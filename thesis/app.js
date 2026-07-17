/* ============================================================
 * thesis/app.js - 论文生成主逻辑（v15.6 · taskbook对齐版）
 * ============================================================
 * - 启动从 Storage.Shared.getMeta() 自动加载题目/器件/功能
 * - 用户可手动输入 / 上传文档 / 上传模板
 * - 上传文档 → AI 拆解 → 填入输入框
 * - 上传模板 → 提取格式信息（字号/字体/缩进）
 * - 「下一步：论文」按钮跨页数据流（topic → thesis）
 * - 中央进度遮罩（与 topic / taskbook 一致）
 * ============================================================ */

import { callMinimax, extractFromDocx, countCnChars, getHardcodedApiKey, aiParsePlan } from './thesis-helpers.js';
import { exportPaperDocx } from '../shared/thesis-docx-export.js';
import UIContainer from '../shared/ui-kit.js';
import Storage from '../shared/storage.js';
import Format from '../shared/format.js';
import ThemeToggle from '../shared/theme-toggle.js';  // 【v15.9.5】修复 ThemeToggle undefined 错误

// ===== 全局状态 =====
const state = {
  topic: '',
  devices: [],
  funcs: [],
  outline: [],         // 参考目录（章节目录）
  refs: [],            // 参考文献
  templateInfo: null,  // {filename, size, fontSize, fontFamily, firstLineIndent}
  codeFiles: [],       // 【v15.10.0】[{name, size, lines, content}]
  codeContext: '',     // 【v15.10.0】合并后的代码字符串（≤ 8000 字）
  pdfContext: '',      // 【v15.10.4】原理图分析报告（手动粘贴）
  wordCount: 15000,
  chapters: {},        // {1: '...', 2: '...', ...}
  abstractCn: '',
  abstractEn: '',
  ack: '',
  referencesText: '',
  stats: { words: 0, figs: 0, refs: 0, indent: 0 },
  generating: false,
  upstreamMeta: null,
  startTs: null,
};

// ===== DOM 引用 =====
const $ = id => document.getElementById(id);
const dom = {};

function bindDom() {
  [
    'input-topic', 'input-devices', 'input-funcs',
    'input-outline', 'input-refs',
    'btn-clear-topic', 'btn-clear-devices', 'btn-clear-funcs',
    'btn-clear-outline', 'btn-clear-refs',
    'device-count', 'func-count', 'outline-count', 'ref-count',
    'btn-generate', 'btn-reset', 'btn-download',
    'btn-copy-toggle', 'copy-dropdown', 'copy-menu',
    'source-info', 'source-text', 'source-card',
    'result-empty', 'result-content', 'result-status', 'result-time',
    'chapter-list', 'extras-section', 'log-panel', 'log-content',
    'abstract-cn', 'abstract-en', 'acknowledgment', 'references',
    'quality-stats', 'q-words', 'q-figs', 'q-refs', 'q-indent',
    // 上传方案文档
    'file-input', 'import-zone', 'import-preview',
    'preview-filename', 'preview-meta',
    'preview-topic', 'preview-devices', 'preview-funcs',
    'btn-clear-upload',
    // 上传模板
    'template-input', 'template-zone', 'template-preview',
    'template-filename', 'template-meta',
    'template-fontsize', 'template-fontfamily', 'template-indent',
    'btn-template-clear',
    // 【v15.10.4】原理图上下文（去除 PDF 上传，纯粘贴）
    'schematic-preview',
    'schematic-filename', 'schematic-chars',
    'schematic-text',
    'btn-schematic-clear',
    'btn-schematic-paste',
    'schematic-paste-modal',
    'schematic-paste-textarea',
    'btn-schematic-paste-close',
    'btn-schematic-paste-cancel',
    'btn-schematic-paste-confirm',
    // 【v15.10.0】软件代码上下文
    'code-input', 'code-zone', 'code-preview',
    'code-stat-files', 'code-stat-lines', 'code-stat-chars',
    'code-list', 'code-paste',
    'btn-code-clear',
    // AI 整理
    'btn-ai-polish',
  ].forEach(id => dom[id] = $(id));
}

// ===== 启动 =====
export function initApp() {
  console.log('[thesis v15.10.0] initApp 启动');
  try { bindDom(); console.log('[thesis] bindDom OK'); } catch (e) { console.error('[thesis] bindDom ERR:', e); }
  try { bindEvents(); console.log('[thesis] bindEvents OK'); } catch (e) { console.error('[thesis] bindEvents ERR:', e); }
  try { UIContainer.initTheme(); console.log('[thesis] initTheme OK'); } catch (e) { console.error('[thesis] initTheme ERR:', e); }
  try { ThemeToggle.init(); console.log('[thesis] ThemeToggle.init OK'); } catch (e) { console.error('[thesis] ThemeToggle.init ERR:', e); }
  console.log('[thesis] initApp 完成');
  console.log('[thesis] data-theme after init:', document.documentElement.getAttribute('data-theme'));
  refreshSourceBanner();
  loadFromStorage();
  updateCounts();
  markProgress();
  log('页面初始化完成', 'info');
}

function bindEvents() {
  // 输入框变化 → 实时计数
  ['input-topic', 'input-devices', 'input-funcs', 'input-outline', 'input-refs'].forEach(id => {
    const el = $(id);
    if (el) el.addEventListener('input', () => {
      updateCounts();
      refreshSourceBanner();
    });
  });

  // 清除按钮
  dom['btn-clear-topic'].addEventListener('click', () => { dom['input-topic'].value = ''; updateCounts(); refreshSourceBanner(); dom['input-topic'].focus(); });
  dom['btn-clear-devices'].addEventListener('click', () => { dom['input-devices'].value = ''; updateCounts(); refreshSourceBanner(); dom['input-devices'].focus(); });
  dom['btn-clear-funcs'].addEventListener('click', () => { dom['input-funcs'].value = ''; updateCounts(); refreshSourceBanner(); dom['input-funcs'].focus(); });
  dom['btn-clear-outline'].addEventListener('click', () => { dom['input-outline'].value = ''; updateCounts(); refreshSourceBanner(); dom['input-outline'].focus(); });
  dom['btn-clear-refs'].addEventListener('click', () => { dom['input-refs'].value = ''; updateCounts(); refreshSourceBanner(); dom['input-refs'].focus(); });

  // 字数选择
  document.querySelectorAll('input[name="wordcount"]').forEach(r => {
    r.addEventListener('change', () => {
      state.wordCount = parseInt(r.value);
      document.querySelectorAll('[data-wc]').forEach(c => c.classList.remove('active'));
      r.closest('.level-card').classList.add('active');
    });
  });

  // 生成按钮
  dom['btn-generate'].addEventListener('click', startGeneration);

  // 工具按钮
  dom['btn-reset'].addEventListener('click', resetAll);
  dom['btn-download'].addEventListener('click', downloadDocx);

  // 复制下拉
  const btnCopyToggle = $('btn-copy-toggle');
  const copyDropdown = $('copy-dropdown');
  if (btnCopyToggle && copyDropdown) {
    btnCopyToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = copyDropdown.classList.toggle('open');
      btnCopyToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });
    copyDropdown.querySelectorAll('.dropdown-item').forEach(item => {
      item.addEventListener('click', () => {
        copyAbstract(item.dataset.copy);
        copyDropdown.classList.remove('open');
        btnCopyToggle.setAttribute('aria-expanded', 'false');
      });
    });
    document.addEventListener('click', () => {
      copyDropdown.classList.remove('open');
      btnCopyToggle.setAttribute('aria-expanded', 'false');
    });
  }

  // 上传方案文档
  if (dom['file-input']) {
    dom['file-input'].addEventListener('change', handleFileUpload);
  }
  if (dom['btn-clear-upload']) {
    dom['btn-clear-upload'].addEventListener('click', clearUploadedFile);
  }
  setupDragAndDrop(dom['import-zone'], dom['file-input'], handleFileUpload);

  // 上传模板
  if (dom['template-input']) {
    dom['template-input'].addEventListener('change', handleTemplateUpload);
  }
  if (dom['btn-template-clear']) {
    dom['btn-template-clear'].addEventListener('click', clearTemplate);
  }
  setupDragAndDrop(dom['template-zone'], dom['template-input'], handleTemplateUpload);

  // 【v15.10.0】上传代码文件（多选）
  if (dom['code-input']) {
    dom['code-input'].addEventListener('change', handleCodeFiles);
  }
  if (dom['btn-code-clear']) {
    dom['btn-code-clear'].addEventListener('click', clearCode);
  }
  if (dom['code-paste']) {
    dom['code-paste'].addEventListener('input', handleCodePasteChange);
  }
  setupDragAndDrop(dom['code-zone'], dom['code-input'], handleCodeFiles);

  // 【v15.10.4】原理图上下文：纯粘贴，无 PDF 上传
  if (dom['btn-schematic-clear']) {
    dom['btn-schematic-clear'].addEventListener('click', clearSchematic);
  }
  if (dom['schematic-text']) {
    dom['schematic-text'].addEventListener('input', handleSchematicTextChange);
  }
  if (dom['btn-schematic-paste']) {
    dom['btn-schematic-paste'].addEventListener('click', openSchematicPasteModal);
  }
  if (dom['btn-schematic-paste-close']) {
    dom['btn-schematic-paste-close'].addEventListener('click', closeSchematicPasteModal);
  }
  if (dom['btn-schematic-paste-cancel']) {
    dom['btn-schematic-paste-cancel'].addEventListener('click', closeSchematicPasteModal);
  }
  if (dom['btn-schematic-paste-confirm']) {
    dom['btn-schematic-paste-confirm'].addEventListener('click', confirmSchematicPaste);
  }


  // AI 整理
  if (dom['btn-ai-polish']) {
    dom['btn-ai-polish'].addEventListener('click', aiPolishInputs);
  }

  // 快捷键 Ctrl+Enter（v15.8 统一 · 与 topic 对齐）
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (!state.generating && typeof startGeneration === 'function') {
        const topicVal = (dom['input-topic']?.value || '').trim();
        if (topicVal) startGeneration();
      }
    }
  });
}

// ===== 拖拽上传通用 =====
function setupDragAndDrop(zone, fileInput, handler) {
  if (!zone || !fileInput) return;
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('drag-over');
  });
  zone.addEventListener('dragleave', () => {
    zone.classList.remove('drag-over');
  });
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const file = e.dataTransfer?.files?.[0];
    if (file) handler({ target: { files: [file] } });
  });
}

// ===== 实时计数 =====
function updateCounts() {
  const devices = (dom['input-devices']?.value || '').split(/[、,，\s\n]+/).filter(Boolean);
  const funcs = (dom['input-funcs']?.value || '').split(/[\r\n]+/).map(s => s.trim()).filter(Boolean);
  const outline = (dom['input-outline']?.value || '').split(/[\r\n]+/).map(s => s.trim()).filter(Boolean);
  const refs = (dom['input-refs']?.value || '').split(/[\r\n]+/).map(s => s.trim()).filter(Boolean);
  if (dom['device-count']) dom['device-count'].textContent = `(${devices.length})`;
  if (dom['func-count']) dom['func-count'].textContent = `(${funcs.length})`;
  if (dom['outline-count']) dom['outline-count'].textContent = `(${outline.length})`;
  if (dom['ref-count']) dom['ref-count'].textContent = `(${refs.length})`;
}

// ===== 来源提示横幅 =====
function refreshSourceBanner() {
  const topic = (dom['input-topic']?.value || '').trim();
  const devices = (dom['input-devices']?.value || '').trim();
  const funcs = (dom['input-funcs']?.value || '').trim();
  const sourceText = dom['source-text'];
  if (!sourceText) return;

  const deviceCount = (dom['input-devices']?.value || '').split(/[、,，\s\n]+/).filter(Boolean).length;
  const funcCount = (dom['input-funcs']?.value || '').split(/[\r\n]+/).map(s => s.trim()).filter(Boolean).length;
  const outlineCount = (dom['input-outline']?.value || '').split(/[\r\n]+/).map(s => s.trim()).filter(Boolean).length;
  const refCount = (dom['input-refs']?.value || '').split(/[\r\n]+/).map(s => s.trim()).filter(Boolean).length;

  if (state.upstreamMeta) {
    const sourceName = state.upstreamMeta.kaitiFilename ? '开题报告生成' : '方案生成';
    sourceText.textContent = `✓ 已从「${sourceName}」带入：题目 + ${deviceCount} 器件 + ${funcCount} 功能${outlineCount ? ' + ' + outlineCount + ' 目录' : ''}${refCount ? ' + ' + refCount + ' 参考文献' : ''}`;
  } else if (topic || devices || funcs) {
    sourceText.textContent = `✍️ 手动填写中：题目 + ${deviceCount} 器件 + ${funcCount} 功能${outlineCount ? ' + ' + outlineCount + ' 目录' : ''}${refCount ? ' + ' + refCount + ' 参考文献' : ''}`;
  } else {
    sourceText.textContent = '💡 三种方式填入题目/器件/功能：从「方案生成」带入 / 上传文档 / 手动输入';
  }
}

// ===== AI 整理填入内容 =====
async function aiPolishInputs() {
  const topicVal = (dom['input-topic']?.value || '').trim();
  const devicesVal = (dom['input-devices']?.value || '').trim();
  const funcsVal = (dom['input-funcs']?.value || '').trim();

  if (!topicVal && !devicesVal && !funcsVal) {
    toast('请先填入题目 / 器件 / 功能', 'error');
    return;
  }

  const apiKey = getHardcodedApiKey();
  if (!apiKey) {
    toast('API 未初始化', 'error');
    return;
  }

  if (dom['btn-ai-polish']) {
    dom['btn-ai-polish'].disabled = true;
    dom['btn-ai-polish'].textContent = '⏳ AI 整理中...';
  }

  const abort = UIContainer.showProgress('AI 整理填入内容...');
  UIContainer.updateProgress(30, '调用 AI 补全题目 + 整理器件');

  try {
    const sys = [
      '你是单片机/嵌入式系统写作助手。任务是“整理”用户输入的论文信息，不许改变原意。',
      '',
      '【【v15.10.6】题目不变原则（用户对齐 · 最重要）】',
      '- **严格保留用户输入的原题，一字不改**',
      '- ❌ 不许加修饰词（「超/智能/多功能/养护/系统/设计/基于 STM32 的」等）',
      '- ❌ 不许扩写、缩简、换成更“学术”的题目格式',
      '- 用户写「智能鱼缸」→ 返回「智能鱼缸」（**不是**「超智能鱼缸养护系统」）',
      '- 用户写什么就返回什么，原封不动',
      '',
      '【整理器件】',
      '- 保留全部型号，去重',
      '- 剔除 [object Object] 这种坏数据',
      '- 输出格式：型号 1、型号 2、型号 3',
      '- 如有角色信息，保留为 型号（角色） 格式',
      '',
      '【整理功能】',
      '- 保留全部功能，去重 / 合并相似描述',
      '- 一行一条功能',
      '- 剔除 [object Object]、乱码、空行',
      '',
      '【输出格式】严格 JSON，不加额外文字：',
      '{',
      '  "topic": "完整题目",',
      '  "devices": "型号1、型号2",',
      '  "funcs": "功能1\\n功能2\\n功能3"',
      '}',
    ].join('\n');
    const userMsg = `【当前题目】\n${topicVal || '（空）'}\n\n【当前器件】\n${devicesVal || '（空）'}\n\n【当前功能】\n${funcsVal || '（空）'}`;
    const result = await callMinimax(apiKey, [
      { role: 'system', content: sys },
      { role: 'user', content: userMsg },
    ], { temperature: 0.3, max_tokens: 1500 });

    UIContainer.updateProgress(80, '解析返回结果');

    let text = (result.text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    // 提取 JSON 块
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('AI 返回不含 JSON');
    let parsed;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (e) {
      throw new Error('JSON 解析失败：' + e.message);
    }

    // 【v15.10.6】题目不覆盖——AI 可能改题，用原值保持
    // （题目如果 AI 返回改了，就丢弃，用用户输入的原值）
    if (parsed.topic && typeof parsed.topic === 'string' && parsed.topic.trim() === topicVal) {
      dom['input-topic'].value = parsed.topic.trim();
    }
    if (parsed.devices && typeof parsed.devices === 'string') {
      dom['input-devices'].value = parsed.devices.trim();
    }
    if (parsed.funcs && typeof parsed.funcs === 'string') {
      dom['input-funcs'].value = parsed.funcs.trim();
    }

    UIContainer.updateProgress(100, '完成');
    setTimeout(() => UIContainer.hideProgress(), 400);

    updateCounts();
    refreshSourceBanner();
    toast('✓ AI 整理完成', 'success');
    log('AI 整理完成', 'success');
  } catch (err) {
    console.error('[thesis] ai polish failed', err);
    toast('AI 整理失败：' + err.message, 'error');
    log('AI 整理失败：' + err.message, 'error');
    UIContainer.hideProgress();
  } finally {
    if (dom['btn-ai-polish']) {
      dom['btn-ai-polish'].disabled = false;
      dom['btn-ai-polish'].textContent = '✨ AI 整理';
    }
  }
}

// ===== 实时字数预估 =====
// 字数预估已删除（v15.8）

// ===== 从 Storage.Shared 读取上游数据 =====
// 【v15.8 修复】使用 Format.devicesToText / funcsToText 正确处理对象数组（避免 [object Object]）
function loadFromStorage() {
  let meta = null;
  try {
    meta = Storage.Shared.getMeta();
  } catch (e) {
    console.warn('Storage.Shared not ready', e);
  }

  if (!meta || (!meta.topic && !meta.devices && !meta.funcs)) {
    state.upstreamMeta = null;
    refreshSourceBanner();
    log('未检测到上游数据，可手动输入或上传文档', 'info');
  } else {
    state.upstreamMeta = meta;
    state.topic = meta.topic || '';

    // 【关键】统一为 string[] 格式：支持 string[]、[{model,role}]、[{text}] 三种入参
    state.devices = normalizeToStringArray(meta.devices, 'model');
    state.funcs = normalizeToStringArray(meta.funcs, 'text');

    dom['input-topic'].value = state.topic;
    dom['input-devices'].value = state.devices.join('、');
    dom['input-funcs'].value = state.funcs.join('\n');

    refreshSourceBanner();
    updateCounts();
    log(`从上游加载：题目+${state.devices.length}器件+${state.funcs.length}功能`, 'info');
  }

  // 【v15.9.5】恢复上次生成结果（即使没上游数据，也能从自己的缓存恢复）
  try {
    const saved = Storage.Shared.getThesis();
    if (saved && saved.chapters && Object.keys(saved.chapters).length) {
      state.chapters = saved.chapters;
      state.abstractCn = saved.abstractCn || '';
      state.abstractEn = saved.abstractEn || '';
      state.ack = saved.ack || '';
      state.referencesText = saved.references || '';
      state.stats = saved.stats || state.stats;
      // 渲染章节
      renderChaptersFromState();
      // 渲染摘要/致谢/参考文献
      if (saved.abstractCn) dom['abstract-cn'].textContent = saved.abstractCn;
      if (saved.abstractEn) dom['abstract-en'].textContent = saved.abstractEn;
      if (saved.ack) dom['acknowledgment'].textContent = saved.ack;
      if (saved.references) dom['references'].textContent = saved.references;
      if (saved.abstractCn || saved.abstractEn || saved.ack) {
        dom['extras-section'].classList.remove('hidden');
      }
      // 切到结果区
      dom['result-empty'].classList.add('hidden');
      dom['result-content'].classList.remove('hidden');
      dom['result-status'].textContent = '✅ 已生成（从缓存恢复）';
      dom['result-status'].style.color = 'var(--color-success)';
      log('从 Storage 恢复上次生成结果', 'info');
    }
  } catch (e) {
    console.warn('Failed to restore thesis from storage', e);
  }
}

// 【v15.9.5】根据 state.chapters 渲染章节列表（从缓存恢复时调用）
function renderChaptersFromState() {
  const list = dom['chapter-list'];
  if (!list) return;
  list.innerHTML = '';
  CHAPTERS.forEach(ch => {
    const content = state.chapters[ch.id];
    if (!content) return;
    const item = document.createElement('div');
    item.className = 'chapter-item';
    item.innerHTML = `
      <div class="chapter-header">
        <span class="chapter-num">Ch${ch.id}</span>
        <span class="chapter-title">${ch.title}</span>
        <span class="chapter-status completed">✓ ${countCnChars(content)} 字</span>
      </div>
    `;
    list.appendChild(item);
  });
}

// 把上游的混乱格式统一转为 string[]
function normalizeToStringArray(arr, objectKey) {
  if (!Array.isArray(arr)) return [];
  return arr.map(item => {
    if (typeof item === 'string') return item.trim();
    if (item && typeof item === 'object') {
      const value = item[objectKey] || item.model || item.text || item.name || '';
      if (value) return String(value).trim();
    }
    return '';
  }).filter(Boolean);
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ===== 工作流进度 =====
function markProgress() {
  try {
    const progress = Storage.Shared.getProgress() || {};
    document.querySelectorAll('.workflow-step').forEach(el => {
      const stage = el.dataset.stage;
      el.classList.remove('active', 'done');
      if (progress[stage]) {
        el.classList.add('done');
      }
    });
    document.querySelector('.workflow-step[data-stage="thesis"]')?.classList.add('active');
  } catch (e) {}
}

// ===== 章节定义 =====
const CHAPTERS = [
  { id: 1, title: '绪论', percent: 0.13, desc: '研究背景、意义、国内外现状、章节安排（[n] 引用唯一允许处）', priority: 'normal' },
  { id: 2, title: '系统总体设计', percent: 0.10, desc: '需求分析、总体架构、模块划分、器件选型', priority: 'normal' },
  { id: 3, title: '硬件设计', percent: 0.30, desc: '主控电路、传感器电路、执行器电路、电源设计（锁定器件）', priority: 'high' },
  { id: 4, title: '软件设计', percent: 0.23, desc: '主程序流程图、模块流程图、算法设计（5 张双轨流程图）', priority: 'high' },
  { id: 5, title: '系统测试', percent: 0.17, desc: '硬件测试、软件测试、联调测试、测试结果分析', priority: 'normal' },
  { id: 6, title: '项目总结', percent: 0.07, desc: '完成情况、存在问题、改进方向、项目心得', priority: 'normal' },
];

// ===== 上传方案文档 =====
async function handleFileUpload(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  if (!/\.(docx|txt)$/i.test(file.name)) {
    toast('请上传 .docx 或 .txt 文件', 'error');
    if (dom['file-input']) dom['file-input'].value = '';
    return;
  }

  if (!window.mammoth) {
    toast('mammoth.js 未加载，无法读取 .docx', 'error');
    return;
  }

  toast(`AI 拆解 ${file.name} 中...`, 'info');

  try {
    let text = '';
    if (file.name.endsWith('.docx')) {
      text = await extractFromDocx(file);
    } else {
      text = await file.text();
    }
    if (!text || text.length < 5) {
      throw new Error('文档内容为空或过短');
    }

    const apiKey = getHardcodedApiKey();
    if (!apiKey) {
      throw new Error('初始化失败，请联系维护者');
    }
    const parsed = await aiParsePlan(apiKey, text);

    if (!parsed.topic && parsed.devices.length === 0 && parsed.funcs.length === 0) {
      throw new Error('AI 未拆解出题目/器件/功能');
    }

    if (parsed.topic) dom['input-topic'].value = parsed.topic;
    if (parsed.devices.length) dom['input-devices'].value = parsed.devices.join('、');
    if (parsed.funcs.length) dom['input-funcs'].value = parsed.funcs.join('\n');

    showUploadPreview(file, parsed);

    updateCounts();
    refreshSourceBanner();
    toast(`AI 拆解完成：${parsed.devices.length} 器件 + ${parsed.funcs.length} 功能`, 'success');
  } catch (err) {
    console.error('[thesis] upload parse failed', err);
    toast('拆解失败：' + err.message, 'error');
  } finally {
    if (dom['file-input']) dom['file-input'].value = '';
  }
}

function showUploadPreview(file, parsed) {
  if (!dom['import-zone'] || !dom['import-preview']) return;
  dom['import-zone'].classList.add('hidden');
  dom['import-preview'].classList.remove('hidden');
  if (dom['btn-clear-upload']) dom['btn-clear-upload'].style.display = 'inline-block';

  if (dom['preview-filename']) dom['preview-filename'].textContent = file.name;
  if (dom['preview-meta']) dom['preview-meta'].textContent = (file.size / 1024).toFixed(1) + ' KB';
  if (dom['preview-topic']) dom['preview-topic'].textContent = parsed.topic || '（未识别）';
  if (dom['preview-devices']) {
    const ds = parsed.devices.slice(0, 6).join('、');
    dom['preview-devices'].textContent = parsed.devices.length > 6
      ? `${ds} ... (共 ${parsed.devices.length} 项)`
      : `${ds} (共 ${parsed.devices.length} 项)`;
  }
  if (dom['preview-funcs']) {
    dom['preview-funcs'].textContent = `共 ${parsed.funcs.length} 项 · ${parsed.funcs.slice(0, 2).join('；')}${parsed.funcs.length > 2 ? '...' : ''}`;
  }
}

function clearUploadedFile() {
  if (!dom['import-zone'] || !dom['import-preview']) return;
  dom['import-zone'].classList.remove('hidden');
  dom['import-preview'].classList.add('hidden');
  if (dom['btn-clear-upload']) dom['btn-clear-upload'].style.display = 'none';
  if (dom['file-input']) dom['file-input'].value = '';

  // 清空输入框内容
  dom['input-topic'].value = '';
  dom['input-devices'].value = '';
  dom['input-funcs'].value = '';

  updateCounts();
  refreshSourceBanner();
  toast('已清除上传', 'info');
}

// ===== 上传论文模板（提取格式信息） =====
async function handleTemplateUpload(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  if (!/\.docx$/i.test(file.name)) {
    toast('请上传 .docx 文件', 'error');
    if (dom['template-input']) dom['template-input'].value = '';
    return;
  }

  if (!window.mammoth) {
    toast('mammoth.js 未加载', 'error');
    return;
  }

  toast(`解析模板 ${file.name}...`, 'info');

  try {
    // 读取 docx 文本，提取格式（粗略）
    const text = await extractFromDocx(file);
    const info = extractTemplateInfo(text, file);

    state.templateInfo = info;
    showTemplatePreview(file, info);
    toast(`模板解析完成：${info.fontFamily} ${info.fontSize}pt · 缩进 ${info.firstLineIndent}`, 'success');
  } catch (err) {
    console.error('[thesis] template parse failed', err);
    toast('模板解析失败：' + err.message, 'error');
  } finally {
    if (dom['template-input']) dom['template-input'].value = '';
  }
}

function extractTemplateInfo(text, file) {
  // 简化版：根据 docx 文本前几行 + 常见模式提取
  const sample = text.slice(0, 500);
  let fontSize = 12;
  let fontFamily = '宋体';
  let firstLineIndent = 24; // 2 字符 ≈ 24pt

  // 检测字号关键词
  if (/三号/.test(sample)) fontSize = 16;
  else if (/小三/.test(sample)) fontSize = 15;
  else if (/四号/.test(sample)) fontSize = 14;
  else if (/小四/.test(sample)) fontSize = 12;
  else if (/五号/.test(sample)) fontSize = 10.5;

  // 检测字体关键词
  if (/黑体/.test(sample)) fontFamily = '黑体';
  else if (/楷体/.test(sample)) fontFamily = '楷体';
  else if (/宋体/.test(sample)) fontFamily = '宋体';
  else if (/Times/.test(sample)) fontFamily = 'Times New Roman';

  return { fontSize, fontFamily, firstLineIndent };
}

function showTemplatePreview(file, info) {
  if (!dom['template-zone'] || !dom['template-preview']) return;
  dom['template-zone'].classList.add('hidden');
  dom['template-preview'].classList.remove('hidden');
  if (dom['btn-template-clear']) dom['btn-template-clear'].style.display = 'inline-block';
  if (dom['template-filename']) dom['template-filename'].textContent = file.name;
  if (dom['template-meta']) dom['template-meta'].textContent = (file.size / 1024).toFixed(1) + ' KB';
  if (dom['template-fontsize']) dom['template-fontsize'].textContent = `${info.fontSize}pt（小四）`;
  if (dom['template-fontfamily']) dom['template-fontfamily'].textContent = info.fontFamily;
  if (dom['template-indent']) dom['template-indent'].textContent = `${info.firstLineIndent}pt（2 字符）`;
}

function clearTemplate() {
  if (!dom['template-zone'] || !dom['template-preview']) return;
  dom['template-zone'].classList.remove('hidden');
  dom['template-preview'].classList.add('hidden');
  if (dom['btn-template-clear']) dom['btn-template-clear'].style.display = 'none';
  if (dom['template-input']) dom['template-input'].value = '';
  state.templateInfo = null;
  toast('已清除模板', 'info');
}

// ===== 【v15.10.0】软件代码上下文（多文件上传 + 粘贴 · 不限字符上限） =====

async function handleCodeFiles(e) {
  const input = e.target;
  const fileList = input.files ? Array.from(input.files) : [];
  if (!fileList.length) return;

  // 单个文件 200KB 上限（防止误传大文件）
  for (const f of fileList) {
    if (f.size > 200 * 1024) {
      toast(`${f.name} 超过 200KB，跳过`, 'error');
      continue;
    }
    try {
      const content = await readFileAsText(f);
      const lines = content.split(/\r?\n/).length;
      state.codeFiles.push({ name: f.name, size: f.size, lines, content });
    } catch (err) {
      console.error('[thesis] code file read failed', f.name, err);
      toast(`读取 ${f.name} 失败：${err.message}`, 'error');
    }
  }

  rebuildCodeContext();
  updateCodePreview();
  input.value = '';  // 重置 input 允许重复传同名文件
  toast(`已加载 ${state.codeFiles.length} 个代码文件`, 'success');
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = ev => resolve(String(ev.target.result || ''));
    reader.onerror = () => reject(reader.error || new Error('读取失败'));
    reader.readAsText(file, 'utf-8');
  });
}

function handleCodePasteChange() {
  rebuildCodeContext();
  updateCodePreview();
}

function rebuildCodeContext() {
  // 优先级：main.* / app.* > 其他
  const sorted = [...state.codeFiles].sort((a, b) => {
    const score = name => /^(main|app)\.[ch]/i.test(name) ? 0 : 1;
    return score(a.name) - score(b.name);
  });

  const parts = [];
  let total = 0;
  for (const f of sorted) {
    const header = `\n/* ====== FILE: ${f.name} (${f.lines} lines) ====== */\n`;
    const tail = `\n/* ====== END FILE: ${f.name} ====== */\n`;
    parts.push(header + f.content + tail);
    total += header.length + f.content.length + tail.length;
  }

  // 粘贴区文本拼到末尾
  const paste = dom['code-paste'] ? dom['code-paste'].value.trim() : '';
  if (paste) {
    const seg = `\n/* ====== PASTE: 用户粘贴 ====== */\n${paste}\n/* ====== END PASTE ====== */\n`;
    parts.push(seg);
    total += seg.length;
  }

  state.codeContext = parts.join('');
  state.codeTotalChars = total;
}

function updateCodePreview() {
  const hasContent = state.codeFiles.length > 0 || (dom['code-paste'] && dom['code-paste'].value.trim());
  if (!dom['code-zone'] || !dom['code-preview']) return;

  // 【v15.10.1】上传区始终可见，有内容时变成"添加更多"入口
  dom['code-zone'].classList.remove('hidden');
  dom['code-preview'].classList.toggle('hidden', !hasContent);

  // 有内容时简化上传区提示语
  const uploadText = dom['code-zone'].querySelector('.import-text strong');
  const uploadSmall = dom['code-zone'].querySelector('.import-text small');
  if (hasContent) {
    if (uploadText) uploadText.textContent = '➕ 点击或拖入添加更多文件';
    if (uploadSmall) uploadSmall.textContent = '可分多次上传，自动累加 · 单文件 ≤ 200KB';
    if (dom['btn-code-clear']) dom['btn-code-clear'].style.display = 'inline-block';
  } else {
    if (uploadText) uploadText.textContent = '点击或拖入代码文件（支持多选）';
    if (uploadSmall) uploadSmall.textContent = '.c / .h / .cpp / .ino / .txt · Ch4 软件设计将严格基于实际代码生成，不编造';
    if (dom['btn-code-clear']) dom['btn-code-clear'].style.display = 'none';
  }

  // 文件列表
  if (dom['code-list']) {
    dom['code-list'].innerHTML = state.codeFiles.map((f, idx) =>
      `<div class="code-file-item">
        <div class="file-info">
          <span class="file-icon">📄</span>
          <span class="file-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>
        </div>
        <span class="file-meta">${f.lines} 行 · ${(f.size/1024).toFixed(1)} KB</span>
        <button type="button" class="file-remove" data-idx="${idx}" title="移除">×</button>
      </div>`
    ).join('');
    dom['code-list'].querySelectorAll('.file-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx, 10);
        state.codeFiles.splice(idx, 1);
        rebuildCodeContext();
        updateCodePreview();
      });
    });
  }

  // 统计
  const totalLines = state.codeFiles.reduce((s, f) => s + f.lines, 0);
  if (dom['code-stat-files']) dom['code-stat-files'].textContent = state.codeFiles.length;
  if (dom['code-stat-lines']) dom['code-stat-lines'].textContent = totalLines;
  if (dom['code-stat-chars']) dom['code-stat-chars'].textContent = state.codeTotalChars || 0;
}

function clearCode() {
  state.codeFiles = [];
  state.codeContext = '';
  state.codeTotalChars = 0;
  if (dom['code-input']) dom['code-input'].value = '';
  if (dom['code-paste']) dom['code-paste'].value = '';
  updateCodePreview();
  toast('已清除代码上下文', 'info');
}

// ===== 【v15.10.4】原理图上下文（纯粘贴，无 PDF 上传） =====
// ===== 【v15.10.3】一键粘贴原理图报告弹窗（无默认模板） =====
// ===== 【v15.10.4】原理图上下文（纯粘贴，无 PDF 上传） =====
function updateSchematicPreviewUI() {
  const text = (state.pdfContext || '').trim();
  const hasContent = text.length > 0;
  if (dom['schematic-chars']) dom['schematic-chars'].textContent = state.pdfContext.length;
  if (dom['schematic-filename']) dom['schematic-filename'].textContent = hasContent ? '已填入报告' : '未填入报告';
  if (dom['btn-schematic-clear']) dom['btn-schematic-clear'].style.display = hasContent ? 'inline-block' : 'none';
}

function clearSchematic() {
  state.pdfContext = '';
  if (dom['schematic-text']) dom['schematic-text'].value = '';
  updateSchematicPreviewUI();
  toast('已清除原理图报告', 'info');
}

function handleSchematicTextChange() {
  state.pdfContext = dom['schematic-text']?.value || '';
  updateSchematicPreviewUI();
}
function openSchematicPasteModal() {
  if (!dom['schematic-paste-modal']) return;
  // 弹窗打开时不预填任何内容（按用户要求：不存默认模板）
  if (dom['schematic-paste-textarea']) dom['schematic-paste-textarea'].value = '';
  dom['schematic-paste-modal'].style.display = 'flex';
  setTimeout(() => {
    if (dom['schematic-paste-textarea']) dom['schematic-paste-textarea'].focus();
  }, 50);
}

function closeSchematicPasteModal() {
  if (!dom['schematic-paste-modal']) return;
  dom['schematic-paste-modal'].style.display = 'none';
  if (dom['schematic-paste-textarea']) dom['schematic-paste-textarea'].value = '';
}

function confirmSchematicPaste() {
  const text = dom['schematic-paste-textarea']?.value?.trim() || '';
  if (!text) {
    toast('报告内容为空', 'error');
    return;
  }
  // 写入 state + 文本框
  state.pdfContext = text;
  if (dom['schematic-text']) dom['schematic-text'].value = text;
  updateSchematicPreviewUI();
  closeSchematicPasteModal();
  toast(`已填入报告，字符数见文本框`, 'success');
}

// ===== 主流程 =====
async function startGeneration() {
  if (state.generating) {
    toast('正在生成中，请等待', 'warning');
    return;
  }

  // 1. 校验输入
  const topic = dom['input-topic'].value.trim();
  const devices = dom['input-devices'].value.trim();
  const funcs = dom['input-funcs'].value.trim();
  if (!topic) { toast('请填写题目', 'error'); dom['input-topic'].focus(); return; }
  if (!devices) { toast('请填写器件清单', 'error'); dom['input-devices'].focus(); return; }
  if (!funcs) { toast('请填写功能要求', 'error'); dom['input-funcs'].focus(); return; }

  // 同步到 state
  state.topic = topic;
  state.devices = devices.split(/[、,，\s\n]+/).filter(Boolean);
  state.funcs = funcs.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  state.outline = (dom['input-outline']?.value || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  state.refs = (dom['input-refs']?.value || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);

  // 2. 切换 UI
  dom['result-empty'].classList.add('hidden');
  dom['result-content'].classList.remove('hidden');
  state.generating = true;

  // 【v15.7】生成中输入区灰化（防误改）
  const inputPane = document.querySelector('.pane-input');
  if (inputPane) inputPane.classList.add('generating');

  // 3. 渲染章节列表
  renderChapterList();
  state.startTs = Date.now();
  startTimer();

  // 4. 中央进度遮罩（与 topic / taskbook 一致）
  const abortCtrl = UIContainer.showProgress('论文生成中...');

  let totalChapters = CHAPTERS.length;
  let completedChapters = 0;

  try {
    for (const ch of CHAPTERS) {
      const target = Math.round(state.wordCount * ch.percent);
      const progressBase = (completedChapters / totalChapters) * 90;
      const progressStep = 90 / totalChapters;
      log(`开始生成 Ch${ch.id} · ${ch.title}（目标 ${target} 字）`, 'info');
      updateChapterStatus(ch.id, 'generating', 0);
      UIContainer.updateProgress(progressBase, `生成 Ch${ch.id} · ${ch.title}（${target} 字）`);

      try {
        const content = await generateChapter(ch.id, ch.title, target, abortCtrl.signal);
        state.chapters[ch.id] = content;
        const actual = countCnChars(content);
        log(`✓ Ch${ch.id} 完成（${actual} 字）`, 'success');
        updateChapterStatus(ch.id, 'completed', actual);
        completedChapters++;
        UIContainer.updateProgress(progressBase + progressStep, `Ch${ch.id} 完成（${actual}/${target} 字）`);
      } catch (err) {
        // 【v15.9.5】用户取消时不报错，只记个提示
        if (err.name === 'AbortError' || abortCtrl.signal.aborted) {
          log(`⏹ 已取消（Ch${ch.id} 中止）`, 'warning');
          throw new Error('USER_CANCELLED');
        }
        log(`✗ Ch${ch.id} 失败：${err.message}`, 'error');
        updateChapterStatus(ch.id, 'failed', 0);
        throw err;
      }
    }

    log('生成附加章节（摘要 / 致谢 / 参考文献）...', 'info');
    UIContainer.updateProgress(92, '生成摘要 / 致谢 / 参考文献');
    await generateExtras(abortCtrl.signal);

    UIContainer.updateProgress(97, '计算质量统计');
    computeQualityStats();

    UIContainer.updateProgress(100, '完成');

    dom['result-status'].textContent = '✅ 已生成';
    dom['result-status'].style.color = 'var(--color-success)';
    log('全部完成！', 'success');

    saveToStorage();

    setTimeout(() => UIContainer.hideProgress(), 600);
    toast('论文生成完成！可下载 .docx', 'success');

  } catch (err) {
    console.error('[thesis] generate failed', err);
    // 【v15.9.5】用户取消：静默处理，只关闭进度框
    if (err.message === 'USER_CANCELLED') {
      toast('已取消生成', 'info', 2000);
      UIContainer.hideProgress();
      // 不改状态，保持上一次的“✅ 已生成”或初始状态
    } else {
      log(`生成失败：${err.message}`, 'error');
      toast('生成失败：' + err.message, 'error');
      dom['result-status'].textContent = '❌ 部分失败';
      dom['result-status'].style.color = 'var(--color-danger)';
      UIContainer.hideProgress();
    }
  } finally {
    // 【v15.7】无论成功失败都要解除输入区灰化
    const inputPane = document.querySelector('.pane-input');
    if (inputPane) inputPane.classList.remove('generating');
    stopTimer();
    state.generating = false;
  }
}

// ===== 计时器 =====
let timerInterval = null;
function startTimer() {
  const tick = () => {
    if (!state.startTs) return;
    const elapsed = Math.floor((Date.now() - state.startTs) / 1000);
    const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const ss = String(elapsed % 60).padStart(2, '0');
    if (dom['result-time']) dom['result-time'].textContent = `${mm}:${ss}`;
  };
  tick();
  timerInterval = setInterval(tick, 500);
}
function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

// ===== 渲染章节列表 =====
function renderChapterList() {
  const html = CHAPTERS.map(ch => {
    const priorityClass = ch.priority === 'high' ? ' priority-high priority-badge' : '';
    return `
    <div class="chapter-item${priorityClass}" id="chapter-${ch.id}">
      <span class="chapter-icon">⏳</span>
      <div class="chapter-info">
        <strong class="chapter-title">Ch${ch.id} · ${ch.title}</strong>
        <span class="chapter-target">${Math.round(state.wordCount * ch.percent)} 字 · ${ch.desc}</span>
      </div>
      <span class="chapter-words">-- / --</span>
    </div>
  `;
  }).join('');
  dom['chapter-list'].innerHTML = html;
}

function updateChapterStatus(ch_id, status, words) {
  const el = document.getElementById(`chapter-${ch_id}`);
  if (!el) return;
  el.classList.remove('generating', 'completed', 'failed');
  el.classList.add(status);
  const icon = el.querySelector('.chapter-icon');
  const wordEl = el.querySelector('.chapter-words');
  if (status === 'generating') {
    icon.textContent = '⏳';
    wordEl.textContent = `生成中...`;
  } else if (status === 'completed') {
    icon.textContent = '✅';
    wordEl.textContent = `${words} 字`;
  } else if (status === 'failed') {
    icon.textContent = '❌';
    wordEl.textContent = `失败`;
  }
}

// ===== 单章生成 =====
async function generateChapter(ch_id, ch_title, target, signal) {
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildChapterPrompt(ch_id, ch_title, target);
  const apiKey = getHardcodedApiKey();

  const result = await callMinimax(apiKey, [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ], { temperature: 0.6, max_tokens: 8000, signal });  // 【v15.9.5】传 signal 支持取消

  return cleanChapterContent(result.text, ch_id);
}


// === v15.10.9 规范 [数字/字母] 与 [汉字] 之间的空格 ===
//   - 'STM 32'    -> 'STM32'    (字母+空格+数字)
//   - '1 . 5V'    -> '1.5V'
//   - '5 V'       -> '5V'
//   - 'STM32 控制器' -> 'STM32控制器'
//   - '温 度 25 度' -> '温度25度'
// v15.10.9: 规范 [数字/字母] 与 [汉字] 之间的空格（贪心循环，直到稳定）
//   - 'STM 32'        -> 'STM32'
//   - '1 . 5V'        -> '1.5V'
//   - '5 V'           -> '5V'
//   - 'STM32 控制器'  -> 'STM32控制器'
//   - '控 制 器'       -> '控制器'
//   - '单 片 机 STM 32' -> '单片机STM32'

function buildSystemPrompt() {
  const devices = state.devices.join('、');
  const funcs = state.funcs.join('\n');

  // 【真的传到 prompt】模板格式要求
  let formatSection = '';
  if (state.templateInfo) {
    const fmt = `${state.templateInfo.fontFamily} ${state.templateInfo.fontSize}pt（小四）`;
    const indent = `${state.templateInfo.firstLineIndent}pt（2字符）`;
    formatSection = `【格式要求】📐 来自上传的学校论文模板，请严格遵守：
- 正文字体：${fmt}
- 首行缩进：${indent}（不要在正文中手写空格，导出时会自动处理）
- 段间距适中，图表清晰引用
- 不要在正文中插入任何“占位符占位符”、“XXX”这种未填项

`;
  } else {
    formatSection = `【格式要求】
- 正文字体：宋体 小四 (12pt)
- 首行缩进：24pt（2字符），不要在正文中手写空格
- 表格清晰、图表引用准确

`;
  }

  return `你是一位单片机/嵌入式系统毕业论文写作助手。

【题目】
${state.topic}

【器件清单】（锁定的，不要修改型号，不要添加新器件）
${devices}

【功能清单】
${funcs}

${state.outline.length ? `【参考目录】🗂️ 学校论文目录，请严格按此章节顺序与名称生成：
${state.outline.join('\n')}

` : ''}${state.refs.length ? `【参考文献】📚 GB/T 7714 格式，仅绪论使用 [n] 引用标记：
${state.refs.join('\n')}

` : ''}${formatSection}【强约束】
1. 器件型号必须严格使用上面清单中的，不允许编造（如 SHT30 / MQ-4 / BH1750 等禁止出现）
2. 引脚编号 / 寄存器地址 / 代码片段不要写具体值
3. 不要写电路原理图内容（占位符 [待插入图：fig-x-x 人类语言] 代替）
4. 论文段落要严谨、有数据支撑、避免口语化
5. Ch1 绪论是唯一允许出现 [n] 参考文献标记的章节（Ch2-6 严禁 [n]）
6. 段落首行缩进 2 字符（在 .docx 中会自动处理，正文无需自己写空格）

【【v15.10.0】全章节禁捏造约束】
7. 严禁编造任何代码细节：函数名、变量名、寄存器名、参数值、时序数值、通信协议字段名，只能引用实际代码中出现的
8. 严禁虚构库函数调用：如未提供代码中明确出现，不得引用 HAL_I2C_Master_Transmit、HAL_SPI_Transmit 等具体 API
9. 器件顺序引脚编号不得确定：未提供代码时只能说"与主控通过 UART 通信"，不得写"PA2/PA3"
10. 测试数据不得捏造：未提供测试数据时只能说"经过多轮测试系统稳定运行"，不得编造具体表格

【【v15.10.5】排版约束】
11. 术语（如 STM32、WiFi 模块、主控制器）可以用两个星号包起来实现加粗
12. 严禁整句、整段加粗（加粗内容应为 2-6 个汉字的术语，不是一整句话）
13. 一段内加粗术语不超过 2 个
14. 普通描述不要用任何加粗，直接平铺文字
15. 章节标题不要加粗（H1 / H2 / H3 标题样式已自带加粗，不要再手动加星号）

【【v15.10.7】标题编号与层级要求】
16. **每个章节必须有编号标题**：H1 写 \`# X 章节名\`（X 为 1-6 阿拉伯数字），H2 写 \`## X.Y 子标题\`，H3 写 \`### X.Y.Z 三级标题\`。
17. **不得省略编号**：不能写 \`# 绪论\`、\`## 研究背景\`（必須 \`# 1 绪论\`、\`## 1.1 研究背景\`）。
18. **不得重复标题**：你输出的章节内容里不要写 H1（导出器会按章节号自动生成“1 绪论”等）；只输出 H2 / H3 / 正文。
19. **标题层级区分明显**：H1 = 32（三号）·居中·黑体；H2 = 28（小三）·左对齐·黑体；H3 = 24（小四）·左对齐·黑体。正文 = 24（小四）·首行缩进 2 字符·宋体。加粗一律不要。

20. **不要加粗**：v15.10.7 已全面去除加粗（导出器不再处理 \`**xxx**\`）。输出里不许出现 \`**术语**\` 字样，包了也会被原样保留为“\**术语**\”字面字符串。
`;
}

function buildChapterPrompt(ch_id, ch_title, target) {
  const isCh1 = ch_id === 1;
  const isCh3 = ch_id === 3;
  const isCh4 = ch_id === 4;

  const chapterGuidance = {
    1: '绪论：研究背景与意义、国内外研究现状、研究内容与章节安排。本章允许出现 [n] 引用标记（如 [1][2]）。',
    2: '系统总体设计：项目需求分析、总体架构设计、模块划分、器件选型说明。',
    3: '硬件设计：主控电路、各传感器电路、执行器电路、电源电路。器件必须严格按锁定清单。配 [待插入图：fig-3-x 人类语言描述] 占位符。',
    4: '软件设计：主程序流程图、子程序流程图（5 张 ASCII + Mermaid 双轨流程图）、关键算法设计。',
    5: '系统测试：硬件测试、软件测试、联调测试、测试结果分析。',
    6: '项目总结：完成情况、存在问题、改进方向、项目心得（是"项目"总结，不是"论文"总结）。',
  };

  // 检查目录里有没有该章节对应的内容
  let outlineHint = '';
  if (state.outline.length) {
    outlineHint = '\n【参考目录要求】\n学校目录提供了具体章节顺序和小节，论文章节要严格按照目录结构来组织内容。\n';
  }

  return `请生成论文第 ${ch_id} 章《${ch_title}》，目标 ${target} 字。

【章节要求】
${chapterGuidance[ch_id] || ''}
${outlineHint}
${isCh1 ? '\n【重要】本章是唯一允许写 [n] 参考文献的位置，其他章禁止。\n' : ''}
${isCh3 ? buildCh3PromptAddition() : ''}
${isCh4 ? buildCh4PromptAddition() : ''}

【输出格式】
- 【v15.10.7】**不要写 H1 标题**（导出器会自动生成“${ch_id} ${ch_title}”作为 H1），从 H2 开始输出。
- 段落用 H2 / H3 分节：【v15.10.7】H2 必须是 \`## ${ch_id}.X 子标题\`，H3 必须是 \`### ${ch_id}.X.Y 三级标题\`。
- 每个 H2 之间段落连贯
- 不要输出"本章小结""本章内容"等冗余引导
- 不要加粗（v15.10.7 已去除）

直接输出章节内容即可。`;
}

// 【v15.10.0】Ch4 软件设计专用 prompt 拼接：有代码则强约束贴代码，无代码则保守描述
// 【v15.10.3】Ch3 硬件设计专用 prompt 拼接：有原理图报告则严格贴报告，无报告则保守描述
function buildCh3PromptAddition() {
  const hasPdf = state.pdfContext && state.pdfContext.length > 100;

  if (hasPdf) {
    return `\n【【v15.10.3】重要】已提供原理图分析报告，本章必须严格基于下方报告描述，**严禁捏造**。\n\n【原理图分析报告】（所有描述只能依据此处出现的模块、元件、连接关系）：\n\`\`\`\n${state.pdfContext}\n\`\`\`\n\n【【v15.10.3】强约束】\n1. **不要在正文中写元器件标号**（R1/C1/Q1/U1 这种 PCB 标号一律不出现）\n2. **所有模块、元件、连接关系只能使用报告中实际出现的**：不得添加报告里没有的电路\n3. **GPIO 引脚可以引用报告中标注的**（如 DS18B20 接 PB8），不得推测未标注的引脚\n4. **电路功能用业务术语描述**：说"加热控制电路由 MOS 管驱动 5V 继电器实现"而不是"Q3 驱动 K10 继电器"\n5. **报告未提及的部分不要补充**：如报告未提"光耦隔离 / TVS / 屏蔽"就不要写这些\n6. 每个电路描述末尾保留一行 \`[待插入图：fig-3-x 人类语言描述]\` 占位符`;
  } else {
    return `\n【【v15.10.3】无原理图报告】未提供原理图，按以下原则写：\n1. 只写通用电路功能，**不要写元器件标号**（R1/C1 这种禁止）\n2. 引脚只能写器件清单中明确使用的（如 DS18B20 接 PB8 来自器件清单）\n3. 不得推测未知的电路（光耦隔离 / TVS / 屏蔽 / 看门狗等）\n4. 每个电路描述末尾保留一行 \`[待插入图：fig-3-x 描述]\` 占位符`;
  }
}

function buildCh4PromptAddition() {
  const hasCode = state.codeContext && state.codeContext.length > 100;

  // 【v15.10.2】极简 ASCII 流程图模板（不要 Mermaid）
  const flowChartGuide = `\n【流程图要求】本章需包含 5 张流程图，**仅使用 ASCII 框图，不需要 Mermaid**。每张 5-7 步，简洁明了，用业务术语：\n\n例：\n### 图4-1 主程序流程图\n\n\`\`\`\n[开始] → [初始化] → [主循环]\n   ↓\n[采集数据] → [阈值判断] → [控制执行器]\n   ↓\n[上传云端] → [延时] → [返回主循环]\n\`\`\`\n\n5 张图：主程序 / 数据采集 / 通信上报 / 控制执行 / 异常处理`;

  if (hasCode) {
    return `\n【【v15.10.2】重要】已提供实际代码作为**逻辑参考**，但描述要用业务术语，避免贴代码细节。\n\n${flowChartGuide}\n\n【代码逻辑参考】（仅用于理解实际业务流程，**不要在正文中贴函数名/变量名/寄存器**）：\n\`\`\`c\n${state.codeContext}\n\`\`\`\n\n【【v15.10.2】写作原则】\n1. **用业务术语描述逻辑**：说"采集温度传感器数据"而不是"调用 DS18B20_GetTemp_SkipRom()"；说"WiFi 上报数据到 APP"而不是"通过 AT+CIPSEND 发送 msg=#T#SW#..."\n2. **不要在正文中贴函数名/变量名/宏定义**：除非介绍核心算法时有必要，否则一律用中文业务术语\n3. **描述业务流程要准确**：根据代码反映的实际判断条件（如温度低→开加热、水位低→开水泵、光照低→开灯），不要套用通用模板\n4. **GPIO 引脚简写**：用"主控 GPIO 引脚"代替具体 PB12/13/14/15，除非必要不写具体编号\n5. **通信协议用通用描述**：说"通过 WiFi 模块以自定义格式上报数据"，不要贴具体 AT 指令或数据包格式\n6. **流程图用业务术语**：图中的方块写"采集水质数据""判断是否超过阈值"等，不要写"调用 DS18B20_ReadByte()"`;
  } else {
    return `\n【重要】本章需要包含 5 张流程图（仅 ASCII，不需要 Mermaid）。${flowChartGuide}\n\n【【v15.10.2】无代码上下文】未提供实际代码，按以下原则写：\n1. 只写最通用的软件架构描述（主程序循环 / 数据采集 / 阈值控制 / 通信 / 显示）\n2. 不得编造任何具体函数名、HAL 库 API、寄存器名称、参数数值\n3. 描述业务逻辑时使用"采集传感器数据→判断阈值→控制执行器"这种抽象表述\n4. GPIO 引脚不写具体编号，用"主控 GPIO 引脚"代替\n5. 5 张流程图用通用模板（采集→判断→控制→通信→显示）`;
  }
}

function cleanChapterContent(text, ch_id) {
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  return text.trim();
}

// ===== 附加章节（摘要 / 致谢 / 参考文献） =====
async function generateExtras(signal) {
  const apiKey = getHardcodedApiKey();
  const devices = state.devices.join('、');

  const cnAbstract = await callMinimax(apiKey, [
    { role: 'system', content: '你是单片机论文写作助手。生成 200-300 字中文摘要。' },
    { role: 'user', content: `题目：${state.topic}\n器件：${devices}\n功能：${state.funcs.join('；')}\n请生成论文中文摘要，包含：研究目的、方法、主要成果、结论。` },
  ], { temperature: 0.5, max_tokens: 1200, signal });
  state.abstractCn = cleanText(cnAbstract.text);

  const enAbstract = await callMinimax(apiKey, [
    { role: 'system', content: '你是单片机论文写作助手。生成 200-300 字英文摘要（Abstract）。' },
    { role: 'user', content: `Title: ${state.topic}\nDevices: ${devices}\nFunctions: ${state.funcs.join('; ')}\n\nGenerate the English Abstract (200-300 words) for the thesis.` },
  ], { temperature: 0.5, max_tokens: 1200, signal });
  state.abstractEn = cleanText(enAbstract.text);

  const ack = await callMinimax(apiKey, [
    { role: 'system', content: '你是单片机论文写作助手。生成 150 字致谢。' },
    { role: 'user', content: `为论文《${state.topic}》写一段致谢，感谢指导老师、同学、家人。` },
  ], { temperature: 0.7, max_tokens: 800, signal });
  state.ack = cleanText(ack.text);

  // 参考文献：优先用用户输入的
  if (state.refs.length) {
    state.referencesText = state.refs.join('\n');
  } else {
    const refs = await callMinimax(apiKey, [
      { role: 'system', content: '你是单片机论文写作助手。生成 15 条参考文献（GB/T 7714 格式）。' },
      { role: 'user', content: `为论文《${state.topic}》生成 15 条参考文献，使用 GB/T 7714 格式。包含：STM32 技术手册、单片机教材、相关传感器数据手册、WiFi 通信论文、嵌入式系统设计书籍、IoT / 智能家居领域期刊论文、传感器应用论文、程序设计书籍等。` },
    ], { temperature: 0.5, max_tokens: 2500, signal });
    state.referencesText = cleanText(refs.text);
  }

  dom['abstract-cn'].textContent = state.abstractCn;
  dom['abstract-en'].textContent = state.abstractEn;
  dom['acknowledgment'].textContent = state.ack;
  dom['references'].textContent = state.referencesText;
  dom['extras-section'].classList.remove('hidden');

  const ch1 = state.chapters[1] || '';
  const refsInCh1 = (ch1.match(/\[\d+\]/g) || []).length;
  state.stats.refs = refsInCh1;
}

function cleanText(text) {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

// ===== 质量统计 =====
function computeQualityStats() {
  let totalWords = 0;
  let totalFigs = 0;

  for (const ch_id in state.chapters) {
    const ch = state.chapters[ch_id];
    totalWords += countCnChars(ch);
    const figs = (ch.match(/\[待插入图[：:]\s*fig-/g) || []).length;
    totalFigs += figs;
    const flows = (ch.match(/【流程图[：:]\s*图/g) || []).length;
    totalFigs += flows;
  }

  state.stats.words = totalWords;
  state.stats.figs = totalFigs;

  dom['q-words'].textContent = totalWords;
  dom['q-figs'].textContent = totalFigs;
  dom['q-refs'].textContent = state.stats.refs;
  dom['q-indent'].textContent = '95%+';
  dom['quality-stats'].classList.remove('hidden');
}

// ===== 保存到 Storage =====
function saveToStorage() {
  try {
    Storage.Shared.setThesis({
      topic: state.topic,
      devices: state.devices,
      funcs: state.funcs,
      outline: state.outline,
      refs: state.refs,
      templateInfo: state.templateInfo,
      chapters: state.chapters,
      abstractCn: state.abstractCn,
      abstractEn: state.abstractEn,
      ack: state.ack,
      references: state.referencesText,
      stats: state.stats,
      generatedAt: new Date().toISOString(),
    });
    Storage.Shared.markComplete('thesis');
    log('已保存到 Storage.Shared', 'info');
  } catch (e) {
    console.warn('Storage.Shared not ready', e);
  }
}

// ===== 复制摘要（下拉） =====
async function copyAbstract(mode = 'cn') {
  let text = '';
  let label = '';
  if (mode === 'cn') {
    text = state.abstractCn || '（未生成中文摘要）';
    label = '中文摘要';
  } else if (mode === 'en') {
    text = state.abstractEn || '（未生成英文摘要）';
    label = '英文摘要';
  } else if (mode === 'all') {
    text = `【中文摘要】\n${state.abstractCn || '（未生成）'}\n\n【English Abstract】\n${state.abstractEn || '（Not generated）'}\n\n【致谢】\n${state.ack || '（未生成）'}`;
    label = '全部';
  }
  try {
    await navigator.clipboard.writeText(text);
    toast(`${label}已复制`, 'success');
  } catch (e) {
    toast('复制失败：' + e.message, 'error');
  }
}

// ===== 下载 .docx =====
async function downloadDocx() {
  try {
    if (!state.chapters[1]) {
      toast('请先生成论文', 'error');
      return;
    }
    toast('生成 .docx 中...', 'info');
    // v15.10.8：下载前清掉所有 ** 标记（避免论文里出现 **xxx** 字面字符串）
    const blob = await exportPaperDocx({
      topic: state.topic,
      abstractCn: state.abstractCn,
      abstractEn: state.abstractEn,
      ack: state.ack,
      refs: state.referencesText,
      chapters: state.chapters,
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${state.topic}_论文.docx`.replace(/[\\/:*?"<>|]/g, '_');
    a.click();
    URL.revokeObjectURL(url);
    toast('下载完成', 'success');
  } catch (e) {
    console.error('[thesis] download failed', e);
    toast('下载失败：' + e.message, 'error');
  }
}

// ===== 复位 = 清空所有内容 =====
function resetAll() {
  if (!confirm('⚠️ 确认清空所有内容？\n\n会清空：\n• 所有输入框（题目/器件/功能/目录/参考文献）\n• 已上传的方案文档 + 参考模板\n• 生成结果（6 章论文 + 摘要 + 致谢 + 参考文献）\n\n此操作不可撤销。')) return;

  // 清空输入区
  ['input-topic', 'input-devices', 'input-funcs', 'input-outline', 'input-refs'].forEach(id => {
    if (dom[id]) dom[id].value = '';
  });

  // 清除上传文件
  clearUploadedFile();
  clearTemplate();
  clearCode();  // 【v15.10.0】
  clearSchematic();  // 【v15.10.3】

  // 清空状态
  state.chapters = {};
  state.abstractCn = '';
  state.abstractEn = '';
  state.ack = '';
  state.referencesText = '';
  state.outline = [];
  state.refs = [];
  state.templateInfo = null;
  state.stats = { words: 0, figs: 0, refs: 0, indent: 0 };

  // 清空 UI
  dom['chapter-list'].innerHTML = '';
  dom['extras-section'].classList.add('hidden');
  dom['quality-stats'].classList.add('hidden');
  dom['log-content'].textContent = '';
  dom['result-empty'].classList.remove('hidden');
  dom['result-content'].classList.add('hidden');
  dom['result-status'].textContent = '⏳ 生成中';
  dom['result-status'].style.color = 'var(--color-primary)';
  dom['result-time'].textContent = '00:00';

  // 清除 Storage.Shared
  try {
    Storage.Shared.markIncomplete('thesis');
    localStorage.removeItem('mcu.shared.thesis');
  } catch (e) {}

  // 重新计算预估
  updateCounts();
  refreshSourceBanner();
  markProgress();  // 【v15.9.3】刷新进度条（去掉 thesis 的已完成绿色）

  toast('✓ 所有内容已清空', 'success');
  log('已清空所有内容', 'info');
}

// ===== 日志 =====
function log(msg, type = 'info') {
  const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const cls = type === 'success' ? 'log-success' : type === 'error' ? 'log-error' : 'log-info';
  const line = document.createElement('div');
  line.className = cls;
  line.textContent = `[${ts}] ${msg}`;
  dom['log-content'].appendChild(line);
  if (dom['log-content'].parentElement) {
    dom['log-content'].parentElement.scrollTop = dom['log-content'].parentElement.scrollHeight;
  }
  console.log(`[thesis] ${msg}`);
}

// ===== Toast =====
function toast(msg, type = 'info') {
  if (window.UIContainer?.toast) {
    window.UIContainer.toast(msg, type);
  } else {
    console.log(`[toast:${type}] ${msg}`);
  }
}