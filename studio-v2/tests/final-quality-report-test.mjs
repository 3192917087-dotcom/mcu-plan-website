import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { inputStamp } from '../kimi-workflow.js';
import { mergeFinalQualityIssues, FIGURE_ARTIFACT_TYPES, TABLE_ARTIFACT_TYPES } from '../paper-quality.js';

const source = await fs.readFile(new URL('../app.js', import.meta.url), 'utf8');
function extract(name) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  const next = source.slice(start + 1).search(/\n(?:async )?function /);
  assert.ok(next >= 0, name);
  return source.slice(start, start + 1 + next);
}
const escapeRegExp = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
let passed = 0;

// A saved report must be rebuilt, not appended, after reload or manuscript changes.
{
  const nodes = new Map();
  const $ = id => {
    if (!nodes.has(id)) nodes.set(id, { textContent: '', innerHTML: '', hidden: false });
    return nodes.get(id);
  };
  const project = { id: 'p1', factRevision: 'f1', paper: {
    generation: { status: 'completed' }, chapters: { 3: { content: '当前正文存在问题' } },
    quality: { checkedAt: 'old-time', issues: [{ message: '修复前的历史问题' }], aiIssues: [
      { chapterId: '3', severity: 'blocking', message: 'AI已修复的问题', autoRepaired: true },
      { chapterId: '5', severity: 'warning', message: '待确认的测试提醒' },
    ] },
  } };
  let scans = 0;
  const sandbox = vm.createContext({ project, inputStamp, mergeFinalQualityIssues, QUALITY_ENGINE_VERSION: 2,
    desiredBodyChars: () => 15000, totalBodyChars: () => 15500, nowIso: () => 'new-time', $, escapeHtml: String,
    localQualityIssues: () => { scans++; return project.paper.chapters[3].content.includes('存在问题')
      ? [{ chapterId: '3', severity: 'blocking', message: '当前仍未解决的问题' }] : []; },
  });
  vm.runInContext(['runLocalQuality', 'qualityReportInputStamp', 'currentQualityReport', 'frontMatterSnapshot', 'renderQuality'].map(extract).join('\n'), sandbox);
  vm.runInContext('renderQuality()', sandbox);
  assert.match($('quality-issues').innerHTML, /当前仍未解决的问题/);
  assert.match($('quality-issues').innerHTML, /待确认的测试提醒/);
  assert.doesNotMatch($('quality-issues').innerHTML, /历史问题|已修复/);
  assert.match($('quality-summary').textContent, /1项重点问题和1项提醒/);
  vm.runInContext('renderQuality()', sandbox);
  assert.equal(scans, 1, '相同稿件无需重复扫描');
  project.paper.chapters[3].content = '问题已修复';
  project.paper.quality.aiIssues = [];
  vm.runInContext('renderQuality()', sandbox);
  assert.equal(scans, 2);
  assert.equal($('quality-summary').textContent, '论文最终检查通过');
  assert.doesNotMatch($('quality-issues').innerHTML, /当前仍未解决的问题|测试提醒/);
  project.paper.quality.aiIssues = [{ chapterId: '3', severity: 'blocking', message: '修改项待复核', pendingFinalVerification: true }];
  vm.runInContext('renderQuality()', sandbox);
  assert.match($('quality-summary').textContent, /最终仍有1项提醒/);
  assert.match($('quality-issues').innerHTML, /修改后尚待最终复核/);
  assert.doesNotMatch($('quality-summary').textContent, /检查通过/);
  passed++;
}

// A failed final audit must retain unresolved findings; a later successful audit replaces them.
{
  let fail = true;
  const project = { paper: { generation: {}, quality: { aiIssues: [{ id: 'old', severity: 'blocking', message: '仍然存在的硬件矛盾' }] } } };
  const sandbox = vm.createContext({ project, inputStamp, mergeFinalQualityIssues,
    Prompts: { buildAuditMessages: () => [] }, paperApiConfig: () => ({ chatModel: 'kimi-k3' }), isKimiWorkflow: () => true,
    buildKimiAuditMessages: () => [], saveGenerationCheckpoint: async () => {}, nowIso: () => 'now', makeId: () => 'audit-failure',
    callAi: async () => { if (fail) throw new Error('请求超时'); return '{}'; }, parseAiJson: async () => ({ issues: [] }),
  });
  vm.runInContext(extract('runFinalAudit'), sandbox);
  await vm.runInContext('runFinalAudit({aborted:false},{publishAsFinal:true})', sandbox);
  assert.equal(project.paper.quality.aiIssues.length, 2);
  assert.equal(project.paper.quality.aiIssues[0].message, '仍然存在的硬件矛盾');
  assert.match(project.paper.quality.aiIssues[1].message, /最终技术复检暂未完成/);
  fail = false;
  await vm.runInContext('runFinalAudit({aborted:false},{publishAsFinal:true})', sandbox);
  assert.equal(project.paper.quality.aiIssues.length, 0, '最终复核通过后不得保留上次失败或已解决的问题');
  passed++;
}

// Neighboring Mermaid diagrams must never be checked as part of the selected diagram.
{
  const sandbox = vm.createContext({ FIGURE_ARTIFACT_TYPES, TABLE_ARTIFACT_TYPES, escapeRegExp });
  vm.runInContext(['artifactAnchorIndex', 'artifactInstructionBlock', 'mermaidFlowIssues', 'mermaidTimingIssues'].map(extract).join('\n'), sandbox);
  const flow = 'flowchart TD\nA([开始]) --> B[开始采集]\nB --> C{有效}\nC -- 是 --> D[本轮通信结束]\nC -- 否 --> D\nD --> Z([结束])';
  const timing = 'flowchart LR\nA([开始]) --> B[主机发起]\nB --> C[从机应答]\nC --> D[传输结束]\nD --> Z([结束])';
  const block = (number, title, code) => `【非正文·Mermaid图：图4-${number} ${title}】\n\n\`\`\`mermaid\n${code}\n\`\`\`\n\n【非正文结束】`;
  sandbox.content = block(1, '功能流程图', flow) + '\n\n正文说明。\n\n' + block(2, '通信时序图', timing);
  sandbox.flowArtifact = { type: 'flowchart', figureNumber: '4-1', title: '功能流程图' };
  sandbox.timingArtifact = { type: 'timing', figureNumber: '4-2', title: '通信时序图' };
  assert.equal(vm.runInContext('mermaidFlowIssues(artifactInstructionBlock(content, flowArtifact)).length', sandbox), 0);
  assert.equal(vm.runInContext('mermaidTimingIssues(artifactInstructionBlock(content, timingArtifact)).length', sandbox), 0);
  sandbox.content = sandbox.content.replace('D --> Z([结束])', 'D --> Z[处理]');
  assert.ok(vm.runInContext('mermaidFlowIssues(artifactInstructionBlock(content, flowArtifact)).some(message => message.includes("开始") && message.includes("结束"))', sandbox), '真正缺少结束节点仍需报告');
  passed++;
}

console.log(JSON.stringify({ scenarios: passed, result: 'passed' }));
