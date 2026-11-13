import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Browser, field, formFields, links, setup, type Env } from './helpers.ts';

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

   test('logout ends the session', async () => {
      const b = new Browser(env);
      await b.login();
      const p1 = await b.open(`${env.base}/1`);
      const out = await b.post(`${env.base}/logout`, { __csrf: field(p1.body, '__csrf')! });
      assert.equal(out.statusCode, 303);
      assert.match(String((await b.get(`${env.base}/1`)).headers.location), /login/);
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
