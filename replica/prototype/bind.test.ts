import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { translateBinds, wrapDoBlock } from './bind.ts';

test('sql: positional params, same name reuses $n, case-insensitive', () => {
   const r = translateBinds('select * from emp where deptno = :p2_dept and (:P2_DEPT is null or mgr = :P2_MGR)', 'sql');
   assert.equal(r.text, 'select * from emp where deptno = $1 and ($1 is null or mgr = $2)');
   assert.deepEqual(r.names, ['P2_DEPT', 'P2_MGR']);
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
   const r = translateBinds("l_x := :P2_SAL * 2; update emp set sal = l_x where empno = :p2_empno;", 'plpgsql');
   assert.equal(r.text, "l_x := rpx_rt.v('P2_SAL') * 2; update emp set sal = l_x where empno = rpx_rt.v('P2_EMPNO');");
});

test('wrapDoBlock picks a tag absent from the body', () => {
   const d = wrapDoBlock("perform 1; -- contains $rpx$");
   assert.ok(d.startsWith('do $rpx0$'));
});

test('end-to-end against PostgreSQL', async () => {
   const c = new pg.Client({ host: '/tmp/pg', user: 'postgres', database: 'rpx_test' });
   await c.connect();
   try {
      const state: Record<string, string | null> = { P2_EMPNO: '7499', P2_MIN: '1000' };

      // report query: binds -> $n, values from session state, run as workspace role
      const q = translateBinds('select ename from emp where sal > :P2_MIN::numeric and empno = :p2_empno::int', 'sql');
      await c.query('begin');
      await c.query('set local role ws_kdk');
      await c.query('set local search_path = kdk_app');
      const rows = await c.query(q.text, q.names.map(n => state[n] ?? null));
      assert.deepEqual(rows.rows, [{ ename: 'ALLEN' }]);

      // page process: binds -> v(), items written back via set_item()
      await c.query('select rpx_rt.ctx_init($1, $2, $3, $4)', [JSON.stringify(state), 'IWAN', 'emp', 's1']);
      const body = translateBinds(
         "update emp set sal = sal + 100 where empno = :P2_EMPNO::int;\n"
       + "perform rpx_rt.set_item('P2_NEW_SAL', (select sal::text from emp where empno = :P2_EMPNO::int));", 'plpgsql');
      await c.query(wrapDoBlock(body.text));
      const back = await c.query('select rpx_rt.ctx_items() as items');
      assert.equal(back.rows[0].items.P2_NEW_SAL, '1700');
      await c.query('rollback');
   } finally {
      await c.end();
   }
});
