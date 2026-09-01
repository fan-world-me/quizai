# Quiz AI Analyzer

Browser extension for AI-assisted quiz analysis. It adds a floating panel to quiz pages, detects questions and answers on supported sites, can analyze selected screen areas as images, and falls back across several AI providers.

Supports Chrome/Chromium browsers and Firefox.

## Supported Sites

- vseosvita.ua
- zno.osvita.ua
- naurok.ua / naurok.com.ua
- Moodle quiz pages
- Google Forms
- Kahoot (quiz, true/false, multi-select, jumble/ordering, open text; pin/map questions are intentionally not supported)
- Classtime
- Generic radio/checkbox/question layouts on other sites

Vseosvita support includes regular choices, matching, ordering, and short/open text answers.

## AI Providers

Provider fallback order:

1. Groq
2. NVIDIA
3. Gemini
4. OpenRouter

Text and image analysis are configured in [src/background.js](src/background.js). Screenshot/area selection uses vision-capable provider paths, so questions with charts, diagrams, formulas, or nearby images should be analyzed with the **Screenshot** button.

## Project Structure

```text
quaz_ai/
|-- src/
|   |-- background.js        # AI provider calls, fallback order, model lists
|   |-- content.js           # Floating panel, quiz detection, highlighting, screenshot selection
|   |-- popup.html           # Extension popup markup
|   |-- popup.css            # Popup styles
|   |-- popup.js             # Popup settings and actions
|   |-- howto.html           # Help page
|   |-- howto.css            # Help page styles
|   |-- auth.example.json    # Example API-key config
|   |-- auth.json            # Local API keys, ignored by git
|   |-- Monocraft.ttf        # Bundled UI font
|   `-- icons/               # Extension icons
|-- manifests/
|   |-- chrome/manifest.json # Chrome MV3 manifest
|   `-- firefox/manifest.json# Firefox manifest
|-- dist/                    # Generated build output
|-- package-extensions.ps1   # Build/package script
|-- LICENSE
`-- README.md
```

There is no separate `src/parsers/` folder anymore. Site detection and parsing logic currently lives inside [src/content.js](src/content.js).

## API Keys

Copy [src/auth.example.json](src/auth.example.json) to `src/auth.json`, then add your keys:

```json
{
  "groqKeys": ["gsk_your_key_here"],
  "nvidiaKeys": ["nvapi-your_key_here"],
  "geminiKeys": ["AIzaSy-your_key_here"],
  "openrouterKeys": ["sk-or-v1-your_key_here"]
}
```

Notes:

- You can provide several keys per provider.
- Empty arrays are allowed for providers you do not use.
- `src/auth.json` is ignored by git and must not be committed.
- The build script excludes `auth.json` from zip archives, but restores it into unpacked local folders for testing.

Key pages:

| Provider | URL |
| --- | --- |
| Groq | https://console.groq.com/keys |
| NVIDIA | https://build.nvidia.com |
| Gemini | https://aistudio.google.com/app/apikey |
| OpenRouter | https://openrouter.ai/keys |

## Build

Run from the project root:

```powershell
.\package-extensions.ps1
```

Generated output:

```text
dist/
|-- chrome-unpacked/      # Load this in Chrome/Edge/Brave developer mode
|-- firefox-unpacked/     # Load this in Firefox temporary add-on mode
|-- quiz-ai-chrome.zip    # Chrome package without auth.json
`-- quiz-ai-firefox.zip   # Firefox package without auth.json
```

## Install Locally

Chrome, Edge, Brave:

1. Open `chrome://extensions/`.
2. Enable Developer mode.
3. Click **Load unpacked**.
4. Select `dist/chrome-unpacked`.

Firefox:

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on**.
3. Select `dist/firefox-unpacked/manifest.json`.

After rebuilding, reload the extension and refresh the quiz tab.

## Main Features

- Floating panel on quiz pages.
- Auto-analysis loop when enabled.
- Manual **Analyze** button.
- **Screenshot** mode for image, formula, chart, and diagram questions.
- Highlighting of detected correct answers.
- Matching and ordering support where the site structure allows it.
- Kahoot support for regular choices, multi-select, open text, and jumble/ordering. Kahoot pin/map questions are intentionally ignored.
- Short/open-answer filling or highlighting.
- Provider fallback with clear error reporting.
- Fullscreen-aware panel and screenshot overlay.
- Moodle secure-window handling for the extension UI.

## Model Configuration

Model lists are kept in [src/background.js](src/background.js):

- `GROQ_TEXT_MODELS`
- `GROQ_VISION_MODELS`
- `NVIDIA_TEXT_MODELS`
- `NVIDIA_VISION_MODELS`
- `GEMINI_TEXT_25`, `GEMINI_TEXT_36`
- `OPENROUTER_TEXT_MODELS`
- `OPENROUTER_VISION_MODELS`

The extension tries models in array order and moves to the next provider/model when a request fails, times out, or is unavailable.

## Security

- Do not commit real API keys.
- Keep `src/auth.json` local.
- Zipped packages are built without `auth.json`.
- The unpacked `dist/*-unpacked` folders may include local `auth.json` for your own testing.

## License

[GPL-3.0](LICENSE)

Author: fan_world_me
