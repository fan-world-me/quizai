// Osvita.ua parser - handles vseosvita.ua and zno.osvita.ua
import { BaseParser } from './base.js';

export class OsvitaParser extends BaseParser {
  constructor() {
    super();
    this.name = 'osvita';
  }

  canHandle(hostname) {
    return hostname.includes('osvita.ua') || hostname.includes('vseosvita') || hostname.includes('zno');
  }

  findQuestionContainer() {
    // Osvita uses various containers
    const selectors = [
      '.question-block',
      '.test-question',
      '.quiz-question',
      '[class*="question"]'
    ];

    for (const selector of selectors) {
      const containers = Array.from(document.querySelectorAll(selector)).filter(el => this.isVisible(el));
      if (containers.length > 0) return containers;
    }

    return [];
  }

  extractQuestionText(container) {
    // Try multiple selectors
    const selectors = [
      '.question-text',
      '.question-title',
      'h3',
      'h4',
      '.text',
      'p:first-of-type'
    ];

    for (const selector of selectors) {
      const el = container.querySelector(selector);
      if (el && this.isVisible(el)) {
        const text = this.extractVisibleText(el);
        if (text.length > 10 && text.length < 1500) {
          return text;
        }
      }
    }

    // Fallback: get first visible paragraph
    const paragraphs = container.querySelectorAll('p');
    for (const p of paragraphs) {
      if (this.isVisible(p)) {
        const text = this.extractVisibleText(p);
        if (text.length > 10 && text.length < 1500) {
          return text;
        }
      }
    }

    return '';
  }

  extractOptions(container) {
    const options = [];

    // Try label-based extraction
    const labels = container.querySelectorAll('label');
    if (labels.length > 0) {
      labels.forEach(label => {
        if (this.isVisible(label)) {
          const text = this.extractVisibleText(label);
          if (text && text.length > 0 && text.length < 500) {
            options.push(text);
          }
        }
      });
      if (options.length > 0) return options;
    }

    // Try button-based extraction
    const buttons = container.querySelectorAll('button[class*="answer"], .answer-option, [class*="option"]');
    if (buttons.length > 0) {
      buttons.forEach(btn => {
        if (this.isVisible(btn)) {
          const text = this.extractVisibleText(btn);
          if (text && text.length > 0 && text.length < 500) {
            options.push(text);
          }
        }
      });
      if (options.length > 0) return options;
    }

    // Try div-based extraction
    const divs = container.querySelectorAll('div[class*="answer"], div[class*="option"]');
    divs.forEach(div => {
      if (this.isVisible(div)) {
        const text = this.extractVisibleText(div);
        if (text && text.length > 0 && text.length < 500) {
          options.push(text);
        }
      }
    });

    return options;
  }

  detectQuestionType(container) {
    if (container.querySelector('input[type="checkbox"]')) {
      return 'checkbox';
    }
    return 'radio';
  }
}
