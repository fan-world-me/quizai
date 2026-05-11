# Quiz AI Analyzer

> Browser extension that automatically analyzes quiz pages and screenshots using multiple AI providers with smart fallback.

**Author:** `fan_world_me` · **Version:** 2.1 · **Browsers:** Chrome · Firefox

---

## Features

| Feature | Details |
|---|---|
| 🤖 Multi-provider AI | Gemini · OpenRouter · NVIDIA · Groq with automatic fallback |
| 📸 Screenshot analysis | Select any area — quiz or not, AI will analyze it |
| ✅ Answer highlighting | Automatically highlights correct answers on supported pages |
| 🔁 Auto-analysis loop | Detects new questions and re-analyzes without manual trigger |
| 💾 Offline history | Recent results cached locally to reduce API calls |
| 🌐 Supported platforms | vseosvita.ua · zno.osvita.ua · naurok.ua · Moodle · Google Forms · Kahoot · generic pages |

---

## AI Providers

Default fallback order (optimized for Ukrainian/Russian school content):

1. **Gemini** — primary, best OCR and multilingual support
2. **OpenRouter** — broad model selection
3. **NVIDIA** — fast inference
4. **Groq** — ultra-fast, vision fallback for screenshots

Each provider can be individually enabled or disabled from the popup. Disabled providers are skipped entirely.

---

## API Keys Setup

Copy `src/auth.example.json` to `src/auth.json` and fill in your keys:

```json
{
  "geminiKeys":      ["AIzaSyYourGeminiKey"],
  "openrouterKeys":  ["sk-or-v1-your_openrouter_key"],
  "nvidiaKeys":      ["nvapi-your_nvidia_key"],
  "groqKeys":        ["gsk_your_groq_key"]
}
```

> `src/auth.json` is git-ignored and never included in zip packages.  
> Multiple keys per provider are supported — the extension rotates them on rate-limit errors.

---

## Build

Requires PowerShell. Run from the repository root:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\package-extensions.ps1
```

Output:

```
dist/
  chrome-unpacked/      ← load in Chrome
  firefox-unpacked/     ← load in Firefox
  quiz-ai-chrome.zip
  quiz-ai-firefox.zip
```

---

## Load in Browser

**Chrome**
1. Go to `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select `dist/chrome-unpacked`

**Firefox**
1. Go to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Select `manifest.json` inside `dist/firefox-unpacked`

---

## Disclaimer

AI answers can be wrong. Always review results before relying on them, especially for unclear screenshots, unusual quiz layouts, or classroom-specific questions.
