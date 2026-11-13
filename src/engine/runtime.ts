import { createHash } from 'node:crypto';
import type pg from 'pg';
import { translateBinds, wrapDoBlock } from './bind.ts';
import { itemsMessage, sign, urlMessage, verify } from './checksum.ts';
import { enterUserCode, leaveUserCode, quoteIdent, quoteQualified, readUserCodeItems, toText } from './db.ts';
import { Evaluator, runComputations } from './guard.ts';
import { attrIf, html, raw, type SafeHtml } from './html.ts';
import type { ButtonDef, ItemDef, NavDef, PageDef, ProcessDef, RegionDef, Target } from './model.ts';
import {
   AFTER_AUTH_KEY, bindValues, clearPages, consumeSubmitToken, FLASH_KEY, issueSubmitToken, NEW_SESSION_KEY, saveState, takeFlash,
} from './session.ts';
import { alert, icon, shell } from './templates.ts';
import { inSavepoint, pgMessage, runSql, substitute, syncItems, userCtx, values, type Ctx } from './usercode.ts';

export type { Ctx } from './usercode.ts';
export { substitute } from './usercode.ts';

export class HttpError extends Error {
   readonly status: number;
   readonly title: string;
   constructor(status: number, title: string, message: string) {
      super(message);
      this.status = status;
      this.title = title;
   }
}

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------
export function appBase(app: Ctx['app']): string {
   return `/r/${encodeURIComponent(app.workspace)}/${encodeURIComponent(app.alias)}`;
}

/** URL to a page; when it sets items it carries an HMAC checksum bound to the session. */
export function pageUrl(ctx: Ctx, page: number, items: Record<string, string> = {}, clear = '', extra: Record<string, string> = {}): string {
   const q = new URLSearchParams();
   if (clear) q.set('clear', clear);
   for (const k of Object.keys(items).sort()) q.set(k, items[k]);
   if (Object.keys(items).length) q.set('cs', sign(ctx.secret, ctx.session.salt, urlMessage(page, items, clear)));
   for (const [k, v] of Object.entries(extra)) q.set(k, v);
   const qs = q.toString();
   return `${appBase(ctx.app)}/${page}${qs ? `?${qs}` : ''}`;
}

/** #COL# substitution from a report row (case-insensitive column names). */
function rowSubstitute(text: string, row: Record<string, string | null>): string {
   return text.replace(/#([A-Za-z_][A-Za-z0-9_$]*)#/g, (m, col: string) => {
      const key = col.toUpperCase();
      return key in row ? row[key] ?? '' : m;
   });
}

function targetUrl(ctx: Ctx, t: Target, row?: Record<string, string | null>): string {
   const vals = values(ctx);
   const items: Record<string, string> = {};
   for (const [k, v] of Object.entries(t.items ?? {})) {
      items[k] = substitute(row ? rowSubstitute(v, row) : v, vals, false);
   }
   return pageUrl(ctx, t.page, items, t.clear_cache ?? '');
}

// ---------------------------------------------------------------------------
// Form state: which items and buttons were rendered, plus the values of protected hidden items.
// Signed into the form, so a POST can only set items the user was shown and only press buttons
// they were offered (conditions / authorization decided at render time), and cannot change hidden values.
// ---------------------------------------------------------------------------
interface Rendered { items: Set<string>; buttons: Set<string> }

function formStateMessage(page: PageDef, names: { i: string[]; b: string[] }, protectedVals: Record<string, string | null>): string {
   return `fs|${page.no}|${JSON.stringify(names)}|${itemsMessage(page.no, protectedVals)}`;
}
const isProtectedHidden = (it: ItemDef) => it.type === 'hidden' && it.protection !== 'unrestricted';

function formState(ctx: Ctx, page: PageDef, rendered: Rendered): string {
   const names = { i: [...rendered.items].sort(), b: [...rendered.buttons].sort() };
   const prot: Record<string, string | null> = {};
   for (const it of page.items) if (rendered.items.has(it.name) && isProtectedHidden(it)) prot[it.name] = ctx.session.state.get(it.name) ?? null;
   const payload = Buffer.from(JSON.stringify(names)).toString('base64url');
   return `${payload}.${sign(ctx.secret, ctx.session.salt, formStateMessage(page, names, prot))}`;
}

function readFormState(ctx: Ctx, page: PageDef, body: Record<string, string>): Rendered {
   const bad = () => new HttpError(403, 'Checksum tidak cocok', 'Nilai tersembunyi di formulir ini diubah. Muat ulang halaman lalu coba lagi.');
   const [payload, sig] = String(body.__ps ?? '').split('.');
   let names: { i: string[]; b: string[] };
   try {
      names = JSON.parse(Buffer.from(payload ?? '', 'base64url').toString());
      if (!Array.isArray(names.i) || !Array.isArray(names.b)) throw new Error();
   } catch {
      throw bad();
   }
   const prot: Record<string, string | null> = {};
   for (const it of page.items) {
      if (names.i.includes(it.name) && isProtectedHidden(it)) prot[it.name] = body[it.name] === '' || body[it.name] === undefined ? null : body[it.name];
   }
   if (!verify(ctx.secret, ctx.session.salt, formStateMessage(page, names, prot), sig)) throw bad();
   return { items: new Set(names.i), buttons: new Set(names.b) };
}

// ---------------------------------------------------------------------------
// SHOW (GET)
// ---------------------------------------------------------------------------
export interface RenderState {
   errors?: { item: string | null; message: string }[];
   processError?: { title: string; detail: string };
   runBeforeHeader: boolean;
   /** signed row-version tokens per form region (static id), carried through re-renders */
   rowVersions?: Record<string, string>;
   query?: Record<string, string>;
}

/** Apply URL arguments (clear cache + item values) after checking the checksum. */
export async function applyUrlArgs(ctx: Ctx, page: PageDef, query: Record<string, string>): Promise<void> {
   const clear = query.clear ?? '';
   if (clear && !/^[0-9]+(,[0-9]+)*$/.test(clear)) throw new HttpError(400, 'Permintaan tidak valid', 'Parameter clear tidak valid.');
   const items: Record<string, string> = {};
   for (const [k, v] of Object.entries(query)) {
      if (!/^[A-Z][A-Z0-9_]*$/.test(k)) continue;
      const def = ctx.app.itemsByName.get(k);
      if (!def) throw new HttpError(400, 'Permintaan tidak valid', `Item ${k} tidak dikenal.`);
      if (def.item.protection === 'restricted') throw new HttpError(403, 'Akses ditolak', `Item ${k} tidak boleh diisi dari URL.`);
      items[k] = v;
   }
   const needsChecksum = Object.keys(items).some(k => ctx.app.itemsByName.get(k)!.item.protection !== 'unrestricted');
   if (needsChecksum && !verify(ctx.secret, ctx.session.salt, urlMessage(page.no, items, clear), query.cs)) {
      throw new HttpError(403, 'Checksum tidak cocok',
         'Tautan ini diubah atau berasal dari sesi lain. Buka kembali halaman lewat menu aplikasi.');
   }
   if (clear) await clearPages(ctx.pool, ctx.session, ctx.app, clear.split(',').map(Number));
   await saveState(ctx.pool, ctx.session, items);
}

interface View {
   ctx: Ctx;
   page: PageDef;
   ev: Evaluator;
   rs: RenderState;
   rendered: Rendered;
   /** target page -> allowed, so links/buttons to pages the user may not open are not offered */
   allowed: Map<number, boolean>;
}

async function canOpen(v: View, no: number): Promise<boolean> {
   if (!v.allowed.has(no)) v.allowed.set(no, await v.ev.pageAllowed(no));
   return v.allowed.get(no)!;
}

export async function renderPage(ctx: Ctx, page: PageDef, rs: RenderState): Promise<string> {
   const flash = await takeFlash(ctx.pool, ctx.session);
   const c = await ctx.pool.connect();
   const stateChanges: Record<string, string | null> = {};
   const problems: string[] = [];
   let regionsHtml: { region: RegionDef; html: SafeHtml }[] = [];
   let nav: NavDef[] = [];
   let headerButtons: SafeHtml[] = [];
   let parentAllowed = false;
   const rendered: Rendered = { items: new Set(), buttons: new Set() };
   const ev = new Evaluator(c, ctx);
   const v: View = { ctx, page, ev, rs, rendered, allowed: new Map() };
   try {
      await c.query('begin');
      await enterUserCode(c, userCtx(ctx));

      // 1. authorization: application scheme, then page scheme
      const denial = await ev.pageDenial(page);
      if (denial) throw new HttpError(403, 'Akses ditolak', denial.errorMsg);

      // 2. once per session: application computations
      const st = ctx.session.state;
      const app = ctx.app.computations;
      const runApp = async (point: string, flag: string, done: string | null) => {
         const r = await runComputations(ev, app.filter(x => x.point === point));
         Object.assign(stateChanges, r.changes, { [flag]: done });
         problems.push(...r.errors);
      };
      if (st.get(NEW_SESSION_KEY) !== 'Y') await runApp('on_new_session', NEW_SESSION_KEY, 'Y');
      if (st.get(AFTER_AUTH_KEY) === 'pending') await runApp('after_authentication', AFTER_AUTH_KEY, null);

      // 3. before header: form init, item defaults, then computations (so they can use the fetched row)
      if (rs.runBeforeHeader) {
         for (const p of page.processes.filter(p => p.point === 'before_header')) {
            if (p.type !== 'form_init' || !(await ev.holds(p.condition))) continue;
            const r = await inSavepoint(c, () => formInit(c, ctx, page, p));
            if (!r.ok) { problems.push(`Data tidak dapat dimuat: ${pgMessage(r.error)}`); continue; }
            for (const [k, val] of Object.entries(r.value.values)) { stateChanges[k] = val; st.set(k, val); }
            if (r.value.version) (rs.rowVersions ??= {})[r.value.staticId] = r.value.version;
         }
         for (const it of page.items) {
            if (it.defaultValue !== null && (st.get(it.name) ?? null) === null) { stateChanges[it.name] = it.defaultValue; st.set(it.name, it.defaultValue); }
         }
         await syncItems(c, ctx);
         const comps = await runComputations(ev, [
            ...app.filter(x => x.point === 'before_header'),
            ...page.computations.filter(x => x.point === 'before_header'),
         ]);
         Object.assign(stateChanges, comps.changes);
         problems.push(...comps.errors);
      }

      // 4. regions, header buttons, navigation (everything filtered by authorization and conditions)
      regionsHtml = [];
      for (const r of page.regions) {
         if (!(await ev.allows(r))) continue;
         regionsHtml.push({ region: r, html: await renderRegion(v, r) });
      }
      for (const b of page.buttons.filter(b => b.position === 'header')) {
         const h = await buttonHtml(v, b);
         if (h) headerButtons.push(h);
      }
      nav = await filterNav(v, ctx.app.nav);
      parentAllowed = page.breadcrumbParent !== null && (await canOpen(v, page.breadcrumbParent));
      await c.query('commit');
   } catch (e) {
      await c.query('rollback').catch(() => {});
      throw e;
   } finally {
      c.release();
   }
   await ev.flush();
   if (Object.keys(stateChanges).length) await saveState(ctx.pool, ctx.session, stateChanges);

   const msgs: SafeHtml[] = [];
   if (flash) msgs.push(alert('success', flash));
   for (const p of problems) msgs.push(alert('danger', 'Terjadi masalah saat menyiapkan halaman.', html`<p>${p}</p>`));
   if (rs.processError) msgs.push(alert('danger', rs.processError.title, html`<p>${rs.processError.detail}</p>`));
   if (rs.errors?.length) {
      msgs.push(alert('danger', `${rs.errors.length} kesalahan perlu diperbaiki`,
         html`<ul>${rs.errors.map(e => e.item ? html`<li><a href="#${e.item}">${e.message}</a></li>` : html`<li>${e.message}</li>`)}</ul>`,
         raw(' tabindex="-1" data-error-summary')));
   }

   const title = substitute(page.title ?? page.name, values(ctx), false);
   const out = shell({
      app: ctx.app, page, nav, parentAllowed, username: ctx.session.appUserId ? ctx.session.username : null, csrf: ctx.session.csrf,
      logoutUrl: `${appBase(ctx.app)}/logout`, pageUrl: no => pageUrl(ctx, no), title,
      headerActions: headerButtons.length ? html`<div class="r-page-head__actions">${headerButtons}</div>` : html``,
      messages: html`<div class="r-messages">${msgs}</div>`,
      body: html`<form method="post" action="${appBase(ctx.app)}/${page.no}" novalidate>
         <input type="hidden" name="__csrf" value="${ctx.session.csrf}">
         <input type="hidden" name="__sid" value="${await issueSubmitToken(ctx.pool, ctx.session, page.no)}">
         <input type="hidden" name="__ps" value="${formState(ctx, page, rendered)}">
         ${layout(regionsHtml)}
      </form>`,
   });
   return out.value;
}

async function filterNav(v: View, entries: NavDef[]): Promise<NavDef[]> {
   const out: NavDef[] = [];
   for (const e of entries) {
      if (!(await v.ev.allows(e))) continue;
      if (e.target.page !== undefined && !(await canOpen(v, e.target.page))) continue;
      out.push({ ...e, children: await filterNav(v, e.children) });
   }
   return out;
}

function layout(rendered: { region: RegionDef; html: SafeHtml }[]): SafeHtml {
   const rows: { region: RegionDef; html: SafeHtml }[][] = [];
   for (const x of rendered) {
      if (x.region.newRow || !rows.length) rows.push([]);
      rows[rows.length - 1].push(x);
   }
   return html`${rows.map(row => html`<div class="r-row">${row.map(x => html`<div class="r-col-${x.region.colSpan}">${x.html}</div>`)}</div>`)}`;
}

/** Columns of a form region in a fixed order: what form_init reads and the row version hashes. */
function formColumns(region: RegionDef): ItemDef[] {
   return region.items.filter(i => i.column);
}

async function readRow(c: pg.PoolClient, region: RegionDef, pkVals: (string | null)[], lock: boolean): Promise<(string | null)[] | null> {
   const cols = formColumns(region);
   const pks = cols.filter(i => i.pk);
   const sql = `select ${cols.map(i => quoteIdent(i.column!)).join(', ')} from ${quoteQualified(region.source!)}
                where ${pks.map((i, n) => `${quoteIdent(i.column!)} = $${n + 1}`).join(' and ')}${lock ? ' for update' : ''}`;
   const r = await c.query({ text: sql, values: pkVals, rowMode: 'array' });
   return r.rowCount ? (r.rows[0] as unknown[]).map(toText) : null;
}

// Lost-update detection: form_init signs a hash of the row it showed; form_dml re-reads the row
// FOR UPDATE and refuses to write when the hash differs (someone else changed it meanwhile).
function rowHash(vals: (string | null)[]): string {
   return createHash('sha256').update(JSON.stringify(vals)).digest('base64url').slice(0, 32);
}
function versionToken(ctx: Ctx, page: PageDef, region: RegionDef, vals: (string | null)[]): string {
   const h = rowHash(vals);
   return `${h}.${sign(ctx.secret, ctx.session.salt, `rv|${page.no}|${region.staticId}|${h}`)}`;
}
function versionMatches(ctx: Ctx, page: PageDef, region: RegionDef, token: string | undefined, current: (string | null)[]): boolean {
   const [h, sig] = (token ?? '').split('.');
   if (!h || !verify(ctx.secret, ctx.session.salt, `rv|${page.no}|${region.staticId}|${h}`, sig)) return false;
   return h === rowHash(current);
}

export class LostUpdateError extends Error {}

async function formInit(c: pg.PoolClient, ctx: Ctx, page: PageDef, p: ProcessDef):
      Promise<{ values: Record<string, string | null>; version: string | null; staticId: string }> {
   const region = page.regions.find(r => r.id === p.regionId)!;
   const cols = formColumns(region);
   const pkVals = cols.filter(i => i.pk).map(i => ctx.session.state.get(i.name) ?? null);
   const out: Record<string, string | null> = {};
   if (pkVals.some(x => x === null)) return { values: out, version: null, staticId: region.staticId };   // new record
   const row = await readRow(c, region, pkVals, false);
   if (!row) throw new Error('Data yang diminta tidak ditemukan (mungkin sudah dihapus).');
   cols.forEach((it, n) => { out[it.name] = row[n]; });
   return { values: out, version: versionToken(ctx, page, region, row), staticId: region.staticId };
}

// ---------------------------------------------------------------------------
// Regions
// ---------------------------------------------------------------------------
async function renderRegion(v: View, r: RegionDef): Promise<SafeHtml> {
   const { ctx, rs } = v;
   let body: SafeHtml;
   let flush = false;
   if (r.type === 'classic_report') {
      body = await classicReport(v, r);
      flush = true;
   } else if (r.type === 'form') {
      const rv = rs.rowVersions?.[r.staticId];
      body = html`${rv ? html`<input type="hidden" name="__rv_${r.staticId}" value="${rv}">` : ''}<div class="r-form">${await itemsHtml(v, r.items)}</div>`;
   } else {
      const content = r.source ? html`<div class="r-region__static">${raw(substitute(r.source, values(ctx), true))}</div>` : html``;
      body = r.items.length ? html`${content}<div class="r-form">${await itemsHtml(v, r.items)}</div>` : content;
   }
   const footer: SafeHtml[] = [];
   if (r.type !== 'classic_report') {
      for (const b of r.buttons.filter(b => b.position !== 'header')) {
         const h = await buttonHtml(v, b);
         if (h) footer.push(h);
      }
   }
   const titleId = `r-${r.staticId}-title`;
   const plain = r.template === 'plain';
   return html`<section class="r-region${plain ? ' r-region--plain' : ''}" id="${r.staticId}"${r.title && !plain ? html` aria-labelledby="${titleId}"` : ''}>
      ${r.title && !plain ? html`<div class="r-region__header"><h2 class="r-region__title" id="${titleId}">${r.title}</h2></div>` : ''}
      <div class="r-region__body${flush ? ' r-region__body--flush' : ''}">${body}</div>
      ${footer.length ? html`<div class="r-region__footer">${footer}</div>` : ''}
   </section>`;
}

async function classicReport(v: View, r: RegionDef): Promise<SafeHtml> {
   const { ctx, rs, page, ev } = v;
   const c = ev.c;
   const pageParam = `p_${r.staticId}`;
   const pageNo = Math.max(1, Number.parseInt(rs.query?.[pageParam] ?? '1', 10) || 1);
   const size = r.pageSize;
   const barButtons: SafeHtml[] = [];
   for (const b of r.buttons.filter(b => b.position !== 'header')) {
      const h = await buttonHtml(v, b);
      if (h) barButtons.push(h);
   }
   const barItems = await itemsHtml(v, r.items, true);
   const searchBar = barItems.value.trim() || barButtons.length
      ? html`<div class="r-region__items"><div class="r-region__items-bar">${barItems}${barButtons}</div></div>`
      : html``;

   const res = await inSavepoint(c, () => runSql(c, ctx, r.source ?? 'select 1', [size + 1, (pageNo - 1) * size],
      (sql, n) => `select * from (${sql}) rpx_q limit $${n} offset $${n + 1}`));
   if (!res.ok) {
      return html`${searchBar}<div class="r-region__body">${alert('danger', 'Laporan gagal dimuat.', html`<p class="r-mono">${pgMessage(res.error)}</p>`)}</div>`;
   }
   const result = res.value;
   const fields = result.fields.map(f => f.name.toUpperCase());
   const rows = result.rows.slice(0, size).map(arr => {
      const o: Record<string, string | null> = {};
      fields.forEach((f, i) => { o[f] = toText(arr[i]); });
      return o;
   });
   const hasMore = result.rows.length > size;
   const cols = r.columns.length
      ? r.columns.filter(col => !col.hidden && fields.includes(col.name))
      : fields.map(f => ({ name: f, label: f, dataType: 'text', isPk: false, hidden: false, link: null }));
   // a link to a page the user may not open is shown as plain text
   const linkOk = new Map<string, boolean>();
   for (const col of cols) if (col.link) linkOk.set(col.name, await canOpen(v, col.link.page));

   if (!rows.length) {
      const filtered = pageNo > 1 || r.items.some(i => (ctx.session.state.get(i.name) ?? null) !== null);
      return html`${searchBar}<div class="r-empty">${icon('inbox')}
         <p class="r-empty__title">${filtered ? 'Tidak ada data yang cocok' : 'Belum ada data'}</p>
         <p>${r.emptyText ?? (filtered ? 'Ubah kata kunci pencarian untuk melihat data lain.' : 'Data akan tampil di sini setelah ditambahkan.')}</p></div>`;
   }
   const first = (pageNo - 1) * size + 1;
   const last = first + rows.length - 1;
   const nav = (n: number) => pageUrl(ctx, page.no, {}, '', { [pageParam]: String(n) }) + `#${r.staticId}`;
   return html`${searchBar}
   <div class="r-table-wrap">
     <table class="r-table">
       <caption class="r-sr-only">${r.title ?? r.staticId}</caption>
       <thead><tr>${cols.map(col => html`<th scope="col"${col.dataType === 'number' ? raw(' class="r-num"') : ''}>${col.label}</th>`)}</tr></thead>
       <tbody>${rows.map(row => html`<tr>${cols.map(col => {
          const val = row[col.name] ?? '';
          const cell = col.link && linkOk.get(col.name) ? html`<a class="r-cell-link" href="${targetUrl(ctx, col.link, row)}">${val}</a>` : html`${val}`;
          return html`<td${col.dataType === 'number' ? raw(' class="r-num"') : ''}>${cell}</td>`;
       })}</tr>`)}</tbody>
     </table>
   </div>
   <div class="r-pagination">
     <span>Baris ${first}–${last}${hasMore ? '' : html` dari ${last}`}</span>
     <nav class="r-pagination__nav" aria-label="Halaman ${r.title ?? ''}">
       ${pageNo > 1 ? html`<a class="r-btn r-btn--sm r-btn--icon" href="${nav(pageNo - 1)}" aria-label="Halaman sebelumnya">${icon('chevron-left')}</a>` : html`<span class="r-btn r-btn--sm r-btn--icon" aria-disabled="true">${icon('chevron-left')}</span>`}
       ${hasMore ? html`<a class="r-btn r-btn--sm r-btn--icon" href="${nav(pageNo + 1)}" aria-label="Halaman berikutnya">${icon('chevron-right')}</a>` : html`<span class="r-btn r-btn--sm r-btn--icon" aria-disabled="true">${icon('chevron-right')}</span>`}
     </nav>
   </div>`;
}

async function lovOptions(v: View, it: ItemDef): Promise<{ display: string; ret: string }[] | Error> {
   if (!it.lov) return [];
   if (it.lov.static) return it.lov.static.map(o => ({ display: o.display, ret: o.return }));
   const c = v.ev.c;
   const r = await inSavepoint(c, () => runSql(c, v.ctx, it.lov!.sql!));
   if (!r.ok) return r.error;
   return r.value.rows.map(row => ({ display: toText(row[0]) ?? '', ret: toText(row[1] ?? row[0]) ?? '' }));
}

async function itemsHtml(v: View, items: ItemDef[], bar = false): Promise<SafeHtml> {
   const { ctx, rs, ev, rendered } = v;
   const out: SafeHtml[] = [];
   for (const it of items) {
      if (!(await ev.allows(it))) continue;
      rendered.items.add(it.name);
      const val = ctx.session.state.get(it.name) ?? '';
      if (it.type === 'hidden') {
         out.push(html`<input type="hidden" name="${it.name}" id="${it.name}" value="${val}">`);
         continue;
      }
      const err = rs.errors?.find(e => e.item === it.name);
      const errId = `${it.name}_error`, helpId = `${it.name}_help`;
      const described = [it.help ? helpId : '', err ? errId : ''].filter(Boolean).join(' ');
      const common = html` id="${it.name}" name="${it.name}"${attrIf('required', it.required)}${err ? raw(' aria-invalid="true"') : ''}${described ? html` aria-describedby="${described}"` : ''}`;
      let control: SafeHtml;
      switch (it.type) {
         case 'textarea':
            control = html`<textarea class="r-input"${common}${it.placeholder ? html` placeholder="${it.placeholder}"` : ''}${it.maxLength ? html` maxlength="${it.maxLength}"` : ''}>${val}</textarea>`;
            break;
         case 'select': {
            const opts = await lovOptions(v, it);
            if (opts instanceof Error) {
               control = html`<select class="r-input" disabled${common}><option>Daftar pilihan gagal dimuat</option></select>`;
               out.push(html`<div class="r-field r-col-${it.colSpan}">${label(it)}${control}<span class="r-error-text">${icon('circle-x')} ${pgMessage(opts)}</span></div>`);
               continue;
            }
            const nullOpt = it.lov?.null_display ?? (it.required ? null : '');
            control = html`<select class="r-input"${common}>
               ${nullOpt !== null ? html`<option value="">${nullOpt}</option>` : ''}
               ${opts.map(o => html`<option value="${o.ret}"${attrIf('selected', o.ret === val)}>${o.display}</option>`)}
            </select>`;
            break;
         }
         case 'display_only':
            control = html`<div class="r-display" id="${it.name}">${val}</div>`;
            break;
         default: {
            const type = it.type === 'date' ? 'date' : it.type === 'password' ? 'password' : 'text';
            const numeric = it.type === 'number';
            control = html`<input class="r-input${numeric ? ' r-num' : ''}" type="${type}"${numeric ? raw(' inputmode="decimal"') : ''}${common} value="${it.type === 'password' ? '' : val}"${it.placeholder ? html` placeholder="${it.placeholder}"` : ''}${it.maxLength ? html` maxlength="${it.maxLength}"` : ''}>`;
         }
      }
      out.push(html`<div class="r-field${bar ? '' : ` r-col-${it.colSpan}`}">${label(it)}${control}
         ${it.help ? html`<span class="r-help" id="${helpId}">${it.help}</span>` : ''}
         ${err ? html`<span class="r-error-text" id="${errId}">${icon('circle-x')} ${err.message}</span>` : ''}</div>`);
   }
   return html`${out}`;
}

function label(it: ItemDef): SafeHtml {
   const text = it.label ?? it.name;
   if (it.type === 'display_only') return html`<span class="r-label">${text}</span>`;
   return html`<label class="r-label" for="${it.name}">${text}${it.required ? html`<span class="r-label__req" aria-hidden="true">*</span>` : ''}</label>`;
}

/** Button markup, or null when its authorization/condition fails or it points to a page the user may not open. */
async function buttonHtml(v: View, b: ButtonDef): Promise<SafeHtml | null> {
   if (!(await v.ev.allows(b))) return null;
   const cls = `r-btn${b.hot ? ' r-btn--primary' : b.style === 'danger' ? ' r-btn--danger' : b.style === 'ghost' ? ' r-btn--ghost' : ''}`;
   const ic = b.style === 'danger' ? icon('trash-2') : b.position === 'header' && b.hot ? icon('plus') : html``;
   if (b.action === 'redirect' && b.target) {
      if (!(await canOpen(v, b.target.page))) return null;
      return html`<a class="${cls}" href="${targetUrl(v.ctx, b.target)}">${ic}${b.label}</a>`;
   }
   v.rendered.buttons.add(b.name);
   return html`<button type="submit" class="${cls}" name="REQUEST" value="${b.name}"${b.confirm ? html` data-confirm="${b.confirm}"` : ''}>${ic}${b.label}</button>`;
}

// ---------------------------------------------------------------------------
// ACCEPT (POST)
// ---------------------------------------------------------------------------
export type AcceptResult = { redirect: string } | { html: string; status: number };

export async function acceptPage(ctx: Ctx, page: PageDef, body: Record<string, string>): Promise<AcceptResult> {
   const request = typeof body.REQUEST === 'string' ? body.REQUEST : '';

   // 1. the signed form state: which items/buttons were rendered + protected hidden values unchanged
   const rendered = readFormState(ctx, page, body);
   if (request && !rendered.buttons.has(request)) {
      throw new HttpError(400, 'Permintaan tidak valid', 'Tombol yang dikirim tidak tersedia di halaman ini.');
   }

   // 2. each rendered form is processed once (double click without JS, browser resend, replay)
   if (!(await consumeSubmitToken(ctx.pool, ctx.session, page.no, body.__sid))) {
      throw new HttpError(409, 'Formulir sudah dikirim',
         'Formulir ini sudah dikirim sebelumnya, jadi tidak diproses lagi. Buka halaman kembali untuk mengirim perubahan baru.');
   }

   // 3. posted values -> session state: only items that were rendered; restricted & display-only are ignored
   const posted: Record<string, string | null> = {};
   for (const it of page.items) {
      if (!rendered.items.has(it.name) || it.type === 'display_only' || it.protection === 'restricted') continue;
      if (!(it.name in body)) continue;
      const val = body[it.name];
      posted[it.name] = typeof val === 'string' ? (val.trim() === '' ? null : val) : null;
   }
   await saveState(ctx.pool, ctx.session, posted);

   // 4. authorization re-check, after-submit computations, validations (read-only transaction)
   const errors: { item: string | null; message: string }[] = [];
   {
      const c = await ctx.pool.connect();
      const ev = new Evaluator(c, ctx, request);
      try {
         await c.query('begin');
         await enterUserCode(c, userCtx(ctx));
         const denial = await ev.pageDenial(page);
         if (denial) throw new HttpError(403, 'Akses ditolak', denial.errorMsg);
         const btn = page.buttons.find(b => b.name === request);
         if (btn && !(await ev.authorized(btn.authzId))) throw new HttpError(403, 'Akses ditolak', 'Anda tidak berhak menjalankan aksi ini.');
         const comps = await runComputations(ev, page.computations.filter(x => x.point === 'after_submit'));
         if (Object.keys(comps.changes).length) await saveState(ctx.pool, ctx.session, comps.changes);
         for (const m of comps.errors) errors.push({ item: null, message: m });
         errors.push(...await validate(ev, page, request, rendered));
         await c.query('rollback');      // validations never change data
      } catch (e) {
         await c.query('rollback').catch(() => {});
         throw e;
      } finally {
         c.release();
      }
      await ev.flush();
   }
   if (errors.length) {
      return { status: 422, html: await renderPage(ctx, page, { runBeforeHeader: false, errors, rowVersions: postedVersions(page, body) }) };
   }

   // 5. processes and branch choice (one transaction, developer code as the workspace role)
   const messages: string[] = [];
   let changes: Record<string, string | null> = {};
   const before = new Map(ctx.session.state);
   const c = await ctx.pool.connect();
   const ev = new Evaluator(c, ctx, request);
   let failed: { title: string; detail: string } | null = null;
   let target: Target = { page: page.no };
   try {
      await c.query('begin');
      await enterUserCode(c, userCtx(ctx));
      for (const p of page.processes.filter(p => p.point === 'after_submit' && (!p.whenButton || p.whenButton === request))) {
         if (!(await ev.holds(p.condition))) continue;
         try {
            const ch = await runProcess(c, ctx, page, p, request, body);
            changes = { ...changes, ...ch };
            for (const [k, val] of Object.entries(ch)) ctx.session.state.set(k, val);
            if (p.successMsg) messages.push(p.successMsg);
         } catch (e) {
            failed = e instanceof LostUpdateError
               ? { title: 'Data diubah pengguna lain', detail: e.message }
               : { title: p.errorMsg ?? `Proses "${p.name}" gagal.`, detail: pgMessage(e) };
            break;
         }
      }
      if (!failed) {
         for (const b of page.branches) {
            if ((b.whenButton && b.whenButton !== request) || !(await ev.holds(b.condition))) continue;
            target = b.target;
            break;
         }
      }
      if (failed) await c.query('rollback');
      else await c.query('commit');
   } catch (e) {
      await c.query('rollback').catch(() => {});
      throw e;
   } finally {
      c.release();
   }
   await ev.flush();
   if (failed) {
      // the failed transaction changed nothing, so neither does session state
      ctx.session.state.clear();
      for (const [k, val] of before) ctx.session.state.set(k, val);
      return { status: 422, html: await renderPage(ctx, page, { runBeforeHeader: false, processError: failed, rowVersions: postedVersions(page, body) }) };
   }
   await saveState(ctx.pool, ctx.session, changes);
   if (messages.length) {
      const vals = values(ctx);
      await saveState(ctx.pool, ctx.session, { [FLASH_KEY]: messages.map(m => substitute(m, vals, false)).join(' ') });
   }
   return { redirect: targetUrl(ctx, target) };
}

async function validate(ev: Evaluator, page: PageDef, request: string, rendered: Rendered): Promise<{ item: string | null; message: string }[]> {
   const { ctx, c } = ev;
   const errors: { item: string | null; message: string }[] = [];
   const val = (n: string) => ctx.session.state.get(n) ?? null;
   // required / max length only for items the user was shown, and not when deleting
   if (!isDelete(request)) {
      for (const it of page.items) {
         if (!rendered.items.has(it.name)) continue;
         const x = val(it.name);
         if (it.required && it.type !== 'hidden' && it.type !== 'display_only' && x === null) {
            errors.push({ item: it.name, message: `${it.label ?? it.name} wajib diisi.` });
         } else if (it.maxLength !== null && x !== null && [...x].length > it.maxLength) {
            // the browser's maxlength is only a hint (and counts UTF-16 units); the server counts characters
            errors.push({ item: it.name, message: `${it.label ?? it.name} maksimal ${it.maxLength} karakter.` });
         }
      }
   }
   for (const rule of page.validations) {
      if (rule.whenButton && rule.whenButton !== request) continue;
      if (rule.item && (!rendered.items.has(rule.item) || errors.some(e => e.item === rule.item))) continue;
      if (!(await ev.holds(rule.condition))) continue;
      if (rule.type === 'not_null') {
         if (rule.item && val(rule.item) === null) errors.push({ item: rule.item, message: rule.errorMsg });
         continue;
      }
      if (rule.type === 'regex') {
         const x = rule.item ? val(rule.item) : null;
         if (x !== null && !new RegExp(rule.expression!).test(x)) errors.push({ item: rule.item, message: rule.errorMsg });
         continue;
      }
      // sql rules: an expression over an empty item is skipped ("required" covers emptiness)
      if (rule.item && val(rule.item) === null) continue;
      const wrap = rule.type === 'sql_expression' ? (s: string) => `select coalesce((${s})::boolean, false)`
         : rule.type === 'sql_exists' ? (s: string) => `select exists (${s})` : (s: string) => `select not exists (${s})`;
      const r = await inSavepoint(c, () => runSql(c, ctx, rule.expression!, [], wrap));
      if (!r.ok) errors.push({ item: rule.item, message: `${rule.errorMsg} (${pgMessage(r.error)})` });
      else if (r.value.rows[0][0] !== true) errors.push({ item: rule.item, message: rule.errorMsg });
   }
   return errors;
}

function postedVersions(page: PageDef, body: Record<string, string>): Record<string, string> {
   const out: Record<string, string> = {};
   for (const r of page.regions) {
      const x = body[`__rv_${r.staticId}`];
      if (typeof x === 'string' && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(x)) out[r.staticId] = x;
   }
   return out;
}

const isDelete = (request: string) => /^(DELETE|HAPUS)$/.test(request);

async function runProcess(c: pg.PoolClient, ctx: Ctx, page: PageDef, p: ProcessDef, request: string,
                          body: Record<string, string>): Promise<Record<string, string | null>> {
   const state = (n: string) => ctx.session.state.get(n) ?? null;
   if (p.type === 'clear_cache') {
      await clearPages(ctx.pool, ctx.session, ctx.app, [page.no]);
      return {};
   }
   if (p.type === 'plpgsql') {
      // refresh rpx_rt items with what earlier processes changed, then run the block
      await leaveUserCode(c);
      await enterUserCode(c, userCtx(ctx, bindValues(ctx.app, ctx.session)));
      const before = await readUserCodeItems(c);
      await c.query(wrapDoBlock(translateBinds(p.code!, 'plpgsql').text));
      const after = await readUserCodeItems(c);
      const out: Record<string, string | null> = {};
      for (const [k, x] of Object.entries(after)) {
         if (before[k] !== x && ctx.app.itemsByName.has(k)) out[k] = x;
      }
      return out;
   }
   if (p.type !== 'form_dml') return {};

   const region = page.regions.find(r => r.id === p.regionId)!;
   const table = quoteQualified(region.source!);
   const cols = region.items.filter(i => i.column && i.type !== 'display_only');
   const pks = cols.filter(i => i.pk);
   const pkVals = pks.map(i => state(i.name));
   const nonPk = cols.filter(i => !i.pk);
   const where = pks.map((i, n) => `${quoteIdent(i.column!)} = $${n + 1}`).join(' and ');

   if (pkVals.every(x => x !== null)) {
      // update / delete of an existing row: lock it and compare with the version the user saw
      const current = await readRow(c, region, pkVals, true);
      if (!current) throw new Error('Data sudah tidak ada (mungkin dihapus pengguna lain).');
      if (!versionMatches(ctx, page, region, body[`__rv_${region.staticId}`], current)) {
         throw new LostUpdateError('Data ini diubah pengguna lain sejak Anda membukanya, jadi perubahan Anda tidak disimpan. '
            + 'Buka ulang data dari daftar untuk melihat versi terbaru, lalu ulangi perubahan Anda.');
      }
   }

   if (isDelete(request)) {
      if (pkVals.some(x => x === null)) throw new Error('Tidak ada data yang dipilih untuk dihapus.');
      const r = await c.query(`delete from ${table} where ${where}`, pkVals);
      if (!r.rowCount) throw new Error('Data sudah tidak ada (mungkin dihapus pengguna lain).');
      return {};
   }
   if (pkVals.some(x => x === null)) {
      // insert: omit null columns so column defaults / identity apply
      const withVal = cols.filter(i => state(i.name) !== null);
      const sql = withVal.length
         ? `insert into ${table} (${withVal.map(i => quoteIdent(i.column!)).join(', ')}) values (${withVal.map((_, n) => `$${n + 1}`).join(', ')})`
         : `insert into ${table} default values`;
      const r = await c.query({ text: `${sql} returning ${pks.map(i => quoteIdent(i.column!)).join(', ')}`, values: withVal.map(i => state(i.name)), rowMode: 'array' });
      const out: Record<string, string | null> = {};
      pks.forEach((i, n) => { out[i.name] = toText(r.rows[0][n]); });
      return out;
   }
   if (!nonPk.length) return {};
   const sets = nonPk.map((i, n) => `${quoteIdent(i.column!)} = $${pks.length + n + 1}`).join(', ');
   const r = await c.query(`update ${table} set ${sets} where ${where}`, [...pkVals, ...nonPk.map(i => state(i.name))]);
   if (!r.rowCount) throw new Error('Data sudah tidak ada (mungkin dihapus pengguna lain).');
   return {};
}
