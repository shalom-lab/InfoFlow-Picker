import browser from 'webextension-polyfill';
import { getSettings, saveSettings, DEFAULT_CATEGORIES } from '../utils/storage.js';
import {
  clearSaveDraft,
  getPendingCapture,
  getSaveDraft,
  mergePendingIntoDraft,
  setSaveDraft,
  clearPendingCapture,
  normalizeDraftImageList,
  applyMergedImagesToDraft,
} from '../utils/draft.js';
import {
  createDraftImageId,
  hydrateDraftImageSlots,
  syncPickedImagesToIdb,
} from '../utils/draftImages.js';
import { t } from '../i18n/index.js';
import { sendToContentScript } from '../utils/injectContent.js';

const contentEl = document.getElementById('content');
const sourceUrlEl = document.getElementById('source-url');
const categoryEl = document.getElementById('category');
const notesEl = document.getElementById('notes');
const saveBtn = document.getElementById('save-btn');
const statusEl = document.getElementById('status');
const optionsBtn = document.getElementById('options-btn');
const imageInput = document.getElementById('image-input');
const imageSelectBtn = document.getElementById('image-select-btn');
const imagePasteBtn = document.getElementById('image-paste-btn');
const imagePreviewContainer = document.getElementById('image-preview-container');
const imagePreview = document.getElementById('image-preview');
const imageRemoveBtn = document.getElementById('image-remove-btn');
const imageGroupPanel = document.getElementById('image-group-panel');
const imageGroupHint = document.getElementById('image-group-hint');
const imageGroupGrid = document.getElementById('image-group-grid');
const imageGroupSelectAllBtn = document.getElementById('image-group-select-all');
const imageGroupSelectCurrentBtn = document.getElementById('image-group-select-current');
const imageLightbox = document.getElementById('image-lightbox');
const imageLightboxImg = document.getElementById('image-lightbox-img');
const imageLightboxClose = document.getElementById('image-lightbox-close');
const imageLightboxPrev = document.getElementById('image-lightbox-prev');
const imageLightboxNext = document.getElementById('image-lightbox-next');
const imageLightboxCounter = document.getElementById('image-lightbox-counter');
const retrySyncBtn = document.getElementById('retry-sync-btn');
const syncQueuePanel = document.getElementById('sync-queue-panel');
const syncQueueToggle = document.getElementById('sync-queue-toggle');
const syncQueueList = document.getElementById('sync-queue-list');

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
let currentImageFile = null; // 存储图片文件对象或URL
let currentImageUrl = null; // 存储图片URL（用于预览）
/** @type {{ images: Array<{url: string, base64?: string, type?: string, arrayBuffer?: number[]}>, clickedIndex: number, selected: Set<number> } | null} */
let imageGroupState = null;
let persistDraftTimer = null;
let syncQueueExpanded = false;
let lastSyncSummary = null;
/** @type {string[]} */
let lightboxSources = [];
let lightboxIndex = 0;
/** @type {string[]} */
let syncQueueObjectUrls = [];
/** @type {Map<string, string[]>} */
let syncQueuePreviewMap = new Map();
/** Serialize select/paste append so concurrent pastes cannot drop earlier images. */
let imageAppendChain = Promise.resolve();

init();

async function init() {
  const settings = await getSettings();
  currentLanguage = settings.language;
  applyTranslations();
  populateCategories(settings.categories);
  
  clearImageState();
  
  await Promise.all([loadSavedFormState(), loadSourceUrl()]);
  loadSettingsForm(settings);
  await refreshSyncStatus();
  
  optionsBtn.addEventListener('click', toggleView);
  saveBtn.addEventListener('click', handleSave);
  saveSettingsBtn.addEventListener('click', handleSaveSettings);
  retrySyncBtn?.addEventListener('click', handleRetrySync);
  syncQueueToggle?.addEventListener('click', handleSyncQueueToggle);
  syncQueueList?.addEventListener('click', handleSyncQueueListClick);
  imageSelectBtn.addEventListener('click', () => imageInput.click());
  imagePasteBtn?.addEventListener('click', handlePasteImageClick);
  imageInput.addEventListener('change', handleImageSelect);
  imageRemoveBtn.addEventListener('click', handleImageRemove);
  imagePreview?.addEventListener('click', () => {
    if (currentImageUrl) openLightbox([currentImageUrl], 0);
  });
  imageGroupSelectAllBtn.addEventListener('click', handleImageGroupSelectAll);
  imageGroupSelectCurrentBtn.addEventListener('click', handleImageGroupSelectCurrentOnly);
  imageLightboxClose?.addEventListener('click', closeLightbox);
  imageLightboxPrev?.addEventListener('click', (event) => {
    event.stopPropagation();
    stepLightbox(-1);
  });
  imageLightboxNext?.addEventListener('click', (event) => {
    event.stopPropagation();
    stepLightbox(1);
  });
  imageLightbox?.addEventListener('click', (event) => {
    if (event.target === imageLightbox) closeLightbox();
  });
  document.addEventListener('paste', handleDocumentPaste);
  document.addEventListener('keydown', handleLightboxKeydown);
  contentEl.addEventListener('input', schedulePersistDraft);
  notesEl.addEventListener('input', schedulePersistDraft);
  sourceUrlEl.addEventListener('input', schedulePersistDraft);
  categoryEl.addEventListener('change', () => {
    schedulePersistDraft();
  });
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
  document.getElementById('content-label').textContent = t(
    currentLanguage,
    'contentLabel',
  );
  document.getElementById('category-label').textContent = t(
    currentLanguage,
    'categoryLabel',
  );
  document.getElementById('source-url-label').textContent = t(
    currentLanguage,
    'sourceUrlLabel',
  );
  sourceUrlEl.placeholder = t(currentLanguage, 'urlPlaceholder');
  document.getElementById('image-label').textContent = t(
    currentLanguage,
    'imageLabel',
  );
  imageSelectBtn.textContent = t(currentLanguage, 'selectImageButton');
  if (imagePasteBtn) {
    imagePasteBtn.textContent = t(currentLanguage, 'pasteImageButton');
  }
  imageRemoveBtn.textContent = t(currentLanguage, 'removeImageButton');
  imageGroupSelectAllBtn.textContent = t(currentLanguage, 'imageGroupSelectAll');
  imageGroupSelectCurrentBtn.textContent = t(currentLanguage, 'imageGroupSelectCurrentOnly');
  if (imageLightboxClose) {
    imageLightboxClose.setAttribute('aria-label', t(currentLanguage, 'imageLightboxClose'));
    imageLightboxClose.title = t(currentLanguage, 'imageLightboxClose');
  }
  if (imageGroupState) {
    updateImageGroupHint();
  }
  document.getElementById('notes-label').textContent = t(
    currentLanguage,
    'notesLabel',
  );
  saveBtn.textContent = t(currentLanguage, 'saveButton');
  if (retrySyncBtn) {
    retrySyncBtn.textContent = t(currentLanguage, 'retrySyncButton');
  }
  updateSyncQueueToggleLabel();
  
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
  // 更新格式选项的文本
  const formatSelect = document.getElementById('settings-format');
  if (formatSelect && formatSelect.options.length >= 3) {
    formatSelect.options[0].text = t(currentLanguage, 'formatJsonMd');
    formatSelect.options[1].text = t(currentLanguage, 'formatJson');
    formatSelect.options[2].text = t(currentLanguage, 'formatMd');
  }
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
    applyStatus(statusEl, statusState.key, statusState.tone, statusState.vars);
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

function tFmt(key, vars) {
  let text = t(currentLanguage, key);
  Object.entries(vars).forEach(([k, v]) => {
    text = text.replace(`{${k}}`, String(v));
  });
  return text;
}

function clearImageState() {
  if (currentImageUrl && currentImageUrl.startsWith('blob:')) {
    URL.revokeObjectURL(currentImageUrl);
  }
  currentImageFile = null;
  currentImageUrl = null;
  imageGroupState = null;
  imagePreviewContainer.style.display = 'none';
  imageGroupPanel.style.display = 'none';
  imageGroupGrid.innerHTML = '';
  if (imageRemoveBtn) imageRemoveBtn.style.display = 'none';
  imageInput.value = '';
}

async function loadSavedFormState() {
  const [pending, existingDraft] = await Promise.all([
    getPendingCapture(),
    getSaveDraft(),
  ]);

  // Explicit context-menu capture always wins for that open.
  if (pending) {
    const draft = mergePendingIntoDraft(
      {
        content: pending.content,
        url: pending.url,
        imageUrl: pending.imageUrl,
        imageData: pending.imageData,
        imageGroup: pending.imageGroup,
      },
      existingDraft,
    );
    if (Array.isArray(draft.__mergedImagesForSync)) {
      await syncPickedImagesToIdb(draft.__mergedImagesForSync);
      delete draft.__mergedImagesForSync;
    }
    await clearPendingCapture();
    await setSaveDraft(draft);
    applyDraftToForm(draft);
    await applyDraftImages(draft);
    // Image-only capture: still fill empty content from selection/clipboard.
    if (!String(draft.content || '').trim()) {
      await preferFreshContentText({ overrideDraft: true });
      await persistDraftNow();
    }
    return;
  }

  // Restore notes / category / images / previous fields first…
  if (existingDraft) {
    applyDraftToForm(existingDraft);
    await applyDraftImages(existingDraft);
  }

  // …then prefer the latest page selection or clipboard over stale draft text.
  // (Draft persistence was winning and showed “previous copy” content.)
  const refreshed = await preferFreshContentText({ overrideDraft: true });
  if (refreshed || existingDraft) {
    await persistDraftNow();
  }
}

/**
 * Prefer live selection, then system clipboard, over persisted draft content.
 * @returns {'selection' | 'clipboard' | null}
 */
async function preferFreshContentText({ overrideDraft = false } = {}) {
  const selection = await readSelectionFromActiveTab();
  if (selection) {
    if (overrideDraft || !contentEl.value.trim()) {
      contentEl.value = selection;
    }
    return 'selection';
  }

  const clip = await readClipboardText();
  if (clip) {
    if (overrideDraft || !contentEl.value.trim()) {
      contentEl.value = clip;
    }
    return 'clipboard';
  }

  return null;
}

async function readSelectionFromActiveTab() {
  const [tab] = await browser.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (!tab?.id || !tab.url) return '';

  if (
    tab.url.startsWith('chrome://') ||
    tab.url.startsWith('edge://') ||
    tab.url.startsWith('about:') ||
    tab.url.startsWith('moz-extension://') ||
    tab.url.startsWith('chrome-extension://')
  ) {
    return '';
  }

  try {
    const response = await sendToContentScript(tab.id, {
      type: 'GET_SELECTION',
    });
    return (response?.text ?? '').trim();
  } catch {
    return '';
  }
}

async function readClipboardText() {
  try {
    if (!navigator.clipboard?.readText) return '';
    return (await navigator.clipboard.readText())?.trim() || '';
  } catch {
    // Permission denied or clipboard unavailable.
    return '';
  }
}

function applyDraftToForm(draft) {
  contentEl.value = draft.content ?? '';
  notesEl.value = draft.notes ?? '';
  sourceUrlEl.value = draft.url ?? '';
  if (draft.category) {
    categoryEl.value = draft.category;
  }

  clearImageState();
  // Image restore is async (IndexedDB); caller awaits applyDraftImages(draft).
}

async function applyDraftImages(draft) {
  const slots = normalizeDraftImageList(draft);
  if (!slots.length) return;

  const images = await hydrateDraftImageSlots(slots);
  if (!images.length) return;

  const selectedIndices = Array.isArray(draft.imageGroupSelected) && draft.imageGroupSelected.length
    ? draft.imageGroupSelected.filter((index) => index >= 0 && index < images.length)
    : images.map((_, index) => index);
  const clickedIndex = Number.isInteger(draft.clickedImageIndex)
    ? Math.min(Math.max(draft.clickedImageIndex, 0), images.length - 1)
    : (draft.imageGroup?.clickedIndex ?? 0);

  if (images.length === 1) {
    const only = images[0];
    imageGroupState = {
      images: [{ ...only, index: 0 }],
      clickedIndex: 0,
      selected: new Set([0]),
    };
    currentImageFile = only.base64
      ? { base64: only.base64, type: only.type || 'image/png', id: only.id }
      : only.url;
    currentImageUrl = only.base64
      ? `data:${only.type || 'image/png'};base64,${only.base64}`
      : only.url;
    showSingleImagePreview(currentImageUrl);
    return;
  }

  imageGroupState = {
    images: images.map((item, index) => ({ ...item, index })),
    clickedIndex: Math.min(Math.max(clickedIndex, 0), images.length - 1),
    selected: new Set(selectedIndices.length ? selectedIndices : images.map((_, index) => index)),
  };
  renderImageGroup();
  syncCurrentImageFromGroup();
}

function collectDraftFromForm() {
  const draft = {
    content: contentEl.value,
    notes: notesEl.value,
    url: sourceUrlEl.value.trim(),
    category: categoryEl.value,
    imageUrl: null,
    imageData: null,
    imageId: null,
    imageItems: null,
    imageGroup: null,
    imageGroupSelected: null,
    clickedImageIndex: 0,
  };

  const images = getCurrentPickedImages();
  if (!images.length) {
    return draft;
  }

  const clickedIndex = imageGroupState
    ? imageGroupState.clickedIndex
    : 0;
  const selected = imageGroupState
    ? [...imageGroupState.selected].sort((a, b) => a - b)
    : images.map((_, index) => index);

  applyMergedImagesToDraft(draft, images, clickedIndex);
  draft.imageGroupSelected = selected;
  return draft;
}

function getCurrentPickedImages() {
  if (imageGroupState?.images?.length) {
    return imageGroupState.images.map((item, index) => ({ ...item, index }));
  }
  const single = snapshotCurrentAsGroupItem();
  return single ? [single] : [];
}

function schedulePersistDraft() {
  if (persistDraftTimer) {
    clearTimeout(persistDraftTimer);
  }
  persistDraftTimer = setTimeout(async () => {
    persistDraftTimer = null;
    try {
      await persistDraftNow();
    } catch (error) {
      console.error('Failed to persist draft:', error);
    }
  }, 300);
}

async function persistDraftNow() {
  if (persistDraftTimer) {
    clearTimeout(persistDraftTimer);
    persistDraftTimer = null;
  }
  const draft = collectDraftFromForm();
  const images = getCurrentPickedImages();
  if (
    draft.content ||
    draft.notes ||
    draft.url ||
    images.length
  ) {
    // Binary images live in IndexedDB; chrome.storage only keeps lightweight refs.
    await syncPickedImagesToIdb(images);
    await setSaveDraft(draft);
  }
}

function showSingleImagePreview(src) {
  imageGroupPanel.style.display = 'none';
  // Keep imageGroupState when present — clearing it caused paste #3 to drop paste #1.
  let previewErrorHandled = false;
  imagePreview.onerror = () => {
    if (!previewErrorHandled) {
      previewErrorHandled = true;
      console.log('Image preview failed (CORS), but save will work via background fetch');
    }
  };
  imagePreview.onload = () => {};
  imagePreview.src = src;
  imagePreviewContainer.style.display = 'block';
  if (imageRemoveBtn) imageRemoveBtn.style.display = 'flex';
}

function renderImageGroup() {
  if (!imageGroupState) return;
  imagePreviewContainer.style.display = 'none';
  imageGroupPanel.style.display = 'block';
  if (imageRemoveBtn) imageRemoveBtn.style.display = 'flex';
  imageGroupGrid.innerHTML = '';

  imageGroupState.images.forEach((item, index) => {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'image-group-item';
    cell.dataset.index = String(index);
    if (imageGroupState.selected.has(index)) {
      cell.classList.add('selected');
    }
    if (index === imageGroupState.clickedIndex) {
      cell.classList.add('primary');
    }

    const img = document.createElement('img');
    img.alt = '';
    if (item.base64) {
      img.src = `data:${item.type || 'image/png'};base64,${item.base64}`;
    } else {
      img.src = item.url;
    }

    const check = document.createElement('span');
    check.className = 'image-group-check';
    check.textContent = '✓';

    const tag = document.createElement('span');
    tag.className = 'image-group-primary-tag';
    tag.textContent = t(currentLanguage, 'imageGroupPrimaryBadge');

    cell.append(img, check, tag);
    cell.addEventListener('click', (event) => {
      if (event.detail === 2) {
        openLightbox(getPreviewSourcesFromGroup(), index);
        return;
      }
      toggleImageGroupSelection(index);
    });
    cell.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      openLightbox(getPreviewSourcesFromGroup(), index);
    });
    imageGroupGrid.appendChild(cell);
  });

  updateImageGroupHint();
}

function getPreviewSourcesFromGroup() {
  if (!imageGroupState) return [];
  return imageGroupState.images.map((item) => {
    if (item.base64) {
      return `data:${item.type || 'image/png'};base64,${item.base64}`;
    }
    return item.url;
  }).filter(Boolean);
}

function updateImageGroupHint() {
  if (!imageGroupState) return;
  imageGroupHint.textContent = tFmt('imageGroupHint', {
    total: imageGroupState.images.length,
    selected: imageGroupState.selected.size,
  });
}

function toggleImageGroupSelection(index) {
  if (!imageGroupState) return;
  if (imageGroupState.selected.has(index)) {
    if (imageGroupState.selected.size <= 1) {
      return;
    }
    imageGroupState.selected.delete(index);
  } else {
    imageGroupState.selected.add(index);
  }
  renderImageGroup();
  syncCurrentImageFromGroup();
  schedulePersistDraft();
}

function handleImageGroupSelectAll() {
  if (!imageGroupState) return;
  imageGroupState.selected = new Set(
    imageGroupState.images.map((_, index) => index),
  );
  renderImageGroup();
  syncCurrentImageFromGroup();
  schedulePersistDraft();
}

function handleImageGroupSelectCurrentOnly() {
  if (!imageGroupState) return;
  imageGroupState.selected = new Set([imageGroupState.clickedIndex]);
  renderImageGroup();
  syncCurrentImageFromGroup();
  schedulePersistDraft();
}

function syncCurrentImageFromGroup() {
  if (!imageGroupState || imageGroupState.selected.size === 0) {
    currentImageFile = null;
    currentImageUrl = null;
    return;
  }
  const primaryIndex = imageGroupState.selected.has(imageGroupState.clickedIndex)
    ? imageGroupState.clickedIndex
    : [...imageGroupState.selected].sort((a, b) => a - b)[0];
  const item = imageGroupState.images[primaryIndex];
  if (item.base64) {
    currentImageFile = {
      id: item.id,
      base64: item.base64,
      type: item.type || 'image/png',
      arrayBuffer: item.arrayBuffer,
    };
    currentImageUrl = `data:${item.type || 'image/png'};base64,${item.base64}`;
  } else {
    currentImageFile = item.url;
    currentImageUrl = item.url;
  }
}

function buildImagePayloadFromItem(item) {
  if (item.base64) {
    const binaryString = atob(item.base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return {
      arrayBuffer: Array.from(new Uint8Array(bytes.buffer)),
      type: item.type || 'image/png',
    };
  }
  return { url: item.url };
}

function getImagesPayloadForSave() {
  if (!imageGroupState) {
    if (!currentImageFile) return { images: [], primaryIndex: 0 };
    if (typeof currentImageFile === 'string') {
      return { images: [{ url: currentImageFile }], primaryIndex: 0 };
    }
    if (currentImageFile.base64) {
      return {
        images: [buildImagePayloadFromItem(currentImageFile)],
        primaryIndex: 0,
      };
    }
    if (currentImageFile.arrayBuffer) {
      const arr = Array.isArray(currentImageFile.arrayBuffer)
        ? currentImageFile.arrayBuffer
        : Array.from(new Uint8Array(currentImageFile.arrayBuffer));
      return {
        images: [{ arrayBuffer: arr, type: currentImageFile.type || 'image/png' }],
        primaryIndex: 0,
      };
    }
    return { images: [], primaryIndex: 0 };
  }

  const selectedIndices = [...imageGroupState.selected].sort((a, b) => a - b);
  const images = selectedIndices.map((index) =>
    buildImagePayloadFromItem(imageGroupState.images[index]),
  );
  const primaryIndex = selectedIndices.indexOf(imageGroupState.clickedIndex);
  return {
    images,
    primaryIndex: primaryIndex >= 0 ? primaryIndex : 0,
  };
}

function handleImageSelect(event) {
  const files = [...(event.target.files || [])].filter((file) =>
    file.type.startsWith('image/'),
  );
  imageInput.value = '';
  if (!files.length) {
    setStatus('invalidImage', 'error');
    return;
  }

  // Append to remembered images (select / paste / right-click share one list).
  appendImagesFromBlobs(files, { announce: false }).catch((error) => {
    console.error('Failed to process selected images:', error);
    setStatus('invalidImage', 'error');
  });
}

function handleImageRemove() {
  clearImageState();
  persistDraftNow();
}

/**
 * Convert an image Blob/File to a PNG item used by the picker UI / save payload.
 * @param {Blob} blob
 * @returns {Promise<{url: string, base64: string, type: string, arrayBuffer: number[]}>}
 */
function processBlobToPngItem(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        if (!canvas.width || !canvas.height) {
          reject(new Error('Invalid image dimensions'));
          return;
        }
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        canvas.toBlob(async (pngBlob) => {
          try {
            if (!pngBlob || pngBlob.size === 0) {
              reject(new Error('Empty PNG blob'));
              return;
            }
            const arrayBuffer = await pngBlob.arrayBuffer();
            if (!arrayBuffer.byteLength) {
              reject(new Error('Empty ArrayBuffer'));
              return;
            }
            const uint8Array = new Uint8Array(arrayBuffer);
            const base64 = uint8ToBase64(uint8Array);
            resolve({
              url: `data:image/png;base64,${base64}`,
              base64,
              type: 'image/png',
              arrayBuffer: Array.from(uint8Array),
            });
          } catch (error) {
            reject(error);
          }
        }, 'image/png');
      };
      img.onerror = () => reject(new Error('Image decode failed'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('FileReader failed'));
    reader.readAsDataURL(blob);
  });
}

function uint8ToBase64(uint8Array) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < uint8Array.length; i += chunk) {
    binary += String.fromCharCode(...uint8Array.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function snapshotCurrentAsGroupItem() {
  if (imageGroupState?.images?.length) return null;
  if (!currentImageFile) return null;
  if (typeof currentImageFile === 'string') {
    return { id: createDraftImageId(), url: currentImageFile, index: 0 };
  }
  if (currentImageFile.base64) {
    return {
      id: currentImageFile.id || createDraftImageId(),
      url: currentImageUrl || `data:${currentImageFile.type || 'image/png'};base64,${currentImageFile.base64}`,
      base64: currentImageFile.base64,
      type: currentImageFile.type || 'image/png',
      arrayBuffer: currentImageFile.arrayBuffer,
      index: 0,
    };
  }
  if (currentImageFile.arrayBuffer) {
    const arr = Array.isArray(currentImageFile.arrayBuffer)
      ? currentImageFile.arrayBuffer
      : Array.from(new Uint8Array(currentImageFile.arrayBuffer));
    const base64 = uint8ToBase64(new Uint8Array(arr));
    return {
      id: currentImageFile.id || createDraftImageId(),
      url: currentImageUrl || `data:image/png;base64,${base64}`,
      base64,
      type: currentImageFile.type || 'image/png',
      arrayBuffer: arr,
      index: 0,
    };
  }
  return null;
}

function applyLocalImageItems(items, { append = true } = {}) {
  if (!items.length) return;

  const stamped = items.map((item) => ({
    ...item,
    id: item.id || createDraftImageId(),
  }));

  let nextImages = [];
  let clickedIndex = 0;

  if (append) {
    const existing = imageGroupState?.images?.length
      ? imageGroupState.images.map((item, index) => ({ ...item, index }))
      : (() => {
          const single = snapshotCurrentAsGroupItem();
          return single ? [single] : [];
        })();
    clickedIndex = existing.length;
    nextImages = [
      ...existing,
      ...stamped.map((item, offset) => ({ ...item, index: existing.length + offset })),
    ];
  } else {
    nextImages = stamped.map((item, index) => ({ ...item, index }));
    clickedIndex = 0;
  }

  if (currentImageUrl && currentImageUrl.startsWith('blob:')) {
    URL.revokeObjectURL(currentImageUrl);
  }

  // Always keep imageGroupState so later pastes append to the full remembered list.
  imageGroupState = {
    images: nextImages.map((item, index) => ({
      ...item,
      index,
      id: item.id || createDraftImageId(),
      url: item.url
        || (item.base64 ? `data:${item.type || 'image/png'};base64,${item.base64}` : ''),
    })),
    clickedIndex,
    selected: new Set(nextImages.map((_, index) => index)),
  };

  if (nextImages.length === 1) {
    const only = imageGroupState.images[0];
    currentImageFile = {
      id: only.id,
      base64: only.base64,
      type: only.type || 'image/png',
      arrayBuffer: only.arrayBuffer,
    };
    currentImageUrl = only.url
      || (only.base64 ? `data:${only.type || 'image/png'};base64,${only.base64}` : '');
    showSingleImagePreview(currentImageUrl);
    return;
  }

  renderImageGroup();
  syncCurrentImageFromGroup();
}

async function appendImagesFromBlobs(blobs, { announce = true } = {}) {
  const run = async () => {
    const items = [];
    for (const blob of blobs) {
      items.push(await processBlobToPngItem(blob));
    }
    applyLocalImageItems(items, { append: true });
    await persistDraftNow();
    if (announce) {
      const total = getCurrentPickedImages().length;
      setStatus('clipboardPasteSuccess', 'success', { n: items.length, total });
    }
  };

  const next = imageAppendChain.then(run, run);
  imageAppendChain = next.catch((error) => {
    console.error('Image append failed:', error);
  });
  try {
    await next;
  } catch (error) {
    setStatus('draftPersistFailed', 'error');
    throw error;
  }
}

function extractImageBlobsFromClipboardEvent(event) {
  const blobs = [];
  const files = event.clipboardData?.files;
  if (files?.length) {
    for (const file of files) {
      if (file.type.startsWith('image/')) blobs.push(file);
    }
  }
  if (!blobs.length && event.clipboardData?.items) {
    for (const item of event.clipboardData.items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) blobs.push(file);
      }
    }
  }
  return blobs;
}

async function readClipboardImageBlobs() {
  if (!navigator.clipboard?.read) {
    return [];
  }
  const clipboardItems = await navigator.clipboard.read();
  const blobs = [];
  for (const item of clipboardItems) {
    const imageType = item.types.find((type) => type.startsWith('image/'));
    if (!imageType) continue;
    blobs.push(await item.getType(imageType));
  }
  return blobs;
}

async function handlePasteImageClick() {
  try {
    const blobs = await readClipboardImageBlobs();
    if (!blobs.length) {
      setStatus('clipboardNoImage', 'error');
      return;
    }
    await appendImagesFromBlobs(blobs);
  } catch (error) {
    console.error('Clipboard image paste failed:', error);
    setStatus('clipboardPasteFailed', 'error');
  }
}

async function handleDocumentPaste(event) {
  const blobs = extractImageBlobsFromClipboardEvent(event);
  if (!blobs.length) return;
  event.preventDefault();
  try {
    await appendImagesFromBlobs(blobs);
  } catch (error) {
    console.error('Paste event image handling failed:', error);
    setStatus('invalidImage', 'error');
  }
}

function openLightbox(sources, startIndex = 0) {
  const list = (sources || []).filter(Boolean);
  if (!list.length || !imageLightbox || !imageLightboxImg) return;
  lightboxSources = list;
  lightboxIndex = Math.min(Math.max(startIndex, 0), list.length - 1);
  imageLightbox.classList.add('open');
  imageLightbox.setAttribute('aria-hidden', 'false');
  renderLightbox();
}

function closeLightbox() {
  if (!imageLightbox) return;
  imageLightbox.classList.remove('open');
  imageLightbox.setAttribute('aria-hidden', 'true');
  lightboxSources = [];
  lightboxIndex = 0;
  if (imageLightboxImg) imageLightboxImg.src = '';
}

function stepLightbox(delta) {
  if (lightboxSources.length <= 1) return;
  lightboxIndex = (lightboxIndex + delta + lightboxSources.length) % lightboxSources.length;
  renderLightbox();
}

function renderLightbox() {
  if (!imageLightboxImg) return;
  imageLightboxImg.src = lightboxSources[lightboxIndex] || '';
  const multi = lightboxSources.length > 1;
  if (imageLightboxPrev) imageLightboxPrev.style.display = multi ? 'block' : 'none';
  if (imageLightboxNext) imageLightboxNext.style.display = multi ? 'block' : 'none';
  if (imageLightboxCounter) {
    imageLightboxCounter.style.display = multi ? 'block' : 'none';
    imageLightboxCounter.textContent = multi
      ? `${lightboxIndex + 1} / ${lightboxSources.length}`
      : '';
  }
}

function handleLightboxKeydown(event) {
  if (!imageLightbox?.classList.contains('open')) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    closeLightbox();
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault();
    stepLightbox(-1);
  } else if (event.key === 'ArrowRight') {
    event.preventDefault();
    stepLightbox(1);
  }
}

function revokeSyncQueueObjectUrls() {
  for (const url of syncQueueObjectUrls) {
    URL.revokeObjectURL(url);
  }
  syncQueueObjectUrls = [];
  syncQueuePreviewMap.clear();
}

function imagePayloadToPreviewSrc(image) {
  if (!image) return null;
  if (image.url && (image.url.startsWith('http') || image.url.startsWith('data:'))) {
    return image.url;
  }
  if (image.arrayBuffer) {
    const bytes = Array.isArray(image.arrayBuffer)
      ? new Uint8Array(image.arrayBuffer)
      : new Uint8Array(image.arrayBuffer);
    return `data:${image.type || 'image/png'};base64,${uint8ToBase64(bytes)}`;
  }
  if (image.base64) {
    return `data:${image.type || 'image/png'};base64,${image.base64}`;
  }
  return null;
}

function getQueueItemImageSources(payload) {
  const images = Array.isArray(payload?.images) && payload.images.length
    ? payload.images
    : payload?.image
      ? [payload.image]
      : [];
  return images.map(imagePayloadToPreviewSrc).filter(Boolean);
}

async function loadSourceUrl() {
  if (sourceUrlEl.value.trim()) {
    return;
  }
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
  
  const content = contentEl.value.trim();
  const category = categoryEl.value;
  const url = sourceUrlEl.value.trim();
  const notes = notesEl.value.trim();
  
  const { images: imagesPayload, primaryIndex } = getImagesPayloadForSave();
  const hasImages = imagesPayload.length > 0;

  if (!content && !hasImages) {
    setStatus('emptyContent', 'error');
    return;
  }
  if (imageGroupState && imageGroupState.selected.size === 0) {
    setStatus('noImageSelected', 'error');
    return;
  }
  
  saving = true;
  saveBtn.disabled = true;
  setStatus('statusSaving', 'progress');
  
  try {
    let imageData = null;
    if (hasImages) {
      imageData = imagesPayload[primaryIndex] ?? imagesPayload[0];
    } else if (currentImageFile instanceof File || (currentImageFile?.constructor?.name === 'File')) {
      const arrayBuffer = await currentImageFile.arrayBuffer();
      if (arrayBuffer.byteLength === 0) {
        throw new Error('File ArrayBuffer is empty');
      }
      imageData = {
        arrayBuffer: Array.from(new Uint8Array(arrayBuffer)),
        type: 'image/png',
      };
    }
    
    // Persist to local sync queue first; GitHub upload continues after popup may close.
    await browser.runtime.sendMessage({
      type: 'SAVE_SELECTION',
      payload: {
        content,
        category,
        url,
        notes,
        image: imageData,
        images: hasImages ? imagesPayload : undefined,
        primaryIndex,
      },
    });
    
    setStatus('statusQueued', 'success');
    await clearSaveDraft();

    contentEl.value = '';
    notesEl.value = '';
    sourceUrlEl.value = '';
    clearImageState();

    await refreshSyncStatus();
  } catch (error) {
    console.error('Save error:', error);
    if (error?.message?.includes('GitHub') || error?.message?.includes('Missing GitHub')) {
      setStatus('missingGithub', 'error');
    } else {
      setStatus('statusError', 'error');
    }
  } finally {
    saving = false;
    saveBtn.disabled = false;
  }
}

function setStatus(key, tone = 'info', vars = null) {
  statusState = { key, tone, vars };
  applyStatus(statusEl, key, tone, vars);
}

async function refreshSyncStatus() {
  try {
    const summary = await browser.runtime.sendMessage({ type: 'GET_SYNC_STATUS' });
    lastSyncSummary = summary;
    renderSyncQueue(summary);

    if (!summary || summary.total === 0) {
      if (retrySyncBtn) retrySyncBtn.style.display = 'none';
      if (statusState.key === 'statusQueued') return;
      if (
        statusState.key === 'statusSyncPending' ||
        statusState.key === 'statusSyncFailed'
      ) {
        setStatus('statusIdle', 'muted');
      }
      return;
    }

    if (retrySyncBtn) {
      retrySyncBtn.style.display = summary.failed > 0 || summary.pending > 0 ? 'block' : 'none';
    }

    // Don't override the just-queued success message immediately.
    if (statusState.key === 'statusQueued') return;

    if (summary.failed > 0) {
      setStatus('statusSyncFailed', 'error', { n: summary.failed });
    } else if (summary.pending > 0) {
      setStatus('statusSyncPending', 'progress', { n: summary.pending });
    }
  } catch (error) {
    console.error('Failed to load sync status:', error);
  }
}

function updateSyncQueueToggleLabel() {
  if (!syncQueueToggle) return;
  const count = lastSyncSummary?.total ?? 0;
  syncQueueToggle.textContent = syncQueueExpanded
    ? t(currentLanguage, 'syncQueueToggleHide')
    : tFmt('syncQueueToggleShow', { n: count });
}

function renderSyncQueue(summary) {
  if (!syncQueuePanel || !syncQueueList || !syncQueueToggle) return;

  revokeSyncQueueObjectUrls();

  if (!summary || summary.total === 0) {
    syncQueuePanel.classList.remove('visible');
    syncQueueList.classList.remove('expanded');
    syncQueueList.innerHTML = '';
    syncQueueExpanded = false;
    return;
  }

  syncQueuePanel.classList.add('visible');
  syncQueueList.classList.toggle('expanded', syncQueueExpanded);
  updateSyncQueueToggleLabel();

  const statusLabel = {
    pending: t(currentLanguage, 'syncQueueStatusPending'),
    uploading: t(currentLanguage, 'syncQueueStatusUploading'),
    failed: t(currentLanguage, 'syncQueueStatusFailed'),
  };

  syncQueueList.innerHTML = '';
  for (const item of summary.items) {
    const row = document.createElement('div');
    row.className = 'sync-queue-item';
    row.setAttribute('role', 'listitem');
    row.dataset.id = item.id;

    const imageSources = getQueueItemImageSources(item.payload);
    syncQueuePreviewMap.set(item.id, imageSources);
    const thumbs = document.createElement('div');
    thumbs.className = 'sync-queue-thumbs';
    if (imageSources.length) {
      const visible = imageSources.slice(0, 2);
      visible.forEach((src, index) => {
        const thumb = document.createElement('img');
        thumb.className = 'sync-queue-thumb';
        thumb.src = src;
        thumb.alt = '';
        thumb.dataset.action = 'preview';
        thumb.dataset.id = item.id;
        thumb.dataset.index = String(index);
        thumbs.appendChild(thumb);
      });
      if (imageSources.length > 2) {
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'sync-queue-thumb-more';
        more.dataset.action = 'preview';
        more.dataset.id = item.id;
        more.dataset.index = '0';
        more.textContent = `+${imageSources.length - 2}`;
        more.title = tFmt('syncQueueImagesCount', { n: imageSources.length });
        thumbs.appendChild(more);
      }
    }

    const meta = document.createElement('div');
    meta.className = 'sync-queue-item-meta';

    const badge = document.createElement('span');
    badge.className = 'sync-queue-badge';
    badge.dataset.status = item.status;
    badge.textContent = statusLabel[item.status] || item.status;

    const preview = document.createElement('span');
    preview.className = 'sync-queue-preview';
    const raw = (item.payload?.content || '').trim().replace(/\s+/g, ' ');
    preview.textContent = raw
      ? (raw.length > 48 ? `${raw.slice(0, 48)}…` : raw)
      : (imageSources.length
        ? tFmt('syncQueueImagesCount', { n: imageSources.length })
        : t(currentLanguage, 'syncQueueEmptyPreview'));
    preview.title = raw || preview.textContent;

    meta.append(badge, preview);

    if (item.attempts > 0) {
      const attempts = document.createElement('span');
      attempts.style.color = '#94a3b8';
      attempts.style.fontSize = '10px';
      attempts.textContent = tFmt('syncQueueAttempts', { n: item.attempts });
      meta.appendChild(attempts);
    }

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'sync-queue-cancel';
    cancelBtn.dataset.action = 'cancel';
    cancelBtn.dataset.id = item.id;
    cancelBtn.textContent = t(currentLanguage, 'syncQueueCancel');

    if (imageSources.length) {
      row.append(thumbs, meta, cancelBtn);
    } else {
      row.style.gridTemplateColumns = '1fr auto';
      row.append(meta, cancelBtn);
    }

    if (item.lastError) {
      const err = document.createElement('div');
      err.className = 'sync-queue-error';
      err.textContent = item.lastError;
      err.title = item.lastError;
      row.appendChild(err);
    }

    syncQueueList.appendChild(row);
  }
}

function handleSyncQueueToggle() {
  syncQueueExpanded = !syncQueueExpanded;
  if (syncQueueList) {
    syncQueueList.classList.toggle('expanded', syncQueueExpanded);
  }
  updateSyncQueueToggleLabel();
}

async function handleSyncQueueListClick(event) {
  const previewEl = event.target.closest('[data-action="preview"]');
  if (previewEl?.dataset.id) {
    const sources = syncQueuePreviewMap.get(previewEl.dataset.id) || [];
    if (sources.length) {
      const startIndex = Number(previewEl.dataset.index || 0);
      openLightbox(sources, Number.isFinite(startIndex) ? startIndex : 0);
    }
    return;
  }

  const btn = event.target.closest('[data-action="cancel"]');
  if (!btn?.dataset.id) return;
  btn.disabled = true;
  try {
    const summary = await browser.runtime.sendMessage({
      type: 'CANCEL_SYNC_ITEM',
      id: btn.dataset.id,
    });
    lastSyncSummary = summary;
    renderSyncQueue(summary);
    if (!summary || summary.total === 0) {
      if (retrySyncBtn) retrySyncBtn.style.display = 'none';
      setStatus('statusIdle', 'muted');
      return;
    }
    if (retrySyncBtn) {
      retrySyncBtn.style.display = summary.failed > 0 || summary.pending > 0 ? 'block' : 'none';
    }
    if (summary.failed > 0) {
      setStatus('statusSyncFailed', 'error', { n: summary.failed });
    } else if (summary.pending > 0) {
      setStatus('statusSyncPending', 'progress', { n: summary.pending });
    } else {
      setStatus('statusIdle', 'muted');
    }
  } catch (error) {
    console.error('Cancel sync item failed:', error);
    btn.disabled = false;
  }
}

async function handleRetrySync() {
  if (retrySyncBtn) retrySyncBtn.disabled = true;
  try {
    setStatus('statusSaving', 'progress');
    await browser.runtime.sendMessage({ type: 'RETRY_SYNC' });
    await refreshSyncStatus();
    if (statusState.key === 'statusSaving') {
      setStatus('statusQueued', 'success');
    }
  } catch (error) {
    console.error('Retry sync failed:', error);
    setStatus('statusError', 'error');
  } finally {
    if (retrySyncBtn) retrySyncBtn.disabled = false;
  }
}

function loadSettingsForm(settings) {
  settingsLanguageEl.value = settings.language;
  settingsGithubTokenEl.value = settings.github.token;
  settingsGithubOwnerEl.value = settings.github.owner;
  settingsGithubRepoEl.value = settings.github.repo;
  settingsGithubBranchEl.value = settings.github.branch;
  settingsGithubBasePathEl.value = settings.github.basePath;
  settingsFormatEl.value = settings.outputFormats || 'json+md';
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
      outputFormats: settingsFormatEl.value,
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

    currentLanguage = settingsLanguageEl.value;
    applyTranslations();
    const updatedSettings = await getSettings();
    populateCategories(updatedSettings.categories);
  } catch {
    setSettingsStatus('settingsError', 'error');
  }
}

function setSettingsStatus(key, tone = 'info') {
  settingsStatusState = { key, tone };
  applyStatus(settingsStatusEl, key, tone);
}

function applyStatus(element, key, tone, vars = null) {
  if (!element) return;
  if (!key) {
    element.textContent = '';
    element.classList.remove('visible');
    element.removeAttribute('data-tone');
    return;
  }
  let text = t(currentLanguage, key);
  if (vars) {
    Object.entries(vars).forEach(([k, v]) => {
      text = text.replace(`{${k}}`, String(v));
    });
  }
  element.textContent = text;
  element.dataset.tone = tone;
  element.classList.add('visible');
}

