/* ============================================================
 * taskbook/app.js
 * 开题报告生成 · 主逻辑
 * - 从 Storage.Shared.getMeta() 自动加载题目/器件/功能
 * - 用户上传 .docx 模板 → 前端骨架提取（v0.6 第 1 步）
 * - 用户输入参考文献（或留空用占位）
 * - AI 跑 v0.6 4 步模板适配 → 生成开题报告
 * - 输出 Markdown + 下载 .docx
 * ============================================================ */

import UIContainer from '../shared/ui-kit.js';
import ApiClient from '../shared/api.js';
import TemplateParser from '../shared/template-parser.js';
import Markdown from '../shared/markdown.js';
import Storage from '../shared/storage.js';
import DocxExporter from '../shared/docx-export.js';
import DocxReader from '../shared/docx-reader.js';
import Format from '../shared/format.js';
import ExtractPrompt from '../shared/extract-prompt.js';
import ThemeToggle from '../shared/theme-toggle.js';

const state = {
  isGenerating: false,
  isAiParsing: false,
  abortController: null,
  template: null,  // {filename, size, skeleton, rawText, aiParsed}
  lastResult: '',
  // 实时状态：导入元信息（用于实时提示框）
  importMeta: null,  // {filename, topic, devices, funcs} — 仅在 doc-import 后设置
  isImporting: false,  // 导入过程中
};

// === DOM 引用 ===
function $(id) { return document.getElementById(id); }
const dom = {};

// === 初始化 ===
function initDom() {
  dom.topic = $('kaiti-topic');
  dom.devices = $('kaiti-devices');
  dom.funcs = $('kaiti-funcs');
  dom.refs = $('kaiti-refs');
  dom.deviceCount = $('kaiti-device-count');
  dom.funcCount = $('kaiti-func-count');
  dom.refCount = $('kaiti-ref-count');

  dom.btnImport = $('btn-import-kaiti');
  dom.fileImport = $('file-import-kaiti');

  dom.btnClearTopic = $('btn-clear-topic');
  dom.btnClearDevices = $('btn-clear-devices');
  dom.btnClearFuncs = $('btn-clear-funcs');
  dom.btnClearRefs = $('btn-clear-refs');

  dom.rawText = $('raw-text');
  dom.btnAiParse = $('btn-ai-parse');
  dom.aiParseStatus = $('ai-parse-status');

  dom.sourceInfo = $('source-info');
  dom.sourceText = dom.sourceInfo.querySelector('.source-text');

  dom.templateInput = $('template-input');
  dom.btnTemplateSelect = $('btn-template-select');
  dom.btnTemplateClear = $('btn-template-clear');
  dom.templateStatus = $('template-status');
  dom.templatePreview = $('template-preview');
  dom.skeletonCount = $('skeleton-count');
  dom.skeletonPreview = $('skeleton-preview');

  dom.btnGenerate = $('btn-generate');

  dom.outputEmpty = $('output-empty');
  dom.outputContent = $('output-content');
  dom.outputMd = $('output-md');

  dom.btnCopy = $('btn-copy');
  dom.btnDownload = $('btn-download');
  dom.btnReset = $('btn-reset');
}

function init() {
  initDom();
  UIContainer.initTheme();
  ThemeToggle.init();
  bindEvents();
  updateProgress();
  autoLoadFromStorage();
  updateCounts();
  refreshBanner();
}

// === 进度条 ===
function updateProgress() {
  const progress = Storage.Shared.getProgress();
  const stages = ['topic', 'taskbook', 'thesis', 'ppt'];
  stages.forEach((stage) => {
    const el = document.querySelector(`.workflow-step[data-stage="${stage}"]`);
    if (!el) return;
    const icon = el.querySelector('.step-icon');
    if (progress[stage]) {
      el.classList.add('done');
      el.classList.remove('active');
      if (icon) icon.textContent = '✓';
    } else if (stage === 'taskbook') {
      el.classList.add('active');
      el.classList.remove('done');
      if (icon) icon.textContent = '';
    } else {
      el.classList.remove('done', 'active');
      if (icon) icon.textContent = '';
    }
  });
}

// === 自动加载 shared 数据 ===
function autoLoadFromStorage() {
  const meta = Storage.Shared.getMeta();
  if (meta) {
    if (meta.topic && !dom.topic.value) dom.topic.value = meta.topic;
    if (meta.devices && meta.devices.length && !dom.devices.value) {
      dom.devices.value = Format.devicesToText(meta.devices);
    }
    if (meta.funcs && meta.funcs.length && !dom.funcs.value) {
      dom.funcs.value = Format.funcsToText(meta.funcs);
    }
  }
}

// === 实时更新提示框 ===
// 状态机：初始 → 加载中 → 已识别 ⇄ 已手动修改 → 已清空
const SOURCE_LABELS = {
  'ai':         '🤖 AI 生成方案',
  'library':    '📚 库项目',
  'kaiti':      '📝 开题报告反推',
  'doc-import': '📎 文档导入',
};

function refreshBanner() {
  // 1. 加载中
  if (state.isImporting) {
    dom.sourceText.textContent = '📎 AI 识别中...';
    return;
  }

  // 2. 检查当前是否有内容
  const topicVal = dom.topic.value.trim();
  const devicesVal = dom.devices.value.trim();
  const funcsVal = dom.funcs.value.trim();
  const hasContent = topicVal || devicesVal || funcsVal;

  // 3. 检查是否刚导入过
  if (state.importMeta) {
    const importedTopic = state.importMeta.topic.trim();
    const importedDevices = state.importMeta.devices.join('\n');
    const importedFuncs = state.importMeta.funcs.join('\n');
    const isModified =
      topicVal !== importedTopic.trim() ||
      devicesVal !== importedDevices.trim() ||
      funcsVal !== importedFuncs.trim();

    const deviceCount = state.importMeta.devices.length;
    const funcCount = state.importMeta.funcs.length;
    const namePart = `（${state.importMeta.filename}）`;

    if (isModified) {
      const dCount = devicesVal ? devicesVal.split('\n').filter(s => s.trim()).length : 0;
      const fCount = funcsVal ? funcsVal.split('\n').filter(s => s.trim()).length : 0;
      dom.sourceText.textContent = `📎 文档导入${namePart} · ✏️ 已手动修改 · 题目 + ${dCount} 项器件 + ${fCount} 项功能`;
    } else {
      dom.sourceText.textContent = `📎 文档导入${namePart} · AI 已识别题目 + ${deviceCount} 项器件 + ${funcCount} 项功能`;
    }
    return;
  }

  // 4. 有内容但未导入（可能是 storage 自动加载 + 手改了 / 或纯手填）
  if (hasContent) {
    const meta = Storage.Shared.getMeta();
    if (meta) {
      const label = SOURCE_LABELS[meta.source] || '📋 手动输入';
      const namePart = meta.kaitiFilename || meta.filename ? `（${meta.kaitiFilename || meta.filename}）` : '';
      const dCount = devicesVal ? devicesVal.split('\n').filter(s => s.trim()).length : 0;
      const fCount = funcsVal ? funcsVal.split('\n').filter(s => s.trim()).length : 0;
      dom.sourceText.textContent = `${label}${namePart} · 题目 + ${dCount} 项器件 + ${fCount} 项功能`;
    } else {
      const dCount = devicesVal ? devicesVal.split('\n').filter(s => s.trim()).length : 0;
      const fCount = funcsVal ? funcsVal.split('\n').filter(s => s.trim()).length : 0;
      dom.sourceText.textContent = `✏️ 手动填写中 · 题目 + ${dCount} 项器件 + ${fCount} 项功能`;
    }
    return;
  }

  // 5. 初始 / 已清空状态
  dom.sourceText.textContent = '未检测到方案数据，请手动填写题目/器件/功能，或点击右上"从文档导入方案"';
}

// === 计数 ===
function updateCounts() {
  const devices = Format.textToLines(dom.devices.value);
  const funcs = Format.textToLines(dom.funcs.value);
  const refs = Format.textToLines(dom.refs.value);
  dom.deviceCount.textContent = `(${devices.length})`;
  dom.funcCount.textContent = `(${funcs.length})`;
  dom.refCount.textContent = `(${refs.length})`;
}

// === 事件绑定 ===
function bindEvents() {
  // 实时更新提示框：每次输入都刷新状态
  dom.topic.addEventListener('input', () => { updateCounts(); refreshBanner(); });
  dom.devices.addEventListener('input', () => { updateCounts(); refreshBanner(); });
  dom.funcs.addEventListener('input', () => { updateCounts(); refreshBanner(); });
  dom.refs.addEventListener('input', updateCounts);

  // 从文档导入方案
  dom.btnImport.addEventListener('click', () => dom.fileImport.click());
  dom.fileImport.addEventListener('change', handleImportKaiti);

  // 清除按钮
  dom.btnClearTopic.addEventListener('click', () => { dom.topic.value = ''; refreshBanner(); dom.topic.focus(); });
  dom.btnClearDevices.addEventListener('click', () => { dom.devices.value = ''; updateCounts(); refreshBanner(); dom.devices.focus(); });
  dom.btnClearFuncs.addEventListener('click', () => { dom.funcs.value = ''; updateCounts(); refreshBanner(); dom.funcs.focus(); });
  dom.btnClearRefs.addEventListener('click', () => { dom.refs.value = ''; updateCounts(); refreshBanner(); dom.refs.focus(); });

  dom.btnTemplateSelect.addEventListener('click', () => dom.templateInput.click());
  dom.templateInput.addEventListener('change', handleTemplateUpload);
  dom.btnTemplateClear.addEventListener('click', clearTemplate);
  if (dom.btnAiParse) dom.btnAiParse.addEventListener('click', aiParseSkeleton);

  dom.btnGenerate.addEventListener('click', () => onGenerate());

  dom.btnCopy.addEventListener('click', onCopy);
  dom.btnDownload.addEventListener('click', onDownload);
  dom.btnReset.addEventListener('click', onResetResult);
}

// === 从文档导入方案：提取题目/器件/功能 ===
async function handleImportKaiti(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  if (!/\.(docx|txt)$/i.test(file.name)) {
    UIContainer.toast('请上传 .docx 或 .txt 文件', 'error');
    e.target.value = '';
    return;
  }

  // 防止重复点击
  dom.btnImport.disabled = true;
  state.abortController = UIContainer.showProgress(`正在读取文档: ${file.name} ...`);
  state.isImporting = true;
  refreshBanner();

  UIContainer.updateProgress(20, '读取文档中...');

  try {
    // 1. 读取文件
    const { text, meta } = await DocxReader.read(file);
    if (!text || text.length < 20) {
      throw new Error('文档内容过短或为空');
    }

    UIContainer.updateProgress(40, '调用 AI 提取方案...');

    // 2. 调用 AI 抽取
    const systemPrompt = ExtractPrompt.build();
    const truncated = text.length > 6000 ? text.slice(0, 6000) + '\n...（后略）' : text;
    const userMsg = `【开题报告原文】\n${truncated}`;
    const result = await ApiClient.chat({
      systemPrompt,
      userMessage: userMsg,
      temperature: 0.3,
      signal: state.abortController.signal,
    });

    UIContainer.updateProgress(80, '整理方案...');
    const parsed = ExtractPrompt.parse(result);

    UIContainer.updateProgress(100, '完成');

    // 3. 自动填充 3 个输入框
    if (parsed.topic) dom.topic.value = parsed.topic;
    if (parsed.devices.length) dom.devices.value = parsed.devices.join('\n');
    if (parsed.funcs.length) dom.funcs.value = parsed.funcs.join('\n');
    updateCounts();

    // 4. 记住导入源，供 refreshBanner 检测"已手动修改"
    state.importMeta = {
      filename: meta.filename,
      topic: parsed.topic,
      devices: parsed.devices,
      funcs: parsed.funcs,
    };
    state.isImporting = false;
    refreshBanner();

    const deviceCount = parsed.devices.length;
    const funcCount = parsed.funcs.length;
    UIContainer.toast(
      `已从 ${meta.filename} 导入方案：题目 + ${deviceCount} 项器件 + ${funcCount} 项功能`,
      'success'
    );

    setTimeout(() => UIContainer.hideProgress(), 500);
  } catch (err) {
    UIContainer.hideProgress();
    state.isImporting = false;
    refreshBanner();
    if (err.name === 'AbortError') {
      UIContainer.toast('已取消导入', 'info');
    } else {
      console.error(err);
      UIContainer.toast('导入失败：' + err.message, 'error');
    }
  } finally {
    dom.btnImport.disabled = false;
    dom.fileImport.value = '';
  }
}

// === 模板上传 ===
async function handleTemplateUpload(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  if (!/\.docx$/i.test(file.name)) {
    UIContainer.toast('请上传 .docx 文件', 'error');
    dom.templateInput.value = '';
    return;
  }

  dom.btnTemplateSelect.disabled = true;
  dom.templateStatus.textContent = '⏳ 解析模板骨架中...';

  try {
    const result = await TemplateParser.parse(file);
    state.template = result;

    dom.templateStatus.textContent = `✅ ${result.filename} (${Format.formatSize(result.size)})`;
    dom.skeletonCount.textContent = result.skeleton.length;
    dom.skeletonPreview.textContent = TemplateParser.previewSkeleton(result.skeleton);
    if (dom.rawText) dom.rawText.textContent = result.rawText.slice(0, 3000) + (result.rawText.length > 3000 ? '\n...（后略）' : '');
    if (dom.aiParseStatus) dom.aiParseStatus.textContent = `已提取 ${result.rawText.length} 字符原始文本`;
    dom.templatePreview.classList.remove('hidden');

    // 智能提示：如果骨架 < 8 项，提示用户启用 AI 解析
    if (result.skeleton.length < 8) {
      if (dom.aiParseStatus) {
        dom.aiParseStatus.textContent += ` · 骨架较少，建议点 [AI 智能解析] 优化`;
        dom.aiParseStatus.style.color = 'var(--color-warning, #f59e0b)';
      }
    }

    UIContainer.toast(`已提取 ${result.skeleton.length} 项本地骨架，AI 解析中...`, 'info');

    // 上传后自动调 AI 解析（只需章节）
    if (!state.isAiParsing) {
      aiParseSkeleton().catch(err => {
        console.warn('[taskbook] AI 解析失败，退到 regex 骨架', err);
      });
    }
  } catch (err) {
    console.error(err);
    UIContainer.toast('模板解析失败：' + err.message, 'error');
    dom.templateStatus.textContent = '解析失败（将用 11 章通用框架）';
  } finally {
    dom.btnTemplateSelect.disabled = false;
    dom.templateInput.value = '';
  }
}

function clearTemplate() {
  state.template = null;
  dom.templateInput.value = '';
  dom.templateStatus.textContent = '未上传（将用 11 章通用框架）';
  dom.templatePreview.classList.add('hidden');
  dom.skeletonCount.textContent = '0';
  dom.skeletonPreview.textContent = '';
  if (dom.rawText) dom.rawText.textContent = '';
  if (dom.aiParseStatus) {
    dom.aiParseStatus.textContent = '';
    dom.aiParseStatus.style.color = '';
  }
}

// === AI 智能解析骨架（上传后自动调用） ===
async function aiParseSkeleton() {
  if (!state.template) return;
  if (state.isAiParsing) return;

  state.isAiParsing = true;

  // 进入"AI 解析中"状态
  dom.skeletonPreview.classList.add('is-loading');
  dom.skeletonCount.textContent = '⏳';
  if (dom.aiParseStatus) {
    dom.aiParseStatus.textContent = '⏳ AI 解析中...';
    dom.aiParseStatus.style.color = 'var(--color-primary, #6366f1)';
  }

  try {
    const userMessage = `【学校开题报告模板 · 原始文本】(前 8000 字)
${state.template.rawText.slice(0, 8000)}

---

任务：只识别这份模板的【章节结构】。输出严格 JSON（不带 markdown 代码块）：

{
  "chapters": [
    { "num": "1", "title": "立题依据", "subChapters": [{ "num": "1.1", "title": "研究背景" }] },
    { "num": "2", "title": "研究目标", "subChapters": [...] }
  ]
}

要求：
1. 只输出章节结构，不输出表格/签字页/参考文献等元信息
2. 如果原模板用"第一部分"/"一"、"X"的中文编号，请转为"# 1"/"## 1.1"格式
3. 如果是"1"、"1.1"、"1.1.1"阿拉伯编号则保留
4. 如果没有明确的章节划分，返回 { "chapters": [] }
5. 最多识别前 10 个主章节（避免边角字段混入）

只输出 JSON，不要其他文字。`;

    const raw = await ApiClient.chat({
      systemPrompt: '你是开题报告模板章节提取专家。只输出严格 JSON。',
      userMessage,
      temperature: 0.2,
    });

    let jsonText = raw.trim();
    const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('AI 未返回有效 JSON');
    jsonText = jsonMatch[0];

    const parsed = JSON.parse(jsonText);
    const chapters = parsed.chapters || [];
    state.template.aiChapters = chapters;

    // 渲染章节列表为预览
    const lines = [];
    chapters.forEach(c => {
      lines.push(`# ${c.num} ${c.title}`);
      (c.subChapters || []).forEach(sc => {
        lines.push(`  ## ${sc.num} ${sc.title}`);
      });
    });

    dom.skeletonPreview.textContent = lines.join('\n') || '⚠️ 未识别到章节';
    dom.skeletonCount.textContent = `${chapters.length} 个主章节`;
    if (dom.aiParseStatus) {
      dom.aiParseStatus.textContent = `✅ AI 识别完成`;
      dom.aiParseStatus.style.color = 'var(--color-success, #10b981)';
    }
  } catch (err) {
    console.warn('[taskbook] AI 解析失败，退到 regex:', err);
    // fallback：保留 regex 骨架显示
    dom.aiParseStatus.textContent = `⚠️ AI 失败，使用本地骨架（可能不准确）`;
    dom.aiParseStatus.style.color = 'var(--color-warning, #f59e0b)';
  } finally {
    state.isAiParsing = false;
    dom.skeletonPreview.classList.remove('is-loading');
  }
}

// === 加载 prompt ===
async function loadPrompt() {
  const res = await fetch('prompt.md');
  if (!res.ok) throw new Error('prompt.md 加载失败');
  const text = await res.text();
  // 去掉 BOM（防 UTF-8 BOM）
  return text.replace(/^\uFEFF/, '');
}

// === 构建 user message ===
function buildUserMessage({ topic, devices, funcs, refs, template, skeletonText }) {
  const parts = [];

  parts.push(`【题目】${topic || '（未填）'}`);

  if (devices.length) {
    parts.push(`【器件清单】\n${devices.map((d, i) => (i + 1) + '. ' + d).join('\n')}`);
  } else {
    parts.push(`【器件清单】（未提供 — 请根据题目和功能推断合理选型，主控+电源必须包括）`);
  }

  if (funcs.length) {
    parts.push(`【功能要求】\n${funcs.map((f, i) => (i + 1) + '. ' + f).join('\n')}`);
  } else {
    parts.push(`【功能要求】（未提供 — 请根据题目推导 5-10 条核心功能）`);
  }

  // 优先使用 AI 解析后的结构化骨架（更准确）
  if (template && template.aiChapters && template.aiChapters.length) {
    const skLines = ['【AI 解析出的章节】（严格按此结构生成）'];
    template.aiChapters.forEach(c => {
      skLines.push(`# ${c.num} ${c.title}`);
      (c.subChapters || []).forEach(sc => {
        skLines.push(`## ${sc.num} ${sc.title}`);
      });
    });
    parts.push(skLines.join('\n'));
  } else if (template && skeletonText) {
    parts.push(`【模板骨架】（严格按此结构生成）\n${skeletonText}`);
  } else {
    parts.push(`【模板】未提供，使用 11 章通用框架：\n` +
      `# 1 立题依据\n## 1.1 研究背景\n## 1.2 研究的目的和意义\n## 1.3 国内外研究现状述评\n` +
      `# 2 研究的主要内容及预期目标\n## 2.1 研究的主要内容\n## 2.2 研究的预期目标\n` +
      `# 3 研究方案\n## 3.1 研究方法\n## 3.2 技术方案（系统总体架构/硬件方案/软件方案）\n` +
      `# 4 进度安排\n# 5 主要参考文献`);
  }

  if (refs.length) {
    parts.push(`【参考文献】（用户提供，按 GB/T 7714 格式）\n${refs.join('\n')}`);
  } else {
    parts.push(`【参考文献】用户未提供，请在参考文献章节写占位符："[1]-[10] 待补充真实文献，开题阶段占位"。国内外研究现状按通用技术路线描述，不编造学者姓名。`);
  }

  parts.push(`请按 prompt 中 v0.6 的规则生成开题报告正文，输出纯 Markdown，不带任何额外说明。`);

  return parts.join('\n\n');
}

// === 清理 AI 返回 ===
function cleanResult(text) {
  if (!text) return '';
  let cleaned = text;

  // 1. 去掉 <think>...</think>
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '');

  // 2. 去掉 markdown 代码块包裹
  cleaned = cleaned.replace(/^```(?:markdown|md)?\s*\n/i, '');
  cleaned = cleaned.replace(/\n```\s*$/i, '');
  cleaned = cleaned.replace(/^```\s*\n/, '').replace(/\n```\s*$/, '');

  // 3. 去掉开头元描述
  cleaned = cleaned.replace(/^(好的|我来|以下是|下面是|下面我来|好的以下是|好的，下面是)[，,。.：:\s]*/i, '');
  cleaned = cleaned.replace(/^(以下是|下面是)[\s\S]{0,30}?(开题报告|报告内容|正文)[\s]*[:：]?\s*/i, '');

  return cleaned.trim();
}

// === 生成 ===
async function onGenerate() {
  if (state.isGenerating) {
    UIContainer.toast('正在生成中，请稍候', 'info');
    return;
  }

  const topic = dom.topic.value.trim();
  if (!topic) {
    UIContainer.toast('请先填写题目', 'error');
    dom.topic.focus();
    return;
  }

  const devices = Format.textToLines(dom.devices.value);
  // 器件为空不阻挡（AI 可自动推断）

  const funcs = Format.textToLines(dom.funcs.value);
  if (funcs.length === 0) {
    UIContainer.toast('至少需要 1 条功能', 'error');
    dom.funcs.focus();
    return;
  }

  const refs = Format.textToLines(dom.refs.value);
  const skeletonText = state.template
    ? TemplateParser.formatSkeleton(state.template.skeleton)
    : '';

  // 全屏进度加载（与 topic 一致）
  state.isGenerating = true;
  dom.btnGenerate.disabled = true;
  dom.btnGenerate.classList.add('is-loading');
  dom.outputEmpty.classList.add('hidden');
  dom.outputContent.classList.add('hidden');

  state.abortController = UIContainer.showProgress(
    state.template
      ? '正在按模板适配生成开题报告...'
      : '正在生成开题报告（11 章通用框架）...'
  );
  UIContainer.updateProgress(20, '正在准备请求...');

  try {
    const systemPrompt = await loadPrompt();
    const userMessage = buildUserMessage({
      topic, devices, funcs, refs,
      template: state.template,
      skeletonText,
    });

    UIContainer.updateProgress(40, '正在调用 AI 生成...');

    const raw = await ApiClient.chat({
      systemPrompt,
      userMessage,
      signal: state.abortController.signal,
      temperature: 0.7,
    });

    UIContainer.updateProgress(80, '正在整理结果...');

    const cleaned = cleanResult(raw);

    if (!cleaned || cleaned.length < 100) {
      throw new Error('生成结果过短，可能生成失败');
    }

    UIContainer.updateProgress(100, '生成成功');
    state.lastResult = cleaned;
    renderOutput(cleaned);

    // 写入 storage
    Storage.Shared.setKaiti(cleaned);
    Storage.Shared.markComplete('taskbook');
    updateProgress();

    setTimeout(() => UIContainer.hideProgress(), 600);
    UIContainer.toast('开题报告生成完成', 'success');
  } catch (err) {
    if (err.name === 'AbortError') {
      UIContainer.toast('已取消生成', 'info');
    } else {
      console.error(err);
      UIContainer.toast('生成失败：' + err.message, 'error');
    }
    dom.outputEmpty.classList.remove('hidden');
    UIContainer.hideProgress();
  } finally {
    state.isGenerating = false;
    dom.btnGenerate.disabled = false;
    dom.btnGenerate.classList.remove('is-loading');
  }
}

// === 渲染输出 ===
function renderOutput(md) {
  dom.outputMd.innerHTML = Markdown.render(md);
  dom.outputEmpty.classList.add('hidden');
  dom.outputContent.classList.remove('hidden');
}

// === 工具栏 ===
async function onCopy() {
  if (!state.lastResult) {
    UIContainer.toast('暂无可复制内容', 'info');
    return;
  }
  try {
    await navigator.clipboard.writeText(state.lastResult);
    UIContainer.toast('已复制到剪贴板', 'success');
  } catch {
    // fallback
    const ta = document.createElement('textarea');
    ta.value = state.lastResult;
    document.body.appendChild(ta);
    ta.select();
    const success = document.execCommand('copy');
    ta.remove();
    if (success) {
      UIContainer.toast('已复制', 'success');
    } else {
      UIContainer.toast('复制失败，请手动复制', 'error');
    }
  }
}

async function onDownload() {
  if (!state.lastResult) {
    UIContainer.toast('暂无可下载内容', 'info');
    return;
  }
  const topic = dom.topic.value.trim() || '开题报告';
  const filename = Format.sanitizeFilename(`${topic}_开题报告.docx`);
  try {
    await DocxExporter.downloadDocx(state.lastResult, filename);
    UIContainer.toast('已开始下载', 'success');
  } catch (err) {
    console.error(err);
    UIContainer.toast('下载失败：' + err.message, 'error');
  }
}

function onResetResult() {
  // 清输出
  state.lastResult = '';
  dom.outputMd.innerHTML = '';
  dom.outputEmpty.classList.remove('hidden');
  dom.outputContent.classList.add('hidden');

  // 清 5 个输入框
  dom.topic.value = '';
  dom.devices.value = '';
  dom.funcs.value = '';
  dom.refs.value = '';
  clearTemplate();  // 清模板 + aiChapters + rawText 面板

  // 清导入状态（重置实时提示框）
  state.importMeta = null;
  state.isImporting = false;

  // 清 storage
  Storage.Shared.setKaiti('');
  Storage.Shared.markIncomplete('taskbook');
  updateProgress();
  updateCounts();
  refreshBanner();  // 实时提示框同步重置为初始状态

  UIContainer.toast('已复位所有内容', 'success');
}

// === 启动 ===
init();