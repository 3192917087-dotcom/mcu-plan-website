import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const port = Number(process.argv[2] || 8767);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
};

function paragraph(label, index) {
  return `${label}的设计以确认后的器件、连接关系和功能目标为依据。系统在运行过程中先完成必要的状态准备，再按照采集、判断、执行和反馈的顺序处理信息。第${index}组分析重点说明数据来源、处理边界和模块之间的配合关系，使相关内容能够与实际制作过程保持一致。针对可能出现的波动，程序采用连续读取和条件判断相结合的方法，只有满足预定条件后才更新输出状态，从而减少瞬时变化造成的误动作。该过程既保留了本科设计所需的实现细节，也避免在不同章节重复介绍相同器件。`;
}

function chapterText(id, title) {
  const section = `${id}.1 ${title}的设计目标`;
  const body = Array.from({ length: 5 }, (_, index) => paragraph(title, index + 1)).join('\n\n');
  if (String(id) === '4') return `${section}\n\n${body}\n\n4.2 主程序设计\n\n主程序按照初始化、数据采集、状态判断、执行控制、显示更新和返回循环的顺序运行，主程序流程如图4-1所示，并在同一循环中处理异常超时。\n\n【非正文·Mermaid流程图：主程序流程图】\n\`\`\`mermaid\nflowchart TD\nA([开始]) --> B[系统初始化]\nB --> C[采集数据]\nC --> D{数据有效}\nD -- 是 --> E[执行控制]\nD -- 否 --> F[异常处理]\nE --> G[更新显示]\nF --> C\nG --> C\n\`\`\`\n【非正文结束】\n\n温湿度采集流程先发送启动信号，等待模块响应，随后读取数据并校验；温湿度采集流程如图4-2所示。\n\n【非正文·Mermaid流程图：温湿度采集流程图】\n\`\`\`mermaid\nflowchart TD\nA([开始]) --> B[发送启动信号]\nB --> C{收到响应}\nC -- 是 --> D[读取数据]\nC -- 否 --> E[超时处理]\nD --> F{校验正确}\nF -- 是 --> G[更新结果]\nF -- 否 --> E\nE --> H([返回])\nG --> H\n\`\`\`\n【非正文结束】\n\n采集值可按平均公式 x=(x1+x2+x3)/3 处理，式中x表示平均值，x1至x3表示三次采样值，单位与传感器输出单位一致，该结果用于阈值判断。`;
  if (String(id) === '5') return `${section}\n\n${body}\n\n5.2 系统功能测试\n\n测试在稳定供电和室内环境下进行，结果见表5-1。\n\n| 测试项目 | 测试条件 | 测试次数 | 平均响应时间/ms | 结论 |\n|---|---|---:|---:|---|\n| 温湿度采集 | 室内稳定环境 | 20 | 820 | 通过 |\n| 自动报警 | 超过设定阈值 | 20 | 160 | 通过 |\n\n测试成功率按P=n/N×100%计算，式中n表示成功次数，N表示总测试次数，单位为百分比；本次20次测试均正确响应，成功率为100%。`;
  return `${section}\n\n${body}`;
}

function mockResponse(messages) {
  const system = String(messages.find(item => item.role === 'system')?.content || '');
  const user = String(messages.findLast(item => item.role === 'user')?.content || '');
  if (system.includes('参考文献筛选员')) {
    let parsed = {};
    try { parsed = JSON.parse(user); } catch {}
    const candidates = parsed.candidateReferences || [];
    const requested = Number(parsed.requestedCount) || 15;
    const targets = parsed.languageTargets || { chinese: Math.round(requested * 0.7), foreign: requested - Math.round(requested * 0.7) };
    const chosen = [
      ...candidates.filter(item => item.language === '中文').slice(0, targets.chinese),
      ...candidates.filter(item => item.language === '外文').slice(0, targets.foreign),
    ];
    candidates.forEach(item => { if (chosen.length < requested && !chosen.some(existing => existing.id === item.id)) chosen.push(item); });
    const selected = chosen.slice(0, requested).map(item => ({
      id: item.id,
      reason: `题名与${parsed.title || '当前课题'}的研究方向相关`,
    }));
    return JSON.stringify({ selected, summary: '已根据题目、器件、功能和出版信息筛选' });
  }
  if (system.includes('硬件事实整理工程师')) {
    return JSON.stringify({
      controller: 'STM32F103C8T6',
      devices: [
        { model: 'STM32F103C8T6', role: '主控', interfaceType: 'GPIO' },
        { model: 'DHT11', role: '温湿度传感器', interfaceType: '1-Wire' },
        { model: '0.96寸OLED', role: '屏幕', interfaceType: 'I2C' },
        { model: '有源蜂鸣器', role: '报警', interfaceType: 'GPIO' },
      ],
      functions: [
        { name: '温湿度采集', deviceModels: ['DHT11'] },
        { name: '环境数据显示', deviceModels: ['0.96寸OLED'] },
        { name: '阈值超限报警', deviceModels: ['有源蜂鸣器'] },
      ],
      mappings: [
        { device: 'DHT11', interfaceType: '1-Wire', signal: 'DATA', pin: 'PA0', alternatives: ['PA1'], busGroup: '', shareAllowed: false },
        { device: '0.96寸OLED', interfaceType: 'I2C', signal: 'SCL', pin: 'PB6', alternatives: ['PB8'], busGroup: 'I2C1', shareAllowed: true },
        { device: '0.96寸OLED', interfaceType: 'I2C', signal: 'SDA', pin: 'PB7', alternatives: ['PB9'], busGroup: 'I2C1', shareAllowed: true },
        { device: '有源蜂鸣器', interfaceType: 'GPIO', signal: 'CTRL', pin: 'PA1', alternatives: ['PA2'], busGroup: '', shareAllowed: false },
      ],
      powerNotes: ['主控使用3.3V供电，外设与主控必须共地。'], fixedFacts: ['OLED采用I2C通信。'], conflicts: [],
    });
  }
  if (system.includes('目录规划专家')) {
    let parsed = {};
    try { parsed = JSON.parse(user); } catch {}
    const facts = parsed.confirmedFacts || {};
    const functions = Array.isArray(facts.functions) ? facts.functions : [];
    const functionTitles = functions.map((item, index) => `${index + 1} ${String(item.name || `功能${index + 1}`).replace(/^使用/, '').slice(0, 20)}`);
    return JSON.stringify({
      summary: '按照已确认器件、功能和引脚生成六章三级目录，同类内容适当归纳且不遗漏已确认功能。',
      chapters: [
        { id: '1', title: '绪论', kind: 'introduction', sections: ['1.1 课题研究背景及意义', '1.2 国内外研究现状', '1.2.1 国内研究现状', '1.2.2 国外研究现状', '1.2.3 国内外研究现状评述', '1.3 主要研究内容', '1.4 论文结构安排'] },
        { id: '2', title: '系统总体方案设计', kind: 'overall', sections: ['2.1 系统需求分析', '2.2 系统总体结构', '2.3 系统工作原理', '2.4 系统器件选型', '2.4.1 主控器件选型', '2.4.2 传感与检测器件选型', '2.4.3 显示、执行与通信器件选型'] },
        { id: '3', title: '系统硬件设计', kind: 'hardware', sections: ['3.1 硬件系统总体设计', '3.2 主控及电源电路设计', '3.3 信息采集电路设计', '3.3.1 温湿度采集接口电路', '3.4 显示与执行电路设计', '3.4.1 显示接口电路', '3.4.2 报警驱动电路'] },
        { id: '4', title: '系统软件设计', kind: 'software', sections: ['4.1 软件总体结构', '4.1.1 软件模块划分与数据流', '4.2 主程序设计', '4.2.1 系统初始化与主循环', '4.3 器件驱动程序设计', '4.3.1 数据采集与显示驱动', '4.4 功能逻辑设计', ...functionTitles.map((title, index) => `4.4.${index + 1} ${title.replace(/^\d+\s+/, '')}逻辑`)] },
        { id: '5', title: '系统调试与功能测试', kind: 'test', sections: ['5.1 调试环境与工具', '5.2 硬件调试', '5.3 软件调试', '5.4 系统功能测试', ...functionTitles.map((title, index) => `5.4.${index + 1} ${title.replace(/^\d+\s+/, '')}功能测试`), '5.5 测试结果分析'] },
        { id: '6', title: '总结与展望', kind: 'conclusion', sections: ['6.1 研究工作总结', '6.2 后续发展展望'] },
      ],
    });
  }
  if (system.includes('方案设计工程师')) return JSON.stringify({ title: '基于STM32的环境监测系统', devices: [{ model: 'STM32F103C8T6', role: '主控' }, { model: 'DHT11', role: '温湿度传感器' }, { model: '0.96寸OLED', role: '屏幕' }], functions: ['使用DHT11实现温湿度采集', '使用0.96寸OLED实现环境数据显示'] });
  if (system.includes('项目资料整理员')) return JSON.stringify({ title: '基于STM32的居家环境监测系统', devices: [{ model: 'STM32F103C8T6', role: '主控' }, { model: 'DHT11', role: '温湿度传感器' }, { model: 'ESP-01S', role: 'WiFi通信模块' }], functions: ['采集室内温湿度数据', '通过ESP-01S实现远程数据上传'], sourceNotes: '编程软件使用Keil 5，云平台采用OneNET。' });
  if (system.includes('生成英文论文题目')) return JSON.stringify({ titleEn: 'Design of an MCU-Based Environmental Monitoring System', abstractCn: '本文围绕单片机环境监测需求，完成硬件连接、程序逻辑和系统测试设计。系统采用传感器采集环境数据，由主控完成判断并驱动显示与报警模块。测试结果表明，各项功能能够按照设定逻辑稳定运行。', abstractEn: 'This paper presents an MCU-based environmental monitoring system. Sensor data are processed by the controller and used for display and alarm control. Test results show that the designed functions operate as expected.', keywords: '单片机；环境监测；传感器；控制系统', keywordsEn: 'microcontroller; environmental monitoring; sensor; control system', acknowledgment: '本次毕业设计的完成离不开学习过程中获得的专业知识和实践训练。通过方案分析、硬件设计、程序整理与系统测试，对单片机系统的开发过程有了更加完整的认识。在此对学习和实践过程中获得的帮助表示诚挚感谢。' });
  if (system.includes('技术一致性审稿人')) return JSON.stringify({ summary: '模拟复核完成', issues: [] });
  if (system.includes('补写编辑')) return Array.from({ length: 6 }, (_, index) => paragraph('补充设计分析', index + 1)).join('\n\n');
  if (system.includes('本科论文章节质量补强编辑') || system.includes('本科论文结构编辑')) {
    let parsed = {};
    try { parsed = JSON.parse(user); } catch {}
    const id = parsed.chapter?.id || '2';
    const content = String(parsed.existingChapter || '');
    const firstHeading = new RegExp(`^(${id}\\.\\d+\\s+[^\\n]+)$`, 'm');
    const revised = content.replace(firstHeading, `$1\n\n${id}.1.1 设计依据与实现边界`).replace(/\n\n(?=[^\n]{80,})/, `\n\n${id}.1.2 模块配合与运行过程\n\n`);
    return revised;
  }
  if (system.includes('本科毕业论文写作者')) {
    let parsed = {};
    try { parsed = JSON.parse(user); } catch {}
    return chapterText(parsed.chapter?.id || '1', parsed.chapter?.title || '章节内容');
  }
  return 'OK';
}

async function handleStatic(request, response) {
  const requested = new URL(request.url, `http://127.0.0.1:${port}`).pathname;
  const relative = requested === '/' ? 'studio-v2/index.html' : decodeURIComponent(requested).replace(/^\/+/, '');
  const target = path.resolve(root, relative);
  if (!target.startsWith(root)) throw new Error('invalid path');
  const info = await stat(target);
  const file = info.isDirectory() ? path.join(target, 'index.html') : target;
  response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  response.end(await readFile(file));
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === 'POST' && request.url === '/mock/chat') {
      let body = '';
      for await (const chunk of request) body += chunk;
      const payload = JSON.parse(body || '{}');
      await new Promise(resolve => setTimeout(resolve, 350));
      const content = mockResponse(payload.messages || []);
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ choices: [{ message: { content } }] }));
      return;
    }
    await handleStatic(request, response);
  } catch (error) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(error.message || 'not found');
  }
});

server.listen(port, '127.0.0.1', () => console.log(`mock server ready at http://127.0.0.1:${port}/studio-v2/`));
