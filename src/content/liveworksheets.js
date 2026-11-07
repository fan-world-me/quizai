// Quiz AI Analyzer - content module: liveworksheets.js
// liveworksheets.com worksheets are one big picture with fields on top, so there is no
// "question + options" to read. The worksheet keeps its own answer data and can display it
// locally through its jQuery plugin; this module runs that command from the panel.
'use strict';

const LWS_HOST_RE = /(^|\.)liveworksheets\.com$/i;

function isLiveWorksheetsPage() {
  return LWS_HOST_RE.test(location.hostname);
}

function lwsReasonText(reason) {
  switch (reason) {
    case 'jquery-missing':     return 'На сторінці ще немає jQuery. Дочекайся повного завантаження листа й спробуй ще раз.';
    case 'worksheet-not-found': return 'Лист не знайдено на сторінці (#worksheet-preview). Відкрий сам лист і спробуй ще раз.';
    case 'plugin-missing':     return 'Плагін листа ще не завантажився. Спробуй ще раз за кілька секунд.';
    case 'no-tab':             return 'Не вдалося визначити вкладку.';
    default:                   return 'Не вдалося запустити команду' + (reason ? ': ' + String(reason).slice(0, 80) : '.');
  }
}

/* Firefox fallback: content scripts can reach the page's objects through wrappedJSObject. */
function lwsRunViaWrappedObject(show) {
  try {
    const w = window.wrappedJSObject;
    if (!w || typeof cloneInto !== 'function') return { ok: false, reason: 'unsupported' };
    const jq = w.jQuery;
    if (typeof jq !== 'function') return { ok: false, reason: 'jquery-missing' };
    const el = jq('#worksheet-preview');
    if (!el.length) return { ok: false, reason: 'worksheet-not-found' };
    if (typeof el.worksheetPreview !== 'function') return { ok: false, reason: 'plugin-missing' };
    const opts = cloneInto({ clicked: false, showAnswers: !!show, showRightAnswers: !!show }, window);
    el.worksheetPreview('validation', opts);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: String((err && err.message) || err) };
  }
}

async function lwsRunPageCommand(show) {
  const viaBackground = await sendRuntimeMessageAsync({ type: 'LWS_RUN', show: !!show });
  if (viaBackground && viaBackground.ok) return viaBackground;
  const viaWrapped = lwsRunViaWrappedObject(show);
  if (viaWrapped.ok) return viaWrapped;
  // Prefer the more informative reason (the page problem, not "unsupported")
  if (viaWrapped.reason && viaWrapped.reason !== 'unsupported') return viaWrapped;
  return viaBackground || viaWrapped;
}

function lwsSetStatus(text, isError) {
  const el = floatingPanel && floatingPanel.querySelector('#__qlws-status');
  if (!el) return;
  el.textContent = text;
  el.className = '__qresult-a' + (isError ? ' er' : '');
}

function lwsRenderCard(statusText) {
  openPanel();
  const box = floatingPanel && floatingPanel.querySelector('#__qresults');
  if (!box) return;
  box.innerHTML = `<div class="__qdiv"></div>
    <div class="__qresult-item">
      <div class="__qresult-q">LiveWorksheets</div>
      <div class="__qresult-a" id="__qlws-status">${esc(statusText)}</div>
      <div style="margin-top:10px">
        <button type="button" class="__qbtn __qbp" id="__qlws-show">Показати відповіді</button>
        <button type="button" class="__qbtn __qbs" id="__qlws-reload">Оновити лист</button>
      </div>
    </div>`;
  const showBtn = box.querySelector('#__qlws-show');
  const reloadBtn = box.querySelector('#__qlws-reload');
  if (showBtn) showBtn.addEventListener('click', () => lwsShowAnswers());
  if (reloadBtn) reloadBtn.addEventListener('click', () => location.reload());
}

async function lwsShowAnswers() {
  lwsSetStatus('Запускаю…', false);
  setStat('LiveWorksheets…', 'an');
  const res = await lwsRunPageCommand(true);
  if (res && res.ok) {
    lwsSetStatus('Відповіді показано на листі. Це лише локальна підсвітка, у «Здати» вони не зараховуються. Щоб вводити самому, натисни «Оновити лист».', false);
    setStat('LiveWorksheets: відповіді показано', 'ok');
  } else {
    lwsSetStatus(lwsReasonText(res && res.reason), true);
    setStat('LiveWorksheets: не вдалося', 'er');
  }
}

/* Called from runAnalysis() on liveworksheets.com */
function runLiveWorksheetsAssist() {
  clearAll();
  lastResults = [];
  lwsRenderCard('Лист — це зображення з полями, тексту питань немає.');
  lwsShowAnswers();
}
