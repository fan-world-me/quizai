// Quiz AI Analyzer - content module: detect/helpers.js
// Shared DOM helpers for detectors (sort containers, text lookup)
'use strict';

/* ═════════════ SORT/ORDERING ═════════════ */
function findSortContainers() {
  const results = [];
  const orderKW = /послідовн|порядок|розташуй|впорядку|хронолог|черговіст|sequence|arrange|order/i;
  for (const sel of ['.v-test-sort-block','.v-test-sort-row','[class*="sort-block"]','[class*="sort-row"]','.flex-col-test']) {
    const els = document.querySelectorAll(sel);
    if (!els.length) continue;
    const parents = new Set(Array.from(els).map(e => e.parentElement).filter(p => p && !isOwnPanel(p)));
    parents.forEach(parent => {
      const items = Array.from(parent.querySelectorAll(sel));
      if (items.length < 2) return;
      const qText = findTextAbove(parent) || findTextInParent(parent);
      if (qText) results.push({ questionText: qText, options: items.map(e => e.textContent.trim()), optionEls: items, containerEl: parent, type: 'ordering' });
    });
    if (results.length) return results;
  }
  document.querySelectorAll('.flex-row-test,.flex-col-test,[class*="flex-row"],[class*="flex-col"]').forEach(container => {
    if (isOwnPanel(container)) return;
    const qText = findTextAbove(container) || findTextInParent(container);
    if (!qText || !orderKW.test(qText)) return;
    const items = Array.from(container.children).filter(el => el.textContent.trim().length > 2 && !isOwnPanel(el));
    if (items.length >= 2)
      results.push({ questionText: qText, options: items.map(e => e.textContent.trim()), optionEls: items, containerEl: container, type: 'ordering' });
  });
  return results;
}

function findTextAbove(el) {
  let cur = el.previousElementSibling;
  for (let i = 0; i < 6 && cur; i++, cur = cur.previousElementSibling) {
    if (isOwnPanel(cur)) continue;
    const t = cur.textContent.trim();
    if (t.length > 4 && t.length < 1500) return t;
  }
  let p = el.parentElement;
  if (p) {
    let sib = p.previousElementSibling;
    for (let i = 0; i < 4 && sib; i++, sib = sib.previousElementSibling) {
      if (isOwnPanel(sib)) continue;
      const t = sib.textContent.trim();
      if (t.length > 4 && t.length < 1500) return t;
    }
  }
  return null;
}

function findTextInParent(el) {
  const check = (root) => {
    if (!root || isOwnPanel(root)) return null;
    const cands = Array.from(root.querySelectorAll('.v-test-questions-title,.question-text,.question-title,h1,h2,h3,h4,h5,legend,p'));
    for (const c of cands) {
      if (isOwnPanel(c) || el.contains(c) || c.contains(el)) continue;
      const t = c.textContent.trim();
      if (t.length > 4 && t.length < 1500) return t;
    }
    return null;
  };
  return check(el.parentElement) || check(el.parentElement?.parentElement);
}

function innerQuestionText(block) {
  for (const s of ['.question-text','.question-title','legend','h1','h2','h3','h4','p','strong']) {
    const el = block.querySelector(s);
    if (el && !isOwnPanel(el)) { const t = el.textContent.trim(); if (t.length > 4 && t.length < 1500) return t; }
  }
  return null;
}

function commonAncestor(els) {
  if (!els.length) return null;
  let a = els[0].parentElement;
  while (a && a !== document.documentElement) {
    if (els.every(e => a.contains(e))) return a;
    a = a.parentElement;
  }
  return null;
}
