import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { translateBinds } from '../engine/bind.ts';
import { attrIf, html, raw, type SafeHtml } from '../engine/html.ts';
import { alert, icon } from '../engine/templates.ts';
import { exportSpec, specToYaml } from '../spec/export.ts';
import { SpecError, type AppSpec } from '../spec/import.ts';
import { humanize, tableFormPage, tableReportPage, uniqueAlias } from './generate.ts';
import { listTables, type TableInfo } from './introspect.ts';
import type { BuilderContext } from './routes.ts';
import { setFlash, StaleVersion, type DevSession } from './session.ts';
import { appUrl, shell } from './views.ts';

// S07 Create Page wizard (B4, flow F02): adds a page to an existing application. The application is exported to its
// spec, the new pages are appended, and the spec is imported again, so the result goes through the same checks and
// lands in the version history like any other change.

export type PageKind = 'report_form' | 'report' | 'form' | 'blank';
const KINDS: { kind: PageKind; title: string; text: string }[] = [
   { kind: 'report_form', title: 'Report + form', text: 'Interactive Report dari tabel, dengan form dialog untuk tambah, ubah, dan hapus. Memakai dua nomor halaman.' },
   { kind: 'report', title: 'Report', text: 'Interactive Report dari tabel atau query SQL, hanya baca.' },
   { kind: 'form', title: 'Form', text: 'Form untuk satu baris tabel: tambah, ubah, hapus.' },
   { kind: 'blank', title: 'Halaman kosong', text: 'Satu region teks; isinya diubah lewat spec atau Page Designer.' },
];
const PAGE_MAX = 99999;

export interface PagesContext extends BuilderContext {
   importText: (s: DevSession, text: string, expect?: { alias: string; hash: string | null }) => Promise<{ pages: number }>;
   importedBy: (s: DevSession) => string;
   findApp: (s: DevSession, alias: string) => Promise<{ id: string; alias: string; name: string; parsingSchema: string }>;
}

export interface PageForm {
   kind: PageKind; name: string; page: string; source: 'table' | 'sql'; table: string; sql: string;
   modal: boolean; nav: boolean; returnPage: string;
}

interface SqlColumn { name: string; type: string }

const TYPE_BY_OID: Record<number, string> = { 20: 'integer', 21: 'integer', 23: 'integer', 700: 'number', 701: 'number', 1700: 'number', 1082: 'date', 1114: 'timestamp', 1184: 'timestamp', 16: 'boolean' };

/** Runs the query with every bind null and no rows, as the workspace role with the app's parsing schema, to check
 *  it and read its columns. Nothing is kept: the transaction is rolled back. */
export async function describeSql(pool: pg.Pool, role: string, schema: string, sql: string): Promise<{ columns: SqlColumn[] } | { error: string }> {
   const src = sql.trim().replace(/;+\s*$/, '');
   if (!/^(select|with)\b/i.test(src)) return { error: 'Query harus diawali SELECT atau WITH.' };
   const b = translateBinds(src, 'sql', { castText: true });
   const c = await pool.connect();
   try {
      await c.query('begin');
      await c.query(`set local role ${role}`);
      await c.query(`select set_config('search_path', $1, true), set_config('statement_timeout', '5s', true)`, [schema]);
      const r = await c.query({ text: `select * from (${b.text}\n) q limit 0`, values: b.names.map(() => null) });
      const names = r.fields.map(f => f.name);
      const bad = names.filter(n => !/^[a-z_][a-z0-9_]*$/i.test(n));
      if (bad.length) return { error: `Beri alias yang sederhana (huruf, angka, garis bawah) pada kolom: ${bad.join(', ')}.` };
      const dup = names.filter((n, i) => names.findIndex(x => x.toLowerCase() === n.toLowerCase()) !== i);
      if (dup.length) return { error: `Nama kolom ganda: ${[...new Set(dup)].join(', ')}. Beri alias yang berbeda.` };
      return { columns: r.fields.map(f => ({ name: f.name, type: TYPE_BY_OID[f.dataTypeID] ?? 'text' })) };
   } catch (e) {
      return { error: `Query tidak bisa dijalankan: ${(e as Error).message}` };
   } finally {
      await c.query('rollback').catch(() => {});
      c.release();
   }
}

function sqlReportPage(page: number, alias: string, label: string, sql: string, columns: SqlColumn[]): Record<string, unknown> {
   return {
      page, alias, name: label,
      regions: [{
         static_id: 'daftar', title: label, type: 'interactive_report', empty_text: 'Tidak ada data.',
         source: { sql: `${sql.trim().replace(/;+\s*$/, '')}\n` },
         columns: columns.map(c => {
            const col: Record<string, unknown> = { name: c.name.toUpperCase(), label: humanize(c.name.toLowerCase()) };
            if (c.type === 'integer') Object.assign(col, { data_type: 'number', format: 'integer' });
            else if (c.type === 'number') Object.assign(col, { data_type: 'number', format: 'number' });
            else if (c.type === 'date') Object.assign(col, { data_type: 'date', format: 'date' });
            else if (c.type === 'timestamp') Object.assign(col, { data_type: 'timestamp', format: 'datetime' });
            else if (c.type === 'boolean') col.data_type = 'boolean';
            return col;
         }),
      }],
   };
}

function blankPage(page: number, alias: string, name: string): Record<string, unknown> {
   return {
      page, alias, name,
      regions: [{ static_id: 'konten', title: name, type: 'static', source: { html: '<p>Halaman ini masih kosong.</p>' } }],
   };
}

// ---------------------------------------------------------------- view

interface ViewData { app: { alias: string; name: string; parsingSchema: string }; pages: { page: number; name: string }[]; tables: TableInfo[]; nextPage: number }

export function pageWizardView(dev: DevSession, d: ViewData, f: PageForm, e: Record<string, string>, problems: string[] = []): SafeHtml {
   const err = (k: string) => e[k] ? html`<p class="r-error-text" id="${k}-err">${e[k]}</p>` : html``;
   const inv = (k: string, help?: string) => {
      const ids = [help, e[k] ? `${k}-err` : ''].filter(Boolean).join(' ');
      return raw(`${e[k] ? ' aria-invalid="true"' : ''}${ids ? ` aria-describedby="${ids}"` : ''}`);
   };
   const all = Object.values(e);
   const summary = all.length || problems.length
      ? alert('danger', problems.length ? 'Halaman tidak dapat ditambahkan' : all.length === 1 ? all[0] : 'Periksa isian berikut',
         problems.length || all.length > 1 ? html`<ul class="r-problems">${(problems.length ? problems : all).map(p => html`<li>${p}</li>`)}</ul>` : undefined,
         raw(' tabindex="-1" data-error-summary'))
      : html``;
   const tableOpt = (t: TableInfo) => {
      const note = t.build === 'form' ? '' : t.build === 'report' ? ' (report saja)' : ' (tidak bisa)';
      return html`<option value="${t.name}"${attrIf('selected', t.name === f.table)}${attrIf('disabled', t.build === 'none')}>${t.name}${note}</option>`;
   };
   const reasons = d.tables.filter(t => t.reason && t.build !== 'form');
   const body = html`<form class="r-builder-stack" method="post" action="${appUrl(d.app.alias)}/pages/new" novalidate data-page-wizard>
  <input type="hidden" name="__csrf" value="${dev.csrf}">
  ${summary}
  <fieldset class="r-region r-kind-picker"${inv('kind')}>
    <legend class="r-region__title">Jenis halaman</legend>
    <div class="r-kind-picker__options">${KINDS.map(k => html`<label class="r-kind">
      <input type="radio" name="kind" value="${k.kind}" aria-labelledby="kind-${k.kind}" aria-describedby="kind-${k.kind}-text"${attrIf('checked', f.kind === k.kind)}>
      <span class="r-kind__title" id="kind-${k.kind}">${k.title}</span><span class="r-kind__text" id="kind-${k.kind}-text">${k.text}</span></label>`)}</div>
    ${err('kind')}
  </fieldset>
  <section class="r-region" aria-labelledby="page-title">
    <div class="r-region__header"><h2 class="r-region__title" id="page-title">Halaman</h2></div>
    <div class="r-region__body"><div class="r-form">
      <div class="r-field r-col-8"><label class="r-label" for="name">Nama halaman</label>
        <input class="r-input" id="name" name="name" maxlength="120" value="${f.name}"${inv('name', 'name-help')}>
        <p class="r-help" id="name-help">Kosongkan untuk memakai nama tabel.</p>${err('name')}</div>
      <div class="r-field r-col-4"><label class="r-label" for="page">Nomor halaman <span class="r-label__req" aria-hidden="true">*</span></label>
        <input class="r-input" id="page" name="page" inputmode="numeric" required value="${f.page}"${inv('page', 'page-help')}>
        <p class="r-help" id="page-help">Report + form juga memakai nomor berikutnya untuk form. Terakhir dipakai: ${d.nextPage - 1}.</p>${err('page')}</div>
    </div></div>
  </section>
  <section class="r-region" aria-labelledby="source-title" data-show-for="report_form report form">
    <div class="r-region__header"><h2 class="r-region__title" id="source-title">Sumber data</h2></div>
    <div class="r-region__body"><div class="r-form">
      <fieldset class="r-field r-fieldset r-col-12" data-show-for="report">
        <legend class="r-label">Ambil dari</legend>
        <div class="r-choice-group r-choice-group--inline">
          <label class="r-choice"><input type="radio" name="source" value="table"${attrIf('checked', f.source === 'table')}> Tabel</label>
          <label class="r-choice"><input type="radio" name="source" value="sql"${attrIf('checked', f.source === 'sql')}> Query SQL</label>
        </div>
      </fieldset>
      <div class="r-field r-col-12" data-show-for="report_form report form" data-show-source="table">
        <label class="r-label" for="table">Tabel di skema ${d.app.parsingSchema}</label>
        <select class="r-input r-mono" id="table" name="table"${inv('table', reasons.length ? 'table-help' : undefined)}>
          <option value="">- Pilih tabel -</option>${d.tables.map(tableOpt)}</select>
        ${reasons.length ? html`<details class="r-help" id="table-help"><summary>Kenapa ada tabel yang hanya report atau tidak bisa?</summary>
           <ul>${reasons.map(t => html`<li><span class="r-mono">${t.name}</span>: ${t.reason}</li>`)}</ul></details>` : ''}
        ${err('table')}
      </div>
      <div class="r-field r-col-12" data-show-for="report" data-show-source="sql">
        <label class="r-label" for="sql">Query SQL</label>
        <textarea class="r-input r-mono r-spec-text r-sql-text" id="sql" name="sql" rows="8" spellcheck="false"${inv('sql', 'sql-help')}>${f.sql}</textarea>
        <p class="r-help" id="sql-help">SELECT atau WITH. Bind item seperti <code>:P1_CARI</code> boleh dipakai. Query dicoba sebagai role workspace dengan skema ${d.app.parsingSchema}, tanpa mengambil data.</p>
        ${err('sql')}
      </div>
    </div></div>
  </section>
  <section class="r-region" aria-labelledby="opt-title">
    <div class="r-region__header"><h2 class="r-region__title" id="opt-title">Opsi</h2></div>
    <div class="r-region__body"><div class="r-form">
      <div class="r-field r-col-12"><label class="r-choice"><input type="checkbox" name="nav" value="1"${attrIf('checked', f.nav)}> Tambahkan ke menu navigasi</label></div>
      <div class="r-field r-col-12" data-show-for="form"><label class="r-choice"><input type="checkbox" name="modal" value="1"${attrIf('checked', f.modal)}> Buka sebagai dialog</label></div>
      <div class="r-field r-col-6" data-show-for="form"><label class="r-label" for="returnPage">Setelah simpan atau batal, kembali ke</label>
        <select class="r-input" id="returnPage" name="returnPage"${inv('returnPage')}>${d.pages.map(p => html`<option value="${p.page}"${attrIf('selected', String(p.page) === f.returnPage)}>${p.page}. ${p.name}</option>`)}</select>${err('returnPage')}</div>
    </div></div>
  </section>
  <div class="r-form-actions">
    <a class="r-btn" href="${appUrl(d.app.alias)}">Batal</a>
    <button type="submit" class="r-btn r-btn--primary">${icon('plus')} Tambah halaman</button>
  </div>
</form>`;
   return shell({ dev, section: 'apps', title: 'Tambah halaman', crumbs: [{ label: 'Aplikasi', href: '/builder/apps' }, { label: d.app.name, href: appUrl(d.app.alias) }], body });
}

// ---------------------------------------------------------------- routes

export function registerPages(app: FastifyInstance, ctx: PagesContext): void {
   const { pool, send } = ctx;

   async function load(s: DevSession, alias: string) {
      const a = await ctx.findApp(s, alias);
      const role = (await pool.query('select db_role from rpx.workspaces where id = $1', [s.workspaceId])).rows[0].db_role as string;
      // the version first: if the app changes between these two reads, saving fails safe (StaleVersion)
      const version = String((await pool.query('select spec_hash from rpx.applications where id = $1', [a.id])).rows[0].spec_hash);
      const spec = await exportSpec(pool, s.workspace, a.alias);
      const tables = await listTables(pool, a.parsingSchema, role);
      const pages = spec.pages.map(p => ({ page: p.page, name: p.name })).sort((x, y) => x.page - y.page);
      const nextPage = Math.max(0, ...pages.map(p => p.page)) + 1;
      return { a, role, version, spec, tables, pages, nextPage, view: { app: a, pages, tables, nextPage } as ViewData };
   }

   app.get('/builder/apps/:alias/pages/new', async (req, reply) => {
      const s = await ctx.dev(req, reply);
      if (!s) return reply;
      const d = await load(s, (req.params as { alias: string }).alias);
      const q = req.query as Record<string, string>;
      const kind = KINDS.some(k => k.kind === q.kind) ? q.kind as PageKind : 'report_form';
      const f: PageForm = {
         kind, name: '', page: String(d.nextPage), source: 'table', table: '', sql: '', modal: true, nav: kind !== 'form',
         returnPage: String(d.spec.home_page ?? d.pages[0]?.page ?? 1),
      };
      return send(reply, pageWizardView(s, d.view, f, {}));
   });

   app.post('/builder/apps/:alias/pages/new', async (req, reply) => {
      const s = await ctx.dev(req, reply);
      if (!s) return reply;
      const d = await load(s, (req.params as { alias: string }).alias);
      const b = req.body as Record<string, string>;
      const f: PageForm = {
         kind: (KINDS.some(k => k.kind === b.kind) ? b.kind : '') as PageKind,
         name: String(b.name ?? '').trim(), page: String(b.page ?? '').trim(), source: b.source === 'sql' ? 'sql' : 'table',
         table: String(b.table ?? ''), sql: String(b.sql ?? '').replace(/\r\n/g, '\n'), modal: b.modal === '1', nav: b.nav === '1',
         returnPage: String(b.returnPage ?? ''),
      };
      const e: Record<string, string> = {};
      const used = new Set(d.pages.map(p => p.page));
      if (!f.kind) e.kind = 'Pilih jenis halaman.';
      const no = /^\d{1,5}$/.test(f.page) ? Number(f.page) : NaN;
      const needs = f.kind === 'report_form' ? [no, no + 1] : [no];
      if (!(no >= 1 && no <= PAGE_MAX - 1)) e.page = `Nomor halaman harus angka 1–${PAGE_MAX - 1}.`;
      else if (needs.some(n => used.has(n))) e.page = `Nomor ${needs.filter(n => used.has(n)).join(' dan ')} sudah dipakai. Nomor bebas berikutnya: ${d.nextPage}.`;
      if (f.name.length > 120) e.name = 'Nama halaman paling panjang 120 karakter.';

      const fromTable = f.kind === 'report_form' || f.kind === 'form' || (f.kind === 'report' && f.source === 'table');
      const t = d.tables.find(x => x.name === f.table);
      if (fromTable) {
         if (!f.table) e.table = 'Pilih tabel.';
         else if (!t) e.table = `Tabel "${f.table}" tidak ada di skema ${d.a.parsingSchema}.`;
         else if (f.kind === 'report' ? t.build === 'none' : t.build !== 'form') e.table = `${t.name}: ${t.reason ?? 'tidak bisa dipakai.'}`;
      }
      let columns: SqlColumn[] = [];
      if (f.kind === 'report' && f.source === 'sql') {
         if (!f.sql.trim()) e.sql = 'Query SQL wajib diisi.';
         else {
            const r = await describeSql(pool, d.role, d.a.parsingSchema, f.sql);
            if ('error' in r) e.sql = r.error;
            else columns = r.columns;
         }
      }
      if (f.kind === 'form' && !used.has(Number(f.returnPage))) e.returnPage = 'Pilih halaman yang ada.';
      if (!f.name && !(fromTable && t) && !e.kind) e.name = 'Nama halaman wajib diisi bila tidak memakai tabel.';
      if (Object.keys(e).length) return send(reply, pageWizardView(s, d.view, f, e), 422);

      // ---- build and append
      const spec = d.spec as AppSpec & Record<string, unknown>;
      const label = f.name || humanize(t!.name);
      const aliases = new Set(spec.pages.map(p => p.alias).filter((x): x is string => !!x));
      const alias = uniqueAlias(f.name || t?.name || `halaman-${no}`, aliases);
      const lovs = (spec.lovs ??= {}) as Record<string, unknown>;
      const added: Record<string, unknown>[] = [];
      if (f.kind === 'report_form') {
         added.push(tableReportPage(t!, no, { alias, label, formPage: no + 1 }));
         added.push(tableFormPage(t!, no + 1, { alias: uniqueAlias(`${alias}-form`, aliases), label, returnPage: no, modal: true, lovs }));
      } else if (f.kind === 'report') {
         added.push(f.source === 'sql' ? sqlReportPage(no, alias, label, f.sql, columns) : tableReportPage(t!, no, { alias, label }));
      } else if (f.kind === 'form') {
         added.push(tableFormPage(t!, no, { alias, label, returnPage: Number(f.returnPage), modal: f.modal, lovs }));
      } else {
         added.push(blankPage(no, alias, label));
      }
      if (!Object.keys(lovs).length) delete spec.lovs;
      spec.pages.push(...(added as unknown as AppSpec['pages']));
      if (f.nav) (spec.navigation ??= []).push({ label, icon: f.kind === 'blank' ? 'file-text' : 'list', page: no } as never);

      try {
         await ctx.importText(s, specToYaml(spec, { workspace: s.workspace, exportedBy: ctx.importedBy(s) }), { alias: d.a.alias, hash: d.version });
      } catch (err) {
         if (err instanceof SpecError) return send(reply, pageWizardView(s, d.view, f, {}, err.problems), 422);
         if (err instanceof StaleVersion) {
            const fresh = await load(s, d.a.alias);
            return send(reply, pageWizardView(s, fresh.view, f, {}, ['Aplikasi baru saja diubah (di tab lain atau oleh developer lain), jadi halaman belum ditambahkan. Periksa nomor halaman lalu kirim lagi.']), 409);
         }
         throw err;
      }
      const nums = added.map(p => p.page as number);
      await setFlash(pool, s, { kind: 'success', text: nums.length > 1 ? `Halaman ${nums.join(' dan ')} (${label}) ditambahkan.` : `Halaman ${nums[0]} (${label}) ditambahkan.` });
      return reply.redirect(appUrl(d.a.alias), 303);
   });
}
