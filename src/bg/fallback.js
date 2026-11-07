// Quiz AI Analyzer - background module: fallback.js
// Author: fan_world_me
// Fallback system: Groq first for speed, then NVIDIA, Gemini, and OpenRouter.
// Created by fan_world_me
async function analyzeTextWithFallback(prompt, data) {
  const attempts = [];
  const enabledProviders = await getEnabledProviders();

  if (enabledProviders.includes('groq')) {
    // Priority 1: Groq fast text models.
    for (const model of GROQ_TEXT_MODELS) {
      const result = await tryGroqTextModel(prompt, model, 'text');
      if (result.success) {
        lastAttemptTrace = attempts.filter(Boolean);
        return result;
      }
      attempts.push(result.error);
    }
  }

  if (enabledProviders.includes('nvidia')) {
    // Priority 2: NVIDIA fast fallback endpoints.
    for (const model of NVIDIA_TEXT_MODELS) {
      const result = await tryNvidiaTextModel(prompt, model, 'text');
      if (result.success) {
        lastAttemptTrace = attempts.filter(Boolean);
        return result;
      }
      attempts.push(result.error);
    }
  }

  if (enabledProviders.includes('gemini')) {
    // Priority 3: Gemini for multilingual quality and screenshots.
    for (const model of GEMINI_TEXT_MODELS) {
      const result = await tryGeminiTextModel(prompt, model, GEMINI_TIER);
      if (result.success) {
        lastAttemptTrace = attempts.filter(Boolean);
        return result;
      }
      attempts.push(result.error);
    }
  }

  if (enabledProviders.includes('openrouter')) {
    // Priority 4: OpenRouter final text fallback.
    for (const model of OPENROUTER_TEXT_MODELS) {
      const result = await tryOpenRouterTextModel(prompt, model, 'text');
      if (result.success) {
        lastAttemptTrace = attempts.filter(Boolean);
        return result;
      }
      attempts.push(result.error);
    }
  }

  lastAttemptTrace = attempts.filter(Boolean);
  throw new Error(attempts.filter(Boolean).join('\n') || 'No available engine');
}

// Image analysis follows the same provider order: Groq, NVIDIA, Gemini, OpenRouter.
// Author: fan_world_me
async function analyzeImageWithFallback(base64, customPrompt = '') {
  const attempts = [];
  const enabledProviders = await getEnabledProviders();

  const prompt = customPrompt || `Analyze this screenshot/image.
If it contains a school quiz or test question, solve it and give the answer.
If it is not a quiz, briefly describe and analyze what is visible.
Do not show hidden reasoning. Do not restate these instructions.
Return 1-4 short lines in the same language as the image when possible.
Use this format when it is a quiz:
Відповідь: <answer>
Пояснення: <one short reason>
Use this format when it is not a quiz:
Аналіз: <brief description>`;

  // 1. Groq Vision.
  if (enabledProviders.includes('groq')) {
    for (const model of GROQ_VISION_MODELS) {
      const result = await tryGroqVisionModel(prompt, base64, model, 'vision');
      if (result.success) {
        lastAttemptTrace = attempts.filter(Boolean);
        return result;
      }
      attempts.push(result.error || `Groq/${model}:FAIL`);
    }
  }

  // 2. NVIDIA Vision.
  if (enabledProviders.includes('nvidia')) {
    for (const model of NVIDIA_VISION_MODELS) {
      const result = await tryNvidiaVisionModel(prompt, base64, model, 'vision');
      if (result.success) {
        lastAttemptTrace = attempts.filter(Boolean);
        return result;
      }
      attempts.push(result.error || `NVIDIA/${model}:FAIL`);
    }
  }

  // 3. Gemini Vision.
  if (enabledProviders.includes('gemini')) {
    for (const model of GEMINI_VISION_MODELS) {
      const result = await tryGeminiVisionModel(prompt, base64, model, GEMINI_TIER);
      if (result.success) {
        lastAttemptTrace = attempts.filter(Boolean);
        return result;
      }
      attempts.push(result.error || `Gemini/${model}:FAIL`);
    }
  }

  // 4. OpenRouter Vision final fallback.
  if (enabledProviders.includes('openrouter')) {
    for (const model of OPENROUTER_VISION_MODELS) {
      const result = await tryOpenRouterVisionModel(prompt, base64, model, 'vision');
      if (result.success) {
        lastAttemptTrace = attempts.filter(Boolean);
        return result;
      }
      attempts.push(result.error || `OpenRouter/${model}:FAIL`);
    }
  }

  lastAttemptTrace = attempts.filter(Boolean);
  throw new Error('No enabled vision provider could analyze the image. Enable Groq, NVIDIA, Gemini, or OpenRouter and add a valid key.');
}
