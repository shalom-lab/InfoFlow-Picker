import browser from 'webextension-polyfill';
import { clearAllDraftImageData, createDraftImageId } from './draftImages.js';

export const SAVE_DRAFT_KEY = 'saveDraft';
export const PENDING_CAPTURE_KEY = 'pendingCapture';

const LEGACY_PENDING_KEYS = [
  'pendingSelection',
  'pendingUrl',
  'pendingImageUrl',
  'pendingImageData',
  'pendingImageGroup',
];

export async function getSaveDraft() {
  const { [SAVE_DRAFT_KEY]: draft } = await browser.storage.local.get(SAVE_DRAFT_KEY);
  return draft ?? null;
}

export async function setSaveDraft(draft) {
  await browser.storage.local.set({
    [SAVE_DRAFT_KEY]: {
      ...draft,
      updatedAt: Date.now(),
    },
  });
}

export async function clearSaveDraft() {
  await browser.storage.local.remove([
    SAVE_DRAFT_KEY,
    PENDING_CAPTURE_KEY,
    ...LEGACY_PENDING_KEYS,
  ]);
  await clearAllDraftImageData();
}

export async function getPendingCapture() {
  const stored = await browser.storage.local.get([
    PENDING_CAPTURE_KEY,
    ...LEGACY_PENDING_KEYS,
  ]);

  if (stored[PENDING_CAPTURE_KEY]) {
    return stored[PENDING_CAPTURE_KEY];
  }

  if (
    stored.pendingSelection ||
    stored.pendingImageUrl ||
    stored.pendingImageData ||
    stored.pendingImageGroup
  ) {
    return {
      content: stored.pendingSelection ?? '',
      url: stored.pendingUrl ?? '',
      imageUrl: stored.pendingImageUrl ?? null,
      imageData: stored.pendingImageData ?? null,
      imageGroup: stored.pendingImageGroup ?? null,
      capturedAt: Date.now(),
    };
  }

  return null;
}

export async function clearPendingCapture() {
  await browser.storage.local.remove([PENDING_CAPTURE_KEY, ...LEGACY_PENDING_KEYS]);
}

/**
 * Normalize draft / pending image fields into a flat list of lightweight slots.
 * Supports legacy base64 drafts, imageItems refs, and imageGroup.
 */
export function normalizeDraftImageList(draft) {
  if (!draft) return [];

  if (Array.isArray(draft.imageItems) && draft.imageItems.length > 0) {
    return draft.imageItems.map((item, index) => ({
      id: item.id,
      url: item.url || '',
      type: item.type,
      base64: item.base64,
      index,
    }));
  }

  if (Array.isArray(draft.imageGroup?.images) && draft.imageGroup.images.length > 0) {
    const clickedIndex = draft.imageGroup.clickedIndex ?? 0;
    return draft.imageGroup.images.map((item, index) => {
      const entry = {
        id: item.id,
        url: item.url || '',
        index,
      };
      if (item.base64) {
        entry.base64 = item.base64;
        entry.type = item.type || 'image/png';
      } else if (index === clickedIndex && draft.imageData?.base64) {
        entry.base64 = draft.imageData.base64;
        entry.type = draft.imageData.type || 'image/png';
      }
      return entry;
    });
  }

  if (draft.imageData?.base64) {
    return [{
      id: draft.imageId || undefined,
      url: draft.imageUrl || '',
      base64: draft.imageData.base64,
      type: draft.imageData.type || 'image/png',
      index: 0,
    }];
  }

  if (draft.imageUrl) {
    return [{ id: draft.imageId || undefined, url: draft.imageUrl, index: 0 }];
  }

  return [];
}

function normalizePendingImages(pending) {
  if (!pending) return [];

  if (Array.isArray(pending.imageGroup?.images) && pending.imageGroup.images.length > 0) {
    const clickedIndex = pending.imageGroup.clickedIndex ?? 0;
    return pending.imageGroup.images.map((item, index) => {
      const entry = {
        id: item.id,
        url: item.url || '',
        index,
      };
      if (item.base64) {
        entry.base64 = item.base64;
        entry.type = item.type || 'image/png';
      } else if (index === clickedIndex && pending.imageData?.base64) {
        entry.base64 = pending.imageData.base64;
        entry.type = pending.imageData.type || 'image/png';
      }
      return entry;
    });
  }

  if (pending.imageData?.base64) {
    return [{
      url: pending.imageUrl || '',
      base64: pending.imageData.base64,
      type: pending.imageData.type || 'image/png',
      index: 0,
    }];
  }

  if (pending.imageUrl) {
    return [{ url: pending.imageUrl, index: 0 }];
  }

  return [];
}

function imageIdentity(item) {
  if (item?.id) return `id:${item.id}`;
  if (item?.base64) return `b64:${item.base64.slice(0, 64)}:${item.base64.length}`;
  if (item?.url) return `url:${item.url}`;
  return '';
}

function dedupeImages(images) {
  const seen = new Set();
  const result = [];
  for (const item of images) {
    const key = imageIdentity(item);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    result.push({ ...item, index: result.length });
  }
  return result;
}

function storageUrl(url) {
  if (!url || url.startsWith('data:') || url.startsWith('blob:')) return '';
  return url;
}

/**
 * Write a merged image list back onto draft fields as lightweight refs.
 * Binary payloads belong in IndexedDB, not chrome.storage.
 */
export function applyMergedImagesToDraft(draft, images, clickedIndex = 0) {
  if (!images.length) {
    draft.imageUrl = null;
    draft.imageData = null;
    draft.imageId = null;
    draft.imageItems = null;
    draft.imageGroup = null;
    draft.imageGroupSelected = null;
    return draft;
  }

  const normalized = images.map((item, index) => ({ ...item, index }));
  const safeClicked = Math.min(Math.max(clickedIndex, 0), normalized.length - 1);

  draft.imageItems = normalized.map(({ id, url, type, index }) => {
    const entry = { index };
    if (id) entry.id = id;
    const safe = storageUrl(url);
    if (safe) entry.url = safe;
    if (type) entry.type = type;
    return entry;
  });
  draft.imageGroupSelected = normalized.map((_, index) => index);
  draft.imageGroup = null;
  draft.imageData = null;

  const primary = normalized[safeClicked];
  draft.imageId = primary.id || null;
  draft.imageUrl = storageUrl(primary.url) || null;
  draft.clickedImageIndex = safeClicked;

  return draft;
}

/**
 * Merge a context-menu capture into the existing draft.
 * Text updates content/url only; images APPEND to remembered images.
 */
export function mergePendingIntoDraft(pending, existingDraft = null) {
  const base = existingDraft ?? emptyDraft();
  const next = {
    ...base,
    url: pending.url ?? base.url,
    updatedAt: Date.now(),
  };

  if (pending.content) {
    next.content = pending.content;
  }

  const incoming = normalizePendingImages(pending).map((item) => ({
    ...item,
    id: item.id || createDraftImageId(),
  }));
  if (incoming.length) {
    const existing = normalizeDraftImageList(next).map((item) => ({
      ...item,
      id: item.id || createDraftImageId(),
    }));
    const merged = dedupeImages([...existing, ...incoming]);
    // Caller should sync __mergedImagesForSync (may include base64) into IndexedDB
    // before persisting the lightweight draft metadata.
    next.__mergedImagesForSync = merged;
    applyMergedImagesToDraft(next, merged, existing.length);
  }

  return next;
}

export function emptyDraft() {
  return {
    content: '',
    url: '',
    notes: '',
    category: '',
    imageUrl: null,
    imageData: null,
    imageId: null,
    imageItems: null,
    imageGroup: null,
    imageGroupSelected: null,
    clickedImageIndex: 0,
    updatedAt: 0,
  };
}
