// Quiz AI Analyzer - content module: detect/vseosvita.js
// ZNO osvita / vseosvita detectors
'use strict';

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
