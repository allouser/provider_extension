/*
 * list-hook.js  —  "click any row -> open provider detail in a new tab"
 * ---------------------------------------------------------------------------
 * Runs in the page's MAIN world (see manifest "world": "MAIN") so it can see
 * the app's own network traffic. Chrome content scripts live in an isolated
 * world and CANNOT intercept the page's fetch / XMLHttpRequest, so this MUST
 * be a MAIN-world script.
 *
 * On the provider LIST page only it:
 *   1. Hooks fetch + XHR, reads the provider-list JSON, and learns the map
 *      provider CODE (e.g. "PRO724864") -> numeric id (e.g. "2") used by the
 *      detail route /provider/view/:id.
 *   2. Makes every table row clickable: clicking anywhere in the row (except
 *      the action "more_horiz" menu, links or buttons) opens that provider's
 *      detail page in a NEW tab.
 *
 * Fallback: if a numeric id was never seen in the network data, we still learn
 * it the first time you open that provider via the existing "View" menu item
 * (correlating the clicked row with the resulting URL).
 *
 * SCOPE: only activates on the /provider/list route (manifest still limits it
 * to app.allocabs.com).
 */
(function () {
  'use strict';

  var LIST_MATCH = /\/provider\/list/;          // the provider list route
  var VIEW_RE = /\/provider\/view\/([^/?#]+)/;  // detail route -> capture id

  // code ("PRO724864") -> numeric id ("2")
  var map = window.__PDC_PROVIDER_MAP__ || (window.__PDC_PROVIDER_MAP__ = {});

  function clean(s) { return (s || '').replace(/\s+/g, ' ').trim(); }
  function onList() { return LIST_MATCH.test(location.href); }

  // ---- (0) live on/off switch (no refresh needed) ------------------------
  // Default ON. Persisted in localStorage so it survives refreshes too, but
  // the toggle takes effect INSTANTLY: the row handler reads `enabled` at
  // click time, and the cursor/hover look is driven by an <html> class.
  var enabled = (function () {
    try { return localStorage.getItem('pdc_rowclick') !== '0'; }
    catch (_) { return true; }
  })();

  function applyEnabled() {
    try { document.documentElement.classList.toggle('pdc-rc-on', enabled); }
    catch (_) {}
    var b = document.getElementById('pdc-toggle');
    if (b && b.isConnected) {
      b.textContent = enabled ? 'Row → New Tab: ON' : 'Row → New Tab: OFF';
      b.style.background = enabled ? '#188038' : '#9aa0a6';
    }
  }

  function toggleEnabled() {
    enabled = !enabled;
    try { localStorage.setItem('pdc_rowclick', enabled ? '1' : '0'); } catch (_) {}
    applyEnabled();
  }

  // Small floating switch, shown only on the provider list page.
  var toggleEl = null;
  function ensureToggle() {
    if (!onList()) {
      if (toggleEl && toggleEl.isConnected) toggleEl.style.display = 'none';
      return;
    }
    if (!toggleEl || !toggleEl.isConnected) {
      if (toggleEl) toggleEl.remove();
      toggleEl = document.createElement('button');
      toggleEl.id = 'pdc-toggle';
      toggleEl.type = 'button';
      toggleEl.style.cssText = [
        'position:fixed', 'left:16px', 'bottom:16px', 'z-index:2147483647',
        'padding:9px 16px', 'border:none', 'border-radius:20px', 'color:#fff',
        'font:600 13px/1 Poppins,Roboto,sans-serif', 'cursor:pointer',
        'box-shadow:0 2px 10px rgba(0,0,0,.35)', 'user-select:none',
      ].join(';');
      toggleEl.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        toggleEnabled();
      });
      if (document.body) document.body.appendChild(toggleEl);
    }
    toggleEl.style.display = 'block';
    applyEnabled();
  }


  // ---- (1) learn code -> numeric id from the provider-list JSON ----------
  function harvest(node, depth) {
    if (!node || typeof node !== 'object' || depth > 8) return;
    if (Object.prototype.toString.call(node) === '[object Array]') {
      for (var i = 0; i < node.length; i++) harvest(node[i], depth + 1);
      return;
    }
    var code = null, id = null, k, v, kl;
    for (k in node) {
      v = node[k];
      if (v == null) continue;
      if (typeof v === 'string' && /^PRO\d{3,}$/i.test(v.trim())) code = v.trim();
      kl = k.toLowerCase();
      if (id === null && (kl === '_id' || kl === 'id')) {
        if (typeof v === 'number' && isFinite(v)) id = String(v);
        else if (typeof v === 'string' && /^\d+$/.test(v)) id = v;
      }
    }
    if (code && id != null) map[code] = id;
    for (k in node) harvest(node[k], depth + 1);
  }

  function hookFetch() {
    if (!window.fetch) return;
    var orig = window.fetch;
    window.fetch = function () {
      return orig.apply(this, arguments).then(function (res) {
        try {
          var ct = (res.headers && res.headers.get('content-type')) || '';
          if (ct.indexOf('json') !== -1) {
            res.clone().json().then(harvest).catch(function () {});
          }
        } catch (_) {}
        return res;
      });
    };
  }

  function hookXHR() {
    var oSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function () {
      var xhr = this;
      xhr.addEventListener('load', function () {
        try {
          if (xhr.responseType === '' || xhr.responseType === 'text') {
            var t = xhr.responseText;
            if (t && /PRO\d{3,}/i.test(t)) harvest(JSON.parse(t), 0);
          } else if (xhr.response && typeof xhr.response === 'object') {
            harvest(xhr.response, 0);
          }
        } catch (_) {}
      });
      return oSend.apply(this, arguments);
    };
  }

  hookFetch();
  hookXHR();

  // ---- (2) make rows open the detail page in a new tab -------------------
  function idColIndex() {
    var ths = document.querySelectorAll('app-provider-list thead th, .Tbleby thead th');
    for (var i = 0; i < ths.length; i++) {
      if (/^id$/i.test(clean(ths[i].textContent))) return i;
    }
    return 1; // header order: # , ID , Name , ...
  }

  var styleInjected = false;
  function injectStyle() {
    if (styleInjected) return;
    styleInjected = true;
    // The `.pdc-rc-on` class is toggled on <html> live, so turning the feature
    // off instantly removes the pointer cursor + hover highlight (no refresh).
    var css =
      'html.pdc-rc-on .Tbleby tbody tr, html.pdc-rc-on app-provider-list tbody tr{cursor:pointer}' +
      'html.pdc-rc-on .Tbleby tbody tr:hover, html.pdc-rc-on app-provider-list tbody tr:hover{background-color:rgba(20,124,252,.08)}';
    var st = document.createElement('style');
    st.id = 'pdc-list-style';
    st.textContent = css;
    document.head.appendChild(st);
  }

  function wire() {
    if (!onList()) return;
    injectStyle();
    ensureToggle();
    var idx = idColIndex();
    var rows = document.querySelectorAll('app-provider-list tbody tr, .Tbleby tbody tr');
    for (var r = 0; r < rows.length; r++) {
      (function () {
        var tr = rows[r];
        if (!tr || !tr.children) return;
        var cells = tr.children;
        if (cells.length <= idx) return;
        var code = clean(cells[idx].textContent);
        var id = map[code];
        if (!id) return;                 // wait until we know the numeric id
        // Always refresh stored id — Angular reuses <tr> nodes on pagination,
        // so a row wired on page 1 would otherwise keep its old id on page 2.
        try { tr.dataset.pdcId = id; } catch (_) {}
        if (tr.dataset && tr.dataset.pdcRow) return; // already has listener
        tr.dataset.pdcRow = '1';
        tr.addEventListener('click', function (e) {
          // Instantly respect the on/off switch (checked at click time, so no
          // refresh is needed to disable the feature).
          if (!enabled) return;
          // Don't hijack real controls: action menu, links, buttons, inputs.
          if (e.target.closest &&
              e.target.closest('a, button, mat-icon, .mat-mdc-menu-trigger, [role="menuitem"], input, textarea, select, .pdc-copy-btn, #pdc-toggle')) {
            return;
          }
          // Read id LIVE from this row (not a loop variable) — fixes classic
          // var-closure bug where every row opened the LAST row's id.
          var row = e.currentTarget || tr;
          var liveId = null;
          try { liveId = row.dataset && row.dataset.pdcId; } catch (_) {}
          if (!liveId) {
            try {
              var cIdx = idColIndex();
              var cCells = row.children;
              if (cCells && cCells.length > cIdx) {
                liveId = map[clean(cCells[cIdx].textContent)];
              }
            } catch (_) {}
          }
          if (!liveId) return;
          e.preventDefault();
          e.stopPropagation();
          window.open(location.origin + '/provider/view/' + liveId, '_blank', 'noopener');
        });
      })();
    }
  }

  // ---- fallback: learn id from the router when "View" is used -------------
  var pendingCode = null, pendingAt = 0;
  document.addEventListener('click', function (e) {
    var tr = e.target.closest && e.target.closest('.Tbleby tbody tr, app-provider-list tbody tr');
    if (!tr) return;
    var cells = tr.children;
    if (cells.length > 1) { pendingCode = clean(cells[idColIndex()].textContent); pendingAt = Date.now(); }
  }, true);

  // ---- orchestration: retry, observe, watch SPA URL -----------------------
  var moTimer = null;
  var observer = new MutationObserver(function () {
    clearTimeout(moTimer);
    moTimer = setTimeout(wire, 120);
  });
  function startObserve() {
    if (document.body) observer.observe(document.body, { childList: true, subtree: true });
    else setTimeout(startObserve, 50);
  }

  var retryTimer = null, stagnant = 0, lastSig = '';
  function step() {
    retryTimer = null;
    wire();
    var sig = Object.keys(map).length + '|' + document.querySelectorAll('[data-pdc-row]').length;
    if (sig === lastSig) stagnant++; else stagnant = 0;
    lastSig = sig;
    if (stagnant > 40) return;                 // nothing new for a while -> stop
    retryTimer = setTimeout(step, 150);
  }

  var lastUrl = location.href;
  setInterval(function () {
    // Instant off/on from the toolbar popup (no refresh): content.js bridges
    // chrome.storage -> localStorage for us, since MAIN world can't read
    // chrome.* APIs. Re-read every tick and update the look immediately.
    try {
      var want = localStorage.getItem('pdc_rowclick') !== '0';
      if (want !== enabled) { enabled = want; applyEnabled(); }
    } catch (_) {}
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    // Learn the id the router just used for a provider we clicked into.
    var m = location.href.match(VIEW_RE);
    if (m && pendingCode && Date.now() - pendingAt < 5000) {
      map[pendingCode] = m[1];
      pendingCode = null;
    }
    // (Re)wire whenever we land on the list page (also after first load).
    if (onList()) { wire(); if (!retryTimer) step(); }
    else ensureToggle();   // hide the switch when we leave the list page
  }, 400);

  wire();
  step();
  startObserve();
  // Show/refresh the switch as soon as the body is ready, then keep it honest.
  applyEnabled();
  (function waitBody() {
    if (document.body) { ensureToggle(); applyEnabled(); }
    else setTimeout(waitBody, 50);
  })();
})();

