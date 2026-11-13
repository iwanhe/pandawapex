import type pg from 'pg';
import { translateBinds } from './bind.ts';
import { toText } from './db.ts';
import { html, raw, type SafeHtml } from './html.ts';
import type { ColumnDef, RegionDef } from './model.ts';
import { alert, icon } from './templates.ts';
import { inSavepoint, pgMessage, type Ctx } from './usercode.ts';
import { bindValues } from './session.ts';
import { canOpen, dialogAttrs, pageUrl, targetUrl, type View } from './runtime.ts';

// Interactive report: search over all searchable columns, sort by a column, column filters, paging,
// CSV/XLSX download. The developer's SQL is wrapped, never edited: user input only ever becomes
// a bind parameter, and column names come from the query's own result (whitelist).

export interface IrFilter { col: string; op: string; val: string | null }
export interface IrState { q: string; sort: { col: string; dir: 'asc' | 'desc' } | null; filters: IrFilter[]; page: number }

const EMPTY: IrState = { q: '', sort: null, filters: [], page: 1 };
const stateKey = (r: RegionDef) => `__ir_${r.staticId}`;
const P = (r: RegionDef, k: string) => `${r.staticId}__${k}`;

type Kind = 'number' | 'date' | 'timestamp' | 'boolean' | 'text';
const NUMERIC = new Set([20, 21, 23, 26, 700, 701, 1700]);
function kindOf(oid: number): Kind {
   if (NUMERIC.has(oid)) return 'number';
   if (oid === 1082) return 'date';
   if (oid === 1114 || oid === 1184) return 'timestamp';
   if (oid === 16) return 'boolean';
   return 'text';
}

const OPS: Record<string, { label: string; kinds: Kind[]; sql: string; needsValue: boolean }> = {
   contains: { label: 'berisi', kinds: ['text'], sql: 'ilike', needsValue: true },
   eq: { label: '=', kinds: ['text', 'number', 'date', 'timestamp', 'boolean'], sql: '=', needsValue: true },
   ne: { label: '≠', kinds: ['text', 'number', 'date', 'timestamp', 'boolean'], sql: '<>', needsValue: true },
   lt: { label: '<', kinds: ['number', 'date', 'timestamp'], sql: '<', needsValue: true },
   le: { label: '≤', kinds: ['number', 'date', 'timestamp'], sql: '<=', needsValue: true },
   gt: { label: '>', kinds: ['number', 'date', 'timestamp'], sql: '>', needsValue: true },
   ge: { label: '≥', kinds: ['number', 'date', 'timestamp'], sql: '>=', needsValue: true },
   null: { label: 'kosong', kinds: ['text', 'number', 'date', 'timestamp', 'boolean'], sql: 'is null', needsValue: false },
   notnull: { label: 'tidak kosong', kinds: ['text', 'number', 'date', 'timestamp', 'boolean'], sql: 'is not null', needsValue: false },
};

interface Col extends ColumnDef { field: string; kind: Kind }

export function readState(ctx: Ctx, r: RegionDef): IrState {
   try {
      const raw_ = ctx.session.state.get(stateKey(r));
      return raw_ ? { ...EMPTY, ...JSON.parse(raw_) } : { ...EMPTY, filters: [] };
   } catch {
      return { ...EMPTY, filters: [] };
   }
}

/** Columns of the report: the declared ones (or every field), bound to the real field names and types. */
async function describe(c: pg.PoolClient, ctx: Ctx, r: RegionDef): Promise<Col[]> {
   const t = translateBinds((r.source ?? 'select 1').trim().replace(/;\s*$/, ''), 'sql', { castText: true });
   const vals = bindValues(ctx.app, ctx.session);
   const res = await c.query({ text: `select * from (${t.text}) rpx_q limit 0`, values: t.names.map(n => vals[n] ?? null), rowMode: 'array' });
   const fields = new Map(res.fields.map(f => [f.name.toUpperCase(), f]));
   const declared: ColumnDef[] = r.columns.length ? r.columns : res.fields.map(f => ({
      name: f.name.toUpperCase(), label: f.name, dataType: 'text', isPk: false, hidden: false, link: null, searchable: true, sortable: true, format: null,
   }));
   return declared.filter(d => fields.has(d.name)).map(d => {
      const f = fields.get(d.name)!;
      return { ...d, field: f.name, kind: d.dataType === 'number' ? 'number' : kindOf(f.dataTypeID) };
   });
}

const quoteField = (f: string) => `rpx_q."${f.replace(/"/g, '""')}"`;
const likeEscape = (s: string) => s.replace(/[\\%_]/g, m => `\\${m}`);

function validValue(kind: Kind, v: string): boolean {
   if (kind === 'number') return /^-?\d+([.,]\d+)?$/.test(v.trim());
   if (kind === 'date' || kind === 'timestamp') return /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/.test(v.trim());
   if (kind === 'boolean') return /^(true|false|y|n|ya|tidak|1|0)$/i.test(v.trim());
   return true;
}

/** Build the wrapped query. Returns SQL + parameters (developer binds first, then report state). */
function buildQuery(ctx: Ctx, r: RegionDef, cols: Col[], st: IrState, limit: number | null, offset: number) {
   const t = translateBinds((r.source ?? 'select 1').trim().replace(/;\s*$/, ''), 'sql', { castText: true });
   const vals = bindValues(ctx.app, ctx.session);
   const params: unknown[] = t.names.map(n => vals[n] ?? null);
   const bind = (v: unknown) => { params.push(v); return `$${params.length}`; };
   const where: string[] = [];
   const visible = cols.filter(c => !c.hidden);
   if (st.q.trim()) {
      const searchable = visible.filter(c => c.searchable);
      if (searchable.length) {
         const p = bind(`%${likeEscape(st.q.trim())}%`);
         where.push(`(${searchable.map(c => `${quoteField(c.field)}::text ilike ${p}`).join(' or ')})`);
      }
   }
   for (const f of st.filters) {
      const col = cols.find(c => c.name === f.col);
      const op = OPS[f.op];
      if (!col || !op || !op.kinds.includes(col.kind)) continue;
      const q = quoteField(col.field);
      if (!op.needsValue) { where.push(`${q} ${op.sql}`); continue; }
      const v = (f.val ?? '').trim();
      if (f.op === 'contains') where.push(`${q}::text ilike ${bind(`%${likeEscape(v)}%`)}`);
      else if (col.kind === 'number') where.push(`${q} ${op.sql} ${bind(v.replace(',', '.'))}::numeric`);
      else if (col.kind === 'date') where.push(`${q} ${op.sql} ${bind(v)}::date`);
      else if (col.kind === 'timestamp') where.push(`${q} ${op.sql} ${bind(v)}::timestamptz`);
      else if (col.kind === 'boolean') where.push(`${q} ${op.sql} ${bind(/^(true|y|ya|1)$/i.test(v))}::boolean`);
      else where.push(`${q}::text ${op.sql} ${bind(v)}`);
   }
   const sortCol = st.sort && cols.find(c => c.name === st.sort!.col && c.sortable);
   const order = sortCol ? ` order by ${quoteField(sortCol.field)} ${st.sort!.dir === 'desc' ? 'desc' : 'asc'} nulls last` : '';
   let sql = `select * from (${t.text}) rpx_q${where.length ? ` where ${where.join(' and ')}` : ''}${order}`;
   if (limit !== null) sql += ` limit ${bind(limit)} offset ${bind(offset)}`;
   return { sql, params };
}

/** Apply the report's URL parameters (search, sort, filter add/remove, page, reset) to its saved state. */
function applyParams(r: RegionDef, cols: Col[], st: IrState, q: Record<string, string>): { state: IrState; changed: boolean; problem: string | null } {
   let changed = false;
   let problem: string | null = null;
   const s: IrState = { ...st, filters: [...st.filters] };
   const get = (k: string) => q[P(r, k)];
   if (get('reset') !== undefined) return { state: { ...EMPTY, filters: [] }, changed: true, problem };
   if (get('q') !== undefined) { s.q = get('q').slice(0, 200); s.page = 1; changed = true; }
   if (get('sort') !== undefined) {
      const col = cols.find(c => c.name === get('sort') && c.sortable && !c.hidden);
      s.sort = col ? { col: col.name, dir: get('dir') === 'desc' ? 'desc' : 'asc' } : null;
      s.page = 1; changed = true;
   }
   if (get('fc') !== undefined) {
      const col = cols.find(c => c.name === get('fc') && !c.hidden);
      const op = OPS[get('fo') ?? ''];
      let val = (get('fv') ?? '').trim();
      // dates may be typed the way they are shown (DD-MM-YYYY)
      const dmy = /^(\d{2})-(\d{2})-(\d{4})$/.exec(val);
      if (dmy && col && (col.kind === 'date' || col.kind === 'timestamp')) val = `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
      if (!col || !op || !op.kinds.includes(col.kind)) problem = 'Filter tidak dapat dipakai untuk kolom itu.';
      else if (op.needsValue && !val) problem = `Isi nilai filter untuk kolom ${col.label}.`;
      else if (op.needsValue && op.sql !== 'ilike' && !validValue(col.kind, val)) {
         problem = col.kind === 'number' ? `Nilai filter ${col.label} harus angka.` : col.kind === 'boolean' ? `Nilai filter ${col.label} harus ya/tidak.` : `Nilai filter ${col.label} harus tanggal (HH-BB-TTTT).`;
      } else if (s.filters.length >= 10) problem = 'Maksimal 10 filter.';
      else { s.filters.push({ col: col.name, op: get('fo')!, val: op.needsValue ? val.slice(0, 200) : null }); s.page = 1; changed = true; }
   }
   if (get('rf') !== undefined) {
      const i = Number(get('rf'));
      if (i === -1) s.q = '';
      else if (Number.isInteger(i) && i >= 0 && i < s.filters.length) s.filters.splice(i, 1);
      s.page = 1; changed = true;
   }
   if (get('p') !== undefined) { s.page = Math.max(1, Math.min(10000, Number.parseInt(get('p'), 10) || 1)); changed = true; }
   return { state: s, changed, problem };
}

export async function renderInteractiveReport(v: View, r: RegionDef): Promise<SafeHtml> {
   const { ctx, page, ev } = v;
   const c = ev.c;
   const desc = await inSavepoint(c, () => describe(c, ctx, r));
   if (!desc.ok) return alert('danger', 'Laporan gagal dimuat.', html`<p class="r-mono">${pgMessage(desc.error)}</p>`);
   const cols = desc.value;
   const visible = cols.filter(col => !col.hidden);

   const applied = applyParams(r, cols, readState(ctx, r), v.rs.query ?? {});
   if (Object.keys(v.rs.query ?? {}).some(k => k.startsWith(`${r.staticId}__`))) v.rs.irParamsApplied = true;
   let st = applied.state;
   if (applied.changed) {
      ctx.session.state.set(stateKey(r), JSON.stringify(st));
      v.changes[stateKey(r)] = JSON.stringify(st);
   }

   const size = r.pageSize;
   const run = async (s: IrState) => {
      const { sql, params } = buildQuery(ctx, r, cols, s, size + 1, (s.page - 1) * size);
      return inSavepoint(c, () => c.query({ text: sql, values: params, rowMode: 'array' }));
   };
   // a problem found while applying a command survives the redirect to the clean URL (shown once)
   const msgKey = `__irmsg_${r.staticId}`;
   let problem = applied.problem;
   if (problem && v.rs.irParamsApplied) {
      ctx.session.state.set(msgKey, problem);
      v.changes[msgKey] = problem;
   } else if (!problem && ctx.session.state.get(msgKey)) {
      problem = ctx.session.state.get(msgKey)!;
      ctx.session.state.delete(msgKey);
      v.changes[msgKey] = null;
   }
   let res = await run(st);
   if (!res.ok && st.filters.length) {
      // a saved filter that no longer fits the data (e.g. a column changed type): drop the filters, keep the report usable
      problem = `Filter tidak dapat diterapkan dan dilepas: ${pgMessage(res.error)}`;
      st = { ...st, filters: [], page: 1 };
      ctx.session.state.set(stateKey(r), JSON.stringify(st));
      v.changes[stateKey(r)] = JSON.stringify(st);
      res = await run(st);
   }
   if (!res.ok) return alert('danger', 'Laporan gagal dimuat.', html`<p class="r-mono">${pgMessage(res.error)}</p>`);

   const fieldIdx = new Map(res.value.fields.map((f, i) => [f.name, i]));
   const rows = res.value.rows.slice(0, size).map(arr => {
      const o: Record<string, string | null> = {};
      for (const col of cols) o[col.name] = toText(arr[fieldIdx.get(col.field)!]);
      return o;
   });
   const hasMore = res.value.rows.length > size;
   const linkOk = new Map<string, boolean>();
   for (const col of visible) if (col.link) linkOk.set(col.name, await canOpen(v, col.link.page));

   const formId = `ir-${r.staticId}`, filterFormId = `ir-${r.staticId}-f`;
   const base = pageUrl(ctx, page.no);
   const url = (params: Record<string, string>) => pageUrl(ctx, page.no, {}, '', Object.fromEntries(Object.entries(params).map(([k, x]) => [P(r, k), x]))) + `#${r.staticId}`;
   v.extraForms.push(html`<form id="${formId}" method="get" action="${base}#${r.staticId}" data-ir-form="${r.staticId}"></form>
      <form id="${filterFormId}" method="get" action="${base}#${r.staticId}" data-ir-form="${r.staticId}"></form>`);

   const colLabel = (name: string) => cols.find(x => x.name === name)?.label ?? name;
   const chips: SafeHtml[] = [];
   if (st.q.trim()) chips.push(html`<span class="r-chip">Cari: “${st.q}” <a href="${url({ rf: '-1' })}" data-ir-link data-ir-key="chips" aria-label="Hapus pencarian ${st.q}">${icon('x')}</a></span>`);
   st.filters.forEach((f, i) => {
      const text = `${colLabel(f.col)} ${OPS[f.op]?.label ?? f.op}${f.val !== null ? ` ${f.val}` : ''}`;
      chips.push(html`<span class="r-chip">${text} <a href="${url({ rf: String(i) })}" data-ir-link data-ir-key="chips" aria-label="Hapus filter ${text}">${icon('x')}</a></span>`);
   });

   const filterable = visible;
   const toolbar = html`<div class="r-ir-toolbar">
      <label class="r-search"><span class="r-sr-only">Cari di ${r.title ?? 'laporan'}</span>${icon('search')}
        <input class="r-input" type="search" name="${P(r, 'q')}" value="${st.q}" form="${formId}" placeholder="Cari…" data-ir-key="search"></label>
      <button type="submit" class="r-btn" form="${formId}">Cari</button>
      <details class="r-ir-filter">
        <summary class="r-btn">${icon('filter')} Filter</summary>
        <div class="r-ir-filter__panel">
          <div class="r-field"><label class="r-label" for="${filterFormId}-c">Kolom</label>
            <select class="r-input" id="${filterFormId}-c" name="${P(r, 'fc')}" form="${filterFormId}">${filterable.map(col => html`<option value="${col.name}">${col.label}</option>`)}</select></div>
          <div class="r-field"><label class="r-label" for="${filterFormId}-o">Operator</label>
            <select class="r-input" id="${filterFormId}-o" name="${P(r, 'fo')}" form="${filterFormId}">${Object.entries(OPS).map(([k, o]) => html`<option value="${k}">${o.label}</option>`)}</select></div>
          <div class="r-field"><label class="r-label" for="${filterFormId}-v">Nilai</label>
            <input class="r-input" id="${filterFormId}-v" name="${P(r, 'fv')}" form="${filterFormId}" placeholder="angka, teks, atau HH-BB-TTTT"></div>
          <button type="submit" class="r-btn r-btn--primary" form="${filterFormId}">Terapkan</button>
        </div>
      </details>
      <div class="r-ir-toolbar__end">
        ${chips.length || st.sort ? html`<a class="r-btn r-btn--ghost" href="${url({ reset: '1' })}" data-ir-link>Atur ulang</a>` : ''}
        <a class="r-btn r-btn--ghost" href="${downloadUrl(ctx, page.no, r, 'csv')}" download>${icon('download')} CSV</a>
        <a class="r-btn r-btn--ghost" href="${downloadUrl(ctx, page.no, r, 'xlsx')}" download>${icon('download')} Excel</a>
      </div>
   </div>
   ${problem ? html`<div class="r-ir-problem">${alert('warning', problem)}</div>` : ''}
   ${chips.length ? html`<div class="r-chips" aria-label="Filter aktif">${chips}</div>` : ''}`;

   const first = (st.page - 1) * size + 1;
   const last = first + rows.length - 1;
   const status = rows.length ? `Baris ${first}–${last}${hasMore ? '' : ` dari ${last}`}` : 'Tidak ada baris';
   if (!rows.length) {
      const filtered = !!(st.q.trim() || st.filters.length || st.page > 1);
      return html`${toolbar}<p class="r-sr-only" aria-live="polite" data-ir-status>${status}</p>
         <div class="r-empty">${icon('inbox')}<p class="r-empty__title">${filtered ? 'Tidak ada data yang cocok' : 'Belum ada data'}</p>
         <p>${r.emptyText ?? (filtered ? 'Ubah pencarian atau filter untuk melihat data lain.' : 'Data akan tampil di sini setelah ditambahkan.')}</p>
         ${filtered ? html`<a class="r-btn r-btn--sm" href="${url({ reset: '1' })}" data-ir-link>Hapus pencarian &amp; filter</a>` : ''}</div>`;
   }

   const head = visible.map(col => {
      const num = col.kind === 'number' ? raw(' class="r-num"') : html``;
      if (!col.sortable) return html`<th scope="col"${num}>${col.label}</th>`;
      const active = st.sort?.col === col.name;
      const nextDir = active && st.sort!.dir === 'asc' ? 'desc' : 'asc';
      const ariaSort = active ? raw(` aria-sort="${st.sort!.dir === 'asc' ? 'ascending' : 'descending'}"`) : html``;
      const ic = active ? icon(st.sort!.dir === 'asc' ? 'arrow-up' : 'arrow-down') : html``;
      return html`<th scope="col"${num}${ariaSort}><a class="r-sort" href="${url({ sort: col.name, dir: nextDir })}" data-ir-link data-ir-key="sort-${col.name}">${col.label}${ic}<span class="r-sr-only">, urutkan ${nextDir === 'asc' ? 'naik' : 'turun'}</span></a></th>`;
   });
   return html`${toolbar}
   <p class="r-sr-only" aria-live="polite" data-ir-status>${status}</p>
   <div class="r-table-wrap">
     <table class="r-table">
       <caption class="r-sr-only">${r.title ?? r.staticId}</caption>
       <thead><tr>${head}</tr></thead>
       <tbody>${rows.map(row => html`<tr>${visible.map(col => {
          const val = formatValue(row[col.name], col.format);
          const cell = col.link && linkOk.get(col.name) ? html`<a class="r-cell-link" href="${targetUrl(ctx, col.link, row)}"${dialogAttrs(ctx, col.link)}>${val}</a>` : html`${val}`;
          return html`<td${col.kind === 'number' ? raw(' class="r-num"') : ''}>${cell}</td>`;
       })}</tr>`)}</tbody>
     </table>
   </div>
   <div class="r-pagination">
     <span>${status}</span>
     <nav class="r-pagination__nav" aria-label="Halaman ${r.title ?? ''}">
       ${st.page > 1 ? html`<a class="r-btn r-btn--sm r-btn--icon" href="${url({ p: String(st.page - 1) })}" data-ir-link data-ir-key="prev" aria-label="Halaman sebelumnya">${icon('chevron-left')}</a>` : html`<span class="r-btn r-btn--sm r-btn--icon" aria-disabled="true">${icon('chevron-left')}</span>`}
       ${hasMore ? html`<a class="r-btn r-btn--sm r-btn--icon" href="${url({ p: String(st.page + 1) })}" data-ir-link data-ir-key="next" aria-label="Halaman berikutnya">${icon('chevron-right')}</a>` : html`<span class="r-btn r-btn--sm r-btn--icon" aria-disabled="true">${icon('chevron-right')}</span>`}
     </nav>
   </div>`;
}

const NUM = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 });
const INT = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });
/** Display formatting only (sorting, filtering and downloads use the raw value). */
export function formatValue(v: string | null, format: string | null): string {
   if (v === null) return '';
   if ((format === 'number' || format === 'integer') && /^-?\d+(\.\d+)?$/.test(v)) return (format === 'number' ? NUM : INT).format(Number(v));
   if (format === 'date') { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v); if (m) return `${m[3]}-${m[2]}-${m[1]}`; }
   return v;
}

function downloadUrl(ctx: Ctx, pageNo: number, r: RegionDef, format: 'csv' | 'xlsx'): string {
   return `${pageUrl(ctx, pageNo)}/region/${encodeURIComponent(r.staticId)}/download?format=${format}`;
}

/** Rows for a download: the same search/filter/sort as on screen, all pages, up to max_download_rows. */
export async function downloadRows(c: pg.PoolClient, ctx: Ctx, r: RegionDef):
      Promise<{ cols: { name: string; label: string; numeric: boolean }[]; rows: (string | null)[][]; truncated: boolean }> {
   const cols = await describe(c, ctx, r);
   const st = readState(ctx, r);
   const { sql, params } = buildQuery(ctx, r, cols, st, r.maxDownloadRows + 1, 0);
   const res = await c.query({ text: sql, values: params, rowMode: 'array' });
   const visible = cols.filter(col => !col.hidden);
   const idx = new Map(res.fields.map((f, i) => [f.name, i]));
   const rows = res.rows.slice(0, r.maxDownloadRows).map(arr => visible.map(col => toText(arr[idx.get(col.field)!])));
   return { cols: visible.map(col => ({ name: col.name, label: col.label, numeric: col.kind === 'number' })), rows, truncated: res.rows.length > r.maxDownloadRows };
}

