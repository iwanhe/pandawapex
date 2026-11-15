import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import YAML from 'yaml';
import { attrIf, html, raw, type SafeHtml } from '../engine/html.ts';
import { HttpError } from '../engine/runtime.ts';
import { alert, icon } from '../engine/templates.ts';
import { exportSpec, specToYaml } from '../spec/export.ts';
import { SpecError, type AppSpec, type PageSpec } from '../spec/import.ts';
import schema from '../spec/spec.schema.json' with { type: 'json' };
import type { BuilderContext } from './routes.ts';
import { setFlash, takeFlash, type DevSession, type Flash } from './session.ts';
import { appUrl, runUrl, shell } from './views.ts';

// S06 Page Designer (B5, flow F03) and S13 application properties.
// Left: the page as a tree (regions with their items, buttons and columns; validations, processes, branches, computations).
// Right: a property editor for the selected component, generated from spec.schema.json, so every attribute the spec
// knows can be edited; nested structures (conditions, links, lists) are edited as small YAML blocks.
// Saving exports the application spec, changes the one component, and imports it again: same checks as an import,
// one more entry in the version history. A version token (the spec hash) stops two developers from overwriting each other.

type Json = Record<string, unknown>;
type Schema = { type?: string; enum?: string[]; $ref?: string; properties?: Record<string, Schema>; required?: string[]; description?: string; oneOf?: Schema[]; items?: Schema; additionalProperties?: unknown; minimum?: number; maximum?: number };
const DEFS = (schema as unknown as { definitions: Record<string, Schema> }).definitions;
const ROOT = schema as unknown as Schema;
const PAGE_DEF = ROOT.properties!.pages!.items!;

function resolve(s: Schema): Schema {
   let x = s;
   for (let n = 0; x.$ref && n < 10; n++) x = DEFS[x.$ref.replace('#/definitions/', '')];
   return x;
}
const isScalar = (s: Schema) => { const r = resolve(s); return !!r.enum || r.type === 'string' || r.type === 'integer' || r.type === 'boolean' || r.type === 'number'; };

// ---------------------------------------------------------------- property fields

type FieldKind = 'text' | 'code' | 'int' | 'bool' | 'enum' | 'yaml';
interface Field { key: string; label: string; kind: FieldKind; options?: string[]; required: boolean; help?: string }

const LABELS: Record<string, string> = {
   page: 'Nomor halaman', alias: 'Alias', name: 'Nama', title: 'Judul', requires_auth: 'Perlu login', breadcrumb_parent: 'Induk breadcrumb',
   authorization: 'Otorisasi', mode: 'Mode', dialog_size: 'Ukuran dialog', static_id: 'Static ID', type: 'Jenis', template: 'Template',
   col_span: 'Lebar kolom (1–12)', new_row: 'Mulai baris baru', 'source.sql': 'Sumber: query SQL', 'source.table': 'Sumber: tabel',
   'source.html': 'Sumber: HTML', 'source.column': 'Sumber: kolom', 'source.pk': 'Primary key', page_size: 'Baris per halaman',
   empty_text: 'Teks bila kosong', condition: 'Kondisi', max_download_rows: 'Batas baris unduhan', 'sort.column': 'Urut kolom',
   'sort.dir': 'Urut arah', 'chart.type': 'Jenis grafik', 'chart.format': 'Format angka', 'chart.value_label': 'Label nilai',
   label: 'Label', help: 'Bantuan', placeholder: 'Placeholder', required: 'Wajib diisi', default: 'Nilai default', lov: 'Daftar pilihan (LOV)',
   protection: 'Proteksi', max_length: 'Panjang maksimal', cascade: 'Bergantung pada item', null_display: 'Teks pilihan kosong',
   on_value: 'Nilai aktif', off_value: 'Nilai nonaktif', inline: 'Sebaris', format: 'Format', read_only: 'Hanya baca bila',
   hot: 'Tombol utama', action: 'Aksi', target: 'Tujuan', style: 'Gaya', confirm: 'Pesan konfirmasi', position: 'Posisi',
   data_type: 'Tipe data', is_pk: 'Primary key', hidden: 'Disembunyikan', link: 'Link', searchable: 'Bisa dicari', sortable: 'Bisa diurutkan',
   expression: 'Ekspresi', error_msg: 'Pesan error', item: 'Item', when_button: 'Hanya untuk tombol', point: 'Titik eksekusi',
   region: 'Region', code: 'Kode PL/pgSQL', success_msg: 'Pesan sukses', items: 'Isi item tujuan', clear_cache: 'Kosongkan cache halaman',
   version: 'Versi', parsing_schema: 'Skema parsing', home_page: 'Halaman beranda', timezone: 'Zona waktu', substitutions: 'Substitution strings',
   authentication: 'Autentikasi', navigation: 'Menu navigasi', authorization_scheme: 'Otorisasi aplikasi', application_items: 'Application items',
   computations: 'Computations aplikasi', lovs: 'Daftar pilihan bersama (LOV)',
};
// help in the builder's language; the schema's own descriptions are written for spec authors
const HELP: Record<string, string> = {
   cascade: 'Daftar item induk, mis. [P4_DEPTNO]. Bila induk berubah, pilihan item ini dimuat ulang dan nilainya dikosongkan.',
   null_display: 'Teks pilihan kosong pada select atau popup LOV.',
   on_value: 'Checkbox/switch: nilai saat aktif (bawaan Y).', off_value: 'Checkbox/switch: nilai saat nonaktif (bawaan N).',
   inline: 'Radio/checkbox group: pilihan berjajar ke samping.', format: 'Cara nilai ditampilkan (display only dan kolom report).',
   read_only: 'Bila kondisi ini terpenuhi, item tampil sebagai teks dan nilai kirimannya diabaikan. Contoh: item_not_null: P2_ID',
   condition: 'Komponen hanya tampil/jalan bila kondisi terpenuhi. Contoh: item_not_null: P2_ID, atau request_in: [SIMPAN, HAPUS]',
   'sort.column': 'Interactive Report: urutan awal sampai pengguna memilih yang lain.',
   'chart.value_label': 'Arti nilai pada grafik, mis. Jumlah atau Rp. Query grafik mengembalikan label, nilai.',
   expression: 'sql_*: ekspresi atau query SQL; regex: pola; fn_boolean: body PL/pgSQL yang mengembalikan boolean; fn_returns_error: body yang mengembalikan teks error atau null.',
   mode: 'modal: dibuka sebagai dialog di atas halaman pemanggil.', lov: 'Nama LOV bersama (mis. DEPARTEMEN) atau definisi langsung: sql: select tampil, nilai from …',
   target: 'Contoh: page: 2 dengan items: { P2_ID: "#ID#" }', link: 'Contoh: page: 2, items: { P2_ID: "#ID#" }, clear_cache: "2"',
   lovs: 'Daftar pilihan bersama, dipakai item lewat namanya.', authentication: 'builtin_accounts, no_auth, atau scheme: oidc dengan pengaturan oidc.',
   items: 'Nilai yang diisikan ke item halaman tujuan, mis. P2_ID: "&P1_ID."',
};
const CODE_KEYS = new Set(['source.sql', 'source.html', 'code', 'expression']);
const humanize = (k: string) => { const w = k.replace(/[._]+/g, ' '); return w[0].toUpperCase() + w.slice(1); };

function fieldsFor(def: Schema, exclude: string[]): Field[] {
   const out: Field[] = [];
   const req = new Set(def.required ?? []);
   for (const [key, raw0] of Object.entries(def.properties ?? {})) {
      if (exclude.includes(key)) continue;
      const s = resolve(raw0);
      const add = (k: string, sc: Schema, required: boolean) => {
         const r = resolve(sc);
         const kind: FieldKind = r.enum ? 'enum' : r.type === 'boolean' ? 'bool' : r.type === 'integer' ? 'int'
            : r.type === 'string' ? (CODE_KEYS.has(k) ? 'code' : 'text') : 'yaml';
         out.push({ key: k, label: LABELS[k] ?? humanize(k), kind, options: r.enum, required, help: HELP[k] });
      };
      // a small object of plain values (source, sort, chart) is shown as separate fields
      if (s.type === 'object' && s.properties && !s.oneOf && Object.values(s.properties).every(isScalar)) {
         for (const [sub, ss] of Object.entries(s.properties)) add(`${key}.${sub}`, ss, false);
      } else {
         add(key, raw0, req.has(key));
      }
   }
   return out;
}

function getPath(o: Json, k: string): unknown {
   const [a, b] = k.split('.');
   return b === undefined ? o[a] : (o[a] as Json | undefined)?.[b];
}
function setPath(o: Json, k: string, v: unknown): void {
   const [a, b] = k.split('.');
   if (b === undefined) { if (v === undefined) delete o[a]; else o[a] = v; return; }
   const sub = { ...((o[a] as Json | undefined) ?? {}) };
   if (v === undefined) delete sub[b]; else sub[b] = v;
   if (Object.keys(sub).length) o[a] = sub; else delete o[a];
}

function valuesOf(o: Json, fields: Field[]): Record<string, string> {
   const v: Record<string, string> = {};
   for (const f of fields) {
      const x = getPath(o, f.key);
      if (x === undefined || x === null) v[f.key] = '';
      else if (f.kind === 'yaml') v[f.key] = YAML.stringify(x, { lineWidth: 0 }).trimEnd();
      else v[f.key] = String(x);
   }
   return v;
}

/** the submitted values applied to a copy of the component; children and unknown keys are kept */
function applyValues(o: Json, fields: Field[], values: Record<string, string>): { obj: Json; errors: Record<string, string> } {
   const obj = structuredClone(o);
   const errors: Record<string, string> = {};
   for (const f of fields) {
      const raw0 = (values[f.key] ?? '').replace(/\r\n/g, '\n');
      const text = f.kind === 'code' ? raw0.replace(/\s+$/, '') : raw0.trim();
      if (!text) {
         if (f.required) errors[f.key] = `${f.label} wajib diisi.`;
         setPath(obj, f.key, undefined);
         continue;
      }
      switch (f.kind) {
         case 'int':
            if (!/^-?\d+$/.test(text)) { errors[f.key] = `${f.label} harus bilangan bulat.`; break; }
            setPath(obj, f.key, Number(text)); break;
         case 'bool': setPath(obj, f.key, text === 'true'); break;
         case 'enum':
            if (f.options && !f.options.includes(text)) { errors[f.key] = `${f.label}: pilihan tidak dikenal.`; break; }
            setPath(obj, f.key, text); break;
         case 'yaml':
            try { setPath(obj, f.key, YAML.parse(text)); } catch (e) { errors[f.key] = `${f.label}: YAML tidak valid (${(e as Error).message.split('\n')[0]}).`; }
            break;
         default: setPath(obj, f.key, f.kind === 'code' ? raw0.replace(/\s+$/, '') + (raw0.includes('\n') ? '\n' : '') : text);
      }
   }
   return { obj, errors };
}

function fieldHtml(f: Field, value: string, error: string | undefined): SafeHtml {
   const id = `f-${f.key.replace(/\./g, '-')}`;
   const describedBy = [f.help || f.kind === 'yaml' ? `${id}-help` : '', error ? `${id}-err` : ''].filter(Boolean).join(' ');
   const aria = raw(`${error ? ' aria-invalid="true"' : ''}${describedBy ? ` aria-describedby="${describedBy}"` : ''}`);
   const name = `f.${f.key}`;
   const label = html`<label class="r-label" for="${id}">${f.label}${f.required ? html` <span class="r-label__req" aria-hidden="true">*</span>` : ''} <span class="r-prop-key">${f.key}</span></label>`;
   let control: SafeHtml;
   switch (f.kind) {
      case 'enum':
         control = html`<select class="r-input" id="${id}" name="${name}"${aria}><option value="">${f.required ? '- Pilih -' : '(bawaan)'}</option>${f.options!.map(o => html`<option value="${o}"${attrIf('selected', o === value)}>${o}</option>`)}</select>`; break;
      case 'bool':
         control = html`<select class="r-input" id="${id}" name="${name}"${aria}><option value="">(bawaan)</option><option value="true"${attrIf('selected', value === 'true')}>ya</option><option value="false"${attrIf('selected', value === 'false')}>tidak</option></select>`; break;
      case 'int':
         control = html`<input class="r-input" id="${id}" name="${name}" inputmode="numeric" value="${value}"${aria}>`; break;
      case 'code': case 'yaml':
         control = html`<textarea class="r-input r-mono r-prop-code" id="${id}" name="${name}" rows="${Math.min(14, Math.max(f.kind === 'yaml' ? 2 : 3, value.split('\n').length + 1))}" spellcheck="false"${aria}>${value}</textarea>`; break;
      default:
         control = html`<input class="r-input" id="${id}" name="${name}" value="${value}"${aria}>`;
   }
   const wide = f.kind === 'code' || f.kind === 'yaml';
   return html`<div class="r-field ${wide ? 'r-col-12' : 'r-col-6'}">${label}${control}
      ${f.help || f.kind === 'yaml' ? html`<p class="r-help" id="${id}-help">${f.help ?? ''}${f.kind === 'yaml' ? ` ${f.help ? '' : 'Ditulis dalam YAML.'} Kosongkan untuk menghapus.` : ''}</p>` : ''}
      ${error ? html`<p class="r-error-text" id="${id}-err">${error}</p>` : ''}</div>`;
}

// ---------------------------------------------------------------- components of a page

type Kind = 'page' | 'region' | 'item' | 'button' | 'column' | 'validation' | 'process' | 'branch' | 'computation';
interface NodeAt { kind: Kind; list: Json[] | null; index: number; obj: Json; def: Schema; exclude: string[]; title: string }

const KIND_LABEL: Record<Kind, string> = {
   page: 'Halaman', region: 'Region', item: 'Item', button: 'Tombol', column: 'Kolom', validation: 'Validasi', process: 'Proses', branch: 'Branch', computation: 'Computation',
};
const PAGE_LISTS = { validation: 'validations', process: 'processes', branch: 'branches', computation: 'computations' } as const;
const REGION_LISTS = { item: 'items', button: 'buttons', column: 'columns' } as const;

function nodeTitle(kind: Kind, o: Json): string {
   switch (kind) {
      case 'page': return `${o.page}. ${o.name}`;
      case 'region': return `${o.title ?? o.static_id}`;
      case 'item': case 'button': case 'validation': case 'process': return String(o.name);
      case 'column': return String(o.name);
      case 'branch': return `ke halaman ${o.page}${o.when_button ? ` (${o.when_button})` : ''}`;
      case 'computation': return String(o.item);
   }
}

/** "page", "region:0", "item:0:2", "button:0:1", "column:0:3", "validation:1", "process:0", "branch:0", "computation:0" */
function locate(page: PageSpec, ref: string): NodeAt | null {
   const p = page as unknown as Json;
   const [kind, a, b] = ref.split(':') as [Kind, string?, string?];
   const n = (x?: string) => (x !== undefined && /^\d+$/.test(x) ? Number(x) : -1);
   const pick = (list: unknown, i: number, k: Kind, def: Schema, exclude: string[] = []): NodeAt | null => {
      const arr = list as Json[] | undefined;
      if (!arr || i < 0 || i >= arr.length) return null;
      return { kind: k, list: arr, index: i, obj: arr[i], def, exclude, title: nodeTitle(k, arr[i]) };
   };
   if (kind === 'page') return { kind, list: null, index: 0, obj: p, def: PAGE_DEF, exclude: ['regions', 'validations', 'processes', 'branches', 'computations'], title: nodeTitle('page', p) };
   if (kind === 'region') return pick(p.regions, n(a), kind, DEFS.region, ['items', 'buttons', 'columns']);
   if (kind in REGION_LISTS) {
      const region = (p.regions as Json[] | undefined)?.[n(a)];
      return region ? pick(region[REGION_LISTS[kind as keyof typeof REGION_LISTS]], n(b), kind, DEFS[kind]) : null;
   }
   if (kind in PAGE_LISTS) return pick(p[PAGE_LISTS[kind as keyof typeof PAGE_LISTS]], n(a), kind, DEFS[kind]);
   return null;
}

function treeHtml(page: PageSpec, base: string, selected: string, add: (action: string, label: string, extra?: Record<string, string>) => SafeHtml): SafeHtml {
   const link = (ref: string, kind: Kind, text: string, meta?: string) =>
      html`<a href="${base}?node=${ref}"${selected === ref ? raw(' aria-current="true"') : ''}><span class="r-tree__kind">${KIND_LABEL[kind]}</span> ${text}${meta ? html` <span class="r-muted">${meta}</span>` : ''}</a>`;
   const regions = (page.regions ?? []) as unknown as Json[];
   const group = (kind: keyof typeof PAGE_LISTS, heading: string, action: string) => {
      const list = ((page as unknown as Json)[PAGE_LISTS[kind]] ?? []) as Json[];
      return html`<li><span class="r-tree__group">${heading}</span>${add(action, `Tambah ${KIND_LABEL[kind].toLowerCase()}`)}
         ${list.length ? html`<ul>${list.map((x, i) => html`<li>${link(`${kind}:${i}`, kind, nodeTitle(kind, x), kind === 'validation' || kind === 'process' ? String(x.type) : undefined)}</li>`)}</ul>` : ''}</li>`;
   };
   return html`<ul class="r-tree" role="list">
  <li>${link('page', 'page', nodeTitle('page', page as unknown as Json))}
    <ul>
      <li><span class="r-tree__group">Region</span>${add('add_region', 'Tambah region')}
        ${regions.length ? html`<ul>${regions.map((r, ri) => {
            const sub = (kind: keyof typeof REGION_LISTS) => ((r[REGION_LISTS[kind]] ?? []) as Json[]).map((x, i) =>
               html`<li>${link(`${kind}:${ri}:${i}`, kind, String(x.name), kind === 'item' ? String(x.type) : undefined)}</li>`);
            const items = sub('item'); const buttons = sub('button'); const columns = sub('column');
            return html`<li>${link(`region:${ri}`, 'region', String(r.title ?? r.static_id), String(r.type))}
              <ul>${items}${buttons}${columns}</ul>
              <div class="r-tree__adds">${add('add_item', 'Item', { region: String(ri) })}${add('add_button', 'Tombol', { region: String(ri) })}</div></li>`;
         })}</ul>` : ''}</li>
      ${group('validation', 'Validasi', 'add_validation')}
      ${group('process', 'Proses', 'add_process')}
      ${group('branch', 'Branch', 'add_branch')}
      ${group('computation', 'Computation', 'add_computation')}
    </ul></li>
</ul>`;
}

// ---------------------------------------------------------------- new components

function uniqueName(existing: string[], base: string): string {
   let n = 1;
   while (existing.includes(`${base}${n}`)) n++;
   return `${base}${n}`;
}

function addComponent(page: PageSpec, action: string, regionIndex: number): string | null {
   const p = page as unknown as Json;
   const regions = (p.regions ??= []) as Json[];
   const allItems = regions.flatMap(r => ((r.items ?? []) as Json[]).map(i => String(i.name)));
   switch (action) {
      case 'add_region': {
         const sid = uniqueName(regions.map(r => String(r.static_id)), 'region_');
         regions.push({ static_id: sid, title: 'Region baru', type: 'static', source: { html: '<p>Isi region.</p>' } });
         return `region:${regions.length - 1}`;
      }
      case 'add_item': {
         const r = regions[regionIndex];
         if (!r) return null;
         const items = (r.items ??= []) as Json[];
         items.push({ name: uniqueName(allItems, `P${page.page}_ITEM_`), type: 'text', label: 'Item baru' });
         return `item:${regionIndex}:${items.length - 1}`;
      }
      case 'add_button': {
         const r = regions[regionIndex];
         if (!r) return null;
         const buttons = (r.buttons ??= []) as Json[];
         buttons.push({ name: uniqueName(regions.flatMap(x => ((x.buttons ?? []) as Json[]).map(b => String(b.name))), 'TOMBOL_'), label: 'Tombol baru' });
         return `button:${regionIndex}:${buttons.length - 1}`;
      }
      case 'add_validation': {
         const list = (p.validations ??= []) as Json[];
         list.push({ name: uniqueName(list.map(v => String(v.name)), 'validasi_'), type: 'sql_expression', expression: 'true', error_msg: 'Periksa isian.' });
         return `validation:${list.length - 1}`;
      }
      case 'add_process': {
         const list = (p.processes ??= []) as Json[];
         list.push({ name: uniqueName(list.map(v => String(v.name)), 'proses_'), type: 'plpgsql', code: 'null;' });
         return `process:${list.length - 1}`;
      }
      case 'add_branch': {
         const list = (p.branches ??= []) as Json[];
         list.push({ page: page.page });
         return `branch:${list.length - 1}`;
      }
      case 'add_computation': {
         if (!allItems.length) return null;
         const list = (p.computations ??= []) as Json[];
         list.push({ item: allItems[0], type: 'static', expression: '' });
         return `computation:${list.length - 1}`;
      }
   }
   return null;
}

// ---------------------------------------------------------------- views

interface EditorState { values: Record<string, string>; errors: Record<string, string>; problems: string[]; conflict?: boolean }

function summaryHtml(st: EditorState): SafeHtml {
   if (st.conflict) return alert('warning', 'Aplikasi sudah diubah developer lain', html`<p>Perubahan Anda belum disimpan. Muat ulang halaman ini untuk melihat versi terbaru, lalu ulangi perubahan.</p>`, raw(' tabindex="-1" data-error-summary'));
   const all = [...Object.values(st.errors), ...st.problems];
   if (!all.length) return html``;
   return alert('danger', st.problems.length ? 'Perubahan tidak dapat disimpan' : all.length === 1 ? all[0] : 'Periksa isian berikut',
      st.problems.length || all.length > 1 ? html`<ul class="r-problems">${all.map(p => html`<li>${p}</li>`)}</ul>` : undefined, raw(' tabindex="-1" data-error-summary'));
}

interface DesignerData {
   app: { alias: string; name: string }; page: PageSpec; pages: { page: number; name: string }[]; version: string; node: NodeAt; ref: string; homePage: number;
}

export function designerView(dev: DevSession, flash: Flash | null, d: DesignerData, st: EditorState, deleteError: string | null = null): SafeHtml {
   const base = `${appUrl(d.app.alias)}/pages/${d.page.page}`;
   const hidden = html`<input type="hidden" name="__csrf" value="${dev.csrf}"><input type="hidden" name="version" value="${d.version}">`;
   const add = (action: string, label: string, extra: Record<string, string> = {}) => html`<form method="post" action="${base}" class="r-tree__add">${hidden}
      <input type="hidden" name="action" value="${action}">${Object.entries(extra).map(([k, v]) => html`<input type="hidden" name="${k}" value="${v}">`)}
      <button type="submit" class="r-btn r-btn--ghost r-btn--xs" aria-label="${label}${extra.region ? ` di region ${String(((d.page.regions ?? [])[Number(extra.region)] as { static_id?: string } | undefined)?.static_id ?? '')}` : ''}">${icon('plus')} ${label}</button></form>`;
   const fields = fieldsFor(d.node.def, d.node.exclude);
   const n = d.node;
   const canMove = n.list !== null;
   const moveForm = (action: string, label: string, disabled: boolean) => html`<form method="post" action="${base}">${hidden}
      <input type="hidden" name="action" value="${action}"><input type="hidden" name="node" value="${d.ref}">
      <button type="submit" class="r-btn r-btn--sm"${attrIf('disabled', disabled)}>${label}</button></form>`;
   const editor = html`<form class="r-region" method="post" action="${base}" novalidate aria-labelledby="editor-title">
  ${hidden}<input type="hidden" name="node" value="${d.ref}"><input type="hidden" name="action" value="save">
  <div class="r-region__header"><h2 class="r-region__title" id="editor-title"><span class="r-badge">${KIND_LABEL[n.kind]}</span> ${n.title}</h2></div>
  <div class="r-region__body">${summaryHtml(st)}
    <div class="r-form">${fields.map(f => fieldHtml(f, st.values[f.key] ?? '', st.errors[f.key]))}</div></div>
  <div class="r-region__footer"><button type="submit" class="r-btn r-btn--primary">${icon('save')} Simpan</button></div>
</form>`;
   const nodeActions = canMove ? html`<div class="r-node-actions" role="group" aria-label="Urutan dan hapus">
      ${moveForm('up', 'Naik', n.index === 0)}${moveForm('down', 'Turun', n.index === n.list!.length - 1)}
      <form method="post" action="${base}" data-confirm="Hapus ${KIND_LABEL[n.kind].toLowerCase()} ${n.title}?">${hidden}
        <input type="hidden" name="action" value="delete"><input type="hidden" name="node" value="${d.ref}">
        <button type="submit" class="r-btn r-btn--sm r-btn--danger">${icon('trash-2')} Hapus ${KIND_LABEL[n.kind].toLowerCase()}</button></form></div>` : html``;
   const deletePage = n.kind === 'page' ? html`<form class="r-region r-region--danger" method="post" action="${base}/delete" novalidate aria-labelledby="delpage-title">
  <input type="hidden" name="__csrf" value="${dev.csrf}"><input type="hidden" name="version" value="${d.version}">
  <div class="r-region__header"><h2 class="r-region__title" id="delpage-title">Hapus halaman</h2></div>
  <div class="r-region__body">
    ${deleteError ? alert('danger', deleteError, undefined, raw(' tabindex="-1" data-error-summary')) : ''}
    ${d.page.page === d.homePage ? html`<p>Halaman ini adalah beranda aplikasi. Ganti halaman beranda di properti aplikasi sebelum menghapusnya.</p>`
      : html`<p>Halaman beserta region, item, dan prosesnya dihapus. Link, branch, dan menu yang menuju halaman ini harus dihapus dulu; kalau masih ada, penghapusan ditolak dengan daftar letaknya.</p>
    <div class="r-form"><div class="r-field r-col-6"><label class="r-label" for="confirm-page">Ketik nomor halaman <span class="r-mono">${d.page.page}</span> untuk mengonfirmasi</label>
      <input class="r-input r-mono" id="confirm-page" name="confirm" inputmode="numeric" autocomplete="off" required${deleteError ? raw(' aria-invalid="true"') : ''}></div></div>`}
  </div>
  ${d.page.page === d.homePage ? '' : html`<div class="r-region__footer"><button type="submit" class="r-btn r-btn--danger">${icon('trash-2')} Hapus halaman</button></div>`}
</form>` : html``;
   const pagePicker = html`<form class="r-page-picker" method="get" action="${appUrl(d.app.alias)}/pages/go">
      <label class="r-label" for="go-page">Halaman</label>
      <select class="r-input" id="go-page" name="page" data-autosubmit>${d.pages.map(p => html`<option value="${p.page}"${attrIf('selected', p.page === d.page.page)}>${p.page}. ${p.name}</option>`)}</select>
      <button type="submit" class="r-btn r-btn--sm" data-autosubmit-fallback>Buka</button></form>`;
   const body = html`<div class="r-designer">
  <nav class="r-region r-designer__tree" aria-label="Struktur halaman">
    <div class="r-region__header">${pagePicker}</div>
    <div class="r-region__body">${treeHtml(d.page, base, d.ref, add)}</div>
  </nav>
  <div class="r-designer__main r-builder-stack">${nodeActions}${editor}${deletePage}</div>
</div>`;
   const actions = html`<a class="r-btn" href="${appUrl(d.app.alias)}/pages/new">${icon('plus')} Tambah halaman</a>
      <a class="r-btn r-btn--primary" href="${runUrl(dev.workspace, d.app.alias)}/${d.page.page}" target="_blank" rel="noopener">${icon('chevron-right')} Jalankan halaman</a>`;
   return shell({ dev, section: 'apps', title: `Halaman ${d.page.page}: ${d.page.name}`, flash, body, actions,
      crumbs: [{ label: 'Aplikasi', href: '/builder/apps' }, { label: d.app.name, href: appUrl(d.app.alias) }] });
}

function appPropsView(dev: DevSession, flash: Flash | null, app: { alias: string; name: string }, version: string, st: EditorState): SafeHtml {
   const fields = fieldsFor(ROOT, ['app', 'pages']);
   const body = html`<form class="r-region" method="post" action="${appUrl(app.alias)}/properties" novalidate aria-labelledby="props-title">
  <input type="hidden" name="__csrf" value="${dev.csrf}"><input type="hidden" name="version" value="${version}">
  <div class="r-region__header"><h2 class="r-region__title" id="props-title">Properti aplikasi</h2></div>
  <div class="r-region__body">${summaryHtml(st)}
    <p class="r-help">Alias (<span class="r-mono">${app.alias}</span>) tidak bisa diubah di sini karena menjadi alamat aplikasi; ekspor lalu impor dengan alias baru bila perlu.</p>
    <div class="r-form">${fields.map(f => fieldHtml(f, st.values[f.key] ?? '', st.errors[f.key]))}</div></div>
  <div class="r-region__footer"><button type="submit" class="r-btn r-btn--primary">${icon('save')} Simpan</button></div>
</form>`;
   return shell({ dev, section: 'apps', title: 'Properti aplikasi', flash, body,
      crumbs: [{ label: 'Aplikasi', href: '/builder/apps' }, { label: app.name, href: appUrl(app.alias) }] });
}

// ---------------------------------------------------------------- routes

export interface DesignerContext extends BuilderContext {
   importText: (s: DevSession, text: string) => Promise<{ pages: number }>;
   importedBy: (s: DevSession) => string;
   findApp: (s: DevSession, alias: string) => Promise<{ id: string; alias: string; name: string; homePage: number }>;
}

export function registerDesigner(app: FastifyInstance, ctx: DesignerContext): void {
   const { pool, send } = ctx;

   async function load(s: DevSession, alias: string) {
      const a = await ctx.findApp(s, alias);
      const v = await pool.query('select spec_hash from rpx.applications where id = $1', [a.id]);
      const spec = await exportSpec(pool, s.workspace, a.alias);
      return { a, spec, version: String(v.rows[0].spec_hash) };
   }
   function pageOf(spec: AppSpec, no: string): PageSpec {
      const p = /^\d+$/.test(no) ? spec.pages.find(x => x.page === Number(no)) : undefined;
      if (!p) throw new HttpError(404, 'Halaman tidak ditemukan', `Aplikasi ini tidak punya halaman ${no}.`);
      return p;
   }
   const params = (req: FastifyRequest) => req.params as { alias: string; page: string };
   const pagesList = (spec: AppSpec) => spec.pages.map(p => ({ page: p.page, name: p.name })).sort((x, y) => x.page - y.page);

   async function save(s: DevSession, spec: AppSpec): Promise<string[] | null> {
      try {
         await ctx.importText(s, specToYaml(spec, { workspace: s.workspace, exportedBy: ctx.importedBy(s) }));
         return null;
      } catch (e) {
         if (e instanceof SpecError) return e.problems;
         throw e;
      }
   }

   app.get('/builder/apps/:alias/pages/go', async (req, reply) => {
      const s = await ctx.dev(req, reply);
      if (!s) return reply;
      const no = String((req.query as Record<string, unknown>).page ?? '');
      return reply.redirect(`${appUrl(params(req).alias)}/pages/${/^\d+$/.test(no) ? no : ''}`, 303);
   });

   app.get('/builder/apps/:alias/pages/:page', async (req, reply) => {
      const s = await ctx.dev(req, reply);
      if (!s) return reply;
      const { a, spec, version } = await load(s, params(req).alias);
      const page = pageOf(spec, params(req).page);
      const asked = String((req.query as Record<string, unknown>).node ?? 'page');
      const found = locate(page, asked);
      const ref = found ? asked : 'page';
      const node = found ?? locate(page, 'page')!;
      const fields = fieldsFor(node.def, node.exclude);
      return send(reply, designerView(s, await takeFlash(pool, s),
         { app: a, page, pages: pagesList(spec), version, node, ref, homePage: spec.home_page ?? 1 },
         { values: valuesOf(node.obj, fields), errors: {}, problems: [] }));
   });

   app.post('/builder/apps/:alias/pages/:page', async (req, reply) => {
      const s = await ctx.dev(req, reply);
      if (!s) return reply;
      const { a, spec, version } = await load(s, params(req).alias);
      const page = pageOf(spec, params(req).page);
      const b = req.body as Record<string, string>;
      const base = `${appUrl(a.alias)}/pages/${page.page}`;
      const ref = String(b.node ?? 'page');
      const render = (node: NodeAt, st: EditorState, status: number) =>
         send(reply, designerView(s, null, { app: a, page, pages: pagesList(spec), version, node, ref, homePage: spec.home_page ?? 1 }, st), status);

      if (b.version !== version) {
         const node = locate(page, ref) ?? locate(page, 'page')!;
         const fields = fieldsFor(node.def, node.exclude);
         const values = b.action === 'save' ? Object.fromEntries(fields.map(f => [f.key, String(b[`f.${f.key}`] ?? '')])) : valuesOf(node.obj, fields);
         return render(node, { values, errors: {}, problems: [], conflict: true }, 409);
      }
      const action = String(b.action ?? '');
      if (action.startsWith('add_')) {
         const created = addComponent(page, action, Number(b.region ?? -1));
         if (!created) throw new HttpError(400, 'Tidak bisa ditambahkan', action === 'add_computation' ? 'Computation membutuhkan item; tambahkan item dulu.' : 'Region tujuan tidak ada.');
         const problems = await save(s, spec);
         if (problems) {
            const node = locate(page, 'page')!;
            return render(node, { values: valuesOf(node.obj, fieldsFor(node.def, node.exclude)), errors: {}, problems }, 422);
         }
         const node = locate(page, created)!;
         await setFlash(pool, s, { kind: 'success', text: `${KIND_LABEL[node.kind]} ${node.title} ditambahkan. Ubah propertinya lalu simpan.` });
         return reply.redirect(`${base}?node=${created}`, 303);
      }

      const node = locate(page, ref);
      if (!node) throw new HttpError(404, 'Komponen tidak ditemukan', 'Komponen ini sudah tidak ada di halaman. Muat ulang Page Designer.');
      const fields = fieldsFor(node.def, node.exclude);

      if (action === 'up' || action === 'down') {
         const to = node.index + (action === 'up' ? -1 : 1);
         if (!node.list || to < 0 || to >= node.list.length) return reply.redirect(`${base}?node=${ref}`, 303);
         [node.list[node.index], node.list[to]] = [node.list[to], node.list[node.index]];
         const problems = await save(s, spec);
         if (problems) return render(node, { values: valuesOf(node.obj, fields), errors: {}, problems }, 422);
         const moved = ref.replace(/(\d+)$/, String(to));
         return reply.redirect(`${base}?node=${moved}`, 303);
      }
      if (action === 'delete') {
         if (!node.list) throw new HttpError(400, 'Tidak bisa dihapus', 'Halaman dihapus lewat bagian "Hapus halaman".');
         node.list.splice(node.index, 1);
         const problems = await save(s, spec);
         if (problems) {
            const fresh = await load(s, a.alias);
            const p2 = pageOf(fresh.spec, String(page.page));
            const back = locate(p2, ref)!;
            return send(reply, designerView(s, null, { app: a, page: p2, pages: pagesList(fresh.spec), version: fresh.version, node: back, ref, homePage: fresh.spec.home_page ?? 1 },
               { values: valuesOf(back.obj, fields), errors: {}, problems: [`${KIND_LABEL[node.kind]} ${node.title} tidak dihapus:`, ...problems] }), 422);
         }
         await setFlash(pool, s, { kind: 'success', text: `${KIND_LABEL[node.kind]} ${node.title} dihapus.` });
         return reply.redirect(base, 303);
      }
      if (action !== 'save') throw new HttpError(400, 'Aksi tidak dikenal', 'Muat ulang Page Designer lalu coba lagi.');

      const values = Object.fromEntries(fields.map(f => [f.key, String(b[`f.${f.key}`] ?? '')]));
      const { obj, errors } = applyValues(node.obj, fields, values);
      if (Object.keys(errors).length) return render(node, { values, errors, problems: [] }, 422);
      if (node.kind === 'page' && obj.page !== page.page) {
         return render(node, { values, errors: { page: 'Nomor halaman tidak bisa diubah di sini; buat halaman baru lalu hapus yang lama.' }, problems: [] }, 422);
      }
      if (node.list) node.list[node.index] = obj;
      else { for (const k of Object.keys(page)) delete (page as unknown as Json)[k]; Object.assign(page, obj); }
      const problems = await save(s, spec);
      if (problems) return render(node, { values, errors: {}, problems }, 422);
      await setFlash(pool, s, { kind: 'success', text: `${KIND_LABEL[node.kind]} ${nodeTitle(node.kind, obj)} disimpan.` });
      return reply.redirect(`${base}?node=${ref}`, 303);
   });

   app.post('/builder/apps/:alias/pages/:page/delete', async (req, reply) => {
      const s = await ctx.dev(req, reply);
      if (!s) return reply;
      const { a, spec, version } = await load(s, params(req).alias);
      const page = pageOf(spec, params(req).page);
      const b = req.body as Record<string, string>;
      const node = locate(page, 'page')!;
      const again = (msg: string, status: number) => send(reply, designerView(s, null,
         { app: a, page, pages: pagesList(spec), version, node, ref: 'page', homePage: spec.home_page ?? 1 },
         { values: valuesOf(node.obj, fieldsFor(node.def, node.exclude)), errors: {}, problems: [] }, msg), status);
      if (b.version !== version) return again('Aplikasi sudah diubah developer lain. Muat ulang lalu ulangi.', 409);
      if (String(b.confirm ?? '').trim() !== String(page.page)) return again('Ketik nomor halaman untuk mengonfirmasi. Halaman tidak dihapus.', 422);
      if (page.page === (spec.home_page ?? 1)) return again('Halaman beranda tidak bisa dihapus.', 422);
      spec.pages = spec.pages.filter(p => p !== page);
      const problems = await save(s, spec);
      if (problems) return again(`Halaman tidak dihapus karena masih dirujuk: ${problems.join(' ')}`, 422);
      await setFlash(pool, s, { kind: 'success', text: `Halaman ${page.page} (${page.name}) dihapus.` });
      return reply.redirect(appUrl(a.alias), 303);
   });

   // ---------- S13 application properties ----------
   const propFields = () => fieldsFor(ROOT, ['app', 'pages']);

   app.get('/builder/apps/:alias/properties', async (req, reply) => {
      const s = await ctx.dev(req, reply);
      if (!s) return reply;
      const { a, spec, version } = await load(s, params(req).alias);
      return send(reply, appPropsView(s, await takeFlash(pool, s), a, version, { values: valuesOf(spec as unknown as Json, propFields()), errors: {}, problems: [] }));
   });

   app.post('/builder/apps/:alias/properties', async (req, reply: FastifyReply) => {
      const s = await ctx.dev(req, reply);
      if (!s) return reply;
      const { a, spec, version } = await load(s, params(req).alias);
      const b = req.body as Record<string, string>;
      const fields = propFields();
      const values = Object.fromEntries(fields.map(f => [f.key, String(b[`f.${f.key}`] ?? '')]));
      if (b.version !== version) return send(reply, appPropsView(s, null, a, version, { values, errors: {}, problems: [], conflict: true }), 409);
      const { obj, errors } = applyValues(spec as unknown as Json, fields, values);
      if (Object.keys(errors).length) return send(reply, appPropsView(s, null, a, version, { values, errors, problems: [] }), 422);
      const problems = await save(s, obj as unknown as AppSpec);
      if (problems) return send(reply, appPropsView(s, null, a, version, { values, errors: {}, problems }), 422);
      await setFlash(pool, s, { kind: 'success', text: 'Properti aplikasi disimpan.' });
      return reply.redirect(`${appUrl(a.alias)}/properties`, 303);
   });
}
