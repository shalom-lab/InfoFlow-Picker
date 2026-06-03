import { getSettings, saveSettings, DEFAULT_CATEGORIES } from '../utils/storage.js';
import { SUPPORTED_LANGUAGES, t } from '../i18n/index.js';

const refs = {
  title: document.getElementById('options-title'),
  languageLabel: document.getElementById('language-label'),
  language: document.getElementById('language'),
  githubTokenLabel: document.getElementById('github-token-label'),
  githubToken: document.getElementById('github-token'),
  githubOwnerLabel: document.getElementById('github-owner-label'),
  githubOwner: document.getElementById('github-owner'),
  githubRepoLabel: document.getElementById('github-repo-label'),
  githubRepo: document.getElementById('github-repo'),
  githubBranchLabel: document.getElementById('github-branch-label'),
  githubBranch: document.getElementById('github-branch'),
  githubBasePathLabel: document.getElementById('github-base-path-label'),
  githubBasePath: document.getElementById('github-base-path'),
  formatLabel: document.getElementById('format-label'),
  format: document.getElementById('format'),
  categoriesLabel: document.getElementById('categories-label'),
  categories: document.getElementById('categories'),
  saveButton: document.getElementById('save-settings'),
  status: document.getElementById('options-status'),
};

let currentLanguage = 'zh';

init();

async function init() {
  await loadSettings();
  applyTranslations();
  refs.saveButton.addEventListener('click', handleSave);
  refs.language.addEventListener('change', () => {
    currentLanguage = refs.language.value;
    applyTranslations();
  });
}

async function loadSettings() {
  const settings = await getSettings();
  currentLanguage = settings.language;
  refs.language.value = currentLanguage;
  refs.githubToken.value = settings.github.token;
  refs.githubOwner.value = settings.github.owner;
  refs.githubRepo.value = settings.github.repo;
  refs.githubBranch.value = settings.github.branch;
  refs.githubBasePath.value = settings.github.basePath;
  refs.format.value = settings.outputFormat || 'md';
  refs.categories.value = (settings.categories?.length
    ? settings.categories
    : DEFAULT_CATEGORIES
  ).join('\n');
}

function applyTranslations() {
  if (!SUPPORTED_LANGUAGES.includes(currentLanguage)) {
    currentLanguage = 'zh';
  }
  refs.title.textContent = t(currentLanguage, 'optionsTitle');
  refs.languageLabel.textContent = t(currentLanguage, 'languageLabel');
  refs.githubTokenLabel.textContent = t(currentLanguage, 'githubTokenLabel');
  refs.githubOwnerLabel.textContent = t(currentLanguage, 'githubOwnerLabel');
  refs.githubRepoLabel.textContent = t(currentLanguage, 'githubRepoLabel');
  refs.githubBranchLabel.textContent = t(currentLanguage, 'githubBranchLabel');
  refs.githubBasePathLabel.textContent = t(
    currentLanguage,
    'githubBasePathLabel',
  );
  refs.formatLabel.textContent = t(currentLanguage, 'formatLabel');
  refs.categoriesLabel.textContent = t(currentLanguage, 'categoriesLabel');
  refs.saveButton.textContent = t(currentLanguage, 'settingsSaveButton');
}

async function handleSave() {
  const categories = refs.categories.value
    .split('\n')
    .map((c) => c.trim())
    .filter(Boolean);

  try {
    await saveSettings({
      language: refs.language.value,
      outputFormat: refs.format.value,
      categories: categories.length ? categories : DEFAULT_CATEGORIES,
      github: {
        token: refs.githubToken.value.trim(),
        owner: refs.githubOwner.value.trim(),
        repo: refs.githubRepo.value.trim(),
        branch: refs.githubBranch.value.trim() || 'master',
        basePath: refs.githubBasePath.value.trim() || 'infoflow-data',
      },
    });
    setStatus('settingsSaved');
  } catch {
    setStatus('settingsError');
  }
}

function setStatus(key) {
  refs.status.textContent = t(currentLanguage, key);
}

