import pg from 'pg';

// Keep dates, timestamps and numerics as the text PostgreSQL sends: the engine works with
// session state as text (like APEX), and JS Date / float conversions would lose precision or shift time zones.
for (const oid of [1082, 1083, 1114, 1184, 1266, 1700, 20]) {
   pg.types.setTypeParser(oid, (v: string) => v);
}

export type Pool = pg.Pool;
export type Client = pg.PoolClient;

export function createPool(connectionString: string): pg.Pool {
   return new pg.Pool({ connectionString, max: Number(process.env.RPX_POOL_MAX ?? 10) });
}

const IDENT = /^[a-z_][a-z0-9_$]*$/;

/** Quote an identifier the way format('%I') does. */
export function quoteIdent(name: string): string {
   return IDENT.test(name) ? name : '"' + name.replace(/"/g, '""') + '"';
}

/** Validate and quote "table" or "schema.table" coming from a spec. */
export function quoteQualified(name: string): string {
   const parts = name.split('.');
   if (parts.length > 2 || parts.some(p => !/^[A-Za-z_][A-Za-z0-9_$]*$/.test(p))) {
      throw new Error(`Invalid object name: ${name}`);
   }
   return parts.map(p => quoteIdent(p.toLowerCase())).join('.');
}

export async function withTx<T>(pool: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
   const c = await pool.connect();
   try {
      await c.query('begin');
      const r = await fn(c);
      await c.query('commit');
      return r;
   } catch (e) {
      await c.query('rollback').catch(() => {});
      throw e;
   } finally {
      c.release();
   }
}

export interface UserCodeContext {
   dbRole: string;            // ws_<workspace>
   parsingSchema: string;
   items: Record<string, string | null>;
   appUser: string;
   appAlias: string;
   sessionId: string;
   timezone?: string;
   statementTimeoutMs?: number;
}

/**
 * Prepare the current transaction to run developer code: switch to the workspace role,
 * the parsing schema, a statement timeout and the rpx_rt context (items, user, app, session).
 * Everything is SET LOCAL, so it ends with the transaction (safe with pooling / PgBouncer).
 */
export async function enterUserCode(c: pg.PoolClient, ctx: UserCodeContext): Promise<void> {
   await c.query(`set local role ${quoteIdent(ctx.dbRole)}`);
   await c.query(`select set_config('search_path', $1, true)
                       , set_config('statement_timeout', $2, true)
                       , set_config('timezone', $3, true)`,
      [`${quoteIdent(ctx.parsingSchema)}, public`, String(ctx.statementTimeoutMs ?? 30000), ctx.timezone ?? 'Asia/Jakarta']);
   await c.query('select rpx_rt.ctx_init($1, $2, $3, $4)',
      [JSON.stringify(ctx.items), ctx.appUser, ctx.appAlias, ctx.sessionId]);
}

/** Read the item map back after developer code ran (set_item writes). */
export async function readUserCodeItems(c: pg.PoolClient): Promise<Record<string, string | null>> {
   const r = await c.query('select rpx_rt.ctx_items() as items');
   return r.rows[0].items ?? {};
}

/** Leave developer-code mode inside the same transaction (back to the engine role). */
export async function leaveUserCode(c: pg.PoolClient): Promise<void> {
   await c.query('reset role');
   await c.query("select set_config('search_path', 'rpx, public', true)");
}

/** Values coming back from developer queries, as session-state text. */
export function toText(v: unknown): string | null {
   if (v === null || v === undefined) return null;
   if (typeof v === 'string') return v;
   if (typeof v === 'boolean') return v ? 'Y' : 'N';
   if (typeof v === 'number' || typeof v === 'bigint') return String(v);
   if (v instanceof Date) return v.toISOString();
   if (Buffer.isBuffer(v)) return null;          // blobs are not session state
   return JSON.stringify(v);
}
