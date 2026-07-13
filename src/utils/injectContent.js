import browser from 'webextension-polyfill';

const CONTENT_FILE = 'content.js';

/** Inject content.js on demand (activeTab + scripting) instead of <all_urls> in manifest. */
export async function ensureContentScript(tabId) {
  try {
    const pong = await browser.tabs.sendMessage(tabId, { type: 'PING' });
    if (pong?.ok) return;
  } catch {
    // Not injected yet — inject on user gesture.
  }

  await browser.scripting.executeScript({
    target: { tabId },
    files: [CONTENT_FILE],
  });
}

export async function sendToContentScript(tabId, message) {
  await ensureContentScript(tabId);
  return browser.tabs.sendMessage(tabId, message);
}
