import { test } from 'node:test';
import assert from 'node:assert/strict';
import { translateBinds, wrapDoBlock } from '../src/engine/bind.ts';

test('sql: positional params, same name reuses $n, case-insensitive', () => {
   const r = translateBinds('select * from emp where deptno = :p2_dept and (:P2_DEPT is null or mgr = :P2_MGR)', 'sql');
   assert.equal(r.text, 'select * from emp where deptno = $1 and ($1 is null or mgr = $2)');
   assert.deepEqual(r.names, ['P2_DEPT', 'P2_MGR']);
});

test('sql castText: every bind is text, user casts still apply', () => {
   const r = translateBinds("where nama ilike '%' || :P1_CARI || '%' and gaji > :P1_MIN::numeric", 'sql', { castText: true });
   assert.equal(r.text, "where nama ilike '%' || $1::text || '%' and gaji > $2::text::numeric");
});

test('sql: skips strings, idents, comments, casts, dollar quotes, array slices', () => {
   const src = `select ':NOT_A' , E'it\\'s :NOPE', "col:x", x::text, arr[a:b], $q$ :INSIDE $q$ -- :C1
   /* :C2 /* nested :C3 */ */ from t where id = :P1_ID`;
   const r = translateBinds(src, 'sql');
   assert.deepEqual(r.names, ['P1_ID']);
   assert.ok(r.text.endsWith('where id = $1'));
   assert.ok(r.text.includes("':NOT_A'") && r.text.includes('arr[a:b]') && r.text.includes('x::text'));
});

test('plpgsql: binds become rpx_rt.v(), := untouched', () => {
   const r = translateBinds('l_x := :P2_SAL * 2; update emp set sal = l_x where empno = :p2_empno;', 'plpgsql');
   assert.equal(r.text, "l_x := rpx_rt.v('P2_SAL') * 2; update emp set sal = l_x where empno = rpx_rt.v('P2_EMPNO');");
});

test('wrapDoBlock picks a tag absent from the body and adds begin/end', () => {
   const d = wrapDoBlock('perform 1; -- contains $rpx$');
   assert.ok(d.startsWith('do $rpx0$'));
   assert.match(d, /begin\nperform 1;/);
});
