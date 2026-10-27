// 仅用于新方案生成；不改变历史方案、论文资料或论文写作规则。
const CLOUD_NAMES = [
  ['OneNET', /onenet|中移物联网/i],
  ['阿里云IoT', /阿里云(?:iot)?|aliyun|alibaba\s*cloud/i],
  ['巴法云', /巴法云|bemfa/i],
  ['点灯科技 Blinker', /点灯(?:科技|平台|云)|blinker/i],
  ['私有物联网服务器', /私有物联网服务器/],
  ['腾讯云', /腾讯云|tencent\s*cloud/i],
  ['华为云', /华为云|huawei\s*cloud/i],
  ['机智云', /机智云|gizwits/i],
  ['涂鸦云', /涂鸦(?:云|智能)|tuya/i],
  ['Blynk', /blynk/i],
  ['ThingsBoard', /thingsboard/i],
  ['AWS IoT', /aws\s*iot/i],
  ['Azure IoT', /azure\s*iot/i],
];
const CLOUD_USAGE = /云平台|云端|云服务|公有云|云服务器|物联网平台|(?:上传|接入|连接|对接)(?:到|至)?云/;
const CONTROLLER_MODEL = /STM32[A-Z0-9]+|STC[A-Z0-9]+|AT89[A-Z0-9]+|ESP32(?:[-_][A-Z0-9]+)*|Arduino(?:\s+(?:UNO(?:\s*R3)?|Nano|Mega(?:\s*2560)?))?|ATmega\d+[A-Z0-9]*|RP2040|MSP430[A-Z0-9]+|PIC\d+[A-Z0-9]+/gi;
const DISPLAY_MODEL = /(?:0\.96\s*寸\s*)?OLED|LCD\s*1602|1\.8\s*寸\s*TFT|数码管/gi;
const DISPLAY_USAGE = /OLED|LCD|TFT|数码管|(?:显示|触摸|液晶|电子墨水|彩)屏|屏幕|点阵屏/i;
const DEVELOPMENT_ONLY = /(?:编译|烧录|下载程序|下载固件|生成代码|配置工程|搭建开发环境|程序调试|程序编写)/;
const APP_NAMES = [
  ['MIT App Inventor', /(?:MIT\s*)?App\s*Inventor/i],
  ['Android Studio', /Android\s*Studio/i],
  ['微信小程序', /微信小程序/],
];
const APP_USAGE = /\bAPP\b|App\s*Inventor|Android\s*Studio|微信小程序|手机(?:端|应用|远程|查看|控制|直连|连接|交互)|移动端/i;
const NETWORK_USAGE = /ESP[ -]?0?1S|ESP8266|HC[ -]?(?:05|06|08|12)\b|NRF24|SIM800|SIM900|SIM7600|EC20|EC200|W5500|ENC28J60|CC2530|SX127\d|SX126\d|Wi[ -]?Fi|无线(?:通信|传输|联网|控制|模块)|蓝牙|LoRa|ZigBee|NB[ -]?IoT|4G|5G|GSM|以太网|通信模块|联网|网络通信|远程(?:查看|控制|监测)|手机(?:端|应用|远程|查看|控制|直连|连接|交互)|移动端/i;
const COMMUNICATION_MODEL = /ESP[ -]?0?1S|ESP8266|ESP32|HC[ -]?(?:05|06|08|12)\b|NRF24|SIM800|SIM900|SIM7600|EC20|EC200|W5500|ENC28J60|CC2530|SX127\d|SX126\d|蓝牙|Wi[ -]?Fi|LoRa|ZigBee|NB[ -]?IoT|4G|5G|GSM|以太网|通信模块|无线模块/i;

function compact(value) { return String(value || '').replace(/[\s_（）()·-]/g, '').toLowerCase(); }
function distinct(values) { return [...new Set((values || []).map(value => String(value).trim()).filter(Boolean))]; }
function clauses(text) { return String(text || '').split(/[\n，,。；;]|(?:但是|但|而)(?=(?:使用|采用|用|改用|改为))/).map(value => value.trim()).filter(Boolean); }
function isNegated(clause, index) {
  return /(?:不要|不用|不使用|不采用|不选(?:择)?|不需要|不依赖|不接入|不连接|不经过|不借助|不能|禁止|避免|无需|而不是|不是)[^，,。；;\n]{0,12}$/.test(clause.slice(0, index));
}

function positiveMention(text, pattern) {
  const scanner = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
  return clauses(text).some(clause => [...clause.matchAll(scanner)].some(match => !isNegated(clause, match.index)));
}

function requestedModel(requirements, pattern, kind) {
  let selected = '';
  for (const clause of clauses(requirements)) {
    for (const match of clause.matchAll(pattern)) {
      if (isNegated(clause, match.index)) continue;
      const before = clause.slice(0, match.index);
      const after = clause.slice(match.index + match[0].length);
      // 对比候选、通信配套器件不能被误解为主控替换。
      const assigned = kind === 'controller'
        ? /(?:主控|单片机|控制器)(?:芯片)?[^。；;]{0,12}$/.test(before)
          || /^(?:使用|采用|用|基于|改为|换成)\s*$/.test(before)
          || /(?:必须|指定|要求)(?:要)?(?:使用|采用|用)?\s*$/.test(before)
          || /^\s*(?:作为|用作|做)(?:主控|单片机|控制器)/.test(after)
        : /(?:屏幕|显示屏|显示器)[^。；;]{0,10}$/.test(before)
          || /(?:使用|采用|改为|换成|指定)\s*$/.test(before)
          || /^\s*(?:屏幕|显示屏)/.test(after);
      if (kind === 'controller' && /(?:作为|用作|做|进行|实现)(?:WiFi|无线|蓝牙|通信|协处理)/i.test(after)) continue;
      if (assigned || compact(clause) === compact(match[0])) selected = match[0].trim();
    }
  }
  return selected;
}

export function buildSchemePolicy({ title = '', functionCount, preferences = {}, requirements = '' } = {}) {
  const controller = requestedModel(requirements, CONTROLLER_MODEL, 'controller') || preferences.controller || 'auto';
  let display = requestedModel(requirements, DISPLAY_MODEL, 'display') || preferences.display || 'auto';
  let cloudPlatforms = distinct(preferences.cloudPlatforms);
  let cloudMode = cloudPlatforms.length ? 'selected' : 'none';
  // 按附加要求的先后顺序处理明确指令；普通“手机远程查看”不等于需要云。
  for (const clause of clauses(requirements)) {
    if (/(?:不使用|不要|不用|无需|不需要|禁止)[^，,。；;\n]{0,8}(?:屏幕|显示屏|OLED|LCD|TFT|数码管)/i.test(clause)) display = 'none';
    const requestedDisplay = requestedModel(clause, DISPLAY_MODEL, 'display');
    if (requestedDisplay) display = requestedDisplay;
  }
  let hasExplicitCloudSelection = false;
  for (const clause of clauses(requirements)) {
    if (/(?:不使用|不要|不用|无需|不需要|禁止)[^，,。；;\n]{0,8}(?:云平台|云服务|云端|公有云|物联网平台)/.test(clause)) {
      cloudPlatforms = []; cloudMode = 'none'; hasExplicitCloudSelection = true;
      continue;
    }
    const rejectedNames = CLOUD_NAMES.filter(([, pattern]) => {
      const match = clause.match(pattern);
      return match && isNegated(clause, match.index);
    }).map(([name]) => name);
    if (rejectedNames.length) {
      cloudPlatforms = cloudPlatforms.filter(name => !rejectedNames.some(rejected => platformMatches(name, rejected)));
      cloudMode = cloudPlatforms.length ? 'selected' : 'none';
      hasExplicitCloudSelection = true;
    }
    const names = CLOUD_NAMES.filter(([, pattern]) => {
      const match = clause.match(pattern);
      return match && !isNegated(clause, match.index)
        && !/仅供参考|用于对比|作为候选|对比方案/.test(clause);
    }).map(([name]) => name);
    if (names.length) {
      cloudPlatforms = hasExplicitCloudSelection && cloudMode === 'selected' ? distinct([...cloudPlatforms, ...names]) : names;
      cloudMode = 'selected'; hasExplicitCloudSelection = true;
    } else if (/(?:需要|使用|采用|接入|连接|对接|上传到|上传至)[^，,。；;\n]{0,8}(?:云平台|云端|云服务|物联网平台)/.test(clause)
      && !/(?:不要|不用|不使用|无需|不需要|禁止)/.test(clause) && cloudMode === 'none') {
      cloudMode = 'generic';
    }
  }
  let appSoftware = distinct(preferences.appSoftware);
  let appMode = appSoftware.length ? 'selected' : 'none';
  let explicitAppTools = false;
  for (const clause of clauses(requirements)) {
    if (/(?:不使用|不要|不用|无需|不需要|禁止)[^，,。；;\n]{0,8}(?:APP|手机应用|手机端|移动端|小程序)/i.test(clause)) {
      appSoftware = []; appMode = 'none'; explicitAppTools = false;
      continue;
    }
    const names = APP_NAMES.filter(([, pattern]) => positiveMention(clause, pattern)).map(([name]) => name);
    if (names.length) {
      appSoftware = explicitAppTools ? distinct([...appSoftware, ...names]) : names;
      explicitAppTools = true; appMode = 'selected';
    } else if (positiveMention(clause, APP_USAGE) && appMode === 'none') appMode = 'generic';
  }
  const communicationAllowed = appMode !== 'none' || cloudMode !== 'none' || positiveMention(requirements, NETWORK_USAGE);
  const targetCount = Math.max(3, Math.min(20, Math.trunc(Number(functionCount) || 8)));
  return {
    functionCount: targetCount,
    functionCountMin: Math.max(3, targetCount - 2),
    functionCountMax: Math.min(20, targetCount + 2),
    scene: scenePolicy(title),
    controller, display, cloudMode, cloudPlatforms,
    programmingSoftware: distinct(preferences.programmingSoftware),
    appSoftware, appMode, communicationAllowed,
  };
}

function modelMatches(actual, expected) {
  const candidate = compact(actual);
  const wanted = compact(expected);
  if (wanted === 'esp32') return /^esp32(?:$|s\d|c\d|h\d|p\d|wroom|wrover|dev|开发|最小)/.test(candidate);
  if (wanted === 'oled') return candidate.includes('oled');
  if (/^\d+(?:\.\d+)?寸oled$/.test(wanted)) return candidate.includes('oled') && candidate.includes(wanted.replace('oled', ''));
  if (wanted === 'lcd1602') return candidate.includes('lcd1602');
  if (/^\d+(?:\.\d+)?寸tft$/.test(wanted)) return candidate.includes('tft') && candidate.includes(wanted.replace('tft', ''));
  if (wanted === '数码管') return candidate.includes('数码管');
  if (wanted === 'arduino') return candidate.includes('arduino');
  if (candidate === wanted) return true;
  return candidate.startsWith(wanted) && /^(?:主控|单片机|芯片|最小系统|开发板|模块|屏幕|显示屏|板|屏)/.test(candidate.slice(wanted.length));
}

function platformMatches(text, name) {
  const known = CLOUD_NAMES.find(([canonical, pattern]) => canonical === name || pattern.test(name));
  return known ? positiveMention(text, known[1]) : compact(text).includes(compact(name));
}

function scenePolicy(title) {
  const value = String(title || '');
  if (/寝室|宿舍/.test(value)) {
    return {
      label: '寝室或宿舍管理',
      forbidden: /温室|大棚|灌溉|农田|鱼缸|水泵|车辆|汽车|停车|宠物喂养|快递分拣|充电桩/,
    };
  }
  if (/温室|大棚|农业|农田|灌溉/.test(value)) {
    return {
      label: '农业或温室管理',
      forbidden: /车辆定位|停车缴费|宠物喂养|快递分拣|寝室门禁/,
    };
  }
  if (/鱼缸|水族/.test(value)) {
    return {
      label: '水族或鱼缸管理',
      forbidden: /车辆定位|停车缴费|温室灌溉|快递分拣|寝室门禁/,
    };
  }
  return null;
}

export function schemeResultIssues(result, policy) {
  const issues = [];
  const devices = Array.isArray(result?.devices) ? result.devices : [];
  const functions = Array.isArray(result?.functions) ? result.functions : [];
  const deviceText = devices.map(device => `${device.model || ''}（${device.role || ''}）`).join('\n');
  const functionText = functions.join('\n');
  const allText = `${deviceText}\n${functionText}`;
  if (!devices.length) issues.push('方案缺少器件清单');
  const functionMin = policy.functionCountMin || Math.max(3, policy.functionCount - 2);
  const functionMax = policy.functionCountMax || Math.min(20, policy.functionCount + 2);
  if (functions.length < functionMin || functions.length > functionMax) {
    issues.push(`功能数量明显偏离参考值${policy.functionCount}，当前为${functions.length}条；应优先保留真实且符合场景的功能`);
  }
  if (policy.scene?.forbidden) {
    const unrelated = functions.filter(item => policy.scene.forbidden.test(String(item || '')));
    if (unrelated.length) issues.push(`存在与${policy.scene.label}场景不匹配的功能：${unrelated.join('；')}`);
  }
  if (functions.some(text => DEVELOPMENT_ONLY.test(text))) issues.push('编译、烧录、程序编写等开发过程不能作为独立功能');
  if (policy.controller !== 'auto') {
    if (!devices.some(device => modelMatches(device.model, policy.controller))) issues.push(`主控必须使用${policy.controller}`);
    const otherControllers = devices.filter(device => /主控|主控制器/.test(device.role || '') && !modelMatches(device.model, policy.controller));
    if (otherControllers.length) issues.push(`不得另加${otherControllers.map(device => device.model).join('、')}作为主控`);
    const mentioned = [...functionText.matchAll(CONTROLLER_MODEL)].map(match => match[0]);
    if (mentioned.some(model => !modelMatches(model, policy.controller)
      && !devices.some(device => modelMatches(device.model, model) && !/主控|主控制器/.test(device.role || '')))) issues.push('功能中仍使用了与指定主控不一致且未列入器件清单的型号');
  }
  if (policy.display === 'none') {
    if (DISPLAY_USAGE.test(allText)) issues.push('已选择不使用屏幕，不得加入屏幕器件或屏幕显示功能');
  } else if (policy.display !== 'auto') {
    if (!devices.some(device => modelMatches(device.model, policy.display))) issues.push(`屏幕必须使用${policy.display}`);
    if (devices.some(device => DISPLAY_USAGE.test(`${device.model} ${device.role}`) && !modelMatches(device.model, policy.display))) issues.push('不得加入未选择的其他屏幕');
    const family = /OLED/i.test(policy.display) ? 'oled' : /LCD/i.test(policy.display) ? 'lcd' : /TFT/i.test(policy.display) ? 'tft' : '数码管';
    if ([...functionText.matchAll(/OLED|LCD(?:1602|12864)?|TFT|数码管/gi)].some(match => !match[0].toLowerCase().startsWith(family))) issues.push('功能中的显示器件与所选屏幕不一致');
  }
  const usedPlatforms = CLOUD_NAMES.filter(([, pattern]) => positiveMention(allText, pattern)).map(([name]) => name);
  if (!policy.communicationAllowed) {
    const extraModules = devices.filter(device => {
      const isMainController = policy.controller === 'auto'
        ? /主控|单片机|主控制器|控制核心|开发板/.test(device.role || '')
        : modelMatches(device.model, policy.controller);
      return !isMainController && COMMUNICATION_MODEL.test(`${device.model || ''} ${device.role || ''}`);
    });
    if (extraModules.length) issues.push(`APP和云平台均未使用，不得加入额外通信模块：${extraModules.map(device => device.model).join('、')}`);
    if (positiveMention(functionText, NETWORK_USAGE)) issues.push('APP和云平台均未使用，不得自动增加无线联网、手机交互或远程控制功能；应补充项目本地功能');
  }
  if (policy.cloudMode === 'none') {
    if (positiveMention(allText, CLOUD_USAGE) || usedPlatforms.length) issues.push('未选择云平台且附加要求未明确需要云，不得加入云平台、云端上传或云端控制');
  } else {
    if (policy.cloudMode === 'selected') {
      policy.cloudPlatforms.forEach(name => {
        if (!platformMatches(functionText, name)) issues.push(`功能中需要说明${name}用于哪些数据上传、查看或控制`);
      });
    }
    const unexpected = usedPlatforms.filter(name => !policy.cloudPlatforms.some(selected => platformMatches(selected, name)));
    if (unexpected.length) issues.push(`不得擅自增加云平台：${unexpected.join('、')}`);
    if (policy.cloudMode === 'generic' && !positiveMention(functionText, CLOUD_USAGE)) issues.push('附加要求需要云平台，功能中应体现云端上传、查看或控制，但不要擅自指定品牌');
  }
  if (devices.some(device => CLOUD_USAGE.test(device.model) || CLOUD_NAMES.some(([, pattern]) => pattern.test(device.model)))) issues.push('云平台不能作为实体器件，应在对应功能中说明');
  if (policy.appMode === 'none') {
    if (APP_NAMES.some(([, pattern]) => positiveMention(functionText, pattern))) issues.push('未选择APP设计软件，不得自行增加自制APP或小程序的开发工具');
    if (policy.cloudMode === 'none' && positiveMention(functionText, APP_USAGE)) issues.push('未选择APP且附加要求未要求APP，不得自动加入手机APP或小程序功能');
  }
  policy.appSoftware.forEach(name => {
    const known = APP_NAMES.find(([canonical]) => canonical === name);
    if (!(known ? positiveMention(functionText, known[1]) : compact(functionText).includes(compact(name)))) issues.push(`需要体现所选${name}实现的手机或小程序交互功能`);
  });
  return distinct(issues);
}
