// Quiz AI Analyzer - content module: core.js
// State, constants, small utils, provider keys, runtime messaging
'use strict';

// Content scripts are loaded as separate files that share one scope (see manifests),
// so there is no IIFE wrapper. The top-frame / run-once guard lives in main.js.


let isAnalyzing     = false;
let progressOverlay = null;
let floatingPanel   = null;
let isPanelOpen     = false;
let lastResults     = [];
let autoEnabled     = false;   /* tracked separately to guard MutationObserver */
let captureMode     = false;   /* area-selection state */
let fabHidden       = false;   /* FAB visibility state */
let autoTimer       = null;
let currentRequestId = 0;      /* request queue management */
let abortController = null;    /* abort old requests */
let kahootOverlayFrame = 0;
const kahootOverlayTrackers = [];

const C_OK  = '#00C851';
const C_ORG = '#FF8800';
const C_ERR = '#FF4444';
const Z     = '2147483647';
let lastAutoSignature = '';
const AUTO_SCAN_INTERVAL_MS = 10000;

/* Debounce utility */
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/* Check if element is visible */
function isElementVisible(el) {
  if (!el) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  if (el.hasAttribute('aria-hidden') && el.getAttribute('aria-hidden') === 'true') return false;
  if (el.offsetWidth === 0 && el.offsetHeight === 0) return false;
  return true;
}

/* Normalize text - remove extra whitespace and filter hidden content */
function normalizeText(text) {
  if (!text) return '';
  return text.replace(/\s+/g, ' ').trim();
}

/* Extract text from element, filtering hidden content */
function extractVisibleText(el) {
  if (!el || !isElementVisible(el)) return '';
  return normalizeText(el.textContent);
}

function isEditorFrame() {
  if (window.top === window) return false;
  const body = document.body;
  const docEl = document.documentElement;
  const title = (document.title || '').toLowerCase();
  const href = String(location.href || '').toLowerCase();

  if (body?.isContentEditable) return true;
  if (body?.getAttribute('contenteditable') === 'true') return true;
  if (body?.id && /tinymce/i.test(body.id)) return true;
  if (body?.className && /mce-content-body|tox-edit-area|editor/i.test(String(body.className))) return true;
  if (docEl?.className && /mce-content-body|tox-edit-area|editor/i.test(String(docEl.className))) return true;
  if (/tinymce|ckeditor|editor/i.test(title)) return true;
  if (/tinymce|ckeditor|editor/i.test(href)) return true;

  return false;
}

function storageKeyForProvider(provider) {
  return provider === 'gemini' ? 'geminiApiKey' : 'groqApiKey';
}

function getProviderKey(provider, data) {
  const providerKey = storageKeyForProvider(provider);
  return data[providerKey] || data.apiKey || '';
}

function parseProviderKeys(provider, value) {
  const raw = String(value || '').trim();
  if (!raw) return [];

  if (provider === 'gemini') {
    const matches = raw.match(/AIza[0-9A-Za-z_\-]{20,}/g);
    if (matches && matches.length) return [...new Set(matches)];
  }

  if (provider === 'groq') {
    const matches = raw.match(/gsk_[0-9A-Za-z_\-]+/g);
    if (matches && matches.length) return [...new Set(matches)];
  }

  return [...new Set(raw.split(/[\s,;\n\r\t]+/).map((item) => item.trim()).filter(Boolean))];
}

function buildKeyPreview(provider, value) {
  const keys = parseProviderKeys(provider, value);
  if (!keys.length) return '';
  if (keys.length === 1) return 'Ключ: ' + keys[0].slice(0, 6) + '...' + keys[0].slice(-4);
  return `Ключів: ${keys.length} (перший ${keys[0].slice(0, 6)}...${keys[0].slice(-4)})`;
}

function hasRuntimeContext() {
  try {
    return !!(chrome && chrome.runtime && chrome.runtime.id);
  } catch (_) {
    return false;
  }
}

function safeSendRuntimeMessage(message, callback) {
  if (!hasRuntimeContext()) {
    if (callback) callback(null);
    return;
  }
  try {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        if (callback) callback(null);
        return;
      }
      if (callback) callback(response);
    });
  } catch (_) {
    if (callback) callback(null);
  }
}

function sendRuntimeMessageAsync(message) {
  return new Promise((resolve) => {
    safeSendRuntimeMessage(message, (response) => resolve(response || null));
  });
}
