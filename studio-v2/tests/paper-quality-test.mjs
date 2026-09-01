import assert from 'node:assert/strict';
import {
  mergeFinalQualityIssues,
  isResolvedQualityConclusion,
  synchronizeArtifactPresentation,
  validateArtifactLedger,
} from '../paper-quality.js';

const artifacts = [
  { id: 'fig-2-1', type: 'system-framework', chapterId: '2', figureNumber: '2-1', title: '系统总体功能框架图' },
  { id: 'tab-2-1', type: 'comparison-table', chapterId: '2', tableNumber: '2-1', title: '主控选型对比' },
  { id: 'formula-4-1', type: 'formula', chapterId: '4', formulaNumber: '4-1', title: '温度偏差计算式' },
];

const goodChapters = {
  2: {
    id: '2',
    content: `2.1 系统总体方案

系统由采集、控制和输出三个层次构成，数据流向和执行关系如图2-1所示，主控依据传感信息协调显示与执行模块。

【非正文·Mermaid图：图2-1 系统总体功能框架图】

\`\`\`mermaid
flowchart LR
A[采集层] --> B[主控层]
B --> C[输出层]
\`\`\`

【非正文结束】

图2-1 系统总体功能框架图

在完成总体结构分析后，需要对候选主控的资源条件进行比较。各候选方案的关键差异如表2-1所示，最终选择能够满足接口数量和运算需求的主控。

表2-1 主控选型对比

| 型号 | 接口 | 结论 |
|---|---|---|
| STM32F103C8T6 | 充足 | 选用 |

表中结果说明所选主控能够覆盖当前外设接口。`,
  },
  4: {
    id: '4',
    content: `4.1 控制算法

控制程序先计算温度测量值与设定值之间的偏差，具体关系如式（4-1）所示，该结果用于选择加热或通风分支。

e_T = T_s - T_m    （4-1）

式中，e_T为温度偏差，T_s为温度设定值，T_m为实时测量值。`,
  },
};

assert.deepEqual(validateArtifactLedger({ artifacts, chapters: goodChapters }), []);

const unsynchronized = `系统数据关系见图2-1中所示，另一处仍写成如图2-1所示。

【非正文·插图位置：系统总体功能框架图】

【非正文结束】`;
const synchronized = synchronizeArtifactPresentation(unsynchronized, [artifacts[0]]);
assert.equal((synchronized.match(/如图2-1所示/g) || []).length, 1);
assert.match(synchronized, /另一处仍写成该图/);
assert.match(synchronized, /【非正文·插图位置：图2-1 系统总体功能框架图】/);
assert.equal((synchronized.match(/^图2-1 系统总体功能框架图$/gm) || []).length, 1);
assert.equal(synchronizeArtifactPresentation(synchronized, [artifacts[0]]), synchronized, '同步操作必须可重复执行且不新增题注');

const brokenChapters = structuredClone(goodChapters);
brokenChapters[2].content = brokenChapters[2].content
  .replace('主控依据', '同时见图2-1所示，主控依据')
  .replace('如表2-1所示', '如表所示')
  .replace('\n图2-1 系统总体功能框架图\n', '\n图2-2 系统总体功能框架图\n');
const broken = validateArtifactLedger({ artifacts, chapters: brokenChapters });
assert.ok(broken.some(item => item.id.includes('raw-reference-count-figure:2-1')), '重复图号引用必须被发现');
assert.ok(broken.some(item => item.id.includes('reference-unnumbered-2-table')), '不带编号的表引用必须被发现');
assert.ok(broken.some(item => item.id.includes('figure-caption-figure:2-1')), '错误图题编号必须被发现');

const unplannedChapters = structuredClone(goodChapters);
unplannedChapters[5] = {
  id: '5',
  content: `5.1 测试结果

测试时采用以下计算关系。

P = n / N × 100%    （5-1）

| 项目 | 结果 |
|---|---|
| 采集 | 通过 |`,
};
const unplanned = validateArtifactLedger({ artifacts, chapters: unplannedChapters });
assert.ok(unplanned.some(item => item.id.includes('formula-wrong-chapter-5')), '第五章公式必须被阻止');
assert.ok(unplanned.some(item => item.id.includes('unplanned-formula-5')), '未规划公式必须被发现');
assert.ok(unplanned.some(item => item.id.includes('table-without-caption-5')), '无表题数据表必须被发现');

const merged = mergeFinalQualityIssues(
  [{ chapterId: '2', severity: 'blocking', message: '最终仍存在的问题' }],
  [
    { chapterId: '2', severity: 'blocking', message: '修复前的问题', autoRepaired: true },
    { chapterId: '4', severity: 'warning', message: '等待最终复核', pendingFinalVerification: true },
    { chapterId: '5', severity: 'warning', message: '最终AI提醒' },
    { chapterId: '3', severity: 'blocking', message: 'DHT11 DATA引脚为PA0，此处描述与事实一致，无矛盾。' },
    { chapterId: '3', severity: 'warning', message: '接线描述正确，无需修改。' },
  ],
);
assert.deepEqual(merged.map(item => item.message), ['最终仍存在的问题', '最终AI提醒']);
assert.equal(isResolvedQualityConclusion('ESP-01S使用PA9和PA10，与确认信息一致，未发现矛盾。'), true);
assert.equal(isResolvedQualityConclusion('ESP-01S引脚与确认信息不一致，存在矛盾。'), false);

console.log(JSON.stringify({ artifacts: artifacts.length, brokenIssues: broken.length, unplannedIssues: unplanned.length, status: 'ok' }));
