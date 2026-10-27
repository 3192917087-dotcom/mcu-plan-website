import { devicePlanGroups, matchesDevice, functionPlanRecords } from './paper-preflight.js?v=20261017-2';
import { parseReferenceOutline, findOutlineSection, chapterRoles, hasChapterRole, findRoleChapter, selectionChapter, scopeRoleChapter, SELECTION_HEADING, activeChapterRecords, effectiveReferenceText, pcbDesignPolicy, ensurePcbOutline, PCB_HEADING, chapterReferenceContract } from './outline-policy.js?v=20261018-3';
import { planDeviceSelection } from './selection-policy.js?v=20261018-3';
export { planDeviceSelection };

export const CHAPTER_TARGETS = Object.freeze({
  introduction: 2800,
  overall: 3200,
  hardware: 4400,
  software: 5000,
  implementation: 7200,
  test: 3300,
  conclusion: 1200,
  requirement: 2600,
});

export const MIN_BODY_CHARS = 15000;

export const DEFAULT_OUTLINE_ID = 'adaptive6';

export function buildSourceCodeExcerpt(codeFiles = [], fallbackText = '', maxChars = 26000) {
  const limit = Math.max(2000, Number(maxChars) || 26000);
  const records = Array.isArray(codeFiles) ? codeFiles.filter(item => item?.content) : [];
  if (!records.length) return String(fallbackText || '未提供').slice(0, limit);
  const perFileBudget = Math.max(500, Math.floor(limit / records.length) - 80);
  return records.map(record => {
    const path = String(record.path || record.name || '未命名程序文件');
    return `/* 文件：${path} */\n${String(record.content || '').slice(0, perFileBudget)}`;
  }).join('\n\n').slice(0, limit);
}

const DEFAULT_CHAPTERS = Object.freeze([
  { id: '1', kind: 'introduction', title: '绪论', sections: ['1.1 课题研究背景及意义', '1.2 国内外研究现状', '1.2.1 国内研究现状', '1.2.2 国外研究现状', '1.2.3 国内外研究现状评述', '1.3 主要研究内容', '1.4 论文结构安排'] },
  { id: '2', kind: 'overall', title: '系统总体方案设计', sections: ['2.1 系统需求分析', '2.2 系统总体结构', '2.3 系统工作原理', '2.4 系统器件选型'] },
  { id: '3', kind: 'hardware', title: '系统硬件设计', sections: ['3.1 主控最小系统设计', '3.2 电源及基础电路设计', '3.3 信息采集电路设计', '3.4 输出与执行电路设计', '3.5 显示及通信电路设计'] },
  { id: '4', kind: 'software', title: '系统软件设计', sections: ['4.1 软件总体结构', '4.2 主程序设计', '4.3 信息采集程序设计', '4.4 输出控制程序设计', '4.5 显示及通信程序设计'] },
  { id: '5', kind: 'test', title: '系统调试与功能测试', sections: ['5.1 调试环境与工具', '5.2 硬件调试', '5.3 软件调试', '5.4 系统功能测试', '5.5 系统性能与稳定性测试'] },
  { id: '6', kind: 'conclusion', title: '总结与展望', sections: ['6.1 研究总结', '6.2 后续展望'] },
]);


function insertAfterSectionNumber(chapter, sectionNumber, additions = []) {
  const index = chapter.sections.findIndex(section => section.startsWith(`${sectionNumber} `));
  if (index >= 0 && additions.length) chapter.sections.splice(index + 1, 0, ...additions);
}

export const OUTLINE_TEMPLATES = Object.freeze({
  [DEFAULT_OUTLINE_ID]: {
    name: '项目自适应六章目录',
    description: '保持本科论文常用六章结构，并依据当前器件与功能更新三级标题。',
    chapters: DEFAULT_CHAPTERS,
  },
});

function uniqueNames(items = []) {
  const seen = new Set();
  return items.map(item => String(item || '').trim()).filter(Boolean).filter(item => {
    const key = item.replace(/[\s，,。；;、：:（）()“”'"·.]/g, '').toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function functionSource(item) {
  return String(typeof item === 'string' ? item : item?.source || item?.name || item?.description || '')
    .replace(/^\s*(?:\d+[.、]|[-•])\s*/, '')
    .replace(/[。；;，,\s]+$/g, '')
    .trim();
}

function uniqueFunctions(items = []) {
  return functionPlanRecords(items);
}

function modelName(device) {
  return String(typeof device === 'string' ? device : device?.model || device?.name || '').replace(/[（(].*$/, '').trim();
}

function deviceDescription(device) {
  return `${modelName(device)} ${typeof device === 'object' ? device?.role || device?.interfaceType || '' : device}`.trim();
}

function functionName(item) {
  const source = functionSource(item);
  // 先识别功能的主行为，再识别其中提到的被监测数据，避免“手机查看温湿度”
  // 被误写成“温湿度采集”这类目录标题。
  if (/APP|小程序|手机/.test(source) && /控制|开关/.test(source)) return '移动端远程控制';
  if (/APP|小程序|手机|远程查看/.test(source) && /查看|监测|状态|显示/.test(source)) return '移动端状态监测';
  if (/WiFi|ESP-01S|联网|上传/.test(source)) return '无线联网与数据上传';
  if (/舵机|SG90|窗户/.test(source)) return '窗户开合控制';
  if (/DHT|温湿度/i.test(source)) return /显示|OLED|LCD/.test(source) ? '温湿度采集与显示' : '温湿度采集';
  if (/MQ[-－]?\d*|烟雾|气体/.test(source)) return /报警|蜂鸣/.test(source) ? '烟雾检测与超限报警' : '烟雾浓度检测';
  if (/HC[-－]?SR|人体|红外/.test(source)) return /灯|照明|继电器/.test(source) ? '人体感应照明控制' : '人体活动检测';
  if (/光敏|光照/.test(source)) return /灯|照明|控制/.test(source) ? '光照检测与联动照明' : '环境光照检测';
  if (/各传感器|逻辑控制|综合/.test(source)) return '系统综合控制逻辑';
  const implemented = source.match(/实现([^，,。；;]{2,24})/)?.[1];
  return String(implemented || source.split(/[，,。；;]/)[0] || '功能逻辑').replace(/^使用/, '').slice(0, 28).trim();
}

function classifyDevices(devices = []) {
  const result = { sensors: [], actuators: [], displays: [] };
  devices.forEach(device => {
    const name = modelName(device);
    const description = deviceDescription(device);
    if (!name || /主控|单片机|电源|稳压|晶振|复位|下载|调试/.test(description)) return;
    if (/屏|显示|OLED|LCD|数码管|WiFi|ESP-01S|蓝牙|通信|LoRa|GSM|NB|RFID|云/.test(description)) result.displays.push(name);
    else if (/电机|舵机|继电器|蜂鸣|报警|风扇|加热|制冷|灯|LED|执行|驱动|水泵|阀|道闸/.test(description)) result.actuators.push(name);
    else result.sensors.push(name);
  });
  Object.keys(result).forEach(key => { result[key] = uniqueNames(result[key]); });
  return result;
}

function classifyFunctions(functions = []) {
  const result = { acquisition: [], control: [], communication: [] };
  uniqueFunctions(functions).forEach(item => {
    const source = functionSource(item);
    const name = functionName(item);
    if (/通信|上传|远程|WiFi|蓝牙|云|联网|APP|小程序|数据发送|查询/.test(source)) result.communication.push(name);
    else if (/控制|报警|调节|驱动|执行|道闸|舵机|继电器|风扇|水泵|加热|制冷|照明/.test(source)) result.control.push(name);
    else result.acquisition.push(name);
  });
  Object.keys(result).forEach(key => { result[key] = uniqueNames(result[key]); });
  return result;
}

function tertiary(sectionNumber, titles, suffix) {
  return uniqueNames(titles).map((title, index) => `${sectionNumber}.${index + 1} ${title}${suffix}`);
}

export function assignChapterTargets(chapters = [], targetBodyChars = MIN_BODY_CHARS, context = {}) {
  const target = Math.max(MIN_BODY_CHARS, Math.min(40000, Number(targetBodyChars) || MIN_BODY_CHARS));
  const deviceCount = Math.min(12, (context.devices || []).length);
  const functionCount = Math.min(16, (context.functions || []).length);
  const baseWeights = { introduction: 14, overall: 16 + deviceCount * 0.45, hardware: 21 + deviceCount * 0.8, software: 24 + functionCount * 0.85, test: 18 + functionCount * 0.45, conclusion: 7 };
  const minimums = { introduction: 2200, overall: 2400, hardware: 3200, software: 3600, test: 2600, conclusion: 900 };
  const roleCount = role => Math.max(1, chapters.filter(chapter => hasChapterRole(chapter, role)).length);
  const chapterMinimum = chapter => chapterRoles(chapter).reduce((sum,role) => sum + minimums[role] / roleCount(role), 0) || 1400;
  const chapterWeight = chapter => chapterRoles(chapter).reduce((sum,role) => sum + baseWeights[role] / roleCount(role), 0) || 10;
  const minimumTotal = chapters.reduce((sum, chapter) => sum + chapterMinimum(chapter), 0);
  const scale = minimumTotal > target ? target * 0.85 / minimumTotal : 1;
  const distributable = Math.max(0, target - minimumTotal * scale);
  const weightTotal = chapters.reduce((sum, chapter) => sum + chapterWeight(chapter), 0) || 1;
  const planned = chapters.map(chapter => {
    const raw = chapterMinimum(chapter) * scale + distributable * chapterWeight(chapter) / weightTotal;
    return { ...chapter, targetCharacters: Math.max(300, Math.floor(raw / 100) * 100) };
  });
  const total = planned.reduce((sum, chapter) => sum + chapter.targetCharacters, 0);
  if (planned.length && total !== target) {
    const preferred = findRoleChapter(planned, 'software') || planned[planned.length - 1];
    preferred.targetCharacters += target - total;
  }
  return planned;
}

export function buildProjectOutline({ title = '', devices = [], functions = [], fixedFacts = [], materials = {}, targetBodyChars = MIN_BODY_CHARS } = {}) {
  const outline = structuredClone(DEFAULT_CHAPTERS);
  const deviceGroups = classifyDevices(devices);
  const functionGroups = groupWorkflowFunctions(functions);
  const overall = outline.find(chapter => chapter.id === '2');
  const selectedGroups = classifyDevices(planDeviceSelection({devices,functions,targetBodyChars}).devices);
  const selectionTitles = ['主控器件选型'];
  if (selectedGroups.sensors.length) selectionTitles.push('关键传感器选型');
  if (selectedGroups.actuators.length || selectedGroups.displays.length) selectionTitles.push('关键执行与交互器件选型');
  overall.sections.push(...tertiary('2.4', selectionTitles, ''));

  const hardware = outline.find(chapter => chapter.id === '3');
  insertAfterSectionNumber(hardware, '3.3', tertiary('3.3', deviceGroups.sensors, '接口电路设计'));
  insertAfterSectionNumber(hardware, '3.4', tertiary('3.4', deviceGroups.actuators, '驱动电路设计'));
  insertAfterSectionNumber(hardware, '3.5', tertiary('3.5', deviceGroups.displays, '接口电路设计'));

  const software = outline.find(chapter => chapter.id === '4');
  const groupedBySection = new Map();
  functionGroups.forEach(group => {
    if (!group.sectionNumber) return;
    if (!groupedBySection.has(group.sectionNumber)) groupedBySection.set(group.sectionNumber, []);
    groupedBySection.get(group.sectionNumber).push(group);
  });
  groupedBySection.forEach((groups, sectionNumber) => {
    insertAfterSectionNumber(software, sectionNumber, groups.map((group, index) => `${sectionNumber}.${index + 1} ${group.title}程序设计`));
  });

  const test = outline.find(chapter => chapter.id === '5');
  const testScenes = groupResultScenes(functions).map(scene => scene.title);
  insertAfterSectionNumber(test, '5.4', tertiary('5.4', testScenes, '功能测试'));
  outline.forEach(chapter => {
    const last = Math.max(...chapter.sections.map(section => Number(section.match(/^\d+\.(\d+)/)?.[1] || 0)));
    chapter.sections.push(`${chapter.id}.${last + 1} 本章小结`);
  });
  return assignChapterTargets(ensurePcbOutline(outline,{fixedFacts},materials), targetBodyChars, { devices, functions });
}

export function outlineFor(templateId = DEFAULT_OUTLINE_ID, context = {}) {
  return buildProjectOutline(context);
}

function findChapter(outline, kind) {
  return scopeRoleChapter(findRoleChapter(outline, kind), kind);
}

function makeArtifact(type, chapter, title, instruction, relatedFunction = '', options = {}) {
  return {
    id: `artifact-${chapter?.id || 'x'}-${type}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    chapterId: chapter?.id || '',
    sectionId: options.sectionId || '',
    title,
    instruction,
    relatedFunction,
    sourceFactIds: uniqueNames(options.sourceFactIds || []),
    reason: options.reason || '',
    required: options.required !== false,
  };
}

function functionRecord(item, index) {
  const record = typeof item === 'object' && item ? item : {};
  return { ...record, id: record.id || `function-${index + 1}`, source: functionSource(item) };
}

function workflowFunctionGroup(record) {
  const source = record.source;
  if (/APP|小程序|手机|远程|WiFi|蓝牙|云|联网|上传|下发|网络通信/.test(source)) return { key: 'remote', title: '远程监测与交互控制', sectionNumber: '4.5' };
  if (/RFID|刷卡|门禁|指纹|密码|人脸|身份识别/.test(source)) return { key: 'access', title: '身份识别与通行控制', sectionNumber: '4.4' };
  if (/GPS|北斗|定位|轨迹|经纬度/.test(source)) return { key: 'positioning', title: '定位信息获取与处理', sectionNumber: '4.3' };
  if (/语音|声音识别|语音指令/.test(source)) return { key: 'voice', title: '语音识别与指令控制', sectionNumber: '4.5' };
  if (/按键|键盘|触摸|旋钮|本地设置/.test(source)) return { key: 'local-interaction', title: '本地输入与参数设置', sectionNumber: '4.5' };
  if (/RTC|时钟|定时|预约|日程/.test(source)) return { key: 'schedule', title: '时间管理与定时控制', sectionNumber: '4.4' };
  if (/SD卡|存储|记录|日志|历史数据/.test(source)) return { key: 'logging', title: '数据存储与历史记录', sectionNumber: '4.5' };
  if (/报警|蜂鸣|烟雾|气体|火焰|入侵|超限|异常/.test(source)) return { key: 'safety', title: '异常检测与安全报警', sectionNumber: '4.4' };
  if (/水泵|灌溉|补水|排水|液位|阀/.test(source) && /控制|联动|调节|驱动|启停/.test(source)) return { key: 'fluid', title: '液位判断与水路控制', sectionNumber: '4.4' };
  if (/风扇|通风|加热|制冷|降温|恒温|温控/.test(source)) return { key: 'environment', title: '环境参数联动调节', sectionNumber: '4.4' };
  if (/灯|照明|(?:^|[^O])LED/i.test(source) && /控制|联动|调节|驱动|开关/.test(source)) return { key: 'lighting', title: '照明状态判断与控制', sectionNumber: '4.4' };
  if (/舵机|窗户|窗帘|门锁|道闸|电机|步进/.test(source)) return { key: 'motion', title: '执行机构动作控制', sectionNumber: '4.4' };
  if (/显示|OLED|LCD|屏|数码管/.test(source)) return { key: 'monitoring', title: '数据采集、处理与显示', sectionNumber: '4.3' };
  if (/控制|调节|驱动|执行|继电器/.test(source)) return { key: 'control', title: '通用输出与联动控制', sectionNumber: '4.4' };
  return { key: 'monitoring', title: '数据采集、处理与显示', sectionNumber: '4.3' };
}

function groupWorkflowFunctions(functions = []) {
  const groups = new Map();
  uniqueFunctions(functions).map(functionRecord).forEach(record => {
    const category = workflowFunctionGroup(record);
    if (!groups.has(category.key)) groups.set(category.key, { ...category, records: [] });
    groups.get(category.key).records.push(record);
  });
  return [...groups.values()];
}

function resultScene(record) {
  const source = record.source;
  const objectRules = [
    [/RFID|刷卡|门禁|指纹|密码|人脸|身份识别/, '身份识别与通行'], [/GPS|北斗|定位|轨迹|经纬度/, '定位与轨迹显示'],
    [/语音|声音识别|语音指令/, '语音交互'], [/按键|键盘|触摸|旋钮|本地设置/, '本地参数设置'],
    [/RTC|时钟|定时|预约|日程/, '定时运行'], [/SD卡|存储|记录|日志|历史数据/, '数据记录与查询'],
    [/水泵|灌溉|补水|排水/, '水泵与液位联动'], [/风扇|通风|降温/, '通风与温度联动'], [/加热|制热/, '加热控制'],
    [/灯|照明|(?:^|[^O])LED/i, '照明控制'], [/舵机|窗户|窗帘|门锁|道闸/, '机构动作控制'], [/蜂鸣|报警|烟雾|气体/, '异常报警'],
  ];
  const matched = objectRules.find(([pattern]) => pattern.test(source));
  if (matched) return { key: matched[1], title: matched[1] };
  if (/通信|上传|远程|WiFi|蓝牙|云|APP|小程序|手机|联网/.test(source)) return { key: '远程交互', title: '远程监测与交互' };
  if (/采集|检测|监测|显示|OLED|LCD|屏|温度|湿度|光照|压力|液位|距离/.test(source)) return { key: '状态监测', title: '数据采集与状态显示' };
  return { key: '综合运行', title: '系统综合运行' };
}

function groupResultScenes(functions = []) {
  const groups = new Map();
  uniqueFunctions(functions).map(functionRecord).forEach(record => {
    const scene = resultScene(record);
    if (!groups.has(scene.key)) groups.set(scene.key, { ...scene, records: [] });
    groups.get(scene.key).records.push(record);
  });
  return [...groups.values()];
}

function testFunctionGroup(record) {
  const source = record.source;
  if (/APP|小程序|手机|远程|WiFi|蓝牙|云|联网|上传|下发|网络通信/.test(source)) return { key: 'remote', title: '远程通信与交互' };
  if (/报警|蜂鸣|烟雾|气体|火焰|入侵|超限|异常|RFID|刷卡|门禁|指纹|密码|人脸/.test(source)) return { key: 'safety', title: '异常报警与安全' };
  if (/继电器|水泵|灌溉|补水|排水|阀|风扇|通风|加热|制冷|降温|灯|照明|舵机|窗户|窗帘|门锁|道闸|电机|步进/.test(source)) return { key: 'actuation', title: '执行机构与联动控制' };
  if (/按键|键盘|触摸|旋钮|本地设置|手动|自动模式|RTC|时钟|定时|预约/.test(source)) return { key: 'local', title: '本地交互与模式控制' };
  return { key: 'monitoring', title: '数据采集与状态显示' };
}

function groupTestFunctions(functions = []) {
  const groups = new Map();
  uniqueFunctions(functions).map(functionRecord).forEach(record => {
    const group = testFunctionGroup(record);
    if (!groups.has(group.key)) groups.set(group.key, { ...group, records: [] });
    groups.get(group.key).records.push(record);
  });
  return [...groups.values()];
}

function deviceOutlineSection(chapter, device, selection = false) {
  if (!chapter) return '';
  const sections = chapter.sections || [];
  const selectionNumbers = sections.filter(section => SELECTION_HEADING.test(section)).map(section => section.match(/^\d+(?:\.\d+){1,2}/)?.[0]);
  const candidates = selection ? sections.filter(section => selectionNumbers.some(number => section.startsWith(`${number} `) || section.startsWith(`${number}.`))) : sections;
  const scoped = { ...chapter, sections: candidates.length ? candidates : sections };
  const name = modelName(device);
  const description = deviceDescription(device);
  const exact = new RegExp(`(?:^|[^A-Za-z0-9])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9])`, 'i');
  const categories = /主控|单片机/.test(description) ? [/主控|微控制器|最小系统/]
    : /OLED|LCD|屏|显示/i.test(description) ? [/显示|人机|交互/]
      : /通信|WiFi|蓝牙|ESP-01S|HC-05|LoRa|GSM/i.test(description) ? [/通信|蓝牙|无线|联网|远程|交互/]
        : /继电器|蜂鸣|LED|电机|舵机|执行|风扇|水泵|阀|灯/i.test(description) ? [/执行|输出|驱动|报警|声光|控制/]
          : [/传感|检测|采集|感知/];
  for (const pattern of [exact, ...categories]) {
    if (scoped.sections.some(section => pattern.test(section))) return findOutlineSection(scoped, [pattern], { preferTertiary: true });
  }
  return findOutlineSection(scoped, [/选型|选用|选取|选择|比较|论证|电路|接口/]);
}

export function deviceSelectionPlacementIssues({outline = [], facts = {}, targetBodyChars, referenceText = ''} = {}) {
  const chapter=selectionChapter(outline);
  if (!chapter) return [];
  const selection=planDeviceSelection({...facts,targetBodyChars,referenceText});
  return selection.devices.flatMap(device=>{
    const sectionId=deviceOutlineSection(chapter,device,true);
    const heading=chapter.sections.find(section=>section.startsWith(`${sectionId} `)) || '';
    const isController=/主控|单片机|微控制器/.test(device.role || '') || device.model===facts.controller;
    return !isController && /主控|微控制器|MCU/i.test(heading) && !/外设|其他器件|关键器件|核心器件/.test(heading)
      ? [`${device.model}的选型图表不能放入仅介绍主控的小节${sectionId}，应在现有位置补充关键器件分组或将该节扩展为主控与关键外设选型`] : [];
  });
}

function functionOutlineSection(chapter, source = '') {
  const patterns = [
    [/远程|通信|蓝牙|WiFi|联网|上传|APP|交互/i, /远程|通信|蓝牙|无线|联网|APP|交互/i],
    [/报警|异常|安全|预警/, /报警|异常|安全|预警/],
    [/水泵|水路|液位|灌溉/, /水路|液位|灌溉|补水/],
    [/温|湿|环境|风扇|加热/, /温|湿|环境|调节/],
    [/显示|数据采集|监测|检测/, /采集|监测|检测|感知|显示/],
    [/照明|灯光/, /照明|灯光/],
    [/识别|门禁|身份/, /识别|门禁|身份/],
    [/手动|按键|参数设置/, /手动|按键|模式|参数|人机/],
  ];
  for (const [from, to] of patterns) {
    if (from.test(source) && (chapter?.sections || []).some(section => to.test(section))) return findOutlineSection(chapter, [to], { preferTertiary: true });
  }
  return findOutlineSection(chapter, [/功能|逻辑|控制|验证|测试|驱动|采集/], { preferTertiary: true });
}

// A reference may split one responsibility over multiple chapters. Route to the
// chapter that actually discusses this topic, rather than always the first one.
function routeArtifact(outline, artifact, devices) {
  if (['comparison-table','device-image'].includes(artifact.type) || PCB_HEADING.test(artifact.title)) return artifact;
  const role = artifact.type === 'system-framework' ? 'overall'
    : ['circuit','pin-table'].includes(artifact.type) ? 'hardware'
      : ['test-table','result-image'].includes(artifact.type) ? 'test' : 'software';
  const candidates = outline.filter(chapter => hasChapterRole(chapter,role)).map(chapter=>scopeRoleChapter(chapter,role));
  if (candidates.length < 2) return artifact;
  const source = `${artifact.title} ${artifact.relatedFunction}`;
  const device = devices.find(item => (artifact.sourceFactIds || []).includes(item.id));
  const topics = [/通信|远程|联网|上传|无线|APP|蓝牙|WiFi/i,/采集|传感|检测|感知/,/报警|预警|安全|异常/,/显示|交互|人机/,/水泵|灌溉|液位|水路/,/温|湿|环境|调节/,/照明|灯光/,/主控|最小系统/,/供电|电源|稳压/,/主程序|主循环|初始化|调度/,/软件.*结构|架构|任务.*划分/];
  const ranked = candidates.map((chapter,index) => {
    const sectionId = device && role === 'hardware' ? deviceOutlineSection(chapter,device)
      : artifact.type === 'software-architecture' ? findOutlineSection(chapter,[/架构|软件.*结构|任务.*划分/])
        : artifact.title === '主程序流程图' ? findOutlineSection(chapter,[/主程序|主循环|初始化|调度/])
          : functionOutlineSection(chapter,source);
    const heading = chapter.sections.find(section=>section.startsWith(`${sectionId} `)) || '';
    const text = `${chapter.title} ${heading}`;
    const score = topics.filter(pattern=>pattern.test(source) && pattern.test(text)).length * 10
      + (device && text.toLowerCase().includes(modelName(device).toLowerCase()) ? 100 : 0);
    return {chapter,sectionId,score,index};
  }).sort((a,b)=>b.score-a.score || a.index-b.index);
  return {...artifact,chapterId:ranked[0].chapter.id,sectionId:ranked[0].sectionId};
}

export function buildArtifactPlan({ outline = [], devices = [], functions = [], mappings = [], fixedFacts = [], materials = {}, targetBodyChars, referenceText = '', selection = null } = {}) {
  const overall = findChapter(outline, 'overall');
  const hardware = findChapter(outline, 'hardware');
  const software = findChapter(outline, 'software');
  const test = findChapter(outline, 'test');
  const distinctFunctions = uniqueFunctions(functions).map(functionRecord);
  const artifacts = [];
  const controllerDevice = devices.find(device => /主控|单片机/.test(`${device.role || ''} ${device.model || ''}`));
  const controllerName = modelName(controllerDevice) || modelName(devices.find(device => /STM32|STC|AT89|ESP32|Arduino/i.test(modelName(device))));
  const is51Project = /(?:STC|AT89|AT90|89C5|51单片机|8051)/i.test(controllerName);
  const uniqueDevices = devicePlanGroups(devices, controllerName);
  const selectionPlan = selection || planDeviceSelection({devices,controller:controllerName,functions,targetBodyChars:targetBodyChars || outline.reduce((sum,c) => sum + Number(c.targetCharacters || 0),0),referenceText});
  const selectedChapter = selectionChapter(outline);
  const contentDevices = uniqueDevices.filter(device => !/主控|单片机|电源|晶振|复位|下载|调试/.test(`${device.role || ''} ${device.model || ''}`));
  if (overall) {
    artifacts.push(makeArtifact('system-framework', overall, '系统总体功能框架图', '直接生成简洁Mermaid代码，使用flowchart LR，按环境或用户输入、检测器件、主控制器、显示/执行/通信对象和供电支撑组织5至9个短句节点；允许使用实际器件类别或型号，突出硬件组成、数据方向和控制方向，不写程序任务、函数、具体引脚或软件调用层级。主干清晰、连线不交叉，全文不再生成第二张硬件组成图。', '', { sectionId: findOutlineSection(overall, [/总体|框架|架构|系统.*结构|系统.*设计/]), reason: '说明系统硬件组成以及数据和控制信息的总体流向' }));
  }
  if (selectedChapter) {
    selectionPlan.devices.forEach(device => {
      const name = device.model || device.name;
      const selectionSection = deviceOutlineSection(selectedChapter, device, true);
      artifacts.push(makeArtifact('comparison-table', selectedChapter, name + '选型对比表', '紧跟' + name + '选型分析之后，只比较' + name + '与至少2个常见候选型号。表格不超过5列、' + (selectionPlan.mode === 'brief' ? '5' : '10') + '行，' + selectionPlan.description + '；指标服务于本项目需求，候选型号不能写入实际器件清单或后续电路。', '', { sectionId: selectionSection, sourceFactIds: device.sourceFactIds, reason: '用独立对比表支撑' + name + '的选型结论' }));
      artifacts.push(makeArtifact('device-image', selectedChapter, `${name}器件图`, `只保留“此处插入${name}器件图”的简短独立提示，不写拍摄、构图、绘制或标注方法。`, '', { sectionId: selectionSection, sourceFactIds: device.sourceFactIds, reason: '帮助读者识别实际选用的重要器件' }));
    });
  }
  if (hardware) {
    const pcbChapter=outline.find(chapter=>(chapter.sections || []).some(section=>PCB_HEADING.test(section)));
    const pcbPolicy=pcbDesignPolicy({fixedFacts},materials);
    if(pcbChapter && pcbPolicy.enabled) artifacts.push(makeArtifact('circuit',pcbChapter,'PCB布局与布线图',`只保留“此处插入PCB布局与布线图”的独立提示；使用${pcbPolicy.tool}，按实际器件、供电和接口说明布局、走线及电气检查。默认主控开发板安装于承载或接口板，不能编造裸芯片自制主控、PCB层数、板材、板尺寸、生产订单或已经测量的阻抗。`,'',{sectionId:findOutlineSection(pcbChapter,[PCB_HEADING]),reason:'落实PCB电路板设计要求，区别于系统框架图和各模块原理图'}));
    uniqueDevices.forEach(device => {
      const name = device.model || device.name;
      const sectionId = deviceOutlineSection(hardware, device);
      const title = /主控|单片机/.test(`${device.role || ''} ${name}`) ? `${name}最小系统电路图` : `${name}接口电路图`;
      artifacts.push(makeArtifact('circuit', hardware, title, `只保留“此处插入${title}”的简短独立提示，不写绘制步骤；正文负责说明已确认引脚、供电、共地和必要的10 kΩ上拉关系。`, '', { sectionId, sourceFactIds: device.sourceFactIds, reason: '对应说明该器件与主控的实际电气连接' }));
      const deviceMappings = mappings.filter(mapping => matchesDevice(mapping.device, device));
      if (deviceMappings.length && contentDevices.some(item => item.id === device.id)) {
        const confirmedPins = deviceMappings.map(mapping => `${mapping.signal || '信号'}=${mapping.pin || '待确认'}`).join('，');
        artifacts.push(makeArtifact('pin-table', hardware, `${name}引脚连接关系表`, `紧跟在${name}接口电路说明处，按“外设信号、主控引脚、连接说明”生成该器件专用三线表，不设置“信号方向”列，不与其他器件合并。只写已确认映射：${confirmedPins}；最多5列、8行数据。`, '', { sectionId, sourceFactIds: device.sourceFactIds, reason: `就近核对${name}的已确认引脚，避免硬件章节出现超长总表` }));
      }
    });
    artifacts.push(is51Project
      ? makeArtifact('circuit', hardware, '5V系统供电电路图', '只保留“此处插入5V系统供电电路图”的简短独立提示，不强行加入3.3V稳压关系，不写绘制步骤。', '', { sectionId: findOutlineSection(hardware, [/供电|电源|稳压/]), reason: '说明51单片机系统的5V供电与共地关系' })
      : makeArtifact('circuit', hardware, '5V输入与3.3V稳压供电电路图', '只保留“此处插入5V输入与3.3V稳压供电电路图”的简短独立提示，不写绘制步骤。', '', { sectionId: findOutlineSection(hardware, [/供电|电源|稳压/]), reason: '说明开发板5V输入和板载3.3V稳压供电关系' }));
  }
  if (software) {
    artifacts.push(makeArtifact('software-architecture', software, '系统软件功能模块图', '直接生成简洁Mermaid代码，使用flowchart TD，用5至9个节点表达主程序、初始化、任务调度、数据采集处理、状态判断、联动控制、显示更新、通信处理、模式管理和异常处理等程序模块的调用层级。不得照搬总体方案小节的系统总体功能框架图的节点和连接方式，不逐个罗列传感器、继电器等硬件器件，不出现实际器件型号、硬件接线或引脚。', '', { sectionId: findOutlineSection(software, [/架构|框架|软件.*结构|任务.*划分/]), reason: '说明程序内部的任务划分和软件模块调用层级，与总体方案中的硬件及信息流框架区分' }));
    artifacts.push(makeArtifact('flowchart', software, '主程序流程图', '直接给出简洁Mermaid代码，使用flowchart TD；A([开始])和末端([结束])各一个，主干自上而下，分支尽快汇合。控制在6至9个短句节点、最多2个判断节点，仅保留初始化、采集、判断、执行、显示/通信更新和异常处理等关键步骤。', '主程序', { sectionId: findOutlineSection(software, [/主程序|主循环|任务调度|运行流程|整体.*流程|初始化/]), reason: '说明系统软件的主执行顺序' }));
    groupWorkflowFunctions(distinctFunctions).forEach(group => {
      const names = group.records.map(item => item.source);
      const factIds = uniqueNames(group.records.flatMap(item => item.sourceFactIds || [item.id]));
      artifacts.push(makeArtifact('flowchart', software, `${group.title}流程图`, `直接给出一张简洁Mermaid流程图，用一个完整流程覆盖以下相关功能：${names.join('、')}。使用flowchart TD，A([开始])和唯一末端([结束])各一个，5至9个短句节点、最多2个判断节点；突出共享输入、关键判断、联动动作和异常出口，不要把每个驱动读写步骤再拆成独立流程图。`, group.title, { sectionId: functionOutlineSection(software, group.title), sourceFactIds: factIds, reason: '将同类程序和功能逻辑归入一张核心流程图，减少重复图示' }));
    });
    const timingFunction = distinctFunctions.find(item => /单总线|DHT|DS18|I2C|SPI|UART|串口|通信|无线|蓝牙|WiFi|射频/i.test(item.source));
    if (timingFunction) {
      const protocol = timingFunction.source.match(/DHT\d+|DS18B20|I2C|SPI|UART|单总线|串口|WiFi|蓝牙|射频/i)?.[0] || '外设接口';
      artifacts.push(makeArtifact('timing', software, `${protocol}关键通信时序图`, `只描述${protocol}这一项通信过程，不把采集、显示等完整功能链混入图名或图内。直接生成一张横向展开的简洁Mermaid时序示意图，必须使用flowchart LR，让时间从左向右推进。使用A([开始])和唯一的Z([结束])终止节点，按发起、应答、数据传输、异常或超时处理、结束排列5至9个短句节点；可在连线上标注关键电平、响应时间或通信阶段。禁止使用sequenceDiagram或flowchart TD，禁止把功能判断流程重复画成时序图。`, timingFunction.source, { sectionId: functionOutlineSection(software, timingFunction.source), sourceFactIds: [timingFunction.id], reason: '以从左向右的时间轴说明一项代表性严格通信过程，避免竖向图和相似时序图堆叠' }));
    }
    const calculationFunction = distinctFunctions.find(func => /ADC|模拟|温度|湿度|光照|滤波|平均|阈值|误差|校准|速度|距离|电压|电流/i.test(functionSource(func)));
    if (calculationFunction) {
      const name = functionSource(calculationFunction);
      artifacts.push(makeArtifact('formula', software, `${name}数据处理公式`, '给出真实使用的换算、滤波、阈值或校准公式，并逐一解释变量、单位、参数来源及程序中的使用位置。', name, { sectionId: functionOutlineSection(software, name), sourceFactIds: [calculationFunction.id], reason: '说明软件中确实存在的数据处理关系' }));
    }
  }
  if (test) {
    const scenes = groupResultScenes(distinctFunctions);
    if (!scenes.length) scenes.push({ title: '系统运行状态', records: [] });
    const testGroups = groupTestFunctions(distinctFunctions);
    if (!testGroups.length) testGroups.push({ title: '系统运行状态', records: [] });
    testGroups.forEach(group => {
      const chunks = group.records.length ? Array.from({ length: Math.ceil(group.records.length / 8) }, (_, index) => group.records.slice(index * 8, index * 8 + 8)) : [[]];
      chunks.forEach((records, index) => {
        const suffix = chunks.length > 1 ? `（第${index + 1}组）` : '';
        const factIds = uniqueNames(records.flatMap(item => item.sourceFactIds || [item.id]));
        const names = records.map(item => item.source);
        artifacts.push(makeArtifact('test-table', test, `${group.title}${suffix}功能测试表`, `只验证以下同类功能：${names.join('、') || '系统基本运行'}。每表最多5列、8行数据，表题在表格上方；包含测试环境或输入条件、操作步骤或测试次数、量化结果/误差/响应时间和结论，表前说明测试方法，表后分析结果。`, '', { sectionId: functionOutlineSection(test, group.title), sourceFactIds: factIds, reason: '按测试职责归组量化数据，避免一张超长总表或为每个功能机械建表' }));
      });
    });
    scenes.forEach(scene => {
      const factIds = uniqueNames(scene.records.flatMap(item => item.sourceFactIds || [item.id]));
      const names = scene.records.map(item => item.source);
      artifacts.push(makeArtifact('result-image', test, `${scene.title}功能展示图`, `只保留“此处插入${scene.title}功能展示图”的简短独立提示。一张图片可同时证明以下相关功能的可观察结果：${names.join('、') || '系统基本运行'}；不得为同一器件、同一屏幕页面或同一动作状态重复安排近似图片。`, scene.title, { sectionId: functionOutlineSection(test, scene.title), sourceFactIds: factIds, reason: '按可观察结果场景合并功能展示，避免重复拍摄同一器件' }));
    });
  }
  return artifacts.filter(item => item.chapterId).map(item=>routeArtifact(outline,item,uniqueDevices)).sort((left, right) => {
    const chapterDifference = outline.findIndex(chapter => chapter.id === left.chapterId) - outline.findIndex(chapter => chapter.id === right.chapterId);
    if (chapterDifference) return chapterDifference;
    const sections = outline.find(chapter => chapter.id === left.chapterId)?.sections || [];
    const position = artifact => sections.findIndex(section => section.startsWith(`${artifact.sectionId} `));
    return position(left) - position(right);
  });
}

export function buildSchemeMessages({ title, requirements, functionCount, preferences = {}, policy = null, previousResult = null, qualityGuard = '' }) {
  return [
    {
      role: 'system',
      content: `你是单片机项目方案设计工程师。根据题目和用户附加要求输出一份可直接交给制作人员和客户确认的方案。用户附加要求优先级最高，不得被默认方案或常见做法覆盖。方案只包含题目、器件、功能三部分，不出现等级、档次、B级方案、AI、模型、推理过程等字样。

器件格式必须为“准确型号  （简短作用）”，例如“STM32F103C8T6  （主控）”“DHT11  （温湿度传感器）”“0.96寸OLED  （屏幕）”。禁止写成96寸OLED。需要独立WiFi模块时默认且只使用ESP-01S，不得输出ESP8266；如果主控本身已具备WiFi，则不要重复堆叠无线模块。功能格式必须为“使用某器件或技术实现某项功能”，每项功能在原有功能名称后补充一小句实现逻辑，说明主控如何处理或控制结果；不要拆成“功能目标、输入、输出、异常处理”等额外栏目。器件与功能必须闭合，不加入与题目无关的堆料。

功能边界是硬性规则：functions只能写系统最终提供给用户或外部对象的可观察功能，例如采集、检测、监测、显示、远程查看、数据上传、阈值控制、报警、记录、查询、设置、调节、识别、手动切换和联动控制。不得把工程配套、连接条件或元件作用当成功能，包括10 kΩ上拉/下拉电阻、电阻、电容、晶振、稳压、电源供电、共地、复位按键、下载/烧录/调试接口、排针、杜邦线、焊接、PCB和“保证通信稳定”等表述。它们只能在器件作用或附加要求中出现；如果某项只有这些内容，直接省略，不要为了凑够数量把它列入functions。不要输出重复或仅换词的功能。

默认硬件约定：除51单片机项目外，主控按常用最小系统开发板选用；开发板使用5V DC输入，并通过板载稳压获得3.3V；需要上拉电阻时统一使用10 kΩ。未指定彩屏而项目确需TFT时使用1.8寸TFT，不使用2.8寸TFT。用户附加要求明确给出其他做法时，以用户要求为准。

人体检测类项目的默认器件为“TCRT5000（人体红外传感器）”；只有用户明确指定其他型号时才允许替换，不得自行输出HC-SR501或LD2410。

数量是参考目标：functions通常围绕functionCount生成，允许因题目实际内容合理增减约两项，但不得为了凑数拆分同一功能或加入无关功能。用户附加要求中的必需功能不能删掉；目标数量偏高时优先保留真实、可观察、符合应用场景的功能，宁可少于目标也不能堆砌。禁止把采集的同一数据、同一界面显示或同一控制动作换词拆分凑数。上拉、供电、复位、烧录、编译和程序编写不占功能名额。先检查功能数量、应用场景与器件闭环再输出。

功能必须符合题目的应用场景：先识别题目中的使用对象、环境和管理目标，再围绕这些内容组织功能。不得把其他项目的功能直接套用进来；例如寝室管理系统不得生成温室灌溉、鱼缸水泵、车辆定位等无关功能。每项功能都要能说明它服务于当前场景中的什么对象或问题。

用户附加要求与下拉选择都属于用户约束；若两者冲突，附加要求优先。主控或屏幕选择为“自动选择”时才由你决定。指定主控必须原型号保留并实际承担控制，不能只在器件列表里列出所选型号却让另一个型号执行功能；不得擅自替换或增加主控。指定屏幕必须按所选屏幕实现显示；屏幕选择为“不使用屏幕”时禁止加入屏幕器件或屏幕显示功能。

云平台空选择表示“不使用云平台”，绝不是“自动选择”。没有选择云平台且附加要求没有明确要求云服务时，即使题目包含WiFi、手机APP、远程查看，也不得自行增加OneNET、阿里云IoT、巴法云、点灯科技Blinker、私有物联网服务器、其他云品牌或泛称的云端服务。WiFi与APP不等于云平台。仅当已选择APP或附加要求明确需要手机/无线通信时，才用局域网直连、设备热点或其他无需云的可行方式；不得把局域网方式冒充跨地域公网远程控制。已选择云平台时，必须在真实的数据上传、远程查看或指令控制功能中说明所选平台用途，不得换成别家或另外增加平台。附加要求明确指定云平台时优先采用；只要求云服务而未指定品牌时，使用泛称“云平台”，不擅自挑品牌。云平台不是实体器件，不混入器件清单。选择“点灯科技 Blinker”时可采用平台官方客户端完成数据显示和设备控制，无需自行开发APP；主控已有联网能力时不额外增加ESP-01S。云平台和APP的未选状态属于内部约束，客户方案只描述实际采用的通信方式，不要专门输出“未使用云平台”或类似否定说明。

APP设计软件的空选择同样表示“不使用”，不是让你自动选择APP设计工具。APP与云平台都未选择，并且附加要求没有明确要求APP、云服务或外部通信时，禁止加入ESP-01S、蓝牙、LoRa、4G、以太网等额外通信模块，禁止自动追加手机查看、联网、无线传输或远程控制功能。功能数量不足应补充贴合题目的本地检测、显示、报警、操作或控制行为，不得靠通信功能凑数。若所选主控为ESP32等自带WiFi的芯片，可以正常保留该主控，但不要自动启用其联网功能。此规则不禁止传感器与主控之间的I2C、SPI、UART等内部接口。附加要求明确要求外部通信时仍优先执行。

编程软件是开发实现约束，选择了Keil 5、STM32CubeMX、IAR或Arduino IDE时，应据此保证主控和实现路径可用；没有选择时按主控合理确定。编译、烧录、程序编写、工程配置不能成为面向用户的功能，编程软件也不能当作器件。已选择APP设计软件时，必须在对应的手机或小程序交互功能中体现所选工具，例如“使用MIT App Inventor制作手机端，通过ESP-01S直连实现状态查看和设备控制”，不能忽略已选软件，不能为了APP自行追加云平台。未选择APP设计软件时不自行加入App Inventor、Android Studio或自制微信小程序；已选择云平台可使用该平台现成的官方客户端或网页。软件名称不要混入器件清单。

resolvedConstraints是对用户配置及明确附加要求整理后的约束，逐项检查其中的主控、屏幕、云平台和功能数量。若附加要求存在它未识别的明确冲突，不要含糊掩盖，也不能无依据地覆盖用户配置。

${qualityGuard ? `上一次结果校验反馈：${qualityGuard}。请优先修正这些问题后再返回完整JSON。` : ''}

只返回JSON：{"title":"题目","devices":[{"model":"型号","role":"作用"}],"functions":["使用……实现……，主控根据……处理并完成……"]}`,
    },
    {
      role: 'user',
      content: JSON.stringify({ title, additionalRequirements: requirements || '无', functionCount: functionCount || '根据题目合理确定', selectedPreferences: preferences, resolvedConstraints: policy, ...(previousResult ? { previousResult } : {}) }, null, 2),
    },
  ];
}

export function buildSchemeMaterialImportMessages({ rawText, currentTitle = '' }) {
  return [
    {
      role: 'system',
      content: `你是单片机论文项目资料整理员。请从用户粘贴或导入的方案中识别论文题目、器件清单、功能要求和可用于论文写作的补充说明。必须忠实保留方案中明确写出的型号和功能，不要改换主控，不要凭空删除内容；只有缺少作用说明时才根据型号补充简短作用。把同一器件去重，把每项功能整理成一行。任何ESP8266字样统一规范为ESP-01S；0.96寸OLED不得误写成96寸OLED；2.8寸TFT统一规范为1.8寸TFT。

只返回JSON：{"title":"完整题目","devices":[{"model":"准确型号","role":"简短作用"}],"functions":["功能要求"],"sourceNotes":"方案中与软件、云平台、测试、实物、限制条件有关且不适合放入器件或功能字段的补充信息"}`,
    },
    { role: 'user', content: JSON.stringify({ currentTitle, importedSchemeText: String(rawText || '').slice(0, 80000) }, null, 2) },
  ];
}

export function buildHardwareMessages(materials) {
  return [
    {
      role: 'system',
      content: `你是单片机项目硬件事实整理工程师。用户填写内容优先，不能擅自替换。资料只有题目时给出一套常见、真实、适合本科制作的建议；资料部分缺失时只补缺失项。用户不需要预先填写硬件连接关系，你必须先根据器件型号识别通信方式和所需信号，再依据主控资源生成供用户下拉确认的引脚建议。必须识别准确主控型号、外设型号、接口类型和每个接口需要的信号。不要把VCC、GND放入GPIO分配，但必须在powerNotes中说明供电电压和共地关系。需要独立WiFi模块时使用ESP-01S，禁止输出ESP8266；人体检测类项目默认使用TCRT5000（人体红外传感器），不得自行输出HC-SR501或LD2410；屏幕未明确指定且确需彩屏时使用1.8寸TFT，不使用2.8寸TFT。不要声称项目无法完成。

开发软件必须结合识别出的主控型号和所选程序文件后缀给出：STM32固定为Keil 5和STM32CubeMX；STC、AT89等51单片机固定为Keil 5；Arduino UNO和ESP32固定为Arduino IDE；其他主控根据其官方或主流工具链选择，不得沿用错误平台的软件。developmentTools只放编译、配置、下载或程序开发软件，不放万用表、示波器等硬件工具。

supplementalDocumentText是用户上传的任务书或开题报告。它只能用于提取课题背景、行业需求、研究方向和明确的设计约束，并压缩写入backgroundNotes；不得从该文档提取、补充或覆盖器件清单、功能要求、引脚和测试结果。功能事实以userFunctions及导入方案为准；二者为空时才根据题目给出合理基础功能，也不能把任务书中的功能段落直接当成已确认方案。

如果schematicText来自PDF原理图，先把其中明确出现的型号、网络名和引脚当作最高优先级事实；只对文本中确实出现的连接生成mapping。PDF文字可能把标签挤在一起，无法确定连接时使用“待确认”并在conflicts说明，不要猜测。STM32F103C8T6的I2C2默认脚为PB10=SCL、PB11=SDA，I2C1常用PB6/PB7或重映射PB8/PB9，不能因为PB10/PB11属于串口复用而漏掉它们。

默认硬件事实必须写入powerNotes或fixedFacts：除STC、AT89等51单片机外，主控视为最小系统开发板；开发板使用5V DC输入，板载稳压得到3.3V，5V外设接5V电源轨，系统所有模块共地；凡使用上拉电阻均统一为10 kΩ。默认使用PCB承载或接口连接板，默认制图软件是嘉立创专业版，与最小系统开发板并不冲突。只有用户明确提供不同事实时才按用户事实覆盖这些默认项。

I2C设备列SCL、SDA；UART设备列TX、RX；SPI设备列SCK、MISO、MOSI及每个设备独立CS；模拟传感器列AO/ADC；普通控制列CTRL；有实际需要时列INT、RST、EN。推荐引脚必须考虑主控的准确具体型号、芯片封装、开发板实际引出脚和常见复用关系，不能把STM32F103的端口套用到其他STM32系列，也不能把Arduino、ESP32或51单片机的命名混用。若具体型号不明确，宁可把pin设为“待确认”并在conflicts说明，也不能编造不存在的引脚。I2C等总线可合理共享，并用同一busGroup标识。只返回JSON：
{"controller":"准确主控型号","developmentTools":["与主控对应的软件"],"backgroundNotes":"仅从任务书或开题报告提取的背景方向，未上传则为空","devices":[{"model":"型号","role":"作用","interfaceType":"GPIO/I2C/UART/SPI/ADC/1-Wire等"}],"functions":[{"name":"功能","deviceModels":["关联器件"]}],"mappings":[{"device":"器件型号","interfaceType":"接口","signal":"SCL等","pin":"PB6","alternatives":["PB8"],"busGroup":"I2C1或空","shareAllowed":true}],"powerNotes":["供电与共地说明"],"fixedFacts":["确定的通信常识"],"conflicts":["仅用户资料明确矛盾时填写"]}`,
    },
    {
      role: 'system',
      content: '多路继电器处理规则：同一型号的多个继电器可以共用一个器件清单项，但必须按被控对象分别建立功能、控制通道和主控引脚映射。例如继电器1控制风扇、继电器2控制水泵，不能合并成笼统的继电器控制。每个通道的signal应带通道或对象标识，全部映射必须保留，后续论文要分别介绍其电路、程序逻辑和测试结果。',
    },
    { role: 'user', content: JSON.stringify({ ...materials, schematicText: String(materials?.schematicText || '').slice(0, 100000), schematicFilename: materials?.schematicFilename || '' }, null, 2) },
  ];
}

export function buildReferenceRecommendationMessages({ title, devices = [], functions = [], candidates = [], count = 15 }) {
  const total = Math.max(5, Math.min(30, Number(count) || 15));
  const chineseCount = Math.round(total * 0.7);
  const foreignCount = total - chineseCount;
  return [
    {
      role: 'system',
      content: `你是电子信息工程课题的参考文献筛选员。只能从candidateReferences中选择，不得补写、改写或虚构文献。根据课题题目、器件、功能和补充关键词，精确选择${total}篇与课题最相关、可用于开题报告、任务书或论文第一章研究现状的文献。

筛选要求：
1. 主题相关性最高，优先近五年期刊论文；标准、学位论文、会议论文只在确有价值时选用。
2. 中外文比例固定约7:3：选择中文${chineseCount}篇、外文${foreignCount}篇；仅在候选确实不足时允许微调，禁止为凑数选择明显跑题文献。
3. 文献库没有摘要时，只能根据题名、方向、来源和适用课题判断相关性，不能虚构研究方法、实验数据或研究结论。
4. 每篇只能出现一次。只返回候选中的id，reason用一句话说明它与本课题哪个研究方面相关。

只返回JSON：{"selected":[{"id":"lib-1","reason":"相关性说明"}],"summary":"筛选依据"}`,
    },
    {
      role: 'user',
      content: JSON.stringify({ title, devices, functions, requestedCount: total, languageTargets: { chinese: chineseCount, foreign: foreignCount }, candidateReferences: candidates }, null, 2),
    },
  ];
}

export function buildDailyMotivationMessages({ date = '', slot = '', avoidTexts = [] } = {}) {
  return [
    {
      role: 'system',
      content: `你是单片机设计工作室的励志语编辑。请写一句简短、坚定、热血但不空泛的中文鼓励语。可以化用古诗词或名言，但不要冒充名人原话，不要写作者姓名，不要出现AI、模型、论文生成、接口、API等技术提示。优先突出逆风翻盘、破局、坚持和最终抵达，适合从右向左滚动展示。新语句不得与本轮avoidTexts中的任何一句相同。只返回JSON：{"text":"鼓励语"}。日期：${date}；轮次：${slot}`,
    },
    {
      role: 'system',
      content: '内容风格改为通用励志语，不必贴合单片机或论文主题。优先使用热门古诗词片段、历史名句和逆风翻盘风格的格言，突出困境中的坚持、破局、反转和最终抵达；可以化用但不要捏造作者或把不确定出处强行署名。语句要适合顶部滚动展示，控制在18至45个汉字。',
    },
    { role: 'user', content: JSON.stringify({ date, slot, avoidTexts }, null, 2) },
  ];
}

export function buildOutlinePlanMessages({ title, facts, materials, targetBodyChars = MIN_BODY_CHARS, previousPlan = null, validationIssues = [] }) {
  const repairing = Boolean(previousPlan && validationIssues.length);
  const reference = parseReferenceOutline(effectiveReferenceText(materials));
  const pcbPolicy=pcbDesignPolicy(facts,materials);
  const selection = planDeviceSelection({ ...facts, targetBodyChars, referenceText: reference.rawText });
  const systemPrompt = `你是单片机本科毕业论文目录规划专家。依据确认的方案器件、功能、程序和参考目录，返回唯一一版可用于写作的目录，不生成正文、图表统计或多个模板。

优先级：确认事实不可更改；参考目录决定可辨识的章数、章名、章节次序、局部分组和小结安排；必要内容在适合的位置补齐，不以默认六章覆盖参考。题目和方案没有的APP、云平台、算法不编造。PCB遵守pcbPolicy：默认使用PCB，软件为嘉立创专业版；主控开发板可安装于承载或接口连接板，不能因器件清单没有“PCB”而删除该设计。

参考解读分三类：
1. referenceStructure.mode为detailed时，保持清楚的章数、章名、内容分工和二三级层级，把当前方案对应到原位置；占位符和旧课题器件可替换。只有事实不适用、内容缺失或明显重复时才做必要调整并解释。选型已有位置就沿用，不强行迁往第二章。
2. mode为partial时，结合章标题、局部编号和文字说明恢复可辨识框架。chapterCount有值即为明确总章数，不得擅自增加；为null表示没有充分证据，不能把截取到的最高章号当作总章数。已见的小结及“各章有小结”要求必须保留；未显示的部分补齐，不能以信息不全为由回退整套默认目录。只有前五章且未见结论也未明确共五章时，可以补总结；明确五章时应把必要职责归入合并章节，不能直接加第六章。如果unnumberedConclusion为true且总章数尚未确定，说明参考在编号章节后另列了结论，应把这部分整理成独立末章，不能揉进测试小节或本章小结。
3. 未提供参考时由程序采用默认目录，各章额外有本章小结，不需你另造结构。

允许3至12章，连续编号。六种内容职责introduction、overall、hardware、software、test、conclusion必须得到覆盖，但不要求各占一章。可以增加requirement相关技术章，或用implementation章合并硬件与软件。每章roles列出实际承担的核心职责；额外需求/技术章可用空数组。kind用最适合的主职责，软硬件合章用implementation，额外需求用requirement，其他用other。首章承担introduction。一个章节合并多种职责时，各自用明确小节分开，禁止内容重复。不要给不相关章错误添加roles来凑覆盖。

第一章优先逐项保留参考可读标题、层级、顺序及内容方向，即使参考整体不完整也一样；不能用默认“背景意义、国内外现状、主要内容、结构安排”四节替换参考的分组。第一章已有两个及以上二级分组且接着第二章时，保留原二级分组数量及各分组内已给出的三级分组数量；占位标题在原位置按项目及写作方向命名，不额外套入默认小节。主要工作、研究评述、技术路线和论文安排可归入已有三级标题或用不同自然段补充，不为满足默认措辞而改名或挪位。论文结构说明需按最终实际目录写全所有一级章节的编号和章名，不能假定总共五章或六章。

器件选型是完善论证的补充：只给selectedDevices中重要器件安排比较，不为所有辅助器件机械增设标题。2万字及以下通常选三四个，2万字以上适度增加，不为字数堆砌。参考已有选型位置时保留；完全未提选型时，在第二章合适位置简要插入关键器件选型，不重构整章，遵守selectionPlan的brief模式。选型位置只有“主控选择”而selectedDevices还包括重要外设时，在该位置补充合理分类，或扩展为“主控与关键外设选型”，不得把传感器、通信等器件图表全塞进仅介绍主控的三级标题。对应器件图片及简短对比表由程序随后安排，不把图表清单写进目录。

内容分工随目录实际位置走：总体功能框架只论述一次；电路写实际供电、连接和接口，不重复选型；软件写任务结构、驱动和功能判断，不复述接线；测试覆盖功能场景、量化结果与稳定性，不复述程序流程；总结针对已完成工作。图、表和公式会按实际职责匹配小节，不使用固定2.4、4.1、5.4等编号。三级标题按独立论点需要设置，不能按器件逐一堆砌。绝对不生成3.1.1.1这样的四级标题：若选型已位于三级标题下，多个器件用正文段落区分，不再细拆。

referenceUnits每项必须且只能有一条referenceUsage：referenceId原样；action为adopted、adapted或not-applicable；sections列最终实际二三级编号；reason说明如何采用、补充、合并或为何事实不适用。基础结构和小结不能随意忽略。章数和小结要求同时按referenceStructure核对，不能只声称已参考。无参考时referenceUsage为[]。
只返回JSON：summary、chapters、referenceUsage。chapters每项为id（字符串）、title、kind、roles（核心职责字符串数组）、sections（“x.x 标题”“x.x.x 标题”字符串数组）。编号连续，子标题紧随父标题，标题无Markdown井号，实际章名不含“第X章”前缀。`;

  const payload = {
    task: repairing ? '修复上一版目录结构，完整返回修复后的JSON' : '按参考框架生成唯一一版完整目录',
    title,
    targetBodyCharacters: Math.max(MIN_BODY_CHARS, Math.min(40000, Number(targetBodyChars) || MIN_BODY_CHARS)),
    confirmedFacts: { controller: facts?.controller, devices: facts?.devices || [], functions: facts?.functions || [], fixedFacts: facts?.fixedFacts || [] },
    userReferenceOutline: reference.rawText || '未提供，依据当前项目独立组织结构',
    referenceUnits: reference.units,
    referenceStructure: {mode:reference.mode,chapters:reference.chapters,chapterCount:reference.chapterCount,minimumChapterCount:reference.minimumChapterCount,allChaptersHaveSummary:reference.allChaptersHaveSummary,unnumberedConclusion:reference.unnumberedConclusion},
    pcbPolicy,
    selectionPlan: {mode:selection.mode,description:selection.description},
    selectedDevices: selection.devices.map(device => ({model:device.model,role:device.role})),
    sourceCodeFiles: materials?.filenames || [],
    sourceCodeSummary: buildSourceCodeExcerpt(materials?.codeFiles, materials?.codeText, 6000),
    testInformation: String(materials?.testInfo || '').slice(0, 8000) || '未提供',
    backgroundDirection: String(materials?.sourceBackgroundText || '').slice(0, 8000) || '未提供',
    otherRequirements: String(materials?.sourceNotes || '').slice(0, 8000) || '未提供',
    ...(repairing ? { validationIssues, previousPlan } : {}),
  };
  return [{ role: 'system', content: systemPrompt }, { role: 'user', content: JSON.stringify(payload, null, 2) }];
}

export function chapterResponsibilities(kind) {
  if (kind && typeof kind === 'object') {
    const roles = chapterRoles(kind);
    return `${roles.length > 1 ? '本章合并多种职责，以下要求分别适用于对应小节，不得互相覆盖。' : ''}${roles.length ? roles.map(role => chapterResponsibilities(role)).join('\n') : chapterResponsibilities(kind.kind)}\n严格按本章实际目录分配内容；若本章设有选型小节，只论证选型清单中的关键器件，其他小节不重复。若有本章小结，简洁归纳本章实际内容，不重复摘要或下章内容。`;
  }
  const map = {
    introduction: '严格按本项目已规划目录写背景意义、国内外研究现状、研究评述、主要研究内容和论文组织，不得改回默认四节目录。主要研究内容与论文结构分别论述，可以是独立二级小节或同一父标题下的不同三级小节，遵从当前目录。清楚参考没有单列某项时，在现有合适小节用不同自然段补充，不能因此漏掉主要工作或论文组织说明。器件、电路、程序和测试细节留给后续章节。文献只能在现状分析中依正文首次出现顺序单篇引用，每篇最多引用一次。',
    requirement: '只写功能需求、性能需求与可行性，不提前展开具体电路和程序步骤。',
    overall: '写系统需求、总体结构和工作原理。器件选型仅在目录指定位置讨论选型清单中的重要器件，与两个常见候选作简短比较后给出项目依据；不要求每类外设都另写选型。候选型号不加入实际器件。其余器件在对应电路中简要介绍。',
    hardware: '写主控、电源和各外设电路及实际连接关系；如果参考将选型设在本章，则只在指定选型小节论证关键器件，不重复其他章节。PCB小节按实际连接说明嘉立创专业版中的布局、走线、电气检查与接口安排，不能因使用开发板就删去PCB承载或接口板内容。按照目录合理归纳同类电路，说明信号、引脚、供电、共地、10 kΩ上拉或驱动关系；每个外设的简短引脚表紧跟其接口电路说明，不设置硬件设计章节总引脚表。电路图提示和对应引脚表之间必须先有分别介绍该器件接口与连接依据的实质正文，不能连续出现图位和表格。除51单片机外主控按最小系统开发板描述，5V输入经板载稳压获得3.3V。每个实际器件都有对应电路图提示。多路继电器按被控对象分别写控制通道、引脚和驱动逻辑。硬件电路小节禁止重复生成系统结构图或硬件框架图，不得重复已在其他位置介绍的器件参数、图片、候选比较和选型理由，也不能提前写程序流程。',
    software: '只写软件结构、主程序、器件驱动过程和各核心功能逻辑。系统软件功能模块图只表达程序任务划分和调用层级，不得重复总体方案章节系统总体功能框架图中的硬件节点、器件型号、信息流连接或硬件接线。保留一张主程序流程图，再依据独立判断链决定核心流程图数量：共享输入、判断和输出的功能合并成一张；报警、环境调节、水路控制、机构动作、远程交互等运行逻辑明显不同的功能分别保留。每项确认功能必须恰好被一张核心流程图覆盖，不设固定数量，也不得为仅有固定读写步骤的驱动机械加图。通信时序只选择最有代表性的严格时序过程，并使用flowchart LR按时间从左向右横向展开，禁止使用sequenceDiagram或flowchart TD画成纵向时序。真实计算才使用公式。多路继电器按被控对象分别描述判断条件、输出通道和异常处理，但共享驱动过程不重复画图。公式只放在软件或控制逻辑对应小节，不能在仅承担测试的章节生成公式。不得粘贴程序源代码，不直接用函数名堆叠介绍，也不得重复硬件接线。',
    implementation: '按功能分别写硬件连接与软件逻辑，但同一器件的选型介绍、连接关系和程序过程必须分工清晰，禁止在不同小节重复。',
    test: '写调试工具、操作方法、全部功能的量化测试、功能展示图位置及结果分析。没有用户数据时结合器件能力和现实实验条件保守推定；测试内容按可观察结果场景归组，一张展示图可以同时证明多个相关功能，同一器件、同一屏幕页面或同一动作状态不得反复安排图片。多路继电器按被控对象分别测试和分析，但可在同一联动场景图中展示；必须有数据表格，不提示“模拟数据”，测试章节不生成公式，公式和计算方法统一放在软件设计章节，不得重复软件设计章节程序流程。',
    conclusion: '结合题目背景概括已完成工作、主要结果和合理展望。不得自曝系统未完成、功能缺失或使用模板化套话。',
  };
  return map[kind] || '';
}

export function referenceWritingPolicy(project,chapter) {
  const paper=project.paper;
  return {referenceContract:chapterReferenceContract(chapter,effectiveReferenceText(paper.materials),paper.outlinePlanning?.referenceUsage),
    pcbPolicy:pcbDesignPolicy(paper.factSheet,paper.materials),
    paperOrganization:hasChapterRole(chapter,'introduction') ? {chapterCount:(paper.outline || []).length,chapters:(paper.outline || []).map(item=>({id:item.id,title:item.title})),instruction:'论文组织结构必须逐章写全此目录，不能省略最后结论章'} : null};
}

export function buildChapterMessages({ project, chapter, outline, artifacts, completedDigest }) {
  const chapterArtifacts = artifacts.filter(item => item.chapterId === chapter.id);
  const baseTarget = CHAPTER_TARGETS[chapter.kind] || 3200;
  const tertiaryCount = (chapter.sections || []).filter(section => /^\d+[.．]\d+[.．]\d+\s+/.test(section)).length;
  const plannedTarget = Number(chapter.targetCharacters);
  const target = Math.min(9000, Math.max(900, plannedTarget || (baseTarget + Math.max(0, tertiaryCount - 2) * 320)));
  const references = hasChapterRole(chapter, 'introduction')
    ? (project.paper.referenceRecords || []).map((reference, index) => ({
        citation: `[${index + 1}]`,
        authors: reference.authors,
        title: reference.title,
        abstract: reference.abstract || '',
        fullPublication: reference.formatted || reference.raw || '',
      }))
    : '本章禁止新增引用';
  const facts = project.paper.factSheet;
  const selection = planDeviceSelection({...facts,targetBodyChars:project.paper.materials.targetBodyChars || MIN_BODY_CHARS,referenceText:effectiveReferenceText(project.paper.materials)});
  const systemPrompt = `你是单片机方向本科毕业论文写作者。写作水平符合普通本科生，内容具体、自然、严谨，允许适当行业背景和专业套话，但必须围绕题目。不要输出解释、写作计划或质量自评，直接输出本章正文。

通用铁律：
1. 用户确认资料最高优先级；不得改换主控、器件、引脚、接口、功能。
1.1 全文不得出现ESP8266；独立WiFi模块统一写ESP-01S。
2. 遵守章节职责，选型、硬件连接、程序逻辑、测试内容不得跨章重复。同一事实只在最合适的位置详细写一次，其他位置最多用一句承担衔接，不得换词复述。completedChapterDigest中已经出现的参数、原理、步骤、结论和图表不得再次详细展开。不得重复已经写过的二级或三级标题；相邻小节不能使用相同的段落开头、论证顺序或结论句式。若两个小节职责接近，应合并为一个完整论证，不要复制一套内容后换标题。
3. 标题必须单独成行且不使用Markdown井号。二级标题严格写成“x.x 标题”，三级标题严格写成“x.x.x 标题”。必须完整保留requiredSections给出的标题并按顺序写作；不得自行增加三级标题。三级标题只承担目录已经确认的分类，不按每个器件、功能或测试项目继续细拆，同类内容在同一标题下用自然段组织。
4. 不插入源代码，不用具体函数名作为主体介绍。
5. 每个chapterArtifacts项目都必须在对应内容之后出现，不能遗漏。chapterArtifacts中的每张图、每张表和每个公式都已给出唯一编号；图前实质正文中必须恰好出现一次“如图x-x所示”，表前实质正文中必须恰好出现一次“如表x-x所示”，公式前实质正文中必须恰好出现一次“如式（x-x）所示”，均需融入完整分析句，禁止单独成段、漏写、重复引用或自行改号。器件图、电路图、实物图和功能展示图使用独占一行的“【非正文·插图位置：图x-x 图名】”，下一行写“【非正文结束】”，再下一段单独写题注“图x-x 图名”；不得添加拍摄、取景、构图、绘制步骤或冗长标注说明。框架图、软件结构图、程序流程图和通信时序图使用“【非正文·Mermaid图：图x-x 图名】”包住第7条规定的Mermaid代码，在“【非正文结束】”后单独写同号题注。硬件电路小节不重复生成总体结构图，合章时仍按各小节职责和图表清单写作。comparison-table、pin-table和test-table必须直接生成可用的Markdown表格，表题严格写成“表x-x 表名”；每个pin-table只写一个器件，使用“外设信号、主控引脚、连接说明”三列，禁止“信号方向”列。formula必须把公式独占一行并在行末写“（x-x）”，随后解释变量、单位、参数来源和用途。所有非正文提示、题注、表题和公式前后各空一行，绝不能接在正文句末。
5.1 任意两项视觉内容之间都必须有至少一个不少于80字的实质正文段落。图与图、图与表、表与图、表与表均不得连续出现；中间段落需要分析前一项内容并自然引出后一项，不能只写“如下图/表所示”等过渡句。不同章节不得复用相同的图位标题、Mermaid代码、表格标题或图表说明；器件图片必须放在对应器件选型小节的正文分析之后，不能集中放在章节末尾或放到其他器件小节。
6. 系统总体功能框架图只在总体方案章节出现一次，使用硬件组成、数据方向和控制方向说明系统；硬件设计章节只用电路图和分器件引脚表表达硬件，不再生成同义结构图。软件设计章节的系统软件功能模块图只写程序任务划分与调用层级，不逐个罗列硬件器件和型号，不得照搬总体方案章节框架图的主要节点或连接关系。如果两张图只是更换标题而节点与连线基本相同，必须重画软件图。
7. 框架图、结构图、流程图和时序图固定使用独占一行的“【非正文·Mermaid图：图x-x 图名】”，下一行用三个反引号加mermaid开启代码围栏，末尾关闭代码围栏，再单独写“【非正文结束】”和题注“图x-x 图名”。系统总体功能框架图使用flowchart LR，系统软件功能模块图使用flowchart TD，均控制在9个节点以内。程序流程图必须使用flowchart TD，起点写成A([开始])，终点使用唯一的“([结束])”节点；主程序流程图表达系统调度，核心功能流程图按共享判断链覆盖一组相关功能，驱动的固定读写步骤优先用正文或一张代表性时序图说明，不能同时生成内容相近的驱动流程图和功能逻辑流程图。主干自上而下，分支在1至2步内汇合，主流程6至9个节点、核心功能5至9个节点，最多2个判断节点，判断分支只用“是/否”等短标签。每个节点使用4至12字短句，不画交叉回线、多个结束节点或无出口分支。通信或严格时序图必须使用flowchart LR，让时间从左向右横向推进，包含开始、发起、应答、数据传输、异常或超时处理和唯一结束节点，禁止使用sequenceDiagram或flowchart TD画成纵向时序。所有Mermaid图禁止subgraph、style、classDef、HTML标签、重复节点和无意义堆叠。
8. 时序图只用于确有通信或严格时序的功能，必须横向绘制。公式只用于真实计算，必须解释变量、单位、参数来源和用途。
9. 表格使用标准Markdown表格，表题“表x-x 表名”单独一行并放在表格之前。每张表最多5列、10行数据；内容较多时必须主动按功能、模块或测试项目拆成多张表，并为每张表补一段承接分析，绝不能输出超长表格后再依赖导出端截断。表格前后必须有实质分析，不能让两张表连续出现。导出端会统一转换为三线表，不要在表格中模拟竖线装饰或合并单元格。
10. 禁止“系统尚未实现”“功能未完成”“受条件限制未测试”等自曝式表述；不得虚构型号、引脚和引用出版信息。
11. 正文必须按论点自然分段，每段只承担一个主要观点，通常控制在120至300个中文字符，单段不得超过380个中文字符；内容转入新的器件、依据、步骤、条件、现象或结论时必须另起一段。段落之间使用一个空行分隔，不得把整节内容写成一块，也不得把每句话机械拆成一段。避免连续重复总结；“本文”“本系统”“该系统”等开头不得机械重复。禁止同义改写前文、重复介绍器件作用、重复解释同一连接或在测试章重述程序流程。
12. 默认硬件事实：除51单片机外，主控按最小系统开发板描述；开发板接收5V DC输入并由板载稳压得到3.3V，各模块共地；凡出现上拉电阻，阻值统一写10 kΩ；TFT屏统一使用1.8寸，不出现2.8寸TFT。PCB按pcbPolicy执行，默认使用嘉立创专业版设计承载或接口板，保留主控开发板；没有依据不编造板层数、尺寸或生产测试结果。用户确认的不同事实优先。
13. 目标有效正文约${target}个中文字符，标题、表格、图位、Mermaid代码和非正文说明不计入有效正文。各章应控制在目标值上下约15%内，信息已经完整时不要继续堆叠背景套话、重复总结或图表来超量扩写。`;
  const userPayload = {
    title: project.title,
    chapter: { id: chapter.id, title: chapter.title, kind: chapter.kind, roles:chapterRoles(chapter), requiredSections: chapter.sections, responsibility: chapterResponsibilities(chapter), targetCharacters: target },
    contentRouting: outline.map(item => ({id:item.id,title:item.title,roles:chapterRoles(item),sections:item.sections})),
    referenceContract:chapterReferenceContract(chapter,effectiveReferenceText(project.paper.materials),project.paper.outlinePlanning?.referenceUsage),
    paperOrganization:hasChapterRole(chapter,'introduction') ? {chapterCount:outline.length,chapters:outline.map(item=>({id:item.id,title:item.title})),instruction:'论文组织结构必须写全这些一级章节，编号和名称均以此为准'} : null,
    pcbPolicy:pcbDesignPolicy(facts,project.paper.materials),
    confirmedFacts: {
      controller: facts.controller,
      devices: devicePlanGroups(facts.devices || [], facts.controller),
      functions: facts.functions,
      pinMappings: facts.mappings,
      powerNotes: facts.powerNotes,
      fixedFacts: facts.fixedFacts,
      connections: project.paper.materials.connectionsText || '未提供',
      testInfo: project.paper.materials.testInfo || '未提供',
      tools: project.paper.materials.toolsText || '未提供',
      sourceCodeSummary: buildSourceCodeExcerpt(project.paper.materials.codeFiles, project.paper.materials.codeText, 26000),
      backgroundDirection: project.paper.materials.sourceBackgroundText || '未提供',
      additionalNotes: project.paper.materials.sourceNotes || '未提供',
    },
    chapterArtifacts,
    deviceSelectionPolicy: selectionChapter(outline)?.id === chapter.id ? {mode:selection.mode,description:selection.description,selectedDevices:selection.devices.map(item=>({model:item.model,role:item.role})),instruction:'仅为清单中的关键器件做选型、器件图和简短对比表；不扩展到全部器件，候选型号不得写进实际器件与后续电路。'} : '本章不重复其他位置的选型论证。',
    references,
    referencePolicy: hasChapterRole(chapter, 'introduction') && references.length
      ? `仅在第一章国内外研究现状中按列表顺序逐篇引用。每篇只引用一次，一句话只放一个编号，不得合并成[1-3]或[1][2]。文末参考文献将按正文首次引用顺序排列。若某篇文献abstract为空，只能依据作者、题名和出版来源保守说明其研究主题或应用方向，禁止写出该文献采用的具体方法、实验数据、性能提升和研究结论。`
      : hasChapterRole(chapter, 'introduction')
        ? '用户关闭或未提供参考文献，本章不得出现引用编号、具名文献综述或文末参考文献条目。国内外现状只做不带具体作者和文献编号的概括分析。'
      : '本章不得出现参考文献编号、作者文献综述或新增文献。',
    completedChapterDigest: completedDigest || '无，当前为第一章',
    output: '只输出本章正文；完整保留requiredSections中的二级和三级标题并按顺序展开，不得删减项目自适应目录；不要重复输出“第x章 章名”一级标题，不要使用#号。',
  };
  return [
    { role: 'system', content: systemPrompt },
    { role: 'system', content: '补充执行规则：选型所在小节仅为选型清单中的关键器件分别生成专用对比表，不得把所有器件塞进一个总表；硬件设计章节每个器件的电路图提示和引脚表之间必须先写一段不少于80字的接口与连接分析；测试章节只写测试方法、量化数据和结果，不生成公式，公式只放在软件设计章节；同型号多路继电器按被控对象分别写作，不能因为型号相同而合并功能、引脚或测试。' },
    { role: 'user', content: JSON.stringify(userPayload, null, 2) },
  ];
}

export function buildExtrasMessages(project) {
  const chapters = activeChapterRecords(project.paper).map(chapter => ({ id: chapter.id, title: chapter.title, content: String(chapter.content || '').slice(0, 12000) }));
  return [
    {
      role: 'system',
      content: `根据论文完整正文生成英文论文题目、中文摘要、英文摘要、中英文关键词和致谢。英文题目必须准确对应中文题目，采用论文标题式自然表达，不添加中文题目中没有的创新或功能。摘要是对整个系统和全文结论的概述，不是章节目录复述，也不展开器件选型、引脚连接、程序步骤和调试过程。中文摘要控制在300至500字，分为2至3个自然段，凝练概括研究背景与目的、总体设计方法、主要功能、验证方式和总体结论。

摘要绝对禁止出现具体器件型号、芯片料号、引脚、寄存器、函数名、阈值、测试次数以及带单位的具体测试数据；STM32F103C8T6、DHT11、ESP-01S等只能概括为“微控制器、传感器、无线通信模块”等类别。不得引用参考文献，不写图表编号，不夸大创新性，不出现“尚未实现、未完成、受条件限制”等表述。英文摘要与中文含义一致并遵守相同禁令。

中文关键词和英文关键词各3至5个，顺序和含义一一对应；中文使用全角分号，英文使用英文分号。致谢自然具体，围绕选题分析、硬件调试、程序验证和论文整理过程表达，不出现任何人名、学校名或单位名，不使用“时光荏苒”等模板开头，不写系统不足。只返回JSON：{"titleEn":"","abstractCn":"","abstractEn":"","keywords":"3至5个中文关键词，以分号分隔","keywordsEn":"3至5个英文关键词，以英文分号分隔","acknowledgment":""}`,
    },
    {
      role: 'system',
      content: '摘要段落规则：中文摘要和英文摘要都必须分为2至3个自然段，段落之间使用空行分隔；每段承担不同信息：研究背景与目的、总体设计与功能、验证结果与结论。不要把摘要写成一个连续大段。',
    },
    { role: 'user', content: JSON.stringify({ title: project.title, chapters }, null, 2) },
  ];
}

export function buildAuditMessages(project) {
  const payload = {
    title: project.title,
    facts: project.paper.factSheet,
    frontMatter: { titleEn: project.paper.titleEn || '', abstractCn: project.paper.abstractCn || '', abstractEn: project.paper.abstractEn || '', keywords: project.paper.keywords || '', keywordsEn: project.paper.keywordsEn || '', acknowledgment: project.paper.acknowledgment || '' },
    referenceRecords: project.paper.referenceRecords || [],
    artifactLedger: project.paper.artifacts || [],
    referenceOutline:effectiveReferenceText(project.paper.materials),
    referenceAdoption:project.paper.outlinePlanning?.referenceUsage || [],
    pcbPolicy:pcbDesignPolicy(project.paper.factSheet,project.paper.materials),
    chapters: activeChapterRecords(project.paper).map(chapter => ({ id: chapter.id, title: chapter.title, content: chapter.content })),
    checks: [
      '硬件型号、接口、引脚和工作逻辑前后一致',
      '不同章节没有大段重复或职责越界',
      '没有重复的二级或三级标题，近似小节已经归纳',
      '正文不存在高相似度段落或同义复述',
      '正文按论点自然分段，通常每段120至300字且没有超过380字的干巴长段，也没有把每句话机械拆段',
      '各章二级和三级标题与项目自适应目录一致，没有漏写目录标题',
      '参考指定的章节方向在对应章节落实，选型没有挪回默认第二章，PCB小节及图位没有被当作不适用删去，第一章沿用参考分组和标题',
      '第一章论文结构安排介绍了最终目录所有一级章节的编号和名称，没有遗漏结论章或额外章节',
      '全部确认功能都恰好被一张核心Mermaid流程图覆盖；共享判断链已经合并，独立逻辑没有因压缩数量而遗漏，也没有为每个功能机械重复画图',
      '系统总体功能框架图只在总体方案章节出现，硬件设计章节没有重复的硬件组成图或框架图',
      '总体方案章节系统总体功能框架图表达硬件组成和信息流，软件设计章节系统软件功能模块图表达程序任务与调用层级，两图节点及连接关系没有同义重复',
      '所有通信或严格时序图都使用flowchart LR按时间从左向右横向展开，没有sequenceDiagram或纵向时序图',
      '测试包含现实的量化数据和不超过5列10行的表格',
      '每张图都按给定图号在对应正文中恰好出现一次“如图x-x所示”，选型位置的器件图也没有漏引',
      '每张表都按给定表号在对应正文中恰好出现一次“如表x-x所示”，表题、表名和数据表一一对应',
      '每个计划公式都按给定编号在对应正文中恰好出现一次“如式（x-x）所示”，公式编号、变量、单位和用途完整',
      '任何两张图、两张表或图表之间都有实质正文段落，不存在连续视觉内容',
      '不同图表和Mermaid图内容不重复，器件图片位于对应器件选型小节，测试章节没有对同一器件、界面或动作状态重复安排展示图',
      '每个流程图均为简洁可复制的Mermaid代码，并包含必要的是/否分支、异常路径或回路线',
      '器件图、电路图、实物图和功能图只保留简短插图提示，没有拍摄或绘制方法',
      '图表预留及说明单独成行，表题在表格之前且表格可转换为三线表',
      '不存在系统未完成或功能缺失式自曝',
      '中文摘要为300至500字并分2至3段，没有具体器件型号、引脚、阈值或测试数据，只对全文进行概述',
      '各目录小节分工清楚，选型、电路、软件、测试不重复；同章合并多种职责时分别放在对应小节',
    ],
  };
  return [
    {
      role: 'system',
      content: `你是单片机本科论文技术一致性审稿人。只检查当前终稿中真实存在且仍未解决的明确问题，不做无目标润色。重点查找跨章重复或同义复述、同章重复段落、器件型号/引脚/接口矛盾、目录漏写、图表公式遗漏、测试数据矛盾和摘要违规。编号、引用次数、题注和表题由本地程序作最终确定性校验，你只判断图表公式是否与本节内容和确认事实相符，不自行重编号。最多返回16个最重要问题。

issues数组只能放入需要修改的缺陷。确认正确、与事实一致、无矛盾、无需修复、已经修复的问题不得写入issues，也不得用blocking或warning表达正向结论；如果没有遗留问题，必须返回空数组。跨章重复、硬件矛盾、连续图表、正文单段超过380字、流程图缺少开始/结束、摘要超出300至500字以及关键图表遗漏必须标为blocking。正文长段修复时只按观点转换处加入空行，不删减技术内容，也不能把每句话机械拆段。能够安全修复时，find必须是待修改章节中唯一出现的完整原文片段，replace应按确认事实修正，不能仅做同义改写。硬件矛盾只能以用户确认事实为准修复；除51单片机外主控按最小系统开发板、5V输入经板载稳压得到3.3V、上拉电阻统一10 kΩ、TFT屏统一1.8寸。禁止修改确认的型号、引脚和功能。无法用唯一片段安全修复时repairable为false，交由后续章节级自动修复。只返回JSON：{"summary":"","issues":[{"chapterId":"3","severity":"blocking|warning","type":"hardware|duplicate|diagram|test|abstract|wording","message":"","repairable":true,"find":"原文唯一片段","replace":"替换文本"}]}`,
    },
    { role: 'user', content: JSON.stringify(payload, null, 2) },
  ];
}
