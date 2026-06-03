import browser from 'webextension-polyfill';
import { getImageGroup } from './imageGroup.js';

browser.runtime.onMessage.addListener(async (message) => {
  if (message?.type === 'GET_SELECTION') {
    return { text: getSelectedText() };
  }
  if (message?.type === 'GET_IMAGE_GROUP' && message?.imageUrl) {
    return getImageGroup(message.imageUrl);
  }
  if (message?.type === 'GET_IMAGE_DATA' && message?.imageUrl) {
    return await getImageData(message.imageUrl);
  }
  return undefined;
});

function getSelectedText() {
  const selection = window.getSelection();
  return selection ? selection.toString().trim() : '';
}

async function getImageData(imageUrl) {
  try {
    // 在页面上查找对应的img元素
    const img = Array.from(document.images).find(
      (img) => img.src === imageUrl || img.currentSrc === imageUrl || img.srcset?.includes(imageUrl)
    );
    
    if (img && img.complete && img.naturalWidth > 0) {
      // 如果图片已经加载，直接从canvas获取数据
      return await getImageDataFromElement(img);
    }
    
    // 如果找不到或未加载，创建一个新的img元素来加载
    return await loadImageFromUrl(imageUrl);
  } catch (error) {
    console.error('Failed to get image data:', error);
    return null;
  }
}

async function getImageDataFromElement(img) {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    
    // 获取图片的blob数据，然后转换为base64
    return new Promise((resolve, reject) => {
      // 添加超时机制（5秒）
      const timeout = setTimeout(() => {
        const error = new Error('Image conversion timeout');
        error.isTimeout = true;
        reject(error);
      }, 5000);
      
      canvas.toBlob((blob) => {
        clearTimeout(timeout);
        if (!blob) {
          // 检查是否是 CORS 问题
          const error = new Error('Failed to convert image to blob (possibly CORS issue)');
          error.isCorsError = true;
          reject(error);
          return;
        }
        // 转换为base64字符串以便传递
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = reader.result;
          // 提取MIME类型和base64数据
          const matches = base64.match(/^data:([^;]+);base64,(.+)$/);
          if (matches) {
            resolve({
              base64: matches[2],
              type: matches[1],
              width: img.naturalWidth,
              height: img.naturalHeight,
            });
          } else {
            reject(new Error('Failed to parse base64 data'));
          }
        };
        reader.onerror = () => reject(new Error('Failed to read blob'));
        reader.readAsDataURL(blob);
      }, 'image/png'); // 统一转换为PNG格式
    });
  } catch (error) {
    // 捕获 CORS 错误
    if (error.message.includes('Tainted') || error.message.includes('CORS') || error.isCorsError) {
      const corsError = new Error('CORS error: Cannot export tainted canvas');
      corsError.isCorsError = true;
      throw corsError;
    }
    throw new Error(`Failed to get image data from element: ${error.message}`);
  }
}

async function loadImageFromUrl(url) {
  return new Promise((resolve, reject) => {
    // 添加超时机制（10秒）
    const timeout = setTimeout(() => {
      const error = new Error('Image load timeout');
      error.isTimeout = true;
      reject(error);
    }, 10000);
    
    const img = new Image();
    img.crossOrigin = 'anonymous'; // 处理跨域
    img.onload = async () => {
      clearTimeout(timeout);
      try {
        const data = await getImageDataFromElement(img);
        resolve(data);
      } catch (error) {
        reject(error);
      }
    };
    img.onerror = () => {
      clearTimeout(timeout);
      const error = new Error('Failed to load image (CORS or network issue)');
      error.isCorsError = true;
      reject(error);
    };
    img.src = url;
  });
}
