import browser from 'webextension-polyfill';
import { DEFAULT_LANGUAGE } from '../i18n/index.js';

export const DEFAULT_CATEGORIES = ['Insight', 'Prompt'];
const DEFAULT_GITHUB = {
  token: '',
  owner: '',
  repo: '',
  branch: 'master',
  basePath: 'infoflow-data',
};

const STORAGE_KEY_SYNC = 'infoflowSettingsSync';
const STORAGE_KEY_LOCAL = 'infoflowSettingsLocal';

export async function getSettings() {
  const [{ [STORAGE_KEY_SYNC]: syncSettings }, { [STORAGE_KEY_LOCAL]: localSettings }] =
    await Promise.all([
      browser.storage.sync.get(STORAGE_KEY_SYNC),
      browser.storage.local.get(STORAGE_KEY_LOCAL),
    ]);
  const settings = syncSettings ?? {};
  const local = localSettings ?? {};
  return {
    language: settings.language ?? DEFAULT_LANGUAGE,
    categories: Array.isArray(settings.categories)
      ? settings.categories.filter(Boolean)
      : DEFAULT_CATEGORIES,
    github: {
      ...DEFAULT_GITHUB,
      ...(settings.github ?? {}),
      ...(local.github ?? {}),
    },
    outputFormats: settings.outputFormats || 'json+md',
  };
}

export async function saveSettings(partial) {
  const current = await getSettings();
  const next = {
    ...current,
    ...partial,
    github: {
      ...current.github,
      ...(partial.github ?? {}),
    },
  };
  const syncPart = {
    language: next.language,
    categories: next.categories,
    outputFormats: next.outputFormats || 'json+md',
    github: {
      owner: next.github.owner,
      repo: next.github.repo,
      branch: next.github.branch,
      basePath: next.github.basePath,
    },
  };
  const localPart = {
    github: {
      token: next.github.token,
    },
  };

  await Promise.all([
    browser.storage.sync.set({ [STORAGE_KEY_SYNC]: syncPart }),
    browser.storage.local.set({ [STORAGE_KEY_LOCAL]: localPart }),
  ]);
  return next;
}

export async function observeSettings(callback) {
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes[STORAGE_KEY_SYNC]) {
      const newValue = changes[STORAGE_KEY_SYNC].newValue;
      callback(
        newValue ?? {
          language: DEFAULT_LANGUAGE,
          categories: DEFAULT_CATEGORIES,
          github: DEFAULT_GITHUB,
        },
      );
    }
    if (area === 'local' && changes[STORAGE_KEY_LOCAL]) {
      // 仅 token 变更时也触发一次回调，方便未来扩展
      callback(null);
    }
  });
}

