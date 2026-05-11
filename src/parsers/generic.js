// Generic parser - fallback for unknown sites
import { BaseParser } from './base.js';

export class GenericParser extends BaseParser {
  constructor() {
    super();
    this.name = 'generic';
  }

  canHandle(hostname) {
    return true; // Always can handle as fallback
  }

  findQuestionContainer() {
    const containers = [];

    // Look for common question patterns
    const selectors = [
      '[class*="question"]',
      '[class*="quiz"]',
      '[class*="test"]',
      'form[class*="quiz"]',
      'form[class*="test"]'
    ];

    for (const selector of selectors) {
      const found = Array.from(document.querySelectorAll(selector))
        .filter(el => this.isVisible(el) && this.looksLikeQuestion(el));
      if (found.length > 0) {
        containers.push(...found);
      }
    }

    // If nothing found, try to find by structure
    if (containers.length === 0) {
      const forms = document.querySelectorAll('form');
      forms.forEach(form => {
        if (this.isVisible(form) && this.looksLikeQuestion(form)) {
          containers.push(form);
        }
      });
    }

    return containers;
  }

  looksLikeQuestion(el) {
    // Check if element looks like a question
    const text = el.textContent.trim();
    if (text.length < 10 || text.length > 5000) return false;

    // Must have some inputs
    const inputs = el.querySelectorAll('input[type="radio"], input[type="checkbox"], button, label');
    if (inputs.length < 2) return false;

    // Should not be navigation or header
    if (el.matches('nav, header, footer, aside')) return false;

    return true;
  }

  extractQuestionText(container) {
    // Try common question selectors
    const selectors = [
      'legend',
      'h1', 'h2', 'h3', 'h4',
      'p:first-of-type',
      'div:first-of-type',
      'label:first-of-type'
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

    // Fallback: get first text node
    const walker = document.createTreeWalker(
      container,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );

    let text = '';
    let node;
    while (node = walker.nextNode()) {
      if (node.parentElement && this.isVisible(node.parentElement)) {
        text += node.textContent + ' ';
        if (text.length > 100) break;
      }
    }

    return this.normalizeText(text);
  }

  extractOptions(container) {
    const options = [];

    // Try labels first
    const labels = container.querySelectorAll('label');
    if (labels.length >= 2) {
      labels.forEach(label => {
        if (this.isVisible(label)) {
          const text = this.extractVisibleText(label);
          if (text && text.length > 0 && text.length < 500) {
            options.push(text);
          }
        }
      });
      if (options.length >= 2) return options;
    }

    // Try buttons
    const buttons = container.querySelectorAll('button, [role="button"]');
    buttons.forEach(btn => {
      if (this.isVisible(btn)) {
        const text = this.extractVisibleText(btn);
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
