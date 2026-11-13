import { readFileSync, existsSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import formbody from '@fastify/formbody';
import cookie from '@fastify/cookie';
import { hash, verify as verifyPassword } from '@node-rs/argon2';
import type pg from 'pg';
import { safeEqual } from './checksum.ts';
import { loadApp, type AppDef, type PageDef } from './model.ts';
import { acceptPage, appBase, applyUrlArgs, HttpError, renderPage, type Ctx } from './runtime.ts';
import { cookieName, cookiePath, createSession, deleteSession, loadSession, saveState, type Session } from './session.ts';
import { finishLogin, identityFrom, OidcSetupError, oidcConfiguration, startLogin } from './oidc.ts';
import rateLimit from '@fastify/rate-limit';
import { errorPage, loginPage } from './templates.ts';

export interface ServerOptions {
   pool: pg.Pool;
   secret: string;
   secureCookies?: boolean;
   logger?: boolean;
   /** external base URL (e.g. https://apps.kcsi.co.id) used for the OIDC redirect URI; defaults to the request host */
   publicUrl?: string;
   /** tests only: allow an http:// issuer */
   allowInsecureOidc?: boolean;
   /** login / SSO attempts per IP per minute */
   loginRateLimit?: number;
}

const STATIC_DIR = join(import.meta.dirname, '../client');
const STATIC_TYPES: Record<string, string> = {
   '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.woff2': 'font/woff2', '.svg': 'image/svg+xml',
};
const MAX_FAILED_LOGINS = 5;
// verifying unknown users against a real hash keeps "unknown user" as slow as "wrong password"
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hash(randomUUID()));

export function buildServer(opts: ServerOptions): FastifyInstance {
   if (!opts.secret || opts.secret.length < 32) throw new Error('RPX_SECRET must be at least 32 characters');
   const app = Fastify({ logger: opts.logger ?? false, trustProxy: true, bodyLimit: 1024 * 1024 });
   app.register(formbody);
   app.register(cookie);
   app.register(rateLimit, { global: false });
   const loginLimit = { max: opts.loginRateLimit ?? 20, timeWindow: '1 minute' };

   app.addHook('onSend', async (_req, reply, payload) => {
      reply.header('Content-Security-Policy',
         "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
      reply.header('X-Content-Type-Options', 'nosniff');
      reply.header('Referrer-Policy', 'same-origin');
      if (!reply.getHeader('Cache-Control')) reply.header('Cache-Control', 'no-store');
      return payload;
   });

   const html = (reply: FastifyReply, body: string, status = 200) => reply.code(status).type('text/html; charset=utf-8').send(body);

   // routes live in a child plugin so that they are added after @fastify/rate-limit has loaded
   app.register(async (app) => {
   // ---------- static assets ----------
   app.get('/static/*', async (req, reply) => {
      const rel = normalize((req.params as { '*': string })['*']).replace(/^([./\\])+/, '');
      const file = join(STATIC_DIR, rel);
      const ext = rel.slice(rel.lastIndexOf('.'));
      if (!file.startsWith(STATIC_DIR) || !STATIC_TYPES[ext] || !existsSync(file)) return reply.code(404).send('Not found');
      reply.header('Cache-Control', 'public, max-age=3600');
      return reply.type(STATIC_TYPES[ext]).send(readFileSync(file));
   });

   app.get('/healthz', async () => {
      await opts.pool.query('select 1');
      return { ok: true };
   });

   // ---------- helpers ----------
   async function resolveApp(req: FastifyRequest): Promise<AppDef> {
      const { ws, app: alias } = req.params as { ws: string; app: string };
      const def = await loadApp(opts.pool, ws, alias);
      if (!def) throw new HttpError(404, 'Aplikasi tidak ditemukan', `Aplikasi "${alias}" tidak ada di workspace "${ws}".`);
      return def;
   }

   function resolvePage(appDef: AppDef, raw: string): PageDef {
      const no = /^\d+$/.test(raw) ? Number(raw) : appDef.pageAliases.get(raw);
      const page = no === undefined ? undefined : appDef.pages.get(no);
      if (!page) throw new HttpError(404, 'Halaman tidak ditemukan', `Halaman "${raw}" tidak ada di aplikasi ini.`);
      return page;
   }

   function setSessionCookie(reply: FastifyReply, appDef: AppDef, s: Session) {
      reply.setCookie(cookieName(appDef), s.id, {
         path: cookiePath(appDef), httpOnly: true, sameSite: 'lax', secure: opts.secureCookies ?? false,
      });
   }

   async function sessionFor(req: FastifyRequest, reply: FastifyReply, appDef: AppDef): Promise<Session> {
      const existing = await loadSession(opts.pool, appDef, req.cookies[cookieName(appDef)]);
      if (existing) return existing;
      const s = await createSession(opts.pool, appDef);
      setSessionCookie(reply, appDef, s);
      return s;
   }

   function loginUrl(appDef: AppDef, returnTo?: string, info?: string): string {
      const q = new URLSearchParams();
      if (returnTo) q.set('return', returnTo);
      if (info) q.set('info', info);
      const qs = q.toString();
      return `${appBase(appDef)}/login${qs ? `?${qs}` : ''}`;
   }

   function safeReturn(appDef: AppDef, r: unknown): string {
      const base = appBase(appDef) + '/';
      return typeof r === 'string' && r.startsWith(base) && !r.includes('//', 1) && !r.startsWith(`${base}login`) ? r : `${base}${appDef.homePage}`;
   }


   // ---------- login / logout ----------
   function renderLogin(appDef: AppDef, s: Session, a: { username?: string; error?: string | null; info?: string | null; returnTo: string }) {
      const sso = appDef.oidc
         ? { label: appDef.oidc.buttonLabel, href: `${appBase(appDef)}/oidc/start?${new URLSearchParams({ return: a.returnTo })}` }
         : null;
      return loginPage({ appName: appDef.name, action: `${appBase(appDef)}/login`, csrf: s.csrf, username: a.username ?? '',
         error: a.error ?? null, info: a.info ?? null, returnTo: a.returnTo, sso, showForm: builtinAllowed(appDef) }).value;
   }
   const builtinAllowed = (appDef: AppDef) => appDef.authScheme === 'builtin_accounts' || !!appDef.oidc?.allowBuiltin;
   const LOGIN_INFO: Record<string, string> = {
      expired: 'Sesi Anda berakhir. Silakan masuk lagi.',
      logout: 'Anda sudah keluar.',
   };

   app.get('/r/:ws/:app/login', async (req, reply) => {
      const appDef = await resolveApp(req);
      const s = await sessionFor(req, reply, appDef);
      const q = req.query as Record<string, string>;
      return html(reply, renderLogin(appDef, s, { info: LOGIN_INFO[q.info] ?? null, returnTo: safeReturn(appDef, q.return) }));
   });

   async function signIn(reply: FastifyReply, appDef: AppDef, guest: Session, user: { id: string; username: string }, returnTo: string) {
      await opts.pool.query('update rpx.app_users set failed_logins = 0, last_login = now() where id = $1', [user.id]);
      // new session id after login (session fixation), the guest session is discarded
      const fresh = await createSession(opts.pool, appDef, user);
      await deleteSession(opts.pool, guest.id);
      setSessionCookie(reply, appDef, fresh);
      return reply.redirect(returnTo, 303);
   }

   app.post('/r/:ws/:app/login', { config: { rateLimit: loginLimit } }, async (req, reply) => {
      const appDef = await resolveApp(req);
      if (!builtinAllowed(appDef)) throw new HttpError(403, 'Tidak tersedia', 'Aplikasi ini hanya menerima masuk lewat SSO.');
      const body = req.body as Record<string, string>;
      const s = await loadSession(opts.pool, appDef, req.cookies[cookieName(appDef)]);
      if (!s || !safeEqual(s.csrf, body.__csrf)) return reply.redirect(loginUrl(appDef, safeReturn(appDef, body.return), 'expired'), 303);
      const username = String(body.username ?? '').trim();
      const password = String(body.password ?? '');
      const u = await opts.pool.query(
         `select id, username, pwd_hash, locked, failed_logins from rpx.app_users where workspace_id = $1 and username = $2`,
         [appDef.workspaceId, username]);
      const user = u.rows[0];
      const ok = await verifyPassword(user?.pwd_hash ?? await getDummyHash(), password).catch(() => false);
      const fail = (msg: string) => html(reply, renderLogin(appDef, s, { username, error: msg, returnTo: safeReturn(appDef, body.return) }), 401);
      if (!user || !user.pwd_hash) return fail('Nama pengguna atau kata sandi salah.');
      if (user.locked) return fail('Akun ini dikunci. Hubungi administrator aplikasi.');
      if (!ok) {
         const r = await opts.pool.query(
            `update rpx.app_users set failed_logins = failed_logins + 1, locked = failed_logins + 1 >= $2
             where id = $1 returning locked`, [user.id, MAX_FAILED_LOGINS]);
         return fail(r.rows[0].locked ? 'Terlalu banyak percobaan gagal. Akun dikunci.' : 'Nama pengguna atau kata sandi salah.');
      }
      return signIn(reply, appDef, s, { id: user.id, username: user.username }, safeReturn(appDef, body.return));
   });

   // ---------- OIDC (SSO) ----------
   function publicBase(req: FastifyRequest): string {
      return (opts.publicUrl ?? `${req.protocol}://${req.host}`).replace(/\/$/, '');
   }
   const OIDC_KEYS = ['__oidc_state', '__oidc_nonce', '__oidc_verifier', '__oidc_return'];

   async function oidcSetup(appDef: AppDef) {
      if (!appDef.oidc) throw new HttpError(404, 'Tidak tersedia', 'Aplikasi ini tidak memakai SSO.');
      try {
         return await oidcConfiguration(appDef.oidc, opts.allowInsecureOidc ?? false);
      } catch (e) {
         if (e instanceof OidcSetupError) throw new HttpError(500, 'Konfigurasi SSO belum lengkap', e.message);
         throw new HttpError(502, 'Penyedia identitas tidak dapat dihubungi', 'Coba lagi beberapa saat lagi atau hubungi administrator.');
      }
   }

   app.get('/r/:ws/:app/oidc/start', { config: { rateLimit: loginLimit } }, async (req, reply) => {
      const appDef = await resolveApp(req);
      const cfg = await oidcSetup(appDef);
      const s = await sessionFor(req, reply, appDef);
      const start = await startLogin(cfg, appDef.oidc!, `${publicBase(req)}${appBase(appDef)}/oidc/callback`);
      await saveState(opts.pool, s, {
         __oidc_state: start.state, __oidc_nonce: start.nonce, __oidc_verifier: start.verifier,
         __oidc_return: safeReturn(appDef, (req.query as Record<string, string>).return),
      });
      return reply.redirect(start.url, 303);
   });

   app.get('/r/:ws/:app/oidc/callback', { config: { rateLimit: loginLimit } }, async (req, reply) => {
      const appDef = await resolveApp(req);
      const cfg = await oidcSetup(appDef);
      const s = await loadSession(opts.pool, appDef, req.cookies[cookieName(appDef)]);
      const st = (k: string) => s?.state.get(k) ?? null;
      if (!s || !st('__oidc_state') || !st('__oidc_verifier') || !st('__oidc_nonce')) {
         return reply.redirect(loginUrl(appDef, undefined, 'expired'), 303);
      }
      const returnTo = safeReturn(appDef, st('__oidc_return'));
      const checks = { state: st('__oidc_state')!, nonce: st('__oidc_nonce')!, verifier: st('__oidc_verifier')! };
      // one-time use, whatever happens next
      await saveState(opts.pool, s, Object.fromEntries(OIDC_KEYS.map(k => [k, null])));
      const fail = (msg: string, status = 401) => html(reply, renderLogin(appDef, s, { error: msg, returnTo }), status);

      const q = req.query as Record<string, string>;
      if (q.error) {
         req.log.warn({ oidcError: q.error }, 'oidc error from IdP');
         return fail(q.error === 'access_denied' ? 'Masuk dibatalkan di penyedia identitas.' : 'Penyedia identitas menolak permintaan masuk.');
      }
      let claims: Record<string, unknown>;
      try {
         claims = await finishLogin(cfg, new URL(`${publicBase(req)}${req.url}`), checks);
      } catch (e) {
         req.log.warn({ err: (e as Error).message }, 'oidc code exchange failed');
         return fail('Verifikasi masuk dari penyedia identitas gagal. Silakan coba lagi.');
      }
      const id = identityFrom(appDef.oidc!, claims);
      if ('rejected' in id) return fail(id.rejected, 403);

      const found = await opts.pool.query(
         `select id, username, locked from rpx.app_users where workspace_id = $1 and oidc_issuer = $2 and oidc_subject = $3`,
         [appDef.workspaceId, id.issuer, id.subject]);
      let user = found.rows[0] as { id: string; username: string; locked: boolean } | undefined;
      if (!user) {
         if (!appDef.oidc!.provision) return fail('Akun Anda belum didaftarkan untuk aplikasi ini. Hubungi administrator.', 403);
         const ins = await opts.pool.query(
            `insert into rpx.app_users (workspace_id, username, email, oidc_issuer, oidc_subject, groups)
             values ($1, $2, $3, $4, $5, $6)
             on conflict (workspace_id, username) do nothing
             returning id, username, locked`,
            [appDef.workspaceId, id.username, id.email, id.issuer, id.subject, id.groups ?? []]);
         if (!ins.rowCount) {
            // the name is taken by a local account: never merge identities silently
            return fail(`Nama pengguna "${id.username}" sudah dipakai akun lain di workspace ini. Hubungi administrator.`, 409);
         }
         user = ins.rows[0];
      } else if (id.groups) {
         await opts.pool.query('update rpx.app_users set groups = $2, email = coalesce($3, email) where id = $1', [user.id, id.groups, id.email]);
      }
      if (user!.locked) return fail('Akun ini dikunci. Hubungi administrator aplikasi.', 403);
      return signIn(reply, appDef, s, { id: user!.id, username: user!.username }, returnTo);
   });

   app.post('/r/:ws/:app/logout', async (req, reply) => {
      const appDef = await resolveApp(req);
      const s = await loadSession(opts.pool, appDef, req.cookies[cookieName(appDef)]);
      const body = req.body as Record<string, string>;
      if (s && safeEqual(s.csrf, body.__csrf)) await deleteSession(opts.pool, s.id);
      reply.clearCookie(cookieName(appDef), { path: cookiePath(appDef) });
      return reply.redirect(loginUrl(appDef, undefined, 'logout'), 303);
   });

   // ---------- show / accept ----------
   app.get('/r/:ws/:app', async (req, reply) => {
      const appDef = await resolveApp(req);
      return reply.redirect(`${appBase(appDef)}/${appDef.homePage}`, 302);
   });

   app.get('/r/:ws/:app/:page', async (req, reply) => {
      const appDef = await resolveApp(req);
      const page = resolvePage(appDef, (req.params as { page: string }).page);
      const session = await sessionFor(req, reply, appDef);
      if (page.requiresAuth && !session.appUserId) return reply.redirect(loginUrl(appDef, req.url), 303);
      const ctx: Ctx = { pool: opts.pool, secret: opts.secret, app: appDef, session };
      const query = req.query as Record<string, string>;
      const hasArgs = Object.keys(query).some(k => k === 'clear' || /^[A-Z]/.test(k));
      await applyUrlArgs(ctx, page, query);
      // drop the item arguments from the address bar after applying them (bookmark-safe, no stale checksums)
      if (hasArgs) {
         const rest = new URLSearchParams(Object.entries(query).filter(([k]) => /^p_/.test(k)));
         const qs = rest.toString();
         return reply.redirect(`${appBase(appDef)}/${page.no}${qs ? `?${qs}` : ''}`, 303);
      }
      return html(reply, await renderPage(ctx, page, { runBeforeHeader: true, query }));
   });

   app.post('/r/:ws/:app/:page', async (req, reply) => {
      const appDef = await resolveApp(req);
      const page = resolvePage(appDef, (req.params as { page: string }).page);
      const session = await loadSession(opts.pool, appDef, req.cookies[cookieName(appDef)]);
      const target = `${appBase(appDef)}/${page.no}`;
      if (!session) return reply.redirect(page.requiresAuth ? loginUrl(appDef, target, 'expired') : target, 303);
      if (page.requiresAuth && !session.appUserId) return reply.redirect(loginUrl(appDef, target), 303);
      const body = (req.body ?? {}) as Record<string, string>;
      if (!safeEqual(session.csrf, body.__csrf)) {
         throw new HttpError(403, 'Formulir kedaluwarsa', 'Formulir ini berasal dari sesi lain atau sudah kedaluwarsa. Muat ulang halaman lalu coba lagi.');
      }
      const ctx: Ctx = { pool: opts.pool, secret: opts.secret, app: appDef, session };
      const r = await acceptPage(ctx, page, body);
      if ('redirect' in r) return reply.redirect(r.redirect, 303);
      return html(reply, r.html, r.status);
   });

   });

   // ---------- errors (S27) ----------
   app.setErrorHandler((err, req, reply) => {
      const params = req.params as { ws?: string; app?: string } | undefined;
      const back = params?.ws && params.app ? `/r/${encodeURIComponent(params.ws)}/${encodeURIComponent(params.app)}` : null;
      if (err instanceof HttpError) {
         return html(reply, errorPage(err.status, err.title, err.message, back).value, err.status);
      }
      const code = (err as { statusCode?: number }).statusCode;
      if (code === 429) {
         return html(reply, errorPage(429, 'Terlalu banyak percobaan', 'Tunggu sekitar satu menit lalu coba lagi.', back).value, 429);
      }
      if (code && code >= 400 && code < 500) {
         return html(reply, errorPage(code, 'Permintaan tidak valid', 'Permintaan tidak dapat diproses.', back).value, code);
      }
      const ref = randomUUID().slice(0, 8);
      req.log.error({ err, ref }, 'unhandled error');
      if (!opts.logger) console.error(`[${ref}]`, err);
      return html(reply, errorPage(500, 'Terjadi kesalahan', `Permintaan tidak dapat diproses. Sebutkan kode referensi ${ref} saat melapor.`, back).value, 500);
   });
   app.setNotFoundHandler((_req, reply) => html(reply, errorPage(404, 'Halaman tidak ditemukan', 'Alamat yang Anda buka tidak ada.', null).value, 404));

   return app;
}
