import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { addDeveloper, createWorkspace } from '../src/cli/commands.ts';
import { Browser, field, formFields, setupPilotEnv, type Env } from './helpers.ts';

// B1 builder: developer sign-in per workspace (S01), workspace home (S02), application list (S03),
// create / import (S04), application home with export, version download and delete (S05).

const PW = 'rahasia-123';

async function devLogin(b: Browser, workspace: string, username = 'admin', password = PW, returnTo = '/builder') {
   const page = await b.get(`/builder/login?return=${encodeURIComponent(returnTo)}`);
   return b.post('/builder/login', { __csrf: field(page.body, '__csrf') ?? '', workspace, username, password, return: returnTo });
}

/** export text without the header comment (it carries a timestamp) */
const body = (yaml: string) => yaml.replace(/^(#.*\n)+/, '');

describe('builder (B1)', () => {
   let env: Env;
   const OTHER = 'lain';
   before(async () => {
      env = await setupPilotEnv();
      await createWorkspace(env.pool, OTHER, [`${OTHER}_app`]);
      await addDeveloper(env.pool, OTHER, 'tina', PW);
   });
   after(() => env?.close());

   test('S01: the builder needs a developer sign-in; app accounts do not work there', async () => {
      const b = new Browser(env);
      const r = await b.get('/builder/apps?q=x');
      assert.equal(r.statusCode, 303);
      assert.equal(r.headers.location, `/builder/login?return=${encodeURIComponent('/builder/apps?q=x')}`);
      const login = await b.get(String(r.headers.location));
      assert.match(login.body, /Masuk sebagai developer/);
      assert.ok(b.cookies.has('rpx_dev_csrf'));
      // budi is an application user of the pilot app, not a developer
      const app = await devLogin(b, env.ws, 'budi');
      assert.equal(app.statusCode, 401);
      assert.match(app.body, /Workspace, nama pengguna, atau kata sandi salah/);
      const ws = await devLogin(b, 'tidak-ada');
      assert.equal(ws.statusCode, 401);
      assert.match(ws.body, /Workspace, nama pengguna, atau kata sandi salah/);
   });

   test('S01: login needs the form token, starts a fresh session and returns to the page asked for', async () => {
      const b = new Browser(env);
      const noToken = await b.post('/builder/login', { workspace: env.ws, username: 'admin', password: PW });
      assert.equal(noToken.statusCode, 403);
      assert.ok(!b.cookies.has('rpx_dev'));

      const ok = await devLogin(b, env.ws, 'admin', PW, '/builder/apps?q=demo');
      assert.equal(ok.statusCode, 303);
      assert.equal(ok.headers.location, '/builder/apps?q=demo');
      const set = [ok.headers['set-cookie']].flat().join('\n');
      assert.match(set, /rpx_dev=[0-9a-f-]{36}; Path=\/builder; HttpOnly; SameSite=Lax/);
      const first = b.cookies.get('rpx_dev');

      // a return address outside the builder is ignored
      const evil = await devLogin(b, env.ws, 'admin', PW, '//evil.example/builder');
      assert.equal(evil.headers.location, '/builder');
      assert.notEqual(b.cookies.get('rpx_dev'), first);
      const old = await env.pool.query('select 1 from rpx.dev_sessions where id = $1', [first]);
      assert.equal(old.rowCount, 0, 'the previous session is dropped at sign-in');
      // a signed-in developer opening the login page goes straight in
      const again = await b.get('/builder/login');
      assert.equal(again.statusCode, 303);
   });

   test('S01: five wrong passwords lock the developer; dev add unlocks', async () => {
      await addDeveloper(env.pool, env.ws, 'kunci', PW);
      const b = new Browser(env);
      for (let i = 1; i <= 5; i++) {
         const r = await devLogin(b, env.ws, 'kunci', 'salah-salah');
         assert.equal(r.statusCode, 401);
         if (i === 5) assert.match(r.body, /Akun developer dikunci/);
      }
      const right = await devLogin(b, env.ws, 'kunci', PW);
      assert.equal(right.statusCode, 401);
      assert.match(right.body, /dikunci/);
      await addDeveloper(env.pool, env.ws, 'kunci', PW);
      assert.equal((await devLogin(b, env.ws, 'kunci', PW)).statusCode, 303);
      // locking an account ends its open sessions
      await env.pool.query(`update rpx.dev_users set locked = true where username = 'kunci'`);
      const r = await b.get('/builder');
      assert.equal(r.statusCode, 303);
      assert.match(String(r.headers.location), /^\/builder\/login\?.*info=expired/);
   });

   test('S02 / S03: workspace home and application list, with search', async () => {
      const b = new Browser(env);
      await devLogin(b, env.ws);
      const home = await b.get('/builder');
      assert.equal(home.statusCode, 200);
      assert.match(home.body, new RegExp(`Workspace ${env.ws}`));
      assert.match(home.body, /Demo Permintaan Barang/);
      assert.match(home.body, /apx_demo/, 'schemas of the workspace are listed');
      assert.match(home.body, /<form method="post" action="\/builder\/logout"/);

      const list = await b.get('/builder/apps');
      assert.match(list.body, /href="\/builder\/apps\/demo"/);
      assert.match(list.body, new RegExp(`href="/r/${env.ws}/demo"`), 'run link');
      assert.match(list.body, /href="\/builder\/apps\/demo\/export" download/);
      assert.match((await b.get('/builder/apps?q=PERMINTAAN')).body, /href="\/builder\/apps\/demo"/);
      const none = await b.get('/builder/apps?q=%25');
      assert.match(none.body, /Tidak ada aplikasi yang cocok/, '% is matched literally, not as a wildcard');
   });

   test('a developer only sees the own workspace', async () => {
      const b = new Browser(env);
      assert.equal((await devLogin(b, OTHER, 'tina')).statusCode, 303);
      const list = await b.get('/builder/apps');
      assert.doesNotMatch(list.body, /Demo Permintaan Barang/);
      assert.match(list.body, /Belum ada aplikasi di workspace ini/);
      assert.equal((await b.get('/builder/apps/demo')).statusCode, 404);
      assert.equal((await b.get('/builder/apps/demo/export')).statusCode, 404);
      const app = await b.get('/builder/apps/new');
      const del = await b.post('/builder/apps/demo/delete', { __csrf: field(app.body, '__csrf')!, confirm: 'demo' });
      assert.equal(del.statusCode, 404);
      assert.equal((await env.pool.query(`select 1 from rpx.applications where alias = 'demo'`)).rowCount, 1);
      // tina cannot sign in to the pilot workspace with her account either
      assert.equal((await devLogin(new Browser(env), env.ws, 'tina')).statusCode, 401);
   });

   test('S04: create an application', async () => {
      const b = new Browser(env);
      await devLogin(b, OTHER, 'tina');
      const form = await b.get('/builder/apps/new');
      assert.match(form.body, /<option value="lain_app" selected>/);
      const csrf = field(form.body, '__csrf')!;
      const bad = await b.post('/builder/apps/new', { __csrf: csrf, name: '', alias: '9 Salah', schema: 'apx_demo' });
      assert.equal(bad.statusCode, 422);
      assert.match(bad.body, /Nama aplikasi wajib diisi/);
      assert.match(bad.body, /Alias hanya boleh/);
      assert.match(bad.body, /Pilih skema yang terdaftar/, 'a schema of another workspace is refused');
      assert.match(bad.body, /value="9 salah"/, "input is kept (alias in lower case)");

      const ok = await b.post('/builder/apps/new', { __csrf: csrf, name: 'Inventaris Gudang', alias: 'Inventaris', schema: 'lain_app' });
      assert.equal(ok.statusCode, 303);
      assert.equal(ok.headers.location, '/builder/apps/inventaris');
      const home = await b.get('/builder/apps/inventaris');
      assert.match(home.body, /Aplikasi Inventaris Gudang dibuat/);
      assert.match(home.body, /Halaman \(1\)/);
      assert.match(home.body, /dev:tina/);
      assert.doesNotMatch((await b.get('/builder/apps/inventaris')).body, /dibuat\.<\/p>/, 'the message shows once');
      // it runs: page 1 asks for a sign-in
      const run = await env.app.inject({ url: `/r/${OTHER}/inventaris/1` });
      assert.equal(run.statusCode, 303);
      assert.match(String(run.headers.location), new RegExp(`^/r/${OTHER}/inventaris/login`));

      const dup = await b.post('/builder/apps/new', { __csrf: csrf, name: 'Lagi', alias: 'inventaris', schema: 'lain_app' });
      assert.equal(dup.statusCode, 422);
      assert.match(dup.body, /sudah dipakai/);
   });

   test('S05: export, re-import through the builder, unchanged (round trip)', async () => {
      const b = new Browser(env);
      await devLogin(b, env.ws);
      const ex = await b.get('/builder/apps/demo/export');
      assert.equal(ex.statusCode, 200);
      assert.match(String(ex.headers['content-type']), /^application\/yaml/);
      assert.equal(ex.headers['content-disposition'], 'attachment; filename="demo.yaml"');
      assert.match(ex.body, new RegExp(`^# Demo Permintaan Barang: diekspor dari pandawapex .*, workspace ${env.ws}, oleh dev:admin`));

      const form = await b.get('/builder/apps/import');
      const csrf = field(form.body, '__csrf')!;
      const exists = await b.post('/builder/apps/import', { __csrf: csrf, spec: ex.body });
      assert.equal(exists.statusCode, 409);
      assert.match(exists.body, /Aplikasi &quot;demo&quot; sudah ada/);
      assert.match(exists.body, /Demo Permintaan Barang: diekspor/, 'the spec stays in the box');

      const before = await env.pool.query(`select count(*)::int n from rpx.app_versions v join rpx.applications a on a.id = v.app_id where a.alias = 'demo'`);
      // the browser sends CRLF line ends from a textarea
      const ok = await b.post('/builder/apps/import', { __csrf: csrf, spec: ex.body.replace(/\n/g, '\r\n'), replace: '1' });
      assert.equal(ok.statusCode, 303);
      assert.equal(ok.headers.location, '/builder/apps/demo');
      const home = await b.get('/builder/apps/demo');
      assert.match(home.body, /Aplikasi diganti: 17 halaman/);
      const v = await env.pool.query(`select v.imported_by from rpx.app_versions v join rpx.applications a on a.id = v.app_id where a.alias = 'demo' order by imported_at desc`);
      assert.equal(v.rowCount, before.rows[0].n + 1);
      assert.equal(v.rows[0].imported_by, 'dev:admin');

      const again = await b.get('/builder/apps/demo/export');
      assert.equal(body(again.body), body(ex.body), 'export → import → export gives the same spec');
      // the app still works for its users
      const u = new Browser(env);
      assert.equal((await u.login('budi')).statusCode, 303);
   });

   test('S04: spec problems are listed, nothing is imported', async () => {
      const b = new Browser(env);
      await devLogin(b, env.ws);
      const csrf = field((await b.get('/builder/apps/import')).body, '__csrf')!;
      const empty = await b.post('/builder/apps/import', { __csrf: csrf, spec: '  ' });
      assert.equal(empty.statusCode, 422);
      assert.match(empty.body, /Isi spec masih kosong/);
      const yaml = await b.post('/builder/apps/import', { __csrf: csrf, spec: 'app: [tidak tertutup' });
      assert.equal(yaml.statusCode, 422);
      assert.match(yaml.body, /File bukan YAML yang valid/);
      const spec = await b.post('/builder/apps/import', { __csrf: csrf, spec: 'app: baru\nname: Baru\nparsing_schema: lain_app\npages:\n  - page: 1\n    name: A\n' });
      assert.equal(spec.statusCode, 422);
      assert.match(spec.body, /Spec tidak dapat diimpor/);
      assert.match(spec.body, /schema &quot;lain_app&quot; is not assigned to workspace/);
      assert.equal((await env.pool.query(`select 1 from rpx.applications where alias = 'baru'`)).rowCount, 0);
      const fields = formFields(spec.body);
      assert.match(fields.spec, /^app: baru/);
   });

   test('S05: version history downloads the exact text that was imported', async () => {
      const b = new Browser(env);
      await devLogin(b, env.ws);
      const home = await b.get('/builder/apps/demo');
      const ids = [...home.body.matchAll(/export\?version=([0-9a-f-]{36})/g)].map(m => m[1]);
      assert.ok(ids.length >= 2);
      const stored = await env.pool.query('select spec from rpx.app_versions where id = $1', [ids[1]]);
      const dl = await b.get(`/builder/apps/demo/export?version=${ids[1]}`);
      assert.equal(dl.statusCode, 200);
      assert.equal(dl.body, stored.rows[0].spec);
      assert.match(String(dl.headers['content-disposition']), /filename="demo-\d{14}\.yaml"/);
      assert.equal((await b.get('/builder/apps/demo/export?version=xyz')).statusCode, 404);
      // a version of another app is not served through this one
      const inv = await env.pool.query(`select v.id from rpx.app_versions v join rpx.applications a on a.id = v.app_id where a.alias = 'inventaris'`);
      assert.equal((await b.get(`/builder/apps/demo/export?version=${inv.rows[0].id}`)).statusCode, 404);
   });

   test('S05: delete needs the alias typed and leaves the data alone', async () => {
      const b = new Browser(env);
      await devLogin(b, OTHER, 'tina');
      const page = await b.get('/builder/apps/inventaris');
      const csrf = field(page.body, '__csrf')!;
      const noToken = await b.post('/builder/apps/inventaris/delete', { confirm: 'inventaris' });
      assert.equal(noToken.statusCode, 403);
      const wrong = await b.post('/builder/apps/inventaris/delete', { __csrf: csrf, confirm: 'Inventaris Gudang' });
      assert.equal(wrong.statusCode, 422);
      assert.match(wrong.body, /bukan alias aplikasi/);
      assert.equal((await env.pool.query(`select 1 from rpx.applications where alias = 'inventaris'`)).rowCount, 1);
      const ok = await b.post('/builder/apps/inventaris/delete', { __csrf: csrf, confirm: 'inventaris' });
      assert.equal(ok.statusCode, 303);
      assert.equal(ok.headers.location, '/builder/apps');
      assert.match((await b.get('/builder/apps')).body, /Aplikasi Inventaris Gudang \(inventaris\) dihapus/);
      assert.equal((await env.pool.query(`select 1 from rpx.applications where alias = 'inventaris'`)).rowCount, 0);
      assert.equal((await env.app.inject({ url: `/r/${OTHER}/inventaris/1` })).statusCode, 404);
   });

   test('sessions end at logout and after an hour idle', async () => {
      const b = new Browser(env);
      await devLogin(b, env.ws);
      const id = b.cookies.get('rpx_dev')!;
      const home = await b.get('/builder');
      const out = await b.post('/builder/logout', { __csrf: field(home.body, '__csrf')! });
      assert.equal(out.statusCode, 303);
      assert.equal(out.headers.location, `/builder/login?info=logout&ws=${env.ws}`);
      assert.match((await b.get(String(out.headers.location))).body, /Anda sudah keluar dari builder/);
      assert.equal((await env.pool.query('select 1 from rpx.dev_sessions where id = $1', [id])).rowCount, 0);
      // replaying the old cookie does not work
      b.cookies.set('rpx_dev', id);
      assert.match(String((await b.get('/builder')).headers.location), /info=expired/);

      await devLogin(b, env.ws);
      await env.pool.query(`update rpx.dev_sessions set last_seen_at = now() - interval '61 minutes' where id = $1`, [b.cookies.get('rpx_dev')]);
      const idle = await b.get('/builder/apps');
      assert.equal(idle.statusCode, 303);
      assert.match(String(idle.headers.location), /^\/builder\/login\?return=%2Fbuilder%2Fapps&info=expired$/);
   });

   test('builder errors link back into the builder', async () => {
      const b = new Browser(env);
      await devLogin(b, env.ws);
      const r = await b.get('/builder/apps/tidak-ada');
      assert.equal(r.statusCode, 404);
      assert.match(r.body, /href="\/builder\/apps"/);
      const nf = await b.get('/builder/tidak/ada/sama/sekali');
      assert.match(nf.body, /href="\/builder"/);
   });
});
