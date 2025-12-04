import browser from 'webextension-polyfill';
import { getSettings } from '../utils/storage.js';

const CONTEXT_MENU_ID = 'infoflow-extract';

browser.runtime.onInstalled.addListener(() => {
  setupContextMenu();
});

async function setupContextMenu() {
  try {
    await browser.contextMenus.removeAll();
  } catch {
    // ignore
  }

  browser.contextMenus.create({
    id: CONTEXT_MENU_ID,
    title: 'InfoFlow Picker',
    contexts: ['selection'],
  });
}

browser.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID) return;
  const selection = info.selectionText?.trim();
  if (!selection || !tab?.id) return;
  await browser.storage.local.set({
    pendingSelection: selection,
    pendingUrl: tab.url ?? '',
  });
  await browser.action.openPopup?.().catch(() => {});
});

browser.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === 'SAVE_SELECTION') {
    return handleSaveSelection(message.payload);
  }
  return undefined;
});

async function handleSaveSelection(payload) {
  const text = payload?.text?.trim();
  const category = payload?.category?.trim();
  const sourceUrl = payload?.url?.trim();
  const notes = payload?.notes?.trim();
  if (!text || !category) {
    throw new Error('Invalid payload');
  }

  const settings = await getSettings();
  if (!settings.github.token || !settings.github.owner || !settings.github.repo) {
    throw new Error('Missing GitHub settings');
  }

  const format = settings.outputFormat || 'md';
  const filePath = buildFilePath(settings, category, format);
  const content = buildContent(format, {
    category,
    text,
    sourceUrl,
    notes,
  });

  await uploadToGitHub({
    filePath,
    content,
    settings,
  });

  return { ok: true };
}

function buildFilePath(settings, category, format) {
  const safeCategory = category.replace(/[\\/:*?"<>|]/g, '_');
  const time = new Date().toISOString().replace(/[:.]/g, '-');
  const base = settings.github.basePath || 'infoflow-data';
  const extension = getExtensionForFormat(format);
  return `${base}/${safeCategory}/${time}.${extension}`;
}

function getExtensionForFormat(format) {
  if (format === 'json') return 'json';
  if (format === 'csv') return 'csv';
  return 'md';
}

async function uploadToGitHub({ filePath, content, settings }) {
  const { owner, repo, token, branch } = settings.github;
  const endpoint = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;
  const body = {
    message: `InfoFlow: ${filePath}`,
    content: base64Encode(content),
    branch,
  };

  const response = await fetch(endpoint, {
    method: 'PUT',
    headers: {
      Authorization: `token ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'InfoFlow-Picker',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GitHub upload failed: ${errorText}`);
  }
}

function buildContent(format, { category, text, sourceUrl, notes }) {
  const savedAt = new Date().toISOString();
  if (format === 'json') {
    const payload = {
      category,
      url: sourceUrl || '',
      notes: notes || '',
      content: text,
      savedAt,
    };
    return JSON.stringify(payload, null, 2);
  }
  if (format === 'csv') {
    const header = ['category', 'url', 'notes', 'content', 'savedAt'];
    const row = [category, sourceUrl || '', notes || '', text, savedAt].map(
      (value) => {
        const v = value.replace(/"/g, '""');
        return `"${v}"`;
      },
    );
    return `${header.join(',')}\n${row.join(',')}`;
  }

  // default: markdown – human readable with structured metadata
  const metaLines = [
    `- **Category:** ${category}`,
    `- **Source URL:** ${sourceUrl || '-'}`,
    `- **Notes:** ${notes ? '见下方 Notes' : '-'}`,
    `- **Saved At:** ${savedAt}`,
  ];
  const lines = [
    `# ${category}`,
    '',
    ...metaLines,
    '',
    '---',
    '',
    '## Content',
    '',
    text,
  ];
  if (notes) {
    lines.push('', '## Notes', '', notes);
  }
  return lines.join('\n');
}

function base64Encode(text) {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

