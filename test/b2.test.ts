import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { addDeveloper, addUser, createWorkspace } from '../src/cli/commands.ts';
import { Browser, field, setup, type Env } from './helpers.ts';

// B2: accounts from the builder (recon S19): application users, developers (administrators only), own password.

const PW = 'rahasia-123';

async function devLogin(b: Browser, workspace: string, username: string, password = PW) {
   const page = await b.get('/builder/login');
   return b.post('/builder/login', { __csrf: field(page.body, '__csrf') ?? '', workspace, username, password, return: '/builder' });
}
/** the CSRF token of a builder page */
async function token(b: Browser, url = '/builder') {
   return field((await b.get(url)).body, '__csrf')!;
}
async function userId(env: Env, username: string) {
   return (await env.pool.query('select id from rpx.app_users where username = $1', [username])).rows[0].id as string;
}
async function devId(env: Env, username: string) {
   return (await env.pool.query('select id from rpx.dev_users where username = $1', [username])).rows[0].id as string;
}

describe('builder accounts (B2)', () => {
   let env: Env;
   const OTHER = 'lain';
   before(async () => {
      env = await setup();
      await addDeveloper(env.pool, env.ws, 'kepala', PW, { admin: true });
      await addDeveloper(env.pool, env.ws, 'rina', PW);
      await createWorkspace(env.pool, OTHER, [`${OTHER}_app`]);
      await addUser(env.pool, OTHER, 'orang_lain', PW);
   });
   after(() => env?.close());

   test('S19 users: application users are listed with groups, searchable and paged', async () => {
      const b = new Browser(env);
      await devLogin(b, env.ws, 'rina');
      const r = await b.get('/builder/users');
      assert.equal(r.statusCode, 200);
      assert.match(r.body, />iwan<\/a>/);
      assert.match(r.body, /<span class="r-badge">SDM<\/span>/);
      assert.doesNotMatch(r.body, /orang_lain/, 'users of another workspace are not shown');
      assert.doesNotMatch(r.body, /href="\/builder\/developers"/, 'a developer who is not an administrator has no Developer menu');
      assert.match((await b.get('/builder/users?q=tam')).body, />tamu<\/a>/);
      assert.match((await b.get('/builder/users?q=%25')).body, /Tidak ada pengguna yang cocok/);

      await env.pool.query(`insert into rpx.app_users (workspace_id, username, pwd_hash)
         select w.id, 'massal' || lpad(i::text, 3, '0'), 'x' from rpx.workspaces w, generate_series(1, 60) i where w.name = $1`, [env.ws]);
      const p1 = await b.get('/builder/users');
      assert.match(p1.body, /Baris 1–50 dari 62/);
      assert.match(p1.body, /href="\/builder\/users\?p=1"/);
      const p2 = await b.get('/builder/users?p=1');
      assert.match(p2.body, /Baris 51–62 dari 62/);
      await env.pool.query(`delete from rpx.app_users where username like 'massal%'`);
   });

   test('S19 users: add a user; the account signs in to the workspace apps', async () => {
      const b = new Browser(env);
      await devLogin(b, env.ws, 'rina');
      const form = await b.get('/builder/users/new');
      assert.match(form.body, /value="SDM"/, 'groups used by authorization are offered');
      assert.match(form.body, /\(emp\)/, 'with the app that uses them');
      const csrf = field(form.body, '__csrf')!;
      const bad = await b.post('/builder/users/new', { __csrf: csrf, username: 'iwan', email: 'bukan-email', password: 'pendek', confirm: 'pendek', groups_other: 'oke, ada spasi' });
      assert.equal(bad.statusCode, 422);
      assert.match(bad.body, /Nama pengguna &quot;iwan&quot; sudah dipakai/);
      assert.match(bad.body, /Format email tidak valid/);
      assert.match(bad.body, /minimal 10 karakter/);
      assert.match(bad.body, /Nama grup tidak valid: ada spasi/);
      const mismatch = await b.post('/builder/users/new', { __csrf: csrf, username: 'dewi', password: 'rahasia-dewi', confirm: 'rahasia-dewi2' });
      assert.match(mismatch.body, /Konfirmasi kata sandi tidak sama/);

      const ok = await b.post('/builder/users/new', { __csrf: csrf, username: 'dewi', email: 'dewi@contoh.id', password: 'rahasia-dewi', confirm: 'rahasia-dewi', groups: 'SDM', groups_other: 'AUDIT, SDM' });
      assert.equal(ok.statusCode, 303);
      const id = await userId(env, 'dewi');
      assert.equal(ok.headers.location, `/builder/users/${id}`);
      const row = (await env.pool.query('select groups, email from rpx.app_users where id = $1', [id])).rows[0];
      assert.deepEqual(row.groups, ['AUDIT', 'SDM']);
      assert.match((await b.get(String(ok.headers.location))).body, /Pengguna dewi ditambahkan/);
      const u = new Browser(env);
      assert.equal((await u.login('dewi', 'rahasia-dewi')).statusCode, 303);
      assert.equal((await u.get(`${env.base}/2`)).statusCode, 200, 'SDM may open the form');
   });

   test('S19 users: groups apply to open sessions at once', async () => {
      const t = new Browser(env);
      await t.login('tamu');
      assert.equal((await t.get(`${env.base}/4`)).statusCode, 403);
      const b = new Browser(env);
      await devLogin(b, env.ws, 'rina');
      const id = await userId(env, 'tamu');
      const r = await b.post(`/builder/users/${id}/groups`, { __csrf: await token(b, `/builder/users/${id}`), groups: 'SDM' });
      assert.equal(r.statusCode, 303);
      assert.match((await b.get(`/builder/users/${id}`)).body, /Grup tamu disimpan: SDM/);
      assert.equal((await t.get(`${env.base}/4`)).statusCode, 200, 'no new sign-in needed');
      await b.post(`/builder/users/${id}/groups`, { __csrf: await token(b), groups_other: '' });
      assert.equal((await t.get(`${env.base}/4`)).statusCode, 403, 'taking the group away works the same way');
   });

   test('S19 users: reset password ends the sessions; lock and unlock', async () => {
      const u = new Browser(env);
      await u.login('iwan');
      assert.equal((await u.get(`${env.base}/1`)).statusCode, 200);
      const b = new Browser(env);
      await devLogin(b, env.ws, 'rina');
      const id = await userId(env, 'iwan');
      const csrf = await token(b, `/builder/users/${id}`);
      const short = await b.post(`/builder/users/${id}/password`, { __csrf: csrf, password: 'iwan', confirm: 'iwan' });
      assert.equal(short.statusCode, 422);
      const same = await b.post(`/builder/users/${id}/password`, { __csrf: csrf, password: 'IWAN', confirm: 'IWAN' });
      assert.match(same.body, /minimal 10 karakter/);
      const ok = await b.post(`/builder/users/${id}/password`, { __csrf: csrf, password: 'sandi-baru-iwan', confirm: 'sandi-baru-iwan' });
      assert.equal(ok.statusCode, 303);
      assert.match((await b.get(`/builder/users/${id}`)).body, /Kata sandi iwan diganti; 1 sesi diakhiri/);
      assert.equal((await u.get(`${env.base}/1`)).statusCode, 303, 'the open session ended');
      assert.equal((await new Browser(env).login('iwan')).statusCode, 401, 'old password no longer works');
      const again = new Browser(env);
      assert.equal((await again.login('iwan', 'sandi-baru-iwan')).statusCode, 303);

      await b.post(`/builder/users/${id}/lock`, { __csrf: csrf, locked: '1' });
      assert.equal((await again.get(`${env.base}/1`)).statusCode, 303, 'locking ends the session');
      const refused = await new Browser(env).login('iwan', 'sandi-baru-iwan');
      assert.equal(refused.statusCode, 401);
      assert.match(refused.body, /dikunci/);
      assert.match((await b.get(`/builder/users/${id}`)).body, /Buka kunci/);
      await b.post(`/builder/users/${id}/lock`, { __csrf: csrf, locked: '0' });
      assert.equal((await new Browser(env).login('iwan', 'sandi-baru-iwan')).statusCode, 303);
   });

   test('S19 users: delete needs the username; other workspaces are out of reach', async () => {
      const b = new Browser(env);
      await devLogin(b, env.ws, 'rina');
      const id = await userId(env, 'dewi');
      const csrf = await token(b, `/builder/users/${id}`);
      const wrong = await b.post(`/builder/users/${id}/delete`, { __csrf: csrf, confirm: 'Dewi ' });
      assert.equal(wrong.statusCode, 422);
      assert.match(wrong.body, /bukan nama pengguna/);
      const ok = await b.post(`/builder/users/${id}/delete`, { __csrf: csrf, confirm: 'dewi' });
      assert.equal(ok.headers.location, '/builder/users');
      assert.equal((await env.pool.query(`select 1 from rpx.app_users where username = 'dewi'`)).rowCount, 0);

      const foreign = await userId(env, 'orang_lain');
      assert.equal((await b.get(`/builder/users/${foreign}`)).statusCode, 404);
      assert.equal((await b.post(`/builder/users/${foreign}/lock`, { __csrf: csrf, locked: '1' })).statusCode, 404);
      assert.equal((await b.get('/builder/users/bukan-uuid')).statusCode, 404);
      assert.equal((await b.post(`/builder/users/${await userId(env, 'tamu')}/lock`, { locked: '1' })).statusCode, 403, 'CSRF token required');
   });

   test('S19 developers: only administrators manage developers', async () => {
      const b = new Browser(env);
      await devLogin(b, env.ws, 'rina');
      assert.equal((await b.get('/builder/developers')).statusCode, 403);
      assert.equal((await b.post(`/builder/developers/${await devId(env, 'kepala')}/lock`, { __csrf: await token(b), locked: '1' })).statusCode, 403);
      assert.equal((await env.pool.query(`select locked from rpx.dev_users where username = 'kepala'`)).rows[0].locked, false);
   });

   test('S19 developers: add, promote, reset, lock and delete a developer', async () => {
      const a = new Browser(env);
      await devLogin(a, env.ws, 'kepala');
      const list = await a.get('/builder/developers');
      assert.equal(list.statusCode, 200);
      assert.match(list.body, /kepala<\/a> <span class="r-muted">\(Anda\)/);
      assert.match(list.body, /href="\/builder\/developers"/);
      const csrf = field(list.body, '__csrf')!;
      const dup = await a.post('/builder/developers/new', { __csrf: csrf, username: 'rina', password: 'rahasia-rina', confirm: 'rahasia-rina' });
      assert.equal(dup.statusCode, 422);
      assert.match(dup.body, /sudah ada di workspace ini/);
      const ok = await a.post('/builder/developers/new', { __csrf: csrf, username: 'joko', email: 'joko@contoh.id', password: 'rahasia-joko', confirm: 'rahasia-joko' });
      assert.equal(ok.statusCode, 303);
      const id = await devId(env, 'joko');
      const j = new Browser(env);
      assert.equal((await devLogin(j, env.ws, 'joko', 'rahasia-joko')).statusCode, 303);
      assert.equal((await j.get('/builder/developers')).statusCode, 403);

      await a.post(`/builder/developers/${id}/role`, { __csrf: csrf, admin: '1' });
      assert.equal((await j.get('/builder/developers')).statusCode, 200, 'the promotion applies to the open session');
      await a.post(`/builder/developers/${id}/role`, { __csrf: csrf, admin: '0' });
      assert.equal((await j.get('/builder/developers')).statusCode, 403);

      const pw = await a.post(`/builder/developers/${id}/password`, { __csrf: csrf, password: 'sandi-baru-joko', confirm: 'sandi-baru-joko' });
      assert.equal(pw.statusCode, 303);
      assert.equal((await j.get('/builder')).statusCode, 303, 'the reset ends the builder session');
      assert.equal((await devLogin(j, env.ws, 'joko', 'sandi-baru-joko')).statusCode, 303);

      await a.post(`/builder/developers/${id}/lock`, { __csrf: csrf, locked: '1' });
      assert.equal((await j.get('/builder')).statusCode, 303);
      assert.equal((await devLogin(new Browser(env), env.ws, 'joko', 'sandi-baru-joko')).statusCode, 401);

      const del = await a.post(`/builder/developers/${id}/delete`, { __csrf: csrf, confirm: 'joko' });
      assert.equal(del.headers.location, '/builder/developers');
      assert.match((await a.get('/builder/developers')).body, /Developer joko dihapus/);
      assert.equal((await env.pool.query(`select 1 from rpx.dev_users where username = 'joko'`)).rowCount, 0);
   });

   test('S19 developers: an administrator cannot lock, demote or delete the own account', async () => {
      const a = new Browser(env);
      await devLogin(a, env.ws, 'kepala');
      const me = await devId(env, 'kepala');
      const csrf = await token(a);
      assert.equal((await a.get(`/builder/developers/${me}`)).headers.location, '/builder/account');
      for (const [path, form] of [['lock', { locked: '1' }], ['role', { admin: '0' }], ['delete', { confirm: 'kepala' }]] as const) {
         const r = await a.post(`/builder/developers/${me}/${path}`, { __csrf: csrf, ...form });
         assert.equal(r.statusCode, 303);
         assert.equal(r.headers.location, '/builder/account');
      }
      const row = (await env.pool.query(`select locked, is_admin from rpx.dev_users where username = 'kepala'`)).rows[0];
      assert.deepEqual(row, { locked: false, is_admin: true });
   });

   test('S19 account: change own password; other sessions end, this one stays', async () => {
      const elsewhere = new Browser(env);
      await devLogin(elsewhere, env.ws, 'rina');
      const b = new Browser(env);
      await devLogin(b, env.ws, 'rina');
      const page = await b.get('/builder/account');
      assert.match(page.body, /Ganti kata sandi/);
      assert.match(page.body, /href="\/builder\/account" title="Akun saya" aria-current="page"/);
      const csrf = field(page.body, '__csrf')!;
      const wrong = await b.post('/builder/account/password', { __csrf: csrf, current: 'salah-salah', password: 'sandi-rina-baru', confirm: 'sandi-rina-baru' });
      assert.equal(wrong.statusCode, 422);
      assert.match(wrong.body, /Kata sandi sekarang salah/);
      const same = await b.post('/builder/account/password', { __csrf: csrf, current: PW, password: PW, confirm: PW });
      assert.match(same.body, /harus berbeda/);
      const ok = await b.post('/builder/account/password', { __csrf: csrf, current: PW, password: 'sandi-rina-baru', confirm: 'sandi-rina-baru' });
      assert.equal(ok.statusCode, 303);
      assert.match((await b.get('/builder/account')).body, /Kata sandi diganti; \d+ sesi lain diakhiri/);
      assert.equal((await elsewhere.get('/builder')).statusCode, 303);
      assert.equal((await devLogin(new Browser(env), env.ws, 'rina', PW)).statusCode, 401);
      assert.equal((await devLogin(new Browser(env), env.ws, 'rina', 'sandi-rina-baru')).statusCode, 303);
   });
});
