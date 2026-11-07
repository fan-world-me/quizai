// Quiz AI Analyzer - content module: auto.js
// Auto-scan loop
'use strict';

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
