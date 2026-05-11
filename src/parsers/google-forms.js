// Google Forms parser
import { BaseParser } from './base.js';

export class GoogleFormsParser extends BaseParser {
  constructor() {
    super();
    this.name = 'google-forms';
  }

  canHandle(hostname) {
    return hostname.includes('docs.google.com') && window.location.pathname.includes('/forms/');
  }

  findQuestionContainer() {
    // Google Forms uses specific classes
    return Array.from(document.querySelectorAll('[role="listitem"], .freebirdFormviewerViewItemsItemItem'))
      .filter(el => this.isVisible(el));
  }

  extractQuestionText(container) {
    // Google Forms question text
    const selectors = [
      '[role="heading"]',
      '.freebirdFormviewerViewItemsItemItemTitle',
      '.freebirdFormviewerComponentsQuestionBaseTitle'
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

    // Radio/checkbox options
    const labels = container.querySelectorAll('label[for], .freebirdFormviewerComponentsQuestionRadioLabel');
    labels.forEach(label => {
      if (this.isVisible(label)) {
        const text = this.extractVisibleText(label);
        if (text && text.length > 0 && text.length < 500) {
          options.push(text);
        }
      }
    });

    return options;
  }

  detectQuestionType(container) {
    // Check for checkbox
    if (container.querySelector('input[type="checkbox"]')) {
      return 'checkbox';
    }

    // Check for dropdown
    if (container.querySelector('select')) {
      return 'radio';
    }

    return 'radio';
  }
}
