import type pg from 'pg';
import { DEV_IDLE_MINUTES } from '../builder/session.ts';

// Housekeeping that runs inside the engine (and as `rpx session purge`): sessions that can never be used again
// are deleted, with their session state, collections and debug messages (on delete cascade).

export interface PurgeResult { appSessions: number; devSessions: number }

const BATCH = 5000;
const LOCK = 'rpx.maintenance';

/**
 * Delete application sessions past their absolute expiry or idle longer than their application allows, and
 * developer sessions likewise. Exactly the sessions loadSession / loadDevSession would refuse.
 * Returns null when another engine instance is purging right now.
 */
export async function purgeSessions(pool: pg.Pool): Promise<PurgeResult | null> {
   const c = await pool.connect();
   try {
      const lock = await c.query('select pg_try_advisory_lock(hashtext($1)) as ok', [LOCK]);
      if (!lock.rows[0].ok) return null;
      try {
         let appSessions = 0;
         // in batches: a first run on a table that was never purged must not hold one long lock
         for (;;) {
            const r = await c.query(
               `delete from rpx.sessions where id in (
                   select s.id from rpx.sessions s join rpx.applications a on a.id = s.app_id
                    where s.expires_at <= now() or s.last_seen_at <= now() - a.idle_timeout
                    limit $1)`, [BATCH]);
            appSessions += r.rowCount ?? 0;
            if ((r.rowCount ?? 0) < BATCH) break;
         }
         const d = await c.query(
            `delete from rpx.dev_sessions where expires_at <= now() or last_seen_at <= now() - make_interval(mins => $1)`, [DEV_IDLE_MINUTES]);
         return { appSessions, devSessions: d.rowCount ?? 0 };
      } finally {
         await c.query('select pg_advisory_unlock(hashtext($1))', [LOCK]);
      }
   } finally {
      c.release();
   }
}

interface Log { info: (obj: object, msg: string) => void; error: (obj: object, msg: string) => void }

/** Purge shortly after start and then every `everyMinutes` (0 or less: never). Returns a function that stops it. */
export function startMaintenance(pool: pg.Pool, log: Log, everyMinutes = 15): () => void {
   if (!(everyMinutes > 0)) return () => {};
   const run = () => purgeSessions(pool)
      .then(r => { if (r && (r.appSessions || r.devSessions)) log.info({ purged: r }, 'expired sessions removed'); })
      .catch(err => log.error({ err }, 'session purge failed'));     // never takes the server down
   const first = setTimeout(run, 10_000);
   const timer = setInterval(run, everyMinutes * 60_000);
   first.unref();
   timer.unref();
   return () => { clearTimeout(first); clearInterval(timer); };
}
