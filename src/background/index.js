import { imageExtension } from '../utils/optimizeImage.js';
import { resolveImageArrayBuffer } from '../utils/imagePayload.js';
import browser from 'webextension-polyfill';
import { getSettings } from '../utils/storage.js';
import { PENDING_CAPTURE_KEY } from '../utils/draft.js';
import { sendToContentScript } from '../utils/injectContent.js';
import { t, DEFAULT_LANGUAGE } from '../i18n/index.js';
import {
  SYNC_ALARM_NAME,
  MAX_SYNC_ATTEMPTS,
  enqueueSync,
  getSyncQueue,
  getSyncSummary,
  updateSyncItem,
  removeSyncItem,
  completeSyncItem,
  pickRunnableItems,
  scheduleSyncAlarm,
  nextRetryDelayMinutes,
  nextRetryDelayMs,
  updateSyncBadge,
} from '../utils/syncQueue.js';

function tSync(locale, key, vars = null) {
  let text = t(locale || DEFAULT_LANGUAGE, key);
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value));
    }
  }
  return text;
}

const CONTEXT_MENU_ID = 'infoflow-extract';

let syncProcessing = false;

browser.runtime.onInstalled.addListener(() => {
  setupContextMenu();
  processSyncQueue().catch((err) => console.error('Initial sync failed:', err));
});

browser.runtime.onStartup?.addListener(() => {
  processSyncQueue().catch((err) => console.error('Startup sync failed:', err));
});

if (browser.alarms?.onAlarm) {
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === SYNC_ALARM_NAME) {
      processSyncQueue().catch((err) => console.error('Alarm sync failed:', err));
    }
  });
}

async function setupContextMenu() {
  try {
    await browser.contextMenus.removeAll();
  } catch {
    // ignore
  }

  browser.contextMenus.create({
    id: CONTEXT_MENU_ID,
    title: 'InfoFlow Picker',
    contexts: ['selection', 'image'],
  });
}

browser.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID) return;
  
  // 处理图片右键
  if (info.mediaType === 'image' && info.srcUrl) {
    const pendingCapture = {
      url: tab.url ?? '',
      imageUrl: info.srcUrl,
      imageData: null,
      imageGroup: null,
      capturedAt: Date.now(),
    };

    if (tab?.id) {
      const [imageData, imageGroup] = await Promise.all([
        sendToContentScript(tab.id, {
          type: 'GET_IMAGE_DATA',
          imageUrl: info.srcUrl,
        }).catch(() => null),
        sendToContentScript(tab.id, {
          type: 'GET_IMAGE_GROUP',
          imageUrl: info.srcUrl,
        }).catch(() => null),
      ]);

      if (imageData?.base64) {
        pendingCapture.imageData = imageData;
      }
      if (imageGroup?.images?.length) {
        pendingCapture.imageGroup = imageGroup;
      }
    }

    await browser.storage.local.set({ [PENDING_CAPTURE_KEY]: pendingCapture });
    await browser.action.openPopup?.().catch(() => {});
    return;
  }
  
  // 处理文本选择
  const selection = info.selectionText?.trim();
  if (!selection || !tab?.id) return;
  await browser.storage.local.set({
    [PENDING_CAPTURE_KEY]: {
      content: selection,
      url: tab.url ?? '',
      capturedAt: Date.now(),
    },
  });
  await browser.action.openPopup?.().catch(() => {});
});

browser.runtime.onMessage.addListener((message) => {
  if (message?.type === 'SAVE_SELECTION') {
    return enqueueSaveSelection(message.payload);
  }
  if (message?.type === 'GET_SYNC_STATUS') {
    // Popup open / poll: wake any runnable jobs without blocking the status reply path.
    processSyncQueue().catch((err) => console.error('Sync kick failed:', err));
    return getSyncSummary();
  }
  if (message?.type === 'KICK_SYNC') {
    return (async () => {
      await processSyncQueue();
      return getSyncSummary();
    })();
  }
  if (message?.type === 'RETRY_SYNC') {
    return (async () => {
      const settings = await getSettings();
      const locale = settings.language || DEFAULT_LANGUAGE;
      const queue = await getSyncQueue();
      // Do not touch in-flight "uploading" items — resetting them races the worker.
      for (const item of queue) {
        if (item.status === 'failed' || item.status === 'pending') {
          await updateSyncItem(item.id, {
            status: 'pending',
            attempts: 0,
            lastError: null,
            nextAttempt: 0,
            message: tSync(locale, 'syncMsgRetryWait'),
          });
        }
      }
      await processSyncQueue();
      return getSyncSummary();
    })();
  }
  if (message?.type === 'RETRY_SYNC_ITEM' && message.id) {
    return (async () => {
      const settings = await getSettings();
      const locale = settings.language || DEFAULT_LANGUAGE;
      const queue = await getSyncQueue();
      const item = queue.find((row) => row.id === message.id);
      if (!item || (item.status !== 'failed' && item.status !== 'pending')) {
        return getSyncSummary();
      }
      await updateSyncItem(item.id, {
        status: 'pending',
        attempts: 0,
        lastError: null,
        nextAttempt: 0,
        message: tSync(locale, 'syncMsgRetryWait'),
      });
      await processSyncQueue();
      return getSyncSummary();
    })();
  }
  if (message?.type === 'CANCEL_SYNC_ITEM' && message.id) {
    return (async () => {
      await removeSyncItem(message.id);
      return getSyncSummary();
    })();
  }
  return undefined;
});

/** Validate + persist locally, return immediately; upload continues in background. */
async function enqueueSaveSelection(payload) {
  const normalized = normalizeSavePayload(payload);
  const settings = await assertGithubSettings();
  const locale = settings.language || DEFAULT_LANGUAGE;

  const item = await enqueueSync(normalized);
  const imageCount = Array.isArray(normalized.images) ? normalized.images.length : 0;
  await updateSyncItem(item.id, {
    repo: `${settings.github.owner}/${settings.github.repo}`,
    imageCount,
    message: imageCount > 0
      ? tSync(locale, 'syncMsgQueuedImages', { n: imageCount })
      : tSync(locale, 'syncMsgQueued'),
  });
  // Kick upload without blocking the popup response path beyond enqueue.
  processSyncQueue().catch((err) => console.error('Sync queue error:', err));
  await scheduleSyncAlarm(0.2);

  return {
    ok: true,
    queued: true,
    id: item.id,
  };
}

function normalizeSavePayload(payload) {
  const content = payload?.content?.trim() || '';
  const category = payload?.category?.trim();
  const url = payload?.url?.trim() || '';
  const notes = payload?.notes?.trim() || '';
  const image = payload?.image;
  const images = Array.isArray(payload?.images) ? payload.images.filter(Boolean) : [];
  const imagesToUpload = images.length > 0 ? images : image ? [image] : [];
  const primaryUploadIndex = Math.min(
    Math.max(payload?.primaryIndex ?? 0, 0),
    Math.max(imagesToUpload.length - 1, 0),
  );

  if (!category) {
    throw new Error('Invalid payload: category is required');
  }
  if (!content && imagesToUpload.length === 0) {
    throw new Error('Invalid payload: content or image is required');
  }

  return {
    content,
    category,
    url,
    notes,
    // Store the primary index instead of duplicating its image bytes.
    image: null,
    images: imagesToUpload,
    primaryIndex: primaryUploadIndex,
  };
}

async function assertGithubSettings() {
  const settings = await getSettings();
  const missing = [];
  if (!settings.github.token || settings.github.token.trim() === '') {
    missing.push('token');
  }
  if (!settings.github.owner || settings.github.owner.trim() === '') {
    missing.push('owner');
  }
  if (!settings.github.repo || settings.github.repo.trim() === '') {
    missing.push('repo');
  }

  if (missing.length > 0) {
    console.error('GitHub settings check failed:', {
      hasToken: !!settings.github.token,
      hasOwner: !!settings.github.owner,
      hasRepo: !!settings.github.repo,
      missing,
    });
    throw new Error(`Missing GitHub settings: ${missing.join(', ')}`);
  }

  return settings;
}

/** How long an "uploading" item may sit before we treat the SW as killed mid-flight. */
const STUCK_UPLOADING_MS = 90 * 1000;

async function processSyncQueue() {
  if (syncProcessing) return;
  syncProcessing = true;

  try {
    const settingsForLocale = await getSettings();
    const locale = settingsForLocale.language || DEFAULT_LANGUAGE;

    // Only reclaim items left "uploading" after an MV3 SW kill — not mid-flight peers.
    const now = Date.now();
    const queue = await getSyncQueue();
    for (const item of queue) {
      if (item.status === 'uploading' && now - (item.updatedAt || 0) >= STUCK_UPLOADING_MS) {
        await updateSyncItem(item.id, {
          status: 'pending',
          nextAttempt: 0,
          message: tSync(locale, 'syncMsgInterrupted'),
        });
      }
    }

    let earliestBackoffMs = null;

    while (true) {
      const current = await getSyncQueue();
      const runnable = pickRunnableItems(current);
      const next = runnable[0];
      if (!next) {
        // Schedule wake for the soonest failed/backoff item.
        for (const item of current) {
          if (
            (item.status === 'failed' || item.status === 'pending') &&
            (item.attempts || 0) < MAX_SYNC_ATTEMPTS &&
            (item.nextAttempt || 0) > Date.now()
          ) {
            const wait = (item.nextAttempt || 0) - Date.now();
            if (earliestBackoffMs == null || wait < earliestBackoffMs) {
              earliestBackoffMs = wait;
            }
          }
        }
        break;
      }

      let settings;
      try {
        settings = await assertGithubSettings();
      } catch (error) {
        const message = error?.message || String(error);
        const hint = shortError(message, locale);
        // Settings block the whole queue — mark every runnable item so none look "stuck".
        for (const item of runnable) {
          await updateSyncItem(item.id, {
            status: 'failed',
            lastError: message,
            message: tSync(locale, 'syncMsgSettings', { hint }),
            nextAttempt: Date.now() + nextRetryDelayMs(1),
          });
        }
        earliestBackoffMs = nextRetryDelayMs(1);
        break;
      }

      // Freeze target paths once so retries overwrite the same files instead of
      // creating new timestamp/random filenames (which caused duplicate images).
      const uploadPlan = next.payload.uploadPlan ?? buildUploadPlan(next.payload, settings);
      const payload = { ...next.payload, uploadPlan };
      const attempts = (next.attempts || 0) + 1;

      await updateSyncItem(next.id, {
        status: 'uploading',
        attempts,
        payload,
        lastError: null,
        nextAttempt: 0,
        repo: `${settings.github.owner}/${settings.github.repo}`,
        imageCount: Array.isArray(payload.images) ? payload.images.length : 0,
        message: tSync(locale, 'syncMsgConnecting'),
      });

      try {
        await uploadSelectionToGitHub(payload, settings, {
          locale,
          onProgress: async (message) => {
            await updateSyncItem(next.id, { message, status: 'uploading' });
          },
        });
        const { owner, repo, branch } = settings.github;
        const viewPath =
          uploadPlan.mdPath || uploadPlan.jsonPath || uploadPlan.imagePaths?.[0] || null;
        const imageCount = Array.isArray(payload.images) ? payload.images.length : 0;
        await completeSyncItem(next.id, {
          resultUrl: viewPath
            ? buildGithubBlobUrl({ owner, repo, branch, filePath: viewPath })
            : null,
          repo: `${owner}/${repo}`,
          imageCount,
          message: imageCount > 0
            ? tSync(locale, 'syncMsgDone')
            : tSync(locale, 'syncMsgDoneNoImages'),
        });
      } catch (error) {
        const raw = error?.message || String(error);
        console.error('Sync item failed:', next.id, raw);
        const hint = shortError(raw, locale);
        const willRetry = attempts < MAX_SYNC_ATTEMPTS;
        const delayMs = nextRetryDelayMs(attempts);
        await updateSyncItem(next.id, {
          status: 'failed',
          lastError: raw,
          attempts,
          payload,
          nextAttempt: willRetry ? Date.now() + delayMs : Number.MAX_SAFE_INTEGER,
          message: willRetry
            ? tSync(locale, 'syncMsgFailRetry', { hint })
            : tSync(locale, 'syncMsgFailGiveUp', { hint }),
        });
        if (earliestBackoffMs == null || delayMs < earliestBackoffMs) {
          earliestBackoffMs = delayMs;
        }
        // Continue with other pending items — do not stall the whole queue.
      }
    }

    if (earliestBackoffMs != null) {
      await scheduleSyncAlarm(Math.max(earliestBackoffMs / 60_000, 0.1));
    } else {
      const summary = await getSyncSummary();
      if (summary.pending > 0 || summary.failed > 0) {
        await scheduleSyncAlarm(nextRetryDelayMinutes(1));
      }
    }
    await updateSyncBadge();
  } finally {
    syncProcessing = false;
  }
}

/** Keep queue messages short and readable in the popup. */
function shortError(message, locale = DEFAULT_LANGUAGE) {
  const text = String(message || '').trim();
  if (!text) return tSync(locale, 'syncErrUploadFailed');
  if (/Missing GitHub settings/i.test(text)) return tSync(locale, 'syncErrMissingSettings');
  if (/401|Bad credentials|Unauthorized/i.test(text)) return tSync(locale, 'syncErrToken');
  if (/403|rate limit|Abuse/i.test(text)) return tSync(locale, 'syncErrRateLimit');
  if (/404|Not Found/i.test(text)) return tSync(locale, 'syncErrNotFound');
  if (/File conflict \(409\)|409/i.test(text)) return tSync(locale, 'syncErrConflict');
  if (/Failed to fetch|NetworkError|network/i.test(text)) return tSync(locale, 'syncErrNetwork');
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

/** GitHub web URL for a file on the configured branch (doubao-download style). */
function buildGithubBlobUrl({ owner, repo, branch, filePath }) {
  const encodedPath = String(filePath)
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/');
  return `https://github.com/${owner}/${repo}/blob/${encodeURIComponent(branch)}/${encodedPath}`;
}

/**
 * Stable paths for one sync job. Generated once and stored on the queue item so
 * failed / SW-killed retries PUT to the same GitHub paths (no duplicate images).
 */
function buildUploadPlan(payload, settings) {
  const category = payload?.category?.trim();
  if (!category) {
    throw new Error('Invalid payload: category is required');
  }

  const content = payload?.content?.trim() || '';
  const image = payload?.image;
  const images = Array.isArray(payload?.images) ? payload.images.filter(Boolean) : [];
  const imagesToUpload = images.length > 0 ? images : image ? [image] : [];
  if (!content && imagesToUpload.length === 0) {
    throw new Error('Invalid payload: content or image is required');
  }

  const safeCategory = category.replace(/[\\/:*?"<>|]/g, '_');
  const time = new Date().toISOString().replace(/[:.]/g, '-');
  const randomSuffix = Math.random().toString(36).substring(2, 8);
  const base = settings.github.basePath || 'infoflow-data';
  const formats = settings.outputFormats || 'json+md';
  const shouldUploadJson = formats === 'json+md' || formats === 'json';
  const shouldUploadMd = formats === 'json+md' || formats === 'md';

  const imagePaths = imagesToUpload.map(
    (img, index) => `${base}/Images/${safeCategory}/${time}-${randomSuffix}-${index}.${imageExtension(img)}`,
  );

  let jsonPath = null;
  let mdPath = null;
  if (content || imagePaths.length > 0) {
    if (shouldUploadJson) {
      jsonPath = `${base}/${safeCategory}/${time}-${randomSuffix}.json`;
    }
    if (shouldUploadMd) {
      mdPath = `${base}/${safeCategory}/${time}-${randomSuffix}.md`;
    }
  }

  return {
    safeCategory,
    imagePaths,
    jsonPath,
    mdPath,
    // Freeze clock so retries produce identical JSON/MD bytes and can skip PUT.
    savedAt: new Date().toISOString(),
  };
}

async function uploadSelectionToGitHub(payload, settings, { onProgress, locale } = {}) {
  locale = locale || DEFAULT_LANGUAGE;
  const report = async (message) => {
    if (typeof onProgress === 'function') {
      try {
        await onProgress(message);
      } catch {
        // Progress UI updates must never abort the upload itself.
      }
    }
  };

  const content = payload?.content?.trim() || '';
  const category = payload?.category?.trim();
  const url = payload?.url?.trim() || '';
  const notes = payload?.notes?.trim() || '';
  const image = payload?.image;
  const images = Array.isArray(payload?.images) ? payload.images.filter(Boolean) : [];
  const imagesToUpload = images.length > 0 ? images : image ? [image] : [];
  const primaryUploadIndex = Math.min(
    Math.max(payload?.primaryIndex ?? 0, 0),
    Math.max(imagesToUpload.length - 1, 0),
  );

  if (!category) {
    throw new Error('Invalid payload: category is required');
  }
  if (!content && imagesToUpload.length === 0) {
    throw new Error('Invalid payload: content or image is required');
  }

  const resolvedSettings = settings ?? (await assertGithubSettings());
  const plan = payload.uploadPlan ?? buildUploadPlan(payload, resolvedSettings);
  const { safeCategory, imagePaths, jsonPath, mdPath, savedAt } = plan;
  const imagePath = imagePaths[primaryUploadIndex] ?? imagePaths[0] ?? null;
  const recordSavedAt = savedAt || new Date().toISOString();

  // Serial uploads: GitHub Contents API commits against the branch tip; parallel
  // PUTs race and surface as 409 "is at X but expected Y" even for different paths.
  const imageTotal = imagesToUpload.length;
  for (let index = 0; index < imageTotal; index++) {
    await report(tSync(locale, 'syncMsgUploadImage', { current: index + 1, total: imageTotal }));
    const imageArrayBuffer = await resolveImageArrayBuffer(imagesToUpload[index]);
    await uploadToGitHub({
      filePath: imagePaths[index],
      content: imageArrayBuffer,
      settings: resolvedSettings,
      isBinary: true,
    });
  }

  const relativeImagePaths = toRelativeImagePaths(imagePaths, safeCategory);
  const relativeImagePath = relativeImagePaths[primaryUploadIndex] ?? relativeImagePaths[0] ?? null;
  const uploads = [];

  if (content) {
    if (jsonPath) {
      uploads.push({
        filePath: jsonPath,
        content: buildContent('json', {
          category,
          content,
          url,
          notes,
          imagePath: relativeImagePath,
          imagePaths: relativeImagePaths,
          savedAt: recordSavedAt,
        }),
      });
    }
    if (mdPath) {
      uploads.push({
        filePath: mdPath,
        content: buildContent('md', {
          category,
          content,
          url,
          notes,
          imagePath: relativeImagePath,
          imagePaths: relativeImagePaths,
          savedAt: recordSavedAt,
        }),
      });
    }
  } else if (imagePath) {
    if (jsonPath) {
      uploads.push({
        filePath: jsonPath,
        content: buildImageOnlyContent('json', {
          category,
          imagePath: relativeImagePath,
          imagePaths: relativeImagePaths,
          url,
          notes,
          savedAt: recordSavedAt,
        }),
      });
    }
    if (mdPath) {
      uploads.push({
        filePath: mdPath,
        content: buildImageOnlyMarkdown({
          category,
          imagePath: relativeImagePath,
          imagePaths: relativeImagePaths,
          url,
          notes,
          savedAt: recordSavedAt,
        }),
      });
    }
  }

  for (const { filePath, content: fileContent } of uploads) {
    const name = filePath.split('/').pop() || filePath;
    await report(tSync(locale, 'syncMsgUploadFile', { name }));
    await uploadToGitHub({ filePath, content: fileContent, settings: resolvedSettings });
  }

  return { ok: true };
}

function toRelativeImagePaths(imagePaths, safeCategory) {
  return imagePaths.map((fullPath) => {
    const imageFileName = fullPath.split('/').pop();
    return `../Images/${safeCategory}/${imageFileName}`;
  });
}

const IMAGES_PER_MARKDOWN_ROW = 5;

function imageAltFromPath(imagePath) {
  const fileName = String(imagePath).split('/').pop() || String(imagePath);
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

function escapeHtmlAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

/** Primary image first, then the rest of `images` without repeating it. */
function orderImagePaths(imagePath, imagePaths = []) {
  const all = (Array.isArray(imagePaths) && imagePaths.length > 0 ? imagePaths : imagePath ? [imagePath] : [])
    .filter(Boolean);
  if (!imagePath) return all;
  return [imagePath, ...all.filter((path) => path !== imagePath)];
}

function buildImagesTable(imagePath, imagePaths = []) {
  const ordered = orderImagePaths(imagePath, imagePaths);
  if (ordered.length === 0) return '';
  const rows = [];
  for (let index = 0; index < ordered.length; index += IMAGES_PER_MARKDOWN_ROW) {
    const cells = ordered.slice(index, index + IMAGES_PER_MARKDOWN_ROW).map((path) => {
      const href = escapeHtmlAttr(path);
      const alt = escapeHtmlAttr(imageAltFromPath(path));
      return `<td><a href="${href}"><img src="${href}" height="240" alt="${alt}"></a></td>`;
    });
    rows.push(`<tr>\n${cells.join('\n')}\n</tr>`);
  }
  return `<table>\n${rows.join('\n')}\n</table>`;
}

function buildImageOnlyMarkdown({ category, imagePath, imagePaths = [], url, notes, savedAt }) {
  const recordSavedAt = savedAt || new Date().toISOString();
  const gallery = buildImagesTable(imagePath, imagePaths);
  const lines = [];
  if (gallery) {
    lines.push(gallery, '');
  }
  lines.push(
    `# ${category}`,
    '',
    `- **Source URL:** ${url || '-'}`,
    `- **Saved At:** ${recordSavedAt}`,
  );

  if (notes) {
    lines.push('', '---', '', '## Notes', '', notes);
  }

  return lines.join('\n');
}

function buildImageOnlyContent(format, { category, imagePath, imagePaths = [], url, notes, savedAt }) {
  const recordSavedAt = savedAt || new Date().toISOString();
  const allPaths = imagePaths.length > 0 ? imagePaths : imagePath ? [imagePath] : [];
  
  if (format === 'json') {
    const payload = {
      category,
      url: url || '',
      content: '',
      notes: notes || '',
      image: imagePath || allPaths[0] || '',
      images: allPaths,
      savedAt: recordSavedAt,
    };
    return JSON.stringify(payload, null, 2);
  }
  
  return buildImageOnlyMarkdown({
    category,
    imagePath,
    imagePaths: allPaths,
    url,
    notes,
    savedAt: recordSavedAt,
  });
}

/** Contents API conflict / create-race statuses that are safe to refetch-SHA and retry. */
const MAX_UPLOAD_CONFLICT_RETRIES = 5;

async function uploadToGitHub({
  filePath,
  content,
  settings,
  isBinary = false,
  retryCount = 0,
  encodedContent: cachedEncoded = null,
  contentSha: cachedContentSha = null,
}) {
  const { owner, repo, token, branch } = settings.github;
  // URL编码文件路径，确保特殊字符正确处理
  const encodedFilePath = filePath.split('/').map(encodeURIComponent).join('/');
  const endpoint = `https://api.github.com/repos/${owner}/${repo}/contents/${encodedFilePath}`;
  const headers = {
    Authorization: `token ${token}`,
    'User-Agent': 'InfoFlow-Picker',
    'Accept': 'application/vnd.github.v3+json',
  };

  let encodedContent = cachedEncoded;
  let contentSha = cachedContentSha;
  if (!encodedContent || !contentSha) {
    if (isBinary) {
      console.log('Encoding binary content, ArrayBuffer size:', content.byteLength);
      encodedContent = base64EncodeBinary(content);
      console.log('Base64 encoded length:', encodedContent.length);
      if (!encodedContent || encodedContent.length === 0) {
        throw new Error('Failed to encode binary content to base64');
      }
      contentSha = await gitBlobSha(new Uint8Array(content));
    } else {
      encodedContent = base64Encode(content);
      contentSha = await gitBlobSha(new TextEncoder().encode(content));
    }
  }

  // 先尝试获取文件的SHA值（如果文件存在）
  let sha = null;
  try {
    const getResponse = await fetch(`${endpoint}?ref=${encodeURIComponent(branch)}`, {
      method: 'GET',
      headers,
    });
    if (getResponse.ok) {
      const fileData = await getResponse.json();
      // GitHub API可能返回单个文件对象或数组，需要处理
      if (fileData.sha) {
        // Idempotent retry: same path already holds identical bytes — skip PUT.
        if (fileData.sha === contentSha) {
          console.log('Skipping upload; remote blob already matches:', filePath);
          return { ok: true, skipped: true, sha: fileData.sha };
        }
        sha = fileData.sha;
      } else if (Array.isArray(fileData) && fileData.length > 0) {
        // 如果是数组，说明路径是目录，不应该发生
        console.warn('Path is a directory, not a file:', filePath);
      }
    } else if (getResponse.status !== 404) {
      // 404表示文件不存在，这是正常的
      // 其他错误需要记录
      console.warn('Failed to get file SHA:', getResponse.status, await getResponse.text());
    }
  } catch (error) {
    // 如果文件不存在或网络错误，忽略错误，继续创建新文件
    console.log('File does not exist or error getting SHA:', error.message);
  }

  const body = {
    message: `InfoFlow: ${filePath}`,
    content: encodedContent,
    branch,
  };

  // 如果文件已存在，需要提供SHA值
  if (sha) {
    body.sha = sha;
  }

  const response = await fetch(endpoint, {
    method: 'PUT',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    const conflictLike =
      response.status === 409 ||
      (response.status === 422 && /sha|conflict|already exists/i.test(errorText));

    // Refetch SHA and retry: branch-tip races (409) or create-without-sha (422).
    if (conflictLike && retryCount < MAX_UPLOAD_CONFLICT_RETRIES) {
      const delayMs = 400 * 2 ** retryCount + Math.floor(Math.random() * 200);
      console.log(
        `Upload conflict ${response.status} on ${filePath}, retrying (${retryCount + 1}/${MAX_UPLOAD_CONFLICT_RETRIES}) after ${delayMs}ms...`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return uploadToGitHub({
        filePath,
        content,
        settings,
        isBinary,
        retryCount: retryCount + 1,
        encodedContent,
        contentSha,
      });
    }

    let errorMessage = `GitHub upload failed: ${errorText}`;

    if (response.status === 409) {
      try {
        const errorData = JSON.parse(errorText);
        errorMessage = `File conflict (409): ${errorData.message}. Retried ${retryCount} times. Please try again.`;
      } catch {
        // 如果解析失败，使用原始错误信息
      }
    }

    throw new Error(errorMessage);
  }

  return { ok: true };
}

/** Git object id for a blob — matches `sha` returned by Contents API. */
async function gitBlobSha(bytes) {
  const header = new TextEncoder().encode(`blob ${bytes.byteLength}\0`);
  const payload = new Uint8Array(header.byteLength + bytes.byteLength);
  payload.set(header, 0);
  payload.set(bytes, header.byteLength);
  const digest = await crypto.subtle.digest('SHA-1', payload);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function buildContent(format, { category, content, url, notes, imagePath, imagePaths = [], savedAt }) {
  const recordSavedAt = savedAt || new Date().toISOString();
  const allPaths = imagePaths.length > 0 ? imagePaths : imagePath ? [imagePath] : [];
  
  if (format === 'json') {
    const payload = {
      category,
      url: url || '',
      content,
      notes: notes || '',
      image: imagePath || allPaths[0] || '',
      images: allPaths,
      savedAt: recordSavedAt,
    };
    return JSON.stringify(payload, null, 2);
  }
  
  const gallery = buildImagesTable(imagePath, imagePaths);
  const lines = [];
  if (gallery) {
    lines.push(gallery, '');
  }
  lines.push(
    `# ${category}`,
    '',
    `- **Category:** ${category}`,
    `- **Source URL:** ${url || '-'}`,
    `- **Saved At:** ${recordSavedAt}`,
    '',
    '---',
    '',
    '## Content',
    '',
    content,
  );

  if (notes) {
    lines.push('', '## Notes', '', notes);
  }

  return lines.join('\n');
}

function base64Encode(text) {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

function base64EncodeBinary(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

