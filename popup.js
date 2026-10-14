/* popup.js — instant on/off switches (no refresh needed).
 * Writes the choice to chrome.storage.local. The content script (content.js)
 * picks it up via chrome.storage.onChanged and applies it live on the page,
 * then forwards the row-click state to the MAIN-world list hook. */
(function () {
  'use strict';

  var COPY_KEY = 'pdc_copy';
  var ROW_KEY = 'pdc_rowclick';

  var copyBtn = document.getElementById('copyToggle');
  var rowBtn = document.getElementById('rowToggle');

  function paint(btn, on) {
    btn.textContent = on ? 'ON' : 'OFF';
    btn.classList.toggle('on', !!on);
    btn.classList.toggle('off', !on);
  }

  function load() {
    var defaults = {};
    defaults[COPY_KEY] = true;
    defaults[ROW_KEY] = true;
    chrome.storage.local.get(defaults, function (res) {
      paint(copyBtn, res[COPY_KEY] !== false);
      paint(rowBtn, res[ROW_KEY] !== false);
    });
  }

  copyBtn.addEventListener('click', function () {
    var wantOn = copyBtn.textContent !== 'ON';
    var o = {};
    o[COPY_KEY] = wantOn;
    chrome.storage.local.set(o, function () { paint(copyBtn, wantOn); });
  });

  rowBtn.addEventListener('click', function () {
    var wantOn = rowBtn.textContent !== 'ON';
    var o = {};
    o[ROW_KEY] = wantOn;
    chrome.storage.local.set(o, function () { paint(rowBtn, wantOn); });
  });

  // Stay honest if the floating on-page switch flips while we're open.
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local') return;
    if (changes[COPY_KEY]) paint(copyBtn, changes[COPY_KEY].newValue !== false);
    if (changes[ROW_KEY]) paint(rowBtn, changes[ROW_KEY].newValue !== false);
  });

  load();
})();
