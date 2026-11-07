// Quiz AI Analyzer - background module: prompts.js
// Author: fan_world_me
// Prompt builder for different question types
// Author: fan_world_me
function buildPrompt(question, options, questionType, rightOptions) {
  const safeOptions = Array.isArray(options) ? options : [];
  const letters = safeOptions.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join('\n');
  const numbers = safeOptions.map((o, i) => `${i + 1}. ${o}`).join('\n');

  if (questionType === 'ordering') {
    return `Task type: ordering

Question:
${question}

Elements:
${letters}

Choose the correct chronological/logical sequence. Return only letters from the list.
The first characters of your response must be "ORDER:".

Return EXACTLY this format (two lines only):
ORDER: A, C, B, D
EXPLANATION: <one short reason in the question language>`;
  }

  if (questionType === 'matching') {
    const rightList = (rightOptions || []).map((r, i) => `${String.fromCharCode(65 + i)}. ${r}`).join('\n');
    return `Task type: matching

Question:
${question}

Left elements:
${numbers}

Right elements:
${rightList}

Match every left item to one right item. Use only numbers and letters shown above.
The first characters of your response must be "MATCHING:".

Return EXACTLY this format:
MATCHING:
1 -> A
2 -> C
3 -> B
EXPLANATION: <one short reason in the question language>`;
  }

  if (questionType === 'open_ended' || questionType === 'short_answer') {
    return `Task type: short answer / fill in the blank

Question:
${question}

Give the most likely intended answer. Return only the answer text.
The first characters of your response must be "ANSWER:".

Return EXACTLY this format (two lines only):
ANSWER: <short answer>
EXPLANATION: <one short reason in the question language>`;
  }

  if (questionType === 'checkbox') {
    return `Task type: multiple choice with one or more correct answers

Question:
${question}

Options:
${letters}

Select every correct option. Use only letters from the option list.
The first characters of your response must be "ANSWER:".

Return EXACTLY this format (two lines only):
ANSWER: A, C
EXPLANATION: <one short reason in the question language>`;
  }

  return `Task type: single choice

Question:
${question}

Options:
${letters}

Select exactly one correct option. Use only one letter from the option list.
The first characters of your response must be "ANSWER:".

Return EXACTLY this format (two lines only):
ANSWER: <one letter>
EXPLANATION: <one short reason in the question language>`;
}
