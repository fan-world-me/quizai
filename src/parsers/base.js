// Base parser class for all site-specific parsers
export class BaseParser {
  constructor() {
    this.name = 'base';
  }

  // Check if this parser can handle the current site
  canHandle(hostname) {
    return false;
  }

  // Extract question container
  findQuestionContainer(root = document) {
    return null;
  }

  // Extract clean question text
  extractQuestionText(container) {
    if (!container) return '';
    return this.normalizeText(container.textContent);
  }

  // Extract answer options
  extractOptions(container) {
    return [];
  }

  // Detect question type
  detectQuestionType(container) {
    return 'radio'; // default
  }

  // Normalize text - remove extra whitespace, filter hidden content
  normalizeText(text) {
    if (!text) return '';
    return text
      .replace(/\s+/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .trim();
  }

  // Check if element is visible
  isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    if (el.hasAttribute('aria-hidden') && el.getAttribute('aria-hidden') === 'true') return false;
    if (el.offsetWidth === 0 && el.offsetHeight === 0) return false;
    return true;
  }

  // Extract visible text only
  extractVisibleText(el) {
    if (!el || !this.isVisible(el)) return '';

    // Clone to avoid modifying original
    const clone = el.cloneNode(true);

    // Remove hidden elements
    const hidden = clone.querySelectorAll('[aria-hidden="true"], [style*="display: none"], [style*="visibility: hidden"]');
    hidden.forEach(h => h.remove());

    // Remove SVG and icons
    clone.querySelectorAll('svg, i.icon, .icon').forEach(icon => icon.remove());

    return this.normalizeText(clone.textContent);
  }

  // Main extraction method
  extract() {
    const containers = this.findQuestionContainer();
    if (!containers || !containers.length) return [];

    const questions = [];
    for (const container of containers) {
      const questionText = this.extractQuestionText(container);
      const options = this.extractOptions(container);
      const type = this.detectQuestionType(container);

      if (questionText && options.length > 0) {
        questions.push({
          questionText,
          options,
          type,
          container
        });
      }
    }

    return questions;
  }
}
