/*
 * Provider Detail Quick Copy
 * ---------------------------------------------------------------------------
 * Adds a small "Copy" button next to the provider's Name, ID, Email and Mobile.
 *
 * SAFETY: This script is scoped in two ways so it NEVER runs outside the
 * provider DETAIL page:
 *   1) manifest.json -> content_scripts.matches  (browser-level scope)
 *   2) CONFIG.urlMatch below                      (extra in-page guard)
 * If you tighten CONFIG.urlMatch, the script bails out on any other URL.
 */
(function () {
  'use strict';

  // -- CONFIGURE ME -----------------------------------------------------------
  // Optional extra URL guard. Set to a substring or RegExp that uniquely
  // identifies the provider DETAIL page. If it does NOT match, the script
  // stops immediately. Leave null to rely on manifest "matches" only.
  //   RegExp example:  /\/provider-details\//
  //   String example:  "https://portal.company.com/provider/"
  const CONFIG = {
    urlMatch: /\/provider\/view\//,
    debug: false, // set true only to show the on-page diagnostic report
    copyKey: 'pdc_copy',     // chrome.storage switch for the copy buttons
    rowKey: 'pdc_rowclick',  // forwarded to the MAIN-world list hook
  };
  // ---------------------------------------------------------------------------

  // -- Live on/off state (no refresh needed) ---------------------------------
  // The toolbar popup writes these keys to chrome.storage.local; we listen
  // for changes and apply them instantly. The row-click switch is forwarded
  // to the MAIN-world list hook through a storage event it can read.
  let copyOn = true;
  let copyClean = false;   // true once we've stripped buttons after an OFF
  let lastRowState = true; // last row-click state mirrored to chrome.storage
  try {
    if (chrome && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(
        { [CONFIG.copyKey]: true, [CONFIG.rowKey]: true },
        (res) => {
          copyOn = res[CONFIG.copyKey] !== false;
          forwardRowState(res[CONFIG.rowKey] !== false);
          copyClean = false;
          process();
        }
      );
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (changes[CONFIG.copyKey]) {
          copyOn = changes[CONFIG.copyKey].newValue !== false;
          copyClean = false;
          const dbg = document.getElementById('pdc-debug');
          if (dbg && !copyOn) dbg.remove();
          ticks = 0; stagnant = 0;
          process();
          if (copyOn && !retryTimer) step();
        }
        if (changes[CONFIG.rowKey]) {
          forwardRowState(changes[CONFIG.rowKey].newValue !== false);
        }
      });
    }
  } catch (_) {}

  // MAIN-world scripts can't touch chrome.storage, so push the row-click
  // state through localStorage, which list-hook.js re-reads on an interval.
  function forwardRowState(on) {
    lastRowState = on !== false;
    try { localStorage.setItem(CONFIG.rowKey, lastRowState ? '1' : '0'); } catch (_) {}
  }
  // Reverse bridge: the floating on-page switch lives in the MAIN world and
  // can only write localStorage, so mirror any change into chrome.storage and
  // the toolbar popup stays in sync. Identical writes fire no events, so this
  // cannot loop.
  setInterval(() => {
    let want;
    try {
      want = localStorage.getItem(CONFIG.rowKey) !== '0';
    } catch (_) { return; }
    if (want === lastRowState) return;
    lastRowState = want;
    try {
      if (chrome && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ [CONFIG.rowKey]: want });
      }
    } catch (_) {}
  }, 1000);

  // (1) URL guard helper -- true only on the provider detail page.
  // NOTE: we do NOT return early here. In an SPA the script loads on every
  // app page; the URL watcher below re-checks this on every navigation so we
  // activate when the user enters the provider page (no refresh needed).
  function onProviderPage() {
    const href = window.location.href;
    return CONFIG.urlMatch instanceof RegExp
      ? CONFIG.urlMatch.test(href)
      : href.includes(CONFIG.urlMatch);
  }

  // (2) Field definitions -- how each label is recognised (case-insensitive).
  const FIELD_DEFS = [
    { key: 'name',   label: /^(provider\s*name|provider|full\s*name|contact\s*name|business\s*name|name)$/i },
    { key: 'id',     label: /^(provider\s*id|provider\s*code|provider\s*no\.?|provider\s*number|id|code)$/i },
    { key: 'email',  label: /^(e-?mail(\s*address)?)$/i },
    { key: 'mobile', label: /^(mobile|mobile\s*(no|number|#)?|phone|phone\s*(no|number|#)?|contact\s*(no|number|#)?|cell|cell\s*(no|number|#)?)$/i },
  ];

  // -- Helpers ---------------------------------------------------------------
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

  // Collect matching elements across shadow roots (Angular/Web Components).
  function qsa(selector, root) {
    root = root || document;
    const out = [];
    root.querySelectorAll(selector).forEach((el) => out.push(el));
    root.querySelectorAll('*').forEach((el) => {
      if (el.shadowRoot) qsa(selector, el.shadowRoot).forEach((e) => out.push(e));
    });
    return out;
  }
  // First matching element across shadow roots (or null).
  function qs(selector, root) {
    return qsa(selector, root)[0] || null;
  }


  function elementValue(el) {
    if (!el) return '';
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return clean(el.value);
    // Clone and drop any copy buttons we previously injected so their text
    // never leaks into the copied value on re-renders.
    const clone = el.cloneNode(true);
    clone.querySelectorAll('.pdc-copy-btn').forEach((b) => b.remove());
    return clean(clone.textContent);
  }

  // label[for="id"] -> the input/span it points to
  function valueFromFor(labelEl) {
    const forId = labelEl.getAttribute && labelEl.getAttribute('for');
    if (!forId) return '';
    return elementValue(document.getElementById(forId));
  }

  // value right after the label (or as a sibling inside the container)
  function valueFromSibling(labelEl) {
    const next = labelEl.nextElementSibling;
    if (next) {
      const v = elementValue(next);
      if (v) return v;
    }
    const parent = labelEl.parentElement;
    if (parent) {
      for (const child of parent.children) {
        if (child === labelEl) continue;
        const v = elementValue(child);
        if (v) return v;
      }
    }
    return '';
  }

  // value elsewhere in the same row / list-item / grid cell
  function valueFromRow(labelEl) {
    const row = labelEl.closest(
      'tr, li, .row, [class*="row"], [class*="item"], [class*="detail"], dl, form'
    );
    if (!row) return '';
    const candidates = Array.from(
      row.querySelectorAll('td, th, dd, span, div, p, input, textarea')
    ).filter(
      (c) => c !== labelEl && !labelEl.contains(c) && !c.contains(labelEl)
    );
    let best = '';
    for (const c of candidates) {
      const v = elementValue(c);
      if (v && v.length > best.length) best = v;
    }
    return best;
  }

  function resolveValue(labelEl, inlineValue) {
    return (
      inlineValue ||
      valueFromFor(labelEl) ||
      valueFromSibling(labelEl) ||
      valueFromRow(labelEl) ||
      ''
    );
  }

  // Returns the specific element that actually holds the value text, so we can
  // drop the Copy button right NEXT TO the value instead of on a new line.
  function valueElement(labelEl, inlineValue) {
    if (inlineValue) return labelEl; // "Name: John Smith" all in one element
    const forId = labelEl.getAttribute && labelEl.getAttribute('for');
    if (forId) {
      const t = document.getElementById(forId);
      if (t && elementValue(t)) return t;
    }
    const next = labelEl.nextElementSibling;
    if (next && elementValue(next)) return next;
    const parent = labelEl.parentElement;
    if (parent) {
      for (const child of parent.children) {
        if (child === labelEl) continue;
        if (elementValue(child)) return child;
      }
    }
    const row = labelEl.closest(
      'tr, li, .row, [class*="row"], [class*="item"], [class*="detail"], dl, form'
    );
    if (row) {
      let best = null, bestLen = 0;
      for (const c of row.querySelectorAll(
        'td, th, dd, span, div, p, input, textarea'
      )) {
        if (c === labelEl || labelEl.contains(c) || c.contains(labelEl)) continue;
        const v = elementValue(c);
        if (v && v.length > bestLen) { best = c; bestLen = v.length; }
      }
      if (best) return best;
    }
    return labelEl;
  }


  // -- Find every element whose text matches a field label -------------------
  function findLabelEls() {
    const out = [];
    const nodes = qsa(
      'label, th, dt, td, span, div, p, li, strong, b, h1, h2, h3, h4, h5, h6'
    );
    const SEMANTIC = ['LABEL', 'DT', 'TH'];
    for (const el of nodes) {
      // 1) Direct own text first (avoids matching big wrapper containers)
      let labelText = clean(
        Array.from(el.childNodes)
          .filter((n) => n.nodeType === Node.TEXT_NODE)
          .map((n) => n.textContent)
          .join(' ')
      ).replace(/[:*#]+\s*$/, '');

      // 2) Semantic labels often wrap their text in a child span -> full text
      let inlineValue = '';
      if (!labelText && SEMANTIC.includes(el.tagName)) {
        labelText = clean(el.textContent).replace(/[:*#]+\s*$/, '');
      }

      // 3) "Label: value" living in the SAME element (very common on view pages)
      const split = labelText.match(/^([^:]{1,40}):\s*(.+)$/);
      if (split) {
        labelText = clean(split[1]);
        inlineValue = clean(split[2]);
      }
      if (!labelText) continue;

      for (const def of FIELD_DEFS) {
        if (def.label.test(labelText)) {
          out.push({ el, def, inlineValue });
          break;
        }
      }
    }
    return out;
  }

  // -- Copy to clipboard (with fallback) -------------------------------------
  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try { document.execCommand('copy'); } catch (__) {}
      ta.remove();
    }
  }

  // -- Build the copy button -------------------------------------------------
  const PRETTY = { name: 'Name', id: 'ID', email: 'Email', mobile: 'Mobile' };
  // Inline styles so the button looks right even inside a Shadow DOM,
  // where the global styles.css cannot reach.
  function styleBtn(btn, done) {
    const s = btn.style;
    s.display = 'inline-flex';
    s.alignItems = 'center';
    s.gap = '6px';
    s.margin = '0 8px';
    s.padding = '5px 14px';
    s.fontSize = '14px';
    s.fontWeight = '700';
    s.fontFamily = 'inherit';
    s.lineHeight = '1.4';
    s.color = '#ffffff';
    s.background = done ? '#188038' : '#1a73e8';
    s.border = 'none';
    s.borderRadius = '6px';
    s.cursor = 'pointer';
    s.verticalAlign = 'middle';
    s.userSelect = 'none';
    s.boxShadow = '0 1px 4px rgba(0,0,0,0.35)';
    s.textDecoration = 'none';
  }
  // -- Fallback: provider name shown as a page heading/title (no "Name" label)
  function findHeadingName() {
    const headings = qsa('h1, h2, h3, .page-title, .panel-title, .card-title, [class*="title"]');
    for (const h of headings) {
      const t = clean(h.textContent);
      // Heuristic: a plausible provider name is short-ish and not a generic word.
      if (t && t.length >= 2 && t.length <= 60 && !/^(provider|details?|view|profile|info|dashboard|home)$/i.test(t)) {
        // Skip if it already looks like a full "Label: value" pair.
        if (!/^(name|id|email|mobile|phone)\s*:/i.test(t)) return { el: h, value: t };
      }
    }
    return null;
  }

  // -- Provider name on this app sits in a dedicated element with NO "Name"
  //    label: <p class="PrleNme">jelsin A J</p>. Try that first, then headings.
  function findNameElement() {
    const el = qs('.PrleNme');
    if (el) {
      const value = elementValue(el);
      if (value) return { el, value };
    }
    return findHeadingName();
  }

  // -- On-page debug panel: dumps the page structure so we can target it -----
  function showDebug(found, missed) {
    const lines = [];
    const push = (s) => lines.push(s);

    push('FOUND: ' + (found.join(', ') || 'none'));
    push('MISSING: ' + (missed.join(', ') || 'none'));
    push('URL: ' + location.href);

    // (A) iframes? if the details live in one, we cannot see them from here.
    const frames = document.querySelectorAll('iframe');
    push('IFRAMES: ' + frames.length);
    frames.forEach((f, i) => push('  iframe[' + i + '] src=' + (f.getAttribute('src') || '(none)')));
    const shadowCount = qsa('*').filter((e) => e.shadowRoot).length;
    push('SHADOW ROOTS: ' + shadowCount + ' (now scanned automatically)');

    // (B) Detect email / phone by VALUE, ignoring labels entirely.
    const emailRx = /[^\s@]+@[^\s@]+\.[^\s@]+/;
    const phoneRx = /(\+?\d[\d\s().-]{7,}\d)/;
    const desc = (el) => {
      const cls = (el.className && typeof el.className === 'string') ? '.' + el.className.trim().split(/\s+/).join('.') : '';
      return '<' + el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + cls + '>';
    };
    const findVal = (rx) => {
      const hits = [];
      qsa('td,th,dd,dt,span,div,p,a,h1,h2,h3,h4,li,strong,b,label').forEach((el) => {
        if (el.children.length > 3) return; // keep it to leaf-ish nodes
        const t = clean(el.textContent);
        if (rx.test(t)) hits.push(desc(el) + ' => "' + t.slice(0, 50) + '"');
      });
      return hits.slice(0, 5);
    };
    push('EMAIL-ish nodes:');
    findVal(emailRx).forEach((h) => push('  ' + h));
    push('PHONE-ish nodes:');
    findVal(phoneRx).forEach((h) => push('  ' + h));

    // (C) profile images + their neighbours (where the name usually sits)
    push('IMAGES:');
    qsa('img').forEach((im, i) => {
      if (i >= 6) return;
      const par = im.parentElement;
      push('  img src=' + (im.getAttribute('src') || '').slice(0, 60) + ' parent=' + desc(par) +
        ' parentText="' + clean(par.textContent).slice(0, 60) + '"');
    });

    // (D) first few headings
    push('HEADINGS:');
    qsa('h1,h2,h3,h4').forEach((h, i) => {
      if (i >= 8) return;
      push('  ' + desc(h) + ' => "' + clean(h.textContent).slice(0, 60) + '"');
    });

    // Live-update an existing debug box instead of stacking new ones every scan.
    const existing = document.getElementById('pdc-debug-text');
    if (existing) {
      existing.textContent = lines.join('\n');
      return;
    }

    const box = document.createElement('div');
    box.id = 'pdc-debug';
    box.style.cssText = [
      'position:fixed', 'right:12px', 'bottom:12px', 'z-index:2147483647',
      'width:420px', 'max-height:70vh', 'overflow:auto', 'background:#1f1f1f', 'color:#e0e0e0',
      'font:11px/1.5 ui-monospace,Consolas,monospace', 'padding:12px 14px',
      'border-radius:8px', 'box-shadow:0 4px 18px rgba(0,0,0,.5)', 'white-space:pre-wrap',
    ].join(';');
    const pre = document.createElement('div');
    pre.id = 'pdc-debug-text';
    pre.textContent = lines.join('\n');
    box.appendChild(pre);

    const copyBtn = document.createElement('button');
    copyBtn.textContent = '📋 Copy this report';
    copyBtn.style.cssText = 'margin-top:8px;margin-right:6px;padding:4px 10px;border:none;border-radius:4px;background:#1a73e8;color:#fff;cursor:pointer';
    copyBtn.onclick = async () => {
      await copyToClipboard(pre.textContent);
      copyBtn.textContent = '✓ Copied — paste it to me';
    };
    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.style.cssText = 'margin-top:8px;padding:4px 10px;border:none;border-radius:4px;background:#444;color:#fff;cursor:pointer';
    closeBtn.onclick = () => box.remove();
    box.appendChild(copyBtn);
    box.appendChild(closeBtn);
    document.body.appendChild(box);
  }

  // -- Inject buttons --------------------------------------------------------
  function process() {
    // SAFETY: never add buttons outside the provider detail page, even though
    // the script is injected on the whole app (required for SPA navigation).
    if (!onProviderPage()) return;
    // Live OFF switch from the toolbar popup: strip our buttons, add nothing.
    // `copyClean` keeps this cheap — after the first sweep there is nothing
    // left to remove, so later scans return immediately.
    if (!copyOn) {
      if (!copyClean) {
        qsa('.pdc-copy-btn').forEach((b) => b.remove());
        copyClean = true;
      }
      return;
    }
    copyClean = false;
    // Single "Copy All" button only: collect the field values live and place
    // one button next to them. No per-field buttons are created.
    const fieldValues = collectFieldValues();
    // Remove any legacy single-field buttons from older versions.
    qsa('.pdc-copy-btn:not([data-pdc-key="all"])').forEach((b) => b.remove());
    qsa('[data-pdc-done]').forEach((el) => { delete el.dataset.pdcDone; });
    ensureCopyAll(fieldValues);

    // Debug report so we can see what matched without guessing.
    if (CONFIG.debug) {
      const items = collectFieldValues();
      const found = items.map((it) => PRETTY[it.key] || it.key);
      const missed = FIELD_DEFS.filter((d) => !found.includes(PRETTY[d.key])).map(
        (d) => PRETTY[d.key]
      );
      showDebug(found, missed);
    }
  }

  // -- Robust injection ------------------------------------------------------
  // app.allocabs.com loads the provider details dynamically (after first
  // paint), so a single scan is unreliable — that is exactly why the buttons
  // only appeared after refreshing the page several times. We now re-scan
  // aggressively: immediately, on every DOM change, and on a retry loop that
  // keeps going while any field is still missing (late AJAX content).

  function allFound() {
    return !!qs('.pdc-copy-btn[data-pdc-key="all"]');
  }
  function countFound() {
    return qs('.pdc-copy-btn[data-pdc-key="all"]') ? 1 : 0;
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // -- Copy All: one clipboard write PER FIELD --------------------------------
  // Windows clipboard history (Win+V) creates one card per write. Writing the
  // four values sequentially with a short pause between each therefore shows
  // up as four separate cards (like images), NOT one combined block of text.
  // The loop runs inside the button's click handler so the user activation
  // stays valid; total time is well under a second.
  //
  // Values are resolved LIVE from the page (labels + name element), so no
  // per-field buttons need to exist for Copy All to work.
  function collectFieldValues() {
    const out = [];
    const seen = new Set();
    // 1) Labelled fields (ID / Email / Mobile, and Name when it has a label).
    for (const { el, def, inlineValue } of findLabelEls()) {
      if (seen.has(def.key)) continue;
      const v = clean(resolveValue(el, inlineValue));
      if (v) {
        out.push({ key: def.key, label: PRETTY[def.key] || def.key, value: v, anchorEl: el });
        seen.add(def.key);
      }
    }
    // 2) Name fallback: dedicated element / heading with no "Name" label.
    if (!seen.has('name')) {
      const head = findNameElement();
      if (head && head.value) {
        out.unshift({ key: 'name', label: 'Name', value: clean(head.value), anchorEl: head.el });
        seen.add('name');
      }
    }
    // Keep a stable order: Name, ID, Email, Mobile, then anything extra.
    const order = { name: 0, id: 1, email: 2, mobile: 3 };
    out.sort((a, b) => (order[a.key] ?? 9) - (order[b.key] ?? 9));
    return out;
  }

  function makeCopyAllButton() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pdc-copy-btn pdc-copy-all';
    btn.dataset.pdcKey = 'all';
    btn.title = 'Copy each field separately (one Win+V card per field)';
    btn.textContent = '📋 Copy All';
    styleBtn(btn, false);
    // Make it stand out slightly from the single-field buttons.
    btn.style.background = '#0b57d0';
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Re-read live so late-loading fields are included at click time.
      const live = collectFieldValues();
      if (!live.length) return;
      const original = '📋 Copy All';
      try {
        for (let i = 0; i < live.length; i++) {
          btn.textContent = 'Copying ' + (i + 1) + '/' + live.length + '…';
          await copyToClipboard(live[i].value);
          // Pause so the OS registers each write as its own history entry.
          if (i < live.length - 1) await sleep(250);
        }
        btn.classList.add('pdc-done');
        btn.textContent = 'Copied ' + live.length + ' ✓';
        styleBtn(btn, true);
      } catch (_) {
        btn.textContent = 'Copy failed';
      }
      setTimeout(() => {
        btn.textContent = original;
        btn.classList.remove('pdc-done');
        styleBtn(btn, false);
        btn.style.background = '#0b57d0';
      }, 1600);
    });
    return btn;
  }

  function ensureCopyAll(fieldValues) {
    const items = fieldValues && fieldValues.length ? fieldValues : collectFieldValues();
    if (!items.length) return;
    if (qs('.pdc-copy-btn[data-pdc-key="all"]')) return;
    // Anchor next to the provider name (first item) so the single button
    // sits inline beside the name instead of under the fields. The name has
    // no label on this page, so Copy All must NOT wait for per-field buttons.
    const nameItem = items.find((it) => it.key === 'name') || items[0];
    const anchor = nameItem && nameItem.anchorEl ? nameItem.anchorEl : null;
    if (!anchor || !anchor.isConnected) return;
    anchor.insertAdjacentElement('afterend', makeCopyAllButton());
  }

  let retryTimer = null;
  let ticks = 0;
  let lastCount = -1;
  let stagnant = 0;
  const MAX_TICKS = 200;      // ~30s ceiling at 150ms
  const STAGNANT_LIMIT = 20;  // stop after ~3s with no new buttons

  function step() {
    retryTimer = null;
    process();

    const c = countFound();
    if (c === lastCount) stagnant++; else stagnant = 0;
    lastCount = c;

    if (allFound() || stagnant > STAGNANT_LIMIT || ticks >= MAX_TICKS) return;
    ticks++;
    retryTimer = setTimeout(step, 150);
  }

  // 1) First pass right away, then start the retry loop.
  process();
  step();

  // 2) Re-run on DOM changes (debounced) — catches re-renders & late content.
  let moTimer;
  const observer = new MutationObserver(() => {
    clearTimeout(moTimer);
    moTimer = setTimeout(() => {
      process();
      // wake the retry loop if it already stopped but content is still missing
      if (!allFound() && !retryTimer && ticks < MAX_TICKS) step();
    }, 120);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // 3) SPA navigation safety: if the URL changes, re-arm and stay scoped.
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    const stillOk =
      !CONFIG.urlMatch ||
      (CONFIG.urlMatch instanceof RegExp
        ? CONFIG.urlMatch.test(lastUrl)
        : lastUrl.includes(CONFIG.urlMatch));
    if (!stillOk) {
      // Left the provider detail page -> remove everything we added.
      qsa('.pdc-copy-btn').forEach((b) => b.remove());
      const dbg = document.getElementById('pdc-debug');
      if (dbg) dbg.remove();
      return;
    }
    // New provider detail -> rescan from scratch.
    ticks = 0; stagnant = 0; lastCount = -1;
    process();
    step();
  }, 400);
})();
