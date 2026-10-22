import { hasChapterRole, chapterProgressLabel, activeChapterRecords, synchronizePaperOrganization } from '../outline-policy.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { inputStamp } from '../kimi-workflow.js';

const source = await fs.readFile(new URL('../app.js', import.meta.url), 'utf8');
function extract(name, next) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  const end = source.indexOf(next, start + 1);
  assert.ok(start >= 0 && end > start, name);
  return source.slice(start, end);
}
function context(additions) {
  return vm.createContext({hasChapterRole,chapterProgressLabel,activeChapterRecords,synchronizePaperOrganization, structuredClone, clone: structuredClone, nowIso: () => 'test-time', unique: values => [...new Set(values)],
    Prompts: { chapterResponsibilities: () => '', buildChapterMessages: () => [], buildAuditMessages: p => [{ content: JSON.stringify(p.paper.chapters) }] },
    normalizeChapterText: text => text, countBodyChars: text => text.length, completedDigest: () => '',
    synchronizeArtifactPresentation: text => text, saveGenerationCheckpoint: async () => {},
    paperWritingMessages: messages => messages, isKimiWorkflow: () => false,
    ...additions });
}
let passed = 0;

// A successful first repair must not short-circuit later chapters.
{
  const repaired = [];
  const sandbox = context({ project: { paper: { generation: {}, outline: [{ id: '3' }, { id: '4' }] } },
    runLocalQuality: () => ({ issues: ['3', '4'].filter(id => !repaired.includes(id)).map(chapterId => ({ severity: 'blocking', chapterId, message: '缺少图表' })) }),
    repairChapterBlockingIssues: async chapter => { repaired.push(chapter.id); return true; } });
  vm.runInContext(extract('autoRepairImportantQuality', 'function renderQuality'), sandbox);
  await vm.runInContext('autoRepairImportantQuality(null)', sandbox);
  assert.deepEqual(repaired, ['3', '4']); passed++;
}

// Raw returned prose must survive pause during the subsequent repair call.
{
  const controller = new AbortController();
  const paper = { generation: {}, chapters: {}, artifacts: [], quality: {} };
  const sandbox = context({ project: { factRevision: 'f1', paper }, signal: controller.signal,
    callAi: async () => '有效正文。'.repeat(160),
    ensureChapterStructureAndArtifacts: async () => { controller.abort(new DOMException('暂停', 'AbortError')); throw controller.signal.reason; } });
  vm.runInContext(extract('generateOneChapter', 'async function expandBodyIfNeeded'), sandbox);
  await assert.rejects(vm.runInContext('generateOneChapter({id:"3",title:"硬件",kind:"hardware"},signal)', sandbox), error => error.name === 'AbortError');
  assert.ok(paper.chapters['3'].content.length >= 700 && paper.chapters['3'].draftComplete);
  assert.equal(paper.chapters['3'].status, 'draft'); passed++;
}

// Resume a completely returned draft by repairing it, without paying to write it again.
{
  let calls = 0;
  const paper = { generation: {}, chapters: { '3': { content: '已保存正文'.repeat(180), inputRevision: 'f1', status: 'draft', draftComplete: true } }, artifacts: [], quality: {} };
  const sandbox = context({ project: { factRevision: 'f1', paper }, signal: new AbortController().signal,
    callAi: async () => { calls++; return ''; }, ensureChapterStructureAndArtifacts: async (chapter, text) => text });
  vm.runInContext(extract('generateOneChapter', 'async function expandBodyIfNeeded'), sandbox);
  await vm.runInContext('generateOneChapter({id:"3",title:"硬件",kind:"hardware"},signal)', sandbox);
  assert.equal(calls, 0); assert.equal(paper.chapters['3'].status, 'complete'); passed++;
}

// An interrupted replacement stream keeps the previous full chapter accessible.
{
  const controller = new AbortController();
  const original = '旧版完整正文'.repeat(160);
  const paper = { generation: {}, chapters: { '3': { content: original, status: 'stale' } }, artifacts: [], quality: {} };
  const sandbox = context({ project: { factRevision: 'f1', paper }, signal: controller.signal, isKimiWorkflow: () => true,
    callAi: async (messages, options) => { await options.onPartial('新版尚未完整返回'); controller.abort(new DOMException('暂停', 'AbortError')); throw controller.signal.reason; } });
  vm.runInContext(extract('generateOneChapter', 'async function expandBodyIfNeeded'), sandbox);
  await assert.rejects(vm.runInContext('generateOneChapter({id:"3",title:"硬件",kind:"hardware"},signal)', sandbox), error => error.name === 'AbortError');
  assert.equal(paper.chapters['3'].content, original); assert.equal(paper.chapters['3'].draftContent, '新版尚未完整返回'); passed++;
}

// Synchronization must not undo a repair that was already advertised as applied.
{
  const original = '原文与图题'.repeat(100);
  const issue = { repairable: true, chapterId: '4', find: '原文与图题'.repeat(100), replace: '修改后的图题'.repeat(100) };
  const sandbox = context({ project: { paper: { chapters: { '4': { content: original } }, artifacts: [] } },
    synchronizeArtifactPresentation: () => original, audit: { issues: [issue] } });
  vm.runInContext(extract('applyAuditRepairs', 'async function runFinalAudit'), sandbox);
  assert.equal(vm.runInContext('applyAuditRepairs(audit)', sandbox), 0); assert.ok(!issue.autoRepaired); passed++;
}

// Rejected chapter-one changes roll back text and citation records as one transaction.
{
  const original = '原文[1]及引用[2]。'.repeat(100);
  const candidate = '改后正文[2]及引用[1]。'.repeat(100);
  const project = { paper: { chapters: { '1': { content: original } }, factSheet: {}, artifacts: [],
    referenceRecords: [{ id: 'a' }, { id: 'b' }], materials: { referencesText: '[1] a\n[2] b' }, quality: {} } };
  const sandbox = context({ project, $: () => null, callAi: async () => candidate,
    localQualityIssues: () => project.paper.chapters['1'].content === original ? [] : [{ severity: 'blocking', chapterId: '1' }],
    synchronizeReferenceOrder: () => { project.paper.referenceRecords.reverse(); project.paper.materials.referencesText = '[1] b\n[2] a'; } });
  vm.runInContext(extract('repairChapterBlockingIssues', 'async function autoRepairImportantQuality'), sandbox);
  const changed = await vm.runInContext('repairChapterBlockingIssues({id:"1",kind:"introduction",sections:[]},["检查"],null)', sandbox);
  assert.equal(changed, false); assert.equal(project.paper.chapters['1'].content, original);
  assert.deepEqual(project.paper.referenceRecords.map(item => item.id), ['a', 'b']);
  assert.equal(project.paper.materials.referencesText, '[1] a\n[2] b'); passed++;
}

// K3 uses exact local patches in the actual repair path instead of full-chapter requests.
{
  let patches = 0;
  const project = { paper: { chapters: { '4': { content: '原文'.repeat(500) } }, factSheet: {}, artifacts: [], quality: {} } };
  const sandbox = context({ project, isKimiWorkflow: () => true,
    requestKimiChapterRepair: async () => { patches++; return '修好正文'.repeat(300); },
    localQualityIssues: () => [], callAi: () => { throw new Error('不应整章重写'); } });
  vm.runInContext(extract('repairChapterBlockingIssues', 'async function autoRepairImportantQuality'), sandbox);
  await vm.runInContext('repairChapterBlockingIssues({id:"4",kind:"software",sections:[]},["问题"],null)', sandbox);
  assert.equal(patches, 1); passed++;
}

// Reuse a review only if the exact manuscript and selected review model are unchanged.
{
  let calls = 0;
  const project = { paper: { generation: {}, quality: {}, chapters: { '3': { content: '第一版' } } } };
  const sandbox = context({ project, inputStamp, isKimiWorkflow: () => true, paperApiConfig: () => ({ chatModel: 'kimi-k3' }),
    buildKimiAuditMessages: p => [{ content: JSON.stringify(p.paper.chapters) }],
    callAi: async () => { calls++; return '{}'; }, parseAiJson: async () => ({ summary: '通过', issues: [] }),
    mergeFinalQualityIssues: (a, b) => b, applyAuditRepairs: () => 0 });
  vm.runInContext(extract('runFinalAudit', 'function tableRowGroups'), sandbox);
  await vm.runInContext('runFinalAudit({aborted:false},{allowRepairs:true})', sandbox);
  await vm.runInContext('runFinalAudit({aborted:false},{publishAsFinal:true})', sandbox);
  assert.equal(calls, 1);
  project.paper.chapters['3'].content = '修改后的第二版';
  await vm.runInContext('runFinalAudit({aborted:false},{publishAsFinal:true})', sandbox);
  assert.equal(calls, 2); passed++;
}

console.log(JSON.stringify({ scenarios: passed, result: 'passed' }));
