import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { attrIf, html, raw, type SafeHtml } from '../engine/html.ts';
import { alert, icon } from '../engine/templates.ts';
import { generateApp, specText } from './generate.ts';
import { listTables, type TableInfo } from './introspect.ts';
import type { BuilderContext } from './routes.ts';
import { setFlash, type DevSession } from './session.ts';
import { shell } from './views.ts';

// S04 Create App wizard (B3, flow F01): name, alias, schema, then the tables to build pages on. One screen, so the
// path from the builder home to a running CRUD app stays within the click budget of recon F01 (about 8).

const ALIAS = /^[a-z][a-z0-9_-]{0,59}$/;
const GROUP = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,59}$/;
const MAX_TABLES = 10;

export interface WizardContext extends BuilderContext {
   importText: (s: DevSession, text: string) => Promise<{ pages: number }>;
   schemas: (s: DevSession) => Promise<string[]>;
   importedBy: (s: DevSession) => string;
}

export interface WizardForm { name: string; alias: string; schema: string; tables: string[]; group: string }

const BUILD_LABEL = {
   form: html`<span class="r-badge r-badge--success">Report + form</span>`,
   report: html`<span class="r-badge r-badge--warning">Report saja</span>`,
   none: html`<span class="r-badge">Tidak bisa</span>`,
};

function tablesRegion(f: WizardForm, tables: TableInfo[] | null, error: string | undefined): SafeHtml {
   if (!f.schema) return html``;
   const body = !tables || !tables.length
      ? html`<div class="r-region__body"><div class="r-empty">${icon('inbox')}<p class="r-empty__title">Skema ${f.schema} belum punya tabel atau view</p>
           <p class="r-muted">Aplikasi tetap bisa dibuat dengan satu halaman beranda kosong.</p></div></div>`
      : html`<div class="r-region__body r-region__body--flush"><div class="r-table-wrap" tabindex="0" role="group" aria-label="Tabel di skema ${f.schema}">
   <table class="r-table r-table--compact">
     <caption class="r-sr-only">Tabel dan view di skema ${f.schema}</caption>
     <thead><tr><th scope="col"><span class="r-sr-only">Pilih</span></th><th scope="col">Tabel</th><th scope="col" class="r-num r-hide-sm">Kolom</th><th scope="col" class="r-num r-hide-sm">Baris (perkiraan)</th><th scope="col">Yang dibuat</th></tr></thead>
     <tbody>${tables.map(t => {
         const id = `t-${t.name}`;
         return html`<tr>
       <td><input type="checkbox" name="tables" value="${t.name}" id="${id}"${attrIf('checked', f.tables.includes(t.name))}${attrIf('disabled', t.build === 'none')}${t.reason ? raw(` aria-describedby="${id}-why"`) : ''}></td>
       <td><label for="${id}" class="r-mono">${t.name}</label>${t.kind === 'view' ? html` <span class="r-muted">(view)</span>` : ''}${t.comment ? html`<br><span class="r-muted">${t.comment}</span>` : ''}</td>
       <td class="r-num r-hide-sm">${t.columns.length}</td>
       <td class="r-num r-hide-sm">${t.rowEstimate === null ? '—' : t.rowEstimate.toLocaleString('id-ID')}</td>
       <td class="r-wrap">${BUILD_LABEL[t.build]}${t.reason ? html`<p class="r-help" id="${id}-why">${t.reason}</p>` : ''}</td></tr>`;
      })}</tbody>
   </table></div></div>`;
   return html`<section class="r-region" aria-labelledby="tables-title">
  <div class="r-region__header"><h2 class="r-region__title" id="tables-title">Halaman dari tabel</h2></div>
  ${error ? html`<div class="r-region__body"><p class="r-error-text" id="tables-err">${error}</p></div>` : ''}
  <div class="r-region__body"><p class="r-help">Setiap tabel yang dipilih menjadi halaman Interactive Report dan, bila tabel memungkinkan, form dialog untuk menambah, mengubah, dan menghapus baris. Foreign key tampil sebagai daftar pilihan. Tanpa tabel, aplikasi berisi satu halaman beranda kosong. Maksimal ${MAX_TABLES} tabel.</p></div>
  ${body}
</section>`;
}

export function wizardView(dev: DevSession, f: WizardForm, schemas: string[], tables: TableInfo[] | null, e: Record<string, string>): SafeHtml {
   const err = (k: string) => e[k] ? html`<p class="r-error-text" id="${k}-err">${e[k]}</p>` : html``;
   const inv = (k: string) => e[k] ? raw(` aria-invalid="true" aria-describedby="${k}-err"`) : raw('');
   const problems = Object.values(e);
   const summary = problems.length
      ? alert('danger', problems.length === 1 ? problems[0] : 'Periksa isian berikut', problems.length === 1 ? undefined : html`<ul class="r-problems">${problems.map(p => html`<li>${p}</li>`)}</ul>`, raw(' tabindex="-1" data-error-summary'))
      : html``;
   const body = html`<form class="r-builder-stack" method="post" action="/builder/apps/new" novalidate data-wizard>
  <input type="hidden" name="__csrf" value="${dev.csrf}">
  ${summary}
  ${!schemas.length ? alert('warning', 'Workspace ini belum punya skema database', html`<p>Minta administrator menambahkan skema dengan <code>rpx ws create</code>.</p>`) : ''}
  <section class="r-region" aria-labelledby="app-title">
    <div class="r-region__header"><h2 class="r-region__title" id="app-title">Data aplikasi</h2></div>
    <div class="r-region__body"><div class="r-form">
      <div class="r-field r-col-12"><label class="r-label" for="name">Nama aplikasi <span class="r-label__req" aria-hidden="true">*</span></label>
        <input class="r-input" id="name" name="name" required maxlength="120" value="${f.name}"${inv('name')}${attrIf('autofocus', !problems.length || !!e.name)}>${err('name')}</div>
      <div class="r-field r-col-6"><label class="r-label" for="alias">Alias <span class="r-label__req" aria-hidden="true">*</span></label>
        <input class="r-input r-mono" id="alias" name="alias" required maxlength="60" autocapitalize="none" spellcheck="false" value="${f.alias}" data-alias-from="name" aria-describedby="alias-help${e.alias ? ' alias-err' : ''}"${e.alias ? raw(' aria-invalid="true"') : ''}>
        <p class="r-help" id="alias-help">Dipakai di alamat: /r/${dev.workspace}/<strong>alias</strong>. Huruf kecil, angka, garis bawah atau tanda hubung; diawali huruf. Terisi otomatis dari nama.</p>${err('alias')}</div>
      <div class="r-field r-col-6"><label class="r-label" for="schema">Skema parsing <span class="r-label__req" aria-hidden="true">*</span></label>
        <select class="r-input" id="schema" name="schema" required data-reload-tables${inv('schema')}>${schemas.map(s => html`<option value="${s}"${attrIf('selected', s === f.schema)}>${s}</option>`)}</select>${err('schema')}
        <noscript><button type="submit" class="r-btn r-btn--sm" formmethod="get" formaction="/builder/apps/new" formnovalidate>Tampilkan tabel skema ini</button></noscript></div>
      <div class="r-field r-col-6"><label class="r-label" for="group">Batasi ke grup</label>
        <input class="r-input" id="group" name="group" maxlength="60" autocapitalize="none" spellcheck="false" value="${f.group}" aria-describedby="group-help${e.group ? ' group-err' : ''}"${e.group ? raw(' aria-invalid="true"') : ''}>
        <p class="r-help" id="group-help">Opsional. Hanya pengguna anggota grup ini yang bisa membuka aplikasi; kosongkan agar semua pengguna workspace bisa.</p>${err('group')}</div>
    </div></div>
  </section>
  ${tablesRegion(f, tables, e.tables)}
  <div class="r-form-actions">
    <a class="r-btn" href="/builder/apps">Batal</a>
    <button type="submit" class="r-btn r-btn--primary"${attrIf('disabled', !schemas.length)}>${icon('plus')} Buat aplikasi</button>
  </div>
</form>`;
   return shell({ dev, section: 'apps', title: 'Buat aplikasi', crumbs: [{ label: 'Aplikasi', href: '/builder/apps' }], body });
}

export function registerWizard(app: FastifyInstance, ctx: WizardContext): void {
   const { pool, send } = ctx;

   async function roleOf(s: DevSession): Promise<string> {
      return (await pool.query('select db_role from rpx.workspaces where id = $1', [s.workspaceId])).rows[0].db_role;
   }
   async function tablesOf(s: DevSession, schema: string, schemas: string[]): Promise<TableInfo[] | null> {
      return schemas.includes(schema) ? listTables(pool, schema, await roleOf(s)) : null;
   }

   app.get('/builder/apps/new', async (req: FastifyRequest, reply: FastifyReply) => {
      const s = await ctx.dev(req, reply);
      if (!s) return reply;
      const q = req.query as Record<string, string | string[] | undefined>;
      // the no-script "show tables" button submits the whole form with GET; keep the token out of the address
      if (q.__csrf !== undefined) {
         const u = new URLSearchParams();
         for (const k of ['name', 'alias', 'schema', 'group']) if (typeof q[k] === 'string' && q[k]) u.set(k, q[k] as string);
         return reply.redirect(`/builder/apps/new${u.size ? `?${u}` : ''}`, 303);
      }
      const sch = await ctx.schemas(s);
      const str = (k: string) => (typeof q[k] === 'string' ? (q[k] as string).trim().slice(0, 120) : '');
      const f: WizardForm = { name: str('name'), alias: str('alias').toLowerCase(), schema: sch.includes(str('schema')) ? str('schema') : (sch[0] ?? ''), tables: [], group: str('group') };
      return send(reply, wizardView(s, f, sch, await tablesOf(s, f.schema, sch), {}));
   });

   app.post('/builder/apps/new', async (req, reply) => {
      const s = await ctx.dev(req, reply);
      if (!s) return reply;
      const b = req.body as Record<string, string | string[] | undefined>;
      const one = (k: string) => String((Array.isArray(b[k]) ? b[k]![0] : b[k]) ?? '').trim();
      const picked = [b.tables ?? []].flat().map(String);
      const f: WizardForm = { name: one('name'), alias: one('alias').toLowerCase(), schema: one('schema'), tables: [...new Set(picked)], group: one('group') };
      const sch = await ctx.schemas(s);
      const e: Record<string, string> = {};
      if (!f.name) e.name = 'Nama aplikasi wajib diisi.';
      else if (f.name.length > 120) e.name = 'Nama aplikasi paling panjang 120 karakter.';
      if (!f.alias) e.alias = 'Alias wajib diisi.';
      else if (!ALIAS.test(f.alias)) e.alias = 'Alias hanya boleh huruf kecil, angka, garis bawah, atau tanda hubung, dan diawali huruf.';
      if (!sch.includes(f.schema)) e.schema = 'Pilih skema yang terdaftar di workspace ini.';
      if (f.group && !GROUP.test(f.group)) e.group = 'Nama grup hanya huruf, angka, titik, garis bawah, atau tanda hubung.';
      if (!e.alias) {
         const ex = await pool.query('select 1 from rpx.applications where workspace_id = $1 and alias = $2', [s.workspaceId, f.alias]);
         if (ex.rowCount) e.alias = `Alias "${f.alias}" sudah dipakai aplikasi lain di workspace ini.`;
      }
      const tables = await tablesOf(s, f.schema, sch);
      // the checkboxes are not trusted: every table is looked up again and must still be buildable
      const chosen = f.tables.map(n => tables?.find(t => t.name === n));
      if (f.tables.length > MAX_TABLES) e.tables = `Pilih paling banyak ${MAX_TABLES} tabel sekaligus; halaman lain bisa ditambahkan nanti.`;
      else if (!e.schema && chosen.some(t => !t || t.build === 'none')) {
         e.tables = `Tabel ${f.tables.filter((_, i) => !chosen[i] || chosen[i]!.build === 'none').join(', ')} tidak ada di skema ${f.schema} atau tidak bisa dipakai.`;
      }
      if (Object.keys(e).length) return send(reply, wizardView(s, f, sch, tables, e), 422);

      const spec = generateApp({ name: f.name, alias: f.alias, schema: f.schema, tables: chosen as TableInfo[], group: f.group || null });
      const r = await ctx.importText(s, specText(spec, ctx.importedBy(s)));
      await setFlash(pool, s, {
         kind: 'success',
         text: f.tables.length ? `Aplikasi ${f.name} dibuat: ${r.pages} halaman dari ${f.tables.length} tabel.` : `Aplikasi ${f.name} dibuat.`,
      });
      return reply.redirect(`/builder/apps/${encodeURIComponent(f.alias)}`, 303);
   });
}
