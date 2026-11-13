import type pg from 'pg';
import { enterUserCode, quoteIdent, toText } from './db.ts';
import { Evaluator } from './guard.ts';
import { attrIf, html, raw, type SafeHtml } from './html.ts';
import { formatValue } from './ir.ts';
import type { ItemDef, PageDef } from './model.ts';
import { appBase, HttpError, type View } from './runtime.ts';
import { icon } from './templates.ts';
import { inSavepoint, pgMessage, runSql, userCtx, type Ctx } from './usercode.ts';

// Page items (M3): rendering per item type, lists of values (inline, shared, SQL, popup search),
// cascading lists, and the server-side checks on submitted values.

/** item types that take their choices from a list of values */
export const LOV_TYPES = new Set(['select', 'popup_lov', 'radio', 'checkbox_group']);
/** multi-value items (checkbox group) keep their values joined with ':' like APEX */
export const SEP = ':';
export const splitValues = (v: string | null): string[] => (v === null ? [] : v.split(SEP).filter(x => x !== ''));

export interface LovOption { display: string; ret: string }
type Problem = { item: string | null; message: string };

const nameOf = (it: ItemDef) => it.label ?? it.name;

// ---------------------------------------------------------------------------
// Lists of values
// ---------------------------------------------------------------------------

/** Field names of a SQL list of values: first column = display, second = return (or the first again). */
const shapes = new Map<string, { d: string; r: string }>();
async function shape(c: pg.PoolClient, ctx: Ctx, it: ItemDef): Promise<{ d: string; r: string }> {
   const key = `${ctx.app.id}|${ctx.app.specHash}|${it.lov!.key}`;
   let s = shapes.get(key);
   if (!s) {
      const res = await runSql(c, ctx, it.lov!.sql!, [], q => `select * from (${q}) l limit 0`);
      const f = res.fields.map(x => x.name);
      if (!f.length) throw new Error('Daftar pilihan tidak mengembalikan kolom.');
      s = { d: `l.${quoteIdent(f[0])}`, r: `l.${quoteIdent(f[1] ?? f[0])}` };
      if (shapes.size > 2000) shapes.clear();
      shapes.set(key, s);
   }
   return s;
}

/** Every option (select, radio group, checkbox group). */
export async function lovOptions(c: pg.PoolClient, ctx: Ctx, it: ItemDef): Promise<LovOption[] | Error> {
   if (!it.lov) return [];
   if (it.lov.static) return it.lov.static.map(o => ({ display: o.display, ret: o.return }));
   const r = await inSavepoint(c, () => runSql(c, ctx, it.lov!.sql!));
   if (!r.ok) return r.error;
   return r.value.rows.map(row => ({ display: toText(row[0]) ?? '', ret: toText(row.length > 1 ? row[1] : row[0]) ?? '' }));
}

export const POPUP_PAGE_SIZE = 25;
const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, m => `\\${m}`)}%`;

/** One page of a popup LOV search (display value contains `q`, case-insensitive). */
export async function lovSearch(c: pg.PoolClient, ctx: Ctx, it: ItemDef, q: string, pageNo: number):
      Promise<{ options: LovOption[]; more: boolean } | Error> {
   const off = (pageNo - 1) * POPUP_PAGE_SIZE;
   if (!it.lov) return { options: [], more: false };
   if (it.lov.static) {
      const needle = q.toLocaleLowerCase('id');
      const hits = it.lov.static.filter(o => o.display.toLocaleLowerCase('id').includes(needle));
      return { options: hits.slice(off, off + POPUP_PAGE_SIZE).map(o => ({ display: o.display, ret: o.return })), more: hits.length > off + POPUP_PAGE_SIZE };
   }
   const r = await inSavepoint(c, async () => {
      const { d, r } = await shape(c, ctx, it);
      return runSql(c, ctx, it.lov!.sql!, [likePattern(q), POPUP_PAGE_SIZE + 1, off],
         (s, n) => `select ${d}::text, ${r}::text from (${s}) l where ${d}::text ilike $${n}::text escape '\\' limit $${n + 1} offset $${n + 2}`);
   });
   if (!r.ok) return r.error;
   const rows = r.value.rows.map(row => ({ display: (row[0] as string | null) ?? '', ret: (row[1] as string | null) ?? '' }));
   return { options: rows.slice(0, POPUP_PAGE_SIZE), more: rows.length > POPUP_PAGE_SIZE };
}

/** The display value for a stored return value (popup LOV shows the name, stores the key). */
export async function lovDisplay(c: pg.PoolClient, ctx: Ctx, it: ItemDef, ret: string): Promise<string> {
   if (!it.lov) return ret;
   if (it.lov.static) return it.lov.static.find(o => o.return === ret)?.display ?? ret;
   const r = await inSavepoint(c, async () => {
      const { d, r } = await shape(c, ctx, it);
      return runSql(c, ctx, it.lov!.sql!, [ret], (s, n) => `select ${d}::text from (${s}) l where ${r}::text = $${n}::text limit 1`);
   });
   return r.ok && r.value.rows.length ? ((r.value.rows[0][0] as string | null) ?? ret) : ret;
}

/** Submitted values that are not in the item's list of values. */
export async function lovMissing(c: pg.PoolClient, ctx: Ctx, it: ItemDef, vals: string[]): Promise<string[] | Error> {
   if (!vals.length || !it.lov) return [];
   if (it.lov.static) {
      const ok = new Set(it.lov.static.map(o => o.return));
      return vals.filter(x => !ok.has(x));
   }
   const r = await inSavepoint(c, async () => {
      const { r } = await shape(c, ctx, it);
      return runSql(c, ctx, it.lov!.sql!, [vals], (s, n) => `select distinct ${r}::text from (${s}) l where ${r}::text = any($${n}::text[])`);
   });
   if (!r.ok) return r.error;
   const found = new Set(r.value.rows.map(row => row[0] as string));
   return vals.filter(x => !found.has(x));
}

// ---------------------------------------------------------------------------
// Submitted values
// ---------------------------------------------------------------------------

/** Items for which the browser sends nothing when no option is chosen (so "absent" means empty / off). */
export const absentMeansEmpty = (it: ItemDef) => ['radio', 'checkbox', 'switch', 'checkbox_group'].includes(it.type);

/** Turn what the browser sent for an item into its session-state value. */
export function postedValue(it: ItemDef, sent: unknown): string | null {
   const list = (Array.isArray(sent) ? sent : sent === undefined ? [] : [sent]).filter((x): x is string => typeof x === 'string');
   if (it.type === 'checkbox_group') {
      const vals = list.flatMap(x => x.split(SEP)).filter(x => x !== '');
      return vals.length ? [...new Set(vals)].join(SEP) : null;
   }
   if (it.type === 'checkbox' || it.type === 'switch') return list.length ? list[list.length - 1] : it.offValue;
   const v = list[0];
   if (v === undefined || v.trim() === '') return null;
   if (it.type === 'datetime') return v.replace('T', ' ');
   return v;
}

const isDate = (v: string) => {
   const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
   if (!m) return false;
   const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
   return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
};
const isTimestamp = (v: string) => {
   const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(v);
   return !!m && isDate(m[1]) && +m[2] < 24 && +m[3] < 60 && +(m[4] ?? 0) < 60;
};
const isNumeric = (v: string) => /^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(v.trim());

export const typeChecks = {
   is_numeric: (v: string, label: string) => (isNumeric(v) ? null : `${label} harus berupa angka (pakai titik untuk desimal).`),
   is_date: (v: string, label: string) => (isDate(v) ? null : `${label} harus berupa tanggal yang valid (TTTT-BB-HH).`),
   is_timestamp: (v: string, label: string) => (isTimestamp(v) ? null : `${label} harus berupa tanggal dan jam yang valid.`),
};

/**
 * Built-in checks on a submitted value: its type (number, date, date+time) and, for list items,
 * that every value comes from the list (a crafted POST cannot store a value the user was never offered).
 */
export async function checkValue(c: pg.PoolClient, ctx: Ctx, it: ItemDef, v: string | null): Promise<Problem | null> {
   const label = nameOf(it);
   const fail = (message: string | null) => (message ? { item: it.name, message } : null);
   if (it.type === 'checkbox' && it.required && v !== it.onValue) return fail(`${label} wajib dicentang.`);
   if (v === null) return null;
   switch (it.type) {
      case 'number': return fail(typeChecks.is_numeric(v, label));
      case 'date': return fail(typeChecks.is_date(v, label));
      case 'datetime': return fail(typeChecks.is_timestamp(v, label));
      case 'checkbox': case 'switch':
         return v === it.onValue || v === it.offValue ? null : fail(`${label}: nilai tidak valid.`);
   }
   if (!LOV_TYPES.has(it.type)) return null;
   const missing = await lovMissing(c, ctx, it, it.type === 'checkbox_group' ? splitValues(v) : [v]);
   if (missing instanceof Error) return fail(`${label}: daftar pilihan gagal dimuat (${pgMessage(missing)}).`);
   return missing.length ? fail(`${label}: pilihan "${missing.join(', ')}" tidak ada di daftar.`) : null;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** datetime-local wants YYYY-MM-DDTHH:MM[:SS]; the database gives "YYYY-MM-DD HH:MM:SS[+TZ]". */
function toLocalInput(v: string): string {
   const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(:\d{2})?/.exec(v);
   return m ? `${m[1]}T${m[2]}${m[3] && m[3] !== ':00' ? m[3] : ''}` : v;
}

function label(it: ItemDef, forId = it.name): SafeHtml {
   const text = nameOf(it);
   const req = it.required ? html`<span class="r-label__req" aria-hidden="true">*</span>` : '';
   if (it.type === 'display_only') return html`<span class="r-label">${text}</span>`;
   return html`<label class="r-label" for="${forId}">${text}${req}</label>`;
}

function legend(it: ItemDef): SafeHtml {
   return html`<legend class="r-label">${nameOf(it)}${it.required ? html`<span class="r-label__req" aria-hidden="true">*</span>` : ''}</legend>`;
}

const lovUrl = (ctx: Ctx, page: PageDef, it: ItemDef, what: 'lov' | 'field') =>
   `${appBase(ctx.app)}/${page.no}/${what}/${encodeURIComponent(it.name)}`;

function highlight(text: string, q: string): SafeHtml {
   if (!q) return html`${text}`;
   const lower = text.toLocaleLowerCase('id'), needle = q.toLocaleLowerCase('id');
   const parts: SafeHtml[] = [];
   let at = 0;
   for (let i = lower.indexOf(needle); i >= 0 && needle.length; i = lower.indexOf(needle, at)) {
      parts.push(html`${text.slice(at, i)}<mark>${text.slice(i, i + needle.length)}</mark>`);
      at = i + needle.length;
   }
   parts.push(html`${text.slice(at)}`);
   return html`${parts}`;
}

/** Markup of one item, or null when its authorization/condition fails. */
export async function fieldHtml(v: View, it: ItemDef, bar = false): Promise<SafeHtml | null> {
   const { ctx, rs, ev, rendered } = v;
   if (!(await ev.allows(it))) return null;
   rendered.items.add(it.name);
   const stored = ctx.session.state.get(it.name) ?? null;
   const val = stored ?? '';
   if (it.type === 'hidden') return html`<input type="hidden" name="${it.name}" id="${it.name}" value="${val}">`;

   const err = rs.errors?.find(e => e.item === it.name);
   const errId = `${it.name}_error`, helpId = `${it.name}_help`;
   const described = [it.help ? helpId : '', err ? errId : ''].filter(Boolean).join(' ');
   const aria = html`${err ? raw(' aria-invalid="true"') : ''}${described ? html` aria-describedby="${described}"` : ''}`;
   const common = html` id="${it.name}" name="${it.name}"${attrIf('required', it.required)}${aria}`;
   const col = bar ? '' : ` r-col-${it.colSpan}`;
   const cascade = it.cascade.length ? html` data-cascade="${it.cascade.join(' ')}" data-cascade-url="${lovUrl(ctx, v.page, it, 'field')}"` : '';
   const extras = html`${it.help ? html`<span class="r-help" id="${helpId}">${it.help}</span>` : ''}
      ${err ? html`<span class="r-error-text" id="${errId}">${icon('circle-x')} ${err.message}</span>` : ''}`;
   const field = (lbl: SafeHtml, control: SafeHtml) =>
      html`<div class="r-field${col}" data-item="${it.name}"${cascade}>${lbl}${control}${extras}</div>`;
   const group = (control: SafeHtml) =>
      html`<fieldset class="r-field r-fieldset${col}" data-item="${it.name}"${cascade}${aria}>${legend(it)}${control}${extras}</fieldset>`;
   const lovFailed = (e: Error) =>
      html`<div class="r-field${col}" data-item="${it.name}"${cascade}>${label(it)}<span class="r-error-text">${icon('circle-x')} Daftar pilihan gagal dimuat: ${pgMessage(e)}</span></div>`;

   switch (it.type) {
      case 'textarea':
         return field(label(it), html`<textarea class="r-input"${common}${it.placeholder ? html` placeholder="${it.placeholder}"` : ''}${it.maxLength ? html` maxlength="${it.maxLength}"` : ''}>${val}</textarea>`);
      case 'display_only': {
         const shown = it.format === 'datetime' ? formatValue(stored, 'datetime') : formatValue(stored, it.format);
         return field(label(it), html`<div class="r-display" id="${it.name}">${shown}</div>`);
      }
      case 'select': {
         const opts = await lovOptions(ev.c, ctx, it);
         if (opts instanceof Error) return lovFailed(opts);
         // a stored value outside the list stays visible (the save will then ask for a valid choice)
         const extra = val !== '' && !opts.some(o => o.ret === val) ? [{ display: val, ret: val }] : [];
         return field(label(it), html`<select class="r-input"${common}>
            ${it.nullDisplay !== null ? html`<option value="">${it.nullDisplay}</option>` : ''}
            ${[...opts, ...extra].map(o => html`<option value="${o.ret}"${attrIf('selected', o.ret === val)}>${o.display}</option>`)}
         </select>`);
      }
      case 'radio': case 'checkbox_group': {
         const opts = await lovOptions(ev.c, ctx, it);
         if (opts instanceof Error) return lovFailed(opts);
         const chosen = new Set(it.type === 'radio' ? [val] : splitValues(stored));
         const type = it.type === 'radio' ? 'radio' : 'checkbox';
         // the first option carries the item id, so "#ITEM" links from the error summary land on the group
         return group(html`<div class="r-choice-group${it.inline ? ' r-choice-group--inline' : ''}">
            ${opts.map((o, n) => html`<label class="r-choice"><input type="${type}" name="${it.name}" id="${n ? `${it.name}_${n + 1}` : it.name}" value="${o.ret}"${attrIf('checked', chosen.has(o.ret))}${attrIf('required', it.required && type === 'radio')}${err ? raw(' aria-invalid="true"') : ''}> <span>${o.display}</span></label>`)}
            ${opts.length ? '' : html`<span class="r-help">Tidak ada pilihan.</span>`}
         </div>`);
      }
      case 'checkbox':
         return html`<div class="r-field${col}" data-item="${it.name}">
            <label class="r-choice"><input type="checkbox"${common} value="${it.onValue}"${attrIf('checked', stored === it.onValue)}> <span>${nameOf(it)}${it.required ? html`<span class="r-label__req" aria-hidden="true">*</span>` : ''}</span></label>${extras}</div>`;
      case 'switch':
         return field(label(it), html`<span class="r-switch"><input type="checkbox" role="switch"${common} value="${it.onValue}"${attrIf('checked', stored === it.onValue)}></span>`);
      case 'popup_lov': {
         const display = stored === null ? '' : await lovDisplay(ev.c, ctx, it, stored);
         // the visible box shows the display value; the hidden input carries the return value
         return field(label(it), html`<div class="r-input-group r-popup-lov" data-popup-lov="${lovUrl(ctx, v.page, it, 'lov')}" data-lov-title="${nameOf(it)}"${it.cascade.length ? html` data-lov-parents="${it.cascade.join(' ')}"` : ''}>
            <input type="hidden" name="${it.name}" id="${it.name}_value" value="${val}">
            <input type="text" class="r-input" id="${it.name}" value="${display}" readonly aria-haspopup="dialog"${it.placeholder ? html` placeholder="${it.placeholder}"` : html` placeholder="Pilih…"`}${attrIf('aria-required="true"', it.required)}${aria} data-lov-display>
            ${it.required ? '' : html`<button type="button" class="r-btn r-btn--icon" data-lov-clear aria-label="Kosongkan ${nameOf(it)}"${stored === null ? raw(' hidden') : ''}>${icon('x')}</button>`}
            <button type="button" class="r-btn r-btn--icon" data-lov-open aria-label="Pilih ${nameOf(it)} dari daftar">${icon('search')}</button>
         </div>`);
      }
      case 'datetime':
         return field(label(it), html`<input class="r-input" type="datetime-local"${common} value="${stored === null ? '' : toLocalInput(stored)}">`);
      default: {
         const type = it.type === 'date' ? 'date' : it.type === 'password' ? 'password' : 'text';
         const numeric = it.type === 'number';
         return field(label(it), html`<input class="r-input${numeric ? ' r-num' : ''}" type="${type}"${numeric ? raw(' inputmode="decimal"') : ''}${common} value="${it.type === 'password' ? '' : val}"${it.placeholder ? html` placeholder="${it.placeholder}"` : ''}${it.maxLength ? html` maxlength="${it.maxLength}"` : ''}>`);
      }
   }
}

export async function itemsHtml(v: View, items: ItemDef[], bar = false): Promise<SafeHtml> {
   const out: SafeHtml[] = [];
   for (const it of items) {
      const h = await fieldHtml(v, it, bar);
      if (h) out.push(h);
   }
   return html`${out}`;
}

// ---------------------------------------------------------------------------
// GET .../:page/lov/:item (popup LOV search) and GET .../:page/field/:item (cascading refresh)
// ---------------------------------------------------------------------------

/**
 * Parent values sent with a cascade/popup request apply to this request only (they are not saved).
 * Only parents the user can edit count: a hidden, display-only or restricted parent keeps its session value,
 * so a list that is filtered by a protected item cannot be widened from the URL.
 */
function applyParents(ctx: Ctx, page: PageDef, it: ItemDef, query: Record<string, unknown>) {
   for (const name of it.cascade) {
      const parent = page.items.find(x => x.name === name);
      if (!parent || parent.type === 'hidden' || parent.type === 'display_only' || parent.protection === 'restricted') continue;
      if (!(name in query) && !absentMeansEmpty(parent)) continue;
      ctx.session.state.set(name, postedValue(parent, query[name]));
   }
}

export async function itemEndpoint(ctx: Ctx, page: PageDef, itemName: string, what: 'lov' | 'field',
                                   query: Record<string, unknown>): Promise<string> {
   const it = page.items.find(x => x.name === itemName);
   if (!it || !LOV_TYPES.has(it.type) || (what === 'lov' && it.type !== 'popup_lov')) {
      throw new HttpError(404, 'Item tidak ditemukan', 'Item ini tidak memiliki daftar pilihan di halaman ini.');
   }
   applyParents(ctx, page, it, query);
   if (what === 'field') ctx.session.state.set(it.name, null);   // a new list: the old choice no longer applies
   const c = await ctx.pool.connect();
   const ev = new Evaluator(c, ctx);
   let out: SafeHtml;
   try {
      await c.query('begin');
      await enterUserCode(c, userCtx(ctx));
      const denial = await ev.pageDenial(page);
      if (denial) throw new HttpError(403, 'Akses ditolak', denial.errorMsg);
      if (!(await ev.allows(it))) throw new HttpError(403, 'Akses ditolak', 'Anda tidak berhak memakai item ini.');
      if (what === 'field') {
         const v: View = {
            ctx, page, ev, rs: { runBeforeHeader: false }, rendered: { items: new Set(), buttons: new Set() },
            allowed: new Map(), extraForms: [], changes: {},
         };
         out = (await fieldHtml(v, it)) ?? html``;
      } else {
         const q = typeof query.q === 'string' ? query.q.slice(0, 200) : '';
         const pageNo = Math.max(1, Math.min(1000, Number.parseInt(String(query.p ?? '1'), 10) || 1));
         out = await popupList(c, ctx, it, q, pageNo);
      }
   } finally {
      await c.query('rollback').catch(() => {});
      c.release();
   }
   await ev.flush();
   return out.value;
}

async function popupList(c: pg.PoolClient, ctx: Ctx, it: ItemDef, q: string, pageNo: number): Promise<SafeHtml> {
   const r = await lovSearch(c, ctx, it, q, pageNo);
   if (r instanceof Error) return html`<p class="r-error-text" data-lov-status>${icon('circle-x')} Daftar pilihan gagal dimuat: ${pgMessage(r)}</p>`;
   const first = (pageNo - 1) * POPUP_PAGE_SIZE;
   const status = r.options.length || pageNo > 1
      ? `${first + r.options.length}${r.more ? '+' : ''} pilihan${q ? ` cocok dengan "${q}"` : ''}`
      : `Tidak ada pilihan${q ? ` yang cocok dengan "${q}"` : ''}.`;
   const options = r.options.map((o, n) => html`<li role="option" id="r-lov-opt-${first + n}" aria-selected="false" data-return="${o.ret}" data-display="${o.display}"><span>${highlight(o.display, q)}</span></li>`);
   return html`${r.options.length
         ? html`<ul class="r-lov-list" role="listbox" id="r-lov-list" aria-label="Pilihan ${nameOf(it)}">${options}</ul>`
         : pageNo > 1 ? '' : html`<p class="r-lov-empty">${status}</p>`}
   ${r.more ? html`<button type="button" class="r-btn r-btn--sm r-btn--ghost r-lov-more" data-lov-page="${pageNo + 1}">Muat lebih banyak</button>` : ''}
   <p class="r-sr-only" data-lov-status>${status}</p>`;
}
