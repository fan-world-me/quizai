// Quiz AI Analyzer - Popup Script
// Author: fan_world_me
document.addEventListener('DOMContentLoaded', () => {
  const DEFAULT_PROVIDERS = ['gemini', 'openrouter', 'nvidia', 'groq'];
  const enabledToggle = document.getElementById('enabledToggle');
  const analyzeBtn = document.getElementById('analyzeBtn');
  const clearBtn = document.getElementById('clearBtn');
  const howtoBtn = document.getElementById('howtoBtn');
  const testConnectionBtn = document.getElementById('testConnectionBtn');
  const resetProvidersBtn = document.getElementById('resetProvidersBtn');
  const providerToggles = Array.from(document.querySelectorAll('[data-provider-toggle]'));
  const statusBar = document.getElementById('statusBar');
  const statusText = document.getElementById('statusText');
  const statusSublabel = document.getElementById('statusSublabel');
  const versionChip = document.getElementById('versionChip');
  const engineChip = document.getElementById('engineChip');
  const usageValue = document.getElementById('usageValue');
  const usageReset = document.getElementById('usageReset');
  const engineDetailValue = document.getElementById('engineDetailValue');
  const fallbackValue = document.getElementById('fallbackValue');
  const keyCountValue = document.getElementById('keyCountValue');
  const attemptTraceValue = document.getElementById('attemptTraceValue');
  const hasScripting = !!chrome.scripting;
  const isAndroid = /Android/i.test(navigator.userAgent);

  function normalizeProviders(value) {
    const list = Array.isArray(value) ? value : DEFAULT_PROVIDERS;
    const filtered = list.filter((provider) => DEFAULT_PROVIDERS.includes(provider));
    return filtered.length ? [...new Set(filtered)] : [...DEFAULT_PROVIDERS];
  }

  function getSelectedProviders() {
    return providerToggles.filter((input) => input.checked).map((input) => input.value);
  }

  function setProviderToggles(providers) {
    const enabled = normalizeProviders(providers);
    providerToggles.forEach((input) => {
      input.checked = enabled.includes(input.value);
    });
  }

  function saveProviders(providers) {
    const normalized = normalizeProviders(providers);
    setProviderToggles(normalized);
    chrome.storage.sync.set({ enabledProviders: normalized }, () => {
      showStatus('Провайдери оновлено', 'ok');
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs && tabs[0];
        if (tab && tab.id) chrome.tabs.sendMessage(tab.id, { type: 'SETTINGS_CHANGED', enabled: enabledToggle.checked }, () => {});
      });
      loadSettings();
    });
  }

  function applySettings(settings) {
    const enabled = !!(settings && settings.enabled);
    enabledToggle.checked = enabled;
    statusSublabel.textContent = enabled ? 'Увімкнено, перевірка раз на 10 сек' : 'Вимкнено';
    versionChip.textContent = `v${settings?.version || 'dev'}`;
    const statusLabel = settings?.statusLabel || 'Engine: auto';
    engineChip.textContent = statusLabel;
    if (engineDetailValue) engineDetailValue.textContent = statusLabel;
    usageValue.textContent = settings?.usage?.remainingText || 'Немає даних';
    usageReset.textContent = settings?.usage?.resetText || 'очікує запит';
    if (fallbackValue) fallbackValue.textContent = settings?.fallbackLabel || 'Gemini -> OpenRouter -> NVIDIA -> Groq';
    setProviderToggles(settings?.enabledProviders || DEFAULT_PROVIDERS);
    if (keyCountValue) {
      const nvidiaCount = settings?.keyCounts?.nvidia ?? '-';
      const openrouterCount = settings?.keyCounts?.openrouter ?? '-';
      const geminiCount = settings?.keyCounts?.gemini ?? '-';
      const groqCount = settings?.keyCounts?.groq ?? '-';
      keyCountValue.textContent = `NVIDIA: ${nvidiaCount} | OpenRouter: ${openrouterCount} | Gemini: ${geminiCount} | Groq: ${groqCount}`;
    }
    if (attemptTraceValue) {
      const attempts = Array.isArray(settings?.lastAttemptTrace) ? settings.lastAttemptTrace : [];
      attemptTraceValue.textContent = attempts.length ? attempts.slice(-3).join(' | ') : 'Немає даних';
    }
  }

  function loadSettings() {
    chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (settings) => {
      if (chrome.runtime.lastError) {
        console.warn('GET_SETTINGS error:', chrome.runtime.lastError.message);
        return;
      }
      applySettings(settings || {});
    });
  }

  loadSettings();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    if (changes.enabled || changes.enabledProviders) loadSettings();
  });

  providerToggles.forEach((input) => {
    input.addEventListener('change', () => saveProviders(getSelectedProviders()));
  });

  resetProvidersBtn.addEventListener('click', () => saveProviders(DEFAULT_PROVIDERS));

  enabledToggle.addEventListener('change', () => {
    const enabled = enabledToggle.checked;
    statusSublabel.textContent = enabled ? 'Увімкнено, перевірка раз на 10 сек' : 'Вимкнено';
    chrome.storage.sync.set({ enabled }, () => sendToPage({ type: 'SETTINGS_CHANGED', enabled }));
  });

  analyzeBtn.addEventListener('click', () => {
    analyzeBtn.textContent = 'Аналізую...';
    analyzeBtn.disabled = true;
    sendToPage({ type: 'TRIGGER_ANALYZE' }, () => {
      setTimeout(() => {
        analyzeBtn.textContent = 'Аналізувати сторінку';
        analyzeBtn.disabled = false;
        loadSettings();
      }, 1200);
    });
  });

  clearBtn.addEventListener('click', () => {
    sendToPage({ type: 'CLEAR_HIGHLIGHTS' });
    showStatus('Виділення знято', 'ok');
  });

  howtoBtn.addEventListener('click', () => {
    const howtoUrl = chrome.runtime.getURL('howto.html');
    if (isAndroid) {
      chrome.tabs.create({ url: howtoUrl }, () => {
        if (chrome.runtime.lastError) {
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs && tabs[0]) chrome.tabs.update(tabs[0].id, { url: howtoUrl });
          });
        }
      });
      return;
    }
    chrome.tabs.create({ url: howtoUrl });
  });

  function sendToPage(message, cb) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab) {
        if (cb) cb();
        return;
      }

      const url = tab.url || '';
      const restricted = /^(chrome|edge|about|moz-extension|chrome-extension):\/\//i.test(url);
      if (restricted) {
        showStatus('Відкрий сторінку з тестом', 'err');
        if (cb) cb();
        return;
      }

      chrome.tabs.sendMessage(tab.id, message, () => {
        if (!chrome.runtime.lastError) {
          if (cb) cb();
          return;
        }

        if (!hasScripting) {
          showStatus('Онови сторінку і спробуй ще раз', 'err');
          if (cb) cb();
          return;
        }

        chrome.scripting.executeScript(
          { target: { tabId: tab.id, allFrames: true }, files: ['content.js'] },
          () => {
            if (chrome.runtime.lastError) {
              showStatus(chrome.runtime.lastError.message || 'Помилка', 'err');
              if (cb) cb();
              return;
            }
            setTimeout(() => {
              chrome.tabs.sendMessage(tab.id, message);
              if (cb) cb();
            }, 700);
          }
        );
      });
    });
  }

  function showStatus(message, type) {
    statusBar.className = `status show ${type === 'ok' ? 'ok' : 'err'}`;
    statusText.textContent = message;
    setTimeout(() => {
      statusBar.className = 'status';
    }, 4000);
  }

  testConnectionBtn.addEventListener('click', () => {
    testConnectionBtn.textContent = 'Перевіряю...';
    testConnectionBtn.disabled = true;
    const startTime = Date.now();

    chrome.runtime.sendMessage({ type: 'TEST_CONNECTION' }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn('TEST_CONNECTION error:', chrome.runtime.lastError.message);
        testConnectionBtn.disabled = false;
        testConnectionBtn.textContent = "Перевірити з'єднання";
        showStatus("Помилка з'єднання", 'err');
        return;
      }

      const elapsed = Date.now() - startTime;
      testConnectionBtn.disabled = false;
      testConnectionBtn.textContent = "Перевірити з'єднання";

      if (response && !response.error) {
        showStatus(`З'єднано: ${response.provider || 'OK'} (${elapsed}ms)`, 'ok');
      } else {
        showStatus(`Помилка: ${response?.error || "Немає з'єднання"}`, 'err');
      }
      loadSettings();
    });
  });
});
