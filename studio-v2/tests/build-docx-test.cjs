const fs = require('node:fs');
const path = require('node:path');

globalThis.docx = require('../vendor/docx.umd.js');
require('../docx-export.js');

const outputDir = path.join(__dirname, 'output');
const outputPath = path.join(outputDir, 'wps-style-three-line-table-test.docx');
const schemeOutputPath = path.join(outputDir, 'scheme-real-docx-test.docx');

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
        id: '1', title: '绪论', content: '1.1 课题研究背景及意义\n\n室内环境监测是智能控制系统的重要应用方向。\n\n1.2 主要研究内容\n\n本文完成硬件、软件与测试设计。',
      },
      {
        id: '2', title: '系统总体方案设计', content: '2.1 系统总体结构\n\n2.1.1 信息采集层\n\n传感器负责采集环境参数。\n\n2.1.2 控制与输出层\n\n主控完成判断并更新显示和报警状态，系统关系如图2-1所示。\n\n【非正文·插图位置：系统总体功能框架图】\n\n【非正文结束】\n\n图示之后结合信息流向说明主控如何接收传感数据，并将判断结果分别送至显示与报警模块，使图形表达与文字分析相互补充。\n\n表2-1 系统功能测试结果\n\n| 测试项目 | 测试次数 | 平均响应时间/ms | 结论 |\n|---|---:|---:|---|\n| 数据采集 | 20 | 820 | 通过 |\n| 异常报警 | 20 | 160 | 通过 |\n\n测试结果表明，各功能均能按设定逻辑运行。',
      },
      {
        id: '4', title: '系统软件设计', content: '4.1 软件总体结构\n\n系统软件按照初始化、采集、判断和输出的顺序运行。\n\n4.2 主程序设计\n\n主程序通过循环完成数据采集与状态控制。\n\n【非正文·Mermaid流程图：主程序流程图】\n\n```mermaid\nflowchart TD\nA([开始]) --> B[系统初始化]\nB --> C[采集数据]\nC --> D{数据有效}\nD -- 是 --> E[执行控制]\nD -- 否 --> F[异常处理]\nE --> G[更新显示]\nF --> C\nG --> C\n```\n\n【非正文结束】',
      },
    ],
    references: [{ formatted: '张毅刚. 单片机原理及应用[M]. 北京: 高等教育出版社, 2016.' }],
    acknowledgment: '通过本次设计，对单片机系统的方案分析、硬件连接、程序逻辑和测试过程形成了更加完整的认识。',
  });
  fs.writeFileSync(outputPath, Buffer.from(await blob.arrayBuffer()));
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
