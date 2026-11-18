import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSpec, SpecError } from '../src/spec/import.ts';
import { Browser, formFields, setup, type Env } from './helpers.ts';

// Dynamic actions tahap 2 (DA2): execute_server_code with items to submit / return, and refresh with items to submit.
// The browser side is covered by e2e/da.spec.ts.

const SPEC = `
app: emp
name: Uji DA server
parsing_schema: demo_app
pages:
  - page: 1
    name: Uji DA server
    regions:
      - static_id: isian
        title: Isian
        type: static
        items:
          - { name: P1_A, type: number, label: Angka }
          - { name: P1_B, type: display_only, label: Hasil, format: number }
          - { name: P1_PILIH, type: select, label: Pilih, lov: { static: [ { display: A, return: A }, { display: B, return: B } ] } }
          - { name: P1_KUNCI, type: hidden, default: "7" }
        buttons:
          - { name: HITUNG, label: Hitung, action: defined_by_da }
          - { name: RAHASIA, label: Rahasia, action: defined_by_da, condition: { never: true } }
      - static_id: daftar
        title: Daftar
        type: classic_report
        source: { sql: "select :P1_PILIH as pilihan" }
    dynamic_actions:
      - name: hitung
        event: click
        button: HITUNG
        actions:
          - action: execute_server_code
            items_to_submit: [P1_A]
            items_to_return: [P1_B]
            code: |
              begin
                 insert into departemen (nama, lokasi) values ('DA ' || :P1_A, 'uji');
                 if :P1_A::int < 0 then
                    raise exception 'Angka tidak boleh negatif.';
                 end if;
                 perform rpx_rt.set_item('P1_B', (:P1_A::int * 2000)::text);
              end;
      - name: pilih
        event: change
        items: [P1_PILIH]
        actions:
          - { action: show, items: [P1_A] }
          - { action: refresh, regions: [daftar], items_to_submit: [P1_PILIH] }
      - name: rahasia
        event: click
        button: RAHASIA
        actions:
          - { action: execute_server_code, code: "begin perform 1; end;" }
`;

describe('DA2: spec checks', () => {
   const variant = (das: string) => SPEC.replace(/    dynamic_actions:\n[\s\S]*$/, `    dynamic_actions:\n${das}\n`);
   const problems = (text: string) => {
      try { parseSpec(text); } catch (e) { if (e instanceof SpecError) return e.problems.join('\n'); throw e; }
      return '';
   };
   test('the test spec itself is valid', () => assert.equal(problems(SPEC), ''));
   const cases: [string, string, RegExp][] = [
      ['server code without code', `      - { name: a, event: page_load, actions: [ { action: execute_server_code } ] }`, /execute_server_code: needs code/],
      ['code on another action', `      - { name: a, event: page_load, actions: [ { action: hide, items: [P1_A], code: "x" } ] }`, /code only applies to execute_server_code/],
      ['items to submit on show', `      - { name: a, event: page_load, actions: [ { action: show, items: [P1_A], items_to_submit: [P1_A] } ] }`, /items_to_submit only applies to execute_server_code and refresh/],
      ['items to return on refresh', `      - { name: a, event: change, items: [P1_A], actions: [ { action: refresh, regions: [daftar], items_to_return: [P1_A] } ] }`, /items_to_return only applies to execute_server_code/],
      ['submit a display only item', `      - { name: a, event: page_load, actions: [ { action: execute_server_code, code: "x", items_to_submit: [P1_B] } ] }`, /item P1_B \(display_only\) cannot be submitted/],
      ['return a protected hidden item', `      - { name: a, event: page_load, actions: [ { action: execute_server_code, code: "x", items_to_return: [P1_KUNCI] } ] }`, /item P1_KUNCI \(hidden\) cannot be returned/],
      ['unknown item to submit', `      - { name: a, event: page_load, actions: [ { action: execute_server_code, code: "x", items_to_submit: [P1_X] } ] }`, /items_to_submit P1_X is not an item on page 1/],
      ['server code on load flag', `      - { name: a, event: change, items: [P1_A], actions: [ { action: execute_server_code, code: "x", on_load: true } ] }`, /on_load only applies to/],
   ];
   for (const [name, das, expected] of cases) test(`rejects: ${name}`, () => assert.match(problems(variant(das)), expected));
});

describe('DA2: calling the server', () => {
   let env: Env;
   before(async () => { env = await setup(SPEC); });
   after(async () => { await env?.close(); });

   const open = async () => {
      const b = new Browser(env);
      await b.login();
      const p = await b.open(`${env.base}/1`);
      return { b, page: p.body, fields: formFields(p.body) };
   };
   const call = (b: Browser, fields: Record<string, string>, extra: Record<string, string>) =>
      b.post(`${env.base}/1/da`, { ...fields, ...extra });
   const departemen = async (nama: string) =>
      Number((await env.pool.query(`select count(*)::int as n from ${env.schema}.departemen where nama = $1`, [nama])).rows[0].n);

   test('the browser gets the dynamic action without its code', async () => {
      const { page } = await open();
      const json = /<script type="application\/json" id="rpx-da">([^<]*)<\/script>/.exec(page)![1];
      assert.doesNotMatch(json, /insert into|raise exception|perform/, 'server code stays on the server');
      const das = JSON.parse(json) as { name: string; actions: Record<string, unknown>[] }[];
      assert.deepEqual(das.map(d => d.name), ['hitung', 'pilih']);
      assert.deepEqual(das[0].actions[0], { action: 'execute_server_code', items_to_submit: ['P1_A'], items_to_return: ['P1_B'] });
   });

   test('execute_server_code: submitted items are bound, returned items come back, data changes are committed', async () => {
      const { b, fields } = await open();
      const r = await call(b, fields, { da: 'hitung', a: '0', P1_A: '21' });
      assert.equal(r.statusCode, 200, r.body);
      assert.deepEqual(JSON.parse(r.body), { items: { P1_B: '42000' }, shown: { P1_B: '42.000' } });
      assert.match(r.headers['content-type'] as string, /application\/json/);
      assert.equal(await departemen('DA 21'), 1);
      const again = await b.open(`${env.base}/1`);
      assert.match(again.body, /id="P1_A" name="P1_A" value="21"/, 'the submitted value is in session state');
      assert.match(again.body, /<div class="r-display" id="P1_B">42.000<\/div>/);
   });

   test('an error in the code rolls back and keeps the session state as it was', async () => {
      const { b, fields } = await open();
      const r = await call(b, fields, { da: 'hitung', a: '0', P1_A: '-1' });
      assert.equal(r.statusCode, 422);
      assert.match(JSON.parse(r.body).error, /Angka tidak boleh negatif/);
      assert.equal(await departemen('DA -1'), 0);
      const again = await b.open(`${env.base}/1`);
      assert.doesNotMatch(again.body, /value="-1"/);
   });

   test('submitted values are checked like a page submit', async () => {
      const { b, fields } = await open();
      const r = await call(b, fields, { da: 'hitung', a: '0', P1_A: 'dua' });
      assert.equal(r.statusCode, 422);
      assert.deepEqual(JSON.parse(r.body), { error: 'Angka harus berupa angka (pakai titik untuk desimal).', item: 'P1_A' });
      assert.equal(await departemen('DA dua'), 0);
      const lov = await call(b, fields, { da: 'pilih', a: '1', P1_PILIH: 'Z' });
      assert.equal(lov.statusCode, 422);
      assert.match(JSON.parse(lov.body).error, /pilihan "Z" tidak ada di daftar/);
   });

   test('refresh with items to submit stores them so the region shows the new value', async () => {
      const { b, fields } = await open();
      const r = await call(b, fields, { da: 'pilih', a: '1', P1_PILIH: 'B' });
      assert.equal(r.statusCode, 200, r.body);
      assert.deepEqual(JSON.parse(r.body), { items: {}, shown: {} });
      const again = await b.open(`${env.base}/1`);
      assert.match(again.body, /<option value="B" selected>/);
      assert.match(again.body, /<td[^>]*>B<\/td>/);
   });

   test('only the dynamic actions this form was rendered with, and only their server actions, can be called', async () => {
      const { b, fields } = await open();
      for (const extra of [
         { da: 'rahasia', a: '0' },          // its button was not rendered
         { da: 'tidak_ada', a: '0' },
         { da: 'pilih', a: '0' },            // a show action, nothing to call
         { da: 'hitung', a: '9' },
         { da: 'hitung', a: 'x' },
      ]) {
         const r = await call(b, fields, extra);
         assert.equal(r.statusCode, 400, JSON.stringify(extra));
         assert.match(JSON.parse(r.body).error, /tidak tersedia/);
      }
   });

   test('CSRF, form state and session are required', async () => {
      const { b, fields } = await open();
      const noCsrf = await b.post(`${env.base}/1/da`, { __ps: fields.__ps, da: 'hitung', a: '0', P1_A: '1' });
      assert.equal(noCsrf.statusCode, 403);
      assert.match(JSON.parse(noCsrf.body).error, /kedaluwarsa/);
      const forged = await call(b, { ...fields, __ps: fields.__ps.replace(/^[^.]+/, Buffer.from(JSON.stringify({ i: ['P1_A'], b: [], d: ['rahasia'] })).toString('base64url')) },
         { da: 'rahasia', a: '0' });
      assert.equal(forged.statusCode, 403);
      const stranger = new Browser(env);
      const anon = await stranger.post(`${env.base}/1/da`, { __csrf: fields.__csrf, __ps: fields.__ps, da: 'hitung', a: '0' });
      assert.equal(anon.statusCode, 401);
      assert.equal(await departemen('DA 1'), 0);
   });
});
