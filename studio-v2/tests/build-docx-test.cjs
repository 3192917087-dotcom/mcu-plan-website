const fs = require('node:fs');
const path = require('node:path');
const JSZip = require('jszip');

globalThis.docx = require('../vendor/docx.umd.js');
require('../docx-export.js');

const outputDir = path.join(__dirname, 'output');
const outputPath = path.join(outputDir, 'wps-style-three-line-table-test.docx');
const schemeOutputPath = path.join(outputDir, 'scheme-real-docx-test.docx');
const longParagraph = Array.from({ length: 7 }, (_, index) => `分段验证第${index + 1}个观点用于说明环境监测系统在数据采集、状态判断、执行控制和结果分析之间的衔接关系，并保证每个观点都具备完整的技术说明和明确的论证边界。`).join('');

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const blob = await globalThis.PaperDocx.buildPaperDocx({
    title: '基于STM32的环境监测系统设计',
    titleEn: 'Design of an MCU-Based Environmental Monitoring System',
    abstractCn: '本文面向室内环境监测需求，设计了由主控、传感器、显示与报警模块构成的单片机系统。系统完成环境数据采集、阈值判断、状态显示和异常报警，并通过测试验证设计逻辑。',
    abstractEn: 'This paper presents an STM32-based indoor environmental monitoring system with sensing, display, threshold control, and alarm functions.',
    keywords: '单片机；环境监测；传感器；控制系统',
    keywordsEn: 'microcontroller; environmental monitoring; sensor; control system',
    chapters: [
      {
        id: '1', title: '绪论', content: '1.1 课题研究背景及意义\n\n室内环境监测是智能控制系统的重要应用方向[1]。\n\n1.2 主要研究内容\n\n本文完成硬件、软件与测试设计。',
      },
      {
        id: '2', title: '系统总体方案设计', content: `2.1 系统总体结构\n\n2.1.1 信息采集层\n\n传感器负责采集环境参数。\n\n2.1.2 控制与输出层\n\n主控完成判断并更新显示和报警状态，系统关系如图2-1所示。\n\n【非正文·插图位置：图2-1 系统总体功能框架图】\n\n【非正文结束】\n\n图2-1 系统总体功能框架图\n\n图示之后结合信息流向说明主控如何接收传感数据，并将判断结果分别送至显示与报警模块，使图形表达与文字分析相互补充。系统量化结果如表2-1所示。\n\n表2-1 系统功能测试结果\n\n| 测试项目 | 测试次数 | 平均响应时间/ms | 结论 |\n|---|---:|---:|---|\n| 数据采集 | 20 | 820 | 通过 |\n| 异常报警 | 20 | 160 | 通过 |\n\n测试结果表明，各功能均能按设定逻辑运行。\n\n${longParagraph}`,
      },
      {
        id: '4', title: '系统软件设计', content: '4.1 软件总体结构\n\n系统软件按照初始化、采集、判断和输出的顺序运行。\n\n4.2 主程序设计\n\n主程序通过循环完成数据采集与状态控制，其执行关系如图4-1所示。\n\n【非正文·Mermaid流程图：图4-1 主程序流程图】\n\n```mermaid\nflowchart TD\nA([开始]) --> B[系统初始化]\nB --> C[采集数据]\nC --> D{数据有效}\nD -- 是 --> E[执行控制]\nD -- 否 --> F[异常处理]\nE --> G([结束])\nF --> G\n```\n\n【非正文结束】\n\n图4-1 主程序流程图\n\n为量化控制偏差，程序采用如式（4-1）所示的差值关系。\n\ne_T = T_s - T_m    （4-1）\n\n式中，e_T为温度偏差，T_s为设定值，T_m为测量值。',
      },
    ],
    references: [{ formatted: '张毅刚. 单片机原理及应用[M]. 北京: 高等教育出版社, 2016.' }],
    acknowledgment: '通过本次设计，对单片机系统的方案分析、硬件连接、程序逻辑和测试过程形成了更加完整的认识。',
  });
  fs.writeFileSync(outputPath, Buffer.from(await blob.arrayBuffer()));
  const zip = await JSZip.loadAsync(fs.readFileSync(outputPath));
  const documentXml = await zip.file('word/document.xml').async('string');
  const stylesXml = await zip.file('word/styles.xml').async('string');
  if (!/REF Ref1/.test(documentXml) || !/SEQ ThesisReference/.test(documentXml) || !/w:bookmarkStart[^>]+w:name="Ref1"/.test(documentXml)) {
    throw new Error('DOCX参考文献交叉引用字段未写入');
  }
  if (!/<w:style[^>]+w:styleId="1"[\s\S]*?<w:name w:val="Normal"\/>/.test(stylesXml)) {
    throw new Error('DOCX没有绑定WPS内置正文样式');
  }
  ['1', '2', '3', '4', '5'].forEach(id => {
    const count = (stylesXml.match(new RegExp(`<w:style[^>]+w:styleId="${id}"`, 'g')) || []).length;
    if (count !== 1) throw new Error(`DOCX内置样式${id}定义数量异常：${count}`);
  });
  if (/w:styleId="(?:Normal|Heading1|Heading2|Heading3|Caption)"/.test(stylesXml)
    || /<w:(?:pStyle|basedOn|next|link)\b[^>]*w:val="(?:Normal|Heading1|Heading2|Heading3|Caption)"/.test(`${stylesXml}\n${documentXml}`)) {
    throw new Error('DOCX仍引用网站自建样式身份，未完全转换为WPS内置样式');
  }
  if (/w:styleId="ThesisBody(?:NoIndent|English)"/.test(stylesXml) || /w:pStyle w:val="ThesisBody(?:NoIndent|English)"/.test(documentXml)) {
    throw new Error('正文仍绑定了自建正文样式，而不是WPS内置正文样式');
  }
  const requiredStyles = [
    ['2', 'heading 1'], ['3', 'heading 2'], ['4', 'heading 3'], ['5', 'caption'],
    ['ThesisTableHeader', '论文表头文字'], ['ThesisTableText', '论文表格文字'], ['ThesisFormula', '论文公式'], ['ThesisReference', '论文参考文献'],
  ];
  requiredStyles.forEach(([id, name]) => {
    const pattern = new RegExp(`<w:style[^>]+w:styleId="${id}"[\\s\\S]*?<w:name w:val="${name}"\\/>`);
    if (!pattern.test(stylesXml)) throw new Error(`DOCX缺少可供WPS修改的${name}样式`);
    if (!new RegExp(`<w:pStyle w:val="${id}"\\/>`).test(documentXml)) throw new Error(`DOCX内容没有绑定${name}样式`);
  });
  const bodyParagraphProperties = [...documentXml.matchAll(/<w:pPr><w:pStyle w:val="1"\/>[\s\S]*?<\/w:pPr>/g)].map(match => match[0]);
  if (!bodyParagraphProperties.length || bodyParagraphProperties.some(value => /<w:(?:spacing|ind|jc)\b/.test(value))) {
    throw new Error('正文段落仍存在会覆盖WPS正文样式的直接段落格式');
  }
  ['2', '3', '4', '5', 'ThesisTableHeader', 'ThesisTableText', 'ThesisFormula'].forEach(id => {
    const properties = [...documentXml.matchAll(new RegExp(`<w:pPr><w:pStyle w:val="${id}"\\/>[\\s\\S]*?<\\/w:pPr>`, 'g'))].map(match => match[0]);
    if (!properties.length || properties.some(value => /<w:(?:spacing|ind|jc)\b/.test(value))) throw new Error(`${id}段落仍存在覆盖WPS样式的直接格式`);
  });
  const splitParagraphs = [...documentXml.matchAll(/<w:p><w:pPr><w:pStyle w:val="1"\/>[\s\S]*?<\/w:p>/g)].filter(match => match[0].includes('分段验证'));
  if (splitParagraphs.length < 2) throw new Error('超长正文没有在导出时按完整语句拆分为多个段落');
  const schemeBlob = await globalThis.PaperDocx.buildSchemeDocx({
    title: '基于STM32的环境监测系统设计',
    devices: [{ model: 'STM32F103C8T6', role: '主控' }, { model: 'DHT11', role: '温湿度传感器' }],
    functions: ['使用DHT11实现温湿度采集', '使用主控实现阈值判断与报警控制'],
  });
  fs.writeFileSync(schemeOutputPath, Buffer.from(await schemeBlob.arrayBuffer()));
  process.stdout.write(JSON.stringify({ paper: outputPath, scheme: schemeOutputPath }));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
