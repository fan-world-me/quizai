# Quiz AI Analyzer

Browser extension for automatic quiz analysis with Gemini and Groq fallback.

## Fallback order

Text and image requests are sent in this order:

1. `gemini-2.5-flash-lite`
2. `gemini-2.5-flash`
3. `gemini-2.0-flash-lite`
4. `gemini-2.0-flash`
5. Groq fallback models

For each model, the extension first tries all available API keys one by one. Only after all keys for the current model are exhausted or temporarily rate-limited does it move to the next model.

## Project structure

- `src/` - extension source files
- `src/auth.example.json` - example file for API keys
- `src/auth.json` - local secrets file used by the extension
- `manifests/` - Chrome and Firefox manifests
- `package-extensions.ps1` - build script

## Add API keys

1. Create `src/auth.json` from `src/auth.example.json`.
2. Put your Gemini keys into `geminiKeys`.
3. Put your Groq key into `groqKeys`.

Example:

```json
{
  "geminiKeys": [
    "AIzaSyYourFirstGeminiKey",
    "AIzaSyYourSecondGeminiKey"
  ],
  "groqKeys": [
    "gsk_your_groq_key"
  ]
}
```

Notes:

- `src/auth.json` is ignored by Git.
- Users can still add or override keys from the extension UI via `chrome.storage.sync`.
- If UI keys exist, they are used first. `src/auth.json` is used as bundled fallback.

## Build

Run in PowerShell from the project root:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\package-extensions.ps1
```

Build output:

- `dist/chrome-unpacked`
- `dist/firefox-unpacked`
- `dist/quiz-ai-chrome.zip`
- `dist/quiz-ai-firefox.zip`

## Load into browser

### Chrome

1. Open `chrome://extensions`
2. Enable Developer mode
3. Click `Load unpacked`
4. Select `dist/chrome-unpacked`

### Firefox

1. Open `about:debugging#/runtime/this-firefox`
2. Click `Load Temporary Add-on`
3. Select any file inside `dist/firefox-unpacked`, usually `manifest.json`

## Publish to Git

Before pushing:

1. Verify `src/auth.json` is not staged.
2. Verify `dist/` is not staged.
3. Commit source files, manifests, `README.md`, and `src/auth.example.json`.
