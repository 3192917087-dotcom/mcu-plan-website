import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import * as Prompts from '../prompts.js';
import { devicePlanGroups, matchesDevice, paperMaterialPreflight } from '../paper-preflight.js';
import { FIGURE_ARTIFACT_TYPES, TABLE_ARTIFACT_TYPES } from '../paper-quality.js';
import { validateMappings } from '../pin-data.js';
import { buildConfirmedWritingBrief, briefInput, inputStamp, validateKimiBrief, buildKimiBriefMessages } from '../kimi-workflow.js';
import { findRoleChapter, hasChapterRole, selectionChapter, effectiveReferenceText } from '../outline-policy.js';

const source = await fs.readFile(new URL('../app.js', import.meta.url), 'utf8');
function extract(name, next) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  const end = source.indexOf(next, start + 1);
  assert.ok(start >= 0 && end > start, name);
  return source.slice(start, end);
}
const devices = [
  ['STM32F103C8T6', '主控'], ['HC-SR04', '超声波测距'], ['MPU6050', '姿态传感'],
  ['DHT11', '温湿度'], ['MQ-2', '烟雾'], ['MQ-3', '酒精'], ['HC-SR501', '人体检测'],
  ['0.96寸OLED', '屏幕'], ['有源蜂鸣器', '声音报警'], ['LED', '灯光报警'],
  ['HC-05', '蓝牙'], ['左右红外传感器', '左侧和右侧障碍物'],
].map(([model, role], i) => ({ id: `device-user-${i + 1}`, model, role }));
devices.push({ id: 'device-ai-9', model: '有源蜂鸣器（SD1209T5-A1）', role: '声音报警' },
  { id: 'device-ai-12', model: '红外避障传感器（左）', role: '检测左侧障碍' },
  { id: 'device-ai-13', model: '红外避障传感器（右）', role: '检测右侧障碍' });
const functions = [
  '采集各传感器数据并进行融合处理', '超声波检测障碍物距离', '姿态检测倾斜或碰撞',
  '监测车内温湿度', '烟雾浓度检测', '酒精浓度检测', '人体红外检测是否有人',
  'OLED显示传感器和预警信息', '蜂鸣器和LED声光报警', '蓝牙发送手机预警信息',
  '定时发送疲劳驾驶提醒', '左右红外传感器检测左右障碍物',
].map((name, i) => ({ id: `function-user-${i + 1}`, name }));
const mappings = [
  ['HC-SR04', 'TRIG', 'PA1'], ['HC-SR04', 'ECHO', 'PA2'],
  ['MPU6050', 'SCL', 'PA5'], ['MPU6050', 'SDA', 'PA6'],
  ['DHT11', 'DATA', 'PA0'], ['MQ-2', 'AO', 'PA4'], ['MQ-3', 'AO', 'PA3'],
  ['HC-SR501', 'OUT', 'PA7'], ['0.96寸OLED', 'SCL', 'PB6'], ['0.96寸OLED', 'SDA', 'PB7'],
  ['有源蜂鸣器（SD1209T5-A1）', 'CTRL', 'PC13'], ['LED', 'CTRL', 'PC14'],
  ['HC-05', 'TX', 'PA10'], ['HC-05', 'RX', 'PA9'],
  ['红外避障传感器（左）', 'OUT-左', 'PB13'], ['红外避障传感器（右）', 'OUT-右', 'PB12'],
].map(([device, signal, pin], i) => ({ id: `mapping-${i}`, device, signal, pin, interfaceType: 'GPIO' }));
function fixture() {
  const facts = { controller: 'STM32F103C8T6', devices: structuredClone(devices), functions: structuredClone(functions), mappings: structuredClone(mappings), analyzedAt: 'yes', confirmedAt: 'yes', conflicts: [], conflictsAcknowledged: true };
  return { title: '基于STM32的行车与驻车安全预警系统', factRevision: 'facts-test', paper: { factSheet: facts, materials: { codeFiles: [], codeText: '', referencesText: '', testInfo: '' },
    outline: Prompts.buildProjectOutline({ devices: facts.devices, functions: facts.functions }), generation: { status: 'failed' }, artifacts: [], chapters: {} } };
}
const unique = values => [...new Set(values.map(String).filter(Boolean))];
function sandbox(project) {
  const ctx = vm.createContext({ project, Prompts, devicePlanGroups, matchesDevice, paperMaterialPreflight, findRoleChapter, hasChapterRole, selectionChapter,effectiveReferenceText,
    FIGURE_ARTIFACT_TYPES, TABLE_ARTIFACT_TYPES, unique, nowIso: () => 'test-time',
    combinedPinIssues: () => validateMappings(project.paper.factSheet.controller, project.paper.factSheet.mappings),
    desiredBodyChars: () => 15000 });
  for (const [name, next] of [
    ['artifactPlanKey', 'function mergeRequiredArtifacts'], ['mergeRequiredArtifacts', 'function normalizeOutlinePlanResult'],
    ['generationArtifactPlanIssues', 'function prepareGenerationArtifacts'], ['preflightPaperGeneration', 'function synchronizeAllArtifactPresentation'],
  ]) vm.runInContext(extract(name, next), ctx);
  return ctx;
}
let passed = 0;
// Exact regression: a generic buzzer and its real part number share one plan,
// while left and right sensors retain their own circuits and correct pins.
{
  const p = fixture(), before = JSON.stringify(p.paper.factSheet), ctx = sandbox(p);
  const artifacts = vm.runInContext('mergeRequiredArtifacts(project.paper.outline, [])', ctx);
  const errors = vm.runInContext('generationArtifactPlanIssues(mergeRequiredArtifacts(project.paper.outline, []))', ctx);
  assert.equal(errors.length, 0, JSON.stringify(errors));
  for (const type of ['circuit', 'pin-table']) {
    const buzzer = artifacts.filter(a => a.type === type && a.sourceFactIds.includes('device-user-9'));
    assert.equal(buzzer.length, 1); assert.ok(buzzer[0].sourceFactIds.includes('device-ai-9'));
    assert.equal(artifacts.filter(a => a.type === type && a.sourceFactIds.includes('device-ai-12')).length, 1);
    assert.equal(artifacts.filter(a => a.type === type && a.sourceFactIds.includes('device-ai-13')).length, 1);
  }
  const left = artifacts.find(a => a.type === 'pin-table' && a.sourceFactIds.includes('device-ai-12'));
  const right = artifacts.find(a => a.type === 'pin-table' && a.sourceFactIds.includes('device-ai-13'));
  assert.ok(left.instruction.includes('PB13') && !left.instruction.includes('PB12'));
  assert.ok(right.instruction.includes('PB12') && !right.instruction.includes('PB13'));
  const report = vm.runInContext('preflightPaperGeneration()', ctx);
  assert.equal(report.issues.length, 0, JSON.stringify(report.issues));
  assert.equal(JSON.stringify(p.paper.factSheet), before, 'do not overwrite confirmed facts'); passed++;
}
// Only merge an unambiguous generic/part-number alias; keep different real parts
// or explicitly different channels/control targets separate.
{
  const groups = devicePlanGroups([
    { id: 'g', model: '有源蜂鸣器' }, { id: 's', model: '有源蜂鸣器(SD1209T5-A1)' },
    { id: 'l', model: '继电器（控制补光灯）' }, { id: 'r', model: '继电器（控制风扇）' },
    { id: 'a', model: '模块（A）' }, { id: 'b', model: '模块（B）' },
  ]);
  assert.equal(groups.length, 5);
  assert.deepEqual(groups[0].sourceFactIds, ['g', 's']);
  assert.equal(devicePlanGroups([{model:'传感器'},{model:'传感器(DHT11)'},{model:'传感器(DHT22)'}]).length, 3);
  assert.equal(devicePlanGroups([{model:'MQ-2'},{model:'MQ 2'}]).length, 1);
  assert.equal(matchesDevice('红外避障传感器（右）', {model:'红外避障传感器（左）'}), false); passed++;
}
// Duplicate descriptions and legacy entries must not lose their original IDs.
{
  const p = fixture();
  p.paper.factSheet.functions.push({id:'duplicate-meaning',name:p.paper.factSheet.functions[0].name});
  const ctx = sandbox(p);
  assert.equal(vm.runInContext('preflightPaperGeneration().issues.length', ctx), 0);
  p.paper.factSheet.functions = ['采集温度', '采集温度', '显示温度'];
  assert.equal(vm.runInContext('preflightPaperGeneration().issues.length', ctx), 0); passed++;
}
// Optional source code, schematics, photos and test data are not prerequisites.
// Required facts and unreadable selected attachments are checked without AI.
{
  const p = fixture();
  assert.equal(paperMaterialPreflight(p).issues.length, 0);
  assert.ok(paperMaterialPreflight(p).assumptions.length >= 2);
  p.paper.materials.codeFiles = [{name:'empty.c',content:''}];
  assert.match(paperMaterialPreflight(p).issues[0].message, /empty.c/);
  p.paper.materials.codeFiles = []; p.paper.factSheet.mappings[0].pin = '待确认';
  assert.ok(paperMaterialPreflight(p).issues.some(i => /尚未确定引脚/.test(i.message)));
  p.paper.factSheet.functions = [];
  assert.ok(paperMaterialPreflight(p).issues.some(i => /功能/.test(i.message)));
  p.paper.factSheet.mappings = [];
  assert.ok(paperMaterialPreflight(p).issues.some(i => /未建立外设引脚/.test(i.message))); passed++;
}
// No paid stages run if required information is missing. The current manuscript
// and failed/resumable state remain untouched.
{
  const p = fixture(); p.paper.factSheet.functions = [];
  const ctx = sandbox(p), steps = [];
  Object.assign(ctx, { requestController: null, setPaperStep: step => steps.push(step), persistProject: async () => {}, toast: text => text,
    callAi: () => { throw new Error('must not spend credits before preflight'); } });
  vm.runInContext(extract('generatePaper', 'function pauseGeneration'), ctx);
  await vm.runInContext('generatePaper()', ctx);
  assert.deepEqual(steps, ['pins']); assert.equal(p.paper.generation.status, 'failed'); passed++;
}
// An auxiliary AI understanding failure uses the full confirmed facts, not an
// exception that aborts thesis generation or a fabricated understanding.
{
  const p = fixture(); const controller = new AbortController();
  const ctx = vm.createContext({ project:p, inputStamp, briefInput, buildKimiBriefMessages, buildConfirmedWritingBrief, validateKimiBrief,
    isKimiWorkflow: () => true, paperApiConfig: () => ({chatModel:'kimi-k3'}), AI_SCHEMAS:{brief:{}},
    saveGenerationCheckpoint: async () => {}, nowIso: () => 'test-time', signal:controller.signal,
    callAi: async () => { throw new Error('transient failure'); } });
  vm.runInContext(extract('prepareKimiWritingBrief', 'async function requestKimiChapterRepair'), ctx);
  await vm.runInContext('prepareKimiWritingBrief(signal)', ctx);
  assert.equal(p.paper.writingBrief.source, 'confirmed-facts');
  assert.deepEqual(validateKimiBrief(p.paper.writingBrief.content, p.paper.factSheet), []);
  assert.deepEqual(p.paper.writingBrief.content.sourceObservations, []);
  controller.abort(new DOMException('用户暂停', 'AbortError')); p.paper.writingBrief = {};
  await assert.rejects(vm.runInContext('prepareKimiWritingBrief(signal)', ctx)); passed++;
}
console.log(JSON.stringify({ scenarios: passed, result: 'passed' }));
