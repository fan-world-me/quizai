// Quiz AI Analyzer - background module: providers/gemini.js
// Author: fan_world_me
async function tryGeminiTextModel(prompt, model, tier) {
  let lastError = '';
  const geminiKeys = await getProviderKeys('gemini');
  if (!geminiKeys.length) {
    return { success: false, error: 'Gemini: no API key found' };
  }

  for (let keyIndex = 0; keyIndex < geminiKeys.length; keyIndex++) {
    if (!isEngineAvailable('gemini', tier, model, keyIndex)) {
      lastError = `Gemini ${tier} ${model} key #${keyIndex + 1}: blocked (cooldown)`;
      console.log(`[Gemini] Key #${keyIndex + 1} blocked until ${new Date(getEngineState('gemini', tier, model, keyIndex).blockedUntil).toISOString()}`);
      continue;
    }

    const apiKey = geminiKeys[keyIndex];
    try {
      const res = await fetch(`${GEMINI_BASE}/${model}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: QUIZ_SYSTEM_PROMPT }]
          },
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0, maxOutputTokens: /lite/i.test(model) ? 220 : 1024, thinkingConfig: geminiThinkingConfig(model) },
          safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
          ],
        }),
      });

      if (!res.ok) {
        const msg = await readErrorMessage(res);
        if (res.status === 429 || res.status === 404 || /quota|rate|limit|not found/i.test(msg)) {
          console.log(`[Gemini] ${tier} ${model} key #${keyIndex + 1}: skipping (${res.status})`);
        } else {
          console.error(`[Gemini] ${tier} ${model} key #${keyIndex + 1}: HTTP ${res.status} - ${msg}`);
        }
        if (res.status === 429 || /quota|rate|limit/i.test(msg)) {
          blockEngine('gemini', tier, model, keyIndex);
          lastError = `Gemini ${tier} ${model} key #${keyIndex + 1}: limit (${msg})`;
          continue;
        }
        if (res.status === 400 || res.status === 401 || res.status === 403) {
          blockEngine('gemini', tier, model, keyIndex);
          lastError = `Gemini ${tier} ${model} key #${keyIndex + 1}: ${res.status} ${msg}`;
          continue;
        }
        lastError = `Gemini ${tier} ${model} key #${keyIndex + 1}: ${res.status} ${msg}`;
        continue;
      }

      const payload = await res.json();
      const text = payload.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (!text) {
        lastError = `Gemini ${tier} ${model} key #${keyIndex + 1}: empty response`;
        console.warn(`[Gemini] Empty response from key #${keyIndex + 1}:`, payload);
        continue;
      }

      clearEngineBlock('gemini', tier, model, keyIndex);
      console.log(`[Gemini] Success: ${tier} ${model} key #${keyIndex + 1}`);
      return {
        success: true,
        text,
        meta: rememberSuccessfulCall('gemini', model, keyIndex, tier, res.headers, geminiKeys.length),
      };
    } catch (err) {
      lastError = `Gemini ${tier} ${model} key #${keyIndex + 1}: ${err.message}`;
      console.error(`[Gemini] Exception on key #${keyIndex + 1}:`, err);
    }
  }

  console.log(`[Gemini] All attempts failed for ${tier} ${model}:`, lastError);
  return { success: false, error: lastError || `Gemini ${tier} ${model}: unavailable` };
}

async function tryGeminiVisionModel(prompt, base64, model, tier) {
  let lastError = '';
  const geminiKeys = await getProviderKeys('gemini');
  if (!geminiKeys.length) {
    return { success: false, error: 'Gemini: no API key found' };
  }

  for (let keyIndex = 0; keyIndex < geminiKeys.length; keyIndex++) {
    if (!isEngineAvailable('gemini', tier, model, keyIndex)) {
      lastError = `Gemini ${tier} ${model} key #${keyIndex + 1}: blocked (cooldown)`;
      continue;
    }

    const apiKey = geminiKeys[keyIndex];
    try {
      const res = await fetch(`${GEMINI_BASE}/${model}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: prompt.includes('Analyze this screenshot/image') ? 'You analyze images directly. Give concise final observations only. Do not reveal hidden reasoning.' : OCR_SYSTEM_PROMPT }]
          },
          contents: [{ parts: [
            { text: prompt },
            { inlineData: { mimeType: 'image/jpeg', data: base64 } },
          ] }],
          generationConfig: { temperature: 0, maxOutputTokens: /lite/i.test(model) ? 800 : 1500, thinkingConfig: geminiThinkingConfig(model) },
        }),
      });

      if (!res.ok) {
        const msg = await readErrorMessage(res);
        if (res.status === 429 || res.status === 404 || /quota|rate|limit|not found/i.test(msg)) {
          console.log(`[Gemini] ${tier} ${model} key #${keyIndex + 1}: skipping (${res.status})`);
        } else {
          console.error(`[Gemini] ${tier} ${model} key #${keyIndex + 1}: HTTP ${res.status} - ${msg}`);
        }
        if (res.status === 429 || /quota|rate|limit/i.test(msg)) {
          blockEngine('gemini', tier, model, keyIndex);
          lastError = `Gemini ${tier} ${model} key #${keyIndex + 1}: limit`;
          continue;
        }
        if (res.status === 400 || res.status === 401 || res.status === 403) {
          blockEngine('gemini', tier, model, keyIndex);
          lastError = `Gemini ${tier} ${model} key #${keyIndex + 1}: ${msg}`;
          continue;
        }
        lastError = `Gemini ${tier} ${model} key #${keyIndex + 1}: ${msg}`;
        continue;
      }

      const payload = await res.json();
      const text = payload.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (!text) {
        lastError = `Gemini ${tier} ${model} key #${keyIndex + 1}: empty response`;
        continue;
      }

      clearEngineBlock('gemini', tier, model, keyIndex);
      return {
        success: true,
        text,
        meta: rememberSuccessfulCall('gemini', model, keyIndex, tier, res.headers, geminiKeys.length),
      };
    } catch (err) {
      lastError = `Gemini ${tier} ${model} key #${keyIndex + 1}: ${err.message}`;
    }
  }

  return { success: false, error: lastError || `Gemini ${tier} ${model}: unavailable` };
}
