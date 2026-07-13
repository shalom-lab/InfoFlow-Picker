# Screenshots (1280 × 800)

Chrome Web Store allows **1–5** screenshots at **1280×800** or **640×400**.  
Format: JPEG or **24-bit PNG (no alpha)**.

## Quick start

1. Open [`../index.html`](../index.html) or this folder’s [`index.html`](index.html)
2. Open each page → **⬇ Download PNG**
3. Upload up to 4 PNGs (or pick your best 1–5)

| Page | Export filename |
|------|-----------------|
| `01-main-save.html` | `01-main-save-1280x800.png` |
| `02-image-picker.html` | `02-image-picker-1280x800.png` |
| `03-settings.html` | `03-settings-1280x800.png` |
| `04-overview.html` | `04-overview-1280x800.png` |

Export validates exact dimensions; toolbar is excluded.

If **Download** fails with “tainted canvas”, refresh the page (icons are embedded via `assets/icon-data.js`). After changing `icons/icon128.png`, run:

```bash
python chrome-web-store/scripts/gen-icon-data.py
```

## Fallback (no CDN)

DevTools device mode → 1280×800 → screenshot `#capture` only.
