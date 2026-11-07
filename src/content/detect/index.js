// Quiz AI Analyzer - content module: detect/index.js
// isOwnPanel + findQuestions dispatcher
'use strict';

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
