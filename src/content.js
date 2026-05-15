// Quiz AI Analyzer - Content Script
// Author: fan_world_me
// Floating panel and quiz detection system
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
  let currentRequestId = 0;      /* request queue management */
  let abortController = null;    /* abort old requests */
  let kahootOverlayFrame = 0;
  const kahootOverlayTrackers = [];

  const C_OK  = '#00C851';
  const C_ORG = '#FF8800';
  const C_ERR = '#FF4444';
  const Z     = '2147483647';
  let lastAutoSignature = '';
  const AUTO_SCAN_INTERVAL_MS = 10000;

  /* Debounce utility */
  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  /* Check if element is visible */
  function isElementVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    if (el.hasAttribute('aria-hidden') && el.getAttribute('aria-hidden') === 'true') return false;
    if (el.offsetWidth === 0 && el.offsetHeight === 0) return false;
    return true;
  }

  /* Normalize text - remove extra whitespace and filter hidden content */
  function normalizeText(text) {
    if (!text) return '';
    return text.replace(/\s+/g, ' ').trim();
  }

  /* Extract text from element, filtering hidden content */
  function extractVisibleText(el) {
    if (!el || !isElementVisible(el)) return '';
    return normalizeText(el.textContent);
  }

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

  function buildHTML(en, hasKey, settings) {
    const version = settings?.version || 'dev';
    const statusLabel = settings?.statusLabel || 'Engine: auto';
    const usageLabel = settings?.usage?.remainingText || 'Немає даних';
    const usageReset = settings?.usage?.resetText || 'очікує запит';
    const fallbackLabel = settings?.fallbackLabel || 'Groq -> NVIDIA -> Gemini -> OpenRouter';
    return `
<style>
@font-face {
  font-family: "CustomFont";
  src: url("${chrome.runtime.getURL('Monocraft.ttf')}") format("truetype");
  font-display: swap;
}
#__qaz_wrap *{box-sizing:border-box;margin:0;padding:0;font-family:CustomFont,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif!important;}
#__qfab{
  width:60px;height:60px;
  background:rgba(6,20,36,0.75);
  backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);
  border:1px solid rgba(77,220,255,0.25);
  border-radius:50%;display:flex;align-items:center;justify-content:center;
  cursor:grab;font-size:28px;position:relative;
  box-shadow:0 8px 32px rgba(0,229,255,0.35),inset 0 1px 0 rgba(255,255,255,0.1);
  transition:all .2s ease;user-select:none;
  touch-action:none;-webkit-user-drag:none;
}
#__qfab:hover{transform:scale(1.08);box-shadow:0 12px 40px rgba(0,229,255,0.5),inset 0 1px 0 rgba(255,255,255,0.15);}
#__qfab:active{cursor:grabbing;transform:scale(1.02);}
#__qfab::before{
  content:'';position:absolute;inset:-2px;border-radius:50%;
  background:linear-gradient(135deg,rgba(77,220,255,0.4),rgba(0,229,255,0.2));
  z-index:-1;opacity:0;transition:opacity .2s;
}
#__qfab:hover::before{opacity:1;}
#__qdot{
  position:absolute;bottom:4px;right:4px;
  width:14px;height:14px;border-radius:50%;
  background:${en ? '#00e5ff' : '#6f8791'};
  border:2px solid rgba(6,20,36,0.9);
  box-shadow:0 0 8px ${en ? 'rgba(0,229,255,0.6)' : 'rgba(111,135,145,0.3)'};
}
#__qfabmeta{
  position:absolute;right:-8px;bottom:-32px;
  max-width:200px;padding:6px 10px;border-radius:999px;
  background:rgba(6,20,36,0.85);backdrop-filter:blur(12px);
  border:1px solid rgba(77,220,255,0.2);
  color:#9fe8ff;font-size:9px;font-weight:600;line-height:1.3;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  box-shadow:0 4px 16px rgba(0,0,0,0.4);
}
#__qcard{
  position:absolute;bottom:70px;right:0;
  width:min(340px,calc(100vw - 24px));
  background:rgba(4,14,22,0.92);
  backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);
  border-radius:20px;display:none;
  border:1px solid rgba(77,220,255,0.25);
  box-shadow:0 20px 60px rgba(0,0,0,0.6),0 0 1px rgba(77,220,255,0.5);
  overflow:hidden;
}
#__qcard.open{display:block;animation:__qci .2s cubic-bezier(0.34,1.56,0.64,1);}
@keyframes __qci{from{opacity:0;transform:translateY(12px) scale(.96);}to{opacity:1;transform:none;}}
.__qhdr{
  background:rgba(6,20,36,0.95);
  border-bottom:1px solid rgba(77,220,255,0.15);
  padding:16px 18px 14px;display:flex;align-items:flex-start;justify-content:space-between;gap:12px;
  position:relative;
}
.__qhdr::before{
  content:'';position:absolute;bottom:0;left:15%;right:15%;height:1px;
  background:linear-gradient(to right,transparent,rgba(0,229,255,0.4),transparent);
}
.__qhtitle{font-size:13px;font-weight:700;display:flex;align-items:center;gap:7px;color:#e6f7ff;text-shadow:0 0 8px rgba(77,220,255,0.3);}
.__qhmeta{margin-top:7px;display:flex;flex-wrap:wrap;gap:6px;}
.__qchip{
  display:inline-flex;align-items:center;gap:4px;font-size:9px;font-weight:600;line-height:1;
  padding:5px 9px;border-radius:999px;
  background:rgba(77,220,255,0.15);
  border:1px solid rgba(77,220,255,0.25);
  color:#9fe8ff;
  box-shadow:inset 0 1px 0 rgba(255,255,255,0.1);
}
.__qhshort{
  font-size:9px;background:rgba(77,220,255,0.12);
  padding:3px 8px;border-radius:8px;white-space:nowrap;
  color:#bfefff;border:1px solid rgba(77,220,255,0.2);
}
.__qhide{
  background:none;border:none;color:rgba(159,232,255,0.6);
  cursor:pointer;font-size:18px;padding:0 0 0 8px;line-height:1;
  transition:all .15s;
}
.__qhide:hover{color:#9fe8ff;transform:rotate(90deg);}
.__qbody{
  padding:14px 16px 16px;max-height:70vh;overflow-y:auto;
  background:rgba(4,14,22,0.5);
}
.__qbody::-webkit-scrollbar{width:6px;}
.__qbody::-webkit-scrollbar-track{background:rgba(77,220,255,0.05);border-radius:3px;}
.__qbody::-webkit-scrollbar-thumb{background:rgba(77,220,255,0.3);border-radius:3px;}
.__qbody::-webkit-scrollbar-thumb:hover{background:rgba(77,220,255,0.5);}
.__qoverview{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;}
.__qov{
  padding:12px;border-radius:12px;
  background:rgba(10,28,42,0.6);
  border:1px solid rgba(77,220,255,0.2);
  backdrop-filter:blur(8px);
  transition:all .2s;
}
.__qov:hover{
  background:rgba(10,28,42,0.8);
  border-color:rgba(77,220,255,0.35);
  box-shadow:0 4px 12px rgba(0,229,255,0.15);
}
.__qovk{font-size:9px;font-weight:700;color:#89cfe6;text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px;}
.__qovv{font-size:11px;font-weight:700;color:#e6f7ff;line-height:1.4;word-break:break-word;}
.__qovv.sm{font-size:10px;font-weight:600;color:#bfefff;}
.__qhint{
  margin-bottom:12px;padding:12px;border-radius:12px;
  background:rgba(10,28,42,0.5);
  border:1px solid rgba(77,220,255,0.18);
  backdrop-filter:blur(8px);
}
.__qhintk{font-size:9px;font-weight:700;color:#89cfe6;text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px;}
.__qhintv{font-size:10px;font-weight:600;color:#cfe9f2;line-height:1.5;}
.__qtogrow{
  display:flex;align-items:center;justify-content:space-between;
  padding:12px 14px;
  background:rgba(10,28,42,0.6);
  border-radius:12px;margin-bottom:12px;
  border:1px solid rgba(77,220,255,0.2);
  backdrop-filter:blur(8px);
  transition:all .2s;
}
.__qtogrow:hover{
  background:rgba(10,28,42,0.8);
  border-color:rgba(77,220,255,0.3);
}
.__qtoglbl{font-size:12px;font-weight:600;color:#e6f7ff;}
.__qtogsub{font-size:9px;color:#89cfe6;margin-top:2px;}
.__qtog{position:relative;width:44px;height:24px;flex-shrink:0;}
.__qtog input{opacity:0;width:0;height:0;}
.__qsl{
  position:absolute;cursor:pointer;inset:0;
  background:rgba(111,135,145,0.4);
  border:1px solid rgba(77,220,255,0.2);
  border-radius:24px;transition:.3s;
}
.__qsl:before{
  position:absolute;content:"";width:18px;height:18px;left:3px;bottom:2px;
  background:linear-gradient(135deg,#6f8791,#89cfe6);
  border-radius:50%;transition:.3s;
  box-shadow:0 2px 6px rgba(0,0,0,0.4);
}
.__qtog input:checked+.__qsl{
  background:rgba(0,229,255,0.3);
  border-color:rgba(0,229,255,0.5);
  box-shadow:0 0 12px rgba(0,229,255,0.3);
}
.__qtog input:checked+.__qsl:before{
  transform:translateX(20px);
  background:linear-gradient(135deg,#00e5ff,#4ddcff);
  box-shadow:0 0 8px rgba(0,229,255,0.6);
}
.__qbtn{
  width:100%;padding:12px 16px;border:none;border-radius:12px;
  font-size:12px;font-weight:600;cursor:pointer;
  display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:10px;
  transition:all .2s;touch-action:manipulation;
  backdrop-filter:blur(8px);
  position:relative;overflow:hidden;
}
.__qbtn::before{
  content:'';position:absolute;inset:0;
  background:linear-gradient(135deg,rgba(255,255,255,0.1),transparent);
  opacity:0;transition:opacity .2s;
}
.__qbtn:hover::before{opacity:1;}
.__qbtn:last-child{margin-bottom:0;}
.__qbp{
  background:rgba(77,220,255,0.25);
  border:1px solid rgba(77,220,255,0.4);
  color:#e6f7ff;
  box-shadow:0 4px 12px rgba(0,229,255,0.2);
}
.__qbp:hover{
  background:rgba(77,220,255,0.35);
  border-color:rgba(77,220,255,0.6);
  box-shadow:0 6px 16px rgba(0,229,255,0.35);
  transform:translateY(-1px);
}
.__qbp:disabled{
  background:rgba(111,135,145,0.2);
  border-color:rgba(111,135,145,0.3);
  color:#6f8791;cursor:not-allowed;
  box-shadow:none;
}
.__qbd{
  background:rgba(255,68,68,0.15);
  border:1px solid rgba(255,68,68,0.3);
  color:#ff9999;
}
.__qbd:hover{
  background:rgba(255,68,68,0.25);
  border-color:rgba(255,68,68,0.5);
  transform:translateY(-1px);
}
.__qbs{
  background:rgba(77,220,255,0.12);
  border:1px solid rgba(77,220,255,0.25);
  color:#9fe8ff;
}
.__qbs:hover{
  background:rgba(77,220,255,0.2);
  border-color:rgba(77,220,255,0.4);
  transform:translateY(-1px);
}
.__qbc{
  background:rgba(0,200,81,0.15);
  border:1px solid rgba(0,200,81,0.3);
  color:#66ff99;
}
.__qbc:hover{
  background:rgba(0,200,81,0.25);
  border-color:rgba(0,200,81,0.5);
  transform:translateY(-1px);
}
.__qst{font-size:10px;color:#89cfe6;padding:6px 4px 0;min-height:18px;line-height:1.5;}
.__qst.an{color:#FF8800;}.__qst.ok{color:#00e5ff;}.__qst.er{color:#ff6b6b;}
.__qresults{margin-top:12px;}
.__qresult-item{
  padding:12px;border-radius:12px;margin-bottom:10px;
  background:rgba(10,28,42,0.6);
  border:1px solid rgba(0,200,81,0.3);
  backdrop-filter:blur(8px);
  transition:all .2s;
}
.__qresult-item:hover{
  background:rgba(10,28,42,0.8);
  border-color:rgba(0,200,81,0.5);
  box-shadow:0 4px 12px rgba(0,200,81,0.15);
}
.__qresult-item.er{border-color:rgba(255,68,68,0.3);background:rgba(40,14,14,0.6);}
.__qresult-item.er:hover{border-color:rgba(255,68,68,0.5);background:rgba(40,14,14,0.8);}
.__qresult-q{font-size:10px;color:#89cfe6;margin-bottom:6px;line-height:1.5;}
.__qresult-a{font-size:11px;font-weight:700;color:#66ff99;display:flex;align-items:flex-start;gap:6px;line-height:1.6;}
.__qresult-a.er{color:#ff6b6b;}
.__qresult-order{font-size:10px;color:#cfe9f2;line-height:1.6;}
.__qresult-order b{color:#00e5ff;}
.__qresult-match{font-size:10px;color:#cfe9f2;line-height:1.7;}
.__qresult-match b{color:#00e5ff;}
.__qnokey{
  font-size:10px;color:#ff9999;padding:12px;
  background:rgba(255,68,68,0.15);
  border:1px solid rgba(255,68,68,0.3);
  border-radius:12px;margin-bottom:12px;line-height:1.6;
}
.__qnokey a{color:#4ddcff;text-decoration:none;font-weight:600;}
.__qdiv{
  height:1px;
  background:linear-gradient(to right,transparent,rgba(77,220,255,0.3),transparent);
  margin:12px 0;
}
.__qcap-hint{
  font-size:10px;color:#9fe8ff;padding:10px 12px;
  background:rgba(77,220,255,0.12);
  border:1px solid rgba(77,220,255,0.25);
  border-radius:12px;margin-bottom:10px;line-height:1.6;
}
/* ── Settings section ── */
.__qsect{display:none;margin-bottom:10px;}
.__qsecttoggle{
  font-size:11px;font-weight:600;color:#9fe8ff;cursor:pointer;
  padding:10px 12px;
  background:rgba(77,220,255,0.12);
  border:1px solid rgba(77,220,255,0.25);
  border-radius:12px;
  display:flex;align-items:center;justify-content:space-between;
  user-select:none;touch-action:manipulation;
  transition:all .2s;
}
.__qsecttoggle:hover{
  background:rgba(77,220,255,0.2);
  border-color:rgba(77,220,255,0.35);
}
.__qsecttoggle:active{background:rgba(77,220,255,0.25);}
.__qsecttoggle span{font-size:10px;color:#89cfe6;transition:transform .2s;}
.__qsectbody{padding:12px 0 4px;}
.__qprovrow{display:flex;gap:8px;margin-bottom:12px;}
.__qprov{
  flex:1;padding:10px 8px;
  border:1px solid rgba(77,220,255,0.25);
  border-radius:10px;
  background:rgba(10,28,42,0.5);
  color:#9fe8ff;
  font-size:11px;font-weight:600;cursor:pointer;
  transition:all .2s;touch-action:manipulation;
  backdrop-filter:blur(8px);
}
.__qprov.active{
  border-color:rgba(0,229,255,0.6);
  background:rgba(77,220,255,0.2);
  color:#00e5ff;
  box-shadow:0 0 12px rgba(0,229,255,0.2);
}
.__qprov:hover{
  background:rgba(10,28,42,0.7);
  border-color:rgba(77,220,255,0.4);
}
.__qprov:active{opacity:.85;}
.__qapirow{position:relative;margin-bottom:10px;}
.__qapiinput{
  width:100%;padding:12px;
  border:1px solid rgba(77,220,255,0.25);
  border-radius:10px;font-size:11px;outline:none;
  font-family:"Monocraft",monospace;
  box-sizing:border-box;-webkit-text-security:none;
  background:rgba(10,28,42,0.6);
  color:#e6f7ff;
  backdrop-filter:blur(8px);
  transition:all .2s;
}
.__qapiinput::placeholder{color:#6f8791;}
.__qapiinput:focus{
  border-color:rgba(0,229,255,0.5);
  background:rgba(10,28,42,0.8);
  box-shadow:0 0 12px rgba(0,229,255,0.15);
}
.__qapiinput.hide-text{-webkit-text-security:disc;}
.__qapibtnrow{display:flex;gap:8px;margin-bottom:10px;}
.__qapibtn{
  flex:1;padding:10px 8px;
  border:1px solid rgba(77,220,255,0.25);
  border-radius:10px;
  background:rgba(10,28,42,0.5);
  font-size:11px;font-weight:600;cursor:pointer;
  touch-action:manipulation;color:#9fe8ff;
  transition:all .2s;
  backdrop-filter:blur(8px);
}
.__qapibtn:hover{
  background:rgba(10,28,42,0.7);
  border-color:rgba(77,220,255,0.4);
}
.__qapibtn:active{opacity:.85;}
.__qapipreview{font-size:9px;color:#89cfe6;margin-bottom:8px;min-height:14px;word-break:break-all;line-height:1.4;}
/* ── History section ── */
.__qhistory{margin-top:12px;}
.__qhistory-title{
  font-size:10px;font-weight:700;color:#89cfe6;
  text-transform:uppercase;letter-spacing:.05em;
  margin-bottom:8px;padding:0 4px;
}
.__qhistory-item{
  padding:10px 12px;border-radius:10px;margin-bottom:8px;
  background:rgba(10,28,42,0.5);
  border:1px solid rgba(77,220,255,0.15);
  backdrop-filter:blur(8px);
  transition:all .2s;
  cursor:pointer;
}
.__qhistory-item:hover{
  background:rgba(10,28,42,0.7);
  border-color:rgba(77,220,255,0.3);
  box-shadow:0 4px 12px rgba(0,229,255,0.1);
}
.__qhistory-q{font-size:10px;color:#9fe8ff;margin-bottom:4px;line-height:1.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.__qhistory-a{font-size:9px;color:#66ff99;line-height:1.5;}
.__qhistory-time{font-size:8px;color:#6f8791;margin-top:4px;}
.__qhistory-empty{font-size:10px;color:#6f8791;text-align:center;padding:20px;line-height:1.5;}
/* ── Restore pill (shown when FAB is hidden on mobile) ── */
#__qrestpill{
  position:fixed;bottom:22px;right:0;z-index:2147483646;
  background:rgba(6,20,36,0.85);
  backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);
  border:1px solid rgba(77,220,255,0.3);
  color:#00e5ff;font-size:20px;border-radius:20px 0 0 20px;
  width:48px;height:48px;display:flex;align-items:center;justify-content:center;
  box-shadow:0 4px 20px rgba(0,229,255,0.4);cursor:pointer;
  touch-action:manipulation;user-select:none;
  animation:__qslide .3s ease;
  transition:all .2s;
}
#__qrestpill:hover{
  background:rgba(6,20,36,0.95);
  box-shadow:0 6px 24px rgba(0,229,255,0.6);
}
@keyframes __qslide{from{transform:translateX(48px);}to{transform:translateX(0);}}
/* ── Mobile responsive ── */
@media (max-width: 480px) {
  #__qcard{width:calc(100vw - 16px);bottom:75px;}
  .__qoverview{grid-template-columns:1fr;}
  .__qbody{max-height:60vh;}
  #__qfab{width:56px;height:56px;font-size:24px;}
  #__qfabmeta{display:none;}
}
</style>

<div id="__qcard">
  <div class="__qhdr">
    <div>
      <span class="__qhtitle">AI Analyzer</span>
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

    <button class="__qbtn __qbp" id="__qabtn" ${!hasKey ? 'disabled' : ''}>Аналіз</button>
    <button class="__qbtn __qbs" id="__qscreenbtn" ${!hasKey ? 'disabled' : ''}>Скріншот</button>
    <button class="__qbtn __qbd" id="__qcbtn">Очистити</button>

    <div class="__qst" id="__qst"></div>
    <div id="__qresults"></div>

    <div class="__qhistory" id="__qhistory">
      <div class="__qdiv"></div>
      <div class="__qhistory-title">Історія (останні 3)</div>
      <div id="__qhistory-list"></div>
    </div>
  </div>
</div>

<div id="__qfab">🧠<div id="__qdot"></div><div id="__qfabmeta">${statusLabel}</div></div>`;
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
      dot.style.background = en ? '#00e5ff' : '#6f8791';
      dot.style.boxShadow = en ? '0 0 8px rgba(0,229,255,0.6)' : '0 0 8px rgba(111,135,145,0.3)';
    }
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

  /* ═════════════ HISTORY ═════════════ */
  /* ═════════════ HISTORY ═════════════ */
  // Offline history for last 3 analyzed questions
  // Created by fan_world_me
  function saveToHistory(results) {
    try {
      const history = loadHistory();
      const timestamp = Date.now();
      results.forEach(r => {
        if (r.success) {
          history.unshift({
            question: r.question,
            answer: r.answers ? r.answers.join(', ') : (r.orderItems ? r.orderItems.join(' → ') : (r.pairs ? r.pairs.map(p => `${p.left}→${p.right}`).join(', ') : '')),
            type: r.type,
            timestamp
          });
        }
      });
      const trimmed = history.slice(0, 3);
      localStorage.setItem('__qaz_history', JSON.stringify(trimmed));
    } catch (_) {}
  }

  function loadHistory() {
    try {
      return JSON.parse(localStorage.getItem('__qaz_history')) || [];
    } catch (_) {
      return [];
    }
  }

  function renderHistory() {
    const historyList = floatingPanel && floatingPanel.querySelector('#__qhistory-list');
    if (!historyList) return;
    const history = loadHistory();
    if (!history.length) {
      historyList.innerHTML = '<div class="__qhistory-empty">Історія порожня<br>Проаналізуйте тест щоб побачити результати тут</div>';
      return;
    }
    historyList.innerHTML = history.map((h, idx) => {
      const timeAgo = formatTimeAgo(h.timestamp);
      return `<div class="__qhistory-item" data-idx="${idx}" style="cursor:pointer;">
        <div class="__qhistory-q">${esc(h.question.slice(0, 60))}${h.question.length > 60 ? '…' : ''}</div>
        <div class="__qhistory-a">${esc(h.answer.slice(0, 80))}${h.answer.length > 80 ? '…' : ''}</div>
        <div class="__qhistory-time">${timeAgo}</div>
      </div>`;
    }).join('');

    // Add click handlers to show full answer
    historyList.querySelectorAll('.__qhistory-item').forEach(item => {
      item.addEventListener('click', () => {
        const idx = parseInt(item.getAttribute('data-idx'), 10);
        const h = history[idx];
        if (!h) return;
        const box = floatingPanel && floatingPanel.querySelector('#__qresults');
        if (box) {
          box.innerHTML = `<div class="__qdiv"></div>
          <div class="__qresult-item">
            <div class="__qresult-q">${esc(h.question)}</div>
            <div class="__qresult-a" style="display:block;font-size:12px;line-height:1.6;color:rgba(255,255,255,0.95);">
              ${esc(h.answer).replace(/\n/g,'<br>')}
            </div>
          </div>`;
        }
      });
    });
  }

  function formatTimeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'щойно';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} хв тому`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} год тому`;
    const days = Math.floor(hours / 24);
    return `${days} дн тому`;
  }

  /* ═════════════ CACHE ═════════════ */
  // Answer caching system - fan_world_me
  function getCacheKey(question, options) {
    const normalized = question.toLowerCase().trim() + '|' + (options || []).join('|').toLowerCase();
    return 'qaz_cache_' + btoa(normalized).slice(0, 50);
  }

  function getCachedAnswer(question, options) {
    try {
      const key = getCacheKey(question, options);
      const cached = localStorage.getItem(key);
      if (!cached) return null;
      const data = JSON.parse(cached);
      const age = Date.now() - data.timestamp;
      if (age > 7 * 24 * 60 * 60 * 1000) {
        localStorage.removeItem(key);
        return null;
      }
      return data.answer;
    } catch (_) {
      return null;
    }
  }

  function setCachedAnswer(question, options, answer) {
    try {
      const key = getCacheKey(question, options);
      localStorage.setItem(key, JSON.stringify({
        answer,
        timestamp: Date.now()
      }));
    } catch (_) {}
  }

  function savePos(x, y) { try { localStorage.setItem('__qaz_p', JSON.stringify({ x, y })); } catch (_) {} }
  function loadPos()      { try { return JSON.parse(localStorage.getItem('__qaz_p')) || {};  } catch (_) { return {}; } }

  /* ═════════════ SCREEN CAPTURE ═════════════ */
  function startCapture() {
    if (captureMode) return;
    captureMode = true;
    const previousPanelDisplay = floatingPanel ? floatingPanel.style.getPropertyValue('display') : '';
    if (floatingPanel) floatingPanel.style.setProperty('display', 'none', 'important');

    const overlay = document.createElement('div');
    overlay.id = '__qaz_overlay';
    overlay.style.cssText = [
      'all:initial','position:fixed','inset:0',`z-index:${Z - 1}`,
      'cursor:crosshair','background:rgba(0,0,0,0.25)',
      'touch-action:none','user-select:none','-webkit-user-select:none',
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

    const overlayRoot = document.fullscreenElement || document.webkitFullscreenElement || document.documentElement;
    overlayRoot.appendChild(overlay);
    overlayRoot.appendChild(hint);
    overlayRoot.appendChild(sel);

    let startX = 0, startY = 0, lastX = 0, lastY = 0, dragging = false;

    const clampPoint = (x, y) => ({
      x: Math.max(0, Math.min(Number.isFinite(x) ? x : 0, window.innerWidth || document.documentElement.clientWidth || 1)),
      y: Math.max(0, Math.min(Number.isFinite(y) ? y : 0, window.innerHeight || document.documentElement.clientHeight || 1)),
    });

    const updateSelection = (x, y) => {
      const p = clampPoint(x, y);
      lastX = p.x; lastY = p.y;
      const w = lastX - startX, h = lastY - startY;
      setSel(startX + (w < 0 ? w : 0), startY + (h < 0 ? h : 0), Math.abs(w), Math.abs(h));
    };

    const finishSelection = (x, y) => {
      if (!dragging) return;
      dragging = false;
      const p = clampPoint(x ?? lastX, y ?? lastY);
      lastX = p.x; lastY = p.y;
      const x1 = Math.min(startX, lastX), y1 = Math.min(startY, lastY);
      const x2 = Math.max(startX, lastX), y2 = Math.max(startY, lastY);
      clean();
      fireCaptureRequest(x1, y1, x2 - x1, y2 - y1);
    };

    const onDocMouseMove = (e) => {
      if (!dragging) return;
      e.preventDefault();
      updateSelection(e.clientX, e.clientY);
    };
    const onDocMouseUp = (e) => {
      if (!dragging) return;
      e.preventDefault();
      finishSelection(e.clientX, e.clientY);
    };
    const onDocTouchMove = (e) => {
      if (!dragging || !e.touches.length) return;
      e.preventDefault();
      const t = e.touches[0];
      updateSelection(t.clientX, t.clientY);
    };
    const onDocTouchEnd = (e) => {
      if (!dragging) return;
      e.preventDefault();
      const t = e.changedTouches && e.changedTouches[0];
      finishSelection(t ? t.clientX : lastX, t ? t.clientY : lastY);
    };
    const onDocTouchCancel = (e) => {
      if (!dragging) return;
      e.preventDefault();
      finishSelection(lastX, lastY);
    };
    const onWindowBlur = () => {
      if (dragging) finishSelection(lastX, lastY);
    };

    const clean = () => {
      overlay.remove(); hint.remove(); sel.remove();
      if (floatingPanel) floatingPanel.style.setProperty('display', previousPanelDisplay || 'block', 'important');
      captureMode = false;
      document.removeEventListener('keydown', onEsc, true);
      document.removeEventListener('mousemove', onDocMouseMove, true);
      document.removeEventListener('mouseup', onDocMouseUp, true);
      document.removeEventListener('touchmove', onDocTouchMove, true);
      document.removeEventListener('touchend', onDocTouchEnd, true);
      document.removeEventListener('touchcancel', onDocTouchCancel, true);
      window.removeEventListener('blur', onWindowBlur, true);
    };
    const onEsc = (e) => { if (e.key === 'Escape') { clean(); setStat('Скасовано', ''); setTimeout(() => setStat('', ''), 1500); } };
    document.addEventListener('keydown', onEsc, true);
    document.addEventListener('mousemove', onDocMouseMove, true);
    document.addEventListener('mouseup', onDocMouseUp, true);
    document.addEventListener('touchmove', onDocTouchMove, { capture: true, passive: false });
    document.addEventListener('touchend', onDocTouchEnd, { capture: true, passive: false });
    document.addEventListener('touchcancel', onDocTouchCancel, { capture: true, passive: false });
    window.addEventListener('blur', onWindowBlur, true);

    /* ── Mouse events ── */
    overlay.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      dragging = true;
      const p = clampPoint(e.clientX, e.clientY);
      startX = p.x; startY = p.y; lastX = p.x; lastY = p.y;
      setSel(startX, startY, 0, 0);
    });
    overlay.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
    }, true);

    /* ── Touch events (mobile) ── */
    overlay.addEventListener('touchstart', (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      const t = e.touches[0];
      if (!t) return;
      dragging = true;
      const p = clampPoint(t.clientX, t.clientY);
      startX = p.x; startY = p.y; lastX = p.x; lastY = p.y;
      setSel(startX, startY, 0, 0);
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
      clearAll();          // Сбросить старые подсветки
      lastResults = [];    // Сбросить старые результаты
      renderResults([]);   // Очистить панель результатов
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
                  <div class="__qresult-a" style="display:block;font-size:12px;line-height:1.6;color:rgba(255,255,255,0.95);">
                    ${esc(ans.answer).replace(/\n/g,'<br>')}
                  </div>
                </div>`;
              }
              // Save to history
              saveToHistory([{
                success: true,
                question: '📷 Аналіз зображення',
                answers: [ans.answer],
                type: 'image'
              }]);
              renderHistory();
            });
          } catch(err) { setStat('Помилка canvas: ' + err.message, 'er'); }
        };
        img.onerror = () => setStat('Помилка завантаження зображення', 'er');
        img.src = 'data:image/jpeg;base64,' + res.base64;
      });
    }

    function fireCaptureRequest(x1, y1, w, h) {
      if (w < 20 || h < 20) { setStat('Selection too small', 'er'); return; }
      cancelCurrentAnalysis(true);
      const captureRequestId = currentRequestId;
      clearAll();          // Сбросить старые подсветки
      lastResults = [];    // Сбросить старые результаты
      renderResults([]);   // Очистить панель результатов
      setStat('Capturing...', 'an');
      openPanel();
      captureAreaBase64({ x: x1, y: y1, w, h, dpr: window.devicePixelRatio || 1 })
        .then((base64) => {
          if (captureRequestId !== currentRequestId) return;
          setStat('Analyzing image...', 'an');
          safeSendRuntimeMessage({ type: 'ANALYZE_IMAGE', data: { base64 } }, (ans) => {
            if (captureRequestId !== currentRequestId) return;
            if (!ans || ans.error) { setStat(ans?.error || 'AI error', 'er'); return; }
            setStat(ans.statusLabel || 'Done', 'ok');
            const box = floatingPanel && floatingPanel.querySelector('#__qresults');
            if (box) {
              box.innerHTML = `<div class="__qdiv"></div>
              <div class="__qresult-item">
                <div class="__qresult-a" style="display:block;font-size:13px;line-height:1.6;color:rgba(255,255,255,0.95);">
                  ${esc(ans.answer).replace(/\n/g,'<br>')}
                </div>
              </div>`;
            }
            // Save to history
            saveToHistory([{
              success: true,
              question: '📷 Скріншот',
              answers: [ans.answer],
              type: 'image'
            }]);
            renderHistory();
          });
        })
        .catch((err) => {
          if (captureRequestId !== currentRequestId) return;
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

  const debouncedAutoRun = debounce(function() {
    if (isAnalyzing || !autoEnabled) return;
    const questions = findQuestions();
    const signature = buildQuestionsSignature(questions);
    if (autoEnabled && questions.length && signature && signature !== lastAutoSignature) {
      lastAutoSignature = signature;
      runAnalysis();
    }
  }, 1500);

  function startAutoLoop() {
    stopAutoLoop();
    autoTimer = setInterval(debouncedAutoRun, AUTO_SCAN_INTERVAL_MS);
  }

  function autoRun() {
    debouncedAutoRun();
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

    if (/vseosvita\.ua/i.test(host)) {
      const qs = detectVseosvita();
      if (qs.length) return qs;
    }

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
      return detectKahootV2();
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

  function cleanVseosvitaItemText(el) {
    if (!el) return '';
    const clone = el.cloneNode(true);
    clone.querySelectorAll('.numb-item,.rk-cross__item,.vr-queue-select,.test-btn_cross,input,button,script,style').forEach(n => n.remove());
    return normalizeText(clone.textContent || '');
  }

  function findVseosvitaQuestionText(scope) {
    const root = scope?.closest?.('.v-test-go-bg,.v-test-question,[id^="i-test-question"],.v-test-go-body') || scope?.parentElement || document;
    const title = root.querySelector?.('.v-test-questions-title .content-box,.v-test-questions-title,strong,.content-box strong,.content-box p');
    const text = title ? normalizeText(title.textContent || '') : '';
    return text || findTextAbove(scope) || findTextInParent(scope) || innerQuestionText(root);
  }

  function detectVseosvita() {
    const qs = [];

    document.querySelectorAll('.v-block-answers-cross-wrapper').forEach(wrapper => {
      if (isOwnPanel(wrapper)) return;
      const cols = Array.from(wrapper.querySelectorAll('.v-col-6'));
      const leftCol = cols.find(col => !col.classList.contains('v-col-last')) || cols[0];
      const rightCol = cols.find(col => col.classList.contains('v-col-last')) || cols[1];
      if (!leftCol || !rightCol) return;

      const leftEls = Array.from(leftCol.querySelectorAll('.v-block-answers-cross-block')).filter(el => !isOwnPanel(el));
      const rightEls = Array.from(rightCol.querySelectorAll('.v-block-answers-cross-block')).filter(el => !isOwnPanel(el));
      const options = leftEls.map(cleanVseosvitaItemText).filter(Boolean);
      const rightOptions = rightEls.map(cleanVseosvitaItemText).filter(Boolean);
      const qText = findVseosvitaQuestionText(wrapper);
      if (qText && options.length >= 2 && rightOptions.length >= 2) {
        qs.push({
          questionText: qText,
          options,
          rightOptions,
          optionEls: leftEls,
          leftEls,
          rightEls,
          containerEl: wrapper,
          type: 'matching'
        });
      }
    });
    if (qs.length) return qs;

    document.querySelectorAll('.a-test-lab-inp input[type="text"],.a-test-lab-inp textarea').forEach(input => {
      if (isOwnPanel(input)) return;
      const box = input.closest('.a-test-lab-inp') || input.parentElement;
      const qText = findVseosvitaQuestionText(box);
      if (qText) {
        qs.push({
          questionText: qText,
          options: [],
          optionEls: [input],
          inputEl: input,
          containerEl: box,
          type: 'open_ended'
        });
      }
    });
    if (qs.length) return qs;

    document.querySelectorAll('.t-test-questions,.row_draggable-question').forEach(container => {
      if (isOwnPanel(container)) return;
      const items = Array.from(container.querySelectorAll('.v-test-questions-select-block')).filter(el => !isOwnPanel(el));
      const options = items.map(cleanVseosvitaItemText).filter(Boolean);
      const qText = findVseosvitaQuestionText(container);
      if (qText && options.length >= 2) {
        qs.push({
          questionText: qText,
          options,
          optionEls: items,
          containerEl: container,
          type: 'ordering'
        });
      }
    });

    return qs;
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
  function detectKahootV2() {
    const qText = getKahootQuestionText() || 'Kahoot question';
    const mediaContext = getKahootMediaContext();
    const captureEl = getKahootCaptureElement();
    const base = { mediaContext, captureEl, containerEl: document.body, source: 'kahoot' };

    const jumbleEls = Array.from(document.querySelectorAll('[data-functional-selector^="draggable-jumble-card-"]'))
      .filter(el => !isOwnPanel(el) && isElementVisible(el));
    const jumbleOptions = jumbleEls.map(el => cleanKahootText(el)).filter(Boolean);
    if (jumbleOptions.length >= 2) return [{ ...base, questionText: qText, options: jumbleOptions, optionEls: jumbleEls, type: 'ordering' }];

    const textInput = document.querySelector('[data-functional-selector="text-answer-input"], input[class*="open-ended-board__Input"]');
    if (textInput && !isOwnPanel(textInput) && isElementVisible(textInput)) {
      return [{ ...base, questionText: qText, options: [], optionEls: [textInput], inputEl: textInput, type: 'open_ended' }];
    }

    let tileBtns = Array.from(document.querySelectorAll('[data-functional-selector^="question-choice-text-"]'))
      .map(el => findKahootChoiceTile(el))
      .filter((el, idx, arr) => el && !isOwnPanel(el) && arr.indexOf(el) === idx);

    if (tileBtns.length < 2) {
      tileBtns = Array.from(document.querySelectorAll('[data-functional-selector^="answer-"]'))
        .filter(el => !isOwnPanel(el) && isElementVisible(el));
    }

    if (tileBtns.length < 2) {
      tileBtns = Array.from(document.querySelectorAll('button,li,[role="button"]')).filter(el => {
        if (isOwnPanel(el)) return false;
        const ds = el.getAttribute?.('data-functional-selector') || '';
        const aria = el.getAttribute?.('aria-label') || '';
        if (/solo-top-bar|kahoot-go-toolbar|control-bar|settings|volume|game-mode/i.test(ds + ' ' + aria)) return false;
        const txt = cleanKahootText(el);
        if (!txt || txt.length > 400) return false;
        const bg = getComputedStyle(el).backgroundColor;
        if (!bg || bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 120 && rect.height > 45 && rect.top > 120;
      });
      if (tileBtns.length > 8) tileBtns = [];
    }

    const options = tileBtns.map(el => cleanKahootText(el)).filter(t => t.length > 0 && t.length < 800);
    if (tileBtns.length < 2 || options.length < 2) {
      return [{
        questionText: 'Kahoot multiplayer: this screen may show only answer colors. Use Screenshot mode to capture the shared question screen.',
        options: [],
        optionEls: [],
        containerEl: document.body,
        type: 'radio',
        noOptions: true,
      }];
    }

    const requiredCount = getKahootRequiredAnswersCount();
    const type = requiredCount > 1 ? 'checkbox' : 'radio';
    return [{ ...base, questionText: qText, options, optionEls: tileBtns, type, requiredCount }];
  }

  function cleanKahootText(el) {
    if (!el) return '';
    const clone = el.cloneNode(true);
    clone.querySelectorAll('script,style,svg,[data-functional-selector="icon"],.__qaz_badge').forEach(n => n.remove());
    const text = normalizeText(clone.textContent || '');
    const imageBits = Array.from(el.querySelectorAll('img')).map((img, idx) => {
      const src = img.currentSrc || img.src || '';
      const alt = normalizeText(img.alt || img.getAttribute('aria-label') || '');
      if (!alt && (!src || src.startsWith('data:'))) return '';
      return `[answer image ${idx + 1}: ${alt || 'no alt'}${src && !src.startsWith('data:') ? ` ${src}` : ''}]`;
    }).filter(Boolean);
    return [text, ...imageBits].filter(Boolean).join(' ');
  }

  function findKahootChoiceTile(el) {
    let cur = el;
    let best = el;
    let bestArea = 0;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      const ds = cur.getAttribute?.('data-functional-selector') || '';
      if (/solo-top-bar|kahoot-go-toolbar|control-bar|settings|volume|game-mode/i.test(ds)) break;
      const rect = cur.getBoundingClientRect();
      const bg = getComputedStyle(cur).backgroundColor;
      const area = rect.width * rect.height;
      const isAnswer = /^answer-\d+$/.test(ds);
      const isQuestionChoice = /^question-choice-text-\d+$/.test(ds);
      const isJumble = /^draggable-jumble-card-\d+$/.test(ds);
      const isClickable = cur.tagName === 'BUTTON' || cur.getAttribute?.('role') === 'button';
      const isColored = bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)';
      const looksLikeTile = (isAnswer || isQuestionChoice || isJumble || (isClickable && isColored) || isColored);
      if (looksLikeTile && rect.width > 160 && rect.height > 45 && rect.top > 120 && area > bestArea) {
        best = cur;
        bestArea = area;
      }
      if (isAnswer || isJumble) break;
      cur = cur.parentElement;
    }
    return best;
  }

  function getKahootRequiredAnswersCount() {
    const el = document.querySelector('[data-functional-selector^="required-answers-count-"]');
    if (!el) return 0;
    const ds = el.getAttribute('data-functional-selector') || '';
    const m = ds.match(/required-answers-count-(\d+)/);
    if (m) return parseInt(m[1], 10) || 0;
    const textMatch = normalizeText(el.textContent || '').match(/\d+/);
    return textMatch ? parseInt(textMatch[0], 10) || 0 : 0;
  }

  function getKahootQuestionText() {
    const selectors = [
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
      'h1', 'h2'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!el || isOwnPanel(el)) continue;
      const text = normalizeText(el.textContent || '');
      if (text.length > 2 && text.length < 600) return text;
    }
    const labelled = Array.from(document.querySelectorAll('[aria-label^="Quiz:"],[aria-label^="True or false:"]'))
      .map(el => normalizeText((el.getAttribute('aria-label') || '').replace(/^(Quiz|True or false):\s*/i, '')))
      .find(Boolean);
    if (labelled) return labelled;

    const topEls = Array.from(document.querySelectorAll('p,span,div,h1,h2,h3')).filter(el => {
      if (isOwnPanel(el) || el.children.length > 2) return false;
      const text = normalizeText(el.textContent || '');
      if (text.length < 5 || text.length > 500) return false;
      const rect = el.getBoundingClientRect();
      return rect.top >= 0 && rect.top < window.innerHeight * 0.6;
    });
    topEls.sort((a, b) => normalizeText(b.textContent || '').length - normalizeText(a.textContent || '').length);
    return topEls[0] ? normalizeText(topEls[0].textContent || '').slice(0, 400) : '';
  }

  function getKahootMediaContext() {
    const mediaEls = Array.from(document.querySelectorAll(
      '[data-functional-selector="media-container"] img,[data-functional-selector="media-container__media-image"],img[aria-label*="Question"][aria-label*="media"],[data-functional-selector^="question-choice-text-"] img'
    )).filter(el => !isOwnPanel(el) && isElementVisible(el));
    return mediaEls.slice(0, 8).map((img, idx) => {
      const src = img.currentSrc || img.src || img.href?.baseVal || img.getAttribute?.('href') || '';
      const alt = normalizeText(img.alt || img.getAttribute('aria-label') || '');
      if (!alt && (!src || src.startsWith('data:'))) return '';
      return `Image ${idx + 1}: ${alt || 'no alt'}${src && !src.startsWith('data:') ? ` (${src})` : ''}`;
    }).filter(Boolean).join('\n');
  }

  function getKahootCaptureElement() {
    const media = document.querySelector('[data-functional-selector="media-container"],[data-functional-selector="media-container__media-image"],[data-functional-selector^="question-choice-text-"] img');
    const main = document.querySelector('[data-functional-selector="main-content-container"], main');
    return media?.closest?.('main,[data-functional-selector="main-content-container"]') || main || media || null;
  }

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

  async function captureElementForAnalysis(el) {
    if (!el || !isElementVisible(el)) return '';
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth || document.documentElement.clientWidth || 1;
    const vh = window.innerHeight || document.documentElement.clientHeight || 1;
    const pad = 16;
    const x1 = Math.max(0, Math.floor(rect.left - pad));
    const y1 = Math.max(0, Math.floor(rect.top - pad));
    const x2 = Math.min(vw, Math.ceil(rect.right + pad));
    const y2 = Math.min(vh, Math.ceil(rect.bottom + pad));
    const w = x2 - x1;
    const h = y2 - y1;
    if (w < 40 || h < 40) return '';
    return captureAreaBase64({ x: x1, y: y1, w, h, dpr: window.devicePixelRatio || 1 });
  }

  /* ═════════════ ANALYSIS ═════════════ */
  function runAnalysis() {
    if (isAnalyzing) cancelCurrentAnalysis(false);

    // Cancel previous request if exists
    if (abortController) {
      abortController.abort();
    }
    abortController = new AbortController();
    currentRequestId++;
    const thisRequestId = currentRequestId;

    clearAll(); lastResults = []; renderResults([]);

    const questions = findQuestions();
    if (!questions.length) {
      setStat('Питань не знайдено', 'er');
      return;
    }

    isAnalyzing = true;
    showProgress(questions.length);
    let done = 0;

    const next = (i) => {
      // Ignore if this is an old request
      if (thisRequestId !== currentRequestId) {
        return;
      }

      if (i >= questions.length) {
        isAnalyzing = false;
        abortController = null;
        hideProgress();
        setStat(`Готово: ${done}/${questions.length}`, done > 0 ? 'ok' : 'er');
        // Ensure progress is hidden after toast
        setTimeout(() => hideProgress(), 100);
        renderResults(lastResults);
        saveToHistory(lastResults);
        renderHistory();
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
        if (box) box.innerHTML = `<div class="__qdiv"></div><div class="__qresult-item"><div class="__qresult-q">📺 Kahoot мультиплеєр</div><div class="__qresult-a" style="display:block;font-size:12px;line-height:1.6;color:rgba(255,255,255,0.95);">${esc(q.questionText)}</div></div>`;
        return;
      }

      const msgData = {
        question: q.questionText,
        options:  q.options,
        questionType: q.type,
        source: window.location.hostname
      };
      if (q.mediaContext) msgData.mediaContext = q.mediaContext;
      if (q.type === 'matching') {
        msgData.rightOptions = q.rightOptions;
      }

      /* Check cache first */
      const cached = getCachedAnswer(q.questionText, q.options);
      if (cached) {
        setStat('📦 З кешу', 'ok');
        processAnswer(cached, q, () => next(i + 1), () => done++);
        return;
      }

      const sendQuizRequest = () => safeSendRuntimeMessage({ type: 'ANALYZE_QUIZ', data: msgData }, (res) => {
        if (thisRequestId !== currentRequestId) return;
        if (res && res.success && res.answer) {
          const ans = res.answer;
          setCachedAnswer(q.questionText, q.options, ans);
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

          processAnswer(ans, q, () => next(i + 1), () => done++);
        } else {
          const errMsg = (res && res.error) ? res.error : 'Помилка запиту';
          lastResults.push({ success: false, question: q.questionText, error: errMsg.slice(0, 60) });
          setStat(errMsg.slice(0, 90), 'er');
          setTimeout(() => next(i + 1), 120);
        }
      });

      if (/kahoot/i.test(window.location.hostname) && q.captureEl) {
        captureElementForAnalysis(q.captureEl)
          .then((base64) => {
            if (thisRequestId !== currentRequestId) return;
            if (base64) msgData.imageBase64 = base64;
            sendQuizRequest();
          })
          .catch(() => sendQuizRequest());
      } else {
        sendQuizRequest();
      }
    };

    next(0);
  }

  /* Helper function to process answer (used for both cached and fresh answers) */
  function processAnswer(ans, q, callback, onDone) {
    if (q.type === 'matching' && ans.matchPairs && ans.matchPairs.length) {
      applyMatchHighlight(q, ans.matchPairs);
      lastResults.push({
        success: true, type: 'matching',
        question: q.questionText,
        pairs: ans.matchPairs,
      });
      if (onDone) onDone();
    } else if (q.type === 'ordering' && ((ans.orderIndices && ans.orderIndices.length) || ans.answerWord)) {
      const orderIndices = ans.orderIndices && ans.orderIndices.length ? ans.orderIndices : inferOrderFromAnswerWord(q.options, ans.answerWord);
      applyOrderHighlight(q, orderIndices);
      lastResults.push({
        success: true, type: 'ordering',
        question: q.questionText,
        orderItems: orderIndices.map(idx => q.options[idx] || '?'),
      });
      if (onDone) onDone();
    } else if ((q.type === 'open_ended' || q.type === 'short_answer') && (ans.answer || ans.textAnswer || ans.rawResponse)) {
      const textAnswer = String(ans.answer || ans.textAnswer || ans.rawResponse || '').trim();
      applyOpenAnswerHighlight(q, textAnswer);
      lastResults.push({
        success: true, type: 'open_ended',
        question: q.questionText,
        answers: [textAnswer],
      });
      if (onDone) onDone();
    } else if (ans.correctIndices && ans.correctIndices.length) {
      applyHighlight(q, ans);
      lastResults.push({
        success: true, type: q.type,
        question: q.questionText,
        answers: ans.correctIndices.map(idx => q.options[idx] || '?'),
      });
      if (onDone) onDone();
    } else {
      // AI returned response but couldn't parse answer - show explanation instead
      const explanation = ans.explanation || ans.rawResponse || 'Немає відповіді';
      lastResults.push({
        success: true,
        question: q.questionText,
        answers: [explanation.slice(0, 200)],
        type: 'text'
      });
      if (onDone) onDone();
    }
    setTimeout(callback, 120);
  }

  /* ═════════════ HIGHLIGHTING ═════════════ */
  function applyHighlight(q, answer) {
    answer.correctIndices.forEach(idx => {
      if (idx >= q.optionEls.length) return;
      const el = /kahoot/i.test(String(q.source || location.hostname)) ? findKahootChoiceTile(q.optionEls[idx]) : q.optionEls[idx];
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
    const isKahoot = /kahoot/i.test(String(q.source || location.hostname));
    if (isKahoot) {
      orderIndices.forEach((itemIdx, rank) => {
        if (itemIdx >= q.optionEls.length) return;
        const el = findKahootChoiceTile(q.optionEls[itemIdx]);
        if (!el || isOwnPanel(el)) return;
        const color = ['#00C851','#33b5e5','#FF8800','#aa66cc','#ff4444'][rank % 5];
        showKahootFixedOrderOverlay(el, rank + 1, color);
      });
      return;
    }
    orderIndices.forEach((itemIdx, rank) => {
      if (itemIdx >= q.optionEls.length) return;
      const el = q.optionEls[itemIdx];
      if (!el || isOwnPanel(el)) return;
      const color = ['#00C851','#33b5e5','#FF8800','#aa66cc','#ff4444'][rank % 5];
      el.style.setProperty('outline',        `4px solid ${color}`, 'important');
      el.style.setProperty('outline-offset', '3px', 'important');
      el.style.setProperty('box-shadow',     `0 0 0 4px ${color}, inset 0 0 18px rgba(255,255,255,.1)`, 'important');
      el.style.setProperty('position',       'relative',           'important');
      el.setAttribute('data-qaz-hl', '1');
      addBadge(el, String(rank + 1), color);
    });
  }

  function visuallyOrderKahootCards(q, orderIndices) {
    // Kahoot drag/drop is stateful; changing DOM order creates broken ghost UI.
    // Keep visual numbering on the original cards and show the order in the panel.
  }

  function inferOrderFromAnswerWord(options, answerWord) {
    const remaining = options.map((_, idx) => idx);
    const text = normalizeText(answerWord || '').toLowerCase();
    const result = [];
    while (remaining.length) {
      let bestPos = -1;
      let bestIndex = remaining[0];
      remaining.forEach((idx) => {
        const opt = normalizeText(options[idx] || '').toLowerCase();
        const pos = opt ? text.indexOf(opt) : -1;
        if (pos >= 0 && (bestPos < 0 || pos < bestPos)) {
          bestPos = pos;
          bestIndex = idx;
        }
      });
      result.push(bestIndex);
      remaining.splice(remaining.indexOf(bestIndex), 1);
      if (bestPos < 0) result.push(...remaining.splice(0));
    }
    return result;
  }

  /* Matching: pairs = [{left:'Foo', right:'Bar'}, ...] */
  function applyMatchHighlight(q, matchPairs) {
    if (q.leftEls && q.rightEls) {
      matchPairs.forEach(pair => {
        const leftIdx = findBestTextIndex(pair.left, q.options);
        const rightIdx = findBestTextIndex(pair.right, q.rightOptions || []);
        const color = ['#00C851','#33b5e5','#FF8800','#aa66cc','#ff4444'][Math.max(0, leftIdx) % 5];
        const leftEl = leftIdx >= 0 ? q.leftEls[leftIdx] : null;
        const rightEl = rightIdx >= 0 ? q.rightEls[rightIdx] : null;
        [leftEl, rightEl].forEach((el, partIdx) => {
          if (!el || isOwnPanel(el)) return;
          el.style.setProperty('outline', `4px solid ${color}`, 'important');
          el.style.setProperty('outline-offset', '3px', 'important');
          el.style.setProperty('box-shadow', `0 0 0 4px ${color}, inset 0 0 18px rgba(255,255,255,.1)`, 'important');
          el.style.setProperty('position', 'relative', 'important');
          el.setAttribute('data-qaz-hl', '1');
          addBadge(el, partIdx === 0 ? String(leftIdx + 1) : String.fromCharCode(65 + rightIdx), color);
        });
      });
      return;
    }

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

  function applyOpenAnswerHighlight(q, answerText) {
    const input = q.inputEl || q.optionEls?.[0];
    if (!input || isOwnPanel(input)) return;
    if ('value' in input && answerText) {
      input.value = answerText;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    input.style.setProperty('outline', `4px solid ${C_OK}`, 'important');
    input.style.setProperty('outline-offset', '3px', 'important');
    input.style.setProperty('box-shadow', `0 0 0 4px ${C_OK}`, 'important');
    input.setAttribute('data-qaz-hl', '1');
    const badgeHost = input.parentElement || q.containerEl;
    if (badgeHost && !isOwnPanel(badgeHost)) {
      badgeHost.style.setProperty('position', 'relative', 'important');
      badgeHost.setAttribute('data-qaz-hl', '1');
      addBadge(badgeHost, answerText.slice(0, 16) || 'OK', C_OK);
    }
  }

  function findBestTextIndex(needle, haystack) {
    const n = normalizeText(needle || '').toLowerCase();
    if (!n || !Array.isArray(haystack)) return -1;
    let bestIdx = -1;
    let bestScore = 0;
    haystack.forEach((item, idx) => {
      const h = normalizeText(item || '').toLowerCase();
      if (!h) return;
      let score = 0;
      if (h === n) score = 1;
      else if (h.includes(n) || n.includes(h)) score = Math.min(h.length, n.length) / Math.max(h.length, n.length);
      else {
        const words = n.split(/\s+/).filter(Boolean);
        const overlap = words.filter(w => h.includes(w)).length;
        score = words.length ? overlap / words.length : 0;
      }
      if (score > bestScore) {
        bestScore = score;
        bestIdx = idx;
      }
    });
    return bestScore >= 0.25 ? bestIdx : -1;
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

  function showKahootFixedOrderOverlay(el, rank, color) {
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const box = document.createElement('div');
    box.className = '__qaz_badge';
    box.setAttribute('data-qaz-hl', '1');
    box.style.cssText = [
      'all:initial','position:fixed',
      `left:${rect.left}px`,`top:${rect.top}px`,
      `width:${rect.width}px`,`height:${rect.height}px`,
      'box-sizing:border-box','border-radius:10px',
      `border:7px solid ${color}`,
      'box-shadow:0 0 0 4px rgba(0,0,0,.25)',
      `z-index:${Z}`,'pointer-events:none',
    ].join('!important;') + '!important;';
    const badge = document.createElement('div');
    badge.textContent = String(rank);
    badge.style.cssText = [
      'all:initial','position:absolute','left:10px','top:10px',
      'width:46px','height:46px','border-radius:50%',
      `background:${color}`,'color:#fff','border:4px solid #fff',
      'display:flex','align-items:center','justify-content:center',
      'font:900 28px Arial,sans-serif','box-shadow:0 4px 14px rgba(0,0,0,.5)',
      'pointer-events:none',
    ].join('!important;') + '!important;';
    box.appendChild(badge);
    document.documentElement.appendChild(box);
    kahootOverlayTrackers.push({ el, box, kind: 'card' });
    startKahootOverlayTracking();
  }

  function startKahootOverlayTracking() {
    if (kahootOverlayFrame) return;
    const tick = () => {
      kahootOverlayFrame = 0;
      for (const item of kahootOverlayTrackers) {
        if (!item.el || !item.box || !document.documentElement.contains(item.box)) continue;
        const rect = item.el.getBoundingClientRect();
        if (!rect.width || !rect.height) {
          item.box.style.setProperty('display', 'none', 'important');
          continue;
        }
        item.box.style.setProperty('display', 'block', 'important');
        item.box.style.setProperty('left', `${rect.left}px`, 'important');
        item.box.style.setProperty('top', `${rect.top}px`, 'important');
        item.box.style.setProperty('width', `${rect.width}px`, 'important');
        item.box.style.setProperty('height', `${rect.height}px`, 'important');
      }
      if (kahootOverlayTrackers.some(item => item.box && document.documentElement.contains(item.box))) {
        kahootOverlayFrame = requestAnimationFrame(tick);
      }
    };
    kahootOverlayFrame = requestAnimationFrame(tick);
  }

  function clearAll() {
    if (kahootOverlayFrame) {
      cancelAnimationFrame(kahootOverlayFrame);
      kahootOverlayFrame = 0;
    }
    kahootOverlayTrackers.splice(0);
    document.querySelectorAll('[data-qaz-hl]').forEach(el => {
      if (isOwnPanel(el)) return;
      el.style.removeProperty('outline');
      el.style.removeProperty('outline-offset');
      el.style.removeProperty('box-shadow');
      el.style.removeProperty('filter');
      el.style.removeProperty('visibility');
      el.style.removeProperty('opacity');
      el.style.removeProperty('pointer-events');
      el.style.removeProperty('position');
      el.style.removeProperty('order');
      el.style.removeProperty('gap');
      if (el.style.display === 'flex') el.style.removeProperty('display');
      if (el.style.flexDirection === 'column') el.style.removeProperty('flex-direction');
      el.removeAttribute('data-qaz-hl');
    });
    document.querySelectorAll('.__qaz_badge').forEach(el => el.remove());
  }

  /* ═════════════ PROGRESS ═════════════ */
  function showProgress(total) {
    // Disabled - no progress overlay
    return;
  }

  function setProgress(cur, total) {
    // Disabled - no progress overlay
    return;
  }

  function hideProgress() {
    // Disabled - no progress overlay
    return;
  }

  /* ═════════════ TOAST ═════════════ */
  function toast(msg, type) {
    // Disabled - no toast messages
    return;
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
