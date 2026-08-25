import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const prompts = await readFile(new URL('../prompts.js', import.meta.url), 'utf8');
const docx = await readFile(new URL('../docx-export.js', import.meta.url), 'utf8');
const referencedIds = [...app.matchAll(/\$\('([^']+)'\)/g)].map(match => match[1]);
const htmlIds = [...html.matchAll(/id="([^"]+)"/g)].map(match => match[1]);
const dynamicIds = new Set(['ack-ai-conflicts']);
const missing = [...new Set(referencedIds.filter(id => !htmlIds.includes(id) && !dynamicIds.has(id)))];
const duplicates = [...new Set(htmlIds.filter((id, index) => htmlIds.indexOf(id) !== index))];
const assertions = [
  ['API无内置Key', /apiKey:\s*''/.test(app) && !/PAGE_CONFIG\.apiKey/.test(app)],
  ['新建项目名称可选', /id="new-project-name"(?![^>]*required)/.test(html)],
  ['屏幕规格统一为1.8寸TFT', html.includes('1.8寸TFT') && !html.includes('2.8寸TFT')],
  ['器件分析使用快速非推��请求', /buildHardwareMessages[\s\S]{0,1200}reasoning:\s*false[\s\S]{0,300}timeoutMs:\s*100000/.test(app)],
  ['空文本与损坏JSON可自动恢复', app.includes('EMPTY_AI_CONTENT') && app.includes('parseAiJson')],
  ['摘要限定300至500字且分段', prompts.includes('300至500字') && prompts.includes('2至3个自然段')],
  ['图表之间要求实质正文', prompts.includes('任意两项视觉内容之间') && prompts.includes('图与图、图与表、表与图、表与表均不得连续出现') && app.includes('consecutiveVisualIssues')],
  ['插图占位与正文区分', prompts.includes('【非正文·插图位置：图名】') && docx.includes("name: '论文插图提示'")],
  ['引脚表不含信号方向列', prompts.includes('外设、外设信号、主控引脚、说明') && prompts.includes('禁止“信号方向”列')],
  ['默认硬件规则完整', prompts.includes('最小系统开发板') && prompts.includes('10 kΩ') && prompts.includes('1.8寸')],
  ['9898中转站专用预设', app.includes('newapi9898') && app.includes('gpt-5.4') && html.includes('9898.ai 中转站（GPT）') && app.includes('https://www.9898.ai/v1')],
];
const failedAssertions = assertions.filter(([, passed]) => !passed).map(([name]) => name);

if (missing.length || duplicates.length || failedAssertions.length) {
  console.error(JSON.stringify({ missing, duplicates, failedAssertions }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ referencedIds: new Set(referencedIds).size, htmlIds: htmlIds.length, assertions: assertions.length, missing, duplicates, failedAssertions }));
}
