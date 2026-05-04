(function () {
  'use strict';

  if (window.top !== window) return;
  if (window.__quizAnalyzerLoaded) return;
  window.__quizAnalyzerLoaded = true;

  let isAnalyzing     = false;
  let progressOverlay = null;
  let floatingPanel   = null;
  let isPanelOpen     = false;
  let lastResults     = [];
  let autoEnabled     = false;   /* tracked separately to guard MutationObserver */
  let captureMode     = false;   /* area-selection state */
  let fabHidden       = false;   /* FAB visibility state */
  let autoTimer       = null;

  const C_OK  = '#00C851';
  const C_ORG = '#FF8800';
  const C_ERR = '#FF4444';
  const Z     = '2147483647';
  let lastAutoSignature = '';
  const AUTO_SCAN_INTERVAL_MS = 10000;

  function isEditorFrame() {
    if (window.top === window) return false;
    const body = document.body;
    const docEl = document.documentElement;
    const title = (document.title || '').toLowerCase();
    const href = String(location.href || '').toLowerCase();

    if (body?.isContentEditable) return true;
    if (body?.getAttribute('contenteditable') === 'true') return true;
    if (body?.id && /tinymce/i.test(body.id)) return true;
    if (body?.className && /mce-content-body|tox-edit-area|editor/i.test(String(body.className))) return true;
    if (docEl?.className && /mce-content-body|tox-edit-area|editor/i.test(String(docEl.className))) return true;
    if (/tinymce|ckeditor|editor/i.test(title)) return true;
    if (/tinymce|ckeditor|editor/i.test(href)) return true;

    return false;
  }

  function storageKeyForProvider(provider) {
    return provider === 'gemini' ? 'geminiApiKey' : 'groqApiKey';
  }

  function getProviderKey(provider, data) {
    const providerKey = storageKeyForProvider(provider);
    return data[providerKey] || data.apiKey || '';
  }

  function parseProviderKeys(provider, value) {
    const raw = String(value || '').trim();
    if (!raw) return [];

    if (provider === 'gemini') {
      const matches = raw.match(/AIza[0-9A-Za-z_\-]{20,}/g);
      if (matches && matches.length) return [...new Set(matches)];
    }

    if (provider === 'groq') {
      const matches = raw.match(/gsk_[0-9A-Za-z_\-]+/g);
      if (matches && matches.length) return [...new Set(matches)];
    }

    return [...new Set(raw.split(/[\s,;\n\r\t]+/).map((item) => item.trim()).filter(Boolean))];
  }

  function buildKeyPreview(provider, value) {
    const keys = parseProviderKeys(provider, value);
    if (!keys.length) return '';
    if (keys.length === 1) return 'Ключ: ' + keys[0].slice(0, 6) + '...' + keys[0].slice(-4);
    return `Ключів: ${keys.length} (перший ${keys[0].slice(0, 6)}...${keys[0].slice(-4)})`;
  }

  function hasRuntimeContext() {
    try {
      return !!(chrome && chrome.runtime && chrome.runtime.id);
    } catch (_) {
      return false;
    }
  }

  function safeSendRuntimeMessage(message, callback) {
    if (!hasRuntimeContext()) {
      if (callback) callback(null);
      return;
    }
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          if (callback) callback(null);
          return;
        }
        if (callback) callback(response);
      });
    } catch (_) {
      if (callback) callback(null);
    }
  }

  function sendRuntimeMessageAsync(message) {
    return new Promise((resolve) => {
      safeSendRuntimeMessage(message, (response) => resolve(response || null));
    });
  }

  function waitForImageLoad(img) {
    return new Promise((resolve, reject) => {
      if (img.complete && img.naturalWidth > 0) {
        resolve();
        return;
      }
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Image load failed'));
    });
  }

  function escapeXml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function stripLocalUi(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return;
    root.querySelectorAll('#__qaz_wrap, #__qaz_overlay, #__qaz_toast, .__qaz_badge, #__qrestpill').forEach((el) => el.remove());
  }

  function inlineFormState(sourceRoot, cloneRoot) {
    if (!sourceRoot || !cloneRoot) return;
    const sourceNodes = sourceRoot.querySelectorAll('input, textarea, select, option, canvas, video');
    const cloneNodes = cloneRoot.querySelectorAll('input, textarea, select, option, canvas, video');
    const len = Math.min(sourceNodes.length, cloneNodes.length);

    for (let i = 0; i < len; i += 1) {
      const src = sourceNodes[i];
      const dst = cloneNodes[i];
      if (!src || !dst) continue;

      const tag = src.tagName;
      if (tag === 'INPUT') {
        dst.setAttribute('value', src.value || '');
        if (src.checked) dst.setAttribute('checked', 'checked');
        else dst.removeAttribute('checked');
      } else if (tag === 'TEXTAREA') {
        dst.textContent = src.value || '';
      } else if (tag === 'OPTION') {
        if (src.selected) dst.setAttribute('selected', 'selected');
        else dst.removeAttribute('selected');
      } else if (tag === 'CANVAS') {
        try {
          const img = document.createElement('img');
          img.setAttribute('src', src.toDataURL('image/png'));
          img.setAttribute('style', src.getAttribute('style') || '');
          img.setAttribute('width', src.width || src.clientWidth || 0);
          img.setAttribute('height', src.height || src.clientHeight || 0);
          dst.replaceWith(img);
        } catch (_) {}
      } else if (tag === 'VIDEO') {
        const poster = src.getAttribute('poster') || '';
        if (poster) dst.setAttribute('poster', poster);
      }
    }
  }

  function buildForeignObjectMarkup() {
    const htmlClone = document.documentElement.cloneNode(true);
    stripLocalUi(htmlClone);
    inlineFormState(document.documentElement, htmlClone);

    const viewportWidth = Math.max(
      window.innerWidth || 0,
      document.documentElement.clientWidth || 0,
      1
    );
    const viewportHeight = Math.max(
      window.innerHeight || 0,
      document.documentElement.clientHeight || 0,
      1
    );
    const scrollX = window.scrollX || window.pageXOffset || 0;
    const scrollY = window.scrollY || window.pageYOffset || 0;

    htmlClone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    htmlClone.style.setProperty('margin', '0', 'important');
    htmlClone.style.setProperty('transform', `translate(${-scrollX}px, ${-scrollY}px)`, 'important');
    htmlClone.style.setProperty('transform-origin', 'top left', 'important');
    htmlClone.style.setProperty('width', `${Math.max(document.documentElement.scrollWidth, viewportWidth)}px`, 'important');
    htmlClone.style.setProperty('height', `${Math.max(document.documentElement.scrollHeight, viewportHeight)}px`, 'important');

    return {
      markup: new XMLSerializer().serializeToString(htmlClone),
      viewportWidth,
      viewportHeight,
      scrollX,
      scrollY
    };
  }

  async function cropBase64Image(base64, rect) {
    const { x, y, w, h, dpr } = rect;
    const img = new Image();
    img.src = 'data:image/jpeg;base64,' + base64;
    await waitForImageLoad(img);

    const scale = dpr || window.devicePixelRatio || 1;
    const cvs = document.createElement('canvas');
    cvs.width = Math.max(1, Math.round(w * scale));
    cvs.height = Math.max(1, Math.round(h * scale));
    const ctx = cvs.getContext('2d');
    ctx.drawImage(
      img,
      Math.round(x * scale),
      Math.round(y * scale),
      cvs.width,
      cvs.height,
      0,
      0,
      cvs.width,
      cvs.height
    );
    return cvs.toDataURL('image/jpeg', 0.88).replace(/^data:image\/jpeg;base64,/, '');
  }

  async function captureAreaFromForeignObject(rect) {
    const { markup, viewportWidth, viewportHeight } = buildForeignObjectMarkup();
    const dpr = rect.dpr || window.devicePixelRatio || 1;
    const svg = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${escapeXml(rect.w)}" height="${escapeXml(rect.h)}" viewBox="${escapeXml(rect.x)} ${escapeXml(rect.y)} ${escapeXml(rect.w)} ${escapeXml(rect.h)}">`,
      `<foreignObject x="0" y="0" width="${escapeXml(viewportWidth)}" height="${escapeXml(viewportHeight)}">`,
      markup,
      '</foreignObject>',
      '</svg>'
    ].join('');

    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    await waitForImageLoad(img);

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(rect.w * dpr));
    canvas.height = Math.max(1, Math.round(rect.h * dpr));
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.drawImage(img, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.88).replace(/^data:image\/jpeg;base64,/, '');
  }

  async function captureAreaBase64(rect) {
    const runtimeResponse = await sendRuntimeMessageAsync({ type: 'CAPTURE_AREA', rect });
    if (runtimeResponse && !runtimeResponse.error && runtimeResponse.base64) {
      return cropBase64Image(runtimeResponse.base64, rect);
    }

    if (!runtimeResponse || !runtimeResponse.needsLocalCapture) {
      const runtimeError = runtimeResponse && runtimeResponse.error ? runtimeResponse.error : 'Capture failed';
      throw new Error(runtimeError);
    }

    try {
      return await captureAreaFromForeignObject(rect);
    } catch (fallbackErr) {
      const runtimeError = runtimeResponse.error || 'Capture failed';
      throw new Error(`${runtimeError}. Local capture failed: ${fallbackErr.message}`);
    }
  }

  function buildQuestionsSignature(questions) {
    return questions.map((q) => {
      const options = (q.options || []).join('|');
      return `${q.type || 'radio'}::${q.questionText || ''}::${options}`;
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
      if (msg.type === 'CLEAR_HIGHLIGHTS') { clearAll(); lastResults = []; renderResults([]); setStat('Очищено', ''); }
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
    wrap.innerHTML = buildHTML(enabled, hasKey, settings || {});
    (document.body || document.documentElement).appendChild(wrap);
    floatingPanel = wrap;
    bindPanel();
  }

  function buildHTML(en, hasKey, settings) {
    const version = settings?.version || 'dev';
    const statusLabel = settings?.statusLabel || 'Engine: auto';
    const usageLabel = settings?.usage?.remainingText || 'Немає даних';
    const usageReset = settings?.usage?.resetText || 'очікує запит';
    const fallbackLabel = settings?.fallbackLabel || 'Gemini 2.5 -> Gemini 2 -> Groq';
    return `
<style>
#__qaz_wrap *{box-sizing:border-box;margin:0;padding:0;}
#__qfab{
  width:56px;height:56px;
  background:linear-gradient(135deg,#1a73e8,#0b3d91);
  border-radius:50%;display:flex;align-items:center;justify-content:center;
  cursor:grab;font-size:26px;position:relative;
  box-shadow:0 4px 20px rgba(26,115,232,.65);
  transition:transform .18s,box-shadow .18s;user-select:none;
  touch-action:none;-webkit-user-drag:none;
}
#__qfab:hover{transform:scale(1.1);box-shadow:0 6px 28px rgba(26,115,232,.8);}
#__qfab:active{cursor:grabbing;}
#__qdot{
  position:absolute;bottom:2px;right:2px;
  width:14px;height:14px;border-radius:50%;
  background:${en ? '#34a853' : '#999'};border:2.5px solid #fff;
}
#__qfabmeta{
  position:absolute;right:-8px;bottom:-30px;
  max-width:190px;padding:5px 8px;border-radius:999px;
  background:rgba(11,61,145,.96);color:#fff;
  font-size:10px;font-weight:700;line-height:1.2;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  box-shadow:0 8px 18px rgba(11,61,145,.25);
}
#__qcard{
  position:absolute;bottom:66px;right:0;
  width:min(292px,calc(100vw - 28px));
  background:#fff;border-radius:18px;display:none;
  border:1px solid rgba(26,115,232,.12);
  box-shadow:0 18px 48px rgba(15,23,42,.18),0 4px 14px rgba(15,23,42,.08);
  overflow:hidden;
}
#__qcard.open{display:block;animation:__qci .16s ease;}
@keyframes __qci{from{opacity:0;transform:translateY(10px) scale(.97);}to{opacity:1;transform:none;}}
.__qhdr{
  background:linear-gradient(135deg,#1a73e8,#0b3d91);color:#fff;
  padding:14px 16px 13px;display:flex;align-items:flex-start;justify-content:space-between;gap:10px;
}
.__qhtitle{font-size:14px;font-weight:700;display:flex;align-items:center;gap:6px;}
.__qhmeta{margin-top:6px;display:flex;flex-wrap:wrap;gap:6px;}
.__qchip{display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:600;line-height:1;padding:5px 8px;border-radius:999px;background:rgba(255,255,255,.18);color:#fff;}
.__qhshort{font-size:10px;background:rgba(255,255,255,.22);padding:2px 8px;border-radius:8px;white-space:nowrap;}
.__qhide{background:none;border:none;color:rgba(255,255,255,.75);cursor:pointer;font-size:18px;padding:0 0 0 8px;line-height:1;}
.__qhide:hover{color:#fff;}
.__qbody{padding:12px 14px 14px;max-height:70vh;overflow-y:auto;background:linear-gradient(180deg,#fff 0%,#f8fbff 100%);}
.__qoverview{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;}
.__qov{padding:10px 11px;border-radius:12px;background:#f3f7ff;border:1px solid #d8e6ff;}
.__qovk{font-size:10px;font-weight:700;color:#5f6b7a;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px;}
.__qovv{font-size:12px;font-weight:700;color:#123a75;line-height:1.35;word-break:break-word;}
.__qovv.sm{font-size:11px;font-weight:600;}
.__qhint{margin-bottom:10px;padding:10px 11px;border-radius:12px;background:#f4f7fb;border:1px solid #e7edf6;}
.__qhintk{font-size:10px;font-weight:700;color:#5f6b7a;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px;}
.__qhintv{font-size:11px;font-weight:700;color:#334155;line-height:1.45;}
.__qtogrow{
  display:flex;align-items:center;justify-content:space-between;
  padding:11px 12px;background:#f4f6f8;border-radius:12px;margin-bottom:10px;border:1px solid #ebeff4;
}
.__qtoglbl{font-size:13px;font-weight:600;color:#333;}
.__qtogsub{font-size:10px;color:#888;margin-top:1px;}
.__qtog{position:relative;width:40px;height:22px;flex-shrink:0;}
.__qtog input{opacity:0;width:0;height:0;}
.__qsl{position:absolute;cursor:pointer;inset:0;background:#ccc;border-radius:22px;transition:.25s;}
.__qsl:before{
  position:absolute;content:"";width:16px;height:16px;left:3px;bottom:3px;
  background:#fff;border-radius:50%;transition:.25s;box-shadow:0 1px 4px rgba(0,0,0,.25);
}
.__qtog input:checked+.__qsl{background:#1a73e8;}
.__qtog input:checked+.__qsl:before{transform:translateX(18px);}
.__qbtn{
  width:100%;padding:11px 14px;border:none;border-radius:10px;
  font-size:13px;font-weight:600;cursor:pointer;
  display:flex;align-items:center;justify-content:center;gap:9px;margin-bottom:8px;
  transition:all .14s;touch-action:manipulation;
}
.__qbtn:last-child{margin-bottom:0;}
.__qbp{background:#1a73e8;color:#fff;}.__qbp:hover{background:#1558b3;}
.__qbp:disabled{background:#b8cfe9;cursor:not-allowed;}
.__qbd{background:#fce8e6;color:#c62828;}.__qbd:hover{background:#f5c0bb;}
.__qbs{background:#e8f0fe;color:#1a73e8;}.__qbs:hover{background:#d2e3fc;}
.__qbc{background:#e6f4ea;color:#137333;}.__qbc:hover{background:#ceead6;}
.__qst{font-size:11px;color:#999;padding:5px 2px 0;min-height:16px;line-height:1.4;}
.__qst.an{color:${C_ORG};}.__qst.ok{color:${C_OK};}.__qst.er{color:${C_ERR};}
.__qresults{margin-top:10px;}
.__qresult-item{
  padding:9px 11px;border-radius:10px;margin-bottom:7px;
  border:1.5px solid #e8f5e9;background:#f1fdf4;
}
.__qresult-item.er{border-color:#fce8e6;background:#fff5f5;}
.__qresult-q{font-size:11px;color:#666;margin-bottom:4px;line-height:1.4;}
.__qresult-a{font-size:12px;font-weight:700;color:#1e7e34;display:flex;align-items:flex-start;gap:5px;}
.__qresult-a.er{color:${C_ERR};}
.__qresult-order{font-size:11px;color:#333;line-height:1.6;}
.__qresult-order b{color:#1a73e8;}
.__qresult-match{font-size:11px;color:#333;line-height:1.7;}
.__qresult-match b{color:#1a73e8;}
.__qnokey{font-size:11px;color:#555;padding:9px 11px;background:#fff8e1;border-radius:9px;margin-bottom:10px;line-height:1.55;}
.__qnokey a{color:#1a73e8;text-decoration:none;font-weight:600;}
.__qdiv{height:1px;background:#f0f0f0;margin:10px 0;}
.__qcap-hint{font-size:11px;color:#555;padding:7px 10px;background:#e8f0fe;border-radius:8px;margin-bottom:8px;line-height:1.5;}
/* ── Settings section ── */
.__qsect{display:none;margin-bottom:8px;}
.__qsecttoggle{
  font-size:12px;font-weight:600;color:#1a73e8;cursor:pointer;
  padding:7px 10px;background:#e8f0fe;border-radius:9px;
  display:flex;align-items:center;justify-content:space-between;
  user-select:none;touch-action:manipulation;
}
.__qsecttoggle:active{background:#d2e3fc;}
.__qsecttoggle span{font-size:11px;color:#888;transition:transform .2s;}
.__qsectbody{padding:10px 0 2px;}
.__qprovrow{display:flex;gap:7px;margin-bottom:10px;}
.__qprov{
  flex:1;padding:9px 6px;border:2px solid #e0e0e0;border-radius:9px;
  background:#fff;font-size:12px;font-weight:600;cursor:pointer;
  transition:all .15s;touch-action:manipulation;
}
.__qprov.active{border-color:#1a73e8;background:#e8f0fe;color:#1a73e8;}
.__qprov:active{opacity:.8;}
.__qapirow{position:relative;margin-bottom:8px;}
.__qapiinput{
  width:100%;padding:11px 12px;border:1.5px solid #ddd;
  border-radius:9px;font-size:13px;outline:none;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  box-sizing:border-box;-webkit-text-security:none;
}
.__qapiinput:focus{border-color:#1a73e8;}
.__qapiinput.hide-text{-webkit-text-security:disc;}
.__qapibtnrow{display:flex;gap:6px;margin-bottom:8px;}
.__qapibtn{
  flex:1;padding:10px 6px;border:1.5px solid #ddd;border-radius:9px;
  background:#fff;font-size:12px;font-weight:600;cursor:pointer;
  touch-action:manipulation;color:#555;
}
.__qapibtn:active{background:#f5f5f5;}
.__qapipreview{font-size:10px;color:#888;margin-bottom:6px;min-height:14px;word-break:break-all;}
/* ── Restore pill (shown when FAB is hidden on mobile) ── */
#__qrestpill{
  position:fixed;bottom:22px;right:0;z-index:2147483646;
  background:linear-gradient(135deg,#1a73e8,#0b3d91);
  color:#fff;font-size:18px;border-radius:20px 0 0 20px;
  width:44px;height:44px;display:flex;align-items:center;justify-content:center;
  box-shadow:0 4px 16px rgba(26,115,232,.5);cursor:pointer;
  touch-action:manipulation;user-select:none;
  animation:__qslide .3s ease;
}
@keyframes __qslide{from{transform:translateX(44px);}to{transform:translateX(0);}}
</style>

<div id="__qcard">
  <div class="__qhdr">
    <div>
      <span class="__qhtitle">&#129504; Quiz AI Analyzer</span>
      <div class="__qhmeta">
        <span class="__qchip" id="__qversion">v${version}</span>
        <span class="__qchip" id="__qenginestatus">${statusLabel}</span>
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:4px;">
      ${/Mobi|Android/i.test(navigator.userAgent) ? '' : '<span class="__qhshort">Ctrl+Shift+Q</span>'}
      <button class="__qhide" id="__qhidebtn" title="Сховати панель">&#10005;</button>
    </div>
  </div>
  <div class="__qbody">
    <div class="__qoverview">
      <div class="__qov">
        <div class="__qovk">Залишок</div>
        <div class="__qovv" id="__qusage">${usageLabel}</div>
      </div>
      <div class="__qov">
        <div class="__qovk">Стан</div>
        <div class="__qovv sm" id="__qusagereset">${usageReset}</div>
      </div>
    </div>
    <div class="__qhint">
      <div class="__qhintk">Fallback</div>
      <div class="__qhintv" id="__qfallback">${fallbackLabel}</div>
    </div>

    <div class="__qsect">
      <div class="__qsecttoggle" id="__qsettoggle">
        &#9881;&#65039; API Налаштування${!hasKey ? ' &#9888;&#65039;' : ''}
        <span id="__qsetarrow">&#9660;</span>
      </div>
      <div class="__qsectbody" id="__qsetbody" style="display:${!hasKey ? 'block' : 'none'}">
        <div class="__qprovrow">
          <button class="__qprov active" id="__qprov_groq">&#9889; Groq FREE</button>
          <button class="__qprov"        id="__qprov_gem">&#10024; Gemini FREE</button>
        </div>
        <div class="__qapirow">
          <input class="__qapiinput" type="text" id="__qapiinput" placeholder="Вставити API ключ тут…" autocomplete="off" autocorrect="off" spellcheck="false">
        </div>
        <div class="__qapibtnrow">
          <button class="__qapibtn" id="__qpastebtn">&#128203; Вставити</button>
          <button class="__qapibtn" id="__qeyebtn">&#128065; Сховати</button>
        </div>
        <div class="__qapipreview" id="__qapipreview"></div>
        <button class="__qbtn __qbc" id="__qsavekeybtn">&#128190; Зберегти ключ</button>
      </div>
    </div>

    <div class="__qtogrow">
      <div>
        <div class="__qtoglbl">Авто-аналіз</div>
        <div class="__qtogsub" id="__qtogsub">${en ? 'Увімкнено • раз на 10 сек' : 'Вимкнено'}</div>
      </div>
      <label class="__qtog">
        <input type="checkbox" id="__qtogchk" ${en ? 'checked' : ''}>
        <span class="__qsl"></span>
      </label>
    </div>

    <button class="__qbtn __qbp" id="__qabtn" ${!hasKey ? 'disabled' : ''}>&#128269; Аналізувати</button>
    <button class="__qbtn __qbs" id="__qscreenbtn" ${!hasKey ? 'disabled' : ''}>&#128247; Виділити область</button>
    <button class="__qbtn __qbd" id="__qcbtn">&#10005; Зняти виділення</button>

    <div class="__qst" id="__qst"></div>
    <div id="__qresults"></div>
  </div>
</div>

<div id="__qfab">&#129504;<div id="__qdot"></div><div id="__qfabmeta">${statusLabel}</div></div>`;
  }

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
      if (fallbackEl) fallbackEl.textContent = settings?.fallbackLabel || 'Gemini 2.5 -> Gemini 2 -> Groq';
    }

    safeSendRuntimeMessage({ type: 'GET_SETTINGS' }, (s) => applyRuntimeMeta(s || {}));

    let moved = false, ox = 0, oy = 0;
    const startDrag = (cx, cy) => {
      moved = false;
      const r = floatingPanel.getBoundingClientRect();
      ox = cx - r.left; oy = cy - r.top;
    };
    const moveDrag = (cx, cy) => {
      moved = true;
      const maxX = window.innerWidth  - 60, maxY = window.innerHeight - 60;
      floatingPanel.style.setProperty('left',   Math.max(0, Math.min(cx - ox, maxX)) + 'px', 'important');
      floatingPanel.style.setProperty('top',    Math.max(0, Math.min(cy - oy, maxY)) + 'px', 'important');
      floatingPanel.style.setProperty('right',  'auto', 'important');
      floatingPanel.style.setProperty('bottom', 'auto', 'important');
      repositionCard();
    };
    const endDrag = () => {
      savePos(floatingPanel.getBoundingClientRect().left, floatingPanel.getBoundingClientRect().top);
      if (!moved) togglePanel();
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
      startDrag(e.clientX, e.clientY);
      const mv = (e) => moveDrag(e.clientX, e.clientY);
      const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); endDrag(); };
      document.addEventListener('mousemove', mv);
      document.addEventListener('mouseup', up);
      e.preventDefault();
    });
    /* Touch: tap = toggle panel, slight move threshold = start dragging */
    let touchHandled = false; /* prevent ghost click after touch */
    fab.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      const startX = t.clientX, startY = t.clientY;
      let draggingTouch = false;
      const DRAG_THRESHOLD = 8;
      startDrag(startX, startY);
      const mv = (ev) => {
        if (!ev.touches.length) return;
        const touch = ev.touches[0];
        const dx = touch.clientX - startX;
        const dy = touch.clientY - startY;
        if (!draggingTouch) {
          if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
          draggingTouch = true;
        }
        if (ev.cancelable) ev.preventDefault();
        moveDrag(touch.clientX, touch.clientY);
      };
      const end = (ev) => {
        document.removeEventListener('touchmove', mv);
        document.removeEventListener('touchend', end);
        document.removeEventListener('touchcancel', end);
        if (draggingTouch) {
          if (ev.cancelable) ev.preventDefault();
          touchHandled = true;
          setTimeout(() => { touchHandled = false; }, 400);
          endDrag();
          return;
        }
        togglePanel();
      };
      document.addEventListener('touchmove', mv, { passive: false });
      document.addEventListener('touchend', end, { passive: false });
      document.addEventListener('touchcancel', end, { passive: false });
    }, { passive: true });
    /* Suppress ghost click that fires after touchend */
    fab.addEventListener('click', (e) => { if (touchHandled) e.stopImmediatePropagation(); });

    document.addEventListener('click', (e) => {
      if (isPanelOpen && floatingPanel && !floatingPanel.contains(e.target)) closePanel();
    }, true);

    togCh.addEventListener('change', () => {
      applyEnabledState(togCh.checked);
      chrome.storage.sync.set({ enabled: togCh.checked });
    });
    abtn.addEventListener('click',   () => { closePanel(); runAnalysis(); });
    cbtn.addEventListener('click',   () => {
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
        pill.textContent = '🧠';
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
    if (dot) dot.style.background = en ? '#34a853' : '#999';
    if (chk) chk.checked = en;
    if (sub) sub.textContent = en ? 'Увімкнено • раз на 10 сек' : 'Вимкнено';
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

  function renderResults(results) {
    const box = floatingPanel && floatingPanel.querySelector('#__qresults');
    if (!box) return;
    if (!results.length) { box.innerHTML = ''; return; }
    const shown = results.slice(0, 5);
    box.innerHTML = '<div class="__qdiv"></div>' + shown.map(r => {
      if (!r.success) {
        return `<div class="__qresult-item er">
          <div class="__qresult-q">${esc(r.question.slice(0, 70))}${r.question.length > 70 ? '…' : ''}</div>
          <div class="__qresult-a er">&#10005; ${esc(r.error || 'Не знайдено')}</div>
        </div>`;
      }
      if (r.type === 'ordering') {
        const orderText = r.orderItems.map((item, i) => `<b>${i + 1}.</b> ${esc(item.slice(0, 40))}`).join('<br>');
        return `<div class="__qresult-item">
          <div class="__qresult-q">${esc(r.question.slice(0, 70))}${r.question.length > 70 ? '…' : ''}</div>
          <div class="__qresult-order">${orderText}</div>
        </div>`;
      }
      if (r.type === 'matching') {
        const matchText = r.pairs.map(p => `<b>${esc(p.left.slice(0, 25))}</b> → ${esc(p.right.slice(0, 25))}`).join('<br>');
        return `<div class="__qresult-item">
          <div class="__qresult-q">${esc(r.question.slice(0, 70))}${r.question.length > 70 ? '…' : ''}</div>
          <div class="__qresult-match">${matchText}</div>
        </div>`;
      }
      const answersText = r.answers.map(a => `&#10003; ${esc(a.slice(0, 60))}`).join('<br>');
      return `<div class="__qresult-item">
        <div class="__qresult-q">${esc(r.question.slice(0, 70))}${r.question.length > 70 ? '…' : ''}</div>
        <div class="__qresult-a" style="display:block;line-height:1.7;">${answersText}</div>
      </div>`;
    }).join('');
  }

  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function savePos(x, y) { try { localStorage.setItem('__qaz_p', JSON.stringify({ x, y })); } catch (_) {} }
  function loadPos()      { try { return JSON.parse(localStorage.getItem('__qaz_p')) || {};  } catch (_) { return {}; } }

  /* ═════════════ SCREEN CAPTURE ═════════════ */
  function startCapture() {
    if (captureMode) return;
    captureMode = true;

    const overlay = document.createElement('div');
    overlay.id = '__qaz_overlay';
    overlay.style.cssText = [
      'all:initial','position:fixed','inset:0',`z-index:${Z - 1}`,
      'cursor:crosshair','background:rgba(0,0,0,0.25)',
    ].join('!important;') + '!important;';

    const hint = document.createElement('div');
    hint.style.cssText = [
      'all:initial','position:fixed','top:18px','left:50%','transform:translateX(-50%)',
      `z-index:${Z}`,'background:rgba(26,115,232,.92)','color:#fff',
      'padding:10px 20px','border-radius:22px','font-size:14px','font-weight:600',
      'font-family:-apple-system,sans-serif','pointer-events:none','white-space:nowrap',
    ].join('!important;') + '!important;';
    hint.textContent = '✂️ Виділіть область з питанням — відпустіть для аналізу. Esc — скасувати.';

    const sel = document.createElement('div');
    sel.style.cssText = [
      'all:initial','position:fixed','border:2.5px solid #1a73e8',
      'background:rgba(26,115,232,0.12)','pointer-events:none',`z-index:${Z}`,
    ].join('!important;') + '!important;';

    document.documentElement.appendChild(overlay);
    document.documentElement.appendChild(hint);
    document.documentElement.appendChild(sel);

    let startX = 0, startY = 0, dragging = false;

    const clean = () => {
      overlay.remove(); hint.remove(); sel.remove();
      captureMode = false;
      document.removeEventListener('keydown', onEsc, true);
    };
    const onEsc = (e) => { if (e.key === 'Escape') { clean(); setStat('Скасовано', ''); setTimeout(() => setStat('', ''), 1500); } };
    document.addEventListener('keydown', onEsc, true);

    /* ── Mouse events ── */
    overlay.addEventListener('mousedown', (e) => {
      e.preventDefault();
      dragging = true;
      startX = e.clientX; startY = e.clientY;
      setSel(startX, startY, 0, 0);
    });
    overlay.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const w = e.clientX - startX, h = e.clientY - startY;
      setSel(startX + (w < 0 ? w : 0), startY + (h < 0 ? h : 0), Math.abs(w), Math.abs(h));
    });

    /* ── Touch events (mobile) ── */
    overlay.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.touches[0];
      dragging = true;
      startX = t.clientX; startY = t.clientY;
      setSel(startX, startY, 0, 0);
    }, { passive: false });
    overlay.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (!dragging) return;
      const t = e.touches[0];
      const w = t.clientX - startX, h = t.clientY - startY;
      setSel(startX + (w < 0 ? w : 0), startY + (h < 0 ? h : 0), Math.abs(w), Math.abs(h));
    }, { passive: false });
    overlay.addEventListener('touchend', (e) => {
      if (!dragging) return;
      dragging = false;
      const t = e.changedTouches[0];
      const x1 = Math.min(startX, t.clientX), y1 = Math.min(startY, t.clientY);
      const x2 = Math.max(startX, t.clientX), y2 = Math.max(startY, t.clientY);
      const w = x2 - x1, h = y2 - y1;
      clean();
      if (w < 20 || h < 20) { setStat('Занадто маленька область', 'er'); return; }
      fireCaptureRequest(x1, y1, w, h);
    });

    overlay.addEventListener('mouseup', (e) => {
      if (!dragging) return;
      dragging = false;
      const x1 = Math.min(startX, e.clientX), y1 = Math.min(startY, e.clientY);
      const x2 = Math.max(startX, e.clientX), y2 = Math.max(startY, e.clientY);
      clean();
      fireCaptureRequest(x1, y1, x2 - x1, y2 - y1);
    });

    /* ── Shared capture + AI send function ── */
    function legacyFireCaptureRequest(x1, y1, w, h) {
      if (w < 20 || h < 20) { setStat('Занадто маленька область', 'er'); return; }
      setStat('Захоплення…', 'an');
      openPanel();
      safeSendRuntimeMessage({ type: 'CAPTURE_AREA', rect: { x: x1, y: y1, w, h, dpr: window.devicePixelRatio || 1 } }, (res) => {
        if (!res || res.error) { setStat(res?.error || 'Помилка захоплення', 'er'); return; }
        const dpr = window.devicePixelRatio || 1;
        const img = new Image();
        img.onload = () => {
          try {
            const cvs = document.createElement('canvas');
            cvs.width  = Math.round(w * dpr);
            cvs.height = Math.round(h * dpr);
            const ctx  = cvs.getContext('2d');
            ctx.drawImage(img, Math.round(x1 * dpr), Math.round(y1 * dpr), cvs.width, cvs.height, 0, 0, cvs.width, cvs.height);
            const base64 = cvs.toDataURL('image/jpeg', 0.88).replace(/^data:image\/jpeg;base64,/, '');
            setStat('AI аналізує зображення…', 'an');
            safeSendRuntimeMessage({ type: 'ANALYZE_IMAGE', data: { base64 } }, (ans) => {
              if (!ans || ans.error) { setStat(ans?.error || 'Помилка AI', 'er'); return; }
              setStat(ans.statusLabel || 'Готово!', 'ok');
              const box = floatingPanel && floatingPanel.querySelector('#__qresults');
              if (box) {
                box.innerHTML = `<div class="__qdiv"></div>
                <div class="__qresult-item">
                  <div class="__qresult-q">&#128247; Аналіз зображення</div>
                  <div class="__qresult-a" style="display:block;font-size:12px;line-height:1.6;color:#333;">
                    ${esc(ans.answer).replace(/\n/g,'<br>')}
                  </div>
                </div>`;
              }
            });
          } catch(err) { setStat('Помилка canvas: ' + err.message, 'er'); }
        };
        img.onerror = () => setStat('Помилка завантаження зображення', 'er');
        img.src = 'data:image/jpeg;base64,' + res.base64;
      });
    }

    function fireCaptureRequest(x1, y1, w, h) {
      if (w < 20 || h < 20) { setStat('Selection too small', 'er'); return; }
      setStat('Capturing...', 'an');
      openPanel();
      captureAreaBase64({ x: x1, y: y1, w, h, dpr: window.devicePixelRatio || 1 })
        .then((base64) => {
          setStat('Analyzing image...', 'an');
          safeSendRuntimeMessage({ type: 'ANALYZE_IMAGE', data: { base64 } }, (ans) => {
            if (!ans || ans.error) { setStat(ans?.error || 'AI error', 'er'); return; }
            setStat(ans.statusLabel || 'Done', 'ok');
            const box = floatingPanel && floatingPanel.querySelector('#__qresults');
            if (box) {
              box.innerHTML = `<div class="__qdiv"></div>
              <div class="__qresult-item">
                <div class="__qresult-q">&#128247; Image analysis</div>
                <div class="__qresult-a" style="display:block;font-size:12px;line-height:1.6;color:#333;">
                  ${esc(ans.answer).replace(/\n/g,'<br>')}
                </div>
              </div>`;
            }
          });
        })
        .catch((err) => {
          setStat(err?.message || 'Capture failed', 'er');
        });
    }

    function setSel(x, y, w, h) {
      sel.style.setProperty('left',   x + 'px', 'important');
      sel.style.setProperty('top',    y + 'px', 'important');
      sel.style.setProperty('width',  w + 'px', 'important');
      sel.style.setProperty('height', h + 'px', 'important');
    }
  }

  /* ═════════════ PAGE WATCHER ═════════════ */
  function stopAutoLoop() {
    if (autoTimer) {
      clearInterval(autoTimer);
      autoTimer = null;
    }
  }

  function startAutoLoop() {
    stopAutoLoop();
    autoTimer = setInterval(autoRun, AUTO_SCAN_INTERVAL_MS);
  }

  function autoRun() {
    if (isAnalyzing || !autoEnabled) return;
    const questions = findQuestions();
    const signature = buildQuestionsSignature(questions);
    if (autoEnabled && questions.length && signature && signature !== lastAutoSignature) {
      lastAutoSignature = signature;
      runAnalysis();
    }
  }

  /* ════════════════════════════════════════════
   * isOwnPanel — prevent the panel from
   * highlighting its own elements
   * ════════════════════════════════════════════ */
  function isOwnPanel(el) {
    return !!(floatingPanel && floatingPanel.contains(el));
  }

  /* ═════════════════════════════════════════════
   * QUESTION DETECTION
   *
   * Supported:
   *  1. vseosvita.ua  — radio/checkbox blocks, sort blocks
   *  2. zno.osvita.ua — .question + .answer divs, q-radio
   *  3. naurok.ua     — .question-option-inner colored blocks
   *  4. Moodle        — multichoice, truefalse, match (dropdowns)
   *  5. Google Forms  — .Qr7Oae + radiogroup / list
   *  6. Kahoot.it     — answer-text blocks
   *  7. Classtime     — .answer-option
   *  8. Generic radio / checkbox / fieldset groups
   * ═════════════════════════════════════════════ */

  function findQuestions() {
    const host = location.hostname;

    const sortQ = findSortContainers();
    if (sortQ.length) return sortQ;

    /* ── 1. vseosvita.ua radio/checkbox ── */
    {
      const qs = [];
      document.querySelectorAll('.flex-row-test').forEach(container => {
        if (isOwnPanel(container)) return;
        const blocks = Array.from(container.querySelectorAll('.v-test-questions-radio-block,.v-test-questions-checkbox-block'));
        if (blocks.length < 2) return;
        const qText = findTextAbove(container) || findTextInParent(container);
        if (!qText) return;
        const cbs = container.querySelectorAll('input[type="checkbox"]');
        const options = blocks.map(b => (b.querySelector('label') || b).textContent.trim()).filter(Boolean);
        if (options.length >= 2)
          qs.push({ questionText: qText, options, optionEls: blocks, containerEl: container, type: cbs.length > 0 ? 'checkbox' : 'radio' });
      });
      if (qs.length) return qs;
    }

    /* ── 2. zno.osvita.ua ── */
    if (/osvita\.ua/i.test(host)) {
      const qs = detectZnoOsvita();
      if (qs.length) return qs;
    }

    /* ── 3. naurok.ua / naurok.com.ua ── */
    if (/naurok\.(ua|com\.ua)/i.test(host)) {
      const qs = detectNaurok();
      if (qs.length) return qs;
    }

    /* ── 4. Moodle ── */
    if (/moodle\./i.test(host) || document.querySelector('.que.multichoice,.que.match,.que.truefalse')) {
      const qs = detectMoodle();
      if (qs.length) return qs;
    }

    /* ── 5. Google Forms ── */
    if (/docs\.google\.com/i.test(host) || document.querySelector('.Qr7Oae')) {
      const qs = detectGoogleForms();
      if (qs.length) return qs;
    }

    /* ── 6. Kahoot ── always return here — never fall through to generic detectors */
    if (/kahoot\.(it|com)/i.test(host)) {
      return detectKahoot();
    }

    /* ── 7. Classtime ── */
    if (/classtime\.(com|ch)/i.test(host)) {
      const qs = detectClasstime();
      if (qs.length) return qs;
    }

    /* ── 8. Generic named radio groups ── */
    {
      const radios = Array.from(document.querySelectorAll('input[type="radio"]')).filter(r => !isOwnPanel(r));
      if (radios.length >= 2) {
        const groups = {};
        radios.forEach(r => { const n = r.name || '__anon'; (groups[n] = groups[n] || []).push(r); });
        const qs = [];
        Object.values(groups).forEach(arr => {
          if (arr.length < 2) return;
          const anc = commonAncestor(arr);
          if (!anc || isOwnPanel(anc)) return;
          const qText = findTextAbove(anc) || findTextInParent(anc) || innerQuestionText(anc);
          if (!qText) return;
          const labels = Array.from(anc.querySelectorAll('label')).filter(l => !isOwnPanel(l));
          const options = labels.map(l => l.textContent.trim()).filter(Boolean);
          const optEls  = labels.length >= arr.length ? labels : arr.map(r => r.closest('div,li,td') || r.parentElement);
          if (options.length >= 2) qs.push({ questionText: qText, options, optionEls: optEls, containerEl: anc, type: 'radio' });
        });
        if (qs.length) return qs;
      }
    }

    /* ── 9. Generic checkbox groups ── */
    {
      const cbs = Array.from(document.querySelectorAll('input[type="checkbox"]')).filter(c => !isOwnPanel(c));
      if (cbs.length >= 2) {
        const anc = commonAncestor(cbs);
        if (anc && !isOwnPanel(anc)) {
          const qText = findTextAbove(anc) || innerQuestionText(anc);
          const labels = Array.from(anc.querySelectorAll('label')).filter(l => !isOwnPanel(l));
          const options = labels.map(l => l.textContent.trim()).filter(Boolean);
          if (qText && options.length >= 2)
            return [{ questionText: qText, options, optionEls: labels, containerEl: anc, type: 'checkbox' }];
        }
      }
    }

    /* ── 10. Generic structured blocks ── */
    for (const sel of ['[role="radiogroup"]','fieldset','.question','.quiz-question','[class*="question-item"]']) {
      const qs = [];
      document.querySelectorAll(sel).forEach(block => {
        if (isOwnPanel(block)) return;
        const labels = Array.from(block.querySelectorAll('label')).filter(l => !isOwnPanel(l));
        const options = labels.map(l => l.textContent.trim()).filter(t => t.length > 0 && t.length < 300);
        if (options.length < 2) return;
        const qText = findTextAbove(block) || innerQuestionText(block);
        if (qText) qs.push({ questionText: qText, options, optionEls: labels, containerEl: block, type: 'radio' });
      });
      if (qs.length) return qs;
    }

    return [];
  }

  /* ══════════════════════════════════════════════
   * zno.osvita.ua
   * ══════════════════════════════════════════════ */
  function detectZnoOsvita() {
    const qs = [];
    document.querySelectorAll('.question').forEach(qDiv => {
      if (isOwnPanel(qDiv)) return;
      const qText = qDiv.textContent.trim();
      if (!qText || qText.length < 3) return;

      let sibling = qDiv.nextElementSibling;
      let answerBlock = null;
      for (let i = 0; i < 5 && sibling; i++, sibling = sibling.nextElementSibling) {
        if (sibling.classList.contains('answers') || sibling.querySelector('.answer')) {
          answerBlock = sibling; break;
        }
      }
      if (!answerBlock)
        answerBlock = qDiv.closest('.question-block,.task,.card_i,[class*="question"]')?.querySelector('.answers');
      if (!answerBlock) return;

      const answerEls = Array.from(answerBlock.querySelectorAll('.answer'));
      if (answerEls.length < 2) return;
      const options = answerEls.map(el => {
        const clone = el.cloneNode(true);
        clone.querySelectorAll('.marker').forEach(m => m.remove());
        return clone.textContent.trim();
      }).filter(Boolean);
      if (options.length >= 2)
        qs.push({ questionText: qText, options, optionEls: answerEls, containerEl: answerBlock, type: 'radio' });
    });
    if (qs.length) return qs;

    /* Fallback: q-radio inputs */
    const radios = Array.from(document.querySelectorAll('input.q-radio,.q-radio')).filter(r => !isOwnPanel(r));
    if (radios.length >= 2) {
      const groups = {};
      radios.forEach(r => {
        const n = r.name || r.closest('table,div')?.id || '__anon';
        (groups[n] = groups[n] || []).push(r);
      });
      const qs2 = [];
      Object.values(groups).forEach(arr => {
        if (arr.length < 2) return;
        const anc = commonAncestor(arr);
        if (!anc || isOwnPanel(anc)) return;
        const qText = findTextAbove(anc) || findTextInParent(anc);
        if (!qText) return;
        const optEls = arr.map(r => r.closest('label,.answer,td,div') || r.parentElement);
        const options = optEls.map(el => {
          const clone = el.cloneNode(true);
          clone.querySelectorAll('input').forEach(i => i.remove());
          return clone.textContent.trim();
        }).filter(Boolean);
        if (options.length >= 2) qs2.push({ questionText: qText, options, optionEls: optEls, containerEl: anc, type: 'radio' });
      });
      if (qs2.length) return qs2;
    }
    return [];
  }

  /* ══════════════════════════════════════════════
   * naurok.ua (На Урок)
   *
   * URL pattern: naurok.ua/test/testing/...
   * Structure:
   *   .test-content-text-inner  — question text
   *   .test-options-grid        — grid of options
   *     .test-option            — each colored block
   *       .question-option-inner — clickable wrapper
   *         .question-option-inner-content — answer text
   *
   * Also handles multiquiz (checkboxes).
   * ══════════════════════════════════════════════ */
  function detectNaurok() {
    const qs = [];
    const qTextEl = document.querySelector(
      '.test-content-text-inner, .test-question-content-inner, .question-text, .test-content-text'
    );
    const qText = qTextEl ? qTextEl.textContent.trim() : '';
    if (!qText) return qs;

    /* Primary: .question-option-inner blocks (quiz type) */
    const optionEls = Array.from(document.querySelectorAll(
      '.question-option-inner, .test-option .question-option-inner'
    )).filter(el => !isOwnPanel(el));

    if (optionEls.length >= 2) {
      const options = optionEls.map(el => {
        const content = el.querySelector('.question-option-inner-content, p, span');
        return (content || el).textContent.trim();
      }).filter(Boolean);
      if (options.length >= 2) {
        qs.push({ questionText: qText, options, optionEls, containerEl: document.body, type: 'radio' });
        return qs;
      }
    }

    /* Fallback: .test-option blocks directly */
    const testOpts = Array.from(document.querySelectorAll(
      '.test-option, .answer-block, [class*="option-block"]'
    )).filter(el => !isOwnPanel(el) && el.textContent.trim().length > 0);
    if (testOpts.length >= 2) {
      const options = testOpts.map(el => el.textContent.trim()).filter(Boolean);
      qs.push({ questionText: qText, options, optionEls: testOpts, containerEl: document.body, type: 'radio' });
    }
    return qs;
  }

  /* ══════════════════════════════════════════════
   * Moodle — multichoice, truefalse, AND match
   *
   * Match structure (.que.match):
   *   .qtext — question text
   *   table.answer
   *     tr.r0 / tr.r1:
   *       td.text   — left side (concept)
   *       td.control > select — right side dropdown
   *         option values = possible matches
   * ══════════════════════════════════════════════ */
  function detectMoodle() {
    const qs = [];

    /* Matching questions */
    document.querySelectorAll('.que.match').forEach(queEl => {
      if (isOwnPanel(queEl)) return;
      const qTextEl = queEl.querySelector('.qtext');
      const qText   = qTextEl ? qTextEl.textContent.trim() : '';
      if (!qText) return;

      const rows = Array.from(queEl.querySelectorAll('table.answer tr'));
      if (rows.length < 2) return;

      const leftItems  = [];
      const rightItems = [];
      const selectEls  = [];

      rows.forEach(row => {
        const textCell    = row.querySelector('td.text');
        const controlCell = row.querySelector('td.control select');
        if (!textCell || !controlCell) return;
        leftItems.push(textCell.textContent.trim());
        const opts = Array.from(controlCell.options).map(o => o.text.trim()).filter(t => t && t !== 'Вибрати...' && t !== 'Choose...' && t !== '...');
        if (!rightItems.length) rightItems.push(...opts);
        selectEls.push(controlCell);
      });

      if (leftItems.length >= 2) {
        qs.push({
          questionText: qText,
          options: leftItems,
          rightOptions: rightItems,
          optionEls: selectEls,
          containerEl: queEl,
          type: 'matching',
          selectEls
        });
      }
    });

    if (qs.length) return qs;

    /* Multichoice / truefalse */
    document.querySelectorAll('.que.multichoice,.que.truefalse,.que.multichoiceset').forEach(queEl => {
      if (isOwnPanel(queEl)) return;
      const qTextEl = queEl.querySelector('.qtext');
      const qText   = qTextEl ? qTextEl.textContent.trim() : '';
      if (!qText) return;
      const answerBlock = queEl.querySelector('.answer');
      if (!answerBlock) return;

      const rows = Array.from(answerBlock.querySelectorAll('.r0,.r1,[class^="r"]'));
      if (rows.length < 2) {
        const labels = Array.from(answerBlock.querySelectorAll('[data-region="answer-label"]'));
        if (labels.length >= 2) {
          const options = labels.map(l => { const f = l.querySelector('.flex-fill'); return (f || l).textContent.trim(); }).filter(Boolean);
          if (options.length >= 2) qs.push({ questionText: qText, options, optionEls: labels, containerEl: answerBlock, type: 'radio' });
        }
        return;
      }

      const options = rows.map(row => {
        const lbl = row.querySelector('[data-region="answer-label"]');
        if (lbl) { const f = lbl.querySelector('.flex-fill'); return (f || lbl).textContent.trim(); }
        const label = row.querySelector('label');
        return label ? label.textContent.trim() : row.textContent.trim();
      }).filter(Boolean);

      const hasMulti = queEl.classList.contains('multichoiceset') || !!answerBlock.querySelector('input[type="checkbox"]');
      if (options.length >= 2)
        qs.push({ questionText: qText, options, optionEls: rows, containerEl: answerBlock, type: hasMulti ? 'checkbox' : 'radio' });
    });

    return qs;
  }

  /* ══════════════════════════════════════════════
   * Google Forms
   * ══════════════════════════════════════════════ */
  function detectGoogleForms() {
    const qs = [];
    document.querySelectorAll('.Qr7Oae').forEach(item => {
      if (isOwnPanel(item)) return;
      const headingEl = item.querySelector('.M7eMe,[role="heading"]');
      const qText = headingEl ? headingEl.textContent.trim() : '';
      if (!qText || qText.length < 2) return;

      const radioGroup = item.querySelector('[role="radiogroup"]');
      if (radioGroup) {
        const optionEls = Array.from(radioGroup.querySelectorAll('.aDTYNe,.snByac'));
        const options = optionEls.map(el => el.textContent.trim()).filter(Boolean);
        if (options.length >= 2) {
          const lblEls = Array.from(radioGroup.querySelectorAll('.docssharedWizToggleLabeledContainer,label'));
          qs.push({ questionText: qText, options, optionEls: lblEls.length >= options.length ? lblEls : optionEls, containerEl: radioGroup, type: 'radio' });
          return;
        }
      }
      const listGroup = item.querySelector('[role="list"]');
      if (listGroup) {
        const optionEls = Array.from(listGroup.querySelectorAll('.aDTYNe,.snByac'));
        const options = optionEls.map(el => el.textContent.trim()).filter(Boolean);
        if (options.length >= 2) {
          const lblEls = Array.from(listGroup.querySelectorAll('.docssharedWizToggleLabeledContainer,label'));
          qs.push({ questionText: qText, options, optionEls: lblEls.length >= options.length ? lblEls : optionEls, containerEl: listGroup, type: 'checkbox' });
        }
      }
    });
    return qs;
  }

  /* ══════════════════════════════════════════════
   * Kahoot.it
   * ══════════════════════════════════════════════ */
  function detectKahoot() {
    /* ── Step 1: find answer TILES via data-functional-selector ── */
    /* Kahoot names them answer-0 … answer-3 (or answer-0 … answer-5) */
    let tileBtns = Array.from(document.querySelectorAll('[data-functional-selector^="answer"]'))
      .filter(el => !isOwnPanel(el));

    /* ── Step 2: if data-functional-selector not found, try layout grid children ── */
    if (tileBtns.length < 2) {
      /* Kahoot wraps answers in a grid; grab direct children of grid */
      for (const gridSel of [
        '[class*="layout_answers"] > *',
        '[class*="answers__grid"] > *',
        '[class*="answersGrid"] > *',
        '[class*="answerGrid"] > *',
        '[class*="AnswerGrid"] > *',
        '[class*="answer-grid"] > *',
        '[class*="choices"] > *',
        '[class*="options"] > *',
      ]) {
        const els = Array.from(document.querySelectorAll(gridSel)).filter(el => !isOwnPanel(el));
        if (els.length >= 2) { tileBtns = els; break; }
      }
    }

    /* ── Step 3: fallback — any button/div that has a background color and contains text ── */
    if (tileBtns.length < 2) {
      const allBtns = Array.from(document.querySelectorAll('button,li,[role="button"]'))
        .filter(el => {
          if (isOwnPanel(el)) return false;
          const txt = el.innerText?.trim();
          if (!txt || txt.length > 400) return false;
          const bg = getComputedStyle(el).backgroundColor;
          /* Kahoot tiles have vivid solid colors (not white/transparent) */
          if (!bg || bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)') return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 80 && rect.height > 50;
        });
      if (allBtns.length >= 2 && allBtns.length <= 8) tileBtns = allBtns;
    }

    if (tileBtns.length < 2) return [];

    /* ── Extract text from tiles ── */
    const options = tileBtns
      .map(el => (el.innerText || el.textContent || '').trim())
      .filter(t => t.length > 0 && t.length < 400);

    /* If tiles have NO text (multiplayer phone-only mode: only colors shown) */
    if (options.length < 2) {
      /* Return a dummy result so the panel shows a helpful message */
      return [{
        questionText: '⚠️ Kahoot мультиплеєр: питання на TV/проекторі, телефон показує лише кольори. Використай кнопку 📷 "Виділити область" щоб сфотографувати питання на екрані поряд.',
        options: [],
        optionEls: [],
        containerEl: document.body,
        type: 'radio',
        noOptions: true,
      }];
    }

    /* ── Question text ── */
    const Q_SELS = [
      '[data-functional-selector="block-title"]',
      '[data-functional-selector="question-title"]',
      '[class*="question-title"]',
      '[class*="questionTitle"]',
      '[class*="QuestionTitle"]',
      '[class*="title__Title"]',
      '[class*="titleText"]',
      '[class*="TitleText"]',
      '[class*="layout_title"] p',
      '[class*="layout_title"] span',
      '[class*="questionWrapper"] p',
      'h1', 'h2',
    ];
    let qText = '';
    for (const sel of Q_SELS) {
      const el = document.querySelector(sel);
      if (el && !isOwnPanel(el)) {
        const t = (el.innerText || el.textContent || '').trim();
        if (t.length > 2) { qText = t; break; }
      }
    }
    /* Last resort: largest leaf-text near top half of viewport */
    if (!qText) {
      const topEls = Array.from(document.querySelectorAll('p,span,div,h1,h2,h3'))
        .filter(el => {
          if (isOwnPanel(el) || el.children.length > 2) return false;
          const t = (el.innerText || el.textContent || '').trim();
          if (t.length < 5 || t.length > 500) return false;
          const r = el.getBoundingClientRect();
          return r.top >= 0 && r.top < window.innerHeight * 0.6;
        });
      topEls.sort((a, b) =>
        (b.innerText||b.textContent||'').length - (a.innerText||a.textContent||'').length
      );
      if (topEls.length) qText = (topEls[0].innerText || topEls[0].textContent || '').trim().slice(0, 400);
    }

    if (!qText) qText = 'Kahoot питання';
    return [{ questionText: qText, options, optionEls: tileBtns, containerEl: document.body, type: 'radio' }];
  }

  /* ══════════════════════════════════════════════
   * Classtime
   * ══════════════════════════════════════════════ */
  function detectClasstime() {
    const ansEls = Array.from(document.querySelectorAll(
      '.answer-option,.choice,[class*="answer-item"],[class*="option-item"]'
    )).filter(el => !isOwnPanel(el));
    if (ansEls.length < 2) return [];
    const options = ansEls.map(el => el.textContent.trim()).filter(Boolean);
    const qEl     = document.querySelector('.question-text,.question-title,[class*="question-body"] p');
    const qText   = qEl ? qEl.textContent.trim() : '';
    if (!qText || options.length < 2) return [];
    return [{ questionText: qText, options, optionEls: ansEls, containerEl: document.body, type: 'radio' }];
  }

  /* ═════════════ SORT/ORDERING ═════════════ */
  function findSortContainers() {
    const results = [];
    const orderKW = /послідовн|порядок|розташуй|впорядку|хронолог|черговіст|sequence|arrange|order/i;
    for (const sel of ['.v-test-sort-block','.v-test-sort-row','[class*="sort-block"]','[class*="sort-row"]','.flex-col-test']) {
      const els = document.querySelectorAll(sel);
      if (!els.length) continue;
      const parents = new Set(Array.from(els).map(e => e.parentElement).filter(p => p && !isOwnPanel(p)));
      parents.forEach(parent => {
        const items = Array.from(parent.querySelectorAll(sel));
        if (items.length < 2) return;
        const qText = findTextAbove(parent) || findTextInParent(parent);
        if (qText) results.push({ questionText: qText, options: items.map(e => e.textContent.trim()), optionEls: items, containerEl: parent, type: 'ordering' });
      });
      if (results.length) return results;
    }
    document.querySelectorAll('.flex-row-test,.flex-col-test,[class*="flex-row"],[class*="flex-col"]').forEach(container => {
      if (isOwnPanel(container)) return;
      const qText = findTextAbove(container) || findTextInParent(container);
      if (!qText || !orderKW.test(qText)) return;
      const items = Array.from(container.children).filter(el => el.textContent.trim().length > 2 && !isOwnPanel(el));
      if (items.length >= 2)
        results.push({ questionText: qText, options: items.map(e => e.textContent.trim()), optionEls: items, containerEl: container, type: 'ordering' });
    });
    return results;
  }

  function findTextAbove(el) {
    let cur = el.previousElementSibling;
    for (let i = 0; i < 6 && cur; i++, cur = cur.previousElementSibling) {
      if (isOwnPanel(cur)) continue;
      const t = cur.textContent.trim();
      if (t.length > 4 && t.length < 1500) return t;
    }
    let p = el.parentElement;
    if (p) {
      let sib = p.previousElementSibling;
      for (let i = 0; i < 4 && sib; i++, sib = sib.previousElementSibling) {
        if (isOwnPanel(sib)) continue;
        const t = sib.textContent.trim();
        if (t.length > 4 && t.length < 1500) return t;
      }
    }
    return null;
  }

  function findTextInParent(el) {
    const check = (root) => {
      if (!root || isOwnPanel(root)) return null;
      const cands = Array.from(root.querySelectorAll('.v-test-questions-title,.question-text,.question-title,h1,h2,h3,h4,h5,legend,p'));
      for (const c of cands) {
        if (isOwnPanel(c) || el.contains(c) || c.contains(el)) continue;
        const t = c.textContent.trim();
        if (t.length > 4 && t.length < 1500) return t;
      }
      return null;
    };
    return check(el.parentElement) || check(el.parentElement?.parentElement);
  }

  function innerQuestionText(block) {
    for (const s of ['.question-text','.question-title','legend','h1','h2','h3','h4','p','strong']) {
      const el = block.querySelector(s);
      if (el && !isOwnPanel(el)) { const t = el.textContent.trim(); if (t.length > 4 && t.length < 1500) return t; }
    }
    return null;
  }

  function commonAncestor(els) {
    if (!els.length) return null;
    let a = els[0].parentElement;
    while (a && a !== document.documentElement) {
      if (els.every(e => a.contains(e))) return a;
      a = a.parentElement;
    }
    return null;
  }

  /* ═════════════ ANALYSIS ═════════════ */
  function runAnalysis() {
    if (isAnalyzing) return;
    clearAll(); lastResults = []; renderResults([]);

    const questions = findQuestions();
    if (!questions.length) {
      setStat('Питань не знайдено', 'er');
      toast('Тестові питання не знайдено на сторінці', 'er');
      return;
    }

    isAnalyzing = true;
    showProgress(questions.length);
    let done = 0;

    const next = (i) => {
      if (i >= questions.length) {
        isAnalyzing = false;
        hideProgress();
        setStat(`Готово: ${done}/${questions.length}`, done > 0 ? 'ok' : 'er');
        toast(`Аналіз завершено! ${done}/${questions.length}`, done > 0 ? 'ok' : 'er');
        renderResults(lastResults);
        openPanel();
        return;
      }
      setProgress(i + 1, questions.length);
      setStat(`Аналіз ${i + 1}/${questions.length}…`, 'an');

      const q = questions[i];

      /* Kahoot multiplayer phone mode — no options on screen, show tip and stop */
      if (q.noOptions) {
        isAnalyzing = false;
        hideProgress();
        setStat('📺 Питання на TV', '');
        openPanel();
        const box = floatingPanel && floatingPanel.querySelector('#__qresults');
        if (box) box.innerHTML = `<div class="__qdiv"></div><div class="__qresult-item"><div class="__qresult-q">📺 Kahoot мультиплеєр</div><div class="__qresult-a" style="display:block;font-size:12px;line-height:1.6;color:#555;">${esc(q.questionText)}</div></div>`;
        return;
      }

      const msgData = {
        question: q.questionText,
        options:  q.options,
        questionType: q.type,
        source: window.location.hostname
      };
      if (q.type === 'matching') {
        msgData.rightOptions = q.rightOptions;
      }

      safeSendRuntimeMessage({ type: 'ANALYZE_QUIZ', data: msgData }, (res) => {
        if (res && res.success && res.answer) {
          const ans = res.answer;
          if (res.statusLabel) setStat(res.statusLabel, 'ok');
          if (floatingPanel) {
            const eng = floatingPanel.querySelector('#__qenginestatus');
            const fabMeta = floatingPanel.querySelector('#__qfabmeta');
            const usage = floatingPanel.querySelector('#__qusage');
            const reset = floatingPanel.querySelector('#__qusagereset');
            const statusLabel = res.statusLabel || 'Engine: auto';
            if (eng) eng.textContent = statusLabel;
            if (fabMeta) fabMeta.textContent = statusLabel;
            if (usage) usage.textContent = res.usage?.remainingText || 'Немає даних';
            if (reset) reset.textContent = res.usage?.resetText || 'очікує запит';
          }

          if (q.type === 'matching' && ans.matchPairs && ans.matchPairs.length) {
            applyMatchHighlight(q, ans.matchPairs);
            lastResults.push({
              success: true, type: 'matching',
              question: q.questionText,
              pairs: ans.matchPairs,
            });
            done++;
          } else if (q.type === 'ordering' && ans.orderIndices && ans.orderIndices.length) {
            applyOrderHighlight(q, ans.orderIndices);
            lastResults.push({
              success: true, type: 'ordering',
              question: q.questionText,
              orderItems: ans.orderIndices.map(idx => q.options[idx] || '?'),
            });
            done++;
          } else if (ans.correctIndices && ans.correctIndices.length) {
            applyHighlight(q, ans);
            lastResults.push({
              success: true, type: q.type,
              question: q.questionText,
              answers: ans.correctIndices.map(idx => q.options[idx] || '?'),
            });
            done++;
          } else {
            lastResults.push({ success: false, question: q.questionText, error: 'AI не знайшов відповідь' });
          }
        } else {
          const errMsg = (res && res.error) ? res.error : 'Помилка запиту';
          lastResults.push({ success: false, question: q.questionText, error: errMsg.slice(0, 60) });
          setStat(errMsg.slice(0, 90), 'er');
          if (/ключ|key|403|ліміт|quota|Доступ/i.test(errMsg)) toast('⚠️ ' + errMsg, 'er');
        }
        setTimeout(() => next(i + 1), 350);
      });
    };

    next(0);
  }

  /* ═════════════ HIGHLIGHTING ═════════════ */
  function applyHighlight(q, answer) {
    answer.correctIndices.forEach(idx => {
      if (idx >= q.optionEls.length) return;
      const el = q.optionEls[idx];
      if (!el || isOwnPanel(el)) return;
      el.style.setProperty('outline',        `4px solid ${C_OK}`, 'important');
      el.style.setProperty('outline-offset', '3px',               'important');
      el.style.setProperty('box-shadow',     `0 0 0 4px ${C_OK}, inset 0 0 22px rgba(0,200,81,.22)`, 'important');
      el.style.setProperty('position',       'relative',          'important');
      el.setAttribute('data-qaz-hl', '1');
      addBadge(el, '✓', C_OK);
    });
  }

  function applyOrderHighlight(q, orderIndices) {
    orderIndices.forEach((itemIdx, rank) => {
      if (itemIdx >= q.optionEls.length) return;
      const el = q.optionEls[itemIdx];
      if (!el || isOwnPanel(el)) return;
      const color = ['#00C851','#33b5e5','#FF8800','#aa66cc','#ff4444'][rank % 5];
      el.style.setProperty('outline',        `4px solid ${color}`, 'important');
      el.style.setProperty('outline-offset', '3px',                'important');
      el.style.setProperty('box-shadow',     `0 0 0 4px ${color}, inset 0 0 18px rgba(255,255,255,.1)`, 'important');
      el.style.setProperty('position',       'relative',           'important');
      el.setAttribute('data-qaz-hl', '1');
      addBadge(el, String(rank + 1), color);
    });
  }

  /* Matching: pairs = [{left:'Foo', right:'Bar'}, ...] */
  function applyMatchHighlight(q, matchPairs) {
    /* Highlight the select elements and set their values */
    if (!q.selectEls) return;
    matchPairs.forEach(pair => {
      /* Find which left item this corresponds to */
      const leftIdx = q.options.findIndex(o => o === pair.left || pair.left.includes(o.slice(0, 20)));
      if (leftIdx < 0 || leftIdx >= q.selectEls.length) return;
      const sel = q.selectEls[leftIdx];
      if (!sel || isOwnPanel(sel)) return;

      /* Try to select the right option */
      for (const opt of Array.from(sel.options)) {
        if (opt.text.trim() === pair.right || pair.right.includes(opt.text.trim().slice(0, 20))) {
          sel.value = opt.value;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          break;
        }
      }

      sel.style.setProperty('outline',     `3px solid ${C_OK}`, 'important');
      sel.style.setProperty('box-shadow',  `0 0 0 3px rgba(0,200,81,.3)`, 'important');
      sel.setAttribute('data-qaz-hl', '1');
    });
  }

  function addBadge(el, text, color) {
    const b = document.createElement('span');
    b.className = '__qaz_badge';
    b.innerHTML = text;
    b.style.cssText = [
      'all:initial','display:inline-flex','align-items:center','justify-content:center',
      'position:absolute','top:8px','right:8px',
      'min-width:26px','height:26px','border-radius:13px',
      `background:${color}`,'color:#fff',
      text.length > 1 ? 'font-size:13px' : 'font-size:15px',
      'font-weight:700',`z-index:${Z}`,
      'box-shadow:0 2px 8px rgba(0,0,0,.35)','font-family:sans-serif',
      'pointer-events:none','line-height:1','padding:0 5px',
    ].join('!important;') + '!important;';
    el.appendChild(b);
  }

  function clearAll() {
    document.querySelectorAll('[data-qaz-hl]').forEach(el => {
      if (isOwnPanel(el)) return;
      el.style.removeProperty('outline');
      el.style.removeProperty('outline-offset');
      el.style.removeProperty('box-shadow');
      el.style.removeProperty('position');
      el.removeAttribute('data-qaz-hl');
    });
    document.querySelectorAll('.__qaz_badge').forEach(el => el.remove());
  }

  /* ═════════════ PROGRESS ═════════════ */
  function showProgress(total) {
    if (progressOverlay) progressOverlay.remove();
    progressOverlay = document.createElement('div');
    progressOverlay.style.cssText = [
      'all:initial','position:fixed','bottom:90px','right:24px',`z-index:${Z}`,
      'background:#fff','border-radius:14px','padding:14px 18px',
      'box-shadow:0 4px 22px rgba(0,0,0,.2)','border:1px solid #e0e0e0',
      'min-width:220px','pointer-events:none',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
    ].join('!important;') + '!important;';
    progressOverlay.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:9px;">
        <div style="width:17px;height:17px;border:3px solid #eee;border-top-color:${C_ORG};border-radius:50%;animation:__qspin .75s linear infinite;flex-shrink:0;"></div>
        <strong style="font-size:13px;color:#333;">Аналізую тест…</strong>
      </div>
      <div id="__qpt" style="font-size:12px;color:#666;margin-bottom:7px;">Питання 1 з ${total}</div>
      <div style="background:#e8e8e8;border-radius:5px;height:5px;overflow:hidden;">
        <div id="__qpb" style="height:100%;background:${C_OK};width:0%;transition:width .3s ease;"></div>
      </div>
      <style>@keyframes __qspin{to{transform:rotate(360deg);}}</style>`;
    document.documentElement.appendChild(progressOverlay);
  }

  function setProgress(cur, total) {
    const t = document.getElementById('__qpt');
    const b = document.getElementById('__qpb');
    if (t) t.textContent = `Питання ${cur} з ${total}`;
    if (b) b.style.width = (cur / total * 100) + '%';
  }

  function hideProgress() {
    if (!progressOverlay) return;
    progressOverlay.style.setProperty('opacity', '0', 'important');
    progressOverlay.style.setProperty('transition', 'opacity .35s', 'important');
    setTimeout(() => { progressOverlay && progressOverlay.remove(); progressOverlay = null; }, 380);
  }

  /* ═════════════ TOAST ═════════════ */
  function toast(msg, type) {
    document.getElementById('__qaz_toast')?.remove();
    const bdr = type === 'ok' ? C_OK : type === 'er' ? C_ERR : C_ORG;
    const el = document.createElement('div');
    el.id = '__qaz_toast';
    el.style.cssText = [
      'all:initial','position:fixed','bottom:90px','left:50%','transform:translateX(-50%)',
      `z-index:${Z}`,'background:#fff','border-radius:22px','padding:11px 22px',
      'box-shadow:0 4px 20px rgba(0,0,0,.18)',`border-left:4px solid ${bdr}`,
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'font-size:13px','color:#333','white-space:nowrap','pointer-events:none',
    ].join('!important;') + '!important;';
    el.textContent = msg;
    document.documentElement.appendChild(el);
    setTimeout(() => {
      el.style.setProperty('opacity', '0', 'important');
      el.style.setProperty('transition', 'opacity .35s', 'important');
      setTimeout(() => el.remove(), 380);
    }, 4500);
  }

  /* ═════════════ FULLSCREEN ═════════════ */
  function onFullscreen() {
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (!floatingPanel) return;
    (fsEl || document.body || document.documentElement).appendChild(floatingPanel);
    applyWrapStyles(floatingPanel);
  }
  document.addEventListener('fullscreenchange',       onFullscreen);
  document.addEventListener('webkitfullscreenchange', onFullscreen);

  boot();
})();
