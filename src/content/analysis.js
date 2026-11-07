// Quiz AI Analyzer - content module: analysis.js
// captureElementForAnalysis, runAnalysis, processAnswer
'use strict';

async function captureElementForAnalysis(el) {
  if (!el || !isElementVisible(el)) return '';
  const rect = el.getBoundingClientRect();
  const vw = window.innerWidth || document.documentElement.clientWidth || 1;
  const vh = window.innerHeight || document.documentElement.clientHeight || 1;
  const pad = 16;
  const x1 = Math.max(0, Math.floor(rect.left - pad));
  const y1 = Math.max(0, Math.floor(rect.top - pad));
  const x2 = Math.min(vw, Math.ceil(rect.right + pad));
  const y2 = Math.min(vh, Math.ceil(rect.bottom + pad));
  const w = x2 - x1;
  const h = y2 - y1;
  if (w < 40 || h < 40) return '';
  return captureAreaBase64({ x: x1, y: y1, w, h, dpr: window.devicePixelRatio || 1 });
}

/* ═════════════ ANALYSIS ═════════════ */
function runAnalysis() {
  if (isAnalyzing) cancelCurrentAnalysis(false);

  // Cancel previous request if exists
  if (abortController) {
    abortController.abort();
  }
  abortController = new AbortController();
  currentRequestId++;
  const thisRequestId = currentRequestId;

  clearAll(); lastResults = []; renderResults([]);

  const questions = findQuestions();
  if (!questions.length) {
    setStat('Питань не знайдено', 'er');
    return;
  }

  isAnalyzing = true;
  showProgress(questions.length);
  let done = 0;

  const next = (i) => {
    // Ignore if this is an old request
    if (thisRequestId !== currentRequestId) {
      return;
    }

    if (i >= questions.length) {
      isAnalyzing = false;
      abortController = null;
      hideProgress();
      setStat(`Готово: ${done}/${questions.length}`, done > 0 ? 'ok' : 'er');
      // Ensure progress is hidden after toast
      setTimeout(() => hideProgress(), 100);
      renderResults(lastResults);
      saveToHistory(lastResults);
      renderHistory();
      openPanel();
      return;
    }
    setProgress(i + 1, questions.length);
    setStat(`Аналіз ${i + 1}/${questions.length}…`, 'an');

    const q = questions[i];

    /* Kahoot multiplayer phone mode — no options on screen, show tip and stop */
    if (q.noOptions) {
      isAnalyzing = false;
      hideProgress();
      setStat('📺 Питання на TV', '');
      openPanel();
      const box = floatingPanel && floatingPanel.querySelector('#__qresults');
      if (box) box.innerHTML = `<div class="__qdiv"></div><div class="__qresult-item"><div class="__qresult-q">📺 Kahoot мультиплеєр</div><div class="__qresult-a" style="display:block;font-size:12px;line-height:1.6;color:rgba(255,255,255,0.95);">${esc(q.questionText)}</div></div>`;
      return;
    }

    const msgData = {
      question: q.questionText,
      options:  q.options,
      questionType: q.type,
      source: window.location.hostname
    };
    if (q.mediaContext) msgData.mediaContext = q.mediaContext;
    if (q.type === 'matching') {
      msgData.rightOptions = q.rightOptions;
    }

    /* Check cache first */
    const cached = getCachedAnswer(q.questionText, q.options);
    if (cached) {
      setStat('📦 З кешу', 'ok');
      processAnswer(cached, q, () => next(i + 1), () => done++);
      return;
    }

    const sendQuizRequest = () => safeSendRuntimeMessage({ type: 'ANALYZE_QUIZ', data: msgData }, (res) => {
      if (thisRequestId !== currentRequestId) return;
      if (res && res.success && res.answer) {
        const ans = res.answer;
        setCachedAnswer(q.questionText, q.options, ans);
        if (res.statusLabel) setStat(res.statusLabel, 'ok');
        if (floatingPanel) {
          const eng = floatingPanel.querySelector('#__qenginestatus');
          const fabMeta = floatingPanel.querySelector('#__qfabmeta');
          const usage = floatingPanel.querySelector('#__qusage');
          const reset = floatingPanel.querySelector('#__qusagereset');
          const statusLabel = res.statusLabel || 'Engine: auto';
          if (eng) eng.textContent = statusLabel;
          if (fabMeta) fabMeta.textContent = statusLabel;
          if (usage) usage.textContent = res.usage?.remainingText || 'Немає даних';
          if (reset) reset.textContent = res.usage?.resetText || 'очікує запит';
        }

        processAnswer(ans, q, () => next(i + 1), () => done++);
      } else {
        const errMsg = (res && res.error) ? res.error : 'Помилка запиту';
        lastResults.push({ success: false, question: q.questionText, error: errMsg.slice(0, 60) });
        setStat(errMsg.slice(0, 90), 'er');
        setTimeout(() => next(i + 1), 120);
      }
    });

    if (/kahoot/i.test(window.location.hostname) && q.captureEl) {
      captureElementForAnalysis(q.captureEl)
        .then((base64) => {
          if (thisRequestId !== currentRequestId) return;
          if (base64) msgData.imageBase64 = base64;
          sendQuizRequest();
        })
        .catch(() => sendQuizRequest());
    } else {
      sendQuizRequest();
    }
  };

  next(0);
}

/* Helper function to process answer (used for both cached and fresh answers) */
function processAnswer(ans, q, callback, onDone) {
  if (q.type === 'matching' && ans.matchPairs && ans.matchPairs.length) {
    applyMatchHighlight(q, ans.matchPairs);
    lastResults.push({
      success: true, type: 'matching',
      question: q.questionText,
      pairs: ans.matchPairs,
    });
    if (onDone) onDone();
  } else if (q.type === 'ordering' && ((ans.orderIndices && ans.orderIndices.length) || ans.answerWord)) {
    const orderIndices = ans.orderIndices && ans.orderIndices.length ? ans.orderIndices : inferOrderFromAnswerWord(q.options, ans.answerWord);
    applyOrderHighlight(q, orderIndices);
    lastResults.push({
      success: true, type: 'ordering',
      question: q.questionText,
      orderItems: orderIndices.map(idx => q.options[idx] || '?'),
    });
    if (onDone) onDone();
  } else if ((q.type === 'open_ended' || q.type === 'short_answer') && (ans.answer || ans.textAnswer || ans.rawResponse)) {
    const textAnswer = String(ans.answer || ans.textAnswer || ans.rawResponse || '').trim();
    applyOpenAnswerHighlight(q, textAnswer);
    lastResults.push({
      success: true, type: 'open_ended',
      question: q.questionText,
      answers: [textAnswer],
    });
    if (onDone) onDone();
  } else if (ans.correctIndices && ans.correctIndices.length) {
    applyHighlight(q, ans);
    lastResults.push({
      success: true, type: q.type,
      question: q.questionText,
      answers: ans.correctIndices.map(idx => q.options[idx] || '?'),
    });
    if (onDone) onDone();
  } else {
    // AI returned response but couldn't parse answer - show explanation instead
    const explanation = ans.explanation || ans.rawResponse || 'Немає відповіді';
    lastResults.push({
      success: true,
      question: q.questionText,
      answers: [explanation.slice(0, 200)],
      type: 'text'
    });
    if (onDone) onDone();
  }
  setTimeout(callback, 120);
}
