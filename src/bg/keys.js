// Quiz AI Analyzer - background module: keys.js
// Author: fan_world_me
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
    authConfigPromise = (async () => {
      try {
        const response = await fetch(AUTH_CONFIG_URL);
        if (response.ok) {
          return await response.json();
        }
      } catch (fetchError) {
        console.warn('fetch auth.json failed, trying XHR:', fetchError.message);
        try {
          return await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', AUTH_CONFIG_URL, true);
            xhr.responseType = 'json';
            xhr.onload = () => {
              if (xhr.status === 200 && xhr.response) {
                resolve(xhr.response);
              } else {
                reject(new Error(`XHR status ${xhr.status}`));
              }
            };
            xhr.onerror = () => reject(new Error('XHR failed'));
            xhr.send();
          });
        } catch (xhrError) {
          console.warn('XHR auth.json failed:', xhrError.message);
        }
      }
      return {};
    })();
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
