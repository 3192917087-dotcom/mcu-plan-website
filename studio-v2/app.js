import * as Store from './storage.js?v=20260826-1';
import * as Prompts from './prompts.js?v=20260901-3';
import { allPins, compatiblePins, validateMappings } from './pin-data.js?v=20260830-1';
import { REFERENCE_LIBRARY, REFERENCE_LIBRARY_META } from './reference-library.js?v=20260826-2';
import * as Rules from '../studio-next/rules.js?v=20260824-6';
import {
  FIGURE_ARTIFACT_TYPES,
  TABLE_ARTIFACT_TYPES,
  mergeFinalQualityIssues,
  synchronizeArtifactPresentation,
  validateArtifactLedger,
} from './paper-quality.js?v=20260901-3';

const PAGE_CONFIG = globalThis.MCU_PAGE_CONFIG || {};
const APP_TITLE = '雄鸡工作室｜单片机方案与论文';
const API_SETTINGS_KEY = 'mcu-paper-studio-v2.api-settings';
const REFERENCE_TOOL_KEY = 'mcu-paper-studio-v2.reference-tool';
const MOTIVATION_KEY = 'mcu-paper-studio-v2.daily-motivation-v2';
const MOTIVATION_REFRESH_MIN_MS = 90 * 1000;
const MOTIVATION_REFRESH_MAX_MS = 4 * 60 * 1000;
const MOTIVATION_SCHEDULE_VERSION = 2;
const MOTIVATION_AI_INTERVAL = 4;
const MIN_BODY_CHARS = 15000;
const QUALITY_ENGINE_VERSION = 2;
const MAX_PROGRAM_FILE_BYTES = 2 * 1024 * 1024;
const MAX_PROGRAM_TOTAL_CHARS = 240000;
const PROGRAM_FILE_EXTENSIONS = new Set([
  'c','h','cc','cpp','cxx','hh','hpp','hxx','ino','pde','s','asm','a51','src','inc','py','ld','lds','ioc',
  'cfg','conf','ini','json','yaml','yml','toml','dts','overlay','kconfig','mk','cmake','txt','uvprojx','uvoptx','ewp',
]);
const DEFAULT_API = Object.freeze({
  mode: 'user',
  provider: 'deepseek',
  apiUrl: String(PAGE_CONFIG.apiUrl || 'https://api.deepseek.com/chat/completions'),
  apiKey: '',
  chatModel: String(PAGE_CONFIG.chatModel || 'deepseek-v4-pro'),
  reasoningModel: String(PAGE_CONFIG.reasoningModel || PAGE_CONFIG.chatModel || 'deepseek-v4-pro'),
});
const API_PRESETS = Object.freeze({
  deepseek: { apiUrl: 'https://api.deepseek.com/chat/completions', chatModel: 'deepseek-v4-pro', reasoningModel: 'deepseek-v4-pro' },
  zhipu: { apiUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', chatModel: 'glm-5.2', reasoningModel: 'glm-5.2' },
  moonshot: { apiUrl: 'https://api.moonshot.cn/v1/chat/completions', chatModel: 'kimi-k3', reasoningModel: 'kimi-k3' },
  openai: { apiUrl: 'https://api.openai.com/v1/chat/completions', chatModel: 'gpt-5.6-terra', reasoningModel: 'gpt-5.6-sol' },
  newapi9898: { apiUrl: 'https://www.9898.ai/v1', chatModel: 'gpt-5.5', reasoningModel: 'gpt-5.5' },
  compatible: { apiUrl: '', chatModel: '', reasoningModel: '' },
});
let activeApiConfig = { ...DEFAULT_API };

const $ = id => document.getElementById(id);
const qs = (selector, root = document) => root.querySelector(selector);
const qsa = (selector, root = document) => [...root.querySelectorAll(selector)];

let projects = [];
let project = null;
let currentRoute = 'projects';
let schemeStep = 'input';
let paperStep = 'materials';
let requestController = null;
let requestTask = '';
let saveTimer = null;
let saveQueue = Promise.resolve();
let generationClock = null;
let operationStatusTimer = null;
let standaloneReferenceState = {
  title: '', notes: '', count: 15, selectedIds: [], recommendationIds: [], reasons: {}, source: '', summary: '', updatedAt: '',
};
let dailyMotivationState = { date: '', text: '', source: '', updatedAt: 0, nextRefreshAt: 0, rotationCount: 0, scheduleVersion: 0 };
let motivationRefreshTimer = null;
let motivationRequestInFlight = false;
const FALLBACK_MOTIVATIONS = Object.freeze([
  '长风破浪会有时，直挂云帆济沧海。',
  '不积跬步，无以至千里；不积小流，无以成江海。',
  '千磨万击还坚劲，任尔东西南北风。',
  '纸上得来终觉浅，绝知此事要躬行。',
  '天行健，君子以自强不息。',
  '山重水复疑无路，柳暗花明又一村。',
  '博观而约取，厚积而薄发。',
]);

function nowIso() { return new Date().toISOString(); }
function makeId(prefix = 'item') {
  if (crypto?.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
function clone(value) { return structuredClone(value); }
function lines(value) { return String(value || '').replace(/\r\n?/g, '\n').split('\n').map(item => item.trim()).filter(Boolean); }
function unique(values) { return [...new Set((values || []).map(value => String(value || '').trim()).filter(Boolean))]; }
function sanitizeTechnicalText(value) {
  return String(value || '')
    .replace(/ESP\s*[-_]?\s*8266/gi, 'ESP-01S')
    .replace(/(^|[^\d.])96\s*寸\s*OLED/gi, '$10.96寸OLED')
    .replace(/2\.8\s*寸\s*TFT/gi, '1.8寸TFT');
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}
function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function safeFilename(value) { return String(value || '未命名项目').replace(/[\\/:*?"<>|]/g, '_').slice(0, 70); }
function clampReferenceCount(value) { return Math.max(5, Math.min(30, Number(value) || 15)); }
function loadStandaloneReferenceState() {
  try {
    const saved = JSON.parse(localStorage.getItem(REFERENCE_TOOL_KEY) || '{}');
    standaloneReferenceState = { ...standaloneReferenceState, ...saved, count: clampReferenceCount(saved.count) };
  } catch (error) {}
}
function saveStandaloneReferenceState() {
  try { localStorage.setItem(REFERENCE_TOOL_KEY, JSON.stringify(standaloneReferenceState)); } catch (error) {}
}
function clearStandaloneReferenceResults() {
  standaloneReferenceState = {
    ...standaloneReferenceState,
    selectedIds: [],
    recommendationIds: [],
    reasons: {},
    source: '',
    summary: '',
    updatedAt: '',
  };
  saveStandaloneReferenceState();
  renderStandaloneReferenceTool();
  toast('文献推荐结果已清除', 'success');
}
function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
function randomMotivationDelay() {
  return Math.round(MOTIVATION_REFRESH_MIN_MS + Math.random() * (MOTIVATION_REFRESH_MAX_MS - MOTIVATION_REFRESH_MIN_MS));
}
function loadDailyMotivation() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(MOTIVATION_KEY) || '{}');
  } catch (error) {}
  const date = todayKey();
  const now = Date.now();
  const needsNewText = saved.date !== date || !String(saved.text || '').trim();
  const needsScheduleMigration = Number(saved.scheduleVersion) !== MOTIVATION_SCHEDULE_VERSION || !Number.isFinite(Number(saved.nextRefreshAt));
  dailyMotivationState = {
    date,
    text: needsNewText ? FALLBACK_MOTIVATIONS[Math.floor(now / 86400000) % FALLBACK_MOTIVATIONS.length] : String(saved.text).trim(),
    source: needsNewText ? 'local' : String(saved.source || 'local'),
    updatedAt: needsNewText ? now : Number(saved.updatedAt) || now,
    nextRefreshAt: needsNewText || needsScheduleMigration ? now : Number(saved.nextRefreshAt),
    rotationCount: needsNewText ? 0 : Math.max(0, Number(saved.rotationCount) || 0),
    scheduleVersion: MOTIVATION_SCHEDULE_VERSION,
  };
  saveDailyMotivation();
}
function saveDailyMotivation() {
  try { localStorage.setItem(MOTIVATION_KEY, JSON.stringify(dailyMotivationState)); } catch (error) {}
}
function renderDailyMotivation() {
  const node = $('daily-motivation-text');
  if (!node) return;
  const text = dailyMotivationState.text || FALLBACK_MOTIVATIONS[0];
  qsa('.daily-motivation-text', $('daily-motivation-track')).forEach(item => { item.textContent = text; });
  restartMotivationTicker();
}
function restartMotivationTicker() {
  const track = $('daily-motivation-track');
  const first = $('daily-motivation-text');
  const viewport = qs('.daily-motivation-viewport');
  if (!track || !first || !viewport) return;
  track.classList.remove('is-running');
  // 保证滚动轨道始终覆盖视口，前一份文字离开左侧时后一份从右侧接上。
  const gap = parseFloat(getComputedStyle(track).columnGap || getComputedStyle(track).gap || '0') || 0;
  const shift = first.getBoundingClientRect().width + gap;
  track.style.setProperty('--motivation-shift', `${shift}px`);
  let copies = qsa('.daily-motivation-text', track).length;
  while (track.scrollWidth < viewport.clientWidth + shift && copies < 24) {
    const clone = first.cloneNode(true);
    clone.removeAttribute('id');
    clone.setAttribute('aria-hidden', 'true');
    track.append(clone);
    copies += 1;
  }
  void track.offsetWidth;
  track.classList.add('is-running');
}
function motivationRefreshDue(now = Date.now()) {
  return now >= (Number(dailyMotivationState.nextRefreshAt) || 0);
}
function rotateFallbackMotivation(updatedAt = Date.now()) {
  const previousText = dailyMotivationState.text;
  const currentIndex = FALLBACK_MOTIVATIONS.indexOf(previousText);
  const rotationCount = Math.max(0, Number(dailyMotivationState.rotationCount) || 0) + 1;
  const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % FALLBACK_MOTIVATIONS.length : rotationCount % FALLBACK_MOTIVATIONS.length;
  dailyMotivationState = {
    ...dailyMotivationState,
    date: todayKey(),
    text: FALLBACK_MOTIVATIONS[nextIndex],
    source: 'local',
    updatedAt,
    nextRefreshAt: updatedAt + randomMotivationDelay(),
    rotationCount,
    scheduleVersion: MOTIVATION_SCHEDULE_VERSION,
  };
  saveDailyMotivation();
  renderDailyMotivation();
  return previousText;
}
function scheduleDailyMotivationRefresh() {
  if (motivationRefreshTimer) clearTimeout(motivationRefreshTimer);
  const delay = Math.max(500, (Number(dailyMotivationState.nextRefreshAt) || Date.now()) - Date.now());
  motivationRefreshTimer = setTimeout(() => { void refreshDailyMotivation({ force: true }); }, delay);
}
async function refreshDailyMotivation({ force = false } = {}) {
  if (motivationRequestInFlight) {
    scheduleDailyMotivationRefresh();
    return;
  }
  const date = todayKey();
  if (dailyMotivationState.date !== date) loadDailyMotivation();
  renderDailyMotivation();
  const due = force || motivationRefreshDue();
  if (!due) {
    scheduleDailyMotivationRefresh();
    return;
  }
  const previousText = rotateFallbackMotivation();
  scheduleDailyMotivationRefresh();
  // 每次到期都先本地换句；每四轮才用AI补充一次，避免影响论文等主要任务。
  const shouldAskAi = activeApiConfig.apiKey && !requestController && dailyMotivationState.rotationCount % MOTIVATION_AI_INTERVAL === 0;
  if (!shouldAskAi) return;
  motivationRequestInFlight = true;
  try {
    const slot = dailyMotivationState.rotationCount;
    const avoidTexts = unique([previousText, dailyMotivationState.text]);
    const raw = await callAi(Prompts.buildDailyMotivationMessages({ date, slot, avoidTexts }), { reasoning: false, maxTokens: 240, jsonMode: true, requestLabel: '励志语更新', timeoutMs: 25000 });
    const result = await parseAiJson(raw, { requestLabel: '每日鼓励语', maxTokens: 240 });
    const text = String(result.text || '').replace(/[\r\n]+/g, ' ').replace(/^['“”"\s]+|['“”"\s]+$/g, '').trim();
    if (text.length >= 8 && text.length <= 80 && text !== previousText && text !== dailyMotivationState.text && !/(API|模型|AI|接口|生成失败)/i.test(text)) {
      dailyMotivationState = { ...dailyMotivationState, date, text, source: 'ai', slot, updatedAt: Date.now() };
      saveDailyMotivation();
      renderDailyMotivation();
    }
  } catch (error) {
    // 到期时已经先行轮换本地语句，AI失败不影响励志语更新和主要功能。
  } finally {
    motivationRequestInFlight = false;
    scheduleDailyMotivationRefresh();
  }
}
function countBodyChars(value) {
  return String(value || '')
    .replace(/【非正文·[\s\S]*?【非正文结束】/g, '')
    .replace(/^#{1,6}.*$/gm, '')
    .replace(/^\s*\|.*\|\s*$/gm, '')
    .replace(/[\s`*_#|\-]/g, '').length;
}
function totalBodyChars() { return Object.values(project?.paper?.chapters || {}).reduce((sum, chapter) => sum + countBodyChars(chapter.content), 0); }
function formatTime(totalSeconds) {
  const seconds = Math.max(0, Number(totalSeconds) || 0);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const remainder = Math.floor(seconds % 60);
  return hours ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}` : `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}
function toast(message, type = 'info') {
  const node = document.createElement('div');
  node.className = `toast ${type === 'error' ? 'is-error' : type === 'success' ? 'is-success' : ''}`;
  node.textContent = message;
  $('toast-region')?.append(node);
  setTimeout(() => node.remove(), 4200);
}

function setOperationStatus(state = 'idle', label = '') {
  const status = $('operation-status');
  const textNode = $('operation-status-text');
  if (!status || !textNode) return;
  clearTimeout(operationStatusTimer);
  if (state === 'idle' || !label) {
    status.hidden = true;
    status.className = 'operation-status';
    textNode.textContent = '';
    return;
  }
  status.hidden = false;
  status.className = `operation-status is-${state}`;
  status.setAttribute('aria-busy', state === 'busy' ? 'true' : 'false');
  textNode.textContent = label;
  if (state !== 'busy') operationStatusTimer = setTimeout(() => setOperationStatus('idle'), state === 'error' ? 9000 : 4500);
}
function parseJsonResponse(value) {
  const text = String(value || '').replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  try { return JSON.parse(text); } catch (error) {}
  const starts = [text.indexOf('{'), text.indexOf('[')].filter(index => index >= 0).sort((a, b) => a - b);
  if (!starts.length) throw new Error('AI没有返回可识别的数据');
  const start = starts[0];
  for (let end = text.length; end > start; end -= 1) {
    const character = text[end - 1];
    if (character !== '}' && character !== ']') continue;
    try { return JSON.parse(text.slice(start, end)); } catch (error) {}
  }
  throw new Error('AI返回的数据不完整，请重试');
}

function freshGeneration() {
  return {
    status: 'idle',
    phase: 'idle',
    percent: 0,
    message: '点击开始后先自动规划论文结构，再逐章生成并保存。',
    currentChapterId: '',
    completedChapterIds: [],
    startedAt: '',
    updatedAt: '',
    completedAt: '',
    lastError: '',
    inputRevision: '',
    auditCompleted: false,
    activeRequestLabel: '',
  };
}

function freshQuality() {
  return {
    engineVersion: QUALITY_ENGINE_VERSION,
    issues: [],
    aiIssues: [],
    checkedAt: '',
    aiCheckedAt: '',
    bodyChars: 0,
    auditStage: '',
    resultStage: '',
    autoRepaired: 0,
  };
}

function createBlankProject(name = '未命名项目', start = 'paper') {
  const now = nowIso();
  const title = name === '未命名项目' ? '' : name;
  const outline = [];
  return {
    schemaVersion: 28,
    id: makeId('project'),
    name,
    title,
    start,
    createdAt: now,
    updatedAt: now,
    factRevision: `facts-${Date.now()}`,
    scheme: {
      status: 'empty',
      title,
      requirements: '',
      countMode: 'random',
      functionCount: 8,
      preferences: { controller: 'auto', display: 'auto', programmingSoftware: [], appSoftware: [], cloudPlatforms: [] },
      structured: null,
      text: '',
      generatedAt: '',
    },
    paper: {
      step: 'materials',
      materials: {
        schemeSourceId: '', schemeRawText: '', schemeFilename: '', devicesText: '', functionsText: '', connectionsText: '', codeText: '', referencesText: '',
        testInfo: '', toolsText: '', autoDevelopmentTools: [], photoNotes: '', sourceNotes: '', filenames: [], codeFiles: [],
        sourceDocumentFilename: '', sourceDocumentText: '', sourceBackgroundText: '',
        schematicFilename: '', schematicText: '', outlineReferenceText: '', outlineReferenceFilename: '', targetBodyChars: MIN_BODY_CHARS,
        useReferencesInPaper: true, referenceRecommendationCount: 15,
        referenceRecommendationIds: [], referenceRecommendationReasons: {}, referenceRecommendationSource: '', referenceRecommendationSummary: '', referenceRecommendationAt: '',
      },
      factSheet: {
        controller: '', devices: [], functions: [], mappings: [], powerNotes: [], fixedFacts: [], conflicts: [], conflictsAcknowledged: false, analyzedAt: '', confirmedAt: '',
      },
      outlineTemplate: Prompts.DEFAULT_OUTLINE_ID,
      outline,
      outlineCustomized: false,
      outlinePlanning: { status: 'idle', generatedAt: '', summary: '', lastError: '', source: '', inputRevision: '' },
      outlineConfirmedAt: '',
      artifacts: [],
      chapters: {},
      referenceRecords: [],
      titleEn: '', abstractCn: '', abstractEn: '', keywords: '', keywordsEn: '', acknowledgment: '',
      generation: freshGeneration(),
      quality: freshQuality(),
    },
  };
}

function inferChapterKind(title = '') {
  if (/绪论|引言/.test(title)) return 'introduction';
  if (/需求|可行性/.test(title)) return 'requirement';
  if (/总体|方案/.test(title)) return 'overall';
  if (/软硬件|实现/.test(title)) return 'implementation';
  if (/硬件|电路/.test(title)) return 'hardware';
  if (/软件|程序/.test(title)) return 'software';
  if (/测试|调试/.test(title)) return 'test';
  if (/总结|结论|展望/.test(title)) return 'conclusion';
  return 'overall';
}

function normalizeProject(source, options = {}) {
  const base = createBlankProject(source?.name || source?.title || '导入项目', source?.start || 'paper');
  const isV2 = Number(source?.schemaVersion) >= 20;
  const duplicate = Boolean(options.duplicate);
  const imported = Boolean(options.imported);
  if (isV2) {
    const normalized = { ...base, ...clone(source) };
    normalized.paper = { ...base.paper, ...(clone(source.paper) || {}) };
    normalized.paper.materials = { ...base.paper.materials, ...(clone(source.paper?.materials) || {}) };
    normalized.paper.factSheet = { ...base.paper.factSheet, ...(clone(source.paper?.factSheet) || {}) };
    normalized.paper.outlinePlanning = { ...base.paper.outlinePlanning, ...(clone(source.paper?.outlinePlanning) || {}) };
    normalized.paper.generation = { ...freshGeneration(), ...(clone(source.paper?.generation) || {}) };
    const loadedQuality = clone(source.paper?.quality) || {};
    const qualityIsCurrent = Number(loadedQuality.engineVersion) === QUALITY_ENGINE_VERSION;
    normalized.paper.quality = qualityIsCurrent
      ? { ...freshQuality(), ...loadedQuality }
      : freshQuality();
    if (qualityIsCurrent) {
      normalized.paper.quality.aiIssues = mergeFinalQualityIssues([], normalized.paper.quality.aiIssues || []);
      normalized.paper.quality.issues = mergeFinalQualityIssues([], normalized.paper.quality.issues || []);
    }
    if (!qualityIsCurrent && normalized.paper.generation.status === 'completed') {
      normalized.paper.generation.message = '已有论文内容已保留；质量规则已更新，下次生成时会按终稿规则重新检查。';
      normalized.paper.generation.auditCompleted = false;
    }
    if (normalized.paper.generation.status === 'completed' && !normalized.paper.quality.checkedAt && /(?:仍有|检查出)\s*\d+\s*项/.test(normalized.paper.generation.message || '')) {
      normalized.paper.generation.message = '已有论文内容已保留；质量规则已更新，下次生成时会按终稿规则重新检查。';
      normalized.paper.generation.auditCompleted = false;
    }
    // 旧版本曾把三级标题数量作为质量问题；当前目录按项目事实动态生成，
    // 因此加载旧项目时移除已经失效的历史提醒，避免误导用户。
    const isLegacyHeadingCountIssue = issue => /三级标题过多|合并同类内容/.test(issue?.message || '');
    normalized.paper.quality.issues = (normalized.paper.quality.issues || []).filter(issue => !isLegacyHeadingCountIssue(issue));
    normalized.paper.quality.aiIssues = (normalized.paper.quality.aiIssues || []).filter(issue => !isLegacyHeadingCountIssue(issue));
    if (Number(source?.schemaVersion) < 23 && normalized.paper.outline?.length && normalized.paper.outlinePlanning?.status === 'legacy') {
      normalized.paper.outlinePlanning = {
        status: 'ready', generatedAt: normalized.paper.outlinePlanning.generatedAt || '', summary: '已有论文目录已保留，可直接核对或重新规划', lastError: '', source: 'migrated',
      };
    }
    if (Number(source?.schemaVersion) < 24) {
      normalized.paper.outlineConfirmedAt = '';
      normalized.paper.outlinePlanning = {
        ...normalized.paper.outlinePlanning,
        status: 'stale',
        summary: '下次生成论文时将按目标字数、器件和功能重新规划结构',
        lastError: '',
        inputRevision: '',
      };
      if (normalized.paper.step === 'outline') normalized.paper.step = normalized.paper.factSheet.confirmedAt ? 'generate' : 'pins';
    }
    normalized.scheme = { ...base.scheme, ...(clone(source.scheme) || {}) };
    normalized.scheme.preferences = { ...base.scheme.preferences, ...(clone(source.scheme?.preferences) || {}) };
    normalized.paper.materials.devicesText = sanitizeTechnicalText(normalized.paper.materials.devicesText);
    normalized.paper.materials.functionsText = sanitizeTechnicalText(normalized.paper.materials.functionsText);
    normalized.paper.materials.schemeRawText = sanitizeTechnicalText(normalized.paper.materials.schemeRawText);
    normalized.paper.factSheet.controller = sanitizeTechnicalText(normalized.paper.factSheet.controller);
    normalized.paper.factSheet.devices = (normalized.paper.factSheet.devices || []).map(item => ({ ...item, model: sanitizeTechnicalText(item.model), role: sanitizeTechnicalText(item.role) }));
    normalized.paper.factSheet.functions = (normalized.paper.factSheet.functions || []).map(item => ({ ...item, name: sanitizeTechnicalText(item.name), deviceModels: (item.deviceModels || []).map(sanitizeTechnicalText) }));
    normalized.paper.factSheet.mappings = (normalized.paper.factSheet.mappings || []).map(item => ({ ...item, device: sanitizeTechnicalText(item.device) }));
    if (normalized.scheme.structured) {
      normalized.scheme.structured.title = sanitizeTechnicalText(normalized.scheme.structured.title);
      normalized.scheme.structured.devices = (normalized.scheme.structured.devices || []).map(item => ({ ...item, model: sanitizeTechnicalText(item.model), role: sanitizeTechnicalText(item.role) }));
      normalized.scheme.structured.functions = (normalized.scheme.structured.functions || []).map(item => sanitizeTechnicalText(typeof item === 'string' ? item : item.name || item.description || ''));
      normalized.scheme.text = schemeText(normalized.scheme.structured);
    }
    if (normalized.paper.outlineTemplate !== Prompts.DEFAULT_OUTLINE_ID) {
      const hasExistingChapters = Object.values(normalized.paper.chapters || {}).some(chapter => chapter?.content);
      normalized.paper.outlineTemplate = Prompts.DEFAULT_OUTLINE_ID;
      normalized.paper.outline = Prompts.buildProjectOutline({ title: normalized.title, devices: normalized.paper.factSheet.devices, functions: normalized.paper.factSheet.functions, targetBodyChars: normalized.paper.materials.targetBodyChars });
      normalized.paper.outlineCustomized = false;
      normalized.paper.outlineConfirmedAt = '';
      if (hasExistingChapters) {
        Object.values(normalized.paper.chapters).forEach(chapter => { if (chapter?.content) chapter.status = 'stale'; });
        normalized.paper.generation.status = 'stale';
        normalized.paper.generation.message = '论文结构将在下次生成时按当前器件、功能和目标字数更新，原有正文已保留';
      }
    }
    if (duplicate || imported) normalized.id = makeId('project');
    if (duplicate) normalized.name = `${normalized.name || normalized.title || '项目'} 副本`;
    normalized.paper.materials.targetBodyChars = Math.max(MIN_BODY_CHARS, Math.min(40000, Number(normalized.paper.materials.targetBodyChars) || MIN_BODY_CHARS));
    normalized.paper.materials.codeFiles = Array.isArray(normalized.paper.materials.codeFiles)
      ? normalized.paper.materials.codeFiles.map(item => ({
        name: String(item?.name || '').trim(), path: String(item?.path || item?.name || '').trim(),
        extension: String(item?.extension || '').trim().toLowerCase(), size: Math.max(0, Number(item?.size) || 0), content: String(item?.content || ''),
      })).filter(item => item.name && item.content)
      : [];
    normalized.paper.materials.filenames = normalized.paper.materials.codeFiles.length
      ? normalized.paper.materials.codeFiles.map(item => item.path || item.name)
      : Array.isArray(normalized.paper.materials.filenames) ? normalized.paper.materials.filenames : [];
    normalized.schemaVersion = 27;
    normalized.updatedAt = nowIso();
    normalized.createdAt = duplicate || imported ? nowIso() : normalized.createdAt || nowIso();
    if (normalized.paper.generation.status === 'running') {
      normalized.paper.generation.status = 'paused';
      normalized.paper.generation.message = '上次生成已中断，可以从已保存章节继续';
    }
    return normalized;
  }

  base.id = duplicate || imported ? makeId('project') : source?.id || base.id;
  base.name = source?.title || source?.name || '旧版迁移项目';
  base.title = source?.title || '';
  base.scheme = {
    ...base.scheme,
    title: base.title,
    requirements: source?.requirements || source?.background || '',
    structured: source?.scheme?.structured || null,
    text: source?.scheme?.markdown || '',
    status: source?.scheme?.markdown ? 'ready' : 'empty',
  };
  const oldMaterials = source?.materials || {};
  base.paper.materials = {
    ...base.paper.materials,
    devicesText: oldMaterials.devicesText || '',
    functionsText: oldMaterials.functionsText || '',
    connectionsText: oldMaterials.connectionText || '',
    codeText: oldMaterials.codeText || '',
    referencesText: oldMaterials.referencesText || '',
    testInfo: oldMaterials.testInfo || '',
    toolsText: oldMaterials.tools || '',
    autoDevelopmentTools: [],
    photoNotes: oldMaterials.photoNotes || '',
    sourceNotes: oldMaterials.sourceNotes || '',
    filenames: Array.isArray(oldMaterials.filenames) ? oldMaterials.filenames : [],
    codeFiles: [],
    sourceDocumentFilename: oldMaterials.sourceDocumentFilename || '',
    sourceDocumentText: oldMaterials.sourceDocumentText || '',
    sourceBackgroundText: oldMaterials.sourceBackgroundText || '',
  };
  const oldDevices = source?.audit?.factSheet?.coreDevices || source?.scheme?.devices || lines(oldMaterials.devicesText);
  const oldFunctions = source?.audit?.factSheet?.coreFunctions || source?.scheme?.functions || lines(oldMaterials.functionsText);
  base.paper.factSheet = {
    ...base.paper.factSheet,
    controller: oldMaterials.pinController || oldDevices.find(item => /STM32|STC|ESP32|Arduino|AT89/i.test(String(item))) || '',
    devices: oldDevices.map((item, index) => typeof item === 'object' ? item : { id: `device-${index + 1}`, model: String(item).replace(/[（(].*$/, '').trim(), role: String(item).match(/[（(]([^）)]+)[）)]/)?.[1] || '' }),
    functions: oldFunctions.map((item, index) => typeof item === 'object' ? item : { id: `function-${index + 1}`, name: String(item), deviceModels: [] }),
    mappings: (oldMaterials.pinMappings || []).map(item => ({ id: item.id || makeId('mapping'), device: item.device || '', interfaceType: item.interfaceType || item.connection || 'GPIO', signal: item.signal || item.connection || 'CTRL', pin: item.pin || '待确认', alternatives: item.alternatives || [], busGroup: item.busGroup || '', shareAllowed: Boolean(item.shareAllowed) })),
  };
  base.paper.outline = Prompts.buildProjectOutline({ title: base.title, devices: base.paper.factSheet.devices, functions: base.paper.factSheet.functions, targetBodyChars: base.paper.materials.targetBodyChars });
  base.paper.outlineTemplate = Prompts.DEFAULT_OUTLINE_ID;
  base.paper.chapters = clone(source?.paper?.chapters || {});
  base.paper.abstractCn = source?.paper?.abstractCn || '';
  base.paper.abstractEn = source?.paper?.abstractEn || '';
  base.paper.keywords = source?.paper?.keywords || '';
  base.paper.titleEn = source?.paper?.titleEn || '';
  base.paper.keywordsEn = source?.paper?.keywordsEn || '';
  base.paper.acknowledgment = source?.paper?.acknowledgment || '';
  if (Object.values(base.paper.chapters).some(chapter => chapter?.content)) {
    base.paper.generation.status = 'paused';
    base.paper.generation.message = '已迁移旧版章节，可以继续生成或下载当前稿';
  }
  return base;
}

function loadApiSettings() {
  return { ...activeApiConfig };
}

function loadStoredCustomApiSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(API_SETTINGS_KEY) || 'null');
    return saved?.apiKey ? { ...DEFAULT_API, ...saved, mode: 'user' } : null;
  } catch (error) { return null; }
}

function saveApiSettings(settings) {
  const normalized = { ...DEFAULT_API, ...settings, mode: 'user' };
  localStorage.setItem(API_SETTINGS_KEY, JSON.stringify(normalized));
  activeApiConfig = normalized;
}

async function persistProject({ immediate = false } = {}) {
  if (!project) return;
  const operation = async () => {
    const saved = await Store.saveProject(project);
    project.updatedAt = saved.updatedAt;
    const index = projects.findIndex(item => item.id === project.id);
    if (index >= 0) projects[index] = clone(project);
    else projects.unshift(clone(project));
  };
  if (immediate) {
    clearTimeout(saveTimer);
    saveQueue = saveQueue.then(operation, operation);
    await saveQueue;
    return;
  }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveQueue = saveQueue.then(operation, operation).catch(error => toast(error.message || '自动保存失败', 'error'));
  }, 420);
}

function bumpFactRevision(reason = '资料已修改') {
  if (!project) return;
  project.factRevision = `facts-${Date.now()}`;
  project.paper.factSheet.confirmedAt = '';
  project.paper.outlineConfirmedAt = '';
  project.paper.outlinePlanning = { status: 'stale', generatedAt: '', summary: `${reason}，生成论文时将重新规划结构`, lastError: '', source: '', inputRevision: '' };
  project.paper.titleEn = '';
  project.paper.artifacts = [];
  Object.values(project.paper.chapters || {}).forEach(chapter => {
    if (chapter?.content) chapter.status = 'stale';
  });
  if (Object.values(project.paper.chapters || {}).some(chapter => chapter?.content)) {
    project.paper.generation.status = 'stale';
    project.paper.generation.message = `${reason}，原有正文已保留，继续生成时会更新受影响章节`;
  }
}

function invalidateOutlinePlan(reason = '参考目录已修改') {
  if (!project) return;
  project.paper.outlineConfirmedAt = '';
  project.paper.outlinePlanning = { status: 'stale', generatedAt: '', summary: `${reason}，生成论文时将重新规划结构`, lastError: '', source: '', inputRevision: '' };
  project.paper.artifacts = [];
  Object.values(project.paper.chapters || {}).forEach(chapter => { if (chapter?.content) chapter.status = 'stale'; });
  if (Object.values(project.paper.chapters || {}).some(chapter => chapter?.content)) {
    project.paper.generation.status = 'stale';
    project.paper.generation.message = `${reason}，原有正文已保留，下次生成时会自动更新结构`;
  }
}

function updateProjectNameFromTitle() {
  if (!project?.title) return;
  if (!project.name || project.name === '未命名项目' || project.name === '旧版迁移项目') {
    project.name = project.title;
    qsa('[data-current-project-name]').forEach(node => { node.textContent = project.name; });
    const activeOption = $('active-project-select')?.selectedOptions?.[0];
    if (activeOption) activeOption.textContent = project.name;
  }
}

async function init() {
  activeApiConfig = loadStoredCustomApiSettings() || { ...DEFAULT_API };
  loadStandaloneReferenceState();
  bindEvents();
  try {
    projects = await Store.listProjects();
    if (!projects.length && !Store.hasMigratedLegacyProject()) {
      const legacy = Store.readLegacyProject();
      if (legacy) {
        const migrated = normalizeProject(legacy, { imported: true });
        migrated.name = legacy.title || '旧版迁移项目';
        await Store.saveProject(migrated);
        Store.clearLegacyProject();
        projects = [migrated];
        Store.setActiveProjectId(migrated.id);
        toast('旧版项目已迁移到新版项目库', 'success');
      }
    }
    const activeId = Store.getActiveProjectId();
    project = projects.find(item => item.id === activeId) || projects[0] || null;
    if (project) {
      project = normalizeProject(project);
      Store.setActiveProjectId(project.id);
      paperStep = project.paper.step || 'materials';
    }
    const requestedRoute = location.hash.replace('#', '');
    currentRoute = ['projects', 'scheme', 'paper', 'tools'].includes(requestedRoute) && (project || ['projects', 'tools'].includes(requestedRoute)) ? requestedRoute : 'projects';
    loadDailyMotivation();
    renderAll();
    scheduleDailyMotivationRefresh();
    void checkActiveApiConnection({ silent: true });
    void refreshDailyMotivation();
  } catch (error) {
    toast(error.message || '项目数据库初始化失败', 'error');
    console.error(error);
  }
}

function renderAll() {
  qsa('[data-current-project-name]').forEach(node => { node.textContent = project?.name || project?.title || '尚未选择项目'; });
  renderProjectSwitcher();
  renderProjects();
  renderStandaloneReferenceTool();
  if (project) {
    renderScheme();
    renderPaper();
  }
  setRoute(currentRoute, { render: false });
}

function renderProjectSwitcher() {
  const select = $('active-project-select');
  if (!select) return;
  select.innerHTML = projects.length
    ? projects.map(item => `<option value="${escapeHtml(item.id)}" ${item.id === project?.id ? 'selected' : ''}>${escapeHtml(item.name || item.title || '未命名项目')}</option>`).join('')
    : '<option value="">尚无项目</option>';
  select.disabled = !projects.length;
}

function projectProgress(item) {
  const generation = item.paper?.generation || {};
  const completed = Object.values(item.paper?.chapters || {}).filter(chapter => chapter?.content && chapter.status !== 'stale').length;
  const total = item.paper?.outline?.length || 6;
  if (generation.status === 'completed') return { percent: 100, label: '论文已完成', detail: `${completed}/${total}章` };
  if (completed) return { percent: Math.max(8, Math.round(completed / total * 80)), label: generation.status === 'running' ? '正在生成' : '论文进行中', detail: `${completed}/${total}章` };
  if (item.scheme?.status === 'ready') return { percent: 18, label: '方案已完成', detail: '可开始论文' };
  return { percent: 4, label: '资料准备中', detail: '尚未生成' };
}

function renderProjects() {
  const grid = $('project-grid');
  const empty = $('projects-empty');
  if (!grid || !empty) return;
  empty.hidden = projects.length > 0;
  grid.hidden = projects.length === 0;
  const completed = projects.filter(item => item.paper?.generation?.status === 'completed').length;
  const ongoing = projects.filter(item => Object.values(item.paper?.chapters || {}).some(chapter => chapter?.content) && item.paper?.generation?.status !== 'completed').length;
  $('project-summary').innerHTML = `<div class="summary-cell"><span>全部项目</span><strong>${projects.length}</strong></div><div class="summary-cell"><span>论文进行中</span><strong>${ongoing}</strong></div><div class="summary-cell"><span>论文已完成</span><strong>${completed}</strong></div>`;
  grid.innerHTML = projects.map(item => {
    const progress = projectProgress(item);
    const updated = item.updatedAt ? new Date(item.updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '刚刚';
    const startRoute = Object.values(item.paper?.chapters || {}).some(chapter => chapter?.content) || item.start === 'paper' ? 'paper' : 'scheme';
    return `<article class="project-card" data-project-id="${escapeHtml(item.id)}">
      <div class="project-card-top"><span class="project-kind"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 3h9l4 4v14H6z"/><path d="M15 3v5h5M9 12h7M9 16h7"/></svg>${startRoute === 'paper' ? '论文项目' : '方案项目'}</span>
      <div class="project-menu"><button type="button" data-project-action="export" title="导出备份" aria-label="导出${escapeHtml(item.name)}"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 19h14"/></svg></button><button type="button" data-project-action="duplicate" title="复制项目" aria-label="复制${escapeHtml(item.name)}"><svg aria-hidden="true" viewBox="0 0 24 24"><rect x="8" y="8" width="11" height="11" rx="1"/><path d="M16 8V5H5v11h3"/></svg></button><button type="button" data-project-action="delete" title="删除项目" aria-label="删除${escapeHtml(item.name)}"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/></svg></button></div></div>
      <h2>${escapeHtml(item.name || item.title || '未命名项目')}</h2><p>最后保存：${escapeHtml(updated)}</p>
      <div class="project-progress"><div class="project-progress-line"><span style="width:${progress.percent}%"></span></div><div class="project-progress-meta"><span>${escapeHtml(progress.label)}</span><span>${escapeHtml(progress.detail)}</span></div></div>
      <button class="button button-secondary project-open" type="button" data-project-action="open" data-open-route="${startRoute}">继续使用</button>
    </article>`;
  }).join('');
}

function setRoute(route, options = {}) {
  if (['scheme', 'paper'].includes(route) && !project) {
    openNewProjectDialog(route === 'scheme' ? 'scheme' : 'paper');
    return;
  }
  currentRoute = ['projects', 'scheme', 'paper', 'tools'].includes(route) ? route : 'projects';
  qsa('.route-view').forEach(view => view.classList.toggle('is-active', view.dataset.view === currentRoute));
  qsa('.nav-item').forEach(button => button.classList.toggle('is-active', button.dataset.route === currentRoute));
  if (options.render !== false) {
    if (currentRoute === 'projects') renderProjects();
    if (currentRoute === 'scheme') renderScheme();
    if (currentRoute === 'paper') renderPaper();
    if (currentRoute === 'tools') renderStandaloneReferenceTool();
  }
  history.replaceState(null, '', `#${currentRoute}`);
  requestAnimationFrame(() => $('workspace-main')?.focus({ preventScroll: true }));
}

async function activateProject(id, route = currentRoute === 'projects' ? 'paper' : currentRoute) {
  const selected = projects.find(item => item.id === id) || await Store.getProject(id);
  if (!selected) return;
  project = normalizeProject(selected);
  Store.setActiveProjectId(project.id);
  paperStep = project.paper.step || 'materials';
  schemeStep = project.scheme?.status === 'ready' ? 'result' : 'input';
  renderAll();
  setRoute(route);
}

function openNewProjectDialog(start = 'paper') {
  const dialog = $('new-project-dialog');
  $('new-project-name').value = '';
  const radio = qs(`input[name="new-project-start"][value="${start}"]`);
  if (radio) radio.checked = true;
  dialog.showModal();
  setTimeout(() => $('new-project-name').focus(), 50);
}

async function createProjectFromDialog(event) {
  event.preventDefault();
  const name = $('new-project-name').value.trim() || '未命名项目';
  const start = qs('input[name="new-project-start"]:checked')?.value || 'paper';
  project = createBlankProject(name, start);
  projects.unshift(clone(project));
  Store.setActiveProjectId(project.id);
  await persistProject({ immediate: true });
  $('new-project-dialog').close();
  paperStep = 'materials';
  schemeStep = 'input';
  renderAll();
  setRoute(start);
  toast('新项目已建立，旧项目仍保留在项目库', 'success');
}

async function handleProjectAction(button) {
  const card = button.closest('[data-project-id]');
  const id = card?.dataset.projectId;
  const action = button.dataset.projectAction;
  const target = projects.find(item => item.id === id);
  if (!target) return;
  if (action === 'open') {
    await activateProject(id, button.dataset.openRoute || 'paper');
    return;
  }
  if (action === 'export') {
    Store.downloadProjectBackup(target);
    toast('项目备份已下载', 'success');
    return;
  }
  if (action === 'duplicate') {
    const copy = await Store.duplicateProject(target, normalizeProject);
    projects.unshift(copy);
    await activateProject(copy.id, copy.start || 'paper');
    toast('项目副本已建立', 'success');
    return;
  }
  if (action === 'delete') {
    if (!confirm(`确定删除“${target.name || target.title}”吗？建议先导出备份。`)) return;
    await Store.deleteProject(id);
    // 以数据库回读结果为准，避免旧版迁移项目或多个标签页造成列表残留。
    projects = (await Store.listProjects()).filter(item => item.id !== id);
    if (!projects.length) Store.clearLegacyProject();
    if (project?.id === id) {
      project = projects[0] ? normalizeProject(projects[0]) : null;
      Store.setActiveProjectId(project?.id || '');
    }
    renderAll();
    toast('项目已删除', 'success');
  }
}

async function importProject(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  try {
    const imported = await Store.importProjectFile(file, normalizeProject);
    projects.unshift(imported);
    await activateProject(imported.id, imported.start || 'paper');
    toast('项目已导入', 'success');
  } catch (error) { toast(error.message || '项目导入失败', 'error'); }
}

function classifyApiFailure(message, status = 0) {
  const text = String(message || '');
  if ([401, 403].includes(status)) return 'API Key无效或没有模型权限';
  if (status === 402 || /no credits|balance|余额|额度/i.test(text)) return 'API账户余额不足';
  if (status === 413 || /context|too long|文本过长|token.*limit/i.test(text)) return '本次输入超过模型长度限制';
  if (status === 429) return '请求过于频繁，请稍后继续';
  if (status >= 500) return `AI服务暂时异常（${status}）：${text.slice(0, 180) || '请检查中转站模型名称和上游状态'}`;
  return text || `API请求失败（${status}）`;
}

async function wait(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason || new DOMException('已暂停', 'AbortError'));
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason || new DOMException('已暂停', 'AbortError')); }, { once: true });
  });
}

function extractAiContent(data, { jsonMode = false } = {}) {
  const message = data?.choices?.[0]?.message || data?.message || {};
  const flatten = value => {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map(item => typeof item === 'string' ? item : item?.text || item?.content || '').filter(Boolean).join('\n');
    return value?.text || value?.content || '';
  };
  const direct = [flatten(message.content), flatten(data?.output_text), flatten(data?.result), flatten(data?.content)].find(value => String(value || '').trim());
  if (direct) return String(direct);
  if (Array.isArray(data?.output)) {
    const output = data.output.flatMap(item => item?.content || []).map(item => item?.text || item?.content || '').filter(Boolean).join('\n');
    if (output.trim()) return output;
  }
  const reasoningText = flatten(message.reasoning_content || message.reasoning || data?.reasoning_content);
  if (jsonMode && /[\[{]/.test(reasoningText)) {
    try { parseJsonResponse(reasoningText); return reasoningText; } catch (error) {}
  }
  return '';
}

async function callAi(messages, { reasoning = false, maxTokens = 8192, jsonMode = false, signal, requestLabel = '生成内容', configOverride = null, timeoutMs = 0 } = {}) {
  const config = configOverride || loadApiSettings();
  if (!config.apiUrl || !config.apiKey || !config.chatModel) throw new Error('尚未填写API，请点击右上角“API未设置”完成配置');
  const isDeepSeek = config.provider === 'deepseek' || /api\.deepseek\.com/i.test(config.apiUrl);
  const basePayload = {
    model: reasoning ? (config.reasoningModel || config.chatModel) : config.chatModel,
    messages,
    stream: false,
    max_tokens: Math.min(Math.max(256, Number(maxTokens) || 8192), 32768),
  };
  if (isDeepSeek) {
    basePayload.thinking = { type: reasoning ? 'enabled' : 'disabled' };
    if (!reasoning) basePayload.temperature = 0.35;
    if (jsonMode) basePayload.response_format = { type: 'json_object' };
  } else if (config.provider === 'moonshot' || config.provider === 'zhipu') {
    basePayload.temperature = 1;
    if (reasoning && config.provider === 'zhipu') basePayload.thinking = { type: 'enabled' };
    if (jsonMode && config.provider === 'zhipu') basePayload.response_format = { type: 'json_object' };
  } else if (config.provider === 'openai') {
    delete basePayload.max_tokens;
    basePayload.max_completion_tokens = Math.min(Math.max(256, Number(maxTokens) || 8192), 32768);
    if (jsonMode) basePayload.response_format = { type: 'json_object' };
  } else if (!reasoning) basePayload.temperature = 0.35;

  const firstTimeout = Number(timeoutMs) > 0 ? Number(timeoutMs) : reasoning ? 4 * 60 * 1000 : 3 * 60 * 1000;
  const timeouts = [firstTimeout, Math.max(45 * 1000, Math.min(2 * 60 * 1000, Math.round(firstTimeout * 0.72)))];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const payload = clone(basePayload);
    if (attempt > 0) {
      payload.model = config.chatModel;
      if (payload.thinking) payload.thinking = { type: 'disabled' };
      if (isDeepSeek) payload.temperature = 0.25;
      payload.messages = [...messages, { role: 'user', content: jsonMode ? '上次没有得到最终结果。请跳过推理过程，直接返回完整、合法的JSON。' : '上次没有得到最终正文。请跳过推理过程，直接返回完整最终内容。' }];
    }
    const controller = new AbortController();
    const forwardAbort = () => controller.abort(signal?.reason || new DOMException('已暂停', 'AbortError'));
    signal?.addEventListener('abort', forwardAbort, { once: true });
    const timeout = setTimeout(() => controller.abort(new DOMException(`${requestLabel}等待超时`, 'TimeoutError')), timeouts[attempt]);
    setOperationStatus('busy', `${requestLabel}${attempt ? '正在自动重试' : '进行中'}`);
    if (project?.paper?.generation && requestTask === 'paper-generation') {
      project.paper.generation.activeRequestLabel = `${requestLabel}${attempt ? '（重试）' : ''}`;
      project.paper.generation.updatedAt = nowIso();
      renderGeneration();
    }
    try {
      const response = await fetch(config.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const raw = await response.text();
      let data = {};
      try { data = raw ? JSON.parse(raw) : {}; } catch (error) {}
      if (!response.ok) {
        const message = data?.error?.message || data?.message || raw.slice(0, 300);
        if (attempt === 0 && response.status === 400 && /temperature/i.test(message)) {
          delete basePayload.temperature;
          await wait(300, signal);
          continue;
        }
        const retryable = [408, 425, 429, 500, 502, 503, 504].includes(response.status);
        if (retryable && attempt === 0) {
          await wait(1800, signal);
          continue;
        }
        throw new Error(classifyApiFailure(message, response.status));
      }
      const content = extractAiContent(data, { jsonMode });
      if (!String(content).trim()) {
        const emptyError = new Error('AI没有返回最终文本');
        emptyError.code = 'EMPTY_AI_CONTENT';
        throw emptyError;
      }
      setOperationStatus('success', `${requestLabel}已完成`);
      return sanitizeTechnicalText(String(content).replace(/<think>[\s\S]*?<\/think>/gi, '').trim());
    } catch (error) {
      if (signal?.aborted) {
        setOperationStatus('idle');
        throw signal.reason || new DOMException('已暂停', 'AbortError');
      }
      const timeoutError = error?.name === 'TimeoutError' || controller.signal.aborted;
      if ((timeoutError || error instanceof TypeError || error?.code === 'EMPTY_AI_CONTENT') && attempt === 0) {
        await wait(1200, signal);
        continue;
      }
      if (timeoutError) {
        setOperationStatus('error', `${requestLabel}超时`);
        throw new Error(`${requestLabel}等待时间过长，已保留当前进度`);
      }
      if (error instanceof TypeError) {
        setOperationStatus('error', `${requestLabel}连接失败`);
        throw new Error('浏览器无法连接该API。请检查接口地址、网络以及厂家是否允许网页跨域调用（CORS）');
      }
      setOperationStatus('error', `${requestLabel}失败`);
      throw error;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', forwardAbort);
    }
  }
  setOperationStatus('error', `${requestLabel}失败`);
  throw new Error(`${requestLabel}失败，请稍后继续`);
}

async function parseAiJson(raw, { signal, requestLabel = '整理数据', maxTokens = 7000 } = {}) {
  try {
    return parseJsonResponse(raw);
  } catch (firstError) {
    const repairedRaw = await callAi([
      {
        role: 'system',
        content: '你是JSON格式修复器。将用户提供的不完整或夹杂说明的内容整理成一个完整、合法的JSON对象。保持原有字段和信息，不补写解释，不使用Markdown代码块，只返回JSON。',
      },
      {
        role: 'user',
        content: `原返回内容：\n${String(raw || '').slice(0, 48000)}\n\n原解析错误：${firstError.message}`,
      },
    ], { reasoning: false, maxTokens, jsonMode: true, signal, requestLabel: `${requestLabel}格式修复`, timeoutMs: 80000 });
    try {
      return parseJsonResponse(repairedRaw);
    } catch (secondError) {
      throw new Error(`${requestLabel}返回格式不完整，系统已自动重试但仍无法识别`);
    }
  }
}

function updateApiConnectionStatus(state = 'checking', message = '') {
  const button = $('api-connection-status');
  const textNode = $('api-connection-text');
  if (!button || !textNode) return;
  const config = loadApiSettings();
  const providerLabels = { deepseek: 'DeepSeek', zhipu: '智谱GLM', moonshot: 'Kimi', openai: 'OpenAI', newapi9898: '9898.ai', compatible: '自定义API' };
  const label = providerLabels[config.provider] || 'API';
  const missing = !config.apiKey;
  const stateLabel = missing ? '未设置' : state === 'success' ? '已连接' : state === 'error' ? '连接失败' : '检测中';
  textNode.textContent = missing ? 'API 未设置' : `${label} ${stateLabel}`;
  button.className = `api-connection-pill is-${missing ? 'error' : state}`;
  const detail = message ? `：${message}` : '';
  button.title = `${label}${detail || `：${stateLabel}`}，点击打开API设置`;
  button.setAttribute('aria-label', `${label}连接状态：${stateLabel}${detail}`);
}

async function checkActiveApiConnection({ silent = false } = {}) {
  if (!loadApiSettings().apiKey) {
    updateApiConnectionStatus('error', '请填写API Key');
    return false;
  }
  updateApiConnectionStatus('checking');
  try {
    await callAi([{ role: 'user', content: '只回复OK' }], { maxTokens: 32, requestLabel: 'API连接检测', configOverride: loadApiSettings() });
    updateApiConnectionStatus('success', '连接正常');
    if (!silent) toast('API连接成功', 'success');
    return true;
  } catch (error) {
    updateApiConnectionStatus('error', error.message || '连接失败');
    if (!silent) toast(`API连接失败：${error.message}`, 'error');
    return false;
  }
}

function openSettings() {
  const formConfig = loadStoredCustomApiSettings() || loadApiSettings();
  $('api-provider').value = formConfig.provider || 'deepseek';
  $('api-url').value = formConfig.apiUrl || '';
  $('api-key').value = formConfig.apiKey || '';
  $('api-chat-model').value = formConfig.chatModel || '';
  $('api-reasoning-model').value = formConfig.reasoningModel || formConfig.chatModel || '';
  $('api-test-status').textContent = '尚未测试';
  $('settings-dialog').showModal();
}

function apiConfigFromForm() {
  const provider = $('api-provider').value;
  let apiUrl = $('api-url').value.trim().replace(/\/$/, '');
  let apiKey = $('api-key').value.trim();
  if (provider === 'deepseek' && /^[a-f0-9]{32}$/i.test(apiKey)) apiKey = 'sk-' + apiKey;
  if (apiUrl && !/\/chat\/completions(?:\?|$)/i.test(apiUrl) && /\/v\d+$/i.test(apiUrl)) apiUrl += '/chat/completions';
  return {
    mode: 'user', provider, apiUrl, apiKey,
    chatModel: $('api-chat-model').value.trim(), reasoningModel: $('api-reasoning-model').value.trim() || $('api-chat-model').value.trim(),
  };
}

function applyProviderPreset() {
  const preset = API_PRESETS[$('api-provider').value] || API_PRESETS.compatible;
  if (preset.apiUrl) $('api-url').value = preset.apiUrl;
  if (preset.chatModel) $('api-chat-model').value = preset.chatModel;
  if (preset.reasoningModel) $('api-reasoning-model').value = preset.reasoningModel;
}

async function testApiConnection() {
  const button = $('btn-test-api');
  const status = $('api-test-status');
  const config = apiConfigFromForm();
  if (!config.apiUrl || !config.apiKey || !config.chatModel) {
    status.textContent = '请先完整填写API地址、Key和写作模型';
    $('api-key').focus();
    return;
  }
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  status.textContent = '正在测试连接';
  try {
    await callAi([{ role: 'user', content: '只回复OK' }], { maxTokens: 32, requestLabel: 'API测试', configOverride: config });
    status.textContent = '连接成功';
    toast('API连接成功', 'success');
  } catch (error) {
    status.textContent = `连接失败：${error.message}`;
    toast(`API测试失败：${error.message}`, 'error');
  } finally { button.disabled = false; button.removeAttribute('aria-busy'); }
}

function submitApiSettings(event) {
  event.preventDefault();
  const config = apiConfigFromForm();
  if (!config.apiUrl || !config.apiKey || !config.chatModel) {
    toast('请填写API地址、Key和模型名称', 'error');
    $('api-test-status').textContent = '设置未完成：请检查必填项';
    $('api-key').focus();
    return;
  }
  saveApiSettings(config);
  $('settings-dialog').close();
  toast('API设置已保存到当前浏览器', 'success');
  void checkActiveApiConnection({ silent: true });
  void refreshDailyMotivation({ force: true });
}

function selectedMultiValues(key) {
  const details = qs(`[data-multi-select="${key}"]`);
  return details ? qsa('input[type="checkbox"]:checked', details).map(input => input.value) : [];
}

function renderMultiSelectSummary(details) {
  const selected = qsa('input[type="checkbox"]:checked', details).map(input => input.value);
  const summary = qs('[data-multi-summary]', details);
  if (!summary) return;
  const emptyLabel = details.dataset.multiSelect === 'programmingSoftware' ? '自动选择' : details.dataset.multiSelect === 'cloudPlatforms' ? '不使用' : '不指定';
  summary.textContent = selected.length ? selected.join('、') : emptyLabel;
  summary.title = summary.textContent;
}

function schemePreferencesFromForm() {
  return {
    controller: $('scheme-controller')?.value || 'auto',
    display: $('scheme-display')?.value || 'auto',
    programmingSoftware: selectedMultiValues('programmingSoftware'),
    appSoftware: selectedMultiValues('appSoftware'),
    cloudPlatforms: selectedMultiValues('cloudPlatforms'),
  };
}

function captureScheme() {
  if (!project) return;
  const previous = JSON.stringify({ title: project.scheme.title, requirements: project.scheme.requirements, countMode: project.scheme.countMode, functionCount: project.scheme.functionCount, preferences: project.scheme.preferences });
  project.scheme.title = $('scheme-title-input')?.value.trim() || '';
  project.scheme.requirements = $('scheme-requirements')?.value.trim() || '';
  project.scheme.countMode = qs('input[name="scheme-count-mode"]:checked')?.value || 'random';
  project.scheme.functionCount = Math.max(3, Math.min(20, Number($('scheme-count')?.value) || 8));
  project.scheme.preferences = schemePreferencesFromForm();
  project.title = project.scheme.title || project.title;
  updateProjectNameFromTitle();
  const next = JSON.stringify({ title: project.scheme.title, requirements: project.scheme.requirements, countMode: project.scheme.countMode, functionCount: project.scheme.functionCount, preferences: project.scheme.preferences });
  if (previous !== next && project.scheme.status === 'ready') project.scheme.status = 'stale';
  persistProject();
}

function setSchemeStep(step) {
  schemeStep = step === 'result' ? 'result' : 'input';
  qsa('[data-scheme-panel]').forEach(panel => panel.classList.toggle('is-active', panel.dataset.schemePanel === schemeStep));
  qsa('[data-scheme-step]').forEach(button => button.classList.toggle('is-active', button.dataset.schemeStep === schemeStep));
}

function schemeText(structured) {
  if (!structured) return '';
  const devices = (structured.devices || []).map(item => `${item.model}  （${item.role}）`).join('，');
  const functions = (structured.functions || []).map((item, index) => `${index + 1}. ${typeof item === 'string' ? item : item.name || ''}`).join('\n');
  return `${structured.title}\n\n器件：\n${devices}\n\n功能：\n${functions}`;
}

function renderSchemePreview() {
  const preview = $('scheme-preview');
  const status = $('scheme-status');
  const structured = project?.scheme?.structured;
  if (!structured) {
    preview.innerHTML = '<p class="placeholder-copy">方案生成后会显示在这里。</p>';
    status.textContent = project?.scheme?.status === 'generating' ? '正在生成' : '等待生成';
    status.className = 'status-badge';
    $('btn-copy-scheme').disabled = true;
    $('btn-download-scheme').disabled = true;
    return;
  }
  status.textContent = project.scheme.status === 'stale' ? '条件已修改' : '方案已生成';
  status.className = `status-badge ${project.scheme.status === 'stale' ? 'is-warning' : 'is-success'}`;
  preview.innerHTML = `<h1>${escapeHtml(structured.title)}</h1><h2>器件</h2><p>${(structured.devices || []).map(item => `${escapeHtml(item.model)}&nbsp;&nbsp;（${escapeHtml(item.role)}）`).join('，')}</p><h2>功能</h2><ol>${(structured.functions || []).map(item => `<li>${escapeHtml(typeof item === 'string' ? item : item.name || '')}</li>`).join('')}</ol>`;
  $('btn-copy-scheme').disabled = false;
  $('btn-download-scheme').disabled = false;
}

function renderScheme() {
  if (!project) return;
  $('scheme-title-input').value = project.scheme.title || project.title || '';
  $('scheme-requirements').value = project.scheme.requirements || '';
  qsa('input[name="scheme-count-mode"]').forEach(input => { input.checked = input.value === (project.scheme.countMode || 'random'); });
  $('scheme-count').value = project.scheme.functionCount || 8;
  $('scheme-count-wrap').hidden = project.scheme.countMode !== 'custom';
  const preferences = { controller: 'auto', display: 'auto', programmingSoftware: [], appSoftware: [], cloudPlatforms: [], ...(project.scheme.preferences || {}) };
  $('scheme-controller').value = preferences.controller || 'auto';
  $('scheme-display').value = preferences.display || 'auto';
  qsa('[data-multi-select]').forEach(details => {
    const values = new Set(preferences[details.dataset.multiSelect] || []);
    qsa('input[type="checkbox"]', details).forEach(input => { input.checked = values.has(input.value); });
    renderMultiSelectSummary(details);
  });
  renderSchemePreview();
  setSchemeStep(schemeStep);
}

async function generateScheme(event) {
  event?.preventDefault();
  if (requestController) return toast('当前还有任务正在运行', 'info');
  captureScheme();
  if (!project.scheme.title) return toast('请先填写项目题目', 'error');
  requestController = new AbortController();
  requestTask = 'scheme-generation';
  project.scheme.status = 'generating';
  renderSchemePreview();
  const submit = qs('#scheme-form button[type="submit"]');
  submit.disabled = true;
  submit.setAttribute('aria-busy', 'true');
  submit.textContent = '正在生成方案';
  try {
    const functionCount = project.scheme.countMode === 'custom'
      ? project.scheme.functionCount
      : Math.max(5, Math.min(12, 5 + Math.floor(Math.random() * 6)));
    const raw = await callAi(Prompts.buildSchemeMessages({ title: project.scheme.title, requirements: project.scheme.requirements, functionCount, preferences: project.scheme.preferences }), { reasoning: false, maxTokens: 5000, jsonMode: true, signal: requestController.signal, requestLabel: '方案生成' });
    const result = await parseAiJson(raw, { signal: requestController.signal, requestLabel: '方案生成', maxTokens: 5000 });
    const devices = (Array.isArray(result.devices) ? result.devices : []).map(item => typeof item === 'string'
      ? { model: sanitizeTechnicalText(item.replace(/[（(].*$/, '').trim()), role: item.match(/[（(]([^）)]+)[）)]/)?.[1] || '外设' }
      : { model: sanitizeTechnicalText(String(item.model || item.name || '').trim()), role: sanitizeTechnicalText(String(item.role || item.purpose || '外设').trim()) }).filter(item => item.model);
    const functions = (Array.isArray(result.functions) ? result.functions : []).map(item => sanitizeTechnicalText(typeof item === 'string' ? item : item.name || item.description || '')).filter(Boolean);
    if (!devices.length || !functions.length) throw new Error('方案内容不完整，请重新生成');
    project.scheme.structured = { title: sanitizeTechnicalText(result.title || project.scheme.title), devices, functions };
    project.scheme.text = schemeText(project.scheme.structured);
    project.scheme.status = 'ready';
    project.scheme.generatedAt = nowIso();
    await persistProject({ immediate: true });
    schemeStep = 'result';
    renderScheme();
    toast('方案已生成', 'success');
  } catch (error) {
    project.scheme.status = project.scheme.structured ? 'stale' : 'empty';
    $('scheme-status').textContent = '生成失败';
    $('scheme-status').className = 'status-badge is-danger';
    toast(error.message || '方案生成失败', 'error');
  } finally {
    requestController = null;
    requestTask = '';
    submit.disabled = false;
    submit.removeAttribute('aria-busy');
    submit.textContent = '生成方案';
    renderSchemePreview();
  }
}

async function copyScheme() {
  if (!project?.scheme?.text) return;
  try {
    await navigator.clipboard.writeText(project.scheme.text);
    toast('方案文本已复制', 'success');
  } catch (error) { toast('复制失败，请在预览中手动选择', 'error'); }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1200);
}

async function downloadScheme() {
  const data = project?.scheme?.structured;
  if (!data) return;
  try {
    if (!globalThis.PaperDocx?.buildSchemeDocx) throw new Error('DOCX组件尚未加载，请刷新页面后重试');
    const blob = await globalThis.PaperDocx.buildSchemeDocx(data);
    downloadBlob(blob, `${safeFilename(data.title)}_设计方案.docx`);
    toast('方案DOCX已下载，可在WPS中继续编辑', 'success');
  } catch (error) {
    toast(error.message || '方案DOCX生成失败', 'error');
  }
}

function availableSchemeSources() {
  return projects.filter(item => item?.scheme?.structured?.devices?.length && item?.scheme?.structured?.functions?.length);
}

function renderSchemeImportOptions() {
  const select = $('paper-scheme-source');
  const button = $('btn-import-scheme');
  if (!select || !button || !project) return;
  const sources = availableSchemeSources();
  const remembered = project.paper.materials.schemeSourceId || '';
  const currentHasScheme = sources.some(item => item.id === project.id);
  const preferred = sources.some(item => item.id === remembered) ? remembered : currentHasScheme ? project.id : '';
  select.innerHTML = `<option value="">不导入，手动填写</option>${sources.map(item => {
    const title = item.scheme.structured.title || item.scheme.title || item.name || '未命名方案';
    const suffix = item.scheme.status === 'stale' ? '（条件已修改）' : item.id === project.id ? '（当前项目）' : '';
    return `<option value="${escapeHtml(item.id)}">${escapeHtml(title)}${suffix}</option>`;
  }).join('')}`;
  select.value = preferred;
  button.disabled = !select.value;
  $('paper-scheme-import-note').textContent = sources.length
    ? `找到 ${sources.length} 份已生成方案；导入后只复制资料，不与原方案绑定。`
    : '暂无已生成方案，也可以直接在下方填写。';
}

function resetHardwareAnalysis(reason = '器件资料已修改') {
  if (!project) return;
  const facts = project.paper.factSheet;
  if (facts.analyzedAt || facts.confirmedAt) bumpFactRevision(reason);
  project.paper.factSheet = {
    ...facts,
    controller: '', devices: [], functions: [], mappings: [], powerNotes: [], fixedFacts: [], conflicts: [],
    conflictsAcknowledged: false, analyzedAt: '', confirmedAt: '',
  };
}

async function importSelectedScheme() {
  if (!project) return;
  const sourceId = $('paper-scheme-source')?.value || '';
  const source = availableSchemeSources().find(item => item.id === sourceId);
  if (!source) return toast('请先选择一份已生成方案', 'info');
  const data = source.scheme.structured;
  const materials = project.paper.materials;
  const devicesText = (data.devices || []).map(item => `${item.model}${item.role ? `（${item.role}）` : ''}`).join('\n');
  const functionsText = (data.functions || []).map(item => typeof item === 'string' ? item : item.name || '').filter(Boolean).join('\n');
  const hasExisting = Boolean(project.title || materials.devicesText || materials.functionsText);
  const differs = project.title !== (data.title || source.scheme.title || '') || materials.devicesText !== devicesText || materials.functionsText !== functionsText;
  if (hasExisting && differs && !confirm('导入会替换当前题目、器件清单和功能要求，其他补充资料会保留。是否继续？')) return;
  resetHardwareAnalysis('已导入新的方案资料');
  project.title = data.title || source.scheme.title || project.title;
  materials.schemeSourceId = source.id;
  materials.schemeRawText = source.scheme.text || schemeText(data);
  materials.schemeFilename = '';
  materials.devicesText = devicesText;
  materials.functionsText = functionsText;
  updateProjectNameFromTitle();
  await persistProject({ immediate: true });
  renderPaper();
  toast('方案已导入，可以继续修改或直接分析器件', 'success');
}

async function readSchemeSourceFile(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file || !project) return;
  const extension = file.name.split('.').pop()?.toLowerCase();
  try {
    let text = '';
    if (extension === 'docx') {
      if (!globalThis.mammoth?.extractRawText) throw new Error('DOCX读取组件尚未加载，请刷新页面后重试');
      const result = await globalThis.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
      text = result.value || '';
    } else if (extension === 'txt' || extension === 'md') text = await file.text();
    else throw new Error('请使用DOCX、TXT或MD文件；旧版DOC请先在WPS中另存为DOCX');
    text = sanitizeTechnicalText(text).trim();
    if (!text) throw new Error('文件中没有读取到可分析的方案文字');
    project.paper.materials.schemeRawText = text.slice(0, 100000);
    project.paper.materials.schemeFilename = file.name;
    $('paper-scheme-text').value = project.paper.materials.schemeRawText;
    $('scheme-file-summary').textContent = `已读取：${file.name}`;
    await persistProject({ immediate: true });
    toast('方案文件已读取，点击“AI分析并填入资料”', 'success');
  } catch (error) {
    toast(error.message || '方案文件读取失败', 'error');
  }
}

function captureSchemeSourceText() {
  if (!project) return;
  const nextText = sanitizeTechnicalText($('paper-scheme-text')?.value || '').slice(0, 100000);
  if (nextText !== project.paper.materials.schemeRawText) project.paper.materials.schemeFilename = '';
  project.paper.materials.schemeRawText = nextText;
  $('scheme-file-summary').textContent = project.paper.materials.schemeFilename ? `已读取：${project.paper.materials.schemeFilename}` : project.paper.materials.schemeRawText ? '已粘贴方案文本' : '支持 DOCX、TXT、MD';
  persistProject();
}

async function analyzeImportedScheme() {
  if (!project || requestController) return requestController ? toast('当前还有任务正在运行', 'info') : undefined;
  captureSchemeSourceText();
  const rawText = project.paper.materials.schemeRawText.trim();
  if (!rawText) {
    $('paper-scheme-text').focus();
    return toast('请先粘贴方案或选择方案文件', 'error');
  }
  const existingMaterials = project.paper.materials;
  if ((existingMaterials.devicesText || existingMaterials.functionsText) && !confirm('AI分析结果会替换当前器件清单和功能要求，其他补充资料会保留。是否继续？')) return;
  const button = $('btn-analyze-scheme-source');
  requestController = new AbortController();
  requestTask = 'scheme-import-analysis';
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  button.textContent = '正在分析方案';
  try {
    const raw = await callAi(Prompts.buildSchemeMaterialImportMessages({ rawText, currentTitle: project.title }), {
      reasoning: false, maxTokens: 6500, jsonMode: true, signal: requestController.signal, requestLabel: '方案资料分析',
    });
    const result = await parseAiJson(raw, { signal: requestController.signal, requestLabel: '方案资料分析', maxTokens: 6500 });
    const devices = (Array.isArray(result.devices) ? result.devices : []).map((item, index) => typeof item === 'string'
      ? deviceFromLine(sanitizeTechnicalText(item), index)
      : { id: `device-import-${index + 1}`, model: sanitizeTechnicalText(item.model || item.name || '').trim(), role: sanitizeTechnicalText(item.role || item.purpose || '').trim() }).filter(item => item.model);
    const functions = (Array.isArray(result.functions) ? result.functions : []).map(item => sanitizeTechnicalText(typeof item === 'string' ? item : item.name || item.description || '')).filter(Boolean);
    if (!result.title && !project.title) throw new Error('方案中没有识别到论文题目');
    if (!devices.length && !functions.length) throw new Error('方案中没有识别到器件或功能，请检查导入内容');
    const materials = project.paper.materials;
    resetHardwareAnalysis('已导入新的方案资料');
    project.title = sanitizeTechnicalText(result.title || project.title).trim();
    materials.schemeSourceId = '';
    materials.devicesText = devices.map(item => `${item.model}${item.role ? `（${item.role}）` : ''}`).join('\n');
    materials.functionsText = functions.join('\n');
    const notes = sanitizeTechnicalText(result.sourceNotes || '').trim();
    if (notes) materials.sourceNotes = unique([materials.sourceNotes, notes]).join('\n');
    updateProjectNameFromTitle();
    await persistProject({ immediate: true });
    renderPaper();
    toast('方案已分析并填入论文资料', 'success');
  } catch (error) {
    if (error?.name !== 'AbortError') toast(error.message || '方案分析失败', 'error');
  } finally {
    requestController = null;
    requestTask = '';
    button.disabled = false;
    button.removeAttribute('aria-busy');
    button.textContent = 'AI分析并填入资料';
  }
}

function capturePaperMaterials({ invalidate = true } = {}) {
  if (!project) return;
  const materials = project.paper.materials;
  const previousHardware = JSON.stringify({ title: project.title, devicesText: materials.devicesText, functionsText: materials.functionsText, codeText: materials.codeText, sourceNotes: materials.sourceNotes, sourceDocumentText: materials.sourceDocumentText });
  const previousOutlineReference = materials.outlineReferenceText || '';
  const previousTargetBodyChars = Number(materials.targetBodyChars) || MIN_BODY_CHARS;
  const previousReferences = JSON.stringify({ text: materials.referencesText || '', use: materials.useReferencesInPaper !== false, count: clampReferenceCount(materials.referenceRecommendationCount) });
  project.title = $('paper-title-input')?.value.trim() || project.title || '';
  materials.devicesText = sanitizeTechnicalText($('paper-devices')?.value.trim() || '');
  materials.functionsText = sanitizeTechnicalText($('paper-functions')?.value.trim() || '');
  materials.referencesText = $('paper-references')?.value.trim() || '';
  materials.useReferencesInPaper = $('paper-use-references')?.checked !== false;
  materials.referenceRecommendationCount = clampReferenceCount($('paper-reference-count')?.value);
  materials.testInfo = $('paper-test-info')?.value.trim() || '';
  materials.toolsText = $('paper-tools')?.value.trim() || '';
  materials.photoNotes = $('paper-photo-notes')?.value.trim() || '';
  materials.sourceNotes = $('paper-source-notes')?.value.trim() || '';
  materials.outlineReferenceText = $('paper-outline-reference')?.value.trim() || '';
  materials.targetBodyChars = Math.max(MIN_BODY_CHARS, Math.min(40000, Number($('paper-target-chars')?.value) || MIN_BODY_CHARS));
  if (previousOutlineReference !== materials.outlineReferenceText) materials.outlineReferenceFilename = '';
  updateProjectNameFromTitle();
  const nextHardware = JSON.stringify({ title: project.title, devicesText: materials.devicesText, functionsText: materials.functionsText, codeText: materials.codeText, sourceNotes: materials.sourceNotes, sourceDocumentText: materials.sourceDocumentText });
  const nextReferences = JSON.stringify({ text: materials.referencesText || '', use: materials.useReferencesInPaper !== false, count: materials.referenceRecommendationCount });
  if (invalidate && previousHardware !== nextHardware) resetHardwareAnalysis('器件资料已修改');
  else if (invalidate && previousOutlineReference !== materials.outlineReferenceText) invalidateOutlinePlan('参考目录已修改');
  else if (invalidate && previousTargetBodyChars !== materials.targetBodyChars) invalidateOutlinePlan('正文目标字数已修改');
  else if (invalidate && previousReferences !== nextReferences && project.paper.chapters?.['1']?.content) {
    project.paper.chapters['1'].status = 'stale';
    project.paper.generation.status = 'stale';
    project.paper.generation.message = '参考文献设置已修改，第一章需要更新';
  }
  persistProject();
}

function setPaperStep(step, { scroll = false } = {}) {
  const allowed = ['materials', 'pins', 'generate'];
  paperStep = allowed.includes(step) ? step : 'materials';
  if (project) {
    project.paper.step = paperStep;
    persistProject();
  }
  const headings = {
    materials: ['准备论文资料', '题目必填，其他资料按实际情况提供。'],
    pins: ['器件分析与引脚选择', '根据器件逐项选择引脚，不需要提前填写硬件连接。'],
    generate: ['生成与下载', '系统会先按目标字数、器件和功能规划结构，再逐章生成并保存。'],
  };
  $('paper-title').textContent = headings[paperStep][0];
  $('paper-step-description').textContent = headings[paperStep][1];
  qsa('[data-paper-panel]').forEach(panel => panel.classList.toggle('is-active', panel.dataset.paperPanel === paperStep));
  qsa('[data-paper-step]').forEach(button => {
    const index = allowed.indexOf(button.dataset.paperStep);
    const current = allowed.indexOf(paperStep);
    button.classList.toggle('is-active', index === current);
    button.classList.toggle('is-complete', index < current);
  });
  if (paperStep === 'pins') renderPins();
  if (paperStep === 'generate') renderGeneration();
  if (scroll) {
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }));
  }
}

function renderPaper() {
  if (!project) return;
  const materials = project.paper.materials;
  renderSchemeImportOptions();
  $('paper-title-input').value = project.title || '';
  $('paper-devices').value = materials.devicesText || '';
  $('paper-functions').value = materials.functionsText || '';
  $('paper-references').value = materials.referencesText || '';
  $('paper-use-references').checked = materials.useReferencesInPaper !== false;
  $('paper-reference-count').value = String(clampReferenceCount(materials.referenceRecommendationCount));
  renderReferenceTool();
  $('paper-test-info').value = materials.testInfo || '';
  $('paper-tools').value = materials.toolsText || '';
  $('paper-photo-notes').value = materials.photoNotes || '';
  $('paper-source-notes').value = materials.sourceNotes || '';
  $('paper-outline-reference').value = materials.outlineReferenceText || '';
  $('paper-target-chars').value = String(Math.max(MIN_BODY_CHARS, Math.min(40000, Number(materials.targetBodyChars) || MIN_BODY_CHARS)));
  $('paper-scheme-text').value = materials.schemeRawText || '';
  $('scheme-file-summary').textContent = materials.schemeFilename ? `已读取：${materials.schemeFilename}` : materials.schemeRawText ? '已粘贴方案文本' : '支持 DOCX、TXT、MD';
  const displayedCodeFiles = materials.codeFiles?.length ? materials.codeFiles : (materials.filenames || []);
  $('code-file-summary').textContent = displayedCodeFiles.length ? `已选 ${displayedCodeFiles.length} 个文件，可继续追加` : '尚未选择，可分多次追加';
  renderCodeFileList(displayedCodeFiles);
  $('source-file-summary').textContent = materials.sourceDocumentFilename
    ? `已读取：${materials.sourceDocumentFilename}（${String(materials.sourceDocumentText || '').length}字，${materials.sourceBackgroundText ? '已提取背景方向' : '分析时仅提取背景方向'}）`
    : '支持 DOCX、TXT、MD；旧版DOC请先用WPS另存为DOCX';
  $('btn-clear-source-file').disabled = !materials.sourceDocumentFilename;
  $('schematic-file-summary').textContent = materials.schematicFilename
    ? `已读取：${materials.schematicFilename}${materials.schematicText ? `（${materials.schematicText.length}字）` : ''}`
    : '尚未选择';
  $('outline-file-summary').textContent = materials.outlineReferenceFilename ? `已读取：${materials.outlineReferenceFilename}` : materials.outlineReferenceText ? '已粘贴参考目录' : '支持 DOCX、TXT、MD';
  renderPins();
  renderGeneration();
  setPaperStep(paperStep);
}

async function readOutlineReferenceFile(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file || !project) return;
  const extension = file.name.split('.').pop()?.toLowerCase();
  try {
    let text = '';
    if (extension === 'docx') {
      if (!globalThis.mammoth?.extractRawText) throw new Error('DOCX读取组件尚未加载，请刷新页面后重试');
      const result = await globalThis.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
      text = result.value || '';
    } else if (extension === 'txt' || extension === 'md') text = await file.text();
    else throw new Error('请使用DOCX、TXT或MD文件；旧版DOC请先在WPS中另存为DOCX');
    text = String(text || '').trim();
    if (!text) throw new Error('文件中没有读取到目录文字');
    project.paper.materials.outlineReferenceText = text.slice(0, 50000);
    project.paper.materials.outlineReferenceFilename = file.name;
    $('paper-outline-reference').value = project.paper.materials.outlineReferenceText;
    $('outline-file-summary').textContent = `已读取：${file.name}`;
    invalidateOutlinePlan('参考目录已更新');
    await persistProject({ immediate: true });
    toast('参考目录已读取，确认引脚后AI会结合项目重新规划', 'success');
  } catch (error) {
    toast(error.message || '参考目录读取失败', 'error');
  }
}

function programFileExtension(filename = '') {
  return String(filename).toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '';
}

function supportedProgramFile(file) {
  const name = String(file?.name || '');
  const basename = name.toLowerCase();
  return PROGRAM_FILE_EXTENSIONS.has(programFileExtension(name)) || ['makefile', 'kconfig', 'cmakelists.txt', 'platformio.ini'].includes(basename);
}

function rebuildProgramCodeText(materials) {
  const records = Array.isArray(materials.codeFiles) ? materials.codeFiles : [];
  const perFileBudget = Math.max(800, Math.floor(MAX_PROGRAM_TOTAL_CHARS / Math.max(1, records.length)) - 80);
  const parts = [];
  for (const record of records) {
    parts.push(`/* 文件：${record.path || record.name} */\n${String(record.content || '').slice(0, perFileBudget)}`);
  }
  materials.codeText = parts.join('\n\n').slice(0, MAX_PROGRAM_TOTAL_CHARS).trim();
  materials.filenames = records.map(item => item.path || item.name);
}

async function readCodeFiles(event) {
  const selected = [...(event.target.files || [])];
  event.target.value = '';
  if (!selected.length || !project) return;
  const supported = selected.filter(supportedProgramFile);
  const oversized = supported.filter(file => file.size > MAX_PROGRAM_FILE_BYTES);
  const readable = supported.filter(file => file.size <= MAX_PROGRAM_FILE_BYTES);
  if (!readable.length) return toast(oversized.length ? '所选程序文件过大，单个文件请控制在2 MB以内' : '没有找到支持的文本程序文件', 'error');
  const materials = project.paper.materials;
  const records = new Map((materials.codeFiles || []).map(item => [String(item.path || item.name).toLowerCase(), item]));
  for (const file of readable) {
    const path = file.webkitRelativePath || file.name;
    records.set(path.toLowerCase(), {
      name: file.name,
      path,
      extension: programFileExtension(file.name),
      size: file.size,
      content: await file.text(),
    });
  }
  materials.codeFiles = [...records.values()];
  rebuildProgramCodeText(materials);
  if (project.paper.factSheet.analyzedAt) bumpFactRevision('程序资料已修改');
  await persistProject({ immediate: true });
  $('code-file-summary').textContent = `已选 ${materials.codeFiles.length} 个文件，可继续追加`;
  renderCodeFileList(materials.codeFiles);
  const skipped = selected.length - readable.length;
  toast(`已加入 ${readable.length} 个程序文件${skipped ? `，跳过 ${skipped} 个不支持或过大的文件` : ''}`, 'success');
}

function removeCodeFile(path) {
  if (!project) return;
  const materials = project.paper.materials;
  materials.codeFiles = (materials.codeFiles || []).filter(item => (item.path || item.name) !== path);
  rebuildProgramCodeText(materials);
  if (project.paper.factSheet.analyzedAt) bumpFactRevision('程序资料已修改');
  $('code-file-summary').textContent = materials.codeFiles.length ? `已选 ${materials.codeFiles.length} 个文件，可继续追加` : '尚未选择，可分多次追加';
  renderCodeFileList(materials.codeFiles);
  persistProject();
}

function renderCodeFileList(codeFiles = []) {
  const target = $('code-file-list');
  if (!target) return;
  const records = codeFiles.map(item => typeof item === 'string' ? { name: item, path: item, size: 0 } : item).filter(item => item?.name || item?.path);
  if (!records.length) { target.innerHTML = ''; return; }
  target.innerHTML = `<strong>已选文件（仅这些文件会交给AI分析）</strong>${records.map(item => {
    const path = String(item.path || item.name);
    const size = Number(item.size) ? ` · ${Math.max(1, Math.round(Number(item.size) / 1024))} KB` : '';
    return `<span class="selected-file-item"><span>${escapeHtml(path)}${escapeHtml(size)}</span><button class="selected-file-remove" type="button" data-remove-code-file="${escapeHtml(path)}" aria-label="移除${escapeHtml(path)}">移除</button></span>`;
  }).join('')}`;
}

async function readSourceDocumentFile(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file || !project) return;
  const extension = programFileExtension(file.name);
  try {
    let text = '';
    if (extension === 'docx') {
      if (!globalThis.mammoth?.extractRawText) throw new Error('DOCX读取组件尚未加载，请刷新页面后重试');
      const result = await globalThis.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
      text = result.value || '';
    } else if (extension === 'txt' || extension === 'md') text = await file.text();
    else throw new Error('请使用DOCX、TXT或MD文件；旧版DOC请先在WPS中另存为DOCX');
    text = String(text || '').replace(/\u0000/g, '').trim();
    if (!text) throw new Error('文件中没有读取到可分析的文字');
    const materials = project.paper.materials;
    materials.sourceDocumentFilename = file.name;
    materials.sourceDocumentText = text.slice(0, 100000);
    materials.sourceBackgroundText = '';
    $('source-file-summary').textContent = `已读取：${file.name}（${materials.sourceDocumentText.length}字，分析时仅提取背景方向）`;
    $('btn-clear-source-file').disabled = false;
    resetHardwareAnalysis('任务书或开题报告已更新');
    await persistProject({ immediate: true });
    toast('背景资料已读取，分析器件时只提取课题背景和研究方向', 'success');
  } catch (error) {
    $('source-file-summary').textContent = '读取失败，请检查文件格式';
    toast(error.message || '背景资料读取失败', 'error');
  }
}

function clearSourceDocument() {
  if (!project) return;
  const materials = project.paper.materials;
  materials.sourceDocumentFilename = '';
  materials.sourceDocumentText = '';
  materials.sourceBackgroundText = '';
  $('source-file-summary').textContent = '支持 DOCX、TXT、MD；旧版DOC请先用WPS另存为DOCX';
  $('btn-clear-source-file').disabled = true;
  resetHardwareAnalysis('任务书或开题报告已清除');
  persistProject();
  toast('背景资料已清除', 'success');
}

function binaryString(bytes) {
  let output = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) output += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  return output;
}

function decodePdfLiteral(value) {
  return String(value || '')
    .replace(/\\([\\()])/g, '$1')
    .replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t')
    .replace(/\\(\d{1,3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)));
}

function decodePdfHex(value) {
  const hex = String(value || '').replace(/\s+/g, '');
  if (!hex || !/^[0-9a-f]+$/i.test(hex)) return '';
  const normalized = hex.length % 2 ? `${hex}0` : hex;
  let output = '';
  for (let index = 0; index < normalized.length; index += 2) output += String.fromCharCode(parseInt(normalized.slice(index, index + 2), 16));
  return output;
}

async function extractPdfTextFallback(buffer) {
  const bytes = new Uint8Array(buffer);
  const source = binaryString(bytes);
  const pageTexts = [];
  const streamPattern = /<<(?:.|\n|\r)*?>>\s*stream\r?\n/g;
  let match;
  while ((match = streamPattern.exec(source))) {
    const start = streamPattern.lastIndex;
    const end = source.indexOf('endstream', start);
    if (end < 0) break;
    let streamBytes = bytes.subarray(start, end);
    if (/\/FlateDecode/.test(match[0]) && globalThis.DecompressionStream) {
      try {
        const compressed = new Blob([streamBytes]).stream().pipeThrough(new DecompressionStream('deflate'));
        streamBytes = new Uint8Array(await new Response(compressed).arrayBuffer());
      } catch {
        // 个别PDF使用原始deflate，保留未解压文本继续尝试。
      }
    }
    const text = binaryString(streamBytes);
    const fragments = [];
    text.replace(/\(((?:\\.|[^\\)])*)\)\s*Tj/g, (_, value) => { fragments.push(decodePdfLiteral(value)); return _; });
    text.replace(/<([0-9a-f\s]+)>\s*Tj/gi, (_, value) => { fragments.push(decodePdfHex(value)); return _; });
    text.replace(/\[((?:.|\n|\r)*?)\]\s*TJ/g, (_, values) => {
      const parts = [...values.matchAll(/\(((?:\\.|[^\\)])*)\)/g)].map(item => decodePdfLiteral(item[1]));
      parts.push(...[...values.matchAll(/<([0-9a-f\s]+)>/gi)].map(item => decodePdfHex(item[1])));
      if (parts.length) fragments.push(parts.join(''));
      return _;
    });
    const cleaned = fragments.join(' ').replace(/\s+/g, ' ').trim();
    if (cleaned) pageTexts.push(cleaned);
    streamPattern.lastIndex = end + 'endstream'.length;
  }
  return pageTexts.join('\n').trim();
}

async function readSchematicFile(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file || !project) return;
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') return toast('请选择PDF原理图文件', 'error');
  try {
    const buffer = await file.arrayBuffer();
    let extracted = '';
    let pageCount = 1;
    if (globalThis.pdfjsLib?.getDocument) {
      const loadingTask = globalThis.pdfjsLib.getDocument({ data: new Uint8Array(buffer), disableWorker: true });
      const pdf = await loadingTask.promise;
      pageCount = pdf.numPages;
      const pages = [];
      for (let index = 1; index <= Math.min(pdf.numPages, 30); index += 1) {
        const page = await pdf.getPage(index);
        const content = await page.getTextContent();
        const text = content.items.map(item => item.str || '').join(' ').replace(/\s+/g, ' ').trim();
        if (text) pages.push(`第${index}页：${text}`);
      }
      extracted = pages.join('\n').trim();
    } else {
      extracted = await extractPdfTextFallback(buffer);
    }
    if (!extracted) throw new Error('PDF没有提取到可读文字，可能是扫描图；请先OCR或粘贴原理图文字');
    const materials = project.paper.materials;
    materials.schematicFilename = file.name;
    materials.schematicText = extracted.slice(0, 100000);
    $('schematic-file-summary').textContent = `已读取：${file.name}（${materials.schematicText.length}字）`;
    resetHardwareAnalysis('原理图资料已更新');
    await persistProject({ immediate: true });
    toast(`已提取 ${pageCount} 页原理图文字，下一步会交给AI核对器件和引脚`, 'success');
  } catch (error) {
    $('schematic-file-summary').textContent = '读取失败，请检查PDF';
    toast(error.message || 'PDF原理图读取失败', 'error');
  }
}

function deviceFromLine(value, index = 0) {
  const text = sanitizeTechnicalText(value).trim();
  return {
    id: `device-user-${index + 1}`,
    model: text.replace(/[（(].*$/, '').trim(),
    role: text.match(/[（(]([^）)]+)[）)]/)?.[1] || '',
    interfaceType: '',
  };
}

function mappingKey(item) { return `${String(item.device || '').toLowerCase()}|${String(item.signal || '').toLowerCase()}`; }

function is51Controller(controller = '') {
  return /(?:STC|AT89|89C5|51\s*单片机)/i.test(String(controller));
}

function defaultDevelopmentTools(controller = '', codeFiles = []) {
  const value = String(controller || '').toUpperCase();
  const extensions = new Set((codeFiles || []).map(item => String(item?.extension || programFileExtension(item?.name || item)).toLowerCase()));
  if (/STM32/.test(value)) return ['Keil 5', 'STM32CubeMX'];
  if (is51Controller(value)) return ['Keil 5'];
  if (/ARDUINO|ATMEGA328|ESP32/.test(value)) return ['Arduino IDE'];
  if (/RP2040|RASPBERRY\s*PI\s*PICO/.test(value)) return extensions.has('py') ? ['Thonny'] : ['Arduino IDE'];
  if (/GD32/.test(value)) return ['Keil 5'];
  if (/CH32/.test(value)) return ['MounRiver Studio'];
  if (/MSP430/.test(value)) return ['Code Composer Studio'];
  if (/PIC\d|DSPIC/.test(value)) return ['MPLAB X IDE'];
  if (/LPC|NXP|MK\d|MIMX/.test(value)) return ['MCUXpresso IDE'];
  if (/RENESAS|RA\d|RX\d/.test(value)) return ['e² studio'];
  if (/AVR|ATMEGA|ATTINY/.test(value)) return ['Microchip Studio'];
  return [];
}

function mergeDevelopmentTools(existingText = '', tools = [], previousAutoTools = []) {
  const previousLine = previousAutoTools.length ? `编译与配置软件：${previousAutoTools.join('、')}` : '';
  const retainedLines = String(existingText || '').split('\n').map(item => item.trim()).filter(item => item && item !== previousLine);
  const retained = retainedLines.join('\n');
  const additions = unique(tools.map(item => String(item || '').trim()).filter(Boolean)).filter(item => !retained.toLowerCase().includes(item.toLowerCase()));
  const automaticLine = additions.length ? `编译与配置软件：${additions.join('、')}` : '';
  return { text: [retained, automaticLine].filter(Boolean).join('\n'), automaticTools: additions };
}

function inferController(title = '', devices = []) {
  const explicit = devices.find(item => /主控|单片机|STM32|STC|AT89|ESP32|Arduino/i.test(`${item.role || ''} ${item.model || ''}`))?.model;
  if (explicit) return explicit;
  const source = String(title || '');
  if (/ESP32/i.test(source)) return 'ESP32';
  if (/Arduino\s*(?:UNO)?|ATmega328/i.test(source)) return 'Arduino UNO';
  if (/RP2040|Raspberry\s*Pi\s*Pico/i.test(source)) return 'Raspberry Pi Pico (RP2040)';
  if (/AT89C?52|AT89/i.test(source)) return 'AT89C52';
  if (/51\s*单片机|STC/i.test(source)) return 'STC89C52RC';
  return 'STM32F103C8T6';
}

function fallbackMappings(controller, devices = []) {
  const used = new Set();
  const mappings = [];
  const signalsFor = device => {
    const source = `${device.interfaceType || ''} ${device.model || ''} ${device.role || ''}`;
    if (/I2C|OLED|SHT3|BH1750/i.test(source)) return ['SCL', 'SDA'];
    if (/UART|串口|ESP-01S|蓝牙|GPS|GSM|4G/i.test(source)) return ['TX', 'RX'];
    if (/SPI|TFT|RFID|LoRa|NRF24/i.test(source)) return ['SCK', 'MISO', 'MOSI', 'CS'];
    if (/1-Wire|单总线|DHT|DS18/i.test(source)) return ['DATA'];
    if (/ADC|模拟|MQ-|光敏|土壤/i.test(source)) return ['AO'];
    return ['CTRL'];
  };
  devices.filter(device => !/主控|单片机|电源|稳压|晶振|复位|下载|调试/.test(`${device.role || ''} ${device.model || ''}`)).forEach(device => {
    const signals = signalsFor(device);
    const interfaceType = String(device.interfaceType || (/OLED/i.test(device.model) ? 'I2C' : 'GPIO'));
    signals.forEach(signal => {
      const choices = compatiblePins(controller, signal, interfaceType);
      const sharedBus = /I2C/i.test(interfaceType);
      const pin = sharedBus && mappings.some(item => item.signal === signal && item.busGroup === 'I2C1')
        ? mappings.find(item => item.signal === signal && item.busGroup === 'I2C1').pin
        : choices.find(choice => !used.has(choice)) || choices[0] || '待确认';
      if (!sharedBus && pin !== '待确认') used.add(pin);
      mappings.push({ id: makeId('mapping'), device: device.model, interfaceType, signal, pin, alternatives: choices.slice(1, 5), busGroup: sharedBus ? 'I2C1' : '', shareAllowed: sharedBus, source: 'ai' });
    });
  });
  return mappings;
}

function controllerPinNotes(controller = '') {
  const value = String(controller).toUpperCase();
  if (is51Controller(value)) return ['51单片机P0口作通用I/O时需要外接10 kΩ上拉电阻，P3.0/P3.1优先保留给串口。'];
  if (/STM32/.test(value)) return ['PA13和PA14默认保留给SWD下载调试接口，不自动分配给普通外设。'];
  if (/ESP32/.test(value)) return ['ESP32的GPIO34、GPIO35、GPIO36和GPIO39仅作输入，GPIO6至GPIO11连接片上Flash，不用于普通外设。'];
  if (/ARDUINO|ATMEGA328/.test(value)) return ['Arduino UNO的D0/D1用于硬件串口，A4/A5用于I2C总线，D11至D13用于SPI总线。'];
  if (/RP2040|RASPBERRY\s*PI\s*PICO/.test(value)) return ['RP2040的GP26、GP27和GP28可用于ADC输入，数字外设应根据复用功能选择对应GP引脚。'];
  return [];
}

function hardwareDefaults(controller, powerNotes = [], fixedFacts = []) {
  const defaults = is51Controller(controller)
    ? ['51单片机采用独立最小系统电路，系统各模块必须共地。']
    : [`${controller}按最小系统开发板使用，开发板接收5V DC输入并通过板载稳压获得3.3V，5V与3.3V外设共地。`];
  return {
    powerNotes: unique([...powerNotes.map(sanitizeTechnicalText), ...defaults]),
    fixedFacts: unique([...fixedFacts.map(sanitizeTechnicalText), ...controllerPinNotes(controller), '凡电路需要上拉电阻时统一使用10 kΩ。', 'TFT彩屏统一使用1.8寸规格，不使用2.8寸TFT。']),
  };
}

async function analyzeHardware(event) {
  event?.preventDefault();
  if (requestController) return toast('当前还有任务正在运行', 'info');
  capturePaperMaterials({ invalidate: true });
  if (!project.title) {
    setPaperStep('materials', { scroll: true });
    $('paper-title-input').focus();
    return toast('请先填写论文题目', 'error');
  }
  requestController = new AbortController();
  requestTask = 'pin-analysis';
  const submit = qs('#paper-materials-form button[type="submit"]');
  const reanalyze = $('btn-reanalyze-pins');
  const inlineStatus = $('hardware-analysis-status');
  if (submit) { submit.disabled = true; submit.setAttribute('aria-busy', 'true'); submit.textContent = '正在分析器件'; }
  if (reanalyze) reanalyze.disabled = true;
  if (inlineStatus) { inlineStatus.textContent = '正在识别器件、通信方式和可用引脚，空结果会自动重试'; inlineStatus.className = 'inline-task-status is-busy'; }
  project.paper.factSheet.analyzedAt = '';
  $('pin-status').textContent = '正在分析';
  try {
    const materials = project.paper.materials;
    const raw = await callAi(Prompts.buildHardwareMessages({
      title: project.title,
      userDevices: lines(materials.devicesText),
      userFunctions: lines(materials.functionsText),
      userConnections: materials.connectionsText || '用户无需填写，请根据器件通信方式和主控可用资源提出待确认的引脚建议',
      sourceCodeOrLogic: Prompts.buildSourceCodeExcerpt(materials.codeFiles, materials.codeText, 30000),
      otherNotes: materials.sourceNotes || '未提供',
      supplementalDocumentFilename: materials.sourceDocumentFilename || '',
      supplementalDocumentText: String(materials.sourceDocumentText || '').slice(0, 80000),
      selectedProgramFiles: (materials.codeFiles || []).map(item => ({ name: item.name, path: item.path, extension: item.extension, size: item.size })),
      schematicFilename: materials.schematicFilename || '',
      schematicText: String(materials.schematicText || '').slice(0, 100000),
    }), { reasoning: false, maxTokens: 7000, jsonMode: true, signal: requestController.signal, requestLabel: '器件与引脚分析', timeoutMs: 100000 });
    const result = await parseAiJson(raw, { signal: requestController.signal, requestLabel: '器件与引脚分析', maxTokens: 7000 });
    const aiDevices = (Array.isArray(result.devices) ? result.devices : []).map((item, index) => ({
      id: item.id || `device-ai-${index + 1}`,
      model: sanitizeTechnicalText(String(item.model || item.name || '').trim()),
      role: sanitizeTechnicalText(String(item.role || item.purpose || '').trim()),
      interfaceType: String(item.interfaceType || item.interface || '').trim(),
    })).filter(item => item.model);
    const userDevices = lines(materials.devicesText).map(deviceFromLine).filter(item => item.model);
    const devices = [...userDevices];
    aiDevices.forEach(item => {
      const existing = devices.find(device => device.model.toLowerCase() === item.model.toLowerCase());
      if (existing) Object.assign(existing, { role: existing.role || item.role, interfaceType: existing.interfaceType || item.interfaceType });
      else devices.push(item);
    });
    const aiFunctions = (Array.isArray(result.functions) ? result.functions : []).map((item, index) => ({
      id: item.id || `function-ai-${index + 1}`,
      name: sanitizeTechnicalText(String(typeof item === 'string' ? item : item.name || item.description || '').trim()),
      deviceModels: Array.isArray(item.deviceModels) ? item.deviceModels.map(String) : [],
    })).filter(item => item.name);
    const userFunctionLines = lines(materials.functionsText);
    // 用户填写内容是事实源。只有用户未提供功能时才采用AI建议，避免同义功能被追加成两份。
    const functions = userFunctionLines.length
      ? userFunctionLines.map((name, index) => ({ id: `function-user-${index + 1}`, name, deviceModels: [] }))
      : aiFunctions;
    const controller = sanitizeTechnicalText(String(result.controller || inferController(project.title, devices)).trim());
    const aiDevelopmentTools = Array.isArray(result.developmentTools)
      ? result.developmentTools
      : String(result.developmentTools || '').split(/[、，,;；\n]/);
    const requiredDevelopmentTools = defaultDevelopmentTools(controller, materials.codeFiles);
    const developmentTools = requiredDevelopmentTools.length ? requiredDevelopmentTools : unique(aiDevelopmentTools);
    const mergedTools = mergeDevelopmentTools(materials.toolsText, developmentTools, materials.autoDevelopmentTools || []);
    materials.toolsText = mergedTools.text;
    materials.autoDevelopmentTools = mergedTools.automaticTools;
    const backgroundNotes = sanitizeTechnicalText(String(result.backgroundNotes || '').trim());
    if (materials.sourceDocumentText) materials.sourceBackgroundText = backgroundNotes;
    if (!devices.some(item => item.model.toLowerCase() === controller.toLowerCase())) devices.unshift({ id: makeId('device'), model: controller, role: is51Controller(controller) ? '主控单片机' : '主控最小系统开发板', interfaceType: 'GPIO' });
    const previousMappings = new Map((project.paper.factSheet.mappings || []).filter(item => item.source === 'user').map(item => [mappingKey(item), item]));
    const schematicPinText = String(materials.schematicText || '').toUpperCase();
    const schematicPins = new Set(schematicPinText.match(/\b(?:P[A-G]\d{1,2}|GPIO\d{1,2}|P\d\.\d|GP\d{1,2}|D\d{1,2}|A[0-5])\b/g) || []);
    let mappings = (Array.isArray(result.mappings) ? result.mappings : []).map((item, index) => {
      const device = String(item.device || item.deviceModel || '').trim();
      const interfaceType = String(item.interfaceType || item.interface || 'GPIO').trim();
      const signal = String(item.signal || item.connection || 'CTRL').trim().toUpperCase();
      const suggested = String(item.pin || '').trim().toUpperCase();
      const alternatives = unique(Array.isArray(item.alternatives) ? item.alternatives.map(pin => String(pin).toUpperCase()) : []);
      const allowed = compatiblePins(controller, signal, interfaceType);
      const controllerPins = allPins(controller).map(pin => String(pin).toUpperCase());
      // AI或原理图明确给出的真实GPIO优先保留；能力表只用于排序建议，不能把真实连接替换掉。
      const proposed = allowed.includes(suggested)
        ? suggested
        : controllerPins.includes(suggested)
          ? suggested
          : alternatives.find(pin => allowed.includes(pin)) || alternatives.find(pin => controllerPins.includes(pin)) || allowed[0] || suggested || '待确认';
      const mapping = {
        id: item.id || `mapping-${index + 1}-${Math.random().toString(36).slice(2, 7)}`,
        device, interfaceType, signal, pin: proposed, alternatives,
        busGroup: String(item.busGroup || '').trim(), shareAllowed: Boolean(item.shareAllowed), source: schematicPins.has(proposed) ? 'schematic' : 'ai',
      };
      const userMapping = previousMappings.get(mappingKey(mapping));
      return userMapping ? { ...mapping, pin: userMapping.pin, source: 'user' } : mapping;
    }).filter(item => item.device && item.signal);
    if (!mappings.length && devices.length > 1) mappings = fallbackMappings(controller, devices);
    const defaults = hardwareDefaults(controller, Array.isArray(result.powerNotes) ? result.powerNotes : [], Array.isArray(result.fixedFacts) ? result.fixedFacts : []);
    project.factRevision = `facts-${Date.now()}`;
    project.paper.factSheet = {
      controller,
      devices,
      functions,
      mappings,
      powerNotes: defaults.powerNotes,
      fixedFacts: defaults.fixedFacts,
      conflicts: unique(Array.isArray(result.conflicts) ? result.conflicts : []),
      conflictsAcknowledged: false,
      analyzedAt: nowIso(),
      confirmedAt: '',
    };
    project.paper.outlineTemplate = Prompts.DEFAULT_OUTLINE_ID;
    project.paper.outline = [];
    project.paper.outlineCustomized = false;
    project.paper.outlinePlanning = { status: 'idle', generatedAt: '', summary: '生成论文时将自动规划目录', lastError: '', source: '', inputRevision: '' };
    project.paper.outlineConfirmedAt = '';
    project.paper.artifacts = [];
    Object.values(project.paper.chapters || {}).forEach(chapter => { if (chapter?.content) chapter.status = 'stale'; });
    if (Object.values(project.paper.chapters || {}).some(chapter => chapter?.content)) project.paper.generation.status = 'stale';
    await persistProject({ immediate: true });
    paperStep = 'pins';
    renderPaper();
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }));
    toast('器件和引脚建议已整理，请核对红色项目', 'success');
    if (inlineStatus) { inlineStatus.textContent = `分析完成，已生成器件、引脚${developmentTools.length ? '并补充开发软件' : ''}`; inlineStatus.className = 'inline-task-status is-success'; }
  } catch (error) {
    toast(error.message || '器件与引脚分析失败', 'error');
    if (inlineStatus) { inlineStatus.textContent = `分析失败：${error.message || '请检查API后重试'}`; inlineStatus.className = 'inline-task-status is-error'; }
    renderPins();
  } finally {
    requestController = null;
    requestTask = '';
    if (submit) { submit.disabled = false; submit.removeAttribute('aria-busy'); submit.textContent = '下一步：分析器件'; }
    if (reanalyze) reanalyze.disabled = false;
  }
}

function pinChoices(mapping) {
  const compatible = compatiblePins(project.paper.factSheet.controller, mapping.signal, mapping.interfaceType);
  return unique(['待确认', ...compatible, ...(mapping.alternatives || []), mapping.pin]);
}

function combinedPinIssues() {
  const factSheet = project?.paper?.factSheet;
  if (!factSheet) return [];
  return validateMappings(factSheet.controller, factSheet.mappings || []);
}

function renderPins() {
  if (!project) return;
  const facts = project.paper.factSheet;
  const mappings = facts.mappings || [];
  const issues = combinedPinIssues();
  const issuesById = new Map();
  issues.forEach(issue => { if (!issuesById.has(issue.id)) issuesById.set(issue.id, []); issuesById.get(issue.id).push(issue); });
  $('pin-status').textContent = !facts.analyzedAt ? '等待分析' : issues.length ? `${issues.length}项待处理` : facts.confirmedAt ? '已确认' : '等待确认';
  $('pin-status').className = `status-badge ${issues.length ? 'is-danger' : facts.confirmedAt ? 'is-success' : ''}`;
  $('hardware-fact-strip').innerHTML = `<div class="fact-cell"><span>主控</span><strong>${escapeHtml(facts.controller || '等待分析')}</strong></div><div class="fact-cell"><span>器件</span><strong>${facts.devices?.length || 0}项</strong></div><div class="fact-cell"><span>功能</span><strong>${facts.functions?.length || 0}项</strong></div>`;
  const conflictBox = $('pin-conflict-summary');
  const messages = unique([...issues.map(issue => issue.message), ...(facts.conflicts || [])]);
  conflictBox.hidden = !messages.length;
  if (messages.length) {
    conflictBox.innerHTML = `<strong>需要确认</strong><ul>${messages.map(message => `<li>${escapeHtml(message)}</li>`).join('')}</ul>${facts.conflicts?.length ? `<label><input type="checkbox" id="ack-ai-conflicts" ${facts.conflictsAcknowledged ? 'checked' : ''}> 我已根据实物确认上述资料冲突的实际情况</label>` : ''}`;
  }
  $('pin-mapping-body').innerHTML = mappings.length ? mappings.map(mapping => {
    const rowIssues = issuesById.get(mapping.id) || [];
    const options = pinChoices(mapping).map(pin => `<option value="${escapeHtml(pin)}" ${pin === mapping.pin ? 'selected' : ''}>${escapeHtml(pin)}</option>`).join('');
    return `<tr data-mapping-id="${escapeHtml(mapping.id)}" class="${rowIssues.length ? 'has-issue' : ''}"><td><strong>${escapeHtml(mapping.device)}</strong></td><td>${escapeHtml(mapping.interfaceType)}</td><td>${escapeHtml(mapping.signal)}</td><td><select data-mapping-pin aria-label="${escapeHtml(mapping.device)} ${escapeHtml(mapping.signal)} 引脚">${options}</select></td><td class="pin-status-cell"><span class="mapping-state ${rowIssues.length ? 'is-error' : ''}" title="${escapeHtml(rowIssues.map(issue => issue.message).join('；'))}">${rowIssues.length ? '需处理' : mapping.source === 'user' ? '用户确认' : mapping.source === 'schematic' ? '原理图识别' : 'AI建议'}</span></td><td><button class="mapping-delete" type="button" data-delete-mapping aria-label="删除${escapeHtml(mapping.device)} ${escapeHtml(mapping.signal)}"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/></svg></button></td></tr>`;
  }).join('') : '<tr><td colspan="6">尚未生成引脚建议，请返回资料页进行分析。</td></tr>';
  $('hardware-notes').innerHTML = [...(facts.powerNotes || []), ...(facts.fixedFacts || [])].length
    ? `<ul>${[...(facts.powerNotes || []), ...(facts.fixedFacts || [])].map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
    : '<p>分析后会显示供电、共地和固定通信说明。</p>';
}

function markMappingEdited() {
  if (project.paper.factSheet.confirmedAt || project.paper.outlineConfirmedAt) bumpFactRevision('引脚分配已修改');
  project.paper.factSheet.confirmedAt = '';
}

function updateMappingPin(select) {
  const row = select.closest('[data-mapping-id]');
  const mapping = project.paper.factSheet.mappings.find(item => item.id === row?.dataset.mappingId);
  if (!mapping) return;
  markMappingEdited();
  mapping.pin = select.value;
  mapping.source = 'user';
  persistProject();
  renderPins();
}

function deleteMapping(button) {
  const id = button.closest('[data-mapping-id]')?.dataset.mappingId;
  if (!id) return;
  markMappingEdited();
  project.paper.factSheet.mappings = project.paper.factSheet.mappings.filter(item => item.id !== id);
  persistProject();
  renderPins();
}

function openMappingDialog() {
  $('mapping-device').value = '';
  $('mapping-interface').value = 'GPIO';
  $('mapping-signal').value = '';
  $('mapping-dialog').showModal();
}

function addMapping(event) {
  event.preventDefault();
  const device = $('mapping-device').value.trim();
  const interfaceType = $('mapping-interface').value;
  const signal = $('mapping-signal').value.trim().toUpperCase();
  if (!device || !signal) return;
  markMappingEdited();
  const allowed = compatiblePins(project.paper.factSheet.controller, signal, interfaceType);
  project.paper.factSheet.mappings.push({ id: makeId('mapping'), device, interfaceType, signal, pin: allowed[0] || '待确认', alternatives: [], busGroup: '', shareAllowed: false, source: 'user' });
  if (!project.paper.factSheet.devices.some(item => item.model.toLowerCase() === device.toLowerCase())) project.paper.factSheet.devices.push({ id: makeId('device'), model: device, role: '外设', interfaceType });
  $('mapping-dialog').close();
  persistProject();
  renderPins();
}

const OUTLINE_KINDS_BY_ID = Object.freeze({ 1: 'introduction', 2: 'overall', 3: 'hardware', 4: 'software', 5: 'test', 6: 'conclusion' });

function flattenPlannedSections(items, chapterId, output = []) {
  (Array.isArray(items) ? items : []).forEach(item => {
    if (typeof item === 'string') {
      const clean = item.replace(/^#{1,6}\s*/, '').replace(/．/g, '.').trim();
      if (new RegExp(`^${chapterId}\\.\\d+(?:\\.\\d+)?\\s+`).test(clean)) output.push(clean);
      return;
    }
    if (!item || typeof item !== 'object') return;
    const number = String(item.number || item.id || '').replace(/．/g, '.').trim();
    const title = String(item.title || item.name || '').replace(/^#{1,6}\s*/, '').trim();
    if (number && title && new RegExp(`^${chapterId}\\.\\d+(?:\\.\\d+)?$`).test(number)) output.push(`${number} ${title}`);
    flattenPlannedSections(item.children || item.sections, chapterId, output);
  });
  return output;
}

function artifactPlanKey(item) {
  const title = String(item.title || '').replace(/[\s，,。；;、：:（）()“”'"·.]/g, '').toLowerCase();
  return `${item.chapterId}|${item.type}|${title}`;
}

function mergeRequiredArtifacts(outline, planned = []) {
  const facts = project.paper.factSheet;
  const devices = [...(facts.devices || [])];
  if (facts.controller && !devices.some(device => String(device.model || '').toLowerCase() === String(facts.controller).toLowerCase())) {
    devices.unshift({ id: `device-controller-${facts.controller}`, model: facts.controller, role: is51Controller(facts.controller) ? '主控单片机' : '主控最小系统开发板', interfaceType: 'GPIO' });
  }
  const baseline = Prompts.buildArtifactPlan({ outline, devices, functions: facts.functions, mappings: facts.mappings || [] });
  const merged = [];
  [...planned, ...baseline].forEach(item => {
    if (item.type === 'hardware-block') return;
    if (item.type === 'pin-table' && (item.sourceFactIds || []).length > 1) return;
    const sourceIds = unique(item.sourceFactIds || []);
    const existing = merged.find(existing => {
      if (artifactPlanKey(existing) === artifactPlanKey(item)) return true;
      if (existing.type !== item.type || existing.chapterId !== item.chapterId || !sourceIds.length) return false;
      return sourceIds.some(id => (existing.sourceFactIds || []).includes(id));
    });
    if (!existing) merged.push({ ...item, sourceFactIds: sourceIds });
    else {
      if (String(item.instruction || '').length > String(existing.instruction || '').length) existing.instruction = item.instruction;
      if (!existing.reason && item.reason) existing.reason = item.reason;
      if (!existing.sectionId && item.sectionId) existing.sectionId = item.sectionId;
      existing.sourceFactIds = unique([...(existing.sourceFactIds || []), ...sourceIds]);
    }
  });
  const figureCounts = new Map();
  const tableCounts = new Map();
  const formulaCounts = new Map();
  return merged.map(item => {
    const output = { ...item };
    if (FIGURE_ARTIFACT_TYPES.has(item.type)) {
      const number = (figureCounts.get(item.chapterId) || 0) + 1;
      figureCounts.set(item.chapterId, number);
      output.figureNumber = `${item.chapterId}-${number}`;
    } else if (TABLE_ARTIFACT_TYPES.has(item.type)) {
      const number = (tableCounts.get(item.chapterId) || 0) + 1;
      tableCounts.set(item.chapterId, number);
      output.tableNumber = `${item.chapterId}-${number}`;
    } else if (item.type === 'formula') {
      const number = (formulaCounts.get(item.chapterId) || 0) + 1;
      formulaCounts.set(item.chapterId, number);
      output.formulaNumber = `${item.chapterId}-${number}`;
    }
    return output;
  });
}

function normalizeOutlinePlanResult(result, targetBodyChars = MIN_BODY_CHARS) {
  const rawChapters = Array.isArray(result?.chapters) ? result.chapters : Array.isArray(result?.outline) ? result.outline : [];
  const chapters = rawChapters.map((item, index) => {
    const id = String(item?.id || item?.number || index + 1).match(/[1-6]/)?.[0] || String(index + 1);
    const title = String(item?.title || item?.name || '').replace(/^第\s*[一二三四五六\d]+\s*章\s*/, '').trim();
    return { id, title, kind: OUTLINE_KINDS_BY_ID[id] || inferChapterKind(title), sections: unique(flattenPlannedSections(item?.sections || item?.children, id)) };
  }).filter(chapter => chapter.id && chapter.title).sort((a, b) => Number(a.id) - Number(b.id));
  return {
    summary: String(result?.summary || '').trim(),
    chapters: Prompts.assignChapterTargets(chapters, targetBodyChars, { devices: project?.paper?.factSheet?.devices || [], functions: project?.paper?.factSheet?.functions || [] }),
  };
}

function outlinePlanIssues(plan) {
  const errors = [];
  const outline = plan.chapters || [];
  const ids = outline.map(chapter => chapter.id);
  if (outline.length !== 6 || ids.join(',') !== '1,2,3,4,5,6') errors.push('目录必须完整包含连续的第1至第6章');
  outline.forEach(chapter => {
    const h2 = (chapter.sections || []).filter(section => new RegExp(`^${chapter.id}\\.\\d+\\s+`).test(section));
    const h3 = (chapter.sections || []).filter(section => new RegExp(`^${chapter.id}\\.\\d+\\.\\d+\\s+`).test(section));
    if (h2.length < 2) errors.push(`第${chapter.id}章至少需要两个二级标题`);
    if (h3.length > 10) errors.push(`第${chapter.id}章三级标题过多，应归纳同类内容`);
    h3.forEach(section => {
      const parent = section.match(/^(\d+\.\d+)\./)?.[1];
      if (parent && !h2.some(item => item.startsWith(`${parent} `))) errors.push(`${section}缺少父级二级标题${parent}`);
    });
    const keys = (chapter.sections || []).map(section => section.replace(/^\d+(?:\.\d+){1,2}\s+/, '').replace(/\s+/g, ''));
    if (new Set(keys).size !== keys.length) errors.push(`第${chapter.id}章存在语义重复的目录标题`);
  });
  const intro = outline.find(chapter => chapter.id === '1');
  const introText = (intro?.sections || []).join(' ');
  const introH2 = (intro?.sections || []).filter(section => /^1\.\d+\s+/.test(section));
  const expectedIntroNumbers = ['1.1', '1.2', '1.3', '1.4'];
  if (introH2.length !== 4 || introH2.map(section => section.match(/^(1\.\d+)/)?.[1]).join(',') !== expectedIntroNumbers.join(',')) errors.push('第一章必须且只能设置1.1至1.4四个二级标题');
  if (!/1\.2\.\d+\s+国内研究现状/.test(introText) || !/1\.2\.\d+\s+国外研究现状/.test(introText) || !/国内外研究现状(?:评述|分析|比较)/.test(introText)) errors.push('第一章国内外研究现状必须拆分为国内、国外和综合评述三级标题');
  if (!/1\.3\s+主要研究内容/.test(introText) || !/1\.4\s+论文结构安排/.test(introText)) errors.push('第一章必须把主要研究内容和论文结构安排分成1.3、1.4两个小节');
  const overallText = (outline.find(chapter => chapter.id === '2')?.sections || []).join(' ');
  if (!/器件选型/.test(overallText)) errors.push('第二章必须设置结合实际器件的选型内容');
  return unique(errors);
}

function generationArtifactPlanIssues(artifacts = []) {
  const errors = [];
  const hasType = (type, chapterId) => artifacts.some(item => item.type === type && (!chapterId || item.chapterId === chapterId));
  if (!hasType('system-framework', '2') || !hasType('comparison-table', '2')) errors.push('第二章缺少总体框架图或器件选型对比表');
  if (hasType('hardware-block', '3')) errors.push('第三章不得重复生成系统硬件组成图，总体框架只保留在第二章');
  if (!hasType('circuit', '3')) errors.push('第三章缺少器件电路图');
  if (!hasType('software-architecture', '4') || !hasType('flowchart', '4')) errors.push('第四章缺少软件结构图或流程图');
  if (!hasType('test-table', '5') || !hasType('result-image', '5')) errors.push('第五章缺少量化测试表或功能展示图');
  const functionalFlowcharts = artifacts.filter(item => item.type === 'flowchart' && item.chapterId === '4' && (item.sourceFactIds || []).length);
  const resultImages = artifacts.filter(item => item.type === 'result-image' && item.chapterId === '5');
  const testTables = artifacts.filter(item => item.type === 'test-table' && item.chapterId === '5');
  if (artifacts.some(item => item.type === 'formula' && item.chapterId !== '4')) errors.push('公式应放在第四章软件设计，不应放在第五章');
  const actualDevices = (project.paper.factSheet.devices || []).map((device, index) => ({ ...device, id: device.id || 'device-' + (index + 1) }));
  const controller = project.paper.factSheet.controller;
  if (controller && !actualDevices.some(device => String(device.model || '').toLowerCase() === String(controller).toLowerCase())) actualDevices.unshift({ id: `device-controller-${controller}`, model: controller, role: '主控' });
  const plannedDeviceKeys = new Set();
  const plannedDevices = actualDevices.filter(device => {
    const key = String(device.model || '').replace(/[\s（）()_-]/g, '').toLowerCase();
    if (!key || plannedDeviceKeys.has(key)) return false;
    plannedDeviceKeys.add(key);
    return true;
  });
  plannedDevices.forEach(device => {
    if (!artifacts.some(item => item.type === 'comparison-table' && item.chapterId === '2' && (item.sourceFactIds || []).includes(device.id))) errors.push(device.model + '缺少独立选型对比表计划');
    if (!artifacts.some(item => item.type === 'device-image' && (item.sourceFactIds || []).includes(device.id))) errors.push(`${device.model}缺少第二章器件图计划`);
    if (!artifacts.some(item => item.type === 'circuit' && (item.sourceFactIds || []).includes(device.id))) errors.push(`${device.model}缺少第三章电路图计划`);
  });
  const mappedDeviceNames = unique((project.paper.factSheet.mappings || []).map(mapping => mapping.device));
  mappedDeviceNames.forEach(deviceName => {
    const mappingKey = String(deviceName || '').replace(/[\s（）()_-]/g, '').toLowerCase();
    const device = plannedDevices.find(item => {
      const deviceKey = String(item.model || '').replace(/[\s（）()_-]/g, '').toLowerCase();
      return mappingKey && deviceKey && (mappingKey === deviceKey || mappingKey.includes(deviceKey) || deviceKey.includes(mappingKey));
    });
    if (device && !artifacts.some(item => item.type === 'pin-table' && (item.sourceFactIds || []).includes(device.id))) errors.push(`${device.model}缺少就近放置的独立引脚表`);
  });
  (project.paper.factSheet.functions || []).forEach(func => {
    const flowCoverage = functionalFlowcharts.filter(item => (item.sourceFactIds || []).includes(func.id)).length;
    const imageCoverage = resultImages.filter(item => (item.sourceFactIds || []).includes(func.id)).length;
    const testCoverage = testTables.filter(item => (item.sourceFactIds || []).includes(func.id)).length;
    if (flowCoverage !== 1) errors.push(`功能“${func.name}”应恰好归入一条独立程序逻辑链，当前为${flowCoverage}条`);
    if (imageCoverage !== 1) errors.push(`功能“${func.name}”应恰好归入一个可观察展示场景，当前为${imageCoverage}个`);
    if (testCoverage !== 1) errors.push(`功能“${func.name}”应恰好归入一张量化测试表，当前为${testCoverage}张`);
  });
  artifacts.filter(item => item.required).forEach(item => {
    if (String(item.instruction || '').length < 12) errors.push(`${item.title}的生成要求缺失`);
  });
  return unique(errors);
}

function prepareGenerationArtifacts() {
  const artifacts = mergeRequiredArtifacts(project.paper.outline || [], []);
  const errors = generationArtifactPlanIssues(artifacts);
  if (!errors.length) project.paper.artifacts = artifacts;
  return errors;
}

function synchronizeAllArtifactPresentation() {
  const chapters = project.paper.chapters || {};
  (project.paper.outline || []).forEach(chapter => {
    const saved = chapters[chapter.id];
    if (!saved?.content) return;
    const artifacts = (project.paper.artifacts || []).filter(item => String(item.chapterId) === String(chapter.id));
    saved.content = synchronizeArtifactPresentation(saved.content, artifacts);
  });
}

function desiredBodyChars() {
  return Math.max(MIN_BODY_CHARS, Math.min(40000, Number(project?.paper?.materials?.targetBodyChars) || MIN_BODY_CHARS));
}

async function planOutlineForPaper(signal) {
  const facts = project.paper.factSheet;
  const targetBodyChars = desiredBodyChars();
  const existing = project.paper.outlinePlanning || {};
  if (existing.status === 'ready' && existing.inputRevision === project.factRevision && project.paper.outline?.length === 6 && !outlinePlanIssues({ chapters: project.paper.outline }).length) return;

  const generation = project.paper.generation;
  generation.phase = 'planning';
  generation.percent = 4;
  generation.activeRequestLabel = '规划论文结构';
  generation.message = `正在根据${targetBodyChars.toLocaleString('zh-CN')}字目标、器件和功能规划六章目录`;
  project.paper.outlinePlanning = { status: 'planning', generatedAt: '', summary: generation.message, lastError: '', source: 'ai', inputRevision: '' };
  project.paper.outlineConfirmedAt = '';
  await saveGenerationCheckpoint();

  const context = { title: project.title, facts, materials: project.paper.materials, targetBodyChars };
  let plan = null;
  let rawPlan = null;
  let source = project.paper.materials.outlineReferenceText ? 'ai-reference' : 'ai';
  let planningNote = '';
  try {
    const raw = await callAi(Prompts.buildOutlinePlanMessages(context), { reasoning: true, maxTokens: 8000, jsonMode: true, signal, requestLabel: '规划论文结构' });
    rawPlan = parseJsonResponse(raw);
    plan = normalizeOutlinePlanResult(rawPlan, targetBodyChars);
    let errors = outlinePlanIssues(plan);
    if (errors.length) {
      generation.message = `正在补齐论文结构中的${errors.length}项遗漏`;
      await saveGenerationCheckpoint();
      const repairedRaw = await callAi(Prompts.buildOutlinePlanMessages({ ...context, previousPlan: rawPlan, validationIssues: errors }), { reasoning: true, maxTokens: 8000, jsonMode: true, signal, requestLabel: '补强论文结构' });
      rawPlan = parseJsonResponse(repairedRaw);
      plan = normalizeOutlinePlanResult(rawPlan, targetBodyChars);
      errors = outlinePlanIssues(plan);
    }
    if (errors.length) throw new Error(`AI目录仍有${errors.length}项结构遗漏`);
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    source = 'local-fallback';
    planningNote = `AI结构规划返回异常，已按器件、功能和目标字数自动建立项目目录：${error.message || '返回不完整'}`;
    plan = {
      summary: planningNote,
      chapters: Prompts.buildProjectOutline({ title: project.title, devices: facts.devices, functions: facts.functions, targetBodyChars }),
    };
  }

  const changed = JSON.stringify(project.paper.outline || []) !== JSON.stringify(plan.chapters);
  project.paper.outline = plan.chapters;
  project.paper.artifacts = [];
  project.paper.outlineCustomized = false;
  project.paper.outlinePlanning = { status: 'ready', generatedAt: nowIso(), summary: plan.summary || '已按目标字数、器件和功能完成论文结构规划', lastError: '', source, inputRevision: project.factRevision };
  project.paper.outlineConfirmedAt = nowIso();
  if (changed) Object.values(project.paper.chapters || {}).forEach(chapter => { if (chapter?.content) chapter.status = 'stale'; });
  generation.message = planningNote || '论文结构已规划完成，正在建立图表和公式要求';
  await saveGenerationCheckpoint();
}

async function confirmPins() {
  const issues = combinedPinIssues();
  const facts = project.paper.factSheet;
  const acknowledged = $('ack-ai-conflicts')?.checked || facts.conflictsAcknowledged;
  facts.conflictsAcknowledged = Boolean(acknowledged);
  if (!facts.analyzedAt) return toast('请先分析器件与引脚', 'error');
  if (issues.length) return toast(`还有${issues.length}项引脚问题需要处理`, 'error');
  if (facts.conflicts?.length && !facts.conflictsAcknowledged) return toast('请确认资料冲突的实际情况', 'error');
  facts.confirmedAt = nowIso();
  project.paper.outlineConfirmedAt = '';
  project.paper.outlinePlanning = { status: 'stale', generatedAt: '', summary: '将在生成论文时按目标字数、器件和功能自动规划结构', lastError: '', source: '', inputRevision: '' };
  await persistProject({ immediate: true });
  setPaperStep('generate', { scroll: true });
  toast('器件和引脚已确认，可以开始生成论文', 'success');
}

const REFERENCE_DOMAIN_TERMS = Object.freeze([
  '鱼缸','水质','养殖','水产','农业','灌溉','温室','家居','门禁','安防','消防','火灾','烟雾','燃气','老人','健康','医疗','心率','血氧','体温','跌倒','可穿戴',
  '机器人','小车','循迹','避障','导航','无人机','视觉','图像','识别','边缘计算','人工智能','物联网','云平台','无线','通信','LoRa','NB-IoT','WiFi','蓝牙','ZigBee',
  '传感器','检测','监测','温湿度','光照','压力','液位','水位','浊度','pH','报警','电机','舵机','继电器','控制','电力','电网','储能','逆变','故障诊断','预测维护','FPGA','信号处理','嵌入式','单片机','STM32','ESP32',
]);

const REFERENCE_DIRECTION_RULES = Object.freeze([
  { query: /鱼缸|水质|养殖|水产|温室|灌溉|农业/, direction: /智慧农业|养殖/ },
  { query: /家居|门禁|照明|窗帘|家庭/, direction: /智能家居|物联网/ },
  { query: /老人|健康|医疗|心率|血氧|体温|跌倒|可穿戴/, direction: /健康监测|可穿戴|辅助设备/ },
  { query: /机器人|小车|循迹|避障|导航|机械臂/, direction: /机器人|自主导航|智能小车/ },
  { query: /视觉|图像|识别|摄像|边缘计算|人工智能/, direction: /边缘AI|机器视觉/ },
  { query: /消防|火灾|烟雾|燃气|工业监测|能源控制/, direction: /消防安全|工业监测|能源控制/ },
  { query: /电网|电力|储能|逆变|变换器|充电/, direction: /电力电子|智能电网/ },
  { query: /LoRa|NB-IoT|蓝牙|ZigBee|无线|通信|传感网络/i, direction: /无线通信|传感网络/ },
  { query: /安全|加密|认证|入侵/, direction: /物联网安全/ },
  { query: /FPGA|信号处理|滤波|频谱/, direction: /信号处理|FPGA/ },
  { query: /故障|预测维护|工业物联网|设备状态/, direction: /工业物联网|预测维护/ },
  { query: /传感|检测|监测|测量|采集/, direction: /传感器|检测系统/ },
  { query: /单片机|STM32|ESP32|嵌入式|物联网/i, direction: /嵌入式|物联网系统/ },
]);

function referenceProjectQuery() {
  const materials = project?.paper?.materials || {};
  return [project?.title, materials.devicesText, materials.functionsText, materials.sourceNotes].filter(Boolean).join(' ');
}

function normalizeReferenceText(value) {
  return String(value || '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function referenceScore(record, query) {
  const source = `${record.direction} ${record.title} ${record.topics} ${record.source} ${record.authors}`;
  const normalizedQuery = normalizeReferenceText(query);
  const normalizedSource = normalizeReferenceText(source);
  let score = 0;
  REFERENCE_DOMAIN_TERMS.forEach(term => {
    const key = term.toLowerCase();
    if (normalizedQuery.includes(normalizeReferenceText(key)) && normalizedSource.includes(normalizeReferenceText(key))) score += key.length >= 4 ? 16 : 11;
  });
  REFERENCE_DIRECTION_RULES.forEach(rule => {
    if (rule.query.test(query) && rule.direction.test(record.direction)) score += 38;
  });
  const latinTokens = unique(String(query).match(/[A-Za-z][A-Za-z0-9-]{2,}/g) || []);
  latinTokens.forEach(token => { if (source.toLowerCase().includes(token.toLowerCase())) score += 10; });
  if (/期刊论文/.test(record.type)) score += 8;
  else if (/学位论文/.test(record.type)) score += 5;
  else if (/会议论文/.test(record.type)) score += 3;
  score += Math.max(0, Math.min(5, Number(record.year) - 2021));
  score += Math.min(5, Math.log2(Number(record.citationCount || 0) + 1));
  return score;
}

function referencePublicationReady(record) {
  const citation = String(record.formatted || '');
  if (!record.authors || !record.title || !record.source || !record.year || !citation) return false;
  if (/期刊论文|\[J\]/i.test(record.type)) {
    return new RegExp(`[,，]\\s*${record.year}\\s*[,，]\\s*\\d+\\s*\\([^)]+\\)\\s*[:：]\\s*[A-Za-z]?\\d+`, 'i').test(citation);
  }
  return /\[[A-Z]+(?:\/[A-Z]+)?\]/i.test(citation);
}

function referenceLanguageTargets(count) {
  const total = clampReferenceCount(count);
  const chinese = Math.round(total * 0.7);
  return { total, chinese, foreign: total - chinese };
}

function rankedReferenceCandidates(query = referenceProjectQuery(), limit = 100) {
  const ranked = REFERENCE_LIBRARY.filter(referencePublicationReady).map(record => ({ record, score: referenceScore(record, query) }))
    .sort((left, right) => right.score - left.score || Number(right.record.year) - Number(left.record.year) || Number(right.record.citationCount) - Number(left.record.citationCount));
  const chinese = ranked.filter(item => item.record.language === '中文').slice(0, Math.round(limit * 0.7));
  const foreign = ranked.filter(item => item.record.language === '外文').slice(0, limit - chinese.length);
  return [...chinese, ...foreign].sort((left, right) => right.score - left.score).map(item => item.record);
}

function fallbackReferenceSelection(candidates, count = 15) {
  const target = referenceLanguageTargets(count);
  const chinese = candidates.filter(item => item.language === '中文').slice(0, target.chinese);
  const foreign = candidates.filter(item => item.language === '外文').slice(0, target.foreign);
  const selected = [...chinese, ...foreign];
  candidates.forEach(item => { if (selected.length < target.total && !selected.some(existing => existing.id === item.id)) selected.push(item); });
  return selected.slice(0, target.total);
}

function balanceReferenceSelection(selected, candidates, count) {
  const target = referenceLanguageTargets(count);
  const balanced = [
    ...selected.filter(item => item.language === '中文').slice(0, target.chinese),
    ...selected.filter(item => item.language === '外文').slice(0, target.foreign),
  ];
  const addFrom = (language, maximum) => {
    const current = () => balanced.filter(item => item.language === language).length;
    candidates.filter(item => item.language === language).forEach(item => {
      if (current() < maximum && !balanced.some(existing => existing.id === item.id)) balanced.push(item);
    });
  };
  addFrom('中文', target.chinese);
  addFrom('外文', target.foreign);
  candidates.forEach(item => { if (balanced.length < target.total && !balanced.some(existing => existing.id === item.id)) balanced.push(item); });
  return balanced.slice(0, target.total);
}

function recommendedReferenceRecords() {
  const ids = project?.paper?.materials?.referenceRecommendationIds || [];
  const byId = new Map(REFERENCE_LIBRARY.map(item => [item.id, item]));
  return ids.map(id => byId.get(id)).filter(Boolean);
}

function referencesByIds(ids = []) {
  const byId = new Map(REFERENCE_LIBRARY.map(item => [item.id, item]));
  return ids.map(id => byId.get(id)).filter(Boolean);
}

function updateReferenceSelectedCount() {
  const checked = qsa('#reference-result-list input[type="checkbox"]:checked').length;
  const total = qsa('#reference-result-list input[type="checkbox"]').length;
  const target = $('reference-selected-count');
  if (target) target.textContent = total ? `已选 ${checked}/${total}` : '';
  const apply = $('btn-apply-reference-recommendations');
  if (apply) apply.disabled = !checked;
}

function renderReferenceTool() {
  const materials = project?.paper?.materials;
  if (!materials) return;
  const enabled = materials.useReferencesInPaper !== false;
  const records = recommendedReferenceRecords();
  const status = $('reference-library-status');
  if (status) status.textContent = !enabled
    ? '当前论文不使用参考文献'
    : materials.referencesText.trim()
    ? `当前已有 ${referenceTextEntries(materials.referencesText).length} 篇 · 文献库 ${REFERENCE_LIBRARY_META.count} 篇`
    : `文献库 ${REFERENCE_LIBRARY_META.count} 篇 · 留空将自动推荐`;
  const recommendButton = $('btn-recommend-references');
  const countInput = $('paper-reference-count');
  if (recommendButton) recommendButton.disabled = !enabled;
  if (countInput) countInput.disabled = !enabled;
  $('reference-field')?.classList.toggle('is-reference-disabled', !enabled);
  const panel = $('reference-recommendations');
  if (!panel) return;
  panel.hidden = !enabled || !records.length;
  if (!records.length) { $('reference-result-list').innerHTML = ''; return; }
  const reasons = materials.referenceRecommendationReasons || {};
  $('reference-recommendation-summary').textContent = materials.referenceRecommendationSummary || (materials.referenceRecommendationSource === 'ai' ? 'AI已按题目、器件和功能筛选' : '已按本地相关性排序');
  $('reference-result-list').innerHTML = records.map(record => `<label class="reference-result-item"><input type="checkbox" value="${escapeHtml(record.id)}" checked><span class="reference-result-copy"><strong>${escapeHtml(record.formatted)}</strong><span>${escapeHtml(reasons[record.id] || `${record.direction} · ${record.year}年 · ${record.language}`)}</span></span></label>`).join('');
  updateReferenceSelectedCount();
}

function standaloneRecommendedRecords() {
  return referencesByIds(standaloneReferenceState.recommendationIds || []);
}

function updateStandaloneReferenceSelection({ save = true } = {}) {
  const checked = qsa('#standalone-reference-list input[type="checkbox"]:checked').map(input => input.value);
  standaloneReferenceState.selectedIds = checked;
  const selected = referencesByIds(checked);
  const output = selected.map((record, index) => `[${index + 1}] ${String(record.formatted || '').replace(/^\s*\[\d+\]\s*/, '')}`).join('\n');
  if ($('standalone-reference-output')) $('standalone-reference-output').value = output;
  if ($('standalone-reference-selected-count')) $('standalone-reference-selected-count').textContent = standaloneRecommendedRecords().length ? `已选 ${selected.length}/${standaloneRecommendedRecords().length}` : '';
  ['btn-standalone-select-all', 'btn-standalone-clear-selection', 'btn-standalone-clear-results'].forEach(id => { if ($(id)) $(id).disabled = !standaloneRecommendedRecords().length; });
  if ($('btn-copy-standalone-references')) $('btn-copy-standalone-references').disabled = !selected.length;
  if (save) saveStandaloneReferenceState();
}

function renderStandaloneReferenceTool() {
  if (!$('standalone-reference-form')) return;
  $('standalone-reference-title').value = standaloneReferenceState.title || '';
  $('standalone-reference-notes').value = standaloneReferenceState.notes || '';
  $('standalone-reference-count').value = String(clampReferenceCount(standaloneReferenceState.count));
  const records = standaloneRecommendedRecords();
  const selectedIds = new Set(standaloneReferenceState.selectedIds || []);
  $('standalone-reference-result-status').textContent = records.length ? `${records.length}篇` : '等待推荐';
  $('standalone-reference-summary').textContent = standaloneReferenceState.summary || '填写题目后开始筛选。';
  $('standalone-reference-library-status').textContent = `文献库共${REFERENCE_LIBRARY_META.count}篇；API不可用时自动使用本地相关性排序。`;
  $('standalone-reference-list').innerHTML = records.length
    ? records.map(record => `<label class="reference-result-item"><input type="checkbox" value="${escapeHtml(record.id)}" ${selectedIds.has(record.id) ? 'checked' : ''}><span class="reference-result-copy"><strong>${escapeHtml(record.formatted)}</strong><span>${escapeHtml(standaloneReferenceState.reasons?.[record.id] || `${record.direction} · ${record.year}年 · ${record.language}`)}</span></span></label>`).join('')
    : '<div class="reference-empty"><strong>尚未生成文献</strong><span>推荐结果会在这里逐篇显示，可勾选后复制。</span></div>';
  updateStandaloneReferenceSelection({ save: false });
}

function referenceTextEntries(value) {
  const raw = String(value || '').trim();
  if (!raw) return [];
  const numbered = raw.split(/\n+(?=\s*\[\d+\]\s*)/).map(item => item.trim()).filter(Boolean);
  return numbered.length > 1 ? numbered : raw.split('\n').map(item => item.trim()).filter(Boolean);
}

function mergeReferencesIntoText(records) {
  const materials = project.paper.materials;
  const existing = referenceTextEntries(materials.referencesText).map(item => item.replace(/^\s*\[\d+\]\s*/, '').trim()).filter(Boolean);
  const keys = new Set(existing.map(normalizeReferenceText));
  try {
    Rules.parseReferences(existing).forEach(record => {
      const titleKey = normalizeReferenceText(record.title);
      if (titleKey) keys.add(`title:${titleKey}`);
    });
  } catch (error) {}
  records.forEach(record => {
    const citation = String(record.formatted || '').replace(/^\s*\[\d+\]\s*/, '').trim();
    const key = normalizeReferenceText(citation);
    const titleKey = normalizeReferenceText(record.title);
    if (citation && !keys.has(key) && (!titleKey || !keys.has(`title:${titleKey}`))) {
      existing.push(citation);
      keys.add(key);
      if (titleKey) keys.add(`title:${titleKey}`);
    }
  });
  materials.referencesText = existing.map((item, index) => `[${index + 1}] ${item}`).join('\n');
  $('paper-references').value = materials.referencesText;
}

async function selectReferenceRecommendations({ title, devices = [], functions = [], notes = '', count = 15, signal } = {}) {
  const target = referenceLanguageTargets(count);
  const query = [title, ...devices, ...functions, notes].filter(Boolean).join(' ');
  const candidates = rankedReferenceCandidates(query, 120);
  let selected = [];
  const reasons = {};
  let summary = '';
  let source = 'ai';
  try {
    const candidatePayload = candidates.map(item => ({ id: item.id, type: item.type, direction: item.direction, language: item.language, year: item.year, authors: item.authors, title: item.title, source: item.source, topics: item.topics, citationCount: item.citationCount }));
    const raw = await callAi(Prompts.buildReferenceRecommendationMessages({ title, devices, functions, candidates: candidatePayload, count: target.total }), { reasoning: false, maxTokens: 6000, jsonMode: true, signal, requestLabel: '参考文献推荐', timeoutMs: 100000 });
    const result = await parseAiJson(raw, { signal, requestLabel: '参考文献推荐', maxTokens: 6000 });
    const candidateMap = new Map(candidates.map(item => [item.id, item]));
    (Array.isArray(result.selected) ? result.selected : []).forEach(item => {
      const id = typeof item === 'string' ? item : String(item.id || '');
      const record = candidateMap.get(id);
      if (record && !selected.some(existing => existing.id === id)) {
        selected.push(record);
        if (typeof item === 'object' && item.reason) reasons[id] = String(item.reason).trim();
      }
    });
    summary = String(result.summary || '').trim();
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    source = 'local';
    summary = 'AI推荐暂不可用，已按题目关键词、方向、年份和文献类型完成本地筛选';
  }
  const aiCount = selected.length;
  selected = balanceReferenceSelection(selected, candidates, target.total);
  if (source === 'ai' && aiCount < selected.length) {
    source = 'hybrid';
    summary = `${summary || 'AI已按课题相关性筛选'}；不足部分已按本地相关性补足`;
  }
  const actual = referenceLanguageTargets(selected.length);
  const chinese = selected.filter(item => item.language === '中文').length;
  const foreign = selected.filter(item => item.language === '外文').length;
  return { selected, reasons, source, summary: `${summary || '已完成相关性筛选'}；共${selected.length}篇（中文${chinese}篇、外文${foreign}篇）`, target: actual };
}

async function recommendReferences({ automatic = false, signal = null } = {}) {
  const materials = project?.paper?.materials;
  if (!project?.title) {
    if (!automatic) { $('paper-title-input')?.focus(); toast('请先填写论文题目', 'error'); }
    return [];
  }
  if (materials?.useReferencesInPaper === false) {
    if (!automatic) toast('请先开启“论文中使用参考文献”', 'info');
    return [];
  }
  let ownRequest = false;
  if (!signal) {
    if (requestController) { toast('当前还有任务正在运行', 'info'); return []; }
    requestController = new AbortController();
    requestTask = 'reference-recommendation';
    signal = requestController.signal;
    ownRequest = true;
  }
  const button = $('btn-recommend-references');
  const status = $('reference-library-status');
  if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); button.textContent = '正在匹配文献'; }
  if (status) status.textContent = `正在从 ${REFERENCE_LIBRARY_META.count} 篇文献中筛选，请稍候`;
  try {
    const count = clampReferenceCount(materials.referenceRecommendationCount);
    const { selected, reasons, source, summary } = await selectReferenceRecommendations({ title: project.title, devices: lines(materials.devicesText), functions: lines(materials.functionsText), notes: materials.sourceNotes, count, signal });
    materials.referenceRecommendationIds = selected.map(item => item.id);
    materials.referenceRecommendationReasons = reasons;
    materials.referenceRecommendationSource = source;
    materials.referenceRecommendationSummary = summary;
    materials.referenceRecommendationAt = nowIso();
    if (automatic) mergeReferencesIntoText(selected);
    await persistProject({ immediate: true });
    renderReferenceTool();
    if (!automatic) toast(source === 'local' ? `AI暂不可用，已在本地筛选 ${selected.length} 篇` : `已推荐 ${selected.length} 篇文献，请确认后加入`, source === 'local' ? 'info' : 'success');
    return selected;
  } finally {
    if (ownRequest) {
      requestController = null;
      requestTask = '';
    }
    if (button) { button.disabled = false; button.removeAttribute('aria-busy'); button.textContent = 'AI推荐文献'; }
    renderReferenceTool();
  }
}

async function applyReferenceRecommendations() {
  const ids = qsa('#reference-result-list input[type="checkbox"]:checked').map(input => input.value);
  const byId = new Map(REFERENCE_LIBRARY.map(item => [item.id, item]));
  const selected = ids.map(id => byId.get(id)).filter(Boolean);
  if (!selected.length) return toast('请至少选择一篇文献', 'error');
  mergeReferencesIntoText(selected);
  await persistProject({ immediate: true });
  renderReferenceTool();
  $('reference-recommendations').hidden = true;
  toast(`已加入 ${selected.length} 篇文献，原有内容已保留`, 'success');
}

async function recommendStandaloneReferences(event) {
  event?.preventDefault();
  const title = $('standalone-reference-title').value.trim();
  if (!title) return toast('请先填写课题题目', 'error');
  if (requestController) return toast('当前还有任务正在运行', 'info');
  const button = $('btn-standalone-reference-search');
  standaloneReferenceState.title = title;
  standaloneReferenceState.notes = $('standalone-reference-notes').value.trim();
  standaloneReferenceState.count = clampReferenceCount($('standalone-reference-count').value);
  requestController = new AbortController();
  requestTask = 'standalone-reference-recommendation';
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  button.textContent = '正在筛选文献';
  $('standalone-reference-result-status').textContent = '筛选中';
  $('standalone-reference-summary').textContent = `正在从${REFERENCE_LIBRARY_META.count}篇文献中匹配`;
  try {
    const result = await selectReferenceRecommendations({ title, notes: standaloneReferenceState.notes, count: standaloneReferenceState.count, signal: requestController.signal });
    standaloneReferenceState.recommendationIds = result.selected.map(item => item.id);
    standaloneReferenceState.selectedIds = [...standaloneReferenceState.recommendationIds];
    standaloneReferenceState.reasons = result.reasons;
    standaloneReferenceState.source = result.source;
    standaloneReferenceState.summary = result.summary;
    standaloneReferenceState.updatedAt = nowIso();
    saveStandaloneReferenceState();
    renderStandaloneReferenceTool();
    toast(result.source === 'local' ? 'AI暂不可用，已完成本地筛选' : '参考文献推荐完成', result.source === 'local' ? 'info' : 'success');
  } catch (error) {
    if (error?.name !== 'AbortError') toast(error.message || '参考文献推荐失败', 'error');
  } finally {
    requestController = null;
    requestTask = '';
    button.disabled = false;
    button.removeAttribute('aria-busy');
    button.textContent = 'AI推荐文献';
  }
}

async function copyStandaloneReferences() {
  updateStandaloneReferenceSelection();
  const output = $('standalone-reference-output').value;
  if (!output) return toast('请至少选择一篇文献', 'error');
  try {
    await navigator.clipboard.writeText(output);
    toast('已复制带连续编号的参考文献', 'success');
  } catch (error) {
    $('standalone-reference-output').classList.remove('sr-only');
    $('standalone-reference-output').select();
    toast('浏览器未允许自动复制，已选中文本', 'info');
  }
}

function prepareReferenceRecords() {
  if (project.paper.materials.useReferencesInPaper === false) {
    project.paper.referenceRecords = [];
    Object.values(project.paper.chapters || {}).forEach(chapter => {
      if (chapter?.content) chapter.content = String(chapter.content).replace(/\[(\d+)\]/g, '');
    });
    return project.paper.referenceRecords;
  }
  let raw = project.paper.materials.referencesText.trim();
  let records = [];
  if (!raw) {
    const count = clampReferenceCount(project.paper.materials.referenceRecommendationCount);
    const fallback = fallbackReferenceSelection(rankedReferenceCandidates(referenceProjectQuery(), 120), count);
    mergeReferencesIntoText(fallback);
    raw = project.paper.materials.referencesText.trim();
  }
  if (raw) {
    const libraryByCitation = new Map(REFERENCE_LIBRARY.map(item => [normalizeReferenceText(item.formatted), item]));
    try {
      records = referenceTextEntries(raw).map((entry, index) => {
        const citation = entry.replace(/^\s*\[\d+\]\s*/, '').trim();
        const library = libraryByCitation.get(normalizeReferenceText(citation));
        if (!library) return Rules.parseReferences(`[${index + 1}] ${citation}`)?.[0];
        const documentType = library.type.match(/\[([A-Z]+(?:\/[A-Z]+)?)\]/i)?.[1] || '';
        const journalDetails = library.formatted.match(new RegExp(`[,，]\\s*${library.year}\\s*[,，]\\s*(\\d+)\\s*\\(([^)]+)\\)\\s*[:：]\\s*([A-Za-z]?\\d+(?:\\s*[-–—]\\s*[A-Za-z]?\\d+)?)`, 'i'));
        const volumeIssue = String(library.publication || '').match(/(?:\d{4}\s*[,，]\s*)?(\d+)\s*\(([^)]+)\)/);
        const pages = journalDetails?.[3] || String(library.publication || '').match(/[:：]\s*([A-Za-z]?\d+(?:\s*[-–—]\s*[A-Za-z]?\d+)?)/)?.[1] || '';
        return Rules.parseReferences([{
          id: library.id,
          authors: library.authors,
          title: library.title,
          documentType,
          source: library.source,
          year: library.year,
          volume: journalDetails?.[1] || volumeIssue?.[1] || '',
          issue: journalDetails?.[2] || volumeIssue?.[2] || '',
          pages: pages.replace(/\s+/g, ''),
          institution: documentType === 'D' ? library.source : '',
          publisher: ['M', 'S'].includes(documentType) ? library.source : '',
          doi: /^10\./.test(library.identifier) ? library.identifier : '',
          url: library.url,
          region: library.language === '中文' ? 'domestic' : library.language === '外文' ? 'foreign' : 'unknown',
          formatted: library.formatted,
          raw: library.formatted,
          originalNumber: index + 1,
        }])?.[0];
      }).filter(Boolean);
    } catch (error) { records = []; }
    if (!records.length) {
      records = lines(raw).map((line, index) => ({ id: `ref-user-${index + 1}`, authors: '', title: line.replace(/^\[\d+\]\s*/, ''), raw: line.replace(/^\[\d+\]\s*/, ''), formatted: line.replace(/^\[\d+\]\s*/, '') }));
    }
  }
  project.paper.referenceRecords = records.map((record, index) => {
    let formatted = record.formatted || record.formattedCitation || record.raw || '';
    if (!formatted && typeof Rules.formatReferenceRecord === 'function') {
      try { formatted = Rules.formatReferenceRecord(record); } catch (error) {}
    }
    return { ...record, id: record.id || `ref-${index + 1}`, citationNumber: index + 1, formatted: String(formatted || '').replace(/^\s*\[\d+\]\s*/, '') };
  });
  return project.paper.referenceRecords;
}

function synchronizeReferenceOrder() {
  if (project.paper.materials.useReferencesInPaper === false) {
    project.paper.referenceRecords = [];
    return [];
  }
  const intro = (project.paper.outline || []).find(item => item.kind === 'introduction') || (project.paper.outline || []).find(item => item.id === '1');
  const saved = project.paper.chapters?.[intro?.id || '1'];
  const records = project.paper.referenceRecords || [];
  if (!saved?.content || !records.length) return records;
  const firstSeen = [];
  for (const match of String(saved.content).matchAll(/\[(\d+)\]/g)) {
    const number = Number(match[1]);
    if (number >= 1 && number <= records.length && !firstSeen.includes(number)) firstSeen.push(number);
  }
  if (!firstSeen.length) return records;
  const remaining = records.map((_, index) => index + 1).filter(number => !firstSeen.includes(number));
  const order = [...firstSeen, ...remaining];
  const numberMap = new Map(order.map((oldNumber, index) => [oldNumber, index + 1]));
  saved.content = String(saved.content).replace(/\[(\d+)\]/g, (full, rawNumber) => {
    const nextNumber = numberMap.get(Number(rawNumber));
    return nextNumber ? `{{REF_${nextNumber}}}` : full;
  }).replace(/\{\{REF_(\d+)\}\}/g, '[$1]');
  project.paper.referenceRecords = order.map((oldNumber, index) => ({ ...records[oldNumber - 1], citationNumber: index + 1 }));
  project.paper.materials.referencesText = project.paper.referenceRecords.map((record, index) => `[${index + 1}] ${String(record.formatted || record.raw || '').replace(/^\s*\[\d+\]\s*/, '')}`).join('\n');
  if ($('paper-references')) $('paper-references').value = project.paper.materials.referencesText;
  return project.paper.referenceRecords;
}

function completedDigest() {
  return Object.values(project.paper.chapters || {}).filter(chapter => chapter?.content && chapter.inputRevision === project.factRevision).map(chapter => {
    const headings = [...String(chapter.content).matchAll(/^#{0,3}\s*(\d+[.．]\d+(?:[.．]\d+)?\s*[^\n]+)$/gm)].map(match => match[1]).slice(0, 18);
    const points = String(chapter.content).split(/\n{2,}/).map(item => item.replace(/^#{1,6}\s*/, '').replace(/\s+/g, ' ').trim()).filter(item => item.length >= 70 && !item.startsWith('【') && !item.startsWith('|')).slice(0, 12).map(item => item.slice(0, 120));
    const figures = (project.paper.artifacts || []).filter(item => item.chapterId === String(chapter.id)).map(item => item.title).slice(0, 18);
    return `第${chapter.id}章已完成且后续章节不得复述：标题=${headings.join('；') || '按目录完成'}；已详细阐述=${points.join('；') || '无'}；已使用图表=${figures.join('；') || '无'}`;
  }).join('\n');
}

function comparableParagraphs(value) {
  return String(value || '').split(/\n{2,}/).map(paragraph => paragraph
    .replace(/^#{1,6}\s*/, '')
    .replace(/【非正文·[\s\S]*?【非正文结束】/g, '')
    .replace(/\s+/g, '')
    .trim())
    .filter(paragraph => paragraph.length >= 90 && !paragraph.startsWith('|') && !/^\d+(?:\.\d+){1,2}[^，。]{0,40}$/.test(paragraph));
}

function paragraphGrams(value, size = 3) {
  const text = String(value || '').replace(/[，。；：、“”‘’（）()\[\]《》,.!?！？\s]/g, '');
  const grams = new Set();
  for (let index = 0; index <= text.length - size; index += 1) grams.add(text.slice(index, index + size));
  return grams;
}

function paragraphSimilarity(left, right) {
  const lengthRatio = Math.min(left.length, right.length) / Math.max(left.length, right.length);
  if (lengthRatio < 0.68) return 0;
  const a = paragraphGrams(left);
  const b = paragraphGrams(right);
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  a.forEach(item => { if (b.has(item)) overlap += 1; });
  return overlap / (a.size + b.size - overlap);
}

function crossChapterDuplicateIssues(chapterId, content) {
  const current = comparableParagraphs(content);
  const issues = [];
  Object.values(project.paper.chapters || {}).forEach(previous => {
    if (!previous?.content || Number(previous.id) >= Number(chapterId) || previous.status === 'stale') return;
    const earlier = comparableParagraphs(previous.content);
    current.forEach(paragraph => {
      const match = earlier.find(candidate => paragraph.slice(0, 180) === candidate.slice(0, 180) || paragraphSimilarity(paragraph, candidate) >= 0.78);
      if (match) issues.push(`与第${previous.id}章存在大段重复或同义复述：“${paragraph.slice(0, 72)}……”`);
    });
  });
  return unique(issues).slice(0, 8);
}

function internalDuplicateIssues(content) {
  const paragraphs = comparableParagraphs(content);
  const issues = [];
  for (let left = 0; left < paragraphs.length; left += 1) {
    for (let right = left + 1; right < paragraphs.length; right += 1) {
      if (paragraphs[left].slice(0, 180) === paragraphs[right].slice(0, 180) || paragraphSimilarity(paragraphs[left], paragraphs[right]) >= 0.82) {
        issues.push(`本章存在重复或同义复述段落：“${paragraphs[right].slice(0, 72)}……”`);
        break;
      }
    }
  }
  return unique(issues).slice(0, 6);
}

function headingRecords(content = '') {
  return [...String(content || '').replace(/．/g, '.').matchAll(/^\s*(\d+(?:\.\d+){1,2})\s+([^\n]+?)\s*$/gm)]
    .map(match => ({ number: match[1], title: match[2].replace(/[\s：:、，,。；;（）()]/g, ''), raw: `${match[1]} ${match[2].trim()}` }));
}

function duplicateHeadingIssues(content = '') {
  const records = headingRecords(content);
  const issues = [];
  const seenNumbers = new Set();
  const seenTitles = new Map();
  records.forEach(record => {
    if (seenNumbers.has(record.number)) issues.push(`本章标题编号${record.number}重复，必须只保留一个小节`);
    seenNumbers.add(record.number);
    if (record.title.length >= 6) {
      if (seenTitles.has(record.title)) issues.push(`本章存在重复小节标题：“${record.raw}”与“${seenTitles.get(record.title)}”`);
      else seenTitles.set(record.title, record.raw);
    }
  });
  return unique(issues).slice(0, 6);
}

function duplicateVisualIssues() {
  const seen = new Map();
  const issues = [];
  Object.values(project.paper.chapters || {}).forEach(chapter => {
    const text = String(chapter?.content || '');
    const blocks = [...text.matchAll(/【非正文(?:·[^】]*)?】[\s\S]*?【非正文结束】/g)].map(match => match[0]);
    blocks.forEach(block => {
      const signature = block
        .replace(/图\s*\d+\s*[-－—]\s*\d+/g, '图号')
        .replace(/表\s*\d+\s*[-－—]\s*\d+/g, '表号')
        .replace(/\s+/g, '')
        .trim();
      if (signature.length < 12) return;
      if (seen.has(signature)) {
        issues.push(`第${chapter.id}章与第${seen.get(signature)}章存在重复图表或Mermaid内容`);
      } else {
        seen.set(signature, chapter.id);
      }
    });
  });
  return unique(issues).slice(0, 8);
}

function normalizeChapterText(value, chapter) {
  let text = sanitizeTechnicalText(value).replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^```(?:markdown|text)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const escapedTitle = chapter.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  text = text.replace(new RegExp(`^#{0,3}\\s*第\\s*${chapter.id}\\s*章[\\s：:、-]*(?:${escapedTitle})?\\s*\\n+`, 'i'), '');
  text = text
    .replace(/^#{1,6}\s*(\d+[.．]\d+(?:[.．]\d+)?\s*[^\n]+)$/gm, '$1')
    .replace(/[ \t]*(【非正文(?:·[^】]*)?】)[ \t]*/g, '\n\n$1\n\n')
    .replace(/[ \t]*(【非正文结束】)[ \t]*/g, '\n\n$1\n\n')
    .replace(/(^|\n)(表\s*\d+\s*[-－—.]\s*\d+\s+[^\n|]+)[ \t]*(?=\n\|)/g, '$1$2\n')
    .replace(/上拉电阻(?:阻值|取值|采用|选用|为|是|\s|：|:)*\d+(?:\.\d+)?\s*k(?:Ω|欧姆)?/gi, '上拉电阻统一采用10 kΩ')
    .replace(/\d+(?:\.\d+)?\s*k(?:Ω|欧姆)?(?:的)?上拉电阻/gi, '10 kΩ上拉电阻')
    .replace(/【非正文·图[^】]*(?:待插入|插入)[：:]?\s*([^】]+)】/g, '【非正文·插图位置：$1】')
    .replace(/【非正文·(?:待插入|此处插入)[：:]?\s*([^】]+)】/g, '【非正文·插图位置：$1】')
    .replace(/(【非正文·插图位置：[^】]+】)[\s\S]*?【非正文结束】/g, '$1\n【非正文结束】')
    .replace(/\n{3,}/g, '\n\n');
  if (chapter.kind !== 'introduction') text = text.replace(/\[(\d+)\]/g, '');
  return text.trim();
}

function requiredTertiaryHeadings(chapter) {
  return (chapter?.sections || []).filter(section => /^\d+[.．]\d+[.．]\d+\s+/.test(section));
}

function missingRequiredHeadings(chapter, content) {
  const text = String(content || '').replace(/．/g, '.');
  return requiredTertiaryHeadings(chapter).filter(section => {
    const normalized = section.replace(/．/g, '.');
    const number = normalized.match(/^(\d+\.\d+\.\d+)/)?.[1];
    return number && !new RegExp(`^${number.replace(/\./g, '\\.')}\\s+`, 'm').test(text);
  });
}

function artifactAnchorIndex(content, artifact) {
  const text = String(content || '');
  let index = -1;
  if (FIGURE_ARTIFACT_TYPES.has(artifact.type) && artifact.figureNumber) {
    index = text.search(new RegExp(`【非正文·(?:插图位置|Mermaid(?:图|流程图)?)[：:]\\s*图\\s*${escapeRegExp(artifact.figureNumber).replace('-', '\\s*[-－—.]\\s*')}\\s+${escapeRegExp(artifact.title)}\\s*】`));
  } else if (TABLE_ARTIFACT_TYPES.has(artifact.type) && artifact.tableNumber) {
    index = text.search(new RegExp(`^\\s*表\\s*${escapeRegExp(artifact.tableNumber).replace('-', '\\s*[-－—.]\\s*')}\\s+${escapeRegExp(artifact.title)}\\s*$`, 'm'));
  } else if (artifact.type === 'formula' && artifact.formulaNumber) {
    index = text.search(new RegExp(`^.*[=＝].*[（(]\\s*${escapeRegExp(artifact.formulaNumber).replace('-', '\\s*[-－—.]\\s*')}\\s*[）)]\\s*$`, 'm'));
  }
  if (index < 0) index = text.indexOf(artifact.title);
  return index;
}

function artifactInstructionBlock(content, artifact) {
  const text = String(content || '');
  const index = artifactAnchorIndex(text, artifact);
  if (index < 0) return '';
  const end = text.indexOf('【非正文结束】', index);
  return text.slice(Math.max(0, index - 400), end >= 0 ? end + '【非正文结束】'.length : Math.min(text.length, index + 2400));
}

function artifactCitationLedgerIssues() {
  return validateArtifactLedger({ artifacts: project.paper.artifacts || [], chapters: project.paper.chapters || {} });
}

function mermaidFlowIssues(block, artifactTitle = '流程图') {
  const match = String(block || '').match(/```mermaid\s*\n([\s\S]*?)```/i);
  if (!match) return [`${artifactTitle}缺少可复制的Mermaid代码块`];
  const code = match[1].trim();
  const lines = code.split('\n').map(line => line.trim()).filter(Boolean);
  const nodeIds = new Set([...code.matchAll(/\b([A-Za-z][A-Za-z0-9_]*)\s*(?=[\[({])/g)].map(item => item[1]));
  const issues = [];
  if (!/^flowchart\s+TD\s*$/im.test(code)) issues.push(`${artifactTitle}必须使用flowchart TD`);
  if ((code.match(/开始/g) || []).length !== 1 || (code.match(/结束/g) || []).length !== 1) issues.push(`${artifactTitle}必须各有且只有一个“开始”和“结束”节点`);
  if (!/\(\[\s*开始\s*\]\)/.test(code) || !/\(\[\s*结束\s*\]\)/.test(code)) issues.push(`${artifactTitle}的开始和结束必须使用圆角终止节点`);
  if (nodeIds.size < 5) issues.push(`${artifactTitle}少于5个有效节点`);
  if (nodeIds.size > 9 || lines.length > 18) issues.push(`${artifactTitle}过于复杂，应精简到9个节点以内`);
  if ((code.match(/\{[^{}]+\}/g) || []).length > 2) issues.push(`${artifactTitle}判断节点超过2个，分支需要归纳`);
  if (!/\{[^{}]+\}/.test(code) || !/(?:--\s*(?:是|否)\s*-->|-->\|(?:是|否)\|)/.test(code)) issues.push(`${artifactTitle}缺少简洁的是/否判断分支`);
  if (/\b(?:subgraph|classDef|style|click)\b|<\/?[A-Za-z][^>]*>/i.test(code)) issues.push(`${artifactTitle}包含不必要的样式、子图或HTML语法`);
  return issues;
}

function mermaidStructureIssues(block, artifactTitle = '结构图') {
  const match = String(block || '').match(/```mermaid\s*\n([\s\S]*?)```/i);
  if (!match) return [`${artifactTitle}缺少可复制的Mermaid代码块`];
  const code = match[1].trim();
  const nodeIds = new Set([...code.matchAll(/\b([A-Za-z][A-Za-z0-9_]*)\s*(?=[\[({])/g)].map(item => item[1]));
  const issues = [];
  if (!/^flowchart\s+(?:TD|LR)\s*$/im.test(code)) issues.push(`${artifactTitle}必须使用flowchart TD或flowchart LR`);
  if (nodeIds.size < 4) issues.push(`${artifactTitle}少于4个有效节点`);
  if (nodeIds.size > 10) issues.push(`${artifactTitle}过于复杂，应精简到10个节点以内`);
  if (/\b(?:subgraph|classDef|style|click)\b|<\/?[A-Za-z][^>]*>/i.test(code)) issues.push(`${artifactTitle}包含不必要的样式、子图或HTML语法`);
  return issues;
}

function mermaidTimingIssues(block, artifactTitle = '时序图') {
  const match = String(block || '').match(/```mermaid\s*\n([\s\S]*?)```/i);
  if (!match) return [`${artifactTitle}缺少可复制的Mermaid代码块`];
  const code = match[1].trim();
  const nodeIds = new Set([...code.matchAll(/\b([A-Za-z][A-Za-z0-9_]*)\s*(?=[\[({])/g)].map(item => item[1]));
  const issues = [];
  if (!/^flowchart\s+LR\s*$/im.test(code)) issues.push(`${artifactTitle}必须使用flowchart LR按时间从左向右横向绘制`);
  if (/^sequenceDiagram\s*$/im.test(code) || /^flowchart\s+TD\s*$/im.test(code)) issues.push(`${artifactTitle}不能使用纵向时序布局`);
  if ((code.match(/开始/g) || []).length !== 1 || (code.match(/结束/g) || []).length !== 1) issues.push(`${artifactTitle}必须各有且只有一个“开始”和“结束”节点`);
  if (nodeIds.size < 5) issues.push(`${artifactTitle}缺少完整的发起、应答、数据传输和结束过程`);
  if (nodeIds.size > 9) issues.push(`${artifactTitle}超过9个节点，应精简横向时间过程`);
  if (/\b(?:subgraph|classDef|style|click)\b|<\/?[A-Za-z][^>]*>/i.test(code)) issues.push(`${artifactTitle}包含不必要的样式、子图或HTML语法`);
  return issues;
}

function visualContentBlocks(content = '') {
  const text = String(content || '');
  const blocks = [];
  const artifactPattern = /【非正文(?:·[^】]*)?】[\s\S]*?【非正文结束】/g;
  for (const match of text.matchAll(artifactPattern)) blocks.push({ start: match.index, end: match.index + match[0].length, type: 'figure' });
  let offset = 0;
  const linesWithOffsets = text.split('\n').map(line => {
    const item = { line, start: offset, end: offset + line.length };
    offset += line.length + 1;
    return item;
  });
  for (let index = 0; index < linesWithOffsets.length; index += 1) {
    if (!/^\s*\|.*\|\s*$/.test(linesWithOffsets[index].line)) continue;
    const startIndex = index > 0 && /^\s*表\s*\d+\s*[-－—.]\s*\d+/.test(linesWithOffsets[index - 1].line) ? index - 1 : index;
    let endIndex = index;
    while (endIndex + 1 < linesWithOffsets.length && /^\s*\|.*\|\s*$/.test(linesWithOffsets[endIndex + 1].line)) endIndex += 1;
    blocks.push({ start: linesWithOffsets[startIndex].start, end: linesWithOffsets[endIndex].end, type: 'table' });
    index = endIndex;
  }
  return blocks.sort((left, right) => left.start - right.start).filter((block, index, list) => !index || block.start >= list[index - 1].end);
}

function consecutiveVisualIssues(content = '') {
  const blocks = visualContentBlocks(content);
  const issues = [];
  for (let index = 1; index < blocks.length; index += 1) {
    const between = String(content).slice(blocks[index - 1].end, blocks[index].start)
      .replace(/^\s*\d+(?:\.\d+){1,2}\s+[^\n]+$/gm, '')
      .replace(/\s+/g, '');
    const substantive = (between.match(/[\u3400-\u9fffA-Za-z0-9]/g) || []).length;
    if (substantive < 80) issues.push(`存在连续的${blocks[index - 1].type === 'figure' ? '图' : '表'}与${blocks[index].type === 'figure' ? '图' : '表'}，中间缺少实质正文段落`);
  }
  return unique(issues);
}

function artifactDetailIssues(content, artifacts = []) {
  const issues = [];
  artifacts.forEach(artifact => {
    if (artifact.sectionId) {
      const sectionMatch = String(content || '').match(new RegExp(`^${escapeRegExp(artifact.sectionId)}\\s+`, 'm'));
      const artifactIndex = artifactAnchorIndex(content, artifact);
      if (artifactIndex < 0) {
        issues.push(`${artifact.title}缺少插图位置`);
      } else if (sectionMatch && artifactIndex < sectionMatch.index) issues.push(`${artifact.title}没有放在${artifact.sectionId}对应正文之后`);
    }
    const block = artifactInstructionBlock(content, artifact);
    if (!block) {
      issues.push(`${artifact.title}未预留或未使用准确图名`);
      return;
    }
    if (artifact.type === 'flowchart') {
      issues.push(...mermaidFlowIssues(block, artifact.title));
    } else if (artifact.type === 'device-image' || artifact.type === 'result-image' || artifact.type === 'circuit') {
      if (!/插图位置|待插入|此处插入/.test(block)) issues.push(`${artifact.title}缺少简短插图提示`);
    } else if (['system-framework', 'software-architecture'].includes(artifact.type)) {
      issues.push(...mermaidStructureIssues(block, artifact.title));
    } else if (artifact.type === 'timing') {
      issues.push(...mermaidTimingIssues(block, artifact.title));
    } else if (['comparison-table', 'pin-table', 'test-table'].includes(artifact.type)) {
      const aroundTitle = String(content || '').slice(Math.max(0, String(content || '').indexOf(artifact.title) - 200), String(content || '').indexOf(artifact.title) + 3500);
      if (!/^\s*\|.*\|\s*$/m.test(aroundTitle) || !/^\s*\|\s*:?-{3,}/m.test(aroundTitle)) issues.push(`${artifact.title}尚未生成可用的Markdown数据表格`);
      if (artifact.type === 'comparison-table' && !tableRowGroups(aroundTitle).some(table => table.length >= 5)) issues.push(`${artifact.title}至少需要包含实际选用型号和2个候选型号`);
    } else if (artifact.type === 'formula') {
      if (!/[=＝]/.test(block) || !/(?:式中|其中|变量)/.test(block) || !/(?:单位|表示|用途)/.test(block)) issues.push(`${artifact.title}缺少公式、变量、单位或用途说明`);
    }
  });
  return issues;
}

async function ensureChapterStructureAndArtifacts(chapter, content, signal) {
  const chapterArtifacts = (project.paper.artifacts || []).filter(item => item.chapterId === chapter.id);
  let bestContent = synchronizeArtifactPresentation(content, chapterArtifacts);
  for (let pass = 0; pass < 2; pass += 1) {
    const missingHeadings = missingRequiredHeadings(chapter, bestContent);
    const ledgerIssues = validateArtifactLedger({ artifacts: chapterArtifacts, chapters: { [chapter.id]: { id: chapter.id, content: bestContent } } }).map(item => item.message);
    const detailIssues = unique([...artifactDetailIssues(bestContent, chapterArtifacts), ...ledgerIssues]);
    const duplicateIssues = unique([...internalDuplicateIssues(bestContent), ...crossChapterDuplicateIssues(chapter.id, bestContent), ...consecutiveVisualIssues(bestContent)]);
    const paragraphIssues = longProseParagraphIssues(bestContent);
    if (!missingHeadings.length && !detailIssues.length && !duplicateIssues.length && !paragraphIssues.length) return bestContent;
    const raw = await callAi([
      {
        role: 'system',
        content: `你是本科论文章节质量补强编辑。请在不删减有效正文、不改变确认事实、不增加新器件/引脚/功能的前提下，修复指定章节的标题、图表说明和跨章重复问题。优先补齐problemsToRepair中列出的每一项图表、公式、表格或Mermaid流程图，不得遗漏。requiredSections中的二级、三级标题必须全部出现且顺序不变，三级标题数量以目录为准，不得擅自压缩。对标记为跨章重复的段落必须按照本章唯一职责重新组织：删除在前文已经完整介绍的参数、原理、接线或程序步骤，只保留一句必要衔接，再补入本章专属分析，禁止仅替换同义词。

每个缺失或说明不足的图表都要放在对应正文之后。正文每段只表达一个主要观点，通常120至300字；超过380字必须在观点转换处用空行拆分，不删减技术内容，也不把每句话机械拆段。artifacts中的每张图都按figureNumber在图前正文中恰好引用一次“如图x-x所示”，每张表都按tableNumber在表前正文中恰好引用一次“如表x-x所示”，每个公式都按formulaNumber在公式前正文中恰好引用一次“如式（x-x）所示”，不得漏引、复用编号或单独成段。程序流程图使用flowchart TD，开始和结束各一个且使用圆角终止节点，主干自上而下、最多9个节点和2个判断节点，分支尽快汇合；系统总体功能框架图使用flowchart LR表达硬件组成及信息流，系统软件功能模块图使用flowchart TD表达程序任务及调用层级，不得逐个重复硬件节点或照搬第二章连接关系；通信或严格时序图必须使用flowchart LR按时间从左向右横向展开，禁止sequenceDiagram和flowchart TD。所有Mermaid图保持简洁，禁止subgraph、style、classDef和HTML。第三章不得生成硬件组成图或总体结构图。器件图、电路图、实物图和功能展示图使用独占一行的“【非正文·插图位置：图x-x 图名】”、下一行“【非正文结束】”以及随后独占一行的“图x-x 图名”题注；Mermaid图使用带相同图号图名的非正文标记并在代码块后保留同号题注；不得写拍摄、绘制、构图或取景说明。每张引脚表只对应一个器件并紧跟该器件电路说明，不得包含“信号方向”列。选型对比表、引脚表和测试表必须直接生成可用的Markdown表格并使用准确的“表x-x 表名”表题；公式必须独占一行、行末写“（x-x）”，并解释变量、单位、参数来源和用途。任意两张图或表之间必须补入不少于80字的实质正文段落，禁止连续图图、图表或表表。只输出补强后的完整本章正文，不输出章标题、解释或质量评价。`,
      },
      { role: 'user', content: JSON.stringify({ pass: pass + 1, chapter: { id: chapter.id, title: chapter.title, kind: chapter.kind, requiredSections: chapter.sections }, chapterResponsibility: Prompts.chapterResponsibilities?.(chapter.kind) || '', confirmedFacts: project.paper.factSheet, completedChapterLedger: completedDigest(), chapterArtifacts, problemsToRepair: [...missingHeadings.map(item => `缺少目录标题：${item}`), ...detailIssues, ...duplicateIssues, ...paragraphIssues], existingChapter: bestContent }, null, 2) },
    ], { reasoning: false, maxTokens: 16000, signal, requestLabel: `第${chapter.id}章内容质量补强${pass ? '复核' : ''}` });
    const revised = synchronizeArtifactPresentation(normalizeChapterText(raw, chapter), chapterArtifacts);
    const revisedLedger = validateArtifactLedger({ artifacts: chapterArtifacts, chapters: { [chapter.id]: { id: chapter.id, content: revised } } });
    const revisedProblems = missingRequiredHeadings(chapter, revised).length + artifactDetailIssues(revised, chapterArtifacts).length + revisedLedger.length + internalDuplicateIssues(revised).length + crossChapterDuplicateIssues(chapter.id, revised).length + consecutiveVisualIssues(revised).length;
    const originalProblems = missingHeadings.length + detailIssues.length + duplicateIssues.length;
    if (countBodyChars(revised) < Math.max(700, Math.floor(countBodyChars(bestContent) * 0.72)) || revisedProblems >= originalProblems) break;
    bestContent = revised;
  }
  return bestContent;
}

function generationPhasePercent(generation) {
  const total = project.paper.outline.length || 1;
  const completed = project.paper.outline.filter(chapter => project.paper.chapters[chapter.id]?.content && project.paper.chapters[chapter.id]?.inputRevision === project.factRevision).length;
  if (generation.phase === 'planning') return 4;
  if (generation.phase === 'chapters') return Math.min(74, 8 + Math.round(completed / total * 66));
  if (generation.phase === 'expand') return 78;
  if (generation.phase === 'extras') return 84;
  if (generation.phase === 'audit') return 92;
  if (generation.phase === 'quality') return 97;
  if (generation.status === 'completed') return 100;
  return Number(generation.percent) || 0;
}

function renderGeneration() {
  if (!project) return;
  const generation = project.paper.generation || freshGeneration();
  project.paper.generation = generation;
  generation.percent = generationPhasePercent(generation);
  const statusMap = { idle: '尚未开始', running: '正在生成', paused: '已暂停', failed: '生成中断', completed: '已完成', stale: '资料已更新' };
  const status = $('generation-status');
  status.textContent = statusMap[generation.status] || '尚未开始';
  status.className = `status-badge ${generation.status === 'failed' || generation.status === 'stale' ? 'is-warning' : generation.status === 'completed' ? 'is-success' : ''}`;
  $('generation-title').textContent = generation.status === 'running' ? (generation.activeRequestLabel || '正在准备下一步') : generation.status === 'completed' ? '论文内容已经保存' : generation.status === 'paused' ? '可以从已保存位置继续' : generation.status === 'failed' ? '生成遇到问题' : generation.status === 'stale' ? '需要根据新资料更新正文' : '准备生成论文';
  const checkedIssues = project.paper.quality?.checkedAt ? (project.paper.quality.issues || []) : null;
  const blockingIssueCount = checkedIssues?.filter(item => item.severity === 'blocking').length || 0;
  const warningIssueCount = checkedIssues?.filter(item => item.severity !== 'blocking').length || 0;
  const completedMessage = checkedIssues === null
    ? generation.message
    : checkedIssues.length
      ? `论文已生成，检查出${blockingIssueCount}项重点问题${warningIssueCount ? `和${warningIssueCount}项提醒` : ''}；当前稿仍可下载`
      : '论文最终检查通过';
  $('generation-message').textContent = generation.lastError || (generation.status === 'completed' ? completedMessage : generation.message) || '点击开始后先自动规划论文结构，再逐章生成并保存。';
  $('generation-progress').style.width = `${generation.percent}%`;
  const screenNotice = $('generation-screen-notice');
  const showScreenNotice = generation.status === 'running';
  if (screenNotice) {
    screenNotice.hidden = !showScreenNotice;
    $('screen-notice-title').textContent = generation.activeRequestLabel || '正在生成论文';
    $('screen-notice-message').textContent = generation.message || '已完成内容会自动保存';
    $('screen-notice-progress').textContent = `${generation.percent}%`;
  }
  document.body.classList.toggle('has-generation-notice', showScreenNotice);
  document.title = showScreenNotice ? `${generation.percent}% · ${generation.activeRequestLabel || '正在生成论文'}` : APP_TITLE;
  const phases = [
    ['references', '文献'], ['planning', '结构规划'], ['chapters', '正文'], ['extras', '摘要'], ['audit', '技术复核'], ['quality', '本地检查'], ['export', '导出'],
  ];
  const order = phases.map(item => item[0]);
  const activeIndex = generation.status === 'completed' ? order.length : Math.max(0, order.indexOf(generation.phase));
  $('generation-phases').innerHTML = phases.map(([id, label], index) => `<span class="phase-item ${index < activeIndex || generation.status === 'completed' ? 'is-complete' : index === activeIndex && generation.status === 'running' ? 'is-active' : ''}">${label}</span>`).join('');
  const elapsed = generation.startedAt ? Math.floor((Date.now() - new Date(generation.startedAt).getTime()) / 1000) : 0;
  $('generation-elapsed').textContent = formatTime(elapsed);
  const outlineRows = (project.paper.outline || []).map(chapter => {
    const saved = project.paper.chapters[chapter.id];
    const valid = saved?.content && saved.inputRevision === project.factRevision && saved.status !== 'stale';
    const active = generation.status === 'running' && generation.currentChapterId === chapter.id;
    const detail = valid ? `${countBodyChars(saved.content).toLocaleString('zh-CN')}字 · 已保存` : saved?.content ? '资料已更新，等待重写' : active ? '正在生成本章' : `目标约${Number(chapter.targetCharacters || 0).toLocaleString('zh-CN')}字 · 等待生成`;
    return `<div class="chapter-row ${valid ? 'is-complete' : ''} ${active ? 'is-active' : ''}"><span class="chapter-number">${escapeHtml(chapter.id)}</span><div class="chapter-main"><strong>第${escapeHtml(chapter.id)}章 ${escapeHtml(chapter.title)}</strong><small>${escapeHtml(detail)}</small></div><span class="chapter-state">${active ? '处理中' : valid ? '已完成' : '未完成'}</span></div>`;
  }).join('');
  $('chapter-list').innerHTML = outlineRows || '<div class="chapter-empty"><strong>论文结构将在生成时自动建立</strong><span>系统会结合目标字数、器件、功能和参考目录安排六章内容。</span></div>';
  const hasContent = Object.values(project.paper.chapters || {}).some(chapter => String(chapter?.content || '').trim());
  $('btn-download-draft').disabled = !hasContent;
  $('btn-download-draft-top').disabled = !hasContent;
  const startButton = $('btn-start-generation');
  startButton.disabled = generation.status === 'running';
  startButton.textContent = generation.status === 'running' ? '正在生成' : ['paused', 'failed'].includes(generation.status) ? '继续生成' : generation.status === 'stale' ? '按新资料更新论文' : generation.status === 'completed' ? '重新生成论文' : '开始生成论文';
  $('btn-pause-generation').hidden = generation.status !== 'running';
  renderQuality();
}

function startGenerationClock() {
  clearInterval(generationClock);
  generationClock = setInterval(() => {
    if (project?.paper?.generation?.status !== 'running') return clearInterval(generationClock);
    const started = new Date(project.paper.generation.startedAt).getTime();
    $('generation-elapsed').textContent = formatTime(Math.floor((Date.now() - started) / 1000));
  }, 1000);
}

async function saveGenerationCheckpoint() {
  project.paper.generation.updatedAt = nowIso();
  await persistProject({ immediate: true });
  renderGeneration();
}

function chapterNeedsGeneration(chapter) {
  const saved = project.paper.chapters[chapter.id];
  return !saved?.content || saved.inputRevision !== project.factRevision || saved.status === 'stale';
}

async function generateOneChapter(chapter, signal) {
  const generation = project.paper.generation;
  generation.phase = 'chapters';
  generation.currentChapterId = chapter.id;
  generation.message = `正在生成第${chapter.id}章，完成后会立即保存`;
  generation.activeRequestLabel = `第${chapter.id}章 ${chapter.title}`;
  await saveGenerationCheckpoint();
  const reasoning = ['hardware', 'software', 'implementation'].includes(chapter.kind);
  const maxTokens = reasoning ? 16000 : 12000;
  const raw = await callAi(Prompts.buildChapterMessages({ project, chapter, outline: project.paper.outline, artifacts: project.paper.artifacts, completedDigest: completedDigest() }), { reasoning, maxTokens, signal, requestLabel: `第${chapter.id}章写作` });
  let content = normalizeChapterText(raw, chapter);
  try {
    content = await ensureChapterStructureAndArtifacts(chapter, content, signal);
  } catch (error) {
    if (signal.aborted) throw error;
    project.paper.quality.aiIssues = [
      ...(project.paper.quality.aiIssues || []),
      { id: makeId('chapter-quality-warning'), severity: 'warning', type: 'artifact-repair', chapterId: chapter.id, message: '第' + chapter.id + '章正文已返回，但图表补强暂未完成：' + (error.message || 'API请求失败'), source: 'system' },
    ];
    generation.message = '第' + chapter.id + '章正文已保存，图表补强稍后自动处理';
    await saveGenerationCheckpoint();
  }
  content = synchronizeArtifactPresentation(content, (project.paper.artifacts || []).filter(item => item.chapterId === chapter.id));
  if (countBodyChars(content) < 700) throw new Error(`第${chapter.id}章返回内容过短，未覆盖已保存内容`);
  project.paper.chapters[chapter.id] = {
    id: chapter.id,
    title: chapter.title,
    kind: chapter.kind,
    content,
    status: 'complete',
    inputRevision: project.factRevision,
    updatedAt: nowIso(),
  };
  if (chapter.kind === 'introduction') synchronizeReferenceOrder();
  generation.completedChapterIds = unique([...(generation.completedChapterIds || []), chapter.id]);
  generation.currentChapterId = '';
  generation.message = `第${chapter.id}章已保存`;
  await saveGenerationCheckpoint();
}

async function expandBodyIfNeeded(signal) {
  let passes = 0;
  const requiredBodyChars = desiredBodyChars();
  while (totalBodyChars() < requiredBodyChars && passes < 3) {
    passes += 1;
    const candidates = project.paper.outline.filter(chapter => ['hardware', 'software', 'implementation', 'test'].includes(chapter.kind));
    const target = candidates.sort((a, b) => countBodyChars(project.paper.chapters[a.id]?.content) - countBodyChars(project.paper.chapters[b.id]?.content))[0];
    if (!target) break;
    const saved = project.paper.chapters[target.id];
    const missing = requiredBodyChars - totalBodyChars();
    const generation = project.paper.generation;
    generation.phase = 'expand';
    generation.currentChapterId = target.id;
    generation.activeRequestLabel = `补充第${target.id}章有效分析`;
    generation.message = `正文距离${requiredBodyChars.toLocaleString('zh-CN')}字目标还差约${missing.toLocaleString('zh-CN')}字，正在补充必要设计分析`;
    await saveGenerationCheckpoint();
    const raw = await callAi([
      { role: 'system', content: '你是单片机本科论文补写编辑。只输出可直接追加到指定章节现有最后一个二级标题下的正文段落，不输出新标题、总结、图表或写作说明。必须补充新的设计依据、参数分析或实现细节，不得重复原文，不得改变确认的器件、引脚和功能。' },
      { role: 'user', content: JSON.stringify({ title: project.title, chapter: { id: target.id, title: target.title, kind: target.kind }, confirmedFacts: project.paper.factSheet, desiredAdditionalCharacters: Math.min(2600, Math.max(1200, missing)), existingChapter: saved.content }, null, 2) },
    ], { reasoning: false, maxTokens: 8000, signal, requestLabel: `第${target.id}章补写` });
    const addition = normalizeChapterText(raw, target);
    if (countBodyChars(addition) < 500) break;
    saved.content = synchronizeArtifactPresentation(`${saved.content.trim()}\n\n${addition.trim()}`, (project.paper.artifacts || []).filter(item => item.chapterId === target.id));
    saved.updatedAt = nowIso();
    await saveGenerationCheckpoint();
  }
  project.paper.generation.currentChapterId = '';
}

function abstractPolicyIssues(abstractCn = '', abstractEn = '') {
  const combined = `${abstractCn}\n${abstractEn}`;
  const issues = [];
  const models = unique((project.paper.factSheet.devices || []).map(device => device.model).filter(model => String(model).length >= 3));
  const escapedModels = models.map(model => String(model).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if ((escapedModels.length && new RegExp(escapedModels.join('|'), 'i').test(combined)) || /\b(?:STM32[A-Z0-9-]*|STC\d+[A-Z0-9-]*|AT89[A-Z0-9-]*|DHT\d+|DS18B20|ESP[-_]?0?1S?|ESP8266|HC[-_]?SR\d+|MQ[-_]?\d+|SG90)\b/i.test(combined)) issues.push('摘要出现具体器件或芯片型号');
  if (/\bP[A-H]\d{1,2}\b|\bGPIO[A-Z0-9_]*\b|\b(?:TIM|USART|I2C|SPI)\d+_[A-Z]+\b/i.test(combined)) issues.push('摘要出现具体引脚、外设实例或寄存器式信息');
  if (/\d+(?:\.\d+)?\s*(?:%|℃|°C|V|mV|A|mA|ms|s|秒|毫秒|次|小时|h|Hz|kHz|MHz|cm|mm|m)\b/i.test(combined)) issues.push('摘要出现带单位的具体测试或阈值数据');
  return issues;
}

function frontMatterPolicyIssues(result = {}) {
  const issues = abstractPolicyIssues(result.abstractCn, result.abstractEn);
  const abstractCn = String(result.abstractCn || '').trim();
  const abstractLength = abstractCn.replace(/\s+/g, '').length;
  const abstractParagraphs = abstractCn.split(/\n\s*\n/).map(item => item.trim()).filter(Boolean);
  if (abstractLength < 300 || abstractLength > 500) issues.push(`中文摘要应控制在300至500字，当前约${abstractLength}字`);
  if (abstractParagraphs.length < 2 || abstractParagraphs.length > 3) issues.push('中文摘要应分为2至3个自然段');
  const titleEn = String(result.titleEn || '').trim();
  const keywordsCn = String(result.keywords || '').split(/[；;]/).map(item => item.trim()).filter(Boolean);
  const keywordsEn = String(result.keywordsEn || '').split(/[;；]/).map(item => item.trim()).filter(Boolean);
  if (!/[A-Za-z]{3}/.test(titleEn) || /[\u3400-\u9fff]/.test(titleEn)) issues.push('英文论文题目缺失或含有中文');
  if (keywordsCn.length < 3 || keywordsCn.length > 5 || keywordsEn.length !== keywordsCn.length) issues.push('中英文关键词必须各3至5个且数量、顺序对应');
  return unique(issues);
}

async function generateExtras(signal) {
  const generation = project.paper.generation;
  generation.phase = 'extras';
  generation.activeRequestLabel = '生成英文题目与中英文摘要';
  generation.message = '正在依据完整正文生成英文题目、中英文摘要、关键词和致谢';
  await saveGenerationCheckpoint();
  const raw = await callAi(Prompts.buildExtrasMessages(project), { reasoning: false, maxTokens: 5500, jsonMode: true, signal, requestLabel: '英文题目与中英文摘要' });
  let result = await parseAiJson(raw, { signal, requestLabel: '摘要整理', maxTokens: 5500 });
  let policyIssues = frontMatterPolicyIssues(result);
  if (policyIssues.length) {
    generation.activeRequestLabel = '修正摘要表达';
    generation.message = '正在移除摘要中的具体型号和数据，保留全文概述';
    await saveGenerationCheckpoint();
    const repairedRaw = await callAi([
      { role: 'system', content: '你是本科论文摘要编辑。请保持英文题目、中英文摘要、中英文关键词和致谢字段完整，只修复列出的问题。英文题目准确对应中文题目。中文摘要严格控制在300至500字并分为2至3个自然段，只概述研究目的、总体方法、主要功能、验证方式和结论，不展开器件选型、接线、程序步骤或调试过程；英文摘要语义一致。禁止具体器件型号、芯片料号、引脚、寄存器、函数名、阈值和任何带单位的具体测试数据；使用“微控制器、传感器、显示模块、无线通信模块”等类别名称。中英文关键词各3至5个且含义、顺序对应。不要引用文献、图表或章节。致谢不出现人名、学校名、单位名和模板化开头。只返回与原结构一致的JSON。' },
      { role: 'user', content: JSON.stringify({ problems: policyIssues, existing: result }, null, 2) },
    ], { reasoning: false, maxTokens: 5500, jsonMode: true, signal, requestLabel: '摘要质量补强' });
    result = await parseAiJson(repairedRaw, { signal, requestLabel: '摘要质量补强', maxTokens: 5500 });
    policyIssues = frontMatterPolicyIssues(result);
  }
  project.paper.titleEn = String(result.titleEn || project.paper.titleEn || '').trim();
  project.paper.abstractCn = String(result.abstractCn || '').trim();
  project.paper.abstractEn = String(result.abstractEn || '').trim();
  project.paper.keywords = String(result.keywords || '').trim();
  project.paper.keywordsEn = String(result.keywordsEn || '').trim();
  project.paper.acknowledgment = String(result.acknowledgment || '').trim();
  project.paper.quality.abstractPolicyIssues = policyIssues;
  await saveGenerationCheckpoint();
}

function applyAuditRepairs(audit) {
  let repaired = 0;
  for (const issue of audit.issues || []) {
    if (!issue.repairable || !issue.chapterId || !issue.find || !issue.replace) continue;
    const chapter = project.paper.chapters[String(issue.chapterId)];
    if (!chapter?.content) continue;
    const occurrences = chapter.content.split(issue.find).length - 1;
    if (occurrences !== 1) continue;
    chapter.content = chapter.content.replace(issue.find, issue.replace);
    chapter.updatedAt = nowIso();
    issue.autoRepaired = true;
    repaired += 1;
  }
  return repaired;
}

async function runFinalAudit(signal, { allowRepairs = false, publishAsFinal = false } = {}) {
  const generation = project.paper.generation;
  generation.phase = 'audit';
  generation.activeRequestLabel = '技术一致性复核';
  generation.message = '只检查硬件矛盾、跨章重复、图表和测试问题，不再整章重写';
  await saveGenerationCheckpoint();
  try {
    const raw = await callAi(Prompts.buildAuditMessages(project), { reasoning: true, maxTokens: 9000, jsonMode: true, signal, requestLabel: '技术一致性复核' });
    const audit = await parseAiJson(raw, { signal, requestLabel: '技术一致性复核', maxTokens: 9000 });
    const issues = mergeFinalQualityIssues([], Array.isArray(audit.issues) ? audit.issues.slice(0, 16).map((item, index) => ({ id: `ai-audit-${index + 1}`, severity: item.severity === 'blocking' ? 'blocking' : 'warning', type: item.type || 'technical', chapterId: String(item.chapterId || ''), message: String(item.message || '').trim(), repairable: Boolean(item.repairable), find: String(item.find || ''), replace: String(item.replace || ''), source: 'ai' })).filter(item => item.message) : []);
    const repaired = allowRepairs ? applyAuditRepairs({ issues }) : 0;
    if (repaired) synchronizeAllArtifactPresentation();
    project.paper.quality.aiSummary = String(audit.summary || '').trim();
    project.paper.quality.aiIssues = issues.filter(issue => !issue.autoRepaired);
    project.paper.quality.autoRepaired = repaired;
    project.paper.quality.auditStage = publishAsFinal ? 'final' : 'pre-repair';
    project.paper.quality.aiCheckedAt = nowIso();
    generation.auditCompleted = true;
    await saveGenerationCheckpoint();
    return { issues, repaired, completed: true };
  } catch (error) {
    if (signal.aborted) throw error;
    project.paper.quality.aiIssues = publishAsFinal
      ? [{ id: makeId('issue'), severity: 'warning', type: 'audit', chapterId: '', message: `最终技术复检暂未完成：${error.message}`, source: 'system' }]
      : [];
    project.paper.quality.auditStage = publishAsFinal ? 'final-incomplete' : 'pre-repair-incomplete';
    generation.auditCompleted = false;
    await saveGenerationCheckpoint();
    return { issues: project.paper.quality.aiIssues, repaired: 0, completed: false };
  }
}

function tableRowGroups(text) {
  const groups = [];
  let current = [];
  String(text || '').split('\n').forEach(line => {
    if (/^\s*\|.*\|\s*$/.test(line)) current.push(line);
    else if (current.length) { groups.push(current); current = []; }
  });
  if (current.length) groups.push(current);
  return groups;
}

function longProseParagraphIssues(text, maximum = 380) {
  const clean = String(text || '')
    .replace(/```mermaid[\s\S]*?```/gi, '\n\n')
    .replace(/【非正文(?:·[^】]*)?】[\s\S]*?【非正文结束】/g, '\n\n');
  const issues = [];
  clean.split(/\n{2,}/).forEach(block => {
    const paragraph = block.trim();
    if (!paragraph || /^\d+(?:[.．]\d+){1,2}\s+[^\n]+$/.test(paragraph)) return;
    if (/^\s*\|.*\|\s*$/m.test(paragraph) || /^(?:图|表)\s*\d+/m.test(paragraph)) return;
    const length = paragraph.replace(/\s+/g, '').length;
    if (length > maximum) issues.push(`存在${length}字的连续长段，应按观点转换拆分且单段不超过${maximum}字`);
  });
  return unique(issues).slice(0, 4);
}

function localQualityIssues() {
  const issues = [];
  const outline = project.paper.outline || [];
  const chapters = project.paper.chapters || {};
  const bodyChars = totalBodyChars();
  const requiredBodyChars = desiredBodyChars();
  if (bodyChars < requiredBodyChars) issues.push({ id: 'body-length', severity: 'blocking', chapterId: '', message: `正文有效字数为${bodyChars.toLocaleString('zh-CN')}，少于设定目标${requiredBodyChars.toLocaleString('zh-CN')}字` });
  outline.forEach(chapter => {
    const saved = chapters[chapter.id];
    if (!saved?.content || saved.inputRevision !== project.factRevision) issues.push({ id: `missing-${chapter.id}`, severity: 'blocking', chapterId: chapter.id, message: `第${chapter.id}章尚未按当前资料生成完成` });
  });

  const seenParagraphs = new Map();
  Object.values(chapters).forEach(chapter => {
    const text = String(chapter.content || '');
    text.split(/\n{2,}/).map(paragraph => paragraph.replace(/\s+/g, '').replace(/^#{1,6}/, '')).filter(paragraph => paragraph.length >= 100 && !paragraph.startsWith('【')).forEach(paragraph => {
      const key = paragraph.slice(0, 180);
      if (seenParagraphs.has(key) && seenParagraphs.get(key) !== chapter.id) issues.push({ id: makeId('duplicate'), severity: 'blocking', chapterId: chapter.id, message: `第${chapter.id}章与第${seenParagraphs.get(key)}章存在重复段落` });
      else seenParagraphs.set(key, chapter.id);
    });
    if (/^(?:如图|由图|结合图).*?(?:所示|可知)[。.]?$/m.test(text)) issues.push({ id: `figure-line-${chapter.id}`, severity: 'warning', chapterId: chapter.id, message: `第${chapter.id}章存在单独成段的“如图所示”，应融入分析句` });
    if (/(?:尚未|未能|没有|并未)(?:完全)?(?:实现|完成|验证|测试)|功能未完成|系统未完成/.test(text)) issues.push({ id: `self-disclose-${chapter.id}`, severity: 'blocking', chapterId: chapter.id, message: `第${chapter.id}章出现系统未完成或未测试式表述` });
    internalDuplicateIssues(text).forEach((message, index) => issues.push({ id: `internal-duplicate-${chapter.id}-${index}`, severity: 'blocking', chapterId: chapter.id, message }));
    crossChapterDuplicateIssues(chapter.id, text).forEach((message, index) => issues.push({ id: `near-duplicate-${chapter.id}-${index}`, severity: 'blocking', chapterId: chapter.id, message }));
    duplicateHeadingIssues(text).forEach((message, index) => issues.push({ id: `duplicate-heading-${chapter.id}-${index}`, severity: 'blocking', chapterId: chapter.id, message }));
    consecutiveVisualIssues(text).forEach((message, index) => issues.push({ id: `visual-spacing-${chapter.id}-${index}`, severity: 'blocking', chapterId: chapter.id, message }));
    longProseParagraphIssues(text).forEach((message, index) => issues.push({ id: `paragraph-length-${chapter.id}-${index}`, severity: 'blocking', chapterId: chapter.id, message }));
    const missingHeadings = missingRequiredHeadings(chapter, text);
    if (missingHeadings.length) issues.push({ id: `headings-missing-${chapter.id}`, severity: 'blocking', chapterId: chapter.id, message: `第${chapter.id}章缺少目录标题：${missingHeadings.join('、')}` });
    if (/\S[ \t]*【非正文/.test(text) || /【非正文(?:·[^】]*)?】[ \t]*\S/.test(text)) issues.push({ id: `artifact-line-${chapter.id}`, severity: 'warning', chapterId: chapter.id, message: `第${chapter.id}章存在未单独成行的图表提示` });
    tableRowGroups(text).forEach((table, index) => {
      const columns = table[0]?.split('|').filter(Boolean).length || 0;
      if (columns > 5) issues.push({ id: `table-column-${chapter.id}-${index}`, severity: 'blocking', chapterId: chapter.id, message: `第${chapter.id}章有表格超过5列，必须按指标拆分` });
      if (table.length > 12) issues.push({ id: `table-row-${chapter.id}-${index}`, severity: 'blocking', chapterId: chapter.id, message: `第${chapter.id}章有表格超过10行数据，必须按功能或模块拆分` });
    });
  });
  duplicateVisualIssues().forEach((message, index) => issues.push({ id: `duplicate-visual-${index}`, severity: 'blocking', chapterId: message.match(/第(\d+)章/)?.[1] || '', message }));
  artifactCitationLedgerIssues().forEach(issue => issues.push(issue));

  (project.paper.artifacts || []).filter(item => item.type === 'flowchart').forEach(item => {
    const text = String(chapters[item.chapterId]?.content || '');
    const block = artifactInstructionBlock(text, item);
    mermaidFlowIssues(block, item.title).forEach((message, index) => issues.push({ id: `flow-${item.id}-${index}`, severity: 'blocking', chapterId: item.chapterId, message }));
  });
  (project.paper.artifacts || []).filter(item => item.type === 'timing').forEach(item => {
    const text = String(chapters[item.chapterId]?.content || '');
    const block = artifactInstructionBlock(text, item);
    mermaidTimingIssues(block, item.title).forEach((message, index) => issues.push({ id: `timing-${item.id}-${index}`, severity: 'blocking', chapterId: item.chapterId, message }));
  });
  (project.paper.artifacts || []).filter(item => ['device-image', 'result-image', 'circuit', 'system-framework', 'software-architecture', 'comparison-table', 'pin-table', 'test-table'].includes(item.type)).forEach(item => {
    const text = String(chapters[item.chapterId]?.content || '');
    const detail = artifactDetailIssues(text, [item]);
    if (detail.length) issues.push({ id: `artifact-detail-${item.id}`, severity: 'blocking', chapterId: item.chapterId, message: detail[0] });
  });
  (project.paper.artifacts || []).filter(item => item.type === 'formula').forEach(item => {
    const text = String(chapters[item.chapterId]?.content || '');
    if (!/[=＝]/.test(text) || !/(?:式中|其中).*(?:单位|表示)|变量|计算公式/s.test(text)) issues.push({ id: `formula-${item.id}`, severity: 'warning', chapterId: item.chapterId, message: `${item.title}缺少变量、单位或用途说明` });
  });
  (project.paper.artifacts || []).filter(item => item.type === 'system-framework').forEach(item => {
    const text = String(chapters[item.chapterId]?.content || '');
    if (!/系统总体.*(?:框架|结构)图|总体功能框架图/.test(text)) issues.push({ id: `framework-${item.id}`, severity: 'warning', chapterId: item.chapterId, message: '系统总体功能框架图尚未明确预留' });
  });
  const testChapter = outline.find(item => item.kind === 'test');
  if (testChapter) {
    const text = String(chapters[testChapter.id]?.content || '');
    if (!/^\s*\|.*\|\s*$/m.test(text)) issues.push({ id: 'test-table', severity: 'blocking', chapterId: testChapter.id, message: '测试章节缺少量化数据表格' });
    if (!/\d+(?:\.\d+)?\s*(?:s|ms|%|℃|V|mA|次|h|小时|秒|毫秒)/i.test(text)) issues.push({ id: 'test-data', severity: 'blocking', chapterId: testChapter.id, message: '测试章节缺少响应时间、误差、成功率或稳定性等量化数据' });
  }

  const hardwareChapter = outline.find(item => item.kind === 'hardware');
  if (hardwareChapter) {
    const text = String(chapters[hardwareChapter.id]?.content || '');
    if (/【非正文·Mermaid图：[^】]*(?:系统硬件组成|硬件总体结构|硬件框架)[^】]*】/.test(text)) issues.push({ id: 'hardware-duplicate-framework', severity: 'blocking', chapterId: hardwareChapter.id, message: '第三章不应重复生成硬件组成图或总体框架图，只保留第二章系统总体功能框架图' });
    if (/2\.8\s*寸\s*TFT/i.test(text)) issues.push({ id: 'hardware-tft-size', severity: 'blocking', chapterId: hardwareChapter.id, message: '硬件章节仍出现2.8寸TFT，应统一为1.8寸TFT' });
    const pullupValues = [
      ...[...text.matchAll(/上拉电阻[^。\n]{0,18}?(\d+(?:\.\d+)?)\s*k(?:Ω|欧姆)/gi)].map(match => Number(match[1])),
      ...[...text.matchAll(/(\d+(?:\.\d+)?)\s*k(?:Ω|欧姆)[^。\n]{0,18}?上拉电阻/gi)].map(match => Number(match[1])),
    ];
    if (pullupValues.some(value => value !== 10)) issues.push({ id: 'hardware-pullup', severity: 'blocking', chapterId: hardwareChapter.id, message: '上拉电阻阻值没有统一为10 kΩ' });
    if (!is51Controller(project.paper.factSheet.controller) && !/(?:5\s*V|5V).*(?:板载稳压|稳压).*(?:3\.3\s*V|3.3V)/s.test(text)) issues.push({ id: 'hardware-power-default', severity: 'blocking', chapterId: hardwareChapter.id, message: '硬件章节缺少开发板5V输入经板载稳压获得3.3V的供电说明' });
    if (/\|[^\n|]*信号方向[^\n|]*\|/.test(text)) issues.push({ id: 'pin-table-direction', severity: 'blocking', chapterId: hardwareChapter.id, message: '引脚关系表不应包含“信号方向”列' });
  }

  const intro = outline.find(item => item.kind === 'introduction');
  const introText = String(chapters[intro?.id]?.content || '');
  const expectedRefs = project.paper.referenceRecords?.length || 0;
  const citations = [...introText.matchAll(/\[(\d+)\]/g)].map(match => Number(match[1]));
  const nonIntroCitation = outline.filter(item => item.id !== intro?.id).some(item => /\[\d+\]/.test(chapters[item.id]?.content || ''));
  if (nonIntroCitation) issues.push({ id: 'citation-boundary', severity: 'blocking', chapterId: '', message: '参考文献引用出现在第一章以外的章节' });
  if (expectedRefs && citations.length !== expectedRefs) issues.push({ id: 'citation-count', severity: 'blocking', chapterId: intro?.id || '1', message: `第一章应依次引用${expectedRefs}篇文献，当前识别到${citations.length}处` });
  if (citations.some((number, index) => number !== index + 1) || new Set(citations).size !== citations.length) issues.push({ id: 'citation-order', severity: 'blocking', chapterId: intro?.id || '1', message: '正文引用编号没有按[1]、[2]顺序且每篇只引用一次' });
  if (/\[\d+\s*[-,，、]\s*\d+\]|\[\d+\]\s*\[\d+\]/.test(introText)) issues.push({ id: 'citation-group', severity: 'blocking', chapterId: intro?.id || '1', message: '存在一处同时引用多篇文献的情况' });
  if (typeof Rules.validateReferences === 'function') {
    try {
      const referenceResult = Rules.validateReferences({ references: project.paper.referenceRecords || [], chapters, requireAllSelected: true });
      const reliableReferenceCodes = new Set(['reference_publication_incomplete', 'citation_grouped', 'multiple_citations_in_sentence', 'citation_outside_ch1', 'citation_sequence', 'citation_repeated', 'citation_unknown', 'reference_unused', 'citation_author_mismatch', 'citation_title_mismatch', 'citation_token_unresolved', 'citation_token_unknown']);
      (referenceResult.errors || []).filter(item => reliableReferenceCodes.has(item.code)).forEach((item, index) => issues.push({ id: `reference-${item.code || index}`, severity: 'blocking', chapterId: item.chapter ? String(item.chapter) : '', message: item.message || String(item) }));
    } catch (error) {
      issues.push({ id: 'reference-validator', severity: 'warning', chapterId: '', message: '参考文献完整性检查暂未完成' });
    }
  }
  if (!project.paper.titleEn || !/[A-Za-z]{3}/.test(project.paper.titleEn) || /[\u3400-\u9fff]/.test(project.paper.titleEn)) issues.push({ id: 'english-title', severity: 'blocking', chapterId: '', message: '英文论文题目尚未正确生成' });
  if (!project.paper.abstractCn || !project.paper.abstractEn) issues.push({ id: 'abstract', severity: 'warning', chapterId: '', message: '中英文摘要尚未生成完成' });
  if (!project.paper.keywords || !project.paper.keywordsEn) issues.push({ id: 'keywords-bilingual', severity: 'blocking', chapterId: '', message: '中英文关键词尚未完整生成' });
  const keywordsCn = String(project.paper.keywords || '').split(/[；;]/).map(item => item.trim()).filter(Boolean);
  const keywordsEn = String(project.paper.keywordsEn || '').split(/[;；]/).map(item => item.trim()).filter(Boolean);
  if (keywordsCn.length && (keywordsCn.length < 3 || keywordsCn.length > 5 || keywordsEn.length !== keywordsCn.length)) issues.push({ id: 'keywords-pairing', severity: 'blocking', chapterId: '', message: '中英文关键词应各3至5个，并保持数量和顺序对应' });
  frontMatterPolicyIssues({
    titleEn: project.paper.titleEn,
    abstractCn: project.paper.abstractCn,
    abstractEn: project.paper.abstractEn,
    keywords: project.paper.keywords,
    keywordsEn: project.paper.keywordsEn,
  }).forEach((message, index) => issues.push({ id: `abstract-policy-${index}`, severity: 'blocking', chapterId: '', message }));
  if (/时光荏苒|光阴似箭|白驹过隙|感谢[^，。]{0,8}(?:老师|同学|家人)[^，。]{0,8}[A-Za-z\u4e00-\u9fa5]{2,4}(?:老师|同学)?/.test(project.paper.acknowledgment || '')) issues.push({ id: 'acknowledgment', severity: 'warning', chapterId: '', message: '致谢存在模板化开头或疑似人名' });
  return uniqueQualityIssues(issues);
}

function uniqueQualityIssues(issues) {
  const seen = new Set();
  return issues.filter(issue => {
    const key = `${issue.chapterId}|${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function runLocalQuality({ publish = true } = {}) {
  const local = localQualityIssues();
  const combined = mergeFinalQualityIssues(local, project.paper.quality.aiIssues || []);
  const result = { ...project.paper.quality, issues: combined, bodyChars: totalBodyChars() };
  if (publish) {
    project.paper.quality.engineVersion = QUALITY_ENGINE_VERSION;
    project.paper.quality.issues = combined;
    project.paper.quality.bodyChars = result.bodyChars;
    project.paper.quality.checkedAt = nowIso();
    project.paper.quality.resultStage = 'final';
  }
  return result;
}

function frontMatterSnapshot() {
  return {
    titleEn: project.paper.titleEn,
    abstractCn: project.paper.abstractCn,
    abstractEn: project.paper.abstractEn,
    keywords: project.paper.keywords,
    keywordsEn: project.paper.keywordsEn,
    acknowledgment: project.paper.acknowledgment,
  };
}

async function repairFrontMatterIssues(problems, signal) {
  const before = frontMatterSnapshot();
  const beforeCount = frontMatterPolicyIssues(before).length;
  const raw = await callAi([
    { role: 'system', content: '你是本科论文前置内容修复编辑。保持JSON字段完整。中文摘要严格300至500字并分2至3个自然段，只概述研究目的、总体方法、主要功能、验证方式和结论，不展开器件、接线、程序或调试细节；不得出现具体型号、引脚和带单位数据。英文摘要与中文摘要含义一致。英文题目准确，中英文关键词各3至5个且顺序对应。致谢不出现人名、学校名、单位名或模板化开头。只返回JSON。' },
    { role: 'user', content: JSON.stringify({ title: project.title, problems, existing: before }, null, 2) },
  ], { reasoning: false, maxTokens: 5200, jsonMode: true, signal, requestLabel: '自动修复摘要与关键词', timeoutMs: 100000 });
  const result = await parseAiJson(raw, { signal, requestLabel: '摘要与关键词修复', maxTokens: 5200 });
  const after = {
    titleEn: String(result.titleEn || '').trim(), abstractCn: String(result.abstractCn || '').trim(), abstractEn: String(result.abstractEn || '').trim(),
    keywords: String(result.keywords || '').trim(), keywordsEn: String(result.keywordsEn || '').trim(), acknowledgment: String(result.acknowledgment || '').trim(),
  };
  if (frontMatterPolicyIssues(after).length >= beforeCount) return false;
  Object.assign(project.paper, after);
  return true;
}

async function repairChapterBlockingIssues(chapter, problems, signal) {
  const saved = project.paper.chapters[chapter.id];
  if (!saved?.content) return false;
  const before = saved.content;
  const beforeCount = localQualityIssues().filter(issue => issue.severity === 'blocking' && issue.chapterId === chapter.id).length;
  const raw = await callAi([
    {
      role: 'system',
      content: `你是单片机本科论文重点问题修复编辑。只修复problems列出的重点问题，保持本章全部有效正文、目录标题顺序、确认器件、引脚和功能不变，输出修复后的完整本章正文，不输出章标题、解释或评价。

必须执行：删除重复和系统未完成式表述；修复与确认事实矛盾的硬件描述；正文每段只讲一个主要观点，通常120至300字，超过380字必须在观点转换处用空行拆段，禁止删减内容或逐句拆段；任意图/表之间补入不少于80字的实质分析段落；artifacts中的每张图按figureNumber在图前正文中恰好引用一次“如图x-x所示”，每张表按tableNumber在表前正文中恰好引用一次“如表x-x所示”，每个公式按formulaNumber在公式前正文中恰好引用一次“如式（x-x）所示”；器件图、电路图、实物图和功能图使用“【非正文·插图位置：图x-x 图名】”、下一行“【非正文结束】”和随后独占一行的同号题注；Mermaid图使用带图号图名的非正文标记，代码块结束后保留同号题注；框架图、结构图和流程图直接使用简洁Mermaid，流程图的开始和结束各一个且为圆角终止节点，主干自上而下、最多9个节点和2个判断节点；第三章不得生成硬件组成图或总体结构图；每张引脚表只对应一个器件并紧跟其电路说明，不得有“信号方向”列；表题严格使用“表x-x 表名”，测试必须有量化表格；公式必须独占一行并在行末写“（x-x）”，随后说明变量、单位和用途；超过5列或10行数据的表格必须按功能或模块拆分成多张表，并保持每张表前后有正文分析。除51单片机外主控按最小系统开发板描述，5V输入经板载稳压得到3.3V，所有模块共地，凡上拉电阻统一10 kΩ，TFT统一1.8寸。禁止新增标题、器件、引脚、功能或文献。`,
    },
    { role: 'user', content: JSON.stringify({ title: project.title, chapter: { id: chapter.id, title: chapter.title, kind: chapter.kind, requiredSections: chapter.sections }, responsibility: Prompts.chapterResponsibilities?.(chapter.kind) || '', problems, confirmedFacts: project.paper.factSheet, artifacts: (project.paper.artifacts || []).filter(item => item.chapterId === chapter.id), references: chapter.kind === 'introduction' ? project.paper.referenceRecords : [], existingChapter: before }, null, 2) },
  ], { reasoning: false, maxTokens: 16000, signal, requestLabel: `自动修复第${chapter.id}章重点问题`, timeoutMs: 150000 });
  const candidate = normalizeChapterText(raw, chapter);
  const normalizedCandidate = synchronizeArtifactPresentation(candidate, (project.paper.artifacts || []).filter(item => item.chapterId === chapter.id));
  if (countBodyChars(normalizedCandidate) < Math.max(700, Math.floor(countBodyChars(before) * 0.78))) return false;
  saved.content = normalizedCandidate;
  if (chapter.kind === 'introduction') synchronizeReferenceOrder();
  const afterCount = localQualityIssues().filter(issue => issue.severity === 'blocking' && issue.chapterId === chapter.id).length;
  if (afterCount > beforeCount) {
    saved.content = before;
    return false;
  }
  saved.updatedAt = nowIso();
  const changed = normalizedCandidate !== before;
  if (changed) {
    (project.paper.quality.aiIssues || []).forEach(issue => {
      if (String(issue.chapterId || '') === String(chapter.id)) issue.pendingFinalVerification = true;
    });
  }
  return changed;
}

async function autoRepairImportantQuality(signal, { maxPasses = 2 } = {}) {
  let changedAny = false;
  for (let pass = 0; pass < maxPasses; pass += 1) {
    const quality = runLocalQuality({ publish: false });
    const blockers = quality.issues.filter(issue => issue.severity === 'blocking');
    if (!blockers.length) break;
    const generation = project.paper.generation;
    generation.phase = 'quality';
    generation.activeRequestLabel = `自动修复重点问题（第${pass + 1}轮）`;
    generation.message = `检测到${blockers.length}项重点问题，正在自动修复并复检`;
    await saveGenerationCheckpoint();
    let changedThisPass = false;
    if (blockers.some(issue => issue.id === 'body-length')) {
      const beforeChars = totalBodyChars();
      await expandBodyIfNeeded(signal);
      changedThisPass ||= totalBodyChars() > beforeChars;
    }
    const frontProblems = blockers.filter(issue => !issue.chapterId && /摘要|关键词|英文论文题目|致谢/.test(issue.message));
    if (frontProblems.length) {
      const frontChanged = await repairFrontMatterIssues(frontProblems.map(item => item.message), signal);
      changedThisPass ||= frontChanged;
      if (frontChanged) {
        (project.paper.quality.aiIssues || []).forEach(issue => {
          if (!issue.chapterId && /摘要|关键词|英文论文题目|致谢/.test(issue.message || '')) issue.pendingFinalVerification = true;
        });
      }
    }
    const chapterIds = unique(blockers.map(issue => issue.chapterId).filter(Boolean));
    for (const chapterId of chapterIds) {
      const chapter = project.paper.outline.find(item => item.id === chapterId);
      if (!chapter) continue;
      const problems = blockers.filter(issue => issue.chapterId === chapterId).map(item => item.message);
      changedThisPass ||= await repairChapterBlockingIssues(chapter, problems, signal);
      await saveGenerationCheckpoint();
    }
    changedAny ||= changedThisPass;
    const remaining = runLocalQuality({ publish: false }).issues.filter(issue => issue.severity === 'blocking').length;
    if (!changedThisPass || remaining >= blockers.length) break;
  }
  return changedAny;
}

function renderQuality() {
  const panel = $('quality-panel');
  const quality = project?.paper?.quality;
  const issues = quality?.issues || [];
  panel.hidden = !quality?.checkedAt && !issues.length;
  if (panel.hidden) return;
  const blockers = issues.filter(item => item.severity === 'blocking').length;
  const warningCount = issues.length - blockers;
  $('quality-summary').textContent = issues.length
    ? `${quality.bodyChars?.toLocaleString('zh-CN') || 0}字 · 最终仍有${blockers ? `${blockers}项重点问题` : ''}${blockers && warningCount ? '和' : ''}${warningCount ? `${warningCount}项提醒` : ''}`
    : '论文最终检查通过';
  $('quality-issues').innerHTML = issues.length
    ? issues.map(issue => `<div class="quality-issue"><span class="issue-tag ${issue.severity === 'blocking' ? 'is-danger' : ''}">${issue.severity === 'blocking' ? '重点' : '提醒'}</span><span>${issue.chapterId ? `第${escapeHtml(issue.chapterId)}章：` : ''}${escapeHtml(issue.message)}</span></div>`).join('')
    : '<p class="quality-pass"><span aria-hidden="true">✓</span> 论文最终检查通过</p>';
}

async function generatePaper() {
  if (requestController) return toast('当前还有任务正在运行', 'info');
  if (!project.paper.factSheet.confirmedAt) {
    setPaperStep('pins', { scroll: true });
    return toast('请先确认器件和引脚', 'error');
  }
  const generation = project.paper.generation;
  const previousStatus = generation.status;
  if (generation.status === 'completed') {
    if (!confirm('重新生成会按当前资料重写全部章节，原稿仍会保留到新章节分别完成。确定继续吗？')) return;
    Object.values(project.paper.chapters).forEach(chapter => { if (chapter?.content) chapter.status = 'stale'; });
    project.paper.abstractCn = '';
    project.paper.abstractEn = '';
    project.paper.titleEn = '';
    project.paper.keywords = '';
    project.paper.keywordsEn = '';
    project.paper.acknowledgment = '';
  }
  requestController = new AbortController();
  requestTask = 'paper-generation';
  generation.status = 'running';
  generation.phase = 'planning';
  if (['idle', 'completed', 'stale'].includes(previousStatus) || !generation.startedAt) {
    generation.startedAt = nowIso();
    generation.completedChapterIds = [];
    generation.auditCompleted = false;
  }
  generation.updatedAt = nowIso();
  generation.completedAt = '';
  generation.lastError = '';
  generation.inputRevision = project.factRevision;
  generation.message = '正在根据目标字数、器件和功能规划论文结构';
  project.paper.quality = freshQuality();
  startGenerationClock();
  await saveGenerationCheckpoint();
  try {
    if (project.paper.materials.useReferencesInPaper !== false && !project.paper.materials.referencesText.trim()) {
      generation.phase = 'references';
      generation.activeRequestLabel = '自动匹配参考文献';
      generation.message = `正在从${REFERENCE_LIBRARY_META.count}篇文献中筛选与题目相关的参考文献`;
      await saveGenerationCheckpoint();
      await recommendReferences({ automatic: true, signal: requestController.signal });
    }
    prepareReferenceRecords();
    await planOutlineForPaper(requestController.signal);
    const artifactErrors = prepareGenerationArtifacts();
    if (artifactErrors.length) throw new Error(`论文图表要求建立失败：${artifactErrors[0]}`);
    generation.phase = 'chapters';
    generation.activeRequestLabel = '准备分章写作';
    generation.message = '论文结构和图表要求已建立，正在按规划篇幅逐章生成';
    await saveGenerationCheckpoint();
    for (const chapter of project.paper.outline) {
      if (requestController.signal.aborted) throw requestController.signal.reason || new DOMException('已暂停', 'AbortError');
      if (!chapterNeedsGeneration(chapter)) continue;
      await generateOneChapter(chapter, requestController.signal);
    }
    try {
      await expandBodyIfNeeded(requestController.signal);
    } catch (error) {
      if (requestController.signal.aborted) throw error;
      project.paper.quality.aiIssues = [
        ...(project.paper.quality.aiIssues || []),
        { id: makeId('body-expansion-warning'), severity: 'warning', type: 'body-length', chapterId: '', message: '正文补写请求未完成，已保留当前章节：' + (error.message || 'API请求失败'), source: 'system' },
      ];
      generation.message = '章节正文已保存，字数补写请求未完成，继续进行摘要和检查';
      await saveGenerationCheckpoint();
    }
    await generateExtras(requestController.signal);
    synchronizeReferenceOrder();
    synchronizeAllArtifactPresentation();
    await runFinalAudit(requestController.signal, { allowRepairs: true, publishAsFinal: false });
    synchronizeReferenceOrder();
    synchronizeAllArtifactPresentation();
    generation.phase = 'quality';
    generation.activeRequestLabel = '检查并自动修复重点问题';
    generation.message = '正在检查标题、图表间距、硬件事实、摘要、引用与字数';
    await saveGenerationCheckpoint();
    runLocalQuality({ publish: false });
    try {
      await autoRepairImportantQuality(requestController.signal);
    } catch (error) {
      if (requestController.signal.aborted) throw error;
      // 质量修复属于增强阶段。API在此阶段超时不能抹掉已保存的完整章节，保留问题清单供用户继续修复。
      project.paper.quality.aiIssues = [
        ...(project.paper.quality.aiIssues || []),
        { id: makeId('quality-warning'), severity: 'warning', type: 'quality-repair', chapterId: '', message: `自动修复阶段暂未完成：${error.message || 'API请求失败'}`, source: 'system' },
      ];
      generation.message = '正文已生成，质量修复请求未完成，已保留当前稿并可下载';
      await saveGenerationCheckpoint();
    }
    synchronizeReferenceOrder();
    synchronizeAllArtifactPresentation();
    await runFinalAudit(requestController.signal, { allowRepairs: false, publishAsFinal: true });
    const finalBlockingIssues = runLocalQuality({ publish: false }).issues.filter(item => item.severity === 'blocking');
    if (finalBlockingIssues.length) {
      try {
        generation.phase = 'quality';
        generation.activeRequestLabel = '修复终稿遗留问题';
        generation.message = `终稿复检仍有${finalBlockingIssues.length}项重点问题，正在进行最后一轮针对性修复`;
        await saveGenerationCheckpoint();
        const finalChanged = await autoRepairImportantQuality(requestController.signal, { maxPasses: 1 });
        if (finalChanged) {
          synchronizeReferenceOrder();
          synchronizeAllArtifactPresentation();
          await runFinalAudit(requestController.signal, { allowRepairs: false, publishAsFinal: true });
        }
      } catch (error) {
        if (requestController.signal.aborted) throw error;
        project.paper.quality.aiIssues = [
          ...(project.paper.quality.aiIssues || []),
          { id: makeId('final-repair-warning'), severity: 'warning', type: 'quality-repair', chapterId: '', message: `终稿遗留问题修复请求未完成：${error.message || 'API请求失败'}`, source: 'system' },
        ];
      }
    }
    synchronizeReferenceOrder();
    synchronizeAllArtifactPresentation();
    runLocalQuality();
    generation.status = 'completed';
    generation.phase = 'export';
    generation.percent = 100;
    generation.currentChapterId = '';
    generation.activeRequestLabel = '';
    generation.completedAt = nowIso();
    const blockers = project.paper.quality.issues.filter(item => item.severity === 'blocking').length;
    generation.message = blockers ? `论文已生成并自动修复，仍有${blockers}项需要根据实物确认` : project.paper.quality.issues.length ? `论文已生成并自动修复，另有${project.paper.quality.issues.length}项普通提醒` : '论文最终检查通过';
    generation.lastError = '';
    await saveGenerationCheckpoint();
    toast('论文已生成，正在准备DOCX', 'success');
    await exportPaper({ automatic: true });
  } catch (error) {
    const paused = error?.name === 'AbortError';
    generation.status = paused ? 'paused' : 'failed';
    const phaseLabel = generation.activeRequestLabel || ({ references: '参考文献匹配', planning: '结构规划', chapters: `第${generation.currentChapterId || ''}章写作`, expand: '正文补写', extras: '摘要与前置内容', audit: '技术复核', quality: '质量修复' }[generation.phase] || '论文生成');
    generation.message = paused ? '已暂停，完成的章节均已保存' : `${phaseLabel}中断，已保存已完成章节，可以继续生成或下载当前稿`;
    generation.lastError = paused ? '' : `${phaseLabel}：${error.message || '论文生成失败'}`;
    generation.activeRequestLabel = '';
    generation.updatedAt = nowIso();
    await persistProject({ immediate: true });
    toast(paused ? '论文生成已暂停' : generation.lastError, paused ? 'info' : 'error');
  } finally {
    clearInterval(generationClock);
    requestController = null;
    requestTask = '';
    renderGeneration();
  }
}

function pauseGeneration() {
  if (requestTask !== 'paper-generation' || !requestController) return;
  project.paper.generation.message = '正在停止当前请求，已完成章节不会丢失';
  renderGeneration();
  requestController.abort(new DOMException('用户暂停生成', 'AbortError'));
}

async function exportPaper(options = {}) {
  const hasContent = Object.values(project?.paper?.chapters || {}).some(chapter => String(chapter?.content || '').trim());
  if (!hasContent) {
    if (!options.automatic) toast('当前还没有已保存的论文正文', 'error');
    return false;
  }
  try {
    if (!globalThis.PaperDocx?.buildPaperDocx) throw new Error('DOCX组件尚未加载，请刷新页面后重试');
    prepareReferenceRecords();
    synchronizeReferenceOrder();
    const completed = project.paper.outline.filter(chapter => project.paper.chapters[chapter.id]?.content).length;
    const chapters = project.paper.outline.map(chapter => {
      const saved = project.paper.chapters[chapter.id];
      return { id: chapter.id, title: chapter.title, content: saved?.content || '【当前稿说明：本章尚未生成】' };
    });
    const complete = completed === project.paper.outline.length;
    const blob = await globalThis.PaperDocx.buildPaperDocx({
      title: project.title,
      titleEn: project.paper.titleEn,
      abstractCn: project.paper.abstractCn,
      abstractEn: project.paper.abstractEn,
      keywords: project.paper.keywords,
      keywordsEn: project.paper.keywordsEn,
      acknowledgment: project.paper.acknowledgment,
      chapters,
      references: project.paper.referenceRecords,
    });
    const suffix = complete ? '完整论文' : `论文当前稿_已完成${completed}章`;
    downloadBlob(blob, `${safeFilename(project.title)}_${suffix}.docx`);
    if (!options.automatic) toast('DOCX已下载，可在WPS中继续编辑', 'success');
    return true;
  } catch (error) {
    toast(error.message || '论文文档生成失败', 'error');
    return false;
  }
}

function navigatePaperStep(step) {
  if (step === 'pins' && !project.paper.factSheet.analyzedAt) {
    setPaperStep('materials', { scroll: true });
    return toast('填写题目后先分析器件与引脚', 'info');
  }
  if (step === 'generate' && !project.paper.factSheet.confirmedAt) {
    setPaperStep('pins', { scroll: true });
    return toast('请先处理并确认器件与引脚', 'info');
  }
  setPaperStep(step, { scroll: true });
}

function bindEvents() {
  document.addEventListener('click', async event => {
    const routeButton = event.target.closest('[data-route]');
    if (routeButton) { setRoute(routeButton.dataset.route); return; }
    const newButton = event.target.closest('[data-action="new-project"], #btn-new-project');
    if (newButton) { openNewProjectDialog('paper'); return; }
    const projectAction = event.target.closest('[data-project-action]');
    if (projectAction) { await handleProjectAction(projectAction); return; }
    const schemeButton = event.target.closest('[data-scheme-step]');
    if (schemeButton) { setSchemeStep(schemeButton.dataset.schemeStep); return; }
    const paperButton = event.target.closest('[data-paper-step]');
    if (paperButton) { navigatePaperStep(paperButton.dataset.paperStep); return; }
    const closeButton = event.target.closest('[data-close-dialog]');
    if (closeButton) { closeButton.closest('dialog')?.close(); }
  });

  $('active-project-select').addEventListener('change', event => activateProject(event.target.value));
  $('project-import-file').addEventListener('change', importProject);
  $('new-project-form').addEventListener('submit', createProjectFromDialog);
  $('api-connection-status').addEventListener('click', openSettings);
  $('settings-form').addEventListener('submit', submitApiSettings);
  $('btn-test-api').addEventListener('click', testApiConnection);
  $('btn-toggle-api-key').addEventListener('click', () => {
    const input = $('api-key');
    const visible = input.type === 'text';
    input.type = visible ? 'password' : 'text';
    $('btn-toggle-api-key').textContent = visible ? '显示' : '隐藏';
    $('btn-toggle-api-key').setAttribute('aria-label', visible ? '显示API Key' : '隐藏API Key');
  });
  $('api-provider').addEventListener('change', applyProviderPreset);

  $('scheme-form').addEventListener('submit', generateScheme);
  $('scheme-form').addEventListener('input', captureScheme);
  qsa('[data-multi-select]').forEach(details => details.addEventListener('change', () => { renderMultiSelectSummary(details); captureScheme(); }));
  qsa('input[name="scheme-count-mode"]').forEach(input => input.addEventListener('change', () => { $('scheme-count-wrap').hidden = input.value !== 'custom' || !input.checked; captureScheme(); }));
  $('btn-regenerate-scheme').addEventListener('click', generateScheme);
  $('btn-copy-scheme').addEventListener('click', copyScheme);
  $('btn-download-scheme').addEventListener('click', downloadScheme);

  $('paper-materials-form').addEventListener('submit', analyzeHardware);
  $('paper-scheme-source').addEventListener('change', event => { $('btn-import-scheme').disabled = !event.target.value; });
  $('btn-import-scheme').addEventListener('click', importSelectedScheme);
  $('paper-scheme-text').addEventListener('input', captureSchemeSourceText);
  $('paper-scheme-file').addEventListener('change', readSchemeSourceFile);
  $('paper-outline-file').addEventListener('change', readOutlineReferenceFile);
  $('btn-analyze-scheme-source').addEventListener('click', analyzeImportedScheme);
  $('paper-materials-form').addEventListener('input', event => {
    if (['paper-code-folder', 'paper-source-file', 'paper-scheme-source', 'paper-scheme-file', 'paper-outline-file', 'paper-scheme-text'].includes(event.target.id)) return;
    capturePaperMaterials({ invalidate: true });
    if (['paper-references', 'paper-use-references', 'paper-reference-count'].includes(event.target.id)) renderReferenceTool();
  });
  $('btn-recommend-references').addEventListener('click', () => recommendReferences());
  $('btn-apply-reference-recommendations').addEventListener('click', applyReferenceRecommendations);
  $('btn-clear-reference-recommendations').addEventListener('click', () => { $('reference-recommendations').hidden = true; });
  $('reference-result-list').addEventListener('change', updateReferenceSelectedCount);
  $('standalone-reference-form').addEventListener('submit', recommendStandaloneReferences);
  ['standalone-reference-title', 'standalone-reference-notes', 'standalone-reference-count'].forEach(id => $(id).addEventListener('input', event => {
    if (id === 'standalone-reference-title') standaloneReferenceState.title = event.target.value;
    if (id === 'standalone-reference-notes') standaloneReferenceState.notes = event.target.value;
    if (id === 'standalone-reference-count') standaloneReferenceState.count = clampReferenceCount(event.target.value);
    saveStandaloneReferenceState();
  }));
  $('standalone-reference-list').addEventListener('change', () => updateStandaloneReferenceSelection());
  $('btn-standalone-select-all').addEventListener('click', () => {
    qsa('#standalone-reference-list input[type="checkbox"]').forEach(input => { input.checked = true; });
    updateStandaloneReferenceSelection();
  });
  $('btn-standalone-clear-selection').addEventListener('click', () => {
    qsa('#standalone-reference-list input[type="checkbox"]').forEach(input => { input.checked = false; });
    updateStandaloneReferenceSelection();
  });
  $('btn-standalone-clear-results').addEventListener('click', clearStandaloneReferenceResults);
  $('btn-copy-standalone-references').addEventListener('click', copyStandaloneReferences);
  $('paper-code-folder').addEventListener('change', readCodeFiles);
  $('code-file-list').addEventListener('click', event => {
    const button = event.target.closest('[data-remove-code-file]');
    if (button) removeCodeFile(button.dataset.removeCodeFile);
  });
  $('paper-source-file').addEventListener('change', readSourceDocumentFile);
  $('btn-clear-source-file').addEventListener('click', clearSourceDocument);
  $('paper-schematic-file').addEventListener('change', readSchematicFile);
  $('btn-reanalyze-pins').addEventListener('click', analyzeHardware);
  $('pin-mapping-body').addEventListener('change', event => { if (event.target.matches('[data-mapping-pin]')) updateMappingPin(event.target); });
  $('pin-mapping-body').addEventListener('click', event => { const button = event.target.closest('[data-delete-mapping]'); if (button) deleteMapping(button); });
  $('pin-conflict-summary').addEventListener('change', event => {
    if (event.target.id !== 'ack-ai-conflicts') return;
    project.paper.factSheet.conflictsAcknowledged = event.target.checked;
    persistProject();
  });
  $('btn-add-mapping').addEventListener('click', openMappingDialog);
  $('mapping-form').addEventListener('submit', addMapping);
  $('btn-confirm-pins').addEventListener('click', confirmPins);
  $('btn-start-generation').addEventListener('click', generatePaper);
  $('btn-pause-generation').addEventListener('click', pauseGeneration);
  $('btn-download-draft').addEventListener('click', () => exportPaper());
  $('btn-download-draft-top').addEventListener('click', () => exportPaper());

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && project) persistProject({ immediate: true });
    if (document.visibilityState === 'visible' && motivationRefreshDue()) void refreshDailyMotivation({ force: true });
  });
  window.addEventListener('focus', () => { if (motivationRefreshDue()) void refreshDailyMotivation({ force: true }); });
  window.addEventListener('hashchange', () => {
    const route = location.hash.replace('#', '');
    if (['projects', 'scheme', 'paper', 'tools'].includes(route)) setRoute(route);
  });
}

init();
