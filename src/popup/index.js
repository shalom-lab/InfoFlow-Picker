import browser from 'webextension-polyfill';
import { getSettings, saveSettings, DEFAULT_CATEGORIES } from '../utils/storage.js';
import { t } from '../i18n/index.js';

const selectionEl = document.getElementById('selection');
const sourceUrlEl = document.getElementById('source-url');
const notesEl = document.getElementById('notes');
const categoryEl = document.getElementById('category');
const saveBtn = document.getElementById('save-btn');
const statusEl = document.getElementById('status');
const optionsBtn = document.getElementById('options-btn');

// 视图元素
const saveView = document.getElementById('save-view');
const settingsView = document.getElementById('settings-view');

// 设置表单元素
const settingsLanguageEl = document.getElementById('settings-language');
const settingsGithubTokenEl = document.getElementById('settings-github-token');
const settingsGithubOwnerEl = document.getElementById('settings-github-owner');
const settingsGithubRepoEl = document.getElementById('settings-github-repo');
const settingsGithubBranchEl = document.getElementById('settings-github-branch');
const settingsGithubBasePathEl = document.getElementById('settings-github-base-path');
const settingsFormatEl = document.getElementById('settings-format');
const settingsCategoriesEl = document.getElementById('settings-categories');
const saveSettingsBtn = document.getElementById('save-settings-btn');
const settingsStatusEl = document.getElementById('settings-status');
const tokenHintEl = document.getElementById('token-hint');

let currentLanguage = 'zh';
let saving = false;
let isSettingsView = false;
let statusState = { key: 'statusIdle', tone: 'muted' };
let settingsStatusState = { key: '', tone: 'info' };

init();

async function init() {
  const settings = await getSettings();
  currentLanguage = settings.language;
  applyTranslations();
  populateCategories(settings.categories);
  await Promise.all([loadSelectionFromPage(), loadSourceUrl()]);
  loadSettingsForm(settings);
  
  optionsBtn.addEventListener('click', toggleView);
  saveBtn.addEventListener('click', handleSave);
  saveSettingsBtn.addEventListener('click', handleSaveSettings);
  settingsLanguageEl.addEventListener('change', async () => {
    currentLanguage = settingsLanguageEl.value;
    await saveSettings({ language: currentLanguage });
    applyTranslations();
    populateCategories((await getSettings()).categories);
  });
  
  setStatus('statusIdle', 'muted');
}

function toggleView() {
  isSettingsView = !isSettingsView;
  if (isSettingsView) {
    saveView.classList.remove('active');
    settingsView.classList.add('active');
    optionsBtn.textContent = '←';
    optionsBtn.title = 'Back';
  } else {
    settingsView.classList.remove('active');
    saveView.classList.add('active');
    optionsBtn.textContent = '⚙';
    optionsBtn.title = 'Settings';
  }
}

function applyTranslations() {
  document.getElementById('title').textContent = t(currentLanguage, 'appTitle');
  document.getElementById('selection-label').textContent = t(
    currentLanguage,
    'selectedTextLabel',
  );
  document.getElementById('source-url-label').textContent = t(
    currentLanguage,
    'sourceUrlLabel',
  );
  sourceUrlEl.placeholder = t(currentLanguage, 'urlPlaceholder');
  document.getElementById('notes-label').textContent = t(
    currentLanguage,
    'notesLabel',
  );
  document.getElementById('category-label').textContent = t(
    currentLanguage,
    'categoryLabel',
  );
  saveBtn.textContent = t(currentLanguage, 'saveButton');
  
  // 设置视图翻译
  document.getElementById('settings-language-label').textContent = t(
    currentLanguage,
    'languageLabel',
  );
  document.getElementById('settings-github-token-label').textContent = t(
    currentLanguage,
    'githubTokenLabel',
  );
  document.getElementById('settings-github-owner-label').textContent = t(
    currentLanguage,
    'githubOwnerLabel',
  );
  document.getElementById('settings-github-repo-label').textContent = t(
    currentLanguage,
    'githubRepoLabel',
  );
  document.getElementById('settings-github-branch-label').textContent = t(
    currentLanguage,
    'githubBranchLabel',
  );
  document.getElementById('settings-github-base-path-label').textContent = t(
    currentLanguage,
    'githubBasePathLabel',
  );
  document.getElementById('settings-format-label').textContent = t(
    currentLanguage,
    'formatLabel',
  );
  document.getElementById('settings-categories-label').textContent = t(
    currentLanguage,
    'categoriesLabel',
  );
  saveSettingsBtn.textContent = t(currentLanguage, 'settingsSaveButton');
  if (tokenHintEl) {
    tokenHintEl.textContent = t(currentLanguage, 'tokenSafetyHint');
  }
  // refresh current status messages with new language
  if (statusState.key) {
    applyStatus(statusEl, statusState.key, statusState.tone);
  }
  if (settingsStatusState.key) {
    applyStatus(settingsStatusEl, settingsStatusState.key, settingsStatusState.tone);
  }
}

function populateCategories(categories) {
  categoryEl.innerHTML = '';
  categories.forEach((category) => {
    const option = document.createElement('option');
    option.value = category;
    option.textContent = category;
    categoryEl.appendChild(option);
  });
}

async function loadSelectionFromPage() {
  const pending = await browser.storage.local.get([
    'pendingSelection',
    'pendingUrl',
  ]);
  if (pending.pendingSelection) {
    selectionEl.value = pending.pendingSelection;
    if (pending.pendingUrl) {
      sourceUrlEl.value = pending.pendingUrl;
    }
    await browser.storage.local.remove(['pendingSelection', 'pendingUrl']);
    return;
  }

  const [tab] = await browser.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (!tab?.id || !tab.url) return;

  // 对浏览器内部页面（如 chrome://、edge://、about: 等）不尝试自动读取选区，避免报错
  if (
    tab.url.startsWith('chrome://') ||
    tab.url.startsWith('edge://') ||
    tab.url.startsWith('about:') ||
    tab.url.startsWith('moz-extension://') ||
    tab.url.startsWith('chrome-extension://')
  ) {
    return;
  }
  try {
    const response = await browser.tabs.sendMessage(tab.id, {
      type: 'GET_SELECTION',
    });
    selectionEl.value = response?.text ?? '';
  } catch (error) {
    // 某些页面不注入 content script 时忽略错误，保留手动输入
    selectionEl.value = '';
  }
}

async function loadSourceUrl() {
  const [tab] = await browser.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (tab?.url) {
    sourceUrlEl.value = tab.url;
  }
}

async function handleSave() {
  if (saving) return;
  const text = selectionEl.value.trim();
  const category = categoryEl.value;
  const sourceUrl = sourceUrlEl.value.trim();
  const notes = notesEl.value.trim();
  if (!text) {
    setStatus('emptySelection', 'error');
    return;
  }

  saving = true;
  saveBtn.disabled = true;
  setStatus('statusSaving', 'progress');
  try {
    await browser.runtime.sendMessage({
      type: 'SAVE_SELECTION',
      payload: { text, category, url: sourceUrl, notes },
    });
    setStatus('statusSuccess', 'success');
  } catch (error) {
    console.error(error);
    setStatus(
      error?.message?.includes('GitHub') ? 'missingGithub' : 'statusError',
      'error',
    );
  } finally {
    saving = false;
    saveBtn.disabled = false;
  }
}

function setStatus(key, tone = 'info') {
  statusState = { key, tone };
  applyStatus(statusEl, key, tone);
}

function loadSettingsForm(settings) {
  settingsLanguageEl.value = settings.language;
  settingsGithubTokenEl.value = settings.github.token;
  settingsGithubOwnerEl.value = settings.github.owner;
  settingsGithubRepoEl.value = settings.github.repo;
  settingsGithubBranchEl.value = settings.github.branch;
  settingsGithubBasePathEl.value = settings.github.basePath;
  settingsFormatEl.value = settings.outputFormat || 'md';
  settingsCategoriesEl.value = (settings.categories?.length
    ? settings.categories
    : DEFAULT_CATEGORIES
  ).join('\n');
}

async function handleSaveSettings() {
  setSettingsStatus('statusSaving', 'progress');
  const categories = settingsCategoriesEl.value
    .split('\n')
    .map((c) => c.trim())
    .filter(Boolean);

  try {
    await saveSettings({
      language: settingsLanguageEl.value,
      outputFormat: settingsFormatEl.value,
      categories: categories.length ? categories : DEFAULT_CATEGORIES,
      github: {
        token: settingsGithubTokenEl.value.trim(),
        owner: settingsGithubOwnerEl.value.trim(),
        repo: settingsGithubRepoEl.value.trim(),
        branch: settingsGithubBranchEl.value.trim() || 'master',
        basePath: settingsGithubBasePathEl.value.trim() || 'infoflow-data',
      },
    });
    setSettingsStatus('settingsSaved', 'success');
    
    // 更新当前语言和分类
    currentLanguage = settingsLanguageEl.value;
    applyTranslations();
    const updatedSettings = await getSettings();
    populateCategories(updatedSettings.categories);
  } catch (error) {
    console.error(error);
    setSettingsStatus('settingsError', 'error');
  }
}

function setSettingsStatus(key, tone = 'info') {
  settingsStatusState = { key, tone };
  applyStatus(settingsStatusEl, key, tone);
}

function applyStatus(element, key, tone) {
  if (!element) return;
  if (!key) {
    element.textContent = '';
    element.classList.remove('visible');
    element.removeAttribute('data-tone');
    return;
  }
  element.textContent = t(currentLanguage, key);
  element.dataset.tone = tone;
  element.classList.add('visible');
}

