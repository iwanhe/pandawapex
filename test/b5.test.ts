import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { addDeveloper, createWorkspace } from '../src/cli/commands.ts';
import { exportSpec } from '../src/spec/export.ts';
import { Browser, field, formFields, setup, type Env } from './helpers.ts';

// B5: Page Designer (recon S06, flow F03) and application properties (S13), on the example app "emp".

const PW = 'rahasia-123';

describe('page designer (B5)', () => {
   let env: Env;
   let dev: Browser;
   const P = (n: number) => `/builder/apps/emp/pages/${n}`;
   const spec = () => exportSpec(env.pool, env.ws, 'emp');
   /** open a component in the designer and post its editor form with some fields changed */
   async function edit(page: number, node: string, change: Record<string, string>) {
      const r = await dev.get(`${P(page)}?node=${node}`);
      assert.equal(r.statusCode, 200);
      const form = formFields(r.body.slice(r.body.indexOf('id="editor-title"') - 400));
      return dev.post(P(page), { ...form, node, action: 'save', ...change });
   }
   async function act(page: number, action: string, extra: Record<string, string> = {}) {
      const r = await dev.get(P(page));
      return dev.post(P(page), { __csrf: field(r.body, '__csrf')!, version: field(r.body, 'version')!, action, ...extra });
   }

   before(async () => {
      env = await setup();
      await addDeveloper(env.pool, env.ws, 'admin', PW);
      dev = new Browser(env);
      const page = await dev.get('/builder/login');
      await dev.post('/builder/login', { __csrf: field(page.body, '__csrf')!, workspace: env.ws, username: 'admin', password: PW, return: '/builder' });
   });
   after(() => env?.close());

   test('S06: the page as a tree, and a property editor generated from the spec schema', async () => {
      const home = await dev.get('/builder/apps/emp');
      assert.match(home.body, /href="\/builder\/apps\/emp\/pages\/2" aria-label="Ubah halaman 2/);
      assert.match(home.body, /href="\/builder\/apps\/emp\/properties"/);
      const r = await dev.get(P(2));
      assert.equal(r.statusCode, 200);
      assert.match(r.body, /<h1>Halaman 2: Form karyawan<\/h1>/);
      for (const n of ['region:0', 'item:0:1', 'button:0:2', 'validation:0', 'process:1', 'branch:0', 'computation:0']) assert.match(r.body, new RegExp(`\\?node=${n}"`), n);
      assert.match(r.body, /name="f\.mode"/);
      assert.doesNotMatch(r.body, /name="f\.regions"/, 'children are edited in the tree, not as a field');
      const item = await dev.get(`${P(2)}?node=item:0:1`);
      assert.match(item.body, /<span class="r-badge">Item<\/span> P2_NAMA/);
      assert.match(item.body, /name="f\.label" value="Nama lengkap"/);
      assert.match(item.body, /name="f\.source\.column" value="nama"/, 'small objects are flattened');
      assert.match(item.body, /<option value="text" selected>text<\/option>/);
      assert.match(item.body, /aria-current="true"><span class="r-tree__kind">Item<\/span> P2_NAMA/);
      // an unknown node falls back to the page
      assert.match((await dev.get(`${P(2)}?node=item:9:9`)).body, /<span class="r-badge">Halaman<\/span>/);
      assert.equal((await dev.get(P(77))).statusCode, 404);
   });

   test('F03: change an item, a YAML property and the page; the runtime follows', async () => {
      const r = await edit(2, 'item:0:1', { 'f.label': 'Nama sesuai KTP', 'f.help': 'Tanpa gelar.' });
      assert.equal(r.statusCode, 303, r.body.slice(0, 800));
      assert.equal(r.headers.location, `${P(2)}?node=item:0:1`);
      assert.match((await dev.get(String(r.headers.location))).body, /Item P2_NAMA disimpan/);
      const item = (await spec()).pages[1].regions![0].items![1];
      assert.equal(item.label, 'Nama sesuai KTP');
      assert.equal(item.help, 'Tanpa gelar.');
      assert.equal(item.max_length, 120, 'untouched properties stay');

      const cond = await edit(2, 'button:0:1', { 'f.condition': 'item_not_null: P2_EMPNO\n', 'f.confirm': 'Yakin hapus karyawan ini?' });
      assert.equal(cond.statusCode, 303, cond.body.slice(0, 800));
      assert.equal((await spec()).pages[1].regions![0].buttons![1].confirm, 'Yakin hapus karyawan ini?');

      const page = await edit(2, 'page', { 'f.dialog_size': 'lg', 'f.title': 'Data karyawan' });
      assert.equal(page.statusCode, 303);
      const p2 = (await spec()).pages[1];
      assert.equal(p2.dialog_size, 'lg');
      assert.equal(p2.regions!.length, 1, 'regions survive a page save');

      const u = new Browser(env);
      await u.login('iwan');
      const run = await u.get(`${env.base}/2`);
      assert.match(run.body, /Nama sesuai KTP/);
      assert.match(run.body, /Tanpa gelar\./);
   });

   test('F03: wrong values are refused with the reason and nothing is saved', async () => {
      const before = await spec();
      const yaml = await edit(2, 'button:0:1', { 'f.condition': 'item_not_null: [tidak ditutup' });
      assert.equal(yaml.statusCode, 422);
      assert.match(yaml.body, /Kondisi: YAML tidak valid/);
      const req = await edit(2, 'button:0:1', { 'f.label': '' });
      assert.match(req.body, /Label wajib diisi/);
      const int = await edit(2, 'item:0:1', { 'f.col_span': 'lebar' });
      assert.match(int.body, /harus bilangan bulat/);
      const bad = await edit(2, 'item:0:1', { 'f.name': 'P9_SALAH', 'f.col_span': '20' });
      assert.equal(bad.statusCode, 422);
      assert.match(bad.body, /Perubahan tidak dapat disimpan/);
      assert.match(bad.body, /value="P9_SALAH"/, 'what was typed is kept');
      const num = await edit(2, 'page', { 'f.page': '99' });
      assert.match(num.body, /Nomor halaman tidak bisa diubah di sini/);
      assert.deepEqual(await spec(), before);
   });

   test('DA1: dynamic actions are edited as YAML on the page and checked like an import', async () => {
      const page = await dev.get(`${P(2)}?node=page`);
      assert.match(page.body, /<textarea[^>]*name="f\.dynamic_actions"[^>]*>[^<]*magang_tanpa_keahlian/);
      const bad = await edit(2, 'page', { 'f.dynamic_actions': '- { name: x, event: click, button: SIMPAN, actions: [ { action: hide, items: [P2_GAJI] } ] }\n' });
      assert.equal(bad.statusCode, 422);
      assert.match(bad.body, /button SIMPAN must have action defined_by_da/);
      const good = await edit(2, 'page', { 'f.dynamic_actions':
         '- { name: aktif, event: change, items: [P2_AKTIF], when: { item_equals: { item: P2_AKTIF, value: "N" } }, actions: [ { action: disable, items: [P2_JABATAN] } ], else: [ { action: enable, items: [P2_JABATAN] } ] }\n' });
      assert.equal(good.statusCode, 303, good.body.slice(0, 800));
      const das = (await spec()).pages.find(x => x.page === 2)!.dynamic_actions!;
      assert.deepEqual(das.map(d => d.name), ['aktif']);
      assert.deepEqual(das[0].else, [{ action: 'enable', items: ['P2_JABATAN'] }]);
   });

   test('F03: add, reorder and delete components', async () => {
      const add = await act(3, 'add_region');
      assert.equal(add.statusCode, 303, add.body.slice(0, 600));
      assert.equal(add.headers.location, `${P(3)}?node=region:1`);
      assert.match((await dev.get(String(add.headers.location))).body, /Region Region baru ditambahkan/);
      const item = await act(3, 'add_item', { region: '1' });
      assert.equal(item.headers.location, `${P(3)}?node=item:1:0`);
      assert.equal((await spec()).pages[2].regions![1].items![0].name, 'P3_ITEM_1');
      await act(3, 'add_button', { region: '1' });
      await act(3, 'add_validation');
      await act(3, 'add_process');
      await act(3, 'add_branch');
      let p3 = (await spec()).pages[2];
      assert.deepEqual([p3.regions![1].buttons![0].name, p3.validations![0].name, p3.processes![0].name, p3.branches![0].page], ['TOMBOL_1', 'validasi_1', 'proses_1', 3]);

      const up = await act(3, 'up', { node: 'region:1' });
      assert.equal(up.headers.location, `${P(3)}?node=region:0`);
      p3 = (await spec()).pages[2];
      assert.equal(p3.regions![0].static_id, 'region_1');
      const down = await act(3, 'down', { node: 'region:0' });
      assert.equal(down.headers.location, `${P(3)}?node=region:1`);

      for (const n of ['branch:0', 'process:0', 'validation:0', 'region:1']) {
         const d = await act(3, 'delete', { node: n });
         assert.equal(d.statusCode, 303, `${n} ${d.body.slice(0, 400)}`);
      }
      p3 = (await spec()).pages[2];
      assert.equal(p3.regions!.length, 1);
      assert.equal(p3.validations, undefined);
      // a computation needs an item to point at
      assert.equal((await act(3, 'add_computation')).statusCode, 400);
   });

   test('F03: deleting something still referenced is refused and explained', async () => {
      // the IR on page 1 links to P2_EMPNO; removing that item breaks the link
      const d = await act(2, 'delete', { node: 'item:0:0' });
      assert.equal(d.statusCode, 422);
      assert.match(d.body, /Item P2_EMPNO tidak dihapus/);
      assert.ok((await spec()).pages[1].regions![0].items!.some(i => i.name === 'P2_EMPNO'));
   });

   test('two developers: the second save is refused, not merged blindly', async () => {
      const other = new Browser(env);
      const lp = await other.get('/builder/login');
      await other.post('/builder/login', { __csrf: field(lp.body, '__csrf')!, workspace: env.ws, username: 'admin', password: PW, return: '/builder' });
      const mine = await dev.get(`${P(2)}?node=item:0:2`);
      const theirs = await other.get(`${P(2)}?node=item:0:2`);
      const f1 = formFields(mine.body.slice(mine.body.indexOf('id="editor-title"') - 400));
      const f2 = formFields(theirs.body.slice(theirs.body.indexOf('id="editor-title"') - 400));
      assert.equal((await dev.post(P(2), { ...f1, node: 'item:0:2', action: 'save', 'f.label': 'Jabatan (A)' })).statusCode, 303);
      const late = await other.post(P(2), { ...f2, node: 'item:0:2', action: 'save', 'f.label': 'Jabatan (B)' });
      assert.equal(late.statusCode, 409);
      assert.match(late.body, /Aplikasi sudah diubah di tab lain atau oleh developer lain/);
      assert.match(late.body, /value="Jabatan \(B\)"/);
      assert.equal((await spec()).pages[1].regions![0].items![2].label, 'Jabatan (A)');
   });

   test('delete a page: confirmation, home page and references', async () => {
      const home = await dev.get(P(1));
      assert.match(home.body, /Halaman ini adalah beranda aplikasi/);
      const t = async (n: number) => { const r = await dev.get(P(n)); return { __csrf: field(r.body, '__csrf')!, version: field(r.body, 'version')! }; };
      assert.equal((await dev.post(`${P(1)}/delete`, { ...(await t(1)), confirm: '1' })).statusCode, 422);
      const linked = await dev.post(`${P(2)}/delete`, { ...(await t(2)), confirm: '2' });
      assert.equal(linked.statusCode, 422);
      assert.match(linked.body, /Halaman tidak dihapus karena masih dirujuk/);
      const wrong = await dev.post(`${P(3)}/delete`, { ...(await t(3)), confirm: '33' });
      assert.match(wrong.body, /Ketik nomor halaman/);
      // a new blank page can go
      const np = await dev.get('/builder/apps/emp/pages/new');
      await dev.post('/builder/apps/emp/pages/new', { __csrf: field(np.body, '__csrf')!, kind: 'blank', name: 'Sementara', page: '50' });
      const ok = await dev.post(`${P(50)}/delete`, { ...(await t(50)), confirm: '50' });
      assert.equal(ok.statusCode, 303);
      assert.ok(!(await spec()).pages.some(p => p.page === 50));
      assert.match((await dev.get('/builder/apps/emp')).body, /Halaman 50 \(Sementara\) dihapus/);
   });

   test('S13: application properties', async () => {
      const r = await dev.get('/builder/apps/emp/properties');
      assert.equal(r.statusCode, 200);
      assert.match(r.body, /name="f\.name" value="Data Karyawan"/);
      assert.match(r.body, /COMPANY: KCSI/, 'substitutions as YAML');
      assert.doesNotMatch(r.body, /name="f\.app"/);
      assert.doesNotMatch(r.body, /name="f\.pages"/);
      const form = formFields(r.body);
      const ok = await dev.post('/builder/apps/emp/properties', { ...form, 'f.name': 'Data Karyawan KCSI', 'f.substitutions': 'COMPANY: KCSI\nKOTA: Kudus' });
      assert.equal(ok.statusCode, 303, ok.body.slice(0, 600));
      const s = await spec();
      assert.equal(s.name, 'Data Karyawan KCSI');
      assert.deepEqual(s.substitutions, { COMPANY: 'KCSI', KOTA: 'Kudus' });
      assert.equal(s.pages.length, 4, 'pages are untouched');
      const bad = await dev.post('/builder/apps/emp/properties', { ...formFields((await dev.get('/builder/apps/emp/properties')).body), 'f.home_page': '404' });
      assert.equal(bad.statusCode, 422);
      assert.match(bad.body, /Perubahan tidak dapat disimpan/);
      assert.equal((await spec()).home_page, 1);
      const stale = await dev.post('/builder/apps/emp/properties', { ...form, 'f.name': 'Lama' });
      assert.equal(stale.statusCode, 409);
   });

   test('after all the edits, export and import still round-trip', async () => {
      const a = await spec();
      const t = await dev.get('/builder/apps/emp/export');
      const imp = await dev.get('/builder/apps/import');
      await dev.post('/builder/apps/import', { __csrf: field(imp.body, '__csrf')!, spec: t.body, replace: '1' });
      assert.deepEqual(await spec(), a);
   });

   test('other workspaces and missing tokens', async () => {
      await createWorkspace(env.pool, 'lain', ['lain_app']);
      await addDeveloper(env.pool, 'lain', 'admin', PW);
      const b = new Browser(env);
      const lp = await b.get('/builder/login');
      await b.post('/builder/login', { __csrf: field(lp.body, '__csrf')!, workspace: 'lain', username: 'admin', password: PW, return: '/builder' });
      assert.equal((await b.get(P(2))).statusCode, 404);
      assert.equal((await b.get('/builder/apps/emp/properties')).statusCode, 404);
      assert.equal((await dev.post(P(2), { action: 'add_region' })).statusCode, 403);
   });
});
