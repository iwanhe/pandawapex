import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { addDeveloper, createWorkspace } from '../src/cli/commands.ts';
import { exportSpec } from '../src/spec/export.ts';
import { Browser, field, formFields, setup, type Env } from './helpers.ts';

// B4: Create Page wizard (recon S07, flow F02): add pages to the existing example app "emp".

const PW = 'rahasia-123';

async function devLogin(b: Browser, ws: string) {
   const page = await b.get('/builder/login');
   return b.post('/builder/login', { __csrf: field(page.body, '__csrf') ?? '', workspace: ws, username: 'admin', password: PW, return: '/builder' });
}

describe('create page wizard (B4)', () => {
   let env: Env;
   let dev: Browser;
   let csrf: string;
   const URL_NEW = '/builder/apps/emp/pages/new';
   const add = (form: Record<string, string>) => dev.post(URL_NEW, { __csrf: csrf, nav: '1', ...form });
   const pagesOf = async () => (await exportSpec(env.pool, env.ws, 'emp')).pages.map(p => p.page);

   before(async () => {
      env = await setup();
      await addDeveloper(env.pool, env.ws, 'admin', PW);
      dev = new Browser(env);
      await devLogin(dev, env.ws);
      csrf = field((await dev.get('/builder')).body, '__csrf')!;
   });
   after(() => env?.close());

   test('S07: the wizard offers page kinds, the next free number and the tables', async () => {
      const home = await dev.get('/builder/apps/emp');
      assert.match(home.body, /href="\/builder\/apps\/emp\/pages\/new"/);
      const r = await dev.get(URL_NEW);
      assert.equal(r.statusCode, 200);
      for (const k of ['report_form', 'report', 'form', 'blank']) assert.match(r.body, new RegExp(`name="kind" value="${k}"`));
      assert.match(r.body, /name="kind" value="report_form" aria-labelledby="kind-report_form" aria-describedby="kind-report_form-text" checked/);
      assert.match(r.body, /id="page" name="page" inputmode="numeric" required value="5"/);
      assert.match(r.body, /<option value="karyawan">karyawan<\/option>/);
      assert.match(r.body, /<option value="jabatan">jabatan \(report saja\)<\/option>/);
      assert.match(r.body, /<option value="5">5\. |<option value="1" selected>1\. Karyawan<\/option>/);
   });

   test('F02: report + form from a table, then used by an application user', async () => {
      const before = await env.pool.query(`select count(*)::int n from rpx.app_versions v join rpx.applications a on a.id = v.app_id where a.alias = 'emp'`);
      const r = await add({ kind: 'report_form', name: '', page: '10', table: 'departemen' });
      assert.equal(r.statusCode, 303, r.body.slice(0, 600));
      assert.equal(r.headers.location, '/builder/apps/emp');
      assert.match((await dev.get('/builder/apps/emp')).body, /Halaman 10 dan 11 \(Departemen\) ditambahkan/);
      const spec = await exportSpec(env.pool, env.ws, 'emp');
      assert.deepEqual(spec.pages.map(p => p.page), [1, 2, 3, 4, 10, 11]);
      assert.deepEqual(spec.navigation!.map(n => n.page), [1, 4, 3, 10]);
      assert.equal(spec.pages.find(p => p.page === 11)!.mode, 'modal');
      const v = await env.pool.query(`select v.imported_by from rpx.app_versions v join rpx.applications a on a.id = v.app_id where a.alias = 'emp' order by imported_at desc`);
      assert.equal(v.rowCount, before.rows[0].n + 1);
      assert.equal(v.rows[0].imported_by, 'dev:admin');

      const u = new Browser(env);
      await u.login('iwan');
      const list = await u.get(`${env.base}/10`);
      assert.equal(list.statusCode, 200);
      assert.match(list.body, /Teknologi Informasi/);
      const form = formFields((await u.get(`${env.base}/11`)).body);
      const saved = await u.post(`${env.base}/11`, { ...form, P11_NAMA: 'Pemasaran', P11_LOKASI: 'Semarang', REQUEST: 'SIMPAN' });
      assert.equal(saved.statusCode, 303, saved.body.slice(0, 400));
      assert.equal((await env.pool.query(`select lokasi from ${env.schema}.departemen where nama = 'Pemasaran'`)).rows[0].lokasi, 'Semarang');
      // the existing pages still work
      assert.equal((await u.get(`${env.base}/1`)).statusCode, 200);
   });

   test('F02: a form on its own, as a normal page that returns to a chosen page', async () => {
      const r = await add({ kind: 'form', name: 'Karyawan baru', page: '30', table: 'karyawan', returnPage: '1', nav: '' });
      assert.equal(r.statusCode, 303, r.body.slice(0, 600));
      const spec = await exportSpec(env.pool, env.ws, 'emp');
      const p = spec.pages.find(x => x.page === 30)!;
      assert.equal(p.mode ?? 'normal', 'normal');
      assert.deepEqual(p.branches, [{ page: 1 }]);
      const dept = p.regions![0]!.items!.find(i => i.name === 'P30_DEPTNO')!;
      assert.equal(dept.type, 'select');
      assert.equal(dept.lov, 'DEPARTEMEN_2', 'the app already has a different DEPARTEMEN list; it is kept');
      assert.match(spec.lovs!.DEPARTEMEN!.sql!, /order by nama/);
      assert.ok(!spec.navigation!.some(n => n.page === 30), 'no menu entry when not asked');

      const u = new Browser(env);
      await u.login('iwan');
      const form = formFields((await u.get(`${env.base}/30`)).body);
      const saved = await u.post(`${env.base}/30`, { ...form, P30_NAMA: 'Lina Marlina', P30_GAJI: '7000000', P30_TGL_MASUK: '2026-01-05', P30_STATUS_KERJA: 'KONTRAK', REQUEST: 'SIMPAN' });
      assert.equal(saved.statusCode, 303, saved.body.slice(0, 600));
      assert.match(String(saved.headers.location), new RegExp(`${env.base}/1`));
      assert.equal((await env.pool.query(`select status_kerja from ${env.schema}.karyawan where nama = 'Lina Marlina'`)).rows[0].status_kerja, 'KONTRAK');
   });

   test('F02: report from a SQL query, with a bind item', async () => {
      const r = await add({ kind: 'report', source: 'sql', name: 'Gaji per departemen', page: '20',
         sql: 'select d.nama as departemen, count(*) as jumlah, sum(k.gaji) as total_gaji\n  from karyawan k join departemen d on d.deptno = k.deptno\n where :P20_CARI is null or d.nama ilike \'%\' || :P20_CARI || \'%\'\n group by d.nama;' });
      assert.equal(r.statusCode, 303, r.body.slice(0, 800));
      const p = (await exportSpec(env.pool, env.ws, 'emp')).pages.find(x => x.page === 20)!;
      assert.deepEqual(p.regions![0]!.columns!.map(c => [c.name, c.data_type ?? 'text']), [['DEPARTEMEN', 'text'], ['JUMLAH', 'number'], ['TOTAL_GAJI', 'number']]);
      assert.doesNotMatch(p.regions![0]!.source!.sql!, /;\s*$/);
      const u = new Browser(env);
      await u.login('iwan');
      const out = await u.get(`${env.base}/20`);
      assert.equal(out.statusCode, 200);
      assert.match(out.body, /Gudang Bahan Baku/);
   });

   test('F02: SQL that cannot become a report is explained, and nothing runs for real', async () => {
      const count = async () => (await env.pool.query(`select count(*)::int n from ${env.schema}.karyawan`)).rows[0].n;
      const n = await count();
      const cases: [string, RegExp][] = [
         ['select nama, gajji from karyawan', /Query tidak bisa dijalankan: column &quot;gajji&quot; does not exist/],
         ['delete from karyawan', /harus diawali SELECT atau WITH/],
         ['select 1; delete from karyawan', /Query tidak bisa dijalankan/],
         ['with x as (delete from karyawan returning *) select * from x', /Query tidak bisa dijalankan/],
         ['select 1 + 1', /Beri alias yang sederhana .* \?column\?/],
         ['select nama, nama from karyawan', /Nama kolom ganda: nama/],
         ['select * from rpx.dev_users', /Query tidak bisa dijalankan: permission denied/],
         ['', /Query SQL wajib diisi/],
      ];
      for (const [sql, re] of cases) {
         const r = await add({ kind: 'report', source: 'sql', name: 'Uji', page: '50', sql });
         assert.equal(r.statusCode, 422, sql);
         assert.match(r.body, re, sql);
      }
      assert.equal(await count(), n, 'the queries are only described, never committed');
      assert.ok(!(await pagesOf()).includes(50));
   });

   test('F02: wrong page numbers and tables are refused with the reason', async () => {
      const cases: [Record<string, string>, RegExp][] = [
         [{ kind: 'blank', name: 'X', page: '1' }, /Nomor 1 sudah dipakai\. Nomor bebas berikutnya: 31/],
         [{ kind: 'report_form', page: '19', table: 'departemen' }, /Nomor 20 sudah dipakai/],
         [{ kind: 'blank', name: 'X', page: '0' }, /harus angka 1–99998/],
         [{ kind: 'blank', name: 'X', page: 'abc' }, /harus angka/],
         [{ kind: 'form', page: '60', table: 'jabatan', returnPage: '1' }, /jabatan: Primary key deptno, nama tidak punya nilai default/],
         [{ kind: 'report_form', page: '60', table: '' }, /Pilih tabel/],
         [{ kind: 'report', source: 'table', page: '60', table: 'tidak_ada' }, /Tabel &quot;tidak_ada&quot; tidak ada di skema/],
         [{ kind: 'blank', page: '60', name: '' }, /Nama halaman wajib diisi/],
         [{ kind: 'form', page: '60', table: 'karyawan', returnPage: '999' }, /Pilih halaman yang ada/],
         [{ kind: 'wizard', page: '60' }, /Pilih jenis halaman/],
      ];
      for (const [form, re] of cases) {
         const r = await add(form);
         assert.equal(r.statusCode, 422, JSON.stringify(form));
         assert.match(r.body, re, JSON.stringify(form));
      }
      assert.ok(!(await pagesOf()).includes(60));
      // a report-only table is fine as a report
      const ok = await add({ kind: 'report', source: 'table', page: '60', table: 'jabatan' });
      assert.equal(ok.statusCode, 303);
   });

   test('F02: a blank page; input is kept after an error', async () => {
      const bad = await add({ kind: 'blank', name: 'Panduan', page: '2' });
      assert.match(bad.body, /value="Panduan"/);
      assert.match(bad.body, /name="kind" value="blank"[^>]* checked/);
      const ok = await add({ kind: 'blank', name: 'Panduan', page: '70' });
      assert.equal(ok.statusCode, 303);
      const spec = await exportSpec(env.pool, env.ws, 'emp');
      assert.equal(spec.pages.find(p => p.page === 70)!.alias, 'panduan');
      assert.deepEqual(spec.navigation!.at(-1), { label: 'Panduan', icon: 'file-text', page: 70 });
   });

   test('another workspace cannot add pages to this app', async () => {
      await createWorkspace(env.pool, 'lain', ['lain_app']);
      await addDeveloper(env.pool, 'lain', 'admin', PW);
      const b = new Browser(env);
      await devLogin(b, 'lain');
      const t = field((await b.get('/builder')).body, '__csrf')!;
      assert.equal((await b.get(URL_NEW)).statusCode, 404);
      assert.equal((await b.post(URL_NEW, { __csrf: t, kind: 'blank', name: 'X', page: '90' })).statusCode, 404);
      assert.equal((await dev.post(URL_NEW, { kind: 'blank', name: 'X', page: '90' })).statusCode, 403, 'CSRF token required');
   });
});
