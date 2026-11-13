import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import type { AppDef } from './model.ts';

export interface Session {
   id: string;
   appUserId: string | null;
   username: string;
   csrf: string;
   salt: Buffer;
   state: Map<string, string | null>;
   /** groups of the signed-in user (from app_users, refreshed at every request) */
   groups: string[];
   /** results of once_per_session authorization schemes, by scheme id */
   authzCache: Record<string, boolean>;
}

export const FLASH_KEY = '__rpx_success';
export const NEW_SESSION_KEY = '__rpx_session_init';
export const AFTER_AUTH_KEY = '__rpx_after_auth';

export async function saveAuthzCache(pool: pg.Pool, s: Session, fresh: Record<string, boolean>): Promise<void> {
   if (!Object.keys(fresh).length) return;
   Object.assign(s.authzCache, fresh);
   await pool.query('update rpx.sessions set authz_cache = authz_cache || $2 where id = $1', [s.id, fresh]);
}

export function cookieName(app: AppDef): string {
   return `rpx_${app.workspace}_${app.alias}`.replace(/[^A-Za-z0-9_]/g, '_');
}

export function cookiePath(app: AppDef): string {
   return `/r/${app.workspace}/${app.alias}`;
}

/** Load a live session (not expired, not idle) for this app, refreshing last_seen_at. */
export async function loadSession(pool: pg.Pool, app: AppDef, id: string | undefined): Promise<Session | null> {
   if (!id || !/^[0-9a-f-]{36}$/.test(id)) return null;
   const r = await pool.query(
      `update rpx.sessions s set last_seen_at = now()
       where s.id = $1 and s.app_id = $2 and s.expires_at > now()
         and s.last_seen_at > now() - make_interval(secs => $3)
       returning s.id, s.app_user_id, s.username, s.csrf_token, s.checksum_salt, s.authz_cache
               , (select u.groups from rpx.app_users u where u.id = s.app_user_id) as groups
               , (select u.locked from rpx.app_users u where u.id = s.app_user_id) as locked`, [id, app.id, app.idleTimeoutSec]);
   if (!r.rowCount) return null;
   const row = r.rows[0];
   if (row.locked) {
      // an account locked by an administrator loses its open sessions immediately
      await pool.query('delete from rpx.sessions where id = $1', [row.id]);
      return null;
   }
   const st = await pool.query('select item_name, value from rpx.session_state where session_id = $1', [row.id]);
   return {
      id: row.id, appUserId: row.app_user_id, username: row.username, csrf: row.csrf_token, salt: row.checksum_salt,
      state: new Map(st.rows.map(x => [x.item_name, x.value])), groups: row.groups ?? [], authzCache: row.authz_cache ?? {},
   };
}

export async function createSession(pool: pg.Pool | pg.PoolClient, app: AppDef, user?: { id: string; username: string; groups?: string[] }): Promise<Session> {
   const r = await pool.query(
      `insert into rpx.sessions (app_id, app_user_id, username, expires_at)
       values ($1, $2, $3, now() + make_interval(secs => $4))
       returning id, app_user_id, username, csrf_token, checksum_salt`,
      [app.id, user?.id ?? null, user?.username ?? 'nobody', app.sessionTimeoutSec]);
   const row = r.rows[0];
   const s: Session = {
      id: row.id, appUserId: row.app_user_id, username: row.username, csrf: row.csrf_token, salt: row.checksum_salt,
      state: new Map(), groups: user?.groups ?? [], authzCache: {},
   };
   // application computations "after_authentication" run on the first page view of a signed-in session
   if (user) await saveState(pool, s, { [AFTER_AUTH_KEY]: 'pending' });
   return s;
}

export async function deleteSession(pool: pg.Pool, id: string): Promise<void> {
   await pool.query('delete from rpx.sessions where id = $1', [id]);
}

/** Persist item values (null clears). Empty strings are stored as NULL, so `:P1_X is null` behaves like in APEX. */
export async function saveState(db: pg.Pool | pg.PoolClient, s: Session, values: Record<string, string | null>): Promise<void> {
   const names = Object.keys(values);
   if (!names.length) return;
   const vals = names.map(n => (values[n] === '' ? null : values[n]));
   await db.query(
      `insert into rpx.session_state (session_id, item_name, value)
       select $1, n, v from unnest($2::text[], $3::text[]) as t(n, v)
       on conflict (session_id, item_name) do update set value = excluded.value, updated_at = now()`,
      [s.id, names, vals]);
   names.forEach((n, i) => s.state.set(n, vals[i]));
}

/** Clear cache for whole pages (all their items). */
export async function clearPages(db: pg.Pool | pg.PoolClient, s: Session, app: AppDef, pageNos: number[]): Promise<void> {
   const names: string[] = [];
   for (const no of pageNos) for (const it of app.pages.get(no)?.items ?? []) names.push(it.name);
   if (!names.length) return;
   await db.query('delete from rpx.session_state where session_id = $1 and item_name = any($2)', [s.id, names]);
   for (const n of names) s.state.delete(n);
}

export async function takeFlash(db: pg.Pool, s: Session): Promise<string | null> {
   const msg = s.state.get(FLASH_KEY) ?? null;
   if (msg !== null) {
      await db.query('delete from rpx.session_state where session_id = $1 and item_name = $2', [s.id, FLASH_KEY]);
      s.state.delete(FLASH_KEY);
   }
   return msg;
}

/** Item map handed to developer code / bind variables: all session state + built-ins. */
export function bindValues(app: AppDef, s: Session, extra: Record<string, string | null> = {}): Record<string, string | null> {
   const out: Record<string, string | null> = {};
   for (const [k, v] of s.state) if (!k.startsWith('__')) out[k] = v;
   out.APP_USER = s.username;
   out.APP_ID = app.alias;
   out.APP_SESSION = s.id;
   return { ...out, ...extra };
}

// One-time submission tokens (double POST / replay protection). Each rendered form gets a token;
// accepting the form deletes it atomically, so the same submission is processed at most once.
const SUBMIT_PREFIX = '__sub:';
const MAX_OPEN_FORMS = 50;

export async function issueSubmitToken(db: pg.Pool | pg.PoolClient, s: Session, pageNo: number): Promise<string> {
   const token = randomBytes(18).toString('base64url');
   await db.query(
      `insert into rpx.session_state (session_id, item_name, value) values ($1, $2, $3)`,
      [s.id, SUBMIT_PREFIX + token, String(pageNo)]);
   // keep the most recent forms only (a user who opens many pages without submitting)
   await db.query(
      `delete from rpx.session_state where session_id = $1 and item_name like '__sub:%'
         and item_name not in (select item_name from rpx.session_state
                               where session_id = $1 and item_name like '__sub:%'
                               order by updated_at desc limit $2)`, [s.id, MAX_OPEN_FORMS]);
   return token;
}

export async function consumeSubmitToken(db: pg.Pool | pg.PoolClient, s: Session, pageNo: number, token: unknown): Promise<boolean> {
   if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,40}$/.test(token)) return false;
   const r = await db.query(
      `delete from rpx.session_state where session_id = $1 and item_name = $2 and value = $3`,
      [s.id, SUBMIT_PREFIX + token, String(pageNo)]);
   return r.rowCount === 1;
}
