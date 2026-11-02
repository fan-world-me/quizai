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

// Gemini: 2.0 is shut down; gemini-3.5-flash is a deprecated alias of 3.6.
// Current stable: 3.5-flash-lite and 3.8-flash (both confirmed on ai.google.dev, last updated 2026-10-22).
// Thinking: Gemini 3.x uses thinkingLevel only (thinkingBudget is silently ignored on Gemini 3).
//   3.5-flash-lite accepts "minimal"; 3.8-flash minimum accepted level is "low".
const GEMINI_TEXT_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.8-flash'];
const GEMINI_VISION_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.8-flash'];
const GEMINI_TIER = 'gemini-3';

// Groq: llama-3.1-8b-instant and llama-3.3-70b-versatile are Enterprise-only (08.2026);
// qwen3-32b, llama-4-*, qwen3.6-27b and groq/compound(-mini) are shut down (07-09.2026).
// gpt-oss-* are text-only; qwen3.8-27b is the only Groq model with vision support (up to 20 MB).
const GROQ_TEXT_MODELS = [
  'openai/gpt-oss-20b',
  'openai/gpt-oss-120b',
  'qwen/qwen3.8-27b',
];
const GROQ_VISION_MODELS = [
  'qwen/qwen3.8-27b',
];

const PROVIDER_ORDER = ['groq', 'nvidia', 'gemini', 'openrouter'];
const PROVIDER_LABELS = {
  gemini: 'Gemini',
  openrouter: 'OpenRouter',
  nvidia: 'NVIDIA',
  groq: 'Groq',
};
const QUIZ_SYSTEM_PROMPT = 'You solve quiz questions. The first characters of your response MUST be the requested label: ANSWER:, ORDER:, or MATCHING:. Return only the requested short format. No markdown, no translation, no restating the question, no thinking aloud.';
const OCR_SYSTEM_PROMPT = 'You are an OCR engine for quiz screenshots. Extract visible text exactly. Preserve language, letters, numbers, and option labels. Do not translate or explain.';

const engineState = new Map();
// Thinking is not needed for quiz answers, so it is switched off (or minimised) per provider docs:
//  - Groq qwen3.8: reasoning_effort "none". gpt-oss can't be fully disabled -> "low" + include_reasoning:false.
//  - NVIDIA Nemotron 3.x: chat_template_kwargs.enable_thinking=false (top-level field of the raw JSON body).
//  - Gemini 3.x: thinkingConfig.thinkingLevel only — thinkingBudget is silently ignored on Gemini 3 models.
//    Flash-Lite / 3.5 / 3.6 accept "minimal"; 3.8-flash minimum is "low".
//  - OpenRouter Nemotron/Gemma: reasoning.enabled=false. Nemotron-Super: no reasoning params needed (not a
//    reasoning model). gpt-oss if it returns to free tier: effort low, excluded from the response.
function groqReasoningParams(model) {
  if (/^qwen\//i.test(model)) return { reasoning_effort: 'none' };
  if (/gpt-oss/i.test(model)) return { reasoning_effort: 'low', include_reasoning: false };
  return {};
}
function nvidiaReasoningParams(model) {
  return /nemotron/i.test(model) ? { chat_template_kwargs: { enable_thinking: false } } : {};
}
function geminiThinkingConfig(model) {
  // thinkingBudget is silently ignored on Gemini 3.x — use thinkingLevel only.
  return { thinkingLevel: /lite|3\.6|3\.5/i.test(model) ? 'minimal' : 'low' };
}
function openRouterReasoningParams(model) {
  if (/gpt-oss/i.test(model)) return { reasoning: { effort: 'low', exclude: true } };
  // nemotron-super and nemotron-3.5-super-vl are not reasoning models, skip reasoning params
  if (/nemotron-3[.-]5?-super/i.test(model)) return {};
  return { reasoning: { enabled: false } };
}
