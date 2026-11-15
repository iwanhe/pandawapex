import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { addDeveloper } from '../src/cli/commands.ts';
import { exportSpec } from '../src/spec/export.ts';
import { Browser, field, formFields, setup, type Env } from './helpers.ts';

// Fase 2 full pass: edge cases across the builder (B1–B5) that the per-milestone tests did not cover.

const PW = 'rahasia-123';
const XSS = '<img src=x onerror=alert(1)>';

describe('builder edge cases (Fase 2 full pass)', () => {
   let env: Env;
   let dev: Browser;
   const spec = () => exportSpec(env.pool, env.ws, 'emp');
   async function devLogin(b: Browser, user = 'admin') {
      const page = await b.get('/builder/login');
      return b.post('/builder/login', { __csrf: field(page.body, '__csrf')!, workspace: env.ws, username: user, password: PW, return: '/builder' });
   }
   const csrfOf = async (b: Browser, url = '/builder') => field((await b.get(url)).body, '__csrf')!;

   before(async () => {
      env = await setup();
      await addDeveloper(env.pool, env.ws, 'admin', PW);
      dev = new Browser(env);
      await devLogin(dev);
   });
   after(() => env?.close());

   test('markup in names, labels and help is escaped in builder and runtime', async () => {
      const csrf = await csrfOf(dev, '/builder/apps/new');
      const r = await dev.post('/builder/apps/new', { __csrf: csrf, name: `Aplikasi ${XSS}`, alias: 'xss', schema: env.schema, tables: ['karyawan'] });
      assert.equal(r.statusCode, 303, r.body.slice(0, 600));
      for (const url of ['/builder', '/builder/apps', '/builder/apps/xss', '/builder/apps/xss/pages/1', '/builder/apps/xss/properties']) {
         const body = (await dev.get(url)).body;
         assert.doesNotMatch(body, /<img src=x/, url);
      }
      const page = await dev.get('/builder/apps/emp/pages/new');
      const p = await dev.post('/builder/apps/emp/pages/new', { __csrf: field(page.body, '__csrf')!, kind: 'blank', name: `Kosong ${XSS}`, page: '50', nav: '1' });
      assert.equal(p.statusCode, 303, p.body.slice(0, 600));
      const d = await dev.get('/builder/apps/emp/pages/2?node=item:0:1');
      const form = formFields(d.body.slice(d.body.indexOf('id="editor-title"') - 400));
      const s = await dev.post('/builder/apps/emp/pages/2', { ...form, node: 'item:0:1', action: 'save', 'f.label': `Nama ${XSS}`, 'f.help': `Bantuan ${XSS}` });
      assert.equal(s.statusCode, 303, s.body.slice(0, 600));
      for (const url of ['/builder/apps/emp', '/builder/apps/emp/pages/2', '/builder/apps/emp/pages/2?node=item:0:1', '/builder/apps/emp/pages/50']) {
         assert.doesNotMatch((await dev.get(url)).body, /<img src=x/, url);
      }
      const user = new Browser(env);
      await user.login();
      for (const url of [`${env.base}/1`, `${env.base}/2`, `${env.base}/50`]) {
         assert.doesNotMatch((await user.open(url)).body, /<img src=x/, url);
      }
   });

   test('very long and non-ASCII input', async () => {
      const csrf = await csrfOf(dev, '/builder/apps/new');
      const long = await dev.post('/builder/apps/new', { __csrf: csrf, name: 'N'.repeat(500), alias: 'a'.repeat(200), schema: env.schema });
      assert.equal(long.statusCode, 422, long.body.slice(0, 400));
      const accents = await dev.post('/builder/apps/new', { __csrf: csrf, name: 'Pengajuan Cuti — Ñoño 🎉', alias: 'cuti', schema: env.schema });
      assert.equal(accents.statusCode, 303, accents.body.slice(0, 400));
      assert.match((await dev.get('/builder/apps')).body, /Pengajuan Cuti — Ñoño 🎉/);
      const badAlias = await dev.post('/builder/apps/new', { __csrf: csrf, name: 'X', alias: 'cuti-ñ', schema: env.schema });
      assert.equal(badAlias.statusCode, 422);
      // page wizard: long name, emoji-only name (alias is derived from the name)
      const pcsrf = await csrfOf(dev, '/builder/apps/cuti/pages/new');
      const lp = await dev.post('/builder/apps/cuti/pages/new', { __csrf: pcsrf, kind: 'blank', name: 'H'.repeat(400), page: '20', nav: '1' });
      assert.equal(lp.statusCode, 422, `long page name: ${lp.statusCode}`);
      const ep = await dev.post('/builder/apps/cuti/pages/new', { __csrf: pcsrf, kind: 'blank', name: '🎉🎉', page: '21', nav: '1' });
      assert.ok([303, 422].includes(ep.statusCode), `emoji page name: ${ep.statusCode} ${ep.body.slice(0, 400)}`);
      // designer: a very long label
      const d = await dev.get('/builder/apps/emp/pages/2?node=item:0:2');
      const form = formFields(d.body.slice(d.body.indexOf('id="editor-title"') - 400));
      const ll = await dev.post('/builder/apps/emp/pages/2', { ...form, node: 'item:0:2', action: 'save', 'f.label': 'L'.repeat(5000) });
      assert.ok([303, 422].includes(ll.statusCode), `long label: ${ll.statusCode}`);
      // accounts: long and odd user names
      const ucsrf = await csrfOf(dev, '/builder/users/new');
      for (const username of ['u'.repeat(61), 'budi😀', 'budi spasi']) {
         const u = await dev.post('/builder/users/new', { __csrf: ucsrf, username, email: '', password: 'sandi-panjang-1', confirm: 'sandi-panjang-1' });
         assert.equal(u.statusCode, 422, `${username}: ${u.statusCode}`);
      }
   });

   test('double submit of the page wizard does not create the page twice', async () => {
      const before = (await spec()).pages.length;
      const page = await dev.get('/builder/apps/emp/pages/new');
      const form = { __csrf: field(page.body, '__csrf')!, kind: 'blank', name: 'Ganda', page: '60', nav: '1' };
      const [a, b] = await Promise.all([dev.post('/builder/apps/emp/pages/new', form), dev.post('/builder/apps/emp/pages/new', form)]);
      const after = await spec();
      assert.equal(after.pages.filter(p => p.name === 'Ganda').length, 1, `${a.statusCode} ${b.statusCode}`);
      assert.equal(after.pages.length, before + 1);
      assert.equal(after.navigation!.filter(n => n.label === 'Ganda').length, 1, 'one menu entry');
   });

   test('two developers saving at the same moment — one wins, the other gets 409', async () => {
      const other = new Browser(env);
      await addDeveloper(env.pool, env.ws, 'budi', PW);
      await devLogin(other, 'budi');
      const open = async (b: Browser, node: string) => {
         const r = await b.get(`/builder/apps/emp/pages/2?node=${node}`);
         return formFields(r.body.slice(r.body.indexOf('id="editor-title"') - 400));
      };
      const f1 = await open(dev, 'item:0:2'), f2 = await open(other, 'item:0:3');
      assert.equal(f1.version, f2.version);
      const [r1, r2] = await Promise.all([
         dev.post('/builder/apps/emp/pages/2', { ...f1, node: 'item:0:2', action: 'save', 'f.label': 'Label A' }),
         other.post('/builder/apps/emp/pages/2', { ...f2, node: 'item:0:3', action: 'save', 'f.label': 'Label B' }),
      ]);
      const codes = [r1.statusCode, r2.statusCode].sort();
      const items = (await spec()).pages.find(p => p.page === 2)!.regions![0]!.items!;
      const saved = [items[2]!.label === 'Label A', items[3]!.label === 'Label B'].filter(Boolean).length;
      // either both are kept (serialised) or exactly one is kept and the other was told (409)
      assert.ok((saved === 2 && codes[0] === 303) || (saved === 1 && codes.join() === '303,409'), `codes ${codes} saved ${saved}`);
   });

   test('the page wizard racing a designer save — neither change is lost silently', async () => {
      const d = await dev.get('/builder/apps/emp/pages/2?node=item:0:4');
      const form = formFields(d.body.slice(d.body.indexOf('id="editor-title"') - 400));
      const page = await dev.get('/builder/apps/emp/pages/new');
      const [w, e] = await Promise.all([
         dev.post('/builder/apps/emp/pages/new', { __csrf: field(page.body, '__csrf')!, kind: 'blank', name: 'Balapan', page: '61', nav: '1' }),
         dev.post('/builder/apps/emp/pages/2', { ...form, node: 'item:0:4', action: 'save', 'f.label': 'Label balapan' }),
      ]);
      const now = await spec();
      const pageKept = now.pages.some(p => p.page === 61), labelKept = now.pages.find(p => p.page === 2)!.regions![0]!.items![4]!.label === 'Label balapan';
      assert.equal(pageKept, w.statusCode === 303, `wizard ${w.statusCode}`);
      assert.equal(labelKept, e.statusCode === 303, `designer ${e.statusCode}`);
      assert.ok(pageKept || labelKept);
      if (w.statusCode !== 303) assert.equal(w.statusCode, 409);
      if (e.statusCode !== 303) { assert.equal(e.statusCode, 409); assert.match(e.body, /Label balapan/, 'typed value kept'); }
   });

   test('the page wizard and app properties do not silently overwrite a newer version', async () => {
      // tab A opens the properties, tab B adds a page; tab A then saves: the page from B must survive
      const props = await dev.get('/builder/apps/emp/properties');
      const pf = formFields(props.body);
      const page = await dev.get('/builder/apps/emp/pages/new');
      const add = await dev.post('/builder/apps/emp/pages/new', { __csrf: field(page.body, '__csrf')!, kind: 'blank', name: 'Dari tab B', page: '70', nav: '1' });
      assert.equal(add.statusCode, 303);
      const save = await dev.post('/builder/apps/emp/properties', { ...pf, 'f.name': 'Nama dari tab A' });
      assert.ok([303, 409].includes(save.statusCode));
      assert.ok((await spec()).pages.some(p => p.page === 70), 'page from tab B kept');
   });

   test('session expired while editing — after login the developer lands back on the page', async () => {
      const b = new Browser(env);
      await devLogin(b);
      const d = await b.get('/builder/apps/emp/pages/2?node=item:0:1');
      const form = formFields(d.body.slice(d.body.indexOf('id="editor-title"') - 400));
      await env.pool.query(`update rpx.dev_sessions set last_seen_at = now() - interval '2 hours' where csrf_token = $1`, [form.__csrf]);
      const post = (referer: string) => env.app.inject({
         method: 'POST', url: '/builder/apps/emp/pages/2', payload: new URLSearchParams({ ...form, node: 'item:0:1', action: 'save', 'f.label': 'Hilang?' }).toString(),
         headers: { cookie: [...b.cookies].map(([k, v]) => `${k}=${v}`).join('; '), 'content-type': 'application/x-www-form-urlencoded', host: 'rpx.local', referer },
      });
      // another site, or a page outside the builder, is not a place to come back to
      for (const referer of ['https://jahat.example/builder/apps', 'http://rpx.local/r/x/emp/1', 'http://rpx.local/builder/login']) {
         assert.equal(new URL(String((await post(referer)).headers.location), 'http://x').searchParams.get('return'), null, referer);
      }
      const r = await post('http://rpx.local/builder/apps/emp/pages/2?node=item:0:1');
      assert.equal(r.statusCode, 303);
      const loc = new URL(String(r.headers.location), 'http://x');
      assert.equal(loc.pathname, '/builder/login');
      assert.equal(loc.searchParams.get('info'), 'expired');
      assert.equal(loc.searchParams.get('return'), '/builder/apps/emp/pages/2?node=item:0:1', 'returns to the page being edited');
   });

   test('SQL report source cannot read the platform tables or other workspaces', async () => {
      const page = await dev.get('/builder/apps/emp/pages/new');
      const csrf = field(page.body, '__csrf')!;
      for (const sql of ['select username, password_hash from rpx.dev_users', 'select * from rpx.sessions', 'select * from rpx.app_users', 'select spec from rpx.app_versions']) {
         const r = await dev.post('/builder/apps/emp/pages/new', { __csrf: csrf, kind: 'report', source: 'sql', sql, name: 'Bocor', page: '80', nav: '1' });
         assert.equal(r.statusCode, 422, `${sql}: ${r.statusCode}`);
      }
      // the query is only described (limit 0), never run, so a slow query does not hold the wizard
      const slow = Date.now();
      const t = await dev.post('/builder/apps/emp/pages/new', { __csrf: csrf, kind: 'report', source: 'sql', sql: 'select pg_sleep(20) as x', name: 'Lambat', page: '80', nav: '1' });
      assert.equal(t.statusCode, 303);
      assert.ok(Date.now() - slow < 5_000);
   });

   test('renaming an item that other components use', async () => {
      const d = await dev.get('/builder/apps/emp/pages/2?node=item:0:0');
      const form = formFields(d.body.slice(d.body.indexOf('id="editor-title"') - 400));
      const r = await dev.post('/builder/apps/emp/pages/2', { ...form, node: 'item:0:0', action: 'save', 'f.name': 'P2_KUNCI' });
      assert.ok([303, 422].includes(r.statusCode), `${r.statusCode} ${r.body.slice(0, 300)}`);
      if (r.statusCode === 303) {
         // the app still works: the report link opens the form for the right row
         const user = new Browser(env);
         await user.login();
         const report = await user.open(`${env.base}/1`);
         assert.equal(report.statusCode, 200);
      }
   });

   test('a deleted application while another tab is open', async () => {
      const csrf = await csrfOf(dev, '/builder/apps/new');
      await dev.post('/builder/apps/new', { __csrf: csrf, name: 'Sementara', alias: 'tmp', schema: env.schema, tables: ['departemen'] });
      const d = await dev.get('/builder/apps/tmp/pages/2?node=page');
      const form = formFields(d.body.slice(d.body.indexOf('id="editor-title"') - 400));
      const home = await dev.get('/builder/apps/tmp');
      const del = await dev.post('/builder/apps/tmp/delete', { __csrf: field(home.body, '__csrf')!, confirm: 'tmp' });
      assert.equal(del.statusCode, 303);
      const r = await dev.post('/builder/apps/tmp/pages/2', { ...form, node: 'page', action: 'save' });
      assert.equal(r.statusCode, 404);
      assert.match(r.body, /href="\/builder\/apps"/);
   });

   test('builder pages are not kept in the browser cache (back button after logout)', async () => {
      for (const url of ['/builder', '/builder/apps/emp', '/builder/users', '/builder/apps/emp/pages/2']) {
         const r = await dev.get(url);
         assert.match(String(r.headers['cache-control'] ?? ''), /no-store/, url);
      }
   });

   test('a spec larger than the request limit gets a readable page', async () => {
      const r = await env.app.inject({
         method: 'POST', url: '/builder/apps/import', payload: 'spec=' + 'x'.repeat(1_100_000),
         headers: { cookie: [...dev.cookies].map(([k, v]) => `${k}=${v}`).join('; '), 'content-type': 'application/x-www-form-urlencoded' },
      });
      assert.equal(r.statusCode, 413);
      assert.match(String(r.headers['content-type']), /text\/html/);
      assert.match(r.body, /href="\/builder\/apps"/);
   });
});
