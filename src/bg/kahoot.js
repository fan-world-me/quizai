// Quiz AI Analyzer - background module: kahoot.js
// Author: fan_world_me
// --- Kahoot-adapted helpers (use existing Gemini/Groq fallback functions) ---

async function answerQuestionWithProviders(title, choices, imageBase64 = '', mediaContext = '') {
  if (!Array.isArray(choices) || choices.length === 0) throw new Error('No answer choices provided.');
  if (imageBase64) {
    return answerChoiceWithVisionProviders(title, choices, 'radio', imageBase64, mediaContext);
  }
  const numbered = choices.map((c, i) => `${i + 1}) ${c}`).join('\n');
  const imageInfo = mediaContext ? `\nImage context:\n${mediaContext}\n` : '';
  const prompt = `Single-choice quiz.
Question: ${title}
${imageInfo}

Options:
${numbered}

Your first characters must be "ANSWER:".
Return exactly:
ANSWER: <one number from 1 to ${choices.length}>
EXPLANATION: <short reason>`;

  const result = await analyzeTextWithFallback(prompt, {});
  const raw = (result?.text || '').trim();
  const match = raw.match(/\d+/);
  if (match) {
    const idx = parseInt(match[0], 10);
    if (Number.isFinite(idx) && idx >= 1 && idx <= choices.length) {
      return { correctIndices: [idx - 1], explanation: raw, meta: result.meta, rawResponse: raw };
    }
  }

  // Fallback: try matching exact text
  const cleaned = raw.replace(/^['\"]|['\"]$/g, '').trim();
  const lowered = cleaned.toLowerCase();
  let found = choices.findIndex(c => c.toLowerCase().trim() === lowered);
  if (found === -1) found = choices.findIndex(c => c.toLowerCase().includes(lowered));
  if (found === -1) found = choices.findIndex(c => lowered.includes(c.toLowerCase().trim()));
  if (found >= 0) return { correctIndices: [found], explanation: raw, meta: result.meta, rawResponse: raw };

  // Best fuzzy match
  let best = 0, bestIdx = 0;
  for (let i = 0; i < choices.length; i++) {
    const score = fuzzyScore(lowered, choices[i].toLowerCase());
    if (score > best) { best = score; bestIdx = i; }
  }
  return { correctIndices: [bestIdx], explanation: raw, meta: result.meta, rawResponse: raw };
}

async function answerMultiSelectWithProviders(title, choices, imageBase64 = '', mediaContext = '') {
  if (!Array.isArray(choices) || choices.length === 0) throw new Error('No answer choices provided.');
  if (imageBase64) {
    return answerChoiceWithVisionProviders(title, choices, 'checkbox', imageBase64, mediaContext);
  }
  const numbered = choices.map((c, i) => `${i + 1}) ${c}`).join('\n');
  const imageInfo = mediaContext ? `\nImage context:\n${mediaContext}\n` : '';
  const prompt = `Multi-select quiz.
Question: ${title}
${imageInfo}

Options:
${numbered}

Your first characters must be "ANSWER:".
Return exactly:
ANSWER: <correct numbers comma-separated>
EXPLANATION: <short reason>`;

  const result = await analyzeTextWithFallback(prompt, {});
  const raw = (result?.text || '').trim();
  const yesNums = [];
  for (const line of raw.split('\n')) {
    const m = line.match(/(\d+)\s*:\s*(YES|Y)/i);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n >= 1 && n <= choices.length) yesNums.push(n - 1);
    }
  }
  if (yesNums.length > 0) return { correctIndices: [...new Set(yesNums)], explanation: raw, meta: result.meta, rawResponse: raw };

  // Fallback: parse all numbers
  const nums = [...raw.matchAll(/\d+/g)].map(m => parseInt(m[0], 10) - 1).filter(n => n >= 0 && n < choices.length);
  if (nums.length > 0) return { correctIndices: [...new Set(nums)], explanation: raw, meta: result.meta, rawResponse: raw };

  // Final fallback: pick single best
  const single = await answerQuestionWithProviders(title, choices);
  return { correctIndices: single.correctIndices, explanation: single.explanation, meta: single.meta, rawResponse: single.rawResponse };
}

async function answerOpenEndedWithProviders(title, imageBase64 = '', mediaContext = '') {
  if (imageBase64) {
    const prompt = `Look at this Kahoot question screenshot and answer the short/open-ended question.
Question text: ${title}
${mediaContext ? `Image context:\n${mediaContext}\n` : ''}
Return exactly:
ANSWER: <short answer only>`;
    const result = await analyzeImageWithFallback(imageBase64, prompt);
    let answer = (result?.text || '').replace(/^ANSWER:\s*/i, '').trim().replace(/^['\"]|['\"]$/g, '');
    if (answer.length > 40) answer = answer.substring(0, 40);
    if (!answer) throw new Error('Empty answer from vision providers');
    return { answer, meta: result.meta, rawResponse: result.text };
  }
  const prompt = `Quiz question: "${title}"\n${mediaContext ? `Image context:\n${mediaContext}\n` : ''}\nThis is a fill-in-the-blank or short answer quiz question. Give the most likely intended answer. Respond with ONLY the answer — max 20 characters, no explanation.`;
  const result = await analyzeTextWithFallback(prompt, {});
  let answer = (result?.text || '').trim().replace(/^['\"]|['\"]$/g, '');
  if (answer.length > 20) answer = answer.substring(0, 20);
  if (!answer) throw new Error('Empty answer from providers');
  return { answer, meta: result.meta, rawResponse: result.text };
}

async function answerSliderWithProviders(title, sliderConfig) {
  const { min, max, step, unit } = sliderConfig || {};
  let rangeInfo = '';
  if (min != null && max != null) rangeInfo = `\nRange: ${min} to ${max} (step: ${step || 'unknown'})`;
  const prompt = `Question: ${title}\n\nThis is a slider question on a quiz. You need to pick the correct numeric value.${rangeInfo}\n\nReply with ONLY a single number. No words, no units, no punctuation — just the number.`;
  const result = await analyzeTextWithFallback(prompt, {});
  const raw = (result?.text || '').trim();
  const cleaned = raw.replace(/[\s,]/g, '');
  const match = cleaned.match(/[\d.]+/);
  if (!match) throw new Error(`Could not parse slider answer: "${raw}"`);
  const value = parseFloat(match[0]);
  if (isNaN(value)) throw new Error(`Could not parse slider answer: "${raw}"`);
  return { value, meta: result.meta, rawResponse: raw };
}

async function answerJumbleWithProviders(title, tiles, imageBase64 = '', mediaContext = '') {
  const numbered = tiles.map((t, i) => `${i + 1}) ${t}`).join('\n');
  const prompt = `Kahoot ordering/jumble question.
Question: ${title}
${mediaContext ? `Image context:\n${mediaContext}\n` : ''}
Tiles:
${numbered}

Return exactly:
ORDER: <tile numbers in the correct order, comma-separated>
ANSWER: <the final word or phrase>`;
  const result = imageBase64 ? await analyzeImageWithFallback(imageBase64, prompt) : await analyzeTextWithFallback(prompt, {});
  const raw = (result?.text || '').trim().replace(/^['\"]|['\"]$/g, '');
  const orderLine = raw.match(/ORDER\s*:\s*([0-9,\s>.-]+)/i);
  const answerLine = raw.match(/ANSWER\s*:\s*(.+)$/im);
  const answerWord = answerLine ? answerLine[1].trim() : raw.replace(/^ANSWER:\s*/i, '').trim();
  const nums = orderLine
    ? [...orderLine[1].matchAll(/\d+/g)].map(m => parseInt(m[0], 10) - 1).filter(n => n >= 0 && n < tiles.length)
    : [...raw.matchAll(/\d+/g)].map(m => parseInt(m[0], 10) - 1).filter(n => n >= 0 && n < tiles.length);
  const uniqueNums = nums.length ? [...new Set(nums)] : [];
  const inferred = inferJumbleOrderFromAnswer(tiles, answerWord);
  const orderIndices = inferred.length === tiles.length ? inferred : uniqueNums;
  return { orderIndices, answerWord, meta: result.meta, rawResponse: result.text };
}

function inferJumbleOrderFromAnswer(tiles, answerWord) {
  const answer = String(answerWord || '').replace(/\s+/g, '').toLowerCase();
  if (!answer) return [];
  const remaining = tiles.map((_, idx) => idx);
  const result = [];
  let cursor = 0;
  while (remaining.length) {
    let best = -1;
    let bestLen = -1;
    for (const idx of remaining) {
      const tile = String(tiles[idx] || '').replace(/\s+/g, '').toLowerCase();
      if (!tile) continue;
      if (answer.slice(cursor, cursor + tile.length) === tile && tile.length > bestLen) {
        best = idx;
        bestLen = tile.length;
      }
    }
    if (best < 0) return [];
    result.push(best);
    remaining.splice(remaining.indexOf(best), 1);
    cursor += bestLen;
  }
  return cursor === answer.length ? result : [];
}

async function answerChoiceWithVisionProviders(title, choices, qType, imageBase64, mediaContext = '') {
  const numbered = choices.map((c, i) => `${i + 1}) ${c}`).join('\n');
  const isMulti = qType === 'checkbox' || qType === 'multiple_select_quiz';
  const prompt = `Look at this Kahoot question screenshot. The picture may be in the question or inside one of the answers.
Question text: ${title}
${mediaContext ? `Image context:\n${mediaContext}\n` : ''}
Options:
${numbered}

Return exactly:
ANSWER: ${isMulti ? '<all correct option numbers, comma-separated>' : '<one correct option number>'}
EXPLANATION: <short reason>`;
  const result = await analyzeImageWithFallback(imageBase64, prompt);
  const raw = (result?.text || '').trim();
  const answerLine = raw.match(/ANSWER\s*:\s*([^\n]+)/i);
  const source = answerLine ? answerLine[1] : raw;
  const nums = [...source.matchAll(/\d+/g)]
    .map(m => parseInt(m[0], 10) - 1)
    .filter(n => n >= 0 && n < choices.length);
  if (nums.length) {
    return { correctIndices: [...new Set(isMulti ? nums : [nums[0]])], explanation: raw, meta: result.meta, rawResponse: raw };
  }
  const lowered = raw.toLowerCase();
  let found = choices.findIndex(c => lowered.includes(c.toLowerCase().trim()));
  if (found < 0) found = 0;
  return { correctIndices: [found], explanation: raw, meta: result.meta, rawResponse: raw };
}

function fuzzyScore(a, b) {
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.85;
  const wordsA = a.split(/\s+/).filter(Boolean);
  const wordsB = b.split(/\s+/).filter(Boolean);
  if (wordsA.length === 0 || wordsB.length === 0) return 0;
  const overlap = wordsA.filter(w => wordsB.some(wb => wb.includes(w) || w.includes(wb))).length;
  return overlap / Math.max(wordsA.length, wordsB.length);
}
