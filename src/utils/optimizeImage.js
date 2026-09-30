/** Preserve dimensions; prefer a quality-90 JPEG only when it saves bytes. */
export async function optimizeImage(blob) {
  const source = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = source;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    if (!canvas.width || !canvas.height) throw new Error('Invalid image dimensions');
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    const jpeg = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    return jpeg?.size && jpeg.size < blob.size ? jpeg : blob;
  } finally {
    URL.revokeObjectURL(source);
  }
}

export function imageExtension(image) {
  return ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
    'image/gif': 'gif', 'image/avif': 'avif', 'image/svg+xml': 'svg',
    'image/bmp': 'bmp', 'image/x-icon': 'ico' })[image.type] || 'png';
}
