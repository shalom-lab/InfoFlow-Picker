# Chrome Web Store — copy-paste fields

Map each block below to the matching field in **Developer Dashboard → Store listing**.

---

## Text fields

| Dashboard field | Value |
|-----------------|-------|
| **Title** (from package) | InfoFlow Picker |
| **Summary** (short description, max 132 chars) | Save highlights & images to GitHub with categories — right-click any image to capture and batch-save. |
| **Category** | Productivity |
| **Language** | English |

### Detailed description (paste into “Description”, max 16,000 chars)

InfoFlow Picker lets you **save images and text from any webpage** straight to **your own GitHub repository** — with source URL, categories, and structured JSON + Markdown export.

**Why install it**

- **Right-click any image** to save it to GitHub — no download folder, no copy-paste
- Pick **multiple images from the same post** (Twitter/X grids, galleries) and upload in one click
- Capture highlighted text with the same workflow — one tool for clips and visuals
- Works with InfoFlow and other Markdown/JSON knowledge workflows

**Image saving (core feature)**

- Context menu on any image → open picker → save to your repo
- Auto-detects sibling images in the same post; default selects the one you clicked
- Select all, pick several, or current only — batch upload to GitHub
- Images stored alongside JSON metadata and Markdown notes in category folders

**Also includes**

- Select text or use the context menu for quotes and highlights
- Custom categories, notes, JSON + Markdown export
- Draft cache survives popup close or failed saves until success
- Chinese & English UI; GitHub token stored locally only

**Privacy**

No data is sent to the developer’s servers. Uploads use your token to your repo only.

**Use cases:** knowledge management, reading notes, research clips, InfoFlow workflows.

---

## Image assets (size requirements)

| Asset | Size | Format | File / how to generate |
|-------|------|--------|------------------------|
| **Store icon** | 128 × 128 | PNG | `icons/icon128.png` |
| **Screenshots** (1–5) | 1280 × 800 or 640 × 400 | JPEG or 24-bit PNG (no alpha) | Open `screenshots/index.html` → Download PNG on each page |
| **Small promo tile** | 440 × 280 | JPEG or 24-bit PNG (no alpha) | `promo/small-tile.html` → Download PNG |
| **Marquee promo tile** | 1400 × 560 | JPEG or 24-bit PNG (no alpha) | `promo/marquee-tile.html` → Download PNG |
| **Promo video** (optional) | YouTube URL | — | Leave empty if none |

**Suggested screenshot order (max 5):**

1. `02-image-picker-1280x800.png` — **image save & multi-pick** (lead with this)
2. `01-main-save-1280x800.png` — text capture
3. `04-overview-1280x800.png` — overview
4. `03-settings-1280x800.png` — GitHub settings

Export uses opaque white background (24-bit PNG, no transparency).

---

## Privacy practices

### Single purpose (required)

The single purpose of this extension is to let users, on explicit action (text selection, image context menu, or save popup), organize web content and images and upload them to a GitHub repository configured by the user. It does not provide unrelated features such as ads, tracking, mining, or modifying pages without user intent.

### activeTab justification

When the user clicks the extension icon or context menu, the extension needs the active tab to read selected text, page URL, and the image the user right-clicked, to prefill the save form. Used only on user gesture, not for background tab monitoring.

### contextMenus justification

Adds the “InfoFlow Picker” item when the user selects text or right-clicks an image, as the entry point for capture and save.

### scripting justification

Used with content scripts to read selection and image data from the active page when the user invokes the extension (Manifest V3). No injection on pages without user action.

### storage justification

Stores locally: GitHub settings (token kept on device, not synced), categories, language, and unsaved capture drafts so content is not lost when the popup closes. Token is not sent to third parties except GitHub API calls chosen by the user.

### tabs justification

Reads the active tab URL as the source link and messages the content script on that tab to retrieve selection. Not used for history analytics or cross-site tracking.

### Host permission (https://api.github.com/*)

HTTPS requests to GitHub REST API only, to upload user-approved content and images to the user’s repository. User-captured data is not sent to developer servers.

Content scripts may run on pages the user visits to read selection/images; captured data goes only to the user’s GitHub.

### Remote code

**Answer: No** — all JavaScript is bundled in the extension package. No eval, no remote executable scripts.

### Data use & Developer Program Policy

- No user content sent to developer servers
- User-provided GitHub token stored locally
- Captured data uploaded only to user-specified GitHub repo
- No ads, data sale, or credit scoring
