import YAML from 'yaml';
import { attrIf, html, type SafeHtml } from '../engine/html.ts';
import { icon } from '../engine/templates.ts';
import type { DaActionSpec, DaActionType, DaCondition, DynamicActionSpec, PageSpec } from '../spec/import.ts';

// Page Designer: the form for one dynamic action (DA3). Event, trigger, condition and the list of actions are edited
// with ordinary controls; item, region and button names are picked from the page. Rows are added, moved and removed
// with submit buttons that only re-render the form (nothing is saved until "Simpan"), so the editor works without
// JavaScript; rpx.js only hides the fields that do not apply to the chosen event, condition or action.
// The same dynamic action can also be edited as YAML.

type Body = Record<string, unknown>;

export const DA_EVENTS: [string, string][] = [
   ['change', 'Item berubah'], ['key_release', 'Mengetik di item'], ['click', 'Tombol diklik'], ['page_load', 'Halaman dibuka'],
];
export const DA_CONDITIONS: [string, string][] = [
   ['', 'Selalu (tanpa kondisi)'], ['item_equals', 'Item sama dengan'], ['item_not_equals', 'Item tidak sama dengan'],
   ['item_in', 'Item salah satu dari'], ['item_not_in', 'Item bukan salah satu dari'], ['item_null', 'Item kosong'],
   ['item_not_null', 'Item terisi'],
];
export const DA_ACTIONS: [DaActionType, string][] = [
   ['show', 'Tampilkan'], ['hide', 'Sembunyikan'], ['enable', 'Aktifkan'], ['disable', 'Nonaktifkan'],
   ['set_value', 'Isi nilai'], ['clear', 'Kosongkan'], ['refresh', 'Muat ulang region'], ['confirm', 'Minta konfirmasi'],
   ['submit_page', 'Kirim halaman'], ['execute_server_code', 'Jalankan kode di server'],
];
/** which action field applies to which action types (the rest is dropped on save and hidden by rpx.js) */
const FOR: Record<string, DaActionType[]> = {
   items: ['show', 'hide', 'enable', 'disable', 'set_value', 'clear'],
   regions: ['show', 'hide', 'refresh'],
   buttons: ['show', 'hide', 'enable', 'disable'],
   value: ['set_value'], from_item: ['set_value'],
   message: ['confirm'], request: ['submit_page'],
   code: ['execute_server_code'], items_to_return: ['execute_server_code'],
   items_to_submit: ['execute_server_code', 'refresh'],
   on_load: ['show', 'hide', 'enable', 'disable', 'set_value', 'clear'],
};

export interface ActionDraft {
   branch: 'actions' | 'else'; action: DaActionType; items: string[]; regions: string[]; buttons: string[];
   value: string; from_item: string; message: string; request: string; code: string; on_load: string;
   items_to_submit: string[]; items_to_return: string[];
}
export interface DaDraft {
   name: string; event: string; items: string[]; button: string;
   condType: string; condItem: string; condValue: string; actions: ActionDraft[];
}

const emptyAction = (): ActionDraft => ({
   branch: 'actions', action: 'show', items: [], regions: [], buttons: [], value: '', from_item: '', message: '', request: '',
   code: '', on_load: '', items_to_submit: [], items_to_return: [],
});

export function draftFromDa(da: DynamicActionSpec): DaDraft {
   const w = (da.when ?? {}) as DaCondition;
   const condType = Object.keys(w)[0] ?? '';
   const arg = (w as Record<string, unknown>)[condType];
   const conv = (branch: 'actions' | 'else') => (a: DaActionSpec): ActionDraft => ({
      ...emptyAction(), branch, action: a.action, items: a.items ?? [], regions: a.regions ?? [], buttons: a.buttons ?? [],
      value: a.value ?? '', from_item: a.from_item ?? '', message: a.message ?? '', request: a.request ?? '', code: a.code ?? '',
      on_load: a.on_load === undefined ? '' : String(a.on_load), items_to_submit: a.items_to_submit ?? [], items_to_return: a.items_to_return ?? [],
   });
   return {
      name: da.name, event: da.event, items: da.items ?? [], button: da.button ?? '',
      condType,
      condItem: typeof arg === 'string' ? arg : String((arg as { item?: string } | undefined)?.item ?? ''),
      condValue: condType === 'item_in' || condType === 'item_not_in' ? ((arg as { values: string[] }).values ?? []).join(', ')
         : String((arg as { value?: string } | undefined)?.value ?? ''),
      actions: [...(da.actions ?? []).map(conv('actions')), ...(da.else ?? []).map(conv('else'))],
   };
}

const str = (v: unknown) => (Array.isArray(v) ? String(v[v.length - 1] ?? '') : typeof v === 'string' ? v : '');
const list = (v: unknown) => (Array.isArray(v) ? v : typeof v === 'string' ? [v] : []).map(String).filter(x => x !== '');

export function draftFromBody(b: Body): DaDraft {
   const n = Math.min(50, Math.max(0, Number(str(b['a.count'])) || 0));
   const actions: ActionDraft[] = [];
   for (let i = 0; i < n; i++) {
      const k = (f: string) => b[`a.${i}.${f}`];
      const type = str(k('action')) as DaActionType;
      actions.push({
         branch: str(k('branch')) === 'else' ? 'else' : 'actions',
         action: DA_ACTIONS.some(([t]) => t === type) ? type : 'show',
         items: list(k('items')), regions: list(k('regions')), buttons: list(k('buttons')),
         value: str(k('value')), from_item: str(k('from_item')), message: str(k('message')).trim(), request: str(k('request')).trim(),
         code: str(k('code')).replace(/\s+$/, ''), on_load: str(k('on_load')),
         items_to_submit: list(k('items_to_submit')), items_to_return: list(k('items_to_return')),
      });
   }
   return {
      name: str(b['da.name']).trim(), event: str(b['da.event']), items: list(b['da.items']), button: str(b['da.button']),
      condType: str(b['da.cond']), condItem: str(b['da.cond_item']), condValue: str(b['da.cond_value']), actions,
   };
}

/** where the focus goes after a row operation */
export function focusAfter(d: DaDraft, op: string): string {
   const [what, at] = op.split(':');
   const i = Number(at);
   if (what === 'add') return `a-${d.actions.length - 1}-action`;
   if (what === 'up') return `a-${i - 1}-action`;
   if (what === 'down') return `a-${i + 1}-action`;
   return 'da-add';
}

/** row operations that only change the form: "add", "del:2", "up:1", "down:0" */
export function applyRowOp(d: DaDraft, op: string): boolean {
   const [what, at] = op.split(':');
   const i = Number(at);
   if (what === 'add') { d.actions.push(emptyAction()); return true; }
   if (!Number.isInteger(i) || i < 0 || i >= d.actions.length) return false;
   if (what === 'del') { d.actions.splice(i, 1); return true; }
   const to = what === 'up' ? i - 1 : what === 'down' ? i + 1 : -1;
   if (to < 0 || to >= d.actions.length) return false;
   [d.actions[i], d.actions[to]] = [d.actions[to], d.actions[i]];
   return true;
}

/** The dynamic action as the spec has it; fields that do not apply are left out. Errors are keyed by form field. */
export function draftToDa(d: DaDraft): { da: DynamicActionSpec; errors: Record<string, string> } {
   const errors: Record<string, string> = {};
   if (!d.name) errors['da.name'] = 'Nama wajib diisi.';
   const da: DynamicActionSpec = { name: d.name, event: (d.event || 'change') as DynamicActionSpec['event'] };
   if (da.event === 'change' || da.event === 'key_release') {
      if (!d.items.length) errors['da.items'] = 'Pilih minimal satu item yang diawasi.';
      da.items = d.items;
   }
   if (da.event === 'click') {
      if (!d.button) errors['da.button'] = 'Pilih tombolnya.';
      da.button = d.button;
   }
   if (d.condType) {
      if (!d.condItem) errors['da.cond_item'] = 'Pilih item untuk kondisi.';
      const t = d.condType;
      if (t === 'item_null' || t === 'item_not_null') da.when = { [t]: d.condItem } as DaCondition;
      else if (t === 'item_in' || t === 'item_not_in') {
         const values = d.condValue.split(',').map(v => v.trim()).filter(Boolean);
         if (!values.length) errors['da.cond_value'] = 'Isi minimal satu nilai, dipisah koma.';
         da.when = { [t]: { item: d.condItem, values } } as DaCondition;
      } else da.when = { [t]: { item: d.condItem, value: d.condValue } } as DaCondition;
   }
   const yes: DaActionSpec[] = [];
   const no: DaActionSpec[] = [];
   for (const a of d.actions) {
      const on = (f: string) => FOR[f].includes(a.action);
      const x: DaActionSpec = { action: a.action };
      if (on('items') && a.items.length) x.items = a.items;
      if (on('regions') && a.regions.length) x.regions = a.regions;
      if (on('buttons') && a.buttons.length) x.buttons = a.buttons;
      if (a.action === 'set_value') { if (a.from_item) x.from_item = a.from_item; else x.value = a.value; }
      if (on('message')) x.message = a.message;
      if (on('request') && a.request) x.request = a.request;
      if (on('code')) x.code = a.code ? `${a.code}\n` : '';
      if (on('items_to_submit') && a.items_to_submit.length) x.items_to_submit = a.items_to_submit;
      if (on('items_to_return') && a.items_to_return.length) x.items_to_return = a.items_to_return;
      if (on('on_load') && (a.on_load === 'true' || a.on_load === 'false')) x.on_load = a.on_load === 'true';
      (a.branch === 'else' && d.condType ? no : yes).push(x);
   }
   if (!d.actions.length) errors['da.actions'] = 'Tambahkan minimal satu aksi.';
   da.actions = yes;
   if (no.length) da.else = no;
   return { da, errors };
}

/** YAML of one dynamic action (for the "edit as YAML" box) */
export const daYaml = (da: DynamicActionSpec) => YAML.stringify(da, { lineWidth: 0 }).trimEnd();

// ---------------------------------------------------------------- view

interface Choices { items: string[]; regions: [string, string][]; buttons: string[]; daButtons: string[] }

export function pageChoices(page: PageSpec): Choices {
   const regions = page.regions ?? [];
   return {
      items: regions.flatMap(r => (r.items ?? []).map(i => i.name)),
      regions: regions.map(r => [r.static_id, r.title ?? r.static_id] as [string, string]),
      buttons: regions.flatMap(r => (r.buttons ?? []).map(b => b.name)),
      daButtons: regions.flatMap(r => (r.buttons ?? []).filter(b => b.action === 'defined_by_da').map(b => b.name)),
   };
}

/** focus: the id of the control to focus after a row operation re-rendered the form */
export function daFormHtml(page: PageSpec, d: DaDraft, errors: Record<string, string>, yamlText: string, focus = ''): SafeHtml {
   const c = pageChoices(page);
   const err = (key: string) => (errors[key] ? html`<p class="r-error-text" id="${key.replace(/\./g, '-')}-err">${errors[key]}</p>` : '');
   const inv = (key: string) => (errors[key] ? html` aria-invalid="true" aria-describedby="${key.replace(/\./g, '-')}-err"` : '');
   const options = (pairs: [string, string][], value: string) => pairs.map(([v, l]) => html`<option value="${v}"${attrIf('selected', v === value)}>${l}</option>`);
   const multi = (id: string, name: string, label: string, pairs: [string, string][], chosen: string[], help: string, key = name, cls = 'r-col-6') => html`
      <div class="r-field ${cls}"${raw0(key)}><label class="r-label" for="${id}">${label}</label>
        <select class="r-input r-da-multi" id="${id}" name="${name}" multiple size="${Math.min(6, Math.max(3, pairs.length))}" aria-describedby="${id}-help"${inv(key)}>
          ${pairs.map(([v, l]) => html`<option value="${v}"${attrIf('selected', chosen.includes(v))}>${l}</option>`)}</select>
        <p class="r-help" id="${id}-help">${help}</p>${err(key)}</div>`;
   const one = (id: string, name: string, label: string, pairs: [string, string][], value: string, blank: string, key = name) => html`
      <div class="r-field r-col-6"${name === 'da.cond_item' ? html` data-da-cond-for="${DA_CONDITIONS.map(([t]) => t).filter(Boolean).join(' ')}"` : ''}><label class="r-label" for="${id}">${label}</label>
        <select class="r-input" id="${id}" name="${name}"${inv(key)}><option value="">${blank}</option>${options(pairs, value)}</select>${err(key)}</div>`;
   const itemPairs = c.items.map(n => [n, n] as [string, string]);
   const multiHelp = 'Ctrl/Cmd + klik untuk memilih lebih dari satu.';

   const rows = d.actions.map((a, i) => {
      const p = `a.${i}`;
      const id = (f: string) => `a-${i}-${f}`;
      const forAttr = (f: string) => html` data-da-for="${FOR[f].join(' ')}"`;
      const field = (f: string, inner: SafeHtml, wide = false) => html`<div class="r-field ${wide ? 'r-col-12' : 'r-col-6'}"${forAttr(f)}>${inner}</div>`;
      const multiField = (f: keyof ActionDraft, label: string, pairs: [string, string][], help = multiHelp) => field(f, html`
         <label class="r-label" for="${id(f)}">${label}</label>
         <select class="r-input r-da-multi" id="${id(f)}" name="${p}.${f}" multiple size="${Math.min(5, Math.max(3, pairs.length))}" aria-describedby="${id(f)}-help">
           ${pairs.map(([v, l]) => html`<option value="${v}"${attrIf('selected', (a[f] as string[]).includes(v))}>${l}</option>`)}</select>
         <p class="r-help" id="${id(f)}-help">${help}</p>`);
      return html`<li class="r-da-action" data-da-row>
  <fieldset class="r-fieldset">
    <legend class="r-label">Aksi ${i + 1}</legend>
    <div class="r-form">
      <div class="r-field r-col-6"><label class="r-label" for="${id('action')}">Jenis aksi</label>
        <select class="r-input" id="${id('action')}" name="${p}.action" data-da-type${attrIf('autofocus', focus === id('action'))}>${options(DA_ACTIONS, a.action)}</select></div>
      <div class="r-field r-col-6" data-da-when-cond><label class="r-label" for="${id('branch')}">Dijalankan bila</label>
        <select class="r-input" id="${id('branch')}" name="${p}.branch">${options([['actions', 'kondisi benar'], ['else', 'kondisi salah (else)']], a.branch)}</select></div>
      ${multiField('items', 'Item', itemPairs)}
      ${multiField('regions', 'Region', c.regions.map(([s, t]) => [s, `${t} (${s})`] as [string, string]))}
      ${multiField('buttons', 'Tombol', c.buttons.map(n => [n, n] as [string, string]))}
      ${field('value', html`<label class="r-label" for="${id('value')}">Nilai tetap</label>
        <input class="r-input" id="${id('value')}" name="${p}.value" value="${a.value}" aria-describedby="${id('value')}-help">
        <p class="r-help" id="${id('value')}-help">Dipakai bila "Ambil dari item" kosong.</p>`)}
      ${field('from_item', html`<label class="r-label" for="${id('from_item')}">Ambil dari item</label>
        <select class="r-input" id="${id('from_item')}" name="${p}.from_item"><option value="">(tidak, pakai nilai tetap)</option>${options(itemPairs, a.from_item)}</select>`)}
      ${field('message', html`<label class="r-label" for="${id('message')}">Pertanyaan konfirmasi</label>
        <input class="r-input" id="${id('message')}" name="${p}.message" value="${a.message}">`, true)}
      ${field('request', html`<label class="r-label" for="${id('request')}">REQUEST</label>
        <input class="r-input r-mono" id="${id('request')}" name="${p}.request" value="${a.request}" aria-describedby="${id('request')}-help">
        <p class="r-help" id="${id('request')}-help">Kosong = nama tombol yang diklik. Proses memakai <span class="r-mono">when_button</span> atau kondisi <span class="r-mono">request_equals</span>.</p>`)}
      ${field('on_load', html`<label class="r-label" for="${id('on_load')}">Juga saat halaman dibuka</label>
        <select class="r-input" id="${id('on_load')}" name="${p}.on_load">${options([['', '(bawaan)'], ['true', 'ya'], ['false', 'tidak']], a.on_load)}</select>`)}
      ${field('code', html`<label class="r-label" for="${id('code')}">Kode PL/pgSQL</label>
        <textarea class="r-input r-mono r-prop-code" id="${id('code')}" name="${p}.code" rows="${Math.min(14, Math.max(4, a.code.split('\n').length + 1))}" spellcheck="false" aria-describedby="${id('code')}-help">${a.code}</textarea>
        <p class="r-help" id="${id('code')}-help">Baca item dengan <span class="r-mono">:P1_X</span>, ubah dengan <span class="r-mono">perform rpx_rt.set_item('P1_X', nilai);</span></p>`, true)}
      ${multiField('items_to_submit', 'Item yang dikirim ke server', itemPairs, 'Nilai di layar yang dikirim lebih dulu. ' + multiHelp)}
      ${multiField('items_to_return', 'Item yang dikembalikan', itemPairs, 'Nilai barunya langsung tampil di halaman. ' + multiHelp)}
    </div>
    <div class="r-da-action__ops" role="group" aria-label="Aksi ${i + 1}">
      <button type="submit" class="r-btn r-btn--sm" name="do" value="up:${i}"${attrIf('disabled', i === 0)}>Naik<span class="r-sr-only"> aksi ${i + 1}</span></button>
      <button type="submit" class="r-btn r-btn--sm" name="do" value="down:${i}"${attrIf('disabled', i === d.actions.length - 1)}>Turun<span class="r-sr-only"> aksi ${i + 1}</span></button>
      <button type="submit" class="r-btn r-btn--sm r-btn--danger" name="do" value="del:${i}">${icon('trash-2')} Hapus<span class="r-sr-only"> aksi ${i + 1}</span></button>
    </div>
  </fieldset></li>`;
   });

   return html`<div class="r-da-form" data-da-form>
  <button type="submit" name="do" value="save" hidden tabindex="-1" aria-hidden="true">Simpan</button>
  <div class="r-form">
    <div class="r-field r-col-6"><label class="r-label" for="da-name">Nama <span class="r-label__req" aria-hidden="true">*</span></label>
      <input class="r-input r-mono" id="da-name" name="da.name" value="${d.name}" required${inv('da.name')}>${err('da.name')}</div>
    <div class="r-field r-col-6"><label class="r-label" for="da-event">Kapan berjalan</label>
      <select class="r-input" id="da-event" name="da.event" data-da-event>${options(DA_EVENTS, d.event)}</select></div>
    ${multi('da-items', 'da.items', 'Item yang diawasi', itemPairs, d.items, multiHelp)}
    <div class="r-field r-col-6" data-da-event-for="click"><label class="r-label" for="da-button">Tombol</label>
      <select class="r-input" id="da-button" name="da.button" aria-describedby="da-button-help"${inv('da.button')}><option value="">- Pilih -</option>${options(c.daButtons.map(n => [n, n] as [string, string]), d.button)}</select>
      <p class="r-help" id="da-button-help">Hanya tombol dengan aksi <span class="r-mono">defined_by_da</span>. ${c.daButtons.length ? '' : 'Halaman ini belum punya; ubah aksi tombolnya dulu.'}</p>${err('da.button')}</div>
    <div class="r-field r-col-6"><label class="r-label" for="da-cond">Kondisi</label>
      <select class="r-input" id="da-cond" name="da.cond" data-da-cond>${options(DA_CONDITIONS, d.condType)}</select></div>
    ${one('da-cond-item', 'da.cond_item', 'Item kondisi', itemPairs, d.condItem, '- Pilih -')}
    <div class="r-field r-col-6" data-da-cond-for="item_equals item_not_equals item_in item_not_in"><label class="r-label" for="da-cond-value">Nilai kondisi</label>
      <input class="r-input" id="da-cond-value" name="da.cond_value" value="${d.condValue}" aria-describedby="da-cond-value-help"${inv('da.cond_value')}>
      <p class="r-help" id="da-cond-value-help">Dibandingkan sebagai teks. Untuk "salah satu dari", pisahkan dengan koma.</p>${err('da.cond_value')}</div>
  </div>
  <h3 class="r-da-form__heading">Aksi, dijalankan berurutan</h3>
  ${err('da.actions')}
  <input type="hidden" name="a.count" value="${d.actions.length}">
  ${d.actions.length ? html`<ol class="r-da-actions" role="list">${rows}</ol>` : html`<p class="r-muted">Belum ada aksi.</p>`}
  <button type="submit" class="r-btn r-btn--sm" id="da-add" name="do" value="add"${attrIf('autofocus', focus === 'da-add')}>${icon('plus')} Tambah aksi</button>
</div>
<details class="r-da-yaml"${attrIf('open', !!yamlText && !!errors['yaml'])}>
  <summary>Ubah sebagai YAML</summary>
  <div class="r-field"><label class="r-label" for="da-yaml">Dynamic action ini dalam YAML</label>
    <textarea class="r-input r-mono r-prop-code" id="da-yaml" name="yaml" rows="${Math.min(20, Math.max(6, yamlText.split('\n').length + 1))}" spellcheck="false"${inv('yaml')}>${yamlText}</textarea>${err('yaml')}</div>
  <button type="submit" class="r-btn r-btn--sm" name="do" value="save_yaml">Simpan YAML</button>
</details>`;
}

// the trigger-item and condition-item fields carry a data attribute so rpx.js can hide them when they do not apply
function raw0(key: string): SafeHtml {
   if (key === 'da.items') return html` data-da-event-for="change key_release"`;
   return html``;
}
