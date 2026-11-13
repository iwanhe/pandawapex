import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { attrIf, html, raw, type SafeHtml } from './html.ts';
import type { AppDef, NavDef, PageDef } from './model.ts';

// Page and component templates built on the design-system primitives (src/client/components.css).
// All copy here is original; labels default to Bahasa Indonesia.

const ICON_DIR = join(import.meta.dirname, '../client/icons');
const icons = new Map<string, string>();
for (const f of readdirSync(ICON_DIR).filter(f => f.endsWith('.svg'))) {
   const svg = readFileSync(join(ICON_DIR, f), 'utf8').replace(/<!--[\s\S]*?-->/g, '').replace(/\sclass="[^"]*"/, '').trim();
   icons.set(f.slice(0, -4), svg.replace('<svg', '<svg class="r-icon" aria-hidden="true" focusable="false"'));
}
export function icon(name: string | null | undefined): SafeHtml {
   return raw(name ? icons.get(name) ?? '' : '');
}

export interface ShellArgs {
   app: AppDef;
   page: PageDef;
   /** navigation entries the user may see (already filtered by authorization and conditions) */
   nav: NavDef[];
   /** whether the breadcrumb parent page may be opened by this user */
   parentAllowed: boolean;
   username: string | null;
   csrf: string;
   logoutUrl: string;
   pageUrl: (no: number) => string;
   title: string;
   headerActions: SafeHtml;
   body: SafeHtml;
   messages: SafeHtml;
}

export function document(title: string, body: SafeHtml, bodyClass = ''): SafeHtml {
   return html`<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="icon" href="data:,">
<link rel="stylesheet" href="/static/fonts.css">
<link rel="stylesheet" href="/static/tokens.css">
<link rel="stylesheet" href="/static/components.css">
<script src="/static/rpx.js" defer></script>
</head>
<body${bodyClass ? raw(` class="${bodyClass}"`) : ''}>
${body}
</body>
</html>`;
}

function navList(entries: NavDef[], current: number, pageUrl: (no: number) => string): SafeHtml {
   if (!entries.length) return html``;
   return html`<ul>${entries.map(e => {
      const href = e.target.page !== undefined ? pageUrl(e.target.page) : e.target.url ?? '#';
      const isCurrent = e.target.page === current;
      return html`<li><a href="${href}"${isCurrent ? raw(' aria-current="page"') : ''}>${icon(e.icon)}<span class="r-nav__label">${e.label}</span></a>${navList(e.children, current, pageUrl)}</li>`;
   })}</ul>`;
}

export function shell(a: ShellArgs): SafeHtml {
   const parent = a.page.breadcrumbParent !== null && a.parentAllowed ? a.app.pages.get(a.page.breadcrumbParent) : undefined;
   const user = a.username
      ? html`<form method="post" action="${a.logoutUrl}" class="r-header__user">
            <input type="hidden" name="__csrf" value="${a.csrf}">
            <span class="r-header__name">${icon('user')} ${a.username}</span>
            <button type="submit" class="r-btn r-btn--ghost r-btn--sm">${icon('log-out')} Keluar</button>
         </form>`
      : html``;
   const body = html`<a class="r-skip" href="#main">Lompat ke konten</a>
<div class="r-shell">
  <header class="r-header">
    <button type="button" class="r-btn r-btn--ghost r-btn--icon" data-nav-toggle aria-controls="r-nav" aria-label="Tampilkan atau sembunyikan navigasi">${icon('menu')}</button>
    <a class="r-header__app" href="${a.pageUrl(a.app.homePage)}">${a.app.name}</a>
    <span class="r-header__spacer"></span>
    ${user}
  </header>
  <nav class="r-nav" id="r-nav" aria-label="Navigasi utama">${navList(a.nav, a.page.no, a.pageUrl)}</nav>
  <main class="r-main" id="main">
    ${parent ? html`<nav class="r-breadcrumb" aria-label="Breadcrumb"><ol><li><a href="${a.pageUrl(parent.no)}">${parent.title ?? parent.name}</a></li><li aria-current="page">${a.title}</li></ol></nav>` : ''}
    <div class="r-page-head">
      <h1>${a.title}</h1>
      ${a.headerActions}
    </div>
    ${a.messages}
    ${a.body}
  </main>
</div>`;
   return document(`${a.title} · ${a.app.name}`, body);
}

export function alert(kind: 'success' | 'danger' | 'warning' | 'info', title: string | SafeHtml, detail?: SafeHtml | string, attrs?: SafeHtml): SafeHtml {
   const ic = { success: 'circle-check', danger: 'circle-x', warning: 'triangle-alert', info: 'info' }[kind];
   const role = kind === 'danger' ? 'alert' : 'status';
   return html`<div class="r-alert r-alert--${kind}" role="${role}"${attrs ?? ''}><span class="r-alert__icon">${icon(ic)}</span><div class="r-alert__body"><p class="r-alert__title">${title}</p>${detail ?? ''}</div></div>`;
}

export function loginPage(args: {
   appName: string; action: string; csrf: string; username: string; error: string | null; info: string | null; returnTo: string;
   sso?: { label: string; href: string } | null; showForm?: boolean;
}): SafeHtml {
   const showForm = args.showForm ?? true;
   const sso = args.sso
      ? html`<a class="r-btn r-btn--primary r-btn--lg r-btn--block" href="${args.sso.href}">${icon('key-round')} ${args.sso.label}</a>
             ${showForm ? html`<p class="r-divider">atau dengan akun aplikasi</p>` : ''}`
      : html``;
   const body = html`<main class="r-login" id="main">
  <div class="r-login__card">
    <div class="r-login__brand">${icon('layout-grid')} ${args.appName}</div>
    <form class="r-region" method="post" action="${args.action}" novalidate>
      <div class="r-region__header"><h1 class="r-region__title">Masuk</h1></div>
      <div class="r-region__body">
        ${args.error ? alert('danger', args.error) : ''}
        ${args.info ? alert('info', args.info) : ''}
        ${sso}
        ${showForm ? html`<input type="hidden" name="__csrf" value="${args.csrf}">
        <input type="hidden" name="return" value="${args.returnTo}">
        <div class="r-form">
          <div class="r-field r-col-12"><label class="r-label" for="username">Nama pengguna</label>
            <input class="r-input" id="username" name="username" autocomplete="username" required value="${args.username}"${attrIf('autofocus', !args.username && !args.sso)}></div>
          <div class="r-field r-col-12"><label class="r-label" for="password">Kata sandi</label>
            <input class="r-input" id="password" name="password" type="password" autocomplete="current-password" required${attrIf('autofocus', !!args.username)}></div>
        </div>` : ''}
      </div>
      ${showForm ? html`<div class="r-region__footer"><button type="submit" class="r-btn${args.sso ? '' : ' r-btn--primary'}">Masuk</button></div>` : ''}
    </form>
  </div>
</main>`;
   return document(`Masuk · ${args.appName}`, body);
}

export function errorPage(status: number, title: string, message: string, backHref: string | null): SafeHtml {
   const body = html`<main class="r-login" id="main">
  <div class="r-login__card">
    <div class="r-region">
      <div class="r-region__body">
        <div class="r-empty">${icon(status === 403 ? 'triangle-alert' : 'circle-x')}
          <h1 class="r-empty__title">${title}</h1>
          <p class="r-error-page__msg">${message}</p>
          ${backHref ? html`<a class="r-btn r-btn--sm" href="${backHref}">Kembali</a>` : ''}
        </div>
      </div>
    </div>
    <p class="r-help r-error-page__code">Kode: ${status}</p>
  </div>
</main>`;
   return document(title, body);
}
