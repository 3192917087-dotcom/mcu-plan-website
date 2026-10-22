import { devicePlanGroups } from './paper-preflight.js?v=20261017-2';
import { parseReferenceOutline, referenceHasSelection } from './outline-policy.js?v=20261018-3';

// Select representative core components; repeated relay channels share one
// selection discussion while their actual circuits and mappings stay distinct.
export function planDeviceSelection({ devices = [], controller = '', functions = [], targetBodyChars = 15000, referenceText = '' } = {}) {
  const reference = parseReferenceOutline(referenceText);
  const brief = Boolean(reference.rawText && !referenceHasSelection(reference));
  const expanded = !brief && Number(targetBodyChars) > 20000;
  const limit = brief ? 3 : expanded ? Math.min(8, 5 + Math.floor((Number(targetBodyChars) - 20001) / 5000)) : 4;
  const groups = devicePlanGroups(devices, controller);
  const seen = new Set();
  const functionsText = functions.map(item => typeof item === 'string' ? item : item.name || item.source || '').join(' ');
  const ranked = groups.filter(device => {
    const name = String(device.model || '').replace(/[（(].*$/, '').trim().toLowerCase();
    if (seen.has(name) || /电阻|电容|晶振|复位|排针|杜邦线|稳压|电源模块/.test(`${device.model} ${device.role}`)) return false;
    seen.add(name); return true;
  }).map((device,index) => {
    const text = `${device.model} ${device.role}`;
    const category = /主控|单片机|微控制器/.test(device.role || '') || device.model === controller ? 'controller'
      : /OLED|LCD|屏|显示/.test(text) ? 'display'
        : /通信|WiFi|蓝牙|LoRa|ESP-01S|HC-05|GSM/.test(text) ? 'communication'
          : /执行|继电器|舵机|电机|风扇|水泵|阀|加热/.test(text) ? 'actuator'
            : /按键|蜂鸣|LED|指示灯/.test(text) ? 'support' : 'sensor';
    const score = ({controller:100,sensor:70,actuator:65,communication:60,display:45,support:15})[category]
      + (functionsText.includes(device.model) ? 5 : 0);
    return {device,category,score,index};
  }).sort((a,b) => b.score - a.score || a.index - b.index);
  const chosen = [];
  for (const category of ['controller','sensor','actuator','communication','display']) {
    const item = ranked.find(record => record.category === category);
    if (item && chosen.length < limit) chosen.push(item);
  }
  for (const item of ranked) if (chosen.length < limit && !chosen.includes(item)) chosen.push(item);
  return { mode: brief ? 'brief' : expanded ? 'expanded' : 'standard', devices: chosen.map(item => item.device),
    referenceHasSelection: !brief && Boolean(reference.rawText),
    description: brief ? '参考未单列选型，简要论证最重要的器件，不扩写为全器件介绍' : expanded ? '篇幅较大，适度增加关键器件比较与设计依据' : '集中论证三四个重要器件，辅助器件在电路说明中简要交代' };
}
