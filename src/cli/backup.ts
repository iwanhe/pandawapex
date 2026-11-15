import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import pg from 'pg';
import { createPool } from '../engine/db.ts';
import { migrate } from './commands.ts';

// `rpx backup` and `rpx restore`: one database (metadata in rpx.*, the workspace schemas and their data) with pg_dump,
// plus the roles that database needs. Roles are not part of a database in PostgreSQL, so a plain pg_dump restored on
// another server loses every grant to ws_<workspace> and rpx_engine; the roles file closes that gap.

/** Session data is not worth keeping and holds secrets (CSRF tokens, checksum salts). The tables are restored empty. */
const NO_DATA = ['rpx.sessions', 'rpx.session_state', 'rpx.collections', 'rpx.debug_messages', 'rpx.dev_sessions'];
const DB_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

export interface BackupResult { dump: string; roles: string; bytes: number; removed: string[] }
export interface RestoreResult { database: string; workspaces: number; applications: number; appUsers: number; developers: number; rolesCreated: string[]; migrations: string[] }

/** libpq environment for the pg_* tools, so that the password never appears in a process list. */
export function pgEnv(url: string): NodeJS.ProcessEnv {
   // parsed by pg itself, so every form the engine accepts works here too (also postgres://user@/db?host=/socket/dir,
   // which the WHATWG URL parser rejects)
   const p = new pg.Client({ connectionString: url }) as unknown as { host?: string; port?: number; user?: string; password?: string; database?: string };
   const env: NodeJS.ProcessEnv = { ...process.env };
   const set = (k: string, v: string | number | undefined | null) => { if (v === undefined || v === null || v === '') delete env[k]; else env[k] = String(v); };
   set('PGHOST', p.host);
   set('PGPORT', p.port);
   set('PGUSER', p.user);
   set('PGPASSWORD', p.password);
   set('PGDATABASE', p.database || 'postgres');
   const ssl = /[?&]sslmode=([^&]+)/.exec(url);
   if (ssl) env.PGSSLMODE = decodeURIComponent(ssl[1]!);
   return env;
}

/** The database a connection string names. */
export const databaseOf = (url: string): string => pgEnv(url).PGDATABASE ?? 'postgres';

/** The same connection with another database name. */
export function withDatabase(url: string, db: string): string {
   const m = /^([a-z]+:\/\/[^/?]*)(\/[^?]*)?(\?.*)?$/.exec(url);
   if (!m) throw new Error('DATABASE_URL tidak dikenali');
   return `${m[1]}/${db}${m[3] ?? ''}`;
}

/** pg_dump / pg_restore: from PGBIN, then PGHOME/bin (as start-lokal.cmd uses), then the PATH. */
export function pgTool(name: 'pg_dump' | 'pg_restore'): string {
   const exe = process.platform === 'win32' ? `${name}.exe` : name;
   for (const dir of [process.env.PGBIN, process.env.PGHOME && join(process.env.PGHOME, 'bin')]) {
      if (dir && existsSync(join(dir, exe))) return join(dir, exe);
   }
   return exe;
}

function run(tool: 'pg_dump' | 'pg_restore', args: string[], env: NodeJS.ProcessEnv): Promise<void> {
   return new Promise((ok, fail) => {
      execFile(pgTool(tool), args, { env, maxBuffer: 16 * 1024 * 1024 }, (err, _out, stderr) => {
         if (!err) return ok();
         if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            return fail(new Error(`${tool} tidak ditemukan. Isi PGHOME dengan folder PostgreSQL (mis. set "PGHOME=D:\\Software\\PGSQL") atau tambahkan folder bin-nya ke PATH.`));
         }
         fail(new Error(`${tool} gagal: ${stderr.trim() || err.message}`));
      });
   });
}

const ident = (s: string) => `"${s.replaceAll('"', '""')}"`;
const literal = (s: string) => `'${s.replaceAll("'", "''")}'`;

/**
 * SQL that recreates the roles this database depends on: rpx_engine, rpx_user_code, the workspace roles, and every
 * role that owns or is granted something here, with their memberships. Roles that already exist are left untouched
 * (so a restore never changes a password on the target server), and new ones get LOGIN/NOLOGIN and their password
 * only: never SUPERUSER, CREATEROLE or CREATEDB.
 */
export async function rolesSql(pool: pg.Pool): Promise<string> {
   const me = (await pool.query(`select rolsuper from pg_roles where rolname = current_user`)).rows[0];
   // pg_authid (password hashes) is readable by superusers only
   const pw = me?.rolsuper ? `(select a.rolpassword from pg_authid a where a.oid = r.oid)` : `null::text`;
   const roles = await pool.query(
      `with needed as (
          select d.refobjid as oid from pg_shdepend d
           where d.refclassid = 'pg_authid'::regclass and d.dbid = (select oid from pg_database where datname = current_database())
          union select oid from pg_roles where rolname in ('rpx_engine', 'rpx_user_code')
          union select r.oid from pg_roles r join rpx.workspaces w on w.db_role = r.rolname)
       select r.oid, r.rolname, r.rolcanlogin, r.rolinherit, ${pw} as password
         from pg_roles r join needed n on n.oid = r.oid
        where r.oid <> 10 and r.rolname !~ '^pg_' order by r.rolname`);
   const oids = roles.rows.map(r => r.oid);
   const members = await pool.query(
      `select g.rolname as granted, m.rolname as member from pg_auth_members am
         join pg_roles g on g.oid = am.roleid join pg_roles m on m.oid = am.member
        where am.roleid = any($1::oid[]) and am.member = any($1::oid[]) order by 1, 2`, [oids]);
   const out = [
      `-- pandawapex: role yang dibutuhkan database "${(await pool.query('select current_database() as d')).rows[0].d}".`,
      '-- Dibuat oleh `rpx backup`. Aman dijalankan berulang: role yang sudah ada tidak diubah.',
      me?.rolsuper ? '' : '-- Catatan: dibuat tanpa hak superuser, jadi kata sandi role tidak ikut. Atur lagi setelah restore.',
      '',
   ];
   for (const r of roles.rows) {
      const attrs = `${r.rolcanlogin ? 'login' : 'nologin'} ${r.rolinherit ? 'inherit' : 'noinherit'}${r.password ? ` password ${literal(r.password)}` : ''}`;
      out.push(`do $rpx_role$ begin`,
         `   if not exists (select from pg_roles where rolname = ${literal(r.rolname)}) then`,
         `      create role ${ident(r.rolname)} ${attrs};`,
         `      raise notice 'rpx role created: %', ${literal(r.rolname)};`,
         `   end if;`,
         `end $rpx_role$;`);
   }
   out.push('');
   for (const m of members.rows) out.push(`grant ${ident(m.granted)} to ${ident(m.member)};`);
   return out.filter((l, i) => !(l === '' && out[i - 1] === '')).join('\n') + '\n';
}

function stamp(d = new Date()): string {
   const p = (n: number) => String(n).padStart(2, '0');
   return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * Back up the database DATABASE_URL points at into `dir`: rpx-<db>-<time>.dump (pg_dump custom format) and
 * rpx-<db>-<time>.roles.sql. With `keep`, older backups of the same database beyond that number are deleted.
 */
export async function backup(url: string, dir: string, opts: { keep?: number } = {}): Promise<BackupResult> {
   if (opts.keep !== undefined && !(Number.isInteger(opts.keep) && opts.keep >= 1)) throw new Error('--keep harus bilangan bulat 1 atau lebih');
   const env = pgEnv(url);
   const db = env.PGDATABASE!;
   mkdirSync(dir, { recursive: true });
   const base = join(resolve(dir), `rpx-${db.replace(/[^A-Za-z0-9_-]/g, '_')}-${stamp()}`);
   const pool = createPool(url);
   let roles: string;
   try {
      const has = await pool.query(`select 1 from pg_namespace where nspname = 'rpx'`);
      if (!has.rowCount) throw new Error(`database "${db}" tidak berisi pandawapex (skema rpx tidak ada). Periksa DATABASE_URL.`);
      roles = await rolesSql(pool);
   } finally {
      await pool.end();
   }
   // written under a temporary name first: a backup that failed half-way never looks like a finished one
   const partial = `${base}.dump.partial`;
   try {
      await run('pg_dump', ['--format=custom', '--no-password', `--file=${partial}`, ...NO_DATA.map(t => `--exclude-table-data=${t}`)], env);
      writeFileSync(`${base}.roles.sql`, roles);
      renameSync(partial, `${base}.dump`);
   } catch (e) {
      rmSync(partial, { force: true });
      throw e;
   }
   const removed: string[] = [];
   if (opts.keep) {
      const mine = new RegExp(`^rpx-${db.replace(/[^A-Za-z0-9_-]/g, '_')}-\\d{8}-\\d{6}\\.dump$`);
      const old = readdirSync(dir).filter(f => mine.test(f)).sort().reverse().slice(opts.keep);
      for (const f of old) {
         rmSync(join(dir, f), { force: true });
         rmSync(join(dir, f.replace(/\.dump$/, '.roles.sql')), { force: true });
         removed.push(f);
      }
   }
   return { dump: `${base}.dump`, roles: `${base}.roles.sql`, bytes: statSync(`${base}.dump`).size, removed };
}

/**
 * Restore a backup into database `target` on the server DATABASE_URL points at. The target must be new, or exist
 * without any tables: a restore never writes into a database that is in use. Roles first, then the dump in one
 * transaction (all or nothing), then migrations newer than the backup.
 */
export async function restore(url: string, dumpFile: string, target: string, log: (m: string) => void = () => {}): Promise<RestoreResult> {
   if (!DB_NAME.test(target)) throw new Error(`nama database tujuan tidak valid: "${target}" (huruf kecil, angka, garis bawah)`);
   if (!existsSync(dumpFile)) throw new Error(`file backup tidak ditemukan: ${dumpFile}`);
   const rolesFile = dumpFile.replace(/\.dump$/, '') + '.roles.sql';
   if (!existsSync(rolesFile)) {
      throw new Error(`file role tidak ditemukan: ${basename(rolesFile)}. File itu dibuat bersama .dump oleh "rpx backup" dan harus berada di folder yang sama.`);
   }
   const targetUrl = withDatabase(url, target);

   const admin = createPool(url);
   const rolesCreated: string[] = [];
   try {
      const exists = await admin.query('select 1 from pg_database where datname = $1', [target]);
      if (exists.rowCount) {
         const t = createPool(targetUrl);
         try {
            const used = await t.query(
               `select count(*)::int as n from pg_class c join pg_namespace n on n.oid = c.relnamespace
                 where c.relkind in ('r', 'p', 'v', 'm', 'S') and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname !~ '^pg_toast'`);
            if (used.rows[0].n > 0) {
               throw new Error(`database "${target}" sudah berisi tabel. Restore hanya ke database baru atau kosong; pilih nama lain di --to (mis. ${target}_restore).`);
            }
         } finally {
            await t.end();
         }
      } else {
         await admin.query(`create database ${ident(target)}`);
         log(`database ${target} dibuat`);
      }
      const c = await admin.connect();
      try {
         c.on('notice', n => { const m = /^rpx role created: (.+)$/.exec(n.message ?? ''); if (m) rolesCreated.push(m[1]!); });
         await c.query(readFileSync(rolesFile, 'utf8'));
      } finally {
         c.release();
      }
      log(rolesCreated.length ? `role dibuat: ${rolesCreated.join(', ')}` : 'semua role sudah ada');
   } finally {
      await admin.end();
   }

   await run('pg_restore', ['--no-password', '--single-transaction', '--exit-on-error', `--dbname=${target}`, dumpFile], { ...pgEnv(targetUrl), PGDATABASE: target });
   log('data dipulihkan');

   const pool = createPool(targetUrl);
   try {
      const migrations = await migrate(pool);
      if (migrations.length) log(`migrasi baru dipasang: ${migrations.join(', ')}`);
      const n = (await pool.query(
         `select (select count(*) from rpx.workspaces)::int as workspaces, (select count(*) from rpx.applications)::int as applications
               , (select count(*) from rpx.app_users)::int as app_users, (select count(*) from rpx.dev_users)::int as developers`)).rows[0];
      return { database: target, workspaces: n.workspaces, applications: n.applications, appUsers: n.app_users, developers: n.developers, rolesCreated, migrations };
   } finally {
      await pool.end();
   }
}
