// Quiz AI Analyzer - background module: engine-state.js
// Author: fan_world_me
const engineState = new Map();
let lastMeta = null;
let lastUsage = null;
let lastAttemptTrace = [];
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
  return MODEL_LABELS[model] || `${provider.toUpperCase()} ${model}`;
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
