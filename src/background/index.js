import browser from 'webextension-polyfill';
import { getSettings } from '../utils/storage.js';

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
    // 尝试从页面直接获取图片数据
    if (tab?.id) {
      try {
        const imageData = await browser.tabs.sendMessage(tab.id, {
          type: 'GET_IMAGE_DATA',
          imageUrl: info.srcUrl,
        });
        
        if (imageData?.base64) {
          // 成功获取图片数据，存储base64数据
          await browser.storage.local.set({
            pendingImageData: imageData,
            pendingImageUrl: info.srcUrl, // 保留URL用于预览
            pendingUrl: tab.url ?? '',
          });
          await browser.action.openPopup?.().catch(() => {});
          return;
        }
      } catch (error) {
        // 如果获取失败（可能是content script未注入或跨域问题），回退到URL方式
        console.log('Failed to get image data from page, using URL fallback:', error);
      }
    }
    
    // 回退到URL方式
    await browser.storage.local.set({
      pendingImageUrl: info.srcUrl,
      pendingUrl: tab.url ?? '',
    });
    await browser.action.openPopup?.().catch(() => {});
    return;
  }
  
  // 处理文本选择
  const selection = info.selectionText?.trim();
  if (!selection || !tab?.id) return;
  await browser.storage.local.set({
    pendingSelection: selection,
    pendingUrl: tab.url ?? '',
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
  
  if (!category) {
    throw new Error('Invalid payload: category is required');
  }
  
  if (!content && !image) {
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
  
  // 处理图片上传 - 统一使用PNG扩展名
  if (image) {
    let imageArrayBuffer;
    // 统一使用PNG扩展名（实际内容可能是其他格式，但扩展名统一为png）
    const extension = 'png';
    
    if (image.url) {
      // 从URL直接下载图片（background script 的 fetch 不受 Canvas CORS 限制）
      // 注意：这里下载的是原始格式，但我们会直接保存原始格式
      // 如果需要在保存前转换为PNG，应该在 popup 或 content script 中完成
      // 但为了性能，我们直接保存原始格式，用户可以在需要时手动转换
      console.log('Downloading image from URL:', image.url);
      const imageResponse = await fetch(image.url);
      if (!imageResponse.ok) {
        throw new Error(`Failed to download image: ${imageResponse.status} ${imageResponse.statusText}`);
      }
      imageArrayBuffer = await imageResponse.arrayBuffer();
      console.log('Downloaded image size:', imageArrayBuffer.byteLength);
      
      // 尝试从 Content-Type 获取文件扩展名，如果没有则使用原始URL的扩展名
      const contentType = imageResponse.headers.get('content-type');
      if (contentType && contentType.startsWith('image/')) {
        // 保持原始格式，不强制转换为PNG（性能考虑）
        const mimeType = contentType.split(';')[0].trim();
        const formatMap = {
          'image/jpeg': 'jpg',
          'image/jpg': 'jpg',
          'image/png': 'png',
          'image/gif': 'gif',
          'image/webp': 'webp',
        };
        const detectedExt = formatMap[mimeType.toLowerCase()] || 'png';
        if (detectedExt !== 'png') {
          console.log(`Image is ${detectedExt} format, but will be saved as PNG`);
        }
      }
    } else if (image.arrayBuffer) {
      // 使用提供的ArrayBuffer（可能是数组格式，需要转换回ArrayBuffer）
      if (Array.isArray(image.arrayBuffer)) {
        // 如果是数组，转换回Uint8Array然后获取ArrayBuffer
        const uint8Array = new Uint8Array(image.arrayBuffer);
        imageArrayBuffer = uint8Array.buffer;
        // 调试：检查ArrayBuffer大小
        console.log('Image ArrayBuffer size:', imageArrayBuffer.byteLength, 'from array length:', image.arrayBuffer.length);
        if (imageArrayBuffer.byteLength === 0) {
          throw new Error('Image ArrayBuffer is empty after conversion');
        }
      } else {
        // 如果已经是ArrayBuffer（理论上不应该发生，但为了兼容性保留）
        imageArrayBuffer = image.arrayBuffer;
        console.log('Image ArrayBuffer size (direct):', imageArrayBuffer.byteLength);
        if (imageArrayBuffer.byteLength === 0) {
          throw new Error('Image ArrayBuffer is empty');
        }
      }
    } else {
      throw new Error('Invalid image data');
    }
    
    // 上传图片到Images/分类/目录，统一使用PNG扩展名
    // 添加随机后缀确保文件名唯一，避免并发冲突
    const randomSuffix = Math.random().toString(36).substring(2, 8);
    imagePath = `${base}/Images/${safeCategory}/${time}-${randomSuffix}.${extension}`;
    await uploadToGitHub({
      filePath: imagePath,
      content: imageArrayBuffer,
      settings,
      isBinary: true,
    });
  }
  
  // 根据配置的格式上传文件
  const formats = settings.outputFormats || 'json+md';
  const shouldUploadJson = formats === 'json+md' || formats === 'json';
  const shouldUploadMd = formats === 'json+md' || formats === 'md';
  
  if (content) {
    // 有内容时，根据格式上传json和/或md
    const uploads = [];
    
    // 计算图片相对路径（从数据文件到图片）
    let relativeImagePath = null;
    if (imagePath) {
      const imageFileName = imagePath.split('/').pop();
      relativeImagePath = `../Images/${safeCategory}/${imageFileName}`;
    }
    
    if (shouldUploadJson) {
      const jsonPath = buildFilePath(settings, category, 'json');
      const jsonContent = buildContent('json', {
        category,
        content,
        url,
        notes,
        imagePath: relativeImagePath,
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
    // 如果只有图片没有内容，根据格式上传文件
    const imageFileName = imagePath.split('/').pop();
    const relativeImagePath = `../Images/${safeCategory}/${imageFileName}`;
    const uploads = [];
    
    // 使用相同的随机后缀，确保json和md文件名一致（除了扩展名）
    const randomSuffix = Math.random().toString(36).substring(2, 8);
    
    if (shouldUploadJson) {
      const jsonPath = `${base}/${safeCategory}/${time}-${randomSuffix}.json`;
      const jsonContent = buildImageOnlyContent('json', {
        category,
        imagePath: relativeImagePath,
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

function buildImageOnlyMarkdown({ category, imagePath, url, notes }) {
  const savedAt = new Date().toISOString();
  const lines = [
    `# ${category}`,
    '',
    `- **Source URL:** ${url || '-'}`,
    `- **Image:** ![](${imagePath})`,
    `- **Saved At:** ${savedAt}`,
  ];
  
  if (notes) {
    lines.push('', '---', '', '## Notes', '', notes);
  }
  
  return lines.join('\n');
}

function buildImageOnlyContent(format, { category, imagePath, url, notes }) {
  const savedAt = new Date().toISOString();
  
  if (format === 'json') {
    const payload = {
      category,
      url: url || '',
      content: '',
      notes: notes || '',
      image: imagePath || '',
      savedAt,
    };
    return JSON.stringify(payload, null, 2);
  }
  
  // 默认返回markdown（虽然这个函数主要用于json）
  return buildImageOnlyMarkdown({ category, imagePath, url, notes });
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

function buildContent(format, { category, content, url, notes, imagePath }) {
  const savedAt = new Date().toISOString();
  
  if (format === 'json') {
    const payload = {
      category,
      url: url || '',
      content,
      notes: notes || '',
      image: imagePath || '',
      savedAt,
    };
    return JSON.stringify(payload, null, 2);
  }
  
  // default: markdown – human readable with structured metadata
  const metaLines = [
    `- **Category:** ${category}`,
    `- **Source URL:** ${url || '-'}`,
    `- **Saved At:** ${savedAt}`,
  ];
  
  if (imagePath) {
    // imagePath应该是相对路径（已经在调用时计算好了）
    metaLines.splice(2, 0, `- **Image:** ![](${imagePath})`);
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

