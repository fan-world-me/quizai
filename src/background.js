const ENGINE_COOLDOWN_MS = 15 * 60 * 1000;
const APP_VERSION = chrome.runtime.getManifest().version;
const FALLBACK_LABEL = 'Gemini 2.5 -> Gemini 2 -> Groq';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const AUTH_CONFIG_URL = chrome.runtime.getURL('auth.json');

const GEMINI_TEXT_25 = ['gemini-2.5-flash-lite', 'gemini-2.5-flash'];
const GEMINI_TEXT_2 = ['gemini-2.0-flash-lite', 'gemini-2.0-flash'];
const GEMINI_VISION_25 = ['gemini-2.5-flash-lite', 'gemini-2.5-flash'];
const GEMINI_VISION_2 = ['gemini-2.0-flash-lite', 'gemini-2.0-flash'];

const GROQ_TEXT_MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'llama3-8b-8192'];
const GROQ_VISION_MODELS = [
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'meta-llama/llama-4-maverick-17b-128e-instruct',
  'llama-3.2-90b-vision-preview',
  'llama-3.2-11b-vision-preview',
];

const engineState = new Map();
let lastMeta = null;
let lastUsage = null;
let lastAttemptTrace = [];
let authConfigPromise = null;

function uniqueNonEmpty(values) {
  return [...new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean))];
}

function parseApiKeys(value, provider) {
  if (Array.isArray(value)) {
    return uniqueNonEmpty(value);
  }

  const raw = String(value || '').trim();
  if (!raw) return [];

  if (provider === 'gemini') {
    const matches = raw.match(/AIza[0-9A-Za-z_\-]{20,}/g);
    if (matches && matches.length) return uniqueNonEmpty(matches);
  }

  if (provider === 'groq') {
    const matches = raw.match(/gsk_[0-9A-Za-z_\-]+/g);
    if (matches && matches.length) return uniqueNonEmpty(matches);
  }

  return uniqueNonEmpty(raw.split(/[\s,;\n\r\t]+/));
}

function readStorage(keys) {
  return new Promise((resolve) => chrome.storage.sync.get(keys, resolve));
}

async function loadAuthConfig() {
  if (!authConfigPromise) {
    authConfigPromise = fetch(AUTH_CONFIG_URL)
      .then((res) => (res.ok ? res.json() : {}))
      .catch(() => ({}));
  }
  return authConfigPromise;
}

async function getBundledKeys(provider) {
  const auth = await loadAuthConfig();
  if (provider === 'gemini') return uniqueNonEmpty(auth?.geminiKeys);
  if (provider === 'groq') return uniqueNonEmpty(auth?.groqKeys);
  return [];
}

async function getProviderKeys(provider) {
  const data = await readStorage(['apiKey', 'geminiApiKey', 'geminiApiKeys', 'groqApiKey', 'groqApiKeys', 'provider']);

  if (provider === 'gemini') {
    const userKeys = uniqueNonEmpty([
      ...parseApiKeys(data.geminiApiKeys, 'gemini'),
      ...parseApiKeys(data.geminiApiKey, 'gemini'),
    ]);
    return userKeys.length ? userKeys : await getBundledKeys('gemini');
  }

  const userKeys = uniqueNonEmpty([
    ...parseApiKeys(data.groqApiKeys, 'groq'),
    ...parseApiKeys(data.groqApiKey, 'groq'),
    ...(String(data.provider || '') === 'groq' ? parseApiKeys(data.apiKey, 'groq') : []),
  ]);
  return userKeys.length ? userKeys : await getBundledKeys('groq');
}

async function getProviderKeyCounts() {
  const [geminiKeys, groqKeys] = await Promise.all([
    getProviderKeys('gemini'),
    getProviderKeys('groq'),
  ]);
  return {
    gemini: geminiKeys.length,
    groq: groqKeys.length,
  };
}

function getStateKey(provider, tier, model, keyIndex) {
  return `${provider}:${tier}:${model}:${keyIndex}`;
}

function getEngineState(provider, tier, model, keyIndex) {
  return engineState.get(getStateKey(provider, tier, model, keyIndex)) || { blockedUntil: 0 };
}

function blockEngine(provider, tier, model, keyIndex) {
  engineState.set(getStateKey(provider, tier, model, keyIndex), {
    blockedUntil: Date.now() + ENGINE_COOLDOWN_MS,
  });
}

function clearEngineBlock(provider, tier, model, keyIndex) {
  engineState.delete(getStateKey(provider, tier, model, keyIndex));
}

function isEngineAvailable(provider, tier, model, keyIndex) {
  return getEngineState(provider, tier, model, keyIndex).blockedUntil <= Date.now();
}

function formatModelLabel(provider, model) {
  const known = {
    'gemini-2.5-flash-lite': 'Gemini 2.5 Flash Lite',
    'gemini-2.5-flash': 'Gemini 2.5 Flash',
    'gemini-2.0-flash-lite': 'Gemini 2 Flash Lite',
    'gemini-2.0-flash': 'Gemini 2 Flash',
    'llama-3.3-70b-versatile': 'Groq Llama 3.3 70B',
    'llama-3.1-8b-instant': 'Groq Llama 3.1 8B',
    'llama3-8b-8192': 'Groq Llama 3 8B',
    'meta-llama/llama-4-scout-17b-16e-instruct': 'Groq Llama 4 Scout',
    'meta-llama/llama-4-maverick-17b-128e-instruct': 'Groq Llama 4 Maverick',
    'llama-3.2-90b-vision-preview': 'Groq Llama 3.2 90B Vision',
    'llama-3.2-11b-vision-preview': 'Groq Llama 3.2 11B Vision',
  };
  return known[model] || `${provider.toUpperCase()} ${model}`;
}

function getStatusLabel(meta) {
  if (!meta) return 'Engine: auto';
  const totalKeys = Number(meta.totalKeys) > 0 ? meta.totalKeys : '?';
  return `${formatModelLabel(meta.provider, meta.model)} | key ${meta.keyIndex + 1}/${totalKeys}`;
}

function readHeader(headers, names) {
  for (const name of names) {
    const value = headers.get(name);
    if (value != null && value !== '') return value;
  }
  return '';
}

function extractUsage(provider, headers) {
  if (!headers) return null;

  const remaining = readHeader(headers, [
    'x-ratelimit-remaining-requests',
    'x-ratelimit-remaining',
    'ratelimit-remaining',
    'x-ratelimit-remaining-minute',
  ]);
  const limit = readHeader(headers, [
    'x-ratelimit-limit-requests',
    'x-ratelimit-limit',
    'ratelimit-limit',
    'x-ratelimit-limit-minute',
  ]);
  const reset = readHeader(headers, [
    'x-ratelimit-reset-requests',
    'x-ratelimit-reset',
    'ratelimit-reset',
    'retry-after',
  ]);

  if (!remaining && !limit && !reset) {
    return {
      provider,
      remainingText: 'Немає даних',
      resetText: '',
      source: 'unavailable',
    };
  }

  return {
    provider,
    remainingText: remaining && limit ? `${remaining}/${limit}` : (remaining || limit || 'Немає даних'),
    resetText: reset ? `скидання: ${reset}` : '',
    source: 'headers',
  };
}

function rememberSuccessfulCall(provider, model, keyIndex, tier, headers, totalKeys) {
  lastMeta = { provider, model, keyIndex, tier, totalKeys };
  lastUsage = extractUsage(provider, headers);
  return { ...lastMeta, usage: lastUsage };
}

function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['enabled', 'geminiApiKey', 'geminiApiKeys', 'groqApiKey', 'groqApiKeys', 'apiKey', 'provider'], async (data) => {
      const geminiKeys = uniqueNonEmpty([
        ...parseApiKeys(data.geminiApiKeys, 'gemini'),
        ...parseApiKeys(data.geminiApiKey, 'gemini'),
      ]);
      const groqKeys = uniqueNonEmpty([
        ...parseApiKeys(data.groqApiKeys, 'groq'),
        ...parseApiKeys(data.groqApiKey, 'groq'),
        ...(String(data.provider || '') === 'groq' ? parseApiKeys(data.apiKey, 'groq') : []),
      ]);
      const keyCounts = await getProviderKeyCounts();
      const [bundledGeminiKeys, bundledGroqKeys] = await Promise.all([
        getBundledKeys('gemini'),
        getBundledKeys('groq'),
      ]);
      resolve({
        enabled: data.enabled !== false,
        hasBuiltinKeys: geminiKeys.length > 0 || groqKeys.length > 0 || bundledGeminiKeys.length > 0 || bundledGroqKeys.length > 0,
        version: APP_VERSION,
        statusLabel: getStatusLabel(lastMeta),
        usage: lastUsage,
        fallbackLabel: FALLBACK_LABEL,
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
    getSettings().then(sendResponse);
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
});

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

    sendResponse({ base64: dataUrl.replace(/^data:image\/\w+;base64,/, '') });
  } catch (err) {
    sendResponse({
      error: `Capture failed: ${err.message}`,
      needsLocalCapture: true
    });
  }
}

async function handleAnalyzeImage(data, sendResponse) {
  try {
    const result = await analyzeImageWithFallback(data.base64);
    sendResponse({
      success: true,
      answer: result.text,
      meta: result.meta,
      statusLabel: getStatusLabel(result.meta),
      usage: result.meta?.usage || null,
    });
  } catch (err) {
    sendResponse({ error: err.message });
  }
}

// --- Kahoot-adapted helpers (use existing Gemini/Groq fallback functions) ---

async function answerQuestionWithProviders(title, choices) {
  if (!Array.isArray(choices) || choices.length === 0) throw new Error('No answer choices provided.');
  const numbered = choices.map((c, i) => `${i + 1}) ${c}`).join('\n');
  const prompt = `Question: ${title}\n\n${numbered}\n\nReply with ONLY the number (1-${choices.length}) of the correct answer.`;

  const result = await analyzeTextWithFallback(prompt, {});
  const raw = (result?.text || '').trim();
  const match = raw.match(/\d+/);
  if (match) {
    const idx = parseInt(match[0], 10);
    if (Number.isFinite(idx) && idx >= 1 && idx <= choices.length) {
      return { correctIndices: [idx - 1], explanation: raw, meta: result.meta, rawResponse: raw };
    }
  }

  // Fallback: try matching exact text
  const cleaned = raw.replace(/^['\"]|['\"]$/g, '').trim();
  const lowered = cleaned.toLowerCase();
  let found = choices.findIndex(c => c.toLowerCase().trim() === lowered);
  if (found === -1) found = choices.findIndex(c => c.toLowerCase().includes(lowered));
  if (found === -1) found = choices.findIndex(c => lowered.includes(c.toLowerCase().trim()));
  if (found >= 0) return { correctIndices: [found], explanation: raw, meta: result.meta, rawResponse: raw };

  // Best fuzzy match
  let best = 0, bestIdx = 0;
  for (let i = 0; i < choices.length; i++) {
    const score = fuzzyScore(lowered, choices[i].toLowerCase());
    if (score > best) { best = score; bestIdx = i; }
  }
  return { correctIndices: [bestIdx], explanation: raw, meta: result.meta, rawResponse: raw };
}

async function answerMultiSelectWithProviders(title, choices) {
  if (!Array.isArray(choices) || choices.length === 0) throw new Error('No answer choices provided.');
  const numbered = choices.map((c, i) => `${i + 1}) ${c}`).join('\n');
  const prompt = `Question: ${title}\n\n${numbered}\n\nThis is a multi-select quiz — there are MULTIPLE correct answers (usually 2-4).\nFor EACH option, decide if it correctly answers the question.\nRespond with one line per option: NUMBER:YES or NUMBER:NO`;

  const result = await analyzeTextWithFallback(prompt, {});
  const raw = (result?.text || '').trim();
  const yesNums = [];
  for (const line of raw.split('\n')) {
    const m = line.match(/(\d+)\s*:\s*(YES|Y)/i);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n >= 1 && n <= choices.length) yesNums.push(n - 1);
    }
  }
  if (yesNums.length > 0) return { correctIndices: [...new Set(yesNums)], explanation: raw, meta: result.meta, rawResponse: raw };

  // Fallback: parse all numbers
  const nums = [...raw.matchAll(/\d+/g)].map(m => parseInt(m[0], 10) - 1).filter(n => n >= 0 && n < choices.length);
  if (nums.length > 0) return { correctIndices: [...new Set(nums)], explanation: raw, meta: result.meta, rawResponse: raw };

  // Final fallback: pick single best
  const single = await answerQuestionWithProviders(title, choices);
  return { correctIndices: single.correctIndices, explanation: single.explanation, meta: single.meta, rawResponse: single.rawResponse };
}

async function answerOpenEndedWithProviders(title) {
  const prompt = `Quiz question: "${title}"\n\nThis is a fill-in-the-blank or short answer quiz question. Give the most likely intended answer. Respond with ONLY the answer — max 20 characters, no explanation.`;
  const result = await analyzeTextWithFallback(prompt, {});
  let answer = (result?.text || '').trim().replace(/^['\"]|['\"]$/g, '');
  if (answer.length > 20) answer = answer.substring(0, 20);
  if (!answer) throw new Error('Empty answer from providers');
  return { answer, meta: result.meta, rawResponse: result.text };
}

async function answerSliderWithProviders(title, sliderConfig) {
  const { min, max, step, unit } = sliderConfig || {};
  let rangeInfo = '';
  if (min != null && max != null) rangeInfo = `\nRange: ${min} to ${max} (step: ${step || 'unknown'})`;
  const prompt = `Question: ${title}\n\nThis is a slider question on a quiz. You need to pick the correct numeric value.${rangeInfo}\n\nReply with ONLY a single number. No words, no units, no punctuation — just the number.`;
  const result = await analyzeTextWithFallback(prompt, {});
  const raw = (result?.text || '').trim();
  const cleaned = raw.replace(/[\s,]/g, '');
  const match = cleaned.match(/[\d.]+/);
  if (!match) throw new Error(`Could not parse slider answer: "${raw}"`);
  const value = parseFloat(match[0]);
  if (isNaN(value)) throw new Error(`Could not parse slider answer: "${raw}"`);
  return { value, meta: result.meta, rawResponse: raw };
}

async function answerJumbleWithProviders(title, tiles) {
  const tileList = tiles.map(t => `"${t}"`).join(', ');
  const prompt = `Question: ${title}\n\nThe answer is formed by arranging these tiles in the correct order: ${tileList}\n\nWhat word or phrase do these tiles spell when arranged correctly to answer the question? Reply with ONLY the answer word/phrase. Nothing else.`;
  const result = await analyzeTextWithFallback(prompt, {});
  const raw = (result?.text || '').trim().replace(/^['\"]|['\"]$/g, '');
  return { answerWord: raw, meta: result.meta, rawResponse: result.text };
}

async function answerPinWithProviders(title, imageBase64) {
  if (!imageBase64) throw new Error('No image for pin question');
  const res = await analyzeImageWithFallback(imageBase64);
  // Try to parse coordinates from text
  const raw = (res?.text || '').trim();
  const lines = raw.split('\n').reverse();
  for (const line of lines) {
    const m = line.match(/(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/);
    if (m) {
      return { coords: { x: Math.max(0, Math.min(100, parseFloat(m[1]))), y: Math.max(0, Math.min(100, parseFloat(m[2]))) }, meta: res.meta, rawResponse: raw };
    }
  }
  throw new Error('Could not parse pin coordinates');
}

function fuzzyScore(a, b) {
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.85;
  const wordsA = a.split(/\s+/).filter(Boolean);
  const wordsB = b.split(/\s+/).filter(Boolean);
  if (wordsA.length === 0 || wordsB.length === 0) return 0;
  const overlap = wordsA.filter(w => wordsB.some(wb => wb.includes(w) || w.includes(wb))).length;
  return overlap / Math.max(wordsA.length, wordsB.length);
}

// --- Rewritten handler: prefer providers for Kahoot-originated requests ---
async function handleAnalyzeQuiz(data, sendResponse) {
  try {
    // Use Kahoot-optimized flows when content signals kahoot source
    if (data && data.source && /kahoot/i.test(String(data.source))) {
      // Map question types and dispatch
      const qType = (data.questionType || 'radio').toLowerCase();
      if (qType === 'pin_it' || qType === 'pin') {
        // Expect imageBase64 in data.imageBase64 (content capture) or ask caller to capture
        const imageBase64 = data.imageBase64 || data.base64 || null;
        if (!imageBase64) { sendResponse({ error: 'No image provided for pin question' }); return; }
        const r = await answerPinWithProviders(data.question, imageBase64);
        sendResponse({ success: true, answer: { coords: r.coords }, meta: r.meta, statusLabel: getStatusLabel(r.meta), usage: r.meta?.usage || null });
        return;
      }

      if (qType === 'slider') {
        const r = await answerSliderWithProviders(data.question, data.sliderConfig || {});
        sendResponse({ success: true, answer: { value: r.value }, meta: r.meta, statusLabel: getStatusLabel(r.meta), usage: r.meta?.usage || null });
        return;
      }

      if (qType === 'jumble') {
        const r = await answerJumbleWithProviders(data.question, data.options || []);
        sendResponse({ success: true, answer: { answerWord: r.answerWord }, meta: r.meta, statusLabel: getStatusLabel(r.meta), usage: r.meta?.usage || null });
        return;
      }

      if (qType === 'open_ended' || qType === 'short_answer') {
        const r = await answerOpenEndedWithProviders(data.question);
        sendResponse({ success: true, answer: { answer: r.answer }, meta: r.meta, statusLabel: getStatusLabel(r.meta), usage: r.meta?.usage || null });
        return;
      }

      // Multi-select / checkbox
      if (qType === 'checkbox' || qType === 'multiple_select_quiz' || Array.isArray(data.options) && data.options.length > 4) {
        const r = await answerMultiSelectWithProviders(data.question, data.options || []);
        sendResponse({ success: true, answer: { correctIndices: r.correctIndices }, meta: r.meta, statusLabel: getStatusLabel(r.meta), usage: r.meta?.usage || null });
        return;
      }

      // Default: single-choice
      const r = await answerQuestionWithProviders(data.question, data.options || []);
      sendResponse({ success: true, answer: { correctIndices: r.correctIndices }, meta: r.meta, statusLabel: getStatusLabel(r.meta), usage: r.meta?.usage || null });
      return;
    }

    // Fallback: original generic pipeline
    const prompt = buildPrompt(data.question, data.options, data.questionType || 'radio', data.rightOptions);
    const result = await analyzeTextWithFallback(prompt, data);
    const parsed = parseAIResponse(result.text, data.options, data.questionType || 'radio', data.rightOptions);

    sendResponse({
      success: true,
      answer: parsed,
      model: `${result.meta.provider}/${result.meta.model}`,
      meta: result.meta,
      statusLabel: getStatusLabel(result.meta),
      usage: result.meta?.usage || null,
    });
  } catch (err) {
    sendResponse({ error: err.message });
  }
}

async function analyzeTextWithFallback(prompt, data) {
  const attempts = [];

  for (const model of GEMINI_TEXT_25) {
    const result = await tryGeminiTextModel(prompt, model, 'gemini-2.5');
    if (result.success) return result;
    attempts.push(result.error);
  }

  for (const model of GEMINI_TEXT_2) {
    const result = await tryGeminiTextModel(prompt, model, 'gemini-2');
    if (result.success) return result;
    attempts.push(result.error);
  }

  for (const model of GROQ_TEXT_MODELS) {
    const result = await tryGroqTextModel(prompt, model, 'groq');
    if (result.success) {
      lastAttemptTrace = attempts.filter(Boolean);
      return result;
    }
    attempts.push(result.error);
  }

  lastAttemptTrace = attempts.filter(Boolean);
  throw new Error(attempts.filter(Boolean).join('\n') || 'No available engine');
}

async function analyzeImageWithFallback(base64) {
  const prompt = 'Read the test question from the image, determine the correct answer, and briefly explain it.';
  const attempts = [];

  for (const model of GEMINI_VISION_25) {
    const result = await tryGeminiVisionModel(prompt, base64, model, 'gemini-2.5');
    if (result.success) return result;
    attempts.push(result.error);
  }

  for (const model of GEMINI_VISION_2) {
    const result = await tryGeminiVisionModel(prompt, base64, model, 'gemini-2');
    if (result.success) return result;
    attempts.push(result.error);
  }

  for (const model of GROQ_VISION_MODELS) {
    const result = await tryGroqVisionModel(prompt, base64, model, 'groq');
    if (result.success) {
      lastAttemptTrace = attempts.filter(Boolean);
      return result;
    }
    attempts.push(result.error);
  }

  lastAttemptTrace = attempts.filter(Boolean);
  throw new Error(attempts.filter(Boolean).join('\n') || 'No available engine');
}

async function tryGeminiTextModel(prompt, model, tier) {
  let lastError = '';
  const geminiKeys = await getProviderKeys('gemini');

  for (let keyIndex = 0; keyIndex < geminiKeys.length; keyIndex++) {
    if (!isEngineAvailable('gemini', tier, model, keyIndex)) continue;

    const apiKey = geminiKeys[keyIndex];
    try {
      const res = await fetch(`${GEMINI_BASE}/${model}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 500 },
          safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
          ],
        }),
      });

      if (!res.ok) {
        const msg = await readErrorMessage(res);
        if (res.status === 429 || /quota|rate|limit/i.test(msg)) {
          blockEngine('gemini', tier, model, keyIndex);
          lastError = `Gemini ${tier} ${model} key #${keyIndex + 1}: limit`;
          continue;
        }
        if (res.status === 400 || res.status === 401 || res.status === 403) {
          blockEngine('gemini', tier, model, keyIndex);
          lastError = `Gemini ${tier} ${model} key #${keyIndex + 1}: ${msg}`;
          continue;
        }
        lastError = `Gemini ${tier} ${model} key #${keyIndex + 1}: ${msg}`;
        continue;
      }

      const payload = await res.json();
      const text = payload.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (!text) {
        lastError = `Gemini ${tier} ${model} key #${keyIndex + 1}: empty response`;
        continue;
      }

      clearEngineBlock('gemini', tier, model, keyIndex);
      return {
        success: true,
        text,
        meta: rememberSuccessfulCall('gemini', model, keyIndex, tier, res.headers, geminiKeys.length),
      };
    } catch (err) {
      lastError = `Gemini ${tier} ${model} key #${keyIndex + 1}: ${err.message}`;
    }
  }

  return { success: false, error: lastError || `Gemini ${tier} ${model}: unavailable` };
}

async function tryGeminiVisionModel(prompt, base64, model, tier) {
  let lastError = '';
  const geminiKeys = await getProviderKeys('gemini');

  for (let keyIndex = 0; keyIndex < geminiKeys.length; keyIndex++) {
    if (!isEngineAvailable('gemini', tier, model, keyIndex)) continue;

    const apiKey = geminiKeys[keyIndex];
    try {
      const res = await fetch(`${GEMINI_BASE}/${model}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [
            { text: prompt },
            { inlineData: { mimeType: 'image/jpeg', data: base64 } },
          ] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 600 },
        }),
      });

      if (!res.ok) {
        const msg = await readErrorMessage(res);
        if (res.status === 429 || /quota|rate|limit/i.test(msg)) {
          blockEngine('gemini', tier, model, keyIndex);
          lastError = `Gemini ${tier} ${model} key #${keyIndex + 1}: limit`;
          continue;
        }
        if (res.status === 400 || res.status === 401 || res.status === 403) {
          blockEngine('gemini', tier, model, keyIndex);
          lastError = `Gemini ${tier} ${model} key #${keyIndex + 1}: ${msg}`;
          continue;
        }
        lastError = `Gemini ${tier} ${model} key #${keyIndex + 1}: ${msg}`;
        continue;
      }

      const payload = await res.json();
      const text = payload.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (!text) {
        lastError = `Gemini ${tier} ${model} key #${keyIndex + 1}: empty response`;
        continue;
      }

      clearEngineBlock('gemini', tier, model, keyIndex);
      return {
        success: true,
        text,
        meta: rememberSuccessfulCall('gemini', model, keyIndex, tier, res.headers, geminiKeys.length),
      };
    } catch (err) {
      lastError = `Gemini ${tier} ${model} key #${keyIndex + 1}: ${err.message}`;
    }
  }

  return { success: false, error: lastError || `Gemini ${tier} ${model}: unavailable` };
}

async function tryGroqTextModel(prompt, model, tier) {
  let lastError = '';
  const groqKeys = await getProviderKeys('groq');

  for (let keyIndex = 0; keyIndex < groqKeys.length; keyIndex++) {
    if (!isEngineAvailable('groq', tier, model, keyIndex)) continue;

    const apiKey = groqKeys[keyIndex];
    try {
      const res = await fetch(GROQ_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
          max_tokens: 500,
        }),
      });

      if (!res.ok) {
        const msg = await readErrorMessage(res);
        if (res.status === 429 || /quota|rate|limit/i.test(msg)) {
          blockEngine('groq', tier, model, keyIndex);
          lastError = `Groq ${model} key #${keyIndex + 1}: limit`;
          continue;
        }
        if (res.status === 401 || res.status === 403) {
          blockEngine('groq', tier, model, keyIndex);
          lastError = `Groq ${model} key #${keyIndex + 1}: ${msg}`;
          continue;
        }
        lastError = `Groq ${model} key #${keyIndex + 1}: ${msg}`;
        continue;
      }

      const payload = await res.json();
      const text = payload.choices?.[0]?.message?.content || '';
      if (!text) {
        lastError = `Groq ${model} key #${keyIndex + 1}: empty response`;
        continue;
      }

      clearEngineBlock('groq', tier, model, keyIndex);
      return {
        success: true,
        text,
        meta: rememberSuccessfulCall('groq', model, keyIndex, tier, res.headers, groqKeys.length),
      };
    } catch (err) {
      lastError = `Groq ${model} key #${keyIndex + 1}: ${err.message}`;
    }
  }

  return { success: false, error: lastError || `Groq ${model}: unavailable` };
}

async function tryGroqVisionModel(prompt, base64, model, tier) {
  let lastError = '';
  const groqKeys = await getProviderKeys('groq');

  for (let keyIndex = 0; keyIndex < groqKeys.length; keyIndex++) {
    if (!isEngineAvailable('groq', tier, model, keyIndex)) continue;

    const apiKey = groqKeys[keyIndex];
    try {
      const res = await fetch(GROQ_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } },
            ],
          }],
          temperature: 0.1,
          max_tokens: 600,
        }),
      });

      if (!res.ok) {
        const msg = await readErrorMessage(res);
        if (res.status === 429 || /quota|rate|limit/i.test(msg)) {
          blockEngine('groq', tier, model, keyIndex);
          lastError = `Groq ${model} key #${keyIndex + 1}: limit`;
          continue;
        }
        if (res.status === 401 || res.status === 403) {
          blockEngine('groq', tier, model, keyIndex);
          lastError = `Groq ${model} key #${keyIndex + 1}: ${msg}`;
          continue;
        }
        lastError = `Groq ${model} key #${keyIndex + 1}: ${msg}`;
        continue;
      }

      const payload = await res.json();
      const text = payload.choices?.[0]?.message?.content || '';
      if (!text) {
        lastError = `Groq ${model} key #${keyIndex + 1}: empty response`;
        continue;
      }

      clearEngineBlock('groq', tier, model, keyIndex);
      return {
        success: true,
        text,
        meta: rememberSuccessfulCall('groq', model, keyIndex, tier, res.headers, groqKeys.length),
      };
    } catch (err) {
      lastError = `Groq ${model} key #${keyIndex + 1}: ${err.message}`;
    }
  }

  return { success: false, error: lastError || `Groq ${model}: unavailable` };
}

async function readErrorMessage(res) {
  let msg = res.statusText || `HTTP ${res.status}`;
  try {
    const data = await res.json();
    msg = data.error?.message || msg;
  } catch (_) {}
  return msg;
}

function buildPrompt(question, options, questionType, rightOptions) {
  const list = options.map((o, i) => `${i + 1}. ${o}`).join('\n');

  if (questionType === 'ordering') {
    const letList = options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join('\n');
    return `Ти — асистент для тестів. Встанови правильний хронологічний/логічний порядок елементів.

Завдання: ${question}

Елементи:
${letList}

Відповідай ТІЛЬКИ у такому форматі:
ПОРЯДОК: A, C, B, D
ПОЯСНЕННЯ: [коротко]`;
  }

  if (questionType === 'matching') {
    const rightList = (rightOptions || []).map((r, i) => `${String.fromCharCode(65 + i)}. ${r}`).join('\n');
    return `Ти — асистент для тестів. Встанови відповідність між лівими і правими елементами.

Завдання: ${question}

Ліві елементи:
${list}

Праві елементи:
${rightList}

Відповідай ТІЛЬКИ у такому форматі:
ВІДПОВІДНІСТЬ:
1 -> A
2 -> C
3 -> B
ПОЯСНЕННЯ: [коротко]`;
  }

  if (questionType === 'checkbox') {
    const letList = options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join('\n');
    return `Ти — асистент для тестів. У цьому питанні може бути декілька правильних відповідей.

Питання: ${question}

Варіанти:
${letList}

Відповідай ТІЛЬКИ у такому форматі:
ВІДПОВІДЬ: A, C
ПОЯСНЕННЯ: [коротко]`;
  }

  const letList = options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join('\n');
  return `Ти — асистент для тестів. Визнач ОДНУ правильну відповідь.

Питання: ${question}

Варіанти:
${letList}

Відповідай ТІЛЬКИ у такому форматі:
ВІДПОВІДЬ: B
ПОЯСНЕННЯ: [коротко]`;
}

function parseAIResponse(text, options, questionType, rightOptions) {
  const expMatch = text.match(/(?:ПОЯСНЕННЯ|EXPLANATION)\s*:\s*(.+)/is);
  const explanation = expMatch ? expMatch[1].trim() : text.trim();

  if (questionType === 'matching') {
    const pairs = [];
    const lines = text.split('\n');
    let inSection = false;
    for (const line of lines) {
      if (/ВІДПОВІДНІСТЬ|MATCHES|MATCHING/i.test(line)) { inSection = true; continue; }
      if (/ПОЯСНЕННЯ|EXPLANATION/i.test(line)) break;
      if (!inSection && !/->/.test(line)) continue;
      const m = line.match(/(\S[\w\s.,'-]*?)\s*(?:->|→)\s*(\S[\w\s.,'-]*)/);
      if (!m) continue;
      const leftRaw = m[1].trim();
      const rightRaw = m[2].trim();
      const leftNum = parseInt(leftRaw, 10) - 1;
      const rightLet = /^[A-Z]$/i.test(rightRaw) ? rightRaw.toUpperCase().charCodeAt(0) - 65 : -1;
      const rightNum = parseInt(rightRaw, 10) - 1;
      const left = !Number.isNaN(leftNum) && leftNum >= 0 && leftNum < options.length ? options[leftNum] : leftRaw;
      const right = rightLet >= 0 && rightOptions && rightLet < rightOptions.length
        ? rightOptions[rightLet]
        : (!Number.isNaN(rightNum) && rightOptions && rightNum >= 0 && rightNum < rightOptions.length ? rightOptions[rightNum] : rightRaw);
      if (left && right) pairs.push({ left, right });
    }
    return { matchPairs: pairs, explanation, rawResponse: text };
  }

  if (questionType === 'ordering') {
    const m = text.match(/(?:ПОРЯДОК|ORDER|SEQUENCE)\s*:\s*([A-Za-z,\s]+)/i);
    if (m) {
      const letters = m[1].trim().toUpperCase().split(/[,\s]+/).filter((l) => /^[A-Z]$/.test(l));
      const orderIndices = letters.map((l) => l.charCodeAt(0) - 65).filter((i) => i >= 0 && i < options.length);
      if (orderIndices.length >= 2) return { orderIndices, explanation, rawResponse: text };
    }
    const allLetters = (text.match(/\b([A-Z])\b/g) || [])
      .map((l) => l.charCodeAt(0) - 65)
      .filter((i, pos, arr) => i >= 0 && i < options.length && arr.indexOf(i) === pos);
    return { orderIndices: allLetters, explanation, rawResponse: text };
  }

  let correctIndices = [];
  const ansMatch = text.match(/(?:ВІДПОВІДЬ|ANSWER)\s*:\s*([A-Za-z,\s]+)/i);
  if (ansMatch) {
    const letters = ansMatch[1].trim().toUpperCase().split(/[,;\s]+/).filter((l) => /^[A-Z]$/.test(l));
    correctIndices = letters.map((l) => l.charCodeAt(0) - 65).filter((i) => i >= 0 && i < options.length);
  }
  if (correctIndices.length === 0) {
    for (let i = 0; i < options.length; i++) {
      const letter = String.fromCharCode(65 + i);
      if (new RegExp(`\\b${letter}[.):]`).test(text.toUpperCase())) {
        correctIndices.push(i);
        if (questionType === 'radio') break;
      }
    }
  }
  return { correctIndices, explanation, rawResponse: text };
}
