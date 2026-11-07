// Quiz AI Analyzer - content module: panel-html.js
// buildHTML - floating panel markup and CSS
'use strict';

function buildHTML(en, hasKey, settings) {
  const version = settings?.version || 'dev';
  const statusLabel = settings?.statusLabel || 'Engine: auto';
  const usageLabel = settings?.usage?.remainingText || 'Немає даних';
  const usageReset = settings?.usage?.resetText || 'очікує запит';
  const fallbackLabel = settings?.fallbackLabel || 'Groq -> NVIDIA -> Gemini -> OpenRouter';
  return `
<style>
/* ══ Quiz AI — MD3 floating panel v3 ══ */
@font-face {
  font-family: "QAZ";
  src: url("${chrome.runtime.getURL('Monocraft.ttf')}") format("truetype");
  font-display: swap;
}

#__qaz_wrap * {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
  font-family: QAZ, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif !important;
}

/* ══ FAB ══ */
#__qfab {
  width: 58px; height: 58px; border-radius: 50%;
  background: linear-gradient(145deg, #6a3de8 0%, #3a7bd5 100%);
  border: 1.5px solid rgba(200,180,255,0.3);
  display: flex; align-items: center; justify-content: center;
  cursor: grab; font-size: 26px; position: relative;
  box-shadow: 0 6px 24px rgba(106,61,232,0.55), 0 2px 6px rgba(0,0,0,0.5);
  user-select: none; touch-action: none; -webkit-user-drag: none;
  will-change: box-shadow;
  transition: box-shadow .2s ease;
}
#__qfab:hover {
  box-shadow: 0 8px 32px rgba(106,61,232,0.75), 0 2px 8px rgba(0,0,0,0.5);
}
#__qfab:active { cursor: grabbing; }

#__qdot {
  position: absolute; bottom: 3px; right: 3px;
  width: 13px; height: 13px; border-radius: 50%;
  background: ${en ? '#7C4DFF' : '#555'};
  border: 2px solid #0d0720;
  box-shadow: 0 0 ${en ? '8px rgba(124,77,255,0.9)' : 'none'};
}
#__qfabmeta {
  position: absolute; right: -4px; bottom: -28px;
  max-width: 170px; padding: 4px 9px; border-radius: 20px;
  background: #1a0f35; border: 1px solid rgba(124,77,255,0.35);
  color: #b39ddb; font-size: 9px; font-weight: 600; line-height: 1.3;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  box-shadow: 0 3px 12px rgba(0,0,0,0.5);
}

/* ══ CARD ══ */
#__qcard {
  position: absolute; bottom: 68px; right: 0;
  width: min(320px, calc(100vw - 16px));
  background: #110928;
  border: 1.5px solid rgba(124,77,255,0.4);
  border-radius: 16px;
  display: none;
  box-shadow: 0 20px 60px rgba(0,0,0,0.75), 0 0 0 1px rgba(255,255,255,0.03) inset;
  overflow: hidden;
}
#__qcard.open {
  display: block;
  animation: __qci .28s cubic-bezier(.2,0,0,1);
}
@keyframes __qci {
  from { opacity: 0; transform: translateY(10px) scale(.97); }
  to   { opacity: 1; transform: none; }
}

/* ══ HEADER ══ */
.__qhdr {
  background: #1a0f35;
  border-bottom: 1.5px solid rgba(124,77,255,0.3);
  padding: 12px 14px 10px;
  display: flex; align-items: flex-start; justify-content: space-between; gap: 8px;
}
.__qhtitle {
  font-size: 13px; font-weight: 800; color: #EDE7F6;
  display: flex; align-items: center; gap: 6px;
  background: linear-gradient(90deg, #CE93D8, #82B1FF);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
}
.__qhmeta { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 5px; }
.__qchip {
  display: inline-flex; align-items: center;
  font-size: 9px; font-weight: 700; line-height: 1;
  padding: 3px 8px; border-radius: 20px;
}
.__qchip:nth-child(1) { background: rgba(124,77,255,0.2); border: 1px solid rgba(124,77,255,0.4); color: #CE93D8; }
.__qchip:nth-child(2) { background: rgba(68,138,255,0.15); border: 1px solid rgba(68,138,255,0.35); color: #82B1FF; }
.__qhshort {
  font-size: 9px; padding: 3px 7px; border-radius: 6px;
  background: rgba(255,255,255,0.05); color: rgba(237,231,246,0.4);
  border: 1px solid rgba(255,255,255,0.08);
}
.__qhide {
  width: 28px; height: 28px; border-radius: 8px; flex-shrink: 0;
  background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
  color: rgba(237,231,246,0.5); cursor: pointer; font-size: 13px;
  display: flex; align-items: center; justify-content: center;
  will-change: background;
  transition: background .15s, color .15s;
}
.__qhide:hover { background: rgba(255,80,80,0.18); border-color: rgba(255,80,80,0.3); color: #FF6B6B; }

/* ══ BODY ══ */
.__qbody {
  padding: 10px 12px 12px;
  max-height: 72vh; overflow-y: auto; overflow-x: hidden;
}
.__qbody::-webkit-scrollbar { width: 4px; }
.__qbody::-webkit-scrollbar-track { background: transparent; }
.__qbody::-webkit-scrollbar-thumb { background: rgba(124,77,255,0.4); border-radius: 4px; }

/* ══ INFO GRID — 2 колонки ══ */
.__qoverview { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 8px; }
.__qov {
  padding: 9px 10px; border-radius: 10px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(124,77,255,0.2);
}
.__qovk {
  font-size: 9px; font-weight: 700; letter-spacing: .05em;
  text-transform: uppercase; color: rgba(237,231,246,0.4); margin-bottom: 4px;
}
.__qovv { font-size: 12px; font-weight: 800; color: #EDE7F6; line-height: 1.4; word-break: break-word; }
.__qovv.sm { font-size: 11px; font-weight: 600; color: rgba(237,231,246,0.75); }

/* ══ INFO ROW — на всю ширину ══ */
.__qhint {
  padding: 8px 10px; border-radius: 10px; margin-bottom: 8px;
  background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07);
}
.__qhintk {
  font-size: 9px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase;
  color: rgba(237,231,246,0.38); margin-bottom: 3px;
}
.__qhintv { font-size: 11px; font-weight: 600; color: rgba(237,231,246,0.75); line-height: 1.5; }

/* ══ AUTO-TOGGLE ROW ══ */
.__qtogrow {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 10px 12px; border-radius: 10px; margin-bottom: 8px;
  background: rgba(124,77,255,0.08); border: 1px solid rgba(124,77,255,0.22);
}
.__qtoglbl { font-size: 12px; font-weight: 800; color: #EDE7F6; }
.__qtogsub { font-size: 9px; color: rgba(237,231,246,0.45); margin-top: 2px; }

/* MD3 Switch */
.__qtog { position: relative; width: 46px; height: 26px; flex-shrink: 0; cursor: pointer; display: block; }
.__qtog input { opacity: 0; width: 0; height: 0; position: absolute; }
.__qsl {
  position: absolute; inset: 0; border-radius: 26px;
  background: rgba(255,255,255,0.1); border: 1.5px solid rgba(255,255,255,0.15);
  transition: background .25s, border-color .25s, box-shadow .25s;
}
.__qsl::before {
  content: ""; position: absolute;
  width: 18px; height: 18px; left: 3px; top: 2px;
  border-radius: 50%; background: rgba(255,255,255,0.4);
  box-shadow: 0 1px 4px rgba(0,0,0,0.4);
  transition: transform .25s cubic-bezier(.34,1.56,.64,1), background .25s;
}
.__qtog input:checked + .__qsl {
  background: linear-gradient(135deg, #7C4DFF, #448AFF);
  border-color: transparent;
  box-shadow: 0 0 14px rgba(124,77,255,0.55);
}
.__qtog input:checked + .__qsl::before {
  transform: translateX(20px); background: #fff;
  box-shadow: 0 1px 6px rgba(124,77,255,0.45);
}

/* ══ КНОПКИ — головне виправлення ══ */
.__qbtn {
  width: 100%;
  /* Фіксована висота — прибирає стрибки */
  height: 42px;
  padding: 0 16px;
  border: none; border-radius: 10px;
  font-size: 13px; font-weight: 700;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center; gap: 8px;
  margin-bottom: 7px;
  /* will-change замість transform — не викликає reflow */
  will-change: filter, box-shadow;
  transition: filter .15s ease, box-shadow .15s ease, opacity .15s ease;
  touch-action: manipulation;
  /* Без overflow:hidden — щоб не клипити тінь */
}
.__qbtn:last-child { margin-bottom: 0; }
.__qbtn:active { filter: brightness(.88); }
.__qbtn:disabled { opacity: .38; cursor: not-allowed; filter: none; }

/* Filled — основна */
.__qbp {
  background: linear-gradient(135deg, #7C4DFF 0%, #3D7BFF 100%);
  color: #fff;
  box-shadow: 0 3px 14px rgba(124,77,255,0.45);
}
.__qbp:hover:not(:disabled) {
  box-shadow: 0 4px 20px rgba(124,77,255,0.65);
  filter: brightness(1.08);
}

/* Tonal — скріншот */
.__qbs {
  background: rgba(124,77,255,0.15);
  border: 1.5px solid rgba(124,77,255,0.35);
  color: #CE93D8;
}
.__qbs:hover:not(:disabled) { background: rgba(124,77,255,0.25); filter: none; box-shadow: 0 2px 12px rgba(124,77,255,0.3); }

/* Danger — очистити */
.__qbd {
  background: rgba(255,82,82,0.12);
  border: 1.5px solid rgba(255,82,82,0.28);
  color: #FF8A80;
}
.__qbd:hover { background: rgba(255,82,82,0.2); filter: none; }

/* Success — зберегти */
.__qbc {
  background: rgba(105,240,174,0.12);
  border: 1.5px solid rgba(105,240,174,0.28);
  color: #69F0AE;
}
.__qbc:hover { background: rgba(105,240,174,0.2); filter: none; }

/* ══ STATUS TEXT ══ */
.__qst { font-size: 10px; color: rgba(237,231,246,0.45); padding: 6px 2px 0; min-height: 16px; line-height: 1.5; }
.__qst.an { color: #FFB74D; }
.__qst.ok { color: #82B1FF; }
.__qst.er { color: #FF6B6B; }

/* ══ RESULTS ══ */
.__qresults { margin-top: 8px; }
.__qresult-item {
  padding: 10px 12px; border-radius: 10px; margin-bottom: 7px;
  background: rgba(105,240,174,0.06); border: 1px solid rgba(105,240,174,0.22);
}
.__qresult-item.er { background: rgba(255,82,82,0.06); border-color: rgba(255,82,82,0.22); }
.__qresult-q { font-size: 10px; color: rgba(237,231,246,0.55); margin-bottom: 4px; line-height: 1.5; }
.__qresult-a { font-size: 11px; font-weight: 700; color: #69F0AE; display: flex; align-items: flex-start; gap: 5px; line-height: 1.6; }
.__qresult-a.er { color: #FF6B6B; }
.__qresult-order { font-size: 10px; color: rgba(237,231,246,0.65); line-height: 1.6; }
.__qresult-order b { color: #82B1FF; }
.__qresult-match { font-size: 10px; color: rgba(237,231,246,0.65); line-height: 1.7; }
.__qresult-match b { color: #82B1FF; }

/* ══ NO KEY ══ */
.__qnokey {
  font-size: 10px; color: #FF8A80; padding: 10px 12px;
  background: rgba(255,82,82,0.1); border: 1px solid rgba(255,82,82,0.22);
  border-radius: 10px; margin-bottom: 8px; line-height: 1.6;
}
.__qnokey a { color: #82B1FF; text-decoration: none; font-weight: 700; }

/* ══ DIVIDER ══ */
.__qdiv {
  height: 1px; margin: 8px 0;
  background: linear-gradient(to right, transparent, rgba(124,77,255,0.35), transparent);
}

/* ══ CAPTURE HINT ══ */
.__qcap-hint {
  font-size: 10px; color: #B39DDB; padding: 9px 11px;
  background: rgba(124,77,255,0.1); border: 1px solid rgba(124,77,255,0.22);
  border-radius: 10px; margin-bottom: 7px; line-height: 1.6;
}

/* ══ SETTINGS ══ */
.__qsect { display: none; margin-bottom: 8px; }
.__qsecttoggle {
  font-size: 11px; font-weight: 700; color: #B39DDB; cursor: pointer;
  padding: 10px 12px; background: rgba(124,77,255,0.1);
  border: 1px solid rgba(124,77,255,0.25); border-radius: 10px;
  display: flex; align-items: center; justify-content: space-between;
  user-select: none; touch-action: manipulation;
  will-change: background; transition: background .15s;
}
.__qsecttoggle:hover { background: rgba(124,77,255,0.18); }
.__qsecttoggle span { font-size: 10px; color: rgba(179,157,219,0.55); transition: transform .2s; }
.__qsectbody { padding: 8px 0 2px; }
.__qprovrow { display: flex; gap: 6px; margin-bottom: 8px; }
.__qprov {
  flex: 1; height: 36px; padding: 0 6px;
  border: 1.5px solid rgba(124,77,255,0.22); border-radius: 8px;
  background: rgba(255,255,255,0.04); color: rgba(237,231,246,0.55);
  font-size: 11px; font-weight: 700; cursor: pointer;
  touch-action: manipulation; will-change: background;
  transition: background .15s, border-color .15s, color .15s;
}
.__qprov.active {
  background: rgba(124,77,255,0.28); border-color: rgba(124,77,255,0.6);
  color: #EDE7F6; box-shadow: 0 2px 10px rgba(124,77,255,0.3);
}
.__qprov:hover:not(.active) { background: rgba(255,255,255,0.07); border-color: rgba(124,77,255,0.35); color: rgba(237,231,246,0.8); }

.__qapirow { position: relative; margin-bottom: 7px; }
.__qapiinput {
  width: 100%; height: 38px; padding: 0 12px;
  border: 1.5px solid rgba(124,77,255,0.22); border-radius: 8px;
  font-size: 11px; outline: none; box-sizing: border-box;
  background: rgba(255,255,255,0.04); color: #EDE7F6;
  transition: border-color .15s, box-shadow .15s;
}
.__qapiinput::placeholder { color: rgba(237,231,246,0.28); }
.__qapiinput:focus { border-color: rgba(124,77,255,0.55); box-shadow: 0 0 0 3px rgba(124,77,255,0.14); }
.__qapiinput.hide-text { -webkit-text-security: disc; }
.__qapibtnrow { display: flex; gap: 6px; margin-bottom: 7px; }
.__qapibtn {
  flex: 1; height: 34px; padding: 0 8px;
  border: 1.5px solid rgba(124,77,255,0.22); border-radius: 8px;
  background: rgba(255,255,255,0.04); font-size: 11px; font-weight: 700;
  cursor: pointer; touch-action: manipulation; color: #B39DDB;
  will-change: background; transition: background .15s, border-color .15s;
}
.__qapibtn:hover { background: rgba(124,77,255,0.14); border-color: rgba(124,77,255,0.38); }
.__qapipreview { font-size: 9px; color: rgba(179,157,219,0.55); margin-bottom: 6px; min-height: 13px; word-break: break-all; line-height: 1.4; }

/* ══ HISTORY ══ */
.__qhistory { margin-top: 8px; }
.__qhistory-title {
  font-size: 9px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase;
  color: rgba(237,231,246,0.35); margin-bottom: 6px; padding: 0 2px;
}
.__qhistory-item {
  padding: 8px 10px; border-radius: 8px; margin-bottom: 6px;
  background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07);
  cursor: pointer; will-change: background;
  transition: background .15s, border-color .15s;
}
.__qhistory-item:hover { background: rgba(124,77,255,0.08); border-color: rgba(124,77,255,0.22); }
.__qhistory-q { font-size: 10px; color: rgba(237,231,246,0.6); margin-bottom: 2px; line-height: 1.4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.__qhistory-a { font-size: 9px; color: #69F0AE; line-height: 1.5; }
.__qhistory-time { font-size: 8px; color: rgba(237,231,246,0.28); margin-top: 2px; }
.__qhistory-empty { font-size: 10px; color: rgba(237,231,246,0.28); text-align: center; padding: 16px; line-height: 1.5; }

/* ══ RESTORE PILL ══ */
#__qrestpill {
  position: fixed; bottom: 22px; right: 0; z-index: 2147483646;
  background: linear-gradient(135deg, #6a3de8, #3a7bd5);
  border: 1.5px solid rgba(124,77,255,0.45);
  color: #EDE7F6; font-size: 20px; border-radius: 16px 0 0 16px;
  width: 46px; height: 46px; display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 18px rgba(124,77,255,0.5); cursor: pointer;
  touch-action: manipulation; user-select: none;
  animation: __qslide .3s cubic-bezier(.2,0,0,1);
  will-change: box-shadow; transition: box-shadow .15s;
}
#__qrestpill:hover { box-shadow: 0 6px 24px rgba(124,77,255,0.7); }
@keyframes __qslide { from { transform: translateX(46px); opacity: 0; } to { transform: none; opacity: 1; } }

/* ══ MOBILE ══ */
@media (max-width: 480px) {
  #__qcard { width: calc(100vw - 10px); bottom: 70px; }
  .__qoverview { grid-template-columns: 1fr; }
  .__qbody { max-height: 64vh; }
  #__qfab { width: 52px; height: 52px; font-size: 22px; }
  #__qfabmeta { display: none; }
}
</style>

<div id="__qcard">
  <div class="__qhdr">
    <div>
      <span class="__qhtitle">🧠 Quiz AI</span>
      <div class="__qhmeta">
        <span class="__qchip" id="__qversion">v${version}</span>
        <span class="__qchip" id="__qenginestatus">${statusLabel}</span>
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:6px;">
      ${/Mobi|Android/i.test(navigator.userAgent) ? '' : '<span class="__qhshort">Ctrl+Shift+Q</span>'}
      <button class="__qhide" id="__qhidebtn" title="Сховати">✕</button>
    </div>
  </div>
  <div class="__qbody">

    <!-- Ліміт / Стан -->
    <div class="__qoverview">
      <div class="__qov">
        <div class="__qovk">Ліміт</div>
        <div class="__qovv" id="__qusage">${usageLabel}</div>
      </div>
      <div class="__qov">
        <div class="__qovk">Стан</div>
        <div class="__qovv sm" id="__qusagereset">${usageReset}</div>
      </div>
    </div>

    <!-- Поточна модель -->
    <div class="__qhint">
      <div class="__qhintk">Модель</div>
      <div class="__qhintv" id="__qenginefull">${statusLabel}</div>
    </div>

    <!-- Fallback -->
    <div class="__qhint">
      <div class="__qhintk">Порядок fallback</div>
      <div class="__qhintv" id="__qfallback">${fallbackLabel}</div>
    </div>

    <!-- Налаштування API -->
    <div class="__qsect">
      <div class="__qsecttoggle" id="__qsettoggle">
        ⚙️ API Налаштування${!hasKey ? ' ⚠️' : ''}
        <span id="__qsetarrow">▼</span>
      </div>
      <div class="__qsectbody" id="__qsetbody" style="display:${!hasKey ? 'block' : 'none'}">
        <div class="__qprovrow">
          <button class="__qprov active" id="__qprov_groq">⚡ Groq</button>
          <button class="__qprov"        id="__qprov_gem">✨ Gemini</button>
        </div>
        <div class="__qapirow">
          <input class="__qapiinput" type="text" id="__qapiinput" placeholder="Вставити API ключ…" autocomplete="off" autocorrect="off" spellcheck="false">
        </div>
        <div class="__qapibtnrow">
          <button class="__qapibtn" id="__qpastebtn">📋 Вставити</button>
          <button class="__qapibtn" id="__qeyebtn">👁 Сховати</button>
        </div>
        <div class="__qapipreview" id="__qapipreview"></div>
        <button class="__qbtn __qbc" id="__qsavekeybtn">💾 Зберегти ключ</button>
      </div>
    </div>

    <!-- Авто-аналіз -->
    <div class="__qtogrow">
      <div>
        <div class="__qtoglbl">Авто-аналіз</div>
        <div class="__qtogsub" id="__qtogsub">${en ? 'Увімкнено • кожні 10 сек' : 'Вимкнено'}</div>
      </div>
      <label class="__qtog">
        <input type="checkbox" id="__qtogchk" ${en ? 'checked' : ''}>
        <span class="__qsl"></span>
      </label>
    </div>

    <!-- Дії -->
    <button class="__qbtn __qbp" id="__qabtn" ${!hasKey ? 'disabled' : ''}>
      🔍 Аналізувати сторінку
    </button>
    <button class="__qbtn __qbs" id="__qscreenbtn" ${!hasKey ? 'disabled' : ''}>
      📸 Скріншот ділянки
    </button>
    <button class="__qbtn __qbd" id="__qcbtn">
      🗑 Очистити результати
    </button>

    <div class="__qst" id="__qst"></div>
    <div id="__qresults"></div>

    <!-- Історія -->
    <div class="__qhistory" id="__qhistory">
      <div class="__qdiv"></div>
      <div class="__qhistory-title">Історія (останні 3)</div>
      <div id="__qhistory-list"></div>
    </div>

  </div>
</div>

<div id="__qfab">🧠<div id="__qdot"></div><div id="__qfabmeta">${statusLabel}</div></div>`;
}
