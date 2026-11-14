import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { hash, verify as verifyPassword } from '@node-rs/argon2';
import type pg from 'pg';
import YAML from 'yaml';
import { safeEqual } from '../engine/checksum.ts';
import { HttpError } from '../engine/runtime.ts';
import { exportSpec, specToYaml } from '../spec/export.ts';
import { importSpec, parseSpec, SpecError } from '../spec/import.ts';
import {
   createDevSession, deleteDevSession, DEV_COOKIE, DEV_CSRF_COOKIE, DEV_PATH, isUuid, loadDevSession, newCsrfToken, setFlash,
   takeFlash, type DevSession,
} from './session.ts';
import {
   appsView, appView, homeView, importView, loginView, newAppView, type AppDetail, type AppRow, type NewAppForm, type PageRow,
   type VersionRow,
} from './views.ts';

// Builder (Phase 2, B1): developer sign-in per workspace, workspace home, application list, create / import / export / delete.
// Every query is scoped to the signed-in developer's workspace; nothing here takes a workspace from the URL.

export interface BuilderOptions {
   pool: pg.Pool;
   secureCookies: boolean;
   loginLimit: { max: number; timeWindow: string };
}

const MAX_FAILED_LOGINS = 5;
const ALIAS = /^[a-z][a-z0-9_-]{0,59}$/;
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hash(randomUUID()));

/** timestamptz arrives as PostgreSQL text (see engine/db.ts); "2026-11-13 10:18:57.12+07" → Date */
export function pgTime(v: string | null | undefined): Date | null {
   if (!v) return null;
   const d = new Date(v.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00'));
   return Number.isNaN(d.getTime()) ? null : d;
}

const LOGIN_INFO: Record<string, string> = {
   expired: 'Sesi builder berakhir. Silakan masuk lagi.',
   logout: 'Anda sudah keluar dari builder.',
};

export function registerBuilder(app: FastifyInstance, o: BuilderOptions): void {
   const { pool } = o;
   const send = (reply: FastifyReply, body: { value: string }, status = 200) =>
      reply.code(status).type('text/html; charset=utf-8').send(body.value);
   const cookieOpts = { path: DEV_PATH, httpOnly: true, sameSite: 'lax' as const, secure: o.secureCookies };

   function safeReturn(r: unknown): string {
      return typeof r === 'string' && /^\/builder(\/|$|\?)/.test(r) && !r.includes('//') && !r.startsWith('/builder/login') ? r : '/builder';
   }

   /** The signed-in developer, or a redirect to the login page (null). POSTs also need the session's CSRF token. */
   async function dev(req: FastifyRequest, reply: FastifyReply): Promise<DevSession | null> {
      const s = await loadDevSession(pool, req.cookies[DEV_COOKIE]);
      if (!s) {
         const q = new URLSearchParams();
         if (req.method === 'GET') q.set('return', req.url);
         if (req.cookies[DEV_COOKIE]) q.set('info', 'expired');
         reply.clearCookie(DEV_COOKIE, { path: DEV_PATH });
         reply.redirect(`/builder/login${q.size ? `?${q}` : ''}`, 303);
         return null;
      }
      if (req.method === 'POST' && !safeEqual(s.csrf, (req.body as Record<string, string> | undefined)?.__csrf)) {
         throw new HttpError(403, 'Formulir kedaluwarsa', 'Formulir ini berasal dari sesi lain atau sudah kedaluwarsa. Muat ulang halaman lalu coba lagi.');
      }
      return s;
   }

   // ---------- data ----------
   async function listApps(s: DevSession, q = ''): Promise<AppRow[]> {
      const r = await pool.query(
         `select a.alias, a.name, a.version, a.parsing_schema
               , (select count(*)::int from rpx.pages p where p.app_id = a.id) as pages
               , v.imported_at, v.imported_by
            from rpx.applications a
            left join lateral (select imported_at, imported_by from rpx.app_versions v where v.app_id = a.id
                               order by imported_at desc limit 1) v on true
           where a.workspace_id = $1
             and ($2 = '' or a.name ilike '%' || $2 || '%' or a.alias ilike '%' || $2 || '%')
           order by lower(a.name), a.alias`, [s.workspaceId, q.replace(/[\\%_]/g, '\\$&')]);
      return r.rows.map(x => ({
         alias: x.alias, name: x.name, version: x.version, parsingSchema: x.parsing_schema, pages: x.pages,
         changedAt: pgTime(x.imported_at), changedBy: x.imported_by,
      }));
   }

   async function schemas(s: DevSession): Promise<string[]> {
      const r = await pool.query('select schema_name from rpx.workspace_schemas where workspace_id = $1 order by 1', [s.workspaceId]);
      return r.rows.map(x => x.schema_name);
   }

   async function findApp(s: DevSession, alias: string): Promise<AppDetail & { id: string }> {
      const r = await pool.query(
         `select a.id, a.alias, a.name, a.version, a.parsing_schema, a.home_page_no
               , coalesce((select scheme_type from rpx.auth_schemes x where x.app_id = a.id and x.is_current), 'builtin_accounts') as auth
               , (select count(*)::int from rpx.pages p where p.app_id = a.id) as pages
               , v.imported_at, v.imported_by
            from rpx.applications a
            left join lateral (select imported_at, imported_by from rpx.app_versions v where v.app_id = a.id
                               order by imported_at desc limit 1) v on true
           where a.workspace_id = $1 and a.alias = $2`, [s.workspaceId, alias]);
      // an application of another workspace is "not found", the same as one that does not exist
      if (!r.rowCount) throw new HttpError(404, 'Aplikasi tidak ditemukan', `Tidak ada aplikasi "${alias}" di workspace ${s.workspace}.`);
      const x = r.rows[0];
      return {
         id: x.id, alias: x.alias, name: x.name, version: x.version, parsingSchema: x.parsing_schema, pages: x.pages,
         changedAt: pgTime(x.imported_at), changedBy: x.imported_by, homePage: x.home_page_no, authScheme: x.auth,
      };
   }

   const importedBy = (s: DevSession) => `dev:${s.username}`;

   async function importText(s: DevSession, text: string) {
      const c = await pool.connect();
      try {
         await c.query('begin');
         const r = await importSpec(c, s.workspace, text, importedBy(s));
         await c.query('commit');
         return r;
      } catch (e) {
         await c.query('rollback').catch(() => {});
         throw e;
      } finally {
         c.release();
      }
   }

   const aliasParam = (req: FastifyRequest) => (req.params as { alias: string }).alias;

   // ---------- S01 login / logout ----------
   function renderLogin(reply: FastifyReply, req: FastifyRequest, a: { workspace?: string; username?: string; error?: string | null; info?: string | null; returnTo: string }, status = 200) {
      // double-submit token: there is no session yet, so the token lives in its own cookie
      let csrf = req.cookies[DEV_CSRF_COOKIE];
      if (!csrf || !/^[0-9a-f]{64}$/.test(csrf)) {
         csrf = newCsrfToken();
         reply.setCookie(DEV_CSRF_COOKIE, csrf, cookieOpts);
      }
      return send(reply, loginView({ csrf, workspace: a.workspace ?? '', username: a.username ?? '', error: a.error ?? null, info: a.info ?? null, returnTo: a.returnTo }), status);
   }

   app.get('/builder/login', async (req, reply) => {
      const q = req.query as Record<string, string>;
      if (await loadDevSession(pool, req.cookies[DEV_COOKIE])) return reply.redirect(safeReturn(q.return), 303);
      return renderLogin(reply, req, { workspace: typeof q.ws === 'string' ? q.ws : '', info: LOGIN_INFO[q.info] ?? null, returnTo: safeReturn(q.return) });
   });

   app.post('/builder/login', { config: { rateLimit: o.loginLimit } }, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, string>;
      const returnTo = safeReturn(body.return);
      const workspace = String(body.workspace ?? '').trim();
      const username = String(body.username ?? '').trim();
      if (!safeEqual(req.cookies[DEV_CSRF_COOKIE] ?? '', body.__csrf)) {
         return renderLogin(reply, req, { workspace, username, info: 'Formulir masuk kedaluwarsa. Silakan coba lagi.', returnTo }, 403);
      }
      const r = await pool.query(
         `select u.id, u.pwd_hash, u.locked from rpx.dev_users u join rpx.workspaces w on w.id = u.workspace_id
           where w.name = $1 and u.username = $2`, [workspace, username]);
      const user = r.rows[0];
      const ok = await verifyPassword(user?.pwd_hash ?? await getDummyHash(), String(body.password ?? '')).catch(() => false);
      const fail = (msg: string) => renderLogin(reply, req, { workspace, username, error: msg, returnTo }, 401);
      // one message for unknown workspace, unknown user and wrong password
      if (!user) return fail('Workspace, nama pengguna, atau kata sandi salah.');
      if (user.locked) return fail('Akun developer ini dikunci. Hubungi administrator workspace.');
      if (!ok) {
         const u = await pool.query(
            `update rpx.dev_users set failed_logins = failed_logins + 1, locked = failed_logins + 1 >= $2
              where id = $1 returning locked`, [user.id, MAX_FAILED_LOGINS]);
         return fail(u.rows[0].locked ? 'Terlalu banyak percobaan gagal. Akun developer dikunci.' : 'Workspace, nama pengguna, atau kata sandi salah.');
      }
      await pool.query('update rpx.dev_users set failed_logins = 0, last_login = now() where id = $1', [user.id]);
      // a new session id at every sign-in; the previous one (if any) is dropped
      const old = req.cookies[DEV_COOKIE];
      if (isUuid(old)) await deleteDevSession(pool, old);
      const id = await createDevSession(pool, user.id);
      reply.setCookie(DEV_COOKIE, id, cookieOpts);
      reply.clearCookie(DEV_CSRF_COOKIE, { path: DEV_PATH });
      return reply.redirect(returnTo, 303);
   });

   app.post('/builder/logout', async (req, reply) => {
      const s = await dev(req, reply);
      if (!s) return reply;
      await deleteDevSession(pool, s.id);
      reply.clearCookie(DEV_COOKIE, { path: DEV_PATH });
      return reply.redirect(`/builder/login?${new URLSearchParams({ info: 'logout', ws: s.workspace })}`, 303);
   });

   // ---------- S02 workspace home ----------
   app.get('/builder', async (req, reply) => {
      const s = await dev(req, reply);
      if (!s) return reply;
      const [apps, sch, devs] = await Promise.all([
         listApps(s), schemas(s),
         pool.query('select count(*)::int as n from rpx.dev_users where workspace_id = $1', [s.workspaceId]),
      ]);
      return send(reply, homeView(s, await takeFlash(pool, s), { apps, schemas: sch, developers: devs.rows[0].n }));
   });
   app.get('/builder/', async (_req, reply) => reply.redirect('/builder', 301));

   // ---------- S03 application list ----------
   app.get('/builder/apps', async (req, reply) => {
      const s = await dev(req, reply);
      if (!s) return reply;
      const q = String((req.query as Record<string, unknown>).q ?? '').trim().slice(0, 100);
      const all = await listApps(s);
      const shown = q ? await listApps(s, q) : all;
      return send(reply, appsView(s, await takeFlash(pool, s), shown, q, all.length));
   });

   // ---------- S04 create ----------
   app.get('/builder/apps/new', async (req, reply) => {
      const s = await dev(req, reply);
      if (!s) return reply;
      const sch = await schemas(s);
      return send(reply, newAppView(s, { name: '', alias: '', schema: sch[0] ?? '' }, sch, {}));
   });

   app.post('/builder/apps/new', async (req, reply) => {
      const s = await dev(req, reply);
      if (!s) return reply;
      const body = req.body as Record<string, string>;
      const f: NewAppForm = { name: String(body.name ?? '').trim(), alias: String(body.alias ?? '').trim().toLowerCase(), schema: String(body.schema ?? '') };
      const sch = await schemas(s);
      const errors: Record<string, string> = {};
      if (!f.name) errors.name = 'Nama aplikasi wajib diisi.';
      else if (f.name.length > 120) errors.name = 'Nama aplikasi paling panjang 120 karakter.';
      if (!f.alias) errors.alias = 'Alias wajib diisi.';
      else if (!ALIAS.test(f.alias)) errors.alias = 'Alias hanya boleh huruf kecil, angka, garis bawah, atau tanda hubung, dan diawali huruf.';
      if (!sch.includes(f.schema)) errors.schema = 'Pilih skema yang terdaftar di workspace ini.';
      if (!errors.alias) {
         const ex = await pool.query('select 1 from rpx.applications where workspace_id = $1 and alias = $2', [s.workspaceId, f.alias]);
         if (ex.rowCount) errors.alias = `Alias "${f.alias}" sudah dipakai aplikasi lain di workspace ini.`;
      }
      if (Object.keys(errors).length) return send(reply, newAppView(s, f, sch, errors), 422);
      const spec = {
         app: f.alias, name: f.name, version: '1.0', parsing_schema: f.schema, home_page: 1,
         pages: [{
            page: 1, name: 'Beranda', title: f.name,
            regions: [{ static_id: 'selamat_datang', title: 'Selamat datang', type: 'static',
               source: { html: '<p>Halaman ini masih kosong. Ubah spec aplikasi untuk menambahkan region, item, dan halaman.</p>' } }],
         }],
      };
      await importText(s, `# ${f.name}: dibuat di builder oleh ${importedBy(s)}\n${YAML.stringify(spec, { lineWidth: 0 })}`);
      await setFlash(pool, s, { kind: 'success', text: `Aplikasi ${f.name} dibuat.` });
      return reply.redirect(`/builder/apps/${encodeURIComponent(f.alias)}`, 303);
   });

   // ---------- S04 import ----------
   app.get('/builder/apps/import', async (req, reply) => {
      const s = await dev(req, reply);
      if (!s) return reply;
      return send(reply, importView(s, { spec: '', replace: false, problems: [], title: '', exists: null }));
   });

   app.post('/builder/apps/import', async (req, reply) => {
      const s = await dev(req, reply);
      if (!s) return reply;
      const body = req.body as Record<string, string>;
      const text = String(body.spec ?? '').replace(/\r\n/g, '\n');
      const replace = body.replace === '1';
      const again = (title: string, problems: string[], exists: string | null = null, status = 422) =>
         send(reply, importView(s, { spec: text, replace, problems, title, exists }), status);
      if (!text.trim()) return again('Isi spec masih kosong', ['Pilih file YAML atau tempel isinya di kotak spec.']);
      let alias: string;
      try {
         alias = parseSpec(text).app;
      } catch (e) {
         if (e instanceof SpecError) return again('Spec tidak valid', e.problems);
         return again('File bukan YAML yang valid', [(e as Error).message.split('\n')[0]]);
      }
      const ex = await pool.query('select 1 from rpx.applications where workspace_id = $1 and alias = $2', [s.workspaceId, alias]);
      if (ex.rowCount && !replace) {
         return again(`Aplikasi "${alias}" sudah ada`, ['Centang "Ganti aplikasi bila alias sudah ada" untuk menggantinya, atau ubah alias di spec.'], alias, 409);
      }
      try {
         const r = await importText(s, text);
         await setFlash(pool, s, { kind: 'success', text: `${r.replaced ? 'Aplikasi diganti' : 'Aplikasi diimpor'}: ${r.pages} halaman, ${r.regions} region, ${r.items} item.` });
      } catch (e) {
         if (e instanceof SpecError) return again('Spec tidak dapat diimpor', e.problems);
         throw e;
      }
      return reply.redirect(`/builder/apps/${encodeURIComponent(alias)}`, 303);
   });

   // ---------- S05 application home ----------
   async function renderApp(s: DevSession, reply: FastifyReply, alias: string, delError: string | null = null) {
      const a = await findApp(s, alias);
      const [pages, versions] = await Promise.all([
         pool.query(
            `select p.page_no, p.name, p.title, p.alias, p.page_mode, p.requires_auth
                  , (select count(*)::int from rpx.regions r where r.page_id = p.id) as regions
               from rpx.pages p where p.app_id = $1 order by p.page_no`, [a.id]),
         pool.query(
            `select id, imported_at, imported_by, engine_version, spec_hash, octet_length(spec) as size
               from rpx.app_versions where app_id = $1 order by imported_at desc limit 20`, [a.id]),
      ]);
      const pr: PageRow[] = pages.rows.map(x => ({ no: x.page_no, name: x.name, title: x.title, alias: x.alias, mode: x.page_mode, regions: x.regions, requiresAuth: x.requires_auth }));
      const vr: VersionRow[] = versions.rows.map(x => ({ id: x.id, importedAt: pgTime(x.imported_at)!, importedBy: x.imported_by, engineVersion: x.engine_version, specHash: x.spec_hash, size: x.size }));
      return send(reply, appView(s, delError ? null : await takeFlash(pool, s), a, pr, vr, { error: delError }), delError ? 422 : 200);
   }

   app.get('/builder/apps/:alias', async (req, reply) => {
      const s = await dev(req, reply);
      if (!s) return reply;
      return renderApp(s, reply, aliasParam(req));
   });

   app.get('/builder/apps/:alias/export', async (req, reply) => {
      const s = await dev(req, reply);
      if (!s) return reply;
      const a = await findApp(s, aliasParam(req));
      const version = (req.query as Record<string, unknown>).version;
      let text: string;
      let file = `${a.alias}.yaml`;
      if (version !== undefined) {
         const v = isUuid(version)
            ? await pool.query('select spec, imported_at from rpx.app_versions where id = $1 and app_id = $2', [version, a.id])
            : { rowCount: 0, rows: [] };
         if (!v.rowCount) throw new HttpError(404, 'Versi tidak ditemukan', 'Versi spec ini tidak ada di riwayat aplikasi.');
         text = v.rows[0].spec;
         file = `${a.alias}-${pgTime(v.rows[0].imported_at)!.toISOString().slice(0, 19).replace(/[-:T]/g, '')}.yaml`;
      } else {
         text = specToYaml(await exportSpec(pool, s.workspace, a.alias), { workspace: s.workspace, exportedBy: importedBy(s) });
      }
      return reply.type('application/yaml; charset=utf-8').header('Content-Disposition', `attachment; filename="${file}"`).send(text);
   });

   app.post('/builder/apps/:alias/delete', async (req, reply) => {
      const s = await dev(req, reply);
      if (!s) return reply;
      const a = await findApp(s, aliasParam(req));
      const confirm = String((req.body as Record<string, string>).confirm ?? '').trim();
      if (confirm !== a.alias) {
         return renderApp(s, reply, a.alias, confirm ? `Yang diketik "${confirm}", bukan alias aplikasi. Aplikasi tidak dihapus.` : 'Ketik alias aplikasi untuk mengonfirmasi penghapusan.');
      }
      await pool.query('delete from rpx.applications where id = $1 and workspace_id = $2', [a.id, s.workspaceId]);
      await pool.query(`select pg_notify('rpx_app_changed', $1)`, [a.id]);
      await setFlash(pool, s, { kind: 'success', text: `Aplikasi ${a.name} (${a.alias}) dihapus.` });
      return reply.redirect('/builder/apps', 303);
   });
}
