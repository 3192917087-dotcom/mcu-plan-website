import assert from 'node:assert/strict';
import {filterSignalMappings, isSignalPeripheral, signalMappedDevices} from '../hardware-signals.js';
import {paperMaterialPreflight} from '../paper-preflight.js';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {compatiblePins, validateMappings} from '../pin-data.js';

let checks = 0;
for (const model of ['AMS1117-3.3', '7805稳压电路', '5V电源模块', 'LM2596降压模块', '10kΩ上拉电阻', '10kΩ电阻', '滤波电容', '晶振', '复位电路', 'SWD下载接口', 'PCB电路板', '手机APP', '云平台']) {
  assert.equal(isSignalPeripheral({model}), false, model);
  assert.equal(filterSignalMappings([{device:model, signal:'CTRL', pin:'PA0', interfaceType:'GPIO'}]).length, 0, model);
  checks++;
}
for (const [model, signal, type] of [['DHT11','DATA','GPIO'], ['OLED','SCL','I2C'], ['INA219','SDA','I2C'], ['电压检测模块','AO','ADC'], ['光敏电阻','AO','ADC'], ['NTC热敏电阻','AO','ADC'], ['电源控制继电器','CTRL','GPIO'], ['MOS管负载开关','EN','GPIO'], ['TP4056充电模块','CHRG','GPIO'], ['LM2596降压模块','EN','GPIO']]) {
  assert.equal(filterSignalMappings([{device:model, signal, pin:'PA0', interfaceType:type}]).length, 1, model);
  checks++;
}
for (const supply of ['VCC','GND','VDD','VDDA','VSS','VIN','VOUT','3.3V','3V3','5V','12V','VBAT','NRST']) {
  assert.equal(filterSignalMappings([{device:'DHT11',signal:supply,pin:'PA0'}]).length, 0, supply);
  assert.equal(filterSignalMappings([{device:'DHT11',signal:'DATA',pin:supply}]).length, 0, supply);
  checks++;
}
const devices = [{id:'power',model:'AMS1117',role:'3.3V稳压'}, {id:'sensor',model:'DHT11'}, {id:'oled',model:'OLED'}];
const mappings = [{device:'AMS1117',signal:'CTRL',pin:'PA1'}, {device:'DHT11',signal:'DATA',pin:'PA2'}];
assert.deepEqual(signalMappedDevices(devices,mappings).map(d=>d.id), ['sensor']);
assert.equal(devices.length,3,'keep power hardware and unmapped devices as thesis facts');
const sharedModel = [{model:'DHT11',boardId:'main'}, {model:'DHT11',boardId:'slave'}];
assert.equal(signalMappedDevices(sharedModel,[{device:'DHT11',boardId:'slave',signal:'DATA',pin:'D2'}])[0].boardId,'slave');
checks++;
const project = {title:'电源设计',paper:{materials:{},factSheet:{controller:'STM32F103C8T6',devices:[{model:'STM32F103C8T6',role:'主控'},devices[0]],functions:[{name:'输出稳定电压'}],analyzedAt:'yes',mappings:[{device:'AMS1117',signal:'CTRL',pin:'待确认'}]}}};
assert.equal(paperMaterialPreflight(project).issues.length,0,'a power rail must not block generation on fake GPIO');
project.paper.factSheet.devices.push({model:'DHT11'});
assert.ok(paperMaterialPreflight(project).issues.some(i=>/未建立外设引脚/.test(i.message)),'power mappings cannot stand in for missing real sensor connections');
checks++;
assert.equal(isSignalPeripheral({model:'电容式土壤湿度传感器'}),true);
assert.equal(isSignalPeripheral({model:'Arduino UNO',role:'从控单片机'}),false);
const source = await fs.readFile(new URL('../app.js',import.meta.url),'utf8');
const fallback = source.slice(source.indexOf('function fallbackMappings('),source.indexOf('function controllerPinNotes('));
let id=0;
const ctx=vm.createContext({isSignalPeripheral,compatiblePins,makeId:()=>`m-${++id}`});
vm.runInContext(fallback,ctx);
const mappingResult=ctx.fallbackMappings('STM32F103C8T6',[
  {model:'OLED'}, {model:'BH1750'}, {model:'DHT11'}, {model:'AMS1117'}, {model:'10kΩ电阻'}, {model:'Arduino UNO',role:'从控单片机'},
]);
assert.equal(mappingResult.length,5,'two I2C devices share a bus and no support component gets CTRL');
assert.ok(mappingResult.filter(m=>m.device==='BH1750').every(m=>m.interfaceType==='I2C'));
assert.deepEqual(validateMappings('STM32F103C8T6',mappingResult),[],'shared bus pins are reserved from ordinary GPIO allocation');
checks++;
console.log(JSON.stringify({status:'passed', checks, paidApiCalls:0}));
