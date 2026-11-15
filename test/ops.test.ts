import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { addDeveloper } from '../src/cli/commands.ts';
import { backup, pgEnv, pgTool, restore, withDatabase } from '../src/cli/backup.ts';
import { createPool } from '../src/engine/db.ts';
import { purgeSessions, startMaintenance } from '../src/engine/maintenance.ts';
import { buildServer, redactUrl } from '../src/engine/server.ts';
import { Browser, field, formFields, links, setup, setupPilotEnv, type Env } from './helpers.ts';

// Operations: session clean-up, access log without URL argument values, keep-alive, backup and restore.

const PW = 'rahasia-123';
const ADMIN_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost/postgres?host=/tmp/pg';

async function devLogin(env: Env, b = new Browser(env)) {
   const page = await b.get('/builder/login');
   await b.post('/builder/login', { __csrf: field(page.body, '__csrf')!, workspace: env.ws, username: 'admin', password: PW, return: '/builder' });
   return b;
}

describe('session clean-up', () => {
   let env: Env;
   before(async () => { env = await setup(); await addDeveloper(env.pool, env.ws, 'admin', PW); });
   after(() => env?.close());

   test('expired and idle sessions go, with their state; live sessions keep working', async () => {
      const live = new Browser(env), old = new Browser(env), idle = new Browser(env);
      for (const b of [live, old, idle]) { await b.login(); await b.open(`${env.base}/1?daftar__q=agus`); }
      const id = (b: Browser) => b.cookies.get(`rpx_${env.ws}_emp`)!;
      await env.pool.query(`update rpx.sessions set expires_at = now() - interval '1 minute' where id = $1`, [id(old)]);
      await env.pool.query(`update rpx.sessions set last_seen_at = now() - interval '61 minutes' where id = $1`, [id(idle)]);   // app idle timeout: 1 hour
      const devLive = await devLogin(env), devOld = await devLogin(env), devIdle = await devLogin(env);
      await env.pool.query(`update rpx.dev_sessions set expires_at = now() - interval '1 minute' where id = $1`, [devOld.cookies.get('rpx_dev')]);
      await env.pool.query(`update rpx.dev_sessions set last_seen_at = now() - interval '61 minutes' where id = $1`, [devIdle.cookies.get('rpx_dev')]);
      const stateBefore = (await env.pool.query('select count(distinct session_id)::int as n from rpx.session_state')).rows[0].n;
      assert.ok(stateBefore >= 3);

      const r = await purgeSessions(env.pool);
      assert.ok(r);
      assert.equal(r.appSessions, 2);
      assert.equal(r.devSessions, 2);
      const left = (await env.pool.query('select id from rpx.sessions')).rows.map(x => x.id);
      assert.ok(left.includes(id(live)));
      assert.ok(!left.includes(id(old)) && !left.includes(id(idle)));
      assert.equal((await env.pool.query('select count(*)::int as n from rpx.session_state where session_id = any($1)', [[id(old), id(idle)]])).rows[0].n, 0, 'state went with the session');
      assert.equal((await env.pool.query('select count(*)::int as n from rpx.dev_sessions')).rows[0].n, 1);

      const page = await live.open(`${env.base}/1`);
      assert.equal(page.statusCode, 200);
      assert.match(page.body, /value="agus"/, 'the live session kept its state');
      assert.equal((await devLive.get('/builder')).statusCode, 200);
      assert.deepEqual(await purgeSessions(env.pool), { appSessions: 0, devSessions: 0 }, 'nothing left to remove');
   });

   test('only one purge runs at a time; a failing purge does not throw into the server', async () => {
      const c = await env.pool.connect();
      try {
         await c.query(`select pg_advisory_lock(hashtext('rpx.maintenance'))`);
         assert.equal(await purgeSessions(env.pool), null);
      } finally {
         await c.query(`select pg_advisory_unlock(hashtext('rpx.maintenance'))`);
         c.release();
      }
      const errors: string[] = [];
      const dead = createPool('postgres://nobody@127.0.0.1:1/none');
      const stop = startMaintenance(dead, { info: () => {}, error: (_o, m) => errors.push(m) }, 0.0001);
      await new Promise(r => setTimeout(r, 300));
      stop();
      await dead.end();
      assert.ok(errors.length >= 1 && errors.every(m => m === 'session purge failed'));
      assert.equal(typeof startMaintenance(env.pool, { info: () => {}, error: () => {} }, 0), 'function', '0 minutes: switched off');
   });
});

describe('access log', () => {
   let env: Env;
   const lines: string[] = [];
   before(async () => { env = await setup(undefined, { logger: { stream: { write: (l: string) => { lines.push(l); } } } }); });
   after(() => env?.close());

   test('redactUrl keeps the path and argument names only', () => {
      assert.equal(redactUrl('/r/x/emp/1'), '/r/x/emp/1');
      assert.equal(redactUrl('/r/x/emp/2?P2_EMPNO=7839&cs=ab12'), '/r/x/emp/2?P2_EMPNO=*&cs=*');
      assert.equal(redactUrl('/r/x/emp/oidc/callback?code=s3cr3t&state=abc'), '/r/x/emp/oidc/callback?code=*&state=*');
      assert.equal(redactUrl('/builder/apps?q=gaji%20direksi'), '/builder/apps?q=*');
      assert.equal(redactUrl('/x?'), '/x');
      assert.equal(redactUrl('/x?a&b=1=2&&c='), '/x?a=*&b=*&c=*');
   });

   test('values of URL arguments never reach the log; paths and status codes do', async () => {
      const b = new Browser(env);
      await b.login();
      const report = await b.open(`${env.base}/1?P1_CARI=rahasia-dapur`);
      await b.open(links(report.body)[0] ?? `${env.base}/1`);
      await env.app.inject({ method: 'GET', url: `${env.base}/oidc/callback?code=kode-sekali-pakai&state=xyz` });
      await env.app.inject({ method: 'GET', url: '/builder/apps?q=pencarian-pribadi' });
      const log = lines.join('');
      assert.match(log, /"url":"\/r\/[^"]+\/emp\/1\?P1_CARI=\*"/);
      assert.match(log, /"statusCode":200/);
      for (const secret of ['rahasia-dapur', 'kode-sekali-pakai', 'pencarian-pribadi', PW]) assert.doesNotMatch(log, new RegExp(secret), secret);
      assert.doesNotMatch(log, /cs=[0-9a-f]{6}/, 'no checksum values');
      assert.doesNotMatch(log, /P2_EMPNO=\d/);
   });
});

describe('keep-alive', () => {
   let env: Env;
   before(async () => { env = await setup(); await addDeveloper(env.pool, env.ws, 'admin', PW); });
   after(() => env?.close());

   test('application session: activity moves the idle clock; no session and idle sessions get 401', async () => {
      const b = new Browser(env);
      assert.equal((await b.get(`${env.base}/keepalive`)).statusCode, 401);
      assert.equal(b.cookies.size, 0, 'no session is created by asking');
      await b.login();
      const sid = b.cookies.get(`rpx_${env.ws}_emp`)!;
      await env.pool.query(`update rpx.sessions set last_seen_at = now() - interval '50 minutes' where id = $1`, [sid]);
      const r = await b.get(`${env.base}/keepalive`);
      assert.equal(r.statusCode, 204);
      assert.equal(r.body, '');
      assert.match(String(r.headers['cache-control']), /no-store/);
      const age = (await env.pool.query(`select extract(epoch from now() - last_seen_at) as s from rpx.sessions where id = $1`, [sid])).rows[0].s;
      assert.ok(Number(age) < 5, 'last_seen_at refreshed');
      // the absolute lifetime is not extended
      const exp = () => env.pool.query(`select expires_at from rpx.sessions where id = $1`, [sid]).then(x => String(x.rows[0].expires_at));
      const before = await exp();
      await b.get(`${env.base}/keepalive`);
      assert.equal(await exp(), before);
      await env.pool.query(`update rpx.sessions set last_seen_at = now() - interval '61 minutes' where id = $1`, [sid]);
      assert.equal((await b.get(`${env.base}/keepalive`)).statusCode, 401, 'too late: already idle');
      assert.equal((await new Browser(env).get('/r/nope/emp/keepalive')).statusCode, 404);
   });

   test('developer session', async () => {
      assert.equal((await new Browser(env).get('/builder/keepalive')).statusCode, 401);
      const dev = await devLogin(env);
      const sid = dev.cookies.get('rpx_dev')!;
      await env.pool.query(`update rpx.dev_sessions set last_seen_at = now() - interval '50 minutes' where id = $1`, [sid]);
      assert.equal((await dev.get('/builder/keepalive')).statusCode, 204);
      assert.equal((await dev.get('/builder')).statusCode, 200);
      await env.pool.query(`update rpx.dev_sessions set last_seen_at = now() - interval '61 minutes' where id = $1`, [sid]);
      assert.equal((await dev.get('/builder/keepalive')).statusCode, 401);
   });
});

// pg_dump and pg_restore must be installed and at least as new as the server. Locally the test is skipped without
// them; in CI a missing tool is a failure, so that this never goes untested unnoticed.
function toolsReady(): string | null {
   try {
      const v = (t: 'pg_dump' | 'pg_restore') => Number(/(\d+)\./.exec(execFileSync(pgTool(t), ['--version'], { encoding: 'utf8' }))![1]);
      const [d, r] = [v('pg_dump'), v('pg_restore')];
      return d >= 14 && r >= 14 ? null : `pg_dump ${d} / pg_restore ${r} too old`;
   } catch (e) {
      return `pg_dump / pg_restore not found (${(e as Error).message})`;
   }
}
const missing = toolsReady();
if (missing && process.env.CI) throw new Error(`backup tests cannot run in CI: ${missing}`);

describe('backup and restore', { skip: missing ?? false }, () => {
   const dir = mkdtempSync(join(tmpdir(), 'rpx-backup-'));
   const made: string[] = [];           // databases to drop afterwards
   const admin = async <T>(fn: (c: pg.Client) => Promise<T>): Promise<T> => {
      const c = new pg.Client({ connectionString: ADMIN_URL });
      await c.connect();
      try { return await fn(c); } finally { await c.end(); }
   };
   const urlOf = (db: string) => { const u = new URL(ADMIN_URL); u.pathname = `/${db}`; return u.toString(); };
   const dbOf = async (pool: pg.Pool) => (await pool.query('select current_database() as d')).rows[0].d as string;
   after(async () => {
      rmSync(dir, { recursive: true, force: true });
      await admin(async c => { for (const d of made) await c.query(`drop database if exists ${d} with (force)`); });
   });

   test('pgEnv passes the connection to the pg tools without the password on the command line', () => {
      const e = pgEnv('postgres://adi:s%40ndi%2F1@db.example:6543/rpx?sslmode=verify-full');
      assert.deepEqual([e.PGHOST, e.PGPORT, e.PGUSER, e.PGPASSWORD, e.PGDATABASE, e.PGSSLMODE], ['db.example', '6543', 'adi', 's@ndi/1', 'rpx', 'verify-full']);
      // the socket form from docs/install-lokal.md (not a valid WHATWG URL, but pg accepts it)
      const s = pgEnv('postgres://iwan@/rpx?host=/var/run/postgresql');
      assert.deepEqual([s.PGHOST, s.PGUSER, s.PGPASSWORD, s.PGDATABASE], ['/var/run/postgresql', 'iwan', undefined, 'rpx']);
      assert.equal(withDatabase('postgres://iwan@/rpx?host=/var/run/postgresql', 'rpx_restore'), 'postgres://iwan@/rpx_restore?host=/var/run/postgresql');
      assert.equal(withDatabase('postgres://u:p@db:6543/rpx?sslmode=require', 'x'), 'postgres://u:p@db:6543/x?sslmode=require');
      assert.equal(withDatabase('postgres://u@db', 'x'), 'postgres://u@db/x');
   });

   test('after losing the database and the workspace role, a restore brings back a working application', async () => {
      const env = await setup();
      await addDeveloper(env.pool, env.ws, 'admin', PW);
      const b = new Browser(env);
      await b.login();
      await env.pool.query(`update ${env.schema}.karyawan set jabatan = 'Sebelum backup' where nama = 'Agus Prasetyo'`);
      const db = await dbOf(env.pool);
      const counts = async (p: pg.Pool) => (await p.query(
         `select (select count(*) from ${env.schema}.karyawan)::int as karyawan, (select count(*) from rpx.pages)::int as pages
               , (select count(*) from rpx.app_versions)::int as versions, (select count(*) from rpx.sessions)::int as sessions`)).rows[0];
      const before = await counts(env.pool);
      assert.ok(before.sessions >= 1);

      const bk = await backup(urlOf(db), dir);
      assert.ok(existsSync(bk.dump) && bk.bytes > 10_000);
      assert.ok(!readdirSync(dir).some(f => f.endsWith('.partial')));
      const roles = readFileSync(bk.roles, 'utf8');
      for (const r of [`ws_${env.ws}`, 'rpx_engine', 'rpx_user_code']) assert.match(roles, new RegExp(`create role "${r}"`), r);
      assert.match(roles, new RegExp(`grant "ws_${env.ws}" to "rpx_engine";`));
      assert.doesNotMatch(roles, /superuser|createrole|createdb/i);
      assert.doesNotMatch(roles, /create role "postgres"/);

      // the disaster: database gone, workspace role gone (as on a new server)
      await env.app.close();
      await env.pool.end();
      await admin(async c => {
         await c.query(`drop database ${db} with (force)`);
         await c.query(`drop role ws_${env.ws}`);
      });

      const target = `${db}_r`;
      made.push(target);
      const log: string[] = [];
      const r = await restore(ADMIN_URL, bk.dump, target, m => log.push(m));
      assert.deepEqual(r.rolesCreated, [`ws_${env.ws}`]);
      assert.deepEqual([r.workspaces, r.applications, r.appUsers, r.developers], [1, 1, 2, 1]);
      assert.deepEqual(r.migrations, []);

      const pool = createPool(urlOf(target));
      const app = buildServer({ pool, secret: 'y'.repeat(40), loginRateLimit: 1000 });
      await app.ready();
      try {
         assert.deepEqual(await counts(pool), { ...before, sessions: 0 }, 'everything but the sessions');
         const restored = { ...env, pool, app } as Env;
         // an old cookie is worthless; users sign in again with the same password
         const stale = new Browser(restored);
         stale.cookies = new Map(b.cookies);
         assert.equal((await stale.get(`${env.base}/1`)).statusCode, 303);
         const u = new Browser(restored);
         await u.login();
         const report = await u.open(`${env.base}/1`);
         assert.equal(report.statusCode, 200);
         assert.match(report.body, /Sebelum backup/);
         // writing as the workspace role proves the grants came back with the role
         const blank = await u.open(links(report.body, 'r-btn r-btn--primary')[0]!);
         const ins = await u.post(`${env.base}/2`, { ...formFields(blank.body), P2_NAMA: 'Setelah restore', P2_DEPTNO: '4', P2_TGL_MASUK: '2026-11-02', P2_GAJI: '5000000', P2_AKTIF: 'Y', REQUEST: 'SIMPAN' });
         assert.equal(ins.statusCode, 303, ins.body.slice(0, 400));
         assert.equal((await pool.query(`select count(*)::int as n from ${env.schema}.karyawan where nama = 'Setelah restore'`)).rows[0].n, 1);
         // the builder too: sign in, and the version history is there
         const dev = await devLogin(restored);
         assert.match((await dev.get('/builder/apps/emp')).body, /Riwayat impor/);

         // a restore never writes into a database that has tables
         await assert.rejects(restore(ADMIN_URL, bk.dump, target), /sudah berisi tabel/);
         await assert.rejects(restore(ADMIN_URL, bk.dump, 'Nama-Salah'), /tidak valid/);
         await assert.rejects(restore(ADMIN_URL, join(dir, 'tidak-ada.dump'), `${target}_x`), /tidak ditemukan/);
         writeFileSync(join(dir, 'sendiri.dump'), 'x');
         await assert.rejects(restore(ADMIN_URL, join(dir, 'sendiri.dump'), `${target}_x`), /file role tidak ditemukan/);
         assert.equal(await admin(async c => (await c.query(`select count(*)::int as n from pg_database where datname = $1`, [`${target}_x`])).rows[0].n), 0, 'nothing created on a refused restore');
      } finally {
         await app.close();
         await pool.end();
         await admin(async c => { await c.query(`drop database ${target} with (force)`); await c.query(`drop role if exists ws_${env.ws}`); });
      }
   });

   test('a pg_restore newer than the server (unknown settings) still restores; any other error fails and cleans up', { skip: process.platform === 'win32' }, async () => {
      // Stand-in for pg_restore 17 against PostgreSQL 16: it sets transaction_timeout, which 16 does not know. With
      // --single-transaction that aborts everything; without it the error is reported at the end and the exit code is 1.
      const real = execFileSync('sh', ['-c', 'command -v pg_restore'], { encoding: 'utf8' }).trim();
      const bin = mkdtempSync(join(tmpdir(), 'rpx-fakepg-'));
      writeFileSync(join(bin, 'pg_restore'), `#!/bin/sh
ERR='pg_restore: error: could not execute query: ERROR:  unrecognized configuration parameter "transaction_timeout"
Command was: SET transaction_timeout = 0;'
for a in "$@"; do [ "$a" = "--single-transaction" ] && { echo "$ERR" >&2; exit 1; }; done
${real} "$@" || exit $?
echo "$ERR" >&2
[ -n "$FAKE_EXTRA_ERROR" ] && echo 'pg_restore: error: could not execute query: ERROR:  relation "x" does not exist' >&2
echo 'pg_restore: warning: errors ignored on restore: 1' >&2
exit 1
`);
      chmodSync(join(bin, 'pg_restore'), 0o755);
      const env = await setup();
      const savedBin = process.env.PGBIN;
      try {
         const db = await dbOf(env.pool);
         const bk = await backup(urlOf(db), dir);
         process.env.PGBIN = bin;
         const target = `${db}_n`;
         made.push(target);
         const r = await restore(ADMIN_URL, bk.dump, target);
         assert.deepEqual([r.workspaces, r.applications, r.appUsers], [1, 1, 2]);
         const pool = createPool(urlOf(target));
         try {
            assert.equal((await pool.query(`select count(*)::int as n from ${env.schema}.karyawan`)).rows[0].n,
               (await env.pool.query(`select count(*)::int as n from ${env.schema}.karyawan`)).rows[0].n);
         } finally {
            await pool.end();
         }
         // another error on top: not accepted, and the database this restore created is gone again
         process.env.FAKE_EXTRA_ERROR = '1';
         await assert.rejects(restore(ADMIN_URL, bk.dump, `${db}_x`), /relation "x" does not exist/);
         assert.equal(await admin(async c => (await c.query('select count(*)::int as n from pg_database where datname = $1', [`${db}_x`])).rows[0].n), 0);
         // into a database that existed (empty): it is left as it is, and the message says what to do
         await admin(c => c.query(`create database ${db}_y`));
         made.push(`${db}_y`);
         await assert.rejects(restore(ADMIN_URL, bk.dump, `${db}_y`), /berisi sebagian data/);
      } finally {
         delete process.env.FAKE_EXTRA_ERROR;
         if (savedBin === undefined) delete process.env.PGBIN; else process.env.PGBIN = savedBin;
         rmSync(bin, { recursive: true, force: true });
         await env.close();
      }
   });

   test('the pilot application (five schemas, functions, triggers, views) survives a round trip; --keep prunes old backups', async () => {
      const env = await setupPilotEnv();
      try {
         const db = await dbOf(env.pool);
         const objects = (p: pg.Pool) => p.query(
            `select (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname like 'apx_demo%')::int as functions
                  , (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'apx_demo' and not t.tgisinternal)::int as triggers
                  , (select count(*) from pg_views where schemaname = 'apx_demo')::int as views
                  , (select count(*) from apx_demo.apx_demo_requests)::int as requests`).then(r => r.rows[0]);
         const before = await objects(env.pool);
         assert.ok(before.functions > 10 && before.triggers >= 5 && before.views >= 5);

         const first = await backup(urlOf(db), dir);
         await new Promise(r => setTimeout(r, 1100));        // file names are per second
         const second = await backup(urlOf(db), dir, { keep: 1 });
         assert.deepEqual(second.removed.map(f => join(dir, f)), [first.dump]);
         assert.ok(!existsSync(first.dump) && !existsSync(first.roles) && existsSync(second.dump) && existsSync(second.roles));
         await assert.rejects(backup(urlOf(db), dir, { keep: 0 }), /--keep/);
         await assert.rejects(backup(ADMIN_URL, dir), /tidak berisi pandawapex/);

         const target = `${db}_r`;
         made.push(target);
         const r = await restore(ADMIN_URL, second.dump, target);
         assert.deepEqual(r.rolesCreated, [], 'same server: the roles are still there and are left alone');
         const pool = createPool(urlOf(target));
         const app = buildServer({ pool, secret: 'y'.repeat(40), loginRateLimit: 1000 });
         await app.ready();
         try {
            assert.deepEqual(await objects(pool), before);
            const u = new Browser({ ...env, pool, app } as Env);
            await u.login('budi');
            const home = await u.open(env.base);
            assert.equal(home.statusCode, 200, home.body.slice(0, 300));
         } finally {
            await app.close();
            await pool.end();
         }
      } finally {
         await env.close();
      }
   });
});
