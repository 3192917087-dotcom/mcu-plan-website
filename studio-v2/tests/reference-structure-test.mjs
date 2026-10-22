import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import * as Prompts from '../prompts.js';
import { planDeviceSelection } from '../selection-policy.js';
import { parseReferenceOutline, validateOutlineStructure, activeChapterRecords, applyPlannedOutline, insertChapterSupplement, chapterProgressLabel, normalizeReferenceUsage, completePartialIntroduction } from '../outline-policy.js';
import { validateArtifactLedger } from '../paper-quality.js';

const devices = [
  ['mcu','STM32F103C8T6','主控'],['temp','DHT11','温湿度传感器'],['light','BH1750','光照传感器'],
  ['soil','土壤湿度传感器','土壤水分检测'],['screen','0.96寸OLED','屏幕'],['wifi','ESP-01S','WiFi通信模块'],
  ['fan','继电器（控制风扇）','风扇驱动'],['lamp','继电器（控制补光灯）','灯光驱动'],['key','按键','手动模式'],
  ['resistor','10kΩ电阻','上拉电阻'],['buzzer','蜂鸣器','声音报警'],
].map(([id,model,role])=>({id,model,role}));
const functions = [{id:'sample',name:'采集温湿度和土壤湿度并显示'}, {id:'cool',name:'温度超限时控制风扇降温'}, {id:'remote',name:'WiFi远程通信及APP控制'}];
const facts = {devices,functions,controller:'STM32F103C8T6'};
let scenarios = 0;

// Truncated material cannot tell us the final chapter count. An explicit total
// or a numbered conclusion can; boilerplate is not a reference requirement.
{
  const partial = parseReferenceOutline('毕 业 设 计\n目 录\n共五章\n第二章 总体设计\n2.1 系统构成\n2.2 本章小结');
  assert.equal(partial.mode,'partial'); assert.equal(partial.chapterCount,5);
  assert.equal(partial.units.length,3); assert.ok(partial.chapters[0].hasSummary);
  assert.equal(parseReferenceOutline('第五章 功能测试\n5.1 功能验证').chapterCount,null);
  assert.equal(parseReferenceOutline('第五章 结论').chapterCount,5);
  assert.equal(parseReferenceOutline('每个章节均应有本章小结').allChaptersHaveSummary,true); scenarios++;
}
{
  const mixed='毕 业 设 计\n学院：任意学院\n目 录\n第1章 绪论\t1\n1.1 二级标题\t1\n1.1.1 三级标题\t2\n第5章 结论\t4\n第1章 绪论\n1.1 研究背景\n作为研究背景，这是一段原论文正文。\n第二章 系统设计及相关技术\n2.1 功能分析\n2.2 本章小结\n第三章 系统硬件设计\n3.1 硬件总体设计\n3.1.1 主控模块微控制器的选择\n3.1.2 主控最小系统电路\n3.2 本章小结\n第四章 系统软件设计\n4.1 软件框架\n4.2 本章小结\n完成了若干工作。                        第五章 系统测试\n5.1 功能验证\n5.2 本章小结\n结论\n结论要单独成页，宋体小四号字，1.5倍行距。';
  const parsed=parseReferenceOutline(mixed);
  assert.equal(parsed.chapterCount,null,'旧TOC的结论章号不能覆盖后面明确的测试章节');
  assert.equal(parsed.chapters.at(-1).title,'系统测试');
  assert.equal(parsed.chapters[0].sectionCount,1,'重复目录和正文目录不应叠加');
  assert.ok(!parsed.rawText.includes('原论文正文'));
  assert.ok(!parsed.rawText.includes('任意学院'));
  assert.ok(!parsed.rawText.includes('行距'));
  assert.ok(!parsed.rawText.includes('二级标题'));
  assert.ok(parsed.rawText.includes('保留未编号的结论部分'));
  assert.ok(parsed.unnumberedConclusion);
  assert.equal(parseReferenceOutline('第五章 系统测试\n5.1 功能测试\n结　　论').unnumberedConclusion,true);
  assert.ok(!parseReferenceOutline('第五章 系统测试\n5.1 功能测试\n本学位论文作者完全了解学校有关保留、使用学位论文的规定').rawText.includes('学位论文作者'));
  assert.equal(planDeviceSelection({...facts,referenceText:mixed}).mode,'standard','微控制器的选择是明确的器件选型要求'); scenarios++;
}

const five = [
  {id:'1',title:'前言',kind:'introduction',sections:['1.1 研究背景与相关研究','1.1.1 国内研究现状','1.1.2 国外研究现状','1.2 主要工作及论文安排','1.3 本章小结']},
  {id:'2',title:'设计需求与总体方案',kind:'overall',sections:['2.1 项目需求','2.2 系统总体框架','2.3 关键器件简要选型','2.3.1 主控器件比较','2.3.2 关键外设比较','2.4 本章小结']},
  {id:'3',title:'软硬件实现',kind:'implementation',roles:['hardware','software'],sections:['3.1 硬件电路与接口','3.1.1 主控与供电电路','3.1.2 传感器及执行器接口','3.1.3 显示与通信电路','3.2 软件程序与控制逻辑','3.2.1 软件结构及主程序','3.2.2 数据采集与环境调节','3.2.3 远程通信与控制','3.3 PCB电路板设计','3.4 本章小结']},
  {id:'4',title:'实验验证',kind:'test',sections:['4.1 测试方法与环境','4.2 功能测试及结果分析','4.3 本章小结']},
  {id:'5',title:'结论',kind:'conclusion',sections:['5.1 主要成果','5.2 后续展望','5.3 本章小结']},
];
const referenceFor = outline => outline.map(chapter=>`第${chapter.id}章 ${chapter.title}\n${chapter.sections.join('\n')}`).join('\n');
{
  assert.deepEqual(validateOutlineStructure({chapters:five},referenceFor(five)),[]);
  const mismatched=structuredClone(five); mismatched[2].roles=['hardware'];
  assert.ok(validateOutlineStructure({chapters:mismatched},'第三章 系统软件设计').some(issue=>issue.includes('参考章名')),'不完整参考中的明确章节职责也不能被忽略');
  const artifacts = Prompts.buildArtifactPlan({...facts,outline:five,referenceText:referenceFor(five)});
  assert.ok(artifacts.filter(item=>item.type==='circuit').every(item=>item.chapterId==='3' && (item.sectionId.startsWith('3.1') || item.sectionId==='3.3')));
  assert.ok(artifacts.filter(item=>['formula','flowchart'].includes(item.type)).every(item=>item.chapterId==='3' && item.sectionId.startsWith('3.2')));
  assert.ok(artifacts.filter(item=>item.type==='test-table').every(item=>item.chapterId==='4'));
  assert.ok(artifacts.every(item=>five.find(chapter=>chapter.id===item.chapterId).sections.some(section=>section.startsWith(`${item.sectionId} `)))); scenarios++;
}
{
  const narrow=structuredClone(five);
  narrow[1].sections=['2.1 系统框架','2.2 主控器件选择','2.3 本章小结'];
  assert.ok(Prompts.deviceSelectionPlacementIssues({outline:narrow,facts}).length>0,'其他器件不能堆到仅有主控的选型标题下');
  narrow[1].sections[1]='2.2 主控与关键外设选型';
  assert.deepEqual(Prompts.deviceSelectionPlacementIssues({outline:narrow,facts}),[]); scenarios++;
}
{
  const records=normalizeReferenceUsage([{referenceId:'x',action:'adapted',sections:['3.2.1.1','4','4.99'],reason:'对应章节'}],five);
  assert.deepEqual(records[0].sections,['3.2.1','4.1','4.99'],'只整理明确的层级引用，不能隐瞒真正不存在的小节');
  const optional=[{referenceId:'reference-1',action:'adapted',sections:['4.2'],reason:'原为APP设计，方案无APP，改为本地显示设计。'}];
  assert.equal(normalizeReferenceUsage(optional,five,'4.6 ***APP设计',{...facts,functions:['本地采集与显示']})[0].action,'not-applicable');
  assert.equal(normalizeReferenceUsage(optional,five,'4.6 ***APP设计',{functions:['APP远程控制']})[0].action,'adapted','不能把已确认的APP功能当作不适用'); scenarios++;
}
{
  const ref='第一章 绪论\n1.1 二级标题\n1.2 国内外现状\n1.3 本章小结';
  const thin=[{id:'1',kind:'introduction',title:'绪论',sections:['1.1 背景与意义','1.2 国内外研究现状','1.3 本章小结']}];
  const completed=completePartialIntroduction(thin,ref);
  assert.deepEqual(completed[0].sections,thin[0].sections,'已有局部第一章分组时，不为默认要素再加标题');
  const summary=normalizeReferenceUsage([{referenceId:'reference-3',action:'adopted',sections:['1.3'],reason:'保留小结'}],completed,ref);
  assert.deepEqual(summary[0].sections,['1.3']);
  assert.deepEqual(completePartialIntroduction(five,referenceFor(five)),five,'清楚参考不强制增加默认小节'); scenarios++;
}

const seven = [
  five[0],
  {id:'2',title:'需求与可行性分析',kind:'requirement',roles:[],sections:['2.1 功能及性能需求','2.2 可行性分析','2.3 本章小结']},
  {id:'3',title:'总体方案与选型',kind:'overall',sections:['3.1 系统框架设计','3.2 关键器件选型','3.2.1 主控选择','3.2.2 温湿度检测器件比较','3.3 本章小结']},
  {id:'4',title:'电路设计',kind:'hardware',sections:['4.1 主控与供电电路','4.2 传感及执行电路','4.3 显示与通信接口','4.4 PCB电路板设计','4.5 本章小结']},
  {id:'5',title:'应用程序实现',kind:'software',sections:['5.1 软件结构及主程序','5.2 温室采集与调节逻辑','5.3 远程通信与显示程序','5.4 本章小结']},
  {id:'6',title:'功能验证与讨论',kind:'test',sections:['6.1 测试条件','6.2 系统功能验证','6.3 本章小结']},
  {id:'7',title:'结论',kind:'conclusion',sections:['7.1 研究总结','7.2 后续工作']},
];
{
  const ref=referenceFor(seven);
  assert.equal(parseReferenceOutline(ref).mode,'detailed');
  assert.deepEqual(validateOutlineStructure({chapters:seven},ref),[]);
  const bad=structuredClone(seven); bad[6].sections.push('7.3 本章小结');
  assert.ok(validateOutlineStructure({chapters:bad},ref).some(issue=>issue.includes('机械追加')));
  const artifacts=Prompts.buildArtifactPlan({...facts,outline:seven,referenceText:ref});
  assert.ok(artifacts.filter(item=>['device-image','comparison-table'].includes(item.type)).every(item=>item.chapterId==='3'));
  assert.ok(artifacts.filter(item=>item.type==='circuit').every(item=>item.chapterId==='4'));
  const formula=artifacts.find(item=>item.type==='formula'); assert.equal(formula.chapterId,'5');
  assert.ok(!validateArtifactLedger({artifacts:[{...formula,formulaNumber:'5-1'}],outline:seven,chapters:{5:{content:'设计处理依据采用计算关系，如式（5-1）所示。\n\nx = y + 1 （5-1）\n\n式中x表示结果，y表示输入，单位均为百分比。'}}}).some(issue=>issue.id.includes('formula-wrong-chapter'))); scenarios++;
}

// Standard/expanded/brief selection never becomes an all-device inventory.
// Relay selection is shared, but two actual output circuits must remain.
{
  const normal=planDeviceSelection({...facts,targetBodyChars:15000});
  const expanded=planDeviceSelection({...facts,targetBodyChars:25000});
  const brief=planDeviceSelection({...facts,targetBodyChars:30000,referenceText:'第二章 总体方案\n2.1 系统需求\n2.2 系统框架'});
  assert.equal(normal.devices.length,4); assert.ok(expanded.devices.length>normal.devices.length);
  assert.equal(brief.mode,'brief'); assert.ok(brief.devices.length<=3);
  assert.equal(normal.devices.filter(item=>item.model.includes('继电器')).length,1);
  assert.ok(!expanded.devices.some(item=>item.id==='resistor'));
  const outline=Prompts.buildProjectOutline({...facts});
  const artifacts=Prompts.buildArtifactPlan({...facts,outline});
  assert.ok(['fan','lamp'].every(id=>artifacts.some(item=>item.type==='circuit' && item.sourceFactIds.includes(id))));
  assert.equal(artifacts.filter(item=>item.type==='device-image').length,4);
  assert.equal(planDeviceSelection({devices:devices.slice(0,2)}).devices.length,2); scenarios++;
}

// Split software references route remote-control diagrams to their real chapter.
{
  const split=structuredClone(seven);
  split[4].sections=['5.1 软件结构与主程序','5.2 温室数据采集与控制','5.3 本章小结'];
  split.splice(5,0,{id:'6',title:'远程通信软件',kind:'software',sections:['6.1 无线通信程序','6.2 APP远程控制','6.3 本章小结']});
  split[6]={...split[6],id:'7',sections:['7.1 测试环境','7.2 功能测试']};
  split[7]={...split[7],id:'8',sections:['8.1 总结','8.2 展望']};
  const artifacts=Prompts.buildArtifactPlan({...facts,outline:split});
  assert.equal(artifacts.find(item=>item.type==='flowchart' && item.sourceFactIds.includes('remote')).chapterId,'6'); scenarios++;
}

// Valid outline changes keep the old version recoverable and exclude orphan
// content from the next manuscript, while unchanged resumes preserve status.
{
  const paper={outline:structuredClone(seven),chapters:{1:{id:'1',content:'原绪论',status:'complete'},4:{id:'4',content:'旧硬件不能变成新测试章',status:'complete'},7:{id:'7',content:'旧结论',status:'complete'}},artifacts:[]};
  applyPlannedOutline(paper,structuredClone(five),'time');
  assert.equal(paper.chapters[7],undefined); assert.equal(paper.outlineHistory[0].chapters[7].content,'旧结论');
  assert.equal(paper.chapters[4],undefined); assert.equal(paper.outlineHistory[0].chapters[4].content,'旧硬件不能变成新测试章');
  assert.equal(paper.chapters[1].status,'stale');
  assert.equal(activeChapterRecords(paper).length,1);
  paper.chapters[1].status='complete'; applyPlannedOutline(paper,structuredClone(five),'next');
  assert.equal(paper.chapters[1].status,'complete'); assert.equal(paper.outlineHistory.length,1);
  const content='3.1 接口设计\n\n原分析。\n\n3.2 本章小结\n\n小结内容。';
  const revised=insertChapterSupplement(content,'新增分析。',{sections:['3.1 接口设计','3.2 本章小结']});
  assert.ok(revised.indexOf('新增分析。')<revised.indexOf('3.2 本章小结'));
  assert.ok(revised.endsWith('小结内容。'));
  assert.equal(chapterProgressLabel(seven[4],'写作'),'第5章 应用程序实现 · 写作'); scenarios++;
}

// More chapters must never produce negative targets or change the requested sum.
{
  const ten=[...seven,...Array.from({length:3},(_,i)=>({id:String(i+8),kind:'other',roles:[],title:'附加分析',sections:[]}))];
  for(const chapters of [five,seven,ten]) for(const target of [15000,20000,25000,40000]) {
    const result=Prompts.assignChapterTargets(chapters,target,facts);
    assert.equal(result.reduce((sum,c)=>sum+c.targetCharacters,0),target);
    assert.ok(result.every(c=>c.targetCharacters>0));
  }
  const app=await fs.readFile(new URL('../app.js',import.meta.url),'utf8');
  const start=app.indexOf('function generationPhasePercent('); const end=app.indexOf('\nfunction ',start+1);
  const sandbox=vm.createContext({project:{paper:{outline:seven,chapters:{}},factRevision:'v'}});
  vm.runInContext(app.slice(start,end),sandbox);
  assert.equal(vm.runInContext("generationPhasePercent({status:'completed',phase:'quality'})",sandbox),100); scenarios++;
}
// Exercise the actual screen renderer: custom chapter names must survive every
// visible progress surface, and finished elapsed time cannot keep increasing.
{
  const app=await fs.readFile(new URL('../app.js',import.meta.url),'utf8');
  const extract=name=>{const start=app.indexOf(`function ${name}(`);return app.slice(start,app.indexOf('\nfunction ',start+1));};
  const elements=new Map();
  const $=id=>{if(!elements.has(id))elements.set(id,{style:{}});return elements.get(id);};
  const generation={status:'running',phase:'chapters',currentChapterId:'5',activeRequestLabel:chapterProgressLabel(seven[4],'写作'),startedAt:'2026-10-18T00:00:00Z',updatedAt:'2026-10-18T00:02:00Z'};
  const project={factRevision:'v',paper:{generation,outline:seven,chapters:{}}};
  const ctx=vm.createContext({project,$,document:{body:{classList:{toggle(){}}}},APP_TITLE:'工作室',chapterProgressLabel,activeChapterRecords,
    currentQualityReport:()=>({checkedAt:'time',issues:[]}),escapeHtml:String,countBodyChars:s=>s.length,formatTime:String,
    renderOutlinePreview(){},renderQuality(){}});
  vm.runInContext([extract('generationPhasePercent'),extract('renderGeneration')].join('\n'),ctx);
  vm.runInContext('renderGeneration()',ctx);
  assert.equal($('screen-notice-title').textContent,'第5章 应用程序实现 · 写作');
  assert.ok($('generation-phases').innerHTML.includes('第5章 应用程序实现'));
  assert.ok($('chapter-list').innerHTML.includes('第5章 应用程序实现'));
  generation.status='completed';generation.phase='quality';generation.completedAt='2026-10-18T00:03:00Z';
  vm.runInContext('renderGeneration()',ctx);
  assert.equal($('generation-elapsed').textContent,'180');
  assert.equal($('generation-progress').style.width,'100%');
  assert.equal($('generation-message').textContent,'论文最终检查通过'); scenarios++;
}
console.log(JSON.stringify({scenarios,status:'passed'}));
