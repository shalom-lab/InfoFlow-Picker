import browser from 'webextension-polyfill';
import { deleteSyncImages } from './syncImages.js';

export const SYNC_QUEUE_KEY = 'syncQueue';
export const SYNC_ALARM_NAME = 'infoflow-sync-queue';
export const MAX_SYNC_ATTEMPTS = 12;
/** Keep recent successful uploads so the popup can show “view on GitHub” links. */
export const KEEP_DONE = 10;

/**
 * @typedef {'pending' | 'uploading' | 'failed' | 'done'} SyncStatus
 * @typedef {{
 *   id: string,
 *   payload: object,
 *   status: SyncStatus,
 *   attempts: number,
 *   lastError: string | null,
 *   message?: string,
 *   nextAttempt?: number,
 *   resultUrl?: string | null,
 *   repo?: string | null,
 *   imageCount?: number,
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
    message: '已保存本地，等待上传',
    nextAttempt: 0,
    resultUrl: null,
    repo: null,
    imageCount: 0,
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

/**
 * Mark upload complete, drop binary payloads, keep a GitHub link, prune older dones.
 * Mirrors doubao-download’s KEEP_DONE + result url pattern.
 */
export async function completeSyncItem(id, { resultUrl, repo, imageCount = 0, message } = {}) {
  const queue = await getSyncQueue();
  const index = queue.findIndex((item) => item.id === id);
  if (index < 0) return null;

  const item = queue[index];
  const images = item.payload?.images || [];
  try {
    await deleteSyncImages(images);
  } catch (error) {
    console.warn('Done-item image cleanup failed:', error);
  }

  const lightPayload = {
    ...item.payload,
    image: null,
    images: [],
  };

  queue[index] = {
    ...item,
    status: 'done',
    lastError: null,
    message: message || '上传完成',
    nextAttempt: 0,
    resultUrl: resultUrl || null,
    repo: repo || null,
    imageCount: imageCount || images.length || 0,
    payload: lightPayload,
    updatedAt: Date.now(),
  };

  const pruned = pruneDoneItems(queue);
  await setSyncQueue(pruned);
  return pruned.find((row) => row.id === id) ?? null;
}

function pruneDoneItems(queue) {
  const done = queue
    .filter((item) => item.status === 'done')
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  if (done.length <= KEEP_DONE) return queue;

  const dropIds = new Set(done.slice(KEEP_DONE).map((item) => item.id));
  return queue.filter((item) => !dropIds.has(item.id));
}

export async function removeSyncItem(id) {
  const queue = await getSyncQueue();
  const next = queue.filter((item) => item.id !== id);
  await setSyncQueue(next);
  const removed = queue.find((item) => item.id === id);
  try {
    await deleteSyncImages(removed?.payload?.images || []);
  } catch (error) {
    console.warn('Queued image cleanup failed:', error);
  }
  return next;
}

/** Items ready to run now (respects backoff after failures). */
export function pickRunnableItems(queue, now = Date.now()) {
  return queue.filter(
    (item) =>
      (item.status === 'pending' || item.status === 'failed') &&
      (item.attempts || 0) < MAX_SYNC_ATTEMPTS &&
      (item.nextAttempt || 0) <= now,
  );
}

export async function getSyncSummary() {
  const queue = await getSyncQueue();
  // Active work first, then failed, then newest done — easier to scan.
  const rank = { uploading: 0, pending: 1, failed: 2, done: 3 };
  const items = [...queue].sort((a, b) => {
    const ra = rank[a.status] ?? 9;
    const rb = rank[b.status] ?? 9;
    if (ra !== rb) return ra - rb;
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });
  const pending = queue.filter((item) => item.status === 'pending' || item.status === 'uploading');
  const failed = queue.filter((item) => item.status === 'failed');
  const done = queue.filter((item) => item.status === 'done');
  return {
    total: queue.length,
    pending: pending.length,
    failed: failed.length,
    done: done.length,
    items,
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

export function nextRetryDelayMs(attempts) {
  return Math.round(nextRetryDelayMinutes(attempts) * 60_000);
}
