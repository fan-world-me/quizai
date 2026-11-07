// Quiz AI Analyzer - background module: providers/groq.js
// Author: fan_world_me
async function tryGroqTextModel(prompt, model, tier) {
  let lastError = '';
  const groqKeys = await getProviderKeys('groq');
  if (!groqKeys.length) {
    return { success: false, error: 'Groq: no API key found' };
  }

  for (let keyIndex = 0; keyIndex < groqKeys.length; keyIndex++) {
    if (!isEngineAvailable('groq', tier, model, keyIndex)) {
      lastError = `Groq ${model} key #${keyIndex + 1}: blocked (cooldown)`;
      continue;
    }

    const apiKey = groqKeys[keyIndex];
    try {
      const res = await fetch(GROQ_URL, {
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
          ...groqReasoningParams(model),
        }),
      });

      if (!res.ok) {
        const msg = await readErrorMessage(res);
        if (res.status === 429 || /quota|rate|limit/i.test(msg)) {
          blockEngine('groq', tier, model, keyIndex);
          lastError = `Groq ${model} key #${keyIndex + 1}: limit`;
          continue;
        }
        if (res.status === 401 || res.status === 403) {
          blockEngine('groq', tier, model, keyIndex);
          lastError = `Groq ${model} key #${keyIndex + 1}: ${msg}`;
          continue;
        }
        lastError = `Groq ${model} key #${keyIndex + 1}: ${msg}`;
        continue;
      }

      const payload = await res.json();
      const text = payload.choices?.[0]?.message?.content || '';
      if (!text) {
        lastError = `Groq ${model} key #${keyIndex + 1}: empty response`;
        continue;
      }

      clearEngineBlock('groq', tier, model, keyIndex);
      return {
        success: true,
        text,
        meta: rememberSuccessfulCall('groq', model, keyIndex, tier, res.headers, groqKeys.length),
      };
    } catch (err) {
      lastError = `Groq ${model} key #${keyIndex + 1}: ${err.message}`;
    }
  }

  return { success: false, error: lastError || `Groq ${model}: unavailable` };
}

async function tryGroqVisionModel(prompt, base64, model, tier) {
  let lastError = '';
  const groqKeys = await getProviderKeys('groq');
  if (!groqKeys.length) {
    return { success: false, error: 'Groq: no API key found' };
  }

  for (let keyIndex = 0; keyIndex < groqKeys.length; keyIndex++) {
    if (!isEngineAvailable('groq', tier, model, keyIndex)) {
      lastError = `Groq ${model} key #${keyIndex + 1}: blocked (cooldown)`;
      continue;
    }

    const apiKey = groqKeys[keyIndex];
    try {
      const res = await fetch(GROQ_URL, {
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
          ...groqReasoningParams(model),
        }),
      });

      if (!res.ok) {
        const msg = await readErrorMessage(res);
        if (res.status === 429 || /quota|rate|limit/i.test(msg)) {
          blockEngine('groq', tier, model, keyIndex);
          lastError = `Groq ${model} key #${keyIndex + 1}: limit`;
          continue;
        }
        if (res.status === 401 || res.status === 403) {
          blockEngine('groq', tier, model, keyIndex);
          lastError = `Groq ${model} key #${keyIndex + 1}: ${msg}`;
          continue;
        }
        lastError = `Groq ${model} key #${keyIndex + 1}: ${msg}`;
        continue;
      }

      const payload = await res.json();
      const text = payload.choices?.[0]?.message?.content || '';
      if (!text) {
        lastError = `Groq ${model} key #${keyIndex + 1}: empty response`;
        continue;
      }

      clearEngineBlock('groq', tier, model, keyIndex);
      return {
        success: true,
        text,
        meta: rememberSuccessfulCall('groq', model, keyIndex, tier, res.headers, groqKeys.length),
      };
    } catch (err) {
      lastError = `Groq ${model} key #${keyIndex + 1}: ${err.message}`;
    }
  }

  return { success: false, error: lastError || `Groq ${model}: unavailable` };
}
