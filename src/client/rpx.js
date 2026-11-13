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

  // move focus to the error summary after a failed submit
  const summary = document.querySelector('[data-error-summary]');
  if (summary) summary.focus();
})();
