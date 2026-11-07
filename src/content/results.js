// Quiz AI Analyzer - content module: results.js
// Results rendering, history, cache, panel position
'use strict';

function renderResults(results) {
  const box = floatingPanel && floatingPanel.querySelector('#__qresults');
  if (!box) return;
  if (!results.length) { box.innerHTML = ''; return; }
  const shown = results.slice(0, 5);
  box.innerHTML = '<div class="__qdiv"></div>' + shown.map(r => {
    if (!r.success) {
      return `<div class="__qresult-item er">
          <div class="__qresult-q">${esc(r.question.slice(0, 70))}${r.question.length > 70 ? '…' : ''}</div>
          <div class="__qresult-a er">&#10005; ${esc(r.error || 'Не знайдено')}</div>
        </div>`;
    }
    if (r.type === 'ordering') {
      const orderText = r.orderItems.map((item, i) => `<b>${i + 1}.</b> ${esc(item.slice(0, 40))}`).join('<br>');
      return `<div class="__qresult-item">
          <div class="__qresult-q">${esc(r.question.slice(0, 70))}${r.question.length > 70 ? '…' : ''}</div>
          <div class="__qresult-order">${orderText}</div>
        </div>`;
    }
    if (r.type === 'matching') {
      const matchText = r.pairs.map(p => `<b>${esc(p.left.slice(0, 25))}</b> → ${esc(p.right.slice(0, 25))}`).join('<br>');
      return `<div class="__qresult-item">
          <div class="__qresult-q">${esc(r.question.slice(0, 70))}${r.question.length > 70 ? '…' : ''}</div>
          <div class="__qresult-match">${matchText}</div>
        </div>`;
    }
    const answersText = r.answers.map(a => `&#10003; ${esc(a.slice(0, 60))}`).join('<br>');
    return `<div class="__qresult-item">
        <div class="__qresult-q">${esc(r.question.slice(0, 70))}${r.question.length > 70 ? '…' : ''}</div>
        <div class="__qresult-a" style="display:block;line-height:1.7;">${answersText}</div>
      </div>`;
  }).join('');
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* ═════════════ HISTORY ═════════════ */
/* ═════════════ HISTORY ═════════════ */
// Offline history for last 3 analyzed questions
// Created by fan_world_me
function saveToHistory(results) {
  try {
    const history = loadHistory();
    const timestamp = Date.now();
    results.forEach(r => {
      if (r.success) {
        history.unshift({
          question: r.question,
          answer: r.answers ? r.answers.join(', ') : (r.orderItems ? r.orderItems.join(' → ') : (r.pairs ? r.pairs.map(p => `${p.left}→${p.right}`).join(', ') : '')),
          type: r.type,
          timestamp
        });
      }
    });
    const trimmed = history.slice(0, 3);
    localStorage.setItem('__qaz_history', JSON.stringify(trimmed));
  } catch (_) {}
}

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem('__qaz_history')) || [];
  } catch (_) {
    return [];
  }
}

function renderHistory() {
  const historyList = floatingPanel && floatingPanel.querySelector('#__qhistory-list');
  if (!historyList) return;
  const history = loadHistory();
  if (!history.length) {
    historyList.innerHTML = '<div class="__qhistory-empty">Історія порожня<br>Проаналізуйте тест щоб побачити результати тут</div>';
    return;
  }
  historyList.innerHTML = history.map((h, idx) => {
    const timeAgo = formatTimeAgo(h.timestamp);
    return `<div class="__qhistory-item" data-idx="${idx}" style="cursor:pointer;">
        <div class="__qhistory-q">${esc(h.question.slice(0, 60))}${h.question.length > 60 ? '…' : ''}</div>
        <div class="__qhistory-a">${esc(h.answer.slice(0, 80))}${h.answer.length > 80 ? '…' : ''}</div>
        <div class="__qhistory-time">${timeAgo}</div>
      </div>`;
  }).join('');

  // Add click handlers to show full answer
  historyList.querySelectorAll('.__qhistory-item').forEach(item => {
    item.addEventListener('click', () => {
      const idx = parseInt(item.getAttribute('data-idx'), 10);
      const h = history[idx];
      if (!h) return;
      const box = floatingPanel && floatingPanel.querySelector('#__qresults');
      if (box) {
        box.innerHTML = `<div class="__qdiv"></div>
          <div class="__qresult-item">
            <div class="__qresult-q">${esc(h.question)}</div>
            <div class="__qresult-a" style="display:block;font-size:12px;line-height:1.6;color:rgba(255,255,255,0.95);">
              ${esc(h.answer).replace(/\n/g,'<br>')}
            </div>
          </div>`;
      }
    });
  });
}

function formatTimeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'щойно';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} хв тому`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} год тому`;
  const days = Math.floor(hours / 24);
  return `${days} дн тому`;
}

/* ═════════════ CACHE ═════════════ */
// Answer caching system - fan_world_me
function getCacheKey(question, options) {
  const normalized = question.toLowerCase().trim() + '|' + (options || []).join('|').toLowerCase();
  return 'qaz_cache_' + btoa(normalized).slice(0, 50);
}

function getCachedAnswer(question, options) {
  try {
    const key = getCacheKey(question, options);
    const cached = localStorage.getItem(key);
    if (!cached) return null;
    const data = JSON.parse(cached);
    const age = Date.now() - data.timestamp;
    if (age > 7 * 24 * 60 * 60 * 1000) {
      localStorage.removeItem(key);
      return null;
    }
    return data.answer;
  } catch (_) {
    return null;
  }
}

function setCachedAnswer(question, options, answer) {
  try {
    const key = getCacheKey(question, options);
    localStorage.setItem(key, JSON.stringify({
      answer,
      timestamp: Date.now()
    }));
  } catch (_) {}
}

function savePos(x, y) { try { localStorage.setItem('__qaz_p', JSON.stringify({ x, y })); } catch (_) {} }
function loadPos()      { try { return JSON.parse(localStorage.getItem('__qaz_p')) || {};  } catch (_) { return {}; } }
