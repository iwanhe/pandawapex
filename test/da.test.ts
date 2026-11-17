import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSpec, SpecError } from '../src/spec/import.ts';
import { Browser, formFields, setup, type Env } from './helpers.ts';

// Dynamic actions (DA1): the spec format and its checks, what the page sends to the browser, and the REQUEST
// values a dynamic action may submit. The browser side itself is covered by e2e/da.spec.ts.

const SPEC = `
app: emp
name: Uji DA
parsing_schema: demo_app
pages:
  - page: 1
    name: Uji DA
    regions:
      - static_id: isian
        title: Isian
        type: static
        items:
          - { name: P1_JENIS, type: select, label: Jenis, lov: { static: [ { display: A, return: A }, { display: B, return: B } ] } }
          - { name: P1_CATATAN, type: text, label: Catatan }
          - { name: P1_HASIL, type: display_only, label: Hasil }
        buttons:
          - { name: HITUNG, label: Hitung, action: defined_by_da }
          - { name: RAHASIA, label: Rahasia, action: defined_by_da, condition: { never: true } }
          - { name: SIMPAN, label: Simpan, hot: true }
    dynamic_actions:
      - name: jenis_b
        event: change
        items: [P1_JENIS]
        when: { item_equals: { item: P1_JENIS, value: B } }
        actions:
          - { action: hide, items: [P1_CATATAN] }
          - { action: confirm, message: "Yakin </script><b>?" }
        else:
          - { action: show, items: [P1_CATATAN] }
      - { name: hitung, event: click, button: HITUNG, actions: [ { action: submit_page } ] }
      - { name: rahasia, event: click, button: RAHASIA, actions: [ { action: submit_page } ] }
      - { name: catat, event: change, items: [P1_CATATAN], actions: [ { action: submit_page, request: CATAT } ] }
    processes:
      - { name: hitung, type: plpgsql, when_button: HITUNG, code: "perform rpx_rt.set_item('P1_HASIL', 'dihitung');" }
      - { name: catat, type: plpgsql, condition: { request_equals: CATAT }, code: "perform rpx_rt.set_item('P1_HASIL', 'dicatat ' || :P1_CATATAN);" }
    branches:
      - { page: 1 }
`;

describe('dynamic actions: spec checks', () => {
   /** the spec with its dynamic_actions replaced (and buttons extended) */
   const variant = (das: string, extraButtons = '') => SPEC
      .replace(/    dynamic_actions:\n[\s\S]*?\n    processes:/, `    dynamic_actions:\n${das}\n    processes:`)
      .replace('          - { name: SIMPAN, label: Simpan, hot: true }', `          - { name: SIMPAN, label: Simpan, hot: true }${extraButtons}`);
   const problems = (text: string) => {
      try { parseSpec(text); } catch (e) { if (e instanceof SpecError) return e.problems.join('\n'); throw e; }
      return '';
   };

   test('the test spec itself is valid', () => assert.equal(problems(SPEC), ''));

   const cases: [string, string, RegExp][] = [
      ['duplicate names', `      - { name: a, event: page_load, actions: [ { action: hide, items: [P1_CATATAN] } ] }
      - { name: a, event: page_load, actions: [ { action: show, items: [P1_CATATAN] } ] }`, /dynamic action "a": duplicate name/],
      ['change without items', `      - { name: a, event: change, actions: [ { action: hide, items: [P1_CATATAN] } ] }`, /event change needs items/],
      ['unknown item', `      - { name: a, event: change, items: [P9_X], actions: [ { action: hide, items: [P1_CATATAN] } ] }`, /item P9_X is not an item on page 1/],
      ['click on a submit button', `      - { name: a, event: click, button: SIMPAN, actions: [ { action: hide, items: [P1_CATATAN] } ] }`, /button SIMPAN must have action defined_by_da/],
      ['click without button', `      - { name: a, event: click, actions: [ { action: hide, items: [P1_CATATAN] } ] }`, /event click needs button/],
      ['no actions', `      - { name: a, event: page_load }`, /needs actions/],
      ['else without when', `      - { name: a, event: page_load, actions: [ { action: hide, items: [P1_CATATAN] } ], else: [ { action: show, items: [P1_CATATAN] } ] }`, /else only applies with a when condition/],
      ['set_value on display_only', `      - { name: a, event: page_load, actions: [ { action: set_value, items: [P1_HASIL], value: x } ] }`, /item P1_HASIL \(display_only\) cannot be changed/],
      ['set_value without a value', `      - { name: a, event: page_load, actions: [ { action: set_value, items: [P1_CATATAN] } ] }`, /needs exactly one of value or from_item/],
      ['enable a region', `      - { name: a, event: page_load, actions: [ { action: enable, regions: [isian] } ] }`, /enable: does not take regions/],
      ['refresh unknown region', `      - { name: a, event: change, items: [P1_JENIS], actions: [ { action: refresh, regions: [lain] } ] }`, /region lain is not a region on page 1/],
      ['confirm without message', `      - { name: a, event: change, items: [P1_JENIS], actions: [ { action: confirm } ] }`, /confirm: needs message/],
      ['submit without request', `      - { name: a, event: change, items: [P1_JENIS], actions: [ { action: submit_page } ] }`, /submit_page: needs request/],
      ['submit as another button', `      - { name: a, event: change, items: [P1_JENIS], actions: [ { action: submit_page, request: SIMPAN } ] }`, /request SIMPAN is the name of another button/],
      ['submit on page load', `      - { name: a, event: page_load, actions: [ { action: submit_page, request: X } ] }`, /page_load action cannot submit_page or confirm/],
      ['on_load on refresh', `      - { name: a, event: change, items: [P1_JENIS], actions: [ { action: refresh, regions: [isian], on_load: true } ] }`, /on_load only applies to/],
      ['message on hide', `      - { name: a, event: page_load, actions: [ { action: hide, items: [P1_CATATAN], message: x } ] }`, /message only applies to confirm/],
   ];
   for (const [name, das, expected] of cases) {
      test(`rejects: ${name}`, () => assert.match(problems(variant(das)), expected));
   }
   test('defined_by_da buttons take no target or confirm', () => {
      assert.match(problems(variant('      - { name: hitung, event: click, button: HITUNG, actions: [ { action: submit_page } ] }',
         '\n          - { name: X, label: X, action: defined_by_da, confirm: Yakin? }')), /button X: a defined_by_da button has no target or confirm/);
   });
   test('the schema rejects unknown actions and javascript', () => {
      assert.throws(() => parseSpec(variant('      - { name: a, event: page_load, actions: [ { action: execute_js, code: "alert(1)" } ] }')), SpecError);
   });
});

describe('dynamic actions: render and submit', () => {
   let env: Env;
   before(async () => { env = await setup(SPEC); });
   after(async () => { await env?.close(); });

   const daJson = (body: string) => {
      const m = /<script type="application\/json" id="rpx-da">([^<]*)<\/script>/.exec(body);
      assert.ok(m, 'the page carries its dynamic actions');
      return JSON.parse(m[1]) as { name: string; event: string; actions: { action: string; message?: string; request?: string }[] }[];
   };

   test('the page sends its dynamic actions as JSON, without click actions of buttons it did not render', async () => {
      const b = new Browser(env);
      await b.login();
      const p = await b.open(`${env.base}/1`);
      assert.equal(p.statusCode, 200);
      const das = daJson(p.body);
      assert.deepEqual(das.map(d => d.name), ['jenis_b', 'hitung', 'catat']);
      assert.equal(das[0].actions[1].message, 'Yakin </script><b>?', 'the text survives');
      assert.match(p.body, /\\u003c\/script>\\u003cb>/, 'and cannot end the script element');
      assert.equal(das[1].actions[0].request, 'HITUNG', 'submit_page defaults to the clicked button');
      assert.match(p.body, /<button type="button" class="r-btn" data-button="HITUNG">Hitung<\/button>/);
      assert.doesNotMatch(p.body, /data-button="RAHASIA"/);
      assert.match(p.body, /<button type="submit" class="r-btn r-btn--primary" name="REQUEST" value="SIMPAN" data-button="SIMPAN">/);
   });

   test('a page without dynamic actions has no DA block', async () => {
      const other = await setup();
      try {
         const b = new Browser(other);
         await b.login();
         const p = await b.open(`${other.base}/1`);
         assert.doesNotMatch(p.body, /id="rpx-da"/);
         const p4 = await b.open(`${other.base}/4`);
         assert.deepEqual(daJson(p4.body).map(d => d.name), ['kosongkan_isian'], 'the example app uses them on page 4');
      } finally {
         await other.close();
      }
   });

   test('a dynamic action may submit its button name or its own REQUEST; processes see it', async () => {
      const b = new Browser(env);
      await b.login();
      let p = await b.open(`${env.base}/1`);
      let r = await b.post(`${env.base}/1`, { ...formFields(p.body), REQUEST: 'HITUNG' });
      assert.equal(r.statusCode, 303);
      p = await b.open(`${env.base}/1`);
      assert.match(p.body, /<div class="r-display" id="P1_HASIL">dihitung<\/div>/);
      r = await b.post(`${env.base}/1`, { ...formFields(p.body), P1_CATATAN: 'ok', REQUEST: 'CATAT' });
      assert.equal(r.statusCode, 303);
      p = await b.open(`${env.base}/1`);
      assert.match(p.body, /<div class="r-display" id="P1_HASIL">dicatat ok<\/div>/);
   });

   test('the REQUEST of a dynamic action whose button was not rendered is refused', async () => {
      const b = new Browser(env);
      await b.login();
      const p = await b.open(`${env.base}/1`);
      const r = await b.post(`${env.base}/1`, { ...formFields(p.body), REQUEST: 'RAHASIA' });
      assert.equal(r.statusCode, 400);
   });
});
