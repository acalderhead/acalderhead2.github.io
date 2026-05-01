/**
 * app.js — Data loader and DOM renderer
 *
 * Fetches data/portfolio.json (and data/config.json for any runtime config
 * needs), then renders every section of the page. Also owns the gallery
 * tab state, quote rotator, and chronicle timeline accordion.
 *
 * Load order (enforced by <script> tags in index.html):
 *   1. canvas.js  — HexCanvas object
 *   2. ui.js      — UI object (theme, tags, form)
 *   3. app.js     — this file, runs last
 *
 * All render functions write directly into placeholder elements that
 * index.html leaves empty (id="*-mount").
 */

(async () => {

  /* ── Fetch data ─────────────────────────────────────────────────────── */
  let portfolio, config;
  try {
    // Load both JSON files in parallel for speed
    [portfolio, config] = await Promise.all([
      fetch('data/portfolio.json').then(r => r.json()),
      fetch('data/config.json').then(r => r.json()),
    ]);
  } catch (err) {
    console.error('[app.js] Failed to load data files:', err);
    return;
  }

  /* ── Convenience aliases ─────────────────────────────────────────────── */
  const { identity, chronicle, caseFiles, uplink, footer, meta } = portfolio;

  /* ── <title> and meta description ───────────────────────────────────── */
  document.title = meta.siteTitle;
  document.querySelector('meta[name="description"]')?.setAttribute('content', meta.description);

  /* ══════════════════════════════════════════════════════════════════════
     SECTION 01 — IDENTITY
  ══════════════════════════════════════════════════════════════════════ */

  /* ── Headline + bio ─────────────────────────────────────────────────── */
  const bioMount = document.getElementById('bio-mount');
  if (bioMount) {
    // Split bio on double-newline to create paragraphs
    const paragraphs = identity.bio
      .split('\n\n')
      .map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`)
      .join('');
    bioMount.innerHTML = paragraphs;
  }

  /* ── Stats row ──────────────────────────────────────────────────────── */
  const statsMount = document.getElementById('stats-mount');
  if (statsMount) {
    statsMount.innerHTML = identity.stats.map(s => `
      <div class="stat-field">
        <span class="stat-label">${s.label}</span>
        <span class="stat-value">${s.value}</span>
      </div>
    `).join('');
  }

  /* ── Skills block ───────────────────────────────────────────────────── */
  // Skills are grouped; each group gets a monospace category label
  // followed by its flat tag list.
  const skillsMount = document.getElementById('skills-mount');
  if (skillsMount) {
    skillsMount.innerHTML = Object.entries(identity.skills).map(([group, tags]) => `
      <div class="skill-group">
        <span class="skill-group-label">${group}</span>
        <div class="skill-group-tags">
          ${tags.map(t => `
            <span class="tag" onclick="toggleTag(this)">${t}</span>
          `).join('')}
        </div>
      </div>
    `).join('');
  }

  /* ── Coordinates badge ──────────────────────────────────────────────── */
  const coordMount = document.getElementById('coord-mount');
  if (coordMount) coordMount.textContent = identity.coordinates;

  /* ══════════════════════════════════════════════════════════════════════
     QUOTES ROTATOR
     Auto-advances every 10 s. Manual clicks reset the timer.
  ══════════════════════════════════════════════════════════════════════ */
  const QUOTES = identity.quotes;
  let selectedQuote = 0;
  let quoteTimer    = null;

  function startQuoteTimer() {
    clearInterval(quoteTimer);
    quoteTimer = setInterval(() => {
      selectedQuote = (selectedQuote + 1) % QUOTES.length;
      syncQuoteIndex();
      renderQuoteFile(true);
    }, 10000);
  }

  function syncQuoteIndex() {
    document.querySelectorAll('.q-idx-item').forEach((el, i) => {
      el.classList.toggle('active', i === selectedQuote);
    });
  }

  function renderQuoteFile(animate) {
    const q  = QUOTES[selectedQuote];
    const el = document.getElementById('quote-file');
    if (!el) return;
    const source = q.source ? `<span class="quote-source">${q.source}</span>` : '';
    const html   = `
      <p class="quote-text">${q.text}</p>
      <span class="quote-author">${q.author}</span>
      ${source}
    `;
    if (animate) {
      el.classList.add('fade-out');
      setTimeout(() => { el.innerHTML = html; el.classList.remove('fade-out'); }, 220);
    } else {
      el.innerHTML = html;
    }
  }

  function renderQuotes() {
    const indexEl = document.getElementById('quotes-index');
    if (indexEl) {
      indexEl.innerHTML = QUOTES.map((_, i) => `
        <div class="q-idx-item interactive${i === selectedQuote ? ' active' : ''}"
             onclick="selectQuote(${i})" title="Quote ${i + 1}">
          ${i + 1}
        </div>
      `).join('');
    }
    renderQuoteFile(false);
  }

  // Exposed on window so inline onclick= attributes can reach it
  window.selectQuote = function(idx) {
    if (idx === selectedQuote) return;
    selectedQuote = idx;
    syncQuoteIndex();
    renderQuoteFile(true);
    startQuoteTimer();
  };

  renderQuotes();
  startQuoteTimer();

  /* ══════════════════════════════════════════════════════════════════════
     SECTION 02 — CHRONICLE LOG
     Each entry renders as an accordion .record element.
     isCurrent → adds .current class (filled dot) and .active (open).
  ══════════════════════════════════════════════════════════════════════ */

  /**
   * Format a YYYY-MM date string for display.
   * Returns just the year portion (e.g. "2025-01" → "2025").
   */
  function fmtDate(str) {
    if (!str) return 'PRES';
    return str.split('-')[0];
  }

  const chronMount = document.getElementById('chronicle-mount');
  if (chronMount) {
    chronMount.innerHTML = chronicle.entries.map(entry => {
      const dateStr  = `${fmtDate(entry.dateStart)}–${fmtDate(entry.dateEnd)}`;
      const isCur    = entry.isCurrent;
      const bullets  = entry.highlights.map(h => `<li>${h}</li>`).join('');
      const tags     = entry.tags.map(t =>
        `<span class="tag" onclick="toggleTag(this)">${t}</span>`
      ).join('');

      return `
        <div class="record${isCur ? ' current active' : ''} interactive"
             onclick="this.classList.toggle('active')">
          <div class="record-header">
            <span>${entry.role}</span>
            <span class="record-date">${dateStr}</span>
          </div>
          <div class="record-body">
            <div class="record-body-inner">
              <ul class="record-highlights">${bullets}</ul>
              <div class="record-tags">${tags}</div>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  /* ══════════════════════════════════════════════════════════════════════
     SECTION 03 — CASE FILES (gallery)
     Three tabs: major | minor | hypotheses
     Left index panel + right file detail panel.
     Tab state is owned here; tab buttons call switchGalleryMode().
  ══════════════════════════════════════════════════════════════════════ */
  let galleryMode = 'major';
  let selectedIdx = 0;

  function getActiveItems() {
    return caseFiles[galleryMode] || [];
  }

  // Status badge — colour-coded pill
  function statusBadge(status) {
    if (!status) return '';
    const map = {
      live:     'badge-live',
      archived: 'badge-archived',
      wip:      'badge-wip',
    };
    return `<span class="status-badge ${map[status] || ''}">${status.toUpperCase()}</span>`;
  }

  function renderIndex() {
    const el    = document.getElementById('gallery-index');
    const items = getActiveItems();
    if (!el) return;
    el.innerHTML = items.map((item, i) => `
      <div class="gallery-idx-item interactive${i === selectedIdx ? ' active' : ''}"
           onclick="selectFile(${i})">
        <span class="idx-num">0${i + 1}</span>
        <span class="idx-title">${item.title}</span>
      </div>
    `).join('');
  }

  function renderFile(doAnim) {
    const el      = document.getElementById('gallery-file');
    const items   = getActiveItems();
    const item    = items[selectedIdx];
    if (!el || !item) return;

    // Minor tab hides the description (index-browse only mode)
    const showDesc = galleryMode !== 'minor';

    const html = `
      <span class="file-id">${item.id}</span>
      ${statusBadge(item.status)}
      <h3 class="file-title">${item.title}</h3>
      ${item.repoUrl
        ? `<a href="${item.repoUrl}" target="_blank" rel="noopener"
              class="file-link interactive">↗ View on GitHub</a>`
        : ''}
      <div class="file-tags">
        ${item.tags.map(t =>
          `<span class="tag${UI.isTagActive(t) ? ' active' : ''}"
                 onclick="toggleTag(this)">${t}</span>`
        ).join('')}
      </div>
      ${showDesc && item.desc
        ? `<p class="file-desc">${item.desc}</p>`
        : ''}
    `;

    if (doAnim) {
      el.classList.add('fade-out');
      setTimeout(() => { el.innerHTML = html; el.classList.remove('fade-out'); }, 230);
    } else {
      el.innerHTML = html;
    }
  }

  function renderGallery() { renderIndex(); renderFile(false); }

  // Exposed on window for inline onclick= in tab buttons
  window.switchGalleryMode = function(mode) {
    if (mode === galleryMode) return;
    galleryMode = mode;
    selectedIdx = 0;
    // Sync active tab button
    const tabs    = document.querySelectorAll('.gallery-tab');
    const modeMap = { major: 0, minor: 1, hypotheses: 2 };
    tabs.forEach((t, i) => t.classList.toggle('active', i === modeMap[mode]));
    renderGallery();
  };

  window.selectFile = function(idx) {
    if (idx === selectedIdx) return;
    selectedIdx = idx;
    renderIndex();
    renderFile(true);
  };

  renderGallery();

  /* ══════════════════════════════════════════════════════════════════════
     SECTION 04 — UPLINK (contact form)
     Labels and hints are driven by portfolio.json uplink block.
  ══════════════════════════════════════════════════════════════════════ */
  const fromLabelEl = document.getElementById('from-label');
  const fromHintEl  = document.getElementById('from-email');
  const dataLabelEl = document.getElementById('data-label');
  const dataHintEl  = document.getElementById('data-msg');
  const submitEl    = document.getElementById('submit-btn');

  if (fromLabelEl) fromLabelEl.textContent = uplink.fromLabel;
  if (fromHintEl)  fromHintEl.placeholder  = uplink.fromHint;
  if (dataLabelEl) dataLabelEl.textContent = uplink.dataLabel;
  if (dataHintEl)  dataHintEl.placeholder  = uplink.dataHint;
  if (submitEl)    submitEl.textContent    = uplink.submitLabel;

  /* ══════════════════════════════════════════════════════════════════════
     FOOTER
  ══════════════════════════════════════════════════════════════════════ */
  const footerLinksMount = document.getElementById('footer-links-mount');
  if (footerLinksMount) {
    footerLinksMount.innerHTML = footer.links.map(link => {
      const rel = link.rel ? `rel="${link.rel}"` : '';
      const id  = link.id === 'email' ? 'id="footer-email-link"' : '';
      const ext = link.rel ? 'target="_blank"' : '';
      return `
        <a href="${link.url}" ${ext} ${rel} ${id} class="footer-link interactive">
          <span>${link.icon}</span> ${link.label}
        </a>
      `;
    }).join('');
  }

  const builtWithEl = document.getElementById('footer-built');
  if (builtWithEl) builtWithEl.textContent = footer.builtWith;

  /* ══════════════════════════════════════════════════════════════════════
     BOOT — initialise canvas + UI after all data is rendered
  ══════════════════════════════════════════════════════════════════════ */
  UI.init();
  HexCanvas.init();

  // Resize handler wires canvas resize back to HexCanvas
  window.addEventListener('resize', () => HexCanvas.resize());

})();