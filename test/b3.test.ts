import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { addDeveloper } from '../src/cli/commands.ts';
import { generateApp, humanize } from '../src/builder/generate.ts';
import { listTables, type TableInfo } from '../src/builder/introspect.ts';
import { parseSpec } from '../src/spec/import.ts';
import { Browser, field, formFields, setup, type Env } from './helpers.ts';

// B3: Create App wizard from tables (recon S04, flow F01).

const PW = 'rahasia-123';

async function appLogin(b: Browser, base: string, user: string) {
   const page = await b.open(`${base}/login`);
   return b.post(`${base}/login`, { __csrf: field(page.body, '__csrf')!, username: user, password: PW, return: `${base}/1` });
}

async function devLogin(b: Browser, ws: string) {
   const page = await b.get('/builder/login');
   return b.post('/builder/login', { __csrf: field(page.body, '__csrf') ?? '', workspace: ws, username: 'admin', password: PW, return: '/builder' });
}

describe('create app wizard (B3)', () => {
   let env: Env;
   let role: string;
   let tables: TableInfo[];
   const t = (name: string) => tables.find(x => x.name === name)!;

   before(async () => {
      env = await setup();
      await addDeveloper(env.pool, env.ws, 'admin', PW, { admin: true });
      role = (await env.pool.query('select db_role from rpx.workspaces where name = $1', [env.ws])).rows[0].db_role;
      const s = env.schema;
      // edge cases next to the emp tables (created by the superuser; default privileges give the workspace role access)
      await env.pool.query(`
         create type ${s}.status_tiket as enum ('baru', 'proses', 'selesai');
         create table ${s}.tiket (
              id       bigint generated always as identity primary key
            , judul    varchar(120) not null
            , status   ${s}.status_tiket not null default 'baru'
            , catatan  varchar(500)
            , dibuat   timestamptz not null default now()
            , penting  boolean not null default false
            , pemohon  int references ${s}.karyawan (empno)
            , lampiran bytea
            , panjang  int generated always as (length(judul)) stored);
         create table ${s}.dokumen (id uuid primary key default gen_random_uuid(), nama text not null);
         create table ${s}.log_masuk (waktu timestamptz, pengguna text);
         create table ${s}.berkas (id serial primary key, isi bytea not null);
         create table ${s}."Campur" (id serial primary key);
         create table ${s}.rahasia (id serial primary key, isi text);
         create table ${s}.arsip (id serial primary key, isi text);
         create table ${s}.lain_a (id serial primary key, nama text);
         create table ${s}.lain_b (id serial primary key, nama text);
         create view ${s}.v_karyawan as select empno, nama from ${s}.karyawan;
         revoke all on ${s}.rahasia from ${role};
         revoke insert, update, delete on ${s}.arsip from ${role};
         grant select on ${s}.v_karyawan to ${role};
         insert into ${s}.tiket (judul, pemohon) select 'Printer macet', empno from ${s}.karyawan where nama = 'Agus Prasetyo';
      `);
      tables = await listTables(env.pool, env.schema, role);
   });
   after(() => env?.close());

   test('introspection decides report + form, report only, or nothing, with the reason', () => {
      assert.equal(t('departemen').build, 'form');
      assert.equal(t('karyawan').build, 'form');
      assert.deepEqual(t('karyawan').fks.map(f => [f.column, f.refTable, f.display]), [['deptno', 'departemen', 'nama']]);
      assert.equal(t('tiket').build, 'form');
      assert.equal(t('dokumen').build, 'form', 'uuid key with a default');
      assert.equal(t('jabatan').build, 'report');
      assert.match(t('jabatan').reason!, /tidak punya nilai default/);
      assert.equal(t('log_masuk').build, 'report');
      assert.match(t('log_masuk').reason!, /Tidak punya primary key/);
      assert.equal(t('v_karyawan').build, 'report');
      assert.equal(t('v_karyawan').kind, 'view');
      assert.equal(t('berkas').build, 'report');
      assert.match(t('berkas').reason!, /Kolom wajib isi bertipe yang belum didukung/);
      assert.equal(t('arsip').build, 'report');
      assert.match(t('arsip').reason!, /tidak punya hak INSERT\/UPDATE\/DELETE/);
      assert.equal(t('rahasia').build, 'none');
      assert.match(t('rahasia').reason!, /tidak punya hak SELECT/);
      assert.equal(t('Campur').build, 'none');
      const kinds = Object.fromEntries(t('tiket').columns.map(c => [c.name, c.kind]));
      assert.deepEqual(kinds, { id: 'integer', judul: 'text', status: 'enum', catatan: 'longtext', dibuat: 'timestamp', penting: 'boolean', pemohon: 'integer', lampiran: 'unsupported', panjang: 'integer' });
      assert.deepEqual(t('tiket').columns.find(c => c.name === 'status')!.enumValues, ['baru', 'proses', 'selesai']);
   });

   test('the generated spec: pages, links, lists of values, items by column type', () => {
      const spec = generateApp({ name: 'Layanan TI', alias: 'layanan', schema: env.schema, tables: [t('tiket'), t('karyawan'), t('jabatan')] });
      const parsed = parseSpec(JSON.stringify(spec));
      assert.deepEqual(parsed.pages.map(p => [p.page, p.mode ?? 'normal']), [[1, 'normal'], [2, 'modal'], [3, 'normal'], [4, 'modal'], [5, 'normal']]);
      assert.deepEqual((spec.navigation as { page: number }[]).map(n => n.page), [1, 3, 5]);
      const report = parsed.pages[0]!.regions![0]!;
      assert.equal(report.type, 'interactive_report');
      assert.match(report.source!.sql!, /left join .*\.karyawan r\d+ on r\d+\.empno = t\.pemohon/);
      assert.doesNotMatch(report.source!.sql!, /lampiran/, 'bytea is left out');
      assert.deepEqual(report.columns!.find(c => c.name === 'ID')!.link, { page: 2, items: { P2_ID: '#ID#' }, clear_cache: '2' });
      const items = Object.fromEntries(parsed.pages[1]!.regions![0]!.items!.map(i => [i.name, i]));
      assert.equal(items.P2_ID.type, 'hidden');
      assert.equal(items.P2_JUDUL.required, true);
      assert.equal(items.P2_JUDUL.max_length, 120);
      assert.equal(items.P2_STATUS.type, 'select');
      assert.equal(items.P2_STATUS.required, undefined, 'a column with a default is optional');
      assert.equal(items.P2_CATATAN.type, 'textarea');
      assert.equal(items.P2_DIBUAT.type, 'datetime');
      assert.equal(items.P2_PENTING.type, 'switch');
      assert.equal(items.P2_PEMOHON.type, 'select');
      assert.equal(items.P2_PEMOHON.label, 'Karyawan');
      assert.equal(items.P2_LAMPIRAN, undefined);
      assert.equal(items.P2_PANJANG, undefined, 'generated columns are not edited');
      assert.deepEqual(Object.keys(spec.lovs as object).sort(), ['DEPARTEMEN', 'KARYAWAN', 'TIKET_STATUS']);
      assert.equal(parsed.pages[4]!.regions![0]!.buttons, undefined, 'report only: no Add button');
      assert.equal(humanize('tgl_masuk'), 'Tgl masuk');
   });

   test('S04: the wizard lists the tables of the chosen schema', async () => {
      const b = new Browser(env);
      await devLogin(b, env.ws);
      const r = await b.get('/builder/apps/new');
      assert.equal(r.statusCode, 200);
      assert.match(r.body, /<input type="checkbox" name="tables" value="karyawan" id="t-karyawan">/);
      assert.match(r.body, /value="rahasia" id="t-rahasia" disabled aria-describedby="t-rahasia-why"/);
      assert.match(r.body, /Report \+ form/);
      assert.match(r.body, /Report saja/);
      assert.match(r.body, /data-alias-from="name"/);
      // the no-script reload keeps the token out of the address
      const noJs = await b.get(`/builder/apps/new?__csrf=abc&name=Uji&alias=uji&schema=${env.schema}`);
      assert.equal(noJs.statusCode, 303);
      assert.equal(noJs.headers.location, `/builder/apps/new?name=Uji&alias=uji&schema=${env.schema}`);
      const kept = await b.get(String(noJs.headers.location));
      assert.match(kept.body, /id="name" name="name" required maxlength="120" value="Uji"/);
   });

   test('S04: wrong input and tampered table choices are refused', async () => {
      const b = new Browser(env);
      await devLogin(b, env.ws);
      const csrf = field((await b.get('/builder/apps/new')).body, '__csrf')!;
      const r = await b.post('/builder/apps/new', { __csrf: csrf, name: 'X', alias: 'emp', schema: env.schema, tables: ['karyawan', 'rahasia', 'tidak_ada'], group: 'ada spasi' });
      assert.equal(r.statusCode, 422);
      assert.match(r.body, /Alias &quot;emp&quot; sudah dipakai/);
      assert.match(r.body, /Tabel rahasia, tidak_ada tidak ada di skema/);
      assert.match(r.body, /Nama grup hanya/);
      assert.match(r.body, /value="karyawan" id="t-karyawan" checked/, 'choices are kept');
      const many = await b.post('/builder/apps/new', { __csrf: csrf, name: 'X', alias: 'x', schema: env.schema, tables: tables.filter(x => x.build !== 'none').map(x => x.name) });
      assert.match(many.body, /paling banyak 10 tabel/);
      assert.equal((await env.pool.query(`select 1 from rpx.applications where alias = 'x'`)).rowCount, 0);
   });

   test('F01: from the wizard to a running CRUD app', async () => {
      const b = new Browser(env);
      await devLogin(b, env.ws);
      const csrf = field((await b.get('/builder/apps/new')).body, '__csrf')!;
      const r = await b.post('/builder/apps/new', { __csrf: csrf, name: 'Layanan TI', alias: 'layanan', schema: env.schema, tables: ['tiket', 'karyawan', 'jabatan'], group: '' });
      assert.equal(r.statusCode, 303, r.body.slice(0, 500));
      assert.equal(r.headers.location, '/builder/apps/layanan');
      const home = await b.get('/builder/apps/layanan');
      assert.match(home.body, /Aplikasi Layanan TI dibuat: 5 halaman dari 3 tabel/);
      assert.match(home.body, /Halaman \(5\)/);
      const v = await env.pool.query(`select spec from rpx.app_versions v join rpx.applications a on a.id = v.app_id where a.alias = 'layanan'`);
      assert.match(v.rows[0].spec, /^# Layanan TI: dibuat dengan wizard builder oleh dev:admin/);

      // an application user runs it
      const u = new Browser(env);
      const base = `/r/${env.ws}/layanan`;
      assert.equal((await appLogin(u, base, 'iwan')).statusCode, 303);
      const list = await u.get(`${base}/1`);
      assert.equal(list.statusCode, 200);
      assert.match(list.body, /Printer macet/);
      assert.match(list.body, /Agus Prasetyo/, 'the foreign key shows the employee name');
      const emp = await u.get(`${base}/3`);
      assert.match(emp.body, /Gudang Bahan Baku/, 'department name instead of its number');

      // add a ticket through the generated form
      const form = await u.get(`${base}/2`);
      assert.equal(form.statusCode, 200);
      assert.match(form.body, /<option value="proses">proses<\/option>/);
      const f = formFields(form.body);
      const agus = (await env.pool.query(`select empno from ${env.schema}.karyawan where nama = 'Agus Prasetyo'`)).rows[0].empno;
      const saved = await u.post(`${base}/2`, { ...f, P2_JUDUL: 'Monitor berkedip', P2_STATUS: 'proses', P2_PEMOHON: String(agus), P2_CATATAN: 'Lantai 2', REQUEST: 'SIMPAN' });
      assert.equal(saved.statusCode, 303, saved.body.slice(0, 600));
      const row = (await env.pool.query(`select status::text, pemohon, catatan, penting, dibuat is not null as ada from ${env.schema}.tiket where judul = 'Monitor berkedip'`)).rows[0];
      assert.deepEqual(row, { status: 'proses', pemohon: agus, catatan: 'Lantai 2', penting: false, ada: true });
      // a required column left empty
      const bad = await u.post(`${base}/2`, { ...formFields((await u.get(`${base}/2`)).body), P2_JUDUL: '', REQUEST: 'SIMPAN' });
      assert.equal(bad.statusCode, 422);
      // the report-only page has no form and no Add button
      const jab = await u.get(`${base}/5`);
      assert.equal(jab.statusCode, 200);
      assert.doesNotMatch(jab.body, />Tambah</);
   });

   test('F01: limited to a group', async () => {
      const b = new Browser(env);
      await devLogin(b, env.ws);
      const csrf = field((await b.get('/builder/apps/new')).body, '__csrf')!;
      const r = await b.post('/builder/apps/new', { __csrf: csrf, name: 'Data SDM', alias: 'sdm', schema: env.schema, tables: 'departemen', group: 'SDM' });
      assert.equal(r.statusCode, 303);
      const iwan = new Browser(env);
      await appLogin(iwan, `/r/${env.ws}/sdm`, 'iwan');
      assert.equal((await iwan.get(`/r/${env.ws}/sdm/1`)).statusCode, 200);
      const tamu = new Browser(env);
      await appLogin(tamu, `/r/${env.ws}/sdm`, 'tamu');
      const no = await tamu.get(`/r/${env.ws}/sdm/1`);
      assert.equal(no.statusCode, 403);
      assert.match(no.body, /hanya untuk anggota grup SDM/);
   });

   test('S04: without tables the app gets one blank home page; app home hints at missing users', async () => {
      const other = await setup();
      try {
         await addDeveloper(other.pool, other.ws, 'admin', PW);
         await other.pool.query('delete from rpx.app_users');
         const b = new Browser(other);
         await devLogin(b, other.ws);
         const csrf = field((await b.get('/builder/apps/new')).body, '__csrf')!;
         const r = await b.post('/builder/apps/new', { __csrf: csrf, name: 'Kosong', alias: 'kosong', schema: other.schema });
         assert.equal(r.statusCode, 303);
         const home = await b.get('/builder/apps/kosong');
         assert.match(home.body, /Aplikasi Kosong dibuat\./);
         assert.match(home.body, /Halaman \(1\)/);
         assert.match(home.body, /Belum ada pengguna aplikasi di workspace ini/);
      } finally {
         await other.close();
      }
   });
});
