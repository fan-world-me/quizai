// Quiz AI Analyzer - Background Service Worker
// Author: fan_world_me
// Logic lives in ./bg/*. Chrome (service worker) loads the modules with importScripts;
// Firefox loads the same files via "background.scripts" in its manifest (see manifests/firefox).
if (typeof importScripts === 'function') {
  importScripts(
    'bg/models.js',
    'bg/config.js',
    'bg/keys.js',
    'bg/engine-state.js',
    'bg/providers/common.js',
    'bg/providers/gemini.js',
    'bg/providers/groq.js',
    'bg/providers/nvidia.js',
    'bg/providers/openrouter.js',
    'bg/parsing.js',
    'bg/prompts.js',
    'bg/fallback.js',
    'bg/kahoot.js',
    'bg/handlers.js'
  );
}
