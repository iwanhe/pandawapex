// pandawapex client runtime: confirm buttons, double-submit guard, mobile nav toggle, modal pages,
// interactive reports, cascading lists and popup LOV.
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
      // a dialog of its own (popup LOV) handles its Escape
      if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('dialog[open]')) post({ type: 'cancel' });
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

  // ---------------------------------------------------------------------------
  // Items. Cascading lists: when a parent item changes, the server re-renders the child field
  // (GET .../field/:item with the parents' current values) and the child's value is cleared.
  // Popup LOV: a search dialog over GET .../lov/:item?q=&p=; it stores the return value and shows the display value.
  // ---------------------------------------------------------------------------
  // the session ended: reload, and the server sends the user to the login page (and back here afterwards)
  const sessionEnded = (res) => { if (res.status === 401) { window.location.reload(); return true; } return false; };
  const parentParams = (scope, names, url) => {
    const form = scope.closest('form');
    const fd = form ? new FormData(form) : null;
    for (const n of names) {
      const vals = fd ? fd.getAll(n).map(String) : [];
      if (vals.length) url.searchParams.set(n, vals.join(':'));
      else url.searchParams.delete(n);
    }
  };
  const labelText = (el) => {
    const l = el && el.querySelector('.r-label');
    return l ? l.textContent.replace('*', '').trim() : '';
  };
  const cascadeFrom = (name, scope) => {
    const root = scope.closest('form') || document;
    root.querySelectorAll('[data-cascade]').forEach((f) => {
      if (f.getAttribute('data-cascade').split(' ').includes(name)) refreshField(f);
    });
  };
  const refreshField = async (field) => {
    const url = new URL(field.getAttribute('data-cascade-url'), window.location.href);
    parentParams(field, field.getAttribute('data-cascade').split(' '), url);
    field.setAttribute('aria-busy', 'true');
    try {
      const res = await fetch(url, { credentials: 'same-origin' });
      if (sessionEnded(res)) return;
      if (!res.ok) throw new Error('cascade');
      const fresh = new DOMParser().parseFromString(await res.text(), 'text/html').body.firstElementChild;
      if (!fresh || !document.contains(field)) throw new Error('cascade');
      field.replaceWith(fresh);
      announce('Pilihan ' + labelText(fresh) + ' diperbarui.');
      cascadeFrom(fresh.getAttribute('data-item'), fresh);   // its value is now empty: its own children follow
    } catch {
      field.removeAttribute('aria-busy');
      announce('Pilihan ' + labelText(field) + ' gagal dimuat ulang.');
    }
  };
  document.addEventListener('change', (e) => {
    if (e.target.name) cascadeFrom(e.target.name, e.target);
  });

  const X_SVG = '<svg class="r-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  let lov = null;
  const setActive = (opts, i) => {
    opts.forEach((o, n) => o.setAttribute('aria-selected', String(n === i)));
    lov.q.setAttribute('aria-activedescendant', opts[i].id);
    opts[i].scrollIntoView({ block: 'nearest' });
  };
  const lovPick = (opt) => {
    const g = lov.group;
    const hidden = g.querySelector('input[type="hidden"]');
    hidden.value = opt.getAttribute('data-return');
    g.querySelector('[data-lov-display]').value = opt.getAttribute('data-display');
    const clear = g.querySelector('[data-lov-clear]');
    if (clear) clear.hidden = false;
    lov.dlg.close();
    hidden.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const lovFetch = async (page) => {
    const seq = ++lov.seq;
    const url = new URL(lov.group.getAttribute('data-popup-lov'), window.location.href);
    url.searchParams.set('q', lov.q.value.trim());
    url.searchParams.set('p', String(page));
    const parents = lov.group.getAttribute('data-lov-parents');
    if (parents) parentParams(lov.group, parents.split(' '), url);
    lov.results.setAttribute('aria-busy', 'true');
    try {
      const res = await fetch(url, { credentials: 'same-origin' });
      const text = await res.text();
      if (seq !== lov.seq) return;                     // a newer search is under way
      if (sessionEnded(res)) return;
      if (!res.ok) throw new Error('lov');
      const doc = new DOMParser().parseFromString(text, 'text/html');
      const list = lov.results.querySelector('[role="listbox"]');
      const freshList = doc.querySelector('[role="listbox"]');
      if (page > 1 && list && freshList) {
        list.append(...freshList.children);
        lov.results.querySelectorAll('[data-lov-page], [data-lov-status]').forEach((n) => n.remove());
        doc.querySelectorAll('[data-lov-page], [data-lov-status]').forEach((n) => lov.results.append(n));
      } else {
        lov.results.replaceChildren(...doc.body.childNodes);
        lov.q.removeAttribute('aria-activedescendant');
      }
      const st = lov.results.querySelector('[data-lov-status]');
      if (st) announce(st.textContent);
    } catch {
      if (seq === lov.seq) lov.results.textContent = 'Daftar pilihan gagal dimuat. Coba lagi.';
    } finally {
      if (seq === lov.seq) lov.results.removeAttribute('aria-busy');
    }
  };
  const lovDialog = () => {
    if (lov) return lov;
    const dlg = document.createElement('dialog');
    dlg.className = 'r-dialog r-dialog--sm r-lov-dialog';
    dlg.setAttribute('aria-labelledby', 'r-lov-title');
    dlg.innerHTML = '<div class="r-dialog__header"><h2 class="r-dialog__title" id="r-lov-title"></h2>'
      + '<button type="button" class="r-btn r-btn--ghost r-btn--icon" aria-label="Tutup" data-lov-x>' + X_SVG + '</button></div>'
      + '<div class="r-dialog__body"><label class="r-label" for="r-lov-q">Cari</label>'
      + '<input type="search" class="r-input" id="r-lov-q" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="r-lov-list">'
      + '<div data-lov-results></div></div>';
    document.body.appendChild(dlg);
    lov = { dlg, q: dlg.querySelector('#r-lov-q'), results: dlg.querySelector('[data-lov-results]'), group: null, timer: 0, seq: 0 };
    dlg.querySelector('[data-lov-x]').addEventListener('click', () => dlg.close());
    dlg.addEventListener('close', () => {
      clearTimeout(lov.timer);
      if (lov.group && document.contains(lov.group)) lov.group.querySelector('[data-lov-display]').focus();
    });
    lov.q.addEventListener('input', () => { clearTimeout(lov.timer); lov.timer = setTimeout(() => lovFetch(1), 250); });
    lov.q.addEventListener('keydown', (e) => {
      const opts = [...lov.results.querySelectorAll('[role="option"]')];
      const cur = opts.findIndex((o) => o.getAttribute('aria-selected') === 'true');
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (opts.length) setActive(opts, e.key === 'ArrowDown' ? Math.min(cur + 1, opts.length - 1) : Math.max(cur - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (cur >= 0) lovPick(opts[cur]);
        else if (opts.length === 1) lovPick(opts[0]);
      }
    });
    lov.results.addEventListener('click', (e) => {
      const o = e.target.closest('[role="option"]');
      if (o) { lovPick(o); return; }
      const more = e.target.closest('[data-lov-page]');
      if (more) lovFetch(Number(more.getAttribute('data-lov-page')));
    });
    return lov;
  };
  const lovOpen = (g) => {
    const l = lovDialog();
    l.group = g;
    l.dlg.querySelector('#r-lov-title').textContent = g.getAttribute('data-lov-title');
    l.q.value = '';
    l.results.replaceChildren();
    l.dlg.showModal();
    l.q.focus();
    lovFetch(1);
  };
  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-popup-lov]');
    if (!g) return;
    const clear = e.target.closest('[data-lov-clear]');
    if (clear) {
      const hidden = g.querySelector('input[type="hidden"]');
      hidden.value = '';
      g.querySelector('[data-lov-display]').value = '';
      clear.hidden = true;
      g.querySelector('[data-lov-display]').focus();
      hidden.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (e.target.closest('[data-lov-open], [data-lov-display]')) {
      lovOpen(g);
    }
  });
  document.addEventListener('keydown', (e) => {
    const d = e.target.closest && e.target.closest('[data-lov-display]');
    if (d && (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === ' ')) {
      e.preventDefault();
      lovOpen(d.closest('[data-popup-lov]'));
    }
  });

  // move focus to the error summary after a failed submit
  const summary = document.querySelector('[data-error-summary]');
  if (summary) summary.focus();
})();
