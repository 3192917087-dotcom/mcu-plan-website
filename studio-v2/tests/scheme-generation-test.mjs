import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { buildSchemePolicy, schemeResultIssues } from '../scheme-policy.js';
import { buildSchemeMessages } from '../prompts.js';

const preferences = { controller: 'STM32F103C8T6', display: '0.96寸OLED', cloudPlatforms: [], programmingSoftware: ['Keil 5', 'STM32CubeMX'], appSoftware: [] };
const functions = [
  '使用DHT11采集环境温湿度',
  '使用0.96寸OLED显示环境数据',
  '使用蜂鸣器实现温度超限报警',
  '使用继电器控制风扇自动通风',
  '使用按键设置温度报警阈值',
  '使用按键切换手动和自动模式',
  '使用继电器根据湿度控制加湿器启停',
  '使用EEPROM保存用户设置的报警阈值',
];
function scheme(count = 8) {
  return { title: '基于STM32的环境监测系统', devices: [
    { model: 'STM32F103C8T6', role: '主控' }, { model: 'DHT11', role: '温湿度传感器' },
    { model: '0.96寸OLED', role: '屏幕' }, { model: '蜂鸣器', role: '报警' },
    { model: '继电器', role: '风扇与加湿器控制' }, { model: '按键', role: '操作' }, { model: 'EEPROM', role: '参数存储' },
  ], functions: functions.slice(0, count) };
}
const policy = buildSchemePolicy({ functionCount: 8, preferences });
assert.deepEqual(schemeResultIssues(scheme(), policy), []);
assert.ok(schemeResultIssues(scheme(7), policy).some(issue => issue.includes('恰好8条')));
assert.ok(schemeResultIssues({ ...scheme(), functions: [...functions, '使用RTC进行定时运行'] }, policy).some(issue => issue.includes('恰好8条')));
assert.equal(buildSchemePolicy({ functionCount: 20 }).functionCount, 20);
assert.equal(buildSchemePolicy({ functionCount: 3 }).functionCount, 3);
assert.equal(policy.cloudMode, 'none');
assert.equal(policy.appMode, 'none');
assert.equal(policy.communicationAllowed, false);
assert.ok(schemeResultIssues({ ...scheme(), functions: [...functions.slice(0, 7), '使用ESP-01S与手机直连控制设备，无需云平台'] }, policy).some(issue => issue.includes('手机交互')));

for (const cloudFunction of [
  '使用ESP-01S上传数据至OneNET实现远程查看',
  '使用ESP-01S接入阿里云IoT进行设备状态查询',
  '使用ESP-01S将数据上传云端实现远程监测',
  '使用ESP-01S连接Bemfa进行远程控制',
]) {
  assert.ok(schemeResultIssues({ ...scheme(), functions: [...functions.slice(0, 7), cloudFunction] }, policy).some(issue => issue.includes('未选择云平台')));
}
const cloudPolicy = buildSchemePolicy({ functionCount: 8, preferences: { ...preferences, cloudPlatforms: ['OneNET'] } });
const cloudScheme = { ...scheme(), devices: [...scheme().devices, { model: 'ESP-01S', role: 'WiFi模块' }], functions: [...functions.slice(0, 7), '使用ESP-01S将数据上传到OneNET，实现手机远程查看'] };
assert.deepEqual(schemeResultIssues(cloudScheme, cloudPolicy), []);
assert.ok(schemeResultIssues(scheme(), cloudPolicy).some(issue => issue.includes('OneNET')));
assert.ok(schemeResultIssues({ ...scheme(), functions: [...functions.slice(0, 7), '使用ESP-01S直连控制设备，不接入OneNET'] }, cloudPolicy).some(issue => issue.includes('OneNET')));
assert.ok(schemeResultIssues({ ...cloudScheme, functions: [...functions.slice(0, 7), '使用ESP-01S连接巴法云进行远程控制'] }, cloudPolicy).some(issue => issue.includes('擅自增加')));
assert.ok(schemeResultIssues({ ...cloudScheme, devices: [...cloudScheme.devices, { model: 'OneNET', role: '云平台' }] }, cloudPolicy).some(issue => issue.includes('实体器件')));

for (const model of ['ESP-01S', 'HC-05', 'LoRa无线模块', 'SIM800L', 'W5500']) {
  assert.ok(schemeResultIssues({ ...scheme(), devices: [...scheme().devices, { model, role: '通信模块' }] }, policy).some(issue => issue.includes('额外通信模块')));
}
assert.deepEqual(schemeResultIssues({ ...scheme(), functions: [functions[0], '使用OLED通过I2C读取主控数据并显示', ...functions.slice(2)] }, policy), []);
const espPreferences = { ...preferences, controller: 'ESP32' };
const espLocal = scheme(); espLocal.devices[0] = { model: 'ESP32-WROOM-32', role: '主控' };
const espLocalPolicy = buildSchemePolicy({ functionCount: 8, preferences: espPreferences });
assert.deepEqual(schemeResultIssues(espLocal, espLocalPolicy), []);
assert.ok(schemeResultIssues({ ...espLocal, functions: [...functions.slice(0, 7), '使用ESP32的WiFi实现手机远程控制'] }, espLocalPolicy).some(issue => issue.includes('手机交互')));

const blinkerPolicy = buildSchemePolicy({ functionCount: 8, preferences: { ...preferences, cloudPlatforms: ['点灯科技 Blinker'] } });
const blinkerScheme = { ...cloudScheme, functions: [...functions.slice(0, 7), '使用ESP-01S接入Blinker，将环境参数显示在官方APP并接收风扇控制指令'] };
assert.equal(blinkerPolicy.communicationAllowed, true);
assert.deepEqual(schemeResultIssues(blinkerScheme, blinkerPolicy), []);
assert.ok(schemeResultIssues(blinkerScheme, policy).some(issue => issue.includes('未选择云平台')));
assert.deepEqual(buildSchemePolicy({ preferences, requirements: '云平台用点灯科技blinker' }).cloudPlatforms, ['点灯科技 Blinker']);
assert.deepEqual(schemeResultIssues({ ...scheme(), functions: [...functions.slice(0, 7), '使用继电器实现定时点灯控制'] }, policy), []);

assert.equal(buildSchemePolicy({ preferences, requirements: '需要手机远程查看' }).cloudMode, 'none');
assert.equal(buildSchemePolicy({ preferences, requirements: '需要手机远程查看' }).communicationAllowed, true);
assert.equal(buildSchemePolicy({ preferences, requirements: '不用APP，也不要通信模块' }).communicationAllowed, false);
const explicitAppPolicy = buildSchemePolicy({ functionCount: 8, preferences, requirements: '需要手机APP直连查看' });
assert.equal(explicitAppPolicy.appMode, 'generic');
assert.deepEqual(schemeResultIssues({ ...cloudScheme, functions: [...functions.slice(0, 7), '使用ESP-01S通过手机APP局域网直连实现环境查看，无需云平台'] }, explicitAppPolicy), []);
assert.equal(buildSchemePolicy({ preferences: { ...preferences, appSoftware: ['MIT App Inventor'] }, requirements: '不使用APP' }).appMode, 'none');
assert.equal(buildSchemePolicy({ preferences, requirements: '需要接入云平台' }).cloudMode, 'generic');
assert.deepEqual(buildSchemePolicy({ preferences, requirements: '云平台使用巴法云' }).cloudPlatforms, ['巴法云']);
assert.deepEqual(buildSchemePolicy({ preferences: { ...preferences, cloudPlatforms: ['OneNET'] }, requirements: '云平台使用巴法云' }).cloudPlatforms, ['巴法云']);
assert.equal(buildSchemePolicy({ preferences: { ...preferences, cloudPlatforms: ['OneNET'] }, requirements: '不需要云平台' }).cloudMode, 'none');
assert.equal(buildSchemePolicy({ preferences: { ...preferences, cloudPlatforms: ['OneNET'] }, requirements: '不要OneNET' }).cloudMode, 'none');
assert.deepEqual(buildSchemePolicy({ preferences, requirements: '不用OneNET而使用巴法云' }).cloudPlatforms, ['巴法云']);
assert.equal(buildSchemePolicy({ preferences, requirements: '不使用云平台；需要接入云平台' }).cloudMode, 'generic');
assert.equal(buildSchemePolicy({ preferences, requirements: '需要接入云平台；不使用云平台' }).cloudMode, 'none');
const genericPolicy = buildSchemePolicy({ functionCount: 8, preferences, requirements: '需要接入云平台' });
assert.deepEqual(schemeResultIssues({ ...scheme(), functions: [...functions.slice(0, 7), '使用ESP-01S将数据上传到云平台，实现手机查看'] }, genericPolicy), []);
assert.ok(schemeResultIssues(cloudScheme, genericPolicy).some(issue => issue.includes('擅自增加')));

const wrongController = scheme(); wrongController.devices[0] = { model: 'STC89C52RC', role: '主控' };
assert.ok(schemeResultIssues(wrongController, policy).some(issue => issue.includes('主控必须')));
assert.ok(schemeResultIssues({ ...scheme(), functions: [...functions.slice(0, 7), '使用STC89C52RC执行采集与控制'] }, policy).some(issue => issue.includes('主控不一致')));
assert.equal(buildSchemePolicy({ preferences, requirements: '必须使用STC89C52RC' }).controller, 'STC89C52RC');
assert.equal(buildSchemePolicy({ preferences, requirements: '主控用ESP32，显示屏用LCD1602' }).controller, 'ESP32');
assert.equal(buildSchemePolicy({ preferences, requirements: '不要STC89C52RC' }).controller, 'STM32F103C8T6');
assert.equal(buildSchemePolicy({ preferences, requirements: '不能使用STC89C52RC' }).controller, 'STM32F103C8T6');
assert.equal(buildSchemePolicy({ preferences, requirements: '使用ESP32作为通信模块' }).controller, 'STM32F103C8T6');
assert.equal(buildSchemePolicy({ preferences, requirements: '使用STM32F407ZGT6作为主控' }).controller, 'STM32F407ZGT6');
assert.equal(buildSchemePolicy({ preferences, requirements: '使用STM32F407ZGT6' }).controller, 'STM32F407ZGT6');
assert.equal(buildSchemePolicy({ preferences, requirements: '主控用ESP32，显示屏用LCD1602' }).display, 'LCD1602');
assert.equal(buildSchemePolicy({ preferences, requirements: '不使用屏幕' }).display, 'none');
const noDisplay = buildSchemePolicy({ functionCount: 8, preferences: { ...preferences, display: 'none' } });
assert.ok(schemeResultIssues(scheme(), noDisplay).some(issue => issue.includes('不使用屏幕')));
const driverLabelScheme = scheme(); driverLabelScheme.devices[2].model = '0.96寸OLED（SSD1306）';
assert.deepEqual(schemeResultIssues(driverLabelScheme, policy), []);
const wrongDisplay = scheme(); wrongDisplay.devices[2].model = 'LCD1602';
assert.ok(schemeResultIssues(wrongDisplay, policy).some(issue => issue.includes('屏幕必须')));
assert.ok(schemeResultIssues({ ...scheme(), functions: [functions[0], '使用LCD1602显示环境数据', ...functions.slice(2)] }, policy).some(issue => issue.includes('所选屏幕不一致')));

const appPolicy = buildSchemePolicy({ functionCount: 8, preferences: { ...preferences, appSoftware: ['MIT App Inventor'] } });
assert.ok(schemeResultIssues(scheme(), appPolicy).some(issue => issue.includes('App Inventor')));
assert.deepEqual(schemeResultIssues({ ...scheme(), functions: [...functions.slice(0, 7), '使用MIT App Inventor制作手机端，通过ESP-01S直连实现远程查看'] }, appPolicy), []);
assert.ok(schemeResultIssues({ ...scheme(), functions: [...functions.slice(0, 7), '使用Keil实现程序编译与烧录'] }, policy).some(issue => issue.includes('开发过程')));

const messages = buildSchemeMessages({ title: '环境监测', functionCount: 8, preferences, policy, qualityGuard: '需要修正数量', previousResult: scheme(7) });
assert.deepEqual(JSON.parse(messages[1].content).resolvedConstraints, policy);
assert.equal(JSON.parse(messages[1].content).previousResult.functions.length, 7);
assert.ok(messages[0].content.includes('空选择表示“不使用云平台”'));
assert.ok(messages[0].content.includes('functions必须恰好包含functionCount条'));
assert.ok(messages[0].content.includes('10 kΩ'));
assert.ok(messages[0].content.includes('人体检测类项目的默认器件为“TCRT5000'));
assert.ok(messages[0].content.includes('APP与云平台都未选择'));
assert.ok(messages[0].content.includes('点灯科技 Blinker'));

// 执行真正的生成入口，用模拟模型响应验证校验、重试、保存与按钮恢复。
const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const normalizers = appSource.slice(appSource.indexOf('function sanitizeTechnicalText'), appSource.indexOf('function escapeHtml'));
const generator = appSource.slice(appSource.indexOf('async function generateScheme('), appSource.indexOf('async function copyScheme('));
async function runGeneration(responses, { count = 8, mode = 'custom', selected = preferences, oldScheme = null, requirements = '' } = {}) {
  const requests = [], saves = [], notifications = [];
  const submit = { disabled: false, setAttribute() {}, removeAttribute() {}, textContent: '' };
  const status = {};
  const context = vm.createContext({
    project: { title: '环境监测', scheme: { title: '环境监测', requirements, countMode: mode, functionCount: count, preferences: selected, structured: oldScheme, text: oldScheme ? '原来的方案' : '', status: oldScheme ? 'ready' : 'empty' } },
    requestController: null, requestTask: '', schemeStep: 'input', AbortController,
    buildSchemePolicy, schemeResultIssues, Prompts: { buildSchemeMessages },
    captureScheme() {}, renderSchemePreview() {}, renderScheme() {}, nowIso: () => '2026-10-11',
    qs: () => submit, $: () => status,
    async callAi(messages) { requests.push(JSON.parse(messages[1].content)); return JSON.stringify(responses[Math.min(requests.length - 1, responses.length - 1)]); },
    parseAiJson: async raw => JSON.parse(raw),
    schemeText: result => JSON.stringify(result),
    persistProject: async () => saves.push(context.project.scheme.text),
    toast: (message, kind) => notifications.push({ message, kind }),
  });
  vm.runInContext(normalizers + '\n' + generator, context);
  await context.generateScheme();
  assert.equal(submit.disabled, false);
  assert.equal(context.requestController, null);
  assert.equal(context.requestTask, '');
  return { context, requests, saves, notifications };
}

let run = await runGeneration([scheme(7), scheme(8)]);
assert.equal(run.requests.length, 2);
assert.equal(run.context.project.scheme.structured.functions.length, 8);
assert.equal(run.saves.length, 1);
assert.ok(run.requests[1].previousResult);

const withSupport = scheme(8); withSupport.functions[7] = '使用10 kΩ上拉电阻保证通信稳定';
run = await runGeneration([withSupport, scheme(8)]);
assert.equal(run.requests.length, 2);
assert.equal(run.context.project.scheme.structured.functions.length, 8);
assert.ok(!run.context.project.scheme.structured.functions.some(text => text.includes('上拉')));

run = await runGeneration([cloudScheme, scheme(8)]);
assert.equal(run.requests.length, 2);
assert.ok(!run.context.project.scheme.text.includes('OneNET'));
const redundantModule = { ...scheme(), devices: [...scheme().devices, { model: 'ESP-01S', role: 'WiFi模块' }] };
run = await runGeneration([redundantModule, scheme()]);
assert.equal(run.requests.length, 2);
assert.ok(!run.context.project.scheme.text.includes('ESP-01S'));
run = await runGeneration([blinkerScheme], { selected: { ...preferences, cloudPlatforms: ['点灯科技 Blinker'] } });
assert.equal(run.requests.length, 1);
assert.ok(run.context.project.scheme.text.includes('Blinker'));
run = await runGeneration([wrongController, scheme(8)]);
assert.equal(run.requests.length, 2);
run = await runGeneration([scheme(8), scheme(3)], { count: 3 });
assert.equal(run.context.project.scheme.structured.functions.length, 3);
assert.equal(run.requests.length, 2);
const duplicated = scheme(8); duplicated.functions[7] = duplicated.functions[6];
run = await runGeneration([duplicated, scheme(8)]);
assert.equal(run.requests.length, 2);
assert.equal(run.context.project.scheme.structured.functions.length, 8);
run = await runGeneration([scheme(7)], { oldScheme: scheme(8) });
assert.equal(run.requests.length, 3);
assert.equal(run.saves.length, 0);
assert.equal(run.context.project.scheme.text, '原来的方案');
assert.equal(run.context.project.scheme.structured.functions.length, 8);
assert.equal(run.context.project.scheme.status, 'stale');
assert.ok(run.notifications.some(item => item.kind === 'error' && item.message.includes('恰好8条')));

run = await runGeneration([scheme(8)], { mode: 'random' });
assert.ok(run.requests[0].functionCount >= 5 && run.requests[0].functionCount <= 10);
assert.ok(run.requests.every(request => request.functionCount === run.requests[0].functionCount));

// 空选项在首次显示、取消全选及项目回填后含义保持一致。
const summaryFunction = appSource.slice(appSource.indexOf('function renderMultiSelectSummary('), appSource.indexOf('function schemePreferencesFromForm('));
for (const [type, expected] of [['appSoftware', '不使用'], ['cloudPlatforms', '不使用'], ['programmingSoftware', '自动选择']]) {
  const summary = {};
  const context = vm.createContext({ qsa: () => [], qs: () => summary });
  vm.runInContext(summaryFunction, context);
  context.renderMultiSelectSummary({ dataset: { multiSelect: type } });
  assert.equal(summary.textContent, expected);
}
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
assert.ok(/data-multi-select="appSoftware"[^]*?<strong data-multi-summary>不使用<\/strong>/.test(html));
assert.ok(html.includes('value="点灯科技 Blinker"'));

console.log(JSON.stringify({ status: 'ok', coverage: ['exact-count', 'support-exclusion', 'controller', 'display', 'cloud-opt-in', 'cloud-selection', 'app-selection', 'no-communication-default', 'internal-bus-preserved', 'esp32-controller-preserved', 'blinker', 'empty-selection-labels', 'requirements-priority', 'bounded-repair', 'preserve-old-scheme', 'button-recovery', 'random-count-stability'], paidApiCalls: 0 }));
