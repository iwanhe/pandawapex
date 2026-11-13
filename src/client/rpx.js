// pandawapex client runtime (M1): confirm buttons, double-submit guard, mobile nav toggle.
// No inline handlers anywhere (CSP script-src 'self').
(() => {
  'use strict';
  let submitting = false;

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-confirm]');
    if (btn && !window.confirm(btn.getAttribute('data-confirm'))) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }, true);

  document.addEventListener('submit', (e) => {
    if ((e.target.getAttribute('method') || 'get').toLowerCase() !== 'post') return;   // report search/filter forms are GET
    if (submitting) { e.preventDefault(); return; }
    submitting = true;
    // keep the clicked button enabled (its name/value is the REQUEST); just mark it busy
    const btn = e.submitter;
    if (btn && btn.classList.contains('r-btn')) btn.setAttribute('aria-busy', 'true');
  });
  // bfcache: page shown again via Back must accept submits again
  window.addEventListener('pageshow', () => {
    submitting = false;
    document.querySelectorAll('.r-btn[aria-busy="true"]').forEach((b) => b.removeAttribute('aria-busy'));
  });

  const shell = document.querySelector('.r-shell');
  const toggle = document.querySelector('[data-nav-toggle]');
  if (shell && toggle) {
    const mobile = window.matchMedia('(max-width: 1023px)');
    toggle.setAttribute('aria-expanded', String(!mobile.matches));
    toggle.addEventListener('click', () => {
      const open = mobile.matches ? shell.dataset.nav !== 'open' : shell.dataset.nav === 'collapsed';
      shell.dataset.nav = mobile.matches ? (open ? 'open' : '') : (open ? '' : 'collapsed');
      toggle.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && shell.dataset.nav === 'open') {
        shell.dataset.nav = '';
        toggle.setAttribute('aria-expanded', 'false');
        toggle.focus();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Modal pages. A link with data-dialog opens its page in a <dialog> with an iframe (?dialog=1).
  // The page inside talks back with postMessage: its height, "closed" (refresh me), "cancel", "redirect top".
  // Without JS the same links simply open the page.
  // ---------------------------------------------------------------------------
  const inDialog = document.body.classList.contains('r-in-dialog') && window.parent !== window;
  const post = (msg) => window.parent.postMessage(Object.assign({ rpx: true }, msg), window.location.origin);

  if (inDialog) {
    if (document.querySelector('[data-dialog-close]')) post({ type: 'close' });
    const top = document.querySelector('[data-top-redirect]');
    if (top) post({ type: 'top', url: top.getAttribute('data-top-redirect') });
    document.addEventListener('click', (e) => {
      if (e.target.closest('[data-dialog-cancel]')) { e.preventDefault(); post({ type: 'cancel' }); }
    });
    // Escape inside the iframe does not reach the parent's <dialog>: forward it
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !e.defaultPrevented) post({ type: 'cancel' });
    });
    const report = () => post({ type: 'height', height: document.documentElement.scrollHeight });
    window.addEventListener('load', report);
    if ('ResizeObserver' in window) new ResizeObserver(report).observe(document.body);
  } else {
    let dlg = null, opener = null;
    const close = () => { if (dlg && dlg.open) dlg.close(); };
    const ensure = () => {
      if (dlg) return dlg;
      dlg = document.createElement('dialog');
      dlg.className = 'r-dialog';
      dlg.setAttribute('aria-labelledby', 'r-dlg-title');
      dlg.innerHTML = '<div class="r-dialog__header"><h2 class="r-dialog__title" id="r-dlg-title"></h2>'
        + '<button type="button" class="r-btn r-btn--ghost r-btn--icon" aria-label="Tutup dialog" data-dlg-x>'
        + '<svg class="r-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>'
        + '<iframe class="r-dialog__frame"></iframe>';
      dlg.querySelector('[data-dlg-x]').addEventListener('click', close);
      dlg.addEventListener('close', () => {
        const f = dlg.querySelector('iframe');
        f.src = 'about:blank';
        if (opener && document.contains(opener)) opener.focus();
      });
      document.body.appendChild(dlg);
      return dlg;
    };
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[data-dialog]');
      if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      opener = a;
      const d = ensure();
      d.className = 'r-dialog r-dialog--' + (a.getAttribute('data-dialog') || 'md');
      d.querySelector('#r-dlg-title').textContent = a.getAttribute('data-dialog-title') || a.textContent.trim();
      const f = d.querySelector('iframe');
      f.title = d.querySelector('#r-dlg-title').textContent;
      f.style.height = '';
      const url = new URL(a.href, window.location.href);
      url.searchParams.set('dialog', '1');
      f.src = url.href;
      d.showModal();
    });
    // refresh the main content (region refresh) without losing the shell
    const refresh = async () => {
      try {
        const res = await fetch(window.location.href, { credentials: 'same-origin' });
        const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
        const fresh = doc.querySelector('#main');
        const main = document.querySelector('#main');
        if (!res.ok || !fresh || !main) throw new Error('refresh');
        main.innerHTML = fresh.innerHTML;
        const status = main.querySelector('[role="status"]');
        (status || main.querySelector('h1')).setAttribute('tabindex', '-1');
        (status || main.querySelector('h1')).focus();
      } catch { window.location.reload(); }
    };
    window.addEventListener('message', (e) => {
      if (e.origin !== window.location.origin || !e.data || !e.data.rpx || !dlg) return;
      const f = dlg.querySelector('iframe');
      if (e.source !== f.contentWindow) return;
      if (e.data.type === 'height') f.style.height = Math.min(e.data.height + 2, window.innerHeight - 140) + 'px';
      else if (e.data.type === 'cancel') close();
      else if (e.data.type === 'close') { opener = null; close(); refresh(); }
      else if (e.data.type === 'top' && /^\/r\//.test(e.data.url)) window.location.href = e.data.url;
    });
  }

  // ---------------------------------------------------------------------------
  // Interactive reports: search, filter, sort and paging reload only the report region.
  // The server applies the command and redirects to the clean page URL; fetch follows that redirect.
  // ---------------------------------------------------------------------------
  let live = null;
  const announce = (text) => {
    if (!live) {
      live = document.createElement('p');
      live.className = 'r-sr-only';
      live.setAttribute('aria-live', 'polite');
      document.body.appendChild(live);
    }
    live.textContent = '';
    setTimeout(() => { live.textContent = text; }, 50);
  };
  const irLoad = async (url, region, key) => {
    region.setAttribute('aria-busy', 'true');
    try {
      const res = await fetch(url, { credentials: 'same-origin' });
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      const fresh = doc.getElementById(region.id);
      if (!res.ok || !fresh) throw new Error('reload');
      region.replaceWith(fresh);
      const target = (key && fresh.querySelector('[data-ir-key="' + key + '"]')) || fresh.querySelector('[data-ir-key="search"]');
      if (target) target.focus();
      const st = fresh.querySelector('[data-ir-status]');
      if (st) announce(st.textContent);
    } catch { window.location.href = url; }
  };
  document.addEventListener('submit', (e) => {
    const f = e.target;
    if (!f.matches('form[data-ir-form]')) return;
    const region = document.getElementById(f.getAttribute('data-ir-form'));
    if (!region) return;
    e.preventDefault();
    const url = new URL(f.action, window.location.href);
    url.hash = '';
    for (const [k, val] of new FormData(f)) url.searchParams.set(k, String(val));
    const details = region.querySelector('details.r-ir-filter');
    irLoad(url.href, region, f.id.endsWith('-f') ? 'chips' : 'search');
    if (details) details.open = false;
  });
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-ir-link]');
    if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
    const region = a.closest('[data-ir]');
    if (!region) return;
    e.preventDefault();
    irLoad(a.href, region, a.getAttribute('data-ir-key'));
  });

  // move focus to the error summary after a failed submit
  const summary = document.querySelector('[data-error-summary]');
  if (summary) summary.focus();
})();
