import type pg from 'pg';
import { translateBinds, wrapDoBlock } from './bind.ts';
import { itemsMessage, sign, urlMessage, verify } from './checksum.ts';
import { enterUserCode, leaveUserCode, quoteIdent, quoteQualified, readUserCodeItems, toText } from './db.ts';
import { attrIf, esc, html, raw, type SafeHtml } from './html.ts';
import type { AppDef, ButtonDef, Condition, ItemDef, PageDef, ProcessDef, RegionDef, Target } from './model.ts';
import { bindValues, clearPages, FLASH_KEY, saveState, takeFlash, type Session } from './session.ts';
import { alert, icon, shell } from './templates.ts';

export interface Ctx {
   pool: pg.Pool;
   secret: string;
   app: AppDef;
   session: Session;
}

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
// URLs & substitutions
// ---------------------------------------------------------------------------
export function appBase(app: AppDef): string {
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

function values(ctx: Ctx): Record<string, string | null> {
   return { ...ctx.app.substitutions, ...bindValues(ctx.app, ctx.session) };
}

/** &ITEM. substitution. `escape` decides whether each value is HTML-escaped (true in HTML contexts). */
export function substitute(text: string, vals: Record<string, string | null>, escape: boolean): string {
   return text.replace(/&([A-Z][A-Z0-9_]*)\./g, (m, name: string) => {
      if (!(name in vals)) return m;
      const v = vals[name] ?? '';
      return escape ? esc(v) : v;
   });
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

function conditionHolds(ctx: Ctx, c: Condition | null): boolean {
   if (!c) return true;
   if (c.item_not_null) return (ctx.session.state.get(c.item_not_null) ?? null) !== null;
   if (c.item_null) return (ctx.session.state.get(c.item_null) ?? null) === null;
   return true;
}

// ---------------------------------------------------------------------------
// Developer-code helpers (always inside a transaction, as the workspace role)
// ---------------------------------------------------------------------------
function userCtx(ctx: Ctx, items = bindValues(ctx.app, ctx.session)) {
   return {
      dbRole: ctx.app.dbRole, parsingSchema: ctx.app.parsingSchema, items, appUser: ctx.session.username,
      appAlias: ctx.app.alias, sessionId: ctx.session.id, timezone: ctx.app.timezone,
   };
}

async function runSql(c: pg.PoolClient, ctx: Ctx, sql: string, extraParams: unknown[] = [], wrap?: (s: string, next: number) => string) {
   const t = translateBinds(sql.trim().replace(/;\s*$/, ''), 'sql', { castText: true });
   const vals = bindValues(ctx.app, ctx.session);
   const params: unknown[] = t.names.map(n => vals[n] ?? null);
   const text = wrap ? wrap(t.text, params.length + 1) : t.text;
   return c.query({ text, values: [...params, ...extraParams], rowMode: 'array' });
}

async function inSavepoint<T>(c: pg.PoolClient, fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: Error }> {
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

function pgMessage(e: unknown): string {
   const err = e as { message?: string; detail?: string };
   return [err.message, err.detail].filter(Boolean).join(' · ');
}

// ---------------------------------------------------------------------------
// SHOW (GET)
// ---------------------------------------------------------------------------
export interface RenderState {
   errors?: { item: string | null; message: string }[];
   processError?: { title: string; detail: string };
   runBeforeHeader: boolean;
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

export async function renderPage(ctx: Ctx, page: PageDef, rs: RenderState): Promise<string> {
   const flash = await takeFlash(ctx.pool, ctx.session);
   const c = await ctx.pool.connect();
   let regionsHtml: { region: RegionDef; html: SafeHtml }[] = [];
   const stateChanges: Record<string, string | null> = {};
   let initError: string | null = null;
   try {
      await c.query('begin');
      await enterUserCode(c, userCtx(ctx));
      if (rs.runBeforeHeader) {
         for (const p of page.processes.filter(p => p.point === 'before_header')) {
            if (p.type !== 'form_init') continue;
            const r = await inSavepoint(c, () => formInit(c, ctx, page, p));
            if (!r.ok) initError = pgMessage(r.error);
            else Object.assign(stateChanges, r.value);
         }
         // defaults for empty items (new record)
         for (const it of page.items) {
            if (it.defaultValue !== null && (ctx.session.state.get(it.name) ?? null) === null && !(it.name in stateChanges)) {
               stateChanges[it.name] = it.defaultValue;
            }
         }
         for (const [k, v] of Object.entries(stateChanges)) ctx.session.state.set(k, v);
      }
      regionsHtml = [];
      for (const r of page.regions) {
         if (!conditionHolds(ctx, r.condition)) continue;
         regionsHtml.push({ region: r, html: await renderRegion(c, ctx, page, r, rs) });
      }
      await c.query('commit');
   } catch (e) {
      await c.query('rollback').catch(() => {});
      throw e;
   } finally {
      c.release();
   }
   if (rs.runBeforeHeader && Object.keys(stateChanges).length) await saveState(ctx.pool, ctx.session, stateChanges);

   const msgs: SafeHtml[] = [];
   if (flash) msgs.push(alert('success', flash));
   if (initError) msgs.push(alert('danger', 'Data tidak dapat dimuat.', html`<p>${initError}</p>`));
   if (rs.processError) msgs.push(alert('danger', rs.processError.title, html`<p>${rs.processError.detail}</p>`));
   if (rs.errors?.length) {
      const n = rs.errors.length;
      msgs.push(alert('danger', `${n} kesalahan perlu diperbaiki`,
         html`<ul>${rs.errors.map(e => e.item ? html`<li><a href="#${e.item}">${e.message}</a></li>` : html`<li>${e.message}</li>`)}</ul>`,
         raw(' tabindex="-1" data-error-summary')));
   }

   const headerButtons = page.buttons.filter(b => b.position === 'header' && conditionHolds(ctx, b.condition));
   const title = substitute(page.title ?? page.name, values(ctx), false);
   const out = shell({
      app: ctx.app, page, username: ctx.session.appUserId ? ctx.session.username : null, csrf: ctx.session.csrf,
      logoutUrl: `${appBase(ctx.app)}/logout`, pageUrl: no => pageUrl(ctx, no), title,
      headerActions: headerButtons.length ? html`<div class="r-page-head__actions">${headerButtons.map(b => button(ctx, b))}</div>` : html``,
      messages: html`<div class="r-messages">${msgs}</div>`,
      body: html`<form method="post" action="${appBase(ctx.app)}/${page.no}" novalidate>
         <input type="hidden" name="__csrf" value="${ctx.session.csrf}">
         ${protectedChecksum(ctx, page)}
         ${layout(regionsHtml)}
      </form>`,
   });
   return out.value;
}

function layout(rendered: { region: RegionDef; html: SafeHtml }[]): SafeHtml {
   const rows: { region: RegionDef; html: SafeHtml }[][] = [];
   for (const x of rendered) {
      if (x.region.newRow || !rows.length) rows.push([]);
      rows[rows.length - 1].push(x);
   }
   return html`${rows.map(row => html`<div class="r-row">${row.map(x => html`<div class="r-col-${x.region.colSpan}">${x.html}</div>`)}</div>`)}`;
}

/** HMAC over the values of protected hidden items, so a form post cannot change them. */
function protectedItems(page: PageDef): ItemDef[] {
   return page.items.filter(i => i.type === 'hidden' && i.protection !== 'unrestricted');
}
function protectedChecksum(ctx: Ctx, page: PageDef): SafeHtml {
   const vals: Record<string, string | null> = {};
   for (const it of protectedItems(page)) vals[it.name] = ctx.session.state.get(it.name) ?? null;
   return html`<input type="hidden" name="__ps" value="${sign(ctx.secret, ctx.session.salt, itemsMessage(page.no, vals))}">`;
}

async function formInit(c: pg.PoolClient, ctx: Ctx, page: PageDef, p: ProcessDef): Promise<Record<string, string | null>> {
   const region = page.regions.find(r => r.id === p.regionId)!;
   const cols = region.items.filter(i => i.column);
   const pks = cols.filter(i => i.pk);
   const pkVals = pks.map(i => ctx.session.state.get(i.name) ?? null);
   const out: Record<string, string | null> = {};
   if (pkVals.some(v => v === null)) {
      // new record: clear the non-pk items unless the user already typed something this request
      return out;
   }
   const sql = `select ${cols.map(i => quoteIdent(i.column!)).join(', ')} from ${quoteQualified(region.source!)}
                where ${pks.map((i, n) => `${quoteIdent(i.column!)} = $${n + 1}`).join(' and ')}`;
   const r = await c.query({ text: sql, values: pkVals, rowMode: 'array' });
   if (!r.rowCount) throw new Error('Data yang diminta tidak ditemukan (mungkin sudah dihapus).');
   cols.forEach((it, n) => { out[it.name] = toText(r.rows[0][n]); });
   return out;
}

// ---------------------------------------------------------------------------
// Regions
// ---------------------------------------------------------------------------
async function renderRegion(c: pg.PoolClient, ctx: Ctx, page: PageDef, r: RegionDef, rs: RenderState): Promise<SafeHtml> {
   let body: SafeHtml;
   let flush = false;
   if (r.type === 'classic_report') {
      body = await classicReport(c, ctx, page, r, rs);
      flush = true;
   } else if (r.type === 'form') {
      body = html`<div class="r-form">${await itemsHtml(c, ctx, r.items, rs)}</div>`;
   } else {
      const content = r.source ? html`<div class="r-region__static">${raw(substitute(r.source, values(ctx), true))}</div>` : html``;
      body = r.items.length ? html`${content}<div class="r-form">${await itemsHtml(c, ctx, r.items, rs)}</div>` : content;
   }
   const footer = r.buttons.filter(b => b.position !== 'header' && conditionHolds(ctx, b.condition));
   const titleId = `r-${r.staticId}-title`;
   const plain = r.template === 'plain';
   return html`<section class="r-region${plain ? ' r-region--plain' : ''}" id="${r.staticId}"${r.title && !plain ? html` aria-labelledby="${titleId}"` : ''}>
      ${r.title && !plain ? html`<div class="r-region__header"><h2 class="r-region__title" id="${titleId}">${r.title}</h2></div>` : ''}
      <div class="r-region__body${flush ? ' r-region__body--flush' : ''}">${body}</div>
      ${footer.length && r.type !== 'classic_report' ? html`<div class="r-region__footer">${footer.map(b => button(ctx, b))}</div>` : ''}
   </section>`;
}

async function classicReport(c: pg.PoolClient, ctx: Ctx, page: PageDef, r: RegionDef, rs: RenderState): Promise<SafeHtml> {
   const pageParam = `p_${r.staticId}`;
   const pageNo = Math.max(1, Number.parseInt(rs.query?.[pageParam] ?? '1', 10) || 1);
   const size = r.pageSize;
   const searchBar = r.items.length || r.buttons.some(b => b.position !== 'header')
      ? html`<div class="r-region__items"><div class="r-region__items-bar">${await itemsHtml(c, ctx, r.items, rs, true)}
          ${r.buttons.filter(b => b.position !== 'header' && conditionHolds(ctx, b.condition)).map(b => button(ctx, b))}</div></div>`
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
          const v = row[col.name] ?? '';
          const cell = col.link ? html`<a class="r-cell-link" href="${targetUrl(ctx, col.link, row)}">${v}</a>` : html`${v}`;
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

async function lovOptions(c: pg.PoolClient, ctx: Ctx, it: ItemDef): Promise<{ display: string; ret: string }[] | Error> {
   if (!it.lov) return [];
   if (it.lov.static) return it.lov.static.map(o => ({ display: o.display, ret: o.return }));
   const r = await inSavepoint(c, () => runSql(c, ctx, it.lov!.sql!));
   if (!r.ok) return r.error;
   return r.value.rows.map(row => ({ display: toText(row[0]) ?? '', ret: toText(row[1] ?? row[0]) ?? '' }));
}

async function itemsHtml(c: pg.PoolClient, ctx: Ctx, items: ItemDef[], rs: RenderState, bar = false): Promise<SafeHtml> {
   const out: SafeHtml[] = [];
   for (const it of items) {
      const v = ctx.session.state.get(it.name) ?? '';
      if (it.type === 'hidden') {
         out.push(html`<input type="hidden" name="${it.name}" id="${it.name}" value="${v}">`);
         continue;
      }
      const err = rs.errors?.find(e => e.item === it.name);
      const errId = `${it.name}_error`, helpId = `${it.name}_help`;
      const described = [it.help ? helpId : '', err ? errId : ''].filter(Boolean).join(' ');
      const common = html` id="${it.name}" name="${it.name}"${attrIf('required', it.required)}${err ? raw(' aria-invalid="true"') : ''}${described ? html` aria-describedby="${described}"` : ''}`;
      let control: SafeHtml;
      switch (it.type) {
         case 'textarea':
            control = html`<textarea class="r-input"${common}${it.placeholder ? html` placeholder="${it.placeholder}"` : ''}${it.maxLength ? html` maxlength="${it.maxLength}"` : ''}>${v}</textarea>`;
            break;
         case 'select': {
            const opts = await lovOptions(c, ctx, it);
            if (opts instanceof Error) {
               control = html`<select class="r-input" disabled${common}><option>Daftar pilihan gagal dimuat</option></select>`;
               out.push(html`<div class="r-field r-col-${it.colSpan}">${label(it)}${control}<span class="r-error-text">${icon('circle-x')} ${pgMessage(opts)}</span></div>`);
               continue;
            }
            const nullOpt = it.lov?.null_display ?? (it.required ? null : '');
            control = html`<select class="r-input"${common}>
               ${nullOpt !== null ? html`<option value="">${nullOpt}</option>` : ''}
               ${opts.map(o => html`<option value="${o.ret}"${attrIf('selected', o.ret === v)}>${o.display}</option>`)}
            </select>`;
            break;
         }
         case 'display_only':
            control = html`<div class="r-display" id="${it.name}">${v}</div>`;
            break;
         default: {
            const type = it.type === 'date' ? 'date' : it.type === 'password' ? 'password' : 'text';
            const numeric = it.type === 'number';
            control = html`<input class="r-input${numeric ? ' r-num' : ''}" type="${type}"${numeric ? raw(' inputmode="decimal"') : ''}${common} value="${it.type === 'password' ? '' : v}"${it.placeholder ? html` placeholder="${it.placeholder}"` : ''}${it.maxLength ? html` maxlength="${it.maxLength}"` : ''}>`;
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

function button(ctx: Ctx, b: ButtonDef): SafeHtml {
   const cls = `r-btn${b.hot ? ' r-btn--primary' : b.style === 'danger' ? ' r-btn--danger' : b.style === 'ghost' ? ' r-btn--ghost' : ''}`;
   const ic = b.style === 'danger' ? icon('trash-2') : b.position === 'header' && b.hot ? icon('plus') : html``;
   if (b.action === 'redirect' && b.target) {
      return html`<a class="${cls}" href="${targetUrl(ctx, b.target)}">${ic}${b.label}</a>`;
   }
   return html`<button type="submit" class="${cls}" name="REQUEST" value="${b.name}"${b.confirm ? html` data-confirm="${b.confirm}"` : ''}>${ic}${b.label}</button>`;
}

// ---------------------------------------------------------------------------
// ACCEPT (POST)
// ---------------------------------------------------------------------------
export type AcceptResult = { redirect: string } | { html: string; status: number };

export async function acceptPage(ctx: Ctx, page: PageDef, body: Record<string, string>): Promise<AcceptResult> {
   const request = typeof body.REQUEST === 'string' ? body.REQUEST : '';
   if (request && !page.buttons.some(b => b.name === request)) {
      throw new HttpError(400, 'Permintaan tidak valid', 'Tombol yang dikirim tidak ada di halaman ini.');
   }

   // 1. protected hidden items must come back unchanged
   const prot: Record<string, string | null> = {};
   for (const it of protectedItems(page)) prot[it.name] = body[it.name] === '' || body[it.name] === undefined ? null : body[it.name];
   if (!verify(ctx.secret, ctx.session.salt, itemsMessage(page.no, prot), body.__ps)) {
      throw new HttpError(403, 'Checksum tidak cocok', 'Nilai tersembunyi di formulir ini diubah. Muat ulang halaman lalu coba lagi.');
   }

   // 2. posted values -> session state (restricted & display-only items are ignored)
   const posted: Record<string, string | null> = {};
   for (const it of page.items) {
      if (it.type === 'display_only' || it.protection === 'restricted') continue;
      if (!(it.name in body)) continue;
      const v = body[it.name];
      posted[it.name] = typeof v === 'string' ? (v.trim() === '' ? null : v) : null;
   }
   await saveState(ctx.pool, ctx.session, posted);

   // 3. validations
   const errors = await validate(ctx, page, request);
   if (errors.length) {
      return { status: 422, html: await renderPage(ctx, page, { runBeforeHeader: false, errors }) };
   }

   // 4. processes (one transaction, developer code as the workspace role)
   const procs = page.processes.filter(p => p.point === 'after_submit' && (!p.whenButton || p.whenButton === request));
   const messages: string[] = [];
   let changes: Record<string, string | null> = {};
   const c = await ctx.pool.connect();
   let failed: { title: string; detail: string } | null = null;
   try {
      await c.query('begin');
      await enterUserCode(c, userCtx(ctx));
      for (const p of procs) {
         try {
            const ch = await runProcess(c, ctx, page, p, request, changes);
            changes = { ...changes, ...ch };
            if (p.successMsg) messages.push(p.successMsg);
         } catch (e) {
            failed = { title: p.errorMsg ?? `Proses "${p.name}" gagal.`, detail: pgMessage(e) };
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
   if (failed) {
      return { status: 422, html: await renderPage(ctx, page, { runBeforeHeader: false, processError: failed }) };
   }
   await saveState(ctx.pool, ctx.session, changes);
   if (messages.length) {
      const vals = values(ctx);
      await saveState(ctx.pool, ctx.session, { [FLASH_KEY]: messages.map(m => substitute(m, vals, false)).join(' ') });
   }

   // 5. branch
   const br = page.branches.find(b => !b.whenButton || b.whenButton === request);
   const target = br?.target ?? { page: page.no };
   return { redirect: targetUrl(ctx, target) };
}

async function validate(ctx: Ctx, page: PageDef, request: string): Promise<{ item: string | null; message: string }[]> {
   const errors: { item: string | null; message: string }[] = [];
   const val = (n: string) => ctx.session.state.get(n) ?? null;
   const deleting = isDelete(request);
   // required items are only enforced for buttons that save (not for delete)
   if (!deleting) {
      for (const it of page.items) {
         if (it.required && it.type !== 'hidden' && it.type !== 'display_only' && val(it.name) === null) {
            errors.push({ item: it.name, message: `${it.label ?? it.name} wajib diisi.` });
         }
      }
   }
   const rules = page.validations.filter(v => !v.whenButton || v.whenButton === request)
      // a rule on an item that already failed "required" would only repeat the problem
      .filter(v => !v.item || !errors.some(e => e.item === v.item));
   const sqlRules = rules.filter(v => v.type.startsWith('sql_'));
   for (const v of rules.filter(v => !v.type.startsWith('sql_'))) {
      if (v.type === 'not_null' && v.item && val(v.item) === null) errors.push({ item: v.item, message: v.errorMsg });
      if (v.type === 'regex' && v.item && val(v.item) !== null && !new RegExp(v.expression!).test(val(v.item)!)) errors.push({ item: v.item, message: v.errorMsg });
   }
   if (sqlRules.length) {
      const c = await ctx.pool.connect();
      try {
         await c.query('begin');
         await enterUserCode(c, userCtx(ctx));
         for (const v of sqlRules) {
            // an expression over an empty item is skipped; "required" covers emptiness
            if (v.item && val(v.item) === null) continue;
            const wrap = v.type === 'sql_expression' ? (s: string) => `select coalesce((${s})::boolean, false)`
               : v.type === 'sql_exists' ? (s: string) => `select exists (${s})` : (s: string) => `select not exists (${s})`;
            const r = await inSavepoint(c, () => runSql(c, ctx, v.expression!, [], wrap));
            if (!r.ok) errors.push({ item: v.item, message: `${v.errorMsg} (${pgMessage(r.error)})` });
            else if (r.value.rows[0][0] !== true) errors.push({ item: v.item, message: v.errorMsg });
         }
         await c.query('rollback');      // validations never change data
      } finally {
         c.release();
      }
   }
   return errors;
}

const isDelete = (request: string) => /^(DELETE|HAPUS)$/.test(request);

async function runProcess(c: pg.PoolClient, ctx: Ctx, page: PageDef, p: ProcessDef, request: string,
                          changes: Record<string, string | null>): Promise<Record<string, string | null>> {
   const state = (n: string) => (n in changes ? changes[n] : ctx.session.state.get(n) ?? null);
   if (p.type === 'clear_cache') {
      await clearPages(ctx.pool, ctx.session, ctx.app, [page.no]);
      return {};
   }
   if (p.type === 'plpgsql') {
      // refresh rpx_rt items with what earlier processes changed, then run the block
      await leaveUserCode(c);
      await enterUserCode(c, userCtx(ctx, { ...bindValues(ctx.app, ctx.session), ...changes }));
      const before = await readUserCodeItems(c);
      await c.query(wrapDoBlock(translateBinds(p.code!, 'plpgsql').text));
      const after = await readUserCodeItems(c);
      const out: Record<string, string | null> = {};
      for (const [k, v] of Object.entries(after)) {
         if (before[k] !== v && ctx.app.itemsByName.has(k)) out[k] = v;
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

   if (isDelete(request)) {
      if (pkVals.some(v => v === null)) throw new Error('Tidak ada data yang dipilih untuk dihapus.');
      const r = await c.query(`delete from ${table} where ${where}`, pkVals);
      if (!r.rowCount) throw new Error('Data sudah tidak ada (mungkin dihapus pengguna lain).');
      return {};
   }
   if (pkVals.some(v => v === null)) {
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
