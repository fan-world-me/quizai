// Quiz AI Analyzer - background module: providers/common.js
// Author: fan_world_me
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
