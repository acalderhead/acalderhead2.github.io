/**
 * ui.js — UI behaviour layer
 *
 * Handles all interactions that don't involve data rendering:
 *   • Theme toggle (dark ↔ light)
 *   • Scroll-triggered section fade-in
 *   • Global tag toggle + cross-highlighting
 *   • Uplink (contact) form validation and mailto dispatch
 *
 * Exports a single object: UI
 * app.js calls UI.init() after the DOM is ready and data is loaded.
 */

const UI = (() => {

  /* ── Theme toggle ────────────────────────────────────────────────────
     The CSS handles the visual transition; JS only swaps body class
     and the active label highlight.
  ───────────────────────────────────────────────────────────────────── */
  let isLight = false;

  function toggleTheme() {
    isLight = !isLight;
    document.body.classList.toggle('light-mode', isLight);
    document.getElementById('sw-dark').classList.toggle('sw-on', !isLight);
    document.getElementById('sw-light').classList.toggle('sw-on', isLight);
  }

  /* ── Scroll fade — IntersectionObserver ─────────────────────────────
     Each .fade-section starts at opacity:0 + translateY(22px).
     Once it enters the viewport it gets class .visible, which CSS
     transitions to full opacity. We unobserve immediately so sections
     don't disappear again on scroll-up.
  ───────────────────────────────────────────────────────────────────── */
  function initScrollFade() {
    const obs = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('visible');
          obs.unobserve(e.target);
        }
      });
    }, { threshold: 0 });

    document.querySelectorAll('.fade-section').forEach(el => obs.observe(el));
  }

  /* ── Global tag system ───────────────────────────────────────────────
     activeTags — Set of currently-toggled tag label strings.
     Clicking any .tag element toggles its label in the Set and
     synchronises every other .tag with the same text across the page
     (skills block, gallery file panel, etc.).
  ───────────────────────────────────────────────────────────────────── */
  const activeTags = new Set();

  function toggleTag(el) {
    const label = el.textContent.trim();
    if (activeTags.has(label)) {
      activeTags.delete(label);
    } else {
      activeTags.add(label);
    }
    // Sync all .tag elements that share the same text
    document.querySelectorAll('.tag').forEach(t => {
      if (t.textContent.trim() === label) {
        t.classList.toggle('active', activeTags.has(label));
      }
    });
  }

  // Returns whether a given tag string is currently active
  function isTagActive(label) {
    return activeTags.has(label);
  }

  /* ── Uplink form (contact) ───────────────────────────────────────────
     Validates the email field on blur and on submit.
     On valid submit → opens a mailto: link so GitHub Pages (no server)
     can still dispatch messages.
  ───────────────────────────────────────────────────────────────────── */

  // Basic RFC-5322–style check (good enough for UX gating)
  function isValidEmail(v) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
  }

  function showEmailError(msg) {
    const err = document.getElementById('email-error');
    const line = document.getElementById('email-line');
    if (err)  err.textContent = msg;
    if (line) line.classList.toggle('has-error', !!msg);
  }

  function validateEmailField() {
    const val = (document.getElementById('from-email')?.value || '').trim();
    if (!val)                showEmailError('');
    else if (!isValidEmail(val)) showEmailError('Invalid address format.');
    else                         showEmailError('');
  }

  function handleUplink(e) {
    e.preventDefault();

    const emailEl = document.getElementById('from-email');
    const msgEl   = document.getElementById('data-msg');
    const email   = (emailEl?.value || '').trim();
    const msg     = (msgEl?.value   || '').trim();

    if (!email || !isValidEmail(email)) {
      showEmailError('A valid email address is required.');
      emailEl?.focus();
      return;
    }
    if (!msg) {
      msgEl?.focus();
      return;
    }

    // Resolve recipient from the footer email link (single source of truth)
    const footerLink = document.getElementById('footer-email-link');
    const recipient  = footerLink
      ? footerLink.href.replace('mailto:', '')
      : 'aidan.calderhead@gmail.com';

    const subject = encodeURIComponent('Portfolio Uplink');
    const body    = encodeURIComponent(`From: ${email}\n\n${msg}`);
    window.location.href = `mailto:${recipient}?subject=${subject}&body=${body}`;
  }

  /* ── Expose toggleTheme so the inline onchange= in HTML can call it ─ */
  // (Attaching to window so it's reachable from the HTML attribute)
  window.toggleTheme    = toggleTheme;
  window.toggleTag      = toggleTag;
  window.validateEmailField = validateEmailField;
  window.handleUplink   = handleUplink;

  /* ── init ────────────────────────────────────────────────────────── */
  function init() {
    initScrollFade();
  }

  return { init, toggleTag, isTagActive };

})();