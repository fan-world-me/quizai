// Quiz AI Analyzer - background module: liveworksheets.js
// Runs the LiveWorksheets preview command inside the page itself (MAIN world),
// because the page's jQuery plugin is not visible to content scripts.
'use strict';

// Serialized and executed in the page - must stay self-contained.
function lwsPageCommand(show) {
  try {
    var jq = window.jQuery;
    if (typeof jq !== 'function') return { ok: false, reason: 'jquery-missing' };
    var el = jq('#worksheet-preview');
    if (!el.length) return { ok: false, reason: 'worksheet-not-found' };
    if (typeof el.worksheetPreview !== 'function') return { ok: false, reason: 'plugin-missing' };
    el.worksheetPreview('validation', { clicked: false, showAnswers: !!show, showRightAnswers: !!show });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: String((err && err.message) || err) };
  }
}

async function handleLwsRun(message, sender, sendResponse) {
  try {
    const tabId = sender && sender.tab && sender.tab.id;
    if (tabId === undefined || tabId === null) {
      sendResponse({ ok: false, reason: 'no-tab' });
      return;
    }
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: lwsPageCommand,
      args: [!!(message && message.show)],
    });
    const first = results && results[0] && results[0].result;
    sendResponse(first || { ok: false, reason: 'no-result' });
  } catch (err) {
    sendResponse({ ok: false, reason: String((err && err.message) || err) });
  }
}
