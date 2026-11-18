const key = value => String(value || '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
const label = device => `${device?.model || device?.name || ''} ${device?.role || ''}`;
const SUPPORT = /电阻|电容|晶振|复位电路|下载接口|调试接口|SWD|JTAG|PCB(?:电路)?板|面包板|接线端子|杜邦线|散热片|编程软件|云平台|手机APP|嘉立创/i;
const FIXED_REGULATOR = /AMS1117|LM1117|78(?:05|12)|79(?:05|12)|HT7333|XC6206/i;
const SENSING = /INA2\d\d|ACS7\d\d|ZMPT|光敏|热敏|NTC|PT100|电阻(?:式|型)?传感|电容式(?:触摸|土壤|液位)|电压(?:电流)?(?:检测|采集|传感)|电流(?:电压)?(?:检测|采集|传感)|电能(?:检测|计量)|电量检测|电源监测|功率(?:检测|计量)/i;
const ACTUATOR = /继电器|MOSFET|MOS管|负载开关|电机驱动|L298|TB6612|ULN2003/i;
const POWER = /电源|供电|稳压|降压|升压|充电|电池|整流|LM2596|MP1584|XL4015|MT3608|TP4056|DC[\s-]*DC/i;
const POWER_CONTROL = /^(?:EN|ENABLE|CE|SHDN|SHUTDOWN|PG|PGOOD|POWERGOOD|CHRG|CHARGE|STDBY|STAT\d*|STATUS|FAULT|ALERT|INT|IRQ|SCL|SDA|SCK|MOSI|MISO|CS|TX|RX)$/i;
const SUPPLY_PIN = /^(?:VCC|VDD\w*|VSS\w*|GND|AGND|DGND|PGND|VIN|VOUT|VBAT|VREF[+-]?|DCIN|DCOUT|3[.,]3V|3V3|5V|12V|24V|0V|NRST|BOOT[01]|OSC_IN|OSC_OUT|V[+-]|电源|供电|接地|共地)(?:\s*[/（(].*)?$/i;

export function isSignalPeripheral(device) {
  const text = label(device);
  if (SENSING.test(text) || ACTUATOR.test(text)) return true;
  return !SUPPORT.test(text) && !FIXED_REGULATOR.test(text) && !POWER.test(text)
    && !/主控|从控|微控制器|单片机|最小系统/.test(device?.role || '');
}

// Keep complete hardware facts for thesis writing. Only signal connections
// belong in the GPIO editor; never turn supply terminals into fallback GPIOs.
export function filterSignalMappings(mappings = [], devices = []) {
  return mappings.filter(mapping => {
    if (!String(mapping?.device || mapping?.deviceModel || '').trim() || !String(mapping?.signal || mapping?.connection || '').trim()) return false;
    const signal = String(mapping.signal || mapping.connection).trim();
    if (SUPPLY_PIN.test(signal) || SUPPLY_PIN.test(String(mapping.pin || '').trim())) return false;
    if (/^(?:POWER|SUPPLY|电源|供电)$/i.test(String(mapping.interfaceType || mapping.interface || '').trim())) return false;
    const name = key(mapping.device || mapping.deviceModel);
    const device = devices.find(item => key(item.model || item.name) === name
      && (!item.boardId || !mapping.boardId || item.boardId === mapping.boardId));
    const text = `${mapping.device || mapping.deviceModel} ${device?.role || ''}`;
    if (SENSING.test(text) || ACTUATOR.test(text)) return true;
    if (SUPPORT.test(text) || FIXED_REGULATOR.test(text)) return false;
    // Generic CTRL on a regulator is not evidence of an actual control input.
    if (POWER.test(text)) return POWER_CONTROL.test(signal);
    return true;
  });
}

export function signalMappedDevices(devices = [], mappings = []) {
  const valid = filterSignalMappings(mappings, devices);
  return devices.filter(device => valid.some(mapping => key(device.model || device.name) === key(mapping.device || mapping.deviceModel)
    && (!device.boardId || !mapping.boardId || device.boardId === mapping.boardId)));
}
