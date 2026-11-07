// Quiz AI Analyzer - background module: parsing.js
// Author: fan_world_me
function normalizeForMatch(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanModelText(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```/g, ''))
    .replace(/^\s*(?:final answer|answer)\s*[-–]\s*/i, 'ANSWER: ')
    .trim();
}

function cleanImageAnalysisText(text) {
  let cleaned = cleanModelText(text)
    .replace(/\b(?:we need to|i need to|let's|first,? i|the task asks|we should)\b[\s\S]*?(?=(?:Відповідь|Ответ|Answer|Аналіз|Analysis)\s*:)/i, '')
    .replace(/^\s*(?:Here is|Sure,? here is|I can see)\s*:?\s*/i, '')
    .trim();

  const answerLike = cleaned.match(/((?:Відповідь|Ответ|Answer|Аналіз|Analysis)\s*:[\s\S]+)/i);
  if (answerLike) cleaned = answerLike[1].trim();

  return cleaned
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 4)
    .join('\n')
    .slice(0, 900);
}

function extractAnswerParts(text) {
  const cleaned = cleanModelText(text);
  const answerMatch = cleaned.match(/(?:^|\n)\s*ANSWER\s*:\s*([^\n\r]+)/i);
  const explanationMatch = cleaned.match(/(?:^|\n)\s*EXPLANATION\s*:\s*([\s\S]+)$/i);

  if (answerMatch) {
    return {
      answerText: answerMatch[1].trim(),
      explanation: explanationMatch ? explanationMatch[1].trim() : '',
      cleaned,
      hasAnswerLine: true,
    };
  }

  const cueMatch = cleaned.match(/(?:correct answer is|answer is|the answer is|choose|select)\s*:?\s*([^\n.]+)/i);
  return {
    answerText: cueMatch ? cueMatch[1].trim() : '',
    explanation: '',
    cleaned,
    hasAnswerLine: false,
  };
}

function findOptionIndicesFromText(answerText, options, allowLoose) {
  const indices = [];
  const source = String(answerText || '');
  const upper = source.toUpperCase();

  for (const letter of upper.match(/\b[A-Z]\b/g) || []) {
    const idx = letter.charCodeAt(0) - 65;
    if (idx >= 0 && idx < options.length && !indices.includes(idx)) indices.push(idx);
  }

  if (!indices.length) {
    for (const num of source.match(/\b\d+\b/g) || []) {
      const idx = parseInt(num, 10) - 1;
      if (idx >= 0 && idx < options.length && !indices.includes(idx)) indices.push(idx);
    }
  }

  if (!indices.length) {
    const normalizedAnswer = normalizeForMatch(source);
    for (let i = 0; i < options.length; i++) {
      const normalizedOption = normalizeForMatch(options[i]);
      if (!normalizedOption || normalizedOption.length < 3) continue;
      if (normalizedAnswer.includes(normalizedOption) || normalizedOption.includes(normalizedAnswer)) {
        indices.push(i);
        break;
      }
    }
  }

  if (!indices.length && allowLoose) {
    const normalizedSource = normalizeForMatch(source);
    let bestIdx = -1;
    let bestScore = 0;
    for (let i = 0; i < options.length; i++) {
      const words = normalizeForMatch(options[i]).split(' ').filter((word) => word.length > 2);
      if (!words.length) continue;
      const hits = words.filter((word) => normalizedSource.includes(word)).length;
      const score = hits / words.length;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0 && bestScore >= 0.65) indices.push(bestIdx);
  }

  return indices;
}

function hasParsedAnswer(parsed, questionType) {
  if (!parsed) return false;
  if (questionType === 'matching') return Array.isArray(parsed.matchPairs) && parsed.matchPairs.length > 0;
  if (questionType === 'ordering') return Array.isArray(parsed.orderIndices) && parsed.orderIndices.length > 1;
  if (questionType === 'open_ended' || questionType === 'short_answer') return !!(parsed.answer || parsed.textAnswer);
  return Array.isArray(parsed.correctIndices) && parsed.correctIndices.length > 0;
}

function parseAIResponse(text, options, questionType, rightOptions) {
  options = Array.isArray(options) ? options : [];
  rightOptions = Array.isArray(rightOptions) ? rightOptions : [];
  const parts = extractAnswerParts(text);
  text = parts.cleaned;
  const explanation = parts.explanation || parts.answerText || 'AI did not return a clear ANSWER line.';

  if (questionType === 'matching') {
    const pairs = [];
    const lines = text.split('\n');
    let inSection = false;
    for (const line of lines) {
      if (/ВІДПОВІДНІСТЬ|СООТВЕТСТВИЕ|MATCHES|MATCHING/i.test(line)) { inSection = true; continue; }
      if (/ПОЯСНЕННЯ|ПОЯСНЕНИЕ|EXPLANATION/i.test(line)) break;
      if (!inSection && !/->/.test(line)) continue;
      const m = line.match(/(\S[\w\s.,'-]*?)\s*(?:->|→)\s*(\S[\w\s.,'-]*)/);
      if (!m) continue;
      const leftRaw = m[1].trim();
      const rightRaw = m[2].trim();
      const leftNum = parseInt(leftRaw, 10) - 1;
      const rightLet = /^[A-Z]$/i.test(rightRaw) ? rightRaw.toUpperCase().charCodeAt(0) - 65 : -1;
      const rightNum = parseInt(rightRaw, 10) - 1;
      const left = !Number.isNaN(leftNum) && leftNum >= 0 && leftNum < options.length ? options[leftNum] : leftRaw;
      const right = rightLet >= 0 && rightOptions && rightLet < rightOptions.length
        ? rightOptions[rightLet]
        : (!Number.isNaN(rightNum) && rightOptions && rightNum >= 0 && rightNum < rightOptions.length ? rightOptions[rightNum] : rightRaw);
      if (left && right) pairs.push({ left, right });
    }
    return { matchPairs: pairs, explanation, rawResponse: text };
  }

  if (questionType === 'ordering') {
    const m = text.match(/(?:ПОРЯДОК|ORDER|SEQUENCE)\s*:\s*([A-Z](?:\s*[,;>\- ]\s*[A-Z])*)/i);
    if (m) {
      const letters = m[1].trim().toUpperCase().split(/[,\s]+/).filter((l) => /^[A-Z]$/.test(l));
      const orderIndices = letters.map((l) => l.charCodeAt(0) - 65).filter((i) => i >= 0 && i < options.length);
      if (orderIndices.length >= 2) return { orderIndices, explanation, rawResponse: text };
    }
    const allLetters = (text.match(/\b([A-Z])\b/g) || [])
      .map((l) => l.charCodeAt(0) - 65)
      .filter((i, pos, arr) => i >= 0 && i < options.length && arr.indexOf(i) === pos);
    return { orderIndices: allLetters, explanation, rawResponse: text };
  }

  if (questionType === 'open_ended' || questionType === 'short_answer') {
    const answer = (parts.answerText || text || '').trim().replace(/^['"]|['"]$/g, '').slice(0, 120);
    return { answer, textAnswer: answer, explanation, rawResponse: text };
  }

  let correctIndices = [];
  if (parts.answerText) {
    correctIndices = findOptionIndicesFromText(parts.answerText, options, true);
  }

  // Fallback: search for letter patterns like "B)" or "B." or "B:" or "B,"
  if (correctIndices.length === 0 && parts.hasAnswerLine) {
    for (let i = 0; i < options.length; i++) {
      const letter = String.fromCharCode(65 + i);
      // Look for patterns: "B)", "B.", "B:", "B," - but NOT standalone letter (to avoid matching words)
      if (new RegExp(`\\b${letter}[.):,]`, 'i').test(text)) {
        correctIndices.push(i);
        if (questionType === 'radio') break;
      }
    }
  }

  // Final fallback: if the model ignored the format, try text after common answer cues only.
  if (correctIndices.length === 0) {
    const cueText = (text.match(/(?:correct answer is|answer is|the answer is|оберіть|виберіть|правильна відповідь)\s*:?\s*([\s\S]{1,300})/i) || [])[1] || '';
    correctIndices = findOptionIndicesFromText(cueText, options, true);
  }

  return { correctIndices, explanation, rawResponse: text };
}
