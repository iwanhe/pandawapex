import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { hash, verify as verifyPassword } from '@node-rs/argon2';
import { attrIf, html, raw, type SafeHtml } from '../engine/html.ts';
import { HttpError } from '../engine/runtime.ts';
import { alert, icon } from '../engine/templates.ts';
import type { BuilderContext } from './routes.ts';
import { isUuid, setFlash, takeFlash, type DevSession, type Flash } from './session.ts';
import { shell, time, when } from './views.ts';

// B2: accounts from the builder (recon S19, workspace administration: users and groups).
//   application users of the workspace (list, add, groups, password, lock, delete)
//   developers of the workspace (administrators only)
//   the signed-in developer's own account (change password)
// Application users and developers are different tables and never share a password check.

const PW_MIN = 10;
const PW_MAX = 200;
const PAGE = 50;
const USERNAME = /^[A-Za-z0-9][A-Za-z0-9._@-]{1,59}$/;
const GROUP = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,59}$/;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}$/;

/** timestamptz arrives as text (engine/db.ts) */
function pgTime(v: string | null | undefined): Date | null {
   if (!v) return null;
   const d = new Date(v.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00'));
   return Number.isNaN(d.getTime()) ? null : d;
}

type Body = Record<string, string | string[] | undefined>;
const str = (b: Body, k: string) => { const v = b[k]; return String(Array.isArray(v) ? v[0] : v ?? ''); };
const list = (b: Body, k: string) => { const v = b[k]; return v === undefined ? [] : Array.isArray(v) ? v.map(String) : [String(v)]; };

function passwordProblem(pw: string, confirm: string, username: string): string | null {
   if (!pw) return 'Kata sandi baru wajib diisi.';
   if (pw.length < PW_MIN) return `Kata sandi minimal ${PW_MIN} karakter.`;
   if (pw.length > PW_MAX) return `Kata sandi maksimal ${PW_MAX} karakter.`;
   if (pw.toLowerCase() === username.toLowerCase()) return 'Kata sandi tidak boleh sama dengan nama pengguna.';
   if (pw !== confirm) return 'Konfirmasi kata sandi tidak sama.';
   return null;
}

/** checked groups + "other" (comma separated), validated and de-duplicated */
function parseGroups(b: Body): { groups: string[]; error: string | null } {
   const raw = [...list(b, 'groups'), ...str(b, 'groups_other').split(',')].map(g => g.trim()).filter(Boolean);
   const bad = raw.filter(g => !GROUP.test(g));
   if (bad.length) return { groups: [], error: `Nama grup tidak valid: ${bad.join(', ')}. Pakai huruf, angka, titik, garis bawah, atau tanda hubung.` };
   return { groups: [...new Set(raw)].sort((a, b) => a.localeCompare(b)), error: null };
}

// ---------------------------------------------------------------- views

interface AppUser {
   id: string; username: string; email: string | null; groups: string[]; locked: boolean; hasPassword: boolean;
   sso: boolean; lastLogin: Date | null; failed: number; createdAt: Date | null; sessions?: number;
}
interface Developer {
   id: string; username: string; email: string; isAdmin: boolean; locked: boolean; lastLogin: Date | null; failed: number; createdAt: Date | null;
}
type KnownGroups = Map<string, string[]>; // group → application aliases whose authorization uses it

const statusBadge = (locked: boolean) => locked
   ? html`<span class="r-badge r-badge--danger">Dikunci</span>`
   : html`<span class="r-badge r-badge--success">Aktif</span>`;

const err = (k: string, e: Record<string, string>) => e[k] ? html`<p class="r-error-text" id="${k}-err">${e[k]}</p>` : html``;
const inv = (k: string, e: Record<string, string>, help?: string) => {
   const ids = [help, e[k] ? `${k}-err` : ''].filter(Boolean).join(' ');
   return raw(`${e[k] ? ' aria-invalid="true"' : ''}${ids ? ` aria-describedby="${ids}"` : ''}`);
};
const summary = (e: Record<string, string>) => {
   const p = Object.values(e);
   if (!p.length) return html``;
   return alert('danger', p.length === 1 ? p[0] : 'Periksa isian berikut', p.length === 1 ? undefined : html`<ul class="r-problems">${p.map(x => html`<li>${x}</li>`)}</ul>`, raw(' tabindex="-1" data-error-summary'));
};

function groupsField(known: KnownGroups, selected: string[], e: Record<string, string>): SafeHtml {
   const names = [...new Set([...known.keys()])].sort((a, b) => a.localeCompare(b));
   const other = selected.filter(g => !known.has(g)).join(', ');
   return html`<fieldset class="r-field r-fieldset r-col-12"${inv('groups', e)}>
      <legend class="r-label">Grup</legend>
      ${names.length
         ? html`<div class="r-choice-group r-choice-group--inline">${names.map(g => html`<label class="r-choice"><input type="checkbox" name="groups" value="${g}"${attrIf('checked', selected.includes(g))}>
              <span>${g}${known.get(g)!.length ? html` <span class="r-muted">(${known.get(g)!.join(', ')})</span>` : ''}</span></label>`)}</div>`
         : html`<p class="r-help">Belum ada grup yang dipakai aplikasi di workspace ini.</p>`}
      <label class="r-label r-label--sub" for="groups_other">Grup lain</label>
      <input class="r-input" id="groups_other" name="groups_other" value="${other}" autocapitalize="none" spellcheck="false" aria-describedby="groups-help">
      <p class="r-help" id="groups-help">Pisahkan dengan koma. Grup dipakai authorization scheme <span class="r-mono">group_member</span>; nama di dalam kurung adalah aplikasi yang memakainya. Peran yang disimpan di tabel aplikasi sendiri (mis. role DEMO) tetap diatur dari aplikasinya.</p>
      ${err('groups', e)}
   </fieldset>`;
}

function pwFields(e: Record<string, string>, label = 'Kata sandi', autocomplete = 'new-password'): SafeHtml {
   return html`<div class="r-field r-col-6"><label class="r-label" for="password">${label} <span class="r-label__req" aria-hidden="true">*</span></label>
        <input class="r-input" id="password" name="password" type="password" autocomplete="${autocomplete}" required minlength="${PW_MIN}" maxlength="${PW_MAX}"${inv('password', e, 'password-help')}>
        <p class="r-help" id="password-help">Minimal ${PW_MIN} karakter.</p>${err('password', e)}</div>
      <div class="r-field r-col-6"><label class="r-label" for="confirm">Ulangi kata sandi <span class="r-label__req" aria-hidden="true">*</span></label>
        <input class="r-input" id="confirm" name="confirm" type="password" autocomplete="${autocomplete}" required maxlength="${PW_MAX}"></div>`;
}

function usersView(dev: DevSession, flash: Flash | null, users: AppUser[], q: string, total: number, all: number, page: number): SafeHtml {
   const from = page * PAGE;
   const qs = (p: number) => `/builder/users?${new URLSearchParams({ ...(q ? { q } : {}), ...(p ? { p: String(p) } : {}) })}`;
   const search = html`<form class="r-ir-toolbar" method="get" action="/builder/users" role="search">
      <label class="r-search"><span class="r-sr-only">Cari pengguna</span>${icon('search')}
        <input class="r-input" type="search" name="q" value="${q}" placeholder="Cari nama pengguna atau email…"></label>
      <button type="submit" class="r-btn">Cari</button>
      ${q ? html`<a class="r-btn r-btn--ghost" href="/builder/users">Hapus pencarian</a>` : ''}
      <span class="r-ir-toolbar__end r-muted" role="status">${q ? `${total} dari ${all} pengguna` : `${all} pengguna`}</span>
    </form>`;
   const table = html`<div class="r-table-wrap" tabindex="0" role="group" aria-label="Daftar pengguna aplikasi">
   <table class="r-table">
     <caption class="r-sr-only">Pengguna aplikasi</caption>
     <thead><tr><th scope="col">Nama pengguna</th><th scope="col">Email</th><th scope="col">Grup</th><th scope="col">Masuk dengan</th><th scope="col">Status</th><th scope="col">Login terakhir</th></tr></thead>
     <tbody>${users.map(u => html`<tr>
       <td><a class="r-cell-link" href="/builder/users/${u.id}">${u.username}</a></td>
       <td>${u.email ?? html`<span class="r-muted">—</span>`}</td>
       <td>${u.groups.length ? html`<span class="r-chips">${u.groups.map(g => html`<span class="r-badge">${g}</span>`)}</span>` : html`<span class="r-muted">—</span>`}</td>
       <td>${u.sso ? (u.hasPassword ? 'SSO + kata sandi' : 'SSO') : 'Kata sandi'}</td>
       <td>${statusBadge(u.locked)}</td>
       <td>${time(u.lastLogin)}</td></tr>`)}</tbody>
   </table></div>
   ${total > PAGE ? html`<div class="r-pagination"><span>Baris ${from + 1}–${from + users.length} dari ${total}</span>
      <nav class="r-pagination__nav" aria-label="Halaman daftar pengguna">
        ${page > 0 ? html`<a class="r-btn r-btn--sm" href="${qs(page - 1)}">${icon('chevron-left')} Sebelumnya</a>` : ''}
        ${from + users.length < total ? html`<a class="r-btn r-btn--sm" href="${qs(page + 1)}">Berikutnya ${icon('chevron-right')}</a>` : ''}
      </nav></div>` : ''}`;
   const add = html`<a class="r-btn r-btn--primary" href="/builder/users/new">${icon('plus')} Tambah pengguna</a>`;
   const content = !all
      ? html`<div class="r-region__body"><div class="r-empty">${icon('users')}<p class="r-empty__title">Belum ada pengguna aplikasi di workspace ini</p>
           <p class="r-muted">Pengguna SSO muncul sendiri setelah login pertama. Akun dengan kata sandi ditambahkan di sini.</p>${add}</div></div>`
      : !users.length
         ? html`${search}<div class="r-region__body"><div class="r-empty">${icon('search')}<p class="r-empty__title">Tidak ada pengguna yang cocok dengan “${q}”</p>
              <a class="r-btn r-btn--sm" href="/builder/users">Tampilkan semua</a></div></div>`
         : html`${search}<div class="r-region__body r-region__body--flush">${table}</div>`;
   const body = html`<p class="r-help r-lead">Satu akun berlaku untuk semua aplikasi di workspace ${dev.workspace}. Akses per aplikasi diatur lewat grup.</p>
<section class="r-region" aria-label="Pengguna aplikasi">${content}</section>`;
   return shell({ dev, section: 'users', title: 'Pengguna aplikasi', flash, body, actions: add });
}

interface NewUserForm { username: string; email: string; groups: string[] }
function newUserView(dev: DevSession, f: NewUserForm, known: KnownGroups, e: Record<string, string>): SafeHtml {
   const body = html`<form class="r-region" method="post" action="/builder/users/new" novalidate>
  <input type="hidden" name="__csrf" value="${dev.csrf}">
  <div class="r-region__header"><h2 class="r-region__title">Akun baru</h2></div>
  <div class="r-region__body">
    ${summary(e)}
    <div class="r-form">
      <div class="r-field r-col-6"><label class="r-label" for="username">Nama pengguna <span class="r-label__req" aria-hidden="true">*</span></label>
        <input class="r-input" id="username" name="username" required maxlength="60" autocomplete="off" autocapitalize="none" spellcheck="false" value="${f.username}"${inv('username', e, 'username-help')}${attrIf('autofocus', !Object.keys(e).length)}>
        <p class="r-help" id="username-help">Dipakai saat login. Huruf, angka, titik, garis bawah, @, atau tanda hubung.</p>${err('username', e)}</div>
      <div class="r-field r-col-6"><label class="r-label" for="email">Email</label>
        <input class="r-input" id="email" name="email" type="email" maxlength="254" autocomplete="off" value="${f.email}"${inv('email', e)}>${err('email', e)}</div>
      ${pwFields(e)}
      ${groupsField(known, f.groups, e)}
    </div>
  </div>
  <div class="r-region__footer"><a class="r-btn" href="/builder/users">Batal</a>
    <button type="submit" class="r-btn r-btn--primary">${icon('plus')} Tambah pengguna</button></div>
</form>`;
   return shell({ dev, section: 'users', title: 'Tambah pengguna', crumbs: [{ label: 'Pengguna aplikasi', href: '/builder/users' }], body });
}

function facts(rows: [string, SafeHtml | string][]): SafeHtml {
   return html`<dl class="r-facts">${rows.map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>`;
}

/** the lock / unlock region shared by users and developers */
function lockRegion(dev: DevSession, action: string, locked: boolean, failed: number, what: string): SafeHtml {
   return html`<form class="r-region" method="post" action="${action}" aria-labelledby="lock-title">
  <input type="hidden" name="__csrf" value="${dev.csrf}">
  <input type="hidden" name="locked" value="${locked ? '0' : '1'}">
  <div class="r-region__header"><h2 class="r-region__title" id="lock-title">${locked ? 'Akun dikunci' : 'Kunci akun'}</h2></div>
  <div class="r-region__body"><p>${locked
      ? `Akun ini tidak bisa login${failed >= 5 ? ' karena terlalu banyak percobaan kata sandi yang salah' : ''}. Membuka kunci juga mengosongkan hitungan percobaan gagal.`
      : `Akun yang dikunci tidak bisa login, dan sesi ${what} yang sedang terbuka langsung berakhir.`}</p></div>
  <div class="r-region__footer"><button type="submit" class="r-btn${locked ? ' r-btn--primary' : ''}">${icon('key-round')} ${locked ? 'Buka kunci' : 'Kunci akun'}</button></div>
</form>`;
}

function deleteRegion(dev: DevSession, action: string, username: string, text: string, error: string | null): SafeHtml {
   return html`<form class="r-region r-region--danger" method="post" action="${action}" novalidate aria-labelledby="delete-title">
  <input type="hidden" name="__csrf" value="${dev.csrf}">
  <div class="r-region__header"><h2 class="r-region__title" id="delete-title">Hapus akun</h2></div>
  <div class="r-region__body">
    ${error ? alert('danger', error, undefined, raw(' tabindex="-1" data-error-summary')) : ''}
    <p>${text}</p>
    <div class="r-form"><div class="r-field r-col-6"><label class="r-label" for="confirm-delete">Ketik <span class="r-mono">${username}</span> untuk mengonfirmasi</label>
      <input class="r-input r-mono" id="confirm-delete" name="confirm" autocomplete="off" autocapitalize="none" spellcheck="false" required${error ? raw(' aria-invalid="true"') : ''}></div></div>
  </div>
  <div class="r-region__footer"><button type="submit" class="r-btn r-btn--danger">${icon('trash-2')} Hapus akun</button></div>
</form>`;
}

function passwordRegion(dev: DevSession, action: string, e: Record<string, string>, text: string): SafeHtml {
   return html`<form class="r-region" method="post" action="${action}" novalidate aria-labelledby="pw-title">
  <input type="hidden" name="__csrf" value="${dev.csrf}">
  <div class="r-region__header"><h2 class="r-region__title" id="pw-title">Atur ulang kata sandi</h2></div>
  <div class="r-region__body">${summary(e)}<p class="r-help">${text}</p><div class="r-form">${pwFields(e, 'Kata sandi baru')}</div></div>
  <div class="r-region__footer"><button type="submit" class="r-btn">${icon('key-round')} Simpan kata sandi</button></div>
</form>`;
}

interface FormErrors { groups?: Record<string, string>; password?: Record<string, string>; delete?: string | null }

function userView(dev: DevSession, flash: Flash | null, u: AppUser, known: KnownGroups, fe: FormErrors, selected?: string[]): SafeHtml {
   const base = `/builder/users/${u.id}`;
   const body = html`
<section class="r-region" aria-labelledby="facts-title">
  <div class="r-region__header"><h2 class="r-region__title" id="facts-title">Ringkasan</h2></div>
  <div class="r-region__body">${facts([
      ['Status', statusBadge(u.locked)],
      ['Email', u.email ?? '—'],
      ['Masuk dengan', u.sso ? (u.hasPassword ? 'SSO dan kata sandi' : 'SSO') : 'Kata sandi'],
      ['Login terakhir', time(u.lastLogin)],
      ['Sesi terbuka', String(u.sessions ?? 0)],
      ['Dibuat', time(u.createdAt)],
   ])}</div>
</section>
<form class="r-region" method="post" action="${base}/groups" novalidate aria-labelledby="groups-title">
  <input type="hidden" name="__csrf" value="${dev.csrf}">
  <div class="r-region__header"><h2 class="r-region__title" id="groups-title">Akses aplikasi</h2></div>
  <div class="r-region__body">${summary(fe.groups ?? {})}
    ${u.sso ? alert('info', 'Akun SSO', html`<p>Grup akun SSO ditimpa dari klaim IdP setiap kali login. Perubahan di sini berlaku sampai login berikutnya.</p>`) : ''}
    <div class="r-form">${groupsField(known, selected ?? u.groups, fe.groups ?? {})}</div></div>
  <div class="r-region__footer"><button type="submit" class="r-btn r-btn--primary">${icon('save')} Simpan grup</button></div>
</form>
${u.sso && !u.hasPassword
   ? html``
   : passwordRegion(dev, `${base}/password`, fe.password ?? {}, 'Pengguna ini langsung keluar dari semua sesi. Sampaikan kata sandi baru lewat jalur yang aman.')}
${lockRegion(dev, `${base}/lock`, u.locked, u.failed, 'pengguna ini')}
${deleteRegion(dev, `${base}/delete`, u.username, 'Akun dan semua sesinya dihapus. Data yang pernah dibuat pengguna ini di tabel aplikasi tidak disentuh.', fe.delete ?? null)}`;
   return shell({ dev, section: 'users', title: u.username, crumbs: [{ label: 'Pengguna aplikasi', href: '/builder/users' }], flash, body });
}

function devsView(dev: DevSession, flash: Flash | null, devs: Developer[]): SafeHtml {
   const table = html`<div class="r-table-wrap" tabindex="0" role="group" aria-label="Daftar developer">
   <table class="r-table">
     <caption class="r-sr-only">Developer</caption>
     <thead><tr><th scope="col">Nama pengguna</th><th scope="col">Email</th><th scope="col">Peran</th><th scope="col">Status</th><th scope="col">Login terakhir</th></tr></thead>
     <tbody>${devs.map(d => html`<tr>
       <td>${d.id === dev.userId
          ? html`<a class="r-cell-link" href="/builder/account">${d.username}</a> <span class="r-muted">(Anda)</span>`
          : html`<a class="r-cell-link" href="/builder/developers/${d.id}">${d.username}</a>`}</td>
       <td>${d.email}</td>
       <td>${d.isAdmin ? html`<span class="r-badge r-badge--info">Administrator</span>` : 'Developer'}</td>
       <td>${statusBadge(d.locked)}</td>
       <td>${time(d.lastLogin)}</td></tr>`)}</tbody>
   </table></div>`;
   const body = html`<p class="r-help r-lead">Developer bisa membuat, mengimpor, mengekspor, dan menghapus aplikasi di workspace ${dev.workspace}, serta mengelola pengguna aplikasi. Administrator juga mengelola developer.</p>
<section class="r-region" aria-label="Developer"><div class="r-region__body r-region__body--flush">${table}</div></section>`;
   return shell({ dev, section: 'devs', title: 'Developer', flash, body, actions: html`<a class="r-btn r-btn--primary" href="/builder/developers/new">${icon('plus')} Tambah developer</a>` });
}

interface NewDevForm { username: string; email: string; admin: boolean }
function newDevView(dev: DevSession, f: NewDevForm, e: Record<string, string>): SafeHtml {
   const body = html`<form class="r-region" method="post" action="/builder/developers/new" novalidate>
  <input type="hidden" name="__csrf" value="${dev.csrf}">
  <div class="r-region__header"><h2 class="r-region__title">Developer baru</h2></div>
  <div class="r-region__body">
    ${summary(e)}
    <div class="r-form">
      <div class="r-field r-col-6"><label class="r-label" for="username">Nama pengguna <span class="r-label__req" aria-hidden="true">*</span></label>
        <input class="r-input" id="username" name="username" required maxlength="60" autocomplete="off" autocapitalize="none" spellcheck="false" value="${f.username}"${inv('username', e)}${attrIf('autofocus', !Object.keys(e).length)}>${err('username', e)}</div>
      <div class="r-field r-col-6"><label class="r-label" for="email">Email</label>
        <input class="r-input" id="email" name="email" type="email" maxlength="254" autocomplete="off" value="${f.email}"${inv('email', e)}>${err('email', e)}</div>
      ${pwFields(e)}
      <div class="r-field r-col-12"><label class="r-choice"><input type="checkbox" name="admin" value="1"${attrIf('checked', f.admin)}> Administrator workspace (boleh mengelola developer)</label></div>
    </div>
  </div>
  <div class="r-region__footer"><a class="r-btn" href="/builder/developers">Batal</a>
    <button type="submit" class="r-btn r-btn--primary">${icon('plus')} Tambah developer</button></div>
</form>`;
   return shell({ dev, section: 'devs', title: 'Tambah developer', crumbs: [{ label: 'Developer', href: '/builder/developers' }], body });
}

function devView(dev: DevSession, flash: Flash | null, d: Developer, fe: FormErrors): SafeHtml {
   const base = `/builder/developers/${d.id}`;
   const body = html`
<section class="r-region" aria-labelledby="facts-title">
  <div class="r-region__header"><h2 class="r-region__title" id="facts-title">Ringkasan</h2></div>
  <div class="r-region__body">${facts([
      ['Status', statusBadge(d.locked)],
      ['Email', d.email],
      ['Peran', d.isAdmin ? 'Administrator' : 'Developer'],
      ['Login terakhir', time(d.lastLogin)],
      ['Dibuat', time(d.createdAt)],
   ])}</div>
</section>
<form class="r-region" method="post" action="${base}/role" aria-labelledby="role-title">
  <input type="hidden" name="__csrf" value="${dev.csrf}">
  <input type="hidden" name="admin" value="${d.isAdmin ? '0' : '1'}">
  <div class="r-region__header"><h2 class="r-region__title" id="role-title">Peran</h2></div>
  <div class="r-region__body"><p>${d.isAdmin ? 'Administrator: boleh menambah, mengunci, dan menghapus developer.' : 'Developer: mengelola aplikasi dan pengguna aplikasi, tidak mengelola developer.'}</p></div>
  <div class="r-region__footer"><button type="submit" class="r-btn">${d.isAdmin ? 'Jadikan developer biasa' : 'Jadikan administrator'}</button></div>
</form>
${passwordRegion(dev, `${base}/password`, fe.password ?? {}, 'Developer ini langsung keluar dari builder. Sampaikan kata sandi baru lewat jalur yang aman.')}
${lockRegion(dev, `${base}/lock`, d.locked, d.failed, 'builder developer ini')}
${deleteRegion(dev, `${base}/delete`, d.username, 'Akun developer dan sesinya dihapus. Aplikasi dan riwayat impornya tetap ada.', fe.delete ?? null)}`;
   return shell({ dev, section: 'devs', title: d.username, crumbs: [{ label: 'Developer', href: '/builder/developers' }], flash, body });
}

function accountView(dev: DevSession, flash: Flash | null, d: Developer, e: Record<string, string>): SafeHtml {
   const body = html`
<section class="r-region" aria-labelledby="facts-title">
  <div class="r-region__header"><h2 class="r-region__title" id="facts-title">Akun saya</h2></div>
  <div class="r-region__body">${facts([
      ['Nama pengguna', d.username],
      ['Workspace', dev.workspace],
      ['Email', d.email],
      ['Peran', d.isAdmin ? 'Administrator' : 'Developer'],
      ['Login terakhir', d.lastLogin ? when(d.lastLogin) : '—'],
   ])}</div>
</section>
<form class="r-region" method="post" action="/builder/account/password" novalidate aria-labelledby="pw-title">
  <input type="hidden" name="__csrf" value="${dev.csrf}">
  <div class="r-region__header"><h2 class="r-region__title" id="pw-title">Ganti kata sandi</h2></div>
  <div class="r-region__body">${summary(e)}
    <div class="r-form">
      <div class="r-field r-col-6"><label class="r-label" for="current">Kata sandi sekarang <span class="r-label__req" aria-hidden="true">*</span></label>
        <input class="r-input" id="current" name="current" type="password" autocomplete="current-password" required maxlength="${PW_MAX}"${inv('current', e)}>${err('current', e)}</div>
      <div class="r-field r-col-6"></div>
      ${pwFields(e, 'Kata sandi baru')}
    </div>
    <p class="r-help">Sesi builder Anda di perangkat lain berakhir; sesi ini tetap terbuka.</p>
  </div>
  <div class="r-region__footer"><button type="submit" class="r-btn r-btn--primary">${icon('save')} Ganti kata sandi</button></div>
</form>`;
   return shell({ dev, section: 'account', title: 'Akun saya', flash, body });
}

// ---------------------------------------------------------------- routes

export function registerAccounts(app: FastifyInstance, ctx: BuilderContext & { passwordLimit: { max: number; timeWindow: string } }): void {
   const { pool, send } = ctx;
   const idParam = (req: FastifyRequest) => (req.params as { id: string }).id;

   async function admin(req: FastifyRequest, reply: FastifyReply): Promise<DevSession | null> {
      const s = await ctx.dev(req, reply);
      if (s && !s.isAdmin) throw new HttpError(403, 'Khusus administrator', 'Hanya administrator workspace yang boleh mengelola developer.');
      return s;
   }

   async function knownGroups(s: DevSession): Promise<KnownGroups> {
      const r = await pool.query(
         `select g, array_remove(array_agg(distinct alias order by alias), null)::text[] as apps from (
            select trim(x) as g, a.alias::text as alias
              from rpx.authz_schemes z join rpx.applications a on a.id = z.app_id
                 , unnest(string_to_array(z.source, ',')) x
             where a.workspace_id = $1 and z.scheme_type = 'group_member'
            union all
            select unnest(groups), null::text from rpx.app_users where workspace_id = $1
          ) t where g <> '' group by g`, [s.workspaceId]);
      return new Map(r.rows.map(x => [x.g, x.apps]));
   }

   const userRow = (x: Record<string, any>): AppUser => ({
      id: x.id, username: x.username, email: x.email, groups: x.groups, locked: x.locked, hasPassword: x.has_pwd, sso: x.sso,
      lastLogin: pgTime(x.last_login), failed: x.failed_logins, createdAt: pgTime(x.created_at), sessions: x.sessions,
   });
   const USER_COLS = `id, username, email, groups, locked, pwd_hash is not null as has_pwd, oidc_issuer is not null as sso
                    , last_login, failed_logins, created_at`;

   async function findUser(s: DevSession, id: string): Promise<AppUser> {
      const r = isUuid(id) ? await pool.query(
         `select ${USER_COLS}, (select count(*)::int from rpx.sessions x where x.app_user_id = u.id and x.expires_at > now()) as sessions
            from rpx.app_users u where id = $1 and workspace_id = $2`, [id, s.workspaceId]) : { rowCount: 0, rows: [] };
      if (!r.rowCount) throw new HttpError(404, 'Pengguna tidak ditemukan', `Tidak ada pengguna ini di workspace ${s.workspace}.`);
      return userRow(r.rows[0]);
   }

   const devRow = (x: Record<string, any>): Developer => ({
      id: x.id, username: x.username, email: x.email, isAdmin: x.is_admin, locked: x.locked, lastLogin: pgTime(x.last_login),
      failed: x.failed_logins, createdAt: pgTime(x.created_at),
   });
   async function findDev(s: DevSession, id: string): Promise<Developer> {
      const r = isUuid(id) ? await pool.query(
         'select id, username, email, is_admin, locked, last_login, failed_logins, created_at from rpx.dev_users where id = $1 and workspace_id = $2',
         [id, s.workspaceId]) : { rowCount: 0, rows: [] };
      if (!r.rowCount) throw new HttpError(404, 'Developer tidak ditemukan', `Tidak ada developer ini di workspace ${s.workspace}.`);
      return devRow(r.rows[0]);
   }
   /** an administrator manages the other developers; the own account goes through /builder/account */
   async function otherDev(s: DevSession, id: string, reply: FastifyReply): Promise<Developer | null> {
      const d = await findDev(s, id);
      if (d.id === s.userId) { reply.redirect('/builder/account', 303); return null; }
      return d;
   }

   function newAccountChecks(b: Body, table: 'app_users' | 'dev_users') {
      const username = str(b, 'username').trim();
      const email = str(b, 'email').trim();
      const e: Record<string, string> = {};
      if (!username) e.username = 'Nama pengguna wajib diisi.';
      else if (!USERNAME.test(username)) e.username = 'Nama pengguna 2–60 karakter: huruf, angka, titik, garis bawah, @, atau tanda hubung, diawali huruf atau angka.';
      if (email && !EMAIL.test(email)) e.email = 'Format email tidak valid.';
      const pw = passwordProblem(str(b, 'password'), str(b, 'confirm'), username);
      if (pw) e.password = pw;
      return { username, email, e, table };
   }

   // ---------- application users ----------
   app.get('/builder/users', async (req, reply) => {
      const s = await ctx.dev(req, reply);
      if (!s) return reply;
      const qq = req.query as Record<string, unknown>;
      const q = String(qq.q ?? '').trim().slice(0, 100);
      const page = Math.max(0, Math.min(10_000, Number.parseInt(String(qq.p ?? '0'), 10) || 0));
      const like = q.replace(/[\\%_]/g, '\\$&');
      const where = `workspace_id = $1 and ($2 = '' or username ilike '%' || $2 || '%' or email ilike '%' || $2 || '%')`;
      const [rows, cnt, all] = await Promise.all([
         pool.query(`select ${USER_COLS} from rpx.app_users where ${where} order by lower(username) limit $3 offset $4`, [s.workspaceId, like, PAGE, page * PAGE]),
         pool.query(`select count(*)::int as n from rpx.app_users where ${where}`, [s.workspaceId, like]),
         pool.query('select count(*)::int as n from rpx.app_users where workspace_id = $1', [s.workspaceId]),
      ]);
      return send(reply, usersView(s, await takeFlash(pool, s), rows.rows.map(userRow), q, cnt.rows[0].n, all.rows[0].n, page));
   });

   app.get('/builder/users/new', async (req, reply) => {
      const s = await ctx.dev(req, reply);
      if (!s) return reply;
      return send(reply, newUserView(s, { username: '', email: '', groups: [] }, await knownGroups(s), {}));
   });

   app.post('/builder/users/new', async (req, reply) => {
      const s = await ctx.dev(req, reply);
      if (!s) return reply;
      const b = req.body as Body;
      const { username, email, e } = newAccountChecks(b, 'app_users');
      const g = parseGroups(b);
      if (g.error) e.groups = g.error;
      if (!e.username) {
         const ex = await pool.query('select 1 from rpx.app_users where workspace_id = $1 and username = $2', [s.workspaceId, username]);
         if (ex.rowCount) e.username = `Nama pengguna "${username}" sudah dipakai di workspace ini.`;
      }
      if (Object.keys(e).length) return send(reply, newUserView(s, { username, email, groups: g.groups }, await knownGroups(s), e), 422);
      const r = await pool.query(
         `insert into rpx.app_users (workspace_id, username, email, pwd_hash, groups) values ($1, $2, $3, $4, $5) returning id`,
         [s.workspaceId, username, email || null, await hash(str(b, 'password')), g.groups]);
      await setFlash(pool, s, { kind: 'success', text: `Pengguna ${username} ditambahkan.` });
      return reply.redirect(`/builder/users/${r.rows[0].id}`, 303);
   });

   app.get('/builder/users/:id', async (req, reply) => {
      const s = await ctx.dev(req, reply);
      if (!s) return reply;
      const u = await findUser(s, idParam(req));
      return send(reply, userView(s, await takeFlash(pool, s), u, await knownGroups(s), {}));
   });

   app.post('/builder/users/:id/groups', async (req, reply) => {
      const s = await ctx.dev(req, reply);
      if (!s) return reply;
      const u = await findUser(s, idParam(req));
      const g = parseGroups(req.body as Body);
      if (g.error) return send(reply, userView(s, null, u, await knownGroups(s), { groups: { groups: g.error } }, g.groups), 422);
      await pool.query('update rpx.app_users set groups = $2, updated_at = now() where id = $1', [u.id, g.groups]);
      // cached "once per session" authorization results were computed with the old groups
      await pool.query(`update rpx.sessions set authz_cache = '{}' where app_user_id = $1`, [u.id]);
      await setFlash(pool, s, { kind: 'success', text: `Grup ${u.username} disimpan: ${g.groups.length ? g.groups.join(', ') : 'tanpa grup'}.` });
      return reply.redirect(`/builder/users/${u.id}`, 303);
   });

   app.post('/builder/users/:id/password', async (req, reply) => {
      const s = await ctx.dev(req, reply);
      if (!s) return reply;
      const u = await findUser(s, idParam(req));
      if (u.sso && !u.hasPassword) throw new HttpError(400, 'Akun SSO', 'Akun ini masuk lewat SSO dan tidak memakai kata sandi.');
      const b = req.body as Body;
      const p = passwordProblem(str(b, 'password'), str(b, 'confirm'), u.username);
      if (p) return send(reply, userView(s, null, u, await knownGroups(s), { password: { password: p } }), 422);
      await pool.query('update rpx.app_users set pwd_hash = $2, failed_logins = 0, updated_at = now() where id = $1', [u.id, await hash(str(b, 'password'))]);
      const out = await pool.query('delete from rpx.sessions where app_user_id = $1', [u.id]);
      await setFlash(pool, s, { kind: 'success', text: `Kata sandi ${u.username} diganti${out.rowCount ? `; ${out.rowCount} sesi diakhiri` : ''}.` });
      return reply.redirect(`/builder/users/${u.id}`, 303);
   });

   app.post('/builder/users/:id/lock', async (req, reply) => {
      const s = await ctx.dev(req, reply);
      if (!s) return reply;
      const u = await findUser(s, idParam(req));
      const lock = str(req.body as Body, 'locked') === '1';
      await pool.query('update rpx.app_users set locked = $2, failed_logins = case when $2 then failed_logins else 0 end, updated_at = now() where id = $1', [u.id, lock]);
      if (lock) await pool.query('delete from rpx.sessions where app_user_id = $1', [u.id]);
      await setFlash(pool, s, { kind: 'success', text: lock ? `${u.username} dikunci.` : `Kunci ${u.username} dibuka.` });
      return reply.redirect(`/builder/users/${u.id}`, 303);
   });

   app.post('/builder/users/:id/delete', async (req, reply) => {
      const s = await ctx.dev(req, reply);
      if (!s) return reply;
      const u = await findUser(s, idParam(req));
      const c = str(req.body as Body, 'confirm').trim();
      if (c !== u.username) {
         return send(reply, userView(s, null, u, await knownGroups(s), { delete: c ? `Yang diketik "${c}", bukan nama pengguna. Akun tidak dihapus.` : 'Ketik nama pengguna untuk mengonfirmasi.' }), 422);
      }
      await pool.query('delete from rpx.app_users where id = $1 and workspace_id = $2', [u.id, s.workspaceId]);
      await setFlash(pool, s, { kind: 'success', text: `Pengguna ${u.username} dihapus.` });
      return reply.redirect('/builder/users', 303);
   });

   // ---------- developers (administrators only) ----------
   app.get('/builder/developers', async (req, reply) => {
      const s = await admin(req, reply);
      if (!s) return reply;
      const r = await pool.query(
         'select id, username, email, is_admin, locked, last_login, failed_logins, created_at from rpx.dev_users where workspace_id = $1 order by lower(username)',
         [s.workspaceId]);
      return send(reply, devsView(s, await takeFlash(pool, s), r.rows.map(devRow)));
   });

   app.get('/builder/developers/new', async (req, reply) => {
      const s = await admin(req, reply);
      if (!s) return reply;
      return send(reply, newDevView(s, { username: '', email: '', admin: false }, {}));
   });

   app.post('/builder/developers/new', async (req, reply) => {
      const s = await admin(req, reply);
      if (!s) return reply;
      const b = req.body as Body;
      const { username, email, e } = newAccountChecks(b, 'dev_users');
      const isAdmin = str(b, 'admin') === '1';
      if (!e.username) {
         const ex = await pool.query('select 1 from rpx.dev_users where workspace_id = $1 and username = $2', [s.workspaceId, username]);
         if (ex.rowCount) e.username = `Developer "${username}" sudah ada di workspace ini.`;
      }
      if (Object.keys(e).length) return send(reply, newDevView(s, { username, email, admin: isAdmin }, e), 422);
      const r = await pool.query(
         `insert into rpx.dev_users (workspace_id, username, email, pwd_hash, is_admin) values ($1, $2, $3, $4, $5) returning id`,
         [s.workspaceId, username, email || `${username}@localhost`, await hash(str(b, 'password')), isAdmin]);
      await setFlash(pool, s, { kind: 'success', text: `Developer ${username} ditambahkan.` });
      return reply.redirect(`/builder/developers/${r.rows[0].id}`, 303);
   });

   app.get('/builder/developers/:id', async (req, reply) => {
      const s = await admin(req, reply);
      if (!s) return reply;
      const d = await otherDev(s, idParam(req), reply);
      if (!d) return reply;
      return send(reply, devView(s, await takeFlash(pool, s), d, {}));
   });

   app.post('/builder/developers/:id/role', async (req, reply) => {
      const s = await admin(req, reply);
      if (!s) return reply;
      const d = await otherDev(s, idParam(req), reply);
      if (!d) return reply;
      const makeAdmin = str(req.body as Body, 'admin') === '1';
      await pool.query('update rpx.dev_users set is_admin = $2, updated_at = now() where id = $1', [d.id, makeAdmin]);
      await setFlash(pool, s, { kind: 'success', text: makeAdmin ? `${d.username} sekarang administrator.` : `${d.username} sekarang developer biasa.` });
      return reply.redirect(`/builder/developers/${d.id}`, 303);
   });

   app.post('/builder/developers/:id/password', async (req, reply) => {
      const s = await admin(req, reply);
      if (!s) return reply;
      const d = await otherDev(s, idParam(req), reply);
      if (!d) return reply;
      const b = req.body as Body;
      const p = passwordProblem(str(b, 'password'), str(b, 'confirm'), d.username);
      if (p) return send(reply, devView(s, null, d, { password: { password: p } }), 422);
      await pool.query('update rpx.dev_users set pwd_hash = $2, failed_logins = 0, updated_at = now() where id = $1', [d.id, await hash(str(b, 'password'))]);
      await pool.query('delete from rpx.dev_sessions where dev_user_id = $1', [d.id]);
      await setFlash(pool, s, { kind: 'success', text: `Kata sandi ${d.username} diganti; sesi builder-nya diakhiri.` });
      return reply.redirect(`/builder/developers/${d.id}`, 303);
   });

   app.post('/builder/developers/:id/lock', async (req, reply) => {
      const s = await admin(req, reply);
      if (!s) return reply;
      const d = await otherDev(s, idParam(req), reply);
      if (!d) return reply;
      const lock = str(req.body as Body, 'locked') === '1';
      await pool.query('update rpx.dev_users set locked = $2, failed_logins = case when $2 then failed_logins else 0 end, updated_at = now() where id = $1', [d.id, lock]);
      if (lock) await pool.query('delete from rpx.dev_sessions where dev_user_id = $1', [d.id]);
      await setFlash(pool, s, { kind: 'success', text: lock ? `${d.username} dikunci.` : `Kunci ${d.username} dibuka.` });
      return reply.redirect(`/builder/developers/${d.id}`, 303);
   });

   app.post('/builder/developers/:id/delete', async (req, reply) => {
      const s = await admin(req, reply);
      if (!s) return reply;
      const d = await otherDev(s, idParam(req), reply);
      if (!d) return reply;
      const c = str(req.body as Body, 'confirm').trim();
      if (c !== d.username) {
         return send(reply, devView(s, null, d, { delete: c ? `Yang diketik "${c}", bukan nama pengguna. Akun tidak dihapus.` : 'Ketik nama pengguna untuk mengonfirmasi.' }), 422);
      }
      await pool.query('delete from rpx.dev_users where id = $1 and workspace_id = $2', [d.id, s.workspaceId]);
      await setFlash(pool, s, { kind: 'success', text: `Developer ${d.username} dihapus.` });
      return reply.redirect('/builder/developers', 303);
   });

   // ---------- own account ----------
   async function self(s: DevSession) { return findDev(s, s.userId); }

   app.get('/builder/account', async (req, reply) => {
      const s = await ctx.dev(req, reply);
      if (!s) return reply;
      return send(reply, accountView(s, await takeFlash(pool, s), await self(s), {}));
   });

   app.post('/builder/account/password', { config: { rateLimit: ctx.passwordLimit } }, async (req, reply) => {
      const s = await ctx.dev(req, reply);
      if (!s) return reply;
      const b = req.body as Body;
      const me = await self(s);
      const e: Record<string, string> = {};
      const row = await pool.query('select pwd_hash from rpx.dev_users where id = $1', [s.userId]);
      const ok = await verifyPassword(row.rows[0].pwd_hash, str(b, 'current')).catch(() => false);
      if (!ok) e.current = 'Kata sandi sekarang salah.';
      const p = passwordProblem(str(b, 'password'), str(b, 'confirm'), me.username);
      if (p) e.password = p;
      else if (ok && str(b, 'password') === str(b, 'current')) e.password = 'Kata sandi baru harus berbeda dari yang sekarang.';
      if (Object.keys(e).length) return send(reply, accountView(s, null, me, e), 422);
      await pool.query('update rpx.dev_users set pwd_hash = $2, failed_logins = 0, updated_at = now() where id = $1', [s.userId, await hash(str(b, 'password'))]);
      const out = await pool.query('delete from rpx.dev_sessions where dev_user_id = $1 and id <> $2', [s.userId, s.id]);
      await setFlash(pool, s, { kind: 'success', text: `Kata sandi diganti${out.rowCount ? `; ${out.rowCount} sesi lain diakhiri` : ''}.` });
      return reply.redirect('/builder/account', 303);
   });
}
