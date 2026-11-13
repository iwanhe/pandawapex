import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Browser, formFields, setup, type Env } from './helpers.ts';

// A second app exercising PL/pgSQL processes, set_item() write-back and a failing process.
const SPEC = `
app: emp
name: Proses
parsing_schema: demo_app
pages:
  - page: 1
    name: Kenaikan gaji
    regions:
      - static_id: f
        title: Naikkan gaji
        type: static
        source: { html: "<p>Hasil: &P1_HASIL.</p>" }
        items:
          - { name: P1_EMPNO, type: number, label: No. karyawan, required: true }
          - { name: P1_PERSEN, type: number, label: Persen, required: true }
          - { name: P1_HASIL, type: display_only, label: Gaji baru }
        buttons:
          - { name: NAIKKAN, label: Naikkan, hot: true }
          - { name: GAGAL, label: Gagal }
    validations:
      - { name: ada, type: sql_exists, expression: "select 1 from karyawan where empno = :P1_EMPNO::int", error_msg: Karyawan tidak ditemukan., item: P1_EMPNO }
    processes:
      - name: naikkan
        type: plpgsql
        when_button: NAIKKAN
        success_msg: "Gaji baru: &P1_HASIL."
        code: |
          declare
             l_baru numeric;
          begin
             update karyawan set gaji = round(gaji * (1 + :P1_PERSEN::numeric / 100))
             where empno = :P1_EMPNO::int
             returning gaji into l_baru;
             perform rpx_rt.set_item('P1_HASIL', l_baru::text);
          end;
      - name: gagal
        type: plpgsql
        when_button: GAGAL
        error_msg: Proses sengaja digagalkan.
        code: |
          update karyawan set gaji = 1 where empno = :P1_EMPNO::int;
          raise exception 'stop di sini';
`;

let env: Env;
before(async () => { env = await setup(SPEC); });
after(async () => { await env?.close(); });

test('plpgsql process updates data and returns an item through set_item()', async () => {
   const before_ = (await env.pool.query(`select gaji from ${env.schema}.karyawan where empno = 1`)).rows[0].gaji;
   const b = new Browser(env);
   await b.login();
   const p = await b.open(`${env.base}/1`);
   const r = await b.post(`${env.base}/1`, { ...formFields(p.body), P1_EMPNO: '1', P1_PERSEN: '10', REQUEST: 'NAIKKAN' });
   assert.equal(r.statusCode, 303);
   const expected = Math.round(Number(before_) * 1.1).toFixed(2);
   assert.equal((await env.pool.query(`select gaji from ${env.schema}.karyawan where empno = 1`)).rows[0].gaji, expected);
   const after_ = await b.open(`${env.base}/1`);
   assert.match(after_.body, new RegExp(`Gaji baru: ${expected.replace('.', '\\.')}`));
   assert.match(after_.body, new RegExp(`Hasil: ${expected.replace('.', '\\.')}`));
});

test('a failing process rolls back everything and shows its error message', async () => {
   const b = new Browser(env);
   await b.login();
   const p = await b.open(`${env.base}/1`);
   const beforeGaji = (await env.pool.query(`select gaji from ${env.schema}.karyawan where empno = 2`)).rows[0].gaji;
   const r = await b.post(`${env.base}/1`, { ...formFields(p.body), P1_EMPNO: '2', P1_PERSEN: '1', REQUEST: 'GAGAL' });
   assert.equal(r.statusCode, 422);
   assert.match(r.body, /Proses sengaja digagalkan\./);
   assert.match(r.body, /stop di sini/);
   assert.equal((await env.pool.query(`select gaji from ${env.schema}.karyawan where empno = 2`)).rows[0].gaji, beforeGaji);
});

test('sql_exists validation', async () => {
   const b = new Browser(env);
   await b.login();
   const p = await b.open(`${env.base}/1`);
   const r = await b.post(`${env.base}/1`, { ...formFields(p.body), P1_EMPNO: '424242', P1_PERSEN: '1', REQUEST: 'NAIKKAN' });
   assert.equal(r.statusCode, 422);
   assert.match(r.body, /Karyawan tidak ditemukan\./);
});
