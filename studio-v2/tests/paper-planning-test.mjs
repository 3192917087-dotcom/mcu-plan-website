import assert from 'node:assert/strict';
import { buildArtifactPlan, buildProjectOutline } from '../prompts.js';

const devices = [
  { id: 'd1', model: 'STM32F103C8T6', role: '主控' },
  { id: 'd2', model: 'DHT11', role: '温湿度传感器' },
  { id: 'd3', model: '0.96寸OLED', role: '屏幕' },
  { id: 'd4', model: '继电器', role: '风扇控制' },
  { id: 'd5', model: 'ESP-01S', role: 'WiFi通信模块' },
];

const cases = [
  {
    name: 'simple',
    functions: [
      { id: 's1', name: '使用DHT11实现温湿度采集' },
      { id: 's2', name: '使用OLED实现温湿度显示' },
    ],
  },
  {
    name: 'medium',
    functions: [
      { id: 'm1', name: '使用DHT11实现温湿度采集' },
      { id: 'm2', name: '使用OLED实现温湿度显示' },
      { id: 'm3', name: '使用蜂鸣器实现温度超限报警' },
      { id: 'm4', name: '使用继电器实现风扇降温控制' },
      { id: 'm5', name: '使用ESP-01S实现远程数据上传' },
      { id: 'm6', name: '使用手机端实现设备状态查看' },
    ],
  },
  {
    name: 'complex',
    functions: [
      { id: 'c1', name: '温湿度采集' }, { id: 'c2', name: 'OLED数据显示' },
      { id: 'c3', name: '烟雾超限蜂鸣报警' }, { id: 'c4', name: '继电器控制风扇降温' },
      { id: 'c5', name: '水泵液位联动控制' }, { id: 'c6', name: '自动照明控制' },
      { id: 'c7', name: '舵机窗户开合控制' }, { id: 'c8', name: 'WiFi远程数据上传' },
      { id: 'c9', name: '手机远程控制设备' },
    ],
  },
];

const summaries = cases.map(testCase => {
  const outline = buildProjectOutline({ title: `${testCase.name}单片机系统`, devices, functions: testCase.functions, targetBodyChars: 15000 });
  assert.equal(outline.reduce((sum, chapter) => sum + chapter.targetCharacters, 0), 15000);
  const softwareTertiaryCount = outline.find(chapter => chapter.kind === 'software').sections.filter(section => /^4\.\d+\.\d+\s+/.test(section)).length;
  assert.ok(softwareTertiaryCount <= 10, `${testCase.name} software outline is too fragmented`);
  const artifacts = buildArtifactPlan({ outline, devices, functions: testCase.functions, mappings: [] });
  const functionalFlows = artifacts.filter(item => item.type === 'flowchart' && item.sourceFactIds.length);
  const resultImages = artifacts.filter(item => item.type === 'result-image');
  const testTables = artifacts.filter(item => item.type === 'test-table');
  const timingDiagrams = artifacts.filter(item => item.type === 'timing');
  timingDiagrams.forEach(item => {
    assert.match(item.instruction, /必须使用flowchart LR/);
    assert.match(item.instruction, /禁止使用sequenceDiagram或flowchart TD/);
  });
  const framework = artifacts.find(item => item.type === 'system-framework');
  const softwareArchitecture = artifacts.find(item => item.type === 'software-architecture');
  assert.match(framework.instruction, /硬件组成、数据方向和控制方向/);
  assert.match(softwareArchitecture.instruction, /程序模块的调用层级/);
  assert.match(softwareArchitecture.instruction, /不得照搬第二章系统总体功能框架图/);
  testCase.functions.forEach(func => {
    assert.equal(functionalFlows.filter(item => item.sourceFactIds.includes(func.id)).length, 1, `${func.id} flow coverage`);
    assert.equal(resultImages.filter(item => item.sourceFactIds.includes(func.id)).length, 1, `${func.id} image coverage`);
    assert.equal(testTables.filter(item => item.sourceFactIds.includes(func.id)).length, 1, `${func.id} test-table coverage`);
  });
  testTables.forEach(item => assert.ok(item.sourceFactIds.length <= 8, `${item.title} must remain short`));
  return { name: testCase.name, functions: testCase.functions.length, functionalFlowcharts: functionalFlows.length, resultImages: resultImages.length, testTables: testTables.length, softwareTertiaryCount };
});

assert.ok(summaries[0].functionalFlowcharts < summaries[1].functionalFlowcharts);
assert.ok(summaries[1].functionalFlowcharts < summaries[2].functionalFlowcharts);
assert.ok(summaries[0].resultImages < summaries[1].resultImages);
assert.ok(summaries[1].resultImages < summaries[2].resultImages);

const structures = [
  '基于单片机的智能鱼缸控制系统', '基于ESP32的居家安全监测系统',
  '基于Arduino的温室环境调节系统', '基于STM32的停车场管理系统',
].map(title => buildProjectOutline({ title, devices, functions: cases[1].functions, targetBodyChars: 15000 }).slice(1, 5).map(chapter => chapter.title).join('|'));
assert.ok(new Set(structures).size >= 2, 'outline variants should differ across project titles');

const stcDevices = [{ id: 'mcu-51', model: 'STC89C52RC', role: '主控单片机' }, { id: 'sensor-1', model: 'DS18B20', role: '温度传感器' }];
const stcOutline = buildProjectOutline({ title: '基于51单片机的温度监测系统', devices: stcDevices, functions: cases[0].functions, targetBodyChars: 15000 });
const stcArtifacts = buildArtifactPlan({ outline: stcOutline, devices: stcDevices, functions: cases[0].functions, mappings: [] });
assert.ok(stcArtifacts.some(item => item.title === '5V系统供电电路图'));
assert.ok(!stcArtifacts.some(item => item.title === '5V输入与3.3V稳压供电电路图'));

console.log(JSON.stringify({ summaries, outlineVariants: new Set(structures).size, status: 'ok' }));
