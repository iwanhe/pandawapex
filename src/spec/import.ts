import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Ajv } from 'ajv';
import YAML from 'yaml';
import type pg from 'pg';
import schema from './spec.schema.json' with { type: 'json' };

export const ENGINE_VERSION = '0.1.0';

// ---------- spec types (mirror spec.schema.json) ----------
export interface Target { page: number; items?: Record<string, string>; clear_cache?: string }
export interface LovSpec { static?: { display: string; return: string }[]; sql?: string; null_display?: string }
export interface ItemSpec {
   name: string; type: string; label?: string; help?: string; placeholder?: string; required?: boolean;
   col_span?: number; source?: { column: string; pk?: boolean }; default?: string; lov?: LovSpec;
   protection?: string; max_length?: number;
}
export interface ButtonSpec {
   name: string; label: string; hot?: boolean; action?: 'submit' | 'redirect'; target?: Target;
   style?: string; confirm?: string; position?: string; condition?: Condition;
}
export interface Condition { item_not_null?: string; item_null?: string }
export interface ColumnSpec { name: string; label?: string; data_type?: string; is_pk?: boolean; hidden?: boolean; link?: Target }
export interface RegionSpec {
   static_id: string; title?: string; type: 'static' | 'classic_report' | 'form'; template?: string;
   col_span?: number; new_row?: boolean; source?: { sql?: string; table?: string; html?: string };
   page_size?: number; empty_text?: string; columns?: ColumnSpec[]; items?: ItemSpec[]; buttons?: ButtonSpec[];
   condition?: Condition;
}
export interface ValidationSpec { name: string; type: string; expression?: string; error_msg: string; item?: string; when_button?: string }
export interface ProcessSpec {
   name: string; point?: string; type: string; region?: string; code?: string;
   when_button?: string; success_msg?: string; error_msg?: string;
}
export interface BranchSpec { page: number; items?: Record<string, string>; clear_cache?: string; when_button?: string }
export interface NavSpec { label: string; icon?: string; page?: number; url?: string; children?: NavSpec[] }
export interface PageSpec {
   page: number; alias?: string; name: string; title?: string; requires_auth?: boolean; breadcrumb_parent?: number;
   regions?: RegionSpec[]; validations?: ValidationSpec[]; processes?: ProcessSpec[]; branches?: BranchSpec[];
}
export interface AppSpec {
   app: string; name: string; version?: string; parsing_schema: string; home_page?: number; timezone?: string;
   substitutions?: Record<string, string>; authentication?: string | AuthSpec; navigation?: NavSpec[]; pages: PageSpec[];
}
export interface OidcSpec {
   issuer: string; client_id: string; client_secret_env: string; scopes?: string; username_claim?: string;
   groups_claim?: string; allowed_domains?: string[]; provision?: boolean; button_label?: string;
}
export interface AuthSpec { scheme: 'builtin_accounts' | 'oidc' | 'no_auth'; oidc?: OidcSpec; allow_builtin?: boolean }

export function authOf(spec: AppSpec): AuthSpec {
   const a = spec.authentication ?? 'builtin_accounts';
   return typeof a === 'string' ? { scheme: a as AuthSpec['scheme'] } : a;
}

export class SpecError extends Error {
   readonly problems: string[];
   constructor(problems: string[]) {
      super(`Spec is invalid:\n  - ${problems.join('\n  - ')}`);
      this.problems = problems;
   }
}

const ajv = new Ajv({ allErrors: true, strict: false });
const validateSchema = ajv.compile(schema);

export function parseSpec(text: string): AppSpec {
   const doc = YAML.parse(text);
   if (!validateSchema(doc)) {
      throw new SpecError((validateSchema.errors ?? []).map(e => `${e.instancePath || '/'} ${e.message}`));
   }
   const spec = doc as unknown as AppSpec;
   checkSemantics(spec);
   return spec;
}

/** Rules JSON Schema cannot express: uniqueness and cross-references. */
function checkSemantics(spec: AppSpec): void {
   const p: string[] = [];
   const pages = new Map<number, PageSpec>();
   const itemPage = new Map<string, number>();
   for (const page of spec.pages) {
      if (pages.has(page.page)) p.push(`page ${page.page}: duplicate page number`);
      pages.set(page.page, page);
      const regionIds = new Set<string>();
      for (const r of page.regions ?? []) {
         if (regionIds.has(r.static_id)) p.push(`page ${page.page}: duplicate region static_id "${r.static_id}"`);
         regionIds.add(r.static_id);
         if (r.type === 'classic_report' && !r.source?.sql) p.push(`page ${page.page} region ${r.static_id}: classic_report needs source.sql`);
         if (r.type === 'form') {
            if (!r.source?.table) p.push(`page ${page.page} region ${r.static_id}: form needs source.table`);
            if (!(r.items ?? []).some(i => i.source?.pk)) p.push(`page ${page.page} region ${r.static_id}: form needs an item with source.pk = true`);
         }
         for (const it of r.items ?? []) {
            if (itemPage.has(it.name)) p.push(`item ${it.name}: name is used twice (item names are unique per app)`);
            itemPage.set(it.name, page.page);
            if (!it.name.startsWith(`P${page.page}_`)) p.push(`item ${it.name}: page items must be named P${page.page}_...`);
            if (it.lov && !['select', 'radio'].includes(it.type)) p.push(`item ${it.name}: lov only applies to select/radio`);
            if (['select', 'radio'].includes(it.type) && !it.lov) p.push(`item ${it.name}: ${it.type} needs a lov`);
            if (it.source && r.type !== 'form') p.push(`item ${it.name}: source.column only allowed inside a form region`);
         }
         const btn = new Set<string>();
         for (const b of r.buttons ?? []) {
            if (btn.has(b.name)) p.push(`page ${page.page}: duplicate button ${b.name}`);
            btn.add(b.name);
            if (b.action === 'redirect' && !b.target) p.push(`button ${b.name}: redirect needs target`);
         }
      }
      for (const pr of page.processes ?? []) {
         if (['form_init', 'form_dml'].includes(pr.type)) {
            const reg = (page.regions ?? []).find(r => r.static_id === pr.region);
            if (!reg || reg.type !== 'form') p.push(`page ${page.page} process ${pr.name}: region must name a form region`);
         }
         if (pr.type === 'plpgsql' && !pr.code) p.push(`page ${page.page} process ${pr.name}: plpgsql needs code`);
      }
      for (const v of page.validations ?? []) {
         if (v.type !== 'not_null' && !v.expression) p.push(`page ${page.page} validation ${v.name}: needs expression`);
         if (v.type === 'not_null' && !v.item) p.push(`page ${page.page} validation ${v.name}: not_null needs item`);
      }
   }
   const checkTarget = (where: string, t: Target) => {
      const target = pages.get(t.page);
      if (!target) { p.push(`${where}: target page ${t.page} does not exist`); return; }
      for (const name of Object.keys(t.items ?? {})) {
         if (itemPage.get(name) !== t.page) p.push(`${where}: item ${name} is not on page ${t.page}`);
      }
   };
   for (const page of spec.pages) {
      for (const r of page.regions ?? []) {
         for (const c of r.columns ?? []) if (c.link) checkTarget(`page ${page.page} column ${c.name}`, c.link);
         for (const b of r.buttons ?? []) if (b.target) checkTarget(`page ${page.page} button ${b.name}`, b.target);
      }
      for (const b of page.branches ?? []) checkTarget(`page ${page.page} branch`, b);
      if (page.breadcrumb_parent !== undefined && !pages.has(page.breadcrumb_parent)) {
         p.push(`page ${page.page}: breadcrumb_parent ${page.breadcrumb_parent} does not exist`);
      }
   }
   const walkNav = (n: NavSpec[]) => n.forEach(e => {
      if (e.page !== undefined && !pages.has(e.page)) p.push(`navigation "${e.label}": page ${e.page} does not exist`);
      walkNav(e.children ?? []);
   });
   walkNav(spec.navigation ?? []);
   if (spec.home_page !== undefined && !pages.has(spec.home_page)) p.push(`home_page ${spec.home_page} does not exist`);
   const auth = authOf(spec);
   if (auth.scheme === 'oidc' && !auth.oidc) p.push('authentication: scheme oidc needs an oidc block');
   if (auth.scheme !== 'oidc' && (auth.oidc || auth.allow_builtin !== undefined)) p.push('authentication: oidc / allow_builtin only apply to scheme oidc');
   if (p.length) throw new SpecError(p);
}

export interface ImportResult { appId: string; pages: number; regions: number; items: number; replaced: boolean }

/** Replace an application's metadata with the spec, in one transaction. Caller owns the transaction. */
export async function importSpec(c: pg.PoolClient, workspace: string, specText: string, importedBy: string): Promise<ImportResult> {
   const spec = parseSpec(specText);
   const hash = createHash('sha256').update(specText).digest('hex');

   const ws = await c.query('select id from rpx.workspaces where name = $1', [workspace]);
   if (!ws.rowCount) throw new SpecError([`workspace "${workspace}" does not exist`]);
   const wsId: string = ws.rows[0].id;
   const sch = await c.query('select 1 from rpx.workspace_schemas where workspace_id = $1 and schema_name = $2', [wsId, spec.parsing_schema]);
   if (!sch.rowCount) throw new SpecError([`schema "${spec.parsing_schema}" is not assigned to workspace "${workspace}"`]);

   const app = await c.query(
      `insert into rpx.applications (workspace_id, alias, name, version, parsing_schema, home_page_no, substitutions, globalization, spec_hash)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (workspace_id, alias) do update
          set name = excluded.name, version = excluded.version, parsing_schema = excluded.parsing_schema
            , home_page_no = excluded.home_page_no, substitutions = excluded.substitutions
            , globalization = excluded.globalization, spec_hash = excluded.spec_hash
       returning id, (xmax <> 0) as replaced`,
      [wsId, spec.app, spec.name, spec.version ?? '1.0', spec.parsing_schema, spec.home_page ?? spec.pages[0].page,
       spec.substitutions ?? {}, { timezone: spec.timezone ?? 'Asia/Jakarta' }, hash]);
   const appId: string = app.rows[0].id;

   // wipe the previous definition (sessions and their state survive)
   await c.query('delete from rpx.pages where app_id = $1', [appId]);
   await c.query('delete from rpx.items where app_id = $1', [appId]);
   await c.query('delete from rpx.processes where app_id = $1', [appId]);
   await c.query('delete from rpx.computations where app_id = $1', [appId]);
   await c.query('delete from rpx.nav_lists where app_id = $1', [appId]);
   await c.query('delete from rpx.auth_schemes where app_id = $1', [appId]);
   await c.query('delete from rpx.lovs where app_id = $1', [appId]);

   const auth = authOf(spec);
   await c.query(`insert into rpx.auth_schemes (app_id, name, scheme_type, attributes, is_current) values ($1, 'default', $2, $3, true)`,
      [appId, auth.scheme, auth.scheme === 'oidc' ? { ...auth.oidc, allow_builtin: auth.allow_builtin ?? false } : {}]);

   if (spec.navigation?.length) {
      const nl = await c.query(`insert into rpx.nav_lists (app_id, name) values ($1, 'navigation_menu') returning id`, [appId]);
      const insertNav = async (entries: NavSpec[], parent: string | null) => {
         let seq = 10;
         for (const e of entries) {
            const r = await c.query(
               `insert into rpx.nav_entries (list_id, parent_id, label, icon, target, seq) values ($1, $2, $3, $4, $5, $6) returning id`,
               [nl.rows[0].id, parent, e.label, e.icon ?? null, e.page !== undefined ? { page: e.page } : { url: e.url ?? '#' }, seq]);
            seq += 10;
            await insertNav(e.children ?? [], r.rows[0].id);
         }
      };
      await insertNav(spec.navigation, null);
   }

   let regions = 0, items = 0;
   for (const page of spec.pages) {
      const pg_ = await c.query(
         `insert into rpx.pages (app_id, page_no, alias, name, title, requires_auth, attributes)
          values ($1, $2, $3, $4, $5, $6, $7) returning id`,
         [appId, page.page, page.alias ?? null, page.name, page.title ?? null,
          auth.scheme === 'no_auth' ? false : page.requires_auth ?? true,
          { breadcrumb_parent: page.breadcrumb_parent ?? null }]);
      const pageId: string = pg_.rows[0].id;
      const regionIds = new Map<string, string>();
      let rseq = 10;
      for (const r of page.regions ?? []) {
         const sourceType = r.source?.sql ? 'sql' : r.source?.table ? 'table' : null;
         const source = r.source?.sql ?? r.source?.table ?? r.source?.html ?? null;
         const reg = await c.query(
            `insert into rpx.regions (page_id, name, static_id, region_type, source_type, source, seq, grid, template, attributes, condition)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
            [pageId, r.title ?? r.static_id, r.static_id, r.type, sourceType, source, rseq,
             { col_span: r.col_span ?? 12, new_row: r.new_row ?? true }, r.template ?? 'standard',
             { title: r.title ?? null, page_size: r.page_size ?? 15, empty_text: r.empty_text ?? null }, r.condition ?? null]);
         rseq += 10;
         regions++;
         const regionId: string = reg.rows[0].id;
         regionIds.set(r.static_id, regionId);
         let cseq = 10;
         for (const col of r.columns ?? []) {
            await c.query(
               `insert into rpx.region_columns (region_id, name, label, data_type, is_pk, hidden, link, seq)
                values ($1, $2, $3, $4, $5, $6, $7, $8)`,
               [regionId, col.name.toUpperCase(), col.label ?? col.name, col.data_type ?? 'text', col.is_pk ?? false,
                col.hidden ?? false, col.link ?? null, cseq]);
            cseq += 10;
         }
         let iseq = 10;
         for (const it of r.items ?? []) {
            await c.query(
               `insert into rpx.items (app_id, page_id, region_id, name, item_type, label, seq, grid, source, default_value
                                     , inline_lov, is_required, protection, attributes)
                values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
               [appId, pageId, regionId, it.name, it.type, it.label ?? null, iseq, { col_span: it.col_span ?? 12 },
                it.source ? { type: 'db_column', column: it.source.column.toLowerCase(), pk: it.source.pk ?? false } : null,
                it.default !== undefined ? { type: 'static', value: it.default } : null,
                it.lov ?? null, it.required ?? false,
                it.protection === 'restricted' ? 'restricted' : it.protection === 'unrestricted' ? 'unrestricted' : 'checksum_session',
                { help: it.help ?? null, placeholder: it.placeholder ?? null, max_length: it.max_length ?? null }]);
            iseq += 10;
            items++;
         }
         let bseq = 10;
         for (const b of r.buttons ?? []) {
            await c.query(
               `insert into rpx.buttons (page_id, region_id, name, label, action, target, is_hot, position, confirm_msg, seq, attributes, condition)
                values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
               [pageId, regionId, b.name, b.label, b.action ?? 'submit', b.target ?? null, b.hot ?? false,
                b.position ?? 'next', b.confirm ?? null, bseq, { style: b.style ?? 'normal' }, b.condition ?? null]);
            bseq += 10;
         }
      }
      let vseq = 10;
      for (const v of page.validations ?? []) {
         await c.query(
            `insert into rpx.validations (page_id, name, val_type, expression, error_msg, associated_item, when_button, seq)
             values ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [pageId, v.name, v.type, v.expression ?? null, v.error_msg, v.item ?? null, v.when_button ?? null, vseq]);
         vseq += 10;
      }
      let pseq = 10;
      for (const pr of page.processes ?? []) {
         const point = pr.point ?? (pr.type === 'form_init' ? 'before_header' : 'after_submit');
         await c.query(
            `insert into rpx.processes (app_id, page_id, region_id, name, point, proc_type, code, when_button, success_msg, error_msg, seq)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [appId, pageId, pr.region ? regionIds.get(pr.region) ?? null : null, pr.name, point, pr.type, pr.code ?? null,
             pr.when_button ?? null, pr.success_msg ?? null, pr.error_msg ?? null, pseq]);
         pseq += 10;
      }
      let brseq = 10;
      for (const b of page.branches ?? []) {
         await c.query(
            `insert into rpx.branches (page_id, point, target, when_button, seq) values ($1, 'after_submit', $2, $3, $4)`,
            [pageId, { page: b.page, items: b.items ?? {}, clear_cache: b.clear_cache ?? null }, b.when_button ?? null, brseq]);
         brseq += 10;
      }
   }

   await c.query(
      `insert into rpx.app_versions (app_id, spec, spec_hash, engine_version, imported_by) values ($1, $2, $3, $4, $5)`,
      [appId, specText, hash, ENGINE_VERSION, importedBy]);
   await c.query(`select pg_notify('rpx_app_changed', $1)`, [appId]);
   return { appId, pages: spec.pages.length, regions, items, replaced: app.rows[0].replaced };
}

export function readSpecFile(path: string): string {
   return readFileSync(path, 'utf8');
}
