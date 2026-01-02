# InfoFlow Picker

<div align="center">

![InfoFlow Picker Logo](extension/assets/logo.svg)

**一个强大的浏览器扩展，帮助您轻松收集网页内容并同步到 GitHub**

[![Chrome Web Store](https://img.shields.io/badge/Chrome-Extension-green?logo=google-chrome)](https://chrome.google.com/webstore)
[![Firefox Add-ons](https://img.shields.io/badge/Firefox-Add--on-orange?logo=firefox)](https://addons.mozilla.org/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

</div>

## ✨ 功能特性

### 📝 文本采集
- **选中文本保存**：在网页中选中文本，点击扩展图标即可快速保存
- **自动填充**：自动获取选中内容和当前页面 URL
- **分类管理**：支持自定义分类，便于组织和管理内容

### 🖼️ 图片采集
- **右键保存图片**：右键点击网页中的图片，选择保存选项
- **手动上传图片**：在文本采集界面也可以手动选择并上传图片
- **智能处理**：自动处理跨域图片，支持多种图片格式（统一转换为 PNG）

### 📋 备注功能
- **添加备注**：为每条记录添加个人备注和说明
- **完整信息**：保存内容、分类、来源链接、图片和备注的完整信息

### 💾 多格式保存
- **JSON + Markdown**：默认同时保存两种格式（推荐）
- **仅 JSON**：只保存 JSON 格式
- **仅 Markdown**：只保存 Markdown 格式
- **灵活配置**：在设置中自由选择保存格式

### 🌐 国际化支持
- **多语言界面**：支持中文和英文
- **界面切换**：可在设置中随时切换语言

### 🎨 美观界面
- **现代化设计**：简洁美观的用户界面
- **图标增强**：丰富的图标提示，提升使用体验
- **响应式交互**：流畅的动画和交互效果

## 🚀 快速开始

### 安装扩展

#### Chrome
1. 下载或克隆本项目
2. 打开 Chrome，访问 `chrome://extensions/`
3. 开启"开发者模式"
4. 点击"加载已解压的扩展程序"
5. 选择项目的 `dist/chrome` 目录

#### Firefox
1. 下载或克隆本项目
2. 打开 Firefox，访问 `about:debugging#/runtime/this-firefox`
3. 点击"临时载入附加组件"
4. 选择项目的 `dist/firefox` 目录中的 `manifest.json` 文件

### 配置 GitHub

1. **获取 GitHub Token**
   - 访问 [GitHub Settings > Developer settings > Personal access tokens](https://github.com/settings/tokens)
   - 点击 "Generate new token (classic)"
   - 勾选 `repo` 权限
   - 复制生成的 token（格式：`ghp_xxx`）

2. **配置扩展设置**
   - 点击扩展图标
   - 点击右上角的设置按钮（⚙️）
   - 填写以下信息：
     - **GitHub Token**：粘贴您的 token
     - **仓库拥有者**：您的 GitHub 用户名或组织名
     - **仓库名称**：目标仓库名称
     - **分支**：默认分支（通常是 `main` 或 `master`）
     - **基础路径**：文件保存的基础路径（如 `infoflow-data`）
     - **上传格式**：选择保存格式（推荐：JSON + Markdown）
     - **分类**：每行一个分类名称
   - 点击"保存设置"

## 📖 使用指南

### 保存文本内容

1. 在网页中选中您想要保存的文本
2. 点击浏览器工具栏中的扩展图标
3. 检查并编辑内容、分类、链接等信息
4. 可选：添加图片或备注
5. 点击"保存到 GitHub"

### 保存图片

**方法一：右键保存**
1. 在网页中右键点击图片
2. 选择扩展的保存选项
3. 填写分类、备注等信息
4. 点击"保存到 GitHub"

**方法二：手动上传**
1. 选中文本后打开扩展
2. 点击"选择图片"按钮
3. 从本地选择图片文件
4. 填写其他信息并保存

### 文件保存结构

```
{base-path}/
├── {category}/
│   ├── 20240101120000-abc123.json
│   └── 20240101120000-abc123.md
└── Images/
    └── {category}/
        └── 20240101120000-abc123.png
```

- **数据文件**：保存在 `{base-path}/{category}/` 目录下
- **图片文件**：保存在 `{base-path}/Images/{category}/` 目录下
- **文件命名**：`时间戳-随机后缀.扩展名`

## 🛠️ 开发

### 环境要求

- Node.js >= 16
- npm >= 8

### 安装依赖

```bash
npm install
```

### 构建项目

```bash
# 构建所有平台
npm run build

# 仅构建 Chrome 版本
npm run build:chrome

# 仅构建 Firefox 版本
npm run build:firefox
```

### 开发模式

```bash
npm run dev
```

### 项目结构

```
InfoFlow-Picker/
├── extension/          # 扩展资源文件
│   ├── assets/        # 图标和资源
│   └── manifest.*.json # 平台特定的 manifest
├── src/               # 源代码
│   ├── background/    # 后台脚本（Service Worker）
│   ├── content/       # 内容脚本
│   ├── popup/         # 弹出窗口界面
│   ├── options/        # 设置页面
│   ├── i18n/          # 国际化文件
│   └── utils/         # 工具函数
├── dist/              # 构建输出
│   ├── chrome/        # Chrome 版本
│   └── firefox/       # Firefox 版本
└── scripts/           # 构建脚本
```

## 🔧 技术栈

- **Manifest V3**：使用最新的扩展 API
- **ESBuild**：快速构建工具
- **WebExtension Polyfill**：跨浏览器兼容
- **GitHub API**：文件上传和管理
- **Canvas API**：图片处理和转换

## 📝 数据格式

### JSON 格式

```json
{
  "content": "选中的文本内容",
  "category": "技术",
  "url": "https://example.com/page",
  "image": "Images/技术/20240101120000-abc123.png",
  "notes": "个人备注",
  "timestamp": "2024-01-01T12:00:00Z"
}
```

### Markdown 格式

```markdown
# 技术

**来源**：https://example.com/page

**内容**：
选中的文本内容

**备注**：
个人备注

![图片](Images/技术/20240101120000-abc123.png)
```

## ⚠️ 注意事项

1. **GitHub Token 安全**
   - Token 仅保存在本地浏览器中
   - 不会通过浏览器同步功能同步
   - 请妥善保管您的 Token

2. **跨域图片限制**
   - 某些跨域图片可能无法直接获取（CORS 限制）
   - 扩展会尝试多种方法获取图片数据
   - 如果预览失败，保存时仍会尝试从 URL 直接下载

3. **GitHub API 限制**
   - 注意 GitHub API 的速率限制
   - 频繁保存时可能会遇到 409 冲突错误
   - 扩展已实现自动重试机制

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

MIT License

## 🙏 致谢

- [InfoFlow](https://github.com/shalom-lab/InfoFlow) - 灵感来源
- 所有贡献者和用户

---

<div align="center">

**如果这个项目对您有帮助，请给个 ⭐ Star！**

Made with ❤️ by the InfoFlow Picker team

</div>

