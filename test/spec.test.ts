import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSpec, SpecError } from '../src/spec/import.ts';

const example = readFileSync(join(import.meta.dirname, '../examples/emp/app.yaml'), 'utf8');

function problems(yaml: string): string[] {
   try {
      parseSpec(yaml);
      return [];
   } catch (e) {
      if (e instanceof SpecError) return e.problems;
      throw e;
   }
}

test('the example spec is valid', () => {
   const spec = parseSpec(example);
   assert.equal(spec.app, 'emp');
   assert.equal(spec.pages.length, 3);
});

test('schema errors: unknown keys and bad item names', () => {
   const p = problems(`app: x\nname: X\nparsing_schema: s\npages:\n  - page: 1\n    name: A\n    colour: red\n    regions:\n      - { static_id: r, type: form, source: { table: t }, items: [ { name: p1_lower, type: text } ] }\n`);
   assert.ok(p.some(m => m.includes('additional properties')), p.join('\n'));
   assert.ok(p.some(m => m.includes('pattern')), p.join('\n'));
});

test('semantic errors: duplicate items, missing pk, broken links, wrong page prefix', () => {
   const yaml = `
app: x
name: X
parsing_schema: s
pages:
  - page: 1
    name: A
    regions:
      - static_id: rep
        type: classic_report
        source: { sql: "select 1 as id" }
        columns: [ { name: ID, link: { page: 9, items: { P9_ID: "#ID#" } } } ]
      - static_id: f
        type: form
        source: { table: t }
        items:
          - { name: P1_A, type: text, source: { column: a } }
          - { name: P2_B, type: text, source: { column: b } }
  - page: 2
    name: B
    regions:
      - { static_id: s, type: static, source: { html: "x" }, items: [ { name: P1_A, type: text } ] }
`;
   const p = problems(yaml).join('\n');
   assert.match(p, /form needs an item with source.pk/);
   assert.match(p, /target page 9 does not exist/);
   assert.match(p, /item P1_A: name is used twice/);
   assert.match(p, /item P2_B: page items must be named P1_/);
});
