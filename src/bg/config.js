// Quiz AI Analyzer - background module: config.js
// Author: fan_world_me
const ENGINE_COOLDOWN_MS = 15 * 60 * 1000;
const APP_VERSION = chrome.runtime.getManifest().version;
const FALLBACK_LABEL = 'Groq → NVIDIA → Gemini → OpenRouter';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const NVIDIA_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const AUTH_CONFIG_URL = chrome.runtime.getURL('auth.json');
const QUIZ_SYSTEM_PROMPT = 'You solve quiz questions. The first characters of your response MUST be the requested label: ANSWER:, ORDER:, or MATCHING:. Return only the requested short format. No markdown, no translation, no restating the question, no thinking aloud.';
const OCR_SYSTEM_PROMPT = 'You are an OCR engine for quiz screenshots. Extract visible text exactly. Preserve language, letters, numbers, and option labels. Do not translate or explain.';
