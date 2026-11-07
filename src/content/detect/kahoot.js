// Quiz AI Analyzer - content module: detect/kahoot.js
// Kahoot detector and helpers
'use strict';

/* ══════════════════════════════════════════════
 * Kahoot.it
 * ══════════════════════════════════════════════ */
function detectKahootV2() {
  const qText = getKahootQuestionText() || 'Kahoot question';
  const mediaContext = getKahootMediaContext();
  const captureEl = getKahootCaptureElement();
  const base = { mediaContext, captureEl, containerEl: document.body, source: 'kahoot' };

  const jumbleEls = Array.from(document.querySelectorAll('[data-functional-selector^="draggable-jumble-card-"]'))
    .filter(el => !isOwnPanel(el) && isElementVisible(el));
  const jumbleOptions = jumbleEls.map(el => cleanKahootText(el)).filter(Boolean);
  if (jumbleOptions.length >= 2) return [{ ...base, questionText: qText, options: jumbleOptions, optionEls: jumbleEls, type: 'ordering' }];

  const textInput = document.querySelector('[data-functional-selector="text-answer-input"], input[class*="open-ended-board__Input"]');
  if (textInput && !isOwnPanel(textInput) && isElementVisible(textInput)) {
    return [{ ...base, questionText: qText, options: [], optionEls: [textInput], inputEl: textInput, type: 'open_ended' }];
  }

  let tileBtns = Array.from(document.querySelectorAll('[data-functional-selector^="question-choice-text-"]'))
    .map(el => findKahootChoiceTile(el))
    .filter((el, idx, arr) => el && !isOwnPanel(el) && arr.indexOf(el) === idx);

  if (tileBtns.length < 2) {
    tileBtns = Array.from(document.querySelectorAll('[data-functional-selector^="answer-"]'))
      .filter(el => !isOwnPanel(el) && isElementVisible(el));
  }

  if (tileBtns.length < 2) {
    tileBtns = Array.from(document.querySelectorAll('button,li,[role="button"]')).filter(el => {
      if (isOwnPanel(el)) return false;
      const ds = el.getAttribute?.('data-functional-selector') || '';
      const aria = el.getAttribute?.('aria-label') || '';
      if (/solo-top-bar|kahoot-go-toolbar|control-bar|settings|volume|game-mode/i.test(ds + ' ' + aria)) return false;
      const txt = cleanKahootText(el);
      if (!txt || txt.length > 400) return false;
      const bg = getComputedStyle(el).backgroundColor;
      if (!bg || bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 120 && rect.height > 45 && rect.top > 120;
    });
    if (tileBtns.length > 8) tileBtns = [];
  }

  const options = tileBtns.map(el => cleanKahootText(el)).filter(t => t.length > 0 && t.length < 800);
  if (tileBtns.length < 2 || options.length < 2) {
    return [{
      questionText: 'Kahoot multiplayer: this screen may show only answer colors. Use Screenshot mode to capture the shared question screen.',
      options: [],
      optionEls: [],
      containerEl: document.body,
      type: 'radio',
      noOptions: true,
    }];
  }

  const requiredCount = getKahootRequiredAnswersCount();
  const type = requiredCount > 1 ? 'checkbox' : 'radio';
  return [{ ...base, questionText: qText, options, optionEls: tileBtns, type, requiredCount }];
}

function cleanKahootText(el) {
  if (!el) return '';
  const clone = el.cloneNode(true);
  clone.querySelectorAll('script,style,svg,[data-functional-selector="icon"],.__qaz_badge').forEach(n => n.remove());
  const text = normalizeText(clone.textContent || '');
  const imageBits = Array.from(el.querySelectorAll('img')).map((img, idx) => {
    const src = img.currentSrc || img.src || '';
    const alt = normalizeText(img.alt || img.getAttribute('aria-label') || '');
    if (!alt && (!src || src.startsWith('data:'))) return '';
    return `[answer image ${idx + 1}: ${alt || 'no alt'}${src && !src.startsWith('data:') ? ` ${src}` : ''}]`;
  }).filter(Boolean);
  return [text, ...imageBits].filter(Boolean).join(' ');
}

function findKahootChoiceTile(el) {
  let cur = el;
  let best = el;
  let bestArea = 0;
  while (cur && cur !== document.body && cur !== document.documentElement) {
    const ds = cur.getAttribute?.('data-functional-selector') || '';
    if (/solo-top-bar|kahoot-go-toolbar|control-bar|settings|volume|game-mode/i.test(ds)) break;
    const rect = cur.getBoundingClientRect();
    const bg = getComputedStyle(cur).backgroundColor;
    const area = rect.width * rect.height;
    const isAnswer = /^answer-\d+$/.test(ds);
    const isQuestionChoice = /^question-choice-text-\d+$/.test(ds);
    const isJumble = /^draggable-jumble-card-\d+$/.test(ds);
    const isClickable = cur.tagName === 'BUTTON' || cur.getAttribute?.('role') === 'button';
    const isColored = bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)';
    const looksLikeTile = (isAnswer || isQuestionChoice || isJumble || (isClickable && isColored) || isColored);
    if (looksLikeTile && rect.width > 160 && rect.height > 45 && rect.top > 120 && area > bestArea) {
      best = cur;
      bestArea = area;
    }
    if (isAnswer || isJumble) break;
    cur = cur.parentElement;
  }
  return best;
}

function getKahootRequiredAnswersCount() {
  const el = document.querySelector('[data-functional-selector^="required-answers-count-"]');
  if (!el) return 0;
  const ds = el.getAttribute('data-functional-selector') || '';
  const m = ds.match(/required-answers-count-(\d+)/);
  if (m) return parseInt(m[1], 10) || 0;
  const textMatch = normalizeText(el.textContent || '').match(/\d+/);
  return textMatch ? parseInt(textMatch[0], 10) || 0 : 0;
}

function getKahootQuestionText() {
  const selectors = [
    '[data-functional-selector="block-title"]',
    '[data-functional-selector="question-title"]',
    '[class*="question-title"]',
    '[class*="questionTitle"]',
    '[class*="QuestionTitle"]',
    '[class*="title__Title"]',
    '[class*="titleText"]',
    '[class*="TitleText"]',
    '[class*="layout_title"] p',
    '[class*="layout_title"] span',
    '[class*="questionWrapper"] p',
    'h1', 'h2'
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (!el || isOwnPanel(el)) continue;
    const text = normalizeText(el.textContent || '');
    if (text.length > 2 && text.length < 600) return text;
  }
  const labelled = Array.from(document.querySelectorAll('[aria-label^="Quiz:"],[aria-label^="True or false:"]'))
    .map(el => normalizeText((el.getAttribute('aria-label') || '').replace(/^(Quiz|True or false):\s*/i, '')))
    .find(Boolean);
  if (labelled) return labelled;

  const topEls = Array.from(document.querySelectorAll('p,span,div,h1,h2,h3')).filter(el => {
    if (isOwnPanel(el) || el.children.length > 2) return false;
    const text = normalizeText(el.textContent || '');
    if (text.length < 5 || text.length > 500) return false;
    const rect = el.getBoundingClientRect();
    return rect.top >= 0 && rect.top < window.innerHeight * 0.6;
  });
  topEls.sort((a, b) => normalizeText(b.textContent || '').length - normalizeText(a.textContent || '').length);
  return topEls[0] ? normalizeText(topEls[0].textContent || '').slice(0, 400) : '';
}

function getKahootMediaContext() {
  const mediaEls = Array.from(document.querySelectorAll(
    '[data-functional-selector="media-container"] img,[data-functional-selector="media-container__media-image"],img[aria-label*="Question"][aria-label*="media"],[data-functional-selector^="question-choice-text-"] img'
  )).filter(el => !isOwnPanel(el) && isElementVisible(el));
  return mediaEls.slice(0, 8).map((img, idx) => {
    const src = img.currentSrc || img.src || img.href?.baseVal || img.getAttribute?.('href') || '';
    const alt = normalizeText(img.alt || img.getAttribute('aria-label') || '');
    if (!alt && (!src || src.startsWith('data:'))) return '';
    return `Image ${idx + 1}: ${alt || 'no alt'}${src && !src.startsWith('data:') ? ` (${src})` : ''}`;
  }).filter(Boolean).join('\n');
}

function getKahootCaptureElement() {
  const media = document.querySelector('[data-functional-selector="media-container"],[data-functional-selector="media-container__media-image"],[data-functional-selector^="question-choice-text-"] img');
  const main = document.querySelector('[data-functional-selector="main-content-container"], main');
  return media?.closest?.('main,[data-functional-selector="main-content-container"]') || main || media || null;
}

function detectKahoot() {
  /* ── Step 1: find answer TILES via data-functional-selector ── */
  /* Kahoot names them answer-0 … answer-3 (or answer-0 … answer-5) */
  let tileBtns = Array.from(document.querySelectorAll('[data-functional-selector^="answer"]'))
    .filter(el => !isOwnPanel(el));

  /* ── Step 2: if data-functional-selector not found, try layout grid children ── */
  if (tileBtns.length < 2) {
    /* Kahoot wraps answers in a grid; grab direct children of grid */
    for (const gridSel of [
      '[class*="layout_answers"] > *',
      '[class*="answers__grid"] > *',
      '[class*="answersGrid"] > *',
      '[class*="answerGrid"] > *',
      '[class*="AnswerGrid"] > *',
      '[class*="answer-grid"] > *',
      '[class*="choices"] > *',
      '[class*="options"] > *',
    ]) {
      const els = Array.from(document.querySelectorAll(gridSel)).filter(el => !isOwnPanel(el));
      if (els.length >= 2) { tileBtns = els; break; }
    }
  }

  /* ── Step 3: fallback — any button/div that has a background color and contains text ── */
  if (tileBtns.length < 2) {
    const allBtns = Array.from(document.querySelectorAll('button,li,[role="button"]'))
      .filter(el => {
        if (isOwnPanel(el)) return false;
        const txt = el.innerText?.trim();
        if (!txt || txt.length > 400) return false;
        const bg = getComputedStyle(el).backgroundColor;
        /* Kahoot tiles have vivid solid colors (not white/transparent) */
        if (!bg || bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 80 && rect.height > 50;
      });
    if (allBtns.length >= 2 && allBtns.length <= 8) tileBtns = allBtns;
  }

  if (tileBtns.length < 2) return [];

  /* ── Extract text from tiles ── */
  const options = tileBtns
    .map(el => (el.innerText || el.textContent || '').trim())
    .filter(t => t.length > 0 && t.length < 400);

  /* If tiles have NO text (multiplayer phone-only mode: only colors shown) */
  if (options.length < 2) {
    /* Return a dummy result so the panel shows a helpful message */
    return [{
      questionText: '⚠️ Kahoot мультиплеєр: питання на TV/проекторі, телефон показує лише кольори. Використай кнопку 📷 "Виділити область" щоб сфотографувати питання на екрані поряд.',
      options: [],
      optionEls: [],
      containerEl: document.body,
      type: 'radio',
      noOptions: true,
    }];
  }

  /* ── Question text ── */
  const Q_SELS = [
    '[data-functional-selector="block-title"]',
    '[data-functional-selector="question-title"]',
    '[class*="question-title"]',
    '[class*="questionTitle"]',
    '[class*="QuestionTitle"]',
    '[class*="title__Title"]',
    '[class*="titleText"]',
    '[class*="TitleText"]',
    '[class*="layout_title"] p',
    '[class*="layout_title"] span',
    '[class*="questionWrapper"] p',
    'h1', 'h2',
  ];
  let qText = '';
  for (const sel of Q_SELS) {
    const el = document.querySelector(sel);
    if (el && !isOwnPanel(el)) {
      const t = (el.innerText || el.textContent || '').trim();
      if (t.length > 2) { qText = t; break; }
    }
  }
  /* Last resort: largest leaf-text near top half of viewport */
  if (!qText) {
    const topEls = Array.from(document.querySelectorAll('p,span,div,h1,h2,h3'))
      .filter(el => {
        if (isOwnPanel(el) || el.children.length > 2) return false;
        const t = (el.innerText || el.textContent || '').trim();
        if (t.length < 5 || t.length > 500) return false;
        const r = el.getBoundingClientRect();
        return r.top >= 0 && r.top < window.innerHeight * 0.6;
      });
    topEls.sort((a, b) =>
      (b.innerText||b.textContent||'').length - (a.innerText||a.textContent||'').length
    );
    if (topEls.length) qText = (topEls[0].innerText || topEls[0].textContent || '').trim().slice(0, 400);
  }

  if (!qText) qText = 'Kahoot питання';
  return [{ questionText: qText, options, optionEls: tileBtns, containerEl: document.body, type: 'radio' }];
}
