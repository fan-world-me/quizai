// Quiz AI Analyzer - content module: main.js
// Fullscreen handling and guarded start
'use strict';

/* ═════════════ FULLSCREEN ═════════════ */
function onFullscreen() {
  const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
  if (!floatingPanel) return;
  (fsEl || document.body || document.documentElement).appendChild(floatingPanel);
  applyWrapStyles(floatingPanel);
}

// Start once per page, top frame only (popup may inject the content scripts again).
if (window.top === window && !window.__quizAnalyzerLoaded) {
  window.__quizAnalyzerLoaded = true;
  document.addEventListener('fullscreenchange',       onFullscreen);
  document.addEventListener('webkitfullscreenchange', onFullscreen);

  boot();
}
