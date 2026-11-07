// Quiz AI Analyzer - background module: images.js
// Turns the pictures attached to a question into ONE JPEG for the vision pipeline:
// fetch (cross-origin allowed here) -> decode -> shrink -> optional labeled collage.
'use strict';

const IMG_MAX_SIDE = 1024;          // single picture: longest side
const IMG_COLLAGE_WIDTH = 1440;     // collage: total width budget
const IMG_JPEG_QUALITY = 0.82;
const IMG_FETCH_TIMEOUT_MS = 10000;
const IMG_MAX_BYTES = 12 * 1024 * 1024;
const IMG_MAX_ITEMS = 8;

function imgMakeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  throw new Error('No canvas available');
}

function imgCanvasToBlob(canvas, type, quality) {
  if (typeof canvas.convertToBlob === 'function') return canvas.convertToBlob({ type, quality });
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), type, quality);
  });
}

async function imgCanvasToBase64(canvas) {
  const blob = await imgCanvasToBlob(canvas, 'image/jpeg', IMG_JPEG_QUALITY);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

async function imgItemToBitmap(item) {
  let blob;
  if (item.dataUrl) {
    blob = await (await fetch(item.dataUrl)).blob();
  } else if (item.url && /^https?:/i.test(item.url)) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), IMG_FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(item.url, { credentials: 'include', signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      blob = await res.blob();
    } finally {
      clearTimeout(timer);
    }
  } else {
    throw new Error('Unsupported image source');
  }
  if (!blob || !blob.size) throw new Error('Empty image');
  if (blob.size > IMG_MAX_BYTES) throw new Error('Image too large');
  return createImageBitmap(blob);
}

function imgFit(w, h, boxW, boxH) {
  const s = Math.min(boxW / w, boxH / h, 1);
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

function imgDrawLabel(ctx, text, x, y) {
  ctx.font = 'bold 26px sans-serif';
  const w = Math.max(34, Math.ceil(ctx.measureText(text).width) + 16);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, w, 34);
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#000000';
  ctx.strokeRect(x, y, w, 34);
  ctx.fillStyle = '#000000';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 8, y + 18);
}

/**
 * items: [{ dataUrl? , url? , role: 'question'|'option', n: optionNumber (1-based, option role only) }]
 * returns { base64, composite, hasQuestionImage, optionNumbers }  (base64 is '' when nothing could be loaded)
 */
async function buildVisionImage(items) {
  const list = (Array.isArray(items) ? items : []).slice(0, IMG_MAX_ITEMS);
  const settled = await Promise.allSettled(list.map((it) => imgItemToBitmap(it)));
  const ready = [];
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') ready.push({ bmp: r.value, role: list[i].role, n: list[i].n });
  });
  if (!ready.length) return { base64: '', composite: false, hasQuestionImage: false, optionNumbers: [] };

  // One picture: just shrink it (no labels needed).
  if (ready.length === 1) {
    const { bmp } = ready[0];
    const size = imgFit(bmp.width, bmp.height, IMG_MAX_SIDE, IMG_MAX_SIDE);
    const canvas = imgMakeCanvas(size.w, size.h);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size.w, size.h);
    ctx.drawImage(bmp, 0, 0, size.w, size.h);
    if (bmp.close) bmp.close();
    return {
      base64: await imgCanvasToBase64(canvas),
      composite: false,
      hasQuestionImage: ready[0].role !== 'option',
      optionNumbers: ready[0].role === 'option' ? [ready[0].n] : [],
    };
  }

  // Several pictures: labeled collage.
  const count = ready.length;
  const cols = count <= 2 ? count : (count <= 4 ? 2 : 3);
  const rows = Math.ceil(count / cols);
  const cellW = Math.min(640, Math.floor(IMG_COLLAGE_WIDTH / cols));
  const cellH = Math.round(cellW * 0.75);
  const pad = 6;
  const canvas = imgMakeCanvas(cols * cellW, rows * cellH);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ready.forEach((item, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const x0 = col * cellW;
    const y0 = row * cellH;
    const size = imgFit(item.bmp.width, item.bmp.height, cellW - pad * 2, cellH - pad * 2);
    const dx = x0 + Math.floor((cellW - size.w) / 2);
    const dy = y0 + Math.floor((cellH - size.h) / 2);
    ctx.drawImage(item.bmp, dx, dy, size.w, size.h);
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#bdbdbd';
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, cellW - 1, cellH - 1);
    imgDrawLabel(ctx, item.role === 'option' ? String(item.n) : 'Q', x0 + 4, y0 + 4);
    if (item.bmp.close) item.bmp.close();
  });

  return {
    base64: await imgCanvasToBase64(canvas),
    composite: true,
    hasQuestionImage: ready.some((r) => r.role !== 'option'),
    optionNumbers: ready.filter((r) => r.role === 'option').map((r) => r.n),
  };
}

// Short instruction placed before the normal quiz prompt when pictures are attached.
function buildImageNote(info) {
  if (!info || !info.composite) {
    return 'The question comes with a picture (attached). Look at it and use it together with the text to answer.';
  }
  const parts = [];
  if (info.hasQuestionImage) parts.push('pictures marked "Q" belong to the question itself');
  if (info.optionNumbers && info.optionNumbers.length) {
    parts.push('pictures marked with a number belong to the answer option with that number (1 = first option / A, 2 = second option / B, and so on)');
  }
  return `Several pictures are attached as one labeled collage: ${parts.join('; ')}. Look at them and use them together with the text to answer.`;
}
