export const CHAPTER_TARGETS = Object.freeze({
  introduction: 2800,
  overall: 3200,
  hardware: 4400,
  software: 5000,
  implementation: 7200,
  test: 3300,
  conclusion: 1200,
  requirement: 2600,
});

export const DEFAULT_OUTLINE_ID = 'adaptive6';

const DEFAULT_CHAPTERS = Object.freeze([
  { id: '1', kind: 'introduction', title: '绪论', sections: ['1.1 课题研究背景及意义', '1.2 国内外研究现状', '1.2.1 国内研究现状', '1.2.2 国外研究现状', '1.2.3 国内外研究现状评述', '1.3 主要研究内容', '1.4 论文结构安排'] },
  { id: '2', kind: 'overall', title: '系统总体方案设计', sections: ['2.1 系统需求分析', '2.2 系统总体结构', '2.3 系统工作原理', '2.4 系统器件选型'] },
  { id: '3', kind: 'hardware', title: '系统硬件设计', sections: ['3.1 主控最小系统设计', '3.2 电源及基础电路设计', '3.3 信息采集电路设计', '3.4 输出与执行电路设计', '3.5 显示及通信电路设计'] },
  { id: '4', kind: 'software', title: '系统软件设计', sections: ['4.1 软件总体结构', '4.2 主程序设计', '4.3 信息采集程序设计', '4.4 输出控制程序设计', '4.5 显示及通信程序设计'] },
  { id: '5', kind: 'test', title: '系统调试与功能测试', sections: ['5.1 调试环境与工具', '5.2 硬件调试', '5.3 软件调试', '5.4 系统功能测试', '5.5 系统性能与稳定性测试'] },
  { id: '6', kind: 'conclusion', title: '总结与展望', sections: ['6.1 研究总结', '6.2 后续展望'] },
]);

export const OUTLINE_TEMPLATES = Object.freeze({
  [DEFAULT_OUTLINE_ID]: {
    name: '项目自适应六章目录',
    description: '保持本科论文常用六章结构，并依据当前器件与功能更新三级标题。',
    chapters: DEFAULT_CHAPTERS,
  },
});

function uniqueNames(items = []) {
  const seen = new Set();
  return items.map(item => String(item || '').trim()).filter(Boolean).filter(item => {
    const key = item.replace(/[\s，,。；;、：:（）()“”'"·.]/g, '').toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function functionSource(item) {
  return String(typeof item === 'string' ? item : item?.name || item?.description || '')
    .replace(/^\s*(?:\d+[.、]|[-•])\s*/, '')
    .replace(/[。；;，,\s]+$/g, '')
    .trim();
}

function uniqueFunctions(items = []) {
  const seen = new Set();
  return items.filter(item => {
    const key = functionSource(item).replace(/[\s，,。；;、：:（）()“”'"·.]/g, '').toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function modelName(device) {
  return String(typeof device === 'string' ? device : device?.model || device?.name || '').replace(/[（(].*$/, '').trim();
}

function deviceDescription(device) {
  return `${modelName(device)} ${typeof device === 'object' ? device?.role || device?.interfaceType || '' : device}`.trim();
}

function functionName(item) {
  const source = functionSource(item);
  // 先识别功能的主行为，再识别其中提到的被监测数据，避免“手机查看温湿度”
  // 被误写成“温湿度采集”这类目录标题。
  if (/APP|小程序|手机/.test(source) && /控制|开关/.test(source)) return '移动端远程控制';
  if (/APP|小程序|手机|远程查看/.test(source) && /查看|监测|状态|显示/.test(source)) return '移动端状态监测';
  if (/WiFi|ESP-01S|联网|上传/.test(source)) return '无线联网与数据上传';
  if (/舵机|SG90|窗户/.test(source)) return '窗户开合控制';
  if (/DHT|温湿度/i.test(source)) return /显示|OLED|LCD/.test(source) ? '温湿度采集与显示' : '温湿度采集';
  if (/MQ[-－]?\d*|烟雾|气体/.test(source)) return /报警|蜂鸣/.test(source) ? '烟雾检测与超限报警' : '烟雾浓度检测';
  if (/HC[-－]?SR|人体|红外/.test(source)) return /灯|照明|继电器/.test(source) ? '人体感应照明控制' : '人体活动检测';
  if (/光敏|光照/.test(source)) return /灯|照明|控制/.test(source) ? '光照检测与联动照明' : '环境光照检测';
  if (/各传感器|逻辑控制|综合/.test(source)) return '系统综合控制逻辑';
  const implemented = source.match(/实现([^，,。；;]{2,24})/)?.[1];
  return String(implemented || source.split(/[，,。；;]/)[0] || '功能逻辑').replace(/^使用/, '').slice(0, 28).trim();
}

function classifyDevices(devices = []) {
  const result = { sensors: [], actuators: [], displays: [] };
  devices.forEach(device => {
    const name = modelName(device);
    const description = deviceDescription(device);
    if (!name || /主控|单片机|电源|稳压|晶振|复位|下载|调试/.test(description)) return;
    if (/屏|显示|OLED|LCD|数码管|WiFi|ESP-01S|蓝牙|通信|LoRa|GSM|NB|RFID|云/.test(description)) result.displays.push(name);
    else if (/电机|舵机|继电器|蜂鸣|报警|风扇|加热|制冷|灯|LED|执行|驱动|水泵|阀|道闸/.test(description)) result.actuators.push(name);
    else result.sensors.push(name);
  });
  Object.keys(result).forEach(key => { result[key] = uniqueNames(result[key]); });
  return result;
}

function classifyFunctions(functions = []) {
  const result = { acquisition: [], control: [], communication: [] };
  uniqueFunctions(functions).forEach(item => {
    const source = functionSource(item);
    const name = functionName(item);
    if (/通信|上传|远程|WiFi|蓝牙|云|联网|APP|小程序|数据发送|查询/.test(source)) result.communication.push(name);
    else if (/控制|报警|调节|驱动|执行|道闸|舵机|继电器|风扇|水泵|加热|制冷|照明/.test(source)) result.control.push(name);
    else result.acquisition.push(name);
  });
  Object.keys(result).forEach(key => { result[key] = uniqueNames(result[key]); });
  return result;
}

function tertiary(sectionNumber, titles, suffix) {
  return uniqueNames(titles).map((title, index) => `${sectionNumber}.${index + 1} ${title}${suffix}`);
}

export function assignChapterTargets(chapters = [], targetBodyChars = 18000, context = {}) {
  const target = Math.max(18000, Math.min(40000, Number(targetBodyChars) || 18000));
  const deviceCount = Math.min(12, (context.devices || []).length);
  const functionCount = Math.min(16, (context.functions || []).length);
  const baseWeights = { introduction: 14, overall: 16 + deviceCount * 0.45, hardware: 21 + deviceCount * 0.8, software: 24 + functionCount * 0.85, test: 18 + functionCount * 0.45, conclusion: 7 };
  const minimums = { introduction: 2200, overall: 2400, hardware: 3200, software: 3600, test: 2600, conclusion: 900 };
  const minimumTotal = chapters.reduce((sum, chapter) => sum + (minimums[chapter.kind] || 1800), 0);
  const distributable = Math.max(0, target - minimumTotal);
  const weightTotal = chapters.reduce((sum, chapter) => sum + (baseWeights[chapter.kind] || 10), 0) || 1;
  const planned = chapters.map(chapter => {
    const minimum = minimums[chapter.kind] || 1800;
    const raw = minimum + distributable * (baseWeights[chapter.kind] || 10) / weightTotal;
    return { ...chapter, targetCharacters: Math.max(minimum, Math.round(raw / 100) * 100) };
  });
  const total = planned.reduce((sum, chapter) => sum + chapter.targetCharacters, 0);
  if (planned.length && total !== target) {
    const preferred = planned.find(chapter => chapter.kind === 'software') || planned[planned.length - 1];
    preferred.targetCharacters += target - total;
  }
  return planned;
}

export function buildProjectOutline({ devices = [], functions = [], targetBodyChars = 18000 } = {}) {
  const outline = structuredClone(DEFAULT_CHAPTERS);
  const deviceGroups = classifyDevices(devices);
  const functionGroups = classifyFunctions(functions);
  const overall = outline.find(chapter => chapter.id === '2');
  overall.sections.push('2.4.1 主控器件选型');
  if (deviceGroups.sensors.length) overall.sections.push('2.4.2 传感器与检测器件选型');
  if (deviceGroups.actuators.length || deviceGroups.displays.length) overall.sections.push('2.4.3 执行、显示与通信器件选型');

  const hardware = outline.find(chapter => chapter.id === '3');
  hardware.sections.splice(hardware.sections.indexOf('3.3 信息采集电路设计') + 1, 0, ...tertiary('3.3', deviceGroups.sensors, '接口电路设计'));
  hardware.sections.splice(hardware.sections.indexOf('3.4 输出与执行电路设计') + 1, 0, ...tertiary('3.4', deviceGroups.actuators, '驱动电路设计'));
  hardware.sections.splice(hardware.sections.indexOf('3.5 显示及通信电路设计') + 1, 0, ...tertiary('3.5', deviceGroups.displays, '接口电路设计'));

  const software = outline.find(chapter => chapter.id === '4');
  software.sections.splice(software.sections.indexOf('4.1 软件总体结构') + 1, 0, '4.1.1 软件开发环境与总体架构', '4.1.2 软件任务划分与数据流');
  software.sections.splice(software.sections.indexOf('4.2 主程序设计') + 1, 0, '4.2.1 系统初始化流程', '4.2.2 主循环与异常处理流程');
  software.sections.splice(software.sections.indexOf('4.3 信息采集程序设计') + 1, 0, ...tertiary('4.3', functionGroups.acquisition, '程序设计'));
  software.sections.splice(software.sections.indexOf('4.4 输出控制程序设计') + 1, 0, ...tertiary('4.4', functionGroups.control, '程序设计'));
  software.sections.splice(software.sections.indexOf('4.5 显示及通信程序设计') + 1, 0, ...tertiary('4.5', functionGroups.communication, '程序设计'));

  const test = outline.find(chapter => chapter.id === '5');
  const tests = uniqueNames([...functionGroups.acquisition, ...functionGroups.control, ...functionGroups.communication]);
  test.sections.splice(test.sections.indexOf('5.4 系统功能测试') + 1, 0, ...tertiary('5.4', tests, '功能测试'));
  return assignChapterTargets(outline, targetBodyChars, { devices, functions });
}

export function outlineFor(templateId = DEFAULT_OUTLINE_ID, context = {}) {
  return buildProjectOutline(context);
}

function findChapter(outline, kind) {
  return outline.find(chapter => chapter.kind === kind)
    || (kind === 'hardware' || kind === 'software' ? outline.find(chapter => chapter.kind === 'implementation') : null);
}

function makeArtifact(type, chapter, title, instruction, relatedFunction = '', options = {}) {
  return {
    id: `artifact-${chapter?.id || 'x'}-${type}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    chapterId: chapter?.id || '',
    sectionId: options.sectionId || '',
    title,
    instruction,
    relatedFunction,
    sourceFactIds: uniqueNames(options.sourceFactIds || []),
    reason: options.reason || '',
    required: options.required !== false,
  };
}

export function buildArtifactPlan({ outline = [], devices = [], functions = [] } = {}) {
  const overall = findChapter(outline, 'overall');
  const hardware = findChapter(outline, 'hardware');
  const software = findChapter(outline, 'software');
  const test = findChapter(outline, 'test');
  const distinctFunctions = uniqueFunctions(functions);
  const artifacts = [];
  const controllerDevice = devices.find(device => /主控|单片机/.test(`${device.role || ''} ${device.model || ''}`));
  const controllerName = modelName(controllerDevice) || modelName(devices.find(device => /STM32|STC|AT89|ESP32|Arduino/i.test(modelName(device))));
  const actualDevices = [...devices];
  if (controllerName && !actualDevices.some(device => modelName(device).toLowerCase() === controllerName.toLowerCase())) {
    actualDevices.unshift({ id: `device-controller-${controllerName}`, model: controllerName, role: '主控' });
  }
  const seenDeviceModels = new Set();
  const uniqueDevices = actualDevices.filter(device => {
    const name = modelName(device);
    const key = name.toLowerCase();
    if (!name || seenDeviceModels.has(key)) return false;
    seenDeviceModels.add(key);
    return true;
  });
  const contentDevices = uniqueDevices.filter(device => !/主控|单片机|电源|晶振|复位|下载|调试/.test(`${device.role || ''} ${device.model || ''}`));
  if (overall) {
    artifacts.push(makeArtifact('system-framework', overall, '系统总体功能框架图', '直接生成简洁Mermaid代码，使用flowchart LR，按输入、主控、显示/执行/通信和供电支撑组织5至9个节点；只表达功能层次，不写具体引脚，不与硬件组成图混淆。', '', { sectionId: '2.2', reason: '说明系统各功能模块之间的总体关系' }));
    artifacts.push(makeArtifact('comparison-table', overall, '主要器件选型对比表', '放在各类器件选型分析之后。主控以及每类关键传感、执行、显示和通信器件，都要把实际选用型号与至少2个常见候选型号比较；候选型号只用于选型论证，不能写成系统实际使用器件。使用不超过5列的简洁三线表，器件较多时按类别拆表，每张表只比较与本项目决策有关的核心指标、适用性和选择依据。', '', { sectionId: '2.4', reason: '用候选型号对比证据支撑每类关键器件的选型结论' }));
    uniqueDevices.forEach(device => {
      const name = device.model || device.name;
      artifacts.push(makeArtifact('device-image', overall, `${name}器件图`, `只保留“此处插入${name}器件图”的简短独立提示，不写拍摄、构图、绘制或标注方法。`, '', { sectionId: '2.4', sourceFactIds: [device.id], reason: '帮助读者识别实际选用器件' }));
    });
  }
  if (hardware) {
    artifacts.push(makeArtifact('hardware-block', hardware, '系统硬件组成图', '直接生成简洁Mermaid代码，使用flowchart LR，用5至10个节点表达主控、供电和实际外设之间的物理连接；只标接口类别，不展开程序流程。', '', { sectionId: '3.1', reason: '说明系统硬件的物理组成' }));
    if (contentDevices.length) artifacts.push(makeArtifact('pin-table', hardware, '主要外设引脚连接关系表', '放在各电路详细说明之前，按“外设、外设信号、主控引脚、说明”组织简短三线表，不设置“信号方向”列；每表最多10行，器件较多时按采集、执行、显示通信拆表。', '', { sectionId: '3.1', sourceFactIds: contentDevices.map(device => device.id), reason: '集中核对已确认引脚并减少正文重复' }));
    uniqueDevices.forEach(device => {
      const name = device.model || device.name;
      const title = /主控|单片机/.test(`${device.role || ''} ${name}`) ? `${name}最小系统电路图` : `${name}接口电路图`;
      artifacts.push(makeArtifact('circuit', hardware, title, `只保留“此处插入${title}”的简短独立提示，不写绘制步骤；正文负责说明已确认引脚、供电、共地和必要的10 kΩ上拉关系。`, '', { sourceFactIds: [device.id], reason: '对应说明该器件与主控的实际电气连接' }));
    });
    artifacts.push(makeArtifact('circuit', hardware, '5V输入与3.3V稳压供电电路图', '只保留“此处插入5V输入与3.3V稳压供电电路图”的简短独立提示，不写绘制步骤。', '', { sectionId: '3.2', reason: '说明开发板5V输入和板载3.3V稳压供电关系' }));
  }
  if (software) {
    artifacts.push(makeArtifact('software-architecture', software, '系统软件结构图', '直接生成简洁Mermaid代码，使用flowchart TD，用5至10个节点表达主程序、初始化、采集、控制、显示/通信和异常处理之间的调用关系；不出现硬件接线。', '', { sectionId: '4.1', reason: '说明软件模块和数据流之间的总体关系' }));
    artifacts.push(makeArtifact('flowchart', software, '主程序流程图', '直接给出简洁Mermaid代码，使用flowchart TD，必须有“开始”和“结束”节点；控制在6至10个节点，仅保留初始化、采集、判断、执行、显示/通信更新和异常处理等关键步骤。', '主程序', { sectionId: '4.2', reason: '说明系统软件的主执行顺序' }));
    distinctFunctions.forEach(func => {
      const name = functionSource(func);
      artifacts.push(makeArtifact('flowchart', software, `${name}流程图`, `直接给出简洁Mermaid代码，使用flowchart TD，必须有“开始”和“结束”节点；用5至8个节点表达${name}的输入、处理、关键判断、正常动作和异常路径。`, name, { sourceFactIds: [func.id], reason: '确保每项确认功能都有可直接绘制的软件流程' }));
      if (/温湿度|单总线|DHT|DS18|I2C|SPI|UART|串口|通信|无线|蓝牙|WiFi|射频/i.test(name)) {
        artifacts.push(makeArtifact('timing', software, `${name}通信时序图`, '直接生成简洁Mermaid sequenceDiagram代码，保留参与对象、发起、应答、数据传输、异常或超时和结束，不写逐步绘制说明。', name, { sourceFactIds: [func.id], reason: '说明该功能中通信或严格时序的执行关系' }));
      }
    });
    const calculationFunction = distinctFunctions.find(func => /ADC|模拟|温度|湿度|光照|滤波|平均|阈值|误差|校准|速度|距离|电压|电流/i.test(functionSource(func)));
    if (calculationFunction) {
      const name = functionSource(calculationFunction);
      artifacts.push(makeArtifact('formula', software, `${name}数据处理公式`, '给出真实使用的换算、滤波、阈值或校准公式，并逐一解释变量、单位、参数来源及程序中的使用位置。', name, { sourceFactIds: [calculationFunction.id], reason: '说明软件中确实存在的数据处理关系' }));
    }
  }
  if (test) {
    artifacts.push(makeArtifact('test-table', test, '系统功能测试表', '按功能分组，每表最多5列、10行，表题在表格上方。必须包含测试环境或输入条件、操作步骤、测试次数、量化结果/误差/响应时间和结论；表前说明测试方法，表后分析结果。', '', { sectionId: '5.4', sourceFactIds: distinctFunctions.map(func => func.id), reason: '使用量化数据验证每项确认功能' }));
    artifacts.push(makeArtifact('formula', test, '测试误差或成功率计算公式', '根据项目测试指标选择误差、相对误差、成功率或平均响应时间公式，说明变量、单位和计算结果。', '', { sectionId: '5.5', reason: '为测试数据分析提供可复核的计算依据' }));
    distinctFunctions.forEach(func => {
      const name = functionSource(func);
      artifacts.push(makeArtifact('result-image', test, `${name}功能展示图`, `只保留“此处插入${name}功能展示图”的简短独立提示，不写拍摄、截图或取景方法。`, name, { sourceFactIds: [func.id], reason: '展示该功能在实际操作后的可观察结果' }));
    });
  }
  return artifacts.filter(item => item.chapterId);
}

export function buildSchemeMessages({ title, requirements, functionCount, preferences = {} }) {
  return [
    {
      role: 'system',
      content: `你是单片机项目方案设计工程师。根据题目和用户附加要求输出一份可直接交给制作人员和客户确认的方案。用户附加要求优先级最高，不得被默认方案或常见做法覆盖。方案只包含题目、器件、功能三部分，不出现等级、档次、B级方案、AI、模型、推理过程等字样。

器件格式必须为“准确型号  （简短作用）”，例如“STM32F103C8T6  （主控）”“DHT11  （温湿度传感器）”“0.96寸OLED  （屏幕）”。禁止写成96寸OLED。需要独立WiFi模块时默认且只使用ESP-01S，不得输出ESP8266；如果主控本身已具备WiFi，则不要重复堆叠无线模块。功能格式必须为“使用某器件或技术实现某项功能”，每项功能要具体、可制作、能对应到器件。器件与功能必须闭合，不加入与题目无关的堆料。

默认硬件约定：除51单片机项目外，主控按常用最小系统开发板选用；开发板使用5V DC输入，并通过板载稳压获得3.3V；需要上拉电阻时统一使用10 kΩ。未指定彩屏而项目确需TFT时使用1.8寸TFT，不使用2.8寸TFT。用户附加要求明确给出其他做法时，以用户要求为准。

用户附加要求与下拉选择都属于用户约束；若两者冲突，附加要求优先。主控或屏幕选择为“自动选择”时才由你决定；屏幕选择为“不使用屏幕”时禁止加入屏幕。编程软件、APP设计软件和云平台只在用户已选择或功能确实需要时列入器件/功能闭环，不得擅自虚构用户未选的云平台。软件名称不要混入器件清单，但相关作用要在功能中说明。

只返回JSON：{"title":"题目","devices":[{"model":"型号","role":"作用"}],"functions":["使用……实现……"]}`,
    },
    {
      role: 'user',
      content: JSON.stringify({ title, additionalRequirements: requirements || '无', functionCount: functionCount || '根据题目合理确定', selectedPreferences: preferences }, null, 2),
    },
  ];
}

export function buildSchemeMaterialImportMessages({ rawText, currentTitle = '' }) {
  return [
    {
      role: 'system',
      content: `你是单片机论文项目资料整理员。请从用户粘贴或导入的方案中识别论文题目、器件清单、功能要求和可用于论文写作的补充说明。必须忠实保留方案中明确写出的型号和功能，不要改换主控，不要凭空删除内容；只有缺少作用说明时才根据型号补充简短作用。把同一器件去重，把每项功能整理成一行。任何ESP8266字样统一规范为ESP-01S；0.96寸OLED不得误写成96寸OLED；2.8寸TFT统一规范为1.8寸TFT。

只返回JSON：{"title":"完整题目","devices":[{"model":"准确型号","role":"简短作用"}],"functions":["功能要求"],"sourceNotes":"方案中与软件、云平台、测试、实物、限制条件有关且不适合放入器件或功能字段的补充信息"}`,
    },
    { role: 'user', content: JSON.stringify({ currentTitle, importedSchemeText: String(rawText || '').slice(0, 80000) }, null, 2) },
  ];
}

export function buildHardwareMessages(materials) {
  return [
    {
      role: 'system',
      content: `你是单片机项目硬件事实整理工程师。用户填写内容优先，不能擅自替换。资料只有题目时给出一套常见、真实、适合本科制作的建议；资料部分缺失时只补缺失项。用户不需要预先填写硬件连接关系，你必须先根据器件型号识别通信方式和所需信号，再依据主控资源生成供用户下拉确认的引脚建议。必须识别准确主控型号、外设型号、接口类型和每个接口需要的信号。不要把VCC、GND放入GPIO分配，但必须在powerNotes中说明供电电压和共地关系。需要独立WiFi模块时使用ESP-01S，禁止输出ESP8266；屏幕未明确指定且确需彩屏时使用1.8寸TFT，不使用2.8寸TFT。不要声称项目无法完成。

默认硬件事实必须写入powerNotes或fixedFacts：除STC、AT89等51单片机外，主控视为最小系统开发板；开发板使用5V DC输入，板载稳压得到3.3V，5V外设接5V电源轨，系统所有模块共地；凡使用上拉电阻均统一为10 kΩ。只有用户明确提供不同事实时才按用户事实覆盖这些默认项。

I2C设备列SCL、SDA；UART设备列TX、RX；SPI设备列SCK、MISO、MOSI及每个设备独立CS；模拟传感器列AO/ADC；普通控制列CTRL；有实际需要时列INT、RST、EN。推荐引脚必须考虑主控型号和常见复用关系。I2C等总线可合理共享，并用同一busGroup标识。只返回JSON：
{"controller":"准确主控型号","devices":[{"model":"型号","role":"作用","interfaceType":"GPIO/I2C/UART/SPI/ADC/1-Wire等"}],"functions":[{"name":"功能","deviceModels":["关联器件"]}],"mappings":[{"device":"器件型号","interfaceType":"接口","signal":"SCL等","pin":"PB6","alternatives":["PB8"],"busGroup":"I2C1或空","shareAllowed":true}],"powerNotes":["供电与共地说明"],"fixedFacts":["确定的通信常识"],"conflicts":["仅用户资料明确矛盾时填写"]}`,
    },
    { role: 'user', content: JSON.stringify(materials, null, 2) },
  ];
}

export function buildOutlinePlanMessages({ title, facts, materials, targetBodyChars = 18000, previousPlan = null, validationIssues = [] }) {
  const repairing = Boolean(previousPlan && validationIssues.length);
  const systemPrompt = `你是单片机本科毕业论文的目录规划专家。请根据用户已经确认的器件、功能、引脚、程序资料和参考目录，一次性生成一版可直接用于正文写作的完整三级目录。不要生成图表统计或图表清单，不要提供模板选项，不要输出多个方案。

规划优先级：
1. 用户提供的参考目录只作为学校结构和标题风格的最高优先级参考；若缺少硬件、软件或测试内容，必须补齐。
2. 用户已确认的器件、功能和引脚是不可更改的项目事实。
3. 固定章节职责和避免重复规则不可被参考目录覆盖。

目录必须包含6章：第1章绪论、第2章系统总体方案设计、第3章系统硬件设计、第4章系统软件设计、第5章系统调试与功能测试、第6章总结与展望。目录详略必须服从目标正文总字数：三级标题只在一个二级标题下确实存在多个可独立论述的同类内容时设置，不得按每个器件或每个功能机械拆分；同类型传感、执行、电路、驱动、功能逻辑和测试应归入一个三级标题。每章必须有二级标题，除第一章规定的现状分析外，三级标题不是数量指标，简单项目可以少设：
- 第1章必须且只能设置4个二级标题：1.1课题研究背景及意义、1.2国内外研究现状、1.3主要研究内容、1.4论文结构安排。“主要研究内容”和“论文结构安排”必须分开。1.2必须进一步拆为国内研究现状、国外研究现状、国内外研究现状评述3个三级标题；引用只出现在这些现状小节。
- 第2章写需求、总体结构、工作原理和器件选型。器件选型必须充分对应已确认器件，按主控、传感检测、执行、显示通信等实际类别设置三级标题。正文将对每类实际选用器件与至少2个常见候选型号进行比较，因此目录要为这些对比留下清晰归属，但候选型号不能写成系统实际器件，不写引脚和电路。
- 第3章按实际器件和电路类别设置三级标题，写主控、电源、采集、执行、显示和通信电路，不重复第二章器件参数与选型理由。
- 第4章必须区分软件总体结构、主程序、器件驱动和功能逻辑；每项确认功能都要在合适的三级标题中得到覆盖，同类功能可以归入同一三级标题，但不能漏项。
- 第5章按实际功能类别设置功能测试三级标题，覆盖测试条件、操作、量化数据和结果分析；同类功能可以归纳，但不能漏项。
- 第6章只总结已完成内容和合理展望，不自曝未完成，不强制设置三级标题。

标题禁止使用Markdown井号。章节与标题编号必须连续、父子编号正确、标题语义不重复。只返回JSON：
{"summary":"本目录规划依据","chapters":[{"id":"1","title":"绪论","kind":"introduction","sections":["1.1 课题研究背景及意义","1.2 国内外研究现状","1.2.1 国内研究现状","1.2.2 国外研究现状","1.2.3 国内外研究现状评述","1.3 主要研究内容","1.4 论文结构安排"]},{"id":"2","title":"系统总体方案设计","kind":"overall","sections":["2.1 系统需求分析","2.1.1 项目功能需求"]}]}`;

  const payload = {
    task: repairing ? '修复上一版目录结构，完整返回修复后的JSON' : '生成唯一一版六章三级目录',
    title,
    targetBodyCharacters: Math.max(18000, Math.min(40000, Number(targetBodyChars) || 18000)),
    confirmedFacts: facts,
    userReferenceOutline: String(materials?.outlineReferenceText || '').trim() || '未提供，按六章职责生成',
    sourceCodeFiles: materials?.filenames || [],
    sourceCodeSummary: String(materials?.codeText || '').slice(0, 22000) || '未提供',
    testInformation: String(materials?.testInfo || '').slice(0, 8000) || '未提供',
    otherRequirements: String(materials?.sourceNotes || '').slice(0, 8000) || '未提供',
    ...(repairing ? { validationIssues, previousPlan } : {}),
  };
  return [{ role: 'system', content: systemPrompt }, { role: 'user', content: JSON.stringify(payload, null, 2) }];
}

export function chapterResponsibilities(kind) {
  const map = {
    introduction: '第一章只设四个二级小节：背景意义、国内外研究现状、主要研究内容、论文结构安排。“主要研究内容”和“论文结构安排”必须分别写作；国内外现状使用三级标题展开。器件、电路、程序和测试细节留给后续章节。文献只能在现状分析中依正文首次出现顺序单篇引用，每篇最多引用一次。',
    requirement: '只写功能需求、性能需求与可行性，不提前展开具体电路和程序步骤。',
    overall: '写系统需求、总体结构、工作原理和器件选型。主控以及每类关键传感、执行、显示和通信器件，都必须把实际选用型号与至少2个常见候选型号进行简要比较，再结合项目需求给出选择结论；候选型号只用于论证，不能写成实际器件。用器件图片和分组对比表支撑结论，不展开引脚、电路、驱动程序和测试结果。',
    hardware: '只写主控、电源和各外设电路及实际连接关系。按照目录合理归纳同类电路，说明信号、引脚、供电、共地、10 kΩ上拉或驱动关系，可用不含信号方向列的简短引脚表；除51单片机外主控按最小系统开发板描述，5V输入经板载稳压获得3.3V。每个实际器件都有器件图和对应电路图提示。不得重复第二章的器件参数、候选比较和选型理由，也不能提前写程序流程。',
    software: '只写软件结构、主程序、器件驱动过程和各核心功能逻辑。主程序和每项确认功能必须有简洁、可复制且含“开始”“结束”节点的Mermaid流程图；软件结构图和通信时序也直接使用Mermaid，真实计算才使用公式。不得粘贴程序源代码，不直接用函数名堆叠介绍，也不得重复硬件接线。',
    implementation: '按功能分别写硬件连接与软件逻辑，但同一器件的选型介绍、连接关系和程序过程必须分工清晰，禁止在不同小节重复。',
    test: '写调试工具、操作方法、每个功能的量化测试、功能展示图位置及结果分析。没有用户数据时结合器件能力和现实实验条件保守推定；每项确认功能都要覆盖，必须有数据表格，不提示“模拟数据”，不得重复第四章程序流程。',
    conclusion: '结合题目背景概括已完成工作、主要结果和合理展望。不得自曝系统未完成、功能缺失或使用模板化套话。',
  };
  return map[kind] || '';
}

export function buildChapterMessages({ project, chapter, outline, artifacts, completedDigest }) {
  const chapterArtifacts = artifacts.filter(item => item.chapterId === chapter.id);
  const baseTarget = CHAPTER_TARGETS[chapter.kind] || 3200;
  const tertiaryCount = (chapter.sections || []).filter(section => /^\d+[.．]\d+[.．]\d+\s+/.test(section)).length;
  const plannedTarget = Number(chapter.targetCharacters);
  const target = Math.min(9000, Math.max(900, plannedTarget || (baseTarget + Math.max(0, tertiaryCount - 2) * 320)));
  const references = chapter.kind === 'introduction'
    ? (project.paper.referenceRecords || []).map((reference, index) => ({
        citation: `[${index + 1}]`,
        authors: reference.authors,
        title: reference.title,
        abstract: reference.abstract || '',
        fullPublication: reference.formatted || reference.raw || '',
      }))
    : '本章禁止新增引用';
  const facts = project.paper.factSheet;
  const systemPrompt = `你是单片机方向本科毕业论文写作者。写作水平符合普通本科生，内容具体、自然、严谨，允许适当行业背景和专业套话，但必须围绕题目。不要输出解释、写作计划或质量自评，直接输出本章正文。

通用铁律：
1. 用户确认资料最高优先级；不得改换主控、器件、引脚、接口、功能。
1.1 全文不得出现ESP8266；独立WiFi模块统一写ESP-01S。
2. 遵守章节职责，选型、硬件连接、程序逻辑、测试内容不得跨章重复。同一事实只在最合适的位置详细写一次，其他位置最多用一句承担衔接，不得换词复述。completedChapterDigest中已经出现的参数、原理、步骤、结论和图表不得再次详细展开。
3. 标题必须单独成行且不使用Markdown井号。二级标题严格写成“x.x 标题”，三级标题严格写成“x.x.x 标题”。必须完整保留requiredSections给出的标题并按顺序写作；不得自行增加三级标题。三级标题只承担目录已经确认的分类，不按每个器件、功能或测试项目继续细拆，同类内容在同一标题下用自然段组织。
4. 不插入源代码，不用具体函数名作为主体介绍。
5. 每个chapterArtifacts项目都必须在对应内容之后出现，不能遗漏。器件图、电路图、实物图和功能展示图只使用独占一行的“【非正文·插图位置：图名】”，下一行直接写“【非正文结束】”，不得添加拍摄、取景、构图、绘制步骤或冗长标注说明；该格式是给用户后续插图的醒目占位提示，不属于论文正文，连接依据必须写在正文中。框架图、硬件组成图、软件结构图、程序流程图和通信时序图直接给出第7条规定的Mermaid代码，不写逐节点绘制说明。comparison-table、pin-table和test-table必须直接生成可用的Markdown表格；pin-table只设“外设、外设信号、主控引脚、说明”，禁止“信号方向”列。formula必须直接写出公式并解释变量、单位、参数来源和用途。所有非正文提示前后各空一行，绝不能接在正文句末。图形首次引用必须融入有分析内容的正文句子，禁止把“如图x-x所示。”单独成段，同一图只引用一次。
5.1 任意两项视觉内容之间都必须有至少一个不少于80字的实质正文段落。图与图、图与表、表与图、表与表均不得连续出现；中间段落需要分析前一项内容并自然引出后一项，不能只写“如下图/表所示”等过渡句。
6. 系统功能框架图、硬件组成图、电路图、软件结构图和程序流程图必须名称与内容明确区分。
7. 框架图、结构图、流程图和时序图固定使用独占一行的“【非正文·Mermaid图：图名】”，下一行用三个反引号加mermaid开启代码围栏，末尾关闭代码围栏，再单独写“【非正文结束】”。框架图和结构图使用flowchart LR或flowchart TD并控制在10个节点以内；主程序和每个核心功能流程图必须使用flowchart TD，必须同时包含文字为“开始”和“结束”的节点，主流程6至10个节点、单项功能5至8个节点，判断分支只用“是/否”等短标签；通信时序使用sequenceDiagram。禁止subgraph、style、classDef、HTML标签、重复节点和无意义堆叠。
8. 时序图只用于确有通信或严格时序的功能。公式只用于真实计算，必须解释变量、单位、参数来源和用途。
9. 表格使用标准Markdown表格，表题“表x-x 表名”单独一行并放在表格之前。表格最多5列、10行；内容较多时按功能或模块拆表。表格前后必须有实质分析，不能让两张表连续出现。导出端会统一转换为三线表，不要在表格中模拟竖线装饰或合并单元格。
10. 禁止“系统尚未实现”“功能未完成”“受条件限制未测试”等自曝式表述；不得虚构型号、引脚和引用出版信息。
11. 每段提出一个明确观点，避免连续重复总结；“本文”“本系统”“该系统”等开头不得机械重复。禁止同义改写前文、重复介绍器件作用、重复解释同一连接或在测试章重述程序流程。
12. 默认硬件事实：除51单片机外，主控按最小系统开发板描述；开发板接收5V DC输入并由板载稳压得到3.3V，各模块共地；凡出现上拉电阻，阻值统一写10 kΩ；TFT屏统一使用1.8寸，不出现2.8寸TFT。用户确认的不同事实优先。
13. 目标有效正文约${target}个中文字符，不用标题、表格、图位和非正文说明凑字数。`;
  const userPayload = {
    title: project.title,
    chapter: { id: chapter.id, title: chapter.title, kind: chapter.kind, requiredSections: chapter.sections, responsibility: chapterResponsibilities(chapter.kind), targetCharacters: target },
    confirmedFacts: {
      controller: facts.controller,
      devices: facts.devices,
      functions: facts.functions,
      pinMappings: facts.mappings,
      powerNotes: facts.powerNotes,
      fixedFacts: facts.fixedFacts,
      connections: project.paper.materials.connectionsText || '未提供',
      testInfo: project.paper.materials.testInfo || '未提供',
      tools: project.paper.materials.toolsText || '未提供',
      sourceCodeSummary: String(project.paper.materials.codeText || '未提供').slice(0, 26000),
      additionalNotes: project.paper.materials.sourceNotes || '未提供',
    },
    chapterArtifacts,
    deviceSelectionPolicy: chapter.kind === 'overall' ? '主控以及每类关键外设都要把实际选用型号与至少2个常见候选型号比较，比较指标必须服务本项目需求。候选器件只能出现在选型论证和对比表中，不得混入实际器件清单或后续接线、程序、测试描述。器件类别较多时拆成多张不超过5列的三线表。' : '本章不新增候选器件。',
    references,
    referencePolicy: chapter.kind === 'introduction'
      ? `仅在第一章国内外研究现状中按列表顺序逐篇引用。每篇只引用一次，一句话只放一个编号，不得合并成[1-3]或[1][2]。文末参考文献将按正文首次引用顺序排列。`
      : '本章不得出现参考文献编号、作者文献综述或新增文献。',
    completedChapterDigest: completedDigest || '无，当前为第一章',
    output: '只输出本章正文；完整保留requiredSections中的二级和三级标题并按顺序展开，不得删减项目自适应目录；不要重复输出“第x章 章名”一级标题，不要使用#号。',
  };
  return [{ role: 'system', content: systemPrompt }, { role: 'user', content: JSON.stringify(userPayload, null, 2) }];
}

export function buildExtrasMessages(project) {
  const chapters = Object.values(project.paper.chapters).map(chapter => ({ id: chapter.id, title: chapter.title, content: String(chapter.content || '').slice(0, 12000) }));
  return [
    {
      role: 'system',
      content: `根据论文完整正文生成英文论文题目、中文摘要、英文摘要、中英文关键词和致谢。英文题目必须准确对应中文题目，采用论文标题式自然表达，不添加中文题目中没有的创新或功能。摘要是对整个系统和全文结论的概述，不是章节目录复述，也不展开器件选型、引脚连接、程序步骤和调试过程。中文摘要控制在300至500字，分为2至3个自然段，凝练概括研究背景与目的、总体设计方法、主要功能、验证方式和总体结论。

摘要绝对禁止出现具体器件型号、芯片料号、引脚、寄存器、函数名、阈值、测试次数以及带单位的具体测试数据；STM32F103C8T6、DHT11、ESP-01S等只能概括为“微控制器、传感器、无线通信模块”等类别。不得引用参考文献，不写图表编号，不夸大创新性，不出现“尚未实现、未完成、受条件限制”等表述。英文摘要与中文含义一致并遵守相同禁令。

中文关键词和英文关键词各3至5个，顺序和含义一一对应；中文使用全角分号，英文使用英文分号。致谢自然具体，围绕选题分析、硬件调试、程序验证和论文整理过程表达，不出现任何人名、学校名或单位名，不使用“时光荏苒”等模板开头，不写系统不足。只返回JSON：{"titleEn":"","abstractCn":"","abstractEn":"","keywords":"3至5个中文关键词，以分号分隔","keywordsEn":"3至5个英文关键词，以英文分号分隔","acknowledgment":""}`,
    },
    { role: 'user', content: JSON.stringify({ title: project.title, chapters }, null, 2) },
  ];
}

export function buildAuditMessages(project) {
  const payload = {
    title: project.title,
    facts: project.paper.factSheet,
    chapters: Object.values(project.paper.chapters).map(chapter => ({ id: chapter.id, title: chapter.title, content: chapter.content })),
    checks: [
      '硬件型号、接口、引脚和工作逻辑前后一致',
      '不同章节没有大段重复或职责越界',
      '各章二级和三级标题与项目自适应目录一致，没有漏写目录标题',
      '每个确认功能都有简洁、可复制且语法完整的Mermaid流程图',
      '框架图、硬件组成图、电路图、软件结构图已区分',
      '测试包含现实的量化数据和不超过5列10行的表格',
      '同一图仅首次引用且“如图所示”融入正文',
      '任何两张图、两张表或图表之间都有实质正文段落，不存在连续视觉内容',
      '每个流程图均为简洁可复制的Mermaid代码，并包含必要的是/否分支、异常路径或回路线',
      '器件图、电路图、实物图和功能图只保留简短插图提示，没有拍摄或绘制方法',
      '图表预留及说明单独成行，表题在表格之前且表格可转换为三线表',
      '不存在系统未完成或功能缺失式自曝',
      '中文摘要为300至500字并分2至3段，没有具体器件型号、引脚、阈值或测试数据，只对全文进行概述',
      '第二章没有电路接线，第三章没有重复器件选型，第四章没有重复硬件接线，第五章没有重述程序流程',
    ],
  };
  return [
    {
      role: 'system',
      content: `你是单片机本科论文技术一致性审稿人。只检查明确问题，不做无目标润色。重点查找跨章重复或同义复述、同章重复段落、器件型号/引脚/接口矛盾、目录漏写、图表遗漏、测试数据矛盾和摘要违规。最多返回16个最重要问题。

跨章重复、硬件矛盾、连续图表、流程图缺少开始/结束、摘要超出300至500字以及关键图表遗漏必须标为blocking。能够安全修复时，find必须是待修改章节中唯一出现的完整原文片段，replace应按确认事实修正，不能仅做同义改写。硬件矛盾只能以用户确认事实为准修复；除51单片机外主控按最小系统开发板、5V输入经板载稳压得到3.3V、上拉电阻统一10 kΩ、TFT屏统一1.8寸。禁止修改确认的型号、引脚和功能。无法用唯一片段安全修复时repairable为false，交由后续章节级自动修复。只返回JSON：{"summary":"","issues":[{"chapterId":"3","severity":"blocking|warning","type":"hardware|duplicate|diagram|test|abstract|wording","message":"","repairable":true,"find":"原文唯一片段","replace":"替换文本"}]}`,
    },
    { role: 'user', content: JSON.stringify(payload, null, 2) },
  ];
}
