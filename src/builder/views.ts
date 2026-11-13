import { attrIf, html, raw, type SafeHtml } from '../engine/html.ts';
import { alert, document, icon } from '../engine/templates.ts';
import type { DevSession, Flash } from './session.ts';

// Builder screens (S01 login, S02 workspace home, S03 application list, S04 create / import, S05 application home).
// Built from the same design-system primitives as the runtime; all copy is original.

export interface AppRow {
   alias: string; name: string; version: string; parsingSchema: string; pages: number; changedAt: Date | null; changedBy: string | null;
}
export interface PageRow { no: number; name: string; title: string | null; alias: string | null; mode: string; regions: number; requiresAuth: boolean }
export interface VersionRow { id: string; importedAt: Date; importedBy: string; engineVersion: string; specHash: string; size: number }
export interface AppDetail extends AppRow { homePage: number; authScheme: string }

const BRAND = 'pandawapex Builder';
const appUrl = (alias: string) => `/builder/apps/${encodeURIComponent(alias)}`;
export const runUrl = (ws: string, alias: string) => `/r/${encodeURIComponent(ws)}/${encodeURIComponent(alias)}`;

const DT = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' });
export function when(d: Date | null): string {
   return d ? DT.format(d) : '—';
}
const time = (d: Date | null) => (d ? html`<time datetime="${d.toISOString()}">${when(d)}</time>` : html`<span class="r-muted">—</span>`);

function flashHtml(f: Flash | null): SafeHtml {
   return f ? alert(f.kind, f.text) : html``;
}

function errorsHtml(title: string, problems: string[]): SafeHtml {
   if (!problems.length) return html``;
   const detail = problems.length === 1 && problems[0] === title
      ? html``
      : html`<ul class="r-problems">${problems.slice(0, 30).map(p => html`<li>${p}</li>`)}${problems.length > 30 ? html`<li>… dan ${problems.length - 30} lagi</li>` : ''}</ul>`;
   return alert('danger', title, detail, raw(' tabindex="-1" data-error-summary'));
}

type Section = 'home' | 'apps';
interface ShellArgs {
   dev: DevSession; section: Section; title: string; crumbs?: { label: string; href: string }[];
   actions?: SafeHtml; flash?: Flash | null; body: SafeHtml;
}

function shell(a: ShellArgs): SafeHtml {
   const navItem = (s: Section, href: string, ic: string, label: string) =>
      html`<li><a href="${href}"${a.section === s ? raw(' aria-current="page"') : ''}>${icon(ic)}<span class="r-nav__label">${label}</span></a></li>`;
   const crumbs = a.crumbs?.length
      ? html`<nav class="r-breadcrumb" aria-label="Breadcrumb"><ol>${a.crumbs.map(c => html`<li><a href="${c.href}">${c.label}</a></li>`)}<li aria-current="page">${a.title}</li></ol></nav>`
      : html``;
   const body = html`<a class="r-skip" href="#main">Lompat ke konten</a>
<div class="r-shell">
  <header class="r-header">
    <button type="button" class="r-btn r-btn--ghost r-btn--icon" data-nav-toggle aria-controls="r-nav" aria-label="Tampilkan atau sembunyikan navigasi">${icon('menu')}</button>
    <a class="r-header__app" href="/builder">${BRAND}</a>
    <span class="r-badge r-badge--info" title="Workspace">${icon('layout-grid')} ${a.dev.workspace}</span>
    <span class="r-header__spacer"></span>
    <form method="post" action="/builder/logout" class="r-header__user">
      <input type="hidden" name="__csrf" value="${a.dev.csrf}">
      <span class="r-header__name">${icon('user')} ${a.dev.username}</span>
      <button type="submit" class="r-btn r-btn--ghost r-btn--sm">${icon('log-out')} Keluar</button>
    </form>
  </header>
  <nav class="r-nav" id="r-nav" aria-label="Navigasi builder"><ul>
    ${navItem('home', '/builder', 'house', 'Beranda')}
    ${navItem('apps', '/builder/apps', 'layout-grid', 'Aplikasi')}
  </ul></nav>
  <main class="r-main" id="main">
    ${crumbs}
    <div class="r-page-head">
      <h1>${a.title}</h1>
      ${a.actions ? html`<div class="r-page-head__actions">${a.actions}</div>` : ''}
    </div>
    <div class="r-messages">${flashHtml(a.flash ?? null)}</div>
    ${a.body}
  </main>
</div>`;
   return document(`${a.title} · ${BRAND}`, body);
}

// ---------- S01 login ----------
export function loginView(a: { csrf: string; workspace: string; username: string; error: string | null; info: string | null; returnTo: string }): SafeHtml {
   const focusWs = !a.workspace;
   const focusUser = !!a.workspace && !a.username;
   const body = html`<main class="r-login" id="main">
  <div class="r-login__card">
    <div class="r-login__brand">${icon('layout-grid')} ${BRAND}</div>
    <form class="r-region" method="post" action="/builder/login" novalidate>
      <div class="r-region__header"><h1 class="r-region__title">Masuk sebagai developer</h1></div>
      <div class="r-region__body">
        ${a.error ? alert('danger', a.error) : ''}
        ${a.info ? alert('info', a.info) : ''}
        <input type="hidden" name="__csrf" value="${a.csrf}">
        <input type="hidden" name="return" value="${a.returnTo}">
        <div class="r-form">
          <div class="r-field r-col-12"><label class="r-label" for="workspace">Workspace</label>
            <input class="r-input" id="workspace" name="workspace" autocomplete="organization" autocapitalize="none" spellcheck="false" required value="${a.workspace}"${attrIf('autofocus', focusWs)}></div>
          <div class="r-field r-col-12"><label class="r-label" for="username">Nama pengguna</label>
            <input class="r-input" id="username" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required value="${a.username}"${attrIf('autofocus', focusUser)}></div>
          <div class="r-field r-col-12"><label class="r-label" for="password">Kata sandi</label>
            <input class="r-input" id="password" name="password" type="password" autocomplete="current-password" required${attrIf('autofocus', !focusWs && !focusUser)}></div>
        </div>
      </div>
      <div class="r-region__footer"><button type="submit" class="r-btn r-btn--primary">Masuk</button></div>
    </form>
    <p class="r-help">Akun developer dibuat oleh administrator dengan <code>rpx dev add</code>. Pengguna aplikasi masuk lewat alamat aplikasinya, bukan di sini.</p>
  </div>
</main>`;
   return document(`Masuk · ${BRAND}`, body);
}

// ---------- S02 workspace home ----------
export function homeView(dev: DevSession, flash: Flash | null, d: { apps: AppRow[]; schemas: string[]; developers: number }): SafeHtml {
   const totalPages = d.apps.reduce((n, a) => n + a.pages, 0);
   const recent = [...d.apps].sort((x, y) => (y.changedAt?.getTime() ?? 0) - (x.changedAt?.getTime() ?? 0)).slice(0, 5);
   const stat = (label: string, value: string | number, hint: SafeHtml | string) =>
      html`<div class="r-card"><p class="r-card__meta"><span>${label}</span></p><p class="r-stat">${value}</p><p class="r-help">${hint}</p></div>`;
   const body = html`
<div class="r-cards r-cards--stats">
  ${stat('Aplikasi', d.apps.length, d.apps.length ? html`<a href="/builder/apps">Lihat semua</a>` : 'Belum ada aplikasi')}
  ${stat('Halaman', totalPages, 'di semua aplikasi')}
  ${stat('Skema database', d.schemas.length, d.schemas.length ? html`<span class="r-mono">${d.schemas.join(', ')}</span>` : 'Belum ada skema')}
  ${stat('Developer', d.developers, 'di workspace ini')}
</div>
<section class="r-region" aria-labelledby="recent-title">
  <div class="r-region__header"><h2 class="r-region__title" id="recent-title">Terakhir diubah</h2></div>
  <div class="r-region__body${recent.length ? ' r-region__body--flush' : ''}">
    ${recent.length ? appTable(dev, recent, 'Aplikasi terakhir diubah') : emptyApps()}
  </div>
</section>`;
   return shell({ dev, section: 'home', title: `Workspace ${dev.workspace}`, flash, body, actions: appActions() });
}

function appActions(): SafeHtml {
   return html`<a class="r-btn" href="/builder/apps/import">${icon('download')} Impor</a>
      <a class="r-btn r-btn--primary" href="/builder/apps/new">${icon('plus')} Buat aplikasi</a>`;
}

function emptyApps(): SafeHtml {
   return html`<div class="r-empty">${icon('inbox')}<p class="r-empty__title">Belum ada aplikasi di workspace ini</p>
      <p class="r-muted">Buat aplikasi kosong, atau impor file spec YAML yang diekspor dari workspace lain.</p>
      <div class="r-btn-group">${appActions()}</div></div>`;
}

function appTable(dev: DevSession, apps: AppRow[], caption: string): SafeHtml {
   return html`<div class="r-table-wrap" tabindex="0" role="group" aria-label="${caption}">
   <table class="r-table">
     <caption class="r-sr-only">${caption}</caption>
     <thead><tr><th scope="col">Nama</th><th scope="col">Alias</th><th scope="col">Versi</th><th scope="col" class="r-num">Halaman</th><th scope="col">Terakhir diubah</th><th scope="col"><span class="r-sr-only">Aksi</span></th></tr></thead>
     <tbody>${apps.map(a => html`<tr>
       <td><a class="r-cell-link" href="${appUrl(a.alias)}">${a.name}</a></td>
       <td class="r-mono">${a.alias}</td>
       <td>${a.version}</td>
       <td class="r-num">${a.pages}</td>
       <td>${time(a.changedAt)}${a.changedBy ? html` <span class="r-muted">oleh ${a.changedBy}</span>` : ''}</td>
       <td class="r-table__actions">
         <a class="r-btn r-btn--sm r-btn--ghost" href="${runUrl(dev.workspace, a.alias)}" aria-label="Jalankan ${a.name}">${icon('chevron-right')} Jalankan</a>
         <a class="r-btn r-btn--sm r-btn--ghost" href="${appUrl(a.alias)}/export" download aria-label="Ekspor ${a.name} sebagai YAML">${icon('file-text')} Ekspor</a>
       </td></tr>`)}</tbody>
   </table></div>`;
}

// ---------- S03 application list ----------
export function appsView(dev: DevSession, flash: Flash | null, apps: AppRow[], q: string, total: number): SafeHtml {
   const search = html`<form class="r-ir-toolbar" method="get" action="/builder/apps" role="search">
      <label class="r-search"><span class="r-sr-only">Cari aplikasi</span>${icon('search')}
        <input class="r-input" type="search" name="q" value="${q}" placeholder="Cari nama atau alias…"></label>
      <button type="submit" class="r-btn">Cari</button>
      ${q ? html`<a class="r-btn r-btn--ghost" href="/builder/apps">Hapus pencarian</a>` : ''}
      <span class="r-ir-toolbar__end r-muted" role="status">${q ? `${apps.length} dari ${total} aplikasi` : `${total} aplikasi`}</span>
    </form>`;
   const content = !total
      ? html`<div class="r-region__body">${emptyApps()}</div>`
      : !apps.length
         ? html`${search}<div class="r-region__body"><div class="r-empty">${icon('search')}<p class="r-empty__title">Tidak ada aplikasi yang cocok dengan “${q}”</p>
              <a class="r-btn r-btn--sm" href="/builder/apps">Tampilkan semua</a></div></div>`
         : html`${search}<div class="r-region__body r-region__body--flush">${appTable(dev, apps, 'Daftar aplikasi')}</div>`;
   const body = html`<section class="r-region" aria-label="Daftar aplikasi">${content}</section>`;
   return shell({ dev, section: 'apps', title: 'Aplikasi', flash, body, actions: appActions() });
}

// ---------- S04 create ----------
export interface NewAppForm { name: string; alias: string; schema: string }
export function newAppView(dev: DevSession, f: NewAppForm, schemas: string[], errors: Record<string, string>): SafeHtml {
   const err = (k: string) => errors[k] ? html`<p class="r-error-text" id="${k}-err">${errors[k]}</p>` : html``;
   const inv = (k: string) => errors[k] ? raw(` aria-invalid="true" aria-describedby="${k}-err"`) : raw('');
   const problems = Object.values(errors);
   const body = html`<form class="r-region" method="post" action="/builder/apps/new" novalidate>
  <input type="hidden" name="__csrf" value="${dev.csrf}">
  <div class="r-region__header"><h2 class="r-region__title">Data aplikasi</h2></div>
  <div class="r-region__body">
    ${errorsHtml(problems.length === 1 ? problems[0] : 'Periksa isian berikut', problems.length === 1 ? [] : problems)}
    ${!schemas.length ? alert('warning', 'Workspace ini belum punya skema database', html`<p>Minta administrator menambahkan skema dengan <code>rpx workspace create</code>.</p>`) : ''}
    <div class="r-form">
      <div class="r-field r-col-12"><label class="r-label" for="name">Nama aplikasi <span class="r-label__req" aria-hidden="true">*</span></label>
        <input class="r-input" id="name" name="name" required maxlength="120" value="${f.name}"${inv('name')}${attrIf('autofocus', !problems.length || !!errors.name)}>${err('name')}</div>
      <div class="r-field r-col-6"><label class="r-label" for="alias">Alias <span class="r-label__req" aria-hidden="true">*</span></label>
        <input class="r-input r-mono" id="alias" name="alias" required maxlength="60" autocapitalize="none" spellcheck="false" value="${f.alias}" aria-describedby="alias-help${errors.alias ? ' alias-err' : ''}"${errors.alias ? raw(' aria-invalid="true"') : ''}>
        <p class="r-help" id="alias-help">Dipakai di alamat: /r/${dev.workspace}/<strong>alias</strong>. Huruf kecil, angka, garis bawah atau tanda hubung; diawali huruf.</p>${err('alias')}</div>
      <div class="r-field r-col-6"><label class="r-label" for="schema">Skema parsing <span class="r-label__req" aria-hidden="true">*</span></label>
        <select class="r-input" id="schema" name="schema" required${inv('schema')}>${schemas.map(s => html`<option value="${s}"${attrIf('selected', s === f.schema)}>${s}</option>`)}</select>${err('schema')}</div>
    </div>
    <p class="r-help">Aplikasi baru berisi satu halaman beranda kosong dan memakai akun aplikasi bawaan workspace untuk masuk.</p>
  </div>
  <div class="r-region__footer">
    <a class="r-btn" href="/builder/apps">Batal</a>
    <button type="submit" class="r-btn r-btn--primary"${attrIf('disabled', !schemas.length)}>${icon('plus')} Buat aplikasi</button>
  </div>
</form>`;
   return shell({ dev, section: 'apps', title: 'Buat aplikasi', crumbs: [{ label: 'Aplikasi', href: '/builder/apps' }], body });
}

// ---------- S04 import ----------
export function importView(dev: DevSession, a: { spec: string; replace: boolean; problems: string[]; title: string; exists: string | null }): SafeHtml {
   const body = html`<form class="r-region" method="post" action="/builder/apps/import" novalidate data-spec-import>
  <input type="hidden" name="__csrf" value="${dev.csrf}">
  <div class="r-region__header"><h2 class="r-region__title">File spec</h2></div>
  <div class="r-region__body">
    ${errorsHtml(a.title, a.problems)}
    <div class="r-form">
      <div class="r-field r-col-12">
        <label class="r-label" for="spec-file">Pilih file YAML</label>
        <div class="r-file" data-spec-drop>
          ${icon('file-text')}
          <input type="file" id="spec-file" accept=".yaml,.yml,text/yaml,application/yaml" data-spec-file aria-describedby="spec-file-help">
          <p class="r-help" id="spec-file-help">Isi file dimuat ke kotak di bawah; periksa dulu sebelum mengimpor.</p>
        </div>
      </div>
      <div class="r-field r-col-12"><label class="r-label" for="spec">Isi spec <span class="r-label__req" aria-hidden="true">*</span></label>
        <textarea class="r-input r-mono r-spec-text" id="spec" name="spec" rows="16" required spellcheck="false" aria-describedby="spec-help">${a.spec}</textarea>
        <p class="r-help" id="spec-help">Hasil <code>rpx app export</code> atau tombol Ekspor. Workspace tujuan selalu workspace Anda (${dev.workspace}).</p></div>
      <div class="r-field r-col-12">
        <label class="r-choice"><input type="checkbox" name="replace" value="1"${attrIf('checked', a.replace)}${a.exists ? raw(' aria-describedby="replace-help"') : ''}> Ganti aplikasi bila alias sudah ada</label>
        ${a.exists ? html`<p class="r-help" id="replace-help">Aplikasi <span class="r-mono">${a.exists}</span> sudah ada. Definisinya diganti seluruhnya; data di tabel dan sesi pengguna tetap.</p>` : ''}
      </div>
    </div>
  </div>
  <div class="r-region__footer">
    <a class="r-btn" href="/builder/apps">Batal</a>
    <button type="submit" class="r-btn r-btn--primary">${icon('download')} Impor</button>
  </div>
</form>`;
   return shell({ dev, section: 'apps', title: 'Impor aplikasi', crumbs: [{ label: 'Aplikasi', href: '/builder/apps' }], body });
}

// ---------- S05 application home ----------
const AUTH_LABEL: Record<string, string> = { builtin_accounts: 'Akun aplikasi', oidc: 'SSO (OIDC)', no_auth: 'Tanpa login' };
const MODE_LABEL: Record<string, string> = { normal: 'Normal', modal: 'Dialog', non_modal: 'Dialog non-modal' };

export function appView(dev: DevSession, flash: Flash | null, a: AppDetail, pages: PageRow[], versions: VersionRow[], del: { error: string | null }): SafeHtml {
   const base = appUrl(a.alias);
   const run = runUrl(dev.workspace, a.alias);
   const facts: [string, SafeHtml | string][] = [
      ['Alias', html`<span class="r-mono">${a.alias}</span>`],
      ['Versi', a.version],
      ['Skema parsing', html`<span class="r-mono">${a.parsingSchema}</span>`],
      ['Halaman beranda', String(a.homePage)],
      ['Autentikasi', AUTH_LABEL[a.authScheme] ?? a.authScheme],
      ['Terakhir diubah', html`${time(a.changedAt)}${a.changedBy ? html` <span class="r-muted">oleh ${a.changedBy}</span>` : ''}`],
   ];
   const pageTable = html`<div class="r-table-wrap" tabindex="0" role="group" aria-label="Halaman ${a.name}">
   <table class="r-table r-table--compact">
     <caption class="r-sr-only">Halaman</caption>
     <thead><tr><th scope="col" class="r-num">No</th><th scope="col">Nama</th><th scope="col">Alias</th><th scope="col">Jenis</th><th scope="col" class="r-num">Region</th><th scope="col">Akses</th></tr></thead>
     <tbody>${pages.map(p => html`<tr>
       <td class="r-num">${p.no}</td>
       <td><a class="r-cell-link" href="${run}/${p.no}">${p.title ?? p.name}</a>${p.title && p.title !== p.name ? html` <span class="r-muted">(${p.name})</span>` : ''}${p.no === a.homePage ? html` <span class="r-badge">Beranda</span>` : ''}</td>
       <td class="r-mono">${p.alias ?? ''}</td>
       <td>${MODE_LABEL[p.mode] ?? p.mode}</td>
       <td class="r-num">${p.regions}</td>
       <td>${p.requiresAuth ? 'Perlu masuk' : html`<span class="r-badge r-badge--warning">Publik</span>`}</td></tr>`)}</tbody>
   </table></div>`;
   const versionTable = versions.length
      ? html`<div class="r-table-wrap" tabindex="0" role="group" aria-label="Riwayat impor ${a.name}">
   <table class="r-table r-table--compact">
     <caption class="r-sr-only">Riwayat impor</caption>
     <thead><tr><th scope="col">Waktu</th><th scope="col">Oleh</th><th scope="col">Engine</th><th scope="col">Hash</th><th scope="col" class="r-num">Ukuran</th><th scope="col"><span class="r-sr-only">Unduh</span></th></tr></thead>
     <tbody>${versions.map((v, i) => html`<tr>
       <td>${time(v.importedAt)}${i === 0 ? html` <span class="r-badge r-badge--success">Aktif</span>` : ''}</td>
       <td>${v.importedBy}</td>
       <td class="r-mono">${v.engineVersion}</td>
       <td class="r-mono" title="${v.specHash}">${v.specHash.slice(0, 12)}</td>
       <td class="r-num">${(v.size / 1024).toFixed(1)} KB</td>
       <td class="r-table__actions"><a class="r-btn r-btn--sm r-btn--ghost" href="${base}/export?version=${v.id}" download aria-label="Unduh spec yang diimpor ${when(v.importedAt)}">${icon('download')} Unduh</a></td></tr>`)}</tbody>
   </table></div>`
      : html`<div class="r-empty"><p class="r-empty__title">Belum ada riwayat impor</p></div>`;

   const body = html`
<section class="r-region" aria-labelledby="facts-title">
  <div class="r-region__header"><h2 class="r-region__title" id="facts-title">Ringkasan</h2></div>
  <div class="r-region__body"><dl class="r-facts">${facts.map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl></div>
</section>
<section class="r-region" aria-labelledby="pages-title">
  <div class="r-region__header"><h2 class="r-region__title" id="pages-title">Halaman (${pages.length})</h2></div>
  <div class="r-region__body r-region__body--flush">${pageTable}</div>
</section>
<section class="r-region" aria-labelledby="versions-title">
  <div class="r-region__header"><h2 class="r-region__title" id="versions-title">Riwayat impor</h2></div>
  <div class="r-region__body${versions.length ? ' r-region__body--flush' : ''}">${versionTable}</div>
  <div class="r-region__footer"><p class="r-help">Ekspor membangun spec dari definisi yang aktif. Unduhan di riwayat adalah teks persis seperti saat diimpor.</p></div>
</section>
<form class="r-region r-region--danger" method="post" action="${base}/delete" novalidate aria-labelledby="delete-title">
  <input type="hidden" name="__csrf" value="${dev.csrf}">
  <div class="r-region__header"><h2 class="r-region__title" id="delete-title">Hapus aplikasi</h2></div>
  <div class="r-region__body">
    ${del.error ? alert('danger', del.error, undefined, raw(' tabindex="-1" data-error-summary')) : ''}
    <p>Definisi aplikasi, riwayat impor, dan sesi penggunanya ikut terhapus. Tabel dan data di skema <span class="r-mono">${a.parsingSchema}</span> tidak disentuh. Ekspor dulu bila masih diperlukan.</p>
    <div class="r-form"><div class="r-field r-col-6"><label class="r-label" for="confirm">Ketik alias <span class="r-mono">${a.alias}</span> untuk mengonfirmasi</label>
      <input class="r-input r-mono" id="confirm" name="confirm" autocomplete="off" autocapitalize="none" spellcheck="false" required${del.error ? raw(' aria-invalid="true"') : ''}></div></div>
  </div>
  <div class="r-region__footer"><button type="submit" class="r-btn r-btn--danger">${icon('trash-2')} Hapus aplikasi</button></div>
</form>`;
   const actions = html`<a class="r-btn" href="${base}/export" download>${icon('file-text')} Ekspor YAML</a>
      <a class="r-btn r-btn--primary" href="${run}">${icon('chevron-right')} Jalankan</a>`;
   return shell({ dev, section: 'apps', title: a.name, crumbs: [{ label: 'Aplikasi', href: '/builder/apps' }], actions, flash, body });
}
