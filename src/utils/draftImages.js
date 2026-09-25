const DB_NAME = 'infoflow-picker-draft';
const DB_VERSION = 1;
const STORE_NAME = 'images';

/**
 * @typedef {{
 *   id: string,
 *   type?: string,
 *   url?: string,
 *   blob?: Blob,
 *   updatedAt?: number,
 * }} DraftImageRecord
 */

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

export function createDraftImageId() {
  return `img-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * @param {string} id
 * @param {{ blob?: Blob, type?: string, url?: string }} payload
 */
export async function putDraftImage(id, payload) {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).put({
    id,
    blob: payload.blob ?? null,
    type: payload.type || payload.blob?.type || 'image/png',
    url: payload.url || '',
    updatedAt: Date.now(),
  });
  await txDone(tx);
  db.close();
}

/** @param {string} id */
export async function getDraftImage(id) {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const request = tx.objectStore(STORE_NAME).get(id);
  const record = await new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
  await txDone(tx);
  db.close();
  return record;
}

/** @param {string[]} ids */
export async function getDraftImages(ids) {
  const list = [];
  for (const id of ids) {
    const record = await getDraftImage(id);
    if (record) list.push(record);
  }
  return list;
}

/** Keep only the provided ids; delete the rest. */
export async function pruneDraftImages(keepIds = []) {
  const keep = new Set(keepIds.filter(Boolean));
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  const allKeys = await new Promise((resolve, reject) => {
    const request = store.getAllKeys();
    request.onsuccess = () => resolve(request.result ?? []);
    request.onerror = () => reject(request.error);
  });
  for (const key of allKeys) {
    if (!keep.has(key)) {
      store.delete(key);
    }
  }
  await txDone(tx);
  db.close();
}

export async function clearDraftImages() {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).clear();
  await txDone(tx);
  db.close();
}

/**
 * Persist binary images for the current picker list.
 * Draft metadata in chrome.storage only keeps lightweight refs (id/url).
 *
 * Important: items that only have an `id` (already stored in IDB from paste/select)
 * must be KEPT. Right-click merge passes existing slots without base64; pruning
 * those ids would wipe manual/paste images.
 *
 * @param {Array<{ id?: string, base64?: string, type?: string, url?: string, arrayBuffer?: number[]|ArrayBuffer }>} images
 */
export async function syncPickedImagesToIdb(images) {
  const keepIds = [];
  for (const item of images) {
    if (!item) continue;
    const id = item.id || createDraftImageId();
    item.id = id;

    if (item.base64 || item.arrayBuffer || item.url?.startsWith?.('data:')) {
      const blob = await imageItemToBlob(item);
      if (blob) {
        await putDraftImage(id, { blob, type: item.type || blob.type || 'image/png' });
        keepIds.push(id);
        continue;
      }
    }

    if (item.url && !item.url.startsWith('data:') && !item.url.startsWith('blob:')) {
      // Preserve any existing blob for this id; only refresh the remote url metadata.
      const previous = await getDraftImage(id);
      await putDraftImage(id, {
        blob: previous?.blob ?? null,
        url: item.url,
        type: item.type || previous?.type || 'image/png',
      });
      keepIds.push(id);
      continue;
    }

    // Lightweight ref from chrome.storage — keep the IndexedDB record as-is.
    const existing = await getDraftImage(id);
    if (existing?.blob || existing?.url) {
      keepIds.push(id);
    }
  }
  await pruneDraftImages(keepIds);
  return keepIds;
}

/**
 * @param {{ id?: string, base64?: string, type?: string, url?: string, arrayBuffer?: number[]|ArrayBuffer }} item
 * @returns {Promise<Blob|null>}
 */
async function imageItemToBlob(item) {
  if (item.arrayBuffer) {
    const bytes = Array.isArray(item.arrayBuffer)
      ? new Uint8Array(item.arrayBuffer)
      : new Uint8Array(item.arrayBuffer);
    return new Blob([bytes], { type: item.type || 'image/png' });
  }
  if (item.base64) {
    const binary = atob(item.base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: item.type || 'image/png' });
  }
  if (item.url?.startsWith('data:')) {
    const response = await fetch(item.url);
    return response.blob();
  }
  return null;
}

/**
 * Rehydrate picker items from draft metadata + IndexedDB.
 * @param {Array<{ id?: string, url?: string, type?: string, base64?: string }>} slots
 */
export async function hydrateDraftImageSlots(slots) {
  if (!Array.isArray(slots) || !slots.length) return [];
  const images = [];
  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index];
    if (!slot) continue;

    // Legacy in-storage base64 (migrate on the fly).
    if (slot.base64) {
      const id = slot.id || createDraftImageId();
      images.push({
        id,
        index,
        base64: slot.base64,
        type: slot.type || 'image/png',
        url: slot.url && !String(slot.url).startsWith('data:')
          ? slot.url
          : `data:${slot.type || 'image/png'};base64,${slot.base64}`,
      });
      continue;
    }

    if (slot.id) {
      const record = await getDraftImage(slot.id);
      if (record?.blob) {
        const base64 = await blobToBase64(record.blob);
        images.push({
          id: slot.id,
          index,
          base64,
          type: record.type || slot.type || 'image/png',
          url: `data:${record.type || slot.type || 'image/png'};base64,${base64}`,
        });
        continue;
      }
      if (record?.url) {
        images.push({
          id: slot.id,
          index,
          url: record.url,
          type: record.type || slot.type || 'image/png',
        });
        continue;
      }
    }

    if (slot.url) {
      images.push({
        id: slot.id || createDraftImageId(),
        index,
        url: slot.url,
        type: slot.type || 'image/png',
      });
    }
  }
  return images;
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Clear chrome draft helpers may also call this. */
export async function clearAllDraftImageData() {
  try {
    await clearDraftImages();
  } catch (error) {
    console.warn('Failed to clear draft images from IndexedDB:', error);
  }
}
