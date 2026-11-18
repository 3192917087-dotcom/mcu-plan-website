import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { buildHardwareMessages, buildChapterMessages } from '../prompts.js';
import { paperMaterialPreflight } from '../paper-preflight.js';
import { compatiblePins } from '../pin-data.js';
import { AI_SCHEMAS } from '../ai-schemas.js';

const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
function extract(name, next) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  const end = source.indexOf(next, start + 1);
  assert.ok(start >= 0 && end > start, `${name} source not found`);
  return source.slice(start, end);
}
const unique = values => [...new Set((values || []).map(String).filter(Boolean))];
const sanitizeTechnicalText = value => String(value || '').trim();
const normalizeBoardProfiles = vm.runInContext(`(${extract('normalizeBoardProfiles', 'function mergeDevelopmentTools')})`, vm.createContext({ unique, sanitizeTechnicalText }));

const materials = {
  schematicFiles: [{ name: '主板.pdf' }, { name: '从板.pdf' }],
  codeFiles: [
    { name: 'main.c', path: 'main/main.c' },
    { name: 'slave.c', path: 'slave/slave.c' },
  ],
};
const devices = [
  { id: 'mcu-main', model: 'STM32F103C8T6', role: '主控' },
  { id: 'mcu-slave', model: 'STM32F103C8T6', role: '从控', boardId: 'board-slave' },
  { id: 'dht11', model: 'DHT11', role: '温湿度传感器' },
];
const functions = [
  { id: 'f-main', name: '主板显示与联动', deviceModels: ['STM32F103C8T6'] },
  { id: 'f-slave', name: '从板采集温湿度', deviceModels: ['DHT11'] },
];
const boards = normalizeBoardProfiles([
  {
    id: 'board-main', name: '主板', role: '主控板', controller: 'STM32F103C8T6',
    schematicFilenames: ['主板.pdf'], programPaths: ['main/main.c'],
    deviceModels: ['STM32F103C8T6'], functionNames: ['主板显示与联动'], communication: ['UART接收从板数据'], notes: '',
  },
  {
    id: 'board-slave', name: '从板', role: '采集板', controller: 'Arduino UNO',
    schematicFilenames: ['从板.pdf'], programPaths: ['slave/slave.c'],
    deviceModels: ['DHT11'], functionNames: ['从板采集温湿度'], communication: ['UART向主板发送数据'], notes: '',
  },
], materials, devices, functions, 'STM32F103C8T6');

assert.equal(boards.length, 2);
assert.equal(boards[0].programPaths[0], 'main/main.c');
assert.equal(boards[1].controller, 'Arduino UNO');
assert.equal(devices.find(item => item.id === 'mcu-slave').boardId, 'board-slave', '同型号从控必须保留显式板卡归属');
assert.equal(devices.find(item => item.model === 'DHT11').boardId, 'board-slave');
assert.deepEqual(functions.find(item => item.id === 'f-slave').boardIds, ['board-slave']);

const pinChoices = vm.runInContext(`(${extract('pinChoices', 'function combinedPinIssues')})`, vm.createContext({
  project: { paper: { factSheet: { controller: 'STM32F103C8T6', boards } } },
  compatiblePins,
  unique,
}));
const slavePins = pinChoices({ boardId: 'board-slave', signal: 'DATA', interfaceType: 'GPIO', alternatives: [], pin: '' });
assert.ok(slavePins.includes('D2'), `从板应使用自身主控引脚能力表：${slavePins.join(',')}`);
assert.ok(!slavePins.includes('PA0'), '从板引脚下拉框不应混入主板STM32引脚');

const project = {
  title: '双板环境监测系统',
  paper: {
    materials: { projectTopology: 'multi', schematicFiles: materials.schematicFiles, schematicText: '主板 从板' },
    factSheet: {
      controller: 'STM32F103C8T6', boards, devices,
      functions: functions.map(item => ({ ...item, boardIds: item.boardIds || [] })),
      mappings: [{ id: 'm1', boardId: 'board-main', device: 'STM32F103C8T6', signal: 'TX', pin: 'PA9' }],
      analyzedAt: 'yes', confirmedAt: 'yes', conflicts: [], conflictsAcknowledged: true,
    },
  },
};
const report = paperMaterialPreflight(project);
assert.ok(!report.issues.some(issue => /至少两块板/.test(issue.message)));
assert.ok(!report.issues.some(issue => /尚未归属/.test(issue.message)));
const programOnlyMulti = {
  title: '双工程项目',
  paper: {
    materials: { projectTopology: 'auto', schematicFiles: [{ name: '总原理图.pdf' }], schematicText: '主控', codeFiles: [{ path: 'main/main.c' }, { path: 'slave/slave.c' }] },
    factSheet: { controller: 'STM32F103C8T6', boards: [{ id: 'board-main', name: '主板', role: '主控板', controller: 'STM32F103C8T6' }], devices, functions, mappings: [], analyzedAt: 'yes', conflicts: [], conflictsAcknowledged: true },
  },
};
assert.ok(paperMaterialPreflight(programOnlyMulti).issues.some(issue => /至少两块板/.test(issue.message)), '两个工程目录也必须触发多板预检');
const ordinaryProject = structuredClone(programOnlyMulti);
ordinaryProject.paper.materials.schematicFiles = [{name:'电源.pdf'}, {name:'外设.pdf'}];
ordinaryProject.paper.materials.codeFiles = [{path:'Core/Src/main.c',content:'MAIN'}, {path:'Drivers/dht11.c',content:'SENSOR'}];
assert.ok(!paperMaterialPreflight(ordinaryProject).issues.some(issue => /至少两块板/.test(issue.message)), 'multiple pages and normal firmware folders do not imply multiple boards');
programOnlyMulti.paper.materials.projectTopology = 'single';
assert.ok(!paperMaterialPreflight(programOnlyMulti).issues.some(issue => /至少两块板/.test(issue.message)), 'explicit single-board selection takes priority over folder labels');

const hardwarePrompt = buildHardwareMessages({ projectTopology: 'multi', schematicFiles: materials.schematicFiles, selectedProgramFiles: materials.codeFiles });
assert.match(hardwarePrompt[0].content, /必须拆分boards/);
assert.match(hardwarePrompt[0].content, /"boardId":"board-main"/);
const chapterPrompt = buildChapterMessages({
  project: { title: '双板环境监测系统', paper: {
    materials: { targetBodyChars: 15000, referencesText: '', sourceNotes: '', connectionsText: '', testInfo: '', toolsText: '', codeFiles: [], codeText: '' },
    factSheet: { controller: 'STM32F103C8T6', boards, devices, functions, mappings: [], powerNotes: [], fixedFacts: [] },
    outlinePlanning: {}, referenceRecords: [],
  } },
  chapter: { id: '3', title: '系统硬件设计', kind: 'hardware', roles: ['hardware'], sections: ['3.1 硬件设计'] }, outline: [], artifacts: [], completedDigest: ''
});
assert.match(chapterPrompt[0].content, /按板卡分别说明/);
assert.ok(AI_SCHEMAS.hardware.properties.boards, '硬件JSON schema必须声明boards');
assert.ok(AI_SCHEMAS.hardware.properties.mappings.items.properties.boardId, '映射schema必须声明boardId');

console.log(JSON.stringify({ result: 'passed', boards: boards.length, pinChecks: slavePins.length }));
