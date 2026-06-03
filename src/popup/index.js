import browser from 'webextension-polyfill';
import { getSettings, saveSettings, DEFAULT_CATEGORIES } from '../utils/storage.js';
import { t } from '../i18n/index.js';

const contentEl = document.getElementById('content');
const sourceUrlEl = document.getElementById('source-url');
const categoryEl = document.getElementById('category');
const notesEl = document.getElementById('notes');
const saveBtn = document.getElementById('save-btn');
const statusEl = document.getElementById('status');
const optionsBtn = document.getElementById('options-btn');
const imageInput = document.getElementById('image-input');
const imageSelectBtn = document.getElementById('image-select-btn');
const imagePreviewContainer = document.getElementById('image-preview-container');
const imagePreview = document.getElementById('image-preview');
const imageRemoveBtn = document.getElementById('image-remove-btn');
const imageGroupPanel = document.getElementById('image-group-panel');
const imageGroupHint = document.getElementById('image-group-hint');
const imageGroupGrid = document.getElementById('image-group-grid');
const imageGroupSelectAllBtn = document.getElementById('image-group-select-all');
const imageGroupSelectCurrentBtn = document.getElementById('image-group-select-current');

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
/** @type {{ images: Array<{url: string, base64?: string, type?: string}>, clickedIndex: number, selected: Set<number> } | null} */
let imageGroupState = null;

init();

async function init() {
  const settings = await getSettings();
  currentLanguage = settings.language;
  applyTranslations();
  populateCategories(settings.categories);
  
  clearImageState();
  
  await Promise.all([loadSelectionFromPage(), loadSourceUrl()]);
  loadSettingsForm(settings);
  
  optionsBtn.addEventListener('click', toggleView);
  saveBtn.addEventListener('click', handleSave);
  saveSettingsBtn.addEventListener('click', handleSaveSettings);
  imageSelectBtn.addEventListener('click', () => imageInput.click());
  imageInput.addEventListener('change', handleImageSelect);
  imageRemoveBtn.addEventListener('click', handleImageRemove);
  imageGroupSelectAllBtn.addEventListener('click', handleImageGroupSelectAll);
  imageGroupSelectCurrentBtn.addEventListener('click', handleImageGroupSelectCurrentOnly);
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
  imageRemoveBtn.textContent = t(currentLanguage, 'removeImageButton');
  imageGroupSelectAllBtn.textContent = t(currentLanguage, 'imageGroupSelectAll');
  imageGroupSelectCurrentBtn.textContent = t(currentLanguage, 'imageGroupSelectCurrentOnly');
  if (imageGroupState) {
    updateImageGroupHint();
  }
  document.getElementById('notes-label').textContent = t(
    currentLanguage,
    'notesLabel',
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
  imageInput.value = '';
}

async function loadSelectionFromPage() {
  const pending = await browser.storage.local.get([
    'pendingSelection',
    'pendingUrl',
    'pendingImageUrl',
    'pendingImageData',
    'pendingImageGroup',
  ]);
  
  // 处理图片右键
  if (pending.pendingImageUrl) {
    const group = pending.pendingImageGroup;
    const clickedIndex = group?.clickedIndex ?? 0;
    const groupImages = group?.images?.length > 1 ? group.images : null;

    if (groupImages) {
      const images = groupImages.map((item, index) => {
        const entry = { url: item.url, index };
        if (index === clickedIndex && pending.pendingImageData?.base64) {
          entry.base64 = pending.pendingImageData.base64;
          entry.type = pending.pendingImageData.type || 'image/png';
        }
        return entry;
      });
      imageGroupState = {
        images,
        clickedIndex,
        selected: new Set([clickedIndex]),
      };
      renderImageGroup();
      syncCurrentImageFromGroup();
    } else if (pending.pendingImageData?.base64) {
      const base64Data = pending.pendingImageData.base64;
      const mimeType = pending.pendingImageData.type || 'image/png';
      currentImageUrl = `data:${mimeType};base64,${base64Data}`;
      currentImageFile = { base64: base64Data, type: mimeType };
      showSingleImagePreview(currentImageUrl);
    } else {
      currentImageUrl = pending.pendingImageUrl;
      currentImageFile = pending.pendingImageUrl;
      showSingleImagePreview(currentImageUrl);
    }
    
    if (pending.pendingUrl) {
      sourceUrlEl.value = pending.pendingUrl;
    }
    await browser.storage.local.remove([
      'pendingImageUrl',
      'pendingUrl',
      'pendingImageData',
      'pendingImageGroup',
    ]);
    return;
  }
  
  // 处理文本选择
  if (pending.pendingSelection) {
    contentEl.value = pending.pendingSelection;
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
    contentEl.value = response?.text ?? '';
  } catch {
    contentEl.value = '';
  }
}

function showSingleImagePreview(src) {
  imageGroupPanel.style.display = 'none';
  imageGroupState = null;
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
}

function renderImageGroup() {
  if (!imageGroupState) return;
  imagePreviewContainer.style.display = 'none';
  imageGroupPanel.style.display = 'block';
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
    cell.addEventListener('click', () => toggleImageGroupSelection(index));
    imageGroupGrid.appendChild(cell);
  });

  updateImageGroupHint();
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
}

function handleImageGroupSelectAll() {
  if (!imageGroupState) return;
  imageGroupState.selected = new Set(
    imageGroupState.images.map((_, index) => index),
  );
  renderImageGroup();
  syncCurrentImageFromGroup();
}

function handleImageGroupSelectCurrentOnly() {
  if (!imageGroupState) return;
  imageGroupState.selected = new Set([imageGroupState.clickedIndex]);
  renderImageGroup();
  syncCurrentImageFromGroup();
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
    currentImageFile = { base64: item.base64, type: item.type || 'image/png' };
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
  const file = event.target.files[0];
  if (!file) return;
  
  imageGroupState = null;
  imageGroupPanel.style.display = 'none';
  
  if (!file.type.startsWith('image/')) {
    setStatus('invalidImage', 'error');
    return;
  }
  
  // 读取文件并转换为PNG格式
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      // 使用Canvas转换为PNG
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      
      // 转换为PNG格式的blob
      canvas.toBlob((blob) => {
        if (!blob) {
          setStatus('invalidImage', 'error');
          return;
        }
        
        // 调试：检查blob大小
        console.log('PNG blob size:', blob.size, 'Canvas size:', canvas.width, 'x', canvas.height);
        if (blob.size === 0) {
          setStatus('invalidImage', 'error');
          console.error('Blob is empty after canvas conversion');
          return;
        }
        
        // 直接将blob转换为ArrayBuffer并存储，避免File对象可能的问题
        blob.arrayBuffer().then((arrayBuffer) => {
          console.log('Blob ArrayBuffer size:', arrayBuffer.byteLength);
          if (arrayBuffer.byteLength === 0) {
            setStatus('invalidImage', 'error');
            console.error('ArrayBuffer is empty');
            return;
          }
          
          // 存储ArrayBuffer（转换为数组以便后续序列化）
          const uint8Array = new Uint8Array(arrayBuffer);
          currentImageFile = {
            arrayBuffer: Array.from(uint8Array),
            type: 'image/png',
            size: blob.size,
          };
          console.log('Stored array length:', currentImageFile.arrayBuffer.length);
          
          // 显示预览
          currentImageUrl = URL.createObjectURL(blob);
          // 重置错误处理（blob URL 通常不会有 CORS 问题，但为了安全起见）
          imagePreview.onerror = null;
          imagePreview.onload = null;
          imagePreview.src = currentImageUrl;
          imagePreviewContainer.style.display = 'block';
        }).catch((error) => {
          console.error('Failed to process blob:', error);
          setStatus('invalidImage', 'error');
        });
      }, 'image/png');
    };
    img.onerror = () => {
      setStatus('invalidImage', 'error');
    };
    img.src = e.target.result;
  };
  reader.onerror = () => {
    setStatus('invalidImage', 'error');
  };
  reader.readAsDataURL(file);
}

function handleImageRemove() {
  clearImageState();
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
    
    setStatus('statusSuccess', 'success');
    
    // 清空表单
    setTimeout(() => {
      contentEl.value = '';
      notesEl.value = '';
      handleImageRemove();
    }, 1500);
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

