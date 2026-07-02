# 🔧 单片机方案设计器

> 一个纯前端的网页工具：输入题目，AI 自动生成精简的单片机项目方案。
> 基于 **MiniMax-M3** 大模型，支持 **GitHub Pages 免费部署**，**API Key 只存浏览器本地**。

![GitHub Pages](https://img.shields.io/badge/部署-GitHub%20Pages-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![No Backend](https://img.shields.io/badge/backend-无-success)

---

## ✨ 特性

- ✅ **0 服务器**：纯静态网站，GitHub Pages 免费托管
- ✅ **API Key 自管**：存在你自己的浏览器，不上传任何服务器
- ✅ **Prompt 独立更新**：能力升级 = 改一个 `.md` 文件，网站代码不动
- ✅ **生成 .docx**：浏览器内生成 Word 文档下载
- ✅ **响应式**：手机能用
- ✅ **ABC 三档**：简单 / 中等 / 复杂方案任选

---

## 📋 准备工作（5 分钟）

你需要：

| # | 东西 | 怎么搞 | 时间 |
|---|---|---|---|
| 1 | **GitHub 账号** | https://github.com/signup 用邮箱注册 | 3 min |
| 2 | **MiniMax 账号 + API Key** | https://platform.minimax.io 注册 → API Keys → Create | 2 min |
| 3 | **MiniMax 余额** | platform.minimax.io 充 ¥10（够用半年） | 1 min |

**不需要：** Git / Python / Node / VS Code / 服务器 / 域名

---

## 🚀 部署教程（30 分钟首次，之后改 Prompt 1 分钟）

### 第 1 步：在 GitHub 建仓库

1. 登录 GitHub
2. 右上角 `+` → **New repository**
3. 填写：
   - **Repository name**：`mcu-plan-website`
   - **Description**（可选）：单片机方案设计器
   - **Public** ✅（必须 Public，GitHub Pages 才能免费托管）
   - **Add a README file** ✅ 勾上
4. 点 **Create repository**

---

### 第 2 步：上传代码

1. 在新仓库页面，点 **Add file** → **Upload files**
2. 把本仓库的**所有文件**拖进去：
   ```
   mcu-plan-website/
   ├── index.html
   ├── css/
   │   └── style.css
   ├── js/
   │   ├── app.js
   │   ├── api.js
   │   ├── prompt-loader.js
   │   └── docx-export.js
   └── prompts/
       └── mcu-plan-prompt.md
   ```
3. 点 **Commit changes**

---

### 第 3 步：启用 GitHub Pages

1. 仓库页面 → **Settings**（顶部）
2. 左侧菜单 → **Pages**
3. **Source**：选 **Deploy from a branch**
4. **Branch**：选 `main` / `(root)`
5. 点 **Save**
6. 等待 1-2 分钟，刷新页面，会显示：
   ```
   Your site is live at https://你的用户名.github.io/mcu-plan-website/
   ```

---

### 第 4 步：填 API Key

1. 打开你的网址（上面那个链接）
2. 点 **⚙️ 设置**
3. 填：
   - **API Key**：你的 MiniMax key（`sk-...`）
   - **Base URL**：`https://api.minimaxi.com/v1`（国内）/ `https://api.minimax.io/v1`（国际）
   - **模型**：`MiniMax-M3`
   - **GitHub 用户名**：你的 GitHub 用户名（用于拉取 Prompt）
4. 点 **保存**

---

### 第 5 步：测试

1. 主界面输入：`智能台灯控制`
2. 选等级：`A`
3. 点 **🚀 生成方案**
4. 等待 3-10 秒
5. 看到结果 = 成功 🎉

---

## 🔄 后期更新 Prompt（1 分钟）

能力进化 = 改一个文件，网站自动更新：

1. GitHub 仓库 → 打开 `prompts/mcu-plan-prompt.md`
2. 点 ✏️ **Edit this file**
3. 改内容
4. 点 **Commit changes**
5. 等 1 分钟，GitHub Pages 自动部署
6. 打开网站 → ⚙️ 设置 → 点 **🔄 刷新 Prompt** → 拉到最新版

---

## 🔒 安全说明

| 项 | 状态 |
|---|---|
| API Key 存储 | 仅浏览器 `localStorage`，不上传任何服务器 |
| 你的 prompt | 公开仓库可见（建议私有化方案见下） |
| MiniMax 余额 | 按 token 计费，生成一个方案约 0.05 元 |

**⚠️ 注意事项：**
- 不要在**公用电脑**填 API Key（别人打开浏览器能看到）
- 退出浏览器前记得关页面（建议加浏览器密码锁）

---

## 🎨 自定义

### 改 Prompt 模板

编辑 `prompts/mcu-plan-prompt.md`，然后 commit。

### 改网站样式

编辑 `css/style.css`，然后 commit。

### 改功能

编辑 `js/app.js`，然后 commit。

---

## 📂 文件结构

```
mcu-plan-website/
├── index.html              # 单页面入口
├── css/
│   └── style.css           # 样式
├── js/
│   ├── app.js              # 主逻辑
│   ├── api.js              # MiniMax API 调用
│   ├── prompt-loader.js    # 加载 GitHub 上的 Prompt
│   └── docx-export.js      # .docx 生成
├── prompts/
│   └── mcu-plan-prompt.md  # Prompt 模板（核心 IP）
├── .gitignore
├── LICENSE
└── README.md
```

---

## ❓ 常见问题

### Q1：网站打开是空白？

检查浏览器控制台（F12 → Console），看错误信息：
- **404**：文件没上传完整
- **CORS 错误**：base URL 填错了
- **marked is not defined**：网络问题，CDN 没加载到

### Q2：生成时报 401？

API Key 无效，去 https://platform.minimax.io 检查或重新生成。

### Q3：生成时报 402？

余额不足，去 platform.minimax.io 充值。

### Q4：拉 Prompt 失败？

- 仓库必须是 **Public**
- GitHub 用户名填错了
- 文件路径不对（默认 `prompts/mcu-plan-prompt.md`）

### Q5：能不能改成私有部署？

可以，把仓库设为 Private，然后用 Cloudflare Pages / Vercel 部署。
但 GitHub Pages 免费版只能托管 Public 仓库。

---

## 🛠️ 技术栈

- **前端**：原生 HTML + CSS + JS（无构建工具）
- **Markdown 渲染**：[marked](https://github.com/markedjs/marked)
- **.docx 生成**：[docx](https://docx.js.org/)
- **文件保存**：[FileSaver.js](https://github.com/eligrey/FileSaver.js)
- **AI API**：MiniMax M3（OpenAI 兼容）
- **部署**：GitHub Pages

---

## 📜 License

MIT

---

## 🌐 立即访问

最新部署版本：**https://3192917087-dotcom.github.io/mcu-plan-website/**

## 🙏 致谢

由程帅志的 AI 秘书 📋 自动生成。
