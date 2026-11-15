import type pg from 'pg';
import YAML from 'yaml';
import type {
   AppSpec, AuthzSpec, BranchSpec, ButtonSpec, ColumnSpec, ComputationSpec, Condition, ItemSpec, LovSpec, NavSpec,
   PageSpec, ProcessSpec, RegionSpec, ValidationSpec,
} from './import.ts';
import { ENGINE_VERSION, SpecError } from './import.ts';

// Export: rebuild the spec from the metadata tables (not from the last imported text), so that whatever changes
// the metadata later (the builder) can be exported, versioned and imported again. Values equal to what import
// would assume are left out, so an exported spec reads like a hand-written one.
//
// Contract (test/export.test.ts): import(export(app)) writes exactly the same metadata rows as the app had.

type Row = Record<string, any>;

/** Remove undefined / null keys (and empty objects or arrays) so the YAML stays small. */
function clean<T extends object>(o: T): T {
   for (const [k, v] of Object.entries(o)) {
      if (v === undefined || v === null || (Array.isArray(v) && !v.length)
          || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length)) {
         delete (o as Row)[k];
      }
   }
   return o;
}
const unless = <T>(v: T, dflt: T): T | undefined => (v === dflt ? undefined : v);
const cond = (c: unknown): Condition | undefined => (c ? (c as Condition) : undefined);

export async function exportSpec(c: pg.PoolClient | pg.Pool, workspace: string, alias: string): Promise<AppSpec> {
   const a = await c.query(
      `select a.* from rpx.applications a join rpx.workspaces w on w.id = a.workspace_id where w.name = $1 and a.alias = $2`,
      [workspace, alias]);
   if (!a.rowCount) throw new SpecError([`application "${alias}" does not exist in workspace "${workspace}"`]);
   const app: Row = a.rows[0];
   const q = async (sql: string) => (await c.query(sql, [app.id])).rows as Row[];

   const authzRows = await q('select * from rpx.authz_schemes where app_id = $1 order by name');
   const authzName = new Map(authzRows.map(r => [r.id as string, r.name as string]));
   const authzOf = (id: string | null) => (id ? authzName.get(id) : undefined);

   const lovRows = await q('select * from rpx.lovs where app_id = $1 order by name');
   const lovEntries = await q('select e.* from rpx.lov_entries e join rpx.lovs l on l.id = e.lov_id where l.app_id = $1 order by e.seq');
   const lovName = new Map(lovRows.map(r => [r.id as string, r.name as string]));

   const pages = await q('select * from rpx.pages where app_id = $1 order by page_no');
   const regions = await q('select r.* from rpx.regions r join rpx.pages p on p.id = r.page_id where p.app_id = $1 order by r.seq');
   const columns = await q(`select c.* from rpx.region_columns c join rpx.regions r on r.id = c.region_id
                            join rpx.pages p on p.id = r.page_id where p.app_id = $1 order by c.seq`);
   const items = await q('select * from rpx.items where app_id = $1 order by seq, name');
   const buttons = await q('select b.* from rpx.buttons b join rpx.pages p on p.id = b.page_id where p.app_id = $1 order by b.seq');
   const validations = await q('select v.* from rpx.validations v join rpx.pages p on p.id = v.page_id where p.app_id = $1 order by v.seq');
   const processes = await q('select * from rpx.processes where app_id = $1 order by seq');
   const branches = await q('select b.* from rpx.branches b join rpx.pages p on p.id = b.page_id where p.app_id = $1 order by b.seq');
   const computations = await q('select * from rpx.computations where app_id = $1 order by seq');
   const auth = (await q('select * from rpx.auth_schemes where app_id = $1 and is_current'))[0];
   const navList = (await q(`select id from rpx.nav_lists where app_id = $1 and name = 'navigation_menu'`))[0];
   const nav = navList ? (await c.query('select * from rpx.nav_entries where list_id = $1 order by seq', [navList.id])).rows as Row[] : [];

   const computation = (r: Row, dfltPoint: string): ComputationSpec => clean({
      item: r.item_name, point: unless(r.point, dfltPoint), type: r.comp_type, expression: r.expression, condition: cond(r.condition),
   });

   const lov = (l: Row | null): LovSpec | undefined => (l ? clean({ static: l.static, sql: l.sql, null_display: l.null_display }) : undefined);

   const item = (r: Row): ItemSpec => {
      const at: Row = r.attributes ?? {};
      return clean({
         name: r.name, type: r.item_type, label: r.label ?? undefined,
         help: at.help, placeholder: at.placeholder, required: r.is_required || undefined,
         col_span: unless(r.grid?.col_span ?? 12, 12),
         source: r.source ? clean({ column: r.source.column, pk: r.source.pk || undefined }) : undefined,
         default: r.default_value?.value,
         lov: r.lov_id ? lovName.get(r.lov_id) : lov(r.inline_lov),
         protection: unless(r.protection, 'checksum_session'),
         max_length: at.max_length, authorization: authzOf(r.authz_scheme_id), condition: cond(r.condition),
         cascade: r.cascade_parents?.length ? r.cascade_parents : undefined,
         null_display: at.null_display, on_value: at.on_value, off_value: at.off_value, inline: at.inline || undefined,
         format: r.format_mask ?? undefined, read_only: cond(at.read_only),
      } as ItemSpec);
   };

   const column = (r: Row): ColumnSpec => clean({
      name: r.name, label: unless(r.label, r.name), data_type: unless(r.data_type, 'text'), is_pk: r.is_pk || undefined,
      hidden: r.hidden || undefined, link: r.link ?? undefined, searchable: unless(r.searchable, true),
      sortable: unless(r.sortable, true), format: r.format_mask ?? undefined,
   } as ColumnSpec);

   const button = (r: Row): ButtonSpec => clean({
      name: r.name, label: r.label, hot: r.is_hot || undefined, action: unless(r.action, 'submit'), target: r.target ?? undefined,
      style: unless(r.attributes?.style ?? 'normal', 'normal'), confirm: r.confirm_msg ?? undefined,
      position: unless(r.position, 'next'), condition: cond(r.condition), authorization: authzOf(r.authz_scheme_id),
   } as ButtonSpec);

   const region = (r: Row): RegionSpec => {
      const at: Row = r.attributes ?? {};
      const source = r.source === null ? undefined
         : r.source_type === 'sql' ? { sql: r.source } : r.source_type === 'table' ? { table: r.source } : { html: r.source };
      return clean({
         static_id: r.static_id, title: at.title ?? undefined, type: r.region_type, template: unless(r.template, 'standard'),
         sort: at.sort ? clean({ column: at.sort.column, dir: unless(at.sort.dir, 'asc') }) : undefined,
         chart: at.chart ?? undefined, max_download_rows: unless(at.max_download_rows ?? 10000, 10000),
         col_span: unless(r.grid?.col_span ?? 12, 12), new_row: unless(r.grid?.new_row ?? true, true),
         source, page_size: unless(at.page_size ?? 15, 15), empty_text: at.empty_text ?? undefined,
         columns: columns.filter(x => x.region_id === r.id).map(column),
         items: items.filter(x => x.region_id === r.id).map(item),
         buttons: buttons.filter(x => x.region_id === r.id).map(button),
         condition: cond(r.condition), authorization: authzOf(r.authz_scheme_id),
      } as RegionSpec);
   };

   const authScheme: string = auth?.scheme_type ?? 'builtin_accounts';
   const page = (p: Row): PageSpec => {
      const at: Row = p.attributes ?? {};
      const regionStatic = new Map(regions.filter(r => r.page_id === p.id).map(r => [r.id as string, r.static_id as string]));
      return clean({
         page: p.page_no, alias: p.alias ?? undefined, name: p.name, title: p.title ?? undefined,
         // import makes every page public under no_auth, so the flag only carries meaning otherwise
         requires_auth: authScheme === 'no_auth' ? undefined : unless(p.requires_auth, true),
         breadcrumb_parent: at.breadcrumb_parent ?? undefined, mode: unless(p.page_mode, 'normal'),
         dialog_size: unless(at.dialog_size ?? 'md', 'md'), authorization: authzOf(p.authz_scheme_id),
         regions: regions.filter(r => r.page_id === p.id).map(region),
         computations: computations.filter(x => x.page_id === p.id).map(x => computation(x, 'before_header')),
         validations: validations.filter(v => v.page_id === p.id).map(v => clean({
            name: v.name, type: v.val_type, expression: v.expression ?? undefined, error_msg: v.error_msg,
            item: v.associated_item ?? undefined, when_button: v.when_button ?? undefined, condition: cond(v.condition),
         } as ValidationSpec)),
         processes: processes.filter(x => x.page_id === p.id).map(x => clean({
            name: x.name, point: unless(x.point, x.proc_type === 'form_init' ? 'before_header' : 'after_submit'), type: x.proc_type,
            region: x.region_id ? regionStatic.get(x.region_id) : undefined, code: x.code ?? undefined,
            when_button: x.when_button ?? undefined, success_msg: x.success_msg ?? undefined, error_msg: x.error_msg ?? undefined,
            condition: cond(x.condition),
         } as ProcessSpec)),
         branches: branches.filter(b => b.page_id === p.id).map(b => clean({
            page: b.target.page, items: b.target.items, clear_cache: b.target.clear_cache ?? undefined,
            when_button: b.when_button ?? undefined, condition: cond(b.condition),
         } as BranchSpec)),
      } as PageSpec);
   };

   const navTree = (parent: string | null): NavSpec[] => nav.filter(n => n.parent_id === parent).map(n => clean({
      label: n.label, icon: n.icon ?? undefined, page: n.target?.page, url: n.target?.page === undefined ? n.target?.url : undefined,
      children: navTree(n.id), authorization: authzOf(n.authz_scheme_id), condition: cond(n.condition),
   } as NavSpec));

   const authentication = (): AppSpec['authentication'] => {
      if (authScheme === 'builtin_accounts') return undefined;
      if (authScheme !== 'oidc') return authScheme;
      const { allow_builtin, ...oidc } = auth.attributes ?? {};
      return clean({ scheme: 'oidc' as const, oidc: clean(oidc), allow_builtin: allow_builtin || undefined });
   };

   const shared: Record<string, LovSpec> = {};
   for (const l of lovRows) {
      shared[l.name] = clean({
         static: l.lov_type === 'static' ? lovEntries.filter(e => e.lov_id === l.id).map(e => ({ display: e.display_value, return: e.return_value })) : undefined,
         sql: l.lov_type === 'sql' ? l.source : undefined,
         null_display: l.attributes?.null_display ?? undefined,
      });
   }

   return clean({
      app: app.alias, name: app.name, version: app.version, parsing_schema: app.parsing_schema,
      home_page: app.home_page_no, timezone: app.globalization?.timezone, substitutions: app.substitutions,
      authentication: authentication(),
      authorization_scheme: authzOf(app.authz_scheme_id),
      authorization: authzRows.map(r => clean({
         name: r.name, type: r.scheme_type, source: r.source, evaluation: unless(r.evaluation, 'once_per_session'),
         error_msg: unless(r.error_msg, 'Anda tidak memiliki akses ke bagian ini.'),
      } as AuthzSpec)),
      application_items: items.filter(i => i.item_type === 'app_item').map(i => clean({ name: i.name, protection: unless(i.protection, 'restricted') })),
      computations: computations.filter(x => x.page_id === null).map(x => computation(x, 'on_new_session')),
      lovs: shared,
      navigation: navTree(null),
      pages: pages.map(page),
   } as AppSpec);
}

/** The spec as YAML, with a header saying where and when it came from. */
export function specToYaml(spec: AppSpec, from: { workspace: string; exportedBy: string; at?: Date }): string {
   const at = (from.at ?? new Date()).toISOString().replace(/\.\d+Z$/, 'Z');
   const doc = new YAML.Document(spec);
   // short maps and lists of scalars on one line ({ name: P2_ID, type: hidden, ... }), like a hand-written spec
   YAML.visit(doc, {
      Map(_, node) { if (fitsOnOneLine(node)) node.flow = true; },
      Seq(_, node) { if (fitsOnOneLine(node)) node.flow = true; },
   });
   const body = doc.toString({ lineWidth: 0, blockQuote: 'literal', flowCollectionPadding: true });
   return `# ${spec.name}: diekspor dari pandawapex ${ENGINE_VERSION}, workspace ${from.workspace}, oleh ${from.exportedBy}, ${at}\n`
      + `# Impor lagi dengan: rpx app import <file> --ws <workspace>   (atau Builder > Aplikasi > Impor)\n${body}`;
}

const FLOW_MAX = 110;
/** A map or list whose values are short scalars (or such small maps), not containing a line break, and short in total. */
function fitsOnOneLine(node: YAML.YAMLMap | YAML.YAMLSeq): boolean {
   const small = (n: unknown): boolean => {
      if (YAML.isScalar(n)) return typeof n.value !== 'string' || !n.value.includes('\n');
      if (YAML.isMap(n)) return n.items.every(p => small(p.value));
      if (YAML.isSeq(n)) return n.items.every(small);
      return false;
   };
   if (!small(node) || !node.items.length) return false;
   return JSON.stringify(node.toJSON()).length <= FLOW_MAX;
}
