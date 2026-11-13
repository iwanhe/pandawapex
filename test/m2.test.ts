import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Browser, field, formFields, links, setup, type Env } from './helpers.ts';

// M2: authorization schemes, conditions, computations, application items, escape filters.
const SPEC = `
app: emp
name: Uji M2
parsing_schema: demo_app
home_page: 1
authorization:
  - { name: sdm, type: group_member, source: "SDM, HRD", error_msg: Khusus tim SDM. }
  - { name: punya_gudang, type: exists_sql, source: "select 1 from departemen where nama = 'Gudang Bahan Baku'" }
  - { name: tanpa_cache, type: exists_sql, source: "select 1 from departemen where nama = 'Gudang Bahan Baku'", evaluation: always }
  - { name: fungsi_iwan, type: fn_boolean, source: "return :APP_USER = 'iwan';" }
  - { name: bukan_tamu, type: fn_boolean, source: "return rpx_rt.app_user() <> 'tamu';" }
application_items:
  - { name: AI_SESI }
  - { name: AI_LOGIN }
  - { name: AI_HITUNG }
computations:
  - { item: AI_SESI, point: on_new_session, type: static, expression: "baru" }
  - { item: AI_LOGIN, point: after_authentication, type: plpgsql_fn, expression: "return 'masuk:' || :APP_USER;" }
  - { item: AI_HITUNG, point: before_header, type: sql_expression, expression: "coalesce(:AI_HITUNG::int, 0) + 1" }
navigation:
  - { label: Beranda, page: 1 }
  - { label: Rahasia, page: 2 }
  - { label: Hanya Iwan, page: 1, authorization: fungsi_iwan }
pages:
  - page: 1
    name: Beranda
    computations:
      - { item: P1_SALAM, type: static, expression: "Halo &APP_USER.", condition: { item_null: P1_SALAM } }
    regions:
      - static_id: info
        type: static
        title: Info
        source:
          html: "<p id='sesi'>&AI_SESI.|&AI_LOGIN.|&AI_HITUNG.</p><p id='esc'>&P1_TEKS.</p><p id='raw'>&P1_TEKS!RAW.</p><p id='js'>&P1_TEKS!JS.</p>"
        items:
          - { name: P1_SALAM, type: display_only, label: Salam }
          - { name: P1_TEKS, type: text, label: Teks, protection: unrestricted }
          - { name: P1_RAHASIA, type: text, label: Isian SDM, authorization: sdm }
          - { name: P1_MODE, type: text, label: Mode, protection: unrestricted }
          - { name: P1_KHUSUS_EDIT, type: text, label: Muncul saat mode edit, condition: { item_equals: { item: P1_MODE, value: edit } } }
          - { name: P1_HASIL, type: display_only, label: Hasil }
        buttons:
          - { name: SIMPAN, label: Simpan, hot: true }
          - { name: SETUJUI, label: Setujui, authorization: sdm }
          - { name: TIDAK_PERNAH, label: Tak pernah, condition: { never: true } }
      - static_id: gudang
        type: static
        title: Panel gudang
        authorization: punya_gudang
        source: { html: "<p>ada gudang</p>" }
      - static_id: dinamis
        type: static
        title: Panel dinamis
        authorization: tanpa_cache
        source: { html: "<p>dinamis</p>" }
      - static_id: kondisi_sql
        type: static
        title: Panel bila ada karyawan
        condition: { sql_exists: "select 1 from karyawan where nama = 'Dewi Lestari'" }
        source: { html: "<p>ada dewi</p>" }
      - static_id: tamu
        type: static
        title: Panel bukan tamu
        authorization: bukan_tamu
        source: { html: "<p>bukan tamu</p>" }
    validations:
      - { name: teks_pendek, type: sql_expression, expression: "length(:P1_TEKS) <= 40", error_msg: Teks terlalu panjang., item: P1_TEKS, condition: { item_not_null: P1_MODE } }
    processes:
      - { name: tandai, type: plpgsql, code: "perform rpx_rt.set_item('P1_HASIL', 'simpan');", condition: { request_equals: SIMPAN } }
      - { name: setujui, type: plpgsql, code: "perform rpx_rt.set_item('P1_HASIL', 'setuju');", when_button: SETUJUI }
    branches:
      - { page: 2, condition: { item_equals: { item: P1_MODE, value: ke-rahasia } } }
      - { page: 1 }
  - page: 2
    name: Rahasia
    authorization: sdm
    regions:
      - { static_id: r, type: static, source: { html: "<p>isi rahasia</p>" } }
`;

let env: Env;
before(async () => { env = await setup(SPEC); });
after(async () => { await env?.close(); });

const text = (body: string, id: string) => new RegExp(`<p id='${id}'>([^<]*)</p>`).exec(body.replace(/&#39;/g, "'"))?.[1];

describe('authorization schemes', () => {
   test('group_member: page 403 with the scheme message; nav entry and link hidden', async () => {
      const tamu = new Browser(env);
      await tamu.login('tamu');
      const home = await tamu.open(`${env.base}/1`);
      assert.doesNotMatch(home.body, />Rahasia</, 'menu entry to a page the user may not open is hidden');
      const denied = await tamu.get(`${env.base}/2`);
      assert.equal(denied.statusCode, 403);
      assert.match(denied.body, /Khusus tim SDM\./);

      const sdm = new Browser(env);
      await sdm.login('iwan');
      const ok = await sdm.open(`${env.base}/2`);
      assert.equal(ok.statusCode, 200);
      assert.match(ok.body, /isi rahasia/);
      assert.match((await sdm.open(`${env.base}/1`)).body, />Rahasia</);
   });

   test('items and buttons the user may not use are neither rendered nor accepted', async () => {
      const tamu = new Browser(env);
      await tamu.login('tamu');
      const p = await tamu.open(`${env.base}/1`);
      assert.doesNotMatch(p.body, /name="P1_RAHASIA"/);
      assert.doesNotMatch(p.body, /value="SETUJUI"/);
      assert.doesNotMatch(p.body, /value="TIDAK_PERNAH"/, 'condition never');
      // forging the hidden button / item in the POST
      const forged = await tamu.post(`${env.base}/1`, { ...formFields(p.body), REQUEST: 'SETUJUI' });
      assert.equal(forged.statusCode, 400);
      const p2 = await tamu.open(`${env.base}/1`);
      await tamu.post(`${env.base}/1`, { ...formFields(p2.body), P1_RAHASIA: 'disusupkan', REQUEST: 'SIMPAN' });
      const st = await env.pool.query(`select count(*)::int as n from rpx.session_state where item_name = 'P1_RAHASIA' and value = 'disusupkan'`);
      assert.equal(st.rows[0].n, 0);

      const sdm = new Browser(env);
      await sdm.login('iwan');
      const ps = await sdm.open(`${env.base}/1`);
      assert.match(ps.body, /name="P1_RAHASIA"/);
      assert.equal((await sdm.post(`${env.base}/1`, { ...formFields(ps.body), REQUEST: 'SETUJUI' })).statusCode, 303);
      assert.match((await sdm.open(`${env.base}/1`)).body, /id="P1_HASIL">setuju</);
   });

   test('exists_sql once_per_session is cached; evaluation "always" is not', async () => {
      const b = new Browser(env);
      await b.login('iwan');
      const first = await b.open(`${env.base}/1`);
      assert.match(first.body, /ada gudang/);
      assert.match(first.body, /dinamis/);
      await env.pool.query(`update ${env.schema}.departemen set nama = 'Gudang (ganti nama)' where nama = 'Gudang Bahan Baku'`);
      try {
         const again = await b.open(`${env.base}/1`);
         assert.match(again.body, /ada gudang/, 'once_per_session result is kept for the session');
         assert.doesNotMatch(again.body, /<p>dinamis<\/p>/, '"always" is evaluated again');
         const fresh = new Browser(env);
         await fresh.login('iwan');
         assert.doesNotMatch((await fresh.open(`${env.base}/1`)).body, /ada gudang/, 'a new session evaluates again');
      } finally {
         await env.pool.query(`update ${env.schema}.departemen set nama = 'Gudang Bahan Baku' where nama = 'Gudang (ganti nama)'`);
      }
   });

   test('fn_boolean schemes see :APP_USER and rpx_rt.app_user()', async () => {
      const tamu = new Browser(env);
      await tamu.login('tamu');
      const t = await tamu.open(`${env.base}/1`);
      assert.doesNotMatch(t.body, /Hanya Iwan/);
      assert.doesNotMatch(t.body, /bukan tamu/);
      const iwan = new Browser(env);
      await iwan.login('iwan');
      const i = await iwan.open(`${env.base}/1`);
      assert.match(i.body, /Hanya Iwan/);
      assert.match(i.body, /bukan tamu/);
   });

   test('a locked account loses its open session', async () => {
      const b = new Browser(env);
      await b.login('tamu');
      assert.equal((await b.get(`${env.base}/1`)).statusCode, 200);
      await env.pool.query(`update rpx.app_users set locked = true where username = 'tamu'`);
      try {
         const r = await b.get(`${env.base}/1`);
         assert.equal(r.statusCode, 303);
         assert.match(String(r.headers.location), /login/);
      } finally {
         await env.pool.query(`update rpx.app_users set locked = false, failed_logins = 0 where username = 'tamu'`);
      }
   });
});

describe('computations', () => {
   test('on_new_session, after_authentication, before_header (app) and page computations with a condition', async () => {
      const b = new Browser(env);
      await b.login('iwan');
      const p = await b.open(`${env.base}/1`);
      assert.equal(text(p.body, 'sesi'), 'baru|masuk:iwan|1');
      assert.match(p.body, /id="P1_SALAM">Halo iwan</);
      const p2 = await b.open(`${env.base}/1`);
      assert.equal(text(p2.body, 'sesi'), 'baru|masuk:iwan|2', 'before_header runs on every page view; session ones once');
   });

   test('an application item cannot be set from the URL (restricted by default)', async () => {
      const b = new Browser(env);
      await b.login('iwan');
      const r = await b.get(`${env.base}/1?AI_LOGIN=palsu`);
      assert.equal(r.statusCode, 403);
   });
});

describe('conditions, validations, branches', () => {
   test('item_equals shows an item only in a mode; validation condition; branch condition', async () => {
      const b = new Browser(env);
      await b.login('iwan');
      let p = await b.open(`${env.base}/1`);
      assert.doesNotMatch(p.body, /name="P1_KHUSUS_EDIT"/);
      assert.match(p.body, /ada dewi/, 'sql_exists condition');

      // P1_MODE empty: the length validation does not apply
      const long = 'x'.repeat(50);
      assert.equal((await b.post(`${env.base}/1`, { ...formFields(p.body), P1_TEKS: long, REQUEST: 'SIMPAN' })).statusCode, 303);
      p = await b.open(`${env.base}/1`);
      const bad = await b.post(`${env.base}/1`, { ...formFields(p.body), P1_MODE: 'edit', P1_TEKS: long, REQUEST: 'SIMPAN' });
      assert.equal(bad.statusCode, 422);
      assert.match(bad.body, /Teks terlalu panjang\./);
      assert.match(bad.body, /name="P1_KHUSUS_EDIT"/, 'the condition sees the submitted mode');

      p = await b.open(`${env.base}/1`);
      const go = await b.post(`${env.base}/1`, { ...formFields(p.body), P1_MODE: 'ke-rahasia', P1_TEKS: 'ok', REQUEST: 'SIMPAN' });
      assert.equal(go.statusCode, 303);
      assert.equal(go.headers.location, `${env.base}/2`);
      assert.match((await b.open(`${env.base}/1`)).body, /id="P1_HASIL">simpan</, 'process ran because request_equals SIMPAN');
   });
});

describe('substitution escape filters', () => {
   test('default and !HTML escape, !RAW does not, !JS escapes for a JS string', async () => {
      const b = new Browser(env);
      await b.login('iwan');
      const p = await b.open(`${env.base}/1`);
      await b.post(`${env.base}/1`, { ...formFields(p.body), P1_TEKS: `<b>tebal</b> "kutip"`, REQUEST: 'SIMPAN' });
      const r = await b.open(`${env.base}/1`);
      assert.match(r.body, /<p id='esc'>&lt;b&gt;tebal&lt;\/b&gt; &quot;kutip&quot;<\/p>/);
      assert.match(r.body, /<p id='raw'><b>tebal<\/b> "kutip"<\/p>/);
      assert.match(r.body, /<p id='js'>\\u003cb\\u003etebal\\u003c\/b\\u003e \\"kutip\\"<\/p>/);
   });
});

describe('example app', () => {
   test('users without the SDM group see the list read-only', async () => {
      const ex = await setup(readFileSync(join(import.meta.dirname, '../examples/emp/app.yaml'), 'utf8'));
      try {
         const tamu = new Browser(ex);
         await tamu.login('tamu');
         const list = await tamu.open(`${ex.base}/1`);
         assert.equal(links(list.body).length, 0, 'names are plain text');
         assert.doesNotMatch(list.body, /Tambah karyawan/);
         const sdm = new Browser(ex);
         await sdm.login('iwan');
         const l2 = await sdm.open(`${ex.base}/1`);
         assert.ok(links(l2.body).length > 0);
         const form = await sdm.open(links(l2.body)[0]);
         assert.match(form.body, /id="P2_MASA_KERJA">\d+ tahun</, 'page computation after form init');
         const about = await sdm.open(`${ex.base}/3`);
         assert.match(about.body, /sejak \d\d-\d\d-\d{4} \d\d:\d\d/);
         assert.ok(field(about.body, '__csrf'));
      } finally {
         await ex.close();
      }
   });
});
