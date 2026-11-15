import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { addDeveloper } from '../src/cli/commands.ts';
import { createPool } from '../src/engine/db.ts';
import { buildServer, parseBuilderHosts, parseTrustProxy } from '../src/engine/server.ts';
import { Browser, field, formFields, setup, type Env } from './helpers.ts';

// Public deployment behind Cloudflare Tunnel (docs/cloudflare-local-demo.md): builder only on its own host name,
// the client IP from one trusted proxy hop, and the whole engine (runtime + builder) on the rpx_engine role.

const PW = 'rahasia-123';

describe('deployment options', () => {
   let env: Env;
   before(async () => { env = await setup(); await addDeveloper(env.pool, env.ws, 'admin', PW); });
   after(() => env?.close());

   test('environment values are parsed', () => {
      assert.equal(parseTrustProxy(undefined), undefined);
      assert.equal(parseTrustProxy('true'), true);
      assert.equal(parseTrustProxy('false'), false);
      assert.equal(parseTrustProxy('0'), false);
      assert.equal(parseTrustProxy(' 1 '), 1);
      assert.equal(parseTrustProxy('127.0.0.1,172.16.0.0/12'), '127.0.0.1,172.16.0.0/12');
      assert.equal(parseBuilderHosts(''), undefined);
      assert.deepEqual(parseBuilderHosts('none'), []);
      assert.deepEqual(parseBuilderHosts('Builder.Example.com, localhost:8080'), ['builder.example.com', 'localhost']);
   });

   test('RPX_BUILDER_HOSTS: the builder answers only on the listed host names', async () => {
      const app = buildServer({ pool: env.pool, secret: 'x'.repeat(40), builderHosts: ['builder.example.com'] });
      await app.ready();
      try {
         const get = (url: string, headers: Record<string, string>) => app.inject({ method: 'GET', url, headers });
         assert.equal((await get('/builder/login', { host: 'builder.example.com' })).statusCode, 200);
         assert.equal((await get('/builder/login', { host: 'builder.example.com:443' })).statusCode, 200);
         for (const url of ['/builder', '/builder/', '/builder/login', '/builder?x=1', '/builder/apps/emp']) {
            const r = await get(url, { host: 'demo.example.com' });
            assert.equal(r.statusCode, 404, url);
            assert.doesNotMatch(r.body, /\/builder/, 'no link into the builder either');
         }
         // a header the client can set does not count
         assert.equal((await get('/builder/login', { host: 'demo.example.com', 'x-forwarded-host': 'builder.example.com' })).statusCode, 404);
         const post = await app.inject({ method: 'POST', url: '/builder/login', headers: { host: 'demo.example.com', 'content-type': 'application/x-www-form-urlencoded' }, payload: 'workspace=x' });
         assert.equal(post.statusCode, 404);
         // the applications themselves are on every host
         assert.equal((await get(`${env.base}/login`, { host: 'demo.example.com' })).statusCode, 200);
         assert.equal((await get('/static/rpx.js', { host: 'demo.example.com' })).statusCode, 200);
      } finally {
         await app.close();
      }
      const off = buildServer({ pool: env.pool, secret: 'x'.repeat(40), builderHosts: [] });
      await off.ready();
      try {
         assert.equal((await off.inject({ method: 'GET', url: '/builder/login', headers: { host: 'localhost' } })).statusCode, 404);
      } finally {
         await off.close();
      }
   });

   test('RPX_TRUST_PROXY=1: a client cannot dodge the login rate limit with its own X-Forwarded-For', async () => {
      async function codes(trustProxy: boolean | number) {
         const app = buildServer({ pool: env.pool, secret: 'x'.repeat(40), loginRateLimit: 2, trustProxy });
         await app.ready();
         try {
            const out: number[] = [];
            for (let i = 0; i < 3; i++) {
               // what Cloudflare forwards: the client's own header, then the address it really saw
               const r = await app.inject({ method: 'POST', url: `${env.base}/login`, payload: 'username=a&password=b',
                  headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': `10.0.0.${i}, 203.0.113.7` } });
               out.push(r.statusCode);
            }
            return out;
         } finally {
            await app.close();
         }
      }
      assert.deepEqual(await codes(1), [303, 303, 429]);
      assert.deepEqual(await codes(true), [303, 303, 303], 'trusting every hop believes the forged address (why the tunnel sets 1)');
   });
});

describe('engine on the rpx_engine role (no superuser)', () => {
   let env: Env;
   let engine: ReturnType<typeof createPool>;
   let app: ReturnType<typeof buildServer>;
   before(async () => {
      env = await setup();
      await addDeveloper(env.pool, env.ws, 'admin', PW);
      // same server and database as the test, but as rpx_engine (password set here, as the deployment guide does)
      await env.pool.query(`alter role rpx_engine with login password 'rpx-engine-test-only'`);
      const url = new URL(process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost/postgres?host=/tmp/pg');
      url.username = 'rpx_engine';
      url.password = 'rpx-engine-test-only';
      url.pathname = `/${(await env.pool.query('select current_database() as d')).rows[0].d}`;
      engine = createPool(url.toString());
      assert.equal((await engine.query('select current_user as u, usesuper from pg_user where usename = current_user')).rows[0].usesuper, false);
      app = buildServer({ pool: engine, secret: 'x'.repeat(40), loginRateLimit: 1000 });
      await app.ready();
   });
   after(async () => { await app?.close(); await engine?.end(); await env?.close(); });

   test('builder and runtime work end to end as rpx_engine', async () => {
      const e = { ...env, app } as Env;
      const dev = new Browser(e);
      const lp = await dev.get('/builder/login');
      assert.equal((await dev.post('/builder/login', { __csrf: field(lp.body, '__csrf')!, workspace: env.ws, username: 'admin', password: PW, return: '/builder' })).statusCode, 303);
      // wizard: introspection, generator, import
      const w = await dev.get('/builder/apps/new');
      const made = await dev.post('/builder/apps/new', { __csrf: field(w.body, '__csrf')!, name: 'Uji engine', alias: 'ujieng', schema: env.schema, tables: ['departemen'] });
      assert.equal(made.statusCode, 303, made.body.slice(0, 500));
      // page wizard with a SQL source (describe as the workspace role)
      const pw = await dev.get('/builder/apps/ujieng/pages/new');
      const sqlPage = await dev.post('/builder/apps/ujieng/pages/new', { __csrf: field(pw.body, '__csrf')!, kind: 'report', source: 'sql', sql: 'select deptno, nama from departemen', name: 'Daftar SQL', page: '10', nav: '1' });
      assert.equal(sqlPage.statusCode, 303, sqlPage.body.slice(0, 500));
      // designer save (compare-and-swap under the advisory lock)
      const d = await dev.get('/builder/apps/ujieng/pages/1?node=page');
      const form = formFields(d.body.slice(d.body.indexOf('id="editor-title"') - 400));
      assert.equal((await dev.post('/builder/apps/ujieng/pages/1', { ...form, node: 'page', action: 'save', 'f.title': 'Departemen (engine)' })).statusCode, 303);
      // accounts: an application user made from the builder
      const nu = await dev.get('/builder/users/new');
      assert.equal((await dev.post('/builder/users/new', { __csrf: field(nu.body, '__csrf')!, username: 'rina', email: '', password: 'sandi-panjang-1', confirm: 'sandi-panjang-1' })).statusCode, 303);
      // runtime: the new user logs in, sees the generated report and the SQL page
      const user = new Browser({ ...e, base: `/r/${env.ws}/ujieng` });
      const login = await user.open(`/r/${env.ws}/ujieng/login`);
      await user.post(`/r/${env.ws}/ujieng/login`, { __csrf: field(login.body, '__csrf')!, username: 'rina', password: 'sandi-panjang-1', return: `/r/${env.ws}/ujieng/1` });
      const p1 = await user.open(`/r/${env.ws}/ujieng/1`);
      assert.equal(p1.statusCode, 200);
      assert.match(p1.body, /Departemen \(engine\)/);
      const p10 = await user.open(`/r/${env.ws}/ujieng/10`);
      assert.equal(p10.statusCode, 200);
      assert.match(p10.body, /Gudang/);
   });
});
