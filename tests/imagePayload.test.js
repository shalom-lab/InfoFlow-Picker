import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { buildImagePayloadFromItem, resolveImageArrayBuffer, persistImagesForSave } from '../src/utils/imagePayload.js';
import { imageExtension } from '../src/utils/optimizeImage.js';

// Exercise the actual background normalization without starting extension listeners.
const background = readFileSync(new URL('../src/background/index.js', import.meta.url), 'utf8');
const normalize = vm.runInNewContext(`(${background.slice(
  background.indexOf('function normalizeSavePayload('),
  background.indexOf('async function assertGithubSettings('),
)})`);

test('a 2 MiB local image survives messaging, queue storage and upload decoding', async () => {
  const bytes = new Uint8Array(2 * 1024 * 1024);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
  const image = buildImagePayloadFromItem({ arrayBuffer: bytes.buffer, type: 'image/png' });
  const incoming = JSON.parse(JSON.stringify({ category: 'Insight', images: [image], primaryIndex: 0 }));
  const queueJson = JSON.stringify(normalize(incoming));
  const restored = JSON.parse(queueJson);
  assert.equal(restored.image, null);
  assert.ok(queueJson.length < 3 * 1024 * 1024);
  assert.deepEqual(new Uint8Array(await resolveImageArrayBuffer(restored.images[0])), bytes);
  const oldImage = { arrayBuffer: Array.from(bytes), type: 'image/png' };
  assert.ok(JSON.stringify({ image: oldImage, images: [oldImage] }).length > 10 * 1024 * 1024);
});

test('pasted base64 and multiple images retain bytes and the chosen primary index', async () => {
  const images = ['AAEC/w==', 'iVBORw0KGgo='].map((base64) =>
    buildImagePayloadFromItem({ base64, url: 'data:image/png;base64,' + base64 }),
  );
  const payload = JSON.parse(JSON.stringify(normalize({ category: 'Insight', images, primaryIndex: 1 })));
  assert.equal(payload.primaryIndex, 1);
  assert.equal(payload.images.length, 2);
  for (let i = 0; i < images.length; i++) {
    assert.deepEqual(Buffer.from(await resolveImageArrayBuffer(payload.images[i])), Buffer.from(images[i].base64, 'base64'));
  }
});

test('legacy queued numeric arrays remain uploadable', async () => {
  assert.deepEqual(new Uint8Array(await resolveImageArrayBuffer({ arrayBuffer: [0, 128, 255] })), new Uint8Array([0, 128, 255]));
  const payload = normalize({ category: 'Insight', image: { arrayBuffer: [1, 2] } });
  assert.equal(payload.images.length, 1);
  await assert.rejects(resolveImageArrayBuffer({ arrayBuffer: [] }), /empty/);
});

test('page image URLs still download unchanged', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url) => {
    assert.equal(url, 'https://example.com/image.png');
    return new Response(new Uint8Array([137, 80, 78, 71]));
  });
  const image = buildImagePayloadFromItem({ url: 'https://example.com/image.png' });
  assert.deepEqual(new Uint8Array(await resolveImageArrayBuffer(image)), new Uint8Array([137, 80, 78, 71]));
});

const popup = readFileSync(new URL('../src/popup/index.js', import.meta.url), 'utf8');
const pickerSource = popup.slice(popup.indexOf('function getImagesPayloadForSave('), popup.indexOf('function handleImageSelect('));
const previewSource = popup.slice(popup.indexOf('async function imagePayloadToPreviewSrc('), popup.indexOf('async function loadSourceUrl('));

test('mixed local, pasted and extracted images preserve selection, primary image and queue previews', async () => {
  const context = vm.createContext({
    buildImagePayloadFromItem,
    Uint8Array,
    uint8ToBase64: (bytes) => Buffer.from(bytes).toString('base64'),
    imageGroupState: {
      images: [
        { base64: 'AAEC', type: 'image/png' }, // Local file after PNG conversion.
        { base64: 'AwQF', type: 'image/png' }, // Clipboard after PNG conversion.
        { base64: 'BgcI', url: 'https://example.com/captured.png', type: 'image/png' },
        { url: 'https://example.com/remote.png' }, // Page URL fallback.
      ],
      selected: new Set([3, 1, 2, 0]),
      clickedIndex: 2,
    },
  });
  vm.runInContext(pickerSource + previewSource, context);
  const selected = context.getImagesPayloadForSave();
  const queued = JSON.parse(JSON.stringify(normalize({ category: 'Insight', ...selected })));
  assert.equal(queued.primaryIndex, 2);
  assert.deepEqual(queued.images.map((image) => image.base64 || image.url), [
    'AAEC', 'AwQF', 'BgcI', 'https://example.com/remote.png',
  ]);
  assert.deepEqual(Array.from(await context.getQueueItemImageSources(queued)), [
    'data:image/png;base64,AAEC', 'data:image/png;base64,AwQF',
    'data:image/png;base64,BgcI', 'https://example.com/remote.png',
  ]);
  context.imageGroupState.selected = new Set([3, 1]);
  const subset = context.getImagesPayloadForSave();
  assert.equal(subset.primaryIndex, 0); // Unselected primary falls back to the first selected image.
  assert.equal(subset.images.length, 2);
  assert.equal(subset.images[0].base64, 'AwQF');
});

test('large images are stored before messaging and failures prevent sending references', async () => {
  const blobs = [];
  const refs = await persistImagesForSave([
    { base64: 'AAAA'.repeat(6 * 1024 * 1024), type: 'image/png' },
    { url: 'https://example.com/image.png' },
  ], async (blob) => { blobs.push(blob); return 'saved-image'; });
  assert.equal(blobs[0].size, 18 * 1024 * 1024);
  assert.ok(JSON.stringify({ type: 'SAVE_SELECTION', payload: { images: refs } }).length < 256);
  assert.deepEqual(refs, [{ storageId: 'saved-image', type: 'image/png' }, { url: 'https://example.com/image.png' }]);
  await assert.rejects(persistImagesForSave([{ base64: 'AAEC' }], async () => {
    throw new Error('Disk full');
  }), /Disk full/);
});

test('single-image popup fallback supports captured, local and legacy image representations', () => {
  for (const currentImageFile of [
    { base64: 'AAEC', type: 'image/png' },
    { arrayBuffer: [0, 1, 2], type: 'image/png' },
    { arrayBuffer: new Uint8Array([0, 1, 2]).buffer, type: 'image/png' },
    'https://example.com/image.png',
  ]) {
    const context = vm.createContext({ buildImagePayloadFromItem, Uint8Array, currentImageFile, imageGroupState: null });
    vm.runInContext(pickerSource, context);
    const payload = context.getImagesPayloadForSave();
    assert.equal(payload.images.length, 1);
    assert.equal(payload.primaryIndex, 0);
    assert.equal(payload.images[0].base64 || payload.images[0].url,
      typeof currentImageFile === 'string' ? currentImageFile : 'AAEC');
  }
});

test('mixed images reach the GitHub upload boundary and metadata references the chosen primary', async () => {
  const uploads = [];
  const settings = { github: { basePath: 'infoflow-data' }, outputFormats: 'json+md' };
  const context = vm.createContext({
    resolveImageArrayBuffer,
    imageExtension,
    uploadToGitHub: async (upload) => uploads.push(upload),
  });
  vm.runInContext(background.slice(background.indexOf('function buildUploadPlan('), background.indexOf('async function uploadToGitHub(')), context);
  vm.runInContext(background.slice(background.indexOf('function buildContent('), background.indexOf('function base64Encode(')), context);
  const payload = JSON.parse(JSON.stringify(normalize({
    category: 'Insight', content: 'Mixed images', primaryIndex: 2,
    images: [
      { base64: 'AAEC', type: 'image/jpeg' },
      { base64: 'AwQF', type: 'image/png' },
      { url: 'data:image/png;base64,BgcI' },
    ],
  })));
  await context.uploadSelectionToGitHub(payload, settings);
  const binaries = uploads.filter((upload) => upload.isBinary);
  assert.equal(binaries.length, 3);
  assert.ok(binaries[0].filePath.endsWith('.jpg'));
  for (let i = 0; i < binaries.length; i++) {
    assert.deepEqual(Array.from(new Uint8Array(binaries[i].content)), [i * 3, i * 3 + 1, i * 3 + 2]);
  }
  const json = JSON.parse(uploads.find((upload) => upload.filePath.endsWith('.json')).content);
  assert.equal(json.images.length, 3);
  assert.equal(json.image, json.images[2]);
  assert.ok(uploads.find((upload) => upload.filePath.endsWith('.md')).content.includes(json.image));
});
