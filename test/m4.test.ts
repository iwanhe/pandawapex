import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import { Browser, formFields, links, setup, type Env } from './helpers.ts';
import { toCsv } from '../src/engine/export.ts';

// Modal dialog pages and the interactive report (example app: page 1 = IR, page 2 = modal form).
let env: Env;
before(async () => { env = await setup(); });
after(async () => { await env?.close(); });

const rowsOf = (body: string) => (body.match(/<tr>/g) ?? []).length - 1;  // minus the header row

describe('interactive report', () => {
   test('sort by a column, both directions; aria-sort on the header', async () => {
      const b = new Browser(env);
      await b.login();
      const asc = await b.open(`${env.base}/1?daftar__sort=GAJI&daftar__dir=asc`);
      assert.match(asc.body, /aria-sort="ascending"/);
      const firstAsc = /<td class="r-num"><a class="r-cell-link"[^>]*>\d+<\/a><\/td><td>([^<]+)</.exec(asc.body)?.[1];
      assert.equal(firstAsc, 'Maria Ulfa', 'lowest salary first');
      const desc = await b.open(`${env.base}/1?daftar__sort=GAJI&daftar__dir=desc`);
      assert.match(desc.body, /aria-sort="descending"/);
      assert.match(desc.body, /<td>Sri Wahyuni</);
      assert.match(desc.body, /14\.500\.000/, 'display format integer (id-ID grouping)');
   });

   test('filters: number, date (as shown or ISO), text; chips can be removed; reset', async () => {
      const b = new Browser(env);
      await b.login();
      await b.open(`${env.base}/1?daftar__reset=1`);
      let r = await b.open(`${env.base}/1?daftar__fc=GAJI&daftar__fo=ge&daftar__fv=10000000`);
      assert.equal(rowsOf(r.body), 3);
      assert.match(r.body, /Gaji \(Rp\) ≥ 10000000/);
      r = await b.open(`${env.base}/1?daftar__fc=TGL_MASUK&daftar__fo=lt&daftar__fv=01-01-2015`);
      assert.equal(rowsOf(r.body), 1, 'only Bambang (2012) is >= 10 jt and joined before 2015');
      r = await b.open(`${env.base}/1?daftar__rf=1`);
      assert.equal(rowsOf(r.body), 3, 'second filter removed');
      r = await b.open(`${env.base}/1?daftar__fc=NAMA&daftar__fo=contains&daftar__fv=sri`);
      assert.equal(rowsOf(r.body), 1);
      r = await b.open(`${env.base}/1?daftar__reset=1`);
      assert.match(r.body, /Baris 1–5/);
      assert.doesNotMatch(r.body, /class="r-chip"/);
   });

   test('state is remembered between visits in the same session, not across sessions', async () => {
      const b = new Browser(env);
      await b.login();
      await b.open(`${env.base}/1?daftar__q=yusuf`);
      assert.equal(rowsOf((await b.open(`${env.base}/1`)).body), 1);
      const other = new Browser(env);
      await other.login();
      assert.equal(rowsOf((await other.open(`${env.base}/1`)).body), 5);
   });

   test('invalid filter values are explained, not executed', async () => {
      const b = new Browser(env);
      await b.login();
      await b.open(`${env.base}/1?daftar__reset=1`);
      const r = await b.open(`${env.base}/1?daftar__fc=GAJI&daftar__fo=gt&daftar__fv=sejuta`);
      assert.match(r.body, /Nilai filter Gaji \(Rp\) harus angka\./, 'the warning survives the redirect');
      assert.equal(rowsOf(r.body), 5, 'no filter was added');
      assert.doesNotMatch((await b.open(`${env.base}/1`)).body, /harus angka/, 'and is shown once');
      const op = await b.open(`${env.base}/1?daftar__fc=NAMA&daftar__fo=lt&daftar__fv=x`);
      assert.equal(rowsOf(op.body), 5, '"<" is not offered for text');
   });

   test('search is literal (%, _ and quotes are not SQL) and columns cannot be injected', async () => {
      const b = new Browser(env);
      await b.login();
      await b.open(`${env.base}/1?daftar__reset=1`);
      assert.match((await b.open(`${env.base}/1?daftar__q=%25`)).body, /Tidak ada data yang cocok/);
      assert.match((await b.open(`${env.base}/1?daftar__q=${encodeURIComponent("' or 1=1 --")}`)).body, /Tidak ada data yang cocok/);
      await b.open(`${env.base}/1?daftar__reset=1`);
      const evil = await b.open(`${env.base}/1?daftar__sort=${encodeURIComponent('NAMA; drop table karyawan')}`);
      assert.equal(evil.statusCode, 200);
      assert.doesNotMatch(evil.body, /aria-sort=/, 'unknown sort column is ignored');
      const f = await b.open(`${env.base}/1?daftar__fc=${encodeURIComponent('1=1) or (1')}&daftar__fo=null`);
      assert.equal(rowsOf(f.body), 5);
      const n = await env.pool.query(`select count(*)::int as n from ${env.schema}.karyawan`);
      assert.ok(n.rows[0].n >= 7);
   });

   test('CSV download: same filter, all pages, BOM, formula cells neutralised', async () => {
      const b = new Browser(env);
      await b.login();
      await b.open(`${env.base}/1?daftar__reset=1`);
      await b.open(`${env.base}/1?daftar__fc=GAJI&daftar__fo=ge&daftar__fv=8000000`);
      const r = await b.get(`${env.base}/1/region/daftar/download?format=csv`);
      assert.equal(r.statusCode, 200);
      assert.match(String(r.headers['content-disposition']), /attachment; filename="emp-daftar-\d{4}-\d{2}-\d{2}\.csv"/);
      const raw = r.rawPayload;
      assert.deepEqual([...raw.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
      const lines = raw.subarray(3).toString('utf8').trim().split('\r\n');
      assert.equal(lines[0], 'No.,Nama,Jabatan,Departemen,Tanggal masuk,Gaji (Rp),Status');
      assert.equal(lines.length - 1, 5, 'five employees earn >= 8 jt, across report pages');
      assert.equal(toCsv([{ name: 'A', label: 'A', numeric: false }], [['=HYPERLINK("x")'], ['-2+3']]).toString().split('\r\n')[1], `"'=HYPERLINK(""x"")"`);
   });

   test('XLSX download is a valid workbook with numbers as numbers', async () => {
      const b = new Browser(env);
      await b.login();
      await b.open(`${env.base}/1?daftar__reset=1`);
      const r = await b.get(`${env.base}/1/region/daftar/download?format=xlsx`);
      assert.equal(r.statusCode, 200);
      const files = unzipSync(new Uint8Array(r.rawPayload));
      assert.ok(files['xl/workbook.xml'] && files['[Content_Types].xml']);
      const sheet = strFromU8(files['xl/worksheets/sheet1.xml']);
      assert.match(sheet, /<t xml:space="preserve">Nama<\/t>/);
      assert.match(sheet, /<c r="F\d+"><v>\d+(\.\d+)?<\/v><\/c>/, 'salary column stored as a number');
   });

   test('download needs a session and respects authorization', async () => {
      const anon = new Browser(env);
      const r = await anon.get(`${env.base}/1/region/daftar/download?format=csv`);
      assert.equal(r.statusCode, 303);
      const b = new Browser(env);
      await b.login();
      assert.equal((await b.get(`${env.base}/1/region/tidak-ada/download`)).statusCode, 404);
   });
});

describe('modal dialog page', () => {
   test('links to the modal page carry data-dialog; ?dialog=1 renders without the app shell', async () => {
      const b = new Browser(env);
      await b.login();
      const list = await b.open(`${env.base}/1`);
      assert.match(list.body, /class="r-cell-link" href="[^"]+" data-dialog="md" data-dialog-title="Form karyawan"/);
      assert.match(list.body, /href="[^"]+" data-dialog="md"[^>]*>.*Tambah karyawan/s);
      const d = await b.open(`${links(list.body)[0]}&dialog=1`);
      assert.match(d.body, /<body class="r-in-dialog">/);
      assert.doesNotMatch(d.body, /class="r-shell"/);
      assert.match(d.body, /action="[^"]+\/2\?dialog=1"/);
      assert.match(d.body, /data-dialog-cancel/, 'Batal closes the dialog');
   });

   test('saving inside the dialog answers "close"; the message is shown on the calling page', async () => {
      const b = new Browser(env);
      await b.login();
      const list = await b.open(`${env.base}/1`);
      const d = await b.open(`${links(list.body)[0]}&dialog=1`);
      const r = await b.post(`${env.base}/2?dialog=1`, { ...formFields(d.body), P2_JABATAN: 'Dari dialog', REQUEST: 'SIMPAN' });
      assert.equal(r.statusCode, 200);
      assert.match(r.body, /data-dialog-close/);
      assert.match((await b.open(`${env.base}/1`)).body, /tersimpan\./);
   });

   test('validation errors stay inside the dialog', async () => {
      const b = new Browser(env);
      await b.login();
      const d = await b.open(`${env.base}/2?clear=2&dialog=1`);
      const r = await b.post(`${env.base}/2?dialog=1`, { ...formFields(d.body), REQUEST: 'SIMPAN' });
      assert.equal(r.statusCode, 422);
      assert.match(r.body, /<body class="r-in-dialog">/);
      assert.match(r.body, /wajib diisi/);
   });

   test('without JavaScript the same page works as a normal page and returns to the list', async () => {
      const b = new Browser(env);
      await b.login();
      const list = await b.open(`${env.base}/1`);
      const form = await b.open(links(list.body)[0]);
      assert.match(form.body, /class="r-shell"/);
      assert.match(form.body, /class="r-btn r-btn--ghost" href="[^"]+\/1">Batal/);
      const r = await b.post(`${env.base}/2`, { ...formFields(form.body), REQUEST: 'SIMPAN' });
      assert.equal(r.statusCode, 303);
      assert.equal(r.headers.location, `${env.base}/1`);
   });

   test('session ended while the dialog was open: the whole window goes to the login page', async () => {
      const b = new Browser(env);
      await b.login();
      const d = await b.open(`${env.base}/2?clear=2&dialog=1`);
      await env.pool.query(`delete from rpx.sessions where username = 'iwan'`);
      const r = await b.post(`${env.base}/2?dialog=1`, { ...formFields(d.body), REQUEST: 'SIMPAN' });
      assert.equal(r.statusCode, 200);
      assert.match(r.body, /data-top-redirect="\/r\/[^"]+\/login\?return=[^"]*%2F1&amp;info=expired"/);
   });
});
