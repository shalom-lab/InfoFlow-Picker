import browser from 'webextension-polyfill';

browser.runtime.onMessage.addListener(async (message) => {
  if (message?.type === 'GET_SELECTION') {
    return { text: getSelectedText() };
  }
  return undefined;
});

function getSelectedText() {
  const selection = window.getSelection();
  return selection ? selection.toString().trim() : '';
}

