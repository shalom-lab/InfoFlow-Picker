import browser from 'webextension-polyfill';

export const SYNC_QUEUE_KEY = 'syncQueue';
export const SYNC_ALARM_NAME = 'infoflow-sync-queue';
export const MAX_SYNC_ATTEMPTS = 12;

/**
 * @typedef {'pending' | 'uploading' | 'failed'} SyncStatus
 * @typedef {{
 *   id: string,
 *   payload: object,
 *   status: SyncStatus,
 *   attempts: number,
 *   lastError: string | null,
 *   createdAt: number,
 *   updatedAt: number,
 * }} SyncQueueItem
 */

export async function getSyncQueue() {
  const { [SYNC_QUEUE_KEY]: queue } = await browser.storage.local.get(SYNC_QUEUE_KEY);
  return Array.isArray(queue) ? queue : [];
}

async function setSyncQueue(queue) {
  await browser.storage.local.set({ [SYNC_QUEUE_KEY]: queue });
  await updateSyncBadge(queue);
}

export function createSyncItem(payload) {
  const now = Date.now();
  return {
    id: `sync-${now}-${Math.random().toString(36).slice(2, 10)}`,
    payload,
    status: 'pending',
    attempts: 0,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** Persist job before any network upload — data survives popup close / SW sleep. */
export async function enqueueSync(payload) {
  const item = createSyncItem(payload);
  const queue = await getSyncQueue();
  queue.push(item);
  await setSyncQueue(queue);
  return item;
}

export async function updateSyncItem(id, patch) {
  const queue = await getSyncQueue();
  const index = queue.findIndex((item) => item.id === id);
  if (index < 0) return null;
  queue[index] = {
    ...queue[index],
    ...patch,
    updatedAt: Date.now(),
  };
  await setSyncQueue(queue);
  return queue[index];
}

export async function removeSyncItem(id) {
  const queue = await getSyncQueue();
  const next = queue.filter((item) => item.id !== id);
  await setSyncQueue(next);
  return next;
}

export async function getSyncSummary() {
  const queue = await getSyncQueue();
  const pending = queue.filter((item) => item.status === 'pending' || item.status === 'uploading');
  const failed = queue.filter((item) => item.status === 'failed');
  return {
    total: queue.length,
    pending: pending.length,
    failed: failed.length,
    items: queue,
  };
}

export async function updateSyncBadge(queue) {
  const list = queue ?? (await getSyncQueue());
  const failed = list.filter((item) => item.status === 'failed').length;
  const pending = list.filter(
    (item) => item.status === 'pending' || item.status === 'uploading',
  ).length;
  const action = browser.action ?? browser.browserAction;
  if (!action?.setBadgeText) return;

  try {
    if (failed > 0) {
      await action.setBadgeText({ text: String(Math.min(failed, 99)) });
      await action.setBadgeBackgroundColor?.({ color: '#dc2626' });
    } else if (pending > 0) {
      await action.setBadgeText({ text: String(Math.min(pending, 99)) });
      await action.setBadgeBackgroundColor?.({ color: '#4f46e5' });
    } else {
      await action.setBadgeText({ text: '' });
    }
  } catch {
    // Badge APIs differ slightly across browsers; never block sync.
  }
}

/** Schedule SW wake-up so uploads continue after popup closes. */
export async function scheduleSyncAlarm(delayInMinutes = 0.5) {
  if (!browser.alarms?.create) return;
  try {
    await browser.alarms.clear(SYNC_ALARM_NAME);
    await browser.alarms.create(SYNC_ALARM_NAME, {
      delayInMinutes: Math.max(delayInMinutes, 0.1),
    });
  } catch {
    // alarms optional on some builds
  }
}

export function nextRetryDelayMinutes(attempts) {
  if (attempts <= 1) return 0.5;
  if (attempts <= 3) return 1;
  if (attempts <= 6) return 5;
  return 15;
}
