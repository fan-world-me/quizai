# Quiz AI Analyzer

Браузерне розширення для автоматичного аналізу тестів за допомогою AI.  
Підтримує **Chrome** та **Firefox**.

**Підтримувані платформи:** vseosvita.ua · zno.osvita.ua · naurok.ua · Moodle · Google Forms · Kahoot · будь-який сайт (generic-парсер)

**AI-провайдери:** NVIDIA · OpenRouter · Gemini · Groq

---

## Структура проєкту

```
quaz_ai/
├── src/                    # Вихідний код
│   ├── background.js       # Service worker, виклики AI API
│   ├── content.js          # Контент-скрипт, UI на сторінці
│   ├── popup.html/js/css   # Попап розширення
│   ├── howto.html/css      # Сторінка довідки
│   ├── auth.json           # Ваші API-ключі (не комітити!)
│   ├── auth.example.json   # Приклад структури ключів
│   ├── Monocraft.ttf       # Вбудований шрифт
│   ├── icons/              # Іконки розширення
│   └── parsers/            # Парсери для різних платформ
│       ├── engine.js       # Вибір парсера за hostname
│       ├── base.js         # Базовий клас парсера
│       ├── moodle.js
│       ├── osvita.js
│       ├── google-forms.js
│       └── generic.js      # Fallback для будь-якого сайту
├── manifests/
│   ├── chrome/manifest.json
│   └── firefox/manifest.json
├── dist/                   # Зібрані файли (генерується скриптом)
└── package-extensions.ps1  # Скрипт збірки (PowerShell)
```

---

## Налаштування API-ключів

Скопіюйте `src/auth.example.json` у `src/auth.json` і вставте свої ключі:

```json
{
  "nvidiaKeys": [
    "nvapi-ваш_ключ_тут"
  ],
  "openrouterKeys": [
    "sk-or-v1-ваш_ключ_тут"
  ],
  "geminiKeys": [
    "AIzaSy-перший_ключ",
    "AIzaSy-другий_ключ"
  ],
  "groqKeys": [
    "gsk_ваш_ключ_тут"
  ]
}
```

- Можна вказати **кілька ключів** для кожного провайдера — розширення буде перемикатися між ними при помилках/лімітах.
- Непотрібні провайдери можна залишити з порожнім масивом `[]`.
- Порядок спроб: **Gemini → OpenRouter → NVIDIA → Groq** (fallback-ланцюжок).

**Де отримати ключі:**
| Провайдер | Посилання |
|-----------|-----------|
| Gemini | https://aistudio.google.com/app/apikey |
| Groq | https://console.groq.com/keys |
| NVIDIA | https://build.nvidia.com |
| OpenRouter | https://openrouter.ai/keys |

> ⚠️ `auth.json` додано до `.gitignore`. Ніколи не комітьте реальні ключі.

---

## Збірка

Потрібен **PowerShell** (вбудований у Windows).

```powershell
cd C:\шлях\до\quaz_ai
.\package-extensions.ps1
```

Скрипт створить:
```
dist/
├── chrome-unpacked/     # Розпакована версія для Chrome
├── firefox-unpacked/    # Розпакована версія для Firefox
├── quiz-ai-chrome.zip   # Архів для Chrome Web Store
└── quiz-ai-firefox.zip  # Архів для Firefox Add-ons
```

> `auth.json` **не потрапляє** до zip-архівів (видаляється скриптом автоматично), але присутній у `*-unpacked` папках для локального використання.

---

## Встановлення

### Chrome / Edge / Brave

1. Відкрийте `chrome://extensions/`
2. Увімкніть **Режим розробника** (Developer mode) у правому верхньому куті
3. Натисніть **Завантажити нерозпакований** (Load unpacked)
4. Виберіть папку `dist/chrome-unpacked`

### Firefox

1. Відкрийте `about:debugging#/runtime/this-firefox`
2. Натисніть **Завантажити тимчасовий додаток** (Load Temporary Add-on)
3. Виберіть файл `dist/firefox-unpacked/manifest.json`

> Для постійного встановлення у Firefox потрібен підписаний `.xpi` — завантажте через [addons.mozilla.org](https://addons.mozilla.org) або використовуйте Firefox Developer Edition / Nightly з вимкненою перевіркою підпису.

---

## Кастомний шрифт

За замовчуванням використовується `Monocraft.ttf`.

**Щоб замінити шрифт:**

1. Покладіть файл шрифту (`.ttf`, `.woff`, `.woff2`) у папку `src/`
2. Відредагуйте `src/popup.css` — знайдіть блок `@font-face` на початку файлу:

```css
@font-face {
  font-family: 'CustomFont';
  src: url('Monocraft.ttf') format('truetype'); /* ← змініть назву файлу */
  font-weight: normal;
  font-style: normal;
}
```

3. Там же у `:root` оновіть змінну `--font-family`:

```css
:root {
  --font-family: CustomFont, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
```

4. Пересоберіть розширення (`.\package-extensions.ps1`) або вручну скопіюйте файл шрифту у `dist/chrome-unpacked/` та `dist/firefox-unpacked/`.

---

## Кастомні стилі

Всі стилі попапу знаходяться у `src/popup.css`. Кольорова схема керується CSS-змінними у `:root`:

```css
:root {
  --bg: #040e16;                        /* фон сторінки */
  --panel: rgba(4,14,22,0.92);          /* фон карток */
  --text: #00e5ff;                      /* основний колір тексту */
  --muted: rgba(255,255,255,0.6);       /* приглушений текст */
  --line: rgba(0,229,255,0.2);          /* колір рамок */
  --blue: #00e5ff;                      /* акцентний колір */
  --red: #ff5252;                       /* колір помилок */
  --shadow: 0 8px 32px rgba(0,229,255,0.15); /* тінь карток */
  --radius: 18px;                       /* заокруглення */
}
```

Змініть ці змінні, щоб повністю перефарбувати інтерфейс без правки решти CSS.

---

## AI-моделі

Моделі задані у `src/background.js`. Щоб змінити — відредагуйте відповідні масиви:

```js
// NVIDIA
const NVIDIA_TEXT_MODELS = ['nvidia/llama-3.3-nemotron-super-49b-v1.5', ...];
const NVIDIA_VISION_MODELS = ['mistralai/mistral-large-3-675b-instruct-2512'];

// OpenRouter
const OPENROUTER_TEXT_MODELS = ['openai/gpt-oss-120b:free'];
const OPENROUTER_VISION_MODELS = ['openai/gpt-oss-120b:free'];

// Gemini
const GEMINI_TEXT_25 = ['gemini-2.5-flash-lite', 'gemini-2.5-flash'];
const GEMINI_TEXT_2  = ['gemini-2.0-flash-lite', 'gemini-2.0-flash'];
const GEMINI_TEXT_15 = ['gemini-1.5-flash-latest', 'gemini-1.5-flash'];

// Groq
const GROQ_TEXT_MODELS   = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', ...];
const GROQ_VISION_MODELS = ['meta-llama/llama-4-scout-17b-16e-instruct', ...];
```

Розширення перебирає моделі у масиві по черзі при помилках. Перша модель — пріоритетна.

---

## Ліцензія

[GPL-3.0](LICENSE) · Author: fan_world_me
