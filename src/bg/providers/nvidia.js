// Quiz AI Analyzer - background module: providers/nvidia.js
// Author: fan_world_me
async function tryNvidiaTextModel(prompt, model, tier) {
  let lastError = '';
  const nvidiaKeys = await getProviderKeys('nvidia');
  if (!nvidiaKeys.length) {
    return { success: false, error: 'NVIDIA: no API key found' };
  }

  for (let keyIndex = 0; keyIndex < nvidiaKeys.length; keyIndex++) {
    if (!isEngineAvailable('nvidia', tier, model, keyIndex)) {
      lastError = `NVIDIA ${model} key #${keyIndex + 1}: blocked (cooldown)`;
      continue;
    }

    const apiKey = nvidiaKeys[keyIndex];
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 18000);
    try {
      const res = await fetch(NVIDIA_URL, {
        method: 'POST',
        signal: controller.signal,
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
          max_tokens: 420,
          ...nvidiaReasoningParams(model),
        }),
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        const msg = await readErrorMessage(res);
        if (res.status === 429 || /quota|rate|limit/i.test(msg)) {
          blockEngine('nvidia', tier, model, keyIndex);
          lastError = `NVIDIA ${model} key #${keyIndex + 1}: limit`;
          continue;
        }
        if (res.status === 401 || res.status === 403 || res.status === 404 || res.status === 410) {
          blockEngine('nvidia', tier, model, keyIndex);
          lastError = `NVIDIA ${model} key #${keyIndex + 1}: ${msg}`;
          continue;
        }
        lastError = `NVIDIA ${model} key #${keyIndex + 1}: ${msg}`;
        continue;
      }

      const payload = await res.json();
      const text = payload.choices?.[0]?.message?.content || '';
      if (!text) {
        lastError = `NVIDIA ${model} key #${keyIndex + 1}: empty response`;
        continue;
      }

      clearEngineBlock('nvidia', tier, model, keyIndex);
      return {
        success: true,
        text,
        meta: rememberSuccessfulCall('nvidia', model, keyIndex, tier, res.headers, nvidiaKeys.length),
      };
    } catch (err) {
      clearTimeout(timeoutId);
      lastError = `NVIDIA ${model} key #${keyIndex + 1}: ${err.name === 'AbortError' ? 'timeout' : err.message}`;
    }
  }

  return { success: false, error: lastError || `NVIDIA ${model}: unavailable` };
}

async function tryNvidiaVisionModel(prompt, base64, model, tier) {
  let lastError = '';
  const nvidiaKeys = await getProviderKeys('nvidia');
  if (!nvidiaKeys.length) {
    return { success: false, error: 'NVIDIA: no API key found' };
  }

  for (let keyIndex = 0; keyIndex < nvidiaKeys.length; keyIndex++) {
    if (!isEngineAvailable('nvidia', tier, model, keyIndex)) {
      lastError = `NVIDIA ${model} key #${keyIndex + 1}: blocked (cooldown)`;
      continue;
    }

    const apiKey = nvidiaKeys[keyIndex];
    try {
      const res = await fetch(NVIDIA_URL, {
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
          ...nvidiaReasoningParams(model),
        }),
      });

      if (!res.ok) {
        const msg = await readErrorMessage(res);
        if (res.status === 429 || /quota|rate|limit/i.test(msg)) {
          blockEngine('nvidia', tier, model, keyIndex);
          lastError = `NVIDIA ${model} key #${keyIndex + 1}: limit`;
          continue;
        }
        if (res.status === 401 || res.status === 403 || res.status === 404 || res.status === 410) {
          blockEngine('nvidia', tier, model, keyIndex);
          lastError = `NVIDIA ${model} key #${keyIndex + 1}: ${msg}`;
          continue;
        }
        lastError = `NVIDIA ${model} key #${keyIndex + 1}: ${msg}`;
        continue;
      }

      const payload = await res.json();
      const text = payload.choices?.[0]?.message?.content || '';
      if (!text) {
        lastError = `NVIDIA ${model} key #${keyIndex + 1}: empty response`;
        continue;
      }

      clearEngineBlock('nvidia', tier, model, keyIndex);
      return {
        success: true,
        text,
        meta: rememberSuccessfulCall('nvidia', model, keyIndex, tier, res.headers, nvidiaKeys.length),
      };
    } catch (err) {
      lastError = `NVIDIA ${model} key #${keyIndex + 1}: ${err.message}`;
    }
  }

  return { success: false, error: lastError || `NVIDIA ${model}: unavailable` };
}
