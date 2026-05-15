// Quiz AI Analyzer - Background Service Worker
// Author: fan_world_me
const ENGINE_COOLDOWN_MS = 15 * 60 * 1000;
const APP_VERSION = chrome.runtime.getManifest().version;
const FALLBACK_LABEL = 'Groq → NVIDIA → Gemini → OpenRouter';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const NVIDIA_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const AUTH_CONFIG_URL = chrome.runtime.getURL('auth.json');

const NVIDIA_TEXT_MODELS = [
  'nvidia/llama-3.3-nemotron-super-49b-v1',
  'qwen/qwen3-next-80b-a3b-instruct',
  'meta/llama-3.3-70b-instruct',
  'nvidia/nemotron-3-nano-30b-a3b',
  'nvidia/llama-3.3-nemotron-super-49b-v1.5',
];
const NVIDIA_VISION_MODELS = [
  'mistralai/mistral-large-3-675b-instruct-2512',
];

const OPENROUTER_TEXT_MODELS = ['openai/gpt-oss-120b:free'];
const OPENROUTER_VISION_MODELS = ['openai/gpt-oss-120b:free'];

const GEMINI_TEXT_25 = ['gemini-2.5-flash-lite', 'gemini-2.5-flash'];
const GEMINI_TEXT_2 = ['gemini-2.0-flash-lite', 'gemini-2.0-flash'];
const GEMINI_TEXT_15 = ['gemini-1.5-flash-latest', 'gemini-1.5-flash'];
const GEMINI_VISION_25 = ['gemini-2.5-flash-lite', 'gemini-2.5-flash'];
const GEMINI_VISION_2 = ['gemini-2.0-flash-lite', 'gemini-2.0-flash'];
const GEMINI_VISION_15 = ['gemini-1.5-flash-latest', 'gemini-1.5-flash'];

const GROQ_TEXT_MODELS = [
  'llama-3.1-8b-instant',
  'qwen/qwen3-32b',
  'openai/gpt-oss-20b',
  'llama-3.3-70b-versatile',
  'openai/gpt-oss-120b',
];
const GROQ_VISION_MODELS = [
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'meta-llama/llama-4-maverick-17b-128e-instruct',
  'llama-3.2-90b-vision-preview',
  'llama-3.2-11b-vision-preview',
];

const PROVIDER_ORDER = ['groq', 'nvidia', 'gemini', 'openrouter'];
const PROVIDER_LABELS = {
  gemini: 'Gemini',
  openrouter: 'OpenRouter',
  nvidia: 'NVIDIA',
  groq: 'Groq',
};
const QUIZ_SYSTEM_PROMPT = 'You solve quiz questions. The first characters of your response MUST be the requested label: ANSWER:, ORDER:, or MATCHING:. Return only the requested short format. No markdown, no translation, no restating the question, no thinking aloud.';
const OCR_SYSTEM_PROMPT = 'You are an OCR engine for quiz screenshots. Extract visible text exactly. Preserve language, letters, numbers, and option labels. Do not translate or explain.';

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

  if (provider === 'nvidia') {
    const matches = raw.match(/nvapi-[0-9A-Za-z_\-]+/g);
    if (matches && matches.length) return uniqueNonEmpty(matches);
  }

  if (provider === 'openrouter') {
    const matches = raw.match(/sk-or-v1-[0-9a-f]+/g);
    if (matches && matches.length) return uniqueNonEmpty(matches);
  }

  return uniqueNonEmpty(raw.split(/[\s,;\n\r\t]+/));
}

function readStorage(keys) {
  return new Promise((resolve) => chrome.storage.sync.get(keys, resolve));
}

function normalizeProviderList(value) {
  const list = Array.isArray(value) ? value : PROVIDER_ORDER;
  const normalized = list.filter((provider) => PROVIDER_ORDER.includes(provider));
  return normalized.length ? [...new Set(normalized)] : [...PROVIDER_ORDER];
}

async function getEnabledProviders() {
  const data = await readStorage(['enabledProviders']);
  return normalizeProviderList(data.enabledProviders);
}

function formatProviderList(providers) {
  return normalizeProviderList(providers).map((provider) => PROVIDER_LABELS[provider]).join(' -> ');
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
  if (provider === 'nvidia') return uniqueNonEmpty(auth?.nvidiaKeys);
  if (provider === 'openrouter') return uniqueNonEmpty(auth?.openrouterKeys);
  return [];
}

async function getProviderKeys(provider) {
  const data = await readStorage(['apiKey', 'geminiApiKey', 'geminiApiKeys', 'groqApiKey', 'groqApiKeys', 'nvidiaApiKey', 'nvidiaApiKeys', 'openrouterApiKey', 'openrouterApiKeys', 'provider']);

  if (provider === 'gemini') {
    const userKeys = uniqueNonEmpty([
      ...parseApiKeys(data.geminiApiKeys, 'gemini'),
      ...parseApiKeys(data.geminiApiKey, 'gemini'),
    ]);
    return userKeys.length ? userKeys : await getBundledKeys('gemini');
  }

  if (provider === 'nvidia') {
    const userKeys = uniqueNonEmpty([
      ...parseApiKeys(data.nvidiaApiKeys, 'nvidia'),
      ...parseApiKeys(data.nvidiaApiKey, 'nvidia'),
    ]);
    return userKeys.length ? userKeys : await getBundledKeys('nvidia');
  }

  if (provider === 'openrouter') {
    const userKeys = uniqueNonEmpty([
      ...parseApiKeys(data.openrouterApiKeys, 'openrouter'),
      ...parseApiKeys(data.openrouterApiKey, 'openrouter'),
    ]);
    return userKeys.length ? userKeys : await getBundledKeys('openrouter');
  }

  const userKeys = uniqueNonEmpty([
    ...parseApiKeys(data.groqApiKeys, 'groq'),
    ...parseApiKeys(data.groqApiKey, 'groq'),
    ...(String(data.provider || '') === 'groq' ? parseApiKeys(data.apiKey, 'groq') : []),
  ]);
  return userKeys.length ? userKeys : await getBundledKeys('groq');
}

async function getProviderKeyCounts() {
  const [geminiKeys, groqKeys, nvidiaKeys, openrouterKeys] = await Promise.all([
    getProviderKeys('gemini'),
    getProviderKeys('groq'),
    getProviderKeys('nvidia'),
    getProviderKeys('openrouter'),
  ]);
  return {
    gemini: geminiKeys.length,
    groq: groqKeys.length,
    nvidia: nvidiaKeys.length,
    openrouter: openrouterKeys.length,
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
    'gemini-2.5-pro': 'Gemini 2.5 Pro',
    'gemini-2.5-flash-native-audio-preview-12-2025': 'Gemini 2.5 Flash Audio 12-2025',
    'gemini-2.5-flash-native-audio-preview-09-2025': 'Gemini 2.5 Flash Audio 09-2025',
    'gemini-2.5-flash-native-audio-latest': 'Gemini 2.5 Flash Audio Latest',
    'gemini-2.5-flash-lite': 'Gemini 2.5 Flash Lite',
    'gemini-2.5-flash': 'Gemini 2.5 Flash',
    'gemini-1.5-flash-latest': 'Gemini 1.5 Flash Latest',
    'gemini-1.5-flash': 'Gemini 1.5 Flash',
    'gemini-2.0-flash-lite': 'Gemini 2 Flash Lite',
    'gemini-2.0-flash': 'Gemini 2 Flash',
    'meta/llama-3.3-70b-instruct': 'NVIDIA Llama 3.3 70B',
    'qwen/qwen3-next-80b-a3b-instruct': 'NVIDIA Qwen3 Next 80B',
    'nvidia/nemotron-3-super-120b-a12b': 'NVIDIA Nemotron 120B',
    'nvidia/nemotron-3-nano-30b-a3b': 'NVIDIA Nemotron 3 Nano 30B',
    'nvidia/llama-3.3-nemotron-super-49b-v1.5': 'NVIDIA Nemotron Super 49B',
    'nvidia/llama-3.3-nemotron-super-49b-v1': 'NVIDIA Nemotron Super 49B v1',
    'mistralai/mistral-large-3-675b-instruct-2512': 'NVIDIA Mistral Large Vision',
    'openai/gpt-oss-120b:free': 'OpenRouter GPT-OSS 120B',
    'openai/gpt-oss-120b': 'Groq GPT-OSS 120B',
    'openai/gpt-oss-20b': 'Groq GPT-OSS 20B',
    'qwen/qwen3-32b': 'Groq Qwen3 32B',
    'llama-3.3-70b-versatile': 'Groq Llama 3.3 70B',
    'llama-3.1-8b-instant': 'Groq Llama 3.1 8B',
    'meta-llama/llama-4-scout-17b-16e-instruct': 'Groq Llama 4 Scout',
    'meta-llama/llama-4-maverick-17b-128e-instruct': 'Groq Llama 4 Maverick',
    'llama-3.2-90b-vision-preview': 'Groq Llama 3.2 90B Vision',
    'llama-3.2-11b-vision-preview': 'Groq Llama 3.2 11B Vision',
  };
  return known[model] || `${provider.toUpperCase()} ${model}`;
}

function getStatusLabel(meta) {
  if (!meta) return 'Engine: auto';
  const modelLabel = formatModelLabel(meta.provider, meta.model);
  // Show key count only for Gemini
  if (meta.provider === 'gemini') {
    const totalKeys = Number(meta.totalKeys) > 0 ? meta.totalKeys : '?';
    return `${modelLabel} | key ${meta.keyIndex + 1}/${totalKeys}`;
  }
  return modelLabel;
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
});

async function handleTestConnection(sendResponse) {
  try {
    const prompt = 'Test';
    const result = await analyzeTextWithFallback(prompt, { question: 'Test', options: ['A', 'B'], questionType: 'radio' });
    if (chrome.runtime.lastError) return;
    sendResponse({
      success: true,
      provider: result.meta?.provider || 'Unknown',
      model: result.meta?.model || 'Unknown'
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
// --- Kahoot-adapted helpers (use existing Gemini/Groq fallback functions) ---

async function answerQuestionWithProviders(title, choices, imageBase64 = '', mediaContext = '') {
  if (!Array.isArray(choices) || choices.length === 0) throw new Error('No answer choices provided.');
  if (imageBase64) {
    return answerChoiceWithVisionProviders(title, choices, 'radio', imageBase64, mediaContext);
  }
  const numbered = choices.map((c, i) => `${i + 1}) ${c}`).join('\n');
  const imageInfo = mediaContext ? `\nImage context:\n${mediaContext}\n` : '';
  const prompt = `Single-choice quiz.
Question: ${title}
${imageInfo}

Options:
${numbered}

Your first characters must be "ANSWER:".
Return exactly:
ANSWER: <one number from 1 to ${choices.length}>
EXPLANATION: <short reason>`;

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

async function answerMultiSelectWithProviders(title, choices, imageBase64 = '', mediaContext = '') {
  if (!Array.isArray(choices) || choices.length === 0) throw new Error('No answer choices provided.');
  if (imageBase64) {
    return answerChoiceWithVisionProviders(title, choices, 'checkbox', imageBase64, mediaContext);
  }
  const numbered = choices.map((c, i) => `${i + 1}) ${c}`).join('\n');
  const imageInfo = mediaContext ? `\nImage context:\n${mediaContext}\n` : '';
  const prompt = `Multi-select quiz.
Question: ${title}
${imageInfo}

Options:
${numbered}

Your first characters must be "ANSWER:".
Return exactly:
ANSWER: <correct numbers comma-separated>
EXPLANATION: <short reason>`;

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

async function answerOpenEndedWithProviders(title, imageBase64 = '', mediaContext = '') {
  if (imageBase64) {
    const prompt = `Look at this Kahoot question screenshot and answer the short/open-ended question.
Question text: ${title}
${mediaContext ? `Image context:\n${mediaContext}\n` : ''}
Return exactly:
ANSWER: <short answer only>`;
    const result = await analyzeImageWithFallback(imageBase64, prompt);
    let answer = (result?.text || '').replace(/^ANSWER:\s*/i, '').trim().replace(/^['\"]|['\"]$/g, '');
    if (answer.length > 40) answer = answer.substring(0, 40);
    if (!answer) throw new Error('Empty answer from vision providers');
    return { answer, meta: result.meta, rawResponse: result.text };
  }
  const prompt = `Quiz question: "${title}"\n${mediaContext ? `Image context:\n${mediaContext}\n` : ''}\nThis is a fill-in-the-blank or short answer quiz question. Give the most likely intended answer. Respond with ONLY the answer — max 20 characters, no explanation.`;
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

async function answerJumbleWithProviders(title, tiles, imageBase64 = '', mediaContext = '') {
  const numbered = tiles.map((t, i) => `${i + 1}) ${t}`).join('\n');
  const prompt = `Kahoot ordering/jumble question.
Question: ${title}
${mediaContext ? `Image context:\n${mediaContext}\n` : ''}
Tiles:
${numbered}

Return exactly:
ORDER: <tile numbers in the correct order, comma-separated>
ANSWER: <the final word or phrase>`;
  const result = imageBase64 ? await analyzeImageWithFallback(imageBase64, prompt) : await analyzeTextWithFallback(prompt, {});
  const raw = (result?.text || '').trim().replace(/^['\"]|['\"]$/g, '');
  const orderLine = raw.match(/ORDER\s*:\s*([0-9,\s>.-]+)/i);
  const answerLine = raw.match(/ANSWER\s*:\s*(.+)$/im);
  const answerWord = answerLine ? answerLine[1].trim() : raw.replace(/^ANSWER:\s*/i, '').trim();
  const nums = orderLine
    ? [...orderLine[1].matchAll(/\d+/g)].map(m => parseInt(m[0], 10) - 1).filter(n => n >= 0 && n < tiles.length)
    : [...raw.matchAll(/\d+/g)].map(m => parseInt(m[0], 10) - 1).filter(n => n >= 0 && n < tiles.length);
  const uniqueNums = nums.length ? [...new Set(nums)] : [];
  const inferred = inferJumbleOrderFromAnswer(tiles, answerWord);
  const orderIndices = inferred.length === tiles.length ? inferred : uniqueNums;
  return { orderIndices, answerWord, meta: result.meta, rawResponse: result.text };
}

function inferJumbleOrderFromAnswer(tiles, answerWord) {
  const answer = String(answerWord || '').replace(/\s+/g, '').toLowerCase();
  if (!answer) return [];
  const remaining = tiles.map((_, idx) => idx);
  const result = [];
  let cursor = 0;
  while (remaining.length) {
    let best = -1;
    let bestLen = -1;
    for (const idx of remaining) {
      const tile = String(tiles[idx] || '').replace(/\s+/g, '').toLowerCase();
      if (!tile) continue;
      if (answer.slice(cursor, cursor + tile.length) === tile && tile.length > bestLen) {
        best = idx;
        bestLen = tile.length;
      }
    }
    if (best < 0) return [];
    result.push(best);
    remaining.splice(remaining.indexOf(best), 1);
    cursor += bestLen;
  }
  return cursor === answer.length ? result : [];
}

async function answerChoiceWithVisionProviders(title, choices, qType, imageBase64, mediaContext = '') {
  const numbered = choices.map((c, i) => `${i + 1}) ${c}`).join('\n');
  const isMulti = qType === 'checkbox' || qType === 'multiple_select_quiz';
  const prompt = `Look at this Kahoot question screenshot. The picture may be in the question or inside one of the answers.
Question text: ${title}
${mediaContext ? `Image context:\n${mediaContext}\n` : ''}
Options:
${numbered}

Return exactly:
ANSWER: ${isMulti ? '<all correct option numbers, comma-separated>' : '<one correct option number>'}
EXPLANATION: <short reason>`;
  const result = await analyzeImageWithFallback(imageBase64, prompt);
  const raw = (result?.text || '').trim();
  const answerLine = raw.match(/ANSWER\s*:\s*([^\n]+)/i);
  const source = answerLine ? answerLine[1] : raw;
  const nums = [...source.matchAll(/\d+/g)]
    .map(m => parseInt(m[0], 10) - 1)
    .filter(n => n >= 0 && n < choices.length);
  if (nums.length) {
    return { correctIndices: [...new Set(isMulti ? nums : [nums[0]])], explanation: raw, meta: result.meta, rawResponse: raw };
  }
  const lowered = raw.toLowerCase();
  let found = choices.findIndex(c => lowered.includes(c.toLowerCase().trim()));
  if (found < 0) found = 0;
  return { correctIndices: [found], explanation: raw, meta: result.meta, rawResponse: raw };
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
    const qType = (data.questionType || 'radio').toLowerCase();
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
    let result = await analyzeTextWithFallback(prompt, data);
    let parsed = parseAIResponse(result.text, data.options, data.questionType || 'radio', data.rightOptions);

    if (!hasParsedAnswer(parsed, data.questionType || 'radio')) {
      const retryPrompt = `${prompt}

The previous response ignored the format. Reply now with the final answer only.
Your first characters must be "ANSWER:" (or "ORDER:"/"MATCHING:" for that task type).`;
      const retry = await tryGeminiTextModel(retryPrompt, GEMINI_TEXT_25[0], '2.5');
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

// Fallback system: Groq first for speed, then NVIDIA, Gemini, and OpenRouter.
// Created by fan_world_me
async function analyzeTextWithFallback(prompt, data) {
  const attempts = [];
  const enabledProviders = await getEnabledProviders();

  if (enabledProviders.includes('groq')) {
    // Priority 1: Groq fast text models.
    for (const model of GROQ_TEXT_MODELS) {
      const result = await tryGroqTextModel(prompt, model, 'text');
      if (result.success) {
        lastAttemptTrace = attempts.filter(Boolean);
        return result;
      }
      attempts.push(result.error);
    }
  }

  if (enabledProviders.includes('nvidia')) {
    // Priority 2: NVIDIA fast fallback endpoints.
    for (const model of NVIDIA_TEXT_MODELS) {
      const result = await tryNvidiaTextModel(prompt, model, 'text');
      if (result.success) {
        lastAttemptTrace = attempts.filter(Boolean);
        return result;
      }
      attempts.push(result.error);
    }
  }

  if (enabledProviders.includes('gemini')) {
    // Priority 3: Gemini for multilingual quality and screenshots.
    for (const model of GEMINI_TEXT_25) {
      const result = await tryGeminiTextModel(prompt, model, '2.5');
      if (result.success) {
        lastAttemptTrace = attempts.filter(Boolean);
        return result;
      }
      attempts.push(result.error);
    }

    for (const model of GEMINI_TEXT_2) {
      const result = await tryGeminiTextModel(prompt, model, '2.0');
      if (result.success) {
        lastAttemptTrace = attempts.filter(Boolean);
        return result;
      }
      attempts.push(result.error);
    }

    for (const model of GEMINI_TEXT_15) {
      const result = await tryGeminiTextModel(prompt, model, '1.5');
      if (result.success) {
        lastAttemptTrace = attempts.filter(Boolean);
        return result;
      }
      attempts.push(result.error);
    }
  }

  if (enabledProviders.includes('openrouter')) {
    // Priority 4: OpenRouter final text fallback.
    for (const model of OPENROUTER_TEXT_MODELS) {
      const result = await tryOpenRouterTextModel(prompt, model, 'text');
      if (result.success) {
        lastAttemptTrace = attempts.filter(Boolean);
        return result;
      }
      attempts.push(result.error);
    }
  }

  lastAttemptTrace = attempts.filter(Boolean);
  throw new Error(attempts.filter(Boolean).join('\n') || 'No available engine');
}

// Image analysis follows the same provider order: Groq, NVIDIA, Gemini, OpenRouter.
// Author: fan_world_me
async function analyzeImageWithFallback(base64, customPrompt = '') {
  const attempts = [];
  const enabledProviders = await getEnabledProviders();

  const prompt = customPrompt || `Analyze this screenshot/image.
If it contains a school quiz or test question, solve it and give the answer.
If it is not a quiz, briefly describe and analyze what is visible.
Do not show hidden reasoning. Do not restate these instructions.
Return 1-4 short lines in the same language as the image when possible.
Use this format when it is a quiz:
Відповідь: <answer>
Пояснення: <one short reason>
Use this format when it is not a quiz:
Аналіз: <brief description>`;

  // 1. Groq Vision.
  if (enabledProviders.includes('groq')) {
    for (const model of GROQ_VISION_MODELS) {
      const result = await tryGroqVisionModel(prompt, base64, model, 'vision');
      if (result.success) {
        lastAttemptTrace = attempts.filter(Boolean);
        return result;
      }
      attempts.push(result.error || `Groq/${model}:FAIL`);
    }
  }

  // 2. NVIDIA Vision.
  if (enabledProviders.includes('nvidia')) {
    for (const model of NVIDIA_VISION_MODELS) {
      const result = await tryNvidiaVisionModel(prompt, base64, model, 'vision');
      if (result.success) {
        lastAttemptTrace = attempts.filter(Boolean);
        return result;
      }
      attempts.push(result.error || `NVIDIA/${model}:FAIL`);
    }
  }

  // 3. Gemini Vision.
  if (enabledProviders.includes('gemini')) {
    for (const [models, tier] of [[GEMINI_VISION_25, 'gemini-2.5'], [GEMINI_VISION_2, 'gemini-2'], [GEMINI_VISION_15, 'gemini-1.5']]) {
      for (const model of models) {
        const result = await tryGeminiVisionModel(prompt, base64, model, tier);
        if (result.success) {
          lastAttemptTrace = attempts.filter(Boolean);
          return result;
        }
        attempts.push(result.error || `Gemini/${model}:FAIL`);
      }
    }
  }

  // 4. OpenRouter Vision final fallback.
  if (enabledProviders.includes('openrouter')) {
    for (const model of OPENROUTER_VISION_MODELS) {
      const result = await tryOpenRouterVisionModel(prompt, base64, model, 'vision');
      if (result.success) {
        lastAttemptTrace = attempts.filter(Boolean);
        return result;
      }
      attempts.push(result.error || `OpenRouter/${model}:FAIL`);
    }
  }

  lastAttemptTrace = attempts.filter(Boolean);
  throw new Error('No enabled vision provider could analyze the image. Enable Groq, NVIDIA, Gemini, or OpenRouter and add a valid key.');
}

async function tryGeminiTextModel(prompt, model, tier) {
  let lastError = '';
  const geminiKeys = await getProviderKeys('gemini');
  if (!geminiKeys.length) {
    return { success: false, error: 'Gemini: no API key found' };
  }

  for (let keyIndex = 0; keyIndex < geminiKeys.length; keyIndex++) {
    if (!isEngineAvailable('gemini', tier, model, keyIndex)) {
      lastError = `Gemini ${tier} ${model} key #${keyIndex + 1}: blocked (cooldown)`;
      console.log(`[Gemini] Key #${keyIndex + 1} blocked until ${new Date(getEngineState('gemini', tier, model, keyIndex).blockedUntil).toISOString()}`);
      continue;
    }

    const apiKey = geminiKeys[keyIndex];
    try {
      const res = await fetch(`${GEMINI_BASE}/${model}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: QUIZ_SYSTEM_PROMPT }]
          },
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 220 },
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
        if (res.status === 429 || res.status === 404 || /quota|rate|limit|not found/i.test(msg)) {
          console.log(`[Gemini] ${tier} ${model} key #${keyIndex + 1}: skipping (${res.status})`);
        } else {
          console.error(`[Gemini] ${tier} ${model} key #${keyIndex + 1}: HTTP ${res.status} - ${msg}`);
        }
        if (res.status === 429 || /quota|rate|limit/i.test(msg)) {
          blockEngine('gemini', tier, model, keyIndex);
          lastError = `Gemini ${tier} ${model} key #${keyIndex + 1}: limit (${msg})`;
          continue;
        }
        if (res.status === 400 || res.status === 401 || res.status === 403) {
          blockEngine('gemini', tier, model, keyIndex);
          lastError = `Gemini ${tier} ${model} key #${keyIndex + 1}: ${res.status} ${msg}`;
          continue;
        }
        lastError = `Gemini ${tier} ${model} key #${keyIndex + 1}: ${res.status} ${msg}`;
        continue;
      }

      const payload = await res.json();
      const text = payload.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (!text) {
        lastError = `Gemini ${tier} ${model} key #${keyIndex + 1}: empty response`;
        console.warn(`[Gemini] Empty response from key #${keyIndex + 1}:`, payload);
        continue;
      }

      clearEngineBlock('gemini', tier, model, keyIndex);
      console.log(`[Gemini] Success: ${tier} ${model} key #${keyIndex + 1}`);
      return {
        success: true,
        text,
        meta: rememberSuccessfulCall('gemini', model, keyIndex, tier, res.headers, geminiKeys.length),
      };
    } catch (err) {
      lastError = `Gemini ${tier} ${model} key #${keyIndex + 1}: ${err.message}`;
      console.error(`[Gemini] Exception on key #${keyIndex + 1}:`, err);
    }
  }

  console.log(`[Gemini] All attempts failed for ${tier} ${model}:`, lastError);
  return { success: false, error: lastError || `Gemini ${tier} ${model}: unavailable` };
}

async function tryGeminiVisionModel(prompt, base64, model, tier) {
  let lastError = '';
  const geminiKeys = await getProviderKeys('gemini');
  if (!geminiKeys.length) {
    return { success: false, error: 'Gemini: no API key found' };
  }

  for (let keyIndex = 0; keyIndex < geminiKeys.length; keyIndex++) {
    if (!isEngineAvailable('gemini', tier, model, keyIndex)) {
      lastError = `Gemini ${tier} ${model} key #${keyIndex + 1}: blocked (cooldown)`;
      continue;
    }

    const apiKey = geminiKeys[keyIndex];
    try {
      const res = await fetch(`${GEMINI_BASE}/${model}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: prompt.includes('Analyze this screenshot/image') ? 'You analyze images directly. Give concise final observations only. Do not reveal hidden reasoning.' : OCR_SYSTEM_PROMPT }]
          },
          contents: [{ parts: [
            { text: prompt },
            { inlineData: { mimeType: 'image/jpeg', data: base64 } },
          ] }],
          generationConfig: { temperature: 0, maxOutputTokens: 800 },
        }),
      });

      if (!res.ok) {
        const msg = await readErrorMessage(res);
        if (res.status === 429 || res.status === 404 || /quota|rate|limit|not found/i.test(msg)) {
          console.log(`[Gemini] ${tier} ${model} key #${keyIndex + 1}: skipping (${res.status})`);
        } else {
          console.error(`[Gemini] ${tier} ${model} key #${keyIndex + 1}: HTTP ${res.status} - ${msg}`);
        }
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
  if (!groqKeys.length) {
    return { success: false, error: 'Groq: no API key found' };
  }

  for (let keyIndex = 0; keyIndex < groqKeys.length; keyIndex++) {
    if (!isEngineAvailable('groq', tier, model, keyIndex)) {
      lastError = `Groq ${model} key #${keyIndex + 1}: blocked (cooldown)`;
      continue;
    }

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
          messages: [
            { role: 'system', content: QUIZ_SYSTEM_PROMPT },
            { role: 'user', content: prompt }
          ],
          temperature: 0,
          max_tokens: 220,
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

async function tryNvidiaTextModel(prompt, model, tier) {
  let lastError = '';
  const nvidiaKeys = await getProviderKeys('nvidia');
  if (!nvidiaKeys.length) {
    return { success: false, error: 'NVIDIA: no API key found' };
  }

  for (let keyIndex = 0; keyIndex < nvidiaKeys.length; keyIndex++) {
    if (!isEngineAvailable('nvidia', tier, model, keyIndex)) {
      lastError = `NVIDIA ${model} key #${keyIndex + 1}: blocked (cooldown)`;
      continue;
    }

    const apiKey = nvidiaKeys[keyIndex];
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 18000);
    try {
      const res = await fetch(NVIDIA_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: QUIZ_SYSTEM_PROMPT },
            { role: 'user', content: prompt }
          ],
          temperature: 0,
          max_tokens: 420,
          extra_body: { thinking: { type: 'disabled' } },
        }),
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        const msg = await readErrorMessage(res);
        if (res.status === 429 || /quota|rate|limit/i.test(msg)) {
          blockEngine('nvidia', tier, model, keyIndex);
          lastError = `NVIDIA ${model} key #${keyIndex + 1}: limit`;
          continue;
        }
        if (res.status === 401 || res.status === 403) {
          blockEngine('nvidia', tier, model, keyIndex);
          lastError = `NVIDIA ${model} key #${keyIndex + 1}: ${msg}`;
          continue;
        }
        lastError = `NVIDIA ${model} key #${keyIndex + 1}: ${msg}`;
        continue;
      }

      const payload = await res.json();
      const text = payload.choices?.[0]?.message?.content || '';
      if (!text) {
        lastError = `NVIDIA ${model} key #${keyIndex + 1}: empty response`;
        continue;
      }

      clearEngineBlock('nvidia', tier, model, keyIndex);
      return {
        success: true,
        text,
        meta: rememberSuccessfulCall('nvidia', model, keyIndex, tier, res.headers, nvidiaKeys.length),
      };
    } catch (err) {
      clearTimeout(timeoutId);
      lastError = `NVIDIA ${model} key #${keyIndex + 1}: ${err.name === 'AbortError' ? 'timeout' : err.message}`;
    }
  }

  return { success: false, error: lastError || `NVIDIA ${model}: unavailable` };
}

async function tryOpenRouterTextModel(prompt, model, tier) {
  let lastError = '';
  const openrouterKeys = await getProviderKeys('openrouter');

  for (let keyIndex = 0; keyIndex < openrouterKeys.length; keyIndex++) {
    if (!isEngineAvailable('openrouter', tier, model, keyIndex)) continue;

    const apiKey = openrouterKeys[keyIndex];
    try {
      const res = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: QUIZ_SYSTEM_PROMPT },
            { role: 'user', content: prompt }
          ],
          temperature: 0,
          max_tokens: 220,
        }),
      });

      if (!res.ok) {
        const msg = await readErrorMessage(res);
        if (res.status === 429 || /quota|rate|limit/i.test(msg)) {
          blockEngine('openrouter', tier, model, keyIndex);
          lastError = `OpenRouter ${model} key #${keyIndex + 1}: limit`;
          continue;
        }
        if (res.status === 401 || res.status === 403) {
          blockEngine('openrouter', tier, model, keyIndex);
          lastError = `OpenRouter ${model} key #${keyIndex + 1}: ${msg}`;
          continue;
        }
        lastError = `OpenRouter ${model} key #${keyIndex + 1}: ${msg}`;
        continue;
      }

      const payload = await res.json();
      const text = payload.choices?.[0]?.message?.content || '';
      if (!text) {
        lastError = `OpenRouter ${model} key #${keyIndex + 1}: empty response`;
        continue;
      }

      clearEngineBlock('openrouter', tier, model, keyIndex);
      return {
        success: true,
        text,
        meta: rememberSuccessfulCall('openrouter', model, keyIndex, tier, res.headers, openrouterKeys.length),
      };
    } catch (err) {
      lastError = `OpenRouter ${model} key #${keyIndex + 1}: ${err.message}`;
    }
  }

  return { success: false, error: lastError || `OpenRouter ${model}: unavailable` };
}

async function tryNvidiaVisionModel(prompt, base64, model, tier) {
  let lastError = '';
  const nvidiaKeys = await getProviderKeys('nvidia');
  if (!nvidiaKeys.length) {
    return { success: false, error: 'NVIDIA: no API key found' };
  }

  for (let keyIndex = 0; keyIndex < nvidiaKeys.length; keyIndex++) {
    if (!isEngineAvailable('nvidia', tier, model, keyIndex)) {
      lastError = `NVIDIA ${model} key #${keyIndex + 1}: blocked (cooldown)`;
      continue;
    }

    const apiKey = nvidiaKeys[keyIndex];
    try {
      const res = await fetch(NVIDIA_URL, {
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
          temperature: 0,
          max_tokens: 500,
        }),
      });

      if (!res.ok) {
        const msg = await readErrorMessage(res);
        if (res.status === 429 || /quota|rate|limit/i.test(msg)) {
          blockEngine('nvidia', tier, model, keyIndex);
          lastError = `NVIDIA ${model} key #${keyIndex + 1}: limit`;
          continue;
        }
        if (res.status === 401 || res.status === 403) {
          blockEngine('nvidia', tier, model, keyIndex);
          lastError = `NVIDIA ${model} key #${keyIndex + 1}: ${msg}`;
          continue;
        }
        lastError = `NVIDIA ${model} key #${keyIndex + 1}: ${msg}`;
        continue;
      }

      const payload = await res.json();
      const text = payload.choices?.[0]?.message?.content || '';
      if (!text) {
        lastError = `NVIDIA ${model} key #${keyIndex + 1}: empty response`;
        continue;
      }

      clearEngineBlock('nvidia', tier, model, keyIndex);
      return {
        success: true,
        text,
        meta: rememberSuccessfulCall('nvidia', model, keyIndex, tier, res.headers, nvidiaKeys.length),
      };
    } catch (err) {
      lastError = `NVIDIA ${model} key #${keyIndex + 1}: ${err.message}`;
    }
  }

  return { success: false, error: lastError || `NVIDIA ${model}: unavailable` };
}

async function tryOpenRouterVisionModel(prompt, base64, model, tier) {
  let lastError = '';
  const openrouterKeys = await getProviderKeys('openrouter');

  for (let keyIndex = 0; keyIndex < openrouterKeys.length; keyIndex++) {
    if (!isEngineAvailable('openrouter', tier, model, keyIndex)) continue;

    const apiKey = openrouterKeys[keyIndex];
    try {
      const res = await fetch(OPENROUTER_URL, {
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
          temperature: 0,
          max_tokens: 500,
        }),
      });

      if (!res.ok) {
        const msg = await readErrorMessage(res);
        if (res.status === 429 || /quota|rate|limit/i.test(msg)) {
          blockEngine('openrouter', tier, model, keyIndex);
          lastError = `OpenRouter ${model} key #${keyIndex + 1}: limit`;
          continue;
        }
        if (res.status === 401 || res.status === 403) {
          blockEngine('openrouter', tier, model, keyIndex);
          lastError = `OpenRouter ${model} key #${keyIndex + 1}: ${msg}`;
          continue;
        }
        lastError = `OpenRouter ${model} key #${keyIndex + 1}: ${msg}`;
        continue;
      }

      const payload = await res.json();
      const text = payload.choices?.[0]?.message?.content || '';
      if (!text) {
        lastError = `OpenRouter ${model} key #${keyIndex + 1}: empty response`;
        continue;
      }

      clearEngineBlock('openrouter', tier, model, keyIndex);
      return {
        success: true,
        text,
        meta: rememberSuccessfulCall('openrouter', model, keyIndex, tier, res.headers, openrouterKeys.length),
      };
    } catch (err) {
      lastError = `OpenRouter ${model} key #${keyIndex + 1}: ${err.message}`;
    }
  }

  return { success: false, error: lastError || `OpenRouter ${model}: unavailable` };
}

async function tryGroqVisionModel(prompt, base64, model, tier) {
  let lastError = '';
  const groqKeys = await getProviderKeys('groq');
  if (!groqKeys.length) {
    return { success: false, error: 'Groq: no API key found' };
  }

  for (let keyIndex = 0; keyIndex < groqKeys.length; keyIndex++) {
    if (!isEngineAvailable('groq', tier, model, keyIndex)) {
      lastError = `Groq ${model} key #${keyIndex + 1}: blocked (cooldown)`;
      continue;
    }

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
          temperature: 0,
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

async function readErrorMessage(res) {
  let msg = res.statusText || `HTTP ${res.status}`;
  try {
    const data = await res.json();
    const err = data.error || {};
    const detail = [err.message, err.code, err.type].filter(Boolean).join(' | ');
    msg = detail || msg;
  } catch (_) {}
  return `HTTP ${res.status}: ${msg}`;
}

function normalizeForMatch(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanModelText(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```/g, ''))
    .replace(/^\s*(?:final answer|answer)\s*[-–]\s*/i, 'ANSWER: ')
    .trim();
}

function cleanImageAnalysisText(text) {
  let cleaned = cleanModelText(text)
    .replace(/\b(?:we need to|i need to|let's|first,? i|the task asks|we should)\b[\s\S]*?(?=(?:Відповідь|Ответ|Answer|Аналіз|Analysis)\s*:)/i, '')
    .replace(/^\s*(?:Here is|Sure,? here is|I can see)\s*:?\s*/i, '')
    .trim();

  const answerLike = cleaned.match(/((?:Відповідь|Ответ|Answer|Аналіз|Analysis)\s*:[\s\S]+)/i);
  if (answerLike) cleaned = answerLike[1].trim();

  return cleaned
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 4)
    .join('\n')
    .slice(0, 900);
}

function extractAnswerParts(text) {
  const cleaned = cleanModelText(text);
  const answerMatch = cleaned.match(/(?:^|\n)\s*ANSWER\s*:\s*([^\n\r]+)/i);
  const explanationMatch = cleaned.match(/(?:^|\n)\s*EXPLANATION\s*:\s*([\s\S]+)$/i);

  if (answerMatch) {
    return {
      answerText: answerMatch[1].trim(),
      explanation: explanationMatch ? explanationMatch[1].trim() : '',
      cleaned,
      hasAnswerLine: true,
    };
  }

  const cueMatch = cleaned.match(/(?:correct answer is|answer is|the answer is|choose|select)\s*:?\s*([^\n.]+)/i);
  return {
    answerText: cueMatch ? cueMatch[1].trim() : '',
    explanation: '',
    cleaned,
    hasAnswerLine: false,
  };
}

function findOptionIndicesFromText(answerText, options, allowLoose) {
  const indices = [];
  const source = String(answerText || '');
  const upper = source.toUpperCase();

  for (const letter of upper.match(/\b[A-Z]\b/g) || []) {
    const idx = letter.charCodeAt(0) - 65;
    if (idx >= 0 && idx < options.length && !indices.includes(idx)) indices.push(idx);
  }

  if (!indices.length) {
    for (const num of source.match(/\b\d+\b/g) || []) {
      const idx = parseInt(num, 10) - 1;
      if (idx >= 0 && idx < options.length && !indices.includes(idx)) indices.push(idx);
    }
  }

  if (!indices.length) {
    const normalizedAnswer = normalizeForMatch(source);
    for (let i = 0; i < options.length; i++) {
      const normalizedOption = normalizeForMatch(options[i]);
      if (!normalizedOption || normalizedOption.length < 3) continue;
      if (normalizedAnswer.includes(normalizedOption) || normalizedOption.includes(normalizedAnswer)) {
        indices.push(i);
        break;
      }
    }
  }

  if (!indices.length && allowLoose) {
    const normalizedSource = normalizeForMatch(source);
    let bestIdx = -1;
    let bestScore = 0;
    for (let i = 0; i < options.length; i++) {
      const words = normalizeForMatch(options[i]).split(' ').filter((word) => word.length > 2);
      if (!words.length) continue;
      const hits = words.filter((word) => normalizedSource.includes(word)).length;
      const score = hits / words.length;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0 && bestScore >= 0.65) indices.push(bestIdx);
  }

  return indices;
}

function hasParsedAnswer(parsed, questionType) {
  if (!parsed) return false;
  if (questionType === 'matching') return Array.isArray(parsed.matchPairs) && parsed.matchPairs.length > 0;
  if (questionType === 'ordering') return Array.isArray(parsed.orderIndices) && parsed.orderIndices.length > 1;
  if (questionType === 'open_ended' || questionType === 'short_answer') return !!(parsed.answer || parsed.textAnswer);
  return Array.isArray(parsed.correctIndices) && parsed.correctIndices.length > 0;
}

// Prompt builder for different question types
// Author: fan_world_me
function buildPrompt(question, options, questionType, rightOptions) {
  const safeOptions = Array.isArray(options) ? options : [];
  const letters = safeOptions.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join('\n');
  const numbers = safeOptions.map((o, i) => `${i + 1}. ${o}`).join('\n');

  if (questionType === 'ordering') {
    return `Task type: ordering

Question:
${question}

Elements:
${letters}

Choose the correct chronological/logical sequence. Return only letters from the list.
The first characters of your response must be "ORDER:".

Return EXACTLY this format (two lines only):
ORDER: A, C, B, D
EXPLANATION: <one short reason in the question language>`;
  }

  if (questionType === 'matching') {
    const rightList = (rightOptions || []).map((r, i) => `${String.fromCharCode(65 + i)}. ${r}`).join('\n');
    return `Task type: matching

Question:
${question}

Left elements:
${numbers}

Right elements:
${rightList}

Match every left item to one right item. Use only numbers and letters shown above.
The first characters of your response must be "MATCHING:".

Return EXACTLY this format:
MATCHING:
1 -> A
2 -> C
3 -> B
EXPLANATION: <one short reason in the question language>`;
  }

  if (questionType === 'open_ended' || questionType === 'short_answer') {
    return `Task type: short answer / fill in the blank

Question:
${question}

Give the most likely intended answer. Return only the answer text.
The first characters of your response must be "ANSWER:".

Return EXACTLY this format (two lines only):
ANSWER: <short answer>
EXPLANATION: <one short reason in the question language>`;
  }

  if (questionType === 'checkbox') {
    return `Task type: multiple choice with one or more correct answers

Question:
${question}

Options:
${letters}

Select every correct option. Use only letters from the option list.
The first characters of your response must be "ANSWER:".

Return EXACTLY this format (two lines only):
ANSWER: A, C
EXPLANATION: <one short reason in the question language>`;
  }

  return `Task type: single choice

Question:
${question}

Options:
${letters}

Select exactly one correct option. Use only one letter from the option list.
The first characters of your response must be "ANSWER:".

Return EXACTLY this format (two lines only):
ANSWER: <one letter>
EXPLANATION: <one short reason in the question language>`;
}

function parseAIResponse(text, options, questionType, rightOptions) {
  options = Array.isArray(options) ? options : [];
  rightOptions = Array.isArray(rightOptions) ? rightOptions : [];
  const parts = extractAnswerParts(text);
  text = parts.cleaned;
  const explanation = parts.explanation || parts.answerText || 'AI did not return a clear ANSWER line.';

  if (questionType === 'matching') {
    const pairs = [];
    const lines = text.split('\n');
    let inSection = false;
    for (const line of lines) {
      if (/ВІДПОВІДНІСТЬ|СООТВЕТСТВИЕ|MATCHES|MATCHING/i.test(line)) { inSection = true; continue; }
      if (/ПОЯСНЕННЯ|ПОЯСНЕНИЕ|EXPLANATION/i.test(line)) break;
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
    const m = text.match(/(?:ПОРЯДОК|ORDER|SEQUENCE)\s*:\s*([A-Z](?:\s*[,;>\- ]\s*[A-Z])*)/i);
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

  if (questionType === 'open_ended' || questionType === 'short_answer') {
    const answer = (parts.answerText || text || '').trim().replace(/^['"]|['"]$/g, '').slice(0, 120);
    return { answer, textAnswer: answer, explanation, rawResponse: text };
  }

  let correctIndices = [];
  if (parts.answerText) {
    correctIndices = findOptionIndicesFromText(parts.answerText, options, true);
  }

  // Fallback: search for letter patterns like "B)" or "B." or "B:" or "B,"
  if (correctIndices.length === 0 && parts.hasAnswerLine) {
    for (let i = 0; i < options.length; i++) {
      const letter = String.fromCharCode(65 + i);
      // Look for patterns: "B)", "B.", "B:", "B," - but NOT standalone letter (to avoid matching words)
      if (new RegExp(`\\b${letter}[.):,]`, 'i').test(text)) {
        correctIndices.push(i);
        if (questionType === 'radio') break;
      }
    }
  }

  // Final fallback: if the model ignored the format, try text after common answer cues only.
  if (correctIndices.length === 0) {
    const cueText = (text.match(/(?:correct answer is|answer is|the answer is|оберіть|виберіть|правильна відповідь)\s*:?\s*([\s\S]{1,300})/i) || [])[1] || '';
    correctIndices = findOptionIndicesFromText(cueText, options, true);
  }

  return { correctIndices, explanation, rawResponse: text };
}

