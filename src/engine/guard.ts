import type pg from 'pg';
import { toText } from './db.ts';
import type { AuthzDef, ComputationDef, Condition, Guarded, PageDef } from './model.ts';
import { saveAuthzCache } from './session.ts';
import { inSavepoint, pgMessage, runFunctionBody, runSql, substitute, syncItems, values, type Ctx } from './usercode.ts';

// Authorization schemes, conditions and computations, evaluated inside the request transaction
// (as the workspace role), with the caching rules of each scheme.

export class Evaluator {
   private pageView = new Map<string, boolean>();
   private fresh: Record<string, boolean> = {};
   readonly c: pg.PoolClient;
   readonly ctx: Ctx;
   request: string;

   constructor(c: pg.PoolClient, ctx: Ctx, request = '') {
      this.c = c;
      this.ctx = ctx;
      this.request = request;
   }

   async authorized(id: string | null): Promise<boolean> {
      if (!id) return true;
      const a = this.ctx.app.authz.get(id);
      if (!a) return false;                                     // a dangling reference never grants access
      if (a.evaluation === 'once_per_session' && id in this.ctx.session.authzCache) return this.ctx.session.authzCache[id];
      if (a.evaluation !== 'always' && this.pageView.has(id)) return this.pageView.get(id)!;
      const ok = await this.evaluate(a);
      this.pageView.set(id, ok);
      if (a.evaluation === 'once_per_session') {
         this.fresh[id] = ok;
         this.ctx.session.authzCache[id] = ok;
      }
      return ok;
   }

   private async evaluate(a: AuthzDef): Promise<boolean> {
      const s = this.ctx.session;
      if (a.type === 'group_member') {
         if (!s.appUserId) return false;
         return a.source.split(',').map(g => g.trim()).filter(Boolean).some(g => s.groups.includes(g));
      }
      if (a.type === 'exists_sql' || a.type === 'not_exists_sql') {
         const r = await inSavepoint(this.c, () => runSql(this.c, this.ctx, a.source, [], q => `select exists (${q})`));
         if (!r.ok) { console.warn(`authorization ${a.name} failed: ${pgMessage(r.error)}`); return false; }
         return (r.value.rows[0][0] === true) === (a.type === 'exists_sql');
      }
      if (a.type === 'fn_boolean') {
         const r = await inSavepoint(this.c, () => runFunctionBody(this.c, this.ctx, a.source, 'boolean'));
         if (!r.ok) { console.warn(`authorization ${a.name} failed: ${pgMessage(r.error)}`); return false; }
         return r.value === true;
      }
      return false;
   }

   async holds(cond: Condition | null): Promise<boolean> {
      if (!cond) return true;
      const st = (n: string) => this.ctx.session.state.get(n) ?? null;
      if (cond.never) return false;
      if (cond.item_not_null) return st(cond.item_not_null) !== null;
      if (cond.item_null) return st(cond.item_null) === null;
      if (cond.item_equals) return st(cond.item_equals.item) === cond.item_equals.value;
      if (cond.request_equals !== undefined) return this.request === cond.request_equals;
      const sql = cond.sql_expression ?? cond.sql_exists;
      if (sql) {
         const wrap = cond.sql_expression ? (q: string) => `select coalesce((${q})::boolean, false)` : (q: string) => `select exists (${q})`;
         const r = await inSavepoint(this.c, () => runSql(this.c, this.ctx, sql, [], wrap));
         if (!r.ok) { console.warn(`condition failed: ${pgMessage(r.error)}`); return false; }
         return r.value.rows[0][0] === true;
      }
      return true;
   }

   /** authorization AND condition */
   async allows(g: Guarded): Promise<boolean> {
      return (await this.authorized(g.authzId)) && (await this.holds(g.condition));
   }

   /** the scheme that refuses access to a page (application-level first), or null when allowed */
   async pageDenial(page: PageDef): Promise<AuthzDef | null> {
      for (const id of [this.ctx.app.authzId, page.authzId]) {
         if (id && !(await this.authorized(id))) return this.ctx.app.authz.get(id) ?? { id, name: '?', type: '', source: '', evaluation: '', errorMsg: 'Akses ditolak.' };
      }
      return null;
   }

   async pageAllowed(no: number): Promise<boolean> {
      const page = this.ctx.app.pages.get(no);
      return !!page && (await this.pageDenial(page)) === null;
   }

   /** persist once_per_session results computed during this request */
   async flush(): Promise<void> {
      await saveAuthzCache(this.ctx.pool, this.ctx.session, this.fresh);
      this.fresh = {};
   }
}

/**
 * Run computations in order. Each result goes straight into session state (in memory) and rpx_rt,
 * so later computations, conditions and SQL see it. Returns the changes to persist and any errors.
 */
export async function runComputations(ev: Evaluator, list: ComputationDef[]): Promise<{ changes: Record<string, string | null>; errors: string[] }> {
   const changes: Record<string, string | null> = {};
   const errors: string[] = [];
   for (const comp of list) {
      if (!(await ev.holds(comp.condition))) continue;
      const r = await inSavepoint(ev.c, () => computeValue(ev, comp));
      if (!r.ok) {
         errors.push(`Computation untuk ${comp.itemName} gagal: ${pgMessage(r.error)}`);
         continue;
      }
      ev.ctx.session.state.set(comp.itemName, r.value);
      changes[comp.itemName] = r.value;
      await syncItems(ev.c, ev.ctx);
   }
   return { changes, errors };
}

async function computeValue(ev: Evaluator, comp: ComputationDef): Promise<string | null> {
   const { c, ctx } = ev;
   const nullIfEmpty = (v: string | null) => (v === '' ? null : v);
   switch (comp.type) {
      case 'static':
         return nullIfEmpty(substitute(comp.expression, values(ctx), false));
      case 'item':
         return ctx.session.state.get(comp.expression.trim().toUpperCase()) ?? null;
      case 'sql_query': {
         const r = await runSql(c, ctx, comp.expression);
         return r.rows.length ? toText(r.rows[0][0]) : null;
      }
      case 'sql_expression': {
         const r = await runSql(c, ctx, comp.expression, [], q => `select (${q})`);
         return toText(r.rows[0][0]);
      }
      case 'plpgsql_fn':
         return toText(await runFunctionBody(c, ctx, comp.expression, 'text'));
      default:
         throw new Error(`unknown computation type ${comp.type}`);
   }
}
