// Parser engine - selects and uses appropriate parser for current site
import { MoodleParser } from './moodle.js';
import { OsvitaParser } from './osvita.js';
import { GoogleFormsParser } from './google-forms.js';
import { GenericParser } from './generic.js';

export class ParserEngine {
  constructor() {
    this.parsers = [
      new MoodleParser(),
      new OsvitaParser(),
      new GoogleFormsParser(),
      new GenericParser() // Always last as fallback
    ];
  }

  // Get appropriate parser for current site
  getParser() {
    const hostname = window.location.hostname;

    for (const parser of this.parsers) {
      if (parser.canHandle(hostname)) {
        console.log(`[ParserEngine] Using ${parser.name} parser for ${hostname}`);
        return parser;
      }
    }

    // Should never reach here since GenericParser always matches
    return this.parsers[this.parsers.length - 1];
  }

  // Extract questions using appropriate parser
  extractQuestions() {
    const parser = this.getParser();
    const questions = parser.extract();

    console.log(`[ParserEngine] Extracted ${questions.length} questions using ${parser.name} parser`);

    return questions;
  }

  // Validate extracted question
  validateQuestion(question) {
    if (!question.questionText || question.questionText.length < 5) {
      return { valid: false, reason: 'Question text too short' };
    }

    if (question.questionText.length > 2000) {
      return { valid: false, reason: 'Question text too long' };
    }

    if (!question.options || question.options.length < 2) {
      return { valid: false, reason: 'Not enough options' };
    }

    if (question.options.length > 20) {
      return { valid: false, reason: 'Too many options' };
    }

    // Check for duplicate options
    const uniqueOptions = new Set(question.options);
    if (uniqueOptions.size !== question.options.length) {
      return { valid: false, reason: 'Duplicate options detected' };
    }

    return { valid: true };
  }

  // Extract and validate questions
  extractValidQuestions() {
    const questions = this.extractQuestions();
    const validated = [];

    for (const question of questions) {
      const validation = this.validateQuestion(question);
      if (validation.valid) {
        validated.push(question);
      } else {
        console.warn(`[ParserEngine] Invalid question: ${validation.reason}`, question);
      }
    }

    return validated;
  }
}
