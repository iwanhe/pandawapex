import { randomBytes } from 'node:crypto';
import type pg from 'pg';

// Developer (builder) sessions. They are separate from application sessions: their own table, their own cookie,
// scoped to /builder, and they always belong to one workspace (the one the developer signed in to).

export const DEV_COOKIE = 'rpx_dev';
export const DEV_CSRF_COOKIE = 'rpx_dev_csrf';
export const DEV_PATH = '/builder';
const SESSION_HOURS = 8;
const IDLE_MINUTES = 60;

export interface Flash { kind: 'success' | 'danger' | 'info'; text: string }

export interface DevSession {
   id: string;
   csrf: string;
   userId: string;
   username: string;
   isAdmin: boolean;
   workspaceId: string;
   workspace: string;
   flash: Flash | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

/** A live session (not expired, not idle, account not locked), refreshing last_seen_at. */
export async function loadDevSession(pool: pg.Pool, id: string | undefined): Promise<DevSession | null> {
   if (!isUuid(id)) return null;
   const r = await pool.query(
      `update rpx.dev_sessions s set last_seen_at = now()
         from rpx.dev_users u join rpx.workspaces w on w.id = u.workspace_id
        where s.id = $1 and u.id = s.dev_user_id and s.expires_at > now()
          and s.last_seen_at > now() - make_interval(mins => $2)
       returning s.id, s.csrf_token, s.flash, u.id as user_id, u.username, u.is_admin, u.locked
               , w.id as workspace_id, w.name as workspace`, [id, IDLE_MINUTES]);
   if (!r.rowCount) return null;
   const row = r.rows[0];
   if (row.locked) {
      await pool.query('delete from rpx.dev_sessions where dev_user_id = $1', [row.user_id]);
      return null;
   }
   return {
      id: row.id, csrf: row.csrf_token, userId: row.user_id, username: row.username, isAdmin: row.is_admin,
      workspaceId: row.workspace_id, workspace: row.workspace, flash: row.flash,
   };
}

export async function createDevSession(pool: pg.Pool, userId: string): Promise<string> {
   // housekeeping: expired sessions of everybody go when somebody signs in
   await pool.query('delete from rpx.dev_sessions where expires_at < now()');
   const r = await pool.query(
      `insert into rpx.dev_sessions (dev_user_id, expires_at) values ($1, now() + make_interval(hours => $2)) returning id`,
      [userId, SESSION_HOURS]);
   return r.rows[0].id;
}

export async function deleteDevSession(pool: pg.Pool, id: string): Promise<void> {
   await pool.query('delete from rpx.dev_sessions where id = $1', [id]);
}

/** Message for the next page (post/redirect/get). */
export async function setFlash(pool: pg.Pool, s: DevSession, flash: Flash): Promise<void> {
   await pool.query('update rpx.dev_sessions set flash = $2 where id = $1', [s.id, flash]);
}

/** The pending message, cleared once read. */
export async function takeFlash(pool: pg.Pool, s: DevSession): Promise<Flash | null> {
   if (!s.flash) return null;
   await pool.query('update rpx.dev_sessions set flash = null where id = $1', [s.id]);
   const f = s.flash;
   s.flash = null;
   return f;
}

export const newCsrfToken = () => randomBytes(32).toString('hex');
