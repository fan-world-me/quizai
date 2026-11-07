// Quiz AI Analyzer - content module: detect/classtime.js
// Classtime detector
'use strict';

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
