# Chrome Web Store listing assets

**Copy-paste text:** [`copy-paste/en-US.md`](copy-paste/en-US.md)

## Generate PNGs

1. In Chrome, open **`index.html`** (double-click the file)
2. Click each page link
3. Click **⬇ Download PNG** in the top toolbar

No local server required. Needs network for html2canvas CDN on first use.

| Slot | Size | Page |
|------|------|------|
| Store icon | 128×128 | `icons/icon128.png` |
| Screenshots | 1280×800 | `screenshots/*.html` |
| Small promo | 440×280 | `promo/small-tile.html` |
| Marquee promo | 1400×560 | `promo/marquee-tile.html` |

After changing `icons/icon128.png`, run:

```bash
python chrome-web-store/scripts/gen-icon-data.py
```
