# GitHub 采集数据格式规范

本文记录 InfoFlow Picker 0.2.8 当前实现写入 GitHub 的文件结构与内容格式，供后续开发、数据读取和导入使用。依据为 `src/background/index.js` �?`src/utils/storage.js`，核对日期为 2026-09-30�?

## 1. 项目与数据流

InfoFlow Picker 是一个浏览器扩展，支持采集网页选中文本、右键图片、本地选择或粘贴的图片，并填写分类、来源链接和备注�?

- `src/content/`：获取页面内容和图片组�?
- `src/popup/`：编辑采集内容、选择多图、管理草稿和提交保存�?
- `src/options/`：配�?GitHub 目标、分类、语言和输出格式�?
- `src/utils/draft.js`、`draftImages.js`：保存草稿及图片数据；草稿图片二进制存入 IndexedDB�?
- `src/utils/syncQueue.js`：将保存任务和图片引用持久化到浏览器本地存储，并管理状态、重试与徽标；`syncImages.js` 将待上传图片二进制独立存�?IndexedDB�?
- `src/background/index.js`：校验输入、生成固定上传路径、上传图片和数据文件�?
- `scripts/build.mjs`：使�?esbuild 构建 Chrome Manifest V3 �?Firefox Manifest V2 扩展�?

保存流程：采�?�?编辑 �?本地队列 �?后台上传图片 �?上传 JSON / Markdown �?成功后移除队列任务。入队成功不代表 GitHub 上传已经完成�?

## 2. 输入与输出选择

- `category` 必填，去除首尾空白后不得为空。默认可选分类为 `Insight`、`Prompt`�?
- `content` 和图片至少提供一种；仅填写备注或链接无法保存�?
- `content`、`category`、`url`、`notes` 均去除首尾空白，正文内部换行保留�?
- `outputFormats` 支持 `json+md`（默认）、`json`、`md`。图片上传不受该选择影响�?
- GitHub 默认分支配置�?`master`，基础路径默认�?`infoflow-data`；实际目标由用户设置决定�?

## 3. 目录与文件名

```text
{basePath}/
├── {safeCategory}/
�?  ├── {time}-{suffix}.json
�?  └── {time}-{suffix}.md
└── Images/
    └── {safeCategory}/
        ├── {time}-{suffix}-0.png
        └── {time}-{suffix}-1.png
```

- `safeCategory`：将分类中的 `\ / : * ? " < > |` 替换�?`_`。文件内容中�?`category` 保留原分类文本�?
- `time`：生成上传计划时�?UTC ISO 时间，将 `:` �?`.` 替换�?`-`，例�?`2026-09-30T04-05-06-789Z`�?
- `suffix`：由 `Math.random().toString(36).substring(2, 8)` 生成，通常�?6 位小写字母或数字，不应作为严格唯一性保证�?
- 图片编号�?`0` 开始，按提交图片数组的顺序排列；单图同样带 `-0`�?
- 同一条记录的 JSON、Markdown 和图片共用时间与后缀�?
- 上传计划在首次上传前持久化，重试复用路径，避免每次重试生成新文件名�?

例如�?

```text
infoflow-data/Insight/2026-09-30T04-05-06-789Z-abc123.json
infoflow-data/Insight/2026-09-30T04-05-06-789Z-abc123.md
infoflow-data/Images/Insight/2026-09-30T04-05-06-789Z-abc123-0.png
```

## 4. JSON 格式

每条记录对应一�?JSON 对象，以 UTF-8 编码，使用两个空格缩进。文本采集与纯图片采集使用相同字段结构�?

```json
{
  "category": "Insight",
  "url": "https://example.com/article",
  "content": "采集的正文内容�?,
  "notes": "个人备注�?,
  "image": "../Images/Insight/2026-09-30T04-05-06-789Z-abc123-1.png",
  "images": [
    "../Images/Insight/2026-09-30T04-05-06-789Z-abc123-0.png",
    "../Images/Insight/2026-09-30T04-05-06-789Z-abc123-1.png"
  ],
  "savedAt": "2026-09-30T04:05:07.123Z"
}
```

字段约定�?

- `category`：字符串，原始分类名，必定非空�?
- `url`：字符串，来源链接；未填写时�?`""`�?
- `content`：字符串，正文；纯图片记录为 `""`�?
- `notes`：字符串，备注；未填写时�?`""`�?
- `image`：字符串，主图的相对路径；无图片时为 `""`。主图不一定是 `images[0]`�?
- `images`：字符串数组，所有上传图片的相对路径，包含主图；无图片时�?`[]`�?
- `savedAt`：UTC ISO 8601 时间字符串，在首次生�?`uploadPlan` 时写入并复用；同一次采集的 JSON �?Markdown 共用该值�?

以上七个字段均输出。当前没�?`id`、`title`、`timestamp`、`schemaVersion` 或独立的采集时间字段。`primaryIndex`、上传计划和队列状态只用于内部处理，不写入最�?JSON�?

`savedAt` 与文件名中的 `time` 生成时机接近但格式不同（文件名会�?`:` / `.` 替换掉）。重试复用同一 `uploadPlan` �?`savedAt` 不变，便于内容幂等跳过�?

## 5. Markdown 格式

Markdown 使用 UTF-8 �?`\n` 换行，固定输出英文标签，不随界面语言变化。正文和备注直接写入，保留原�?Markdown 语法，不额外转义�?

### 5.1 有正文的记录

```markdown
# Insight

- **Category:** Insight
- **Source URL:** https://example.com/article
- **Image:** ![](../Images/Insight/2026-09-30T04-05-06-789Z-abc123-0.png)
- **Saved At:** 2026-09-30T04:05:07.123Z

---

## Content

采集的正文内容�?

## Notes

个人备注�?
```

- 缺少来源链接时，`Source URL` 的值为 `-`�?
- 无图片时省略 `Image` 行�?
- 仅有一张图片时，在 `Image` 行展示，不输�?`Images` 章节�?
- 多张图片时，在正文之后、备注之前追�?`## Images`，按数组顺序逐张输出 `![](相对路径)`，图片之间留空行。主图也包含在该列表中，因此会重复展示�?
- 无备注时省略整个 `Notes` 章节�?

### 5.2 纯图片记�?

```markdown
# Insight

- **Source URL:** https://example.com/article
- **Image:** ![](../Images/Insight/2026-09-30T04-05-06-789Z-abc123-0.png)
- **Saved At:** 2026-09-30T04:05:07.123Z

---

## Notes

个人备注�?
```

纯图片记录没�?`Category` 元数据行，也没有 `Content` 章节。多图时在元数据后追�?`Images` 章节。仅在有备注时，才在备注章节之前输出分隔�?`---`�?

## 6. 图片路径与实际内�?

JSON �?`image`、`images` �?Markdown 图片链接均相对于数据文件所在目录：

```text
../Images/{safeCategory}/{time}-{suffix}-{index}.png
```

读取端应以数据文件目录解析路径，不能直接将其当成仓库根目录路径或网页图片原始 URL。最�?JSON 不保存每张图片的原始 URL�?

以上示例�?PNG 为例�?.2.6 起按图片 MIME 类型生成扩展名：JPEG 使用 `.jpg`，PNG 使用 `.png`，WebP 等使用对应后缀。手动选图和粘贴的原图大于 2 MiB 时，提交时会尝试质量 90% �?JPEG，仅在体积更小时采用；勾选“本次不压缩图片”时使用原图。URL 图片缺少已知类型时仍回退�?`.png`；后台不会据此重新编码。读取端应使�?JSON 中的实际路径，不要自行拼�?`.png` 后缀�?

## 7. GitHub 写入行为

当前代码通过 GitHub Contents API 逐文件上传。文本先编码�?UTF-8，再转为 Base64；图片直接将二进制转�?Base64�?

每个文件写入时的提交信息为：

```text
InfoFlow: {filePath}
```

例如�?

```text
InfoFlow: infoflow-data/Insight/2026-09-30T04-05-06-789Z-abc123.json
```

上传前查询目标分支上的文�?SHA，存在则携带 SHA 更新；若远端 blob SHA 与本地内容一致则跳过 PUT。同一条记录内的图片与 JSON/Markdown 按顺序串行上传，并对 409/422 做指数退避重试，以降�?Contents API 分支 tip 竞态。一条采集记录仍不是原子提交：图片成功后数据文件仍可能失败。读取端应允许暂时缺少部分配套文件�?

## 8. 与旧 README 示例的差异及维护要求

�?README 的数据示例未覆盖当前实现，以下内容以本文为准�?

- 时间字段�?`savedAt`，不�?`timestamp`�?
- JSON 同时包含主图 `image` 和完整图片数�?`images`�?
- 图片引用�?`../Images/` 开头�?
- 文件名保�?ISO 日期结构，图片文件名带数字索引�?
- Markdown 包含英文元数据标签及 `Content`、`Images`、`Notes` 等条件章节�?
- 后台不保证所有图片二进制都转换为 PNG�?

后续修改 `buildUploadPlan`、`toRelativeImagePaths`、`buildContent`、`buildImageOnlyContent`、`buildImageOnlyMarkdown` �?`uploadToGitHub` 时，应同步更新本文。格式变更需核对纯文本、文本加单图、文本加多图、纯图片和无备注等情况，并考虑已有数据的读取兼容性�?
