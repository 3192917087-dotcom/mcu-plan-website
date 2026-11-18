const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = {title:'基于STM32的环境控制系统',devices:[{model:'STM32F103C8T6',role:'主控'},{model:'DHT11',role:'温湿度传感器'},{model:'0.96寸OLED',role:'屏幕'}],functions:['使用DHT11采集环境温湿度，主控定时更新数据','使用0.96寸OLED显示环境参数，主控根据采集结果刷新页面']};
const correct = {...base,devices:[...base.devices,{model:'HC-05',role:'蓝牙模块'},{model:'Asrpro语音模块',role:'语音控制'},{model:'TB6612驱动模块',role:'电机驱动'},{model:'直流电机',role:'执行机构'}],functions:[...base.functions,'使用HC-05通过蓝牙APP查看状态并控制设备，主控解析手机下发的命令','使用Asrpro语音模块识别风扇控制指令，主控根据识别结果切换电机状态','使用TB6612驱动模块控制直流电机，主控通过PWM调节风速']};
const wrong = JSON.parse(JSON.stringify(correct).replaceAll('HC-05','ESP-01S').replaceAll('蓝牙','WiFi').replaceAll('Asrpro语音模块','LD3320').replaceAll('TB6612驱动模块','L298N'));
(async()=>{
  const browser=await chromium.launch({headless:true,channel:'msedge'});
  try {
    const context=await browser.newContext({reducedMotion:'reduce'});
    await context.addInitScript(()=>localStorage.setItem('mcu-paper-studio-v2.api-settings',JSON.stringify({provider:'compatible',apiUrl:'https://mock-api.example/v1/chat/completions',apiKey:'local-test-key',chatModel:'test-model'})));
    const requests=[];let externalPosts=0;
    await context.route('**/*',route=>{
      if(route.request().method()!=='POST')return route.continue();
      if(!route.request().url().startsWith('https://mock-api.example/')){externalPosts++;return route.abort();}
      const body=route.request().postDataJSON();let content='连接正常';
      if(body.messages?.[0]?.content.includes('你是单片机项目方案设计工程师')) {
        requests.push(JSON.parse(body.messages[1].content));
        content=JSON.stringify(requests.length===1?wrong:correct);
      }
      return route.fulfill({json:{choices:[{message:{role:'assistant',content},finish_reason:'stop'}]}});
    });
    const page=await context.newPage();const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto('http://127.0.0.1:8765/studio-v2/?v=20261118-4#projects');
    await page.locator('#btn-new-project').click();
    await page.locator('input[name="new-project-start"][value="scheme"]').check();
    await page.locator('#new-project-form button[type="submit"]').click();
    await page.locator('#scheme-title-input').fill(base.title);
    await page.locator('#scheme-requirements').fill('需要手机APP、离线语音控制和直流电机调速');
    assert.equal(await page.locator('#scheme-communication').inputValue(),'auto');
    await page.locator('#scheme-communication').selectOption('bluetooth');
    await page.locator('input[name="scheme-count-mode"][value="custom"]').check();
    await page.locator('#scheme-count').fill('5');
    await page.locator('#scheme-controller').selectOption('STM32F103C8T6');
    await page.locator('#scheme-form button[type="submit"]').click();
    await page.waitForFunction(()=>document.querySelector('#scheme-status').textContent.includes('已生成'));
    assert.equal(requests.length,2,'bad protocol and modules must be repaired before success');
    assert.deepEqual(requests[0].resolvedConstraints.communication.required,['bluetooth']);
    assert.ok(requests[1].previousResult);
    const text=await page.locator('#scheme-preview').innerText();
    for(const model of ['HC-05','Asrpro','TB6612'])assert.ok(text.includes(model),model);
    for(const model of ['ESP-01S','LD3320','L298N'])assert.ok(!text.includes(model),model);
    await page.reload();
    await page.waitForFunction(()=>document.querySelector('#scheme-preview').textContent.includes('TB6612'));
    assert.ok((await page.locator('#scheme-preview').innerText()).includes('HC-05'));
    await page.locator('[data-scheme-step="input"]').first().click();
    assert.equal(await page.locator('#scheme-communication').inputValue(),'bluetooth','selection survives reload');
    assert.deepEqual(await page.locator('#scheme-communication option').evaluateAll(options=>options.map(o=>o.value)),['auto','bluetooth','wifi','none']);
    await page.locator('#scheme-communication').selectOption('wifi');
    await page.waitForTimeout(1500);
    await page.reload();
    await page.locator('[data-scheme-step="input"]').first().click();
    assert.equal(await page.locator('#scheme-communication').inputValue(),'wifi','changing just the select auto-saves');
    await page.locator('#scheme-communication').selectOption('none');
    await page.locator('#scheme-requirements').fill('');
    await page.locator('[data-multi-select="appSoftware"] summary').click();
    await page.locator('[data-multi-select="appSoftware"] input[value="MIT App Inventor"]').check();
    await page.locator('[data-multi-select="appSoftware"] summary').click();
    await page.locator('#scheme-form button[type="submit"]').click();
    await page.waitForFunction(()=>document.querySelector('#toast-region').textContent.includes('通信'));
    assert.equal(requests.length,2,'conflicting APP and no-communication choices do not call AI');
    assert.deepEqual(errors,[]);assert.equal(externalPosts,0);
    console.log(JSON.stringify({status:'passed',checks:['transport-dropdown','protocol-repair','module-repair','saved-result','reload','select-autosave','conflict-before-API'],mockGenerations:requests.length,paidApiCalls:0}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
