// Quiz AI Analyzer - content module: lifecycle.js
// boot, settings state, panel injection
'use strict';

function buildQuestionsSignature(questions) {
  return questions.map((q) => {
    const options = (q.options || []).join('|');
    return `${q.type || 'radio'}::${q.questionText || ''}::${options}::${q.mediaContext || ''}`;
  }).join('##');
}

/* ═════════════ BOOT ═════════════ */
function boot() {
  if (isEditorFrame()) return;
  safeSendRuntimeMessage({ type: 'GET_SETTINGS' }, (s) => {
    const enabled = !!(s && s.enabled);
    const hasKey  = !!(s && (s.apiKey || s.hasBuiltinKeys));
    autoEnabled   = enabled;
    injectPanel(enabled, hasKey, s || {});
    if (enabled) { startAutoLoop(); setTimeout(autoRun, 2500); }
  });

  if (hasRuntimeContext()) {
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'TRIGGER_ANALYZE')  runAnalysis();
    if (msg.type === 'CLEAR_HIGHLIGHTS') { cancelCurrentAnalysis(true); clearAll(); lastResults = []; renderResults([]); setStat('Очищено', ''); }
    if (msg.type === 'SETTINGS_CHANGED') onSettingsChange(msg.enabled);
    if (msg.type === 'KEY_UPDATED')      { updatePanelKey(true); }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || !changes.enabled) return;
    const nextEnabled = changes.enabled.newValue !== false;
    if (nextEnabled === autoEnabled) {
      updatePanelUI(nextEnabled);
      return;
    }
    applyEnabledState(nextEnabled);
  });
  }

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && /^[qQйЙ]$/.test(e.key)) {
      e.preventDefault();
      if (fabHidden) { showFab(); openPanel(); }
      else           { togglePanel(); }
    }
  });
}

function applyEnabledState(en) {
  autoEnabled = en;
  lastAutoSignature = '';
  updatePanelUI(en);
  if (en) {
    startAutoLoop();
    setTimeout(autoRun, 800);
  }
  else     { stopAutoLoop(); clearAll(); lastResults = []; lastAutoSignature = ''; }
}

function onSettingsChange(en) {
  applyEnabledState(en);
}

function cancelCurrentAnalysis(clearSignature) {
  currentRequestId++;
  isAnalyzing = false;
  if (abortController) {
    try { abortController.abort(); } catch (_) {}
    abortController = null;
  }
  hideProgress();
  if (clearSignature) lastAutoSignature = '';
}

/* ═════════════ PANEL HTML ═════════════ */
function applyWrapStyles(wrap) {
  const s = wrap.style;
  s.setProperty('all',            'initial',    'important');
  s.setProperty('position',       'fixed',      'important');
  s.setProperty('z-index',        Z,            'important');
  s.setProperty('pointer-events', 'auto',       'important');
  s.setProperty('display',        'block',      'important');
  s.setProperty('box-sizing',     'border-box', 'important');
  s.setProperty('font-family',    '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif', 'important');
  const pos = loadPos();
  if (pos.x != null && pos.y != null &&
      pos.x >= 0 && pos.x <= window.innerWidth  - 60 &&
      pos.y >= 0 && pos.y <= window.innerHeight - 60) {
    s.setProperty('left',   pos.x + 'px', 'important');
    s.setProperty('top',    pos.y + 'px', 'important');
    s.setProperty('right',  'auto',       'important');
    s.setProperty('bottom', 'auto',       'important');
  } else {
    s.setProperty('right',  '22px',       'important');
    s.setProperty('bottom', '22px',       'important');
    s.setProperty('left',   'auto',       'important');
    s.setProperty('top',    'auto',       'important');
  }
}

function injectPanel(enabled, hasKey, settings) {
  if (document.getElementById('__qaz_wrap')) return;
  const wrap = document.createElement('div');
  wrap.id = '__qaz_wrap';
  wrap.setAttribute('data-darkreader-ignore', '');
  wrap.setAttribute('data-darkreader-mode', 'ignore');
  applyWrapStyles(wrap);
  const tpl = document.createElement('template');
  tpl.innerHTML = buildHTML(enabled, hasKey, settings || {});
  wrap.appendChild(tpl.content.cloneNode(true));
  (document.body || document.documentElement).appendChild(wrap);
  floatingPanel = wrap;
  bindPanel();
}
