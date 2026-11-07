// Quiz AI Analyzer - content module: screenshot.js
// Area screenshot via SVG foreignObject + crop
'use strict';

function waitForImageLoad(img) {
  return new Promise((resolve, reject) => {
    if (img.complete && img.naturalWidth > 0) {
      resolve();
      return;
    }
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Image load failed'));
  });
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function stripLocalUi(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  root.querySelectorAll('#__qaz_wrap, #__qaz_overlay, #__qaz_toast, .__qaz_badge, #__qrestpill').forEach((el) => el.remove());
}

function inlineFormState(sourceRoot, cloneRoot) {
  if (!sourceRoot || !cloneRoot) return;
  const sourceNodes = sourceRoot.querySelectorAll('input, textarea, select, option, canvas, video');
  const cloneNodes = cloneRoot.querySelectorAll('input, textarea, select, option, canvas, video');
  const len = Math.min(sourceNodes.length, cloneNodes.length);

  for (let i = 0; i < len; i += 1) {
    const src = sourceNodes[i];
    const dst = cloneNodes[i];
    if (!src || !dst) continue;

    const tag = src.tagName;
    if (tag === 'INPUT') {
      dst.setAttribute('value', src.value || '');
      if (src.checked) dst.setAttribute('checked', 'checked');
      else dst.removeAttribute('checked');
    } else if (tag === 'TEXTAREA') {
      dst.textContent = src.value || '';
    } else if (tag === 'OPTION') {
      if (src.selected) dst.setAttribute('selected', 'selected');
      else dst.removeAttribute('selected');
    } else if (tag === 'CANVAS') {
      try {
        const img = document.createElement('img');
        img.setAttribute('src', src.toDataURL('image/png'));
        img.setAttribute('style', src.getAttribute('style') || '');
        img.setAttribute('width', src.width || src.clientWidth || 0);
        img.setAttribute('height', src.height || src.clientHeight || 0);
        dst.replaceWith(img);
      } catch (_) {}
    } else if (tag === 'VIDEO') {
      const poster = src.getAttribute('poster') || '';
      if (poster) dst.setAttribute('poster', poster);
    }
  }
}

function buildForeignObjectMarkup() {
  const htmlClone = document.documentElement.cloneNode(true);
  stripLocalUi(htmlClone);
  inlineFormState(document.documentElement, htmlClone);

  const viewportWidth = Math.max(
    window.innerWidth || 0,
    document.documentElement.clientWidth || 0,
    1
  );
  const viewportHeight = Math.max(
    window.innerHeight || 0,
    document.documentElement.clientHeight || 0,
    1
  );
  const scrollX = window.scrollX || window.pageXOffset || 0;
  const scrollY = window.scrollY || window.pageYOffset || 0;

  htmlClone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  htmlClone.style.setProperty('margin', '0', 'important');
  htmlClone.style.setProperty('transform', `translate(${-scrollX}px, ${-scrollY}px)`, 'important');
  htmlClone.style.setProperty('transform-origin', 'top left', 'important');
  htmlClone.style.setProperty('width', `${Math.max(document.documentElement.scrollWidth, viewportWidth)}px`, 'important');
  htmlClone.style.setProperty('height', `${Math.max(document.documentElement.scrollHeight, viewportHeight)}px`, 'important');

  return {
    markup: new XMLSerializer().serializeToString(htmlClone),
    viewportWidth,
    viewportHeight,
    scrollX,
    scrollY
  };
}

async function cropBase64Image(base64, rect) {
  const { x, y, w, h, dpr } = rect;
  const img = new Image();
  img.src = 'data:image/jpeg;base64,' + base64;
  await waitForImageLoad(img);

  const scale = dpr || window.devicePixelRatio || 1;
  const cvs = document.createElement('canvas');
  cvs.width = Math.max(1, Math.round(w * scale));
  cvs.height = Math.max(1, Math.round(h * scale));
  const ctx = cvs.getContext('2d');
  ctx.drawImage(
    img,
    Math.round(x * scale),
    Math.round(y * scale),
    cvs.width,
    cvs.height,
    0,
    0,
    cvs.width,
    cvs.height
  );
  return cvs.toDataURL('image/jpeg', 0.88).replace(/^data:image\/jpeg;base64,/, '');
}

async function captureAreaFromForeignObject(rect) {
  const { markup, viewportWidth, viewportHeight } = buildForeignObjectMarkup();
  const dpr = rect.dpr || window.devicePixelRatio || 1;
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${escapeXml(rect.w)}" height="${escapeXml(rect.h)}" viewBox="${escapeXml(rect.x)} ${escapeXml(rect.y)} ${escapeXml(rect.w)} ${escapeXml(rect.h)}">`,
    `<foreignObject x="0" y="0" width="${escapeXml(viewportWidth)}" height="${escapeXml(viewportHeight)}">`,
    markup,
    '</foreignObject>',
    '</svg>'
  ].join('');

  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await waitForImageLoad(img);

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(rect.w * dpr));
  canvas.height = Math.max(1, Math.round(rect.h * dpr));
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.drawImage(img, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.88).replace(/^data:image\/jpeg;base64,/, '');
}

async function captureAreaBase64(rect) {
  const runtimeResponse = await sendRuntimeMessageAsync({ type: 'CAPTURE_AREA', rect });
  if (runtimeResponse && !runtimeResponse.error && runtimeResponse.base64) {
    return cropBase64Image(runtimeResponse.base64, rect);
  }

  if (!runtimeResponse || !runtimeResponse.needsLocalCapture) {
    const runtimeError = runtimeResponse && runtimeResponse.error ? runtimeResponse.error : 'Capture failed';
    throw new Error(runtimeError);
  }

  try {
    return await captureAreaFromForeignObject(rect);
  } catch (fallbackErr) {
    const runtimeError = runtimeResponse.error || 'Capture failed';
    throw new Error(`${runtimeError}. Local capture failed: ${fallbackErr.message}`);
  }
}
