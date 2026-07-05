# 雄鸡助手 (v14.8)

> 单片机毕设一站式生成 · 方案 → 开题报告 → 论文 → PPT

## 功能页面

| 页面 | 路径 | 状态 | 说明 |
|---|---|---|---|
| 🏠 主页 | `/index.html` | ✅ 可用 | 4 个功能卡片 dashboard |
| 📝 方案生成 | `/topic/` | ✅ 可用 | 输入题目 → AI 生成方案（含 22 级库匹配 + 开题报告反推） |
| 📋 开题报告 | `/taskbook/` | ✅ v14.8 稳定 | 基于方案 + 模板 → 生成开题报告 |
| 📄 论文生成 | `/thesis/` | 🚧 待开发 | 基于方案生成论文 |
| 🎨 PPT 生成 | `/ppt/` | 🚧 待开发 | 基于方案生成答辩 PPT |

## 目录结构

```
mcu-plan-website/
├── index.html              # 主页（dashboard）
├── topic/                  # 功能页 1：方案生成
│   ├── index.html
│   ├── app.js
│   ├── style.css
│   └── prompt.md
├── taskbook/               # 功能页 2：开题报告
│   ├── index.html
│   ├── app.js
│   ├── style.css
│   └── prompt.md           # 内嵌 kaiti-report-generator skill v0.6
├── thesis/                 # 功能页 3（占位）
├── ppt/                    # 功能页 4（占位）
├── shared/                 # 共享资源
│   ├── design-tokens.css   # 设计系统
│   ├── ui-kit.js           # Toast + 进度条 + 主题
│   ├── api.js              # API 客户端（OpenAI 兼容）
│   ├── device-library.js   # 器件库（59 器件 / 17 类）
│   ├── markdown.js         # 轻量 markdown 渲染 + extractMetadata
│   ├── storage.js          # localStorage 跨页数据流
│   ├── docx-reader.js      # .docx/.txt 读取（mammoth）
│   ├── docx-export.js      # .docx 导出（JSZip）
│   ├── template-parser.js  # 模板骨架提取（mammoth + 启发式）
│   └── vendor/
│       ├── jszip.min.js          # 97 KB
│       └── mammoth.browser.min.js # 641 KB
├── library/                # 静态数据
│   ├── 22ji-catalog.json   # 22 级项目库（56 个）
│   └── 22ji-content/*.json # 22 级项目内容
├── test-docs/              # 测试用开题报告 .txt
├── docs/                   # 文档
├── _archive_v13_*/         # v13 备份
├── dev-server.js           # 本地预览服务器
└── README.md
```

## 数据流（v14.8）

```
topic 页（方案生成）
   ↓ 点"下一步"按钮
   ↓ Storage.Shared.setMeta(structuredMeta)
   ↓ Storage.Shared.markComplete('topic')
   ↓ window.location.href → taskbook/

taskbook 页（开题报告）
   ↓ init() 时 read Storage.Shared.getMeta()
   ↓ 自动填 题目 / 器件 / 功能
   ↓ 用户可手动改 / 上传模板 .docx / 填参考文献
   ↓ AI 跑 kaiti-report-generator v0.6 4 步适配
   ↓ Storage.Shared.setKaiti(markdown)
   ↓ Storage.Shared.markComplete('taskbook')
   ↓ 用户可下载 .docx 或复制 Markdown
```

## 开题报告模块（v14.8 · 2026-07-05）

**5 项前提条件**（按顺序）：
1. 📝 **题目**（必填）
2. 🔧 **器件清单**（主控+电源必填，可自动从方案 meta 加载）
3. ⚙️ **功能要求**（至少 1 条，可自动从方案 meta 加载）
4. 📄 **学校模板**（可选，无则用 11 章通用框架）
5. 📚 **参考文献**（可选，无则用占位符）

**核心设计**：
- 复用 kaiti-report-generator skill v0.6（背景章节铁律 / 4 步模板适配 / 8 模块生成公式）
- 前端本地骨架提取（mammoth + 启发式），避免一次额外 API 调用
- 自动从 topic 页的方案 meta 加载题目/器件/功能（无缝衔接）
- 输出 Markdown + 一键下载 .docx

## 启动

```bash
node dev-server.js
```

访问 http://localhost:8765/

## 设计原则

1. **可扩展**：每个功能页独立模块，新增功能页 = 复制目录 + 改 prompt
2. **数据流优先**：跨页通过 `Storage.Shared` localStorage 桥接（不依赖 URL 参数）
3. **避免重复 API 调用**：前端能做的（如骨架提取）前端做，AI 只跑语义/生成
4. **视觉动态**：CSS + Web Animations API 实现流畅动画

## 技术栈

- 纯静态 HTML + ES Modules（无构建工具）
- 原生 CSS + CSS Variables（暗色模式基础版）
- OpenAI 兼容 API（默认 MiniMax-M3）
- localStorage 跨页数据流
- 第三方库本地化（JSZip / mammoth，避免 CDN）

## 编码

- 所有文件 **UTF-8 BOM**（根除 GBK 编码问题）
- 中文 JS 字符串需显式 `[char]0xXXXX`（Windows ANSI 解析坑）

## 历史版本

- **v13**：4 大模块 state 隔离
- **v14.0**：模块化重构 + 设计系统 + UI 组件库 + 库比对 + 开题反推
- **v14.1**：开题报告模块上线（taskbook/）
- **v14.2 ~ v14.7**：共享模块深度重构 + storage 修复 + extract mode + abort controller 统一
- **v14.8**：v15-v20 UI 迭代后回滚到稳定功能版（卡片化设计 + 全部核心功能稳定）