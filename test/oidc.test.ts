import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Browser, setup, type Env } from './helpers.ts';
import { startMockIdp, type MockIdp } from './oidc-mock.ts';

let env: Env;
let idp: MockIdp;

before(async () => {
   idp = await startMockIdp();
   process.env.RPX_TEST_OIDC_SECRET = idp.clientSecret;
   const spec = readFileSync(join(import.meta.dirname, '../examples/emp/app.yaml'), 'utf8').replace(/^app: emp$/m, `app: emp
authentication:
  scheme: oidc
  allow_builtin: true
  oidc:
    issuer: ${idp.issuer}
    client_id: ${idp.clientId}
    client_secret_env: RPX_TEST_OIDC_SECRET
    groups_claim: groups
    allowed_domains: [kcsi.co.id]
    button_label: Masuk dengan akun KCSI`);
   env = await setup(spec, { allowInsecureOidc: true, publicUrl: 'http://localhost' });
});
after(async () => { await env?.close(); await idp?.close(); });

/** Run the browser through start -> IdP -> callback; returns the callback response. */
async function sso(b: Browser, returnTo = `${env.base}/1`) {
   const start = await b.get(`${env.base}/oidc/start?return=${encodeURIComponent(returnTo)}`);
   assert.equal(start.statusCode, 303);
   const authorize = new URL(String(start.headers.location));
   assert.equal(authorize.origin, idp.issuer);
   assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
   const atIdp = await fetch(authorize, { redirect: 'manual' });
   const callback = new URL(atIdp.headers.get('location')!);
   return { callback, res: await b.get(callback.pathname + callback.search) };
}

test('login page offers SSO and, because allow_builtin is on, the password form', async () => {
   const r = await new Browser(env).open(`${env.base}/1`);
   assert.match(r.body, /Masuk dengan akun KCSI/);
   assert.match(r.body, /name="password"/);
});

test('first SSO login provisions the user with groups and opens the requested page', async () => {
   idp.nextUser = { sub: 'aad-001', email: 'dewi.lestari@kcsi.co.id', preferred_username: 'Dewi.Lestari@kcsi.co.id', groups: ['QC', 'Gudang'] };
   const b = new Browser(env);
   const guest = (await b.get(`${env.base}/login`), [...b.cookies.values()][0]);
   const { res } = await sso(b, `${env.base}/3`);
   assert.equal(res.statusCode, 303);
   assert.equal(res.headers.location, `${env.base}/3`);
   assert.notEqual([...b.cookies.values()][0], guest, 'new session id after SSO login');
   const page = await b.open(`${env.base}/3`);
   assert.match(page.body, /dewi\.lestari@kcsi\.co\.id/, 'username comes from preferred_username, lower-cased');
   const u = await env.pool.query(`select groups, oidc_subject, pwd_hash from rpx.app_users where username = 'dewi.lestari@kcsi.co.id'`);
   assert.deepEqual(u.rows[0], { groups: ['QC', 'Gudang'], oidc_subject: 'aad-001', pwd_hash: null });
});

test('next login with the same subject reuses the account and refreshes groups', async () => {
   idp.nextUser = { sub: 'aad-001', email: 'dewi.lestari@kcsi.co.id', preferred_username: 'dewi.lestari@kcsi.co.id', groups: ['QC'] };
   const { res } = await sso(new Browser(env));
   assert.equal(res.statusCode, 303);
   const n = await env.pool.query(`select count(*)::int as n, max(groups::text) as g from rpx.app_users where oidc_subject = 'aad-001'`);
   assert.deepEqual(n.rows[0], { n: 1, g: '{QC}' });
});

test('accounts outside the allowed domain are refused', async () => {
   idp.nextUser = { sub: 'g-999', email: 'someone@gmail.com', preferred_username: 'someone@gmail.com' };
   const { res } = await sso(new Browser(env));
   assert.equal(res.statusCode, 403);
   assert.match(res.body, /domain &quot;gmail\.com&quot; tidak diizinkan/);
   assert.equal((await env.pool.query(`select count(*)::int as n from rpx.app_users where oidc_subject = 'g-999'`)).rows[0].n, 0);
});

test('a callback with a wrong state is rejected, and a used callback cannot be replayed', async () => {
   idp.nextUser = { sub: 'aad-002', email: 'agus@kcsi.co.id', preferred_username: 'agus@kcsi.co.id' };
   const b = new Browser(env);
   const start = await b.get(`${env.base}/oidc/start`);
   const atIdp = await fetch(String(start.headers.location), { redirect: 'manual' });
   const cb = new URL(atIdp.headers.get('location')!);
   cb.searchParams.set('state', 'forged');
   const bad = await b.get(cb.pathname + cb.search);
   assert.equal(bad.statusCode, 401);
   assert.match(bad.body, /Verifikasi masuk dari penyedia identitas gagal/);
   // the state was consumed by the failed attempt: replaying the genuine callback goes back to login
   cb.searchParams.set('state', new URL(atIdp.headers.get('location')!).searchParams.get('state')!);
   const replay = await b.get(cb.pathname + cb.search);
   assert.equal(replay.statusCode, 303);
   assert.match(String(replay.headers.location), /login\?info=expired/);
});

test('a callback in another browser (no matching session) does not log anyone in', async () => {
   idp.nextUser = { sub: 'aad-003', email: 'rina@kcsi.co.id', preferred_username: 'rina@kcsi.co.id' };
   const victim = new Browser(env);
   const start = await new Browser(env).get(`${env.base}/oidc/start`);
   const atIdp = await fetch(String(start.headers.location), { redirect: 'manual' });
   const cb = new URL(atIdp.headers.get('location')!);
   const r = await victim.get(cb.pathname + cb.search);
   assert.equal(r.statusCode, 303);
   assert.match(String(r.headers.location), /login\?info=expired/);
});

test('an SSO username that collides with a local account is not merged', async () => {
   idp.nextUser = { sub: 'aad-004', email: 'iwan@kcsi.co.id', preferred_username: 'iwan' };
   const { res } = await sso(new Browser(env));
   assert.equal(res.statusCode, 409);
   assert.match(res.body, /sudah dipakai akun lain/);
});

test('IdP error (user cancelled) shows a friendly message', async () => {
   const b = new Browser(env);
   await b.get(`${env.base}/oidc/start`);
   const r = await b.get(`${env.base}/oidc/callback?error=access_denied&state=x`);
   assert.equal(r.statusCode, 401);
   assert.match(r.body, /Masuk dibatalkan/);
});

test('missing client secret gives a clear setup error, not a crash', async () => {
   const saved = process.env.RPX_TEST_OIDC_SECRET;
   delete process.env.RPX_TEST_OIDC_SECRET;
   try {
      const r = await new Browser(env).get(`${env.base}/oidc/start`);
      assert.equal(r.statusCode, 500);
      assert.match(r.body, /RPX_TEST_OIDC_SECRET/);
   } finally {
      process.env.RPX_TEST_OIDC_SECRET = saved;
   }
});
