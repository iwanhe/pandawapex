import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { translateBinds } from './bind.ts';
import { esc } from './html.ts';
import type { AppDef } from './model.ts';
import { bindValues, type Session } from './session.ts';

// Helpers for running developer code (SQL, PL/pgSQL) inside the current request transaction,
// always as the workspace role (see enterUserCode in db.ts).

export interface Ctx {
   pool: pg.Pool;
   secret: string;
   app: AppDef;
   session: Session;
}

export function userCtx(ctx: Ctx, items = bindValues(ctx.app, ctx.session)) {
   return {
      dbRole: ctx.app.dbRole, parsingSchema: ctx.app.parsingSchema, items, appUser: ctx.session.username,
      appAlias: ctx.app.alias, sessionId: ctx.session.id, timezone: ctx.app.timezone,
   };
}

/** Push the current session state into rpx_rt so v('ITEM') sees values changed during this request. */
export async function syncItems(c: pg.PoolClient, ctx: Ctx): Promise<void> {
   const u = userCtx(ctx);
   await c.query('select rpx_rt.ctx_init($1, $2, $3, $4)', [JSON.stringify(u.items), u.appUser, u.appAlias, u.sessionId]);
}

/** Run developer SQL with :BINDS as text parameters. `wrap` may embed it (limit/offset, exists, ...). */
export async function runSql(c: pg.PoolClient, ctx: Ctx, sql: string, extraParams: unknown[] = [], wrap?: (s: string, next: number) => string) {
   const t = translateBinds(sql.trim().replace(/;\s*$/, ''), 'sql', { castText: true });
   const vals = bindValues(ctx.app, ctx.session);
   const params: unknown[] = t.names.map(n => vals[n] ?? null);
   const text = wrap ? wrap(t.text, params.length + 1) : t.text;
   return c.query({ text, values: [...params, ...extraParams], rowMode: 'array' });
}

/**
 * Run a PL/pgSQL *function body* (code that ends in `return ...;`, like APEX's "PL/SQL Function Body").
 * It becomes a pg_temp function for the duration of the call; if anything fails, the caller's
 * savepoint rollback also removes the function.
 */
export async function runFunctionBody(c: pg.PoolClient, ctx: Ctx, body: string, returns: 'text' | 'boolean'): Promise<unknown> {
   await syncItems(c, ctx);
   const name = `rpx_fn_${randomBytes(6).toString('hex')}`;
   const code = translateBinds(body, 'plpgsql').text.trim();
   const block = /^(declare|begin)\b/i.test(code) ? code : `begin\n${code}\nend;`;
   let tag = '$rpx$';
   for (let k = 0; block.includes(tag); k++) tag = `$rpx${k}$`;
   await c.query(`create function pg_temp.${name}() returns ${returns} language plpgsql as ${tag}\n${block}\n${tag}`);
   const r = await c.query({ text: `select pg_temp.${name}()`, rowMode: 'array' });
   await c.query(`drop function pg_temp.${name}()`);
   return r.rows[0][0];
}

export async function inSavepoint<T>(c: pg.PoolClient, fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: Error }> {
   await c.query('savepoint rpx_sp');
   try {
      const value = await fn();
      await c.query('release savepoint rpx_sp');
      return { ok: true, value };
   } catch (e) {
      await c.query('rollback to savepoint rpx_sp');
      return { ok: false, error: e as Error };
   }
}

export function pgMessage(e: unknown): string {
   const err = e as { message?: string; detail?: string };
   return [err.message, err.detail].filter(Boolean).join(' · ');
}

export function values(ctx: Ctx): Record<string, string | null> {
   return { ...ctx.app.substitutions, ...bindValues(ctx.app, ctx.session) };
}

/**
 * &ITEM. substitution with APEX-style escape filters: &ITEM!HTML. &ITEM!ATTR. &ITEM!JS. &ITEM!RAW. &ITEM!STRIPHTML.
 * `htmlContext` = the result goes into HTML, so values without a filter are HTML-escaped.
 */
export function substitute(text: string, vals: Record<string, string | null>, htmlContext: boolean): string {
   return text.replace(/&([A-Z][A-Z0-9_]*)(?:!(HTML|ATTR|JS|RAW|STRIPHTML))?\./g, (m, name: string, filter?: string) => {
      if (!(name in vals)) return m;
      const v = vals[name] ?? '';
      switch (filter) {
         case 'RAW': return v;
         case 'JS': return JSON.stringify(v).slice(1, -1).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/'/g, "\\'");
         case 'STRIPHTML': return htmlContext ? esc(v.replace(/<[^>]*>/g, '')) : v.replace(/<[^>]*>/g, '');
         case 'HTML': case 'ATTR': return esc(v);
         default: return htmlContext ? esc(v) : v;
      }
   });
}
