import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type pg from 'pg';
import { importApp } from '../src/cli/commands.ts';
import { exportSpec, specToYaml } from '../src/spec/export.ts';
import { parseSpec } from '../src/spec/import.ts';
import { setup, setupPilotEnv, type Env } from './helpers.ts';

// Export rebuilds the spec from the metadata tables. The contract: importing the export writes exactly the rows
// the application had, for every table import writes. Checked on the two example apps and on a spec that uses
// every option import knows (the "kitchen sink").

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SKIP = new Set(['id', 'created_at', 'updated_at', 'spec_hash', 'locked_by', 'app_id']);

/** All metadata rows of an app, with ids replaced by stable names, sorted. */
async function snapshot(pool: pg.Pool, appId: string) {
   const tables: Record<string, string> = {
      applications: 'select * from rpx.applications where id = $1',
      authz_schemes: 'select * from rpx.authz_schemes where app_id = $1',
      auth_schemes: 'select * from rpx.auth_schemes where app_id = $1',
      lovs: 'select * from rpx.lovs where app_id = $1',
      lov_entries: 'select e.* from rpx.lov_entries e join rpx.lovs l on l.id = e.lov_id where l.app_id = $1',
      nav_lists: 'select * from rpx.nav_lists where app_id = $1',
      nav_entries: 'select e.* from rpx.nav_entries e join rpx.nav_lists l on l.id = e.list_id where l.app_id = $1',
      pages: 'select * from rpx.pages where app_id = $1',
      regions: 'select r.* from rpx.regions r join rpx.pages p on p.id = r.page_id where p.app_id = $1',
      region_columns: 'select c.* from rpx.region_columns c join rpx.regions r on r.id = c.region_id join rpx.pages p on p.id = r.page_id where p.app_id = $1',
      items: 'select * from rpx.items where app_id = $1',
      buttons: 'select b.* from rpx.buttons b join rpx.pages p on p.id = b.page_id where p.app_id = $1',
      validations: 'select v.* from rpx.validations v join rpx.pages p on p.id = v.page_id where p.app_id = $1',
      processes: 'select * from rpx.processes where app_id = $1',
      branches: 'select b.* from rpx.branches b join rpx.pages p on p.id = b.page_id where p.app_id = $1',
      computations: 'select * from rpx.computations where app_id = $1',
   };
   const rows: Record<string, any[]> = {};
   for (const [t, sql] of Object.entries(tables)) rows[t] = (await pool.query(sql, [appId])).rows;
   // stable name for every id an app row can point at
   const label = new Map<string, string>();
   const pageNo = new Map(rows.pages.map(p => [p.id, p.page_no]));
   for (const p of rows.pages) label.set(p.id, `page:${p.page_no}`);
   for (const r of rows.regions) label.set(r.id, `region:${pageNo.get(r.page_id)}/${r.static_id}`);
   for (const a of rows.authz_schemes) label.set(a.id, `authz:${a.name}`);
   for (const l of rows.lovs) label.set(l.id, `lov:${l.name}`);
   for (const l of rows.nav_lists) label.set(l.id, `navlist:${l.name}`);
   for (const e of rows.nav_entries) label.set(e.id, `nav:${e.label}@${e.seq}`);
   for (const a of rows.applications) label.set(a.id, 'app');
   for (const w of rows.applications) label.set(w.workspace_id, 'workspace');
   const norm = (v: unknown): unknown => {
      if (typeof v === 'string' && UUID.test(v)) return label.get(v) ?? `?${v}`;
      if (Array.isArray(v)) return v.map(norm);
      if (v && typeof v === 'object' && !(v instanceof Date)) {
         return Object.fromEntries(Object.keys(v).sort().map(k => [k, norm((v as Record<string, unknown>)[k])]));
      }
      return v;
   };
   const out: Record<string, string[]> = {};
   for (const [t, list] of Object.entries(rows)) {
      out[t] = list.map(r => JSON.stringify(norm(Object.fromEntries(Object.entries(r).filter(([k]) => !SKIP.has(k)))))).sort();
   }
   return out;
}

async function roundTrip(env: Env, alias: string) {
   const appId = (await env.pool.query('select id from rpx.applications where alias = $1', [alias])).rows[0].id;
   const before_ = await snapshot(env.pool, appId);
   const yaml1 = specToYaml(await exportSpec(env.pool, env.ws, alias), { workspace: env.ws, exportedBy: 'test', at: new Date(0) });
   parseSpec(yaml1);                                     // valid against the schema and the semantic checks
   await importApp(env.pool, env.ws, yaml1, 'test');
   const after_ = await snapshot(env.pool, appId);
   for (const t of Object.keys(before_)) assert.deepEqual(after_[t], before_[t], `table ${t} after re-import`);
   const yaml2 = specToYaml(await exportSpec(env.pool, env.ws, alias), { workspace: env.ws, exportedBy: 'test', at: new Date(0) });
   assert.equal(yaml2, yaml1, 'exporting again gives the same text');
   return yaml1;
}

describe('export round trip', () => {
   let emp: Env;
   let pilot: Env;
   before(async () => { [emp, pilot] = await Promise.all([setup(), setupPilotEnv()]); });
   after(async () => { await Promise.all([emp?.close(), pilot?.close()]); });

   test('example app emp (dialog, IR, M3 items, computations)', async () => {
      const yaml = await roundTrip(emp, 'emp');
      assert.match(yaml, /^# Data Karyawan: diekspor dari pandawapex/);
      assert.match(yaml, /lovs:\n  DEPARTEMEN:/);
      assert.doesNotMatch(yaml, /col_span: 12\b|template: standard|page_size: 15\b/, 'defaults are left out');
   });

   test('pilot DEMO (17 pages, shared LOVs, read-only items, charts)', async () => {
      const yaml = await roundTrip(pilot, 'demo');
      assert.match(yaml, /read_only: \{ sql_expression: "coalesce\(:P301_STATUS, 'DRAFT'\) not in \('APPROVED'/);
      assert.match(yaml, /chart: \{ type: pie, format: integer, value_label: Jumlah \}/);
      assert.match(yaml, /code: call apx_demo_approval_pkg\.approve\(p_approval_id => :P191_APPROVAL_ID::bigint/);
      assert.match(yaml, /- \{ name: P301_REQUEST_ID, type: hidden, source: \{ column: request_id, pk: true \} \}/, 'short maps on one line');
   });

   test('every option import knows (kitchen sink)', async () => {
      const spec = `app: kitchen
name: Semua opsi
version: "2.3"
parsing_schema: x
home_page: 2
timezone: Europe/Amsterdam
substitutions: { PERUSAHAAN: KCSI, TAHUN: "2026" }
authentication:
  scheme: oidc
  allow_builtin: true
  oidc: { issuer: "https://login.contoh.id", client_id: rpx, client_secret_env: RPX_OIDC_SECRET, scopes: "openid email", groups_claim: groups, allowed_domains: [kcsi.co.id], provision: true, button_label: Masuk KCSI }
authorization_scheme: semua
authorization:
  - { name: semua, type: exists_sql, source: "select 1", evaluation: always }
  - { name: admin, type: group_member, source: ADMIN, error_msg: Khusus admin. }
application_items:
  - { name: AI_A }
  - { name: AI_B, protection: unrestricted }
computations:
  - { item: AI_A, type: static, expression: "1" }
  - { item: AI_B, point: after_authentication, type: sql_query, expression: "select 2", condition: { item_null: AI_B } }
lovs:
  STATUS: { static: [ { display: Ya, return: "Y" }, { display: Tidak, return: "N" } ], null_display: "-" }
  ANGKA: { sql: "select x::text, x from generate_series(1, 3) x" }
navigation:
  - { label: Satu, icon: house, page: 1 }
  - label: Grup
    url: https://contoh.id
    authorization: admin
    condition: { never: true }
    children:
      - { label: Dua, page: 2 }
pages:
  - page: 1
    name: Satu
    alias: satu
    title: Halaman Satu
    requires_auth: false
    regions:
      - static_id: html
        type: static
        template: plain
        source: { html: "<p>halo</p>" }
        condition: { request_in: [A, B] }
      - static_id: rep
        title: Laporan
        type: classic_report
        col_span: 6
        new_row: false
        page_size: 7
        empty_text: Kosong.
        template: collapsible
        authorization: admin
        source: { sql: "select 1 as a, 'x' as b" }
        columns:
          - { name: A, data_type: number, is_pk: true, hidden: true, searchable: false, sortable: false }
          - { name: B, label: Bee, link: { page: 2, items: { P2_ID: "#A#" }, clear_cache: "2" }, format: date }
        items:
          - { name: P1_Q, type: text, label: Cari, placeholder: kata, help: bantuan, max_length: 20, protection: unrestricted, col_span: 4 }
        buttons:
          - { name: CARI, label: Cari, hot: true, position: previous, style: ghost }
  - page: 2
    name: Dua
    mode: modal
    dialog_size: lg
    breadcrumb_parent: 1
    authorization: admin
    regions:
      - static_id: f
        type: form
        source: { table: t }
        items:
          - { name: P2_ID, type: hidden, source: { column: id, pk: true }, protection: restricted }
          - { name: P2_S, type: select, label: S, lov: STATUS, null_display: "pilih", required: true, default: "Y", source: { column: s }, condition: { item_equals: { item: P2_ID, value: "1" } } }
          - { name: P2_R, type: radio, label: R, lov: { static: [ { display: A, return: a } ] }, inline: true, cascade: [P2_S], read_only: { sql_expression: "true" }, source: { column: r } }
          - { name: P2_C, type: switch, label: C, on_value: "1", off_value: "0", authorization: admin, source: { column: c } }
          - { name: P2_N, type: popup_lov, label: N, lov: { sql: "select 'a', 'a'", null_display: "--" }, source: { column: n } }
          - { name: P2_D, type: display_only, label: D, format: datetime }
        buttons:
          - { name: HAPUS, label: Hapus, style: danger, confirm: Yakin?, condition: { item_not_null: P2_ID } }
          - { name: SIMPAN, label: Simpan, hot: true }
          - { name: TUTUP, label: Tutup, action: close_dialog }
          - { name: KE1, label: Ke 1, action: redirect, position: header, target: { page: 1, items: { P1_Q: "&P2_ID." } } }
      - static_id: ir
        type: interactive_report
        max_download_rows: 50
        sort: { column: A, dir: desc }
        source: { sql: "select 1 as a" }
      - static_id: ch
        type: chart
        chart: { type: bar, format: integer, value_label: Rp }
        source: { sql: "select 'a', 1" }
    computations:
      - { item: P2_D, type: sql_expression, expression: "now()::text" }
      - { item: P2_S, point: after_submit, type: item, expression: P2_ID, condition: { request_equals: SIMPAN } }
    validations:
      - { name: v1, type: not_null, item: P2_S, error_msg: Wajib. }
      - { name: v2, type: fn_returns_error, expression: "return null;", when_button: SIMPAN }
      - { name: v3, type: regex, item: P2_S, expression: "^[YN]$", error_msg: "Y/N", condition: { sql_exists: "select 1" } }
    processes:
      - { name: ambil, type: form_init, region: f }
      - { name: simpan, type: form_dml, region: f, success_msg: Tersimpan., error_msg: Gagal. }
      - { name: kode, type: plpgsql, point: before_header, code: "perform 1;" }
      - { name: tutup, type: close_dialog, when_button: SIMPAN }
      - { name: bersih, type: clear_cache, condition: { never: true } }
    branches:
      - { page: 1, when_button: HAPUS, items: { P1_Q: "&P2_ID." }, clear_cache: "1" }
      - { page: 2 }
`;
      const env = await setup(spec);
      try {
         const yaml = await roundTrip(env, 'kitchen');
         // what a reader of the export cares about survives verbatim
         assert.match(yaml, /allow_builtin: true/);
         assert.match(yaml, /requires_auth: false/);
         assert.match(yaml, /substitutions: \{ .*PERUSAHAAN: KCSI/);    // jsonb keeps its own key order
      } finally {
         await env.close();
      }
   });
});
