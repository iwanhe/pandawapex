import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hash } from '@node-rs/argon2';
import type pg from 'pg';
import { quoteIdent, withTx } from '../engine/db.ts';
import { importSpec, type ImportResult } from '../spec/import.ts';

const MIGRATIONS_DIR = join(import.meta.dirname, '../../db/migrations');

/** Apply db/migrations/*.sql in order, each in its own transaction, recorded in rpx.schema_migrations. */
export async function migrate(pool: pg.Pool, log: (m: string) => void = () => {}): Promise<string[]> {
   await pool.query(`create schema if not exists rpx`);
   await pool.query(`create table if not exists rpx.schema_migrations (
                        version    text primary key
                      , applied_at timestamptz not null default now())`);
   const done = new Set((await pool.query('select version from rpx.schema_migrations')).rows.map(r => r.version));
   const files = readdirSync(MIGRATIONS_DIR).filter(f => /^\d{4}_.+\.sql$/.test(f)).sort();
   const applied: string[] = [];
   for (const f of files) {
      if (done.has(f)) continue;
      await withTx(pool, async c => {
         // serialize concurrent migrators
         await c.query('select pg_advisory_xact_lock(7342001)');
         const again = await c.query('select 1 from rpx.schema_migrations where version = $1', [f]);
         if (again.rowCount) return;
         await c.query(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
         await c.query('insert into rpx.schema_migrations (version) values ($1)', [f]);
         applied.push(f);
         log(`applied ${f}`);
      });
   }
   if (!applied.length) log('database is up to date');
   return applied;
}

const WS_NAME = /^[a-z][a-z0-9_]{1,30}$/;
const SCHEMA_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

/**
 * Create a workspace: its NOLOGIN role ws_<name> (member of rpx_user_code, grantable to the engine),
 * its schemas, and grants so developer code can use the tables there (now and in the future).
 */
export async function createWorkspace(pool: pg.Pool, name: string, schemas: string[]): Promise<{ id: string; role: string }> {
   if (!WS_NAME.test(name)) throw new Error(`workspace name must match ${WS_NAME}`);
   if (!schemas.length) throw new Error('at least one --schema is required');
   for (const s of schemas) if (!SCHEMA_NAME.test(s) || s === 'rpx' || s === 'rpx_rt' || s.startsWith('pg_')) throw new Error(`invalid schema name: ${s}`);
   const role = `ws_${name}`;
   return withTx(pool, async c => {
      const exists = await c.query('select 1 from pg_roles where rolname = $1', [role]);
      if (!exists.rowCount) await c.query(`create role ${quoteIdent(role)} nologin in role rpx_user_code`);
      await c.query(`grant ${quoteIdent(role)} to rpx_engine`);
      // the role running the engine in development may be a plain owner role instead of rpx_engine
      await c.query(`do $$ begin
                        if not (select rolsuper from pg_roles where rolname = current_user) then
                           execute format('grant %I to %I', '${role}', current_user);
                        end if;
                     end $$`);
      for (const s of schemas) {
         const q = quoteIdent(s);
         await c.query(`create schema if not exists ${q}`);
         await c.query(`grant usage on schema ${q} to ${quoteIdent(role)}`);
         await c.query(`grant select, insert, update, delete on all tables in schema ${q} to ${quoteIdent(role)}`);
         await c.query(`grant usage, select on all sequences in schema ${q} to ${quoteIdent(role)}`);
         await c.query(`grant execute on all functions in schema ${q} to ${quoteIdent(role)}`);
         await c.query(`alter default privileges in schema ${q} grant select, insert, update, delete on tables to ${quoteIdent(role)}`);
         await c.query(`alter default privileges in schema ${q} grant usage, select on sequences to ${quoteIdent(role)}`);
         await c.query(`alter default privileges in schema ${q} grant execute on functions to ${quoteIdent(role)}`);
      }
      const ws = await c.query(
         `insert into rpx.workspaces (name, db_role) values ($1, $2)
          on conflict (name) do update set db_role = excluded.db_role returning id`, [name, role]);
      const id: string = ws.rows[0].id;
      for (const s of schemas) {
         await c.query(`insert into rpx.workspace_schemas (workspace_id, schema_name) values ($1, $2) on conflict do nothing`, [id, s]);
      }
      return { id, role };
   });
}

export async function importApp(pool: pg.Pool, workspace: string, specText: string, importedBy = process.env.USER ?? 'cli'): Promise<ImportResult> {
   return withTx(pool, c => importSpec(c, workspace, specText, importedBy));
}

export async function addUser(pool: pg.Pool, workspace: string, username: string, password: string, groups: string[] = []): Promise<string> {
   if (password.length < 10) throw new Error('password must be at least 10 characters');
   const ws = await pool.query('select id from rpx.workspaces where name = $1', [workspace]);
   if (!ws.rowCount) throw new Error(`workspace "${workspace}" does not exist`);
   const pwd = await hash(password);
   const r = await pool.query(
      `insert into rpx.app_users (workspace_id, username, pwd_hash, groups) values ($1, $2, $3, $4)
       on conflict (workspace_id, username) do update set pwd_hash = excluded.pwd_hash, groups = excluded.groups
                                                         , locked = false, failed_logins = 0
       returning id`, [ws.rows[0].id, username, pwd, groups]);
   return r.rows[0].id;
}

export const PILOT_SCHEMAS = ['apx_demo', 'apx_demo_sec_pkg', 'apx_demo_doc_pkg', 'apx_demo_approval_pkg', 'apx_demo_request_pkg'];
export const PILOT_USERS: [string, string][] = [
   ['admin', 'ADMIN'], ['budi', 'REQUESTER'], ['sari', 'MANAGER'], ['dodi', 'DIRECTOR'], ['gudang', 'WAREHOUSE'],
];

/**
 * Pilot "Demo Permintaan Barang" (examples/demo-permintaan): workspace with one schema per ported package,
 * database objects + sample data, the app, and one login per role (same password). Safe to run again.
 */
export async function setupPilot(pool: pg.Pool, password: string, ws = 'pandawa'): Promise<ImportResult> {
   const root = new URL('../../examples/demo-permintaan/', import.meta.url);
   await createWorkspace(pool, ws, PILOT_SCHEMAS);
   // the scripts set search_path: run them on their own connection and reset it before it goes back to the pool
   const c = await pool.connect();
   try {
      await c.query(readFileSync(new URL('install.sql', root), 'utf8'));
      await c.query(readFileSync(new URL('seed.sql', root), 'utf8'));
   } finally {
      await c.query('reset search_path').catch(() => {});
      c.release();
   }
   const r = await importApp(pool, ws, readFileSync(new URL('app.yaml', root), 'utf8'));
   for (const [user] of PILOT_USERS) await addUser(pool, ws, user, password);
   return r;
}

