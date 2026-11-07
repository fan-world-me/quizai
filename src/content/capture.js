// Quiz AI Analyzer - content module: capture.js
// Manual area selection (startCapture)
'use strict';

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
