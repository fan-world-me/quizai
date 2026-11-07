// Quiz AI Analyzer - content module: images.js
// Finds the pictures that belong to a question (question image, picture options,
// CSS backgrounds, canvas) and prepares them for the vision pipeline.
'use strict';

// Words that suggest "look at the picture" (used only when no picture was found in the DOM).
const IMAGE_HINT_RE = /(зображен|малюн|картинк|на фото|фотограф|світлин|ілюстрац|діаграм|графік|на карті|рисун|изображ|image|picture|photo|diagram|figure|chart|graph|\bmap\b)/i;
const IMAGE_MAX_PER_QUESTION = 8;
const IMAGE_MIN_SIZE = 48;            // rendered px; smaller ones are icons, avatars, bullets
const IMAGE_LOAD_TIMEOUT_MS = 8000;
const IMAGE_ANCESTOR_LEVELS = 2;      // how far above the options block we look for the question picture

function imgWithTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

function imgBlobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function imgOptionIndex(q, el) {
  const opts = q.optionEls || [];
  for (let i = 0; i < opts.length; i++) {
    if (opts[i] && opts[i].contains(el)) return i;
  }
  return -1;
}

function imgIsDecor(el) {
  return !!(el.closest && el.closest('header,nav,footer,aside,[role="banner"],[role="navigation"]'));
}

function imgBackgroundUrl(el) {
  let bg = '';
  try { bg = getComputedStyle(el).backgroundImage || ''; } catch (_) { return ''; }
  if (!bg || bg === 'none') return '';
  const m = bg.match(/url\((['"]?)(.*?)\1\)/);
  return m ? m[2] : '';
}

/** Region we look at: the options block, plus up to two ancestors that still belong to this question only. */
function imgSearchRoots(q, allQs) {
  const base = q.containerEl;
  const roots = [{ root: base, level: 0 }];
  if (!base) return roots;
  const others = (allQs || []).filter(o => o !== q && o.containerEl).map(o => o.containerEl);
  let cur = base;
  for (let level = 1; level <= IMAGE_ANCESTOR_LEVELS; level++) {
    const parent = cur.parentElement;
    if (!parent || parent === document.body || parent === document.documentElement) break;
    if (others.some(o => parent.contains(o))) break;
    roots.push({ root: parent, level });
    cur = parent;
  }
  return roots;
}

function imgCollectFrom(q, root, level, out, seen) {
  const base = q.containerEl;
  const take = (kind, el, url, dataUrl) => {
    const key = dataUrl ? dataUrl.slice(-120) : url;
    if (!key || seen.has(key)) return;
    // Pictures from the ancestors only count when they come BEFORE the options (i.e. belong to the question text).
    if (level > 0 && base && !(base.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING)) return;
    seen.add(key);
    out.push({ kind, url: url || '', dataUrl: dataUrl || '', optionIndex: level === 0 ? imgOptionIndex(q, el) : -1, order: out.length });
  };

  root.querySelectorAll('img').forEach((img) => {
    if (isOwnPanel(img) || imgIsDecor(img) || !isElementVisible(img)) return;
    const r = img.getBoundingClientRect();
    if (r.width < IMAGE_MIN_SIZE || r.height < IMAGE_MIN_SIZE) return;
    const url = img.currentSrc || img.src || '';
    if (url) take('img', img, url, '');
  });

  root.querySelectorAll('canvas').forEach((cv) => {
    if (isOwnPanel(cv) || imgIsDecor(cv) || !isElementVisible(cv)) return;
    const r = cv.getBoundingClientRect();
    if (r.width < IMAGE_MIN_SIZE || r.height < IMAGE_MIN_SIZE) return;
    try { take('canvas', cv, '', cv.toDataURL('image/jpeg', 0.85)); } catch (_) { /* tainted canvas */ }
  });

  root.querySelectorAll('video[poster]').forEach((v) => {
    if (isOwnPanel(v) || !isElementVisible(v)) return;
    if (v.poster) take('poster', v, v.poster, '');
  });

  // CSS background images (limited scan: big pages have thousands of nodes)
  const all = root.querySelectorAll('*');
  const limit = Math.min(all.length, 400);
  for (let i = 0; i < limit; i++) {
    const el = all[i];
    if (isOwnPanel(el) || imgIsDecor(el)) continue;
    const url = imgBackgroundUrl(el);
    if (!url) continue;
    const r = el.getBoundingClientRect();
    if (r.width < IMAGE_MIN_SIZE || r.height < IMAGE_MIN_SIZE) continue;
    if (!isElementVisible(el)) continue;
    take('bg', el, url, '');
  }
}

/**
 * Synchronous scan (no network). Returns:
 *  cands   - picture candidates (question pictures first, then option pictures in option order)
 *  rootEl  - element to screenshot if the pictures cannot be loaded
 *  key     - stable cache key part built from the picture URLs ('' = no pictures)
 *  hint    - true when the text hints at a picture but none was found
 */
function scanQuestionImages(q, allQs) {
  const out = [];
  const seen = new Set();
  let rootEl = q.containerEl || null;
  try {
    const roots = imgSearchRoots(q, allQs);
    for (const { root, level } of roots) {
      const before = out.length;
      if (root) imgCollectFrom(q, root, level, out, seen);
      if (out.length > before && level > 0) rootEl = root;
      if (level === 0 && out.length) break;   // found inside the block itself - no need to climb
    }
  } catch (_) { /* detection must never break the analysis */ }

  out.sort((a, b) => {
    const ra = a.optionIndex >= 0 ? 1 : 0;
    const rb = b.optionIndex >= 0 ? 1 : 0;
    if (ra !== rb) return ra - rb;
    if (a.optionIndex !== b.optionIndex) return a.optionIndex - b.optionIndex;
    return a.order - b.order;
  });
  const cands = out.slice(0, IMAGE_MAX_PER_QUESTION);

  const text = [q.questionText].concat(q.options || []).join(' ');
  const key = cands.map(c => (c.url ? c.url.slice(-100) : 'canvas:' + c.dataUrl.slice(-40)) + '@' + c.optionIndex).join('|');
  return { cands, rootEl, key, hint: !cands.length && IMAGE_HINT_RE.test(text) };
}

/** Cheap signature for the auto-scan loop: a new picture with the same text must trigger a new analysis. */
function quickImageSignature(q) {
  try {
    const root = q && q.containerEl;
    if (!root) return '';
    const urls = [];
    root.querySelectorAll('img').forEach((img) => {
      if (isOwnPanel(img)) return;
      const u = img.currentSrc || img.src;
      if (u) urls.push(u.slice(-80));
    });
    return urls.slice(0, 12).join(',');
  } catch (_) {
    return '';
  }
}

async function imgLoadCandidate(c) {
  if (c.dataUrl) return { dataUrl: c.dataUrl };
  const url = c.url;
  if (/^data:image\//i.test(url)) return { dataUrl: url };

  let absolute = url;
  let sameOrigin = false;
  try {
    const u = new URL(url, location.href);
    absolute = u.href;
    sameOrigin = u.origin === location.origin;
  } catch (_) { /* keep raw url */ }

  const isBlob = /^blob:/i.test(url);
  if (isBlob || sameOrigin) {
    // Same-origin pictures may need the page's cookies (e.g. Moodle files), so read them here.
    try {
      const res = await imgWithTimeout(fetch(absolute, { credentials: 'include' }), IMAGE_LOAD_TIMEOUT_MS);
      if (res.ok) {
        const blob = await res.blob();
        if (blob.size && blob.size < 12 * 1024 * 1024) return { dataUrl: await imgBlobToDataUrl(blob) };
      }
    } catch (_) { /* fall through */ }
    if (isBlob) return null;   // background cannot read page blob: URLs
  }
  return { url: absolute };    // cross-origin: the background script fetches it
}

/** Loads the scanned pictures. Falls back to a screenshot of the block when nothing could be loaded. */
async function loadQuestionImages(ctx, q) {
  const result = { images: [], screenshot: '' };
  const loaded = await Promise.all(ctx.cands.map(async (c) => {
    try {
      const item = await imgLoadCandidate(c);
      if (!item) return null;
      return Object.assign(item, { role: c.optionIndex >= 0 ? 'option' : 'question', n: c.optionIndex + 1 });
    } catch (_) {
      return null;
    }
  }));
  result.images = loaded.filter(Boolean);

  if (!result.images.length && (ctx.cands.length || ctx.hint)) {
    const target = ctx.rootEl || q.containerEl;
    try { result.screenshot = (await captureElementForAnalysis(target)) || ''; } catch (_) { /* ignore */ }
  }
  return result;
}
