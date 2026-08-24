/**
 * MCU Paper Studio - content rules and deterministic validators.
 *
 * This module deliberately contains no DOM, storage, network or model calls.
 * UI code can use it in a browser as an ES module and keep AI generation
 * separate from checks that are deterministic.
 */

export const RULES_VERSION = '1.4.2';
export const MIN_FINAL_BODY_CHARS = 18000;

export const SCHEME_LEVELS = Object.freeze({
  A: Object.freeze({ minFunctions: 10, maxFunctions: 15, description: '复杂，包含云平台或 WiFi/APP 通信' }),
  B: Object.freeze({ minFunctions: 7, maxFunctions: 10, description: '中等，包含无线通信' }),
  C: Object.freeze({ minFunctions: 3, maxFunctions: Infinity, description: '基础，无强制通信要求' }),
});

export const SCHEME_IRON_RULES = Object.freeze([
  Object.freeze({ id: 'no-4g', pattern: /(?:SIM7600|\b4G\b)/i, suggestion: 'ESP-01S WiFi', reason: '默认方案优先低成本、免 SIM 卡' }),
  Object.freeze({ id: 'no-mmwave', pattern: /LD2410|毫米波/i, suggestion: 'HC-SR501', reason: '默认人体检测采用低成本红外方案' }),
  Object.freeze({ id: 'simple-fall', pattern: /MPU6050/i, suggestion: 'SW-520D', reason: '基础跌倒/倾斜检测优先简单方案' }),
  Object.freeze({ id: 'avoid-premium-sensors', pattern: /AS608|MAX30102|TCS34725/i, suggestion: '从器件库选择满足需求的简单替代器件', reason: '默认面向本科项目的成本和实现难度' }),
  Object.freeze({ id: 'simple-driver', pattern: /TB6612|L298N/i, suggestion: '5V 继电器或与负载匹配的简单驱动', reason: '默认执行机构优先简单、可验证的驱动方式' }),
]);

const INVALID_OLED_SIZE_PATTERN = /(?:^|[^\d.．])96\s*(?:英寸|寸)\s*(?:的\s*)?(?:OLED|显示(?:屏|器)?)/i;

export const SCHEME_SYSTEM_PROMPT = String.raw`
你是单片机/嵌入式本科项目方案设计助手。你的任务是根据题目和用户附加要求生成一份面向制作人员与客户确认的简明项目方案。

【最高优先级】
1. 题目必须逐字保持，不增删、不改写、不“学术化”。
2. 用户附加要求中的明确内容 > 本次功能数量 > 常见选型经验。附加要求是方案的最高业务依据。
3. 用户明确指定的器件和功能不得被替换、删除或歪曲；不同材料冲突时不要擅自选择，输出 conflicts 等待用户确认。
4. 用户没有提供的引脚、阈值、精度、响应时间、地址、电压和测试结果不得写成项目事实。
5. 不输出或解释任何A/B/C等级、难度档位、内部生成规则或“符合某级方案”等信息。
6. 用户给出的本次功能数量需要落实，但不得通过同义拆分或无关功能凑数量；若题目和附加要求确实无法支持，应在warnings中说明。
7. 同一器件完成同类动作时必须合并。例如“OLED显示温湿度”和“OLED显示运行状态”应合成一项“使用OLED显示环境数据和运行状态”，不能拆成两项凑数。
8. 一项自动控制功能必须同时概括“主控判断条件”和“执行器动作”，不能拆成“主控阈值判断”和“继电器/电机执行”两项功能凑数量。

【工作模式】
- create：先完整落实用户补充信息，再用难度等级补全用户没有说明的内容；补充项标记为 ai_suggestion。用户要求与等级建议不一致时，以用户要求为准，不得将其列为冲突。不得为凑数量拆分同一功能或增加与题目无关的功能。
- import 或 extract：只能忠实整理已有方案、任务书或开题材料；不按难度等级补功能，不新增、替换或猜测器件型号。原文未说明的选型理由写“原资料未说明”，缺失和矛盾进入 conflicts/warnings，不得伪装成原文事实。

【等级规则】
- A：10~15 项功能，通常包含云平台或 WiFi/APP 通信、传感器和执行机构。
- B：7~10 项功能，通常包含无线通信、传感器和执行机构。
- C：至少 3 项功能，以基础采集和控制为主，不强制增加通信。
- 等级只用于补足用户未说明的复杂度。功能数量、联网方式、器件选择与用户补充信息不一致时，一律以用户补充信息为准；不能覆盖用户明确限制，也不能为了凑数量生成与题目无关的功能。
- 最终方案正文不得提及等级名称、等级规则、功能数量档位或“符合某级方案”等内部判断。

【默认选型铁律】
1. 默认不推荐 4G/SIM7600，远程传输优先 ESP-01S WiFi。
2. 默认不推荐 LD2410，普通人体检测优先 HC-SR501。
3. 基础倾斜/跌倒检测默认不用 MPU6050，优先 SW-520D。
4. 默认避免 AS608、MAX30102、TCS34725 等成本或实现难度较高的器件，除非题目明确需要。
5. 默认避免 TB6612/L298N 等复杂双路驱动，普通开关型负载优先简单且匹配的驱动方案。
6. 能少一个硬件就少一个，优先低价、主流、资料充分、适合本科调试的方案。
7. 主控自带 ADC 时不额外添加 ADC0832。
8. 用户明确指定上述器件时，以用户要求为准，但应在 conflicts/warnings 中提示实现难度，不得悄悄替换。
9. 0.96 英寸 OLED 必须写为“0.96寸OLED”或“0.96英寸OLED”，禁止丢失小数点写成“96寸OLED”或“96英寸OLED”。

【方案内容边界】
1. overview 说明项目背景、建设目标和系统级总体工作方式。
2. architecture 分别说明输入/采集、主控处理、输出/执行和通信层；没有通信时明确写“无”。
3. devices 对每个核心器件说明准确型号或用户原称、项目中的主要作用和工程选型理由，不堆砌手册参数。
4. functions 对每项功能说明用户可理解的功能表现及在项目中的作用。
5. implementationNotes 只概括供电、已知接口/通信、开发调试环境和安装布置注意事项。
6. 方案阶段不生成 deviceRefs、逐功能器件闭环、程序流程、引脚连接、processDescription、verificationMethod、测试步骤和通过判据；这些在论文事实核对阶段结合原理图、源程序和测试资料处理。
7. 输出前检查题目、功能数量（仅 create）、器件/功能基本完整性、重复项、OLED尺寸写法和选型铁律（仅 create）。
8. 面向用户显示的内容只有题目、器件和功能。器件作用应简短，适合显示为“型号（作用）”；功能description必须写成“使用某器件实现某功能”的完整句子。

【输出】
只输出严格 JSON，不要 Markdown 代码块，不要解释：
{
  "topic": "逐字保留的原题目",
  "level": "B",
  "overview": {
    "background": "项目使用场景和需要解决的问题",
    "goal": "本项目的主要建设目标",
    "overallDescription": "从输入、主控处理到输出执行的系统级概述"
  },
  "architecture": {
    "inputLayer": "采集或接收的信息",
    "controlLayer": "主控承担的总体处理职责",
    "outputLayer": "显示、报警、驱动或控制输出",
    "communicationLayer": "通信用途；没有则写无"
  },
  "devices": [
    { "model": "准确型号或用户原称", "role": "项目中的主要作用", "selectionReason": "工程选型理由", "source": "user|source_document|ai_suggestion" }
  ],
  "functions": [
    { "text": "功能名称", "description": "使用某器件实现某功能", "source": "user|source_document|ai_suggestion" }
  ],
  "implementationNotes": {
    "power": "总体供电注意事项",
    "interfaces": "已知接口或通信的概括说明",
    "development": "开发与调试环境；不确定时明确待确认",
    "installation": "器件安装和布置注意事项"
  },
  "conflicts": [],
  "warnings": []
}
`.trim();

export const PAPER_BASE_SYSTEM_PROMPT = String.raw`
你是单片机/嵌入式方向本科工程设计论文写作助手。只能在已锁定项目事实、章节写作合同和已确认材料范围内写作。

【事实与冲突】
1. 题目逐字不变；主控、器件、接口、引脚、阈值、功能和术语必须全文一致。
2. 不得新增、替换或删除用户已经明确或确认的项目事实。只有两份及以上用户资料对主控、核心器件、实际接口/连接、关键阈值或核心功能给出互相冲突的结论，且没有已确认解决结果时，才停止受影响小节并返回待确认问题；某类资料未提供本身不是冲突，不得因此中止整章或整篇论文。
3. 器件固有知识可以解释，但项目实际采用的 GPIO、引脚、地址、电压、阈值、控制极性和测试结果必须来自用户资料或已确认结果。不得把数据手册中的典型能力、常见接法或模型推断写成项目已经采用的事实。

【资料不完整时的继续写作策略】
1. 缺少连接关系或原理图时，继续按已确认器件和功能写协议级、信号级连接逻辑、通用电路组成及工作原理；不得虚构具体 GPIO、引脚编号、总线地址、实际供电电压、阈值或控制极性。需要具体接线的位置用非正文说明提示用户按原理图补充，不能用猜测值填满表格。
2. 缺少源程序时，允许依据已确认功能和接口事实写设计级的软件架构、状态转换、业务流程、判断分支、异常处理及流程图说明；不得声称这些内容已经由实际源代码验证，不得编造源文件名、函数名、变量名、宏、寄存器配置或库 API。提供源程序时才分析其真实实现，并仍用业务语言表述。
3. 缺少实测数据时，必须依据已确认器件能力、功能逻辑和合理实验条件生成现实、保守、可编辑且内部一致的量化测试表。表格必须有测试条件或次数、数值、单位、判定标准和结果；同一指标在正文、表格、摘要与总结中保持一致，不使用100%成功率、零误差或明显超出器件能力的结果。
4. 缺少实物照片或插图资料时，正文继续正常写作，并在对应内容后保留唯一图位及详细的非正文拍摄/绘制说明，不得把未见到的照片内容描述成已经观察到的事实。
5. 缺少学校目录时，使用当前已确认的六章目录和章节职责；缺少参考文献时进入无参考文献模式；二者均不得阻断正文生成。
6. 缺少方案、任务书或背景说明时，可以围绕题目、已确认器件和功能作不点名、不含虚构统计数据的通用行业背景分析，但不得新增未经确认的项目功能、器件或性能指标。
7. 资料缺失带来的限制应通过保守表述或非正文补充说明处理，不得在正文中写成“系统未完成、功能未实现、无法运行”，也不得只返回问题清单而不完成当前章节。

【章节职责唯一】
- 第1章回答为什么做：背景、意义、国内外现状、主要研究内容和论文结构。
- 第2章回答做什么及为什么这样选：需求、总体架构、功能、主要器件选型和最终方案。
- 第3章回答硬件怎样实现：连接关系、电气条件、电路工作原理和硬件图位。
- 第4章回答软件怎样实现：总体架构、业务流程、判断逻辑、异常处理、流程图/时序图/公式。
- 第5章回答如何调试与验证：环境、步骤、量化数据表、现象、结果分析和功能展示图位。用户未提供实测数据时，允许依据器件能力、功能逻辑和常见实验条件给出保守且内部一致的可编辑测试数据，不能省略数据、单位和表格，也不能写明显超出器件能力的数值。
- 第6章回答完成了什么、有哪些边界条件、怎样改进。核心功能已经列入项目事实时，不得写成“未完成、尚未实现、没有实现”；不足只能描述精度、环境、样本范围、交互或后续扩展等有边界的限制。
- 允许必要的简短前后呼应，禁止换词重复、跨章完整复述和通过器件参数堆砌凑字数。

【标题层级与输出】
1. 当前章标题由系统统一生成，正文中不要重复输出“第X章……”标题。
2. 论文二级标题统一写成“## 2.1 标题”，论文三级标题统一写成“### 2.1.1 标题”。
3. 禁止使用单个“#”以及“####”或更深层级；标题编号必须与本章目录一致。
4. 标题单独占一行，标题下直接写正文，不把标题井号留在普通段落中。
5. “论文组织结构”中“第1章为……、第2章为……”等逐章说明必须写成普通正文段落，禁止添加任何标题井号；一级章标题只能由系统统一生成。
6. 同类器件、同类电路、同类程序或同类测试应归入同一个二级标题，用段落、分点或表格展开；不得为每个器件、每项功能机械创建三级标题。三级标题只在一个二级标题下确有两个以上不同逻辑主题时使用，每个二级标题通常不超过3个三级标题。

【软件正文】
1. 正文不插入源代码。
2. 不用源文件名、函数名、变量名、宏、寄存器或库 API 介绍程序。
3. 有实际源程序时先分析真实实现，再用本科论文语言、流程图、时序图、状态图和必要公式说明业务逻辑。
4. 没有实际代码依据时仍应依据已确认功能写设计级业务流程，但只能说明应执行的步骤、判断和状态关系，不得冒充对实际代码的分析，也不得生成具体函数、变量、寄存器或调用细节。

【图表与非正文说明】
- 核心器件规划器件图；独立硬件模块规划电路图；核心程序逻辑规划流程图；时序敏感通信才规划时序图；核心功能测试规划展示图。
- 正文必须先引用图表，再给正式占位；紧接详细的绘图或拍摄说明。
- 每张图必须使用明确且唯一的图号。每个图号全文只允许一次“如图X-X所示”的首次引出、一个正式图位和一段非正文制作说明，三者在首次出现处连续安排。
- 后文再次分析同一张图时可以写“由图X-X可知”“结合图X-X分析”或“该图中”，但不得再次写“如图X-X所示/如图所示”，不得重复插入同一图位或制作说明。
- 禁止使用没有明确图号的“如图所示”“如下图所示”；续写前必须检查本章已有图号，跳过已经出现的图。
- 非正文说明统一使用“【非正文·类型｜定稿前删除】”开始，以“【非正文结束】”结束。
- 图示数量由实际项目决定，不固定套用五张流程图。

【引用】
1. 只使用用户文献库，不联网检索、不新增文献。
2. 用户未提供文献时按“无参考文献模式”正常写作：不得编造作者、题名或出版信息，不得输出 citationToken、[n] 引用编号和文末参考文献；国内外现状采用不点名的概括性分析，不能因文献为空而中止论文生成。
3. 用户提供文献时，粘贴内容是唯一文献来源，必须原样忠实使用；不得新增、删除、替换、联网检索或猜补缺失出版信息。
4. 引用只出现在第一章，主要位于国内外研究现状。用户提供的每篇文献全文只引用一次；每个观点句只放一个 [n]；禁止合并引用。
5. 生成阶段若文献记录提供 citationToken，必须在对应观点句使用该令牌，不自行猜数字；系统将按正文实际出现顺序转换为从 [1] 连续的编号，并同步排序文末参考文献。
6. 正文作者必须与编号对应文献一致。无摘要文献只能保守描述题目体现的研究方向。
7. 用户提供的文献必须保留完整出版信息：期刊文献应含期刊名、年份、卷（期）和页码；学位论文应含学位授予单位和年份；其他类型应按对应 GB/T 7714 项目保留来源与年份。不得只输出作者和题名。

【写作质量】
- 使用“本文”“本系统”“该模块”，语言正式、清楚、符合本科工程设计水平。
- 允许少量相关的宏观行业铺垫，但必须尽快收束到题目场景，不编政策、市场或统计数据。
- 没有可靠依据不写创新点；普通集成只能写主要工作或设计特点。
- 第5章必须有量化测试数据表。没有用户数据时，可依据已确认器件能力和合理实验条件推定保守数值；同一指标在正文、表格和结论中必须一致，避免100%成功率、零误差等绝对化结果。
- 致谢不得出现任何人名、学校名或单位名，不使用“时光荏苒、白驹过隙、岁月如梭”等模板开头；应围绕选题分析、硬件调试、程序验证和论文整理等实际环节表达概括性感谢。
- 学校未明确要求时不生成本章小结。
- 当前调用只完成章节合同指定的小节，不越界、不提前写后续章节。
`.trim();

const DEVICE_PATTERNS = Object.freeze({
  controller: /主控|控制器|单片机|STM32|STC\d|AT89|ESP32|ESP8266|Arduino|PIC\d|MSP430/i,
  sensor: /传感|检测|采集|测量|温度|湿度|光照|烟雾|气体|水位|压力|加速度|红外|超声|RFID|摄像|DHT\d*|DS18B20|BH1750|MQ-?\d+|HC-SR04|HC-SR501|MPU6050/i,
  actuator: /执行|驱动|继电器|电机|风扇|水泵|舵机|蜂鸣器|加热|阀|灯|MOS|三极管|SG90|ULN2003/i,
  display: /显示|OLED|LCD|TFT|数码管|屏/i,
  communication: /通信|WiFi|蓝牙|ZigBee|LoRa|NB-IoT|ESP-01|HC-05|NRF24|串口|UART|RS485|CAN/i,
  power: /电源|供电|适配器|电池|稳压|DC-DC|LDO|AMS1117/i,
});

const FUNCTION_PATTERNS = Object.freeze({
  sensing: /采集|检测|监测|测量|识别|读取/i,
  displayOrCommunication: /显示|界面|通信|上传|发送|接收|远程|无线|WiFi|蓝牙|联网|云/i,
  controlOrAlarm: /控制|调节|执行|报警|提醒|联动|模式|按键|启停|开关/i,
});

const RESPONSIBILITIES = Object.freeze({
  1: Object.freeze({
    purpose: '说明研究背景、意义、国内外研究现状、本文主要工作和论文结构',
    allowedTypes: ['topic', 'project_goal', 'application', 'background', 'reference'],
    forbiddenTopics: ['完整器件参数', '具体引脚连接', '源程序函数', '详细测试结果'],
  }),
  2: Object.freeze({
    purpose: '说明系统需求、总体架构、功能设计、主要器件选型和最终方案',
    allowedTypes: ['topic', 'project_goal', 'function', 'device', 'selection', 'architecture'],
    forbiddenTopics: ['具体引脚连接', '驱动程序实现', '实际测试结论'],
  }),
  3: Object.freeze({
    purpose: '说明硬件连接、电气条件和电路工作原理',
    allowedTypes: ['device', 'connection', 'electrical', 'hardware_report'],
    forbiddenTopics: ['重复完整选型比较', '程序函数流程', '功能测试结论'],
  }),
  4: Object.freeze({
    purpose: '用业务语言说明软件架构、驱动过程、功能逻辑和异常处理',
    allowedTypes: ['function', 'program_report', 'parameter', 'formula'],
    forbiddenTopics: ['源代码', '函数名式介绍', '重复器件选型', '重复硬件接线', '测试通过结论'],
  }),
  5: Object.freeze({
    purpose: '说明调试环境、功能验证方法、结果与分析',
    allowedTypes: ['function', 'test', 'test_record', 'photo'],
    forbiddenTopics: ['新增器件', '新增功能', '重复程序设计', '超出器件能力或前后矛盾的量化性能'],
  }),
  6: Object.freeze({
    purpose: '概括实际完成工作、说明有边界的限制条件和一一对应的优化方向，不否定已确认核心功能',
    allowedTypes: ['project_goal', 'function', 'test', 'limitation', 'future_work'],
    forbiddenTopics: ['新增功能', '重复器件参数', '重复程序流程', '重复测试步骤'],
  }),
});

function text(value) {
  return value == null ? '' : String(value).trim();
}

function list(value) {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

function normalizeKey(value) {
  return text(value).toLowerCase().replace(/[\s，,。；;、（）()\[\]【】:_-]+/g, '');
}

function uniqueBy(values, getKey = normalizeKey) {
  const seen = new Set();
  return values.filter(value => {
    const key = getKey(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function stripRole(value) {
  return text(value).replace(/[（(][^）)]*[）)]\s*$/, '').trim();
}

function deviceFrom(value, index = 0) {
  if (typeof value === 'string') {
    const match = value.match(/^(.+?)[（(]([^）)]+)[）)]$/);
    return {
      id: `device-${index + 1}`,
      model: text(match ? match[1] : value),
      name: text(match ? match[1] : value),
      role: text(match ? match[2] : ''),
      selectionReason: '',
      core: undefined,
    };
  }
  const item = value || {};
  return {
    ...item,
    id: text(item.id) || `device-${index + 1}`,
    model: text(item.model || item.name),
    name: text(item.name || item.model),
    role: text(item.role),
    selectionReason: text(item.selectionReason),
  };
}

function functionFrom(value, index = 0) {
  if (typeof value === 'string') return { id: `function-${index + 1}`, name: text(value), text: text(value), description: '' };
  const item = value || {};
  const name = text(item.name || item.text);
  return {
    ...item,
    id: text(item.id) || `function-${index + 1}`,
    name,
    text: name,
    description: text(item.description),
  };
}

function classifyDevice(device) {
  const role = `${device.role || ''}`;
  for (const [kind, pattern] of Object.entries(DEVICE_PATTERNS)) {
    if (role && pattern.test(role)) return kind;
  }
  const haystack = `${device.model} ${device.name} ${device.role}`;
  for (const [kind, pattern] of Object.entries(DEVICE_PATTERNS)) {
    if (pattern.test(haystack)) return kind;
  }
  return 'other';
}

function classifyFunction(func) {
  const value = `${func.name || ''} ${func.text || ''}`;
  if (FUNCTION_PATTERNS.sensing.test(value)) return 'sensing';
  if (FUNCTION_PATTERNS.displayOrCommunication.test(value)) return 'displayOrCommunication';
  if (FUNCTION_PATTERNS.controlOrAlarm.test(value)) return 'controlOrAlarm';
  return 'other';
}

function cleanFunctionTitle(value) {
  return text(value)
    .replace(/^使用\s*[^，,。；;]{1,24}(?:实现|完成|进行)?\s*/i, '')
    .replace(/[。；;]+$/g, '')
    .replace(/功能$/g, '') || '核心功能';
}

function section(number, titleValue, children = []) {
  return {
    id: `section-${number.replace(/\./g, '-')}`,
    number,
    title: titleValue,
    children,
  };
}

function dynamicSections(items, prefix, titleBuilder) {
  return uniqueBy(items, item => normalizeKey(titleBuilder(item))).map((item, index) =>
    section(`${prefix}.${index + 1}`, titleBuilder(item)),
  );
}

function parseSchoolOutline(raw) {
  if (Array.isArray(raw) && raw.every(item => item && typeof item === 'object')) {
    return JSON.parse(JSON.stringify(raw));
  }
  const lines = Array.isArray(raw) ? raw : text(raw).split(/\r?\n/);
  const chapters = [];
  let currentChapter = null;
  let currentH2 = null;
  for (const rawLine of lines) {
    const line = text(rawLine).replace(/^#{1,6}\s*/, '');
    if (!line) continue;
    const chineseNumber = { 一: '1', 二: '2', 三: '3', 四: '4', 五: '5', 六: '6', 七: '7', 八: '8', 九: '9', 十: '10' };
    const ch = line.match(/^(?:第\s*)?([一二三四五六七八九十]|\d+)\s*章[.、\s]*(.+)$/);
    const h3 = line.match(/^(\d+\.\d+\.\d+)\s+(.+)$/);
    const h2 = line.match(/^(\d+\.\d+)\s+(.+)$/);
    if (ch && !line.includes('.')) {
      const chapterNumber = chineseNumber[ch[1]] || ch[1];
      currentChapter = section(chapterNumber, ch[2]);
      chapters.push(currentChapter);
      currentH2 = null;
    } else if (h3 && currentChapter) {
      const parentNumber = h3[1].split('.').slice(0, 2).join('.');
      currentH2 = currentChapter.children.find(item => item.number === parentNumber) || currentH2;
      if (currentH2) currentH2.children.push(section(h3[1], h3[2]));
    } else if (h2 && currentChapter) {
      currentH2 = section(h2[1], h2[2]);
      currentChapter.children.push(currentH2);
    }
  }
  return chapters;
}

/** Build the approved six-chapter outline with dynamic third-level headings. */
export function buildDefaultOutline({ devices = [], functions = [], schoolOutline = null } = {}) {
  if (schoolOutline && list(schoolOutline).length) {
    const parsed = parseSchoolOutline(schoolOutline);
    if (parsed.length) return parsed;
  }

  const devs = uniqueBy(list(devices).map(deviceFrom), item => normalizeKey(item.model));
  const funcs = uniqueBy(list(functions).map(functionFrom), item => normalizeKey(item.name));
  const groups = Object.groupBy
    ? Object.groupBy(devs, classifyDevice)
    : devs.reduce((acc, item) => {
        const key = classifyDevice(item);
        (acc[key] ||= []).push(item);
        return acc;
      }, {});
  const functionGroups = Object.groupBy
    ? Object.groupBy(funcs, classifyFunction)
    : funcs.reduce((acc, item) => {
        const key = classifyFunction(item);
        (acc[key] ||= []).push(item);
        return acc;
      }, {});

  const selectionChildren = [];
  if (groups.controller?.length) selectionChildren.push(section('2.4.1', '主控制器选型'));
  if ([...(groups.sensor || []), ...(groups.actuator || [])].length) {
    selectionChildren.push(section(`2.4.${selectionChildren.length + 1}`, '传感与执行器件选型'));
  }
  if ([...(groups.display || []), ...(groups.communication || []), ...(groups.other || [])].length) {
    selectionChildren.push(section(`2.4.${selectionChildren.length + 1}`, '显示、通信与辅助器件选型'));
  }

  const hardwareGroups = [];
  if (groups.sensor?.length) {
    hardwareGroups.push({ title: '传感器电路设计', items: groups.sensor });
  }
  if (groups.actuator?.length) {
    hardwareGroups.push({ title: '执行器驱动电路设计', items: groups.actuator });
  }
  const displayAndComm = [...(groups.display || []), ...(groups.communication || [])];
  if (displayAndComm.length) {
    hardwareGroups.push({ title: '显示与通信电路设计', items: displayAndComm });
  }
  if (groups.other?.length) {
    hardwareGroups.push({ title: '其他功能电路设计', items: groups.other });
  }
  const hardwareChildren = hardwareGroups.map((group, index) => {
    const number = `3.${index + 4}`;
    return section(number, group.title);
  });

  const softwareGroups = [];
  if (functionGroups.sensing?.length) {
    softwareGroups.push({ title: '传感器驱动程序设计', items: functionGroups.sensing });
  }
  if (functionGroups.displayOrCommunication?.length) {
    softwareGroups.push({ title: '显示与通信程序设计', items: functionGroups.displayOrCommunication });
  }
  const controlAndOther = [...(functionGroups.controlOrAlarm || []), ...(functionGroups.other || [])];
  if (controlAndOther.length) {
    softwareGroups.push({ title: '控制及报警逻辑设计', items: controlAndOther });
  }
  const softwareChildren = softwareGroups.map((group, index) => {
    const number = `4.${index + 4}`;
    return section(number, group.title);
  });

  const testChildren = [];
  if ([...(functionGroups.sensing || []), ...(functionGroups.displayOrCommunication || [])].length) {
    testChildren.push(section('5.4.1', '采集、显示与通信功能测试'));
  }
  if ([...(functionGroups.controlOrAlarm || []), ...(functionGroups.other || [])].length) {
    testChildren.push(section(`5.4.${testChildren.length + 1}`, '控制、报警与联动功能测试'));
  }

  return [
    section('1', '绪论', [
      section('1.1', '研究背景及意义'),
      section('1.2', '国内外研究现状', [
        section('1.2.1', '国内研究现状'),
        section('1.2.2', '国外研究现状'),
        section('1.2.3', '国内外研究现状分析'),
      ]),
      section('1.3', '本文主要研究内容'),
      section('1.4', '论文组织结构'),
    ]),
    section('2', '系统总体方案设计', [
      section('2.1', '系统需求分析'),
      section('2.2', '系统总体架构'),
      section('2.3', '系统功能设计'),
      section('2.4', '主要器件选型', selectionChildren),
      section('2.5', '系统总体方案确定'),
    ]),
    section('3', '系统硬件设计', [
      section('3.1', '硬件系统总体设计'),
      section('3.2', '主控最小系统设计'),
      section('3.3', '电源电路设计'),
      ...hardwareChildren,
    ]),
    section('4', '系统软件设计', [
      section('4.1', '软件开发环境'),
      section('4.2', '软件总体架构'),
      section('4.3', '系统主程序设计'),
      ...softwareChildren,
      section(`4.${softwareChildren.length + 4}`, '软件异常处理'),
    ]),
    section('5', '系统调试与功能测试', [
      section('5.1', '系统开发与调试环境'),
      section('5.2', '硬件调试'),
      section('5.3', '软件调试'),
      section('5.4', '系统功能测试', testChildren),
      section('5.5', '测试结果分析'),
    ]),
    section('6', '总结与展望'),
  ];
}

export function flattenOutline(outline = []) {
  const result = [];
  const visit = node => {
    result.push(node);
    list(node.children).forEach(visit);
  };
  list(outline).forEach(visit);
  return result;
}

/** Allocate an initial draft target while enforcing a final 18,000-character body. */
export function buildWordTargets(outline = buildDefaultOutline(), options = {}) {
  const complexityTargets = { simple: 19000, medium: 20000, complex: 22000 };
  const complexity = options.complexity || 'medium';
  const requested = Number(options.requestedTarget || complexityTargets[complexity] || 20000);
  const totalTarget = Math.max(19000, Number.isFinite(requested) ? requested : 20000);
  const minimumFinal = Math.max(MIN_FINAL_BODY_CHARS, Number(options.minimumFinal || 0));
  const defaultWeights = { 1: 0.14, 2: 0.16, 3: 0.24, 4: 0.26, 5: 0.16, 6: 0.04 };
  const customWeights = options.chapterWeights || {};
  const chapters = list(outline);
  const rawWeights = chapters.map(chapter => Number(customWeights[chapter.number] ?? defaultWeights[Number(chapter.number)] ?? 1));
  const weightSum = rawWeights.reduce((sum, value) => sum + Math.max(0, value), 0) || 1;
  const perChapter = {};
  let allocated = 0;
  chapters.forEach((chapter, index) => {
    const isLast = index === chapters.length - 1;
    const target = isLast
      ? totalTarget - allocated
      : Math.round(totalTarget * Math.max(0, rawWeights[index]) / weightSum);
    allocated += target;
    perChapter[chapter.number] = {
      chapterId: chapter.id,
      number: chapter.number,
      title: chapter.title,
      target,
      targetMin: Math.max(500, Math.floor(target * 0.92)),
      targetMax: Math.ceil(target * 1.12),
    };
  });
  return { minimumFinal, totalTarget, complexity, chapters: perChapter };
}

export function buildChapterContracts({ outline, facts = [], artifacts = [], targets = null } = {}) {
  const plan = outline?.length ? outline : buildDefaultOutline();
  const wordTargets = targets || buildWordTargets(plan);
  return plan.map(chapter => {
    const number = Number(chapter.number);
    const responsibility = RESPONSIBILITIES[number] || {
      purpose: `完成“${chapter.title}”规定的工程论文内容`,
      allowedTypes: [],
      forbiddenTopics: [],
    };
    const allowedFactIds = list(facts)
      .filter(fact => !responsibility.allowedTypes.length || responsibility.allowedTypes.includes(fact.type))
      .map(fact => fact.id)
      .filter(Boolean);
    const chapterArtifacts = list(artifacts).filter(item => String(item.chapterId) === String(chapter.id) || String(item.chapterNumber) === String(chapter.number));
    const target = wordTargets.chapters[chapter.number] || { targetMin: 800, targetMax: 2000 };
    return {
      chapterId: chapter.id,
      chapterNumber: chapter.number,
      chapterTitle: chapter.title,
      purpose: responsibility.purpose,
      allowedFactIds,
      allowedEvidenceIds: uniqueBy(list(facts).flatMap(fact => responsibility.allowedTypes.includes(fact.type) ? list(fact.sourceIds) : [])),
      requiredTopics: list(chapter.children).map(item => `${item.number} ${item.title}`),
      forbiddenTopics: [...responsibility.forbiddenTopics],
      alreadyCoveredFactIds: [],
      requiredArtifactIds: chapterArtifacts.filter(item => item.required !== false).map(item => item.id),
      targetMin: target.targetMin,
      targetMax: target.targetMax,
    };
  });
}

function artifactMarker(type) {
  const labels = {
    device_photo: '图片查找说明',
    circuit_diagram: '电路图绘制说明',
    connection_table: '表格整理说明',
    flowchart: '流程图绘制稿',
    timing_diagram: '时序图绘制稿',
    state_diagram: '状态图绘制稿',
    test_photo: '图片拍摄说明',
    formula: '公式参数说明',
  };
  return labels[type] || '图表说明';
}

export function makeArtifactSpec({ id, type, chapterId, sectionId, title, sourceFactIds = [], instruction = '', required = true }) {
  const figureNumber = text(title).match(/图\s*(\d+)\s*[-－—]\s*(\d+)/);
  return {
    id,
    type,
    chapterId,
    sectionId,
    title,
    required,
    bodyReference: figureNumber ? `如图${figureNumber[1]}-${figureNumber[2]}所示。` : `${title}见对应图位。`,
    placeholder: `【${title}——待插入】`,
    nonBodyInstruction: `【非正文·${artifactMarker(type)}｜定稿前删除】\n${instruction || '请严格依据已确认项目事实完成。'}\n【非正文结束】`,
    sourceFactIds: uniqueBy(sourceFactIds),
    status: 'planned',
  };
}

function normalizeAuthors(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  return text(value).split(/[，,；;、]+/).map(text).filter(Boolean);
}

function cleanReferenceNumber(value) {
  return text(value).replace(/^\s*\[\d+\]\s*/, '').trim();
}

function referenceType(value) {
  const token = text(value).toUpperCase().replace(/\s+/g, '');
  const aliases = { 期刊: 'J', 学位论文: 'D', 专著: 'M', 图书: 'M', 会议: 'C', 网络: 'EB/OL' };
  return aliases[token] || (/^(?:J|D|M|C|N|P|R|S|Z|EB\/OL)$/.test(token) ? token : '');
}

function metadataFromFormattedLine(value) {
  const formatted = cleanReferenceNumber(value);
  const marker = formatted.match(/\[([A-Z]+(?:\/[A-Z]+)?)\]/i);
  const documentType = referenceType(marker?.[1]);
  const beforeMarker = marker ? formatted.slice(0, marker.index).replace(/[.．]\s*$/, '') : formatted;
  const separators = [...beforeMarker.matchAll(/[.．]\s+/g)];
  const separator = separators.at(-1);
  const authorsPart = separator ? beforeMarker.slice(0, separator.index) : '';
  const titlePart = separator ? beforeMarker.slice(separator.index + separator[0].length) : beforeMarker;
  const afterMarker = marker
    ? formatted.slice(marker.index + marker[0].length).replace(/^[.．]\s*/, '').replace(/[.．]\s*$/, '')
    : '';
  const year = afterMarker.match(/(?:^|[,，]\s*|:\s*)((?:19|20)\d{2})(?=$|[,，.:：\s])/i)?.[1] || '';
  const source = text(afterMarker.split(/[,，]/)[0]).replace(/^.+?[:：]\s*/, value => value.includes(':') || value.includes('：') ? value.split(/[:：]/).pop() : value);
  const volumeIssue = year
    ? afterMarker.match(new RegExp(`${year}\\s*[,，]\\s*([^,，:：.]+?)(?:\\(([^)]+)\\))?\\s*(?=[:：,，.]|$)`))
    : null;
  const pages = text(afterMarker.match(/[:：]\s*([A-Za-z]?\d+(?:\s*[-–—]\s*[A-Za-z]?\d+)?)(?=[.．]|$)/)?.[1]).replace(/\s+/g, '');
  const institution = documentType === 'D'
    ? text(afterMarker.replace(new RegExp(`[,，]?\\s*${year}.*$`), '').split(/[:：]/).pop())
    : '';
  const publisher = documentType === 'M'
    ? text(afterMarker.replace(new RegExp(`[,，]?\\s*${year}.*$`), '').split(/[:：]/).pop())
    : '';
  const place = /[:：]/.test(afterMarker) ? text(afterMarker.split(/[:：]/)[0]) : '';
  return {
    formatted,
    authors: normalizeAuthors(authorsPart),
    title: text(titlePart),
    documentType,
    source,
    year,
    volume: text(volumeIssue?.[1]),
    issue: text(volumeIssue?.[2]),
    pages,
    institution,
    publisher,
    place,
  };
}

function normalizeReferenceRecord(item, index) {
  const raw = text(item?.raw || item?.rawCitation || item?.formatted || item?.formattedCitation);
  const inferred = raw ? metadataFromFormattedLine(raw) : {};
  const documentType = referenceType(item?.documentType || item?.type || inferred.documentType);
  const publication = item?.publication || {};
  return {
    ...item,
    id: text(item?.id) || `ref-${index + 1}`,
    authors: normalizeAuthors(item?.authors || item?.author || inferred.authors),
    title: text(item?.title || inferred.title),
    documentType,
    source: text(item?.source || item?.containerTitle || publication.containerTitle || inferred.source),
    year: text(item?.year || publication.year || inferred.year),
    volume: text(item?.volume || publication.volume || inferred.volume),
    issue: text(item?.issue || publication.issue || inferred.issue),
    pages: text(item?.pages || publication.pages || inferred.pages),
    institution: text(item?.institution || publication.institution || inferred.institution),
    publisher: text(item?.publisher || publication.publisher || inferred.publisher),
    place: text(item?.place || publication.place || inferred.place),
    doi: text(item?.doi || publication.doi),
    url: text(item?.url || publication.url),
    accessDate: text(item?.accessDate || publication.accessDate),
    abstract: text(item?.abstract),
    region: ['domestic', 'foreign'].includes(item?.region) ? item.region : 'unknown',
    directionTags: list(item?.directionTags).map(text).filter(Boolean),
    selected: item?.selected !== false,
    originalNumber: Number(item?.originalNumber || index + 1),
    usedCount: Number(item?.usedCount || 0),
    raw,
    formatted: cleanReferenceNumber(item?.formatted || item?.formattedCitation || inferred.formatted || raw),
  };
}

function parseReferenceLine(line, index) {
  const raw = text(line);
  const withoutNumber = raw.replace(/^\s*\[(\d+)\]\s*/, '');
  const pipe = withoutNumber.split(/\s*[|｜]\s*/);
  if (pipe.length >= 2) {
    const type = referenceType(pipe[2]);
    const extended = Boolean(type);
    return normalizeReferenceRecord({
      id: `ref-${index + 1}`,
      authors: normalizeAuthors(pipe[0]),
      title: text(pipe[1]),
      documentType: type,
      source: extended ? text(pipe[3]) : '',
      year: extended ? text(pipe[4]) : '',
      volume: extended ? text(pipe[5]).replace(/\([^)]*\)/g, '') : '',
      issue: extended ? text(pipe[5]).match(/\(([^)]+)\)/)?.[1] || '' : '',
      pages: extended ? text(pipe[6]) : '',
      abstract: extended ? text(pipe[7]) : text(pipe[2]),
      region: /国外|foreign/i.test(pipe[8] || pipe[3] || '') ? 'foreign' : /国内|domestic/i.test(pipe[8] || pipe[3] || '') ? 'domestic' : 'unknown',
      selected: true,
      raw: extended ? '' : raw,
      originalNumber: Number(raw.match(/^\s*\[(\d+)\]/)?.[1] || index + 1),
    }, index);
  }
  return normalizeReferenceRecord({
    id: `ref-${index + 1}`,
    raw,
    originalNumber: Number(raw.match(/^\s*\[(\d+)\]/)?.[1] || index + 1),
  }, index);
}

/** Parse records supplied as objects, complete GB/T lines, or pipe-delimited records. */
export function parseReferences(input) {
  if (!input) return [];
  if (Array.isArray(input) && input.every(item => item && typeof item === 'object')) {
    return input.map(normalizeReferenceRecord);
  }
  const source = Array.isArray(input) ? input.join('\n') : String(input || '');
  if (/^\s*\[x\]/im.test(source)) {
    return source.split(/^\s*\[x\]\s*/gim).map(text).filter(Boolean).map((block, index) => {
      const blockLines = block.split(/\r?\n/).map(text).filter(Boolean);
      const citation = blockLines[0] || '';
      const abstract = blockLines.slice(1).join(' ').replace(/^(?:摘要|abstract)\s*[：:]\s*/i, '').trim();
      const parsed = parseReferenceLine(citation, index);
      return normalizeReferenceRecord({ ...parsed, abstract: abstract || parsed.abstract, originalNumber: index + 1 }, index);
    });
  }
  const lines = Array.isArray(input) ? input : text(input).split(/\r?\n/);
  return lines.map(text).filter(Boolean).map(parseReferenceLine);
}

function missingReferenceMetadata(reference) {
  const missing = [];
  if (!reference.authors.length) missing.push('作者');
  if (!reference.title) missing.push('题名');
  if (!reference.documentType) {
    missing.push('文献类型');
    if (!reference.source && !reference.publisher && !reference.institution) missing.push('期刊/学校/出版社');
    if (!reference.year) missing.push('年份');
  } else if (reference.documentType === 'J') {
    if (!reference.source) missing.push('期刊名');
    if (!reference.year) missing.push('年份');
    if (!reference.volume) missing.push('卷号');
    if (!reference.issue) missing.push('期号');
    if (!reference.pages) missing.push('页码');
  } else if (reference.documentType === 'D') {
    if (!reference.institution && !reference.source) missing.push('学位授予单位');
    if (!reference.year) missing.push('年份');
  } else if (reference.documentType === 'M') {
    if (!reference.publisher && !reference.source) missing.push('出版社');
    if (!reference.year) missing.push('年份');
  } else if (reference.documentType) {
    if (!reference.source && !reference.publisher && !reference.institution) missing.push('出版来源');
    if (!reference.year) missing.push('年份');
  }
  return missing;
}

export function formatReferenceRecord(referenceInput) {
  const reference = normalizeReferenceRecord(referenceInput || {}, 0);
  const missing = missingReferenceMetadata(reference);
  if (reference.formatted && !missing.length) return cleanReferenceNumber(reference.formatted);
  const authors = reference.authors.join('，');
  const head = `${authors}${authors ? '. ' : ''}${reference.title}${reference.documentType ? `[${reference.documentType}]` : ''}`;
  let tail = '';
  if (reference.documentType === 'J') {
    tail = `${reference.source}, ${reference.year}, ${reference.volume}${reference.issue ? `(${reference.issue})` : ''}${reference.pages ? `: ${reference.pages}` : ''}`;
  } else if (reference.documentType === 'D') {
    tail = `${reference.place ? `${reference.place}: ` : ''}${reference.institution || reference.source}, ${reference.year}`;
  } else if (reference.documentType === 'M') {
    tail = `${reference.place ? `${reference.place}: ` : ''}${reference.publisher || reference.source}, ${reference.year}`;
  } else {
    tail = [reference.source || reference.institution || reference.publisher, reference.year, reference.volume, reference.issue, reference.pages].filter(Boolean).join(', ');
  }
  const formatted = `${head}${tail ? `. ${tail}` : ''}.`.replace(/\s+([,.:])/g, '$1').replace(/\.{2,}$/g, '.');
  return missing.length ? `${formatted} [出版信息待补充：${missing.join('、')}]` : formatted;
}

function chapterEntries(chapters) {
  if (Array.isArray(chapters)) return chapters.map((chapter, index) => [String(chapter.number || chapter.chapterNumber || index + 1), text(chapter.text || chapter.draft || chapter.content)]);
  return Object.entries(chapters || {}).map(([number, value]) => [String(number), text(typeof value === 'string' ? value : value?.text || value?.draft || value?.content)]);
}

function citationSentences(value) {
  return text(value).match(/[^。！？!?；;\n]+[。！？!?；;]?/g) || [];
}

function authorTokens(reference) {
  return uniqueBy(reference.authors.flatMap(author => {
    const clean = text(author).replace(/\bet\s+al\.?|等$/gi, '').trim();
    const tokens = [clean];
    if (/^[A-Za-z]/.test(clean)) tokens.push(clean.split(/\s+/)[0]);
    return tokens.filter(token => token.length >= 2);
  }));
}

const IGNORED_NAMED_SUBJECTS = new Set([
  '国内', '国外', '国内外', '相关', '已有', '部分', '学者', '研究', '现有', '本文', '本研究', '近年来',
  '主要', '通常', '普遍', '一般', '多数', '少数', '共同', '分别', '重点',
  '相关学者', '国内学者', '国外学者', '许多学者', '众多学者', '部分学者', '本系统', '该系统', '系统设计', '控制系统', '相关研究',
  '现有研究', '部分研究', '国内外研究', '国内外现状', '研究主要', '主要研究', '研究现状',
  '相关工作', '现有工作', '研究工作', '研究方向', '研究内容', '技术发展', '发展现状',
  '研究人员', '传感器', '执行器', '核心器件', '各模块', '该模块', '本模块',
]);

function ignoredNamedSubject(value) {
  const subject = text(value);
  return IGNORED_NAMED_SUBJECTS.has(subject)
    || /^(?:本|该|其|上述|相关|现有|部分)(?:系统|项目|模块|设计|研究|方法|方案|器件)$/.test(subject)
    || /^[\u4e00-\u9fff]{0,4}(?:主要|研究|设计|工作|现状|领域|方向|内容|技术|方法|方案|系统|平台|模块|装置|网络|电路|模型|算法|器件|性能|精度|可靠性|实时性|需求|问题|任务|目标|背景|意义|应用|功能|结果|过程|数据|测试|控制)$/.test(subject);
}

const COMMON_CHINESE_SURNAME = /^[赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮卞齐康伍余元卜顾孟平黄和穆萧尹姚邵湛汪祁毛禹狄米贝明臧计伏成戴谈宋茅庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林刁钟徐邱骆高夏蔡田樊胡凌霍虞万支柯昝管卢莫经房裘缪干解应宗丁宣贲邓郁单杭洪包诸左石崔吉龚程嵇邢滑裴陆荣翁荀羊甄魏家封芮羿储靳汲邴糜松井段富巫乌焦巴弓牧隗山谷车侯宓蓬全郗班仰秋仲伊宫宁仇栾暴甘钭厉戎祖武符刘景詹束龙叶幸司韶黎乔苍双闻莘党翟谭贡劳逄姬申扶堵冉宰郦雍桑桂濮牛寿通边扈燕冀浦尚农温别庄晏柴瞿阎充慕连茹习宦艾鱼容向古易慎戈廖庾终暨居衡步都耿满弘匡国文寇广禄阙东欧殳沃利蔚越夔隆师巩厍聂晁勾敖融冷訾辛阚那简饶空曾毋沙乜养鞠须丰巢关蒯相查后荆红游竺权逯盖益桓公]/;

function likelyChineseAuthor(value, hasGroupMarker = false) {
  const candidate = text(value);
  return candidate.length >= 2
    && candidate.length <= 4
    && !ignoredNamedSubject(candidate)
    && (hasGroupMarker || COMMON_CHINESE_SURNAME.test(candidate));
}

function namedAuthorCandidates(sentence) {
  const candidates = [];
  for (const match of sentence.matchAll(/(?:^|[，,；;。！？\s]|学者|研究者)([\u4e00-\u9fff]{2,4})(等)?(?:围绕|针对|提出|设计了?|研究了|构建了?|采用了?|开发了?|实现了?)/g)) {
    if (likelyChineseAuthor(match[1], Boolean(match[2]))) candidates.push(match[1]);
  }
  for (const match of sentence.matchAll(/\b([A-Z][A-Za-z'-]{1,30})(?:\s+et\s+al\.?)?(?:等)?(?:\s+|，|,)(?:studied|proposed|designed|developed|研究|提出|设计|开发)/g)) {
    candidates.push(match[1]);
  }
  return uniqueBy(candidates);
}

function namedResearchClaims(sentence) {
  const claims = [];
  for (const match of sentence.matchAll(/(?:^|[，,；;。！？\s]|学者|研究者)([\u4e00-\u9fff]{2,4})(等(?:人|学者)?)?(?:围绕|针对|提出|指出|认为|研究了?|设计了?|开发了?|构建了?|采用了?|实现了?)/g)) {
    const candidate = match[1];
    if (likelyChineseAuthor(candidate, Boolean(match[2]))) claims.push(candidate);
  }
  for (const match of sentence.matchAll(/\b([A-Z][A-Za-z'-]{1,30})(?:\s+et\s+al\.?)?\s+(?:proposed|studied|designed|developed)\b/g)) {
    claims.push(match[1]);
  }
  for (const match of sentence.matchAll(/([\u4e00-\u9fff]{2,4}|\b[A-Z][A-Za-z'-]{1,30})(?:等|\s+et\s+al\.?)?\s*[（(](?:19|20)\d{2}[a-z]?[）)]\s*(?:提出|指出|认为|研究了?|设计了?|proposed|studied|designed)/g)) {
    const candidate = match[1];
    if (/^[A-Z]/.test(candidate) || likelyChineseAuthor(candidate)) claims.push(candidate);
  }
  for (const match of sentence.matchAll(/根据\s*([\u4e00-\u9fff]{2,4}|[A-Z][A-Za-z'-]{1,30})(?:等|\s+et\s+al\.?)?的研究/g)) {
    const candidate = match[1];
    if (/^[A-Z]/.test(candidate) || likelyChineseAuthor(candidate)) claims.push(candidate);
  }
  return uniqueBy(claims);
}

function explicitReferenceTitles(sentence) {
  return uniqueBy([...sentence.matchAll(/《([^》]{2,80})》(?:一文|研究)?(?:提出|指出|认为|显示|表明)/g)].map(match => text(match[1])));
}

export function validateReferences({ references = [], chapters = {}, bibliography = null, requireAllSelected = true } = {}) {
  const refs = parseReferences(references).filter(reference => reference.selected !== false);
  const referenceIds = new Set(refs.map(reference => reference.id));
  const errors = [];
  const warnings = [];
  const occurrences = [];
  const groupedPattern = /\[\s*\d+\s*(?:[-–—,，、]\s*\d+\s*)+\]/;
  const adjacentPattern = /\[\d+\]\s*\[\d+\]/;

  for (const [chapterNumber, content] of chapterEntries(chapters)) {
    for (const match of content.matchAll(/\{\{cite:([^}]+)\}\}/g)) {
      const referenceId = text(match[1]);
      if (!refs.length) errors.push({ code: 'citation_token_without_library', chapter: chapterNumber, message: '未提供参考文献却出现了引用令牌' });
      else if (!referenceIds.has(referenceId)) errors.push({ code: 'citation_token_unknown', chapter: chapterNumber, message: `引用令牌“${referenceId}”不在用户文献库中` });
      else errors.push({ code: 'citation_token_unresolved', chapter: chapterNumber, message: `引用令牌“${referenceId}”尚未转换为正文编号` });
    }
    if (!refs.length && (/^#{1,6}\s*参考文献\s*$/mi.test(content) || /\[(?:J|D|M|C|EB\/OL)\]/i.test(content))) {
      errors.push({ code: 'bibliography_without_library', chapter: chapterNumber, message: '未提供参考文献却生成了文献条目或参考文献小节' });
    }
    if (groupedPattern.test(content) || adjacentPattern.test(content)) {
      errors.push({ code: 'citation_grouped', chapter: chapterNumber, message: '一个引用位置只能出现一个编号，禁止合并引用' });
    }
    for (const match of content.matchAll(/\[(\d+)\]/g)) {
      occurrences.push({ chapter: chapterNumber, number: Number(match[1]), index: match.index });
      if (chapterNumber !== '1') errors.push({ code: 'citation_outside_ch1', chapter: chapterNumber, message: `引用[${match[1]}]出现在第一章以外` });
    }
    for (const sentence of citationSentences(content)) {
      const marks = [...sentence.matchAll(/\[(\d+)\]/g)].map(match => Number(match[1]));
      const namedClaims = namedResearchClaims(sentence);
      const explicitTitles = explicitReferenceTitles(sentence);
      if (marks.length > 1) errors.push({ code: 'multiple_citations_in_sentence', chapter: chapterNumber, message: `单句出现多个引用：${sentence}` });
      if ((namedClaims.length || explicitTitles.length) && marks.length === 0) {
        const claimLabel = [...namedClaims, ...explicitTitles.map(title => `《${title}》`)].join('、');
        if (!refs.length) errors.push({ code: 'citation_named_claim_without_library', chapter: chapterNumber, message: `未提供参考文献却出现了具名研究陈述：“${claimLabel}”` });
        else if (chapterNumber !== '1') errors.push({ code: 'citation_named_claim_outside_ch1', chapter: chapterNumber, message: `具名文献研究陈述只能出现在第一章：“${namedClaims.join('、')}”` });
        else errors.push({ code: 'citation_named_claim_unmarked', chapter: chapterNumber, message: `具名研究陈述“${claimLabel}”缺少对应的用户文献引用` });
      }
      if (marks.length === 1) {
        const current = refs[marks[0] - 1];
        if (!current) continue;
        const currentTokens = authorTokens(current);
        const namedReferences = refs
          .map((reference, index) => ({ index: index + 1, tokens: authorTokens(reference) }))
          .filter(item => item.tokens.some(token => sentence.includes(token)));
        if (namedReferences.some(item => item.index !== marks[0])) {
          errors.push({ code: 'citation_author_mismatch', chapter: chapterNumber, message: `句中作者与引用[${marks[0]}]不对应：${sentence}` });
        }
        const unrecognized = uniqueBy([...namedAuthorCandidates(sentence), ...namedClaims]).filter(candidate =>
          !currentTokens.some(token => candidate.includes(token) || token.includes(candidate)),
        );
        if (unrecognized.length) {
          errors.push({ code: 'citation_author_unknown', chapter: chapterNumber, message: `句中作者“${unrecognized.join('、')}”与引用[${marks[0]}]的作者不对应` });
        }
        if (explicitTitles.some(title => {
          const claimKey = normalizeKey(title);
          const currentKey = normalizeKey(current.title);
          return claimKey && currentKey && !claimKey.includes(currentKey) && !currentKey.includes(claimKey);
        })) {
          errors.push({ code: 'citation_title_mismatch', chapter: chapterNumber, message: `句中文献题名与引用[${marks[0]}]不对应` });
        }
      }
    }
  }

  const sequence = occurrences.map(item => item.number);
  sequence.forEach((number, index) => {
    if (number !== index + 1) errors.push({ code: 'citation_sequence', message: `第${index + 1}个引用应为[${index + 1}]，实际为[${number}]` });
  });
  const counts = new Map();
  sequence.forEach(number => counts.set(number, (counts.get(number) || 0) + 1));
  for (const [number, count] of counts) {
    if (count !== 1) errors.push({ code: 'citation_repeated', message: `参考文献[${number}]被引用${count}次，每篇只能引用一次` });
    if (number < 1 || number > refs.length) errors.push({ code: 'citation_unknown', message: `引用[${number}]不在用户文献库中` });
  }
  if (requireAllSelected) {
    refs.forEach((reference, index) => {
      if (!counts.has(index + 1)) errors.push({ code: 'reference_unused', referenceId: reference.id, message: `已选文献“${reference.title}”未在正文引用` });
    });
  }
  refs.forEach(reference => {
    const missing = missingReferenceMetadata(reference);
    if (missing.length) {
      errors.push({
        code: 'reference_publication_incomplete',
        referenceId: reference.id,
        message: `参考文献“${reference.title || reference.id}”缺少${missing.join('、')}，不能只保留作者和题名`,
        missing,
      });
    }
    if (reference.region === 'unknown') warnings.push({ code: 'reference_region_unknown', referenceId: reference.id, message: `请确认“${reference.title}”属于国内还是国外文献` });
  });

  if (bibliography) {
    const bibliographyRecords = parseReferences(bibliography);
    if (bibliographyRecords.length !== sequence.length) errors.push({ code: 'bibliography_count', message: '文末参考文献数量与正文引用数量不一致' });
    bibliographyRecords.forEach((item, index) => {
      const expected = refs[index];
      if (expected && normalizeKey(item.title) !== normalizeKey(expected.title)) {
        errors.push({ code: 'bibliography_order', message: `文末第${index + 1}条与正文[${index + 1}]不对应` });
      }
    });
  }

  const orderedReferences = sequence.map(number => refs[number - 1]).filter(Boolean).map((reference, index) => ({ ...reference, citationNumber: index + 1, usedCount: 1 }));
  return { valid: errors.length === 0, errors, warnings, occurrences, orderedReferences };
}

function cleanModelOutput(value) {
  return text(value)
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
    .replace(/^```(?:json|markdown|md)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function parseSchemeMarkdown(raw) {
  const title = raw.match(/^#\s+(.+)$/m)?.[1] || raw.match(/(?:题目|课题)[：:]\s*(.+)/)?.[1] || '';
  const deviceLine = raw.match(/(?:\*\*)?器件(?:清单)?(?:\*\*)?[：:]\s*([^\n]+)/i)?.[1] || '';
  const devices = deviceLine.split(/[、，,；;]+/).map(text).filter(Boolean).map((value, index) => deviceFrom(value, index));
  const functionBlock = raw.match(/(?:\*\*)?功能(?:要求|清单)?(?:\*\*)?[：:]\s*\n([\s\S]*)/i)?.[1] || '';
  const funcs = functionBlock.split(/\r?\n/)
    .map(line => line.replace(/^\s*[-*+]\s*(?:\[[ xX]\]\s*)?/, '').replace(/^\s*\d+[.、]\s*/, '').trim())
    .filter(Boolean)
    .map((value, index) => functionFrom(value, index));
  return {
    topic: text(title),
    level: '',
    overview: {},
    architecture: {},
    devices,
    functions: funcs,
    implementationNotes: {},
    conflicts: [],
    warnings: [],
    legacy: true,
    raw,
  };
}

export function parseSchemeResult(input) {
  if (input && typeof input === 'object') {
    const object = input;
    const rawFunctions = list(object.functions || object.funcs);
    return {
      topic: text(object.topic || object.title),
      level: text(object.level).toUpperCase(),
      overview: object.overview && typeof object.overview === 'object' && !Array.isArray(object.overview) ? { ...object.overview } : {},
      architecture: object.architecture && typeof object.architecture === 'object' && !Array.isArray(object.architecture) ? { ...object.architecture } : {},
      devices: list(object.devices).map(deviceFrom),
      functions: rawFunctions.map(functionFrom),
      implementationNotes: object.implementationNotes && typeof object.implementationNotes === 'object' && !Array.isArray(object.implementationNotes) ? { ...object.implementationNotes } : {},
      conflicts: list(object.conflicts),
      warnings: list(object.warnings),
      legacy: Boolean(object.legacy || object.legacyMapping) ||
        !object.overview || !object.architecture || !object.implementationNotes ||
        (rawFunctions.length > 0 && rawFunctions.every(item => typeof item === 'string')),
      raw: object,
    };
  }
  const raw = cleanModelOutput(input);
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return parseSchemeResult(JSON.parse(jsonMatch[0]));
    } catch (_) {
      // Fall through to the backward-compatible Markdown parser.
    }
  }
  return parseSchemeMarkdown(raw);
}

function explicitText(options) {
  return [options.userText, ...list(options.allowedDevices), ...list(options.explicitDevices), ...list(options.allowedFunctions)]
    .map(value => typeof value === 'object' ? JSON.stringify(value) : text(value))
    .join(' ');
}

function hasAny(value, pattern) {
  return pattern.test(text(value));
}

export function validateSchemeResult(input, options = {}) {
  const data = parseSchemeResult(input);
  const errors = [];
  const warnings = [];
  const expectedTopic = text(options.expectedTopic);
  const mode = ['import', 'extract'].includes(text(options.mode).toLowerCase()) ? 'import' : 'create';
  const expectedLevel = text(options.level).toUpperCase();
  const outputLevel = text(data.level).toUpperCase();
  const level = expectedLevel || outputLevel || 'B';
  const limits = SCHEME_LEVELS[level] || SCHEME_LEVELS.B;
  const models = data.devices.map(item => item.model).filter(Boolean);
  const functionTexts = data.functions.map(item => item.name || item.text).filter(Boolean);
  const expectedFunctionCount = Math.max(0, Number(options.expectedFunctionCount) || 0);
  const userEvidence = explicitText(options);

  if (!data.topic) errors.push({ code: 'scheme_topic_missing', message: '方案缺少题目' });
  if (expectedTopic && data.topic !== expectedTopic) errors.push({ code: 'scheme_topic_changed', message: `题目必须逐字保持为“${expectedTopic}”` });
  if (!SCHEME_LEVELS[level] || (outputLevel && !SCHEME_LEVELS[outputLevel])) errors.push({ code: 'scheme_level_invalid', message: '方案难度等级必须为A、B或C' });
  else if (expectedLevel && outputLevel && outputLevel !== expectedLevel) errors.push({ code: 'scheme_level_changed', message: `方案难度等级必须保持为${expectedLevel}级` });
  if (!models.length) errors.push({ code: 'scheme_devices_missing', message: '方案缺少器件清单' });
  if (!functionTexts.length) errors.push({ code: 'scheme_functions_missing', message: '方案缺少功能清单' });
  if (mode === 'create' && expectedFunctionCount && functionTexts.length !== expectedFunctionCount) {
    errors.push({ code: 'scheme_function_count_mismatch', message: `本次要求生成${expectedFunctionCount}项功能，当前返回${functionTexts.length}项` });
  }
  if (mode === 'create' && (functionTexts.length < limits.minFunctions || functionTexts.length > limits.maxFunctions)) {
    const range = Number.isFinite(limits.maxFunctions) ? `${limits.minFunctions}~${limits.maxFunctions}` : `至少${limits.minFunctions}`;
    warnings.push({ code: 'scheme_function_count_advisory', message: `等级参考通常为${range}项功能，当前为${functionTexts.length}项；已按用户补充信息优先保留` });
  }
  if (uniqueBy(models).length !== models.length) errors.push({ code: 'scheme_device_duplicate', message: '器件清单存在重复型号或同义重复' });
  if (uniqueBy(functionTexts).length !== functionTexts.length) errors.push({ code: 'scheme_function_duplicate', message: '功能清单存在重复或同义重复' });
  const methodSignatures = data.functions.map(item => {
    let value = text(item.description || item.name || item.text);
    if (value && !/^使用/.test(value)) value = `使用${value}`;
    const match = value.match(/^使用\s*(.{1,36}?)(采集|检测|监测|显示|控制|驱动|报警|通信|上传|调节|识别|定位)/);
    return match ? normalizeKey(`${match[1]}-${match[2]}`) : '';
  }).filter(Boolean);
  if (uniqueBy(methodSignatures).length !== methodSignatures.length) {
    errors.push({ code: 'scheme_function_method_split', message: '同一器件的同类动作被拆成多项功能，请合并后补充另一项独立功能' });
  }
  const functionDescriptions = data.functions.map(item => text(item.description || item.name || item.text));
  const hasControllerDecision = functionDescriptions.some(value =>
    /(?:主控|单片机|STM32|STC|ESP32|ARDUINO|AT89)/i.test(value) &&
    /(?:阈值|超限|条件|判断)/.test(value) &&
    /(?:控制|联动|启停|驱动)/.test(value));
  const hasActuatorThresholdControl = functionDescriptions.some(value =>
    /(?:继电器|电机|风扇|阀|舵机|水泵|气泵|加热|制冷)/.test(value) &&
    /(?:阈值|超限|条件|判断|根据)/.test(value) &&
    /(?:控制|联动|启停|驱动)/.test(value));
  if (hasControllerDecision && hasActuatorThresholdControl) {
    errors.push({ code: 'scheme_control_chain_split', message: '同一自动控制链路被拆成主控判断和执行器动作，请合并为一项完整功能并补充另一项独立功能' });
  }

  const overviewComplete = ['background', 'goal', 'overallDescription'].every(key => text(data.overview?.[key]));
  const architectureComplete = ['inputLayer', 'controlLayer', 'outputLayer', 'communicationLayer'].every(key => text(data.architecture?.[key]));
  const implementationComplete = ['power', 'interfaces', 'development', 'installation'].every(key => text(data.implementationNotes?.[key]));
  const devicesComplete = data.devices.every(item => text(item.model) && text(item.role) && text(item.selectionReason));
  const functionsComplete = data.functions.every(item => text(item.name || item.text) && text(item.description));
  if (data.legacy) {
    warnings.push({ code: 'scheme_legacy_structure', message: '旧版方案可继续读取，但建议补充项目概述、系统架构、选型理由和功能说明' });
  } else {
    if (!overviewComplete) errors.push({ code: 'scheme_overview_incomplete', message: '项目概述需包含背景、目标和总体工作方式' });
    if (!architectureComplete) errors.push({ code: 'scheme_architecture_incomplete', message: '系统架构需说明输入、控制、输出和通信层' });
    if (!implementationComplete) errors.push({ code: 'scheme_implementation_notes_incomplete', message: '实施注意事项需覆盖供电、接口、开发环境和安装布置' });
    if (!devicesComplete) errors.push({ code: 'scheme_device_details_incomplete', message: '每个器件都需说明型号或原称、项目作用和选型理由' });
    if (!functionsComplete) errors.push({ code: 'scheme_function_details_incomplete', message: '每项功能都需说明功能表现及在项目中的作用' });
  }

  const outputText = `${models.join(' ')} ${functionTexts.join(' ')}`;
  const detailedOutputText = [
    ...data.devices.map(item => `${item.model || ''} ${item.name || ''} ${item.role || ''} ${item.selectionReason || ''}`),
    ...data.functions.map(item => `${item.name || item.text || ''} ${item.description || ''}`),
    JSON.stringify(data.overview || {}),
    JSON.stringify(data.architecture || {}),
    JSON.stringify(data.implementationNotes || {}),
  ].join(' ');
  INVALID_OLED_SIZE_PATTERN.lastIndex = 0;
  if (INVALID_OLED_SIZE_PATTERN.test(detailedOutputText)) {
    errors.push({
      code: 'scheme_oled_size_decimal_missing',
      message: 'OLED尺寸误写为“96寸”或“96英寸”；若使用0.96英寸OLED，请改为“0.96寸OLED”',
    });
  }
  if (mode === 'create') {
    for (const rule of SCHEME_IRON_RULES) {
      rule.pattern.lastIndex = 0;
      if (rule.pattern.test(outputText) && !rule.pattern.test(userEvidence)) {
        errors.push({ code: `scheme_${rule.id}`, message: `${rule.reason}；建议使用${rule.suggestion}` });
      }
    }
  }

  if (mode === 'create') {
    const hasSensor = data.devices.some(item => classifyDevice(item) === 'sensor');
    const hasActuator = data.devices.some(item => classifyDevice(item) === 'actuator');
    const hasWireless = /WiFi|无线|蓝牙|ZigBee|LoRa|NRF24|ESP-01|HC-05|云平台|APP/i.test(outputText);
    if ((level === 'A' || level === 'B') && (!hasSensor || !hasActuator)) warnings.push({ code: 'scheme_level_components_advisory', message: '当前方案没有同时识别到采集和输出能力；若这是用户明确设计则保持不变' });
    if (level === 'A' && !/WiFi|云平台|APP|小程序|OneNET/i.test(outputText)) warnings.push({ code: 'scheme_level_a_network_advisory', message: '当前方案未加入云平台或WiFi/APP通信；已按用户补充信息优先处理' });
    if (level === 'B' && !hasWireless) warnings.push({ code: 'scheme_level_b_wireless_advisory', message: '当前方案未加入无线通信；已按用户补充信息优先处理' });
    if (level === 'C' && hasWireless && !/WiFi|无线|蓝牙|ZigBee|LoRa|NRF24|ESP-01|HC-05/i.test(userEvidence)) warnings.push({ code: 'scheme_level_c_extra_wireless', message: 'C级方案自动加入了通信功能，请确认是否确有需要' });
  } else {
    const allowedModels = list(options.allowedDevices).map(item => normalizeKey(typeof item === 'object' ? item.model || item.name : item));
    for (const model of models) {
      if (allowedModels.length && !allowedModels.some(value => value.includes(normalizeKey(model)) || normalizeKey(model).includes(value))) {
        errors.push({ code: 'scheme_added_device', message: `抽取模式新增了未确认器件：${model}` });
      }
    }
    const allowedFunctionTexts = list(options.allowedFunctions).map(item => normalizeKey(typeof item === 'object' ? item.text || item.name : item));
    for (const functionText of functionTexts) {
      if (allowedFunctionTexts.length && !allowedFunctionTexts.some(value => value.includes(normalizeKey(functionText)) || normalizeKey(functionText).includes(value))) {
        errors.push({ code: 'scheme_added_function', message: `整理模式新增了原资料未确认的功能：${functionText}` });
      }
    }
  }
  if (data.conflicts.length) errors.push({ code: 'scheme_unresolved_conflicts', message: `方案仍有${data.conflicts.length}项冲突需要用户确认` });

  return {
    valid: errors.length === 0,
    errors,
    warnings: [...warnings, ...data.warnings],
    data: { ...data, level },
    stats: { devices: models.length, functions: functionTexts.length },
  };
}

function issue(severity, code, message, extra = {}) {
  return { severity, code, message, ...extra };
}

export function runFactChecks(project = {}, options = {}) {
  const phase = options.phase || 'paper';
  const errors = [];
  const warnings = [];
  const sources = new Set(list(project.sources).map(source => source.id));
  const facts = list(project.facts);
  const devices = list(project.devices).map(deviceFrom);
  const functions = list(project.functions).map(functionFrom);
  const conflicts = list(project.conflicts);

  const openBlocking = conflicts.filter(item => item.status !== 'resolved' && item.severity === 'blocking');
  if (openBlocking.length) errors.push(issue('error', 'fact_blocking_conflicts', `仍有${openBlocking.length}项阻断冲突未确认`, { conflictIds: openBlocking.map(item => item.id) }));
  const openConfirm = conflicts.filter(item => item.status !== 'resolved' && item.severity === 'confirm');
  if (openConfirm.length) warnings.push(issue('warning', 'fact_pending_conflicts', `仍有${openConfirm.length}项信息需要确认`, { conflictIds: openConfirm.map(item => item.id) }));

  if (!text(project.topic || project.title)) errors.push(issue('error', 'fact_topic_missing', '论文题目缺失'));
  if (phase === 'paper' && !['locked', 'confirmed'].includes(project.status)) errors.push(issue('error', 'fact_project_unlocked', '项目事实尚未确认并锁定'));

  for (const fact of facts) {
    const missingSources = list(fact.sourceIds).filter(id => !sources.has(id));
    if (missingSources.length) errors.push(issue('error', 'fact_source_missing', `事实“${fact.key || fact.id}”引用了不存在的来源`, { factId: fact.id, sourceIds: missingSources }));
    if (['conflicted', 'missing'].includes(fact.status) && fact.critical !== false) errors.push(issue('error', 'fact_critical_unresolved', `关键事实“${fact.key || fact.id}”尚未解决`, { factId: fact.id }));
    if (phase === 'paper' && ['suggested', 'pending_confirm', 'stale'].includes(fact.status)) errors.push(issue('error', 'fact_not_confirmed', `事实“${fact.key || fact.id}”未确认或已失效`, { factId: fact.id }));
  }

  const modelKeys = devices.map(item => normalizeKey(item.model));
  if (new Set(modelKeys).size !== modelKeys.length) errors.push(issue('error', 'fact_duplicate_devices', '器件清单存在重复型号'));
  const controllers = devices.filter(item => classifyDevice(item) === 'controller');
  if (!controllers.length) errors.push(issue('error', 'fact_controller_missing', '主控制器型号未明确'));
  if (controllers.length > 1) warnings.push(issue('warning', 'fact_multiple_controllers', '检测到多个主控制器，请确认主从关系'));

  const deviceIds = new Set(devices.map(item => item.id));
  for (const func of functions) {
    const invalidDevices = list(func.deviceIds).filter(id => !deviceIds.has(id));
    if (invalidDevices.length) errors.push(issue('error', 'fact_function_unknown_device', `功能“${func.name}”引用了不存在的器件`, { functionId: func.id, deviceIds: invalidDevices }));
    if (phase === 'paper') {
      if (!list(func.deviceIds).length) errors.push(issue('error', 'fact_function_no_hardware', `功能“${func.name}”没有硬件支撑`, { functionId: func.id }));
      if (!list(func.softwareEvidenceIds).length) errors.push(issue('error', 'fact_function_no_software', `功能“${func.name}”没有程序逻辑依据`, { functionId: func.id }));
      if (!func.testId) errors.push(issue('error', 'fact_function_no_test', `功能“${func.name}”没有对应测试项目`, { functionId: func.id }));
    }
  }

  const connections = list(project.connections);
  const connectionKeys = new Map();
  for (const connection of connections) {
    const key = `${connection.deviceId}:${normalizeKey(connection.devicePin)}`;
    const value = normalizeKey(`${connection.controllerPin}:${connection.signal}`);
    if (connectionKeys.has(key) && connectionKeys.get(key) !== value) errors.push(issue('error', 'fact_connection_conflict', `同一器件引脚存在不同连接：${connection.devicePin}`, { connectionId: connection.id }));
    connectionKeys.set(key, value);
    if (phase === 'paper' && !['confirmed', 'locked'].includes(connection.status)) errors.push(issue('error', 'fact_connection_unconfirmed', `连接“${connection.devicePin || connection.id}”尚未确认`, { connectionId: connection.id }));
  }

  if (phase === 'paper') {
    if (!project.hardwareReport || !['confirmed', 'locked'].includes(project.hardwareReport.status)) errors.push(issue('error', 'fact_hardware_report', '硬件连接与电气关系报告尚未确认'));
    if (!project.programReport || !['confirmed', 'locked'].includes(project.programReport.status)) errors.push(issue('error', 'fact_program_report', '程序逻辑报告尚未确认'));
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    metrics: {
      facts: facts.length,
      devices: devices.length,
      functions: functions.length,
      openBlockingConflicts: openBlocking.length,
    },
  };
}

export function stripNonBody(value) {
  return text(value)
    .replace(/【非正文·[\s\S]*?【非正文结束】/g, '')
    .replace(/【(?:图|表)[^】]*——待插入】/g, '')
    .replace(/^#{1,6}\s+.*$/gm, '')
    .replace(/^\s*\|.*\|\s*$/gm, '')
    .replace(/\[(?:\d+)\]/g, '')
    .trim();
}

export function countEffectiveBodyChars(chapters) {
  return chapterEntries(chapters).reduce((sum, [, content]) => {
    const body = stripNonBody(content);
    const han = (body.match(/[\u3400-\u9fff]/g) || []).length;
    const latinWords = (body.match(/\b[A-Za-z][A-Za-z0-9-]*\b/g) || []).length;
    return sum + han + latinWords;
  }, 0);
}

function duplicateParagraphs(chapters) {
  const seen = new Map();
  const duplicates = [];
  for (const [chapter, content] of chapterEntries(chapters)) {
    const paragraphs = stripNonBody(content).split(/\n\s*\n/).map(text).filter(value => value.length >= 40);
    paragraphs.forEach(paragraph => {
      const key = normalizeKey(paragraph);
      if (seen.has(key)) duplicates.push({ paragraph, firstChapter: seen.get(key), chapter });
      else seen.set(key, chapter);
    });
  }
  return duplicates;
}

function validateArtifacts(artifacts, chapters) {
  const errors = [];
  const warnings = [];
  const ids = new Set();
  const content = chapterEntries(chapters).map(([, value]) => value).join('\n');
  for (const artifact of list(artifacts)) {
    if (!artifact.id || ids.has(artifact.id)) errors.push(issue('error', 'artifact_duplicate_id', `图表ID缺失或重复：${artifact.id || '（空）'}`));
    ids.add(artifact.id);
    if (artifact.required !== false && !text(artifact.placeholder)) errors.push(issue('error', 'artifact_placeholder_missing', `图表“${artifact.title}”缺少占位符`, { artifactId: artifact.id }));
    const placeholderCount = artifact.placeholder ? content.split(artifact.placeholder).length - 1 : 0;
    const referenceCount = artifact.bodyReference ? content.split(artifact.bodyReference).length - 1 : 0;
    if (artifact.required !== false && artifact.placeholder && !placeholderCount) errors.push(issue('error', 'artifact_not_in_body', `正文缺少图表占位“${artifact.title}”`, { artifactId: artifact.id }));
    if (artifact.required !== false && placeholderCount > 1) errors.push(issue('error', 'artifact_placeholder_duplicate', `图表“${artifact.title}”的正式图位出现了 ${placeholderCount} 次，同一张图只能保留一个图位`, { artifactId: artifact.id }));
    if (artifact.required !== false && artifact.bodyReference && !referenceCount) errors.push(issue('error', 'artifact_reference_missing', `正文未先引用图表“${artifact.title}”`, { artifactId: artifact.id }));
    if (artifact.required !== false && referenceCount > 1) errors.push(issue('error', 'artifact_reference_duplicate', `图表“${artifact.title}”的首次引出出现了 ${referenceCount} 次，同一张图只能写一次“如图所示”`, { artifactId: artifact.id }));
    if (artifact.required !== false && placeholderCount && referenceCount && content.indexOf(artifact.bodyReference) > content.indexOf(artifact.placeholder)) errors.push(issue('error', 'artifact_reference_after_placeholder', `图表“${artifact.title}”应先在正文中引用，再放置正式图位`, { artifactId: artifact.id }));
    if (artifact.required !== false && artifact.nonBodyInstruction && !content.includes(artifact.nonBodyInstruction)) warnings.push(issue('warning', 'artifact_instruction_missing', `图表“${artifact.title}”缺少详细非正文说明`, { artifactId: artifact.id }));
  }
  return { errors, warnings };
}

function codeLikeIssues(chapters) {
  const errors = [];
  for (const [chapter, raw] of chapterEntries(chapters)) {
    const content = stripNonBody(raw);
    if (/```(?:c|cpp|c\+\+|arduino)?[\s\S]*?```/i.test(content)) errors.push(issue('error', 'paper_code_block', `第${chapter}章正文包含代码块`));
    if (/\b(?:HAL_|LL_|MX_)[A-Za-z0-9_]*\s*\(|\b[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+\s*\(/.test(content)) errors.push(issue('error', 'paper_function_name', `第${chapter}章使用了函数名或库API介绍程序`));
  }
  return errors;
}

function testEvidenceIssues(project, chapters) {
  const chapter5 = chapterEntries(chapters).find(([number]) => number === '5')?.[1] || '';
  const result = [];
  const hasMarkdownTable = /^\s*\|[^\n]+\|\s*\n\s*\|(?:\s*:?-{3,}:?\s*\|)+/m.test(chapter5);
  const quantities = chapter5.match(/\d+(?:\.\d+)?\s*(?:%|℃|°C|ms|s|秒|分钟|min|h|小时|V|mV|A|mA|lx|ppm|cm|mm|m|次)(?![A-Za-z])/gi) || [];
  if (!hasMarkdownTable) result.push(issue('error', 'paper_test_table_missing', '第五章缺少量化测试数据表，必须用表格列出测试项目、条件、数据和结论'));
  if (quantities.length < 3) result.push(issue('error', 'paper_test_quantities_missing', '第五章量化测试数据不足，至少应在测试表和分析中给出多个带单位的可核对数值'));
  if (/100\s*%|零误差|误差为\s*0(?:\.0+)?\b/.test(chapter5)) result.push(issue('warning', 'paper_test_absolute_result', '测试结果含100%或零误差等绝对化数据，请确认是否符合真实条件'));
  return result;
}

function acknowledgmentIssues(value) {
  const content = text(value);
  const errors = [];
  if (!content) return [issue('error', 'paper_acknowledgment_missing', '致谢尚未生成')];
  if (content.length < 140) errors.push(issue('error', 'paper_acknowledgment_too_short', '致谢内容过短，应结合选题、调试、验证和论文整理等实际环节表达感谢'));
  if (/时光荏苒|白驹过隙|岁月如梭|光阴似箭|转眼间.*大学/.test(content)) errors.push(issue('error', 'paper_acknowledgment_template', '致谢使用了明显模板化开头，请改为具体、朴实的项目过程表达'));
  const namedPeople = [...content.matchAll(/(?:感谢|感激|致谢)(?:我的|本人的)?(?:导师|指导教师|老师|教授)?[：:，,\s]*([\u4e00-\u9fff]{2,4})(?:老师|教授|同学|先生|女士)/g)]
    .map(match => match[1]);
  if (namedPeople.length) errors.push(issue('error', 'paper_acknowledgment_person_name', `致谢不得出现人名：${uniqueBy(namedPeople).join('、')}`));
  return errors;
}

/** Final deterministic gate. Semantic review should run separately after this. */
export function runFinalQualityChecks({ project = {}, chapters = {}, outline = [], references = [], bibliography = null, artifacts = [], abstractCn = '', abstractEn = '', acknowledgment = '', minimumBodyChars = MIN_FINAL_BODY_CHARS } = {}) {
  const errors = [];
  const warnings = [];
  const factResult = runFactChecks(project, { phase: 'paper' });
  errors.push(...factResult.errors);
  warnings.push(...factResult.warnings);

  const entries = chapterEntries(chapters);
  const expectedChapters = list(outline).length || 6;
  if (entries.filter(([, content]) => content).length < expectedChapters) errors.push(issue('error', 'paper_chapters_missing', '论文章节未全部生成'));
  for (const [number, value] of entries) {
    if (!value) errors.push(issue('error', 'paper_chapter_empty', `第${number}章内容为空`));
    const chapterObject = Array.isArray(chapters)
      ? chapters.find(item => String(item.number || item.chapterNumber) === number)
      : typeof chapters[number] === 'object' ? chapters[number] : null;
    if (chapterObject && !['confirmed', 'locked'].includes(chapterObject.status)) errors.push(issue('error', 'paper_chapter_unlocked', `第${number}章尚未确认锁定`));
    if (chapterObject?.inputRevision && project.factRevision && chapterObject.inputRevision !== project.factRevision) errors.push(issue('error', 'paper_chapter_stale', `第${number}章依据旧事实版本生成`));
  }

  const effectiveBodyChars = countEffectiveBodyChars(chapters);
  if (effectiveBodyChars < minimumBodyChars) errors.push(issue('error', 'paper_body_too_short', `正文有效字数为${effectiveBodyChars}，不得低于${minimumBodyChars}`));

  const citationResult = validateReferences({ references, chapters, bibliography, requireAllSelected: true });
  errors.push(...citationResult.errors.map(item => ({ severity: 'error', ...item })));
  warnings.push(...citationResult.warnings.map(item => ({ severity: 'warning', ...item })));

  const artifactResult = validateArtifacts(artifacts, chapters);
  errors.push(...artifactResult.errors);
  warnings.push(...artifactResult.warnings);
  errors.push(...codeLikeIssues(chapters));
  errors.push(...testEvidenceIssues(project, chapters));

  const duplicates = duplicateParagraphs(chapters);
  duplicates.forEach(item => errors.push(issue('error', 'paper_duplicate_paragraph', `第${item.chapter}章与第${item.firstChapter}章存在完全重复段落`)));

  if (!text(abstractCn)) errors.push(issue('error', 'paper_cn_abstract_missing', '中文摘要尚未生成'));
  if (!text(abstractEn)) errors.push(issue('error', 'paper_en_abstract_missing', '英文摘要尚未生成'));
  if (text(abstractCn) && /\[\d+\]/.test(abstractCn)) errors.push(issue('error', 'paper_abstract_citation', '摘要不得出现参考文献引用'));
  errors.push(...acknowledgmentIssues(acknowledgment));

  const unresolved = list(project.conflicts).filter(item => item.status !== 'resolved');
  if (unresolved.some(item => item.severity === 'blocking')) errors.push(issue('error', 'paper_conflict_remaining', '最终稿仍存在阻断冲突'));

  return {
    valid: errors.length === 0,
    status: errors.length ? 'draft' : 'final',
    errors,
    warnings,
    metrics: {
      effectiveBodyChars,
      minimumBodyChars,
      chapters: entries.filter(([, content]) => content).length,
      citations: citationResult.occurrences.length,
      artifacts: list(artifacts).length,
      duplicateParagraphs: duplicates.length,
      openBlockingConflicts: factResult.metrics.openBlockingConflicts,
    },
    orderedReferences: citationResult.orderedReferences,
  };
}

const Rules = Object.freeze({
  RULES_VERSION,
  MIN_FINAL_BODY_CHARS,
  SCHEME_LEVELS,
  SCHEME_IRON_RULES,
  SCHEME_SYSTEM_PROMPT,
  PAPER_BASE_SYSTEM_PROMPT,
  buildDefaultOutline,
  flattenOutline,
  buildWordTargets,
  buildChapterContracts,
  makeArtifactSpec,
  parseReferences,
  formatReferenceRecord,
  validateReferences,
  parseSchemeResult,
  validateSchemeResult,
  runFactChecks,
  stripNonBody,
  countEffectiveBodyChars,
  runFinalQualityChecks,
});

export default Rules;
