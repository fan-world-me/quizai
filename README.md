# Quiz AI Analyzer

Browser extension for analyzing quiz pages, school questions, and selected screenshot areas with multiple AI providers.

Author: `fan_world_me`

## Features

- Multi-provider AI fallback: Gemini, OpenRouter, NVIDIA, Groq
- User-selectable providers in the extension popup
- Default provider order tuned for Ukrainian/Russian school questions
- Screenshot analysis for both quiz and non-quiz images
- Automatic answer highlighting on supported quiz pages
- Auto-analysis loop with duplicate-question detection
- Offline history for recent results
- Answer cache to reduce repeated API calls
- Chrome and Firefox build outputs
- Monocraft-based UI

## Default Provider Order

The default order is:

1. Gemini
2. OpenRouter
3. NVIDIA
4. Groq

Users can enable one or more providers in the popup. If a provider is disabled, the extension skips it completely.

## Image Analysis

The screenshot tool is not limited to tests:

- If the selected image contains a quiz question, the extension returns an answer and a short explanation.
- If the selected image is not a quiz, the extension returns a short visual analysis.

Gemini Vision is used first by default because it is more reliable for OCR and Ukrainian/Russian school tasks. Groq vision can be used as a fallback when enabled.

## Project Structure

```text
src/
  background.js        AI provider logic, fallback, API calls
  content.js           Floating panel, page detection, highlighting, screenshots
  popup.html           Extension popup
  popup.css            Popup styles
  popup.js             Popup controls and provider selection
  howto.html           Built-in help page
  howto.css            Help page styles
  auth.example.json    Example API key file
  auth.json            Local secrets file, ignored by git
  Monocraft.ttf        Bundled UI font
  icons/               Extension icons
  parsers/             Experimental parser modules
manifests/
  chrome/manifest.json
  firefox/manifest.json
package-extensions.ps1
```

## API Keys

Create `src/auth.json` from `src/auth.example.json`:

```json
{
  "nvidiaKeys": ["nvapi-your_nvidia_key"],
  "openrouterKeys": ["sk-or-v1-your_openrouter_key"],
  "geminiKeys": ["AIzaSyYourGeminiKey"],
  "groqKeys": ["gsk_your_groq_key"]
}
```

Notes:

- `src/auth.json` is ignored by git.
- Local unpacked builds include `auth.json` so development works.
- Zip packages do not include `auth.json`, so secrets are not published.
- Users can also add keys through extension storage/UI where supported.

## Build

Run in PowerShell from the repository root:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\package-extensions.ps1
```

Build output:

- `dist/chrome-unpacked`
- `dist/firefox-unpacked`
- `dist/quiz-ai-chrome.zip`
- `dist/quiz-ai-firefox.zip`

## Load In Browser

Chrome:

1. Open `chrome://extensions`
2. Enable Developer mode
3. Click `Load unpacked`
4. Select `dist/chrome-unpacked`

Firefox:

1. Open `about:debugging#/runtime/this-firefox`
2. Click `Load Temporary Add-on`
3. Select `manifest.json` inside `dist/firefox-unpacked`

## Git Hygiene

Tracked:

- `src/`
- `manifests/`
- `package-extensions.ps1`
- `README.md`
- `LICENSE`

Ignored:

- `src/auth.json`
- `dist/`
- `*.zip`
- local IDE folders and cache folders
- custom local fonts, except bundled `src/Monocraft.ttf`

Before publishing, verify:

```powershell
git status --short
Get-ChildItem dist -Recurse -Filter auth.json
```

`auth.json` may exist in local unpacked folders, but it must not be committed and must not appear in zip packages.

## Disclaimer

AI answers can be wrong. Review results before relying on them, especially for unclear screenshots, unusual quiz layouts, or questions that depend on classroom-specific context.
