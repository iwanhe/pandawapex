import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { explain } from '../src/cli/errors.ts';

// CLI errors say what to do (the Windows "localhost" case used to print only "error:").

test('a refused connection, also as an AggregateError with an empty message', async () => {
   const url = 'postgres://postgres@localhost:5499/rpx';
   const c = new pg.Client({ connectionString: url });
   const e = await c.connect().then(() => null, x => x);
   assert.match(explain(e, url), /PostgreSQL tidak bisa dihubungi di localhost:5499\. Nyalakan dulu/);
   const agg = Object.assign(new AggregateError([Object.assign(new Error('connect ECONNREFUSED ::1:5432'), { code: 'ECONNREFUSED' })], ''), { code: 'ECONNREFUSED' });
   assert.match(explain(agg, 'postgres://postgres@localhost:5432/rpx'), /localhost:5432/);
   const inner = new AggregateError([Object.assign(new Error('x'), { code: 'ECONNREFUSED' })], '');
   assert.match(explain(inner, 'postgres://postgres@localhost:5432/rpx'), /tidak bisa dihubungi/);
});

test('missing database, wrong password, anything else', () => {
   assert.match(explain(Object.assign(new Error('database "rpx" does not exist'), { code: '3D000' }), 'postgres://postgres@localhost/rpx'), /database "rpx" belum ada\. Buat dulu/);
   assert.match(explain(Object.assign(new Error('password authentication failed'), { code: '28P01' })), /menolak login/);
   assert.equal(explain(new Error('missing --ws')), 'error: missing --ws');
   assert.equal(explain(new AggregateError([], '')), 'error: AggregateError');
});
