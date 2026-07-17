/* ============================================================
 * topic/app.js
 * 题目生成方案 · 主逻辑
 * ============================================================ */

import UIContainer from '../shared/ui-kit.js';
import ApiClient from '../shared/api.js';
import DocxReader from '../shared/docx-reader.js';
import Markdown from '../shared/markdown.js';
import Storage from '../shared/storage.js';
import DocxExporter from '../shared/docx-export.js';
import Format from '../shared/format.js';
import ThemeToggle from '../shared/theme-toggle.js';

const state = {
  isGenerating: false,
  abortController: null,
  lastResult: '',
  catalog: [],  // 22 级项目库
  imported: null,  // {filename, size, type, text, extracted: {topic, devices, funcs}}
  mode: 'create',  // create | extract（抽取模式锁定等级和描述框）
};

// === DOM 引用 ===
function $(id) { return document.getElementById(id); }
const dom = {};

// === 初始化 ===
export function initApp() {
  Object.assign(dom, {
    inputTopic: $('input-topic'),
    inputDesc: $('input-description'),
    charCount: $('char-count'),
    btnClearDesc: $('btn-clear-desc'),
    btnTemplate: $('btn-template'),
    btnGenerate: $('btn-generate'),
    btnCopy: $('btn-copy'),
    btnDownload: $('btn-download'),
    btnNextTaskbook: $('btn-next-taskbook'),
    btnNextThesis: $('btn-next-thesis'),
    btnReset: $('btn-reset'),
    btnThemeToggle: $('theme-toggle'),
    advMcu: $('adv-mcu'),
    advMcuCustom: $('adv-mcu-custom'),
    advDisplay: $('adv-display'),
    advDisplayCustom: $('adv-display-custom'),
    advPower: $('adv-power'),
    advPowerCustom: $('adv-power-custom'),
    resultEmpty: $('result-empty'),
    resultContent: $('result-content'),
    resultBody: $('result-body'),
    resultStatus: $('result-status'),
    resultTime: $('result-time'),
    templateDialog: $('template-dialog'),
    templateClose: $('template-close'),
    topicSuggest: $('topic-suggest'),
    topicSuggestList: $('topic-suggest-list'),
    // === 开题报告导入 ===
    fileInput: $('file-input'),
    importZone: $('import-zone'),
    importPreview: $('import-preview'),
    previewFilename: $('preview-filename'),
    previewMeta: $('preview-meta'),
    previewTopic: $('preview-topic'),
    previewDevices: $('preview-devices'),
    previewFuncs: $('preview-funcs'),
    previewFuncCount: $('preview-func-count'),
    btnClearImport: $('btn-clear-import'),
    btnDirectGenerate: $('btn-direct-generate'),
  });

  UIContainer.initTheme();

  // 【v15.9.3】清理无效的 progress.topic（如果 topic 自身没内容）
  try {
    const hasInput = Storage.get('topic.lastInput.topic');
    const hasResult = Storage.get('topic.lastResult');
    const hasScheme = Storage.Shared.getScheme();
    if (!hasInput && !hasResult && !hasScheme) {
      const p = Storage.Shared.getProgress();
      if (p.topic) {
        p.topic = false;
        Storage.set('shared.progress', p);
      }
    }
  } catch (e) {}

  restoreFromStorage();
  bindEvents();
  updateProgress();
  loadCatalog().then(() => {
    loadFromShared();
  });
}

// === 加载 22 级项目库 ===
async function loadCatalog() {
  try {
    const r = await fetch('../library/22ji-catalog.json');
    if (r.ok) {
      let text = await r.text();
      // 去掉 BOM
      if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
      const data = JSON.parse(text);
      state.catalog = data;
      console.log(`[topic] 22级库已加载: ${data.length} 个项目`);
    }
  } catch (e) {
    console.warn('Failed to load 22ji catalog:', e);
  }
}

// === 22 级库模糊匹配 ===
function searchCatalog(keyword) {
  if (!keyword || keyword.length < 2 || state.catalog.length === 0) return [];
  const k = keyword.toLowerCase();
  const results = [];
  for (const item of state.catalog) {
    if (item.name && item.name.toLowerCase().includes(k)) {
      results.push(item);
      if (results.length >= 5) break;
    }
  }
  // 关键词拆分匹配（如"智能小车" → 包含"小车"的项目）
  if (results.length < 3) {
    for (const item of state.catalog) {
      if (results.includes(item)) continue;
      const words = k.split(/\s+/).filter(w => w.length >= 2);
      if (words.length > 1 && words.some(w => item.name && item.name.toLowerCase().includes(w))) {
        results.push(item);
        if (results.length >= 5) break;
      }
    }
  }
  return results;
}

function showCatalogSuggest(keyword) {
  const results = searchCatalog(keyword);
  if (results.length === 0) {
    dom.topicSuggest.classList.add('hidden');
    return;
  }
  dom.topicSuggestList.innerHTML = results.map(item => `
    <li>
      <button type="button" class="catalog-item" data-id="${item.id}" data-name="${escapeAttr(item.name)}">
        <span class="catalog-id">${item.id}</span>
        <span class="catalog-name">${escapeAttr(item.name)}</span>
        <span class="catalog-action">→ 填入</span>
      </button>
    </li>
  `).join('');
  dom.topicSuggest.classList.remove('hidden');
  // 绑定点击事件
  dom.topicSuggestList.querySelectorAll('.catalog-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const name = btn.dataset.name;
      dom.inputTopic.value = name;
      dom.topicSuggest.classList.add('hidden');
      UIContainer.toast('已填入题目：' + name, 'success');
      // 异步加载该项目的具体内容作为描述建议
      loadCatalogItemContent(btn.dataset.id);
    });
  });
}

async function loadCatalogItemContent(id) {
  const item = state.catalog.find(c => c.id === id);
  if (!item || !item.contentFile) return;
  try {
    const r = await fetch('../' + item.contentFile);
    if (r.ok) {
      let text = await r.text();
      if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
      const data = JSON.parse(text);
      // 构造库参考内容（显示在生成框）
      const title = data.title || data.name || '';
      const devices = data.devices || '';
      const funcs = (data.functions || data.funcs || []).filter(Boolean);
      const md = buildLibraryPreview({ id, name: item.name, title, devices, funcs });
      showResult(md, { kind: 'library', libraryId: id });

      // 【v15.9.2】库加载不写入 shared——必须点“下一步”才共享
      // 只暂存到 state，用户点“下一步”时才进 shared
      const libMeta = Markdown.extractMetadata(md);
      const level = /A$/.test(id) ? 'A' : 'B';
      state.lastMeta = {
        topic: title || item.name,
        level,
        source: 'library',
        libraryId: id,
        libraryName: item.name,
        mcu: 'AI 自动推荐',
        display: 'AI 自动推荐',
        power: 'AI 自动推荐',
        devices: libMeta.devices || [],
        funcs: libMeta.funcs || [],
        generatedAt: new Date().toISOString(),
        generatorVersion: 'v15.9.2',
      };
      state.lastInputs = { source: 'library', libraryId: id };

      // 同步 lastInput（避免刷新后库题丢失）
      syncLastInputFromCurrent();

      UIContainer.toast(`已加载 ${item.id} 的内容到生成框，可点"下一步"跳过 AI 重新设计`, 'success');
    }
  } catch (e) {
    console.warn('Failed to load catalog item content:', e);
    UIContainer.toast('加载库内容失败：' + e.message, 'error');
  }
}

function buildLibraryPreview({ id, name, title, devices, funcs }) {
  const devText = Array.isArray(devices)
    ? devices.join('、')
    : (devices || '').toString();
  const funcList = (funcs || []).map(f => `- [ ] ${f}`).join('\n');
  return `# ${title || name}（${id}）

**器件**：${devText}

**功能**：
${funcList || '- [ ] （无）'}
`;
}

function syncLastInputFromCurrent() {
  Storage.set('topic.lastInput.topic', dom.inputTopic.value);
  Storage.set('topic.lastInput.desc', dom.inputDesc.value);
  Storage.set('topic.lastInput.level', document.querySelector('input[name="level"]:checked')?.value || 'B');
}

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// === 开题报告导入处理 ===
async function handleImportFile(file) {
  try {
    UIContainer.toast('正在读取文件...', 'info');
    const { text, meta } = await DocxReader.read(file);
    if (!text || text.length < 10) {
      UIContainer.toast('文件内容为空或太短', 'error');
      return;
    }
    // 文本长度限制（AI 上下文）
    const truncated = text.length > 8000 ? text.slice(0, 8000) + '\n...(后文省略)' : text;

    // AI 抽取题目/器件/功能
    state.imported = { ...meta, text: truncated, extracted: null };
    UIContainer.updateProgress(0, 'AI 抽取中...');
    const abortController = UIContainer.showProgress('正在从开题报告中抽取题目、器件、功能...');

    try {
      const extractPrompt = buildExtractPrompt();
      const userMsg = `【开题报告原文】\n${truncated}`;
      const result = await ApiClient.chat({
        systemPrompt: extractPrompt,
        userMessage: userMsg,
        temperature: 0.3,  // 低温度保抽取准确性
        signal: abortController.signal,
      });
      UIContainer.updateProgress(80, '整理抽取结果...');
      const parsed = parseExtractResult(result);
      state.imported.extracted = parsed;

      UIContainer.updateProgress(100, '完成');
      setTimeout(() => {
        UIContainer.hideProgress();
        renderImportPreview();
        UIContainer.toast('抽取完成，可“填入输入框”继续生成或“直接生成方案”', 'success');
      }, 200);

    } catch (err) {
      UIContainer.hideProgress();
      if (err.name === 'AbortError') {
        UIContainer.toast('已取消抽取', 'info');
      } else {
        UIContainer.showError(err);
      }
      state.imported = null;
    }
  } catch (err) {
    UIContainer.showError(err);
  }
}

function buildExtractPrompt() {
  // 抽取专用的 system prompt · 不输出思考 · 严格 JSON 格式
  return `你是开题报告抽取助手。你的任务是从用户上传的开题报告原文中抽取【题目】、【器件】、【功能】三项。

【严格规则】
1. 【题目】：抽取原文中明确的课题/项目名称，去除“参考资料/进度安排/研究背景”等元信息。如有多个候选，选最接近标题的。
2. 【器件】：抽取原文中明说的元器件型号或类别名称。原文未明的型号不要反推、不要补充。
3. 【功能】：抽取原文中明确描述的功能点。不得添加原文未提的功能。
4. 功能不得调整/夸大声明，每个功能只能提取原文表述。

【输出格式】必须是严格的 JSON，不要其他内容、不要 markdown 代码块、不要思考过程：
{
  "topic": "抽取出的题目",
  "devices": ["器件1", "器件2", ...],
  "funcs": ["功能1", "功能2", ...]
}

【输出】`;
}

function parseExtractResult(text) {
  // 从 AI 返回中提取 JSON
  let t = (text || '').trim();
  // 去掉 markdown 代码块包裹
  t = t.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
  // 去掉开头的废话
  t = t.replace(/^(好的[，,。.].+?\n+)/i, '');
  t = t.replace(/^(以下是.+?\n+)/i, '');
  // 尝试提取 JSON 块
  const jsonMatch = t.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const obj = JSON.parse(jsonMatch[0]);
      return {
        topic: (obj.topic || '').toString().trim(),
        devices: Array.isArray(obj.devices) ? obj.devices.filter(Boolean).map(String) : [],
        funcs: Array.isArray(obj.funcs) ? obj.funcs.filter(Boolean).map(String) : [],
      };
    } catch (e) {
      console.warn('Failed to parse JSON:', e, jsonMatch[0]);
    }
  }
  // 兑底：如果解析失败，返回原文作为提示
  return { topic: '', devices: [], funcs: [], rawText: t };
}

function renderImportPreview() {
  if (!state.imported) return;
  const { filename, size, extracted } = state.imported;
  dom.previewFilename.textContent = filename;
  dom.previewMeta.textContent = Format.formatSize(size);
  // 可编辑字段：用户可以在预览区直接增删改
  dom.previewTopic.value = extracted.topic || '';
  dom.previewDevices.value = extracted.devices.join('\n');
  dom.previewFuncs.value = extracted.funcs.join('\n');
  updatePreviewFuncCount();
  dom.importPreview.classList.remove('hidden');
  dom.btnClearImport.style.display = 'block';
  state.mode = 'extract';
  lockLevelAndDesc();
  bindPreviewEdits();
}

function bindPreviewEdits() {
  // 动态绑定 input/textarea 的实时计数（避免重复绑定）
  if (dom.previewFuncs.dataset.bound) return;
  dom.previewFuncs.addEventListener('input', updatePreviewFuncCount);
  dom.previewFuncs.dataset.bound = '1';
}

function updatePreviewFuncCount() {
  const lines = dom.previewFuncs.value.split('\n').map(s => s.trim()).filter(Boolean);
  dom.previewFuncCount.textContent = `(${lines.length})`;
}

function readPreviewEdits() {
  // 读取用户编辑后的预览数据
  const topic = dom.previewTopic.value.trim();
  const devices = dom.previewDevices.value
    .split(/[、，,\n]/)
    .map(s => s.trim())
    .filter(Boolean);
  const funcs = dom.previewFuncs.value
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean);
  return { topic, devices, funcs };
}

function lockLevelAndDesc() {
  // 抽取模式下锁定等级 + 描述（AI 已抽完，以原文为准）
  dom.inputDesc.readOnly = true;
  dom.inputDesc.classList.add('readonly-locked');
  document.querySelectorAll('input[name="level"]').forEach(r => {
    r.disabled = true;
    r.closest('.level-card').classList.add('disabled');
    r.closest('.level-card').style.cursor = 'not-allowed';
    r.closest('.level-card').title = '抽取模式下等级自动判定';
  });
  document.querySelectorAll('.level-card').forEach(c => {
    c.style.pointerEvents = 'none';
    c.style.opacity = '0.6';
  });
}

function unlockLevelAndDesc() {
  dom.inputDesc.readOnly = false;
  dom.inputDesc.classList.remove('readonly-locked');
  document.querySelectorAll('input[name="level"]').forEach(r => {
    r.disabled = false;
    r.closest('.level-card').classList.remove('disabled');
    r.closest('.level-card').style.cursor = '';
    r.closest('.level-card').title = '';
  });
  document.querySelectorAll('.level-card').forEach(c => {
    c.style.pointerEvents = '';
    c.style.opacity = '';
  });
}

// === 事件绑定 ===
function bindEvents() {
  // 主题切换
  ThemeToggle.init();

  // 字符计数 + 22级库建议
  dom.inputDesc.addEventListener('input', () => {
    dom.charCount.textContent = dom.inputDesc.value.length;
  });
  dom.inputTopic.addEventListener('input', () => {
    showCatalogSuggest(dom.inputTopic.value.trim());
  });
  // 失焦时收起建议（350ms 让用户能点中候选）
  dom.inputTopic.addEventListener('blur', () => {
    setTimeout(() => dom.topicSuggest.classList.add('hidden'), 350);
  });
  // 聚焦时如果已有输入，显示建议
  dom.inputTopic.addEventListener('focus', () => {
    if (dom.inputTopic.value.trim().length >= 2) {
      showCatalogSuggest(dom.inputTopic.value.trim());
    }
  });

  // 描述清空
  dom.btnClearDesc.addEventListener('click', () => {
    dom.inputDesc.value = '';
    dom.charCount.textContent = '0';
    UIContainer.toast('已清空描述', 'success');
  });

  // 等级卡片 change 事件（修复按钮切换）
  document.querySelectorAll('input[name="level"]').forEach(radio => {
    radio.addEventListener('change', () => {
      document.querySelectorAll('.level-card').forEach(c => c.classList.remove('active'));
      radio.closest('.level-card').classList.add('active');
    });
  });
  // 同时绑 click 事件（保证 label 点击也响应）
  document.querySelectorAll('.level-card').forEach(card => {
    card.addEventListener('click', (e) => {
      // 让 label 原生处理 radio 切换
      const radio = card.querySelector('input[type="radio"]');
      if (radio && !radio.checked) {
        radio.checked = true;
        document.querySelectorAll('.level-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
      }
    });
  });

  // 高级选项自定义
  ['adv-mcu', 'adv-display', 'adv-power'].forEach(id => {
    const sel = $(id);
    const custom = $(id + '-custom');
    if (sel && custom) {
      sel.addEventListener('change', () => {
        if (sel.value === '__custom__') {
          custom.style.display = 'block';
          custom.focus();
        } else {
          custom.style.display = 'none';
          custom.value = '';
        }
      });
    }
  });

  // 模板按钮
  dom.btnTemplate.addEventListener('click', () => dom.templateDialog.showModal());
  dom.templateClose.addEventListener('click', () => dom.templateDialog.close());
  document.querySelectorAll('.template-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const tpl = btn.dataset.template;
      const texts = {
        lamp: '需要 2 个传感器（光敏电阻、人体红外），3 个执行器（LED 灯、蜂鸣器、舵机）。阈值 300 lux 触发开灯。人离开后延时 30 秒关灯。',
        home: '监测温湿度、烟雾、门窗状态。远程通过 WiFi 控制灯光、空调、窗帘。报警时推送通知到手机 APP。',
        car: '超声波测距避障，红外循迹，蓝牙遥控。3 种模式：自动避障 / 循迹 / 遥控。',
      };
      dom.inputDesc.value = texts[tpl] || '';
      dom.charCount.textContent = dom.inputDesc.value.length;
      dom.templateDialog.close();
    });
  });

  // 生成按钮
  dom.btnGenerate.addEventListener('click', onGenerate);

  // 复制按钮
  dom.btnCopy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(state.lastResult);
      UIContainer.toast('已复制到剪贴板', 'success');
    } catch (e) {
      UIContainer.showError(e);
    }
  });

  // 下载按钮
  dom.btnDownload.addEventListener('click', () => {
    if (!state.lastResult) {
      UIContainer.toast('暂无方案可下载', 'error');
      return;
    }
    const topic = dom.inputTopic.value.trim() || '方案';
    const filename = `${topic}-方案.docx`;
    DocxExporter.downloadDocx(state.lastResult, filename)
      .then(() => UIContainer.toast('已下载 ' + filename, 'success'))
      .catch(err => UIContainer.showError(err));
  });

  // 下一步按钮（v15.8 · 拆成两个：开题报告 / 论文）
  if (dom.btnNextTaskbook) dom.btnNextTaskbook.addEventListener('click', () => onNextStep('taskbook'));
  if (dom.btnNextThesis) dom.btnNextThesis.addEventListener('click', () => onNextStep('thesis'));

  // 复位/清空按钮
  dom.btnReset.addEventListener('click', onResetResult);

  // === 开题报告导入事件 ===
  dom.fileInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (file) await handleImportFile(file);
    dom.fileInput.value = '';  // 重置以允许重选同一文件
  });

  // 拖拽支持
  ['dragenter', 'dragover'].forEach(evt => {
    dom.importZone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dom.importZone.classList.add('dragging');
    });
  });
  ['dragleave', 'drop'].forEach(evt => {
    dom.importZone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dom.importZone.classList.remove('dragging');
    });
  });
  dom.importZone.addEventListener('drop', async (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file) await handleImportFile(file);
  });

  dom.btnClearImport.addEventListener('click', () => {
    state.imported = null;
    state.mode = 'create';
    dom.importPreview.classList.add('hidden');
    dom.btnClearImport.style.display = 'none';
    unlockLevelAndDesc();
    UIContainer.toast('已清除导入', 'info');
  });

  dom.btnDirectGenerate.addEventListener('click', () => {
    if (!state.imported?.extracted) {
      UIContainer.toast('请先导入开题报告', 'error');
      return;
    }
    // 读取用户编辑后的预览内容（不是 state.imported.extracted 原值）
    const edited = readPreviewEdits();
    if (!edited.topic) {
      UIContainer.toast('题目不能为空，请填写', 'error');
      dom.previewTopic.focus();
      return;
    }
    if (edited.funcs.length === 0) {
      UIContainer.toast('至少需要 1 条功能', 'error');
      dom.previewFuncs.focus();
      return;
    }
    onGenerate({ fromImport: true, edited });
  });

  // 快捷键 Ctrl+Enter
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (!state.isGenerating) onGenerate();
    }
  });
}

function restoreFromStorage() {
  const savedTopic = Storage.get('topic.lastInput.topic', '');
  const savedDesc = Storage.get('topic.lastInput.desc', '');
  const savedLevel = Storage.get('topic.lastInput.level', 'B');
  if (savedTopic) dom.inputTopic.value = savedTopic;
  if (savedDesc) {
    dom.inputDesc.value = savedDesc;
    dom.charCount.textContent = savedDesc.length;
  }
  const levelRadio = document.querySelector(`input[name="level"][value="${savedLevel}"]`);
  if (levelRadio) {
    levelRadio.checked = true;
    document.querySelectorAll('.level-card').forEach(c => c.classList.remove('active'));
    levelRadio.closest('.level-card').classList.add('active');
  }
}

function loadFromShared() {
  // 【v15.9.5】优先读 lastResult（不依赖 shared.meta，让切页面回来不丢内容）
  const lastResult = Storage.get('topic.lastResult', '');
  const sharedScheme = Storage.Shared.getScheme();
  if (lastResult && !state.lastResult) {
    state.lastResult = lastResult;
    showResult(lastResult, { fromShared: false });
  } else if (sharedScheme && !state.lastResult) {
    showResult(sharedScheme, { fromShared: true });
  }
}

function saveInput() {
  const getAdv = (selId, customId) => {
    const sel = $(selId);
    const custom = $(customId);
    if (sel && custom && sel.value === '__custom__') return custom.value || '';
    return sel ? sel.value : '';
  };
  Storage.set('topic.lastInput.topic', dom.inputTopic.value);
  Storage.set('topic.lastInput.desc', dom.inputDesc.value);
  Storage.set('topic.lastInput.level', document.querySelector('input[name="level"]:checked').value);
  Storage.set('topic.lastInput.advMcu', getAdv('adv-mcu', 'adv-mcu-custom'));
  Storage.set('topic.lastInput.advDisplay', getAdv('adv-display', 'adv-display-custom'));
  Storage.set('topic.lastInput.advPower', getAdv('adv-power', 'adv-power-custom'));
}

async function onGenerate(opts = {}) {
  const { fromImport = false, edited = null } = opts;
  let topic, desc, level, mcu, display, power;
  if (fromImport && edited) {
    // 抽取模式：题目/器件/功能都从预览区读（用户可能编辑过）
    topic = edited.topic;
    desc = '';
    level = 'auto';
    mcu = '未指定';
    display = '未指定';
    power = '未指定';
  } else {
    topic = dom.inputTopic.value.trim();
    if (!topic) {
      UIContainer.toast('请先填写题目', 'error');
      dom.inputTopic.focus();
      return;
    }
    desc = dom.inputDesc.value.trim();
    level = document.querySelector('input[name="level"]:checked').value;
    mcu = getAdvValue('adv-mcu', 'adv-mcu-custom');
    display = getAdvValue('adv-display', 'adv-display-custom');
    power = getAdvValue('adv-power', 'adv-power-custom');
  }
  if (state.isGenerating) {
    UIContainer.toast('正在生成中，请稍候', 'info');
    return;
  }

  // 关键修复：saveInput 移到生成成功后才调用。
  // 避免失败/abort 后输入仍被缓存、下次启动时只恢复一半。
  // （库加载场景中点库时同步输入即可）

  // 关键修复：prompt.md 作为 system prompt，用户输入作为 user message
  const systemPrompt = await loadPrompt();
  let userMessage;
  if (fromImport && state.imported?.text) {
    // 抽取模式：原文 + 用户编辑后的结果一起传
    // 【核心】AI 只能严格按编辑后的结果输出，不得添加任何原文没有的内容
    userMessage = `【开题报告原文】（供参考，不得凭空添加内容）\n${state.imported.text}\n\n---\n\n【用户整理后的题目】${topic}\n【用户整理后的器件】${edited.devices.join('、') || '（无）'}\n【用户整理后的功能】\n${edited.funcs.map((f, i) => (i+1) + '. ' + f).join('\n')}\n\n请按 prompt 中 extract 模式的规则，将上面【用户整理后的】内容整理为三段式方案。\n【严格约束】\n- 题目、器件、功能都以【用户整理后的】为准\n- 不要添加原文里【没有】的功能，即使原文里貌似有隐藏含义\n- 不要凭“想象”补全任何用户没填的内容`;
  } else {
    userMessage = buildUserMessage({ topic, desc, level, mcu, display, power });
  }

  state.isGenerating = true;
  dom.btnGenerate.disabled = true;
  dom.btnGenerate.classList.add('is-loading');
  state.abortController = UIContainer.showProgress('正在生成方案...');

  try {
    UIContainer.updateProgress(20, '正在准备请求...');
    await new Promise(r => setTimeout(r, 200));

    UIContainer.updateProgress(40, '正在调用 AI...');
    const result = await ApiClient.chat({
      systemPrompt,
      userMessage,
      temperature: 0.7,
      signal: state.abortController.signal,
    });

    UIContainer.updateProgress(80, '正在整理结果...');
    const cleaned = cleanResult(result);
    state.lastResult = cleaned;
    state.lastMeta = Markdown.extractMetadata(cleaned);  // 【v15.9】暂存，不写入 shared
    state.lastInputs = { topic, desc, level, mcu, display, power, fromImport, edited };
    // 生成成功后才存输入（失败/abort 不存，避免下次启动只恢复输入不恢复结果）
    saveInput();
    // 【v15.9.5】同时存生成结果——切走页面回来不至于丢内容
    Storage.set('topic.lastResult', cleaned);

    UIContainer.updateProgress(100, '完成');
    setTimeout(() => {
      UIContainer.hideProgress();
      showResult(cleaned);
      // 【v15.9 修复】不写入 shared meta——必须点“下一步”才共享（与 v9.3 规则一致）
      // 渲染完成只更新“已完成”主题进度（用于顶部进度条）
      Storage.Shared.markComplete('topic');
      updateProgress();
    }, 300);

  } catch (err) {
    UIContainer.hideProgress();
    if (err.name === 'AbortError') {
      UIContainer.toast('已取消生成', 'info');
    } else {
      UIContainer.showError(err);
    }
  } finally {
    state.isGenerating = false;
    state.abortController = null;
    dom.btnGenerate.disabled = false;
    dom.btnGenerate.classList.remove('is-loading');
  }
}

function getAdvValue(selId, customId) {
  const sel = $(selId);
  const custom = $(customId);
  if (sel && custom && sel.value === '__custom__') return custom.value.trim() || 'AI 自动推荐';
  return (sel && sel.value) || 'AI 自动推荐';
}

function buildUserMessage({ topic, desc, level, mcu, display, power }) {
  let msg = `【题目】${topic}\n`;
  msg += `【描述】${desc || '（无）'}\n`;
  msg += `【等级】${level}\n`;
  msg += `【主控】${mcu}\n`;
  msg += `【显示器】${display}\n`;
  msg += `【电源】${power}\n\n`;
  msg += '请按规则生成三段式方案（题目 + 器件 + 功能）。';
  return msg;
}

function cleanResult(text) {
  let t = (text || '').trim();
  // 剥离 <think>...</think> 思考过程（多种格式兼容）
  t = t.replace(/<think>[\s\S]*?<\/think>/gi, '');
  t = t.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '');
  // 去掉开头的 "我已..." "好的" 等废话
  t = t.replace(/^(我[已经仔细].+?[：:]\s*\n+)/i, '');
  t = t.replace(/^(好的[，,。.].+?\n+)/i, '');
  // 移除 markdown 代码块包裹
  t = t.replace(/^```(?:markdown|md)?\s*\n?/i, '');
  t = t.replace(/\n?```\s*$/i, '');
  return t.trim();
}

function showResult(md, opts = {}) {
  state.lastResult = md;
  dom.resultEmpty.classList.add('hidden');
  dom.resultContent.classList.remove('hidden');
  dom.resultBody.innerHTML = Markdown.render(md);
  if (opts.kind === 'library') {
    dom.resultStatus.textContent = `📚 库参考（${opts.libraryId || ''}）`;
    dom.resultStatus.classList.add('status-library');
    dom.resultStatus.classList.remove('status-generated');
  } else {
    dom.resultStatus.textContent = opts.fromShared ? '✓ 已加载' : '✓ 已生成';
    dom.resultStatus.classList.add('status-generated');
    dom.resultStatus.classList.remove('status-library');
  }
  dom.resultTime.textContent = new Date().toLocaleString('zh-CN');
  if (!opts.fromShared) {
    setTimeout(() => {
      dom.resultContent.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  }

  // 生成成功后提示可跳论文页
  setTimeout(() => {
    UIContainer.toast('生成成功！点右上角「下一步：论文」可继续生成论文', 'success', 4000);
  }, 600);
}

function onResetResult() {
  // 完全复位：清空输入 + 等级回 B + 高级选项回默认 + 清生成框 + 清 storage
  dom.inputTopic.value = '';
  dom.inputDesc.value = '';
  dom.charCount.textContent = '0';

  // 等级回 B
  const defaultLevel = 'B';
  const defaultRadio = document.querySelector(`input[name="level"][value="${defaultLevel}"]`);
  if (defaultRadio) {
    defaultRadio.checked = true;
    document.querySelectorAll('.level-card').forEach(c => c.classList.remove('active'));
    defaultRadio.closest('.level-card').classList.add('active');
  }

  // 高级选项回默认（主控 STM32F103C8T6 / 显示 OLED / 电源 5V适配器）
  resetAdv('adv-mcu', 'adv-mcu-custom', 'STM32F103C8T6');
  resetAdv('adv-display', 'adv-display-custom', 'OLED 0.96寸');
  resetAdv('adv-power', 'adv-power-custom', '5V适配器');

  // 收起库建议
  if (dom.topicSuggest) dom.topicSuggest.classList.add('hidden');

  // 清上传的开题报告 + 预览区 + 解锁
  if (state.imported) {
    state.imported = null;
    state.mode = 'create';
    if (dom.importPreview) dom.importPreview.classList.add('hidden');
    if (dom.btnClearImport) dom.btnClearImport.style.display = 'none';
    if (dom.previewTopic) dom.previewTopic.value = '';
    if (dom.previewDevices) dom.previewDevices.value = '';
    if (dom.previewFuncs) dom.previewFuncs.value = '';
    if (dom.previewFuncCount) dom.previewFuncCount.textContent = '(0)';
    if (dom.fileInput) dom.fileInput.value = '';
    unlockLevelAndDesc();
  }

  // 清生成框
  state.lastResult = '';

  // 清 storage（lastInput + lastResult + shared.scheme + shared.meta + shared.progress.topic）
  Storage.remove('topic.lastInput.topic');
  Storage.remove('topic.lastInput.desc');
  Storage.remove('topic.lastInput.level');
  Storage.remove('topic.lastInput.advMcu');
  Storage.remove('topic.lastInput.advDisplay');
  Storage.remove('topic.lastInput.advPower');
  Storage.remove('topic.lastResult');  // 【v15.9.5】生成结果也清
  Storage.Shared.clearScheme();
  Storage.Shared.clearMeta();
  Storage.Shared.setTopic('');   // 【v15.9】清 topic
  Storage.Shared.setDevices([]); // 【v15.9】清器件
  Storage.Shared.setFuncs([]);   // 【v15.9】清功能
  // 复位后清除 topic 完成标记（顶部进度条回到 active）
  const progress = Storage.Shared.getProgress();
  if (progress.topic) {
    progress.topic = false;
    Storage.set('shared.progress', progress);
  }
  updateProgress();  // 【v15.9.3】刷新进度条 UI（去掉 topic 的已完成绿色）

  // 显示空状态
  dom.resultEmpty.classList.remove('hidden');
  dom.resultContent.classList.add('hidden');
  dom.resultBody.innerHTML = '';

  UIContainer.toast('已复位全部内容', 'success');
  updateProgress();
}

function resetAdv(selId, customId, defaultValue) {
  const sel = $(selId);
  const custom = $(customId);
  if (!sel) return;
  // 找到匹配 defaultValue 的 option，没有就选第一项
  const target = Array.from(sel.options).find(o => o.value === defaultValue) || sel.options[0];
  if (target) sel.value = target.value;
  if (custom) {
    custom.style.display = 'none';
    custom.value = '';
  }
}

async function onNextStep(dest = 'taskbook') {
  if (!state.lastResult) {
    UIContainer.toast('请先生成方案', 'error');
    return;
  }
  // 【v15.9】点“下一步”才写入 shared meta（v9.3 规则：主动存档）
  // 复用 onGenerate 暂存的 state.lastMeta，避免重复 extract
  const cleaned = state.lastResult;
  const parsed = state.lastMeta || Markdown.extractMetadata(cleaned);
  const inputs = state.lastInputs || {};
  // 【【v15.10.6】题目不变原则】题目用用户原始输入或预览区编辑结果，不受 AI 输出标题影响
  // create 模式：topicVal = dom.inputTopic.value（用户填的）
  // 抽模式：previewTopic = inputs.edited.topic（用户在预览区编辑过的）
  // 兜底：parsed.topic（AI 抽取的）—— 仅在用户没填也没编辑时使用
  const topicVal = dom.inputTopic.value.trim();
  const previewTopic = (inputs.edited && inputs.edited.topic) ? inputs.edited.topic.trim() : '';
  const finalTopic = topicVal || previewTopic || (parsed.topic || '');
  const mergedMeta = {
    topic: finalTopic,
    level: 'B',
    source: 'ai',
    mcu: '',
    display: '',
    power: '',
    devices: Array.isArray(parsed.devices) && parsed.devices.length
      ? parsed.devices
      : (Array.isArray(parsed.devicesRaw)
          ? parsed.devicesRaw
          : (typeof parsed.devicesRaw === 'string'
              ? parsed.devicesRaw.split(/[、,，]/).map(s => s.trim()).filter(Boolean)
              : [])),
    funcs: Array.isArray(parsed.funcs) && parsed.funcs.length
      ? parsed.funcs.map(f => typeof f === 'string' ? f : (f.text || JSON.stringify(f)))
      : (Array.isArray(parsed.funcsRaw) ? parsed.funcsRaw : []),
    generatedAt: new Date().toISOString(),
    generatorVersion: 'v15.10.6',
  };
  Storage.Shared.setTopic(mergedMeta.topic);
  Storage.Shared.setScheme(cleaned);
  Storage.Shared.setDevices(mergedMeta.devices);
  Storage.Shared.setFuncs(mergedMeta.funcs);
  Storage.Shared.setMeta(mergedMeta);
  Storage.Shared.markComplete('topic');

  if (dest === 'thesis') {
    // 跳过开题报告，直接生成论文
    try {
      const r = await fetch('../thesis/index.html', { method: 'HEAD' });
      if (r.ok) {
        UIContainer.toast('已保存方案数据，跳到论文生成...', 'info', 1500);
        setTimeout(() => { window.location.href = '../thesis/index.html'; }, 600);
        return;
      }
    } catch (e) {
      UIContainer.toast('论文页不可用，请检查路径', 'error');
      return;
    }
  } else {
    // 默认：先生成开题报告
    try {
      const r = await fetch('../taskbook/index.html', { method: 'HEAD' });
      if (r.ok) {
        UIContainer.toast('已保存方案数据，跳到开题报告...', 'info', 1500);
        setTimeout(() => { window.location.href = '../taskbook/index.html'; }, 600);
        return;
      }
    } catch (e) {
      UIContainer.toast('开题报告页不可用，请检查路径', 'error');
      return;
    }
  }
  UIContainer.toast('页面不可用，方案已保存到本地', 'success');
}

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
    } else if (stage === 'topic') {
      el.classList.add('active');
      el.classList.remove('done');
      if (icon) icon.textContent = '';
    } else {
      el.classList.remove('done', 'active');
      if (icon) icon.textContent = '';
    }
  });
}

async function loadPrompt() {
  try {
    const r = await fetch('./prompt.md');
    if (r.ok) return await r.text();
  } catch (e) {
    console.warn('Failed to load prompt.md');
  }
  return '你是嵌入式项目方案专家。按等级生成三段式方案（题目+器件+功能）。';
}