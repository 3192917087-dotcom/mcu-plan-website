const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const url = 'http://127.0.0.1:8765/studio-v2/';
const fixture = {
  controller:'STM32F103C8T6', developmentTools:['Keil 5','STM32CubeMX'],
  boards:[{id:'board-main',name:'主板',role:'主控板',controller:'STM32F103C8T6',schematicFilenames:[],programPaths:[],deviceModels:['STM32F103C8T6','DHT11','OLED','INA219','电压检测模块','TP4056充电模块','电源控制继电器'],functionNames:['监测并显示环境与供电状态'],communication:[],notes:''}],
  devices:[['STM32F103C8T6','主控'],['DHT11','温湿度检测'],['OLED','显示'],['INA219','电流传感器'],['电压检测模块','电压检测'],['TP4056充电模块','充电'],['电源控制继电器','控制电源'],['AMS1117','稳压'],['10kΩ电阻','上拉'],['滤波电容','滤波']].map(([model,role])=>({model,role,boardId:'board-main'})),
  functions:[{name:'监测并显示环境与供电状态',deviceModels:['DHT11','OLED'],boardIds:['board-main']}],
  mappings:[['DHT11','DATA','PA2'],['OLED','SCL','PB6'],['OLED','SDA','PB7'],['INA219','SCL','PB6'],['INA219','SDA','PB7'],['电压检测模块','AO','PA1'],['TP4056充电模块','CHRG','PA4'],['电源控制继电器','CTRL','PA3'],['AMS1117','CTRL','PB3'],['10kΩ电阻','CTRL','PB4'],['滤波电容','CTRL','PB5'],['DHT11','VCC','PA0'],['OLED','GND','GND']].map(([device,signal,pin],i)=>({id:`mapping-${i}`,boardId:'board-main',device,signal,pin,interfaceType:/SC[L]|SDA/.test(signal)?'I2C':signal==='AO'?'ADC':'GPIO',busGroup:/SC[L]|SDA/.test(signal)?'I2C1':'',shareAllowed:/SC[L]|SDA/.test(signal)})),
  powerNotes:['开发板5V输入，板载稳压提供3.3V，所有模块共地'],fixedFacts:[],conflicts:[],
};
(async()=>{
  const browser=await chromium.launch({headless:true,channel:'msedge'});
  try {
    const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
    await context.addInitScript(()=>localStorage.setItem('mcu-paper-studio-v2.api-settings',JSON.stringify({provider:'compatible',apiUrl:'https://mock-api.example/v1/chat/completions',apiKey:'local-test-key',chatModel:'test-model',reasoningModel:'test-model'})));
    let mode='normal', mockCalls=0, externalPosts=0;
    await context.route('**/*', async route=>{
      if(route.request().method()!=='POST') return route.continue();
      if(!route.request().url().startsWith('https://mock-api.example/')) {externalPosts++;return route.abort();}
      const body=route.request().postDataJSON();
      const isHardware=body.messages?.some(m=>m.content?.includes('你是单片机项目硬件事实整理工程师'));
      let content='连接正常';
      if(isHardware) {
        mockCalls++;
        const response=structuredClone(fixture);
        if(mode==='pending') response.mappings.find(m=>m.device==='DHT11'&&m.signal==='DATA').pin='待确认';
        content=JSON.stringify(mode==='empty'?{}:response);
      }
      await route.fulfill({json:{choices:[{message:{role:'assistant',content},finish_reason:'stop'}]}});
    });
    const page=await context.newPage();
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(url+'#projects');
    await page.locator('#btn-new-project').click();
    await page.locator('#new-project-form button[type="submit"]').click();
    await page.locator('#paper-title-input').fill('基于STM32的环境及供电状态监测系统');
    await page.locator('#paper-functions').fill('监测并显示环境与供电状态');
    await page.locator('#paper-materials-form button[type="submit"]').click();
    await page.waitForFunction(()=>document.querySelectorAll('#pin-mapping-body [data-mapping-id]').length===8);
    const state=await page.evaluate(async()=>{const s=await import('./storage.js?v=20261118-1');return s.getProject(s.getActiveProjectId());});
    assert.equal(state.paper.factSheet.mappings.length,8);
    assert.ok(state.paper.factSheet.devices.some(d=>d.model==='AMS1117'),'keep power facts for writing');
    assert.ok(!state.paper.factSheet.mappings.some(m=>/AMS1117|电阻|电容/.test(m.device)));
    assert.ok(state.paper.factSheet.mappings.some(m=>m.device==='电压检测模块'));
    assert.ok(state.paper.factSheet.mappings.some(m=>m.device==='TP4056充电模块'));
    assert.match(await page.locator('#hardware-fact-strip').innerText(),/信号外设\s*6项/);
    const nav=await page.locator('.main-nav').boundingBox();
    const status=await page.locator('#operation-status').boundingBox();
    assert.ok(!status || status.y>=nav.y+nav.height,'task status must not cover navigation');
    await page.screenshot({path:path.join(__dirname,'output','hardware-signals-desktop.png')});

    // Manual entry cannot bypass the same rule used for AI results.
    await page.locator('#btn-add-mapping').click();
    await page.locator('#mapping-device').fill('AMS1117');
    await page.locator('#mapping-signal').fill('CTRL');
    await page.locator('#mapping-form button[type="submit"]').click();
    assert.equal(await page.locator('#pin-mapping-body [data-mapping-id]').count(),8);
    await page.locator('#mapping-dialog [data-close-dialog]').first().click();

    // An incomplete response must not erase the last usable analysis.
    mode='empty';
    await page.locator('#btn-reanalyze-pins').click();
    await page.waitForFunction(()=>document.querySelector('#hardware-analysis-status')?.classList.contains('is-error'));
    assert.equal(await page.locator('#pin-mapping-body [data-mapping-id]').count(),8);
    await page.reload();
    await page.waitForFunction(()=>document.querySelectorAll('#pin-mapping-body [data-mapping-id]').length===8);

    // Older saved power mappings are cleaned on load, without dropping hardware facts.
    await page.evaluate(async()=>{
      const s=await import('./storage.js?v=20261118-1');const p=await s.getProject(s.getActiveProjectId());
      p.paper.factSheet.mappings.push({id:'legacy-power',device:'AMS1117',signal:'CTRL',pin:'PA0',interfaceType:'GPIO',boardId:'board-main'});
      await s.saveProject(p);
    });
    await page.reload();
    await page.waitForFunction(()=>document.querySelectorAll('#pin-mapping-body [data-mapping-id]').length===8);
    assert.ok(!(await page.locator('#pin-mapping-body').innerText()).includes('AMS1117'));

    // An uncertain AI connection stays uncertain instead of silently acquiring GPIO0.
    mode='pending';
    await page.locator('#btn-reanalyze-pins').click();
    await page.waitForFunction(()=>document.querySelector('#pin-mapping-body [data-mapping-id="mapping-0"] select')?.value==='待确认');
    assert.match(await page.locator('#pin-conflict-summary').innerText(),/尚未选择引脚/);
    assert.deepEqual(errors,[]);assert.equal(externalPosts,0);
    console.log(JSON.stringify({status:'passed',checks:5,mockCalls,paidApiCalls:0}));
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
