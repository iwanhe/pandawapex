import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Browser, field, formFields, links, setup, type Env } from './helpers.ts';
import { buildServer } from '../src/engine/server.ts';

let env: Env;
before(async () => { env = await setup(); });
after(async () => { await env?.close(); });

describe('F04: login -> report -> form -> save', () => {
   test('protected page redirects to login, then back after signing in', async () => {
      const b = new Browser(env);
      const r = await b.get(`${env.base}/1`);
      assert.equal(r.statusCode, 303);
      assert.match(String(r.headers.location), /\/login\?return=/);
      const guestSid = [...b.cookies.values()][0];
      const login = await b.login();
      assert.equal(login.statusCode, 303);
      assert.equal(login.headers.location, `${env.base}/1`);
      assert.notEqual([...b.cookies.values()][0], guestSid, 'session id must change at login (fixation)');
   });

   test('wrong password: 401, generic message, lock after 5 failures', async () => {
      const b = new Browser(env);
      const r = await b.login('iwan', 'salah-sekali');
      assert.equal(r.statusCode, 401);
      assert.match(r.body, /Nama pengguna atau kata sandi salah/);
      const unknown = await new Browser(env).login('tidak-ada', 'apa-saja-123');
      assert.match(unknown.body, /Nama pengguna atau kata sandi salah/, 'unknown users get the same message');
      await env.pool.query(`update rpx.app_users set failed_logins = 0`);
   });

   test('report lists rows with checksummed links; edit and save; success message once', async () => {
      const b = new Browser(env);
      await b.login();
      const report = await b.open(`${env.base}/1`);
      assert.equal(report.statusCode, 200);
      assert.match(report.body, /Agus Prasetyo/);
      assert.match(report.body, /Baris 1–5/);
      const agus = (await env.pool.query(`select empno from ${env.schema}.karyawan where nama = 'Agus Prasetyo'`)).rows[0].empno;
      const link = links(report.body).find(l => l.includes(`P2_EMPNO=${agus}&`))!;
      assert.match(link, /cs=/);

      const form = await b.open(link);
      assert.equal(form.statusCode, 200);
      const fields = formFields(form.body);
      assert.equal(fields.P2_NAMA, 'Agus Prasetyo');
      assert.equal(fields.P2_DEPTNO, '1');

      const save = await b.post(`${env.base}/2`, { ...fields, P2_JABATAN: 'Koordinator Penerimaan', P2_GAJI: '7250000', REQUEST: 'SIMPAN' });
      assert.equal(save.statusCode, 303);
      assert.equal(save.headers.location, `${env.base}/1`);
      const db = await env.pool.query(`select jabatan, gaji from ${env.schema}.karyawan where empno = $1`, [agus]);
      assert.deepEqual(db.rows[0], { jabatan: 'Koordinator Penerimaan', gaji: '7250000.00' });

      const back = await b.open(`${env.base}/1`);
      assert.match(back.body, /Data karyawan Agus Prasetyo tersimpan\./);
      const again = await b.open(`${env.base}/1`);
      assert.doesNotMatch(again.body, /tersimpan\./, 'flash is shown only once');
   });

   test('validation errors re-render with inline messages and keep the typed values', async () => {
      const b = new Browser(env);
      await b.login();
      const form = await b.open(links((await b.open(`${env.base}/1`)).body)[0]);
      const r = await b.post(`${env.base}/2`, { ...formFields(form.body), P2_NAMA: '', P2_GAJI: '-5', P2_JABATAN: 'Tetap diketik', REQUEST: 'SIMPAN' });
      assert.equal(r.statusCode, 422);
      assert.match(r.body, /Nama lengkap wajib diisi\./);
      assert.match(r.body, /Gaji harus lebih dari 0\./);
      assert.match(r.body, /value="Tetap diketik"/);
      assert.equal((r.body.match(/aria-invalid="true"/g) ?? []).length, 2);
   });

   test('BUG-001: max_length is enforced by the server, counting characters (not bytes)', async () => {
      const b = new Browser(env);
      await b.login();
      const list = await b.open(`${env.base}/1`);
      const blank = await b.open(links(list.body, 'r-btn r-btn--primary')[0]);
      const f = { ...formFields(blank.body), P2_DEPTNO: '1', P2_TGL_MASUK: '2026-01-05', P2_GAJI: '1000', P2_AKTIF: 'Y', REQUEST: 'SIMPAN' };
      const tooLong = await b.post(`${env.base}/2`, { ...f, P2_NAMA: 'P'.repeat(121) });
      assert.equal(tooLong.statusCode, 422);
      assert.match(tooLong.body, /Nama lengkap maksimal 120 karakter\./);
      // 120 characters including multi-byte ones is fine
      // the re-rendered form carries a fresh submission token
      const ok = await b.post(`${env.base}/2`, { ...f, __sid: formFields(tooLong.body).__sid, P2_NAMA: 'É😀'.repeat(60) });
      assert.equal(ok.statusCode, 303);
      await env.pool.query(`delete from ${env.schema}.karyawan where nama = $1`, ['É😀'.repeat(60)]);
   });

   test('create via "Tambah" then delete', async () => {
      const b = new Browser(env);
      await b.login();
      const list = await b.open(`${env.base}/1`);
      const add = links(list.body, 'r-btn r-btn--primary')[0];
      const blank = await b.open(add);
      const f = formFields(blank.body);
      assert.equal(f.P2_EMPNO, '');
      assert.doesNotMatch(blank.body, /value="HAPUS"/, 'delete button hidden for a new record');
      const ins = await b.post(`${env.base}/2`, { ...f, P2_NAMA: 'Karyawan Uji', P2_DEPTNO: '4', P2_TGL_MASUK: '2026-11-02', P2_GAJI: '5000000', P2_AKTIF: 'Y', REQUEST: 'SIMPAN' });
      assert.equal(ins.statusCode, 303);
      const id = (await env.pool.query(`select empno from ${env.schema}.karyawan where nama = 'Karyawan Uji'`)).rows[0].empno;

      // the generated key went back into session state: the form now edits that row
      const edit = await b.open(`${env.base}/2`);
      assert.equal(formFields(edit.body).P2_EMPNO, String(id));
      assert.match(edit.body, /value="HAPUS"/);
      const del = await b.post(`${env.base}/2`, { ...formFields(edit.body), REQUEST: 'HAPUS' });
      assert.equal(del.statusCode, 303);
      assert.equal((await env.pool.query(`select count(*)::int as n from ${env.schema}.karyawan where empno = $1`, [id])).rows[0].n, 0);
   });

   test('search item filters the report; empty result shows the empty state', async () => {
      const b = new Browser(env);
      await b.login();
      const p1 = await b.open(`${env.base}/1`);
      await b.post(`${env.base}/1`, { ...formFields(p1.body), P1_CARI: 'dewi', REQUEST: 'CARI' });
      const found = await b.open(`${env.base}/1`);
      assert.equal(links(found.body).length, 1);
      await b.post(`${env.base}/1`, { ...formFields(found.body), P1_CARI: 'zzz', REQUEST: 'CARI' });
      const none = await b.open(`${env.base}/1`);
      assert.match(none.body, /Tidak ada data yang cocok/);
   });

   test('pagination', async () => {
      const b = new Browser(env);
      await b.login();
      const p2 = await b.open(`${env.base}/1?p_daftar=2`);
      assert.match(p2.body, /Baris 6–7 dari 7/);
      assert.match(p2.body, /aria-label="Halaman sebelumnya"/);
   });
});

describe('security', () => {
   test('tampered URL item value is refused (checksum)', async () => {
      const b = new Browser(env);
      await b.login();
      const link = links((await b.open(`${env.base}/1`)).body)[0];
      const bad = link.replace(/P2_EMPNO=\d+/, 'P2_EMPNO=999');
      const r = await b.get(bad);
      assert.equal(r.statusCode, 403);
      assert.match(r.body, /Checksum tidak cocok/);
   });

   test('a link from another session does not work', async () => {
      const a = new Browser(env), b = new Browser(env);
      await a.login(); await b.login();
      const link = links((await a.open(`${env.base}/1`)).body)[0];
      assert.equal((await b.get(link)).statusCode, 403);
   });

   test('changing the hidden primary key in a form post is refused', async () => {
      const b = new Browser(env);
      await b.login();
      const form = await b.open(links((await b.open(`${env.base}/1`)).body)[0]);
      const f = formFields(form.body);
      const r = await b.post(`${env.base}/2`, { ...f, P2_EMPNO: String(Number(f.P2_EMPNO) + 1), P2_NAMA: 'Diretas', REQUEST: 'SIMPAN' });
      assert.equal(r.statusCode, 403);
   });

   test('post without the CSRF token is refused', async () => {
      const b = new Browser(env);
      await b.login();
      const p1 = await b.open(`${env.base}/1`);
      const f = formFields(p1.body);
      delete f.__csrf;
      assert.equal((await b.post(`${env.base}/1`, { ...f, REQUEST: 'CARI' })).statusCode, 403);
   });

   test('unknown button names are refused', async () => {
      const b = new Browser(env);
      await b.login();
      const p1 = await b.open(`${env.base}/1`);
      assert.equal((await b.post(`${env.base}/1`, { ...formFields(p1.body), REQUEST: 'DROP' })).statusCode, 400);
   });

   test('report values are HTML-escaped', async () => {
      await env.pool.query(`update ${env.schema}.karyawan set jabatan = '<script>alert(1)</script>' where nama = 'Dewi Lestari'`);
      const b = new Browser(env);
      await b.login();
      const r = await b.open(`${env.base}/1`);
      assert.doesNotMatch(r.body, /<script>alert/);
      assert.match(r.body, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
      assert.match(String(r.headers['content-security-policy']), /script-src 'self'/);
   });

   test('developer code runs as the workspace role and cannot read engine metadata', async () => {
      const c = await env.pool.connect();
      try {
         await c.query('begin');
         await c.query(`set local role ws_${env.ws}`);
         await assert.rejects(c.query('select * from rpx.sessions'), /permission denied/);
      } finally {
         await c.query('rollback');
         c.release();
      }
   });

   test('BUG-004: the same form submission cannot be processed twice (double POST / replay)', async () => {
      const b = new Browser(env);
      await b.login();
      const blank = await b.open(links((await b.open(`${env.base}/1`)).body, 'r-btn r-btn--primary')[0]);
      const f = { ...formFields(blank.body), P2_NAMA: 'Kirim Dobel', P2_TGL_MASUK: '2026-01-01', P2_GAJI: '1', P2_AKTIF: 'Y', REQUEST: 'SIMPAN' };
      const [r1, r2] = await Promise.all([b.post(`${env.base}/2`, f), b.post(`${env.base}/2`, f)]);
      assert.deepEqual([r1.statusCode, r2.statusCode].sort(), [303, 409]);
      assert.equal((await b.post(`${env.base}/2`, f)).statusCode, 409, 'a later replay is refused too');
      const n = await env.pool.query(`select count(*)::int as n from ${env.schema}.karyawan where nama = 'Kirim Dobel'`);
      assert.equal(n.rows[0].n, 1);
      await env.pool.query(`delete from ${env.schema}.karyawan where nama = 'Kirim Dobel'`);
   });

   test('login attempts are rate limited per IP', async () => {
      const strict = buildServer({ pool: env.pool, secret: 'x'.repeat(40), loginRateLimit: 2 });
      await strict.ready();
      try {
         const codes: number[] = [];
         for (let i = 0; i < 3; i++) {
            const r = await strict.inject({ method: 'POST', url: `${env.base}/login`, payload: 'username=a&password=b',
               headers: { 'content-type': 'application/x-www-form-urlencoded' } });
            codes.push(r.statusCode);
         }
         assert.deepEqual(codes, [303, 303, 429]);
      } finally {
         await strict.close();
      }
   });

   test('logout ends the session', async () => {
      const b = new Browser(env);
      await b.login();
      const p1 = await b.open(`${env.base}/1`);
      const out = await b.post(`${env.base}/logout`, { __csrf: field(p1.body, '__csrf')! });
      assert.equal(out.statusCode, 303);
      assert.match(String((await b.get(`${env.base}/1`)).headers.location), /login/);
   });
});

describe('lost update', () => {
   async function openRow(b: Browser, name: string) {
      const list = await b.open(`${env.base}/1`);
      const id = (await env.pool.query(`select empno from ${env.schema}.karyawan where nama = $1`, [name])).rows[0].empno;
      const form = await b.open(links(list.body).find(l => l.includes(`P2_EMPNO=${id}&`))!);
      return { id, fields: formFields(form.body) };
   }

   test('second editor of the same row gets a conflict instead of overwriting', async () => {
      const a = new Browser(env), b = new Browser(env);
      await a.login(); await b.login();
      const ra = await openRow(a, 'Rina Kartikasari');
      const rb = await openRow(b, 'Rina Kartikasari');
      assert.match(ra.fields.__rv_form, /^[\w-]+\.[\w-]+$/);
      assert.equal((await a.post(`${env.base}/2`, { ...ra.fields, P2_JABATAN: 'Akuntan Senior', REQUEST: 'SIMPAN' })).statusCode, 303);
      const conflict = await b.post(`${env.base}/2`, { ...rb.fields, P2_JABATAN: 'Kepala Akuntansi', REQUEST: 'SIMPAN' });
      assert.equal(conflict.statusCode, 422);
      assert.match(conflict.body, /Data diubah pengguna lain/);
      const db = await env.pool.query(`select jabatan from ${env.schema}.karyawan where empno = $1`, [ra.id]);
      assert.equal(db.rows[0].jabatan, 'Akuntan Senior');
      // after reopening, B sees the new version and can save
      const fresh = await openRow(b, 'Rina Kartikasari');
      assert.equal(fresh.fields.P2_JABATAN, 'Akuntan Senior');
      assert.equal((await b.post(`${env.base}/2`, { ...fresh.fields, P2_JABATAN: 'Kepala Akuntansi', REQUEST: 'SIMPAN' })).statusCode, 303);
   });

   test('delete of a row changed meanwhile is refused too', async () => {
      const a = new Browser(env), b = new Browser(env);
      await a.login(); await b.login();
      const ra = await openRow(a, 'Maria Ulfa');
      const rb = await openRow(b, 'Maria Ulfa');
      await a.post(`${env.base}/2`, { ...ra.fields, P2_GAJI: '6300000', REQUEST: 'SIMPAN' });
      const del = await b.post(`${env.base}/2`, { ...rb.fields, REQUEST: 'HAPUS' });
      assert.equal(del.statusCode, 422);
      assert.equal((await env.pool.query(`select count(*)::int as n from ${env.schema}.karyawan where empno = $1`, [rb.id])).rows[0].n, 1);
   });

   test('a validation error keeps the original version (no silent refresh)', async () => {
      const a = new Browser(env), b = new Browser(env);
      await a.login(); await b.login();
      const rb = await openRow(b, 'Bambang Sutrisno');
      const err = await b.post(`${env.base}/2`, { ...rb.fields, P2_NAMA: '', REQUEST: 'SIMPAN' });
      assert.equal(err.statusCode, 422);
      assert.equal(formFields(err.body).__rv_form, rb.fields.__rv_form);
      const ra = await openRow(a, 'Bambang Sutrisno');
      await a.post(`${env.base}/2`, { ...ra.fields, P2_JABATAN: 'Manajer Lini 2', REQUEST: 'SIMPAN' });
      const again = await b.post(`${env.base}/2`, { ...formFields(err.body), P2_NAMA: 'Bambang Sutrisno', REQUEST: 'SIMPAN' });
      assert.equal(again.statusCode, 422);
      assert.match(again.body, /Data diubah pengguna lain/);
   });

   test('a forged or missing version token is not accepted', async () => {
      const b = new Browser(env);
      await b.login();
      const rb = await openRow(b, 'Dewi Lestari');
      const { __rv_form, ...noToken } = rb.fields;
      assert.ok(__rv_form);
      assert.equal((await b.post(`${env.base}/2`, { ...noToken, REQUEST: 'SIMPAN' })).statusCode, 422);
      const again = await openRow(b, 'Dewi Lestari');
      const forged = `${'A'.repeat(32)}.${'B'.repeat(32)}`;
      assert.equal((await b.post(`${env.base}/2`, { ...again.fields, __rv_form: forged, REQUEST: 'SIMPAN' })).statusCode, 422);
   });
});

describe('errors', () => {
   test('unknown page and unknown app give friendly 404 pages', async () => {
      const b = new Browser(env);
      await b.login();
      const r = await b.get(`${env.base}/404`);
      assert.equal(r.statusCode, 404);
      assert.match(r.body, /Halaman tidak ditemukan/);
      assert.equal((await b.get(`/r/${env.ws}/tidak-ada/1`)).statusCode, 404);
   });
});
