import browser from 'webextension-polyfill';
import { getImageGroup } from './imageGroup.js';

if (!globalThis.__infoflowPickerContentInit) {
  globalThis.__infoflowPickerContentInit = true;

  browser.runtime.onMessage.addListener(async (message) => {
    if (message?.type === 'PING') {
      return { ok: true };
    }
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
}

function getSelectedText() {
  const selection = window.getSelection();
  return selection ? selection.toString().trim() : '';
}

async function getImageData(imageUrl) {
  const img = Array.from(document.images).find(
    (candidate) =>
      candidate.src === imageUrl ||
      candidate.currentSrc === imageUrl ||
      candidate.srcset?.includes(imageUrl),
  );

  if (img && img.complete && img.naturalWidth > 0) {
    return getImageDataFromElement(img);
  }

  return loadImageFromUrl(imageUrl);
}

async function getImageDataFromElement(img) {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');

  try {
    ctx.drawImage(img, 0, 0);
  } catch {
    const corsError = new Error('CORS error: Cannot export tainted canvas');
    corsError.isCorsError = true;
    throw corsError;
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Image conversion timeout'));
    }, 5000);

    canvas.toBlob((blob) => {
      clearTimeout(timeout);
      if (!blob) {
        reject(new Error('Failed to convert image to blob (possibly CORS issue)'));
        return;
      }

      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result;
        const matches = base64.match(/^data:([^;]+);base64,(.+)$/);
        if (matches) {
          resolve({
            base64: matches[2],
            type: matches[1],
            width: img.naturalWidth,
            height: img.naturalHeight,
          });
          return;
        }
        reject(new Error('Failed to parse base64 data'));
      };
      reader.onerror = () => reject(new Error('Failed to read blob'));
      reader.readAsDataURL(blob);
    }, 'image/png');
  });
}

async function loadImageFromUrl(url) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Image load timeout'));
    }, 10000);

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      clearTimeout(timeout);
      getImageDataFromElement(img).then(resolve).catch(reject);
    };
    img.onerror = () => {
      clearTimeout(timeout);
      reject(new Error('Failed to load image (CORS or network issue)'));
    };
    img.src = url;
  });
}
