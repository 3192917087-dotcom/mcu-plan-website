import assert from 'node:assert/strict';
import {buildSchemePolicy,schemeResultIssues} from '../scheme-policy.js';
import {buildSchemeMessages} from '../prompts.js';

const preferences={controller:'STM32F103C8T6',display:'auto',appSoftware:[],cloudPlatforms:[]};
function result(module,role,feature) {
  return {devices:[{model:'STM32F103C8T6',role:'主控'},{model:module,role}],functions:['使用DHT11采集环境温湿度','使用OLED显示环境参数',feature]};
}
const policy=(requirements='',title='环境控制系统',extra={})=>buildSchemePolicy({title,requirements,functionCount:3,preferences:{...preferences,...extra}});
let checks=0;
const bluetooth=result('HC-05','蓝牙模块','使用HC-05通过蓝牙APP查看环境数据并控制设备');
const wifi=result('ESP-01S','WiFi模块','使用ESP-01S通过WiFi APP局域网查看环境数据并控制设备');
for(const p of [policy('手机APP采用蓝牙通信'),policy('','基于蓝牙APP的环境控制系统'),policy('APP用HC-05连接')]) {
  assert.deepEqual(schemeResultIssues(bluetooth,p),[]);
  assert.ok(schemeResultIssues(wifi,p).some(issue=>/蓝牙/.test(issue)));
  checks++;
}
assert.deepEqual(schemeResultIssues(wifi,policy('APP使用WiFi通信')),[]);
assert.ok(schemeResultIssues(bluetooth,policy('APP使用WiFi通信')).some(i=>/WiFi/.test(i)));
checks++;
assert.deepEqual(policy('不是WiFi而是蓝牙APP').communication.required,['bluetooth']);
assert.deepEqual(policy('不是WiFi而是蓝牙APP').communication.forbidden,['wifi']);
assert.deepEqual(policy('APP改用WiFi通信','蓝牙控制系统').communication.required,['wifi']);
assert.deepEqual(policy('需要蓝牙和WiFi两种通信').communication.required,['bluetooth','wifi']);
assert.deepEqual(policy('不用蓝牙；改用WiFi').communication.required,['wifi']);
assert.deepEqual(policy('APP使用蓝牙；改用WiFi').communication.required,['wifi']);
assert.deepEqual(policy('对比WiFi和蓝牙，但使用蓝牙APP').communication.required,['bluetooth']);
checks++;
const appOnly=policy('需要手机APP');
assert.ok(schemeResultIssues({...bluetooth,functions:wifi.functions},appOnly).some(i=>/统一实际通信链路/.test(i)));
assert.ok(schemeResultIssues({...wifi,functions:bluetooth.functions},appOnly).some(i=>/统一实际通信链路/.test(i)));
checks++;
for(const [key,role,wrong,correct,feature] of [
  ['bluetooth','蓝牙模块','HC-06','HC-05','蓝牙APP查询并控制设备'],
  ['voice','语音控制模块','LD3320','Asrpro语音模块','识别离线语音指令并控制设备'],
  ['motorDriver','电机驱动模块','L298N','TB6612驱动模块','驱动直流电机正反转并调节转速'],
]) {
  const p=policy(key==='bluetooth'?'需要蓝牙APP':'');
  assert.ok(schemeResultIssues(result(wrong,role,`使用${wrong}${feature}`),p).some(i=>/固定使用/.test(i)));
  assert.deepEqual(schemeResultIssues(result(correct,role,`使用${correct}${feature}`),p),[]);
  assert.ok(schemeResultIssues(result(correct,role,`使用${wrong}${feature}`),p).some(i=>/型号必须/.test(i)));
  const specified=policy(`${role}使用${wrong}${key==='bluetooth'?'，需要蓝牙APP':''}`);
  assert.equal(specified.modules[key].explicit,true);
  assert.deepEqual(schemeResultIssues(result(wrong,role,`使用${wrong}${feature}`),specified),[]);
  assert.ok(schemeResultIssues(result(correct,role,`使用${correct}${feature}`),specified).length>0);
  checks++;
}
assert.equal(policy('不要使用L298N').modules.motorDriver.explicit,false);
assert.equal(policy('L298N仅供参考').modules.motorDriver.explicit,false);
assert.equal(policy('L298N用于对比').modules.motorDriver.explicit,false);
assert.deepEqual(policy('语音模块用SU-03T').modules.voice.models,['SU-03T']);
assert.deepEqual(policy('电机驱动用DRV8871').modules.motorDriver.models,['DRV8871']);
assert.deepEqual(policy('','基于L298N驱动的电机控制系统').modules.motorDriver.models,['L298N']);
assert.deepEqual(schemeResultIssues(result('DRV8871','电机驱动模块','使用DRV8871驱动直流电机调速'),policy('电机驱动用DRV8871')),[]);
checks++;
const cloudAndBluetooth=policy('APP使用蓝牙通信，云平台用OneNET');
const dual={...bluetooth,devices:[...bluetooth.devices,{model:'ESP-01S',role:'WiFi模块'}],functions:[...bluetooth.functions,'使用ESP-01S通过WiFi上传到OneNET实现云端监测']};
assert.deepEqual(schemeResultIssues(dual,cloudAndBluetooth),[],'cloud upload and local Bluetooth can coexist with distinct roles');
checks++;
assert.ok(buildSchemeMessages({title:'测试',policy:policy()})[0].content.includes('APP开发工具是两个不同约束'));
assert.equal(policy('', '', {appSoftware:['MIT App Inventor']}).communication.required.length,0,'APP software does not force a protocol');
checks++;
const bluetoothTerminal=result('HC-05','蓝牙模块','使用HC-05通过蓝牙向本地终端发送环境数据');
const wifiTerminal=result('ESP-01S','WiFi模块','使用ESP-01S通过WiFi向局域网终端发送环境数据');
for (const [mode,correct,wrong] of [['bluetooth',bluetoothTerminal,wifiTerminal],['wifi',wifiTerminal,bluetoothTerminal]]) {
  const selected=policy('', '', {communicationMode:mode});
  assert.deepEqual(selected.communication.required,[mode]);
  assert.equal(selected.communicationAllowed,true,'a transport can be selected without APP or cloud');
  assert.equal(selected.appMode,'none');
  assert.equal(selected.cloudMode,'none');
  assert.deepEqual(schemeResultIssues(correct,selected),[]);
  assert.ok(schemeResultIssues(wrong,selected).length>0,'the other transport cannot replace the selection');
  checks++;
}
assert.deepEqual(policy('','蓝牙系统',{communicationMode:'wifi'}).communication.required,['wifi'],'dropdown overrides title transport');
assert.deepEqual(policy('APP采用WiFi通信','',{communicationMode:'bluetooth'}).communication.required,['wifi'],'explicit requirements override dropdown');
assert.deepEqual(policy('APP采用蓝牙通信','',{communicationMode:'wifi'}).communication.required,['bluetooth']);
checks++;
for(const mode of ['auto','invalid',undefined]) {
  const automatic=policy('','',{communicationMode:mode});
  assert.deepEqual(automatic.communication.required,[]);
  assert.equal(automatic.communicationAllowed,false,'auto does not add external communication without a need');
}
assert.deepEqual(policy('','',{communicationMode:'auto',appSoftware:['Android Studio']}).communication.required,[],'auto with APP is neutral');
checks++;
const noCommunication=policy('','WiFi环境控制系统',{communicationMode:'none'});
assert.equal(noCommunication.communicationAllowed,false);
assert.ok(schemeResultIssues(wifiTerminal,noCommunication).some(i=>i.includes('额外通信模块')));
assert.ok(schemeResultIssues(bluetoothTerminal,noCommunication).some(i=>i.includes('额外通信模块')));
assert.deepEqual(schemeResultIssues({devices:[{model:'STM32F103C8T6',role:'主控'},{model:'OLED',role:'屏幕'}],functions:['使用OLED通过I2C显示环境参数','使用按键切换页面','使用蜂鸣器提示参数超限']},noCommunication),[],'no external communication preserves internal buses');
checks++;
assert.equal(policy('不用蓝牙','',{communicationMode:'none'}).communication.disabled,true);
assert.equal(policy('需要手机APP','',{communicationMode:'none'}).communicationAllowed,true);
assert.deepEqual(policy('需要蓝牙APP','',{communicationMode:'none'}).communication.required,['bluetooth']);
assert.equal(policy('不使用通信模块','',{communicationMode:'wifi'}).communicationAllowed,false);
assert.equal(policy('','',{communicationMode:'none',appSoftware:['MIT App Inventor']}).configurationIssues.length,1);
assert.equal(policy('','',{communicationMode:'none',cloudPlatforms:['OneNET']}).configurationIssues.length,1);
assert.equal(policy('APP通过WiFi连接','',{communicationMode:'none',appSoftware:['MIT App Inventor']}).configurationIssues.length,0);
checks++;
console.log(JSON.stringify({status:'passed',checks,paidApiCalls:0}));
