/**
 * Detect related images in the same post (e.g. Twitter 4-grid / carousel).
 */

const TWITTER_MEDIA_HOST = 'pbs.twimg.com';

export function getImageGroup(imageUrl) {
  const clickedImg = findImageElement(imageUrl);
  if (!clickedImg) {
    return singleResult(imageUrl, 0);
  }

  const tweetContainer = clickedImg.closest(
    'article[data-testid="tweet"], article[role="article"]',
  );
  if (tweetContainer) {
    const group = collectFromContainer(tweetContainer, clickedImg, 'twitter-tweet');
    if (group.images.length > 1) {
      return group;
    }
  }

  const generic = collectFromGenericContainer(clickedImg);
  if (generic && generic.images.length > 1) {
    return generic;
  }

  const url = resolveImageUrl(clickedImg) || imageUrl;
  return singleResult(url, 0);
}

function singleResult(url, clickedIndex) {
  return {
    clickedIndex,
    source: 'single',
    images: [{ url: normalizeMediaUrl(url), index: 0 }],
  };
}

function collectFromContainer(container, clickedImg, source) {
  const seen = new Map();
  const candidates = [];

  container.querySelectorAll('img').forEach((img) => {
    if (!isContentMediaImage(img)) return;
    const url = normalizeMediaUrl(resolveImageUrl(img));
    if (!url) return;
    const key = mediaDedupeKey(url);
    if (seen.has(key)) return;
    seen.set(key, true);
    candidates.push({ url, element: img });
  });

  candidates.sort((a, b) => {
    const pos = a.element.compareDocumentPosition(b.element);
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });

  const images = candidates.map((c, index) => ({ url: c.url, index }));
  const clickedIndex = findClickedIndex(candidates, clickedImg, images);

  return { clickedIndex, source, images };
}

function collectFromGenericContainer(clickedImg) {
  let node = clickedImg.parentElement;
  while (node && node !== document.body) {
    const imgs = Array.from(node.querySelectorAll('img')).filter(isContentMediaImage);
    if (imgs.length > 1 && imgs.includes(clickedImg)) {
      return collectFromContainer(node, clickedImg, 'generic-siblings');
    }
    node = node.parentElement;
  }
  return null;
}

function findClickedIndex(candidates, clickedImg, images) {
  const idx = candidates.findIndex((c) => c.element === clickedImg);
  if (idx >= 0) return idx;
  const clickedUrl = normalizeMediaUrl(resolveImageUrl(clickedImg));
  const key = mediaDedupeKey(clickedUrl);
  const byUrl = images.findIndex((img) => mediaDedupeKey(img.url) === key);
  return byUrl >= 0 ? byUrl : 0;
}

function findImageElement(imageUrl) {
  const normalizedTarget = normalizeMediaUrl(imageUrl);
  const targetKey = mediaDedupeKey(normalizedTarget);

  return (
    Array.from(document.images).find((img) => {
      const urls = [img.src, img.currentSrc].filter(Boolean);
      if (img.srcset) {
        img.srcset.split(',').forEach((part) => {
          const u = part.trim().split(/\s+/)[0];
          if (u) urls.push(u);
        });
      }
      return urls.some((u) => mediaDedupeKey(normalizeMediaUrl(u)) === targetKey);
    }) ?? null
  );
}

function resolveImageUrl(img) {
  if (img.currentSrc) return img.currentSrc;
  if (img.src) return img.src;
  if (img.srcset) {
    const first = img.srcset.split(',')[0]?.trim().split(/\s+/)[0];
    if (first) return first;
  }
  return '';
}

function isContentMediaImage(img) {
  const url = resolveImageUrl(img);
  if (!url || url.startsWith('data:')) return false;
  if (/profile_images|emoji|twemoji|card_img|abs.twimg\.com\/icons/i.test(url)) {
    return false;
  }
  if (url.includes(TWITTER_MEDIA_HOST) && url.includes('/media/')) {
    return true;
  }
  const w = img.naturalWidth || img.width || 0;
  const h = img.naturalHeight || img.height || 0;
  if (w > 0 && h > 0 && (w < 80 || h < 80)) return false;
  return /\.(jpe?g|png|gif|webp)(\?|$)/i.test(url) || url.includes('/media/');
}

function normalizeMediaUrl(url) {
  if (!url) return url;
  try {
    const u = new URL(url, window.location.href);
    if (u.hostname.includes('twimg.com') && u.pathname.includes('/media/')) {
      u.searchParams.set('name', 'large');
      return u.toString();
    }
  } catch {
    // ignore invalid URLs
  }
  return url;
}

function mediaDedupeKey(url) {
  const m = url.match(/\/media\/([^/?]+)/);
  if (m) return m[1];
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}
