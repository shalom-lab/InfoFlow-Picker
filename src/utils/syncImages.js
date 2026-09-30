// Separate from draft images: clearing/editing a draft must never delete queued bytes.
const DB_NAME = 'infoflow-picker-sync-images';

async function withStore(mode, operation) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('images');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('images', mode);
      const request = operation(tx.objectStore('images'));
      tx.oncomplete = () => resolve(request?.result);
      tx.onerror = () => reject(tx.error || new Error('Image storage failed'));
      tx.onabort = () => reject(tx.error || new Error('Image storage aborted'));
    });
  } finally {
    db.close();
  }
}

export async function putSyncImage(blob) {
  const id = crypto.randomUUID();
  // Persist owned bytes, independent of a popup's temporary Blob backing file.
  const record = { bytes: await blob.arrayBuffer(), type: blob.type };
  await withStore('readwrite', (store) => store.put(record, id));
  return id;
}

export async function getSyncImage(id) {
  const record = await withStore('readonly', (store) => store.get(id));
  if (!record) throw new Error(`Local queued image is missing: ${id}`);
  return record instanceof Blob ? record : new Blob([record.bytes], { type: record.type });
}

export async function deleteSyncImages(images = []) {
  const ids = images.map((image) => image?.storageId).filter(Boolean);
  if (!ids.length) return;
  await withStore('readwrite', (store) => {
    for (const id of ids) store.delete(id);
  });
}
