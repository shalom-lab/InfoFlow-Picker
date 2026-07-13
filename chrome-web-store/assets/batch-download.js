/** One-click ZIP of all Chrome Web Store image assets. */
const GENERATED_PAGES = [
  {
    page: "screenshots/02-image-picker.html",
    width: 1280,
    height: 800,
    filename: "screenshots/02-image-picker-1280x800.png",
    label: "Screenshot · Save images",
  },
  {
    page: "screenshots/01-main-save.html",
    width: 1280,
    height: 800,
    filename: "screenshots/01-main-save-1280x800.png",
    label: "Screenshot · Text & images",
  },
  {
    page: "screenshots/04-overview.html",
    width: 1280,
    height: 800,
    filename: "screenshots/04-overview-1280x800.png",
    label: "Screenshot · Overview",
  },
  {
    page: "screenshots/03-settings.html",
    width: 1280,
    height: 800,
    filename: "screenshots/03-settings-1280x800.png",
    label: "Screenshot · Settings",
  },
  {
    page: "promo/small-tile.html",
    width: 440,
    height: 280,
    filename: "promo/promo-small-440x280.png",
    label: "Small promo tile",
  },
  {
    page: "promo/marquee-tile.html",
    width: 1400,
    height: 560,
    filename: "promo/promo-marquee-1400x560.png",
    label: "Marquee promo tile",
  },
];

const IFRAME_STYLE =
  "position:fixed;left:-9999px;top:0;width:1400px;height:800px;border:0;visibility:hidden;pointer-events:none";

function resolvePageUrl(pagePath) {
  return new URL(pagePath, window.location.href).href;
}

function getIframeDocument(iframe) {
  try {
    return iframe.contentDocument || iframe.contentWindow?.document || null;
  } catch {
    return null;
  }
}

function dataUrlToBlob(dataUrl) {
  const [header, b64] = dataUrl.split(",");
  const mime = header.match(/:(.*?);/)[1];
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

async function waitForCapture(iframe, pagePath, timeoutMs = 12000) {
  const started = Date.now();
  while Date.now() - started < timeoutMs) {
    const doc = getIframeDocument(iframe);
    if (doc) {
      const target = doc.getElementById("capture");
      if (target) return target;
    }
    await new Promise((r) => setTimeout(r, 120));
  }

  const doc = getIframeDocument(iframe);
  if (!doc) {
    throw new Error(
      "Cannot read export page. Try: python -m http.server 8765 in chrome-web-store/, then open http://localhost:8765/index.html",
    );
  }
  throw new Error(`No #capture in ${pagePath}`);
}

async function waitForIcons(target) {
  const imgs = target.querySelectorAll("img[data-store-icon]");
  if (!imgs.length) return;
  await Promise.all(
    [...imgs].map(
      (img) =>
        new Promise((resolve) => {
          if (img.complete && img.src.startsWith("data:")) {
            resolve();
            return;
          }
          const done = () => resolve();
          img.addEventListener("load", done, { once: true });
          img.addEventListener("error", done, { once: true });
          setTimeout(done, 2500);
        }),
    ),
  );
}

function mountIframe(pagePath, setContent) {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.setAttribute("loading", "eager");
    iframe.style.cssText = IFRAME_STYLE;

    let settled = false;
    const cleanup = () => iframe.remove();

    const onReady = async () => {
      if (settled) return;
      try {
        const target = await waitForCapture(iframe, pagePath);
        await waitForIcons(target);
        await new Promise((r) => setTimeout(r, 250));
        settled = true;
        resolve({ target, cleanup });
      } catch (err) {
        settled = true;
        cleanup();
        reject(err);
      }
    };

    iframe.addEventListener("load", () => {
      if (setContent === "src" && (!iframe.src || iframe.src === "about:blank")) return;
      onReady();
    });

    iframe.addEventListener("error", () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`Failed to load ${pagePath}`));
    });

    document.body.appendChild(iframe);
    setContent(iframe);
  });
}

function loadPageViaSrc(pagePath) {
  const pageUrl = resolvePageUrl(pagePath);
  return mountIframe(pagePath, (iframe) => {
    iframe.src = pageUrl;
  });
}

async function loadPageViaSrcdoc(pagePath) {
  const pageUrl = resolvePageUrl(pagePath);
  const baseHref = new URL("./", pageUrl).href;
  const res = await fetch(pageUrl);
  if (!res.ok) throw new Error(`Fetch failed: ${pagePath}`);
  let html = await res.text();
  if (!/<base[\s>]/i.test(html)) {
    html = html.replace(/<head([^>]*)>/i, `<head$1><base href="${baseHref}">`);
  }
  return mountIframe(pagePath, (iframe) => {
    iframe.srcdoc = html;
  });
}

async function loadPageCapture(pagePath) {
  try {
    return await loadPageViaSrc(pagePath);
  } catch {
    return loadPageViaSrcdoc(pagePath);
  }
}

async function downloadAllStoreAssets(onProgress) {
  if (typeof JSZip !== "function") throw new Error("JSZip not loaded");
  if (!window.StoreExport) throw new Error("export.js not loaded");

  const zip = new JSZip();
  const total = GENERATED_PAGES.length + 1;
  let step = 0;

  const progress = (msg) => {
    step += 1;
    if (onProgress) onProgress(step, total, msg);
  };

  if (window.ICON_DATA_URL) {
    zip.file("icons/icon128.png", dataUrlToBlob(window.ICON_DATA_URL));
    progress("Store icon · 128×128");
  } else {
    try {
      const resp = await fetch("icons/icon128.png");
      zip.file("icons/icon128.png", await resp.blob());
      progress("Store icon · 128×128");
    } catch {
      progress("Store icon skipped");
    }
  }

  for (const asset of GENERATED_PAGES) {
    if (onProgress) onProgress(step, total, `Rendering ${asset.label}…`);
    const { target, cleanup } = await loadPageCapture(asset.page);
    try {
      const blob = await window.StoreExport.captureToBlob(target, asset.width, asset.height);
      zip.file(asset.filename, blob);
      progress(`Done · ${asset.filename}`);
    } finally {
      cleanup();
    }
  }

  if (onProgress) onProgress(total, total, "Creating ZIP…");
  const zipBlob = await zip.generateAsync({ type: "blob" });
  window.StoreExport.downloadBlob(zipBlob, "infoflow-picker-store-assets.zip");
}

function initBatchDownload(buttonId, statusId) {
  const btn = document.getElementById(buttonId);
  const status = document.getElementById(statusId);
  if (!btn) return;

  btn.addEventListener("click", async () => {
    const label = btn.textContent;
    btn.disabled = true;
    const setStatus = (text) => {
      if (status) status.textContent = text;
    };

    try {
      setStatus("Starting…");
      await downloadAllStoreAssets((_step, total, msg) => {
        btn.textContent = `Exporting… (${Math.min(_step, total)}/${total})`;
        setStatus(msg);
      });
      setStatus("Done — infoflow-picker-store-assets.zip downloaded.");
    } catch (err) {
      console.error(err);
      setStatus("");
      alert("Batch download failed: " + (err.message || "Unknown error"));
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  });
}

window.StoreBatchDownload = { downloadAllStoreAssets, initBatchDownload, GENERATED_PAGES };
