import browser from 'webextension-polyfill';
import { getSettings } from '../utils/storage.js';
import { PENDING_CAPTURE_KEY } from '../utils/draft.js';
import { sendToContentScript } from '../utils/injectContent.js';

const CONTEXT_MENU_ID = 'infoflow-extract';

browser.runtime.onInstalled.addListener(() => {
  setupContextMenu();
});

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

browser.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === 'SAVE_SELECTION') {
    return handleSaveSelection(message.payload);
  }
  return undefined;
});

async function handleSaveSelection(payload) {
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

  const safeCategory = category.replace(/[\\/:*?"<>|]/g, '_');
  const time = new Date().toISOString().replace(/[:.]/g, '-');
  const base = settings.github.basePath || 'infoflow-data';
  
  let imagePath = null;
  let imagePaths = [];
  
  // 处理图片上传 - 统一使用PNG扩展名
  if (imagesToUpload.length > 0) {
    const extension = 'png';
    const randomSuffix = Math.random().toString(36).substring(2, 8);

    imagePaths = await Promise.all(
      imagesToUpload.map(async (img, index) => {
        const imageArrayBuffer = await resolveImageArrayBuffer(img);
        const filePath = `${base}/Images/${safeCategory}/${time}-${randomSuffix}-${index}.${extension}`;
        await uploadToGitHub({
          filePath,
          content: imageArrayBuffer,
          settings,
          isBinary: true,
        });
        return filePath;
      }),
    );

    imagePath = imagePaths[primaryUploadIndex] ?? imagePaths[0] ?? null;
  }
  
  // 根据配置的格式上传文件
  const formats = settings.outputFormats || 'json+md';
  const shouldUploadJson = formats === 'json+md' || formats === 'json';
  const shouldUploadMd = formats === 'json+md' || formats === 'md';
  
  if (content) {
    // 有内容时，根据格式上传json和/或md
    const uploads = [];
    
    const relativeImagePaths = toRelativeImagePaths(imagePaths, safeCategory);
    const relativeImagePath = relativeImagePaths[primaryUploadIndex] ?? relativeImagePaths[0] ?? null;
    
    if (shouldUploadJson) {
      const jsonPath = buildFilePath(settings, category, 'json');
      const jsonContent = buildContent('json', {
        category,
        content,
        url,
        notes,
        imagePath: relativeImagePath,
        imagePaths: relativeImagePaths,
      });
      uploads.push({ filePath: jsonPath, content: jsonContent });
    }
    
    if (shouldUploadMd) {
      const mdPath = buildFilePath(settings, category, 'md');
      const mdContent = buildContent('md', {
        category,
        content,
        url,
        notes,
        imagePath: relativeImagePath,
        imagePaths: relativeImagePaths,
      });
      uploads.push({ filePath: mdPath, content: mdContent });
    }
    
    // 并行上传所有文件
    await Promise.all(
      uploads.map(({ filePath, content }) =>
        uploadToGitHub({ filePath, content, settings }),
      ),
    );
  } else if (imagePath) {
    const relativeImagePaths = toRelativeImagePaths(imagePaths, safeCategory);
    const relativeImagePath = relativeImagePaths[primaryUploadIndex] ?? relativeImagePaths[0] ?? null;
    const uploads = [];
    const randomSuffix = Math.random().toString(36).substring(2, 8);
    
    if (shouldUploadJson) {
      const jsonPath = `${base}/${safeCategory}/${time}-${randomSuffix}.json`;
      const jsonContent = buildImageOnlyContent('json', {
        category,
        imagePath: relativeImagePath,
        imagePaths: relativeImagePaths,
        url,
        notes,
      });
      uploads.push({ filePath: jsonPath, content: jsonContent });
    }
    
    if (shouldUploadMd) {
      const mdPath = `${base}/${safeCategory}/${time}-${randomSuffix}.md`;
      const mdContent = buildImageOnlyMarkdown({
        category,
        imagePath: relativeImagePath,
        imagePaths: relativeImagePaths,
        url,
        notes,
      });
      uploads.push({ filePath: mdPath, content: mdContent });
    }
    
    // 并行上传所有文件
    await Promise.all(
      uploads.map(({ filePath, content }) =>
        uploadToGitHub({ filePath, content, settings }),
      ),
    );
  }

  return { ok: true };
}

function toRelativeImagePaths(imagePaths, safeCategory) {
  return imagePaths.map((fullPath) => {
    const imageFileName = fullPath.split('/').pop();
    return `../Images/${safeCategory}/${imageFileName}`;
  });
}

async function resolveImageArrayBuffer(image) {
  if (image.url) {
    console.log('Downloading image from URL:', image.url);
    const imageResponse = await fetch(image.url);
    if (!imageResponse.ok) {
      throw new Error(`Failed to download image: ${imageResponse.status} ${imageResponse.statusText}`);
    }
    const imageArrayBuffer = await imageResponse.arrayBuffer();
    console.log('Downloaded image size:', imageArrayBuffer.byteLength);
    return imageArrayBuffer;
  }

  if (image.arrayBuffer) {
    if (Array.isArray(image.arrayBuffer)) {
      const uint8Array = new Uint8Array(image.arrayBuffer);
      const imageArrayBuffer = uint8Array.buffer;
      if (imageArrayBuffer.byteLength === 0) {
        throw new Error('Image ArrayBuffer is empty after conversion');
      }
      return imageArrayBuffer;
    }
    if (image.arrayBuffer.byteLength === 0) {
      throw new Error('Image ArrayBuffer is empty');
    }
    return image.arrayBuffer;
  }

  throw new Error('Invalid image data');
}

function buildImageOnlyMarkdown({ category, imagePath, imagePaths = [], url, notes }) {
  const savedAt = new Date().toISOString();
  const allPaths = imagePaths.length > 0 ? imagePaths : imagePath ? [imagePath] : [];
  const lines = [
    `# ${category}`,
    '',
    `- **Source URL:** ${url || '-'}`,
    `- **Image:** ![](${imagePath || allPaths[0] || ''})`,
    `- **Saved At:** ${savedAt}`,
  ];

  if (allPaths.length > 1) {
    lines.push('', '## Images', '');
    allPaths.forEach((p) => lines.push(`![](${p})`, ''));
  }
  
  if (notes) {
    lines.push('', '---', '', '## Notes', '', notes);
  }
  
  return lines.join('\n');
}

function buildImageOnlyContent(format, { category, imagePath, imagePaths = [], url, notes }) {
  const savedAt = new Date().toISOString();
  const allPaths = imagePaths.length > 0 ? imagePaths : imagePath ? [imagePath] : [];
  
  if (format === 'json') {
    const payload = {
      category,
      url: url || '',
      content: '',
      notes: notes || '',
      image: imagePath || allPaths[0] || '',
      images: allPaths,
      savedAt,
    };
    return JSON.stringify(payload, null, 2);
  }
  
  return buildImageOnlyMarkdown({ category, imagePath, imagePaths: allPaths, url, notes });
}

function buildFilePath(settings, category, format) {
  const safeCategory = category.replace(/[\\/:*?"<>|]/g, '_');
  const time = new Date().toISOString().replace(/[:.]/g, '-');
  // 添加随机后缀确保文件名唯一，避免并发冲突
  const randomSuffix = Math.random().toString(36).substring(2, 8);
  const base = settings.github.basePath || 'infoflow-data';
  const extension = getExtensionForFormat(format);
  return `${base}/${safeCategory}/${time}-${randomSuffix}.${extension}`;
}

function getExtensionForFormat(format) {
  if (format === 'json') return 'json';
  if (format === 'csv') return 'csv';
  return 'md';
}

async function uploadToGitHub({ filePath, content, settings, isBinary = false, retryCount = 0 }) {
  const { owner, repo, token, branch } = settings.github;
  // URL编码文件路径，确保特殊字符正确处理
  const encodedFilePath = filePath.split('/').map(encodeURIComponent).join('/');
  const endpoint = `https://api.github.com/repos/${owner}/${repo}/contents/${encodedFilePath}`;
  
  let encodedContent;
  if (isBinary) {
    // 对于二进制文件（图片），直接编码ArrayBuffer
    console.log('Encoding binary content, ArrayBuffer size:', content.byteLength);
    encodedContent = base64EncodeBinary(content);
    console.log('Base64 encoded length:', encodedContent.length);
    if (!encodedContent || encodedContent.length === 0) {
      throw new Error('Failed to encode binary content to base64');
    }
  } else {
    // 对于文本文件
    encodedContent = base64Encode(content);
  }
  
  // 先尝试获取文件的SHA值（如果文件存在）
  let sha = null;
  try {
    const getResponse = await fetch(`${endpoint}?ref=${encodeURIComponent(branch)}`, {
      method: 'GET',
      headers: {
        Authorization: `token ${token}`,
        'User-Agent': 'InfoFlow-Picker',
        'Accept': 'application/vnd.github.v3+json',
      },
    });
    if (getResponse.ok) {
      const fileData = await getResponse.json();
      // GitHub API可能返回单个文件对象或数组，需要处理
      if (fileData.sha) {
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
      Authorization: `token ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'InfoFlow-Picker',
      'Accept': 'application/vnd.github.v3+json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    
    // 如果是409错误，尝试重新获取SHA并重试（最多重试2次）
    if (response.status === 409 && retryCount < 2) {
      console.log(`409 conflict detected, retrying (attempt ${retryCount + 1}/2)...`);
      // 等待一小段时间后重试，并重新获取SHA
      await new Promise(resolve => setTimeout(resolve, 500 + retryCount * 200)); // 递增延迟
      // 递归重试，会重新获取SHA
      return uploadToGitHub({ filePath, content, settings, isBinary, retryCount: retryCount + 1 });
    }
    
    let errorMessage = `GitHub upload failed: ${errorText}`;
    
    // 如果是409错误，提供更详细的提示
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
}

function buildContent(format, { category, content, url, notes, imagePath, imagePaths = [] }) {
  const savedAt = new Date().toISOString();
  const allPaths = imagePaths.length > 0 ? imagePaths : imagePath ? [imagePath] : [];
  
  if (format === 'json') {
    const payload = {
      category,
      url: url || '',
      content,
      notes: notes || '',
      image: imagePath || allPaths[0] || '',
      images: allPaths,
      savedAt,
    };
    return JSON.stringify(payload, null, 2);
  }
  
  const metaLines = [
    `- **Category:** ${category}`,
    `- **Source URL:** ${url || '-'}`,
    `- **Saved At:** ${savedAt}`,
  ];
  
  if (imagePath || allPaths[0]) {
    metaLines.splice(2, 0, `- **Image:** ![](${imagePath || allPaths[0]})`);
  }
  
  const lines = [
    `# ${category}`,
    '',
    ...metaLines,
    '',
    '---',
    '',
    '## Content',
    '',
    content,
  ];

  if (allPaths.length > 1) {
    lines.push('', '## Images', '');
    allPaths.forEach((p) => lines.push(`![](${p})`, ''));
  }
  
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

