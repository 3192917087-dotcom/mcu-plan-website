import assert from 'node:assert/strict';
import { buildArtifactPlan, buildProjectOutline } from '../prompts.js';

const functions = [
  { id: 'f1', name: '使用DHT11实现温湿度采集' },
  { id: 'f2', name: '使用OLED实现温湿度显示' },
  { id: 'f3', name: '使用蜂鸣器实现温度超限报警' },
  { id: 'f4', name: '使用继电器实现风扇降温控制' },
  { id: 'f5', name: '使用ESP-01S实现远程数据上传' },
  { id: 'f6', name: '使用手机端实现设备状态查看' },
];
const devices = [
  { id: 'd1', model: 'STM32F103C8T6', role: '主控' },
  { id: 'd2', model: 'DHT11', role: '温湿度传感器' },
  { id: 'd3', model: '0.96寸OLED', role: '屏幕' },
  { id: 'd4', model: '继电器', role: '风扇控制' },
  { id: 'd5', model: 'ESP-01S', role: 'WiFi通信模块' },
];

const outline = buildProjectOutline({ title: '基于STM32的智能环境监测系统', devices, functions, targetBodyChars: 15000 });
assert.equal(outline.reduce((sum, chapter) => sum + chapter.targetCharacters, 0), 15000);

const artifacts = buildArtifactPlan({ outline, devices, functions, mappings: [] });
const functionalFlows = artifacts.filter(item => item.type === 'flowchart' && item.sourceFactIds.length);
const resultImages = artifacts.filter(item => item.type === 'result-image');
assert.ok(functionalFlows.length >= 1 && functionalFlows.length <= 2);
assert.ok(resultImages.length >= 1 && resultImages.length <= 3);
assert.ok(resultImages.length < functions.length);
functions.forEach(func => {
  assert.ok(functionalFlows.some(item => item.sourceFactIds.includes(func.id)), `${func.id} missing flow group`);
  assert.ok(resultImages.some(item => item.sourceFactIds.includes(func.id)), `${func.id} missing result scene`);
});

const structures = [
  '基于单片机的智能鱼缸控制系统',
  '基于ESP32的居家安全监测系统',
  '基于Arduino的温室环境调节系统',
  '基于STM32的停车场管理系统',
].map(title => buildProjectOutline({ title, devices, functions, targetBodyChars: 15000 }).slice(1, 5).map(chapter => chapter.title).join('|'));
assert.ok(new Set(structures).size >= 2, 'outline variants should differ across project titles');

console.log(JSON.stringify({ target: 15000, functionalFlowcharts: functionalFlows.length, resultImages: resultImages.length, outlineVariants: new Set(structures).size, status: 'ok' }));
