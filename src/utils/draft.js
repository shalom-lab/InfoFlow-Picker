import browser from 'webextension-polyfill';

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

export function mergePendingIntoDraft(pending, existingDraft = null) {
  const base = existingDraft ?? emptyDraft();
  const next = {
    ...base,
    url: pending.url ?? base.url,
    updatedAt: Date.now(),
  };

  if (pending.content) {
    next.content = pending.content;
    next.imageUrl = null;
    next.imageData = null;
    next.imageGroup = null;
    next.imageGroupSelected = null;
  }

  if (pending.imageUrl) {
    next.imageUrl = pending.imageUrl;
    next.imageData = pending.imageData ?? null;
    next.imageGroup = pending.imageGroup ?? null;
    next.imageGroupSelected = pending.imageGroup?.clickedIndex != null
      ? [pending.imageGroup.clickedIndex]
      : [0];
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
    imageGroup: null,
    imageGroupSelected: null,
    updatedAt: 0,
  };
}
