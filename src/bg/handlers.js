// Quiz AI Analyzer - background module: handlers.js
// Author: fan_world_me
function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['enabled', 'enabledProviders', 'geminiApiKey', 'geminiApiKeys', 'groqApiKey', 'groqApiKeys', 'nvidiaApiKey', 'nvidiaApiKeys', 'openrouterApiKey', 'openrouterApiKeys', 'apiKey', 'provider'], async (data) => {
      const geminiKeys = uniqueNonEmpty([
        ...parseApiKeys(data.geminiApiKeys, 'gemini'),
        ...parseApiKeys(data.geminiApiKey, 'gemini'),
      ]);
      const groqKeys = uniqueNonEmpty([
        ...parseApiKeys(data.groqApiKeys, 'groq'),
        ...parseApiKeys(data.groqApiKey, 'groq'),
        ...(String(data.provider || '') === 'groq' ? parseApiKeys(data.apiKey, 'groq') : []),
      ]);
      const nvidiaKeys = uniqueNonEmpty([
        ...parseApiKeys(data.nvidiaApiKeys, 'nvidia'),
        ...parseApiKeys(data.nvidiaApiKey, 'nvidia'),
      ]);
      const openrouterKeys = uniqueNonEmpty([
        ...parseApiKeys(data.openrouterApiKeys, 'openrouter'),
        ...parseApiKeys(data.openrouterApiKey, 'openrouter'),
      ]);
      const keyCounts = await getProviderKeyCounts();
      const enabledProviders = normalizeProviderList(data.enabledProviders);
      const [bundledGeminiKeys, bundledGroqKeys, bundledNvidiaKeys, bundledOpenrouterKeys] = await Promise.all([
        getBundledKeys('gemini'),
        getBundledKeys('groq'),
        getBundledKeys('nvidia'),
        getBundledKeys('openrouter'),
      ]);
      resolve({
        enabled: data.enabled !== false,
        hasBuiltinKeys: geminiKeys.length > 0 || groqKeys.length > 0 || nvidiaKeys.length > 0 || openrouterKeys.length > 0 || bundledGeminiKeys.length > 0 || bundledGroqKeys.length > 0 || bundledNvidiaKeys.length > 0 || bundledOpenrouterKeys.length > 0,
        version: APP_VERSION,
        statusLabel: getStatusLabel(lastMeta),
        usage: lastUsage,
        fallbackLabel: formatProviderList(enabledProviders),
        enabledProviders,
        providerOrder: PROVIDER_ORDER,
        keyCounts,
        lastAttemptTrace,
      });
    });
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'ANALYZE_QUIZ') {
    handleAnalyzeQuiz(message.data, sendResponse);
    return true;
  }
  if (message.type === 'GET_SETTINGS') {
    getSettings().then((settings) => {
      if (chrome.runtime.lastError) return;
      sendResponse(settings);
    }).catch(() => {});
    return true;
  }
  if (message.type === 'CAPTURE_AREA') {
    handleCapture(sender, sendResponse);
    return true;
  }
  if (message.type === 'ANALYZE_IMAGE') {
    handleAnalyzeImage(message.data, sendResponse);
    return true;
  }
  if (message.type === 'TEST_CONNECTION') {
    handleTestConnection(sendResponse);
    return true;
  }
  if (message.type === 'LWS_RUN') {
    handleLwsRun(message, sender, sendResponse);
    return true;
  }
});

async function handleTestConnection(sendResponse) {
  try {
    const enabledProviders = await getEnabledProviders();
    const results = [];

    for (const provider of enabledProviders) {
      const startTime = Date.now();
      try {
        const keys = await getProviderKeys(provider);
        if (!keys.length) {
          results.push(`${PROVIDER_LABELS[provider]}: no key`);
          continue;
        }

        const apiKey = keys[0];
        let response;

        if (provider === 'groq') {
          response = await fetch('https://api.groq.com/openai/v1/models', {
            headers: { 'Authorization': `Bearer ${apiKey}` }
          });
        } else if (provider === 'nvidia') {
          response = await fetch('https://integrate.api.nvidia.com/v1/models', {
            headers: { 'Authorization': `Bearer ${apiKey}` }
          });
        } else if (provider === 'gemini') {
          response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        } else if (provider === 'openrouter') {
          response = await fetch('https://openrouter.ai/api/v1/models', {
            headers: { 'Authorization': `Bearer ${apiKey}` }
          });
        }

        const elapsed = Date.now() - startTime;
        if (response && response.ok) {
          results.push(`${PROVIDER_LABELS[provider]}: ${elapsed}ms`);
        } else {
          results.push(`${PROVIDER_LABELS[provider]}: error ${response?.status || 'unknown'}`);
        }
      } catch (err) {
        const elapsed = Date.now() - startTime;
        results.push(`${PROVIDER_LABELS[provider]}: ${err.message} (${elapsed}ms)`);
      }
    }

    if (chrome.runtime.lastError) return;
    sendResponse({
      success: true,
      provider: results.join(' | ')
    });
  } catch (err) {
    if (chrome.runtime.lastError) return;
    sendResponse({ error: err.message });
  }
}

async function handleCapture(sender, sendResponse) {
  try {
    const windowId = sender.tab && sender.tab.windowId;
    const tabId = sender.tab && sender.tab.id;
    const tabsApi = (typeof browser !== 'undefined' && browser.tabs) ? browser.tabs : chrome.tabs;
    let dataUrl = '';

    try {
      if (typeof tabsApi.captureTab === 'function' && Number.isInteger(tabId)) {
        dataUrl = await tabsApi.captureTab(tabId, { format: 'jpeg', quality: 92 });
      } else {
        throw new Error('captureTab unavailable');
      }
    } catch (firstErr) {
      try {
        dataUrl = await tabsApi.captureVisibleTab(windowId, { format: 'jpeg', quality: 92 });
      } catch (secondErr) {
        try {
          dataUrl = await tabsApi.captureVisibleTab(undefined, { format: 'jpeg', quality: 92 });
        } catch (thirdErr) {
          if (typeof chrome.tabs.captureTab === 'function' && Number.isInteger(tabId)) {
            dataUrl = await chrome.tabs.captureTab(tabId, { format: 'jpeg', quality: 92 });
          } else {
            throw thirdErr || secondErr || firstErr;
          }
        }
      }
    }

    if (chrome.runtime.lastError) return;
    sendResponse({ base64: dataUrl.replace(/^data:image\/\w+;base64,/, '') });
  } catch (err) {
    if (chrome.runtime.lastError) return;
    sendResponse({
      error: `Capture failed: ${err.message}`,
      needsLocalCapture: true
    });
  }
}

async function handleAnalyzeImage(data, sendResponse) {
  try {
    const result = await analyzeImageWithFallback(data.base64);
    const answer = cleanImageAnalysisText(result.text || '');

    if (chrome.runtime.lastError) return;
    sendResponse({
      success: true,
      answer,
      meta: result.meta,
      statusLabel: getStatusLabel(result.meta),
      usage: result.meta?.usage || null,
    });
  } catch (err) {
    if (chrome.runtime.lastError) return;
    sendResponse({ error: err.message });
  }
}
// --- Rewritten handler: prefer providers for Kahoot-originated requests ---
async function handleAnalyzeQuiz(data, sendResponse) {
  try {
    const qType = (data.questionType || 'radio').toLowerCase();
    const isKahoot = !!(data && data.source && /kahoot/i.test(String(data.source)));

    // Pictures attached by the content script (any platform except Kahoot, which sends its own screenshot):
    // merge them into one JPEG and use the vision pipeline instead of text-only.
    let imageNote = '';
    if (!isKahoot && Array.isArray(data.images) && data.images.length && !data.imageBase64) {
      try {
        const built = await buildVisionImage(data.images);
        if (built.base64) {
          data.imageBase64 = built.base64;
          imageNote = buildImageNote(built);
        }
      } catch (_) { /* no usable pictures - continue with text only */ }
      delete data.images;
    } else if (!isKahoot && data.imageBase64) {
      imageNote = buildImageNote(null);
    }

    if (qType === 'open_ended' || qType === 'short_answer') {
      const r = await answerOpenEndedWithProviders(data.question, data.imageBase64 || '', data.mediaContext || '');
      if (chrome.runtime.lastError) return;
      sendResponse({ success: true, answer: { answer: r.answer }, meta: r.meta, statusLabel: getStatusLabel(r.meta), usage: r.meta?.usage || null });
      return;
    }

    // Use Kahoot-optimized flows when content signals kahoot source
    if (data && data.source && /kahoot/i.test(String(data.source))) {
      if (qType === 'slider') {
        const r = await answerSliderWithProviders(data.question, data.sliderConfig || {});
        if (chrome.runtime.lastError) return;
        sendResponse({ success: true, answer: { value: r.value }, meta: r.meta, statusLabel: getStatusLabel(r.meta), usage: r.meta?.usage || null });
        return;
      }

      if (qType === 'jumble' || qType === 'ordering') {
        const r = await answerJumbleWithProviders(data.question, data.options || [], data.imageBase64 || '', data.mediaContext || '');
        if (chrome.runtime.lastError) return;
        sendResponse({ success: true, answer: { orderIndices: r.orderIndices, answerWord: r.answerWord }, meta: r.meta, statusLabel: getStatusLabel(r.meta), usage: r.meta?.usage || null });
        return;
      }

      if (qType === 'open_ended' || qType === 'short_answer') {
        const r = await answerOpenEndedWithProviders(data.question, data.imageBase64 || '', data.mediaContext || '');
        if (chrome.runtime.lastError) return;
        sendResponse({ success: true, answer: { answer: r.answer }, meta: r.meta, statusLabel: getStatusLabel(r.meta), usage: r.meta?.usage || null });
        return;
      }

      // Multi-select / checkbox
      if (qType === 'checkbox' || qType === 'multiple_select_quiz' || Array.isArray(data.options) && data.options.length > 4) {
        const r = await answerMultiSelectWithProviders(data.question, data.options || [], data.imageBase64 || '', data.mediaContext || '');
        if (chrome.runtime.lastError) return;
        sendResponse({ success: true, answer: { correctIndices: r.correctIndices }, meta: r.meta, statusLabel: getStatusLabel(r.meta), usage: r.meta?.usage || null });
        return;
      }

      // Default: single-choice
      const r = await answerQuestionWithProviders(data.question, data.options || [], data.imageBase64 || '', data.mediaContext || '');
      if (chrome.runtime.lastError) return;
      sendResponse({ success: true, answer: { correctIndices: r.correctIndices }, meta: r.meta, statusLabel: getStatusLabel(r.meta), usage: r.meta?.usage || null });
      return;
    }

    // Fallback: original generic pipeline
    const prompt = buildPrompt(data.question, data.options, data.questionType || 'radio', data.rightOptions);

    // Question has a picture: vision models first (same prompt, same answer format).
    if (data.imageBase64 && !isKahoot) {
      const visionPrompt = `${imageNote}\n\n${prompt}`;
      let vResult = await analyzeImageWithFallback(data.imageBase64, visionPrompt);
      let vParsed = parseAIResponse(vResult.text, data.options, data.questionType || 'radio', data.rightOptions);

      if (!hasParsedAnswer(vParsed, data.questionType || 'radio')) {
        try {
          const retryPrompt = `${visionPrompt}

The previous response ignored the format. Reply now with the final answer only.
Your first characters must be "ANSWER:" (or "ORDER:"/"MATCHING:" for that task type).`;
          const vRetry = await analyzeImageWithFallback(data.imageBase64, retryPrompt);
          const retryParsed = parseAIResponse(vRetry.text, data.options, data.questionType || 'radio', data.rightOptions);
          if (hasParsedAnswer(retryParsed, data.questionType || 'radio')) {
            vResult = vRetry;
            vParsed = retryParsed;
          }
        } catch (_) { /* keep the first response */ }
      }

      if (chrome.runtime.lastError) return;
      sendResponse({
        success: true,
        answer: vParsed,
        model: `${vResult.meta.provider}/${vResult.meta.model}`,
        meta: vResult.meta,
        statusLabel: getStatusLabel(vResult.meta),
        usage: vResult.meta?.usage || null,
      });
      return;
    }
    let result = await analyzeTextWithFallback(prompt, data);
    let parsed = parseAIResponse(result.text, data.options, data.questionType || 'radio', data.rightOptions);

    if (!hasParsedAnswer(parsed, data.questionType || 'radio')) {
      const retryPrompt = `${prompt}

The previous response ignored the format. Reply now with the final answer only.
Your first characters must be "ANSWER:" (or "ORDER:"/"MATCHING:" for that task type).`;
      const retry = await tryGeminiTextModel(retryPrompt, GEMINI_TEXT_MODELS[0], GEMINI_TIER);
      if (retry.success) {
        const retryParsed = parseAIResponse(retry.text, data.options, data.questionType || 'radio', data.rightOptions);
        if (hasParsedAnswer(retryParsed, data.questionType || 'radio')) {
          result = retry;
          parsed = retryParsed;
        }
      }
    }

    if (chrome.runtime.lastError) return;
    sendResponse({
      success: true,
      answer: parsed,
      model: `${result.meta.provider}/${result.meta.model}`,
      meta: result.meta,
      statusLabel: getStatusLabel(result.meta),
      usage: result.meta?.usage || null,
    });
  } catch (err) {
    if (chrome.runtime.lastError) return;
    sendResponse({ error: err.message });
  }
}
