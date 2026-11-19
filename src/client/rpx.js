// pandawapex client runtime: confirm buttons, double-submit guard, mobile nav toggle, modal pages,
// interactive reports, cascading lists, popup LOV, dynamic actions and session keep-alive.
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
        document.dispatchEvent(new Event('rpx:refreshed'));
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
      document.dispatchEvent(new CustomEvent('rpx:field-replaced', { detail: fresh.getAttribute('data-item') }));
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

  // builder import: a chosen (or dropped) YAML file is read into the spec textarea; the form itself stays urlencoded
  const specText = (form) => form && form.querySelector('textarea[name="spec"]');
  const loadSpecFile = (form, file) => {
    if (!file) return;
    const help = form.querySelector('#spec-file-help');
    if (file.size > 900 * 1024) { if (help) help.textContent = `${file.name} terlalu besar (maksimal 900 KB).`; return; }
    const r = new FileReader();
    r.onload = () => {
      specText(form).value = String(r.result);
      if (help) help.textContent = `${file.name} dimuat (${(file.size / 1024).toFixed(1)} KB). Periksa lalu tekan Impor.`;
    };
    r.readAsText(file);
  };
  document.addEventListener('change', (e) => {
    if (e.target.matches && e.target.matches('[data-spec-file]')) loadSpecFile(e.target.closest('form'), e.target.files[0]);
  });
  for (const drop of document.querySelectorAll('[data-spec-drop]')) {
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.setAttribute('data-dragover', ''); });
    drop.addEventListener('dragleave', () => drop.removeAttribute('data-dragover'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      drop.removeAttribute('data-dragover');
      loadSpecFile(drop.closest('form'), e.dataTransfer.files[0]);
    });
  }

  // create-app wizard: the alias follows the name until it is edited by hand; another schema reloads its table list
  for (const alias of document.querySelectorAll('[data-alias-from]')) {
    const src = document.getElementById(alias.getAttribute('data-alias-from'));
    if (!src) continue;
    const slug = (v) => v.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^[^a-z]+/, '').replace(/-+$/, '').slice(0, 60);
    let manual = alias.value !== '' && alias.value !== slug(src.value);
    alias.addEventListener('input', () => { manual = alias.value !== ''; });
    src.addEventListener('input', () => { if (!manual) alias.value = slug(src.value); });
  }
  for (const sel of document.querySelectorAll('select[data-reload-tables]')) {
    sel.addEventListener('change', () => {
      const form = sel.form;
      const q = new URLSearchParams();
      for (const k of ['name', 'alias', 'schema', 'group']) if (form.elements[k] && form.elements[k].value) q.set(k, form.elements[k].value);
      location.assign(`${form.getAttribute('action')}?${q}`);
    });
  }

  // create-page wizard: show only the fields that apply to the chosen page kind and data source
  for (const form of document.querySelectorAll('form[data-page-wizard]')) {
    const sync = () => {
      const kind = (form.querySelector('input[name="kind"]:checked') || {}).value;
      const source = kind === 'report' ? (form.querySelector('input[name="source"]:checked') || {}).value : 'table';
      for (const el of form.querySelectorAll('[data-show-for]')) {
        let show = el.getAttribute('data-show-for').split(' ').includes(kind);
        const src = el.getAttribute('data-show-source');
        if (show && src) show = src === source;
        el.hidden = !show;
      }
    };
    form.addEventListener('change', (e) => { if (e.target.name === 'kind' || e.target.name === 'source') sync(); });
    sync();
  }

  // page designer, dynamic action form: show only the fields that apply to the chosen event, condition and action types
  // (without script everything is shown; the server drops what does not apply)
  for (const box of document.querySelectorAll('[data-da-form]')) {
    const has = (el, attr, v) => el.getAttribute(attr).split(' ').includes(v);
    const sync = () => {
      const ev = (box.querySelector('[data-da-event]') || {}).value;
      const cond = (box.querySelector('[data-da-cond]') || {}).value || '';
      box.querySelectorAll('[data-da-event-for]').forEach((el) => { el.hidden = !has(el, 'data-da-event-for', ev); });
      box.querySelectorAll('[data-da-cond-for]').forEach((el) => { el.hidden = !has(el, 'data-da-cond-for', cond); });
      box.querySelectorAll('[data-da-when-cond]').forEach((el) => { el.hidden = !cond; });
      box.querySelectorAll('[data-da-row]').forEach((row) => {
        const type = (row.querySelector('[data-da-type]') || {}).value;
        row.querySelectorAll('[data-da-for]').forEach((el) => { el.hidden = !has(el, 'data-da-for', type); });
      });
    };
    box.addEventListener('change', (e) => { if (e.target.matches('[data-da-event], [data-da-cond], [data-da-type]')) sync(); });
    sync();
  }

  // page designer: choosing another page in the picker opens it; the button is only for browsers without script
  for (const sel of document.querySelectorAll('select[data-autosubmit]')) {
    const fallback = sel.form && sel.form.querySelector('[data-autosubmit-fallback]');
    if (fallback) fallback.hidden = true;
    sel.addEventListener('change', () => sel.form.submit());
  }

  // Keep the session alive while the user is working in this page (typing in a long form), so that the idle timeout
  // counts from the last activity instead of the last page load. A tab that is merely open still idles out.
  const scope = location.pathname.match(/^\/builder(?=\/|$)|^\/r\/[^/]+\/[^/]+/);
  if (scope && !/\/login$/.test(location.pathname)) {
    let active = false;
    const mark = () => { active = true; };
    for (const ev of ['keydown', 'pointerdown', 'input']) document.addEventListener(ev, mark, { capture: true, passive: true });
    const timer = setInterval(() => {
      if (!active) return;
      active = false;
      fetch(`${scope[0]}/keepalive`, { credentials: 'same-origin', cache: 'no-store' })
        .then((r) => { if (r.status === 401) clearInterval(timer); })   // the session is gone: stop asking
        .catch(() => {});                                               // offline: try again next time
    }, 5 * 60 * 1000);
  }

  // ---------------------------------------------------------------------------
  // Dynamic actions. The server renders the page's definitions as JSON (<script type="application/json" id="rpx-da">);
  // here they react to change / key release / click and run their actions in order. Showing, hiding, enabling and
  // disabling are convenience only: the server's conditions, read_only and authorization still decide what is saved.
  // ---------------------------------------------------------------------------
  let das = [];
  const readDas = () => {
    const el = document.getElementById('rpx-da');
    try { das = el ? JSON.parse(el.textContent) : []; } catch { das = []; }
  };
  const esc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&'));
  const controls = (name) => [...document.getElementsByName(name)].filter((e) => /^(INPUT|SELECT|TEXTAREA)$/.test(e.tagName));
  // the value as the server would get it: radio = the chosen one, checkbox group = chosen values joined with ":"
  const daGet = (name) => {
    const els = controls(name);
    if (!els.length) {
      const shown = document.getElementById(name);
      return shown ? shown.textContent.trim() : '';
    }
    const first = els[0];
    if (first.type === 'radio') return (els.find((e) => e.checked) || { value: '' }).value;
    if (first.type === 'checkbox') {
      if (first.hasAttribute('data-off-value')) return first.checked ? first.value : first.getAttribute('data-off-value');
      return els.filter((e) => e.checked).map((e) => e.value).join(':');
    }
    return first.value;
  };
  let depth = 0;
  const changed = (el) => {
    if (depth > 8) return;                     // a chain of set_value actions that feeds itself stops here
    depth++;
    try { el.dispatchEvent(new Event('change', { bubbles: true })); } finally { depth--; }
  };
  const daSet = (name, val) => {
    const els = controls(name);
    if (!els.length) return;
    const first = els[0];
    if (first.type === 'radio') els.forEach((e) => { e.checked = e.value === val; });
    else if (first.type === 'checkbox' && first.hasAttribute('data-off-value')) first.checked = val === first.value;
    else if (first.type === 'checkbox') {
      const chosen = new Set(val ? val.split(':') : []);
      els.forEach((e) => { e.checked = chosen.has(e.value); });
    } else first.value = val;
    changed(first);
  };
  const holds = (w) => {
    if (!w) return true;
    const [kind, arg] = Object.entries(w)[0];
    const v = daGet(typeof arg === 'string' ? arg : arg.item);
    switch (kind) {
      case 'item_equals': return v === arg.value;
      case 'item_not_equals': return v !== arg.value;
      case 'item_in': return arg.values.includes(v);
      case 'item_not_in': return !arg.values.includes(v);
      case 'item_null': return v === '';
      case 'item_not_null': return v !== '';
      default: return false;
    }
  };
  const targets = (a) => [
    ...(a.items || []).map((n) => document.querySelector('[data-item="' + esc(n) + '"]')),
    ...(a.regions || []).map((id) => document.getElementById(id)),
    ...(a.buttons || []).flatMap((n) => [...document.querySelectorAll('[data-button="' + esc(n) + '"]')]),
  ].filter(Boolean);
  const setDisabled = (el, off) => {
    const ctls = el.matches('[data-button]') ? [el] : [...el.querySelectorAll('input, select, textarea, button')];
    for (const c of ctls) {
      if (c.tagName === 'A') {
        if (off) c.setAttribute('aria-disabled', 'true'); else c.removeAttribute('aria-disabled');
      } else c.disabled = off;
      if (off) c.setAttribute('data-da-disabled', ''); else c.removeAttribute('data-da-disabled');
    }
  };
  const refreshRegion = async (id) => {
    const region = document.getElementById(id);
    if (!region) return;
    region.setAttribute('aria-busy', 'true');
    try {
      const res = await fetch(window.location.href, { credentials: 'same-origin' });
      if (sessionEnded(res)) return;
      const fresh = new DOMParser().parseFromString(await res.text(), 'text/html').getElementById(id);
      if (!res.ok || !fresh || !document.contains(region)) throw new Error('refresh');
      region.replaceWith(fresh);
    } catch {
      region.removeAttribute('aria-busy');
      announce('Region gagal dimuat ulang.');
    }
  };
  // a message for a failed server call, shown at the top of the form (replaced by the next call)
  const daError = (form, text) => {
    const old = document.getElementById('rpx-da-error');
    if (old) old.remove();
    if (!text || !form) return;
    const box = document.createElement('div');
    box.id = 'rpx-da-error';
    box.className = 'r-alert r-alert--danger';
    box.setAttribute('role', 'alert');
    const body = document.createElement('div');
    body.className = 'r-alert__body';
    const title = document.createElement('p');
    title.className = 'r-alert__title';
    title.textContent = 'Aksi tidak berhasil.';
    const detail = document.createElement('p');
    detail.textContent = text;
    body.append(title, detail);
    box.append(body);
    form.prepend(box);
  };
  /**
   * Send items to submit to the server and, for execute_server_code, run the action's code there (the code
   * never leaves the server: the request only names the dynamic action and the action's position).
   * Returns false when the remaining actions must not run.
   */
  const callServer = async (da, index, a, from) => {
    const form = (from && from.closest('form[method="post"]')) || document.querySelector('form[method="post"]');
    if (!form) return false;
    const fields = new URLSearchParams();
    for (const k of ['__csrf', '__ps']) {
      const el = form.querySelector('input[type="hidden"][name="' + k + '"]');
      if (el) fields.set(k, el.value);
    }
    // protected hidden items are part of the signed form state, so they travel with every call
    form.querySelectorAll('input[type="hidden"]').forEach((el) => { if (/^P\d+_/.test(el.name)) fields.set(el.name, el.value); });
    fields.set('da', da.name);
    fields.set('a', String(index));
    for (const n of a.items_to_submit || []) fields.set(n, daGet(n));
    const url = new URL(form.getAttribute('action'), window.location.href);
    url.pathname += '/da';
    url.search = '';
    let res;
    let data = {};
    form.setAttribute('aria-busy', 'true');
    try {
      res = await fetch(url, { method: 'POST', credentials: 'same-origin', body: fields,
        headers: { Accept: 'application/json' } });
      if (sessionEnded(res)) return false;
      data = await res.json().catch(() => ({}));
    } catch {
      res = null;
    } finally {
      form.removeAttribute('aria-busy');
    }
    if (!res || !res.ok) {
      daError(form, data.error || 'Server tidak dapat dihubungi. Coba lagi.');
      return false;
    }
    daError(form, null);
    for (const [n, v] of Object.entries(data.items || {})) {
      if (controls(n).length) daSet(n, v === null ? '' : v);
      else {
        const shown = document.getElementById(n);
        if (shown && shown.classList.contains('r-display')) shown.textContent = (data.shown || {})[n] ?? (v || '');
      }
    }
    return true;
  };
  const submitPage = (request, from) => {
    const form = (from && from.closest('form[method="post"]')) || document.querySelector('form[method="post"]');
    if (!form) return;
    let req = form.querySelector('input[type="hidden"][name="REQUEST"]');
    if (!req) {
      req = document.createElement('input');
      req.type = 'hidden';
      req.name = 'REQUEST';
      form.appendChild(req);
    }
    req.value = request;
    form.requestSubmit();
  };
  /** Run the actions of the branch that applies; `only` limits which ones (page load). Stops at a declined confirm. */
  const runDa = async (da, from, only) => {
    const yes = holds(da.when);
    const list = yes ? da.actions : da.else;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      const index = yes ? i : da.actions.length + i;     // position in actions + else, as the server counts
      if (only && !only(a)) continue;
      switch (a.action) {
        case 'show': case 'hide': targets(a).forEach((el) => { el.hidden = a.action === 'hide'; }); break;
        case 'enable': case 'disable': targets(a).forEach((el) => setDisabled(el, a.action === 'disable')); break;
        case 'set_value': (a.items || []).forEach((n) => daSet(n, a.from_item !== undefined ? daGet(a.from_item) : a.value)); break;
        case 'clear': (a.items || []).forEach((n) => daSet(n, '')); break;
        case 'refresh':
          if (a.items_to_submit && !(await callServer(da, index, a, from))) return;
          await Promise.all((a.regions || []).map(refreshRegion));
          break;
        case 'execute_server_code': if (!(await callServer(da, index, a, from))) return; break;
        case 'confirm': if (!window.confirm(a.message)) return; break;
        case 'alert': window.alert(a.message); break;
        case 'focus': {
          // the chosen radio (or the first one), otherwise the field itself; nothing when it is hidden or disabled
          const els = controls((a.items || [])[0] || '').filter((e) => !e.disabled && e.type !== 'hidden' && e.offsetParent !== null);
          const target = els.find((e) => e.checked) || els[0];
          if (target) target.focus();
          break;
        }
        case 'submit_page': submitPage(a.request, from); return;
        default: break;
      }
    }
  };
  const STATE = ['show', 'hide', 'enable', 'disable'];
  // page load: page_load actions, plus the "on_load" actions of the others so the page starts in the right state
  const runLoad = (stateOnly) => {
    for (const da of das) {
      if (da.event === 'page_load' && !stateOnly) runDa(da, null, null);
      else runDa(da, null, (a) => a.on_load && (!stateOnly || STATE.includes(a.action)));
    }
  };
  const onItem = (event, e) => {
    const name = e.target && e.target.name;
    if (!name) return;
    for (const da of das) if (da.event === event && (da.items || []).includes(name)) runDa(da, e.target, null);
  };
  document.addEventListener('change', (e) => onItem('change', e));
  document.addEventListener('keyup', (e) => onItem('key_release', e));
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[data-da-disabled]');
    if (link) { e.preventDefault(); return; }
    const btn = e.target.closest('button[type="button"][data-button]');
    if (!btn) return;
    for (const da of das) if (da.event === 'click' && da.button === btn.getAttribute('data-button')) runDa(da, btn, null);
  });
  // disabled fields are not posted by the browser; post them anyway so a disabled field keeps its value
  document.addEventListener('submit', (e) => {
    if (e.defaultPrevented || (e.target.getAttribute('method') || 'get').toLowerCase() !== 'post') return;
    e.target.querySelectorAll('input[data-da-disabled], select[data-da-disabled], textarea[data-da-disabled]').forEach((c) => { c.disabled = false; });
  });
  document.addEventListener('rpx:refreshed', () => { readDas(); runLoad(false); });
  document.addEventListener('rpx:field-replaced', () => runLoad(true));
  readDas();
  runLoad(false);

  // move focus to the error summary after a failed submit
  const summary = document.querySelector('[data-error-summary]');
  if (summary) summary.focus();
})();
