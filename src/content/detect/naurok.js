// Quiz AI Analyzer - content module: detect/naurok.js
// naurok detector — supports both legacy (.question-option-inner) and new beta (tb-*) layouts.
'use strict';

/* ══════════════════════════════════════════════
 * naurok.ua (На Урок) — beta layout (tb-*)
 *
 * URL: naurok.ua/test/testing/... served via /test-beta-static/
 *
 * Question types detected via tb-multi-hint icon class:
 *   lucide-square-check-big   → checkbox    (multiple correct)
 *   lucide-keyboard           → open_ended  (text input, single field)
 *   lucide-text-cursor-input  → fill_blank  (gaps inside sentence)
 *   lucide-list-ordered       → ordering    (drag/arrow reorder)
 *   lucide-arrow-left-right   → matching    (connect pairs)
 *   (no hint)                 → radio       (single choice)
 *
 * Structures:
 *
 *   RADIO / CHECKBOX:
 *     section.tb-question > div.tb-question-text.tb-rich > p
 *     div.tb-answers[role="group"] > button.tb-answer
 *       span.tb-answer-key, span.tb-answer-tick (checkbox only), span.tb-rich > p
 *
 *   OPEN-ENDED:
 *     section.tb-question (same)
 *     form.tb-type-answer > input.tb-big-input
 *
 *   FILL-IN-THE-BLANK:
 *     section.tb-question  — only hint, NO question text here
 *     div.tb-question.tb-fill-text
 *       div.tb-question-text.tb-rich > p
 *         "text " <span.tb-fill-slot[data-blank="N"]>
 *           span.tb-fill-wrap > input.tb-fill-input
 *         " more text"
 *     div.tb-submit-row > button
 *
 *   ORDERING:
 *     section.tb-question (same)
 *     ol.tb-order > li.tb-order-item.tb-c0…
 *       span.tb-order-num, span.tb-order-body > span.tb-rich
 *       span.tb-order-tools > button.tb-order-btn[aria-label="Вгору/Вниз"]
 *
 *   MATCHING:
 *     section.tb-question (same)
 *     div.tb-match
 *       div.tb-match-col   — left column (terms)
 *         button.tb-match-card > span.tb-rich
 *       div.tb-match-col   — right column (definitions)
 *         button.tb-match-card > span.tb-rich
 *     div.tb-submit-row > button  — "З'єднати N з M"
 *
 * Legacy layout (kept as fallback):
 *   .test-content-text-inner  — question text
 *   .question-option-inner    — answer blocks
 * ══════════════════════════════════════════════ */

/* ── Determine question type from tb-multi-hint icon ── */
function tbHintType(questionSection) {
  const hint = questionSection && questionSection.querySelector('.tb-multi-hint');
  if (!hint) return null;
  const svg = hint.querySelector('svg');
  if (!svg) return null;
  const cls = svg.className && svg.className.baseVal ? svg.className.baseVal : (svg.getAttribute('class') || '');
  if (/list-ordered/i.test(cls))      return 'ordering';
  if (/keyboard/i.test(cls))          return 'keyboard';
  if (/square-check/i.test(cls))      return 'checkbox';
  if (/arrow-left-right/i.test(cls))  return 'matching';
  if (/text-cursor-input/i.test(cls)) return 'fill_blank';
  if (/square-chevron-down/i.test(cls)) return 'fill_blank';
  if (/columns.?3|columns-3/i.test(cls)) return 'categorize';
  return null;
}

/* ── Beta (tb-*) layout ── */
function detectNaurokBeta() {
  const qs = [];

  const questionSection = document.querySelector('section.tb-question');
  if (!questionSection || isOwnPanel(questionSection)) return qs;

  // tb-stagebox wraps both section.tb-question and the answer area —
  // using it as containerEl lets imgSearchRoots find images in the question text.
  const stageBox = questionSection.closest('.tb-stagebox') || questionSection.parentElement || questionSection;

  const qTextEl = questionSection.querySelector('.tb-question-text');
  const qText = qTextEl ? qTextEl.textContent.trim() : '';

  // For fill_blank the question text lives in div.tb-fill-text, not in section —
  // so we must NOT exit early when qText is empty if that type is detected.
  const hintType = tbHintType(questionSection);
  if (!qText && hintType !== 'fill_blank') return qs;

  // ── 1. Open-ended: form.tb-type-answer > input.tb-big-input ──
  if (hintType === 'keyboard') {
    const typeAnswerForm = document.querySelector('form.tb-type-answer');
    if (typeAnswerForm && !isOwnPanel(typeAnswerForm)) {
      const inputEl = typeAnswerForm.querySelector('input.tb-big-input');
      if (inputEl) {
        qs.push({
          questionText: qText,
          options: [],
          optionEls: [inputEl],
          inputEl,
          containerEl: stageBox,
          type: 'open_ended',
        });
        return qs;
      }
    }
  }

  // ── 2. Fill-in-the-blank: div.tb-fill-text with input.tb-fill-input or select.tb-fill-select gaps ──
  if (hintType === 'fill_blank') {
    const fillContainer = document.querySelector('div.tb-question.tb-fill-text');
    if (fillContainer && !isOwnPanel(fillContainer)) {
      const inputs  = Array.from(fillContainer.querySelectorAll('input.tb-fill-input')).filter(el => !isOwnPanel(el));
      const selects = Array.from(fillContainer.querySelectorAll('select.tb-fill-select')).filter(el => !isOwnPanel(el));
      const fields  = inputs.length ? inputs : selects; // prefer inputs, fall back to selects

      if (fields.length >= 1) {
        const richEl = fillContainer.querySelector('.tb-question-text.tb-rich');
        let qTextFull = qText;
        if (richEl) {
          const clone = richEl.cloneNode(true);
          clone.querySelectorAll('.tb-fill-slot').forEach((slot, i) => {
            slot.replaceWith(`___${i + 1}___`);
          });
          qTextFull = clone.textContent.trim();
        }
        if (!qTextFull && richEl) qTextFull = richEl.textContent.trim();
        if (!qTextFull) qTextFull = fillContainer.textContent.trim().slice(0, 200);

        // For select fields, collect the choices per slot so AI can pick from them
        const slotOptions = selects.length ? selects.map(sel =>
          Array.from(sel.options)
            .filter(o => o.value !== '')
            .map(o => o.text.trim())
        ) : [];

        qs.push({
          questionText: qTextFull,
          // pass all choices flattened as options so AI prompt shows them
          options: slotOptions.flat(),
          slotOptions,  // per-slot choices for select type
          optionEls: fields,
          inputEls: fields,
          containerEl: stageBox,
          type: 'fill_blank',
          _tbFillInputs: inputs.length ? inputs : null,
          _tbFillSelects: selects.length ? selects : null,
        });
        return qs;
      }
    }
  }

  // ── 3. Ordering: ol.tb-order > li.tb-order-item ──
  if (hintType === 'ordering') {
    const orderList = document.querySelector('ol.tb-order');
    if (orderList && !isOwnPanel(orderList)) {
      const items = Array.from(orderList.querySelectorAll('li.tb-order-item'))
        .filter(el => !isOwnPanel(el));
      if (items.length >= 2) {
        const options = items.map(li => {
          const body = li.querySelector('.tb-order-body .tb-rich, .tb-order-body');
          return (body || li).textContent.trim();
        }).filter(Boolean);
        if (options.length >= 2) {
          qs.push({
            questionText: qText,
            options,
            optionEls: items,
            containerEl: stageBox,
            type: 'ordering',
            _tbOrderList: orderList,
          });
          return qs;
        }
      }
    }
  }

  // ── 4. Matching: div.tb-match > div.tb-match-col × 2 ──
  if (hintType === 'matching') {
    const matchBox = document.querySelector('div.tb-match');
    if (matchBox && !isOwnPanel(matchBox)) {
      const cols = Array.from(matchBox.querySelectorAll(':scope > div.tb-match-col'));
      if (cols.length === 2) {
        const leftCards  = Array.from(cols[0].querySelectorAll('button.tb-match-card')).filter(el => !isOwnPanel(el));
        const rightCards = Array.from(cols[1].querySelectorAll('button.tb-match-card')).filter(el => !isOwnPanel(el));
        if (leftCards.length >= 1 && rightCards.length >= 1) {
          const leftOptions  = leftCards.map(btn => (btn.querySelector('.tb-rich') || btn).textContent.trim());
          const rightOptions = rightCards.map(btn => (btn.querySelector('.tb-rich') || btn).textContent.trim());
          qs.push({
            questionText: qText,
            options: leftOptions,
            rightOptions,
            optionEls: leftCards,
            leftEls: leftCards,
            rightEls: rightCards,
            containerEl: stageBox,
            type: 'matching',
            _tbMatchBox: matchBox,
          });
          return qs;
        }
      }
    }
  }

  // ── 5. Categorize: div.tb-cat-pool + div.tb-cat-groups ──
  if (hintType === 'categorize') {
    const pool   = document.querySelector('div.tb-cat-pool');
    const groups = document.querySelector('div.tb-cat-groups');
    if (pool && groups && !isOwnPanel(pool)) {
      const chips = Array.from(pool.querySelectorAll('button.tb-cat-chip')).filter(el => !isOwnPanel(el));
      const groupEls = Array.from(groups.querySelectorAll('div.tb-cat-group')).filter(el => !isOwnPanel(el));
      if (chips.length >= 1 && groupEls.length >= 1) {
        const options     = chips.map(btn => (btn.querySelector('.tb-rich') || btn).textContent.trim());
        const rightOptions = groupEls.map(g => (g.querySelector('.tb-cat-title') || g).textContent.trim());
        qs.push({
          questionText: qText,
          options,
          rightOptions,
          optionEls: chips,
          leftEls:   chips,
          rightEls:  groupEls,
          containerEl: stageBox,
          type: 'matching',   // reuse matching pipeline — pairs chip→group
          _tbCatPool:   pool,
          _tbCatGroups: groups,
        });
        return qs;
      }
    }
  }

  // ── 6. Checkbox (multiple correct) / Radio (single correct) ──
  const answersContainer = document.querySelector('div.tb-answers[role="group"]');
  if (!answersContainer || isOwnPanel(answersContainer)) return qs;

  const answerBtns = Array.from(answersContainer.querySelectorAll('button.tb-answer'))
    .filter(el => !isOwnPanel(el));
  if (answerBtns.length < 2) return qs;

  const options = answerBtns.map(btn => {
    const rich = btn.querySelector('.tb-rich');
    return (rich || btn).textContent.replace(/^[A-H]\s*/, '').trim();
  }).filter(Boolean);

  if (options.length < 2) return qs;

  const isMulti = hintType === 'checkbox' || !!answersContainer.querySelector('.tb-answer-tick');

  qs.push({
    questionText: qText,
    options,
    optionEls: answerBtns,
    containerEl: stageBox,
    type: isMulti ? 'checkbox' : 'radio',
  });

  return qs;
}

/* ── Programmatically connect matching pairs via card clicks ──
 * Called from highlight.js applyMatchHighlight when q._tbMatchBox is present.
 * matchPairs: [{left: 'term text', right: 'definition text'}, ...]
 * Mechanic: click left card → click matching right card → pair connects.
 */
function applyNaurokBetaMatch(q, matchPairs) {
  if (!q._tbMatchBox) return false;

  const STEP = 150; // ms between clicks in a pair
  const PAIR_GAP = 400; // ms between pairs

  matchPairs.forEach((pair, pairIdx) => {
    setTimeout(() => {
      const cols = Array.from(q._tbMatchBox.querySelectorAll(':scope > div.tb-match-col'));
      if (cols.length < 2) return;

      const leftCards  = Array.from(cols[0].querySelectorAll('button.tb-match-card')).filter(el => !isOwnPanel(el));
      const rightCards = Array.from(cols[1].querySelectorAll('button.tb-match-card')).filter(el => !isOwnPanel(el));

      // Find left card by text match
      const leftCard = leftCards.find(btn => {
        const txt = (btn.querySelector('.tb-rich') || btn).textContent.trim();
        return txt === pair.left || txt.includes(pair.left.slice(0, 20));
      });
      // Find right card by text match
      const rightCard = rightCards.find(btn => {
        const txt = (btn.querySelector('.tb-rich') || btn).textContent.trim();
        return txt === pair.right || txt.includes(pair.right.slice(0, 20));
      });

      if (!leftCard || !rightCard) return;

      // Skip already connected cards (aria-pressed="true" means selected/locked)
      if (leftCard.getAttribute('aria-pressed') === 'true' ||
          rightCard.getAttribute('aria-pressed') === 'true') return;

      leftCard.click();
      setTimeout(() => {
        rightCard.click();
      }, STEP);
    }, pairIdx * PAIR_GAP);
  });

  return true;
}

/* ── Programmatically assign chips to category groups ──
 * Called from highlight.js applyMatchHighlight when q._tbCatPool is present.
 * matchPairs: [{left: 'chip text', right: 'group name'}, ...]
 * Mechanic: click chip → chip gets aria-pressed="true" → click target group → chip moves in.
 */
function applyNaurokBetaCategorize(q, matchPairs) {
  if (!q._tbCatPool || !q._tbCatGroups) return false;

  const STEP = 150;
  const PAIR_GAP = 400;

  matchPairs.forEach((pair, pairIdx) => {
    setTimeout(() => {
      // Re-query live DOM — chips move out of pool after each assignment
      const chips  = Array.from(q._tbCatPool.querySelectorAll('button.tb-cat-chip')).filter(el => !isOwnPanel(el));
      const groupEls = Array.from(q._tbCatGroups.querySelectorAll('div.tb-cat-group')).filter(el => !isOwnPanel(el));

      const chip = chips.find(btn => {
        const txt = (btn.querySelector('.tb-rich') || btn).textContent.trim();
        return txt === pair.left || txt.includes(pair.left.slice(0, 20));
      });
      const group = groupEls.find(g => {
        const title = (g.querySelector('.tb-cat-title') || g).textContent.trim();
        return title === pair.right || title.includes(pair.right.slice(0, 20));
      });

      if (!chip || !group) return;
      chip.click();
      setTimeout(() => group.click(), STEP);
    }, pairIdx * PAIR_GAP);
  });

  return true;
}

/* ── Programmatically reorder tb-order items using ↑ buttons ──
 * Called from highlight.js applyOrderHighlight when q._tbOrderList is present.
 */
function applyNaurokBetaOrder(q, targetOrder) {
  if (!q._tbOrderList) return false;

  const list = q._tbOrderList;
  const STEP = 80;

  function getItems() {
    return Array.from(list.querySelectorAll('li.tb-order-item')).filter(el => !isOwnPanel(el));
  }

  function clickUpBtn(li) {
    for (const btn of li.querySelectorAll('button.tb-order-btn')) {
      const lbl = (btn.getAttribute('aria-label') || '').toLowerCase();
      if (/вгору|вверх|up/i.test(lbl) && !btn.disabled) {
        btn.click();
        return true;
      }
    }
    return false;
  }

  const targetTexts = targetOrder.map(idx => q.options[idx] || '');
  let delay = 0;

  targetTexts.forEach((targetText, targetPos) => {
    setTimeout(() => {
      const MAX_CLICKS = q.options.length * q.options.length;
      let clicks = 0;
      const move = () => {
        const items = getItems();
        const currentPos = items.findIndex(li => {
          const body = li.querySelector('.tb-order-body .tb-rich, .tb-order-body');
          return (body || li).textContent.trim() === targetText;
        });
        if (currentPos < 0 || currentPos === targetPos || clicks >= MAX_CLICKS) return;
        if (currentPos > targetPos) {
          clickUpBtn(items[currentPos]);
          clicks++;
          setTimeout(move, STEP);
        }
      };
      move();
    }, delay);
    delay += q.options.length * STEP * 2;
  });

  return true;
}

/* ── Legacy layout ── */
function detectNaurokLegacy() {
  const qs = [];

  const qTextEl = document.querySelector(
    '.test-content-text-inner, .test-question-content-inner, .question-text, .test-content-text'
  );
  const qText = qTextEl ? qTextEl.textContent.trim() : '';
  if (!qText) return qs;

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

  const testOpts = Array.from(document.querySelectorAll(
    '.test-option, .answer-block, [class*="option-block"]'
  )).filter(el => !isOwnPanel(el) && el.textContent.trim().length > 0);
  if (testOpts.length >= 2) {
    const options = testOpts.map(el => el.textContent.trim()).filter(Boolean);
    qs.push({ questionText: qText, options, optionEls: testOpts, containerEl: document.body, type: 'radio' });
  }

  return qs;
}

/* ── Public entry point ── */
function detectNaurok() {
  const beta = detectNaurokBeta();
  if (beta.length) return beta;
  return detectNaurokLegacy();
}
