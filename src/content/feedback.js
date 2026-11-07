// Quiz AI Analyzer - content module: feedback.js
// clearAll, progress overlay, toast
'use strict';

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
