// Quiz AI Analyzer - content module: detect/moodle.js
// Moodle detector
'use strict';

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
