[![Telegram](https://img.shields.io/badge/Telegram-@fan__world__me-2CA5E0?style=flat-square&logo=telegram)](https://t.me/fan_world_me)   [![Discord](https://img.shields.io/badge/Discord-fan__world__me-5865F2?style=flat-square&logo=discord)](https://discord.com/users/fan_world_me)   [![GitHub](https://img.shields.io/badge/GitHub-fan--world--me-181717?style=flat-square&logo=github)](https://github.com/fan-world-me)   [![Portfolio](https://img.shields.io/badge/Portfolio-fan--world--me.github.io-00e5ff?style=flat-square&logo=githubpages&logoColor=white)](https://fan-world-me.github.io/)

```
 ██████╗ ██╗   ██╗██╗███████╗     █████╗ ██╗
██╔═══██╗██║   ██║██║╚══███╔╝    ██╔══██╗██║
██║   ██║██║   ██║██║  ███╔╝     ███████║██║
██║▄▄ ██║██║   ██║██║ ███╔╝      ██╔══██║██║
╚██████╔╝╚██████╔╝██║███████╗    ██║  ██║██║
 ╚══▀▀═╝  ╚═════╝ ╚═╝╚══════╝    ╚═╝  ╚═╝╚═╝
  Quiz AI Analyzer v2.8 — Chrome & Firefox browser extension
```

Browser extension that adds a floating AI panel to quiz pages — detects questions and answers automatically, analyzes screenshots for image/formula questions, and falls back across four AI providers without you having to do anything.

### 💭 More about this extension

- 🤖 **Auto-analysis loop** — scans the page continuously, highlights detected correct answers
- 📷 **Screenshot mode** — select any screen area and analyze as image (charts, formulas, diagrams)
- 🎯 **Answer highlighting** — visually marks the correct option directly on the page
- 🔄 **Matching & ordering** — handles pair-matching and ordering question types
- 🌐 **Multi-site support** — vseosvita.ua, zno.osvita.ua, naurok.ua, Moodle, Google Forms, Kahoot, Classtime, and generic radio/checkbox layouts
- ⚡ **4-provider fallback** — Groq → NVIDIA → Gemini → OpenRouter; auto-retries on failure or rate limit
- 🔐 **Fullscreen-aware** — panel and screenshot overlay work inside Kahoot/Moodle fullscreen modes
- 🛡️ **Moodle secure-window** — special handling for restricted Moodle quiz environments

---

### 🌐 Supported Sites

| Site | Question types |
|---|---|
| vseosvita.ua | choices, matching, ordering, short/open text |
| zno.osvita.ua | choices |
| naurok.ua / naurok.com.ua | choices |
| Moodle | quiz pages (multi-choice, short answer) |
| Google Forms | radio, checkbox, short answer |
| Kahoot | quiz, true/false, multi-select, jumble/ordering *(pin/map intentionally skipped)* |
| Classtime | choices |
| Generic | radio/checkbox/question layouts on any other site |

---

### 🧰 Tech Stack

**Core**
![JavaScript](https://img.shields.io/badge/JavaScript-ES2022-F7DF1E?style=flat-square&logo=javascript&logoColor=black)
![Chrome Extensions](https://img.shields.io/badge/Chrome_Extensions-MV3-4285F4?style=flat-square&logo=googlechrome&logoColor=white)
![Firefox](https://img.shields.io/badge/Firefox_Add--ons-MV3-FF7139?style=flat-square&logo=firefox&logoColor=white)

**AI Providers**
![Groq](https://img.shields.io/badge/Groq-primary-F55036?style=flat-square)
![NVIDIA](https://img.shields.io/badge/NVIDIA-fallback-76B900?style=flat-square&logo=nvidia&logoColor=white)
![Gemini](https://img.shields.io/badge/Gemini-fallback-4285F4?style=flat-square&logo=google&logoColor=white)
![OpenRouter](https://img.shields.io/badge/OpenRouter-fallback-6B21A8?style=flat-square)

**APIs used**
![Storage API](https://img.shields.io/badge/Storage_API-settings-00e5ff?style=flat-square)
![Tabs API](https://img.shields.io/badge/Tabs_API-messaging-00e5ff?style=flat-square)
![Scripting API](https://img.shields.io/badge/Scripting_API-injection-00e5ff?style=flat-square)
![Clipboard API](https://img.shields.io/badge/Clipboard_API-read-00e5ff?style=flat-square)

---

### 🗂️ Project Structure

```
quaz_ai/
├── src/
│   ├── background.js        — AI provider calls, fallback chain, model lists
│   ├── content.js           — floating panel, quiz detection, answer highlighting, screenshot selection
│   ├── popup.html           — extension popup markup
│   ├── popup.css            — popup styles (Monocraft font)
│   ├── popup.js             — popup settings and actions
│   ├── howto.html           — built-in help page
│   ├── howto.css            — help page styles
│   ├── auth.example.json    — example API-key config (copy → auth.json)
│   ├── auth.json            — your API keys — local only, git-ignored
│   ├── Monocraft.ttf        — bundled UI font
│   └── icons/               — 16 / 48 / 128 px PNG icons
├── manifests/
│   ├── chrome/manifest.json — Chrome MV3 manifest
│   └── firefox/manifest.json— Firefox MV3 manifest
├── dist/                    — generated build output (gitignored)
├── package-extensions.ps1   — build & package script
└── LICENSE
```

---

### 🚀 How it works

```
[Page loads] ──► content.js detects site ──► extracts questions & answers
                        │
                        ▼
             [Send to background.js]
                        │
             ┌──────────┴──────────┐
             │  Provider fallback  │
             │  Groq → NVIDIA      │
             │  → Gemini           │
             │  → OpenRouter       │
             └──────────┬──────────┘
                        │
                        ▼
             [Parse ANSWER:/ORDER:/MATCHING: prefix]
                        │
                        ▼
             [Highlight correct answer on page]
```

---

### 🔑 API Keys

Copy `src/auth.example.json` to `src/auth.json` and fill in your keys:

```json
{
  "groqKeys":       ["gsk_your_key_here"],
  "nvidiaKeys":     ["nvapi-your_key_here"],
  "geminiKeys":     ["AIzaSy-your_key_here"],
  "openrouterKeys": ["sk-or-v1-your_key_here"]
}
```

You can provide multiple keys per provider — they'll be rotated on rate limit.  
Empty arrays `[]` are fine for providers you don't use.

| Provider | Key page |
|---|---|
| Groq | https://console.groq.com/keys |
| NVIDIA | https://build.nvidia.com |
| Gemini | https://aistudio.google.com/app/apikey |
| OpenRouter | https://openrouter.ai/keys |

> `src/auth.json` is gitignored and must never be committed.

---

### 📦 Build

```powershell
.\package-extensions.ps1
```

Output in `dist/`:

```
dist/
├── chrome-unpacked/      — load in Chrome/Edge/Brave developer mode
├── firefox-unpacked/     — load in Firefox temporary add-on mode
├── quiz-ai-chrome.zip    — Chrome package (without auth.json)
└── quiz-ai-firefox.zip   — Firefox package (without auth.json)
```

---

### 🛠️ Install Locally

**Chrome / Edge / Brave**
```
1. Open chrome://extensions
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select dist/chrome-unpacked
```

**Firefox**
```
1. Open about:debugging#/runtime/this-firefox
2. Click "Load Temporary Add-on"
3. Select dist/firefox-unpacked/manifest.json
```

After rebuilding, reload the extension and refresh the quiz tab.

---

### 🔒 Security note

> API keys are stored in `src/auth.json` — local file, never uploaded.  
> Zip packages are built without `auth.json`.  
> The unpacked `dist/*-unpacked` folders may include your local `auth.json` for testing only.

---

### 📄 License

[GPL-3.0](LICENSE) © [fan-world-me](https://github.com/fan-world-me)

---

Made with 🩵 in Ukraine 🇺🇦

[![Telegram](https://img.shields.io/badge/Telegram-@fan__world__me-2CA5E0?style=flat-square&logo=telegram)](https://t.me/fan_world_me)   [![Discord](https://img.shields.io/badge/Discord-fan__world__me-5865F2?style=flat-square&logo=discord)](https://discord.com/users/fan_world_me)   [![Portfolio](https://img.shields.io/badge/Portfolio-fan--world--me.github.io-00e5ff?style=flat-square&logo=githubpages&logoColor=white)](https://fan-world-me.github.io/)
