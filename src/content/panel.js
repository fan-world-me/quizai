// Quiz AI Analyzer - content module: panel.js
// bindPanel, FAB, open/close, panel state updates
'use strict';

/* ═════════════ BIND PANEL ═════════════ */
function bindPanel() {
  const fab      = floatingPanel.querySelector('#__qfab');
  const togCh    = floatingPanel.querySelector('#__qtogchk');
  const abtn     = floatingPanel.querySelector('#__qabtn');
  const cbtn     = floatingPanel.querySelector('#__qcbtn');
  const scrbtn   = floatingPanel.querySelector('#__qscreenbtn');
  const hidebtn  = floatingPanel.querySelector('#__qhidebtn');
  const settoggle= floatingPanel.querySelector('#__qsettoggle');
  const setbody  = floatingPanel.querySelector('#__qsetbody');
  const setarrow = floatingPanel.querySelector('#__qsetarrow');
  const provGroq = floatingPanel.querySelector('#__qprov_groq');
  const provGem  = floatingPanel.querySelector('#__qprov_gem');
  const apiInput = floatingPanel.querySelector('#__qapiinput');
  const eyeBtn   = floatingPanel.querySelector('#__qeyebtn');
  const apiPrev  = floatingPanel.querySelector('#__qapipreview');
  const saveBtn  = floatingPanel.querySelector('#__qsavekeybtn');
  const engineStatusEl = floatingPanel.querySelector('#__qenginestatus');
  const fabMetaEl = floatingPanel.querySelector('#__qfabmeta');
  const usageEl = floatingPanel.querySelector('#__qusage');
  const usageResetEl = floatingPanel.querySelector('#__qusagereset');
  const fallbackEl = floatingPanel.querySelector('#__qfallback');

  function applyRuntimeMeta(settings) {
    const statusLabel = settings?.statusLabel || 'Engine: auto';
    if (engineStatusEl) engineStatusEl.textContent = statusLabel;
    if (fabMetaEl) fabMetaEl.textContent = statusLabel;
    if (usageEl) usageEl.textContent = settings?.usage?.remainingText || 'Немає даних';
    if (usageResetEl) usageResetEl.textContent = settings?.usage?.resetText || 'очікує запит';
    if (fallbackEl) fallbackEl.textContent = settings?.fallbackLabel || 'Groq → NVIDIA → Gemini → OpenRouter';
  }

  safeSendRuntimeMessage({ type: 'GET_SETTINGS' }, (s) => applyRuntimeMeta(s || {}));
  renderHistory();

  const stopOwnContextMenu = (e) => {
    const target = e.target;
    if (!target || !floatingPanel || !floatingPanel.contains(target)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  const stopOwnRightButton = (e) => {
    if (e.button !== 2) return;
    const target = e.target;
    if (!target || !floatingPanel || !floatingPanel.contains(target)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  ['contextmenu', 'auxclick'].forEach((type) => {
    window.addEventListener(type, stopOwnContextMenu, true);
    document.addEventListener(type, stopOwnContextMenu, true);
  });
  ['mousedown', 'mouseup', 'pointerdown', 'pointerup'].forEach((type) => {
    window.addEventListener(type, stopOwnRightButton, true);
    document.addEventListener(type, stopOwnRightButton, true);
  });

  let dragCleanup = null;
  let dragged = false, ox = 0, oy = 0, dragStartX = 0, dragStartY = 0;
  const DRAG_THRESHOLD = 8;
  const startDrag = (cx, cy) => {
    dragged = false;
    dragStartX = cx; dragStartY = cy;
    const r = floatingPanel.getBoundingClientRect();
    ox = cx - r.left; oy = cy - r.top;
  };
  const moveDrag = (cx, cy) => {
    if (!dragged && Math.hypot(cx - dragStartX, cy - dragStartY) < DRAG_THRESHOLD) return;
    dragged = true;
    const maxX = window.innerWidth  - 60, maxY = window.innerHeight - 60;
    floatingPanel.style.setProperty('left',   Math.max(0, Math.min(cx - ox, maxX)) + 'px', 'important');
    floatingPanel.style.setProperty('top',    Math.max(0, Math.min(cy - oy, maxY)) + 'px', 'important');
    floatingPanel.style.setProperty('right',  'auto', 'important');
    floatingPanel.style.setProperty('bottom', 'auto', 'important');
    repositionCard();
  };
  const endDrag = (shouldToggle = true) => {
    if (dragCleanup) { dragCleanup(); dragCleanup = null; }
    savePos(floatingPanel.getBoundingClientRect().left, floatingPanel.getBoundingClientRect().top);
    if (shouldToggle && !dragged) togglePanel();
  };
  const cancelDrag = () => {
    if (dragCleanup) { dragCleanup(); dragCleanup = null; }
  };

  fab.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    savePos(null, null);
    const s = floatingPanel.style;
    s.setProperty('right', '22px', 'important'); s.setProperty('bottom', '22px', 'important');
    s.setProperty('left', 'auto', 'important');  s.setProperty('top', 'auto', 'important');
    repositionCard();
  });
  fab.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (dragCleanup) cancelDrag();
    startDrag(e.clientX, e.clientY);
    const mv = (ev) => {
      ev.preventDefault();
      moveDrag(ev.clientX, ev.clientY);
    };
    const up = (ev) => {
      if (ev) ev.preventDefault();
      endDrag(true);
    };
    const cancel = () => cancelDrag();
    dragCleanup = () => {
      document.removeEventListener('mousemove', mv, true);
      document.removeEventListener('mouseup', up, true);
      window.removeEventListener('blur', cancel, true);
      document.removeEventListener('visibilitychange', cancel, true);
    };
    document.addEventListener('mousemove', mv, true);
    document.addEventListener('mouseup', up, true);
    window.addEventListener('blur', cancel, true);
    document.addEventListener('visibilitychange', cancel, true);
    e.preventDefault();
    e.stopPropagation();
  });
  floatingPanel.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);
  /* Touch: tap = toggle panel, drag starts only after a small threshold. */
  let touchHandled = false; /* prevent ghost click after touch */
  fab.addEventListener('touchstart', (e) => {
    if (dragCleanup) cancelDrag();
    const t = e.touches[0];
    if (!t) return;
    startDrag(t.clientX, t.clientY);
    const mv = (ev) => {
      if (!ev.touches.length) return;
      const touch = ev.touches[0];
      if (ev.cancelable) ev.preventDefault();
      moveDrag(touch.clientX, touch.clientY);
    };
    const end = (ev) => {
      if (ev && ev.cancelable) ev.preventDefault();
      touchHandled = true;
      setTimeout(() => { touchHandled = false; }, 400);
      endDrag(true);
    };
    const cancel = (ev) => {
      if (ev && ev.cancelable) ev.preventDefault();
      cancelDrag();
      touchHandled = true;
      setTimeout(() => { touchHandled = false; }, 400);
    };
    dragCleanup = () => {
      document.removeEventListener('touchmove', mv, true);
      document.removeEventListener('touchend', end, true);
      document.removeEventListener('touchcancel', cancel, true);
      window.removeEventListener('blur', cancel, true);
      document.removeEventListener('visibilitychange', cancel, true);
    };
    document.addEventListener('touchmove', mv, { capture: true, passive: false });
    document.addEventListener('touchend', end, { capture: true, passive: false });
    document.addEventListener('touchcancel', cancel, { capture: true, passive: false });
    window.addEventListener('blur', cancel, true);
    document.addEventListener('visibilitychange', cancel, true);
    if (e.cancelable) e.preventDefault();
    e.stopPropagation();
  }, { passive: false });
  /* Suppress ghost click that fires after touchend */
  fab.addEventListener('click', (e) => {
    if (touchHandled) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  });

  document.addEventListener('click', (e) => {
    if (isPanelOpen && floatingPanel && !floatingPanel.contains(e.target)) closePanel();
  }, true);

  togCh.addEventListener('change', () => {
    applyEnabledState(togCh.checked);
    chrome.storage.sync.set({ enabled: togCh.checked });
  });
  abtn.addEventListener('click',   () => { openPanel(); runAnalysis(); });
  cbtn.addEventListener('click',   () => {
    cancelCurrentAnalysis(true);
    clearAll(); lastResults = []; renderResults([]);
    setStat('Виділення знято', '');
    setTimeout(() => setStat('', ''), 2000);
  });
  scrbtn  && scrbtn.addEventListener('click',  () => { closePanel(); startCapture(); });
  hidebtn && hidebtn.addEventListener('click', () => { closePanel(); hideFab(); });

  /* ── Settings section ── */
  let currentProvider = 'groq';

  /* Load saved provider + key when section opens */
  function applyProviderState(provider, key) {
    currentProvider = provider;
    provGroq.classList.toggle('active', currentProvider === 'groq');
    provGem.classList.toggle('active',  currentProvider === 'gemini');
    apiInput.value = key || '';
    apiPrev.textContent = buildKeyPreview(provider, key);
    updatePanelKey(!!key);
  }

  function loadSettingsUI() {
    chrome.storage.sync.get(['apiKey', 'groqApiKey', 'groqApiKeys', 'geminiApiKey', 'geminiApiKeys', 'provider'], (d) => {
      const provider = d.provider || 'groq';
      const key = provider === 'gemini'
        ? ((Array.isArray(d.geminiApiKeys) && d.geminiApiKeys.length) ? d.geminiApiKeys.join(', ') : getProviderKey(provider, d))
        : ((Array.isArray(d.groqApiKeys) && d.groqApiKeys.length) ? d.groqApiKeys.join(', ') : getProviderKey(provider, d));
      applyProviderState(provider, key);
      return;
      if (false) {
        apiInput.value   = d.apiKey;
        apiPrev.textContent = 'Ключ: ' + d.apiKey.slice(0, 6) + '…' + d.apiKey.slice(-4);
      } else {
        apiInput.value   = '';
        apiPrev.textContent = '';
      }
    });
  }

  /* Toggle settings body open/close */
  settoggle && settoggle.addEventListener('click', () => {
    const open = setbody.style.display !== 'none';
    setbody.style.display = open ? 'none' : 'block';
    if (setarrow) setarrow.style.transform = open ? '' : 'rotate(180deg)';
    if (!open) loadSettingsUI(); /* load fresh values when opening */
  });

  /* Provider buttons */
  function setProvider(p) {
    chrome.storage.sync.get(['apiKey', 'groqApiKey', 'groqApiKeys', 'geminiApiKey', 'geminiApiKeys'], (d) => {
      const fallback = p === 'groq' ? (d.apiKey || '') : '';
      const storedList = p === 'gemini' ? d.geminiApiKeys : d.groqApiKeys;
      const key = (Array.isArray(storedList) && storedList.length) ? storedList.join(', ') : (d[storageKeyForProvider(p)] || fallback);
      applyProviderState(p, key);
      chrome.storage.sync.set({ provider: p });
    });
  }
  provGroq && provGroq.addEventListener('click', () => setProvider('groq'));
  provGem  && provGem.addEventListener('click',  () => setProvider('gemini'));

  /* Paste button — clipboard API with prompt() fallback */
  const pasteBtn = floatingPanel.querySelector('#__qpastebtn');
  pasteBtn && pasteBtn.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && text.trim()) {
        apiInput.value = text.trim();
        apiInput.dispatchEvent(new Event('input'));
        setStat('Вставлено ✓', 'ok');
        setTimeout(() => setStat('', ''), 1500);
      }
    } catch (_) {
      /* Fallback: focus the input so user can manually paste */
      apiInput.focus();
      apiInput.select();
      setStat('Натисніть та утримуйте поле → Вставити', '');
      setTimeout(() => setStat('', ''), 3000);
    }
  });

  /* Eye toggle — hides/shows text using CSS */
  let keyHidden = false;
  eyeBtn && eyeBtn.addEventListener('click', () => {
    keyHidden = !keyHidden;
    apiInput.classList.toggle('hide-text', keyHidden);
    eyeBtn.textContent = keyHidden ? '👁 Показати' : '🙈 Сховати';
  });

  /* Live key preview while typing */
  apiInput && apiInput.addEventListener('input', () => {
    const v = apiInput.value.trim();
    apiPrev.textContent = buildKeyPreview(currentProvider, v) || v;
  });

  /* Save key */
  saveBtn && saveBtn.addEventListener('click', () => {
    const key = apiInput.value.trim();
    if (!key) { setStat('Введіть API ключ', 'er'); return; }
    const parsedKeys = parseProviderKeys(currentProvider, key);
    const payload = { apiKey: key, provider: currentProvider, [storageKeyForProvider(currentProvider)]: key };
    if (currentProvider === 'gemini') payload.geminiApiKeys = parsedKeys;
    if (currentProvider === 'groq') payload.groqApiKeys = parsedKeys;
    chrome.storage.sync.set(payload, () => {
      setStat('Ключ збережено ✓', 'ok');
      setTimeout(() => setStat('', ''), 2500);
      /* close settings and enable buttons */
      setbody.style.display = 'none';
      if (setarrow) setarrow.style.transform = '';
      updatePanelKey(true);
      /* notify popup if open */
      safeSendRuntimeMessage({ type: 'KEY_UPDATED' });
      /* update warning icon */
      if (settoggle) settoggle.innerHTML = '⚙️ API Налаштування <span id="__qsetarrow" style="font-size:11px;color:#888;">▼</span>';
    });
  });
}

/* ─── FAB show/hide ─── */
const isMobile = () => /Mobi|Android/i.test(navigator.userAgent);

function hideFab() {
  fabHidden = true;
  if (floatingPanel) floatingPanel.style.setProperty('display', 'none', 'important');
  if (isMobile()) {
    /* Show a small pill at the screen edge so user can restore the FAB */
    if (!document.getElementById('__qrestpill')) {
      const pill = document.createElement('div');
      pill.id = '__qrestpill';
      pill.textContent = 'AI';
      pill.title = 'Відновити панель';
      Object.assign(pill.style, {
        position:'fixed', bottom:'22px', right:'0', zIndex: Z,
        background:'linear-gradient(135deg,#1a73e8,#0b3d91)',
        color:'#fff', fontSize:'20px', borderRadius:'20px 0 0 20px',
        width:'46px', height:'46px', display:'flex',
        alignItems:'center', justifyContent:'center',
        boxShadow:'0 4px 16px rgba(26,115,232,.5)',
        cursor:'pointer', touchAction:'manipulation', userSelect:'none',
      });
      pill.addEventListener('click',       () => { pill.remove(); showFab(); openPanel(); });
      pill.addEventListener('touchend', (e)=> { e.preventDefault(); pill.remove(); showFab(); openPanel(); });
      document.body.appendChild(pill);
    }
  } else {
    toast('Панель прихована. Ctrl+Shift+Q — щоб відкрити', 'ok');
  }
}
function showFab() {
  fabHidden = false;
  const pill = document.getElementById('__qrestpill');
  if (pill) pill.remove();
  if (floatingPanel) floatingPanel.style.setProperty('display', 'block', 'important');
}

function repositionCard() {
  const card = floatingPanel && floatingPanel.querySelector('#__qcard');
  if (!card) return;
  const r = floatingPanel.getBoundingClientRect();
  card.style.bottom = r.top > 400 ? '66px' : 'auto';
  card.style.top    = r.top > 400 ? 'auto' : '66px';
  card.style.right  = r.left > 292 ? '0'   : 'auto';
  card.style.left   = r.left > 292 ? 'auto': '0';
}

function togglePanel() { isPanelOpen ? closePanel() : openPanel(); }
function openPanel()   { repositionCard(); isPanelOpen = true;  floatingPanel && floatingPanel.querySelector('#__qcard').classList.add('open'); }
function closePanel()  { isPanelOpen = false; floatingPanel && floatingPanel.querySelector('#__qcard').classList.remove('open'); }

function updatePanelUI(en) {
  const dot = floatingPanel && floatingPanel.querySelector('#__qdot');
  const chk = floatingPanel && floatingPanel.querySelector('#__qtogchk');
  const sub = floatingPanel && floatingPanel.querySelector('#__qtogsub');
  if (dot) {
    dot.style.background = en ? 'linear-gradient(135deg,#7C4DFF,#448AFF)' : '#555';
    dot.style.boxShadow = en ? '0 0 8px rgba(124,77,255,0.9)' : 'none';
  }
  if (chk) chk.checked = en;
  if (sub) sub.textContent = en ? 'Увімкнено • кожні 10 сек' : 'Вимкнено';
}
function updatePanelKey(hasKey) {
  const abtn   = floatingPanel && floatingPanel.querySelector('#__qabtn');
  const scrbtn = floatingPanel && floatingPanel.querySelector('#__qscreenbtn');
  if (abtn)   abtn.disabled   = !hasKey;
  if (scrbtn) scrbtn.disabled = !hasKey;
}

function reloadPanelProviderState() {
  safeSendRuntimeMessage({ type: 'GET_SETTINGS' }, (s) => {
    updatePanelKey(!!(s && (s.apiKey || s.hasBuiltinKeys)));
  });
}

function setStat(txt, cls) {
  const el = floatingPanel && floatingPanel.querySelector('#__qst');
  if (!el) return;
  el.textContent = txt;
  el.className = '__qst ' + (cls || '');
}
