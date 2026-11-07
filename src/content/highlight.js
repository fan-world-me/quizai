// Quiz AI Analyzer - content module: highlight.js
// Answer highlighting, badges, Kahoot overlays
'use strict';

/* ═════════════ HIGHLIGHTING ═════════════ */
function applyHighlight(q, answer) {
  answer.correctIndices.forEach(idx => {
    if (idx >= q.optionEls.length) return;
    const el = /kahoot/i.test(String(q.source || location.hostname)) ? findKahootChoiceTile(q.optionEls[idx]) : q.optionEls[idx];
    if (!el || isOwnPanel(el)) return;
    el.style.setProperty('outline',        `4px solid ${C_OK}`, 'important');
    el.style.setProperty('outline-offset', '3px',               'important');
    el.style.setProperty('box-shadow',     `0 0 0 4px ${C_OK}, inset 0 0 22px rgba(0,200,81,.22)`, 'important');
    el.style.setProperty('position',       'relative',          'important');
    el.setAttribute('data-qaz-hl', '1');
    addBadge(el, '✓', C_OK);
  });
}

function applyOrderHighlight(q, orderIndices) {
  const isKahoot = /kahoot/i.test(String(q.source || location.hostname));
  if (isKahoot) {
    orderIndices.forEach((itemIdx, rank) => {
      if (itemIdx >= q.optionEls.length) return;
      const el = findKahootChoiceTile(q.optionEls[itemIdx]);
      if (!el || isOwnPanel(el)) return;
      const color = ['#00C851','#33b5e5','#FF8800','#aa66cc','#ff4444'][rank % 5];
      showKahootFixedOrderOverlay(el, rank + 1, color);
    });
    return;
  }
  orderIndices.forEach((itemIdx, rank) => {
    if (itemIdx >= q.optionEls.length) return;
    const el = q.optionEls[itemIdx];
    if (!el || isOwnPanel(el)) return;
    const color = ['#00C851','#33b5e5','#FF8800','#aa66cc','#ff4444'][rank % 5];
    el.style.setProperty('outline',        `4px solid ${color}`, 'important');
    el.style.setProperty('outline-offset', '3px', 'important');
    el.style.setProperty('box-shadow',     `0 0 0 4px ${color}, inset 0 0 18px rgba(255,255,255,.1)`, 'important');
    el.style.setProperty('position',       'relative',           'important');
    el.setAttribute('data-qaz-hl', '1');
    addBadge(el, String(rank + 1), color);
  });
}

function visuallyOrderKahootCards(q, orderIndices) {
  // Kahoot drag/drop is stateful; changing DOM order creates broken ghost UI.
  // Keep visual numbering on the original cards and show the order in the panel.
}

function inferOrderFromAnswerWord(options, answerWord) {
  const remaining = options.map((_, idx) => idx);
  const text = normalizeText(answerWord || '').toLowerCase();
  const result = [];
  while (remaining.length) {
    let bestPos = -1;
    let bestIndex = remaining[0];
    remaining.forEach((idx) => {
      const opt = normalizeText(options[idx] || '').toLowerCase();
      const pos = opt ? text.indexOf(opt) : -1;
      if (pos >= 0 && (bestPos < 0 || pos < bestPos)) {
        bestPos = pos;
        bestIndex = idx;
      }
    });
    result.push(bestIndex);
    remaining.splice(remaining.indexOf(bestIndex), 1);
    if (bestPos < 0) result.push(...remaining.splice(0));
  }
  return result;
}

/* Matching: pairs = [{left:'Foo', right:'Bar'}, ...] */
function applyMatchHighlight(q, matchPairs) {
  if (q.leftEls && q.rightEls) {
    matchPairs.forEach(pair => {
      const leftIdx = findBestTextIndex(pair.left, q.options);
      const rightIdx = findBestTextIndex(pair.right, q.rightOptions || []);
      const color = ['#00C851','#33b5e5','#FF8800','#aa66cc','#ff4444'][Math.max(0, leftIdx) % 5];
      const leftEl = leftIdx >= 0 ? q.leftEls[leftIdx] : null;
      const rightEl = rightIdx >= 0 ? q.rightEls[rightIdx] : null;
      [leftEl, rightEl].forEach((el, partIdx) => {
        if (!el || isOwnPanel(el)) return;
        el.style.setProperty('outline', `4px solid ${color}`, 'important');
        el.style.setProperty('outline-offset', '3px', 'important');
        el.style.setProperty('box-shadow', `0 0 0 4px ${color}, inset 0 0 18px rgba(255,255,255,.1)`, 'important');
        el.style.setProperty('position', 'relative', 'important');
        el.setAttribute('data-qaz-hl', '1');
        addBadge(el, partIdx === 0 ? String(leftIdx + 1) : String.fromCharCode(65 + rightIdx), color);
      });
    });
    return;
  }

  /* Highlight the select elements and set their values */
  if (!q.selectEls) return;
  matchPairs.forEach(pair => {
    /* Find which left item this corresponds to */
    const leftIdx = q.options.findIndex(o => o === pair.left || pair.left.includes(o.slice(0, 20)));
    if (leftIdx < 0 || leftIdx >= q.selectEls.length) return;
    const sel = q.selectEls[leftIdx];
    if (!sel || isOwnPanel(sel)) return;

    /* Try to select the right option */
    for (const opt of Array.from(sel.options)) {
      if (opt.text.trim() === pair.right || pair.right.includes(opt.text.trim().slice(0, 20))) {
        sel.value = opt.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        break;
      }
    }

    sel.style.setProperty('outline',     `3px solid ${C_OK}`, 'important');
    sel.style.setProperty('box-shadow',  `0 0 0 3px rgba(0,200,81,.3)`, 'important');
    sel.setAttribute('data-qaz-hl', '1');
  });
}

function applyOpenAnswerHighlight(q, answerText) {
  const input = q.inputEl || q.optionEls?.[0];
  if (!input || isOwnPanel(input)) return;
  if ('value' in input && answerText) {
    input.value = answerText;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  input.style.setProperty('outline', `4px solid ${C_OK}`, 'important');
  input.style.setProperty('outline-offset', '3px', 'important');
  input.style.setProperty('box-shadow', `0 0 0 4px ${C_OK}`, 'important');
  input.setAttribute('data-qaz-hl', '1');
  const badgeHost = input.parentElement || q.containerEl;
  if (badgeHost && !isOwnPanel(badgeHost)) {
    badgeHost.style.setProperty('position', 'relative', 'important');
    badgeHost.setAttribute('data-qaz-hl', '1');
    addBadge(badgeHost, answerText.slice(0, 16) || 'OK', C_OK);
  }
}

function findBestTextIndex(needle, haystack) {
  const n = normalizeText(needle || '').toLowerCase();
  if (!n || !Array.isArray(haystack)) return -1;
  let bestIdx = -1;
  let bestScore = 0;
  haystack.forEach((item, idx) => {
    const h = normalizeText(item || '').toLowerCase();
    if (!h) return;
    let score = 0;
    if (h === n) score = 1;
    else if (h.includes(n) || n.includes(h)) score = Math.min(h.length, n.length) / Math.max(h.length, n.length);
    else {
      const words = n.split(/\s+/).filter(Boolean);
      const overlap = words.filter(w => h.includes(w)).length;
      score = words.length ? overlap / words.length : 0;
    }
    if (score > bestScore) {
      bestScore = score;
      bestIdx = idx;
    }
  });
  return bestScore >= 0.25 ? bestIdx : -1;
}

function addBadge(el, text, color) {
  const b = document.createElement('span');
  b.className = '__qaz_badge';
  b.innerHTML = text;
  b.style.cssText = [
    'all:initial','display:inline-flex','align-items:center','justify-content:center',
    'position:absolute','top:8px','right:8px',
    'min-width:26px','height:26px','border-radius:13px',
    `background:${color}`,'color:#fff',
    text.length > 1 ? 'font-size:13px' : 'font-size:15px',
    'font-weight:700',`z-index:${Z}`,
    'box-shadow:0 2px 8px rgba(0,0,0,.35)','font-family:sans-serif',
    'pointer-events:none','line-height:1','padding:0 5px',
  ].join('!important;') + '!important;';
  el.appendChild(b);
}

function showKahootFixedOrderOverlay(el, rank, color) {
  const rect = el.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const box = document.createElement('div');
  box.className = '__qaz_badge';
  box.setAttribute('data-qaz-hl', '1');
  box.style.cssText = [
    'all:initial','position:fixed',
    `left:${rect.left}px`,`top:${rect.top}px`,
    `width:${rect.width}px`,`height:${rect.height}px`,
    'box-sizing:border-box','border-radius:10px',
    `border:7px solid ${color}`,
    'box-shadow:0 0 0 4px rgba(0,0,0,.25)',
    `z-index:${Z}`,'pointer-events:none',
  ].join('!important;') + '!important;';
  const badge = document.createElement('div');
  badge.textContent = String(rank);
  badge.style.cssText = [
    'all:initial','position:absolute','left:10px','top:10px',
    'width:46px','height:46px','border-radius:50%',
    `background:${color}`,'color:#fff','border:4px solid #fff',
    'display:flex','align-items:center','justify-content:center',
    'font:900 28px Arial,sans-serif','box-shadow:0 4px 14px rgba(0,0,0,.5)',
    'pointer-events:none',
  ].join('!important;') + '!important;';
  box.appendChild(badge);
  document.documentElement.appendChild(box);
  kahootOverlayTrackers.push({ el, box, kind: 'card' });
  startKahootOverlayTracking();
}

function startKahootOverlayTracking() {
  if (kahootOverlayFrame) return;
  const tick = () => {
    kahootOverlayFrame = 0;
    for (const item of kahootOverlayTrackers) {
      if (!item.el || !item.box || !document.documentElement.contains(item.box)) continue;
      const rect = item.el.getBoundingClientRect();
      if (!rect.width || !rect.height) {
        item.box.style.setProperty('display', 'none', 'important');
        continue;
      }
      item.box.style.setProperty('display', 'block', 'important');
      item.box.style.setProperty('left', `${rect.left}px`, 'important');
      item.box.style.setProperty('top', `${rect.top}px`, 'important');
      item.box.style.setProperty('width', `${rect.width}px`, 'important');
      item.box.style.setProperty('height', `${rect.height}px`, 'important');
    }
    if (kahootOverlayTrackers.some(item => item.box && document.documentElement.contains(item.box))) {
      kahootOverlayFrame = requestAnimationFrame(tick);
    }
  };
  kahootOverlayFrame = requestAnimationFrame(tick);
}
