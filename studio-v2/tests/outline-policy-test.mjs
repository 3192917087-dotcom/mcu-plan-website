import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import * as Prompts from '../prompts.js';
import { inputStamp } from '../kimi-workflow.js';
import { OUTLINE_POLICY_VERSION, parseReferenceOutline, referenceAdoptionIssues, validateOutlineStructure, chapterRoles, applyPlannedOutline, normalizeReferenceUsage, completePartialIntroduction, effectiveReferenceText, ensurePcbOutline } from '../outline-policy.js';

const facts = { controller: 'STM32F103C8T6', devices: [
  {id:'mcu',model:'STM32F103C8T6',role:'主控'}, {id:'sensor',model:'DHT11',role:'温湿度传感器'},
  {id:'screen',model:'0.96寸OLED',role:'显示'}, {id:'fan',model:'继电器',role:'风扇控制'},
], functions:[{id:'f1',name:'采集温湿度并显示'},{id:'f2',name:'控制风扇降温'}] };
const outline = Prompts.buildProjectOutline({title:'环境监测',devices:facts.devices,functions:facts.functions});
const referenceText = '第一章前言\n1.1研究背景\n1.1.1国内研究现状\n1.1.2国外研究现状\n1.2研究的目的与意义\n1.3本设计的主要内容及论文结构\n1.3.1本设计的主要内容\n1.3.2论文结构\n第四章软件设计\n42系统整体功能流程及初始化\n4.3软件整体框架设计';
const parsed = parseReferenceOutline(referenceText);
assert.equal(parsed.units.length, 5);
assert.equal(parsed.units[0].children.length, 2);
assert.equal(parsed.units[3].number, '4.2', '目录OCR漏点也需解析');
assert.equal(parseReferenceOutline('软件按采集与报警两条主线组织；保留本章小结').units.length, 1, '模糊描述也是参考要求');

const flexible = structuredClone(outline);
flexible[0] = {id:'1',kind:'introduction',title:'前言',sections:[
  '1.1 研究背景','1.1.1 国内研究现状','1.1.2 国外研究现状','1.1.3 研究现状评述',
  '1.2 研究的目的与意义','1.3 本设计的主要内容及论文结构','1.3.1 本设计的主要内容','1.3.2 论文结构',
]};
flexible[1].sections = ['2.1 设计目标与运行机制','2.2 核心器件选择','2.2.1 主控器件选择','2.2.2 温湿度传感器比较','2.2.3 显示及执行器件比较','2.3 总体功能框架','2.4 本章小结'];
flexible[2].sections = ['3.1 系统供电电路','3.2 主控最小系统电路','3.3 温湿度检测接口','3.4 风扇执行驱动','3.5 OLED显示接口','3.6 PCB电路板设计'];
flexible[3].sections = ['4.1 软件开发环境','4.2 主运行流程及初始化','4.3 软件功能架构','4.4 温湿度采集与显示程序','4.5 风扇降温控制逻辑'];
flexible[4].sections = ['5.1 实验条件与工具','5.2 温湿度采集及显示测试','5.3 风扇降温控制验证','5.4 运行稳定性测试'];
assert.deepEqual(validateOutlineStructure({chapters:flexible}), [], '参考目录的三小节引入结构和同义标题必须被接受');
const plan = {chapters:flexible, referenceUsage: parsed.units.map((unit,index) => ({referenceId:unit.id,action:'adapted',sections:[['1.1'],['1.2'],['1.3'],['4.2'],['4.3']][index],reason:'保留原分组，结合当前项目补齐相关内容'}))};
assert.deepEqual(referenceAdoptionIssues(plan, referenceText), []);
assert.ok(referenceAdoptionIssues({...plan,referenceUsage:[]}, referenceText).length, '声称参考但没有对应关系不能通过');
const fakeAdoption = structuredClone(plan);
fakeAdoption.referenceUsage[4].sections = ['4.1'];
assert.ok(referenceAdoptionIssues(fakeAdoption, referenceText).some(message=>message.includes('框架')), '不能把框架要求随意映射到开发环境');
fakeAdoption.referenceUsage[4].sections = ['4.99'];
assert.ok(referenceAdoptionIssues(fakeAdoption, referenceText).some(message=>message.includes('不存在')));
const broken = structuredClone(flexible);
broken[3].sections.splice(1,0,'4.3.1 提前出现的子节');
assert.ok(validateOutlineStructure({chapters:broken}).some(message=>message.includes('交错')));

const messages=Prompts.buildOutlinePlanMessages({title:'环境监测',facts,materials:{outlineReferenceText:referenceText}});
const payload=JSON.parse(messages[1].content);
assert.equal(payload.referenceUnits.length,parsed.units.length);
assert.equal(Object.hasOwn(payload,'outlineVariationReference'),false,'不能再给AI一份默认完整目录作为锚点');
assert.doesNotMatch(Prompts.chapterResponsibilities('introduction'),/只设四个二级小节/,'正文写作不得推翻参考目录');
assert.match(messages[0].content,/选型已有位置就沿用，不强行迁往第二章/,'明确选型位置优先于默认章节安排');
const relocated = {chapters:flexible,referenceUsage:[{referenceId:'reference-1',action:'adapted',sections:['2.2.1','3.2'],reason:'主控选型集中在第二章，第三章保留最小系统电路以避免重复'}]};
assert.ok(referenceAdoptionIssues(relocated,'3.1主控选择与最小系统电路').some(issue=>issue.includes('不能迁往')),'参考已指定选型第三章，不能默认移回第二章');
const microcontrollerPlan = structuredClone(relocated);
microcontrollerPlan.chapters[2].sections[0] = '3.1 硬件总体设计';
microcontrollerPlan.referenceUsage[0].sections = ['2.2.1','3.1','3.2'];
const microIssues=referenceAdoptionIssues(microcontrollerPlan,'3.1硬件总体设计\n3.1.1主控模块微控制器的选择\n3.1.2STM32最小系统电路');
assert.ok(microIssues.some(issue=>issue.includes('不能迁往')));
assert.ok(!microIssues.some(issue=>issue.includes('控制功能')),'微控制器不能被误判为必须另设控制功能');
assert.ok(referenceAdoptionIssues({...relocated,referenceUsage:[{...relocated.referenceUsage[0],sections:['3.2']}]},'3.1主控微控制器的选择').length,'迁移选型仍需指向实际选型位置');

const artifacts=Prompts.buildArtifactPlan({outline:flexible,devices:facts.devices,functions:facts.functions,mappings:[{device:'DHT11',signal:'DATA',pin:'PA1'}]});
for(const a of artifacts) assert.ok(flexible.find(c=>c.id===a.chapterId).sections.some(s=>s.startsWith(`${a.sectionId} `)),`${a.title}应指向实际存在的小节`);
assert.equal(artifacts.find(a=>a.type==='system-framework').sectionId,'2.3');
assert.equal(artifacts.find(a=>a.type==='software-architecture').sectionId,'4.3');
assert.equal(artifacts.find(a=>a.title==='主程序流程图').sectionId,'4.2');
assert.equal(artifacts.find(a=>a.type==='device-image'&&a.sourceFactIds.includes('sensor')).sectionId,'2.2.2');
assert.equal(artifacts.find(a=>a.type==='test-table'&&a.sourceFactIds.includes('f1')).sectionId,'5.2');

const source=await fs.readFile(new URL('../app.js',import.meta.url),'utf8');
function extract(name){const start=source.search(new RegExp(`(?:async )?function ${name}\\(`));const next=source.slice(start+1).search(/\n(?:async )?function /);assert.ok(start>=0&&next>=0,name);return source.slice(start,start+1+next);}
function sandboxFor(project,callAi){
  const sandbox=vm.createContext({project,Prompts,inputStamp,OUTLINE_POLICY_VERSION,parseReferenceOutline,referenceAdoptionIssues,validateOutlineStructure,chapterRoles,applyPlannedOutline,normalizeReferenceUsage,completePartialIntroduction,effectiveReferenceText,ensurePcbOutline,
    unique:values=>[...new Set(values)],MIN_BODY_CHARS:15000,OUTLINE_KINDS_BY_ID:{1:'introduction',2:'overall',3:'hardware',4:'software',5:'test',6:'conclusion'},
    inferChapterKind:()=>'',desiredBodyChars:()=>15000,paperApiConfig:()=>({provider:'deepseek',chatModel:'deepseek-v4-pro'}),
    paperWritingMessages:m=>m,callAi,parseJsonResponse:JSON.parse,saveGenerationCheckpoint:async()=>{},nowIso:()=> 'test-time',
  });
  vm.runInContext(['flattenPlannedSections','normalizeOutlinePlanResult','outlinePlanIssues','planOutlineForPaper'].map(extract).join('\n'),sandbox);
  return sandbox;
}
// Cache includes the reference, model, rule version and target, and can be bypassed for a fresh draft.
{
  let calls=0;
  const project={title:'环境监测',factRevision:'unchanged',paper:{factSheet:facts,materials:{outlineReferenceText:''},generation:{},outline,chapters:{},outlinePlanning:{status:'ready',inputRevision:'unchanged'}}};
  const sandbox=sandboxFor(project,async()=>{calls++;return JSON.stringify({summary:'按项目规划',chapters:outline,referenceUsage:parseReferenceOutline(project.paper.materials.outlineReferenceText).units.map(unit=>({referenceId:unit.id,action:'adopted',sections:['4.3'],reason:'保留采集模块分组'}))});});
  await vm.runInContext('planOutlineForPaper({aborted:false})',sandbox);
  await vm.runInContext('planOutlineForPaper({aborted:false})',sandbox);
  assert.equal(calls,0,'无参考目录直接采用本地默认结构，不花目录生成额度');
  project.paper.materials.outlineReferenceText='4.3信息采集程序设计';
  await vm.runInContext('planOutlineForPaper({aborted:false})',sandbox);
  assert.equal(calls,1,'修改参考目录必须重新规划');
  await vm.runInContext('planOutlineForPaper({aborted:false},{force:true})',sandbox);
  assert.equal(calls,2,'用户重新生成整篇时重新规划目录');
}
// Invalid planning must stop before paid chapter writing, preserving the previous draft.
{
  let calls=0;
  const project={title:'环境监测',factRevision:'f1',paper:{factSheet:facts,materials:{outlineReferenceText:'各章需要本章小结'},generation:{},outline:structuredClone(outline),chapters:{3:{content:'已有完整章节'}},outlinePlanning:{}}};
  const sandbox=sandboxFor(project,async()=>{calls++;return '{"chapters":[]}';});
  await assert.rejects(vm.runInContext('planOutlineForPaper({aborted:false})',sandbox),/尚未开始正文写作/);
  assert.equal(calls,2);
  assert.deepEqual(project.paper.outline,outline);
  assert.equal(project.paper.chapters[3].content,'已有完整章节');
  assert.equal(project.paper.outlinePlanning.status,'failed');
}
console.log(JSON.stringify({referenceUnits:parsed.units.length,artifacts:artifacts.length,scenarios:10,result:'passed'}));
