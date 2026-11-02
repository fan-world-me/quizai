// Quiz AI Analyzer - Background Service Worker
// Author: fan_world_me
const ENGINE_COOLDOWN_MS = 15 * 60 * 1000;
const APP_VERSION = chrome.runtime.getManifest().version;
const FALLBACK_LABEL = 'Groq → NVIDIA → Gemini → OpenRouter';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const NVIDIA_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const AUTH_CONFIG_URL = chrome.runtime.getURL('auth.json');

// Model IDs verified against provider docs on 2026-10-26.
// NVIDIA NIM: nemotron-3.5-lightning-30b-a3b and nemotron-3-ultra-550b-a55b confirmed live in API catalog.
//   nemotron-3-super-120b-a12b was deprecated on 2026-10-19 — replaced with nemotron-3.5-super-vl-120b-a12b,
//   a vision-language model released 2026-10-15 and confirmed available on integrate.api.nvidia.com.
// OpenRouter: nemotron-3-super-120b-a12b:free removed from free tier ~Oct 27-28 2026;
//   replaced with nvidia/nemotron-3.5-lightning:free (confirmed free Nov 2 2026).
// Groq: gpt-oss-20b, gpt-oss-120b and qwen3.8-27b are confirmed production models (paid, not free).
// Gemini: 3.5-flash-lite and 3.8-flash are confirmed stable on ai.google.dev as of Oct 22, 2026.
//   Gemini 3.x ignores thinkingBudget silently — use thinkingLevel only.
const NVIDIA_TEXT_MODELS = [
  'nvidia/nemotron-3.5-lightning-30b-a3b',
  'nvidia/nemotron-3-ultra-550b-a55b',
];
const NVIDIA_VISION_MODELS = [
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
  'nvidia/nemotron-3.5-super-vl-120b-a12b',
];

// OpenRouter free tier (verified Nov 2, 2026).
// nemotron-3-super-120b-a12b:free was removed from free tier ~Oct 27-28 2026.
// Replaced with nemotron-3.5-lightning:free (active free) + ultra as backup.
const OPENROUTER_TEXT_MODELS = ['nvidia/nemotron-3.5-lightning:free', 'nvidia/nemotron-3-ultra-550b-a55b:free'];
const OPENROUTER_VISION_MODELS = ['google/gemma-4-31b-it:free', 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free'];
