/**
 * Export #capture as PNG. Icons use inline data URLs (icon-data.js).
 */
async function ensureStoreIconsReady(root) {
  if (!window.ICON_DATA_URL) return;
  const imgs = root.querySelectorAll("img[data-store-icon]");
  await Promise.all(
    [...imgs].map(
      (img) =>
        new Promise((resolve) => {
          img.crossOrigin = "anonymous";
          if (img.complete && img.src === window.ICON_DATA_URL) {
            resolve();
            return;
          }
          img.onload = () => resolve();
          img.onerror = () => resolve();
          img.src = window.ICON_DATA_URL;
        }),
    ),
  );
}

async function captureToBlob(target, width, height) {
  if (!target || typeof html2canvas !== "function") {
    throw new Error("html2canvas not loaded");
  }

  const bg = target.dataset.exportBg || "#ffffff";
  await ensureStoreIconsReady(target);

  const canvas = await html2canvas(target, {
    width,
    height,
    scale: 1,
    useCORS: true,
    allowTaint: false,
    backgroundColor: bg,
    logging: false,
  });

  let output = canvas;
  if (canvas.width !== width || canvas.height !== height) {
    output = document.createElement("canvas");
    output.width = width;
    output.height = height;
    const ctx = output.getContext("2d");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(canvas, 0, 0, width, height);
  }

  return new Promise((resolve, reject) => {
    output.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("PNG export failed"))),
      "image/png",
      1,
    );
  });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function initScreenshotExport(filename, width = 1280, height = 800) {
  const btn = document.getElementById("download-btn");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    const target = document.getElementById("capture");
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Exporting…";

    try {
      const blob = await captureToBlob(target, width, height);
      downloadBlob(blob, filename);
    } catch (err) {
      console.error(err);
      alert("Download failed: " + (err.message || "Unknown error"));
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  });
}

function buildToolbar(title, prevHref, nextHref, filename, width = 1280, height = 800, uploadField = "Chrome Web Store") {
  const sizeLabel = `${width} × ${height}`;
  document.body.insertAdjacentHTML(
    "afterbegin",
    `
    <header class="toolbar">
      <span class="toolbar-title">${title}</span>
      <span class="toolbar-hint">Upload to: <strong>${uploadField}</strong> · ${sizeLabel} · 24-bit PNG</span>
      <div class="toolbar-actions">
        ${prevHref ? `<a class="btn-nav" href="${prevHref}">← Prev</a>` : ""}
        ${nextHref ? `<a class="btn-nav" href="${nextHref}">Next →</a>` : ""}
        <button type="button" class="btn-download" id="download-btn">⬇ Download PNG (${sizeLabel})</button>
      </div>
    </header>
  `,
  );
  initScreenshotExport(filename, width, height);
}
