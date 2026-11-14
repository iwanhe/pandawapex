import YAML from 'yaml';
import type { ColumnInfo, TableInfo } from './introspect.ts';

// Create App wizard (B3): turns the developer's choices into an application spec. Pure function, so the output can
// be tested without a browser; the spec goes through the same importer and checks as a hand-written one.
//
// Per chosen table: page 2n-1 is an interactive report, page 2n a modal form (when the table allows one).
// The report links each row to the form; the form inserts, updates and deletes through form_dml.

export interface CreateAppInput {
   name: string;
   alias: string;
   schema: string;          // parsing schema
   tables: TableInfo[];     // in the order chosen
   group?: string | null;   // limit the whole application to one group
}

const REPORT_COLUMNS_MAX = 12;
const SIMPLE = /^[a-z_][a-z0-9_$]*$/;
const ITEM = /^[A-Z][A-Z0-9_]{0,59}$/;

export function humanize(name: string): string {
   const words = name.replace(/[_$]+/g, ' ').trim().replace(/\s+/g, ' ');
   return words ? words[0].toUpperCase() + words.slice(1) : name;
}
const qi = (s: string) => (SIMPLE.test(s) ? s : `"${s.replace(/"/g, '""')}"`);
const slug = (s: string) => {
   const x = s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
   return /^[a-z]/.test(x) ? x : `t-${x}`.slice(0, 50);
};

const usable = (c: ColumnInfo) => c.kind !== 'unsupported' && SIMPLE.test(c.name) && ITEM.test(c.name.toUpperCase().slice(0, 55));

function dataType(c: ColumnInfo): { data_type?: string; format?: string } {
   switch (c.kind) {
      case 'integer': return { data_type: 'number', format: 'integer' };
      case 'number': return { data_type: 'number', format: 'number' };
      case 'date': return { data_type: 'date', format: 'date' };
      case 'timestamp': return { data_type: 'timestamp', format: 'datetime' };
      case 'boolean': return { data_type: 'boolean' };
      default: return {};
   }
}

interface Built { pages: unknown[]; nav: unknown[]; lovs: Record<string, unknown> }

/** a page alias not in use yet */
export function uniqueAlias(base: string, used: Set<string>): string {
   let alias = slug(base);
   for (let n = 2; used.has(alias); n++) alias = `${slug(base).slice(0, 50)}-${n}`;
   used.add(alias);
   return alias;
}

/** Interactive Report page on a table; when formPage is given, rows link to it and an Add button opens it */
export function tableReportPage(t: TableInfo, page: number, o: { alias: string; label: string; formPage?: number }): Record<string, unknown> {
   const fkBy = new Map(t.fks.map(f => [f.column, f]));
   const cols = t.columns.filter(usable);
   // report columns: the key first, then the others in table order, at most REPORT_COLUMNS_MAX
   const shown = [...cols.filter(c => t.pk.includes(c.name)), ...cols.filter(c => !t.pk.includes(c.name))].slice(0, REPORT_COLUMNS_MAX);
   const joins: string[] = [];
   const select = shown.map((c, n) => {
      const fk = fkBy.get(c.name);
      if (fk && !t.pk.includes(c.name)) {
         const a = `r${n}`;
         joins.push(`left join ${qi(fk.refSchema)}.${qi(fk.refTable)} ${a} on ${a}.${qi(fk.refColumn)} = t.${qi(c.name)}`);
         return `coalesce(${a}.${qi(fk.display)}::text, t.${qi(c.name)}::text) as ${c.name}`;
      }
      return `t.${qi(c.name)}`;
   });
   const sql = [`select ${select.join('\n     , ')}`, `  from ${qi(t.schema)}.${qi(t.name)} t`, ...joins.map(j => `  ${j}`)].join('\n') + '\n';
   const form = o.formPage;
   const pkItems = form === undefined ? {} : Object.fromEntries(t.pk.map(p => [`P${form}_${p.toUpperCase()}`, `#${p.toUpperCase()}#`]));
   const columns = shown.map(c => {
      const fk = fkBy.get(c.name);
      const col: Record<string, unknown> = { name: c.name.toUpperCase(), label: fk && !t.pk.includes(c.name) ? humanize(fk.refTable) : humanize(c.name) };
      if (!(fk && !t.pk.includes(c.name))) Object.assign(col, dataType(c));
      if (t.pk.includes(c.name)) {
         col.is_pk = true;
         if (form !== undefined && c.name === t.pk[0]) col.link = { page: form, items: pkItems, clear_cache: String(form) };
      }
      return col;
   });
   const sortCol = shown.find(c => !t.pk.includes(c.name) && (c.kind === 'text' || c.kind === 'longtext')) ?? shown[0];
   return {
      page, alias: o.alias, name: o.label,
      regions: [{
         static_id: 'daftar', title: `Daftar ${o.label.toLowerCase()}`, type: 'interactive_report',
         empty_text: form !== undefined ? `Belum ada data. Tambahkan dengan tombol "Tambah".` : 'Belum ada data.',
         source: { sql }, columns,
         sort: { column: sortCol.name.toUpperCase() },
         ...(form !== undefined ? { buttons: [{ name: 'TAMBAH', label: 'Tambah', hot: true, action: 'redirect', position: 'header', target: { page: form, clear_cache: String(form) } }] } : {}),
      }],
   };
}

/** Form page on a table (insert, update, delete). returnPage: where the form goes after saving or cancelling. */
export function tableFormPage(t: TableInfo, page: number, o: { alias: string; label: string; returnPage: number; modal: boolean; lovs: Record<string, unknown> }): Record<string, unknown> {
   const { lovs } = o;
   const fkBy = new Map(t.fks.map(f => [f.column, f]));
   const cols = t.columns.filter(usable);
   const item = (c: ColumnInfo) => `P${page}_${c.name.toUpperCase()}`;
   const items: Record<string, unknown>[] = [];
   for (const c of cols.filter(x => t.pk.includes(x.name))) items.push({ name: item(c), type: 'hidden', source: { column: c.name, pk: true } });
   const editable = cols.filter(c => !t.pk.includes(c.name) && !c.generated);
   for (const c of editable) {
      const fk = fkBy.get(c.name);
      const it: Record<string, unknown> = { name: item(c), label: fk ? humanize(fk.refTable) : humanize(c.name) };
      if (fk) {
         let lov = fk.refTable.toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 50);
         if (!/^[A-Z]/.test(lov)) lov = `L_${lov}`;
         const sqlLov = `select ${qi(fk.display)}::text as d, ${qi(fk.refColumn)} as r from ${qi(fk.refSchema)}.${qi(fk.refTable)} order by 1`;
         let key = lov;
         for (let n = 2; lovs[key] && (lovs[key] as { sql?: string }).sql !== sqlLov; n++) key = `${lov}_${n}`;
         lovs[key] = { sql: sqlLov };
         Object.assign(it, { type: 'select', lov: key, null_display: `- Pilih ${humanize(fk.refTable).toLowerCase()} -` });
      } else if (c.kind === 'enum') {
         const base = `${t.name}_${c.name}`.toUpperCase().slice(0, 55);
         const values = { static: c.enumValues.map(v => ({ display: v, return: v })) };
         let key = base;
         for (let n = 2; lovs[key] && JSON.stringify(lovs[key]) !== JSON.stringify(values); n++) key = `${base}_${n}`;
         lovs[key] = values;
         Object.assign(it, { type: 'select', lov: key, null_display: '- Pilih -' });
      } else {
         switch (c.kind) {
            case 'integer': case 'number': it.type = 'number'; break;
            case 'date': it.type = 'date'; break;
            case 'timestamp': it.type = 'datetime'; break;
            case 'boolean': Object.assign(it, { type: 'switch', on_value: 'Y', off_value: 'N' }); break;
            case 'longtext': it.type = 'textarea'; break;
            default: it.type = 'text';
         }
      }
      if (c.notNull && !c.hasDefault && c.kind !== 'boolean') it.required = true;
      it.col_span = c.kind === 'longtext' ? 12 : 6;
      if (c.maxLength && (it.type === 'text' || it.type === 'textarea')) it.max_length = c.maxLength;
      it.source = { column: c.name };
      items.push(it);
   }
   const firstPk = item(cols.find(c => c.name === t.pk[0])!);
   const what = o.label.toLowerCase();
   return {
      page, alias: o.alias, name: `Form ${what}`, breadcrumb_parent: o.returnPage,
      ...(o.modal ? { mode: 'modal', ...(editable.length > 8 ? { dialog_size: 'lg' } : {}) } : {}),
      regions: [{
         static_id: 'form', title: o.label, type: 'form', source: { table: `${t.schema}.${t.name}` }, items,
         buttons: [
            o.modal
               ? { name: 'BATAL', label: 'Batal', action: 'close_dialog', style: 'ghost' }
               : { name: 'BATAL', label: 'Batal', action: 'redirect', style: 'ghost', target: { page: o.returnPage } },
            { name: 'HAPUS', label: 'Hapus', style: 'danger', confirm: `Hapus data ${what} ini?`, condition: { item_not_null: firstPk } },
            { name: 'SIMPAN', label: 'Simpan', hot: true },
         ],
      }],
      processes: [
         { name: 'ambil_data', type: 'form_init', region: 'form' },
         { name: 'simpan_data', type: 'form_dml', region: 'form', success_msg: `Data ${what} tersimpan.` },
         ...(o.modal ? [{ name: 'tutup', type: 'close_dialog' }] : []),
      ],
      branches: [{ page: o.returnPage }],
   };
}

function tablePages(t: TableInfo, report: number, lovs: Record<string, unknown>, usedAliases: Set<string>): Built {
   const form = report + 1;
   const withForm = t.build === 'form';
   const label = humanize(t.name);
   const alias = uniqueAlias(t.name, usedAliases);
   usedAliases.add(`${alias}-form`);
   const reportPage = tableReportPage(t, report, { alias, label, formPage: withForm ? form : undefined });
   if (!withForm) return { pages: [reportPage], nav: [{ label, icon: 'list', page: report }], lovs };
   const formPage = tableFormPage(t, form, { alias: `${alias}-form`, label, returnPage: report, modal: true, lovs });
   return { pages: [reportPage, formPage], nav: [{ label, icon: 'list', page: report }], lovs };
}

export function generateApp(input: CreateAppInput): Record<string, unknown> {
   const spec: Record<string, unknown> = {
      app: input.alias, name: input.name, version: '1.0', parsing_schema: input.schema, home_page: 1,
   };
   if (input.group) {
      spec.authorization = [{ name: 'akses_aplikasi', type: 'group_member', source: input.group, error_msg: `Aplikasi ini hanya untuk anggota grup ${input.group}.` }];
      spec.authorization_scheme = 'akses_aplikasi';
   }
   const tables = input.tables.filter(t => t.build !== 'none');
   if (!tables.length) {
      spec.pages = [{
         page: 1, name: 'Beranda', title: input.name,
         regions: [{ static_id: 'selamat_datang', title: 'Selamat datang', type: 'static',
            source: { html: '<p>Halaman ini masih kosong. Ubah spec aplikasi untuk menambahkan region, item, dan halaman.</p>' } }],
      }];
      return spec;
   }
   const lovs: Record<string, unknown> = {};
   const pages: unknown[] = [];
   const nav: unknown[] = [];
   const aliases = new Set<string>();
   tables.forEach((t, i) => {
      const b = tablePages(t, 2 * i + 1, lovs, aliases);
      pages.push(...b.pages);
      nav.push(...b.nav);
   });
   if (Object.keys(lovs).length) spec.lovs = lovs;
   spec.navigation = nav;
   spec.pages = pages;
   return spec;
}

export function specText(spec: Record<string, unknown>, by: string): string {
   return `# ${String(spec.name)}: dibuat dengan wizard builder oleh ${by}\n${YAML.stringify(spec, { lineWidth: 0 })}`;
}
