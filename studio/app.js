import * as Rules from './rules.js?v=20260823-7';

const PAGE_CONFIG = globalThis.MCU_PAGE_CONFIG || {};
const DEEPSEEK_API_URL = String(PAGE_CONFIG.apiUrl || 'https://api.deepseek.com/chat/completions');
const DEEPSEEK_API_KEY = String(PAGE_CONFIG.apiKey || '').trim();
const DEEPSEEK_CHAT_MODEL = String(PAGE_CONFIG.chatModel || 'deepseek-v4-pro');
const DEEPSEEK_REASONING_MODEL = String(PAGE_CONFIG.reasoningModel || DEEPSEEK_CHAT_MODEL);

const STORAGE_KEY = 'mcu-paper-studio.project.v1';
const STORAGE_BACKUP_KEY = 'mcu-paper-studio.project.backup.v1';
const CHAPTER_WEIGHTS = { 1: 0.14, 2: 0.16, 3: 0.24, 4: 0.26, 5: 0.16, 6: 0.04 };
const CHAPTER_TITLES = {
  1: '绪论',
  2: '系统总体方案设计',
  3: '系统硬件设计',
  4: '系统软件设计',
  5: '系统调试与功能测试',
  6: '总结与展望',
};

let project = loadProject();
let currentView = 'home';
let schemeStep = 1;
let paperStep = Math.max(1, Math.min(4, Number(project.paper?.stage) || 1));
let activeChapter = String(project.paper?.activeChapter || '1');
let requestController = null;
let requestTask = '';
let saveTimer = null;
let busyHeartbeatTimer = null;
let busyOpenedAt = 0;
let busyLastProgressAt = 0;
let busyBaseDetail = '';
let busyRequestAttempt = 0;
let busyRequestAttemptMax = 0;
let busyRequestTimeoutMs = 0;

const $ = id => document.getElementById(id);
const qs = (selector, root = document) => root.querySelector(selector);
const qsa = (selector, root = document) => [...root.querySelectorAll(selector)];

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix = 'item') {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function schemeInputSignatureFor(value) {
  return JSON.stringify({
    title: value?.title || '',
    background: value?.background || '',
    requirements: value?.requirements || '',
    level: value?.level || 'B',
    sourceMode: value?.sourceMode || 'create',
    sourceText: value?.sourceText || '',
    preferences: value?.preferences || {},
  });
}

function currentSchemeInputSignature() {
  return schemeInputSignatureFor(project);
}

function freshPaperGeneration(message = '确认目录后即可一键生成论文') {
  return {
    status: 'idle',
    phase: 'idle',
    failedPhase: '',
    runId: '',
    inputRevision: '',
    currentChapterId: '',
    semanticBatchId: '',
    completedChapterIds: [],
    semanticBatches: {},
    attempts: {},
    compactMode: false,
    percent: 0,
    message,
    lastError: '',
    startedAt: '',
    updatedAt: '',
    requestAttempt: 0,
    requestAttemptMax: 0,
    requestStartedAt: '',
    requestTimeoutSeconds: 0,
    lastSavedAt: '',
    pauseRequestedAt: '',
    completedAt: '',
    downloadReady: false,
    outputVersion: '',
    downloadedAt: '',
    manualQualityRequired: false,
    manualQualityType: '',
    manualQualityMessage: '',
  };
}

function emptyProject() {
  const now = nowIso();
  return {
    schemaVersion: 3,
    id: makeId('project'),
    revision: `facts-${Date.now()}`,
    createdAt: now,
    updatedAt: now,
    title: '',
    background: '',
    requirements: '',
    level: 'B',
    sourceMode: 'create',
    sourceText: '',
    preferences: { mcu: '', display: '', power: '' },
    scheme: {
      status: 'empty',
      markdown: '',
      structured: null,
      devices: [],
      functions: [],
      deviceRecords: [],
      functionRecords: [],
      closures: [],
      relationsStage: 'not-started',
      conflicts: [],
      warnings: [],
      aiReview: {
        status: 'not-run',
        verdict: '',
        summary: '',
        changes: [],
        reviewedAt: '',
      },
      confirmedAt: '',
      inputRevision: '',
      inputSignature: '',
    },
    materials: {
      devicesText: '',
      functionsText: '',
      connectionText: '',
      codeText: '',
      referencesText: '',
      schoolOutline: '',
      testInfo: '',
      tools: '',
      photoNotes: '',
      sourceNotes: '',
      filenames: [],
    },
    audit: {
      status: 'not-run',
      issues: [],
      summary: '',
      factSheet: {
        recommendedDevices: [],
        coreDevices: [],
        recommendedFunctions: [],
        coreFunctions: [],
        fixedFacts: [],
      },
      confirmationSignature: '',
      confirmedAt: '',
      inputRevision: '',
    },
    outline: {
      text: '',
      confirmedAt: '',
      inputRevision: '',
    },
    paper: {
      stage: 1,
      sourceMode: 'independent',
      sourceSchemeRevision: '',
      targetChars: 20000,
      activeChapter: '1',
      chapters: {},
      abstractCn: '',
      abstractEn: '',
      keywords: '',
      acknowledgment: '',
      referenceOrder: [],
      semanticIssues: [],
      semanticCheckedAt: '',
      quality: null,
      status: 'planning',
      generation: freshPaperGeneration(),
    },
    consents: {
      schemeAiReviewDisclosure: false,
      paperFactAuditDisclosure: false,
    },
  };
}

function normalizeProject(value) {
  const base = emptyProject();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return base;
  const normalized = {
    ...base,
    ...value,
    schemaVersion: 3,
    preferences: { ...base.preferences, ...(value.preferences || {}) },
    scheme: normalizeSchemeRelations({ ...base.scheme, ...(value.scheme || {}) }),
    materials: { ...base.materials, ...(value.materials || {}) },
    audit: {
      ...base.audit,
      ...(value.audit || {}),
      factSheet: { ...base.audit.factSheet, ...(value.audit?.factSheet || {}) },
    },
    outline: { ...base.outline, ...(value.outline || {}) },
    consents: { ...base.consents, ...(value.consents || {}) },
    paper: {
      ...base.paper,
      ...(value.paper || {}),
      chapters: { ...(value.paper?.chapters || {}) },
      generation: { ...base.paper.generation, ...(value.paper?.generation || {}) },
    },
  };
  normalized.paper.stage = Math.max(1, Math.min(4, Number(normalized.paper.stage) || 1));
  normalized.paper.referenceOrder = Array.isArray(normalized.paper.referenceOrder) ? normalized.paper.referenceOrder.filter(Boolean) : [];
  normalized.paper.semanticIssues = Array.isArray(normalized.paper.semanticIssues) ? normalized.paper.semanticIssues : [];
  normalized.paper.generation.completedChapterIds = Array.isArray(normalized.paper.generation.completedChapterIds)
    ? normalized.paper.generation.completedChapterIds.map(String).filter(id => /^[1-6]$/.test(id))
    : [];
  normalized.paper.generation.semanticBatches = normalized.paper.generation.semanticBatches
    && typeof normalized.paper.generation.semanticBatches === 'object'
    && !Array.isArray(normalized.paper.generation.semanticBatches)
    ? normalized.paper.generation.semanticBatches
    : {};
  normalized.paper.generation.attempts = normalized.paper.generation.attempts
    && typeof normalized.paper.generation.attempts === 'object'
    && !Array.isArray(normalized.paper.generation.attempts)
    ? normalized.paper.generation.attempts
    : {};
  ['recommendedDevices', 'coreDevices', 'recommendedFunctions', 'coreFunctions', 'fixedFacts'].forEach(key => {
    normalized.audit.factSheet[key] = unique((Array.isArray(normalized.audit.factSheet[key]) ? normalized.audit.factSheet[key] : [])
      .map(item => typeof item === 'string' ? item.trim() : String(item?.name || item?.label || item?.value || '').trim())
      .filter(Boolean));
  });
  if (normalized.paper.generation.status === 'running') {
    normalized.paper.generation.status = 'paused';
    normalized.paper.generation.failedPhase = normalized.paper.generation.failedPhase || normalized.paper.generation.phase || 'chapters';
    normalized.paper.generation.message = '上次生成被中断，可从未完成章节继续';
    normalized.paper.generation.pauseRequestedAt = '';
    normalized.paper.generation.requestAttempt = 0;
    normalized.paper.generation.requestAttemptMax = 0;
    normalized.paper.generation.requestStartedAt = '';
    normalized.paper.generation.requestTimeoutSeconds = 0;
  }
  Object.values(normalized.paper.chapters).forEach(chapter => {
    if (chapter?.status === 'generating') chapter.status = chapter.content ? 'draft' : 'planned';
  });
  if (Object.values(normalized.paper.chapters).filter(chapter => chapter?.content).length >= 6
    && !normalized.paper.semanticCheckedAt
    && ['completed', 'paused', 'failed'].includes(normalized.paper.generation.status)
    && normalized.paper.generation.phase !== 'chapters') {
    normalized.paper.generation.status = 'paused';
    normalized.paper.generation.phase = 'semantic';
    normalized.paper.generation.failedPhase = 'semantic';
    normalized.paper.generation.downloadReady = false;
    normalized.paper.generation.message = '需要按新版规则复核重复、硬件一致性和参考文献';
    normalized.paper.quality = null;
    normalized.paper.abstractCn = '';
    normalized.paper.abstractEn = '';
    normalized.paper.keywords = '';
    normalized.paper.acknowledgment = '';
  }
  normalized.scheme.markdown = normalizeKnownText(normalized.scheme.markdown || '');
  if (normalized.scheme.markdown && ['mapping-review-required', 'reviewed'].includes(normalized.scheme.status)) {
    normalized.scheme.status = 'generated';
  }
  const preservePaperRelations = value.scheme?.relationsStage === 'paper'
    || (normalized.scheme.closures.length > 0 && ['reviewing', 'confirmed'].includes(normalized.audit.status));
  normalized.scheme.relationsStage = preservePaperRelations ? 'paper' : 'not-started';
  if (!preservePaperRelations) normalized.scheme.closures = [];
  if (normalized.scheme.markdown && !normalized.scheme.inputSignature) {
    normalized.scheme.inputSignature = schemeInputSignatureFor(normalized);
  }
  if (!normalized.materials.devicesText && normalized.paper.sourceMode === 'scheme') {
    normalized.materials.devicesText = normalized.scheme.devices.join('\n');
  }
  if (!normalized.materials.functionsText && normalized.paper.sourceMode === 'scheme') {
    normalized.materials.functionsText = normalized.scheme.functions.join('\n');
  }
  return normalized;
}

function loadProject() {
  try {
    return normalizeProject(JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'));
  } catch (error) {
    return emptyProject();
  }
}

function saveProject({ immediate = false } = {}) {
  project.updatedAt = nowIso();
  const write = () => {
    try {
      if (project.paper?.generation?.status === 'running') project.paper.generation.lastSavedAt = nowIso();
      localStorage.setItem(STORAGE_BACKUP_KEY, localStorage.getItem(STORAGE_KEY) || '');
      localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
      setSaveStatus('已自动保存');
    } catch (error) {
      setSaveStatus('保存失败，请导出备份', true);
    }
  };
  clearTimeout(saveTimer);
  if (immediate) write();
  else {
    setSaveStatus('正在保存…');
    saveTimer = setTimeout(write, 350);
  }
}

function setSaveStatus(text, danger = false) {
  const node = $('save-status') || $('global-save-state');
  if (!node) return;
  node.textContent = text;
  node.classList.toggle('is-danger', danger);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function lines(value) {
  return String(value || '')
    .split(/\r?\n|[；;]+/)
    .map(item => item.replace(/^\s*(?:[-*+]\s+|\d+、\s*|\d+\.(?!\d)\s*)/, '').trim())
    .filter(Boolean);
}

function unique(values) {
  const seen = new Set();
  return values.filter(value => {
    const key = String(value).toLowerCase().replace(/\s+/g, '');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeKnownText(value) {
  return String(value ?? '').replace(
    /(^|[^\d.．])96\s*(?:英寸|寸)\s*(?:的\s*)?(OLED|有机发光二极管显示(?:屏|器)?|显示(?:屏|器)?)/gi,
    (_, prefix, display) => `${prefix}0.96寸${display}`,
  );
}

function normalizeKnownValues(value) {
  if (typeof value === 'string') return normalizeKnownText(value);
  if (Array.isArray(value)) return value.map(normalizeKnownValues);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeKnownValues(item)]));
  }
  return value;
}

function stripInternalSchemeLevelText(value) {
  if (typeof value === 'string') {
    return value
      .replace(/(?:本|该)?方案(?:整体|设计)?(?:的)?(?:功能数量和系统复杂度)?(?:符合|达到|按照|满足|定位为|属于)\s*[ABCＡＢＣ]\s*级(?:方案|项目|难度|要求|标准|设计)?(?:的)?(?:要求|标准)?[，,。；;]?/gi, '')
      .replace(/(?:本|该)?(?:方案|项目)(?:设计)?(?:为|按|按照|定位为)\s*[ABCＡＢＣ]\s*级(?:方案|项目|难度|要求|标准|设计)?[，,。；;]?/gi, '')
      .replace(/(?:根据|依据)\s*[ABCＡＢＣ]\s*级(?:方案|项目|难度|要求|标准|设计)?(?:的)?(?:要求|标准)?[，,。；;]?/gi, '')
      .replace(/(?:符合|达到|按照|满足|定位为|属于)\s*[ABCＡＢＣ]\s*级(?:方案|项目|难度|要求|标准|设计)?(?:的)?(?:要求|标准)?[，,。；;]?/gi, '')
      .replace(/[ABCＡＢＣ]\s*级方案(?:要求|标准|设计)?[，,。；;]?/gi, '')
      .replace(/[^\S\r\n]{2,}/g, ' ')
      .replace(/^[，,。；;\s]+|[，,；;\s]+$/g, '')
      .trim();
  }
  if (Array.isArray(value)) return value.map(stripInternalSchemeLevelText);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === 'level' ? item : stripInternalSchemeLevelText(item)]));
  }
  return value;
}

function identityKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[（(][^）)]*[）)]\s*$/, '')
    .replace(/[\s\-_/·，,。；;：:（）()]+/g, '');
}

function stableId(prefix, value) {
  const source = identityKey(value) || String(value || prefix);
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}-${(hash >>> 0).toString(36)}`;
}

function parseDeviceValue(value) {
  if (typeof value === 'string') {
    const text = normalizeKnownText(value).trim();
    const match = text.match(/^(.+?)[（(]([^）)]+)[）)]$/);
    const model = (match?.[1] || text).trim();
    const role = (match?.[2] || '').trim();
    return { model, role, label: role ? `${model}（${role}）` : model, source: 'user' };
  }
  const item = value && typeof value === 'object' ? value : {};
  const model = normalizeKnownText(item.model || item.name || item.label || '').trim();
  const role = normalizeKnownText(item.role || '').trim();
  const label = normalizeKnownText(item.label || (role ? `${model}（${role}）` : model)).trim();
  return {
    ...item,
    model: model || label,
    role,
    label,
    source: item.source || 'user',
    sourceRef: String(item.sourceRef || item.ref || '').trim(),
  };
}

function parseFunctionValue(value) {
  if (typeof value === 'string') return { name: normalizeKnownText(value).trim(), source: 'user', suggestedDeviceRefs: [] };
  const item = value && typeof value === 'object' ? value : {};
  const name = normalizeKnownText(item.name || item.text || '').trim();
  return {
    ...item,
    name,
    text: name,
    processDescription: normalizeKnownText(item.processDescription || '').trim(),
    verificationMethod: normalizeKnownText(item.verificationMethod || '').trim(),
    source: item.source || 'user',
    sourceRef: String(item.sourceRef || item.ref || '').trim(),
    suggestedDeviceRefs: Array.isArray(item.suggestedDeviceRefs)
      ? item.suggestedDeviceRefs.map(String)
      : Array.isArray(item.deviceRefs) ? item.deviceRefs.map(String) : [],
  };
}

function reconcileEntityRecords(values, existing, kind) {
  const parser = kind === 'device' ? parseDeviceValue : parseFunctionValue;
  const labelOf = record => kind === 'device' ? record.label : record.name;
  const prefix = kind === 'device' ? 'device' : 'function';
  const prepared = (Array.isArray(values) ? values : []).map(parser).filter(record => labelOf(record));
  const old = (Array.isArray(existing) ? existing : []).map(parser).filter(record => labelOf(record));
  const assigned = new Array(prepared.length).fill(null);
  const usedOld = new Set();

  prepared.forEach((record, index) => {
    const matchIndex = old.findIndex((candidate, candidateIndex) => !usedOld.has(candidateIndex) && identityKey(labelOf(candidate)) === identityKey(labelOf(record)));
    if (matchIndex < 0) return;
    usedOld.add(matchIndex);
    assigned[index] = { ...old[matchIndex], ...record, id: old[matchIndex].id || stableId(prefix, labelOf(record)) };
  });

  const unmatchedNew = prepared.map((_, index) => index).filter(index => !assigned[index]);
  const unmatchedOld = old.map((_, index) => index).filter(index => !usedOld.has(index));
  if (unmatchedNew.length === 1 && unmatchedOld.length === 1) {
    const newIndex = unmatchedNew[0];
    const oldRecord = old[unmatchedOld[0]];
    assigned[newIndex] = { ...oldRecord, ...prepared[newIndex], id: oldRecord.id || stableId(prefix, labelOf(prepared[newIndex])) };
  }

  const usedIds = new Set(assigned.filter(Boolean).map(record => record.id));
  return assigned.map((record, index) => {
    if (record) return record;
    const item = prepared[index];
    const requested = String(item.id || '').trim();
    let id = requested && !/^(?:device|function)-\d+$/.test(requested) ? requested : stableId(prefix, labelOf(item));
    let suffix = 2;
    while (usedIds.has(id)) id = `${stableId(prefix, labelOf(item))}-${suffix++}`;
    usedIds.add(id);
    return { ...item, id };
  });
}

function classifyRelationStage(device) {
  const value = `${device.model || ''} ${device.role || ''} ${device.label || ''}`;
  if (/主控|控制器|单片机|controller|processor|STM32|STC\d|AT89|ESP32|Arduino|Raspberry/i.test(value)) return 'processing';
  if (/传感|检测|采集|输入|按键|按钮|编码器|识别|测量|红外接收|麦克风|sensor|detect|input|button|measure/i.test(value)) return 'input';
  if (/显示|OLED|LCD|数码管|报警|蜂鸣|继电器|电机|风扇|加热|水泵|灯|舵机|执行|驱动|通信|WiFi|蓝牙|LoRa|ZigBee|ESP-01|输出|display|alarm|relay|motor|actuator|communication|output/i.test(value)) return 'output';
  return 'support';
}

function resolveDeviceRefs(refs, devices) {
  const resolved = [];
  const unresolved = [];
  const hasTemporaryRefs = devices.some(device => String(device.sourceRef || '').trim());
  (Array.isArray(refs) ? refs : []).forEach(rawRef => {
    const ref = String(rawRef || '').trim();
    if (!ref) return;
    const key = identityKey(ref);
    const matches = devices.filter(device => (hasTemporaryRefs
      ? [device.id, device.sourceRef]
      : [device.id, device.model, device.label])
      .some(candidate => identityKey(candidate) === key));
    if (matches.length === 1) resolved.push(matches[0].id);
    else unresolved.push(ref);
  });
  return { resolved: unique(resolved), unresolved: unique(unresolved) };
}

function defaultProcessDescription(functionName, deviceIds, devices) {
  if (!deviceIds.length) return '';
  const names = deviceIds.map(id => devices.find(device => device.id === id)?.model).filter(Boolean);
  return `${names.join('、')}共同完成“${functionName}”，主控按照输入条件进行判断并驱动对应结果；请结合实物核对具体处理顺序。`;
}

function defaultVerificationMethod(functionName) {
  const name = String(functionName || '该功能');
  if (/采集|检测|监测|测量|识别/.test(name)) return `改变或模拟被测条件，观察${name}的输入变化及系统反馈是否符合预期。`;
  if (/显示|界面/.test(name)) return `依次改变相关输入和工作状态，观察显示内容是否与当前状态一致。`;
  if (/通信|上传|远程|蓝牙|WiFi|无线/.test(name)) return `触发数据更新或控制指令，核对发送端、接收端与设备动作是否一致。`;
  if (/报警|控制|调节|启停|开关/.test(name)) return `改变触发条件或设置值，观察执行器与提示状态是否按照设定逻辑变化。`;
  return `按实际操作触发“${name}”，观察输入、处理结果和输出动作是否一致。`;
}

function closureLinkedIds(closure) {
  return unique(['inputDeviceIds', 'processingDeviceIds', 'outputDeviceIds', 'supportDeviceIds']
    .flatMap(key => Array.isArray(closure?.[key]) ? closure[key] : []));
}

function closureMissing(closure) {
  const missing = [];
  if (!closureLinkedIds(closure).length) missing.push('实现器件');
  if (!String(closure?.processDescription || '').trim()) missing.push('处理过程');
  if (!String(closure?.verificationMethod || '').trim()) missing.push('验证方法');
  return missing;
}

function createClosure(func, devices) {
  const refs = resolveDeviceRefs(func.suggestedDeviceRefs, devices);
  const stageIds = { input: [], processing: [], output: [], support: [] };
  refs.resolved.forEach(id => {
    const device = devices.find(item => item.id === id);
    stageIds[classifyRelationStage(device)].push(id);
  });
  return {
    id: stableId('closure', func.id || func.name),
    functionId: func.id,
    functionName: func.name,
    inputDeviceIds: stageIds.input,
    processingDeviceIds: stageIds.processing,
    outputDeviceIds: stageIds.output,
    supportDeviceIds: stageIds.support,
    unresolvedDeviceRefs: refs.unresolved,
    processDescription: normalizeKnownText(func.processDescription || '').trim(),
    verificationMethod: normalizeKnownText(func.verificationMethod || '').trim(),
    status: 'suggested',
    confirmedAt: '',
  };
}

function reconcileClosures(functions, devices, existingClosures = []) {
  const validDeviceIds = new Set(devices.map(device => device.id));
  const old = Array.isArray(existingClosures) ? existingClosures : [];
  return functions.map(func => {
    const previous = old.find(item => item.functionId === func.id)
      || old.find(item => identityKey(item.functionName) === identityKey(func.name));
    if (!previous) return createClosure(func, devices);
    const normalizeIds = key => unique((Array.isArray(previous[key]) ? previous[key] : []).filter(id => validDeviceIds.has(id)));
    const closure = {
      ...previous,
      id: previous.id || stableId('closure', func.id),
      functionId: func.id,
      functionName: func.name,
      inputDeviceIds: normalizeIds('inputDeviceIds'),
      processingDeviceIds: normalizeIds('processingDeviceIds'),
      outputDeviceIds: normalizeIds('outputDeviceIds'),
      supportDeviceIds: normalizeIds('supportDeviceIds'),
      unresolvedDeviceRefs: unique(Array.isArray(previous.unresolvedDeviceRefs) ? previous.unresolvedDeviceRefs : []),
      processDescription: normalizeKnownText(previous.processDescription || '').trim(),
      verificationMethod: normalizeKnownText(previous.verificationMethod || '').trim(),
    };
    if (closureMissing(closure).length || closure.unresolvedDeviceRefs.length) {
      closure.status = 'incomplete';
      closure.confirmedAt = '';
    } else if (closure.status !== 'confirmed') {
      closure.status = 'suggested';
    }
    return closure;
  });
}

function normalizeSchemeRelations(scheme) {
  const raw = scheme && typeof scheme === 'object' ? scheme : {};
  const existingDevices = Array.isArray(raw.deviceRecords) ? raw.deviceRecords : [];
  const existingFunctions = Array.isArray(raw.functionRecords) ? raw.functionRecords : [];
  const deviceInput = existingDevices.length ? existingDevices : (raw.devices || []);
  const functionInput = existingFunctions.length ? existingFunctions : (raw.functions || []);
  const deviceRecords = reconcileEntityRecords(deviceInput, existingDevices, 'device');
  const functionRecords = reconcileEntityRecords(functionInput, existingFunctions, 'function');
  const closures = reconcileClosures(functionRecords, deviceRecords, raw.closures || []);
  return {
    ...raw,
    devices: deviceRecords.map(device => device.label),
    functions: functionRecords.map(func => func.name),
    deviceRecords,
    functionRecords,
    closures,
    conflicts: Array.isArray(raw.conflicts) ? raw.conflicts : [],
    warnings: Array.isArray(raw.warnings) ? raw.warnings : [],
    aiReview: {
      status: 'not-run',
      verdict: '',
      summary: '',
      changes: [],
      reviewedAt: '',
      ...(raw.aiReview || {}),
    },
  };
}

function applySchemeLists(deviceValues, functionValues) {
  const deviceRecords = reconcileEntityRecords(deviceValues, project.scheme.deviceRecords || [], 'device');
  const functionRecords = reconcileEntityRecords(functionValues, project.scheme.functionRecords || [], 'function');
  const closures = project.scheme.relationsStage === 'paper'
    ? reconcileClosures(functionRecords, deviceRecords, project.scheme.closures || [])
    : [];
  project.scheme = normalizeSchemeRelations({
    ...project.scheme,
    deviceRecords,
    functionRecords,
    closures,
  });
  if (project.scheme.relationsStage !== 'paper') project.scheme.closures = [];
}

function paperDevices() {
  return unique(lines(project.materials.devicesText)).filter(value => !isPlaceholderFactValue(value));
}

function paperFunctions() {
  return unique(lines(project.materials.functionsText)).filter(value => !isPlaceholderFactValue(value));
}

function paperSourceReady() {
  return Boolean(String(project.title || '').trim());
}

function isPlaceholderFactValue(value) {
  return /^(?:请填写|请补充|待确认|待填写|未提供|暂无|不确定|未知|自动推荐|由\s*AI|AI\s*建议)/i.test(String(value || '').trim());
}

function isControllerFact(value) {
  return /主控|控制器|单片机|MCU|STM32|STC[A-Z0-9]*|AT(?:89|90)S?|ESP32|ESP8266|Arduino|PIC\d|MSP430|GD32|CH32|HC32|N76|MS51|AVR|RP2040|Raspberry\s*Pi\s*Pico|PSoC|CC2530|CC26\d|nRF5\d|C8051|LPC\d|MCS-?51|51\s*单片机/i.test(String(value || ''));
}

function paperMaterialsReady() {
  const devices = paperDevices().filter(value => !isPlaceholderFactValue(value));
  const functions = paperFunctions().filter(value => !isPlaceholderFactValue(value));
  const hasController = devices.some(isControllerFact);
  return Boolean(String(project.title || '').trim()) && hasController && functions.length > 0;
}

function normalizedFactList(value) {
  return unique((Array.isArray(value) ? value : [])
    .map(item => typeof item === 'string' ? item.trim() : String(item?.name || item?.label || item?.value || '').trim())
    .filter(Boolean));
}

function paperCoreDevices() {
  const all = paperDevices();
  const classified = normalizedFactList(project.audit?.factSheet?.coreDevices);
  const matched = all.filter(value => classified.some(candidate => {
    const left = identityKey(value);
    const right = identityKey(candidate);
    return left === right || (Math.min(left.length, right.length) >= 4 && (left.includes(right) || right.includes(left)));
  }));
  return matched.length ? matched : all;
}

function paperCoreFunctions() {
  const all = paperFunctions();
  const classified = normalizedFactList(project.audit?.factSheet?.coreFunctions);
  const topicTokens = value => unique((String(value || '').match(/温湿度|温度|湿度|光照|土壤|烟雾|气体|水位|液位|距离|人体|心率|血氧|显示|OLED|LCD|报警|阈值|按键|串口|蓝牙|WiFi|通信|上传|控制|联动|定位|计时|识别|采集|检测|测量|处理/g) || []));
  const matchedGroups = classified.filter(candidate => {
    const candidateKey = identityKey(candidate);
    const candidateTokens = topicTokens(candidate);
    return all.some(value => {
      const actualKey = identityKey(value);
      if (candidateKey === actualKey || (Math.min(candidateKey.length, actualKey.length) >= 4 && (candidateKey.includes(actualKey) || actualKey.includes(candidateKey)))) return true;
      const actualTokens = topicTokens(value);
      return candidateTokens.some(token => actualTokens.includes(token));
    });
  });
  return matchedGroups.length ? matchedGroups : all;
}

function paperSchemeText() {
  return project.paper.sourceMode === 'scheme' ? project.scheme.markdown || '' : '';
}

function paperClosureSummary() {
  return project.paper.sourceMode === 'scheme' ? closureSummaryRows() : [];
}

function stripThink(text) {
  return String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
    .replace(/^```(?:markdown|md|json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

function parseJsonResponse(text) {
  const clean = stripThink(text);
  const fenced = clean.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const source = fenced || clean;
  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('没有识别到检查结果，请重新检查');
  return JSON.parse(source.slice(start, end + 1));
}

function toast(message, type = 'info') {
  const host = $('toast');
  if (!host) {
    console[type === 'error' ? 'error' : 'log'](message);
    return;
  }
  host.textContent = message;
  host.dataset.type = type;
  host.hidden = false;
  clearTimeout(host._timer);
  host._timer = setTimeout(() => { host.hidden = true; }, type === 'error' ? 12000 : 5000);
}

function formatElapsed(milliseconds) {
  const seconds = Math.max(0, Math.floor((Number(milliseconds) || 0) / 1000));
  const minutes = Math.floor(seconds / 60);
  const remain = seconds % 60;
  return minutes ? `${minutes}分${String(remain).padStart(2, '0')}秒` : `${remain}秒`;
}

function recentSaveLabel(value) {
  const parsed = Date.parse(value || '');
  if (!Number.isFinite(parsed)) return '尚无保存点';
  const seconds = Math.max(0, Math.floor((Date.now() - parsed) / 1000));
  if (seconds < 5) return '刚刚';
  if (seconds < 60) return `${seconds}秒前`;
  return `${Math.floor(seconds / 60)}分钟前`;
}

function refreshBusyHeartbeat() {
  const meta = $('busy-dialog-meta');
  const detailNode = $('busy-dialog-message');
  if (detailNode) detailNode.textContent = busyBaseDetail || '已经完成的内容会自动保留';
  if (!meta) return;
  const generation = project.paper?.generation || {};
  const elapsed = busyOpenedAt ? formatElapsed(Date.now() - busyOpenedAt) : '0秒';
  const quietFor = busyLastProgressAt ? Date.now() - busyLastProgressAt : 0;
  const attempt = busyRequestAttempt ? ` · AI请求 ${busyRequestAttempt}/${busyRequestAttemptMax}` : '';
  const timeout = busyRequestTimeoutMs ? ` · 本次最长等待 ${Math.round(busyRequestTimeoutMs / 60000)} 分钟` : '';
  const working = quietFor >= 2 * 60 * 1000 ? ' · AI仍在深度处理，页面没有停止' : '';
  meta.textContent = `本次已用时 ${elapsed}${attempt}${timeout} · 最近保存 ${recentSaveLabel(generation.lastSavedAt || project.updatedAt)}${working}`;
}

function setBusyRequestState(attempt, maximum, timeoutMs) {
  busyRequestAttempt = attempt;
  busyRequestAttemptMax = maximum;
  busyRequestTimeoutMs = timeoutMs;
  const generation = project.paper?.generation;
  if (generation?.status === 'running') {
    generation.requestAttempt = attempt;
    generation.requestAttemptMax = maximum;
    generation.requestStartedAt = nowIso();
    generation.requestTimeoutSeconds = Math.round(timeoutMs / 1000);
    generation.updatedAt = nowIso();
    saveProject({ immediate: true });
  }
  refreshBusyHeartbeat();
}

function clearBusyRequestState() {
  busyRequestAttempt = 0;
  busyRequestAttemptMax = 0;
  busyRequestTimeoutMs = 0;
  const generation = project.paper?.generation;
  if (generation) {
    generation.requestAttempt = 0;
    generation.requestAttemptMax = 0;
    generation.requestStartedAt = '';
    generation.requestTimeoutSeconds = 0;
  }
  refreshBusyHeartbeat();
}

function showBusy(title, detail = '已经完成的内容会自动保留', { canPause = false } = {}) {
  const dialog = $('busy-dialog');
  if (!dialog) return;
  const titleNode = qs('[data-busy-title]', dialog) || $('busy-dialog-title');
  const detailNode = qs('[data-busy-detail]', dialog) || $('busy-dialog-message');
  if (titleNode) titleNode.textContent = title;
  busyBaseDetail = detail;
  busyLastProgressAt = Date.now();
  if (!busyOpenedAt) busyOpenedAt = Date.now();
  if (detailNode) detailNode.textContent = detail;
  const progress = $('busy-dialog-progress');
  const step = $('busy-dialog-step');
  const value = $('busy-dialog-value');
  if (progress) progress.classList.add('is-indeterminate');
  const progressbar = $('busy-dialog-progressbar');
  if (progressbar) {
    progressbar.removeAttribute('aria-valuenow');
    progressbar.setAttribute('aria-valuetext', '正在处理');
  }
  if (step) step.textContent = '正在通过 API 生成内容';
  if (value) value.textContent = '请稍候';
  const cancelButton = $('btn-cancel-busy');
  if (cancelButton) {
    cancelButton.hidden = !canPause;
    cancelButton.disabled = !canPause;
    cancelButton.textContent = '暂停生成（已完成内容会保留）';
  }
  if (typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal();
  else dialog.hidden = false;
  clearInterval(busyHeartbeatTimer);
  busyHeartbeatTimer = setInterval(refreshBusyHeartbeat, 1000);
  refreshBusyHeartbeat();
}

function updateBusyProgress(percent, stepText, detail) {
  const progress = $('busy-dialog-progress');
  const step = $('busy-dialog-step');
  const value = $('busy-dialog-value');
  const detailNode = $('busy-dialog-message');
  const safePercent = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
  busyLastProgressAt = Date.now();
  if (detail) busyBaseDetail = detail;
  if (progress) {
    progress.classList.remove('is-indeterminate');
    progress.style.width = `${safePercent}%`;
  }
  const progressbar = $('busy-dialog-progressbar');
  if (progressbar) {
    progressbar.setAttribute('aria-valuenow', String(safePercent));
    progressbar.removeAttribute('aria-valuetext');
  }
  if (step && stepText) step.textContent = stepText;
  if (value) value.textContent = `${safePercent}%`;
  if (detailNode && detail) detailNode.textContent = detail;
  refreshBusyHeartbeat();
}

function hideBusy() {
  clearInterval(busyHeartbeatTimer);
  busyHeartbeatTimer = null;
  busyOpenedAt = 0;
  busyLastProgressAt = 0;
  busyBaseDetail = '';
  clearBusyRequestState();
  const dialog = $('busy-dialog');
  if (!dialog) return;
  if (typeof dialog.close === 'function' && dialog.open) dialog.close();
  else dialog.hidden = true;
}

function getCurrentStatus() {
  if (!project.title) return { label: '还没有项目', next: '从方案设计或论文资料开始' };
  if (project.paper?.quality?.blocking?.length === 0 && project.paper.status === 'final') {
    return { label: '论文内容检查通过', next: '可以导出最终稿' };
  }
  if (Object.values(project.paper?.chapters || {}).some(ch => ch?.content)) {
    const locked = Object.values(project.paper.chapters).filter(ch => ch?.status === 'locked').length;
    return { label: `论文已写至第 ${activeChapter} 章`, next: `已有 ${locked} 章确认并锁定` };
  }
  if (project.paper?.generation?.status === 'completed') return { label: '论文已生成', next: '可下载论文文档' };
  if (['paused', 'failed'].includes(project.paper?.generation?.status)) return { label: '论文生成已暂停', next: '继续生成未完成内容' };
  if (project.outline?.confirmedAt) return { label: '论文目录已确认', next: '一键生成完整论文' };
  if (project.audit?.status === 'confirmed') return { label: '论文资料已核对', next: '确认论文目录' };
  if (project.scheme?.status === 'confirmed') return { label: '方案已确认', next: '补充论文资料并核对事实' };
  if (project.scheme?.markdown) return { label: '方案待确认', next: '查看完整方案' };
  return { label: '项目资料填写中', next: '继续完善当前内容' };
}

function renderHome() {
  const status = getCurrentStatus();
  const titleNode = $('home-project-title') || $('current-project-title');
  const statusNode = $('home-project-status') || $('current-project-status');
  const nextNode = $('home-project-next') || $('current-project-next-action');
  const dateNode = $('home-project-date') || $('current-project-updated');
  const emptyNode = $('home-empty-project');
  const currentNode = $('home-current-project');
  if (titleNode) titleNode.textContent = project.title || '尚未创建项目';
  if (statusNode) statusNode.textContent = status.label;
  if (nextNode) nextNode.textContent = `下一步：${status.next}`;
  if (dateNode) dateNode.textContent = project.updatedAt ? `最近保存：${new Date(project.updatedAt).toLocaleString('zh-CN')}` : '';
  const summaryNode = $('current-project-summary');
  if (summaryNode) summaryNode.textContent = project.title
    ? `论文资料已整理 ${paperDevices().length} 个器件、${paperFunctions().length} 项功能；${status.next}。`
    : '创建项目后，这里会显示你做到哪一步、还有什么需要处理。';
  const planStatus = $('home-plan-status');
  if (planStatus) planStatus.textContent = project.scheme.status === 'confirmed' ? '方案已确认' : project.scheme.markdown ? '待确认' : '未开始';
  const paperStatus = $('home-paper-status');
  if (paperStatus) paperStatus.textContent = Object.values(project.paper.chapters || {}).some(chapter => chapter?.content)
    ? '写作中'
    : project.audit.status === 'confirmed' ? '资料已确认' : '可独立开始';
  const continueButton = $('btn-continue');
  if (continueButton) continueButton.textContent = project.title ? '继续上次工作' : '开始新项目';
  const clearButton = $('btn-clear-current-project');
  if (clearButton) clearButton.hidden = !project.title;
  const select = $('project-switcher');
  if (select) select.innerHTML = `<option value="${escapeHtml(project.id)}">${escapeHtml(project.title || '尚未创建项目')}</option>`;
  if (emptyNode) emptyNode.hidden = Boolean(project.title);
  if (currentNode) currentNode.hidden = !project.title;
}

function setView(name, step) {
  currentView = name;
  if (name === 'scheme' && step) schemeStep = Number(step);
  if (name === 'paper' && step) {
    paperStep = Math.max(1, Math.min(4, Number(step) || 1));
    project.paper.stage = paperStep;
    saveProject();
  }
  ['home', 'scheme', 'paper'].forEach(view => {
    const node = $(`view-${view}`);
    if (node) {
      node.hidden = view !== name;
      node.classList.toggle('is-active', view === name);
    }
  });
  qsa('[data-nav-view]').forEach(button => {
    const active = button.dataset.navView === name;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-current', active ? 'page' : 'false');
  });
  if (name === 'home') renderHome();
  if (name === 'scheme') renderScheme();
  if (name === 'paper') renderPaper();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderStepNav(host, steps, active, action) {
  if (!host) return;
  host.innerHTML = steps.map((step, index) => {
    const number = index + 1;
    const done = number < active;
    const current = number === active;
    return `<button type="button" class="workflow-step${done ? ' is-done' : ''}${current ? ' is-current' : ''}" data-action="${action}" data-step="${number}" aria-current="${current ? 'step' : 'false'}">
      <span>${done ? '✓' : number}</span><strong>${escapeHtml(step)}</strong>
    </button>`;
  }).join('');
}

function renderScheme() {
  schemeStep = Math.max(1, Math.min(2, Number(schemeStep) || 1));
  const workspaceSubtitle = $('plan-workspace-subtitle');
  if (workspaceSubtitle) workspaceSubtitle.textContent = `当前项目：${project.title || '尚未命名'}`;
  const overallStatus = $('plan-overall-status');
  if (overallStatus) overallStatus.textContent = `第 ${schemeStep} / 2 步`;
  const planSaveState = $('plan-save-state');
  if (planSaveState) planSaveState.textContent = project.scheme.markdown ? '方案已保存' : '提交后保存资料';
  renderStepNav($('scheme-step-nav'), ['提供资料', '查看方案'], schemeStep, 'scheme-step');
  for (let i = 1; i <= 4; i += 1) {
    const panel = $(`scheme-step-${i}`);
    if (panel) panel.hidden = i !== schemeStep;
  }
  const panel = $(`scheme-step-${schemeStep}`);
  if (!panel) return;
  if (schemeStep === 1) renderSchemeBasics(panel);
  if (schemeStep === 2) renderSchemeResultPage(panel);
}

function renderSchemeBasics(panel) {
  const importMode = project.sourceMode === 'extract' || project.sourceMode === 'import';
  panel.innerHTML = `
    <div class="panel-heading"><div><span class="step-kicker">第 1 步</span><h2>你现在有没有现成方案？</h2><p>没有方案就告诉AI题目和基本要求；已有方案直接粘贴或导入，不再重复走复杂核对。</p></div></div>
    <div class="mode-switch scheme-mode-switch" role="radiogroup" aria-label="方案来源">
      <label><input type="radio" name="source-mode" value="create" ${!importMode ? 'checked' : ''}><span><strong>我还没有方案</strong><small>根据题目和要求生成完整方案</small></span></label>
      <label><input type="radio" name="source-mode" value="import" ${importMode ? 'checked' : ''}><span><strong>我已经有方案</strong><small>粘贴文字或导入文件直接整理</small></span></label>
    </div>
    ${importMode ? `
      <div class="scheme-entry-card">
        <label class="field field-wide"><span>方案题目 <small>可不填，系统会从方案开头识别</small></span><input id="scheme-title" maxlength="100" value="${escapeHtml(project.title)}" placeholder="已有方案中写了题目时可以留空"></label>
        <label class="field field-wide"><span>粘贴完整方案 <b>必填</b></span><textarea id="scheme-source" rows="18" placeholder="把已有方案完整复制到这里，或使用下方按钮导入文件">${escapeHtml(project.sourceText)}</textarea></label>
        <label class="file-button">导入 TXT、MD 或 DOCX<input id="scheme-source-file" type="file" accept=".txt,.md,.docx" hidden></label>
        <small id="scheme-file-hint">文件文字会直接保存为方案，不会被AI改写。</small>
      </div>` : `
      <div class="scheme-entry-card">
        <div class="form-grid">
          <label class="field field-wide"><span>设计题目 <b>必填</b></span><input id="scheme-title" maxlength="100" value="${escapeHtml(project.title)}" placeholder="例如：基于 STM32 的智能温室控制系统"></label>
          <label class="field field-wide"><span>补充信息和必须实现的要求 <b>优先级最高</b></span><textarea id="scheme-requirements" rows="7" placeholder="可以写使用场景、功能要求、老师要求或已确定器件；这里的明确要求优先于A/B/C等级">${escapeHtml([project.background, project.requirements].filter(Boolean).join('\n'))}</textarea><small>等级只用于补充你没有说明的内容，不会覆盖这里填写的器件、功能、通信方式或限制。</small></label>
        </div>
        <details class="scheme-more-options"><summary>更多偏好（可选）</summary><div class="form-grid">
          <fieldset class="field field-wide level-picker"><legend>项目难度 <small>仅作为未填写内容的参考</small></legend>${['A','B','C'].map(level => `<label><input type="radio" name="scheme-level" value="${level}" ${project.level === level ? 'checked' : ''}><span>${level} 级<small>${level === 'A' ? '较复杂，通常含联网平台' : level === 'B' ? '中等，完成较丰富功能' : '基础，完成采集与控制'}</small></span></label>`).join('')}</fieldset>
          <label class="field"><span>主控偏好</span><input id="scheme-mcu" value="${escapeHtml(project.preferences.mcu)}" placeholder="留空由AI推荐"></label>
          <label class="field"><span>显示器偏好</span><input id="scheme-display" value="${escapeHtml(project.preferences.display)}" placeholder="例如：0.96寸OLED"></label>
          <label class="field"><span>供电方式</span><input id="scheme-power" value="${escapeHtml(project.preferences.power)}" placeholder="留空由AI推荐"></label>
        </div></details>
      </div>`}
    ${importMode ? '<div class="notice notice-info">现有方案会按原文保存，不在方案阶段调用AI重写。进入论文资料核对时，系统会再单独说明需要AI处理的内容。</div>' : `<label class="ai-disclosure-check"><input id="scheme-ai-consent" type="checkbox" ${project.consents.schemeAiReviewDisclosure ? 'checked' : ''}> 我知道：点击生成后，题目、要求和可选偏好会发送给已配置的AI服务生成方案。</label>`}
    <div class="panel-actions"><button class="btn btn-secondary" type="button" data-action="go-home">返回首页</button><button class="btn btn-primary scheme-primary-action" type="button" data-action="submit-scheme">${importMode ? '直接保存并查看方案' : 'AI生成详细方案'}</button></div>`;
}

function captureSchemeBasics() {
  const title = $('scheme-title')?.value.trim() || '';
  const sourceMode = qs('input[name="source-mode"]:checked')?.value || project.sourceMode || 'create';
  const importMode = sourceMode === 'extract' || sourceMode === 'import';
  const sourceText = $('scheme-source')?.value.trim() || project.sourceText || '';
  if (!importMode && !title) {
    toast('请先填写设计题目', 'error');
    $('scheme-title')?.focus();
    return false;
  }
  if (importMode && !sourceText) {
    toast('请粘贴已有方案或导入方案文件', 'error');
    $('scheme-source')?.focus();
    return false;
  }
  const previousFacts = factsSignature();
  const previousSchemeInput = JSON.stringify({
    title: project.title,
    background: project.background,
    requirements: project.requirements,
    level: project.level,
    sourceMode: project.sourceMode,
    sourceText: project.sourceText,
    preferences: project.preferences,
  });
  project.title = importMode ? title : (title || project.title);
  project.background = '';
  project.requirements = $('scheme-requirements')?.value.trim() || '';
  project.level = qs('input[name="scheme-level"]:checked')?.value || 'B';
  project.sourceMode = sourceMode;
  project.sourceText = sourceText;
  project.preferences = {
    mcu: $('scheme-mcu')?.value.trim() || '',
    display: normalizeKnownText($('scheme-display')?.value || '').trim(),
    power: $('scheme-power')?.value.trim() || '',
  };
  const currentSchemeInput = JSON.stringify({
    title: project.title,
    background: project.background,
    requirements: project.requirements,
    level: project.level,
    sourceMode: project.sourceMode,
    sourceText: project.sourceText,
    preferences: project.preferences,
  });
  if (previousSchemeInput !== currentSchemeInput && project.scheme.markdown) {
    project.scheme.status = 'stale';
    project.scheme.confirmedAt = '';
    project.scheme.aiReview = {
      status: 'not-run',
      verdict: '',
      summary: '方案输入已修改，请重新生成或保存新方案。',
      changes: [],
      issues: [],
      reviewedAt: '',
    };
    project.scheme.closures.forEach(closure => {
      closure.status = 'needs_review';
      closure.confirmedAt = '';
    });
    invalidateIfFactsChanged(previousFacts);
  } else {
    invalidateIfFactsChanged(previousFacts);
  }
  saveProject({ immediate: true });
  return true;
}

function renderSchemeGenerate(panel) {
  const hasResult = project.scheme.markdown && project.scheme.devices.length && project.scheme.functions.length;
  panel.innerHTML = `
    <div class="panel-heading"><div><span class="step-kicker">第 2 步</span><h2>${hasResult ? '方案已经整理好' : '让AI生成并自动复核方案'}</h2><p>第一次AI生成器件、功能与对应关系，第二次AI独立检查并修正；完成后你只需要整体确认。</p></div></div>
    <div class="summary-box"><strong>${escapeHtml(project.title || '未填写题目')}</strong><span>${project.sourceMode === 'extract' ? '已有资料整理模式' : `${project.level} 级方案设计`}</span></div>
    <label class="ai-disclosure-check"><input id="scheme-ai-review-consent" type="checkbox" ${project.consents.schemeAiReviewDisclosure ? 'checked' : ''}> 我知道：生成与二次复核会把题目、器件、功能及对应关系发送给已配置的AI服务；任务书原文、源程序、测试记录和参考文献不会发送到第二次复核。</label>
    ${hasResult ? renderSchemeResult() : '<div class="empty-state"><span>②</span><h3>准备生成和复核</h3><p>AI会自动完成器件分配、功能分配、实现过程和验证方法。</p></div>'}
        <div class="panel-actions"><button class="btn btn-secondary" type="button" data-action="scheme-step" data-step="1">返回修改</button><button class="btn btn-primary" id="ai-generate-scheme" type="button" data-action="generate-scheme">${hasResult ? '重新生成并复核' : '生成并自动复核'}</button>${hasResult ? '<button class="btn btn-primary" type="button" data-action="scheme-step" data-step="3">查看AI复核结果</button>' : ''}</div>`;
}

function renderSchemeResult() {
  return `<div class="scheme-result">
    <div><span class="result-label">器件清单 · ${project.scheme.devices.length} 项</span><div class="tag-list">${project.scheme.devices.map(item => `<span>${escapeHtml(item)}</span>`).join('')}</div></div>
    <div><span class="result-label">功能清单 · ${project.scheme.functions.length} 项</span><ol>${project.scheme.functions.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ol></div>
  </div>`;
}

function schemeStructuredData() {
  return project.scheme.structured && typeof project.scheme.structured === 'object'
    ? project.scheme.structured
    : {};
}

function schemeTextValue(value, fallback = '原方案未说明') {
  const rawValue = String(value || '').trim();
  const textValue = project.sourceMode === 'create' ? stripInternalSchemeLevelText(rawValue) : rawValue;
  return textValue || fallback;
}

function buildSchemeDocumentText(data = schemeStructuredData()) {
  const overview = data.overview || {};
  const architecture = data.architecture || {};
  const notes = data.implementationNotes || {};
  const devices = Array.isArray(data.devices) && data.devices.length ? data.devices : project.scheme.deviceRecords;
  const functions = Array.isArray(data.functions) && data.functions.length ? data.functions : project.scheme.functionRecords;
  const deviceText = devices.map((item, index) => `${index + 1}. ${item.model || item.name || item.label || '未命名器件'}：${schemeTextValue(item.role, '主要作用待确认')}。选型说明：${schemeTextValue(item.selectionReason, '原方案未说明')}`).join('\n');
  const functionText = functions.map((item, index) => `${index + 1}. ${item.text || item.name || '未命名功能'}：${schemeTextValue(item.description, '具体表现以项目实际要求为准')}`).join('\n');
  return normalizeKnownText(`# ${project.title || data.topic || '单片机项目方案'}

## 一、项目概述
### 1. 项目背景
${schemeTextValue(overview.background)}

### 2. 项目目标
${schemeTextValue(overview.goal)}

### 3. 总体说明
${schemeTextValue(overview.overallDescription)}

## 二、系统总体组成
### 1. 输入与采集
${schemeTextValue(architecture.inputLayer)}

### 2. 主控与处理
${schemeTextValue(architecture.controlLayer)}

### 3. 输出与执行
${schemeTextValue(architecture.outputLayer)}

### 4. 通信方式
${schemeTextValue(architecture.communicationLayer, '无独立通信功能')}

## 三、主要器件及选型
${deviceText || '原方案未列出器件。'}

## 四、主要功能
${functionText || '原方案未列出功能。'}

## 五、实施注意事项
### 1. 供电
${schemeTextValue(notes.power)}

### 2. 接口与通信
${schemeTextValue(notes.interfaces)}

### 3. 开发与调试
${schemeTextValue(notes.development)}

### 4. 安装与布置
${schemeTextValue(notes.installation)}`);
}

function renderSchemeDocumentHtml() {
  const data = schemeStructuredData();
  const overview = data.overview || {};
  const architecture = data.architecture || {};
  const notes = data.implementationNotes || {};
  const devices = Array.isArray(data.devices) && data.devices.length ? data.devices : project.scheme.deviceRecords;
  const functions = Array.isArray(data.functions) && data.functions.length ? data.functions : project.scheme.functionRecords;
  const paragraph = value => `<p>${escapeHtml(schemeTextValue(value))}</p>`;
  return `<article class="scheme-document">
    <header><span>${project.sourceMode === 'create' ? 'AI生成方案' : '已整理方案'}</span><h2>${escapeHtml(project.title || data.topic || '单片机项目方案')}</h2></header>
    <section class="scheme-document-section"><h3>一、项目概述</h3><h4>项目背景</h4>${paragraph(overview.background)}<h4>项目目标</h4>${paragraph(overview.goal)}<h4>总体说明</h4>${paragraph(overview.overallDescription)}</section>
    <section class="scheme-document-section"><h3>二、系统总体组成</h3><div class="scheme-architecture-grid"><div><b>输入与采集</b>${paragraph(architecture.inputLayer)}</div><div><b>主控与处理</b>${paragraph(architecture.controlLayer)}</div><div><b>输出与执行</b>${paragraph(architecture.outputLayer)}</div><div><b>通信方式</b>${paragraph(architecture.communicationLayer || '无独立通信功能')}</div></div></section>
    <section class="scheme-document-section"><h3>三、主要器件及选型</h3><div class="scheme-device-list">${devices.map(item => `<div><strong>${escapeHtml(item.model || item.name || item.label)}</strong><p>${escapeHtml(schemeTextValue(item.role, '主要作用待确认'))}</p><small>选型说明：${escapeHtml(schemeTextValue(item.selectionReason, '原方案未说明'))}</small></div>`).join('')}</div></section>
    <section class="scheme-document-section"><h3>四、主要功能</h3><ol class="scheme-function-list">${functions.map(item => `<li><strong>${escapeHtml(item.text || item.name)}</strong><p>${escapeHtml(schemeTextValue(item.description, '具体表现以项目实际要求为准'))}</p></li>`).join('')}</ol></section>
    <section class="scheme-document-section"><h3>五、实施注意事项</h3><dl class="scheme-notes"><div><dt>供电</dt><dd>${escapeHtml(schemeTextValue(notes.power))}</dd></div><div><dt>接口与通信</dt><dd>${escapeHtml(schemeTextValue(notes.interfaces))}</dd></div><div><dt>开发与调试</dt><dd>${escapeHtml(schemeTextValue(notes.development))}</dd></div><div><dt>安装与布置</dt><dd>${escapeHtml(schemeTextValue(notes.installation))}</dd></div></dl></section>
  </article>`;
}

function renderSchemeResultPage(panel) {
  const resultCurrent = project.scheme.markdown
    && ['generated', 'confirmed'].includes(project.scheme.status)
    && project.scheme.inputSignature === currentSchemeInputSignature();
  if (!resultCurrent) {
    schemeStep = 1;
    renderScheme();
    toast(project.scheme.markdown ? '资料已修改，请重新生成或保存方案' : '请先生成或导入方案', 'info');
    return;
  }
  const conflicts = unresolvedSchemeConflicts();
  panel.innerHTML = `
    <div class="panel-heading"><div><span class="step-kicker">第 2 步</span><h2>${project.sourceMode === 'create' ? '方案已经生成' : '方案原文已保存'}</h2><p>这份方案可以直接复制和下载。器件连接、程序逻辑和测试细化会在论文资料核对时处理。</p></div><span class="status-pill ${conflicts.length ? 'is-danger' : 'is-success'}">${conflicts.length ? `${conflicts.length} 项内容待确认` : '等待你确认'}</span></div>
    ${conflicts.length ? `<div class="notice notice-danger">方案资料存在冲突：${escapeHtml(conflicts[0].detail)}。请返回修改资料后重新整理。</div>` : ''}
    ${project.sourceMode === 'create' && project.scheme.structured
      ? renderSchemeDocumentHtml()
      : `<article class="scheme-document scheme-import-document">${plainTextToHtml(project.scheme.markdown)}</article>`}
    <div class="scheme-output-toolbar panel-actions"><button class="btn btn-secondary" type="button" data-action="scheme-step" data-step="1">修改资料</button><button class="btn btn-secondary" type="button" data-action="copy-scheme">复制完整方案</button><button class="btn btn-secondary" type="button" data-action="export-scheme">下载完整方案</button><button class="btn btn-secondary" type="button" data-action="export-customer-scheme">下载客户版方案</button><button class="btn btn-primary" type="button" data-action="accept-scheme" ${conflicts.length ? 'disabled' : ''}>使用此方案，进入论文</button><button class="btn btn-quiet btn-reset-project" type="button" data-action="reset-project">清空并开始下一题</button></div>`;
}

function normalizeSchemeConflict(value, index = 0) {
  const item = typeof value === 'string' ? { detail: value } : (value || {});
  const detail = String(item.detail || item.message || item.description || item.reason || item.field || '存在需要确认的方案冲突').trim();
  return {
    ...item,
    id: item.id || stableId('scheme-conflict', `${index}-${detail}`),
    detail,
    severity: item.severity || 'blocking',
    resolved: Boolean(item.resolved),
    resolution: String(item.resolution || '').trim(),
  };
}

function schemeConflicts() {
  return (project.scheme.conflicts || []).map(normalizeSchemeConflict);
}

function unresolvedSchemeConflicts() {
  return schemeConflicts().filter(item => !item.resolved);
}

function closureReviewIssues({ requireConfirmed = false } = {}) {
  const issues = [];
  const deviceIds = new Set(project.scheme.deviceRecords.map(device => device.id));
  const functionIds = new Set(project.scheme.functionRecords.map(func => func.id));
  const usedDeviceIds = new Set();
  const closuresByFunction = new Map();
  project.scheme.closures.forEach(closure => {
    if (!functionIds.has(closure.functionId)) issues.push(`“${closure.functionName || '未命名功能'}”引用了已删除的功能记录`);
    if (closuresByFunction.has(closure.functionId)) issues.push(`“${closure.functionName || '未命名功能'}”存在重复实现关系`);
    closuresByFunction.set(closure.functionId, closure);
    const linkedIds = closureLinkedIds(closure);
    linkedIds.forEach(id => usedDeviceIds.add(id));
    const unknown = linkedIds.filter(id => !deviceIds.has(id));
    if (unknown.length || closure.unresolvedDeviceRefs?.length) issues.push(`“${closure.functionName}”仍有无法识别的器件关联`);
    const missing = closureMissing(closure);
    if (missing.length) issues.push(`“${closure.functionName}”还缺：${missing.join('、')}`);
    if (requireConfirmed && closure.status !== 'confirmed') issues.push(`“${closure.functionName}”尚未确认`);
  });
  project.scheme.functionRecords.forEach(func => {
    if (!closuresByFunction.has(func.id)) issues.push(`“${func.name}”还没有实现关系`);
  });
  project.scheme.deviceRecords.forEach(device => {
    if (!usedDeviceIds.has(device.id) && classifyRelationStage(device) !== 'support') {
      issues.push(`器件“${device.model}”尚未参与任何功能`);
    }
  });
  unresolvedSchemeConflicts().forEach(item => issues.push(`方案冲突待处理：${item.detail}`));
  if (/96\s*(?:英寸|寸)\s*(?:OLED|显示(?:屏|器)?)/i.test([
    ...project.scheme.devices,
    ...project.scheme.functions,
    ...project.scheme.closures.flatMap(closure => [closure.processDescription, closure.verificationMethod]),
  ].join(' ').replace(/0\.96\s*(?:英寸|寸)/gi, ''))) {
    issues.push('OLED尺寸不能写成“96寸”，请重新生成并使用“0.96寸OLED”');
  }
  return unique(issues);
}

function isSchemeReadyForPaper() {
  return project.scheme.status === 'confirmed'
    && Boolean(project.title)
    && Boolean(project.scheme.markdown)
    && project.scheme.inputSignature === currentSchemeInputSignature()
    && unresolvedSchemeConflicts().length === 0;
}

function invalidateSchemeReview(summary) {
  if (!project.scheme.functions.length) return;
  project.scheme.status = 'mapping-review-required';
  project.scheme.confirmedAt = '';
  project.scheme.aiReview = {
    status: 'not-run',
    verdict: '',
    summary,
    changes: [],
    issues: [],
    reviewedAt: '',
  };
  project.scheme.closures.forEach(closure => {
    closure.status = 'needs_review';
    closure.confirmedAt = '';
  });
  invalidateIfFactsChanged('__scheme-review-stale__');
}

function renderSchemeReview(panel) {
  project.scheme = normalizeSchemeRelations(project.scheme);
  const review = project.scheme.aiReview || {};
  const automaticIssues = closureReviewIssues({ requireConfirmed: false });
  const reviewIssues = unique([...(review.issues || []), ...automaticIssues]);
  const passed = review.status === 'passed' && Boolean(review.reviewedAt) && !reviewIssues.length;
  const summaryCards = project.scheme.closures.map(closure => `<details class="ai-closure-summary"><summary><span>${escapeHtml(closure.functionName)}</span><strong>${closureLinkedIds(closure).length} 个器件</strong></summary><div class="ai-closure-body"><p><b>使用器件：</b>${escapeHtml(deviceNames(closureLinkedIds(closure)).join('、') || '未分配')}</p><p><b>实现过程：</b>${escapeHtml(closure.processDescription || '未生成')}</p><p><b>验证方法：</b>${escapeHtml(closure.verificationMethod || '未生成')}</p></div></details>`).join('');
  panel.innerHTML = `
    <div class="panel-heading"><div><span class="step-kicker">第 3 步</span><h2>${passed ? 'AI复核完成，请整体确认' : 'AI复核发现需要处理的问题'}</h2><p>器件分配、功能分配、实现过程和验证方法均由AI完成。你只需判断整个方案是否符合你的项目。</p></div><span class="status-pill ${passed ? 'is-success' : 'is-danger'}">${passed ? '自动检查通过' : '暂不能确认'}</span></div>
    <article class="ai-review-hero ${passed ? 'is-passed' : 'is-blocked'}"><div class="ai-review-mark">${passed ? '✓' : '!'}</div><div><h3>${escapeHtml(review.summary || (passed ? 'AI已完成独立复核' : '当前方案尚未通过自动复核'))}</h3><p>已检查 ${project.scheme.functions.length} 项功能与 ${project.scheme.devices.length} 个器件的多对多关系。</p></div></article>
    ${review.changes?.length ? `<section class="ai-review-section"><h3>AI复核时做出的修正</h3><ul>${review.changes.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul></section>` : ''}
    ${reviewIssues.length ? `<section class="ai-review-section is-danger"><h3>需要重新生成或补充的信息</h3><ul>${reviewIssues.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul></section>` : ''}
    <section class="ai-review-section"><h3>方案概要</h3><div class="tag-list">${project.scheme.devices.map(item => `<span>${escapeHtml(item)}</span>`).join('')}</div><div class="ai-closure-summary-list">${summaryCards}</div></section>
    <label class="final-scheme-check ${passed ? '' : 'is-disabled'}"><input id="scheme-overall-confirm" type="checkbox" ${passed ? '' : 'disabled'}> 我已查看题目、器件和功能，确认整个方案没有问题。</label>
    <div class="panel-actions"><button class="btn btn-secondary" type="button" data-action="scheme-step" data-step="1">方案有问题，返回修改</button><button class="btn btn-secondary" type="button" data-action="scheme-step" data-step="2">重新生成并复核</button><button class="btn btn-primary" type="button" data-action="save-scheme-review" ${passed ? '' : 'disabled'}>方案没有问题，整体确认</button></div>`;
}

function saveSchemeReview() {
  if (project.scheme.aiReview?.status !== 'passed' || !project.scheme.aiReview?.reviewedAt) {
    toast('当前方案尚未通过AI复核，请重新生成', 'error');
    return;
  }
  if (!$('scheme-overall-confirm')?.checked) {
    toast('请先勾选“确认整个方案没有问题”', 'error');
    return;
  }
  const previousFacts = factsSignature();
  const confirmedAt = nowIso();
  project.scheme.closures.forEach(closure => {
    closure.status = 'confirmed';
    closure.confirmedAt = confirmedAt;
  });
  const issues = closureReviewIssues({ requireConfirmed: true });
  if (!project.scheme.markdown) {
    project.scheme.markdown = buildSchemeDocumentText(project.scheme.structured || schemeStructuredData());
  }
  project.scheme.status = issues.length ? 'mapping-review-required' : 'reviewed';
  project.scheme.confirmedAt = issues.length ? '' : confirmedAt;
  invalidateIfFactsChanged(previousFacts);
  saveProject({ immediate: true });
  if (issues.length) {
    renderScheme();
    toast(`自动核对仍有 ${issues.length} 项问题：${issues[0]}`, 'error');
    return;
  }
  schemeStep = 4;
  renderScheme();
}

function deviceNames(ids) {
  return (ids || []).map(id => project.scheme.deviceRecords.find(device => device.id === id)?.model).filter(Boolean);
}

function closureSummaryRows() {
  return project.scheme.closures.map(closure => ({
    functionId: closure.functionId,
    functionName: closure.functionName,
    inputs: deviceNames(closure.inputDeviceIds),
    processingDevices: deviceNames(closure.processingDeviceIds),
    outputs: deviceNames(closure.outputDeviceIds),
    supportingDevices: deviceNames(closure.supportDeviceIds),
    processDescription: closure.processDescription,
    verificationMethod: closure.verificationMethod,
    status: closure.status,
  }));
}

function deviceUsageSummary() {
  const counts = new Map(project.scheme.deviceRecords.map(device => [device.id, 0]));
  project.scheme.closures.forEach(closure => closureLinkedIds(closure).forEach(id => counts.set(id, (counts.get(id) || 0) + 1)));
  return project.scheme.deviceRecords.map(device => ({ ...device, count: counts.get(device.id) || 0 }));
}

function renderSchemeConfirm(panel) {
  project.scheme = normalizeSchemeRelations(project.scheme);
  const issues = closureReviewIssues({ requireConfirmed: true });
  if (project.scheme.aiReview?.status !== 'passed' || !project.scheme.aiReview?.reviewedAt) issues.unshift('方案尚未通过AI二次复核');
  if (project.scheme.status !== 'reviewed' && project.scheme.status !== 'confirmed') issues.unshift('方案尚未完成整体确认');
  const complete = project.scheme.closures.length - project.scheme.closures.filter(closure => closureMissing(closure).length || closure.status !== 'confirmed').length;
  const usage = deviceUsageSummary();
  const unused = usage.filter(device => !device.count);
  const common = usage.filter(device => device.count > 1).sort((a, b) => b.count - a.count);
  const cards = project.scheme.closures.map(closure => `<article class="closure-confirm-card"><header><h3>${escapeHtml(closure.functionName)}</h3><span class="status-pill ${closure.status === 'confirmed' ? 'is-success' : 'is-danger'}">${closure.status === 'confirmed' ? '已完整' : '需修改'}</span></header><dl><div><dt>输入</dt><dd>${escapeHtml(deviceNames(closure.inputDeviceIds).join('、') || '无独立输入器件')}</dd></div><div><dt>主控与处理</dt><dd>${escapeHtml([deviceNames(closure.processingDeviceIds).join('、'), closure.processDescription].filter(Boolean).join('；'))}</dd></div><div><dt>输出</dt><dd>${escapeHtml(deviceNames(closure.outputDeviceIds).join('、') || '无独立输出器件')}</dd></div>${closure.supportDeviceIds?.length ? `<div><dt>辅助</dt><dd>${escapeHtml(deviceNames(closure.supportDeviceIds).join('、'))}</dd></div>` : ''}<div><dt>验证</dt><dd>${escapeHtml(closure.verificationMethod)}</dd></div></dl></article>`).join('');
  panel.innerHTML = `
    <div class="panel-heading"><div><span class="step-kicker">第 4 步</span><h2>${issues.length ? '方案还不能锁定' : '方案已通过整体确认'}</h2><p>${issues.length ? '请先返回AI复核页处理问题，再锁定方案。' : 'AI生成与独立复核已经完成，功能—器件关系将按当前结果原样传入论文。'}</p></div><span class="status-pill ${issues.length ? 'is-danger' : 'is-success'}">${issues.length ? '需返回处理' : '可以进入论文'}</span></div>
    <article class="confirmation-card"><span>设计题目</span><h3>${escapeHtml(project.title)}</h3><div class="metric-row"><span><b>${project.scheme.devices.length}</b> 个器件</span><span><b>${project.scheme.functions.length}</b> 项功能</span><span><b>${complete}</b> 项实现闭环</span><span><b>${issues.length}</b> 项关键问题</span></div></article>
    ${issues.length ? `<div class="notice notice-danger">还有 ${issues.length} 项未完成，目前只能保存方案草稿。请返回修改：${escapeHtml(issues[0])}</div>` : ''}
    <div class="closure-confirm-list">${cards}</div>
    <div class="device-usage-grid"><section><h3>公共器件及用途</h3>${common.length ? common.map(device => `<p><strong>${escapeHtml(device.model)}</strong><span>服务 ${device.count} 项功能</span></p>`).join('') : '<p class="muted-text">没有跨功能复用的器件</p>'}</section><section><h3>尚未参与任何功能的器件</h3>${unused.length ? unused.map(device => `<p><strong>${escapeHtml(device.model)}</strong><span>请确认是否确有需要</span></p>`).join('') : '<p class="muted-text">全部器件都有明确用途</p>'}</section></div>
    <div class="panel-actions"><button class="btn btn-secondary" type="button" data-action="scheme-step" data-step="3">返回查看AI复核</button><button class="btn btn-secondary" type="button" data-action="export-scheme">导出方案</button><button class="btn btn-primary" type="button" data-action="confirm-scheme" ${issues.length ? 'disabled' : ''}>锁定方案并开始论文</button></div>`;
}

function toSchemeMarkdown() {
  const closures = closureSummaryRows().map((item, index) => `### ${index + 1}. ${item.functionName}\n- 输入器件：${item.inputs.join('、') || '无独立输入器件'}\n- 主控与处理器件：${item.processingDevices.join('、') || '未单独指定'}\n- 处理过程：${item.processDescription || '待补充'}\n- 输出器件：${item.outputs.join('、') || '无独立输出器件'}\n- 辅助器件：${item.supportingDevices.join('、') || '无'}\n- 验证方法：${item.verificationMethod || '待补充'}`).join('\n\n');
  return `# ${project.title}\n\n**器件**：${project.scheme.devices.join('，')}\n\n**功能**：\n${project.scheme.functions.map(item => `- [x] ${item}`).join('\n')}\n\n## 已确认的功能实现关系\n\n${closures}`;
}

function parseSchemeFallback(text) {
  const clean = stripThink(text);
  const deviceLine = clean.match(/\*\*器件\*\*[：:]\s*([^\n]+)/)?.[1] || '';
  const devices = unique(deviceLine.split(/[，,、；;]/).map(item => item.trim()).filter(Boolean));
  const functions = unique([...clean.matchAll(/^\s*-\s*\[[ xX]?\]\s*(.+)$/gm)].map(match => match[1].trim()));
  return { topic: project.title, devices, functions, markdown: clean };
}

function schemeValidationOptions() {
  return {
    expectedTopic: project.title,
    level: project.level,
    mode: project.sourceMode,
    userText: `${project.background}\n${project.requirements}`,
    allowedDevices: project.sourceMode === 'extract' ? extractExpectedItems(project.sourceText, 'device') : [],
    allowedFunctions: project.sourceMode === 'extract' ? extractExpectedItems(project.sourceText, 'function') : [],
    explicitDevices: [project.preferences.mcu, project.preferences.display, project.preferences.power].filter(Boolean),
  };
}

function schemeCandidateFromParsed(parsed) {
  return normalizeKnownValues({
    topic: parsed.topic || project.title,
    level: parsed.level || project.level,
    overview: parsed.overview || {},
    architecture: parsed.architecture || {},
    devices: (parsed.devices || []).map(item => ({
      model: item.model || item.name || '',
      role: item.role || '',
      selectionReason: item.selectionReason || '',
      source: item.source || 'ai_suggestion',
    })),
    functions: (parsed.functions || parsed.funcs || []).map(item => ({
      text: item.name || item.text || '',
      description: item.description || '',
      source: item.source || 'ai_suggestion',
    })),
    implementationNotes: parsed.implementationNotes || {},
    conflicts: Array.isArray(parsed.conflicts) ? parsed.conflicts : [],
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
  });
}

function validateSchemeCandidate(candidate) {
  if (typeof Rules.validateSchemeResult !== 'function') return { errors: [], warnings: [], data: candidate };
  return Rules.validateSchemeResult(candidate, schemeValidationOptions());
}

function inferSchemeTitle(text) {
  const source = normalizeKnownText(text || '');
  const named = source.match(/(?:^|\n)\s*(?:题目|课题名称|设计名称|项目名称)\s*[：:]\s*([^\n]{2,100})/i)?.[1];
  if (named) return named.replace(/^[#*\-\s]+|[#*\-\s]+$/g, '').trim();
  const heading = source.match(/(?:^|\n)\s*#\s+([^\n]{2,100})/)?.[1];
  if (heading) return heading.trim();
  const first = source.split(/\r?\n/)
    .map(item => item.replace(/^\s*(?:[-*#]+|\d+[.、])\s*/, '').trim())
    .find(item => item.length >= 4 && item.length <= 100 && !/^(?:摘要|目录|项目概述|总体方案|设计方案|一[、.]|第[一二三四五六七八九十\d]+章)/.test(item));
  return first || '';
}

function extractImportedSchemeSummary(text) {
  const source = normalizeKnownText(text || '');
  const rows = source.split(/\r?\n/).map(item => item.trim()).filter(Boolean);
  const collectSection = headingPattern => {
    const values = [];
    let active = false;
    for (const raw of rows) {
      const heading = raw.replace(/^[#\s]+/, '').trim();
      if (headingPattern.test(heading)) {
        active = true;
        continue;
      }
      if (active && /^(?:#{1,4}\s*|第[一二三四五六七八九十\d]+[章节]|[一二三四五六七八九十]+[、.])/.test(raw)) break;
      if (!active) continue;
      const value = raw
        .replace(/^\s*(?:[-*+]\s*|\d+[、.]\s*)/, '')
        .split(/[：:]/)[0]
        .replace(/[。；;]+$/, '')
        .trim();
      if (value && value.length <= 60) values.push(value);
    }
    return values;
  };
  const modelMatches = extractExpectedItems(source, 'device').filter(item => !/^(?:I2C|SPI|UART|ADC|PWM|USB|DC|AC|GPIO)$/i.test(item));
  const sectionDevices = collectSection(/(?:主要器件|器件清单|元器件|硬件组成|器件及选型)/);
  const sectionFunctions = collectSection(/(?:主要功能|功能清单|系统功能|功能设计)/)
    .map(item => item.replace(/功能$/, '').trim())
    .filter(item => item.length >= 2);
  const structuredDevices = sectionDevices.filter(item => /(?:STM32|STC|AT89|ESP|Arduino|OLED|LCD|传感器|模块|电机|继电器|蜂鸣器|按键|电源)/i.test(item));
  const devices = unique(structuredDevices.length ? structuredDevices : modelMatches);
  const functions = unique(sectionFunctions.length ? sectionFunctions : extractExpectedItems(source, 'function'));
  return { devices, functions };
}

function saveImportedScheme() {
  const markdown = normalizeKnownText(project.sourceText || '').trim();
  if (!markdown) {
    toast('请粘贴已有方案或导入方案文件', 'error');
    return;
  }
  project.title = (project.title || inferSchemeTitle(markdown)).trim();
  if (!project.title) {
    toast('没有从方案中识别到题目，请在上方补充方案题目', 'error');
    schemeStep = 1;
    renderScheme();
    $('scheme-title')?.focus();
    return;
  }
  const extracted = extractImportedSchemeSummary(markdown);
  const deviceRecords = reconcileEntityRecords(extracted.devices, [], 'device');
  const functionRecords = reconcileEntityRecords(extracted.functions, [], 'function');
  project.sourceMode = 'import';
  project.sourceText = markdown;
  project.scheme = normalizeSchemeRelations({
    ...project.scheme,
    status: 'generated',
    markdown,
    structured: null,
    devices: deviceRecords.map(item => item.label),
    functions: functionRecords.map(item => item.name),
    deviceRecords,
    functionRecords,
    closures: [],
    relationsStage: 'not-started',
    conflicts: [],
    warnings: [],
    confirmedAt: '',
    inputRevision: project.revision,
    inputSignature: currentSchemeInputSignature(),
    aiReview: { status: 'not-run', verdict: '', summary: '已有方案已按原文保存', changes: [], issues: [], reviewedAt: '' },
  });
  project.scheme.closures = [];
  project.audit = { status: 'not-run', issues: [], summary: '', confirmedAt: '', inputRevision: '' };
  project.outline.confirmedAt = '';
  project.paper.quality = null;
  saveProject({ immediate: true });
  schemeStep = 2;
  renderScheme();
  toast('已有方案已保存，可以直接复制、下载或进入论文', 'success');
}

async function reviewSchemeWithAi(candidate, firstValidation, signal) {
  const reviewerPrompt = `你是单片机项目方案复核员。只核对方案总体说明、系统组成、器件选型和功能说明，不进入论文级细化。不要生成逐功能器件对应关系、程序流程、引脚连接、processDescription、verificationMethod或测试步骤；这些属于论文事实核对阶段。保持原题目，修正明显的方案结构错误和“96寸OLED”等型号错误；资料确实冲突时才阻断。只返回与方案生成规则相同的严格JSON，不要Markdown。`;
  const reviewPayload = {
    candidate,
    deterministicCheckIssues: [
      ...(firstValidation.errors || []).map(item => item.message || String(item)),
      ...(firstValidation.warnings || []).map(item => item.message || String(item)),
    ],
  };
  const raw = await callAi([
    { role: 'system', content: reviewerPrompt },
    { role: 'user', content: JSON.stringify(reviewPayload, null, 2) },
  ], { temperature: 0.1, maxTokens: 16384, model: 'thinking', jsonMode: true, signal });
  const envelope = normalizeKnownValues(parseJsonResponse(raw));
  const reviewedSource = envelope.scheme || envelope.correctedScheme || envelope;
  const parsed = typeof Rules.parseSchemeResult === 'function'
    ? Rules.parseSchemeResult(reviewedSource)
    : reviewedSource;
  if (!parsed.topic || !parsed.devices?.length || !parsed.functions?.length) throw new Error('AI复核没有返回完整方案，请重新生成');
  const validation = validateSchemeCandidate(schemeCandidateFromParsed(parsed));
  const conflicts = Array.isArray(parsed.conflicts) ? parsed.conflicts : [];
  const localIssues = (validation.errors || []).map(item => item.message || String(item));
  const rawVerdict = String(envelope.verdict || '').trim().toLowerCase();
  const verdict = ['pass', 'ok', 'approved'].includes(rawVerdict)
    ? 'pass'
    : ['revised', 'corrected', 'fixed'].includes(rawVerdict)
      ? 'revised'
      : ['blocked', 'fail', 'failed', 'rejected'].includes(rawVerdict)
        ? 'blocked'
        : 'unknown';
  const verdictIssue = verdict === 'unknown' ? 'AI复核没有返回可识别的结论，请重新生成并复核' : '';
  const blocked = localIssues.length > 0 || conflicts.length > 0 || verdict === 'blocked' || verdict === 'unknown';
  return {
    parsed,
    validation,
    review: {
      status: blocked ? 'blocked' : 'passed',
      verdict: blocked ? 'blocked' : verdict,
      summary: String(envelope.summary || (blocked ? 'AI复核发现需要重新生成或补充的信息。' : 'AI已完成器件—功能关系复核，未发现明显问题。')).trim(),
      changes: unique((Array.isArray(envelope.changes) ? envelope.changes : []).map(item => String(item).trim()).filter(Boolean)),
      issues: unique([verdictIssue, ...localIssues, ...conflicts.map(item => String(item.detail || item.message || item.reason || item))].filter(Boolean)),
      reviewedAt: nowIso(),
    },
  };
}

async function generateScheme() {
  if (!project.title) {
    schemeStep = 1;
    renderScheme();
    toast('请先填写题目', 'error');
    return;
  }
  const sourceMode = 'create';
  if (!$('scheme-ai-consent')?.checked) {
    toast('请先勾选AI资料处理说明', 'error');
    $('scheme-ai-consent')?.focus();
    return;
  }
  project.consents.schemeAiReviewDisclosure = true;
  saveProject({ immediate: true });
  const userMessage = `【工作模式】create\n【题目】${project.title}\n【最高优先级：用户补充信息和必须实现的要求】\n${project.requirements || '未填写'}\n【次级参考：难度等级】${project.level}（只补充用户未说明的内容，不得覆盖、删减或替换上面的明确要求）\n【主控偏好】${project.preferences.mcu || '自动推荐'}\n【显示器偏好】${project.preferences.display || '自动判断'}\n【供电偏好】${project.preferences.power || '自动推荐'}\n\n若补充信息与等级惯例不一致，以补充信息为准，不要为凑等级数量添加无关功能。请生成完整、清楚、可直接使用的项目方案。`;
  requestController = new AbortController();
  requestTask = 'scheme';
  showBusy('正在生成详细方案', 'AI会检查题目、器件、功能和总体结构是否完整');
  try {
    const raw = await callAi([
      { role: 'system', content: Rules.SCHEME_SYSTEM_PROMPT || Rules.SOLUTION_SYSTEM_PROMPT || '严格生成题目、器件、功能三段式单片机方案。' },
      { role: 'user', content: userMessage },
    ], { temperature: 0.45, signal: requestController.signal });
    const firstParsed = typeof Rules.parseSchemeResult === 'function'
      ? Rules.parseSchemeResult(raw, project.title)
      : parseSchemeFallback(raw);
    const candidate = schemeCandidateFromParsed(firstParsed);
    if (!candidate.topic || !candidate.devices.length || !candidate.functions.length) {
      throw new Error('AI没有返回完整的题目、器件和功能，请重新处理');
    }
    const validation = validateSchemeCandidate(candidate);
    const blockingValidationErrors = (validation.errors || []).filter(item => item.code !== 'scheme_unresolved_conflicts');
    if (blockingValidationErrors.length) throw new Error(blockingValidationErrors[0].message || '方案内容不完整，请重新生成');
    const parsed = stripInternalSchemeLevelText(validation.data || firstParsed);
    if (parsed.topic && parsed.topic !== project.title) throw new Error('生成结果修改了原题目，请重新生成');
    const rawDevices = parsed.devices || [];
    const rawFunctions = parsed.functions || parsed.funcs || [];
    const deviceRecords = reconcileEntityRecords(rawDevices.map((item, index) => {
      const record = parseDeviceValue(item);
      return { ...record, sourceRef: record.sourceRef || (typeof item === 'object' ? item.ref : '') || `D${index + 1}` };
    }), [], 'device');
    const functionRecords = reconcileEntityRecords(rawFunctions.map((item, index) => {
      const record = parseFunctionValue(item);
      return { ...record, sourceRef: record.sourceRef || (typeof item === 'object' ? item.ref : '') || `F${index + 1}` };
    }), [], 'function');
    const devices = deviceRecords.map(device => device.label);
    const functions = functionRecords.map(func => func.name);
    if (!deviceRecords.length || !functionRecords.length) throw new Error('生成结果缺少器件或功能，请重新生成');
    const rawConflicts = stripInternalSchemeLevelText(Array.isArray(parsed.conflicts) ? parsed.conflicts : []);
    const structured = stripInternalSchemeLevelText(normalizeKnownValues({
      topic: parsed.topic || project.title,
      level: parsed.level || project.level,
      overview: parsed.overview || {},
      architecture: parsed.architecture || {},
      devices: rawDevices,
      functions: rawFunctions,
      implementationNotes: parsed.implementationNotes || {},
      conflicts: rawConflicts,
      warnings: parsed.warnings || [],
    }));
    project.scheme = normalizeSchemeRelations({
      ...project.scheme,
      status: 'generated',
      markdown: '',
      structured,
      devices,
      functions,
      deviceRecords,
      functionRecords,
      closures: [],
      relationsStage: 'not-started',
      conflicts: rawConflicts.map(normalizeSchemeConflict),
      warnings: [
        ...(Array.isArray(parsed.warnings) ? parsed.warnings : []),
        ...(validation.warnings || []),
      ],
      aiReview: { status: 'passed', verdict: 'pass', summary: '方案结构检查通过', changes: [], issues: [], reviewedAt: nowIso() },
      inputRevision: project.revision,
      inputSignature: currentSchemeInputSignature(),
    });
    project.scheme.closures = [];
    project.scheme.markdown = buildSchemeDocumentText(structured);
    saveProject({ immediate: true });
    schemeStep = 2;
    renderScheme();
    toast('详细方案已经生成完成', 'success');
  } catch (error) {
    if (error.name !== 'AbortError') toast(error.message || '方案生成失败', 'error');
  } finally {
    hideBusy();
    requestController = null;
    requestTask = '';
  }
}

function extractExpectedItems(text, kind) {
  const source = String(text || '');
  const pattern = kind === 'device'
    ? /(?:STM32\w*|STC\w*|AT89\w*|ESP32|ESP8266|Arduino\s*Uno|\d+(?:\.\d+)?\s*(?:英寸|寸)\s*OLED|OLED(?:显示屏)?|[A-Z]{1,8}-?\d{1,8}[A-Z0-9-]*)/gi
    : /(?:采集|检测|监测|显示|报警|控制|通信|上传|调节|定位|识别)[^。；;\n]{0,40}/g;
  return unique(source.match(pattern) || []);
}

function confirmScheme() {
  const issues = [];
  if (!project.title) issues.push('方案题目尚未填写');
  if (!project.scheme.markdown) issues.push('方案正文尚未生成');
  if (!['generated', 'confirmed'].includes(project.scheme.status) || project.scheme.inputSignature !== currentSchemeInputSignature()) issues.push('方案资料已经修改，请重新生成或保存');
  unresolvedSchemeConflicts().forEach(item => issues.push(`方案冲突待处理：${item.detail}`));
  if (issues.length) {
    toast(issues[0], 'error');
    schemeStep = project.scheme.markdown ? 2 : 1;
    renderScheme();
    return;
  }
  const confirmedAt = nowIso();
  project.scheme.status = 'confirmed';
  project.scheme.confirmedAt = confirmedAt;
  project.scheme.aiReview = { status: 'passed', verdict: 'pass', summary: '方案已确认使用', changes: [], issues: [], reviewedAt: confirmedAt };
  project.scheme.inputRevision = project.revision;
  project.scheme.inputSignature = currentSchemeInputSignature();
  const paperHasOwnWork = Boolean(project.materials.devicesText || project.materials.functionsText || project.materials.sourceNotes)
    || project.audit.status !== 'not-run'
    || Boolean(project.outline.confirmedAt)
    || Object.values(project.paper.chapters || {}).some(chapter => chapter?.content);
  if (!paperHasOwnWork) {
    const previousFacts = factsSignature();
    project.materials.devicesText = project.scheme.devices.join('\n');
    project.materials.functionsText = project.scheme.functions.join('\n');
    project.materials.sourceNotes = project.scheme.markdown;
    project.paper.sourceMode = 'scheme';
    project.paper.sourceSchemeRevision = project.scheme.inputSignature;
    project.paper.stage = 1;
    invalidateIfFactsChanged(previousFacts);
  }
  saveProject({ immediate: true });
  toast('方案已确认，接下来补充论文资料并进行细化核对', 'success');
  setView('paper', 1);
}

function renderPaper() {
  paperStep = Math.max(1, Math.min(4, Number(paperStep) || 1));
  const workspaceSubtitle = $('paper-workspace-subtitle');
  if (workspaceSubtitle) workspaceSubtitle.textContent = `当前项目：${project.title || '尚未命名'}`;
  const overallStatus = $('paper-overall-status');
  if (overallStatus) overallStatus.textContent = `第 ${paperStep} / 4 步`;
  const paperSaveState = $('paper-save-state');
  if (paperSaveState) paperSaveState.textContent = project.paper.generation?.status === 'completed' ? '论文已保存' : '内容自动保存';
  renderStepNav($('paper-step-nav'), ['资料确认', '事实核对', '目录规划', '生成论文'], paperStep, 'paper-step');
  for (let i = 1; i <= 5; i += 1) {
    const panel = $(`paper-step-${i}`);
    if (panel) panel.hidden = i !== paperStep;
  }
  const panel = $(`paper-step-${paperStep}`);
  if (!panel) return;
  if (paperStep === 1) renderPaperMaterials(panel);
  if (paperStep === 2) renderFactAudit(panel);
  if (paperStep === 3) renderOutline(panel);
  if (paperStep === 4) renderPaperGeneration(panel);
}

function renderPaperMaterials(panel) {
  const materials = project.materials;
  const canImportScheme = isSchemeReadyForPaper();
  const usingScheme = project.paper.sourceMode === 'scheme' && canImportScheme;
  panel.innerHTML = `
    <div class="panel-heading"><div><span class="step-kicker">第 1 步</span><h2>把论文需要的实际资料集中放进来</h2><p>论文功能可以独立使用。已有自己的设计方案时，直接填写或粘贴资料，不需要先用网站生成方案。</p></div><span class="status-pill">${usingScheme ? '已带入网站方案' : '论文独立模式'}</span></div>
    <div class="notice notice-info">论文资料与方案模块相互独立：你在这里修改题目、器件、功能和说明，不会改动已经生成的方案。${canImportScheme ? '如需复用网站方案，可点击下方按钮一键带入。' : ''}</div>
    ${canImportScheme ? `<div class="panel-actions compact-actions"><button class="btn btn-secondary" type="button" data-action="use-scheme-for-paper">带入已确认的网站方案</button></div>` : ''}
    <div class="form-grid">
      <label class="field field-wide"><span>论文题目 <b>必填</b></span><input id="paper-title" value="${escapeHtml(project.title)}" placeholder="题目会在全文保持一致"></label>
      <label class="field"><span>实际器件清单 <small>不确定可留空</small><small>一行一个；已知内容始终优先，留空时由AI提出器件建议供你确认</small></span><textarea id="paper-devices" rows="10" placeholder="例如：STM32F103C8T6\n0.96寸OLED\nDHT11">${escapeHtml(materials.devicesText)}</textarea></label>
      <label class="field"><span>实际功能清单 <small>不确定可留空</small><small>一行一个；已知内容始终优先，留空时由AI提出功能建议供你确认</small></span><textarea id="paper-functions" rows="10" placeholder="例如：温湿度采集\n数据显示\n超限报警">${escapeHtml(materials.functionsText)}</textarea></label>
      <label class="field field-wide"><span>已有方案、任务书或补充设计说明 <small>选填</small></span><textarea id="paper-source-notes" rows="10" placeholder="可直接粘贴你自己设计的完整方案、任务书要求或其他说明；AI写论文时会把这里的内容作为重要依据。">${escapeHtml(materials.sourceNotes)}</textarea></label>
      <label class="field field-wide"><span>原理图连接关系或硬件说明 <small>选填</small></span><textarea id="paper-connections" rows="8" placeholder="例如：DHT11 数据端接主控 PA1；OLED 使用 I²C 通信……">${escapeHtml(materials.connectionText)}</textarea></label>
      <div class="field field-wide"><label for="paper-code"><span>单片机源程序或程序逻辑 <small>选填</small></span></label><textarea id="paper-code" rows="10" placeholder="可以粘贴源程序。正文只会提取业务逻辑，不会插入代码或使用函数名介绍。">${escapeHtml(materials.codeText)}</textarea><label class="file-button" for="paper-code-files">选择 C、H、TXT 文件<input id="paper-code-files" type="file" accept=".c,.h,.txt,.ino,.cpp" multiple hidden></label></div>
      <label class="field field-wide"><span>参考文献 <small>选填</small></span><textarea id="paper-references" rows="8" placeholder="没有参考文献可留空；有文献时请粘贴完整 GB/T 7714 条目。也可使用：作者｜题目｜J｜期刊名｜年份｜卷(期)｜页码｜摘要｜国内/国外">${escapeHtml(materials.referencesText)}</textarea><small>留空时按“无参考文献模式”正常生成，不写引用编号和文末参考文献；粘贴后只使用你提供的条目，不联网补充、不替换。期刊条目应含期刊名、年份、卷（期）和页码，学位论文应含授予单位和年份。</small></label>
      <label class="field field-wide"><span>学校目录或往届论文目录 <small>选填</small></span><textarea id="paper-school-outline" rows="8" placeholder="没有可以留空，系统会按项目自动规划">${escapeHtml(materials.schoolOutline)}</textarea></label>
      <label class="field"><span>测试、调试和操作记录 <small>选填</small></span><textarea id="paper-test-info" rows="7" placeholder="填写使用的工具、软件、操作方法和已有测试数据；没有数据时系统会按器件能力生成保守的量化测试表">${escapeHtml(materials.testInfo)}</textarea></label>
      <label class="field"><span>实物照片和待插图说明 <small>选填</small></span><textarea id="paper-photo-notes" rows="7" placeholder="写明有哪些实物图、功能展示图；图片后续由你在 WPS 中插入">${escapeHtml(materials.photoNotes)}</textarea></label>
    </div>
    <div class="panel-actions"><button class="btn btn-secondary" type="button" data-action="go-home">返回首页</button><button class="btn btn-primary" type="button" data-action="save-paper-materials">保存资料并开始核对</button></div>`;
}

function useSchemeForPaper() {
  if (!isSchemeReadyForPaper()) {
    toast('当前没有已确认的网站方案可带入', 'error');
    return;
  }
  const previousFacts = factsSignature();
  project.materials.devicesText = project.scheme.devices.join('\n');
  project.materials.functionsText = project.scheme.functions.join('\n');
  project.materials.sourceNotes = project.scheme.markdown;
  project.paper.sourceMode = 'scheme';
  project.paper.sourceSchemeRevision = project.scheme.inputSignature;
  invalidateIfFactsChanged(previousFacts);
  saveProject({ immediate: true });
  renderPaper();
  toast('已带入网站方案，之后仍可在论文中独立修改', 'success');
}

function capturePaperMaterials() {
  const title = $('paper-title')?.value.trim() || '';
  const devices = unique(lines($('paper-devices')?.value));
  const functions = unique(lines($('paper-functions')?.value));
  if (!title) {
    toast('请先填写论文题目；其他资料不完整时可以由AI提出建议', 'error');
    return false;
  }
  const previousFacts = factsSignature();
  project.title = title;
  project.materials = {
    ...project.materials,
    devicesText: devices.join('\n'),
    functionsText: functions.join('\n'),
    sourceNotes: $('paper-source-notes')?.value.trim() || '',
    connectionText: $('paper-connections')?.value.trim() || '',
    codeText: $('paper-code')?.value.trim() || '',
    referencesText: $('paper-references')?.value.trim() || '',
    schoolOutline: $('paper-school-outline')?.value.trim() || '',
    testInfo: $('paper-test-info')?.value.trim() || '',
    photoNotes: $('paper-photo-notes')?.value.trim() || '',
  };
  if (project.paper.sourceMode === 'scheme') {
    const changedFromScheme = devices.join('\n') !== project.scheme.devices.join('\n')
      || functions.join('\n') !== project.scheme.functions.join('\n')
      || title !== project.scheme.structured?.topic;
    if (changedFromScheme) project.paper.sourceMode = 'independent';
  }
  invalidateIfFactsChanged(previousFacts);
  project.paper.stage = 2;
  saveProject({ immediate: true });
  return true;
}

function factsSignature() {
  return JSON.stringify({
    title: project.title,
    devices: paperDevices(),
    functions: paperFunctions(),
    sourceNotes: project.materials.sourceNotes,
    connections: project.materials.connectionText,
    code: project.materials.codeText,
    tests: project.materials.testInfo,
    references: project.materials.referencesText,
  });
}

function invalidateIfFactsChanged(previousSignature, { preserveAudit = false } = {}) {
  if (previousSignature === factsSignature()) return;
  project.revision = `facts-${Date.now()}`;
  if (!preserveAudit) {
    project.audit = {
      ...project.audit,
      status: 'stale',
      issues: [],
      summary: '资料已修改，请重新运行AI检查。',
      factSheet: normalizeFactSheet(null),
      confirmationSignature: '',
      confirmedAt: '',
      inputRevision: '',
    };
  }
  project.outline.confirmedAt = '';
  Object.values(project.paper.chapters || {}).forEach(chapter => {
    if (chapter?.content) chapter.status = 'stale';
  });
  project.paper.status = 'draft';
  project.paper.quality = null;
  project.paper.abstractCn = '';
  project.paper.abstractEn = '';
  project.paper.keywords = '';
  project.paper.acknowledgment = '';
  project.paper.referenceOrder = [];
  project.paper.semanticIssues = [];
  project.paper.semanticCheckedAt = '';
  project.paper.generation = {
    ...freshPaperGeneration('项目资料已变化，需要基于新资料重新生成'),
    status: Object.values(project.paper.chapters || {}).some(chapter => chapter?.content) ? 'paused' : 'idle',
  };
}

function localFactIssues() {
  const issues = [];
  if (!project.title) issues.push({ severity: 'blocking', title: '论文题目缺失', detail: '请先填写并确认论文题目。' });
  if (!paperDevices().length) issues.push({ severity: 'blocking', field: 'devices', applyMode: 'replace-empty', title: '器件清单缺失', detail: '需要确认主控和核心器件；AI会根据题目与已有说明先给出建议。' });
  else if (!paperDevices().some(isControllerFact)) {
    issues.push({ severity: 'blocking', field: 'devices', applyMode: 'append', title: '主控型号尚未明确', detail: '当前器件清单没有识别到主控制器，需要确认实际主控后才能锁定硬件事实。' });
  }
  if (!paperFunctions().length) issues.push({ severity: 'blocking', field: 'functions', applyMode: 'replace-empty', title: '功能清单缺失', detail: '需要确认论文实际覆盖的核心功能；AI会根据题目与已有说明先给出建议。' });
  if (!project.materials.connectionText) issues.push({ severity: 'confirm', title: '连接关系尚未提供', detail: '硬件章节只能采用保守描述，最终稿前建议补充。' });
  if (!project.materials.codeText) issues.push({ severity: 'confirm', title: '源程序尚未提供', detail: '软件章节只能按已确认功能描述通用业务流程。' });
  if (!project.materials.testInfo) issues.push({ severity: 'writing', title: '测试记录尚未提供', detail: '系统会依据器件能力和功能逻辑生成保守、可编辑的量化测试数据表，请在定稿前按实物情况调整。' });
  return issues.map(normalizeIssue);
}

function normalizeFactSheet(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const recommendedDevices = normalizedFactList(source.recommendedDevices || source.devices);
  const recommendedFunctions = normalizedFactList(source.recommendedFunctions || source.functions);
  return {
    recommendedDevices,
    coreDevices: normalizedFactList(source.coreDevices).length ? normalizedFactList(source.coreDevices) : recommendedDevices,
    recommendedFunctions,
    coreFunctions: normalizedFactList(source.coreFunctions).length ? normalizedFactList(source.coreFunctions) : recommendedFunctions,
    fixedFacts: normalizedFactList(source.fixedFacts || source.commonFacts),
  };
}

function suggestedFactIssues(factSheet) {
  const issues = [];
  if (!paperDevices().length) {
    const values = factSheet.recommendedDevices;
    issues.push(normalizeIssue({
      severity: 'blocking', field: 'devices', applyMode: 'replace-empty', title: '器件清单缺失',
      detail: values.length ? '以下器件是AI根据题目和已有说明整理的建议，采用前只需核对是否符合实际项目。' : 'AI暂时没有得到可采用的明确器件型号，请返回资料页填写实际主控和核心器件。',
      suggestion: values.length ? values.join('；') : '', suggestedValues: values, autoApplicable: true,
    }));
  } else if (!paperDevices().some(isControllerFact)) {
    const controllers = factSheet.recommendedDevices.filter(isControllerFact);
    issues.push(normalizeIssue({
      severity: 'blocking', field: 'devices', applyMode: 'append', title: '主控型号尚未明确',
      detail: controllers.length ? 'AI根据题目和已有器件推定了常用主控，请核对实际型号。' : 'AI暂时没有得到可采用的明确主控型号，请返回资料页填写实际主控。',
      suggestion: controllers.length ? controllers.join('；') : '', suggestedValues: controllers, autoApplicable: true,
    }));
  }
  if (!paperFunctions().length) {
    const values = factSheet.recommendedFunctions;
    issues.push(normalizeIssue({
      severity: 'blocking', field: 'functions', applyMode: 'replace-empty', title: '功能清单缺失',
      detail: values.length ? '以下功能是AI根据题目和已有说明归纳的建议，采用前请核对是否确实需要实现。' : 'AI暂时没有得到可采用的明确功能，请返回资料页填写实际实现的核心功能。',
      suggestion: values.length ? values.join('；') : '', suggestedValues: values, autoApplicable: true,
    }));
  }
  return issues;
}

function normalizeIssue(issue, index = 0) {
  const severityMap = { blocker: 'blocking', must: 'blocking', warning: 'confirm', suggestion: 'writing' };
  return {
    id: issue.id || makeId(`issue-${index}`),
    severity: severityMap[issue.severity] || issue.severity || 'confirm',
    title: issue.title || issue.field || issue.message || '需要确认',
    detail: issue.detail || issue.description || issue.reason || '',
    impact: issue.impact || issue.affected || '',
    suggestion: issue.suggestion || issue.recommendation || '',
    field: ['devices', 'functions'].includes(issue.field) ? issue.field : '',
    applyMode: issue.applyMode || '',
    suggestedValues: normalizedFactList(issue.suggestedValues || issue.values),
    autoApplicable: Boolean(issue.autoApplicable),
    resolved: Boolean(issue.resolved),
    resolution: issue.resolution || '',
    finalResolution: issue.finalResolution || '',
  };
}

function normalizeAiFactIssue(value, index = 0) {
  const issue = normalizeIssue(value, index);
  const evidenceText = `${issue.title}\n${issue.detail}\n${issue.impact}`;
  const hasExplicitConflict = /冲突|矛盾|不一致|不相符|相左|前后不同|分别写(?:为|成)|一处.+另一处|两处.+不同/u.test(evidenceText);
  const coreFactsStillMissing = (issue.field === 'devices' && (!paperDevices().length || !paperDevices().some(isControllerFact)))
    || (issue.field === 'functions' && !paperFunctions().length);
  if (issue.severity === 'blocking' && !hasExplicitConflict && !coreFactsStillMissing) issue.severity = 'confirm';
  const soften = text => String(text || '')
    .replace(/系统无法实现/g, '现有资料不足以确认具体实现细节')
    .replace(/功能无法实现/g, '现有资料不足以确认该功能的具体实现细节')
    .replace(/论文无法体现系统实际运行效果[^。]*。?/g, '目前缺少可核对的系统实际运行记录，相关展示内容应保守表述。')
    .replace(/论文无法编写程序代码/g, '论文不应猜写具体程序代码')
    .replace(/均无法确定/g, '尚不能按实际项目参数确定')
    .replace(/无法确定/g, '尚不能按实际项目参数确定');
  issue.detail = soften(issue.detail);
  issue.impact = soften(issue.impact);
  return issue;
}

function renderFactAudit(panel) {
  project.audit.issues = (project.audit.issues || []).map(normalizeAiFactIssue);
  const issues = project.audit.issues;
  const blocking = issues.filter(issue => issue.severity === 'blocking' && !issue.resolved).length;
  const auditSummary = !blocking && issues.length
    ? '未发现会阻断写作的核心事实冲突。未提供的连接、程序和测试细节将按保守策略处理，可直接继续。'
    : project.audit.summary;
  panel.innerHTML = `
    <div class="panel-heading"><div><span class="step-kicker">第 2 步</span><h2>先解决资料之间的不一致</h2><p>系统会把题目、器件、连接、程序和功能放在一起核对；未确认的引脚、地址、电压和阈值不会直接写入正文。</p></div><span class="status-pill ${blocking ? 'is-danger' : ''}">${issues.length ? `${blocking} 项必须解决` : '尚未检查'}</span></div>
    ${auditSummary ? `<div class="notice notice-info">${escapeHtml(auditSummary)}</div>` : ''}
    ${project.audit.factSheet?.coreDevices?.length || project.audit.factSheet?.coreFunctions?.length ? `<div class="notice notice-info"><strong>AI项目事实建议表</strong><p>核心器件：${escapeHtml((project.audit.factSheet.coreDevices || []).join('、') || '等待确认')}<br>核心功能：${escapeHtml((project.audit.factSheet.coreFunctions || []).join('、') || '等待确认')}</p><small>只会补充你没有填写的器件或功能；你已经填写的事实始终优先。</small></div>` : ''}
    <div class="issue-list">${issues.length ? issues.map(renderIssueCard).join('') : '<div class="empty-state"><span>✓</span><h3>等待资料核对</h3><p>点击下方按钮后，系统会集中列出需要确认的内容。</p></div>'}</div>
    <label class="ai-disclosure-check"><input id="paper-ai-audit-consent" type="checkbox" ${project.consents.paperFactAuditDisclosure ? 'checked' : ''}> 我知道：点击AI检查后，论文题目、已有方案或任务书说明、器件与功能清单、连接说明、程序文字和测试记录会发送给已配置的AI服务进行核对。</label>
        <div class="panel-actions"><button class="btn btn-secondary" type="button" data-action="paper-step" data-step="1">返回补充资料</button><button class="btn btn-secondary" id="ai-audit-facts" type="button" data-action="run-fact-audit">${project.audit.status === 'reviewing' ? '重新检查资料' : 'AI 检查资料'}</button>${project.audit.status === 'reviewing' ? '<button class="btn btn-primary" type="button" data-action="confirm-facts">确认已处理并继续</button>' : ''}</div>`;
}

function renderIssueCard(issue) {
  const labels = { blocking: '必须解决', confirm: '建议确认', writing: '写作优化' };
  const canAdoptSuggestion = Boolean(issue.autoApplicable && issue.suggestion && issue.field && issue.suggestedValues?.length);
  return `<article class="issue-card issue-${escapeHtml(issue.severity)} ${issue.resolved ? 'is-resolved' : ''}" data-issue-id="${escapeHtml(issue.id)}">
    <div class="issue-heading"><span>${labels[issue.severity] || '建议确认'}</span><h3>${escapeHtml(issue.title)}</h3></div>
    ${issue.detail ? `<p>${escapeHtml(issue.detail)}</p>` : ''}
    ${issue.impact ? `<small>会影响：${escapeHtml(Array.isArray(issue.impact) ? issue.impact.join('、') : issue.impact)}</small>` : ''}
    ${issue.suggestion ? `<div class="issue-suggestion">建议：${escapeHtml(issue.suggestion)}</div>` : ''}
    ${canAdoptSuggestion ? `<button class="btn btn-secondary btn-small" type="button" data-action="accept-issue-suggestion" data-issue-id="${escapeHtml(issue.id)}">采用这条建议</button>` : ''}
    <label class="resolution"><span>你的确认或实际情况</span><input value="${escapeHtml(issue.resolution)}" data-issue-resolution="${escapeHtml(issue.id)}" placeholder="填写实际情况，或点击上方按钮采用建议"></label>
    <label class="check-row"><input type="checkbox" data-issue-resolved="${escapeHtml(issue.id)}" ${issue.resolved ? 'checked' : ''}> 我已核对并确认这项内容</label>
  </article>`;
}

async function runFactAudit() {
  if (!paperSourceReady()) {
    setView('paper', 1);
    toast('请先填写论文题目；器件和功能不确定时可以留空由AI建议', 'error');
    return;
  }
  if (!$('paper-ai-audit-consent')?.checked) {
    toast('请先阅读并勾选AI资料处理说明', 'error');
    $('paper-ai-audit-consent')?.focus();
    return;
  }
  project.consents.paperFactAuditDisclosure = true;
  saveProject({ immediate: true });
  const baseIssues = localFactIssues();
  requestController = new AbortController();
  requestTask = 'fact-audit';
  showBusy('正在核对项目事实', '只列出冲突、缺失和需要确认的常识，不会直接修改资料');
  try {
    const prompt = `你是单片机本科论文的项目事实审查员。请比较用户提供的题目、器件、功能、连接关系和程序逻辑，先建立项目事实建议表，再找出真正会导致硬件、软件、测试或论文前后不一致的问题。用户已填写的事实优先级最高，不得替换、删减或改写。若器件或功能留空，根据题目和已有说明给出一套现实、常见、可落地的本科设计建议；建议必须包含明确主控型号、核心器件型号和核心功能，但不要为追求复杂度增加无关功能。固定通信方式等可靠常识可以作为建议，但不能替用户确认实际引脚、阈值、地址、电压或测试数据。\n\n只返回 JSON：\n{"summary":"一句话结论","factSheet":{"recommendedDevices":["完整型号"],"coreDevices":["需要单独介绍和配图的核心器件"],"recommendedFunctions":["功能"],"coreFunctions":["需要完整流程与测试的核心功能"],"fixedFacts":["可确认的固定通信常识"]},"issues":[{"severity":"blocking|confirm|writing","field":"devices|functions|other","title":"问题","detail":"不同资料写了什么或缺少什么","impact":"受影响章节","suggestion":"如何确认","suggestedValues":["需要写入清单的值"]}]}\nblocking 只用于两份用户资料对主控、核心器件、实际连接或关键功能给出明确冲突，或者题目、主控、器件清单、功能清单本身仍未确认。用户已有主控、器件和功能时，具体模块型号、引脚、地址、电压、阈值、源程序或测试数据未提供只能标为 confirm/writing，绝不能阻断，也不得写“系统无法实现”“功能未完成”。资料未提供本身不得让正文停止；不要输出 Markdown。`;
    const context = {
      title: project.title,
      devices: paperDevices(),
      functions: paperFunctions(),
      designSchemeOrTaskNotes: project.materials.sourceNotes || '未提供',
      confirmedFunctionClosures: paperClosureSummary(),
      connections: project.materials.connectionText || '未提供',
      sourceCodeOrLogic: (project.materials.codeText || '未提供').slice(0, 30000),
      testInfo: project.materials.testInfo || '未提供',
    };
    const raw = await callAi([
      { role: 'system', content: prompt },
      { role: 'user', content: JSON.stringify(context, null, 2) },
    ], { temperature: 0.15, maxTokens: 16384, model: 'thinking', jsonMode: true, signal: requestController.signal });
    const result = parseJsonResponse(raw);
    const factSheet = normalizeFactSheet(result.factSheet);
    const aiIssues = Array.isArray(result.issues) ? result.issues.map(normalizeAiFactIssue) : [];
    const mergedIssues = mergeIssues(baseIssues, suggestedFactIssues(factSheet), aiIssues);
    const hasBlockingIssues = mergedIssues.some(issue => issue.severity === 'blocking');
    project.audit = {
      status: 'reviewing',
      issues: mergedIssues,
      summary: hasBlockingIssues
        ? result.summary || '发现需要先确认的核心事实，请处理必须解决项。'
        : '未发现会阻断写作的核心事实冲突。未提供的连接、程序和测试细节将按保守策略处理，可直接继续。',
      factSheet,
      confirmationSignature: project.audit.confirmationSignature || '',
      confirmedAt: '',
      inputRevision: project.revision,
    };
    saveProject({ immediate: true });
    renderPaper();
    toast('资料检查完成，请处理需要确认的内容', 'success');
  } catch (error) {
    if (error.name !== 'AbortError') {
      project.audit = {
        status: 'reviewing',
        issues: baseIssues,
        summary: `已完成基础检查。智能核对暂未完成：${error.message}`,
        factSheet: normalizeFactSheet(project.audit.factSheet),
        confirmationSignature: project.audit.confirmationSignature || '',
        confirmedAt: '',
        inputRevision: project.revision,
      };
      saveProject({ immediate: true });
      renderPaper();
      toast('已保留基础检查结果，可以继续处理', 'info');
    }
  } finally {
    hideBusy();
    requestController = null;
    requestTask = '';
  }
}

function mergeIssues(...groups) {
  const map = new Map();
  groups.flat().filter(Boolean).map(normalizeIssue).forEach(issue => {
    const key = `${issue.field || 'general'}|${issue.title}`.toLowerCase().replace(/\s+/g, '');
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...issue, id: issue.id || makeId('issue') });
      return;
    }
    map.set(key, {
      ...existing,
      ...issue,
      id: existing.id,
      severity: existing.severity === 'blocking' || issue.severity === 'blocking' ? 'blocking' : issue.severity || existing.severity,
      detail: issue.detail || existing.detail,
      suggestion: issue.suggestion || existing.suggestion,
      field: issue.field || existing.field,
      applyMode: issue.applyMode || existing.applyMode,
      suggestedValues: unique([...(existing.suggestedValues || []), ...(issue.suggestedValues || [])]),
      autoApplicable: Boolean(existing.autoApplicable || issue.autoApplicable),
    });
  });
  return [...map.values()];
}

function acceptsSuggestedResolution(value) {
  return /^(?:确认|同意|采用|接受)(?:ai)?建议[。.!！]?$/i.test(String(value || '').trim());
}

function finalIssueResolution(issue) {
  const entered = String(issue?.resolution || '').trim();
  if (acceptsSuggestedResolution(entered)) return issue?.autoApplicable && issue?.suggestion ? String(issue.suggestion).trim() : '';
  return entered || String(issue?.finalResolution || '').trim();
}

function captureIssueEdits() {
  const byId = new Map((project.audit.issues || []).map(issue => [issue.id, issue]));
  qsa('[data-issue-resolution]').forEach(input => {
    const issue = byId.get(input.dataset.issueResolution);
    if (issue) issue.resolution = input.value.trim();
  });
  qsa('[data-issue-resolved]').forEach(input => {
    const issue = byId.get(input.dataset.issueResolved);
    if (!issue) return;
    if (input.checked && !issue.resolution?.trim() && issue.autoApplicable && issue.suggestion && issue.field && issue.suggestedValues?.length) {
      issue.resolution = '确认建议';
      const resolutionInput = qs(`[data-issue-resolution="${CSS.escape(issue.id)}"]`);
      if (resolutionInput) resolutionInput.value = issue.resolution;
    }
    issue.finalResolution = finalIssueResolution(issue);
    issue.resolved = input.checked && Boolean(issue.finalResolution);
  });
}

function parseConfirmedValues(issue) {
  if (acceptsSuggestedResolution(issue.resolution)) return issue.autoApplicable ? normalizedFactList(issue.suggestedValues) : [];
  const value = finalIssueResolution(issue)
    .replace(/^(?:实际|确认|采用|器件|功能|主控)(?:为|是|采用)?[：:\s]*/u, '')
    .trim();
  return unique(value.split(/\r?\n|[；;、，,]+/).map(item => item.trim()).filter(Boolean));
}

function applyConfirmedFactSuggestions() {
  const resolved = (project.audit.issues || []).filter(issue => issue.resolved && ['devices', 'functions'].includes(issue.field));
  const apply = (field, currentValues) => {
    const applicable = resolved.filter(issue => issue.field === field);
    let values = [...currentValues];
    applicable.forEach(issue => {
      const additions = parseConfirmedValues(issue);
      if (!additions.length) return;
      if (issue.applyMode === 'replace-empty') {
        if (!values.length) values = additions;
        return;
      }
      values = unique([...values, ...additions]);
    });
    return values;
  };
  const devices = apply('devices', paperDevices());
  const functions = apply('functions', paperFunctions());
  project.materials.devicesText = devices.join('\n');
  project.materials.functionsText = functions.join('\n');
}

function confirmFacts() {
  if (project.audit.status !== 'reviewing' || project.audit.inputRevision !== project.revision) {
    toast('资料已经变化，请重新运行AI检查后再确认', 'error');
    renderPaper();
    return;
  }
  captureIssueEdits();
  const unresolved = project.audit.issues.filter(issue => issue.severity === 'blocking' && !issue.resolved);
  if (unresolved.length) {
    saveProject({ immediate: true });
    renderPaper();
    toast(`还有 ${unresolved.length} 项关键信息必须解决`, 'error');
    return;
  }
  const previousFacts = factsSignature();
  const confirmedFactSheet = { ...normalizeFactSheet(project.audit.factSheet), fixedFacts: [] };
  const previousConfirmationSignature = String(project.audit.confirmationSignature || '');
  applyConfirmedFactSuggestions();
  if (!paperMaterialsReady()) {
    saveProject({ immediate: true });
    renderPaper();
    toast('请先确认AI给出的主控、核心器件和功能建议，或返回资料页填写实际内容', 'error');
    return;
  }
  project.audit.issues = (project.audit.issues || []).map(issue => ({
    ...issue,
    finalResolution: issue.resolved ? finalIssueResolution(issue) : issue.finalResolution || '',
  }));
  const confirmationSignature = promptSignature(JSON.stringify({
    factSheet: confirmedFactSheet,
    resolutions: project.audit.issues.filter(issue => issue.resolved).map(issue => ({
      title: issue.title,
      field: issue.field,
      finalResolution: issue.finalResolution,
    })),
  }));
  const materialsChanged = previousFacts !== factsSignature();
  const confirmationChanged = previousConfirmationSignature !== confirmationSignature;
  if (materialsChanged || confirmationChanged) invalidateIfFactsChanged(materialsChanged ? previousFacts : '__confirmed_audit_changed__', { preserveAudit: true });
  project.audit.factSheet = confirmedFactSheet;
  project.audit.confirmationSignature = confirmationSignature;
  project.audit.status = 'confirmed';
  project.audit.confirmedAt = nowIso();
  project.audit.inputRevision = project.revision;
  project.paper.stage = 3;
  saveProject({ immediate: true });
  setView('paper', 3);
  toast('项目事实已确认，可以规划论文目录', 'success');
}

function fallbackOutline() {
  return `第1章 绪论\n1.1 研究背景及意义\n1.2 国内外研究现状\n1.2.1 国内研究现状\n1.2.2 国外研究现状\n1.2.3 国内外研究现状分析\n1.3 本文主要研究内容\n1.4 论文组织结构\n\n第2章 系统总体方案设计\n2.1 系统需求分析\n2.2 系统总体架构\n2.3 系统功能设计\n2.4 主要器件选型\n2.4.1 主控制器选型\n2.4.2 传感与执行器件选型\n2.4.3 显示、通信与辅助器件选型\n2.5 系统总体方案确定\n\n第3章 系统硬件设计\n3.1 硬件系统总体设计\n3.2 主控最小系统设计\n3.3 电源电路设计\n3.4 传感器电路设计\n3.5 执行器驱动电路设计\n3.6 显示与通信电路设计\n\n第4章 系统软件设计\n4.1 软件开发环境\n4.2 软件总体架构\n4.3 系统主程序设计\n4.4 传感器驱动程序设计\n4.5 显示与通信程序设计\n4.6 控制及报警逻辑设计\n4.7 软件异常处理\n\n第5章 系统调试与功能测试\n5.1 系统开发与调试环境\n5.2 硬件调试\n5.3 软件调试\n5.4 系统功能测试\n5.4.1 采集、显示与通信功能测试\n5.4.2 控制、报警与联动功能测试\n5.5 测试结果分析\n\n第6章 总结与展望`;
}

function buildDefaultOutline() {
  const builder = Rules.createDefaultOutline || Rules.buildDefaultOutline || Rules.generateDefaultOutline;
  if (typeof builder === 'function') {
    try {
      const result = builder({
        devices: paperCoreDevices(),
        functions: paperCoreFunctions(),
        schoolOutline: project.materials.schoolOutline || null,
      });
      if (Array.isArray(result) && result.some(item => item && typeof item === 'object')) {
        const flat = typeof Rules.flattenOutline === 'function'
          ? Rules.flattenOutline(result)
          : result;
        return flat.map(item => String(item.number).includes('.')
          ? `${item.number} ${item.title}`
          : `第${item.number}章 ${item.title}`).join('\n');
      }
      return Array.isArray(result) ? result.join('\n') : String(result || fallbackOutline());
    } catch (error) {
      console.warn(error);
    }
  }
  return fallbackOutline();
}

function renderOutline(panel) {
  if (!project.outline.text) project.outline.text = project.materials.schoolOutline || buildDefaultOutline();
  panel.innerHTML = `
    <div class="panel-heading"><div><span class="step-kicker">第 3 步</span><h2>确认目录后，一键生成整篇论文</h2><p>学校目录优先；没有目录时，系统会按同类器件和功能归纳标题，避免拆分过细。</p></div><span class="status-pill">正文目标 ${Number(project.paper.targetChars || 20000).toLocaleString('zh-CN')} 字以上</span></div>
    <div class="outline-layout">
      <label class="field field-wide"><span>论文目录 <small>每行一个标题，可直接修改</small></span><textarea id="outline-editor" rows="28">${escapeHtml(project.outline.text)}</textarea></label>
      <aside class="chapter-contract"><h3>内容分工</h3><ul><li>第1章：背景和研究现状</li><li>第2章：功能、架构和器件选型</li><li>第3章：电气连接和电路原理</li><li>第4章：程序业务逻辑，不插代码</li><li>第5章：调试、操作和功能验证</li><li>第6章：成果、不足和展望</li></ul><p>同一内容只在负责章节详细展开，避免全文重复。</p></aside>
    </div>
    <div class="form-grid compact"><label class="field"><span>正文目标字数</span><input id="paper-target" type="number" min="18000" step="1000" value="${Math.max(18000, Number(project.paper.targetChars) || 20000)}"></label></div>
    <div class="panel-actions"><button class="btn btn-secondary" type="button" data-action="paper-step" data-step="2">返回事实核对</button><button class="btn btn-secondary" type="button" data-action="reset-outline">恢复推荐目录</button><button class="btn btn-primary" type="button" data-action="confirm-outline">确认目录，进入论文生成</button></div>`;
}

function confirmOutline() {
  if (!paperMaterialsReady()) {
    setView('paper', 1);
    toast('请先填写论文题目、器件清单和功能清单', 'error');
    return;
  }
  if (project.audit.status !== 'confirmed' || project.audit.inputRevision !== project.revision) {
    toast('资料发生变化，请先重新确认事实', 'error');
    paperStep = 2;
    renderPaper();
    return;
  }
  const text = $('outline-editor')?.value.trim() || '';
  const target = Math.max(18000, Number($('paper-target')?.value) || 20000);
  const found = [...text.matchAll(/^#{0,6}\s*第\s*([1-9]\d*)\s*章\s+(.+)$/gm)];
  const chapterNumbers = found.map(match => Number(match[1])).filter(number => number >= 1 && number <= 6);
  const validChapterSequence = chapterNumbers.length === 6 && chapterNumbers.every((number, index) => number === index + 1);
  if (!validChapterSequence) {
    toast('目录必须按顺序且各只出现一次：第1章至第6章', 'error');
    return;
  }
  const changed = project.outline.text !== text;
  project.outline = { text, confirmedAt: nowIso(), inputRevision: project.revision };
  project.materials.schoolOutline = project.materials.schoolOutline || '';
  project.paper.targetChars = target;
  project.paper.stage = 4;
  if (changed) {
    Object.values(project.paper.chapters).forEach(chapter => {
      if (chapter?.content) chapter.status = 'stale';
    });
    project.paper.quality = null;
    project.paper.abstractCn = '';
    project.paper.abstractEn = '';
    project.paper.keywords = '';
    project.paper.acknowledgment = '';
    project.paper.referenceOrder = [];
    project.paper.semanticIssues = [];
    project.paper.semanticCheckedAt = '';
    project.paper.generation = {
      ...freshPaperGeneration('目录已修改，需要按新目录重新生成'),
      status: Object.values(project.paper.chapters || {}).some(chapter => chapter?.content) ? 'paused' : 'idle',
    };
  }
  ensureChapterRecords();
  saveProject({ immediate: true });
  setView('paper', 4);
  toast('目录已确认，点击“生成论文”即可自动完成全文、检查并下载', 'success');
}

function chapterTargets() {
  const target = Math.max(18000, Number(project.paper.targetChars) || 20000);
  const builder = Rules.buildChapterTargets || Rules.createChapterTargets;
  if (typeof builder === 'function') {
    try {
      return builder(project, target);
    } catch (error) {
      console.warn(error);
    }
  }
  if (typeof Rules.buildWordTargets === 'function' && typeof Rules.buildDefaultOutline === 'function') {
    try {
      const outline = Rules.buildDefaultOutline({ devices: paperDevices(), functions: paperFunctions() });
      const plan = Rules.buildWordTargets(outline, {
        requestedTarget: target,
        complexity: project.level === 'A' ? 'complex' : project.level === 'C' ? 'simple' : 'medium',
      });
      return Object.fromEntries(Object.entries(plan.chapters || {}).map(([id, value]) => [id, value.target]));
    } catch (error) {
      console.warn(error);
    }
  }
  return Object.fromEntries(Object.entries(CHAPTER_WEIGHTS).map(([id, weight]) => [id, Math.round(target * weight)]));
}

function outlineForChapter(id) {
  const all = String(project.outline.text || '').split(/\r?\n/);
  const withoutMarkdown = line => line.trim().replace(/^#{1,6}\s*/, '');
  const start = all.findIndex(line => new RegExp(`^第\\s*${id}\\s*章`).test(withoutMarkdown(line)));
  if (start < 0) return `第${id}章 ${CHAPTER_TITLES[id]}`;
  let end = all.length;
  for (let i = start + 1; i < all.length; i += 1) {
    if (/^第\s*[1-9]\d*\s*章/.test(withoutMarkdown(all[i]))) { end = i; break; }
  }
  return all.slice(start, end).join('\n').trim();
}

function ensureChapterRecords() {
  const targets = chapterTargets();
  for (let id = 1; id <= 6; id += 1) {
    const key = String(id);
    const existing = project.paper.chapters[key] && typeof project.paper.chapters[key] === 'object'
      ? project.paper.chapters[key]
      : {};
    Object.assign(existing, {
      id: key,
      title: CHAPTER_TITLES[id],
      target: Number(targets[id] || targets[key] || Math.round(project.paper.targetChars * CHAPTER_WEIGHTS[id])),
      outline: outlineForChapter(id),
      content: existing.content || '',
      pendingContent: existing.pendingInputRevision === project.revision ? (existing.pendingContent || '') : '',
      pendingInputRevision: existing.pendingInputRevision === project.revision ? existing.pendingInputRevision : '',
      status: existing.status || 'planned',
      issues: Array.isArray(existing.issues) ? existing.issues : [],
      inputRevision: existing.inputRevision || project.revision,
      updatedAt: existing.updatedAt || '',
    });
    project.paper.chapters[key] = existing;
  }
}

function countBodyChars(text) {
  if (typeof Rules.countEffectiveBodyChars === 'function') {
    return Rules.countEffectiveBodyChars({ 1: { content: String(text || '') } });
  }
  return String(text || '')
    .replace(/【非正文·[\s\S]*?【非正文结束】/g, '')
    .replace(/【(?:图|表)[^】]*——待插入】/g, '')
    .replace(/^#{1,6}\s+.*$/gm, '')
    .replace(/^\s*\|.*\|\s*$/gm, '')
    .replace(/\[\d+\]/g, '')
    .replace(/[^\u3400-\u9fffA-Za-z0-9-]+/g, '')
    .length;
}

function paperGenerationState() {
  const defaults = freshPaperGeneration();
  const generation = project.paper.generation && typeof project.paper.generation === 'object'
    ? project.paper.generation
    : {};
  Object.entries(defaults).forEach(([key, value]) => {
    if (generation[key] === undefined) generation[key] = value;
  });
  if (!generation.attempts || typeof generation.attempts !== 'object' || Array.isArray(generation.attempts)) generation.attempts = {};
  if (!generation.semanticBatches || typeof generation.semanticBatches !== 'object' || Array.isArray(generation.semanticBatches)) generation.semanticBatches = {};
  if (!Array.isArray(generation.completedChapterIds)) generation.completedChapterIds = [];
  project.paper.generation = generation;
  return generation;
}

function generationStatusLabel(status) {
  return {
    idle: '等待生成',
    running: '正在生成',
    paused: '已暂停，可继续',
    failed: '生成遇到问题',
    completed: '论文文档已生成',
  }[status] || '等待生成';
}

function healOrphanedGeneration() {
  const generation = paperGenerationState();
  if (generation.status !== 'running' || requestController) return false;
  generation.status = 'paused';
  generation.failedPhase = generation.failedPhase || generation.phase || 'chapters';
  generation.message = '检测到请求已经中断，可以从当前保存点继续';
  generation.lastError = '页面曾保留“正在生成”状态，但当前已经没有活动请求，系统已自动恢复为可继续状态。';
  generation.pauseRequestedAt = '';
  generation.requestAttempt = 0;
  generation.requestAttemptMax = 0;
  generation.requestStartedAt = '';
  generation.requestTimeoutSeconds = 0;
  generation.updatedAt = nowIso();
  saveProject({ immediate: true });
  hideBusy();
  return true;
}

function requestGenerationPause(button) {
  const generation = paperGenerationState();
  if (requestTask !== 'paper' || generation.status !== 'running') {
    if (!requestController) {
      if (healOrphanedGeneration() && currentView === 'paper') renderPaper();
      else toast('当前没有正在运行的完整论文任务', 'info');
    }
    return;
  }
  if (!requestController) {
    if (healOrphanedGeneration() && currentView === 'paper') renderPaper();
    return;
  }
  generation.pauseRequestedAt = nowIso();
  generation.message = '正在暂停当前AI请求…';
  generation.updatedAt = nowIso();
  saveProject({ immediate: true });
  if (button) {
    button.disabled = true;
    button.textContent = '正在暂停…';
  }
  const modalButton = $('btn-cancel-busy');
  if (modalButton) {
    modalButton.disabled = true;
    modalButton.textContent = '正在暂停…';
  }
  updateBusyProgress(generation.percent, '正在安全暂停', '已完成的章节和片段均已保存，请稍候');
  requestController.abort(new DOMException('用户暂停当前生成', 'AbortError'));
}

function renderPaperGeneration(panel) {
  healOrphanedGeneration();
  ensureChapterRecords();
  const generation = paperGenerationState();
  const chapters = Object.values(project.paper.chapters).sort((a, b) => Number(a.id) - Number(b.id));
  const generated = chapters.filter(chapter => chapter.content && chapter.inputRevision === project.revision);
  const completed = generated.filter(chapter => chapter.status === 'locked');
  const bodyChars = totalBodyChars();
  const quality = project.paper.quality;
  const isRunning = generation.status === 'running' && requestTask === 'paper';
  const isComplete = generation.status === 'completed' && chapters.every(chapter => chapter.content);
  const manualQualityRequired = Boolean(generation.manualQualityRequired && generation.status === 'paused');
  const hasFullDraft = generated.length === 6 && chapters.every(chapter => countBodyChars(chapter.content) >= 500);
  const hasSavedContent = generated.some(chapter => countBodyChars(chapter.content) > 0);
  const canResume = !manualQualityRequired && (['paused', 'failed'].includes(generation.status) || chapters.some(chapter => chapter.content) && !isComplete);
  const primaryLabel = isRunning ? '正在生成论文…' : canResume ? '继续生成论文' : isComplete ? '检查并补充论文' : '生成完整论文并下载 Word';
  const chapterRows = chapters.map(chapter => {
    const chars = countBodyChars(chapter.content);
    const current = generation.currentChapterId === chapter.id && isRunning;
    const status = current ? '正在生成' : chapter.pendingContent ? '新稿片段已保存，等待续写' : chapter.status === 'locked' ? '已生成并检查' : chapter.content ? '已有内容，待完善' : '等待生成';
    return `<li class="generation-status-item ${current ? 'is-current' : ''} ${chapter.status === 'locked' ? 'is-done' : ''}"><span>${chapter.status === 'locked' ? '✓' : chapter.id}</span><div><strong>第${chapter.id}章 ${escapeHtml(chapter.title)}</strong><small>${escapeHtml(status)}${chars ? ` · ${chars.toLocaleString('zh-CN')} 字` : ''}</small>${current ? '<em>深度写作会持续较长时间；可查看上方耗时和最近保存时间</em>' : ''}${chapter.content ? `<details class="chapter-result-preview"><summary>查看本章正文</summary><div>${paperTextToHtml(normalizeRepeatedFigureIntroductions(chapter.content), chapter)}</div></details>` : ''}</div></li>`;
  }).join('');
  const resultNotice = manualQualityRequired
    ? `<div class="notice notice-warning"><strong>草稿已保存，需要补充真实资料</strong><p>${escapeHtml(generation.manualQualityMessage || '剩余问题不能由AI安全猜测，请补充资料后重新检查，或下载草稿在WPS中处理。')}</p></div>`
    : isComplete
    ? `<div class="notice ${quality?.blocking?.length ? 'notice-warning' : 'notice-info'}"><strong>${quality?.blocking?.length ? '论文草稿已生成' : '论文已生成并通过基础检查'}</strong><p>${quality?.blocking?.length ? `还有 ${quality.blocking.length} 项需要你后续确认，已按草稿保留并可下载。` : '正文、摘要和基础质量检查均已完成，可直接下载后在 WPS 中补充图片和学校格式。'}</p></div>`
    : generation.lastError ? `<div class="notice notice-warning"><strong>已完成的章节不会丢失</strong><p>${escapeHtml(generation.lastError)}</p></div>` : '';
  panel.innerHTML = `
    <div class="panel-heading"><div><span class="step-kicker">第 4 步</span><h2>一键生成完整论文</h2><p>你只需要点击一次。系统会在后台依次完成六章、自动检查、生成中英文摘要，并返回采用本科论文通用版式的 DOCX 文档。</p></div><span class="status-pill ${isComplete ? 'is-success' : generation.lastError ? 'is-warning' : ''}">${escapeHtml(generationStatusLabel(generation.status))}</span></div>
    <section class="paper-generation-hero">
      <div><span class="result-label">自动处理流程</span><h3>${escapeHtml(generation.message || '准备生成论文')}</h3><p>后台仍按章节生成以避免文本超限；每章完成后立即保存，中断后可以继续。</p><small>${generation.startedAt ? `本轮开始：${escapeHtml(new Date(generation.startedAt).toLocaleString('zh-CN'))}` : '尚未开始'}${generation.lastSavedAt ? ` · 最近保存：${escapeHtml(new Date(generation.lastSavedAt).toLocaleTimeString('zh-CN'))}` : ''}${isRunning && generation.requestAttempt ? ` · 当前AI请求 ${generation.requestAttempt}/${generation.requestAttemptMax}` : ''}</small></div>
      <div class="document-summary"><strong>${bodyChars.toLocaleString('zh-CN')}</strong><span>正文有效字数</span><small>${generated.length} / 6 章已有正文 · ${completed.length} 章通过检查</small></div>
    </section>
    ${resultNotice}
    <ol class="generation-status-list">${chapterRows}</ol>
    ${quality ? `<details class="generation-quality-details" ${quality.blocking?.length ? 'open' : ''}><summary>查看自动质量检查结果</summary>${renderQualityGroups(quality)}</details>` : ''}
    ${isComplete && project.paper.abstractCn ? `<details class="abstract-preview"><summary>查看已生成摘要</summary><h4>中文摘要</h4><p>${escapeHtml(project.paper.abstractCn)}</p><h4>关键词</h4><p>${escapeHtml(project.paper.keywords)}</p><h4>English Abstract</h4><p>${escapeHtml(project.paper.abstractEn)}</p></details>` : ''}
    <div class="panel-actions generation-result-actions"><button class="btn btn-secondary" type="button" data-action="paper-step" data-step="3">返回目录</button>${isComplete ? `${quality?.blocking?.length ? '<button class="btn btn-secondary" type="button" data-action="export-paper" data-final="false">下载论文草稿 DOCX</button>' : ''}<button class="btn btn-primary" type="button" data-action="export-paper" data-final="${quality && !quality.blocking?.length}">下载论文 DOCX</button>${quality?.blocking?.length ? '<button class="btn btn-secondary" type="button" data-action="generate-full-paper">继续完善论文</button>' : ''}` : isRunning ? '<button class="btn btn-secondary" type="button" data-action="cancel-generation">暂停生成（暂停后可下载草稿）</button>' : hasSavedContent ? `<button class="btn btn-secondary" type="button" data-action="export-paper" data-final="false">下载已保存草稿 DOCX</button>${manualQualityRequired ? '<button class="btn btn-primary" type="button" data-action="paper-step" data-step="1">返回资料页补充信息</button>' : `<button class="btn btn-primary" type="button" data-action="generate-full-paper">${canResume ? '从保存点继续' : primaryLabel}</button>`}` : `<button class="btn btn-primary" type="button" data-action="generate-full-paper">${primaryLabel}</button>`}</div>`;
}

function renderChapters(panel) {
  ensureChapterRecords();
  const chapters = project.paper.chapters;
  if (!chapters[activeChapter]) activeChapter = '1';
  project.paper.activeChapter = activeChapter;
  const current = chapters[activeChapter];
  const chars = countBodyChars(current.content);
  panel.innerHTML = `
    <div class="panel-heading"><div><span class="step-kicker">第 4 步</span><h2>逐章生成、检查和确认</h2><p>每次只处理一章。你的手动修改会自动保存，重新检查不会覆盖已确认章节。</p></div><span class="status-pill">全文 ${totalBodyChars().toLocaleString('zh-CN')} / ${project.paper.targetChars.toLocaleString('zh-CN')} 字</span></div>
    <div class="writing-layout">
      <aside class="chapter-sidebar">${Object.values(chapters).map(chapter => `<button type="button" class="chapter-tab ${chapter.id === activeChapter ? 'is-active' : ''}" data-action="select-chapter" data-chapter="${chapter.id}"><span>第${chapter.id}章</span><strong>${escapeHtml(chapter.title)}</strong><small>${chapterStatusLabel(chapter)} · ${countBodyChars(chapter.content)}字</small></button>`).join('')}</aside>
      <section class="chapter-workspace">
        <div class="chapter-workspace-head"><div><span>本章目标约 ${Number(current.target).toLocaleString('zh-CN')} 字</span><h3>第${current.id}章 ${escapeHtml(current.title)}</h3></div><span class="status-pill">${chapterStatusLabel(current)}</span></div>
        <details class="contract-details"><summary>查看本章写作范围</summary><pre>${escapeHtml(current.outline)}</pre><p>${escapeHtml(chapterDuty(current.id))}</p></details>
        <label class="chapter-content-label" for="chapter-editor"><strong>本章正文</strong><span>AI 生成的内容会显示在下方编辑框中并自动保存，你也可以直接修改。</span></label>
        <textarea id="chapter-editor" class="chapter-editor" rows="30" placeholder="本章还没有正文。点击下方“AI 生成本章”后，内容会显示在这里。">${escapeHtml(current.content)}</textarea>
        <div class="chapter-meta"><span>当前有效字数：<b>${chars.toLocaleString('zh-CN')}</b></span><span>目标完成度：<b>${Math.min(100, Math.round(chars / Math.max(1, current.target) * 100))}%</b></span></div>
        ${current.issues?.length ? `<div class="inline-audit"><h4>本章检查结果</h4>${current.issues.map(issue => `<p class="${issue.severity === 'blocking' ? 'is-danger' : ''}">• ${escapeHtml(issue.message || issue.title)}</p>`).join('')}</div>` : ''}
        <div class="panel-actions"><button class="btn btn-secondary" id="ai-generate-chapter" type="button" data-action="generate-chapter">${current.content ? '重新生成本章' : 'AI 生成本章'}</button>${current.content ? '<button class="btn btn-secondary" type="button" data-action="expand-chapter">AI 补充本章</button><button class="btn btn-secondary" type="button" data-action="audit-chapter">检查本章</button><button class="btn btn-primary" type="button" data-action="lock-chapter">确认并锁定本章</button>' : ''}</div>
      </section>
    </div>
    <div class="panel-actions outer-actions"><button class="btn btn-secondary" type="button" data-action="paper-step" data-step="3">返回目录</button><button class="btn btn-primary" type="button" data-action="paper-step" data-step="5">进入全文质量检查</button></div>`;
}

function chapterDuty(id) {
  return {
    1: '只写背景、意义、国内外研究现状、本文内容和结构。如用户提供参考文献，只允许在本章按正文首次出现顺序引用；未提供时采用不点名的概括性分析。',
    2: '只详细写需求、系统方案、功能、架构和器件选型，不重复电路连接和程序逻辑。每个核心器件预留器件图片位置。',
    3: '只详细写电气连接、电路工作原理和供电关系。每个独立模块预留电路图；连接复杂时给出关系表。',
    4: '只写开发环境、程序总体流程、器件驱动和功能业务逻辑。不插入代码，不使用函数名或变量名介绍程序。',
    5: '介绍调试工具、环境、操作方法和分组功能验证过程，必须包含带单位的量化测试数据表。没有实测记录时按器件能力保守推定可编辑数据。每项核心功能预留一张展示图。',
    6: '结合题目背景概括实际完成内容、限定条件和一一对应的优化方向，不引入新功能，不得把已确认功能写成未完成或未实现。',
  }[id] || '';
}

function chapterStatusLabel(chapter) {
  return {
    planned: '尚未开始',
    generating: '正在生成',
    draft: '草稿待确认',
    reviewing: '有问题待修改',
    locked: '已确认并锁定',
    stale: '资料变化后需复查',
  }[chapter.status] || '尚未开始';
}

function revealChapterEditor() {
  requestAnimationFrame(() => {
    const editor = $('chapter-editor');
    if (!editor) return;
    editor.scrollIntoView({ behavior: 'smooth', block: 'center' });
    editor.classList.add('is-newly-generated');
    window.setTimeout(() => editor.classList.remove('is-newly-generated'), 1800);
  });
}

function parsedReferences() {
  const parser = Rules.parseReferences || Rules.parseReferenceRecords;
  if (typeof parser === 'function') {
    try {
      return parser(project.materials.referencesText || '');
    } catch (error) { console.warn(error); }
  }
  return lines(project.materials.referencesText).map((line, index) => {
    const [authors = '', title = '', abstract = ''] = line.split(/[|｜]/).map(item => item.trim());
    return { id: `ref-${index + 1}`, authors, title: title || line, abstract, raw: line };
  });
}

function referencesForPrompt() {
  const references = parsedReferences();
  const byId = new Map(references.map(reference => [reference.id, reference]));
  const ordered = (project.paper.referenceOrder || []).map(id => byId.get(id)).filter(Boolean);
  references.forEach(reference => {
    if (!ordered.some(item => item.id === reference.id)) ordered.push(reference);
  });
  return ordered.map((reference, index) => ({
    ...reference,
    formatted: formattedReference(reference),
    citationNumber: index + 1,
    citationToken: `{{cite:${reference.id}}}`,
  }));
}

function referenceWritingPolicy(chapterId = '1') {
  if (String(chapterId) !== '1') return '本章不得出现参考文献引用、作者文献综述或引用编号。';
  const references = referencesForPrompt();
  if (!references.length) {
    return '用户没有提供参考文献，本次按无参考文献模式写作：国内外研究现状采用不点名的概括性分析；不得编造作者、题名或出版信息，不得输出 citationToken、[n] 引用编号或文末参考文献。无文献不会阻止论文生成。';
  }
  return `用户已提供 ${references.length} 篇参考文献：必须只使用这些条目，全部在第一章各引用一次；使用每条记录的 citationToken，不自行输出数字编号，不新增、删除、替换、联网检索或猜补出版信息。`;
}

function normalizeCitationOrder(value) {
  const source = String(value || '');
  const base = parsedReferences();
  if (!base.length) {
    project.paper.referenceOrder = [];
    return source.replace(/\{\{cite:[^}]+\}\}/g, '');
  }
  const baseById = new Map(base.map(reference => [reference.id, reference]));
  const previousOrder = (project.paper.referenceOrder || []).map(id => baseById.get(id)).filter(Boolean);
  const previousIds = new Set(previousOrder.map(reference => reference.id));
  const numericOrder = [...previousOrder, ...base.filter(reference => !previousIds.has(reference.id))];
  const order = [];
  const rewritten = source.replace(/\{\{cite:([^}]+)\}\}|\[(\d+)\]/g, (full, tokenId, numeric) => {
    const reference = tokenId
      ? baseById.get(String(tokenId).trim())
      : numericOrder[Number(numeric) - 1];
    if (!reference) return full;
    if (order.includes(reference.id)) return `[${order.indexOf(reference.id) + 1}]`;
    order.push(reference.id);
    return `[${order.length}]`;
  });
  project.paper.referenceOrder = order;
  return rewritten.replace(/[ \t]+([，。；;,.])/g, '$1').replace(/\n{3,}/g, '\n\n').trim();
}

function formattedReference(reference) {
  if (typeof Rules.formatReferenceRecord === 'function') return Rules.formatReferenceRecord(reference);
  const authors = Array.isArray(reference?.authors) ? reference.authors.join('，') : String(reference?.authors || '');
  return [authors, reference?.title].filter(Boolean).join('. ');
}

function normalizedFigureKey(major, minor) {
  return `${Number(major)}-${Number(minor)}`;
}

function maskedNonBodyText(value) {
  return String(value || '').replace(/【非正文·[\s\S]*?【非正文结束】/g, block => block.replace(/[^\n]/g, ' '));
}

function collectFigureUsage(value) {
  const source = String(value || '').replace(/\r\n?/g, '\n');
  const body = maskedNonBodyText(source);
  const introductions = new Map();
  const placeholders = new Map();
  const introPattern = /(?:如(?:下)?图|图)\s*(\d+)\s*[-－—]\s*(\d+)\s*(?:中)?所示/g;
  const placeholderPattern = /【\s*图\s*(\d+)\s*[-－—]\s*(\d+)[^】]*(?:待插入|待添加|预留)[^】]*】/g;
  for (const match of body.matchAll(introPattern)) {
    const key = normalizedFigureKey(match[1], match[2]);
    if (!introductions.has(key)) introductions.set(key, []);
    introductions.get(key).push({ index: match.index, text: match[0] });
  }
  for (const match of source.matchAll(placeholderPattern)) {
    const key = normalizedFigureKey(match[1], match[2]);
    if (!placeholders.has(key)) placeholders.set(key, []);
    placeholders.get(key).push({ index: match.index, text: match[0] });
  }
  const unnumbered = [...body.matchAll(/(?:如(?:下)?图|图)\s*(?:中)?所示/g)].map(match => ({ index: match.index, text: match[0] }));
  return { introductions, placeholders, unnumbered };
}

function normalizeRepeatedFigureIntroductions(value) {
  const source = String(value || '').replace(/\r\n?/g, '\n');
  const seenPlaceholders = new Set();
  const outputLines = [];
  let removeFollowingInstruction = false;
  let skippingInstruction = false;
  const placeholderPattern = /【\s*图\s*(\d+)\s*[-－—]\s*(\d+)[^】]*(?:待插入|待添加|预留)[^】]*】/g;

  for (const line of source.split('\n')) {
    const trimmed = line.trim();
    if (skippingInstruction) {
      if (trimmed.includes('【非正文结束】')) skippingInstruction = false;
      continue;
    }
    if (removeFollowingInstruction) {
      if (!trimmed) continue;
      if (trimmed.startsWith('【非正文·')) {
        if (!trimmed.includes('【非正文结束】')) skippingInstruction = true;
        removeFollowingInstruction = false;
        continue;
      }
      removeFollowingInstruction = false;
    }

    let removedDuplicate = false;
    const nextLine = line.replace(placeholderPattern, (full, major, minor) => {
      const key = normalizedFigureKey(major, minor);
      if (seenPlaceholders.has(key)) {
        removedDuplicate = true;
        return '';
      }
      seenPlaceholders.add(key);
      return full;
    }).replace(/[ \t]{2,}/g, ' ').trimEnd();
    if (removedDuplicate && !nextLine.trim()) {
      removeFollowingInstruction = true;
      continue;
    }
    outputLines.push(nextLine);
  }

  const seenIntroductions = new Set();
  const introPattern = /(?:如(?:下)?图|图)\s*(\d+)\s*[-－—]\s*(\d+)\s*(?:中)?所示([ \t]*[，,:：。！？；;]?)/g;
  return outputLines.join('\n').replace(introPattern, (full, major, minor, trailing, offset, whole) => {
    const key = normalizedFigureKey(major, minor);
    if (!seenIntroductions.has(key)) {
      seenIntroductions.add(key);
      return full;
    }
    const previous = whole.slice(0, offset).match(/\S(?=\s*$)/)?.[0] || '';
    if (!previous || /[。！？；;\n]/.test(previous)) return '';
    return `前述图示${trailing || ''}`;
  }).replace(/\n{3,}/g, '\n\n').trim();
}

function figureUsageIssues(value) {
  const usage = collectFigureUsage(value);
  const issues = [];
  usage.introductions.forEach((entries, key) => {
    if (entries.length > 1) issues.push({ severity: 'blocking', message: `图${key}重复使用了 ${entries.length} 次“如图所示”，同一张图只允许首次引出一次` });
  });
  usage.placeholders.forEach((entries, key) => {
    if (entries.length > 1) issues.push({ severity: 'blocking', message: `图${key}出现了 ${entries.length} 个重复图位，同一张图只能保留一个图位` });
  });
  if (usage.unnumbered.length) issues.push({ severity: 'blocking', message: `检测到 ${usage.unnumbered.length} 处没有图号的“如图所示”，请改为明确图号并只在首次引出时使用` });
  const keys = new Set([...usage.introductions.keys(), ...usage.placeholders.keys()]);
  keys.forEach(key => {
    const introductions = usage.introductions.get(key) || [];
    const placeholders = usage.placeholders.get(key) || [];
    if (introductions.length && !placeholders.length) issues.push({ severity: 'confirm', message: `图${key}已有正文引用，但没有识别到对应图位` });
    if (!introductions.length && placeholders.length) issues.push({ severity: 'confirm', message: `图${key}已有图位，但正文没有先用“如图${key}所示”引出` });
    if (introductions.length && placeholders.length && introductions[0].index > placeholders[0].index) issues.push({ severity: 'blocking', message: `图${key}的正文引用位于图位之后，应先引用再放置图位` });
  });
  return issues;
}

function figureLedgerForPrompt(value) {
  const usage = collectFigureUsage(value);
  const keys = [...new Set([...usage.introductions.keys(), ...usage.placeholders.keys()])]
    .sort((left, right) => left.localeCompare(right, 'zh-CN', { numeric: true }));
  if (!keys.length) return '暂无已使用图号。';
  return keys.map(key => `图${key}｜${usage.introductions.has(key) ? '已首次引出' : '未识别到首次引出'}｜${usage.placeholders.has(key) ? '已有图位' : '未识别到图位'}`).join('\n');
}

function uniqueFigurePlaceholderCount(value, chapterId) {
  const prefix = `${Number(chapterId)}-`;
  return [...collectFigureUsage(value).placeholders.keys()].filter(key => key.startsWith(prefix)).length;
}

function artifactPlanForChapter(id) {
  const devices = paperCoreDevices();
  const functions = paperCoreFunctions();
  if (id === '2') {
    return `本章图位：每个核心器件在首次完成选型介绍后预留器件图片。器件清单：${devices.join('、')}。格式示例：“如图2-x所示”→“【图2-x 器件名称实物图——待插入】”→“【非正文·图片准备说明｜定稿前删除】说明应拍摄或查找的视角、需要清楚展示的型号与外观特征。【非正文结束】”。`;
  }
  if (id === '3') {
    return `本章图表：对主控最小系统、电源和每个独立器件模块分别说明实际连接与电路原理，并在对应说明后预留电路图。器件清单：${devices.join('、')}。连接信号较多时给出“器件—信号—主控端—作用”的连接关系表；若正文已集中、清楚说明连接关系，不重复制作同内容表格。每个图位后提供可直接照着绘制的详细非正文说明。未知引脚不得推测。`;
  }
  if (id === '4') {
    return `本章图示：必须包含系统主程序流程图，并为实际需要展开的核心功能逻辑提供详细文字流程图；通信对时序敏感时才规划时序图，多工作模式时才规划状态图，必要计算才使用公式。功能清单：${functions.join('、')}。流程图说明需写出开始、初始化、采集或输入、条件判断的各分支、执行动作、异常处理和返回路径，可直接供用户照着绘制；不得固定套用与本项目无关的五张图。`;
  }
  if (id === '5') {
    return `本章展示：先介绍实际使用的调试工具、软件与操作环境，再按同类功能归纳测试方法、操作步骤、量化数据和结果分析。功能清单：${functions.join('、')}。至少生成一张 Markdown 量化测试表，表中包含测试项目、条件或次数、测量/统计数据（带单位）、判定标准和结果；用户没有提供数据时，依据已确认器件能力和常见实验条件推定保守、可编辑且前后一致的数据，禁止100%成功率、零误差等绝对化结果。每项核心功能说明后必须预留一张功能展示图，并给出拍摄对象、操作状态、画面中应出现的信息和判定依据。`;
  }
  return '图表只按本章真实需要规划；任何图位必须先在正文引用，随后给正式占位和详细非正文制作说明。每张图只允许一次带明确图号的首次引出、一个图位和一段制作说明，后文不得重复“如图所示”或重复插入同一张图。';
}

function previousChapterContext(currentId) {
  return Object.values(project.paper.chapters)
    .filter(chapter => Number(chapter.id) < Number(currentId) && chapter.content)
    .map(chapter => {
      const headings = [...String(chapter.content).matchAll(/^#{2,3}\s+(.+)$/gm)].map(match => match[1]).slice(0, 12);
      const paragraphOpenings = String(chapter.content).split(/\n{2,}/)
        .map(item => item.replace(/^#{1,6}\s*/, '').replace(/\s+/g, ' ').trim())
        .filter(item => item.length >= 60 && !item.startsWith('【'))
        .slice(0, 12)
        .map(item => item.slice(0, 90));
      return `第${chapter.id}章内容账本（这些主题只可简短衔接，不得再次完整展开）：\n标题：${headings.join('；') || '无'}\n段落要点：${paragraphOpenings.join('；') || '无'}`;
    })
    .join('\n\n');
}

function boundedPromptText(value, maxChars, label = '资料') {
  const content = String(value || '').trim();
  const limit = Math.max(200, Number(maxChars) || 0);
  if (!content || content.length <= limit) return content || null;
  const notice = `\n【${label}较长，系统已压缩中间内容；保留开头与末尾供本章核对】\n`;
  const available = Math.max(100, limit - notice.length);
  const head = Math.round(available * 0.7);
  return `${content.slice(0, head)}${notice}${content.slice(-(available - head))}`;
}

function samePromptMaterial(left, right) {
  const normalize = value => String(value || '').replace(/[\s#>*`_-]+/g, '').toLowerCase();
  const a = normalize(left);
  const b = normalize(right);
  return Boolean(a && b && (a === b || (a.length > 500 && b.length > 500 && (a.includes(b) || b.includes(a)))));
}

function confirmedAuditResolutionText(issue) {
  const finalResolution = finalIssueResolution(issue);
  return [
    `核对项：${issue.title}`,
    issue.detail ? `原问题：${issue.detail}` : '',
    issue.suggestion ? `系统建议：${issue.suggestion}` : '',
    finalResolution ? `用户最终确认：${finalResolution}` : '',
  ].filter(Boolean).join('；');
}

function chapterMaterialContext(chapterId, { compact = false } = {}) {
  const id = String(chapterId);
  const scheme = paperSchemeText();
  const sourceNotes = project.materials.sourceNotes || '';
  const backgroundNotes = [project.background, project.requirements].filter(Boolean).join('\n');
  const facts = {
    title: project.title,
    devices: paperDevices(),
    functions: paperFunctions(),
    coreDevices: paperCoreDevices(),
    coreFunctions: paperCoreFunctions(),
    confirmedFunctionClosures: paperClosureSummary(),
    materialPriority: '用户最新补充说明 > 用户连接说明、测试记录和源程序证据 > 用户原始方案 > 网站生成方案 > 通用器件常识；发生冲突时不得自行折中或改写用户事实。',
    missingMaterialPolicy: '网站未录入某类材料不等于项目未完成；不得据此否定任何已确认功能。未知引脚、地址、电压和阈值不得编造。第五章无实测数据时按器件能力生成保守量化表。',
    confirmedAuditResolutions: boundedPromptText(project.audit.issues
      .filter(issue => issue.resolved)
      .map(confirmedAuditResolutionText)
      .join('\n'), compact ? 2500 : 6000, '已确认核对结果'),
  };
  const addNotes = (limit, label = '已有方案或任务说明') => {
    const value = sourceNotes || backgroundNotes;
    if (value) facts[label] = boundedPromptText(value, compact ? Math.min(limit, 4500) : limit, label);
  };

  if (id === '1') {
    facts.backgroundAndRequirements = boundedPromptText(backgroundNotes, compact ? 4000 : 9000, '选题背景与功能要求');
    if (sourceNotes) facts.taskNotes = boundedPromptText(sourceNotes, compact ? 4500 : 10000, '已有方案或任务说明');
  } else if (id === '2') {
    facts.scheme = boundedPromptText(scheme, compact ? 6000 : 15000, '已有完整方案');
    if (!samePromptMaterial(scheme, sourceNotes)) addNotes(9000);
  } else if (id === '3') {
    facts.connections = boundedPromptText(project.materials.connectionText, compact ? 8000 : 24000, '硬件连接资料');
    addNotes(6000);
    if (scheme && !samePromptMaterial(scheme, sourceNotes)) facts.schemeSummary = boundedPromptText(scheme, compact ? 3000 : 6000, '方案摘要');
  } else if (id === '4') {
    facts.codeLogic = boundedPromptText(project.materials.codeText, compact ? 16000 : 45000, '源程序');
    facts.interfaceFacts = boundedPromptText(project.materials.connectionText, compact ? 4000 : 9000, '接口与连接摘要');
    addNotes(5000);
  } else if (id === '5') {
    facts.tests = boundedPromptText(project.materials.testInfo, compact ? 7000 : 20000, '测试记录');
    facts.tools = boundedPromptText(project.materials.tools, compact ? 3000 : 7000, '调试工具');
    facts.photoNotes = boundedPromptText(project.materials.photoNotes || '用户后续手动插图', compact ? 2500 : 6000, '实物与功能照片说明');
    addNotes(4000);
  } else if (id === '6') {
    facts.testConclusionEvidence = boundedPromptText(project.materials.testInfo, compact ? 3500 : 7000, '测试结论依据');
    const chapter5 = String(project.paper.chapters?.['5']?.content || '');
    const tableAndConclusion = chapter5.split(/\r?\n/)
      .filter(line => /^\s*\|.*\|\s*$/.test(line) || /测试结果|结果表明|由表|平均|误差|响应|成功率|通过率|稳定/.test(line))
      .join('\n');
    facts.chapter5ResultDigest = boundedPromptText(tableAndConclusion || chapter5.slice(-5000), compact ? 3500 : 7000, '第五章量化结果摘要');
    addNotes(3500);
  }
  return facts;
}

function chapterPrompt(chapter, mode = 'generate', { compact = false } = {}) {
  const references = referencesForPrompt();
  const context = {
    ...chapterMaterialContext(chapter.id, { compact }),
    references: chapter.id === '1' ? references.map(reference => ({
      id: reference.id,
      authors: reference.authors,
      title: reference.title,
      abstract: reference.abstract,
      citationToken: reference.citationToken,
      fullPublication: formattedReference(reference),
    })) : [],
    referencePolicy: referenceWritingPolicy(chapter.id),
  };
  const previous = boundedPromptText(previousChapterContext(chapter.id), compact ? 4500 : 9000, '前文章节内容账本') || '';
  const artifactPlan = artifactPlanForChapter(chapter.id);
  return `【论文题目】${project.title}\n【当前任务】撰写第${chapter.id}章《${chapter.title}》\n【本章目录】\n${chapter.outline}\n【本章内容职责】${chapterDuty(chapter.id)}\n【目标有效字数】约${chapter.target}字\n【本章图表与说明计划】${artifactPlan}\n\n【只与本章相关的已确认项目事实】\n${JSON.stringify(context, null, 2)}\n\n${previous}\n\n写作要求：全文围绕题目，符合本科生工程论文水平，专业但不故作高深；适当使用行业背景话术，但必须落回本项目。当前章标题由系统统一生成，不要重复输出；只允许输出本章目录中已有的二、三级标题。论文二级标题严格使用“## 2.1 标题”，三级标题严格使用“### 2.1.1 标题”，不得使用单个“#”或“####”及更深层级。同类器件、电路、程序和测试用段落、分点或表格归纳，不得为每个条目另设三级标题，每个二级标题通常不超过3个三级标题。每张图只允许一次“如图X-X所示”的首次引出、一个正式图位和一段非正文制作说明；后文可以写“由图X-X可知”或“结合图X-X分析”，但不得再次使用“如图所示”或重复插入同一图位。禁止没有明确图号的“如图所示”。图表、流程图或拍摄说明用“【非正文·……｜定稿前删除】”与正文区分。各章节严格履行唯一职责，不能把器件选型、电路、程序和测试内容互相重复。${referenceWritingPolicy(chapter.id)}第六章不得将已确认功能写成未完成、未实现或仅停留在设想。只输出本章正文，不输出写作解释。`;
}

function continuationPrompt(chapter, issues = [], { minimal = false } = {}) {
  const tail = String(chapter.content || '').slice(-1800);
  const figureLedger = figureLedgerForPrompt(chapter.content);
  const headings = [...String(chapter.content || '').matchAll(/^#{2,3}\s+(.+)$/gm)].map(match => match[1]);
  const paragraphLedger = String(chapter.content || '').split(/\n{2,}/)
    .map(item => item.replace(/^#{1,6}\s*/, '').replace(/\s+/g, ' ').trim())
    .filter(item => item.length >= 60 && !item.startsWith('【'))
    .slice(0, 24)
    .map(item => item.slice(0, 90));
  const relevantFacts = chapterMaterialContext(chapter.id, { compact: true });
  if (minimal) {
    Object.entries(relevantFacts).forEach(([key, value]) => {
      if (typeof value === 'string' && value.length > 3500) relevantFacts[key] = boundedPromptText(value, 3500, key);
    });
  }
  return `【论文题目】${project.title}\n【当前章节】第${chapter.id}章《${chapter.title}》\n【本章目录】\n${chapter.outline}\n【本章职责】${chapterDuty(chapter.id)}\n【本章目标】约${chapter.target}字\n【当前有效字数】${countBodyChars(chapter.content)}字\n【本章紧凑事实账本】\n${JSON.stringify(relevantFacts, null, 2)}\n【本章已有标题】${headings.join('；') || '无'}\n【本章已覆盖段落要点】${paragraphLedger.join('；') || '无'}\n【本章已使用图账本】\n${figureLedger}\n【参考文献规则】${referenceWritingPolicy(chapter.id)}\n【需要补充的问题】\n${issues.length ? issues.map(item => `- ${item.message || item.detail || item}`).join('\n') : '- 当前内容尚未达到本章目标，请继续补足目录中尚未充分展开的内容'}\n【已有正文末尾】\n${tail}\n\n请从已有正文之后自然续写，只输出真正缺少的新段落，不要重复已有标题、段落、器件参数、工作原理或章节总结，不要重新输出整章。账本中已有的图号不得再次写“如图X-X所示”，不得重复对应图位或制作说明；需要继续分析时改写为“由图X-X可知”“结合图X-X分析”或“该图中”。禁止没有明确图号的“如图所示”。继续遵守：不编造未知引脚；第五章无实测数据时生成保守量化数据表；不插入代码；只使用目录已有标题，同类内容不得另设三级标题；图表说明用“【非正文·……｜定稿前删除】”区分。`;
}

function paragraphFingerprint(value) {
  return String(value || '')
    .replace(/【非正文·[\s\S]*?【非正文结束】/g, '')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\[\d+\]|\{\{cite:[^}]+\}\}/g, '')
    .replace(/[\s\p{P}\p{S}\d]/gu, '')
    .toLowerCase();
}

function trigramSimilarity(leftValue, rightValue) {
  const left = paragraphFingerprint(leftValue);
  const right = paragraphFingerprint(rightValue);
  if (left.length < 80 || right.length < 80) return 0;
  if (left === right) return 1;
  const lengthRatio = Math.min(left.length, right.length) / Math.max(left.length, right.length);
  if (lengthRatio < 0.72) return 0;
  const grams = value => {
    const set = new Set();
    for (let index = 0; index <= value.length - 3; index += 1) set.add(value.slice(index, index + 3));
    return set;
  };
  const leftSet = grams(left);
  const rightSet = grams(right);
  let overlap = 0;
  leftSet.forEach(item => { if (rightSet.has(item)) overlap += 1; });
  return overlap / Math.max(1, leftSet.size + rightSet.size - overlap);
}

function proseBlocks(value) {
  return String(value || '').replace(/\r\n?/g, '\n').split(/\n{2,}/).map(block => block.trim()).filter(Boolean);
}

function isDeduplicableBlock(block) {
  const value = String(block || '').trim();
  return paragraphFingerprint(value).length >= 80
    && !/^#{1,6}\s/.test(value)
    && !/^\|/.test(value)
    && !value.startsWith('【');
}

function dedupeGeneratedContent(value, chapterId) {
  const known = [];
  Object.values(project.paper.chapters || {})
    .filter(chapter => String(chapter.id) !== String(chapterId) && chapter.content)
    .forEach(chapter => proseBlocks(chapter.content).filter(isDeduplicableBlock).forEach(block => known.push(block)));
  const kept = [];
  for (const block of proseBlocks(value)) {
    if (isDeduplicableBlock(block) && [...known, ...kept.filter(isDeduplicableBlock)].some(other => trigramSimilarity(other, block) >= 0.92)) continue;
    kept.push(block);
  }
  return kept.join('\n\n').trim();
}

function appendChapterContent(existing, addition) {
  const left = String(existing || '').trim();
  const right = stripThink(addition).trim();
  if (!left) return right;
  if (!right) return left;
  const existingBlocks = proseBlocks(left);
  const existingHeadings = new Set([...left.matchAll(/^#{2,3}\s+(.+)$/gm)].map(match => match[1].replace(/\s+/g, '').toLowerCase()));
  const additions = proseBlocks(right).filter(block => {
    const heading = block.match(/^#{2,3}\s+(.+)$/)?.[1];
    if (heading && existingHeadings.has(heading.replace(/\s+/g, '').toLowerCase())) return false;
    if (!isDeduplicableBlock(block)) return true;
    return !existingBlocks.some(existingBlock => isDeduplicableBlock(existingBlock) && trigramSimilarity(existingBlock, block) >= 0.9);
  });
  return additions.length ? `${left}\n\n${additions.join('\n\n')}` : left;
}

async function requestChapterContent(chapter, { mode = 'generate', signal } = {}) {
  const generation = paperGenerationState();
  const forceCompact = generation.compactMode && String(generation.currentChapterId) === String(chapter.id);
  const attempts = forceCompact ? [true] : [false, true];
  for (let attempt = 0; attempt < attempts.length; attempt += 1) {
    const compact = attempts[attempt];
    try {
      const raw = await callAi([
        { role: 'system', content: Rules.PAPER_BASE_SYSTEM_PROMPT || Rules.BASE_SYSTEM_PROMPT || Rules.THESIS_BASE_SYSTEM_PROMPT || '你是严谨的单片机本科论文写作专家，只使用用户确认事实，禁止编造技术细节。' },
        { role: 'user', content: mode === 'continue' ? continuationPrompt(chapter, chapter.issues || [], { minimal: compact }) : chapterPrompt(chapter, mode, { compact }) },
      ], { temperature: 0.38, maxTokens: compact ? 24576 : 16384, model: 'thinking', signal });
      if (forceCompact) generation.compactMode = false;
      return { content: stripThink(raw), truncated: false };
    } catch (error) {
      if (error.partialContent) return { content: stripThink(error.partialContent), truncated: true };
      if (!compact && error.code === 'context_limit') continue;
      throw error;
    }
  }
  throw new Error(`第${chapter.id}章生成失败，请继续生成`);
}

function beginAutomaticOutputSegment(chapterId, maximum = 16) {
  const generation = paperGenerationState();
  const key = `automatic-output-segment:${project.revision}:${chapterId}`;
  const current = generation.attempts[key] || { count: 0 };
  if (Number(current.count || 0) < maximum) return true;
  throw makeAiError(`第${chapterId}章已达到自动分段上限，已保存的正文和新稿片段均未丢失；请先人工检查后再决定是否继续`, { code: 'output_limit' });
}

function recordAutomaticOutputSegment(chapterId) {
  recordChapterOperation('automatic-output-segment', chapterId);
}

async function requestCompleteChapterReplacement(chapter, signal, { trackAutomaticSegments = true } = {}) {
  let staged = chapter.pendingInputRevision === project.revision ? String(chapter.pendingContent || '').trim() : '';
  for (let segment = 0; segment < 4; segment += 1) {
    if (signal?.aborted) throw new DOMException('已取消生成', 'AbortError');
    if (trackAutomaticSegments) beginAutomaticOutputSegment(chapter.id);
    const workingChapter = staged ? { ...chapter, content: staged } : chapter;
    const result = await requestChapterContent(workingChapter, { mode: staged ? 'continue' : 'generate', signal });
    if (trackAutomaticSegments) recordAutomaticOutputSegment(chapter.id);
    staged = staged ? appendChapterContent(staged, result.content) : String(result.content || '').trim();
    if (!result.truncated) return staged;
    chapter.pendingContent = staged;
    chapter.pendingInputRevision = project.revision;
    chapter.updatedAt = nowIso();
    saveProject({ immediate: true });
  }
  throw makeAiError(`第${chapter.id}章连续达到输出上限，已保存新稿片段；再次点击继续时会从片段末尾续写，原稿未被覆盖`, { code: 'output_limit' });
}

async function requestCompleteChapterContinuation(chapter, signal, { trackAutomaticSegments = true } = {}) {
  let staged = chapter.pendingInputRevision === project.revision && chapter.pendingContent
    ? String(chapter.pendingContent).trim()
    : String(chapter.content || '').trim();
  for (let segment = 0; segment < 4; segment += 1) {
    if (signal?.aborted) throw new DOMException('已取消生成', 'AbortError');
    if (trackAutomaticSegments) beginAutomaticOutputSegment(chapter.id);
    const workingChapter = { ...chapter, content: staged };
    const result = await requestChapterContent(workingChapter, { mode: 'continue', signal });
    if (trackAutomaticSegments) recordAutomaticOutputSegment(chapter.id);
    staged = appendChapterContent(staged, result.content);
    if (!result.truncated) return staged;
    chapter.pendingContent = staged;
    chapter.pendingInputRevision = project.revision;
    chapter.updatedAt = nowIso();
    saveProject({ immediate: true });
  }
  throw makeAiError(`第${chapter.id}章续写连续达到输出上限，已保存全部片段；再次点击继续可接着完成`, { code: 'output_limit' });
}

function beginChapterRewriteAttempt(chapterId, maximum = 2) {
  const generation = paperGenerationState();
  const key = `full-rewrite:${project.revision}:${chapterId}`;
  const current = generation.attempts[key] || { count: 0 };
  return Number(current.count || 0) < maximum;
}

function recordChapterOperation(kind, chapterId) {
  const generation = paperGenerationState();
  const key = `${kind}:${project.revision}:${chapterId}`;
  const current = generation.attempts[key] || { count: 0 };
  generation.attempts[key] = { count: Number(current.count || 0) + 1, updatedAt: nowIso() };
  saveProject({ immediate: true });
}

function beginChapterContinuationAttempt(chapterId, maximum = 4) {
  const generation = paperGenerationState();
  const key = `auto-continuation:${project.revision}:${chapterId}`;
  const current = generation.attempts[key] || { count: 0 };
  return Number(current.count || 0) < maximum;
}

function issuesRequireReplacement(issues = []) {
  return issues.some(item => /重复|矛盾|冲突|参考文献|引用|标题|代码|函数名|未完成|未实现|无法运行|仅停留|自我否定|出版信息/.test(item.message || item.detail || String(item)));
}

function otherChapterLedger(excludedId) {
  return Object.values(project.paper.chapters || {})
    .filter(item => String(item.id) !== String(excludedId) && item.content)
    .sort((left, right) => Number(left.id) - Number(right.id))
    .map(item => {
      const headings = [...String(item.content).matchAll(/^#{2,3}\s+(.+)$/gm)].map(match => match[1]).slice(0, 12);
      const points = String(item.content).split(/\n{2,}/)
        .map(value => value.replace(/^#{1,6}\s*/, '').replace(/\s+/g, ' ').trim())
        .filter(value => value.length >= 60 && !value.startsWith('【'))
        .slice(0, 10)
        .map(value => value.slice(0, 100));
      return `第${item.id}章账本：标题=${headings.join('；') || '无'}；要点=${points.join('；') || '无'}`;
    })
    .join('\n');
}

function chapterRevisionPrompt(chapter, issues = [], { compact = false } = {}) {
  const references = referencesForPrompt();
  const relevantFacts = chapterMaterialContext(chapter.id, { compact });
  const original = String(chapter.content || '').trim();
  return `【论文题目】${project.title}
【修订章节】第${chapter.id}章《${chapter.title}》
【本章唯一允许的目录】
${chapter.outline}
【必须解决的问题】
${issues.map(item => {
    if (typeof item === 'string') return `- 问题：${item}`;
    return `- 问题：${item.message || item.detail || '提升事实一致性和表达质量'}${item.evidence ? `\n  正文证据：${item.evidence}` : ''}${item.instruction ? `\n  修订要求：${item.instruction}` : ''}`;
  }).join('\n') || '- 提升事实一致性和表达质量'}
【只与本章相关的已确认事实】
${JSON.stringify(relevantFacts, null, 2)}
${chapter.id === '1' ? `【参考文献规则】${referenceWritingPolicy(chapter.id)}\n【参考文献与当前编号】\n${JSON.stringify(references.map(reference => ({ citationNumber: reference.citationNumber, citationToken: reference.citationToken, authors: reference.authors, title: reference.title, fullPublication: formattedReference(reference) })), null, 2)}` : `【参考文献规则】${referenceWritingPolicy(chapter.id)}`}
【其他章节内容账本】
${boundedPromptText(otherChapterLedger(chapter.id), compact ? 4500 : 8000, '其他章节账本') || '暂无其他章节内容'}
【需要修订的完整原文】
${original}

请返回修订后的完整本章正文，并直接替换旧稿，不要只追加补充说明。保留正确事实和必要图表占位，删除重复段落、错误引用、目录外标题、前后矛盾及否定已完成功能的表述。只使用目录中已有的二三级标题，同类内容用段落、分点或表格归纳。严格执行上面的参考文献规则：有文献时只使用用户提供条目并各引用一次，无文献时删除所有引用编号且不得编造文献。第五章必须保留带单位的量化测试数据表。第六章的不足只能写有边界的性能、环境、样本或扩展限制，不得写核心功能未完成。只输出完整本章。`;
}

async function requestChapterRevision(chapter, issues, signal) {
  const generation = paperGenerationState();
  const forceCompact = generation.compactMode && String(generation.currentChapterId) === String(chapter.id);
  const attempts = forceCompact ? [true] : [false, true];
  for (let attempt = 0; attempt < attempts.length; attempt += 1) {
    const compact = attempts[attempt];
    try {
      const raw = await callAi([
        { role: 'system', content: Rules.PAPER_BASE_SYSTEM_PROMPT || '你是严谨的单片机本科论文修订专家。' },
        { role: 'user', content: chapterRevisionPrompt(chapter, issues, { compact }) },
      ], { model: 'thinking', maxTokens: compact ? 65536 : 49152, signal });
      const content = stripThink(raw).trim();
      if (countBodyChars(content) < Math.max(500, Math.round(countBodyChars(chapter.content) * 0.65))) {
        throw new Error(`第${chapter.id}章修订结果过短，已保留原稿`);
      }
      if (forceCompact) generation.compactMode = false;
      return content;
    } catch (error) {
      if (!compact && ['context_limit', 'output_limit'].includes(error.code)) continue;
      throw error;
    }
  }
  throw new Error(`第${chapter.id}章修订失败，已保留原稿`);
}

function firstChapterNeedingGeneration(chapters = Object.values(project.paper.chapters || {})) {
  return [...chapters]
    .sort((left, right) => Number(left.id) - Number(right.id))
    .find(chapter => !chapter.content
      || countBodyChars(chapter.content) < 500
      || chapter.inputRevision !== project.revision
      || chapter.status === 'stale'
      || chapter.status === 'generating'
      || Boolean(chapter.pendingContent)) || null;
}

function persistGeneratedChapter(chapter, content, { append = false } = {}) {
  const next = append ? appendChapterContent(chapter.content, content) : String(content || '').trim();
  let normalized = normalizeRepeatedFigureIntroductions(next);
  if (String(chapter.id) === '1') normalized = normalizeCitationOrder(normalized);
  normalized = dedupeGeneratedContent(normalized, chapter.id);
  if (countBodyChars(normalized) < 200) throw new Error(`第${chapter.id}章返回内容过短，请稍后继续生成`);
  chapter.content = normalized;
  chapter.pendingContent = '';
  chapter.pendingInputRevision = '';
  chapter.status = 'draft';
  chapter.inputRevision = project.revision;
  chapter.updatedAt = nowIso();
  chapter.issues = auditChapterLocal(chapter);
  project.paper.status = 'draft';
  project.paper.quality = null;
  project.paper.semanticIssues = [];
  project.paper.semanticCheckedAt = '';
  project.paper.abstractCn = '';
  project.paper.abstractEn = '';
  project.paper.keywords = '';
  project.paper.acknowledgment = '';
  const generation = paperGenerationState();
  if (generation.status !== 'running') {
    const nextChapter = firstChapterNeedingGeneration();
    const resumePhase = nextChapter ? 'chapters' : 'semantic';
    Object.assign(generation, {
      status: 'paused',
      phase: resumePhase,
      failedPhase: resumePhase,
      currentChapterId: nextChapter?.id || '',
      percent: nextChapter ? 5 : 78,
      message: nextChapter
        ? `第${chapter.id}章已保存，继续时将从第${nextChapter.id}章接着生成`
        : `第${chapter.id}章内容已变化，需要重新复核全文并更新摘要`,
      lastError: '',
      downloadReady: false,
      updatedAt: nowIso(),
    });
  }
  saveProject({ immediate: true });
}

async function generateChapterAutomatically(chapter, signal) {
  const initialIssues = chapter.content ? auditChapterLocal(chapter) : [];
  const initialBlocking = initialIssues.filter(issue => issue.severity === 'blocking');
  const reusable = chapter.content
    && chapter.inputRevision === project.revision
    && chapter.status !== 'stale'
    && !initialBlocking.length;
  if (!reusable) {
    const mustReplace = !chapter.content || chapter.inputRevision !== project.revision || chapter.status === 'stale';
    chapter.status = 'generating';
    saveProject({ immediate: true });
    if (!mustReplace && issuesRequireReplacement(initialBlocking)) {
      if (!beginChapterRewriteAttempt(chapter.id)) {
        chapter.issues = initialIssues;
        chapter.status = 'reviewing';
        saveProject({ immediate: true });
        return false;
      }
      const revised = await requestChapterRevision(chapter, initialBlocking, signal);
      persistGeneratedChapter(chapter, revised, { append: false });
      recordChapterOperation('full-rewrite', chapter.id);
    } else if (mustReplace) {
      const replacement = await requestCompleteChapterReplacement(chapter, signal);
      persistGeneratedChapter(chapter, replacement, { append: false });
    } else {
      if (!beginChapterContinuationAttempt(chapter.id)) {
        chapter.issues = initialIssues;
        chapter.status = 'reviewing';
        saveProject({ immediate: true });
        return false;
      }
      const completed = await requestCompleteChapterContinuation(chapter, signal);
      persistGeneratedChapter(chapter, completed, { append: false });
      recordChapterOperation('auto-continuation', chapter.id);
    }
  }
  for (let attempt = 0; attempt < 1; attempt += 1) {
    chapter.issues = auditChapterLocal(chapter);
    const blocking = chapter.issues.filter(issue => issue.severity === 'blocking');
    if (!blocking.length) break;
    const before = countBodyChars(chapter.content);
    if (issuesRequireReplacement(blocking)) {
      if (!beginChapterRewriteAttempt(chapter.id)) break;
      const revised = await requestChapterRevision(chapter, blocking, signal);
      persistGeneratedChapter(chapter, revised, { append: false });
      recordChapterOperation('full-rewrite', chapter.id);
    } else {
      if (!beginChapterContinuationAttempt(chapter.id)) break;
      const completed = await requestCompleteChapterContinuation(chapter, signal);
      persistGeneratedChapter(chapter, completed, { append: false });
      recordChapterOperation('auto-continuation', chapter.id);
    }
    if (countBodyChars(chapter.content) <= before) break;
  }
  chapter.issues = auditChapterLocal(chapter);
  chapter.status = chapter.issues.some(issue => issue.severity === 'blocking') ? 'reviewing' : 'locked';
  chapter.inputRevision = project.revision;
  saveProject({ immediate: true });
  return chapter.status === 'locked';
}

async function generateChapter(mode = 'generate') {
  if (!paperMaterialsReady()) {
    setView('paper', 1);
    toast('请先填写论文题目、器件清单和功能清单', 'error');
    return;
  }
  const chapter = project.paper.chapters[activeChapter];
  if (!chapter) return;
  if (project.audit.status !== 'confirmed' || project.audit.inputRevision !== project.revision) {
    toast('项目资料已变化，请先重新进行事实核对', 'error');
    setView('paper', 2);
    return;
  }
  chapter.status = 'generating';
  renderPaper();
  requestController = new AbortController();
  requestTask = 'chapter';
  showBusy(`${mode === 'expand' ? '正在补充' : '正在生成'}第 ${chapter.id} 章`, '本次只处理当前章节，其他章节不会被覆盖');
  try {
    const result = mode === 'expand'
      ? { content: await requestCompleteChapterContinuation(chapter, requestController.signal, { trackAutomaticSegments: false }), truncated: false, completeContent: true }
      : { content: await requestCompleteChapterReplacement(chapter, requestController.signal, { trackAutomaticSegments: false }), truncated: false };
    const content = stripThink(result.content);
    if (countBodyChars(content) < 500) throw new Error('生成内容过短，请重新生成');
    persistGeneratedChapter(chapter, content, { append: mode === 'expand' && !result.completeContent });
    renderPaper();
    revealChapterEditor();
    toast(`第 ${chapter.id} 章草稿已生成，请检查后再锁定`, 'success');
  } catch (error) {
    if (error.name !== 'AbortError' && error.partialContent) {
      const partial = stripThink(error.partialContent);
      if (countBodyChars(partial) >= 500 && (mode !== 'expand' || countBodyChars(partial) > countBodyChars(chapter.content))) {
        persistGeneratedChapter(chapter, partial, { append: false });
        toast('本章达到单次输出上限，已保留生成内容；请点击“AI 补充本章”继续完成', 'info');
      } else {
        chapter.status = chapter.content ? 'draft' : 'planned';
        toast('本章达到单次输出上限，现有正文已保留，请点击“AI 补充本章”继续', 'info');
      }
    } else {
      if (error.name !== 'AbortError') toast(error.message || '章节生成失败', 'error');
      chapter.status = chapter.content ? 'draft' : 'planned';
    }
    renderPaper();
    if (error.partialContent && chapter.content) revealChapterEditor();
  } finally {
    hideBusy();
    requestController = null;
    requestTask = '';
  }
}

function headingStructureIssues(chapter) {
  const content = String(chapter.content || '');
  const issues = [];
  const headings = [...content.matchAll(/^(#{2,6})\s+((\d+\.\d+(?:\.\d+)?)\s+[^\n]+)$/gm)].map(match => ({ hashes: match[1].length, number: match[3], text: match[2] }));
  const allowed = new Set([...String(chapter.outline || '').matchAll(/(?:^|\n)\s*#{0,6}\s*(\d+\.\d+(?:\.\d+)?)\s+[^\n]+/g)].map(match => match[1]));
  const seen = new Set();
  headings.forEach(heading => {
    if (seen.has(heading.number)) issues.push({ severity: 'blocking', message: `标题编号 ${heading.number} 在本章重复出现` });
    seen.add(heading.number);
    if (allowed.size && !allowed.has(heading.number)) issues.push({ severity: 'blocking', message: `出现目录外标题 ${heading.number}，只能使用已确认目录中的标题` });
    const expectedLevel = heading.number.split('.').length;
    if ((expectedLevel === 2 && heading.hashes !== 2) || (expectedLevel === 3 && heading.hashes !== 3) || heading.hashes > 3) {
      issues.push({ severity: 'blocking', message: `标题 ${heading.number} 的层级标记错误：二级用##，三级用###，禁止####` });
    }
  });
  const h3 = headings.filter(heading => heading.number.split('.').length === 3);
  if (h3.length > 8) issues.push({ severity: 'blocking', message: `本章包含 ${h3.length} 个三级标题，拆分过细，应合并同类型器件、功能、电路或程序` });
  const byParent = new Map();
  h3.forEach(heading => {
    const parent = heading.number.split('.').slice(0, 2).join('.');
    byParent.set(parent, (byParent.get(parent) || 0) + 1);
  });
  byParent.forEach((count, parent) => {
    if (count > 3) issues.push({ severity: 'blocking', message: `二级标题 ${parent} 下有 ${count} 个三级标题，请归纳为不超过3个逻辑主题` });
  });
  return issues;
}

function testChapterIssues(value) {
  const text = String(value || '');
  const issues = [];
  const hasTable = /^\s*\|[^\n]+\|\s*\n\s*\|(?:\s*:?-{3,}:?\s*\|)+/m.test(text);
  const quantities = text.match(/\d+(?:\.\d+)?\s*(?:%|℃|°C|ms|s|秒|分钟|min|h|小时|V|mV|A|mA|lx|ppm|cm|mm|m|次)(?![A-Za-z])/gi) || [];
  if (!hasTable) issues.push({ severity: 'blocking', message: '第五章必须包含至少一张 Markdown 量化测试数据表' });
  if (quantities.length < 3) issues.push({ severity: 'blocking', message: '第五章缺少足够的带单位量化数据，不能只写“功能正常”' });
  if (/100\s*%|零误差|误差为\s*0(?:\.0+)?\b/.test(text)) issues.push({ severity: 'confirm', message: '测试结果包含100%或零误差等绝对化数值，请结合实际条件确认' });
  return issues;
}

function completionClaimIssues(value) {
  const text = String(value || '');
  const pattern = /(?:尚未|仍未|未能|没有|并未|未予)(?:完全)?(?:实现|完成|验证|部署|运行)|(?:系统|功能|模块)[^。；\n]{0,12}(?:无法运行|没有实现|尚不完整|功能不完善)|仅停留在(?:设想|理论|概念)(?:阶段)?/g;
  return pattern.test(text) ? [{ severity: 'blocking', message: '第六章出现了“未完成/未实现”等自我否定表述；不足应改为有边界的性能、环境、样本或扩展限制' }] : [];
}

function auditChapterLocal(chapter) {
  const issues = [];
  const text = chapter.content || '';
  const chars = countBodyChars(text);
  if (chars < Math.round(chapter.target * 0.72)) issues.push({ severity: 'blocking', message: `本章有效字数 ${chars}，明显低于约 ${chapter.target} 字的目标` });
  if (chapter.id !== '1' && /\[\d+\]/.test(text)) issues.push({ severity: 'blocking', message: '参考文献引用只能出现在第一章' });
  if (chapter.id === '1' && typeof Rules.validateReferences === 'function') {
    try {
      const referenceResult = Rules.validateReferences({ references: referencesForPrompt(), chapters: { 1: text }, requireAllSelected: true });
      referenceResult.errors
        .filter(item => item.code !== 'reference_publication_incomplete')
        .forEach(item => issues.push({ severity: 'blocking', message: item.message || String(item) }));
    } catch (error) { console.warn(error); }
  }
  if (chapter.id === '4') {
    if (/```\s*(?:c|cpp|c\+\+|ino|java)?\b/i.test(text)) issues.push({ severity: 'blocking', message: '软件章节出现了程序代码，请改为业务文字和流程图说明' });
    if (/\b[A-Za-z_]\w{2,}\s*\(/.test(text)) issues.push({ severity: 'confirm', message: '检测到疑似函数名，请确认是否应改为中文业务描述' });
  }
  const devices = paperCoreDevices();
  const functions = paperCoreFunctions();
  if (chapter.id === '2' && devices.length) {
    const missed = devices.filter(device => !text.includes(device.replace(/[（(].*$/, '').trim()));
    if (missed.length) issues.push({ severity: 'confirm', message: `器件选型可能遗漏：${missed.join('、')}` });
  }
  if (chapter.id === '3' && !/待插入图|电路图/.test(text)) issues.push({ severity: 'confirm', message: '硬件章节没有识别到电路图占位说明' });
  if (chapter.id === '4' && !/流程图|开始.*判断|→/.test(text)) issues.push({ severity: 'confirm', message: '软件章节没有识别到详细流程图说明' });
  if (chapter.id === '5') {
    const missingFunctions = functions.filter(item => !text.includes(item.slice(0, Math.min(8, item.length))));
    if (missingFunctions.length) issues.push({ severity: 'confirm', message: `测试章节可能没有逐项回应 ${missingFunctions.length} 项功能` });
    issues.push(...testChapterIssues(text));
  }
  if (chapter.id === '6') issues.push(...completionClaimIssues(text));
  issues.push(...headingStructureIssues(chapter));
  issues.push(...figureUsageIssues(text));
  const customAudit = Rules.auditChapter || Rules.runChapterChecks;
  if (typeof customAudit === 'function') {
    try {
      const extra = customAudit(chapter, project);
      if (Array.isArray(extra)) issues.push(...extra.map(item => ({ severity: item.severity || 'confirm', message: item.message || item.title || String(item) })));
    } catch (error) { console.warn(error); }
  }
  return dedupeIssues(issues);
}

function dedupeIssues(issues) {
  const seen = new Set();
  return issues.filter(issue => {
    const key = String(issue.message || issue.title).replace(/\s+/g, '');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function captureChapterEditor() {
  const chapter = project.paper.chapters[activeChapter];
  const editor = $('chapter-editor');
  if (!chapter || !editor) return;
  if (chapter.content !== editor.value) {
    chapter.content = editor.value;
    chapter.status = chapter.status === 'locked' ? 'draft' : (chapter.status || 'draft');
    chapter.inputRevision = project.revision;
    chapter.updatedAt = nowIso();
    chapter.issues = [];
    chapter.pendingContent = '';
    chapter.pendingInputRevision = '';
    project.paper.quality = null;
    project.paper.semanticIssues = [];
    project.paper.semanticCheckedAt = '';
    project.paper.abstractCn = '';
    project.paper.abstractEn = '';
    project.paper.keywords = '';
    project.paper.acknowledgment = '';
    const generation = paperGenerationState();
    const nextChapter = firstChapterNeedingGeneration();
    const resumePhase = nextChapter ? 'chapters' : 'semantic';
    Object.assign(generation, {
      status: 'paused',
      phase: resumePhase,
      failedPhase: resumePhase,
      currentChapterId: nextChapter?.id || '',
      percent: resumePhase === 'chapters' ? 5 : 78,
      message: resumePhase === 'chapters'
        ? `第${chapter.id}章已保存，继续时将从第${nextChapter.id}章接着生成`
        : `第${chapter.id}章已手动修改，需要重新复核全文并更新摘要`,
      lastError: '',
      downloadReady: false,
      updatedAt: nowIso(),
    });
    saveProject();
  }
}

function auditActiveChapter() {
  captureChapterEditor();
  const chapter = project.paper.chapters[activeChapter];
  chapter.issues = auditChapterLocal(chapter);
  chapter.status = chapter.issues.some(issue => issue.severity === 'blocking') ? 'reviewing' : 'draft';
  saveProject({ immediate: true });
  renderPaper();
  toast(chapter.issues.length ? `检查到 ${chapter.issues.length} 项需要处理的内容` : '本章基础检查通过', chapter.issues.length ? 'info' : 'success');
}

function lockActiveChapter() {
  captureChapterEditor();
  const chapter = project.paper.chapters[activeChapter];
  chapter.issues = auditChapterLocal(chapter);
  const blocking = chapter.issues.filter(issue => issue.severity === 'blocking');
  if (blocking.length) {
    chapter.status = 'reviewing';
    saveProject({ immediate: true });
    renderPaper();
    toast(`还有 ${blocking.length} 项必须解决，暂时不能锁定`, 'error');
    return;
  }
  chapter.status = 'locked';
  chapter.inputRevision = project.revision;
  saveProject({ immediate: true });
  const next = Math.min(6, Number(activeChapter) + 1);
  if (next > Number(activeChapter)) activeChapter = String(next);
  renderPaper();
  toast(`第 ${chapter.id} 章已确认并锁定`, 'success');
}

function totalBodyChars() {
  if (typeof Rules.countEffectiveBodyChars === 'function') {
    return Rules.countEffectiveBodyChars(project.paper.chapters || {});
  }
  return Object.values(project.paper.chapters || {}).reduce((sum, chapter) => sum + countBodyChars(chapter?.content), 0);
}

function repeatedParagraphIssues() {
  const seen = [];
  const issues = [];
  Object.values(project.paper.chapters || {}).forEach(chapter => {
    proseBlocks(chapter.content).filter(isDeduplicableBlock).forEach(paragraph => {
      const duplicate = seen.find(item => trigramSimilarity(item.paragraph, paragraph) >= 0.9);
      if (duplicate) issues.push(`第${duplicate.chapterId}章和第${chapter.id}章存在高度重复段落，需删除重复论述并保留所属章节的唯一职责`);
      else seen.push({ chapterId: chapter.id, paragraph });
    });
  });
  return unique(issues);
}

function acknowledgmentQualityIssues(input = project.paper.acknowledgment) {
  const value = String(input || '').trim();
  const issues = [];
  if (!value) return ['致谢尚未生成'];
  if (value.length < 140) issues.push('致谢过短，应结合选题、硬件调试、程序验证和论文整理等实际环节表达感谢');
  if (/时光荏苒|白驹过隙|岁月如梭|光阴似箭|转眼间.*大学/.test(value)) issues.push('致谢使用了模板化开头，需要改为具体、朴实的项目过程表达');
  const names = [...value.matchAll(/(?:感谢|感激|致谢)(?:我的|本人的)?(?:导师|指导教师|老师|教授)?[：:，,\s]*([\u4e00-\u9fff]{2,4})(?:老师|教授|同学|先生|女士)/g)]
    .map(match => match[1]);
  if (names.length) issues.push(`致谢不得出现人名：${unique(names).join('、')}`);
  return issues;
}

function fallbackQuality() {
  const blocking = [];
  const confirm = [];
  const writing = [];
  const chapters = Object.values(project.paper.chapters || {});
  const bodyChars = totalBodyChars();
  if (bodyChars < 18000) blocking.push(`正文有效字数为 ${bodyChars}，少于 18000 字`);
  if (!project.paper.abstractCn || !project.paper.abstractEn) blocking.push('中英文摘要尚未基于完整正文生成');
  if (project.audit.status !== 'confirmed' || project.audit.inputRevision !== project.revision) blocking.push('项目事实尚未基于当前资料确认');
  const unlocked = chapters.filter(chapter => chapter.status !== 'locked');
  if (unlocked.length) blocking.push(`还有 ${unlocked.length} 个章节未确认并锁定`);
  const stale = chapters.filter(chapter => chapter.inputRevision !== project.revision || chapter.status === 'stale');
  if (stale.length) blocking.push(`有 ${stale.length} 个章节基于旧资料，需要复查`);
  chapters.forEach(chapter => {
    auditChapterLocal(chapter).forEach(issue => (issue.severity === 'blocking' ? blocking : confirm).push(`第${chapter.id}章：${issue.message}`));
  });
  const nonCh1 = chapters.filter(chapter => chapter.id !== '1' && /\[\d+\]/.test(chapter.content || ''));
  if (nonCh1.length) blocking.push('第二章以后出现了参考文献引用标记');
  const refs = referencesForPrompt();
  const ch1 = project.paper.chapters['1']?.content || '';
  const ch2 = project.paper.chapters['2']?.content || '';
  const ch3 = project.paper.chapters['3']?.content || '';
  const ch4 = project.paper.chapters['4']?.content || '';
  const ch5 = project.paper.chapters['5']?.content || '';
  const citations = [...ch1.matchAll(/\[(\d+)\]/g)].map(match => Number(match[1]));
  if (refs.length) {
    if (citations.length !== refs.length) blocking.push(`提供了 ${refs.length} 篇参考文献，但第一章实际出现 ${citations.length} 个引用`);
    if (citations.some((value, index) => value !== index + 1)) blocking.push('参考文献编号没有按 [1]、[2]、[3] 顺序连续出现');
    if (new Set(citations).size !== citations.length) blocking.push('存在同一篇文献被重复引用');
    if (/\[\d+\s*[-,，、]\s*\d+\]/.test(ch1) || /\[\d+\]\s*\[\d+\]/.test(ch1)) blocking.push('存在一句或一处同时使用多个引用标识');
  } else if (citations.length) blocking.push('未提供参考文献却出现了引用编号');
  const ch2Figures = uniqueFigurePlaceholderCount(ch2, 2);
  const ch3Figures = uniqueFigurePlaceholderCount(ch3, 3);
  const ch4Flows = (ch4.match(/流程图|【非正文·流程图/g) || []).length;
  const ch5Figures = uniqueFigurePlaceholderCount(ch5, 5);
  const devices = paperCoreDevices();
  const functions = paperCoreFunctions();
  if (devices.length && ch2Figures < devices.length) blocking.push(`第二章器件图片占位不足：识别到 ${ch2Figures} 个，应逐项覆盖 ${devices.length} 个器件`);
  if (devices.length && ch3Figures < Math.max(1, devices.length - 1)) blocking.push(`第三章电路图占位不足：识别到 ${ch3Figures} 个，尚未覆盖主要硬件模块`);
  if (functions.length && ch4Flows < Math.max(1, functions.length)) blocking.push(`第四章流程图说明不足：识别到 ${ch4Flows} 处，尚未覆盖主要功能逻辑`);
  if (functions.length && ch5Figures < functions.length) blocking.push(`第五章功能展示图占位不足：识别到 ${ch5Figures} 个，应逐项覆盖 ${functions.length} 项功能`);
  if (lines(project.materials.connectionText).length >= 3 && !/表\s*3[-－—]\d+|连接关系表/.test(ch3)) confirm.push('连接信号较多，但第三章没有识别到连接关系表，请确认正文是否已经集中说明清楚');
  const allBody = Object.values(project.paper.chapters || {}).map(chapter => chapter.content || '').join('\n');
  if (/待插入/.test(allBody) && !/【非正文·/.test(allBody)) blocking.push('存在图表占位，但缺少与正文区分的详细绘制或拍摄说明');
  repeatedParagraphIssues().forEach(item => blocking.push(item));
  (project.paper.semanticIssues || []).forEach(item => {
    const message = `${item.chapterId ? `第${item.chapterId}章：` : ''}${item.detail || item.message || item}`;
    (item.severity === 'blocking' ? blocking : confirm).push(message);
  });
  acknowledgmentQualityIssues().forEach(item => blocking.push(item));
  const referenceValidator = Rules.validateReferences;
  if (typeof referenceValidator === 'function') {
    try {
      const referenceResult = referenceValidator({ references: refs, chapters: project.paper.chapters, requireAllSelected: true });
      referenceResult.errors.forEach(item => blocking.push(item.message || String(item)));
      referenceResult.warnings.forEach(item => confirm.push(item.message || String(item)));
    } catch (error) { console.warn(error); }
  }
  if (!project.materials.testInfo) writing.push('第五章量化数据由系统按器件能力和常见实验条件保守推定，请在定稿前根据实物测试调整');
  if (!project.materials.photoNotes) confirm.push('实物图和功能展示图仍需在 WPS 中补充');
  return { bodyChars, blocking: unique(blocking), confirm: unique(confirm), writing: unique(writing), checkedAt: nowIso() };
}

function runQuality() {
  if (!paperMaterialsReady()) {
    setView('paper', 1);
    toast('请先填写论文题目、器件清单和功能清单', 'error');
    return;
  }
  const result = runQualityCore();
  renderPaper();
  toast(result.blocking.length ? `检查完成，还有 ${result.blocking.length} 项必须解决` : '论文内容检查通过，可以导出最终稿', result.blocking.length ? 'info' : 'success');
}

function runQualityCore() {
  Object.values(project.paper.chapters || {}).forEach(chapter => {
    if (chapter.content) chapter.issues = auditChapterLocal(chapter);
  });
  let result = fallbackQuality();
  const checker = Rules.runFinalQualityChecks || Rules.auditFinalPaper;
  if (typeof checker === 'function') {
    try {
      const sourceRecords = [];
      if (project.materials.codeText) sourceRecords.push({ id: 'source-code', kind: 'source_code' });
      if (project.materials.testInfo) sourceRecords.push({ id: 'source-test', kind: 'test_record' });
      const closureByFunction = new Map(project.scheme.closures.map(closure => [closure.functionId, closure]));
      const structuredProject = {
        title: project.title,
        topic: project.title,
        status: project.audit.status === 'confirmed' ? 'locked' : 'draft',
        factRevision: project.revision,
        sources: sourceRecords,
        facts: [],
        devices: project.scheme.deviceRecords.map(device => ({ id: device.id, model: device.model, name: device.model, role: device.role || '' })),
        functions: project.scheme.functionRecords.map(func => {
          const closure = closureByFunction.get(func.id);
          return {
            id: func.id,
            name: func.name,
            deviceIds: closure ? closureLinkedIds(closure) : [],
            softwareEvidenceIds: project.materials.codeText ? ['source-code'] : [],
            testId: project.materials.testInfo ? 'source-test' : '',
          };
        }),
        conflicts: [
          ...project.audit.issues.filter(issue => issue.severity === 'blocking' && !issue.resolved).map(issue => ({ ...issue, status: 'open' })),
          ...unresolvedSchemeConflicts().map(item => ({ ...item, status: 'open' })),
        ],
        hardwareReport: { status: project.audit.status === 'confirmed' ? 'confirmed' : 'draft' },
        programReport: { status: project.audit.status === 'confirmed' ? 'confirmed' : 'draft' },
      };
      const outline = Object.keys(project.paper.chapters || {}).sort((a, b) => Number(a) - Number(b)).map(id => ({
        number: id,
        title: project.paper.chapters[id]?.title || CHAPTER_TITLES[id],
      }));
      const canUseStructuredFactGate = project.paper.sourceMode === 'scheme'
        && project.scheme.relationsStage === 'paper'
        && project.scheme.closures.length === project.scheme.functionRecords.length
        && project.scheme.closures.every(closure => closure.status === 'confirmed');
      const custom = canUseStructuredFactGate ? checker({
          project: structuredProject,
          chapters: project.paper.chapters,
          outline,
          references: referencesForPrompt(),
          artifacts: [],
           abstractCn: project.paper.abstractCn,
           abstractEn: project.paper.abstractEn,
           acknowledgment: project.paper.acknowledgment,
         }) : null;
      if (custom && typeof custom === 'object') {
        result = {
          ...result,
          ...custom,
          blocking: unique([...(result.blocking || []), ...(custom.blocking || custom.mustResolve || []), ...(custom.errors || []).map(item => item.message || String(item))]),
          confirm: unique([...(result.confirm || []), ...(custom.confirm || custom.shouldConfirm || []), ...(custom.warnings || []).map(item => item.message || String(item))]),
          writing: unique([...(result.writing || []), ...(custom.writing || custom.optimization || [])]),
        };
      }
    } catch (error) {
      console.warn(error);
    }
  }
  project.paper.quality = result;
  project.paper.status = result.blocking.length ? 'reviewing' : 'final';
  saveProject({ immediate: true });
  return result;
}

function qualityChapterTargets(result) {
  const text = (result?.blocking || []).join('\n');
  const ids = new Set();
  if (/第一章|参考文献|引用/.test(text)) ids.add('1');
  if (/第二章|器件图片|器件选型/.test(text)) ids.add('2');
  if (/第三章|电路图|连接关系/.test(text)) ids.add('3');
  if (/第四章|流程图|函数名|代码/.test(text)) ids.add('4');
  if (/第五章|功能展示|测试/.test(text)) ids.add('5');
  if (/第六章|总结|展望/.test(text)) ids.add('6');
  if (/正文有效字数/.test(text)) {
    Object.values(project.paper.chapters || {})
      .filter(chapter => countBodyChars(chapter.content) < Number(chapter.target || 0))
      .forEach(chapter => ids.add(chapter.id));
  }
  return [...ids];
}

function qualityRepairState(result) {
  const generation = paperGenerationState();
  const automatic = [];
  const manual = [];
  const allBlocking = result?.blocking || [];
  allBlocking.forEach(item => {
    const message = typeof item === 'string' ? item : item.message || String(item);
    if (/缺少(?:期刊名|年份|卷号|期号|页码|学位授予单位|出版社)|出版信息不完整|不能只保留作者和题名/.test(message)) {
      manual.push(message);
      return;
    }
    const ids = qualityChapterTargets({ blocking: [message] });
    const canRepairChapter = ids.some(id => {
      if (/正文有效字数/.test(message)) {
        const continuationKey = `auto-continuation:${project.revision}:${id}`;
        if (Number(generation.attempts[continuationKey]?.count || 0) >= 4) return false;
        const lengthKey = `length-fill:${id}:${project.revision}`;
        return Number(generation.attempts[lengthKey]?.count || 0) < 3;
      }
      const related = allBlocking.filter(candidate => {
        const candidateMessage = typeof candidate === 'string' ? candidate : candidate.message || '';
        return candidateMessage.includes(`第${id}章`) || (id === '1' && /参考文献|引用/.test(candidateMessage));
      });
      if (!related.length) return false;
      const replace = issuesRequireReplacement(related);
      const key = `${replace ? 'full-rewrite' : 'auto-continuation'}:${project.revision}:${id}`;
      const count = Number(generation.attempts[key]?.count || 0);
      if (count >= (replace ? 2 : 4)) return false;
      const detailedKey = generationAttemptKey('quality-repair', id, related);
      return Number(generation.attempts[detailedKey]?.count || 0) < 3;
    });
    if (canRepairChapter) automatic.push(message);
    else manual.push(message);
  });
  return { automatic, manual };
}

const SEMANTIC_AUDIT_VERSION = 'semantic-20260823-7';
const SEMANTIC_AUDIT_BATCHES = Object.freeze([
  Object.freeze({ id: 'purpose-solution-implementation', chapterIds: ['1', '2', '3', '4'], label: '研究目标、方案与实现一致性', focus: '检查背景和研究目标是否由总体方案、硬件和软件落实，核对器件与接口事实，并识别第1至4章职责越界和大段重复。' }),
  Object.freeze({ id: 'purpose-solution-evidence', chapterIds: ['1', '2', '5', '6'], label: '研究目标、方案、测试与总结闭环', focus: '检查功能目标是否在测试中得到量化验证、总结是否与方案和测试一致，并识别背景、方案、测试及总结之间的不当重复。' }),
  Object.freeze({ id: 'implementation-test-result', chapterIds: ['3', '4', '5', '6'], label: '实现、测试与结论一致性', focus: '检查硬件和软件实现是否被测试覆盖，测试是否有量化表格且数据前后一致，总结是否否定已完成功能。' }),
  Object.freeze({ id: 'global-digest', chapterIds: ['1', '2', '3', '4', '5', '6'], label: '全文结构与重复复核', focus: '基于各章代表性片段检查跨章大段重复、三级标题拆分过细和全文关键事实漂移。', digestOnly: true }),
]);

function promptSignature(value) {
  let hash = 2166136261;
  const input = String(value || '');
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function semanticChapterExcerpt(chapter, { compact = false, digestOnly = false } = {}) {
  const content = String(chapter?.content || '').trim();
  if (!compact && !digestOnly) return content;
  const evidencePattern = /STM32|STC\d|AT89|ESP32|ESP8266|I\s*[²2]\s*C|SPI|UART|GPIO|引脚|接口|供电|电压|阈值|平均|误差|响应|成功率|通过率|稳定|测试结果|未完成|未实现|无法运行|设想/i;
  const sections = content.split(/(?=^##\s+)/gm).filter(Boolean);
  const selected = sections.map(section => {
    const blocks = proseBlocks(section);
    const headings = blocks.filter(block => /^#{2,3}\s/.test(block));
    const tables = blocks.filter(block => /^\s*\|/m.test(block));
    const evidence = blocks.filter(block => evidencePattern.test(block));
    const prose = blocks.filter(block => !/^#{2,3}\s/.test(block) && !/^\s*\|/m.test(block));
    return unique([
      ...headings.slice(0, 4),
      prose[0],
      ...evidence.slice(0, compact ? 4 : 7),
      ...tables.slice(0, compact ? 2 : 4),
      prose.at(-1),
    ].filter(Boolean)).join('\n\n');
  }).filter(Boolean).join('\n\n');
  const limit = digestOnly ? (compact ? 4500 : 7000) : 9500;
  return boundedPromptText(selected || content, limit, `第${chapter?.id || ''}章复核摘要`) || '';
}

function semanticBatchPrompt(batch, { compact = false } = {}) {
  const chapters = batch.chapterIds.map(id => project.paper.chapters[id]).filter(Boolean);
  const body = chapters.map(chapter => `===== 第${chapter.id}章 ${chapter.title} =====\n${semanticChapterExcerpt(chapter, { compact, digestOnly: batch.digestOnly })}`).join('\n\n');
  const facts = {
    title: project.title,
    devices: paperDevices(),
    functions: paperFunctions(),
    coreDevices: paperCoreDevices(),
    coreFunctions: paperCoreFunctions(),
    connections: boundedPromptText(project.materials.connectionText, compact ? 3000 : 10000, '连接说明') || '用户未提供连接说明',
    confirmedResolutions: project.audit.issues.filter(item => item.resolved).map(confirmedAuditResolutionText).join('\n') || '暂无人工确认项',
    missingMaterialPolicy: '资料框未录入不等于系统未完成；只有正文中两处明确冲突才可报告硬件矛盾，未知事实不得猜测。',
  };
  return `请执行单片机本科论文的一致性审查批次“${batch.label}”。\n【本批重点】${batch.focus}\n\n【已确认事实】\n${JSON.stringify(facts, null, 2)}\n\n只报告证据明确、会降低论文质量的问题：\n1. 两章大段同义或原样重复，而不是必要的一两句衔接；\n2. 型号、通信方式、供电、引脚、接口、控制关系或同一测试数据明确矛盾；\n3. 第五章缺少量化测试表或正文、表格、结论数据不一致；\n4. 同类器件、电路、程序或测试被机械拆成过多三级标题；\n5. 第六章把已确认核心功能写成未完成、未实现、无法运行或仅停留在设想。\n\n每批最多返回20个独立问题，优先保留会影响技术事实和论文结论的问题。每个问题必须给出正文证据和具体修订办法，单条证据控制在160字以内；证据不足时不要报告。需要修改哪章就把 chapterId 指向哪章。返回严格JSON：\n{"issues":[{"chapterId":"1-6","severity":"blocking或confirm","type":"repetition|hardware_contradiction|test_data|heading_fragmentation|completion_denial","detail":"问题及冲突双方","evidence":"对应章节和可定位文字","instruction":"不改变已确认事实的修改办法"}]}\n没有问题返回 {"issues":[]}，不要返回Markdown。\n\n【本批正文】\n${body}`;
}

function normalizeSemanticIssues(data, batch) {
  const allowedTypes = new Set(['repetition', 'hardware_contradiction', 'test_data', 'heading_fragmentation', 'completion_denial']);
  return (Array.isArray(data?.issues) ? data.issues : []).map(item => {
    const evidence = String(item.evidence || '').trim();
    return {
      chapterId: batch.chapterIds.includes(String(item.chapterId || '')) ? String(item.chapterId) : '',
      severity: evidence && item.severity !== 'confirm' ? 'blocking' : 'confirm',
      type: allowedTypes.has(item.type) ? item.type : 'hardware_contradiction',
      detail: String(item.detail || '').trim(),
      evidence: evidence || '模型未单独列出可定位证据，保留为人工确认项',
      instruction: String(item.instruction || '').trim(),
      batchId: batch.id,
    };
  }).filter(item => item.chapterId && item.detail);
}

function semanticIssueKey(issue) {
  return `${issue.chapterId}|${issue.type}|${String(issue.detail || '').replace(/\s+/g, '').slice(0, 160)}`;
}

async function runSemanticAuditBatch(batch, signal) {
  const generation = paperGenerationState();
  const signatureSource = JSON.stringify({
    version: SEMANTIC_AUDIT_VERSION,
    model: DEEPSEEK_REASONING_MODEL,
    revision: project.revision,
    batch,
    title: project.title,
    devices: paperDevices(),
    functions: paperFunctions(),
    connections: project.materials.connectionText || '',
    sourceNotes: project.materials.sourceNotes || '',
    confirmedResolutions: project.audit.issues.filter(item => item.resolved).map(item => ({
      title: item.title,
      detail: item.detail || '',
      suggestion: item.suggestion || '',
      finalResolution: finalIssueResolution(item),
    })),
    coreDevices: paperCoreDevices(),
    coreFunctions: paperCoreFunctions(),
    chapters: batch.chapterIds.map(id => ({
      id,
      outline: project.paper.chapters[id]?.outline || '',
      duty: chapterDuty(id),
      content: project.paper.chapters[id]?.content || '',
    })),
  });
  const signature = promptSignature(signatureSource);
  const cached = generation.semanticBatches[batch.id];
  if (cached?.status === 'completed' && cached.signature === signature && Array.isArray(cached.issues)) return cached.issues;

  generation.semanticBatchId = batch.id;
  generation.semanticBatches[batch.id] = { status: 'running', signature, issues: [], updatedAt: nowIso() };
  saveProject({ immediate: true });
  const forceCompact = (cached?.status === 'failed' && cached.signature === signature && cached.compact)
    || (generation.compactMode && generation.phase === 'semantic' && generation.semanticBatchId === batch.id);
  const attempts = forceCompact ? [true] : [false, true];
  for (let attempt = 0; attempt < attempts.length; attempt += 1) {
    const compact = attempts[attempt];
    try {
      const raw = await callAi([
        { role: 'system', content: '你是嵌入式本科论文一致性审稿人。只报告有明确正文证据的问题，返回严格JSON，不新增或猜测项目事实。' },
        { role: 'user', content: semanticBatchPrompt(batch, { compact }) },
      ], { model: 'thinking', maxTokens: compact ? 49152 : 32768, jsonMode: true, signal });
      let data;
      try {
        data = parseJsonResponse(raw);
      } catch (error) {
        error.code = 'invalid_json';
        throw error;
      }
      const issues = normalizeSemanticIssues(data, batch);
      generation.semanticBatches[batch.id] = { status: 'completed', signature, issues, compact, updatedAt: nowIso() };
      if (forceCompact) generation.compactMode = false;
      saveProject({ immediate: true });
      return issues;
    } catch (error) {
      generation.semanticBatches[batch.id] = { status: 'failed', signature, issues: [], compact, error: error.message || '审查失败', updatedAt: nowIso() };
      saveProject({ immediate: true });
      if (!compact && ['context_limit', 'output_limit', 'invalid_json'].includes(error.code)) continue;
      throw error;
    }
  }
  throw new Error(`审查批次“${batch.label}”未完成`);
}

async function runSemanticPaperAudit(signal) {
  const generation = paperGenerationState();
  const merged = new Map();
  for (let index = 0; index < SEMANTIC_AUDIT_BATCHES.length; index += 1) {
    if (signal.aborted) throw new DOMException('已取消生成', 'AbortError');
    const batch = SEMANTIC_AUDIT_BATCHES[index];
    const percent = 78 + Math.round(index / SEMANTIC_AUDIT_BATCHES.length * 4);
    generation.message = `正在复核：${batch.label}`;
    generation.percent = percent;
    updateBusyProgress(percent, `全文复核 ${index + 1} / ${SEMANTIC_AUDIT_BATCHES.length}`, batch.label);
    saveProject({ immediate: true });
    const issues = await runSemanticAuditBatch(batch, signal);
    issues.forEach(issue => {
      const key = semanticIssueKey(issue);
      if (!merged.has(key) || (merged.get(key).severity === 'confirm' && issue.severity === 'blocking')) merged.set(key, issue);
    });
  }
  generation.semanticBatchId = '';
  const issues = [...merged.values()];
  project.paper.semanticIssues = issues;
  project.paper.semanticCheckedAt = nowIso();
  saveProject({ immediate: true });
  return issues;
}

function generationAttemptKey(prefix, chapterId, issues) {
  const chapterSignature = promptSignature(project.paper.chapters?.[chapterId]?.content || '');
  const issueSignature = promptSignature((issues || []).map(item => `${item.type || ''}|${item.message || item.detail || item}|${item.evidence || ''}|${item.instruction || ''}`).join('\n'));
  return `${SEMANTIC_AUDIT_VERSION}:${prefix}:${chapterId}:${chapterSignature}:${issueSignature}`;
}

async function auditAndRepairPaperSemantics(signal) {
  const generation = paperGenerationState();
  let issues = await runSemanticPaperAudit(signal);
  for (let pass = 0; pass < 3; pass += 1) {
    const targets = [...new Set(issues.filter(item => item.severity === 'blocking').map(item => item.chapterId))];
    if (!targets.length) break;
    let changed = false;
    for (let index = 0; index < targets.length; index += 1) {
      if (signal.aborted) throw new DOMException('已取消生成', 'AbortError');
      const chapter = project.paper.chapters[targets[index]];
      if (!chapter) continue;
      const related = issues.filter(item => item.chapterId === chapter.id && item.severity === 'blocking');
      const attemptKey = generationAttemptKey('semantic-repair', chapter.id, related);
      const attempt = generation.attempts[attemptKey] || { count: 0, completed: false };
      if (attempt.completed || attempt.count >= 2) continue;
      if (!beginChapterRewriteAttempt(chapter.id)) continue;
      generation.attempts[attemptKey] = { ...attempt, completed: false, startedAt: nowIso(), updatedAt: nowIso() };
      generation.currentChapterId = chapter.id;
      saveProject({ immediate: true });
      updateBusyProgress(82 + pass + Math.round(index / Math.max(1, targets.length) * 2), `第 ${pass + 1} 轮：修订第 ${chapter.id} 章`, related[0]?.detail || '正在消除重复、矛盾或不当标题');
      const revised = await requestChapterRevision(chapter, related, signal);
      persistGeneratedChapter(chapter, revised, { append: false });
      recordChapterOperation('full-rewrite', chapter.id);
      generation.attempts[attemptKey] = { count: attempt.count + 1, completed: true, updatedAt: nowIso() };
      chapter.issues = auditChapterLocal(chapter);
      chapter.status = chapter.issues.some(issue => issue.severity === 'blocking') ? 'reviewing' : 'locked';
      changed = true;
      saveProject({ immediate: true });
    }
    if (!changed) break;
    generation.currentChapterId = '';
    generation.message = `第 ${pass + 1} 轮一致性修订已保存，正在重新复核`;
    saveProject({ immediate: true });
    issues = await runSemanticPaperAudit(signal);
  }
  return issues;
}

function renderQuality(panel) {
  const result = project.paper.quality;
  const bodyChars = totalBodyChars();
  const locked = Object.values(project.paper.chapters || {}).filter(chapter => chapter.status === 'locked').length;
  panel.innerHTML = `
    <div class="panel-heading"><div><span class="step-kicker">第 5 步</span><h2>检查通过后才算最终稿</h2><p>检查事实一致性、功能闭环、引用、重复内容、章节状态和正文有效字数。</p></div><span class="status-pill ${result?.blocking?.length ? 'is-danger' : result ? 'is-success' : ''}">${result ? (result.blocking.length ? '论文草稿' : '可以导出最终稿') : '等待检查'}</span></div>
    <div class="quality-overview"><div><span>正文有效字数</span><strong>${bodyChars.toLocaleString('zh-CN')}</strong><small>最低 18,000</small></div><div><span>已锁定章节</span><strong>${locked} / 6</strong><small>需全部确认</small></div><div><span>参考文献</span><strong>${referencesForPrompt().length || '未提供'}</strong><small>${referencesForPrompt().length ? '只在第一章各引用一次' : '默认无文献模式'}</small></div></div>
    ${result ? renderQualityGroups(result) : '<div class="empty-state"><span>✓</span><h3>还没有运行全文检查</h3><p>系统不会只给一个模糊分数，而会告诉你具体需要处理什么。</p></div>'}
    <div class="extras-card"><div><h3>摘要和导出</h3><p>摘要在正文完成后生成，确保研究目的、方法、成果与全文一致。</p></div><button class="btn btn-secondary" id="ai-generate-abstracts" type="button" data-action="generate-abstracts">${project.paper.abstractCn ? 'AI 重新生成摘要' : 'AI 生成中英文摘要'}</button></div>
    ${project.paper.abstractCn ? `<details class="abstract-preview"><summary>查看已生成摘要</summary><h4>中文摘要</h4><p>${escapeHtml(project.paper.abstractCn)}</p><h4>关键词</h4><p>${escapeHtml(project.paper.keywords)}</p><h4>English Abstract</h4><p>${escapeHtml(project.paper.abstractEn)}</p></details>` : ''}
    <div class="panel-actions"><button class="btn btn-secondary" type="button" data-action="paper-step" data-step="4">返回分章写作</button><button class="btn btn-secondary" type="button" data-action="run-quality">运行全文检查</button><button class="btn btn-secondary" type="button" data-action="export-paper" data-final="false">导出论文草稿</button><button class="btn btn-primary" type="button" data-action="export-paper" data-final="true" ${result && !result.blocking.length ? '' : 'disabled'}>导出最终稿</button></div>`;
}

function renderQualityGroups(result) {
  const group = (title, items, className, emptyText) => `<section class="quality-group ${className}"><header><h3>${title}</h3><span>${items.length}</span></header>${items.length ? `<ul>${items.map(item => `<li>${escapeHtml(typeof item === 'string' ? item : item.message || item.title)}</li>`).join('')}</ul>` : `<p>${emptyText}</p>`}</section>`;
  return `<div class="quality-groups">
    ${group('必须解决', result.blocking || [], 'quality-blocking', '没有阻断最终稿的问题')}
    ${group('建议确认', result.confirm || [], 'quality-confirm', '没有额外待确认项')}
    ${group('写作优化', result.writing || [], 'quality-writing', '没有检测到明显重复或结构问题')}
  </div>`;
}

async function generateAbstracts() {
  if (!paperMaterialsReady()) {
    setView('paper', 1);
    toast('请先填写论文题目、器件清单和功能清单', 'error');
    return;
  }
  const chapters = Object.values(project.paper.chapters || {}).filter(chapter => chapter.content);
  if (chapters.length < 6) {
    toast('请先完成六个章节，再生成摘要', 'error');
    return;
  }
  const digest = chapters.map(chapter => `第${chapter.id}章：${chapter.content.slice(0, 1200)}`).join('\n\n');
  requestController = new AbortController();
  requestTask = 'abstract';
  showBusy('正在根据全文生成摘要', '中文摘要完成后再生成一致的英文摘要');
  try {
    const raw = await callAi([
      { role: 'system', content: '你是本科工程论文摘要编辑。只能概括正文已有事实，不添加新功能、新数据或夸张结论。返回严格 JSON，不要 Markdown。' },
      { role: 'user', content: `题目：${project.title}\n全文摘要材料：\n${digest}\n\n返回 {"abstractCn":"300至500字中文摘要，包含目的、方法、实现内容、保守成果","keywords":"3至5个中文关键词，用分号分隔","abstractEn":"与中文摘要语义完全一致的英文摘要","acknowledgment":"180至260字、2至3段的朴实致谢；结合选题分析、硬件调试、程序验证和论文整理，不出现任何人名、学校名或单位名，不使用时光荏苒、白驹过隙、岁月如梭等模板句"}` },
    ], { temperature: 0.25, jsonMode: true, signal: requestController.signal });
    const data = parseJsonResponse(raw);
    project.paper.abstractCn = String(data.abstractCn || '').trim();
    project.paper.keywords = String(data.keywords || '').trim();
    project.paper.abstractEn = String(data.abstractEn || '').trim();
    project.paper.acknowledgment = String(data.acknowledgment || '').trim();
    saveProject({ immediate: true });
    renderPaper();
    toast('中英文摘要已生成，请结合正文检查', 'success');
  } catch (error) {
    if (error.name !== 'AbortError') toast(error.message || '摘要生成失败', 'error');
  } finally {
    hideBusy();
    requestController = null;
    requestTask = '';
  }
}

async function generateAbstractsCore(signal) {
  const chapters = Object.values(project.paper.chapters || {})
    .filter(chapter => chapter.content)
    .sort((a, b) => Number(a.id) - Number(b.id));
  if (chapters.length < 6) throw new Error('六个章节尚未全部生成，暂时不能生成摘要');
  const digest = chapters.map(chapter => {
    const content = String(chapter.content || '');
    const middle = Math.max(0, Math.floor(content.length / 2) - 600);
    return `第${chapter.id}章《${chapter.title}》：\n开头：${content.slice(0, 1000)}\n中部：${content.slice(middle, middle + 1200)}\n结尾：${content.slice(-1000)}`;
  }).join('\n\n');
  const raw = await callAi([
    { role: 'system', content: '你是本科工程论文摘要编辑。只能概括正文已有事实，不添加新功能、新数据或夸张结论。返回严格 JSON，不要 Markdown。' },
    { role: 'user', content: `题目：${project.title}\n全文摘要材料：\n${digest}\n\n返回 {"abstractCn":"300至500字中文摘要，包含目的、方法、实现内容、保守成果","keywords":"3至5个中文关键词，用分号分隔","abstractEn":"与中文摘要语义完全一致的英文摘要","acknowledgment":"180至260字、2至3段的朴实致谢；结合选题分析、硬件调试、程序验证和论文整理，不出现任何人名、学校名或单位名，不使用时光荏苒、白驹过隙、岁月如梭等模板句"}` },
  ], { temperature: 0.25, maxTokens: 4096, jsonMode: true, signal });
  const data = parseJsonResponse(raw);
  const abstractCn = String(data.abstractCn || '').trim();
  const keywords = String(data.keywords || '').trim();
  const abstractEn = String(data.abstractEn || '').trim();
  if (!abstractCn || !keywords || !abstractEn) throw new Error('摘要返回内容不完整，请继续生成');
  let acknowledgment = String(data.acknowledgment || '').trim();
  if (acknowledgmentQualityIssues(acknowledgment).length) {
    acknowledgment = stripThink(await callAi([
      { role: 'system', content: '你是本科工程论文致谢编辑。只返回致谢正文，不返回标题或解释。' },
      { role: 'user', content: `请重写下面致谢。要求180至260字、2至3段，结合选题分析、硬件搭建与调试、程序验证、测试记录和论文整理表达概括性感谢；不得出现任何人名、学校名、单位名；不得使用“时光荏苒、白驹过隙、岁月如梭、光阴似箭”等模板句。\n\n原文：${acknowledgment}` },
    ], { temperature: 0.45, maxTokens: 1200, signal })).trim();
  }
  const acknowledgmentIssues = acknowledgmentQualityIssues(acknowledgment);
  if (acknowledgmentIssues.length) throw new Error(acknowledgmentIssues[0]);
  project.paper.abstractCn = abstractCn;
  project.paper.keywords = keywords;
  project.paper.abstractEn = abstractEn;
  project.paper.acknowledgment = acknowledgment;
  saveProject({ immediate: true });
  return data;
}

function paperExtrasReady() {
  return Boolean(project.paper.abstractCn && project.paper.abstractEn && project.paper.keywords && project.paper.acknowledgment);
}

async function generateFullPaper() {
  healOrphanedGeneration();
  if (requestController) {
    toast('已有生成任务正在进行，请稍候', 'info');
    return;
  }
  if (!paperMaterialsReady()) {
    setView('paper', 1);
    toast('请先填写论文题目、器件清单和功能清单', 'error');
    return;
  }
  if (project.audit.status !== 'confirmed' || project.audit.inputRevision !== project.revision) {
    setView('paper', 2);
    toast('项目资料发生变化，请先重新确认事实', 'error');
    return;
  }
  if (!project.outline.confirmedAt || project.outline.inputRevision !== project.revision) {
    setView('paper', 3);
    toast('请先确认当前论文目录', 'error');
    return;
  }
  ensureChapterRecords();
  const generation = paperGenerationState();
  const chapters = Object.values(project.paper.chapters).sort((a, b) => Number(a.id) - Number(b.id));
  const firstPendingChapter = firstChapterNeedingGeneration(chapters);
  const phaseOrder = { chapters: 0, semantic: 1, abstract: 2, quality: 3, export: 4 };
  const sameRevision = generation.inputRevision === project.revision;
  const checkpoint = sameRevision && ['paused', 'failed'].includes(generation.status)
    ? generation.failedPhase || generation.phase
    : '';
  const checkpointChapter = checkpoint === 'chapters'
    ? chapters.find(chapter => String(chapter.id) === String(generation.currentChapterId || '')) || null
    : null;
  let startPhase = 'chapters';
  if (checkpointChapter || firstPendingChapter) startPhase = 'chapters';
  else if (sameRevision && generation.status === 'completed' && project.paper.quality?.blocking?.length) startPhase = 'quality';
  else if (sameRevision && ['paused', 'failed'].includes(generation.status)) {
    if (Object.hasOwn(phaseOrder, checkpoint)) startPhase = checkpoint;
  } else if (sameRevision && chapters.every(chapter => chapter.content && chapter.inputRevision === project.revision)) {
    startPhase = project.paper.semanticCheckedAt ? (paperExtrasReady() ? 'quality' : 'abstract') : 'semantic';
  }
  const resumeChapterId = startPhase === 'chapters'
    ? String(checkpointChapter?.id || firstPendingChapter?.id || (sameRevision ? generation.currentChapterId : '') || '')
    : '';

  if (!sameRevision) {
    generation.completedChapterIds = [];
    generation.semanticBatches = {};
    generation.attempts = {};
    generation.compactMode = false;
    generation.startedAt = '';
  }
  const paperController = new AbortController();
  requestController = paperController;
  requestTask = 'paper';
  const signal = paperController.signal;
  try {
    Object.assign(generation, {
      status: 'running',
      phase: startPhase,
      failedPhase: '',
      runId: makeId('paper-run'),
      inputRevision: project.revision,
      currentChapterId: startPhase === 'chapters' ? generation.currentChapterId : '',
      completedChapterIds: unique([
        ...generation.completedChapterIds,
        ...chapters.filter(chapter => chapter.status === 'locked' && chapter.inputRevision === project.revision).map(chapter => chapter.id),
      ]),
      percent: phaseOrder[startPhase] === 0 ? 2 : phaseOrder[startPhase] === 1 ? 78 : phaseOrder[startPhase] === 2 ? 86 : phaseOrder[startPhase] === 3 ? 92 : 99,
      message: startPhase === 'chapters' ? '正在准备论文正文' : `正在从“${{ semantic: '全文复核', abstract: '摘要生成', quality: '质量检查', export: '文档导出' }[startPhase]}”继续`,
      lastError: '',
      startedAt: generation.startedAt || nowIso(),
      updatedAt: nowIso(),
      completedAt: '',
      downloadReady: false,
      manualQualityRequired: false,
      manualQualityType: '',
      manualQualityMessage: '',
    });
    saveProject({ immediate: true });
    renderPaper();
    showBusy('正在生成完整论文', '会依次完成六章、摘要和质量检查；已完成内容会立即保存', { canPause: true });
    if (phaseOrder[startPhase] <= phaseOrder.chapters) {
      updateBusyProgress(2, '正在准备论文资料', '每章只使用相关资料；中断后从当前章节继续');
      const savedIndex = chapters.findIndex(chapter => chapter.id === resumeChapterId);
      const chapterStartIndex = savedIndex >= 0 ? savedIndex : 0;
      for (let index = chapterStartIndex; index < chapters.length; index += 1) {
        if (signal.aborted) throw new DOMException('已取消生成', 'AbortError');
        const chapter = chapters[index];
        generation.currentChapterId = chapter.id;
        generation.phase = 'chapters';
        generation.message = `正在生成第${chapter.id}章《${chapter.title}》`;
        generation.percent = 5 + Math.round(index / chapters.length * 72);
        generation.updatedAt = nowIso();
        saveProject({ immediate: true });
        renderPaper();
        updateBusyProgress(generation.percent, `第 ${chapter.id} / 6 章：${chapter.title}`, chapter.content && chapter.inputRevision === project.revision ? '正在核对已保存内容；符合规则时直接复用' : '系统正在写作并自动补足本章，其他章节不会被覆盖');
        await generateChapterAutomatically(chapter, signal);
        generation.completedChapterIds = unique([...generation.completedChapterIds, chapter.id]);
        generation.percent = 5 + Math.round((index + 1) / chapters.length * 72);
        generation.updatedAt = nowIso();
        saveProject({ immediate: true });
      }
      generation.phase = 'semantic';
      generation.currentChapterId = '';
      generation.message = '正文已保存，准备分批检查跨章一致性';
      generation.percent = 78;
      saveProject({ immediate: true });
    }

    if (phaseOrder[startPhase] <= phaseOrder.semantic) {
      generation.phase = 'semantic';
      generation.currentChapterId = '';
      generation.message = '正在分批检查跨章节重复与硬件一致性';
      generation.percent = 78;
      saveProject({ immediate: true });
      renderPaper();
      showBusy('正在分批复核整篇论文', '四个审查批次分别保存，失败后不会重跑已经完成的批次', { canPause: true });
      updateBusyProgress(78, '正在执行全文语义复核', '检查重复、硬件矛盾、测试数据、标题结构和总结表述');
      await auditAndRepairPaperSemantics(signal);
      generation.phase = 'abstract';
      generation.semanticBatchId = '';
      generation.message = '全文复核已保存，准备生成摘要';
      generation.percent = 86;
      saveProject({ immediate: true });
    }

    if (phaseOrder[startPhase] <= phaseOrder.abstract) {
      generation.phase = 'abstract';
      generation.currentChapterId = '';
      generation.message = '正在根据最终正文生成中英文摘要';
      generation.percent = 86;
      saveProject({ immediate: true });
      renderPaper();
      showBusy('正在生成完整论文', '正文和复核结果已经保存，正在生成摘要', { canPause: true });
      if (!paperExtrasReady()) {
        updateBusyProgress(86, '正在生成中英文摘要', '摘要只概括正文已有内容，不添加新功能或新数据');
        await generateAbstractsCore(signal);
      }
      generation.phase = 'quality';
      generation.message = '摘要已保存，准备检查全文质量';
      generation.percent = 92;
      saveProject({ immediate: true });
    }

    let quality = project.paper.quality || fallbackQuality();
    if (phaseOrder[startPhase] <= phaseOrder.quality) {
      generation.phase = 'quality';
      generation.currentChapterId = '';
      generation.message = '正在检查全文质量';
      generation.percent = 92;
      saveProject({ immediate: true });
      renderPaper();
      showBusy('正在生成完整论文', '正文和摘要已经保存，正在执行全文质量检查', { canPause: true });
      updateBusyProgress(92, '正在检查全文', '检查字数、引用顺序、章节完整性、图表占位和重复内容');
      quality = runQualityCore();
      const repairTargets = qualityChapterTargets(quality);
      let contentChanged = false;
      if (quality.blocking.length && repairTargets.length) {
        generation.message = '正在根据质量检查结果定向完善论文';
        for (let index = 0; index < repairTargets.length; index += 1) {
          if (signal.aborted) throw new DOMException('已取消生成', 'AbortError');
          const chapter = project.paper.chapters[repairTargets[index]];
          if (!chapter) continue;
          const related = quality.blocking.filter(item => {
            const message = typeof item === 'string' ? item : item.message || '';
            const belongsToChapter = message.includes(`第${chapter.id}章`) || (chapter.id === '1' && /参考文献|引用/.test(message));
            return belongsToChapter;
          });
          if (!related.length) continue;
          if (related.every(item => /出版信息|期刊名|卷号|期号|页码|学位授予单位|出版社|文献类型/.test(typeof item === 'string' ? item : item.message || ''))) continue;
          const attemptKey = generationAttemptKey('quality-repair', chapter.id, related);
          const attempt = generation.attempts[attemptKey] || { count: 0, completed: false };
          if (attempt.count >= 3) continue;
          chapter.issues = related.map(message => ({ severity: 'blocking', message: typeof message === 'string' ? message : message.message }));
          generation.currentChapterId = chapter.id;
          const replace = issuesRequireReplacement(related);
          if (replace && !beginChapterRewriteAttempt(chapter.id)) continue;
          if (!replace && !beginChapterContinuationAttempt(chapter.id)) continue;
          generation.attempts[attemptKey] = { ...attempt, completed: false, startedAt: nowIso(), updatedAt: nowIso() };
          updateBusyProgress(93 + Math.round(index / Math.max(1, repairTargets.length) * 3), `正在完善第 ${chapter.id} 章`, replace ? '替换修订当前章节，删除旧稿中的重复或错误内容' : '只补充当前章节确实缺少的内容');
          if (replace) {
            const revised = await requestChapterRevision(chapter, related, signal);
            persistGeneratedChapter(chapter, revised, { append: false });
            recordChapterOperation('full-rewrite', chapter.id);
          } else {
            const completed = await requestCompleteChapterContinuation(chapter, signal);
            persistGeneratedChapter(chapter, completed, { append: false });
            recordChapterOperation('auto-continuation', chapter.id);
          }
          generation.attempts[attemptKey] = { count: attempt.count + 1, completed: true, updatedAt: nowIso() };
          chapter.issues = auditChapterLocal(chapter);
          chapter.status = chapter.issues.some(issue => issue.severity === 'blocking') ? 'reviewing' : 'locked';
          contentChanged = true;
          saveProject({ immediate: true });
        }
        generation.currentChapterId = '';
        quality = runQualityCore();
      }
      if (totalBodyChars() < 18000) {
        const shortest = chapters
          .filter(chapter => countBodyChars(chapter.content) < Number(chapter.target || 0))
          .sort((left, right) => countBodyChars(left.content) / Math.max(1, left.target) - countBodyChars(right.content) / Math.max(1, right.target));
        for (const chapter of shortest) {
          if (totalBodyChars() >= 18000) break;
          if (signal.aborted) throw new DOMException('已取消生成', 'AbortError');
          const attemptKey = `length-fill:${chapter.id}:${project.revision}`;
          const attempt = generation.attempts[attemptKey] || { count: 0, completed: false };
          if (attempt.count >= 3) continue;
          if (!beginChapterContinuationAttempt(chapter.id)) continue;
          generation.attempts[attemptKey] = { ...attempt, completed: false, startedAt: nowIso(), updatedAt: nowIso() };
          chapter.issues = [{ severity: 'blocking', message: `全文有效正文仍不足18000字，请补充本章尚未充分展开的设计依据和分析；不要用标题、表格、图位或非正文说明凑字数` }];
          generation.currentChapterId = chapter.id;
          updateBusyProgress(97, `正在补足第 ${chapter.id} 章`, '按有效正文口径补充本章缺少的设计分析');
          const completed = await requestCompleteChapterContinuation(chapter, signal);
          persistGeneratedChapter(chapter, completed, { append: false });
          recordChapterOperation('auto-continuation', chapter.id);
          generation.attempts[attemptKey] = { count: attempt.count + 1, completed: true, updatedAt: nowIso() };
          chapter.issues = auditChapterLocal(chapter);
          chapter.status = chapter.issues.some(issue => issue.severity === 'blocking') ? 'reviewing' : 'locked';
          contentChanged = true;
          saveProject({ immediate: true });
        }
        generation.currentChapterId = '';
        quality = runQualityCore();
      }
      if (contentChanged || !project.paper.semanticCheckedAt) {
        generation.phase = 'semantic';
        generation.message = '正文已调整，正在复核受影响的审查批次';
        updateBusyProgress(98, '正在复核修订后的正文', '内容签名未变化的批次会直接复用，受影响批次重新检查');
        await auditAndRepairPaperSemantics(signal);
        generation.phase = 'quality';
        quality = runQualityCore();
      }
      if (!paperExtrasReady()) {
        generation.phase = 'abstract';
        generation.message = '正在根据修订后的正文更新摘要';
        updateBusyProgress(99, '正在更新中英文摘要', '摘要会依据最新正文重新生成');
        await generateAbstractsCore(signal);
        generation.phase = 'quality';
        quality = runQualityCore();
      }
      generation.phase = 'export';
      generation.currentChapterId = '';
      generation.message = '质量检查已完成，准备论文文档';
      generation.percent = 99;
      saveProject({ immediate: true });
    }

    const incompleteChapter = firstChapterNeedingGeneration(chapters);
    if (incompleteChapter) {
      Object.assign(generation, {
        phase: 'chapters',
        failedPhase: 'chapters',
        currentChapterId: incompleteChapter.id,
        message: `第${incompleteChapter.id}章仍不完整，可以从该章继续生成`,
        updatedAt: nowIso(),
      });
      saveProject({ immediate: true });
      throw new Error(`第${incompleteChapter.id}章内容仍不完整，请点击继续生成`);
    }
    quality = runQualityCore();

    if (quality.blocking.length) {
      const repairState = qualityRepairState(quality);
      const manualQualityRequired = repairState.automatic.length === 0 && repairState.manual.length > 0;
      const referenceOnly = manualQualityRequired && repairState.manual.every(message => /参考文献|出版信息|期刊名|卷号|期号|页码|学位授予单位|出版社/.test(message));
      generation.status = 'paused';
      generation.phase = 'quality';
      generation.failedPhase = 'quality';
      generation.percent = 99;
      generation.message = manualQualityRequired
        ? '论文草稿已保存，剩余问题需要补充真实资料后处理'
        : `论文草稿已完整保存，仍有 ${quality.blocking.length} 项质量问题，可继续自动完善`;
      generation.lastError = quality.blocking[0]?.message || quality.blocking[0] || '全文质量检查仍有必须解决的问题';
      generation.completedAt = '';
      generation.updatedAt = nowIso();
      generation.downloadReady = true;
      generation.outputVersion = 'draft';
      generation.manualQualityRequired = manualQualityRequired;
      generation.manualQualityType = referenceOnly ? 'references' : manualQualityRequired ? 'content' : '';
      generation.manualQualityMessage = referenceOnly
        ? '参考文献缺少期刊名、年份、卷期、页码或学位授予单位等真实出版信息，AI不会猜补。请返回资料页补全后重新生成。'
        : manualQualityRequired
          ? '自动修订次数已用完，剩余问题不能继续靠AI反复改写。请返回资料页补充真实连接、程序或测试信息，或下载草稿后在WPS中修改。'
          : '';
      generation.pauseRequestedAt = '';
      generation.requestAttempt = 0;
      generation.requestAttemptMax = 0;
      generation.requestStartedAt = '';
      saveProject({ immediate: true });
      updateBusyProgress(99, '草稿已保存，尚未通过最终质量门槛', manualQualityRequired ? generation.manualQualityMessage : '网站不会把有阻断问题的草稿标记为最终稿；可下载当前草稿或继续完善');
      toast(manualQualityRequired ? '草稿已保存，剩余问题需要补充真实资料' : `论文草稿已保存，仍有 ${quality.blocking.length} 项必须解决，可继续自动完善`, 'info');
      return;
    }

    generation.status = 'completed';
    generation.phase = 'export';
    generation.failedPhase = '';
    generation.percent = 100;
    generation.message = '论文已生成并通过最终质量检查';
    generation.completedAt = nowIso();
    generation.updatedAt = generation.completedAt;
    generation.downloadReady = true;
    generation.outputVersion = 'final';
    generation.manualQualityRequired = false;
    generation.manualQualityType = '';
    generation.manualQualityMessage = '';
    generation.pauseRequestedAt = '';
    generation.requestAttempt = 0;
    generation.requestAttemptMax = 0;
    generation.requestStartedAt = '';
    saveProject({ immediate: true });
    updateBusyProgress(100, '论文已通过质量检查', '正在下载可在 Word 或 WPS 打开的最终论文文档');
    hideBusy();
    if (requestController === paperController) {
      requestController = null;
      requestTask = '';
    }
    renderPaper();
    const exported = await exportPaper(true);
    if (exported) {
      generation.downloadedAt = nowIso();
      saveProject({ immediate: true });
      toast('完整论文已通过检查并下载', 'success');
    } else {
      toast('论文内容已全部保存，自动下载未完成，可点击页面上的下载按钮重试', 'info');
    }
  } catch (error) {
    generation.status = error.name === 'AbortError' ? 'paused' : 'failed';
    generation.failedPhase = generation.phase || startPhase;
    generation.compactMode = generation.compactMode || error.code === 'context_limit';
    const stageLabel = { chapters: '当前章节', semantic: '当前全文复核批次', abstract: '摘要', quality: '质量检查', export: '文档导出' }[generation.failedPhase] || '当前步骤';
    generation.message = error.name === 'AbortError' ? '生成已暂停，可以继续' : `生成遇到问题，可从${stageLabel}继续`;
    generation.lastError = error.name === 'AbortError' ? '你已暂停当前生成，已完成的章节和片段均已保存。' : (error.message || '论文生成失败');
    generation.updatedAt = nowIso();
    generation.downloadReady = Object.values(project.paper.chapters || {}).some(chapter => chapter?.content && chapter.inputRevision === project.revision);
    generation.pauseRequestedAt = '';
    generation.requestAttempt = 0;
    generation.requestAttemptMax = 0;
    generation.requestStartedAt = '';
    saveProject({ immediate: true });
    if (error.name !== 'AbortError') toast(generation.lastError, 'error');
    else toast('生成已暂停，已完成的内容不会丢失', 'info');
  } finally {
    hideBusy();
    if (requestController === paperController) {
      requestController = null;
      requestTask = '';
    }
    if (currentView === 'paper') renderPaper();
  }
}

function makeAiError(message, { code = 'fatal', status = 0, retryable = false, partialContent = '' } = {}) {
  const error = new Error(message || '生成服务请求失败');
  error.code = code;
  error.status = status;
  error.retryable = retryable;
  if (partialContent) error.partialContent = partialContent;
  return error;
}

function classifyAiFailure(message, status = 0) {
  const value = String(message || '');
  const statusCode = Number(status);
  if (statusCode === 401 || statusCode === 403) return { code: 'auth', retryable: false };
  if (statusCode === 402) return { code: 'quota', retryable: false };
  if ([408, 425, 429].includes(statusCode) || statusCode >= 500 && statusCode < 600) return { code: 'transient', retryable: true };
  if (statusCode === 413) return { code: 'context_limit', retryable: false };
  if (/unauthori[sz]ed|invalid.*(?:key|token)|令牌.*(?:失效|错误)|密钥.*(?:失效|错误)/i.test(value)) return { code: 'auth', retryable: false };
  if (/no credits|insufficient.*(?:balance|quota)|余额不足|额度不足|欠费/i.test(value)) return { code: 'quota', retryable: false };
  if ((statusCode === 0 || statusCode === 400) && /context.{0,20}(?:length|window)|maximum context|prompt.{0,20}too long|input.{0,20}(?:too long|length)|token.{0,20}(?:exceed|limit)|文本.{0,8}(?:过长|超限)|请求.{0,8}过长/i.test(value)) return { code: 'context_limit', retryable: false };
  return { code: 'fatal', retryable: false };
}

function waitForRetry(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason || new DOMException('已取消生成', 'AbortError'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason || new DOMException('已取消生成', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function callAi(messages, { temperature = 0.4, maxTokens = 8192, model = 'normal', jsonMode = false, signal } = {}) {
  if (!DEEPSEEK_API_KEY) throw makeAiError('网页版本尚未配置 DeepSeek API Key', { code: 'auth' });
  const reasoning = model === 'thinking' || model === 'deepseek-reasoner';
  const payload = {
    model: reasoning ? DEEPSEEK_REASONING_MODEL : DEEPSEEK_CHAT_MODEL,
    messages,
    stream: false,
    thinking: { type: reasoning ? 'enabled' : 'disabled' },
    max_tokens: Math.min(Math.max(1, Number(maxTokens) || 8192), 65536),
  };
  if (reasoning) payload.reasoning_effort = 'max';
  if (jsonMode) payload.response_format = { type: 'json_object' };
  if (!reasoning && Number.isFinite(temperature)) payload.temperature = Math.max(0, Math.min(2, Number(temperature)));

  const maximumAttempts = 2;
  const timeoutPlan = reasoning ? [8 * 60 * 1000, 4 * 60 * 1000] : [5 * 60 * 1000, 2 * 60 * 1000];
  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    const attemptController = new AbortController();
    const forwardAbort = () => attemptController.abort(signal?.reason || new DOMException('已取消生成', 'AbortError'));
    signal?.addEventListener('abort', forwardAbort, { once: true });
    const timeoutMs = timeoutPlan[attempt];
    setBusyRequestState(attempt + 1, maximumAttempts, timeoutMs);
    const timeout = setTimeout(() => attemptController.abort(makeAiError(`当前AI请求等待超过${Math.round(timeoutMs / 60000)}分钟，已停止本次请求并保留进度`, { code: 'timeout', retryable: attempt === 0 })), timeoutMs);
    try {
      const response = await fetch(DEEPSEEK_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify(payload),
        signal: attemptController.signal,
      });
      const rawBody = await response.text();
      let data = {};
      try { data = rawBody ? JSON.parse(rawBody) : {}; } catch (error) { data = {}; }
      if (!response.ok) {
        const message = data?.error?.message || rawBody.slice(0, 300) || `生成服务返回 ${response.status}`;
        const failure = classifyAiFailure(message, response.status);
        const apiError = makeAiError(message, { ...failure, status: response.status });
        const retryAfter = Number(response.headers.get('retry-after'));
        if (apiError.retryable && attempt < maximumAttempts - 1) {
          const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(15000, retryAfter * 1000) : 2200;
          const generation = project?.paper?.generation;
          if (generation?.status === 'running') {
            generation.message = `AI服务暂时繁忙，正在进行最后一次恢复请求（${attempt + 2}/${maximumAttempts}）`;
            generation.updatedAt = nowIso();
            saveProject({ immediate: true });
            updateBusyProgress(generation.percent, `正在重试当前步骤（${attempt + 2}/${maximumAttempts}）`, '已完成内容均已保存；只重试当前AI请求，不会重写前面章节');
          }
          await waitForRetry(waitMs, signal);
          continue;
        }
        throw apiError;
      }
      const content = data?.choices?.[0]?.message?.content;
      const finishReason = data?.choices?.[0]?.finish_reason;
      if (finishReason === 'length') {
        throw makeAiError('本次输出达到上限；已完成进度会保留，当前步骤将缩短输入后重试', { code: 'output_limit', partialContent: content || '' });
      }
      if (finishReason === 'insufficient_system_resource') {
        throw makeAiError('AI服务当前推理资源不足，正在重试本步骤', { code: 'transient', retryable: true });
      }
      if (finishReason === 'content_filter') throw makeAiError('本次生成被内容安全规则中止，请调整输入材料后重试', { code: 'content_filter' });
      if (!content) {
        const emptyError = makeAiError('生成服务没有返回正文', { code: 'transient', retryable: true });
        if (attempt < maximumAttempts - 1) {
          await waitForRetry([1800, 5000][attempt], signal);
          continue;
        }
        throw emptyError;
      }
      markServiceVerified(data.model || 'DeepSeek');
      clearBusyRequestState();
      return content;
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError' && signal?.aborted) throw signal?.reason || error;
      let requestError = error;
      if (attemptController.signal.aborted && !signal?.aborted) {
        requestError = makeAiError(`当前AI请求等待超过${Math.round(timeoutMs / 60000)}分钟，已保留进度`, { code: 'timeout', retryable: attempt === 0 });
      } else if (!error?.code && (error instanceof TypeError || /failed to fetch|network|ERR_NETWORK_CHANGED|网络/i.test(error?.message || ''))) {
        requestError = makeAiError('网络连接发生变化，当前步骤会自动重试', { code: 'network', retryable: true });
      }
      if (requestError.retryable && attempt < maximumAttempts - 1) {
        const generation = project?.paper?.generation;
        if (generation?.status === 'running') {
          generation.message = `网络或服务暂时波动，正在进行最后一次恢复请求（${attempt + 2}/${maximumAttempts}）`;
          generation.updatedAt = nowIso();
          saveProject({ immediate: true });
          updateBusyProgress(generation.percent, `正在重试当前步骤（${attempt + 2}/${maximumAttempts}）`, requestError.code === 'timeout' ? '首次深度请求等待较久，正在进行最后一次恢复尝试' : '网络或AI服务暂时波动，已经完成的内容不会重写');
        }
        await waitForRetry(2200, signal);
        continue;
      }
      clearBusyRequestState();
      throw requestError;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', forwardAbort);
    }
  }
  clearBusyRequestState();
  throw makeAiError('生成服务连续请求失败，已保留当前进度', { code: 'transient' });
}

function markServiceVerified(model) {
  const node = $('service-status');
  if (!node) return;
  node.innerHTML = `<span aria-hidden="true"></span> API 已验证 · ${escapeHtml(model)}`;
  node.classList.add('is-ready');
  node.classList.remove('is-error', 'is-checking');
}

async function testApiConnection() {
  const button = $('btn-test-api');
  if (button) {
    button.disabled = true;
    button.textContent = '测试中…';
  }
  try {
    await callAi([
      { role: 'system', content: '只按用户要求返回极短确认。' },
      { role: 'user', content: '只回复 OK' },
    ], { temperature: 0, maxTokens: 128 });
    toast('API 真实请求成功，内容生成功能已经接通', 'success');
  } catch (error) {
    const node = $('service-status');
    if (node) {
      node.innerHTML = `<span aria-hidden="true"></span> API 测试失败`;
      node.classList.add('is-error');
      node.classList.remove('is-ready');
    }
    toast(`API 测试失败：${error.message}`, 'error');
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = '测试 API';
    }
  }
}

async function readTextFile(file) {
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension === 'docx') {
    if (!globalThis.mammoth) throw new Error('DOCX 读取组件尚未加载，请先将文字复制到输入框');
    const result = await globalThis.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return result.value || '';
  }
  return file.text();
}

async function handleFileInput(input) {
  const files = [...(input.files || [])];
  if (!files.length) return;
  try {
    if (input.id === 'scheme-source-file') {
      const text = await readTextFile(files[0]);
      const nextSourceText = text.slice(0, 80000);
      if (nextSourceText !== project.sourceText) {
        project.sourceText = nextSourceText;
      }
      const textarea = $('scheme-source');
      if (textarea) textarea.value = project.sourceText;
      project.materials.filenames = unique([...project.materials.filenames, files[0].name]);
      saveProject({ immediate: true });
      toast(`已读取 ${files[0].name}，请核对文字内容`, 'success');
    }
    if (input.id === 'paper-code-files') {
      const previousFacts = factsSignature();
      const parts = [];
      for (const file of files) {
        const text = await readTextFile(file);
        parts.push(`\n/* 文件：${file.name} */\n${text}`);
      }
      const merged = [project.materials.codeText, ...parts].filter(Boolean).join('\n').slice(0, 160000);
      project.materials.codeText = merged;
      const textarea = $('paper-code');
      if (textarea) textarea.value = merged;
      project.materials.filenames = unique([...project.materials.filenames, ...files.map(file => file.name)]);
      invalidateIfFactsChanged(previousFacts);
      saveProject({ immediate: true });
      toast(`已读取 ${files.length} 个程序文件`, 'success');
    }
  } catch (error) {
    toast(error.message || '文件读取失败', 'error');
  } finally {
    input.value = '';
  }
}

function exportHtmlDocument(filename, title, body) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{font-family:'宋体',serif;line-height:1.8;margin:2.6cm;color:#111}h1{text-align:center;font-size:22pt}h2{font-size:18pt;margin-top:28px}h3{font-size:15pt;margin-top:22px}p{text-indent:2em;font-size:12pt}pre{white-space:pre-wrap;font-family:'宋体',serif}.note{color:#555;border:1px dashed #999;padding:10px}ol,ul{font-size:12pt}</style></head><body>${body}</body></html>`;
  const blob = new Blob(['\ufeff', html], { type: 'application/msword;charset=utf-8' });
  downloadBlob(blob, filename);
}

function exportCustomerHtmlDocument(filename, title, deviceText, functionTexts) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
    @page{size:A4 portrait;margin:2.54cm 3.175cm}
    body{margin:0;color:#000;background:#fff;font-family:'宋体','SimSun',serif;font-size:12pt;line-height:1.5}
    h1{margin:0 0 26pt;text-align:center;font-family:'黑体','SimHei',sans-serif;font-size:22pt;line-height:1.35;font-weight:700}
    h2{margin:0 0 8pt;text-align:left;font-family:'黑体','SimHei',sans-serif;font-size:16pt;line-height:1.35;font-weight:700}
    h2.function-heading{margin-top:8pt}
    p{orphans:2;widows:2}
    .devices{margin:0 0 10pt;text-indent:24pt;font-size:12pt;line-height:1.6}
    .check-item{margin:0 0 2pt;padding-left:24pt;text-indent:0;font-size:12pt;line-height:1.5}
  </style></head><body><h1>${escapeHtml(title)}</h1><h2>器件</h2><p class="devices">${escapeHtml(deviceText)}</p><h2 class="function-heading">功能</h2>${functionTexts.map(item => `<p class="check-item">- [ ] ${escapeHtml(item)}</p>`).join('')}</body></html>`;
  const blob = new Blob(['\ufeff', html], { type: 'application/msword;charset=utf-8' });
  downloadBlob(blob, filename);
}

function paperHeadingFromLine(line) {
  const value = String(line || '').trim();
  const hash = value.match(/^(#{1,6})\s*(\S.*)$/);
  const text = (hash ? hash[2] : value).trim();
  const semanticText = text.replace(/^\*\*(.+)\*\*$/, '$1').trim();
  if (/^第\s*[一二三四五六七八九十百\d]+\s*章/.test(semanticText)) return { level: 0, text };
  if (/^\d+[.．]\d+\s*[Vv](?=\s|[\u3400-\u9fff]|$)/.test(text)) return hash ? { level: hash[1].length >= 4 ? 3 : 2, text } : null;
  const thirdLevel = hash
    ? /^\d+[.．]\d+[.．]\d+(?=\s|[、：:）)]|[\u3400-\u9fff])/
    : /^\d+[.．]\d+[.．]\d+(?=\s|[、：:）)])/;
  const secondLevel = hash
    ? /^\d+[.．]\d+(?=\s|[、：:）)]|[\u3400-\u9fff])/
    : /^\d+[.．]\d+(?=\s|[、：:）)])/;
  if (thirdLevel.test(text)) return { level: 3, text };
  if (secondLevel.test(text)) return { level: 2, text };
  return hash ? { level: 0, text } : null;
}

function isLeadingChapterHeading(line, chapter) {
  const value = String(line || '').trim().replace(/^#{1,6}\s*/, '').replace(/^\*\*(.+)\*\*$/, '$1').trim();
  const id = String(chapter?.id || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const title = String(chapter?.title || '').trim();
  const titlePattern = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!id || !title) return false;
  return value === title || new RegExp(`^第\\s*${id}\\s*章(?:\\s+|[、：:]\\s*)?(?:${titlePattern})?\\s*$`).test(value);
}

function paperTextToHtml(text, chapter = null) {
  const blocks = [];
  let paragraphLines = [];
  let seenContent = false;
  const inlineHtml = value => escapeHtml(value).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  const flushParagraph = () => {
    if (!paragraphLines.length) return;
    blocks.push(`<p>${paragraphLines.map(line => inlineHtml(line)).join('<br>')}</p>`);
    paragraphLines = [];
  };
  String(text || '').replace(/\r\n?/g, '\n').split('\n').forEach(line => {
    const value = line.trim();
    if (!value) {
      flushParagraph();
      return;
    }
    if (!seenContent && isLeadingChapterHeading(value, chapter)) {
      seenContent = true;
      return;
    }
    seenContent = true;
    const heading = paperHeadingFromLine(value);
    if (heading) {
      flushParagraph();
      blocks.push(heading.level > 0
        ? `<h${heading.level}>${inlineHtml(heading.text)}</h${heading.level}>`
        : `<p>${inlineHtml(heading.text)}</p>`);
      return;
    }
    paragraphLines.push(value);
  });
  flushParagraph();
  return blocks.join('\n');
}

function plainTextToHtml(text) {
  return escapeHtml(text)
    .replace(/^###\s+(.+)$/gm, '<h3>$1</h3>')
    .replace(/^##\s+(.+)$/gm, '<h2>$1</h2>')
    .replace(/^#\s+(.+)$/gm, '<h1>$1</h1>')
    .split(/\n{2,}/)
    .map(block => /^(?:<h[1-3]>|【)/.test(block) ? block.replace(/\n/g, '<br>') : `<p>${block.replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

function schemeAudienceContent() {
  const content = project.scheme.markdown || buildSchemeDocumentText();
  return project.sourceMode === 'create' ? stripInternalSchemeLevelText(content) : content;
}

function exportScheme() {
  const content = schemeAudienceContent();
  if (!content.trim()) {
    toast('还没有可下载的方案', 'error');
    return;
  }
  exportHtmlDocument(`${safeFilename(project.title || '单片机方案')}-设计方案.doc`, `${project.title || '单片机项目'}设计方案`, plainTextToHtml(content));
}

function exportCustomerScheme() {
  const clean = value => {
    const text = project.sourceMode === 'create' ? stripInternalSchemeLevelText(value) : String(value || '').trim();
    return text.replace(/^[-*+\s]+/, '').replace(/[。；;，,\s]+$/, '').trim();
  };
  const concise = (value, maximum = 64) => {
    const text = clean(value).split(/(?<=[。！？!?；;])/)[0].trim();
    return text.length > maximum ? `${text.slice(0, maximum).replace(/[，,、：:\s]+$/, '')}…` : text;
  };
  const deviceEntries = project.scheme.deviceRecords.length
    ? project.scheme.deviceRecords.map(item => clean(
      item.model || item.name || parseDeviceValue(item.label || '').model,
    ))
    : project.scheme.devices.map(item => clean(parseDeviceValue(item).model));
  const functionEntries = project.scheme.functionRecords.length
    ? project.scheme.functionRecords.map(item => {
      const name = concise(item.name || item.text || '', 42);
      const description = concise(item.description || '', 72);
      if (!description || identityKey(description).includes(identityKey(name))) return name;
      return `${name}：${description}`;
    })
    : project.scheme.functions.map(item => concise(item, 72));
  const devices = unique(deviceEntries.filter(Boolean));
  const functions = unique(functionEntries.filter(Boolean));
  if (!project.title || !devices.length || !functions.length) {
    toast('客户版需要题目、器件和功能，请先生成完整方案', 'error');
    return;
  }
  exportCustomerHtmlDocument(
    `${safeFilename(project.title)}-客户版方案.doc`,
    project.title,
    devices.join('，'),
    functions,
  );
  toast('客户版方案已下载：器件仅保留型号或名称，功能按清单展示', 'success');
}

async function copyScheme() {
  const content = schemeAudienceContent();
  if (!content.trim()) {
    toast('还没有可复制的方案', 'error');
    return;
  }
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(content);
    else {
      const textarea = document.createElement('textarea');
      textarea.value = content;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.append(textarea);
      textarea.select();
      if (!document.execCommand('copy')) throw new Error('浏览器未允许复制');
      textarea.remove();
    }
    toast('完整方案已复制，可以直接粘贴到 Word 或 WPS', 'success');
  } catch (error) {
    toast('自动复制失败，请在方案正文中手动选择复制', 'error');
  }
}

function bibliographyHtml() {
  const refs = referencesForPrompt();
  if (!refs.length) return '';
  return `<h2>参考文献</h2><div>${refs.map((ref, index) => `<p>[${index + 1}] ${escapeHtml(formattedReference(ref))}</p>`).join('')}</div>`;
}

async function exportPaper(finalVersion) {
  if (!paperMaterialsReady()) {
    setView('paper', 1);
    toast('论文资料不完整，请先填写题目、器件和功能', 'error');
    return false;
  }
  if (finalVersion) runQualityCore();
  if (finalVersion && (!project.paper.quality || project.paper.quality.blocking.length)) {
    toast('还有必须解决的问题，只能导出论文草稿', 'error');
    return false;
  }
  const allChapters = Object.values(project.paper.chapters || {}).sort((a, b) => Number(a.id) - Number(b.id));
  const currentChapters = allChapters.filter(chapter => chapter.inputRevision === project.revision && String(chapter.content || '').trim());
  const chapters = finalVersion ? allChapters : currentChapters;
  const completePaper = currentChapters.length >= 6 && currentChapters.every(chapter => countBodyChars(chapter.content) >= 500);
  const hasSavedContent = chapters.some(chapter => String(chapter.content || '').trim());
  if (finalVersion && !completePaper) {
    toast('六个章节尚未全部生成，暂时不能导出论文文档', 'error');
    return false;
  }
  if (!finalVersion && !hasSavedContent) {
    toast('当前还没有已保存的论文正文', 'error');
    return false;
  }
  const references = referencesForPrompt();
  let exportReferences = references;
  if (typeof Rules.validateReferences === 'function' && completePaper) {
    const referenceAudit = Rules.validateReferences({ references, chapters: project.paper.chapters, requireAllSelected: true });
    const boundaryErrors = referenceAudit.errors.filter(item => item.code !== 'reference_publication_incomplete');
    if (boundaryErrors.length) {
      toast(`参考文献检查未通过：${boundaryErrors[0].message || '请先修正引用'}`, 'error');
      return false;
    }
    exportReferences = referenceAudit.orderedReferences;
  }
  const suffix = finalVersion ? '最终稿' : completePaper ? '草稿' : '阶段草稿';
  showBusy('正在生成标准 DOCX', '正在应用 A4 页面、宋体正文、黑体标题、1.5 倍行距、目录和页码');
  updateBusyProgress(96, '正在排版本科论文文档', '生成的是可在 Word 或 WPS 中继续编辑的真实 DOCX 文件');
  try {
    if (!globalThis.PaperDocx?.buildPaperDocx) throw new Error('DOCX 生成组件尚未加载，请刷新页面后重试');
    const blob = await globalThis.PaperDocx.buildPaperDocx({
      title: project.title,
      abstractCn: project.paper.abstractCn,
      abstractEn: project.paper.abstractEn,
      keywords: project.paper.keywords,
      acknowledgment: project.paper.acknowledgment,
      chapters: chapters.map(chapter => ({ id: chapter.id, title: chapter.title, content: normalizeRepeatedFigureIntroductions(chapter.content) })),
      references: exportReferences,
    });
    if (blob.size < 1000) throw new Error('DOCX 文件内容异常，请重新下载');
    downloadBlob(blob, `${safeFilename(project.title)}-${suffix}.docx`);
    updateBusyProgress(100, 'DOCX 文档已经生成', '已按本科论文通用版式生成，可使用 Word 或 WPS 打开');
    toast(`论文${suffix} DOCX 已生成`, 'success');
    return true;
  } catch (error) {
    toast(error.message || 'DOCX 生成失败', 'error');
    return false;
  } finally {
    hideBusy();
  }
}

function safeFilename(value) {
  return String(value || '论文').replace(/[\\/:*?"<>|]/g, '-').slice(0, 80);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportBackup() {
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json;charset=utf-8' });
  downloadBlob(blob, `${safeFilename(project.title || '单片机论文项目')}-项目备份.json`);
}

function continueProject() {
  if (Object.values(project.paper.chapters || {}).some(chapter => chapter?.content)) setView('paper', 4);
  else if (project.outline.confirmedAt) setView('paper', 4);
  else if (project.audit.status === 'confirmed') setView('paper', 3);
  else if (paperMaterialsReady() || project.materials.sourceNotes) setView('paper', 1);
  else if (project.scheme.markdown) setView('scheme', 2);
  else setView('scheme', 1);
}

function resetProject() {
  if (!confirm('确定清空当前项目并开始下一题吗？当前内容会先自动下载备份。')) return;
  exportBackup();
  project = emptyProject();
  schemeStep = 1;
  paperStep = 1;
  activeChapter = '1';
  saveProject({ immediate: true });
  setView('home');
  toast('当前内容已清空，可以开始下一题；旧项目已下载备份', 'success');
}

function wireStaticControls() {
  const actions = {
    'btn-brand-home': 'go-home',
    'btn-plan-back-home': 'go-home',
    'btn-paper-back-home': 'go-home',
    'nav-home': 'go-home',
    'nav-plan': 'start-scheme',
    'nav-paper': 'start-paper',
    'btn-start-scheme': 'start-scheme',
    'btn-start-paper': 'start-paper',
    'btn-enter-plan': 'start-scheme',
    'btn-enter-paper': 'start-paper',
    'btn-continue': 'continue-project',
    'btn-new-project': 'open-new-project',
    'btn-current-project-menu': 'export-backup',
    'btn-clear-current-project': 'reset-project',
    'btn-cancel-busy': 'cancel-generation',
    'btn-help-next-action': 'continue-project',
  };
  Object.entries(actions).forEach(([id, action]) => {
    const node = $(id);
    if (node) node.dataset.action = action;
  });
  const navViews = { 'nav-home': 'home', 'nav-plan': 'scheme', 'nav-paper': 'paper' };
  Object.entries(navViews).forEach(([id, view]) => {
    const node = $(id);
    if (node) node.dataset.navView = view;
  });
}

function openNewProjectDialog() {
  const dialog = $('dialog-new-project');
  if (dialog?.showModal) dialog.showModal();
}

function closeDialog(id) {
  const dialog = $(id);
  if (dialog?.open) dialog.close();
}

function createProjectFromDialog() {
  if (project.title && !confirm('新建项目会替换当前本地项目。是否先下载备份并继续？')) return;
  if (project.title) exportBackup();
  const title = $('new-project-name')?.value.trim() || '';
  const start = qs('input[name="new-project-start"]:checked')?.value || 'plan';
  project = emptyProject();
  project.title = title;
  project.paper.sourceMode = 'independent';
  saveProject({ immediate: true });
  closeDialog('dialog-new-project');
  setView(start === 'paper' ? 'paper' : 'scheme', 1);
}

function bindEvents() {
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-action]');
    if (!button || button.disabled) return;
    const action = button.dataset.action;
    if (action === 'go-home') setView('home');
    if (action === 'start-scheme') setView('scheme', 1);
    if (action === 'start-paper') {
      setView('paper', 1);
    }
    if (action === 'continue-project') continueProject();
    if (action === 'new-project') resetProject();
    if (action === 'reset-project') resetProject();
    if (action === 'open-new-project') openNewProjectDialog();
    if (action === 'export-backup') exportBackup();
    if (action === 'scheme-step') {
      const nextStep = Number(button.dataset.step);
      const resultCurrent = project.scheme.markdown
        && ['generated', 'confirmed'].includes(project.scheme.status)
        && project.scheme.inputSignature === currentSchemeInputSignature();
      if (nextStep === 2 && !resultCurrent) {
        schemeStep = 1;
        renderScheme();
        toast(project.scheme.markdown ? '资料已修改，请重新生成或保存方案' : '请先生成或导入方案', 'info');
      } else {
        schemeStep = nextStep;
        renderScheme();
      }
    }
    if (action === 'paper-step') {
      const nextStep = Number(button.dataset.step);
      if (nextStep === 2 && !paperSourceReady()) {
        setView('paper', 1);
        toast('请先填写论文题目；器件和功能不确定时可以留空由AI建议', 'info');
      } else if (nextStep > 2 && (!paperMaterialsReady() || project.audit.status !== 'confirmed' || project.audit.inputRevision !== project.revision)) {
        setView('paper', 2);
        toast('请先完成项目事实核对并确认AI建议', 'info');
      } else {
        captureChapterEditor();
        setView('paper', nextStep);
      }
    }
    if (action === 'submit-scheme' && captureSchemeBasics()) {
      if (['extract', 'import'].includes(project.sourceMode)) saveImportedScheme();
      else generateScheme();
    }
    if (action === 'save-scheme-basics' && captureSchemeBasics()) { schemeStep = 1; renderScheme(); }
    if (action === 'generate-scheme') generateScheme();
    if (action === 'save-scheme-review') saveSchemeReview();
    if (action === 'confirm-scheme') confirmScheme();
    if (action === 'accept-scheme') confirmScheme();
    if (action === 'export-scheme') exportScheme();
    if (action === 'export-customer-scheme') exportCustomerScheme();
    if (action === 'copy-scheme') copyScheme();
    if (action === 'edit-scheme-relations') setView('scheme', 2);
    if (action === 'use-scheme-for-paper') useSchemeForPaper();
    if (action === 'save-paper-materials' && capturePaperMaterials()) setView('paper', 2);
    if (action === 'run-fact-audit') runFactAudit();
    if (action === 'accept-issue-suggestion') {
      captureIssueEdits();
      const issue = (project.audit.issues || []).find(item => item.id === button.dataset.issueId);
      if (issue?.autoApplicable && issue.suggestion && issue.field && issue.suggestedValues?.length) {
        issue.resolution = '确认建议';
        issue.finalResolution = String(issue.suggestion).trim();
        issue.resolved = true;
        saveProject({ immediate: true });
        renderPaper();
        toast('已采用这条建议，请继续核对其他必须确认项', 'success');
      }
    }
    if (action === 'confirm-facts') confirmFacts();
    if (action === 'reset-outline') { project.outline.text = buildDefaultOutline(); renderPaper(); }
    if (action === 'confirm-outline') confirmOutline();
    if (action === 'generate-full-paper') generateFullPaper().catch(error => {
      console.error(error);
      const generation = paperGenerationState();
      generation.status = 'failed';
      generation.message = '生成遇到问题，可以继续';
      generation.lastError = error?.message || '论文生成异常';
      generation.updatedAt = nowIso();
      saveProject({ immediate: true });
      hideBusy();
      requestController = null;
      requestTask = '';
      renderPaper();
      toast(generation.lastError, 'error');
    });
    if (action === 'select-chapter') { captureChapterEditor(); activeChapter = button.dataset.chapter; renderPaper(); }
    if (action === 'generate-chapter') generateChapter('generate');
    if (action === 'expand-chapter') generateChapter('expand');
    if (action === 'audit-chapter') auditActiveChapter();
    if (action === 'lock-chapter') lockActiveChapter();
    if (action === 'run-quality') runQuality();
    if (action === 'generate-abstracts') generateAbstracts();
    if (action === 'export-paper') exportPaper(button.dataset.final === 'true');
    if (action === 'cancel-generation') requestGenerationPause(button);
  });

  document.addEventListener('change', event => {
    const input = event.target;
    if (input.matches('input[name="source-mode"]')) {
      if (project.sourceMode !== input.value) {
        project.sourceMode = input.value;
      }
      saveProject();
      renderScheme();
    }
    if (input.type === 'file') handleFileInput(input);
    if (input.matches('[data-issue-resolved]')) captureIssueEdits();
  });

  document.addEventListener('input', event => {
    if (event.target.id === 'chapter-editor') captureChapterEditor();
    if (event.target.matches('[data-issue-resolution]')) captureIssueEdits();
  });

  window.addEventListener('beforeunload', () => {
    saveProject({ immediate: true });
  });
  window.addEventListener('pageshow', () => {
    if (healOrphanedGeneration() && currentView === 'paper') renderPaper();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && healOrphanedGeneration() && currentView === 'paper') renderPaper();
  });

  $('btn-close-new-project-dialog')?.addEventListener('click', () => closeDialog('dialog-new-project'));
  $('btn-cancel-new-project')?.addEventListener('click', () => closeDialog('dialog-new-project'));
  $('form-new-project')?.addEventListener('submit', event => {
    event.preventDefault();
    createProjectFromDialog();
  });
  $('btn-open-help')?.addEventListener('click', () => { const drawer = $('help-drawer'); if (drawer) drawer.hidden = false; });
  $('btn-close-help')?.addEventListener('click', () => { const drawer = $('help-drawer'); if (drawer) drawer.hidden = true; });
  $('btn-test-api')?.addEventListener('click', testApiConnection);
  $('busy-dialog')?.addEventListener('cancel', event => {
    if (!requestController) return;
    event.preventDefault();
    toast(requestTask === 'paper' ? '论文仍在生成；如需暂停，请点击“暂停生成（已完成内容会保留）”' : '当前AI操作仍在进行，请等待处理完成', 'info');
  });
}

async function checkService() {
  const node = $('service-status');
  if (node) {
    const configured = Boolean(DEEPSEEK_API_KEY);
    node.innerHTML = `<span aria-hidden="true"></span> ${configured ? `API 已配置 · ${escapeHtml(DEEPSEEK_CHAT_MODEL)}` : 'API 未配置'}`;
    node.classList.toggle('is-ready', configured);
    node.classList.toggle('is-error', !configured);
    node.classList.remove('is-checking');
  }
}

function init() {
  wireStaticControls();
  bindEvents();
  healOrphanedGeneration();
  renderHome();
  setView('home');
  checkService();
  setSaveStatus('已自动保存');
}

init();
