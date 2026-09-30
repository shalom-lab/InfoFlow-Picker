/** Keep image bytes compact across extension messaging and JSON storage. */
export function buildImagePayloadFromItem(item) {
  if (item.base64) {
    return { base64: item.base64, type: item.type || 'image/png' };
  }
  if (item.arrayBuffer) {
    const bytes = new Uint8Array(item.arrayBuffer);
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return { base64: btoa(binary), type: item.type || 'image/png' };
  }
  return { url: item.url };
}

export async function resolveImageArrayBuffer(image) {
  if (image.base64) {
    const binary = atob(image.base64);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer;
  }
  // Retain compatibility with jobs saved by earlier versions.
  if (image.arrayBuffer) {
    const bytes = new Uint8Array(image.arrayBuffer);
    if (!bytes.byteLength) throw new Error('Image ArrayBuffer is empty');
    return bytes.buffer;
  }
  if (image.url) {
    const response = await fetch(image.url);
    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
    }
    return response.arrayBuffer();
  }
  throw new Error('Invalid image data');
}
