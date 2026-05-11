// Moodle parser - handles Moodle LMS quiz pages
import { BaseParser } from './base.js';

export class MoodleParser extends BaseParser {
  constructor() {
    super();
    this.name = 'moodle';
  }

  canHandle(hostname) {
    return hostname.includes('moodle') || document.querySelector('.que, .formulation');
  }

  findQuestionContainer() {
    // Moodle uses .que class for question blocks
    return Array.from(document.querySelectorAll('.que')).filter(el => this.isVisible(el));
  }

  extractQuestionText(container) {
    // Try multiple selectors in priority order
    const selectors = [
      '.qtext',
      '.formulation .qtext',
      'legend',
      '.content > p:first-child'
    ];

    for (const selector of selectors) {
      const el = container.querySelector(selector);
      if (el && this.isVisible(el)) {
        return this.extractVisibleText(el);
      }
    }

    return '';
  }

  extractOptions(container) {
    const options = [];

    // Radio/checkbox questions
    const answers = container.querySelectorAll('.answer label, .answer .r0, .answer .r1');
    if (answers.length > 0) {
      answers.forEach(label => {
        if (this.isVisible(label)) {
          const text = this.extractVisibleText(label);
          if (text && text.length > 0 && text.length < 500) {
            options.push(text);
          }
        }
      });
      return options;
    }

    // True/False questions
    const tfOptions = container.querySelectorAll('.answer input[type="radio"] + label');
    if (tfOptions.length > 0) {
      tfOptions.forEach(label => {
        if (this.isVisible(label)) {
          options.push(this.extractVisibleText(label));
        }
      });
      return options;
    }

    return options;
  }

  detectQuestionType(container) {
    // Check for multiple answer (checkbox)
    if (container.querySelector('input[type="checkbox"]')) {
      return 'checkbox';
    }

    // Check for matching
    if (container.querySelector('.match, select[name*="sub"]')) {
      return 'matching';
    }

    // Check for ordering/drag-drop
    if (container.querySelector('.draggable, .droppable')) {
      return 'ordering';
    }

    // Default to radio (single choice)
    return 'radio';
  }
}
