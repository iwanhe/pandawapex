import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Browser, formFields, links, setup, type Env } from './helpers.ts';
import { parseSpec, SpecError } from '../src/spec/import.ts';
import { postedValue } from '../src/engine/items.ts';

// M3: item types, shared / cascading / popup lists of values, value checks, function-body validations.
// Example app: page 2 = employee form (switch, radio, checkbox group, shared LOV), page 4 = transfer
// (popup LOV cascading from a select, radio -> cascading select, datetime, required checkbox).
let env: Env;
before(async () => { env = await setup(); });
after(async () => { await env?.close(); });

const deptno = async (nama: string) =>
   String((await env.pool.query(`select deptno from ${env.schema}.departemen where nama = $1`, [nama])).rows[0].deptno);
const emp = async (nama: string) =>
   (await env.pool.query(`select * from ${env.schema}.karyawan where nama = $1`, [nama])).rows[0];

/** Open the form of one employee through the report link (which carries the checksum). */
async function openEmployee(b: Browser, nama: string) {
   const list = await b.open(`${env.base}/1?daftar__q=${encodeURIComponent(nama)}`);
   const href = links(list.body)[0];
   assert.ok(href, `link to ${nama}`);
   return b.open(href);
}

/** POST with repeated keys, the way a browser sends several ticked boxes. */
async function postPairs(b: Browser, url: string, pairs: [string, string][]) {
   const r = await env.app.inject({
      method: 'POST', url, payload: new URLSearchParams(pairs).toString(),
      headers: { cookie: [...b.cookies].map(([k, v]) => `${k}=${v}`).join('; '), 'content-type': 'application/x-www-form-urlencoded' },
   });
   return r;
}

describe('item types on the employee form', () => {
   test('switch, radio group, checkbox group and a shared LOV render as native, labelled controls', async () => {
      const b = new Browser(env);
      await b.login();
      const r = await openEmployee(b, 'Sri Wahyuni');
      assert.equal(r.statusCode, 200);
      assert.match(r.body, /<input type="checkbox" role="switch" id="P2_AKTIF" name="P2_AKTIF"[^>]*value="Y" checked>/);
      assert.match(r.body, /<fieldset class="r-field r-fieldset r-col-6" data-item="P2_STATUS_KERJA"[^>]*><legend class="r-label">Status kerja/);
      assert.match(r.body, /<input type="radio" name="P2_STATUS_KERJA" id="P2_STATUS_KERJA" value="TETAP" checked/);
      assert.match(r.body, /<input type="checkbox" name="P2_KEAHLIAN" id="P2_KEAHLIAN_2" value="APEX">/);
      assert.match(r.body, /<option value="">- Pilih departemen -<\/option>/, 'null display set on the item, list shared');
      assert.match(r.body, /<option value="\d+" selected>Gudang Bahan Baku<\/option>/);
   });

   test('several ticked boxes are stored joined with ":"; an unticked switch stores its off value', async () => {
      const b = new Browser(env);
      await b.login();
      const f = formFields((await openEmployee(b, 'Agus Prasetyo')).body);
      delete f.P2_AKTIF;                                     // switch off: the browser sends nothing
      const pairs = Object.entries(f).filter(([k]) => k !== 'P2_KEAHLIAN' && k !== 'P2_STATUS_KERJA');
      const r = await postPairs(b, `${env.base}/2`,
         [...pairs, ['P2_KEAHLIAN', 'SQL'], ['P2_KEAHLIAN', 'GDG'], ['P2_STATUS_KERJA', 'KONTRAK'], ['REQUEST', 'SIMPAN']]);
      assert.equal(r.statusCode, 303, r.body.slice(0, 400));
      const row = await emp('Agus Prasetyo');
      assert.equal(row.keahlian, 'SQL:GDG');
      assert.equal(row.aktif, false);
      assert.equal(row.status_kerja, 'KONTRAK');
      // and they come back ticked
      const again = await openEmployee(b, 'Agus Prasetyo');
      assert.match(again.body, /value="SQL" checked/);
      assert.match(again.body, /value="GDG" checked/);
      assert.doesNotMatch(again.body, /value="APEX" checked/);
      assert.match(again.body, /role="switch" id="P2_AKTIF" name="P2_AKTIF"[^>]*value="Y">/, 'switch off');
   });

   test('values outside the list are refused, whatever the browser sends', async () => {
      const b = new Browser(env);
      await b.login();
      const f = formFields((await openEmployee(b, 'Dewi Lestari')).body);
      const r = await b.post(`${env.base}/2`, { ...f, P2_DEPTNO: '999', P2_STATUS_KERJA: 'DIREKTUR', P2_KEAHLIAN: 'SQL:SIHIR', P2_AKTIF: 'mungkin', REQUEST: 'SIMPAN' });
      assert.equal(r.statusCode, 422);
      assert.match(r.body, /Departemen: pilihan &quot;999&quot; tidak ada di daftar\./);
      assert.match(r.body, /Status kerja: pilihan &quot;DIREKTUR&quot; tidak ada di daftar\./);
      assert.match(r.body, /Keahlian: pilihan &quot;SIHIR&quot; tidak ada di daftar\./);
      assert.match(r.body, /Aktif: nilai tidak valid\./);
      assert.match(r.body, /<option value="999" selected>999<\/option>/, 'the refused value stays visible');
      assert.equal((await emp('Dewi Lestari')).status_kerja, 'TETAP', 'nothing saved');
   });

   test('number and date items check their type on the server', async () => {
      const b = new Browser(env);
      await b.login();
      const f = formFields((await openEmployee(b, 'Dewi Lestari')).body);
      const r = await b.post(`${env.base}/2`, { ...f, P2_GAJI: 'sejuta', P2_TGL_MASUK: '2026-02-30', REQUEST: 'SIMPAN' });
      assert.equal(r.statusCode, 422);
      assert.match(r.body, /Gaji per bulan \(Rp\) harus berupa angka/);
      assert.match(r.body, /Tanggal masuk harus berupa tanggal yang valid/);
   });
});

describe('popup LOV and cascading lists (page 4)', () => {
   test('popup LOV search: case-insensitive, highlighted, filtered by its cascade parent', async () => {
      const b = new Browser(env);
      await b.login();
      const page = await b.open(`${env.base}/4`);
      assert.equal(page.statusCode, 200);
      assert.match(page.body, /data-popup-lov="\/r\/[^"]+\/emp\/4\/lov\/P4_EMPNO"/);
      assert.match(page.body, /aria-label="Pilih Karyawan dari daftar"/);
      assert.match(page.body, /data-cascade="P4_DEPT_TUJUAN" data-cascade-url="\/r\/[^"]+\/emp\/4\/field\/P4_JABATAN_BARU"/);

      const all = await b.get(`${env.base}/4/lov/P4_EMPNO?q=SRI`);
      assert.equal(all.statusCode, 200);
      assert.equal(all.headers['cache-control'], 'no-store');
      assert.match(all.body, /role="listbox"/);
      assert.match(all.body, /data-display="Sri Wahyuni \(Kepala Gudang\)"><span><mark>Sri<\/mark> Wahyuni/);

      const keu = await deptno('Keuangan');
      const inDept = await b.get(`${env.base}/4/lov/P4_EMPNO?q=&P4_DEPT_ASAL=${keu}`);
      const names = [...inDept.body.matchAll(/data-display="([^"]+)"/g)].map(m => m[1]);
      assert.deepEqual(names, ['Maria Ulfa (Staf Administrasi)', 'Rina Kartikasari (Akuntan)']);

      const none = await b.get(`${env.base}/4/lov/P4_EMPNO?q=${encodeURIComponent("%' or '1'='1")}`);
      assert.match(none.body, /Tidak ada pilihan yang cocok/, 'the search is literal');
   });

   test('a cascading select is re-rendered for the new parent value, emptied', async () => {
      const b = new Browser(env);
      await b.login();
      await b.open(`${env.base}/4`);
      const r = await b.get(`${env.base}/4/field/P4_JABATAN_BARU?P4_DEPT_TUJUAN=${await deptno('Keuangan')}`);
      assert.equal(r.statusCode, 200);
      assert.match(r.body, /^<div class="r-field r-col-6" data-item="P4_JABATAN_BARU" data-cascade="P4_DEPT_TUJUAN"/);
      const opts = [...r.body.matchAll(/<option value="([^"]*)"/g)].map(m => m[1]);
      assert.deepEqual(opts, ['', 'Akuntan', 'Kasir', 'Staf Administrasi']);
      assert.doesNotMatch(r.body, /selected/);
   });

   test('the endpoints check session, page authorization and the item', async () => {
      const anon = new Browser(env);
      assert.equal((await anon.get(`${env.base}/4/lov/P4_EMPNO?q=a`)).statusCode, 401);
      const tamu = new Browser(env);
      await tamu.login('tamu');
      const denied = await tamu.get(`${env.base}/4/lov/P4_EMPNO?q=a`);
      assert.equal(denied.statusCode, 403);
      assert.doesNotMatch(denied.body, /Wahyuni/);
      const b = new Browser(env);
      await b.login();
      assert.equal((await b.get(`${env.base}/4/lov/P2_DEPTNO`)).statusCode, 404, 'item of another page');
      assert.equal((await b.get(`${env.base}/4/lov/P4_DEPT_ASAL`)).statusCode, 404, 'a select is not a popup LOV');
      assert.equal((await b.get(`${env.base}/4/field/P4_BERLAKU`)).statusCode, 404, 'no list');
   });

   test('transfer: popup value shown by name, validations (function body, required checkbox, datetime), then saved', async () => {
      const b = new Browser(env);
      await b.login();
      const f = formFields((await b.open(`${env.base}/4`)).body);
      const sri = String((await emp('Sri Wahyuni')).empno);
      const gudang = await deptno('Gudang Bahan Baku'), keu = await deptno('Keuangan');

      // same department and job she already has; past date; approval not ticked
      let r = await b.post(`${env.base}/4`, {
         ...f, P4_EMPNO: sri, P4_DEPT_TUJUAN: gudang, P4_JABATAN_BARU: 'Kepala Gudang', P4_BERLAKU: '2020-01-01T08:00', REQUEST: 'PROSES',
      });
      assert.equal(r.statusCode, 422);
      assert.match(r.body, /Sri Wahyuni sudah menjabat Kepala Gudang di departemen itu\./, 'fn_returns_error message');
      assert.match(r.body, /Tanggal berlaku tidak boleh sebelum hari ini\./, 'fn_boolean');
      assert.match(r.body, /Atasan langsung sudah menyetujui mutasi ini wajib dicentang\./);
      assert.match(r.body, /id="P4_EMPNO" value="Sri Wahyuni \(Kepala Gudang\)" readonly/, 'popup LOV shows the display value');
      assert.match(r.body, /type="datetime-local" id="P4_BERLAKU"[^>]*value="2020-01-01T08:00"/);

      // a job of another department is not in the cascaded list
      const g = formFields(r.body);
      r = await b.post(`${env.base}/4`, { ...g, P4_DEPT_TUJUAN: keu, P4_JABATAN_BARU: 'Operator Forklift', P4_BERLAKU: '2099-01-01T07:30', P4_SETUJU: 'Y', REQUEST: 'PROSES' });
      assert.equal(r.statusCode, 422);
      assert.match(r.body, /Jabatan baru: pilihan &quot;Operator Forklift&quot; tidak ada di daftar\./);

      r = await b.post(`${env.base}/4`, {
         ...formFields(r.body), P4_DEPT_TUJUAN: keu, P4_JABATAN_BARU: 'Kasir', P4_BERLAKU: '2099-01-01T07:30', P4_SETUJU: 'Y',
         P4_STATUS: 'KONTRAK', P4_KEAHLIAN: 'K3', REQUEST: 'PROSES',
      });
      assert.equal(r.statusCode, 303, r.body.slice(0, 500));
      const row = await emp('Sri Wahyuni');
      assert.equal(String(row.deptno), keu);
      assert.equal(row.jabatan, 'Kasir');
      assert.equal(row.status_kerja, 'KONTRAK');
      assert.equal(row.keahlian, 'K3');
      assert.match((await b.open(String(r.headers.location))).body, /Mutasi karyawan tercatat\./);
   });

   test('tamu does not see the menu entry of a page it may not open', async () => {
      const tamu = new Browser(env);
      await tamu.login('tamu');
      const r = await tamu.open(`${env.base}/1`);
      assert.doesNotMatch(r.body, />Mutasi</);
   });
});

describe('protected cascade parents', () => {
   // the list is filtered by a protected hidden item: a parent value in the URL must not widen it
   const spec = `app: emp
name: Uji
parsing_schema: x
pages:
  - page: 1
    name: Satu
    regions:
      - static_id: r
        type: static
        items:
          - { name: P1_DEPT, type: hidden, default: "1" }
          - name: P1_EMP
            type: popup_lov
            label: Karyawan
            cascade: [P1_DEPT]
            lov: { sql: "select nama, empno from karyawan where deptno = :P1_DEPT::int order by nama" }
`;
   let env2: Env;
   before(async () => { env2 = await setup(spec); });
   after(async () => { await env2?.close(); });

   test('a hidden parent keeps its session value', async () => {
      const b = new Browser(env2);
      await b.login();
      await b.open(`${env2.base}/1`);
      const own = await b.get(`${env2.base}/1/lov/P1_EMP?q=`);
      const other = await b.get(`${env2.base}/1/lov/P1_EMP?q=&P1_DEPT=3`);
      assert.match(own.body, /Sri Wahyuni/);
      assert.equal(other.body, own.body);
      // an optional popup LOV offers a clear button, hidden while empty
      const page = await b.open(`${env2.base}/1`);
      assert.match(page.body, /<button type="button" class="r-btn r-btn--icon" data-lov-clear aria-label="Kosongkan Karyawan" hidden>/);
   });
});

describe('spec checks', () => {
   const base = (items: string) => `app: x\nname: X\nparsing_schema: s\nlovs:\n  L: { static: [ { display: A, return: a } ] }\npages:\n  - page: 1\n    name: A\n    regions:\n      - static_id: r\n        type: static\n        items:\n${items}`;
   const problems = (yaml: string) => {
      try { parseSpec(yaml); return []; } catch (e) { if (e instanceof SpecError) return e.problems; throw e; }
   };
   test('lists, cascades and on/off values are checked', () => {
      const p = problems(base([
         '          - { name: P1_A, type: select, lov: NOPE }',
         '          - { name: P1_B, type: select, lov: L, cascade: [P1_C] }',
         '          - { name: P1_C, type: select, lov: L, cascade: [P1_B] }',
         '          - { name: P1_D, type: text, on_value: X }',
         '          - { name: P1_E, type: checkbox_group }',
         '          - { name: P1_F, type: select, lov: L, cascade: [P9_X] }',
      ].join('\n') + '\n')).join('\n');
      assert.match(p, /shared lov "NOPE" is not defined/);
      assert.match(p, /cascade forms a cycle/);
      assert.match(p, /on_value \/ off_value only apply to checkbox and switch/);
      assert.match(p, /P1_E: checkbox_group needs a lov/);
      assert.match(p, /cascade parent P9_X is not an item on page 1/);
   });
   test('the example app passes', () => {
      assert.deepEqual(problems(base('          - { name: P1_A, type: radio, lov: L }\n')), []);
   });
});

describe('posted values', () => {
   const item = (type: string) => ({ type, onValue: 'Y', offValue: 'N' }) as Parameters<typeof postedValue>[0];
   test('normalisation per item type', () => {
      assert.equal(postedValue(item('checkbox_group'), ['a', 'b', 'a', '']), 'a:b');
      assert.equal(postedValue(item('checkbox_group'), undefined), null);
      assert.equal(postedValue(item('switch'), undefined), 'N');
      assert.equal(postedValue(item('switch'), 'Y'), 'Y');
      assert.equal(postedValue(item('radio'), undefined), null);
      assert.equal(postedValue(item('datetime'), '2026-11-13T09:15'), '2026-11-13 09:15');
      assert.equal(postedValue(item('text'), ['first', 'second']), 'first');
      assert.equal(postedValue(item('text'), '   '), null);
   });
});
