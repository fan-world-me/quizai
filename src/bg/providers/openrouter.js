// Quiz AI Analyzer - background module: providers/openrouter.js
// Author: fan_world_me
async function tryOpenRouterTextModel(prompt, model, tier) {
  let lastError = '';
  const openrouterKeys = await getProviderKeys('openrouter');

  for (let keyIndex = 0; keyIndex < openrouterKeys.length; keyIndex++) {
    if (!isEngineAvailable('openrouter', tier, model, keyIndex)) continue;

    const apiKey = openrouterKeys[keyIndex];
    try {
      const res = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: QUIZ_SYSTEM_PROMPT },
            { role: 'user', content: prompt }
          ],
          temperature: 0,
          max_tokens: 400,
          ...openRouterReasoningParams(model),
        }),
      });

      if (!res.ok) {
        const msg = await readErrorMessage(res);
        if (res.status === 429 || /quota|rate|limit/i.test(msg)) {
          blockEngine('openrouter', tier, model, keyIndex);
          lastError = `OpenRouter ${model} key #${keyIndex + 1}: limit`;
          continue;
        }
        if (res.status === 401 || res.status === 403) {
          blockEngine('openrouter', tier, model, keyIndex);
          lastError = `OpenRouter ${model} key #${keyIndex + 1}: ${msg}`;
          continue;
        }
        lastError = `OpenRouter ${model} key #${keyIndex + 1}: ${msg}`;
        continue;
      }

      const payload = await res.json();
      const text = payload.choices?.[0]?.message?.content || '';
      if (!text) {
        lastError = `OpenRouter ${model} key #${keyIndex + 1}: empty response`;
        continue;
      }

      clearEngineBlock('openrouter', tier, model, keyIndex);
      return {
        success: true,
        text,
        meta: rememberSuccessfulCall('openrouter', model, keyIndex, tier, res.headers, openrouterKeys.length),
      };
    } catch (err) {
      lastError = `OpenRouter ${model} key #${keyIndex + 1}: ${err.message}`;
    }
  }

  return { success: false, error: lastError || `OpenRouter ${model}: unavailable` };
}

async function tryOpenRouterVisionModel(prompt, base64, model, tier) {
  let lastError = '';
  const openrouterKeys = await getProviderKeys('openrouter');

  for (let keyIndex = 0; keyIndex < openrouterKeys.length; keyIndex++) {
    if (!isEngineAvailable('openrouter', tier, model, keyIndex)) continue;

    const apiKey = openrouterKeys[keyIndex];
    try {
      const res = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } },
            ],
          }],
          temperature: 0,
          max_tokens: 500,
          ...openRouterReasoningParams(model),
        }),
      });

      if (!res.ok) {
        const msg = await readErrorMessage(res);
        if (res.status === 429 || /quota|rate|limit/i.test(msg)) {
          blockEngine('openrouter', tier, model, keyIndex);
          lastError = `OpenRouter ${model} key #${keyIndex + 1}: limit`;
          continue;
        }
        if (res.status === 401 || res.status === 403) {
          blockEngine('openrouter', tier, model, keyIndex);
          lastError = `OpenRouter ${model} key #${keyIndex + 1}: ${msg}`;
          continue;
        }
        lastError = `OpenRouter ${model} key #${keyIndex + 1}: ${msg}`;
        continue;
      }

      const payload = await res.json();
      const text = payload.choices?.[0]?.message?.content || '';
      if (!text) {
        lastError = `OpenRouter ${model} key #${keyIndex + 1}: empty response`;
        continue;
      }

      clearEngineBlock('openrouter', tier, model, keyIndex);
      return {
        success: true,
        text,
        meta: rememberSuccessfulCall('openrouter', model, keyIndex, tier, res.headers, openrouterKeys.length),
      };
    } catch (err) {
      lastError = `OpenRouter ${model} key #${keyIndex + 1}: ${err.message}`;
    }
  }

  return { success: false, error: lastError || `OpenRouter ${model}: unavailable` };
}
