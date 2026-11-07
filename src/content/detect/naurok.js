// Quiz AI Analyzer - content module: detect/naurok.js
// naurok detector
'use strict';

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
