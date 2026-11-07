// Quiz AI Analyzer - content module: detect/google-forms.js
// Google Forms detector
'use strict';

/* ══════════════════════════════════════════════
 * Google Forms
 * ══════════════════════════════════════════════ */
function detectGoogleForms() {
  const qs = [];
  document.querySelectorAll('.Qr7Oae').forEach(item => {
    if (isOwnPanel(item)) return;
    const headingEl = item.querySelector('.M7eMe,[role="heading"]');
    const qText = headingEl ? headingEl.textContent.trim() : '';
    if (!qText || qText.length < 2) return;

    const radioGroup = item.querySelector('[role="radiogroup"]');
    if (radioGroup) {
      const optionEls = Array.from(radioGroup.querySelectorAll('.aDTYNe,.snByac'));
      const options = optionEls.map(el => el.textContent.trim()).filter(Boolean);
      if (options.length >= 2) {
        const lblEls = Array.from(radioGroup.querySelectorAll('.docssharedWizToggleLabeledContainer,label'));
        qs.push({ questionText: qText, options, optionEls: lblEls.length >= options.length ? lblEls : optionEls, containerEl: radioGroup, type: 'radio' });
        return;
      }
    }
    const listGroup = item.querySelector('[role="list"]');
    if (listGroup) {
      const optionEls = Array.from(listGroup.querySelectorAll('.aDTYNe,.snByac'));
      const options = optionEls.map(el => el.textContent.trim()).filter(Boolean);
      if (options.length >= 2) {
        const lblEls = Array.from(listGroup.querySelectorAll('.docssharedWizToggleLabeledContainer,label'));
        qs.push({ questionText: qText, options, optionEls: lblEls.length >= options.length ? lblEls : optionEls, containerEl: listGroup, type: 'checkbox' });
      }
    }
  });
  return qs;
}
