import type pg from 'pg';

// In-memory application definition, loaded from rpx.* and cached per spec_hash.

export interface Target { page: number; items?: Record<string, string>; clear_cache?: string | null }
export interface Condition { item_not_null?: string; item_null?: string }

export interface ItemDef {
   id: string; name: string; type: string; label: string | null; regionId: string | null;
   colSpan: number; required: boolean; protection: string;
   column: string | null; pk: boolean; defaultValue: string | null;
   lov: { static?: { display: string; return: string }[]; sql?: string; null_display?: string } | null;
   help: string | null; placeholder: string | null; maxLength: number | null;
}
export interface ButtonDef {
   name: string; label: string; action: string; target: Target | null; hot: boolean; position: string;
   confirm: string | null; style: string; regionId: string | null; condition: Condition | null;
}
export interface ColumnDef { name: string; label: string; dataType: string; isPk: boolean; hidden: boolean; link: Target | null }
export interface RegionDef {
   id: string; staticId: string; type: string; title: string | null; sourceType: string | null; source: string | null;
   template: string; colSpan: number; newRow: boolean; pageSize: number; emptyText: string | null;
   columns: ColumnDef[]; items: ItemDef[]; buttons: ButtonDef[]; condition: Condition | null;
}
export interface ValidationDef { name: string; type: string; expression: string | null; errorMsg: string; item: string | null; whenButton: string | null }
export interface ProcessDef {
   name: string; point: string; type: string; regionId: string | null; code: string | null;
   whenButton: string | null; successMsg: string | null; errorMsg: string | null;
}
export interface BranchDef { target: Target; whenButton: string | null }
export interface PageDef {
   id: string; no: number; alias: string | null; name: string; title: string | null; requiresAuth: boolean;
   breadcrumbParent: number | null; regions: RegionDef[]; items: ItemDef[]; buttons: ButtonDef[];
   validations: ValidationDef[]; processes: ProcessDef[]; branches: BranchDef[];
}
export interface NavDef { label: string; icon: string | null; target: { page?: number; url?: string }; children: NavDef[] }
export interface OidcConfig {
   issuer: string; clientId: string; clientSecretEnv: string; scopes: string; usernameClaim: string;
   groupsClaim: string | null; allowedDomains: string[]; provision: boolean; buttonLabel: string; allowBuiltin: boolean;
}
export interface AppDef {
   id: string; workspaceId: string; workspace: string; dbRole: string; alias: string; name: string; version: string;
   parsingSchema: string; homePage: number; specHash: string; timezone: string; authScheme: string;
   oidc: OidcConfig | null;
   sessionTimeoutSec: number; idleTimeoutSec: number;
   substitutions: Record<string, string>; pages: Map<number, PageDef>; pageAliases: Map<string, number>;
   itemsByName: Map<string, { item: ItemDef; page: number | null }>; nav: NavDef[];
}

const cache = new Map<string, AppDef>();

export async function loadApp(pool: pg.Pool, workspace: string, alias: string): Promise<AppDef | null> {
   const head = await pool.query(
      `select a.id, a.spec_hash from rpx.applications a join rpx.workspaces w on w.id = a.workspace_id
       where w.name = $1 and a.alias = $2`, [workspace, alias]);
   if (!head.rowCount) return null;
   const key = `${workspace}/${alias}`;
   const cached = cache.get(key);
   if (cached && cached.specHash === head.rows[0].spec_hash && cached.id === head.rows[0].id) return cached;
   const app = await readApp(pool, head.rows[0].id);
   cache.set(key, app);
   return app;
}

async function readApp(pool: pg.Pool, appId: string): Promise<AppDef> {
   const a = (await pool.query(
      `select a.*, w.name as ws_name, w.db_role
            , extract(epoch from a.session_timeout)::int as st, extract(epoch from a.idle_timeout)::int as it
            , (select scheme_type from rpx.auth_schemes s where s.app_id = a.id and s.is_current) as auth
            , (select attributes from rpx.auth_schemes s where s.app_id = a.id and s.is_current) as auth_attrs
       from rpx.applications a join rpx.workspaces w on w.id = a.workspace_id where a.id = $1`, [appId])).rows[0];
   const pagesQ = (await pool.query('select * from rpx.pages where app_id = $1 order by page_no', [appId])).rows;
   const regionsQ = (await pool.query(
      `select r.* from rpx.regions r join rpx.pages p on p.id = r.page_id where p.app_id = $1 order by r.seq`, [appId])).rows;
   const colsQ = (await pool.query(
      `select c.* from rpx.region_columns c join rpx.regions r on r.id = c.region_id join rpx.pages p on p.id = r.page_id
       where p.app_id = $1 order by c.seq`, [appId])).rows;
   const itemsQ = (await pool.query('select * from rpx.items where app_id = $1 order by seq', [appId])).rows;
   const btnQ = (await pool.query(
      `select b.* from rpx.buttons b join rpx.pages p on p.id = b.page_id where p.app_id = $1 order by b.seq`, [appId])).rows;
   const valQ = (await pool.query(
      `select v.* from rpx.validations v join rpx.pages p on p.id = v.page_id where p.app_id = $1 order by v.seq`, [appId])).rows;
   const procQ = (await pool.query('select * from rpx.processes where app_id = $1 order by seq', [appId])).rows;
   const brQ = (await pool.query(
      `select b.* from rpx.branches b join rpx.pages p on p.id = b.page_id where p.app_id = $1 order by b.seq`, [appId])).rows;
   const navQ = (await pool.query(
      `select e.* from rpx.nav_entries e join rpx.nav_lists l on l.id = e.list_id
       where l.app_id = $1 and l.name = 'navigation_menu' order by e.seq`, [appId])).rows;

   const item = (r: any): ItemDef => ({
      id: r.id, name: r.name, type: r.item_type, label: r.label, regionId: r.region_id,
      colSpan: r.grid?.col_span ?? 12, required: r.is_required, protection: r.protection,
      column: r.source?.column ?? null, pk: !!r.source?.pk, defaultValue: r.default_value?.value ?? null,
      lov: r.inline_lov, help: r.attributes?.help ?? null, placeholder: r.attributes?.placeholder ?? null,
      maxLength: r.attributes?.max_length ?? null,
   });
   const button = (r: any): ButtonDef => ({
      name: r.name, label: r.label, action: r.action, target: r.target, hot: r.is_hot, position: r.position,
      confirm: r.confirm_msg, style: r.attributes?.style ?? 'normal', regionId: r.region_id, condition: r.condition,
   });

   const pages = new Map<number, PageDef>();
   const pageAliases = new Map<string, number>();
   const itemsByName = new Map<string, { item: ItemDef; page: number | null }>();
   for (const p of pagesQ) {
      const items = itemsQ.filter(i => i.page_id === p.id).map(item);
      const buttons = btnQ.filter(b => b.page_id === p.id).map(button);
      const regions: RegionDef[] = regionsQ.filter(r => r.page_id === p.id).map(r => ({
         id: r.id, staticId: r.static_id, type: r.region_type, title: r.attributes?.title ?? null,
         sourceType: r.source_type, source: r.source, template: r.template,
         colSpan: r.grid?.col_span ?? 12, newRow: r.grid?.new_row ?? true,
         pageSize: r.attributes?.page_size ?? 15, emptyText: r.attributes?.empty_text ?? null,
         columns: colsQ.filter(c => c.region_id === r.id).map(c => ({
            name: c.name, label: c.label, dataType: c.data_type, isPk: c.is_pk, hidden: c.hidden, link: c.link,
         })),
         items: items.filter(i => i.regionId === r.id),
         buttons: buttons.filter(b => b.regionId === r.id),
         condition: r.condition,
      }));
      const page: PageDef = {
         id: p.id, no: p.page_no, alias: p.alias, name: p.name, title: p.title, requiresAuth: p.requires_auth,
         breadcrumbParent: p.attributes?.breadcrumb_parent ?? null, regions, items, buttons,
         validations: valQ.filter(v => v.page_id === p.id).map(v => ({
            name: v.name, type: v.val_type, expression: v.expression, errorMsg: v.error_msg,
            item: v.associated_item, whenButton: v.when_button,
         })),
         processes: procQ.filter(x => x.page_id === p.id).map(x => ({
            name: x.name, point: x.point, type: x.proc_type, regionId: x.region_id, code: x.code,
            whenButton: x.when_button, successMsg: x.success_msg, errorMsg: x.error_msg,
         })),
         branches: brQ.filter(b => b.page_id === p.id).map(b => ({ target: b.target, whenButton: b.when_button })),
      };
      pages.set(page.no, page);
      if (page.alias) pageAliases.set(page.alias, page.no);
      for (const i of items) itemsByName.set(i.name, { item: i, page: page.no });
   }
   for (const i of itemsQ.filter(i => !i.page_id)) itemsByName.set(i.name, { item: item(i), page: null });

   const buildNav = (parent: string | null): NavDef[] => navQ.filter(e => e.parent_id === parent).map(e => ({
      label: e.label, icon: e.icon, target: e.target, children: buildNav(e.id),
   }));

   return {
      id: a.id, workspaceId: a.workspace_id, workspace: a.ws_name, dbRole: a.db_role, alias: a.alias, name: a.name,
      version: a.version, parsingSchema: a.parsing_schema, homePage: a.home_page_no, specHash: a.spec_hash,
      timezone: a.globalization?.timezone ?? 'Asia/Jakarta', authScheme: a.auth ?? 'builtin_accounts',
      oidc: a.auth === 'oidc' ? {
         issuer: a.auth_attrs.issuer, clientId: a.auth_attrs.client_id, clientSecretEnv: a.auth_attrs.client_secret_env,
         scopes: a.auth_attrs.scopes ?? 'openid profile email', usernameClaim: a.auth_attrs.username_claim ?? 'preferred_username',
         groupsClaim: a.auth_attrs.groups_claim ?? null, allowedDomains: a.auth_attrs.allowed_domains ?? [],
         provision: a.auth_attrs.provision ?? true, buttonLabel: a.auth_attrs.button_label ?? 'Masuk dengan akun organisasi',
         allowBuiltin: a.auth_attrs.allow_builtin ?? false,
      } : null,
      sessionTimeoutSec: a.st, idleTimeoutSec: a.it,
      substitutions: a.substitutions ?? {}, pages, pageAliases, itemsByName, nav: buildNav(null),
   };
}
