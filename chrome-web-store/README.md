# Chrome Web Store listing assets

Everything needed to publish **InfoFlow Picker** on the [Chrome Web Store](https://chrome.google.com/webstore).

**Copy-paste text:** [`copy-paste/en-US.md`](copy-paste/en-US.md) — title, summary, description, privacy fields.

**Generate images:** open [`index.html`](index.html) in Chrome → download each PNG.

---

## Dashboard checklist

| Field | Requirement | Source |
|-------|-------------|--------|
| Title | From package | **InfoFlow Picker** |
| Summary | Max 132 chars | Extract highlighted knowledge and sync it to GitHub with categories. |
| Description | Max 16,000 chars | `copy-paste/en-US.md` |
| Category | Pick one | **Productivity** |
| Language | Pick one | **English** |
| Store icon | **128 × 128** PNG | `icons/icon128.png` |
| Screenshots | **1–5**, **1280×800** or 640×400, JPEG / 24-bit PNG (no alpha) | `screenshots/*.html` |
| Small promo tile | **440 × 280**, JPEG / 24-bit PNG (no alpha) | `promo/small-tile.html` |
| Marquee promo tile | **1400 × 560**, JPEG / 24-bit PNG (no alpha) | `promo/marquee-tile.html` |
| Promo video | Optional YouTube URL | — |

---

## Generate PNGs

1. Open **`index.html`** in Chrome (double-click or local server).
2. Click **⬇ Download all (ZIP)** for every PNG at once, **or** open each page → Download PNG.
3. Toolbar is excluded; export size matches the table above.

---

## Distribution

Upload extension zip from [GitHub Releases](https://github.com/shalom-lab/InfoFlow-Picker/releases) or run the **Publish to Web Stores** workflow manually.

Repo: [github.com/shalom-lab/InfoFlow-Picker](https://github.com/shalom-lab/InfoFlow-Picker)

---

**Reuse this setup in other projects:** Cursor personal skill `chrome-web-store-assets` (`~/.cursor/skills/chrome-web-store-assets/`). Run its scaffold script or ask the agent to apply the skill.
