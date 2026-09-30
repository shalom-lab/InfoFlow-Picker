// Real Canvas + IndexedDB integration checks; no GitHub requests are made.
// Set PLAYWRIGHT_MODULE to an installed playwright module path when not local.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const result = await build({
  stdin: { contents: `
    import * as payload from './src/utils/imagePayload.js';
    import * as images from './src/utils/syncImages.js';
    import * as optimize from './src/utils/optimizeImage.js';
    import { clearDraftImages } from './src/utils/draftImages.js';
    window.imageTest = { ...payload, ...images, ...optimize, clearDraftImages };
  `, resolveDir: process.cwd() },
  bundle: true, write: false, format: 'iife', platform: 'browser',
});
const server = createServer((req, res) => {
  if (req.url === '/test.js') {
    res.setHeader('Content-Type', 'text/javascript');
    res.end(result.outputFiles[0].text);
  } else res.end('<script src="/test.js"></script>');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  const context = await browser.newContext();
  let page = await context.newPage();
  const url = `http://127.0.0.1:${server.address().port}`;
  await page.goto(url);
  const compressed = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1024;
    const ctx = canvas.getContext('2d');
    const pixels = ctx.createImageData(1024, 1024);
    let seed = 42;
    for (let i = 0; i < pixels.data.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
        pixels.data[i + c] = seed >>> 24;
      }
      pixels.data[i + 3] = 255;
    }
    ctx.putImageData(pixels, 0, 0);
    const png = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const optimized = await imageTest.optimizeImage(png);
    const pngBytes = await png.arrayBuffer();
    const items = [
      { arrayBuffer: pngBytes, type: 'image/png', localImage: true },
      { arrayBuffer: pngBytes, type: 'image/png', localImage: true },
      { arrayBuffer: pngBytes, type: 'image/png' },
    ];
    const automatic = await imageTest.persistImagesForSave(items);
    const originals = await imageTest.persistImagesForSave(items, undefined, { skipCompression: true });
    const originalBlobs = await Promise.all(originals.map(ref => imageTest.getSyncImage(ref.storageId)));
    const originalBytesMatch = (await Promise.all(originalBlobs.map(async blob => {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      return bytes.every((byte, i) => byte === new Uint8Array(pngBytes)[i]);
    }))).every(Boolean);
    await imageTest.deleteSyncImages([...automatic, ...originals]);
    const bitmap = await createImageBitmap(optimized);
    const stored = await imageTest.putSyncImage(optimized);
    localStorage.setItem('jpegRef', stored);
    const tiny = new Blob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII='), c => c.charCodeAt(0))], { type: 'image/png' });
    const kept = await imageTest.optimizeImage(tiny);
    return { before: png.size, after: optimized.size, type: optimized.type,
      width: bitmap.width, height: bitmap.height, tinyRetained: kept === tiny,
      automaticTypes: automatic.map(ref => ref.type), originalTypes: originals.map(ref => ref.type), originalBytesMatch };
  });
  assert.equal(compressed.type, 'image/jpeg');
  assert.ok(compressed.after < compressed.before);
  assert.equal(compressed.width, 1024);
  assert.equal(compressed.height, 1024);
  assert.equal(compressed.tinyRetained, true);
  assert.deepEqual(compressed.automaticTypes, ['image/jpeg', 'image/jpeg', 'image/png']);
  assert.deepEqual(compressed.originalTypes, ['image/png', 'image/png', 'image/png']);
  assert.equal(compressed.originalBytesMatch, true);
  console.log('Canvas compression:', compressed);
  const saved = await page.evaluate(async () => {
    // This exceeds the runtime message limit if encoded inline as Base64.
    const bytes = new Uint8Array(50 * 1024 * 1024);
    bytes[0] = 137;
    bytes[bytes.length - 1] = 255;
    const refs = await imageTest.persistImagesForSave([{ arrayBuffer: bytes.buffer, type: 'image/png' }]);
    localStorage.setItem('refs', JSON.stringify(refs));
    await imageTest.clearDraftImages();
    return { messageBytes: JSON.stringify({ type: 'SAVE_SELECTION', payload: { images: refs } }).length };
  });
  assert.ok(saved.messageBytes < 256);
  await page.close();
  page = await context.newPage();
  await page.goto(url);
  const restored = await page.evaluate(async () => {
    const refs = JSON.parse(localStorage.getItem('refs'));
    const bytes = new Uint8Array(await imageTest.resolveImageArrayBuffer(refs[0]));
    const jpeg = await imageTest.getSyncImage(localStorage.getItem('jpegRef'));
    await imageTest.deleteSyncImages(refs);
    let deleted = false;
    try { await imageTest.getSyncImage(refs[0].storageId); } catch { deleted = true; }
    return { size: bytes.length, first: bytes[0], last: bytes[bytes.length - 1], jpegType: jpeg.type, deleted };
  });
  assert.deepEqual(restored, { size: 50 * 1024 * 1024, first: 137, last: 255, jpegType: 'image/jpeg', deleted: true });
  console.log('50 MiB survives page close and draft cleanup; reference message:', saved.messageBytes, 'bytes. Cleanup passed.');
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
