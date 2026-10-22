import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import * as Prompts from '../prompts.js';
import { validateReferenceFiles, readReferenceFiles, validateReferenceInterpretation, buildReferenceInterpretationMessages, referenceReviewState, confirmReferenceInterpretation, referenceEditorText, updateReferenceEditorText, REFERENCE_IMPORT_VERSION } from '../reference-import.js';
import { referenceAdoptionIssues, validateOutlineStructure, ensurePcbOutline, pcbDesignPolicy, effectiveReferenceText, normalizeReferenceUsage, chapterReferenceContract, synchronizePaperOrganization, organizationCoverageIssues, completePartialIntroduction, parseReferenceOutline } from '../outline-policy.js';

let scenarios=0;
const reference=`第一章 绪论
1.1 课题来源与研究背景
1.2 研究目的及意义
1.3 国内外研究现状
1.3.1 国内研究现状
1.3.2 国外研究现状
1.4 研究内容与技术路线
1.5 论文结构安排
1.6 本章小结
第二章 系统总体方案设计
2.1 系统需求分析
2.2 系统总体框架
2.3 工作原理
2.4 本章小结
第三章 系统硬件设计
3.1 模块选型
3.1.1 主控器件选型
3.1.2 关键外设选型
3.2 主控与供电电路
3.3 传感及执行电路
3.4 PCB电路板图设计
3.5 本章小结
第四章 系统软件设计
4.1 软件结构与主程序
4.2 环境采集与控制程序
4.3 本章小结
第五章 系统测试
5.1 测试环境与工具
5.2 功能与性能验证
5.3 本章小结
第六章 结论
6.1 研究总结
6.2 本章小结`;
const parsed=parseReferenceOutline(reference);
const roles=['introduction','overall','hardware','software','test','conclusion'];
const outline=parsed.chapters.map((c,i)=>({id:c.id,title:c.title,kind:roles[i],sections:parsed.units.filter(u=>u.chapterId===c.id).flatMap(u=>[`${u.number} ${u.title}`,...u.children])}));
const usage=parsed.units.map(u=>({referenceId:u.id,action:'adopted',sections:[u.number],reason:'按原章节内容方向组织'}));
const facts={controller:'STM32F103C8T6',devices:[{id:'mcu',model:'STM32F103C8T6',role:'主控'},{id:'sensor',model:'DHT11',role:'温湿度采集'},{id:'relay',model:'继电器',role:'风扇驱动'}],functions:[{id:'f1',name:'采集温湿度并控制风扇'}]};
{
  assert.deepEqual(validateOutlineStructure({chapters:outline},reference),[]);
  assert.deepEqual(referenceAdoptionIssues({chapters:outline,referenceUsage:usage},reference),[]);
  const moved=structuredClone(outline);moved[1].sections.splice(3,0,'2.4 模块选型');moved[2].sections=moved[2].sections.filter(s=>!s.startsWith('3.1'));
  assert.ok(validateOutlineStructure({chapters:moved},reference).some(i=>i.includes('第3章')));
  const movedUsage=structuredClone(usage);movedUsage.find(u=>u.sections.includes('3.1')).sections=['2.4'];
  assert.ok(referenceAdoptionIssues({chapters:moved,referenceUsage:movedUsage},reference).some(i=>i.includes('不能迁往')));
  const changed=structuredClone(outline);changed[0].sections[0]='1.1 课题研究背景及意义';
  assert.ok(referenceAdoptionIssues({chapters:changed,referenceUsage:usage},reference).some(i=>i.includes('第一章应保留')));
  const lostChild=structuredClone(outline);lostChild[0].sections=lostChild[0].sections.filter(s=>!s.startsWith('1.3.2 '));
  assert.ok(validateOutlineStructure({chapters:lostChild},reference).some(i=>i.includes('三级分组')));
  const pcbUsage=structuredClone(usage);pcbUsage.find(u=>u.sections.includes('3.4')).action='not-applicable';
  assert.ok(referenceAdoptionIssues({chapters:outline,referenceUsage:pcbUsage},reference).some(i=>i.includes('默认使用PCB')));
  const fixed=normalizeReferenceUsage([{referenceId:parsed.units.find(u=>u.number==='3.4').id,action:'adapted',sections:['3.4'],reason:'方案没有PCB，所以改为硬件装配'}],outline,reference,facts);
  assert.equal(fixed[0].action,'adapted','不能再把默认PCB误判为不适用');scenarios++;
}
{
  const short='第一章 绪论\n1.1 课题来源与研究背景\n1.2 国内外研究现状';
  assert.deepEqual(completePartialIntroduction([outline[0]],short),[outline[0]],'局部第一章清楚时，不机械插入默认标题');
  const defaultOutline=Prompts.buildProjectOutline(facts);
  assert.ok(defaultOutline[2].sections.some(s=>/PCB/.test(s)));
  assert.ok(defaultOutline.every(c=>/本章小结/.test(c.sections.at(-1))));
  assert.ok(!Prompts.buildProjectOutline({...facts,fixedFacts:['不使用PCB，仅使用面包板']})[2].sections.some(s=>/PCB/.test(s)));
  assert.equal(pcbDesignPolicy({},{}).tool,'嘉立创专业版');
  assert.equal(pcbDesignPolicy({fixedFacts:['默认制图软件为嘉立创专业版']},{sourceNotes:'PCB软件为Altium Designer'}).tool,'Altium Designer');
  assert.equal(pcbDesignPolicy({fixedFacts:['不使用PCB']}).enabled,false);
  const artifacts=Prompts.buildArtifactPlan({...facts,outline,referenceText:reference});
  assert.ok(artifacts.filter(a=>['device-image','comparison-table'].includes(a.type)).every(a=>a.chapterId==='3'));
  const pcb=artifacts.find(a=>/PCB/.test(a.title));assert.equal(pcb.chapterId,'3');assert.equal(pcb.sectionId,'3.4');
  const project={title:'环境监测',paper:{factSheet:facts,materials:{outlineReferenceText:reference},outline,outlinePlanning:{referenceUsage:usage},referenceRecords:[]}};
  const payload=JSON.parse(Prompts.buildChapterMessages({project,chapter:outline[0],outline,artifacts,completedDigest:''})[2].content);
  assert.equal(payload.referenceContract.requirements.length,6);
  assert.equal(payload.paperOrganization.chapters.length,6);
  assert.equal(payload.pcbPolicy.enabled,true);scenarios++;
}
{
  const text=reference+'\n【小节方向：2.4】本章首先介绍总体设计和选型、意义、检测等内容。';
  const plan=structuredClone(outline);
  assert.deepEqual(referenceAdoptionIssues({chapters:plan,referenceUsage:usage},text),[],'小结回顾内容不能变成标题关键词要求');
  const noDesign=structuredClone(outline);noDesign[2].sections=noDesign[2].sections.filter(s=>!s.includes('PCB'));noDesign[4].sections[0]='5.1 电路板调试';
  const fixed=ensurePcbOutline(noDesign,facts,{});
  assert.ok(fixed[2].sections.some(s=>/PCB/.test(s)),'电路板调试不能冒充PCB设计');
  scenarios++;
}
{
  let content='1.1 课题来源与研究背景\n\n原始背景不能变。\n\n1.5 论文结构安排\n\n全文只有五章。第1章绪论，第5章系统测试。\n\n1.6 本章小结\n\n保留小结。';
  content=synchronizePaperOrganization(content,outline[0],outline);
  assert.ok(content.includes('原始背景不能变。'));assert.ok(content.endsWith('保留小结。'));
  assert.ok(!content.includes('只有五章'));assert.deepEqual(organizationCoverageIssues(content,outline),[]);
  assert.equal(synchronizePaperOrganization(content,outline[0],outline),content);
  const noHeading={...outline[0],sections:['1.1 研究背景','1.2 研究内容']};
  const separate='1.1 研究背景\n\n保留背景分析。\n\n1.2 研究内容\n\n全文共分为五章。\n\n第1章为绪论。\n\n第5章为系统测试。';
  const replaced=synchronizePaperOrganization(separate,noHeading,outline);
  assert.ok(!replaced.includes('五章'));assert.equal((replaced.match(/第1章/g)||[]).length,1);assert.deepEqual(organizationCoverageIssues(replaced,outline),[]);
  const combined={...outline[0],sections:['1.1 主要研究内容及论文结构','1.1.1 主要研究内容','1.1.2 论文结构安排']};
  const text='1.1 主要研究内容及论文结构\n\n1.1.1 主要研究内容\n\n采集和控制的研究内容。\n\n1.1.2 论文结构安排\n\n全文五章。';
  const result=synchronizePaperOrganization(text,combined,outline);
  assert.ok(result.includes('采集和控制的研究内容。'));assert.equal((result.match(/全文共分为6章/g)||[]).length,1);
  const twelve=Array.from({length:12},(_,i)=>({id:String(i+1),title:`章节主题${i+1}`,sections:[]}));
  assert.deepEqual(organizationCoverageIssues(synchronizePaperOrganization('',outline[0],twelve),twelve),[]);scenarios++;
}
{
  assert.deepEqual(validateReferenceInterpretation({outlineText:reference,warnings:[]},reference).warnings,[]);
  assert.throws(()=>validateReferenceInterpretation({outlineText:reference.replace('3.4 PCB电路板图设计',''),warnings:[]},reference),/遗漏/);
  assert.throws(()=>validateReferenceInterpretation({outlineText:reference.replace('1.1 课题来源与研究背景','1.1 研究背景及意义'),warnings:[]},reference),/改变第一章/);
  assert.throws(()=>validateReferenceInterpretation({outlineText:reference.replace('1.3.2 国外研究现状',''),warnings:[]},reference),/改变第一章/);
  const placeholder='第三章 硬件设计\n3.5 **PCB设计';
  assert.throws(()=>validateReferenceInterpretation({outlineText:'第三章 硬件设计\n3.5 **模块设计',warnings:[]},placeholder),/PCB方向/);
  assert.throws(()=>validateReferenceInterpretation({outlineText:'',warnings:[]},reference),/未返回/);
  assert.equal(effectiveReferenceText({outlineReferenceText:'raw',outlineReferenceAnalysis:{status:'ready',inputText:'raw',outlineText:'parsed'}}),'parsed');
  assert.equal(effectiveReferenceText({outlineReferenceText:'edited',outlineReferenceAnalysis:{status:'ready',inputText:'raw',outlineText:'parsed'}}),'edited');scenarios++;
}
{
  const raw='第三章 系统硬件设计\n3.2 **模块设计\n可给出模块选型说明\n3.5 **PCB设计\n说明使用的EDA工具，简述PCB过程中的规则与注意事项。';
  assert.throws(()=>validateReferenceInterpretation({outlineText:'第三章 系统硬件设计\n3.2 **模块设计\n3.5 **PCB设计',warnings:[]},raw),/选型说明方向/);
  const text='第三章 系统硬件设计\n3.2 **模块设计\n【小节方向：3.2】给出模块选型说明\n3.5 **PCB设计\n【小节方向：3.5】说明EDA工具与PCB布局布线规则';
  const result=validateReferenceInterpretation({outlineText:text,warnings:[]},raw);
  assert.ok(result.outlineText.includes('【小节方向：3.2】'));
  assert.equal(parseReferenceOutline(result.outlineText).units.find(u=>u.number==='3.2').guidance[0].sectionId,'3.2');
  const contract=chapterReferenceContract({id:'3'},result.outlineText,[]);
  assert.ok(contract.requirements.some(u=>/模块选型说明/.test(u.text)));
  assert.ok(validateOutlineStructure({chapters:Prompts.buildProjectOutline(facts)},'第三章 模块选型与硬件设计').some(i=>i.includes('第3章')));
  const retrospective='第三章 系统硬件设计\n3.6 本章小结\n本章节首先介绍了总体设计，其后介绍了主控选型及接口检测。';
  assert.doesNotThrow(()=>validateReferenceInterpretation({outlineText:'第三章 系统硬件设计\n3.6 本章小结',warnings:[]},retrospective),'小结回顾的选型不是新的选型位置要求');
  scenarios++;
}
{
  const file=(name,text)=>({name,size:100,text:async()=>text,arrayBuffer:async()=>new ArrayBuffer(0)});
  assert.throws(()=>validateReferenceFiles([file('旧版.doc','')]),/另存为DOCX/);
  assert.throws(()=>validateReferenceFiles([{name:'目录.png',size:21*1024*1024}]),/20 MB/);
  const result=await readReferenceFiles([file('目录.txt',reference),file('补充.md','各章包含小结')]);
  assert.equal(result.filenames.length,2);assert.equal(result.ocrPages,0);assert.ok(result.text.includes('各章包含小结'));scenarios++;
}
{
  let closed=0, recognized=0;
  const file={name:'图文混合.docx',size:1,arrayBuffer:async()=>new ArrayBuffer(0)};
  const mammoth={extractRawText:async()=>({value:'第一章 绪论\n1.1 研究背景'}),images:{imgElement:fn=>fn},convertToHtml:async(_,opts)=>{
    await opts.convertImage({contentType:'image/png',read:async()=> 'AAA'});
  }};
  const createWorker=async()=>({recognize:async()=>{recognized++;return {data:{text:'第三章 硬件设计\n3.1 模块选型\n3.2 PCB设计'}};},terminate:async()=>{closed++;}});
  const result=await readReferenceFiles([file],{mammoth,createWorker});
  assert.equal(recognized,1);assert.equal(closed,1);assert.ok(result.text.includes('PCB设计'));scenarios++;
}
{
  let terminated=0;
  const worker=async()=>({recognize:async()=>({data:{text:''}}),terminate:async()=>{terminated++;}});
  await assert.rejects(readReferenceFiles([{name:'空白.png',size:1}],{createWorker:worker}),/未识别到文字/);
  assert.equal(terminated,1);
  const abort=new AbortController();abort.abort(new DOMException('取消','AbortError'));
  await assert.rejects(readReferenceFiles([{name:'目录.png',size:1}],{signal:abort.signal,createWorker:worker}),e=>e.name==='AbortError');scenarios++;
}
{
  const abort=new AbortController();let terminated=0;
  let recognizing;const ready=new Promise(resolve=>{recognizing=resolve;});
  const task=readReferenceFiles([{name:'目录.png',size:1}],{signal:abort.signal,createWorker:async()=>({recognize:()=>{recognizing();return new Promise(()=>{});},terminate:async()=>{terminated++;}})});
  const rejection=assert.rejects(task,e=>e.name==='AbortError');
  await ready;abort.abort(new DOMException('取消','AbortError'));await rejection;
  assert.ok(terminated>0,'识别挂起时取消仍终止worker并立即返回');
  const mammoth={extractRawText:async()=>({value:reference}),images:{imgElement:fn=>fn},convertToHtml:async(_,opts)=>{await opts.convertImage({contentType:'image/png',read:async()=> 'AAA'});}};
  const result=await readReferenceFiles([{name:'带装饰图.docx',size:1,arrayBuffer:async()=>new ArrayBuffer(0)}],{mammoth,createWorker:async()=>({recognize:async()=>({data:{text:''}}),terminate:async()=>{}})});
  assert.ok(result.text.includes('PCB'),'有正文的Word装饰图无文字不影响导入');scenarios++;
}
{
  const source=await fs.readFile(new URL('../app.js',import.meta.url),'utf8');
  const extract=name=>{const start=source.search(new RegExp(`(?:async )?function ${name}\\(`));const tail=source.slice(start+1).search(/\n(?:async )?function /);return source.slice(start,start+1+tail);};
  const ctx=vm.createContext({});vm.runInContext(extract('missingRequiredHeadings'),ctx);
  ctx.chapter=outline[2];ctx.content=outline[2].sections.filter(s=>!s.startsWith('3.4')).join('\n');
  assert.ok(vm.runInContext('missingRequiredHeadings(chapter,content)',ctx).includes('3.4 PCB电路板图设计'));
  ctx.content=outline[2].sections.join('\n').replace('3.1 模块选型','3.1 系统组成');
  assert.ok(vm.runInContext('missingRequiredHeadings(chapter,content)',ctx).includes('3.1 模块选型'));
  const materials={outlineReferenceText:reference};let calls=0;
  const elements=new Map();const $=id=>{if(!elements.has(id))elements.set(id,{value:''});return elements.get(id);};
  const app=vm.createContext({project:{id:'p',paper:{materials}},$,REFERENCE_IMPORT_VERSION,buildReferenceInterpretationMessages,validateReferenceInterpretation,referenceReviewState,referenceEditorText,updateReferenceEditorText,
    callAi:async()=>{calls++;return JSON.stringify({outlineText:reference,warnings:[]});},AI_SCHEMAS:{},parseJsonResponse:JSON.parse,nowIso:()=> 'time',persistProject:async()=>{},renderOutlineImportStatus(){}});
  vm.runInContext(extract('ensureOutlineReferenceParsed'),app);
  await vm.runInContext('ensureOutlineReferenceParsed(null)',app);await vm.runInContext('ensureOutlineReferenceParsed(null)',app);
  assert.equal(calls,1,'同一目录只解读一次，避免重复API费用');
  materials.outlineReferenceAnalysis.status='needs-review';
  await assert.rejects(vm.runInContext('ensureOutlineReferenceParsed(null)',app),e=>e.referenceReview===true);
  assert.equal(calls,1,'待核对时不得再次调用AI或开始写作');
  materials.outlineReferenceAnalysis.status='ready';
  materials.outlineReferenceText='';await vm.runInContext('ensureOutlineReferenceParsed(null)',app);assert.equal(calls,1);
  materials.outlineReferenceText=reference;app.callAi=async()=>'{"outlineText":"","warnings":[]}';
  await assert.rejects(vm.runInContext('ensureOutlineReferenceParsed(null,{force:true})',app),/未返回/);
  assert.equal(materials.outlineReferenceText,reference);
  assert.equal(materials.outlineReferenceAnalysis.status,'ready','重新解读失败不丢失已有目录');
  assert.ok(materials.outlineReferenceAnalysis.lastError.includes('未返回'));scenarios++;
  let repairCalls=0;
  app.callAi=async()=>JSON.stringify({outlineText:++repairCalls===1?reference.replace('1.1 课题来源与研究背景','1.1 研究背景'):reference,warnings:[]});
  await vm.runInContext('ensureOutlineReferenceParsed(null,{force:true})',app);
  assert.equal(repairCalls,2,'清晰资料解读遗漏最多进行一次带具体问题的修正');
  assert.equal(materials.outlineReferenceAnalysis.status,'ready');
  app.callAi=async()=>JSON.stringify({outlineText:reference,warnings:['图片里有一个字不确定']});
  await assert.rejects(vm.runInContext('ensureOutlineReferenceParsed(null,{force:true})',app),e=>e.referenceReview===true);
  assert.equal(materials.outlineReferenceAnalysis.status,'needs-review');
  assert.ok(materials.outlineReferenceAnalysis.outlineText.includes('PCB'),'待核对必须保留可编辑的候选目录');

  // Use the actual UI handler: adopting the candidate must not require a dummy
  // edit, another AI call, or another confirmation after a project reload.
  let invalidations=0;
  Object.assign(app,{requestController:null,confirmReferenceInterpretation,
    capturePaperMaterials(){},invalidateOutlinePlan(){invalidations++;},toast(){}});
  vm.runInContext(extract('confirmOutlineReference'),app);
  $('paper-outline-reference').value=materials.outlineReferenceAnalysis.outlineText;
  const candidate=$('paper-outline-reference').value;
  await vm.runInContext('confirmOutlineReference()',app);
  assert.equal(materials.outlineReferenceAnalysis.status,'ready');
  assert.equal(materials.outlineReferenceAnalysis.confirmedByUser,true);
  assert.equal(materials.outlineReferenceAnalysis.outlineText,candidate);
  assert.equal(materials.outlineReferenceText,reference,'原始参考资料保留');
  assert.ok(materials.outlineReferenceAnalysis.warnings.includes('图片里有一个字不确定'));
  assert.equal(invalidations,1,'采用后的目录使旧的写作规划失效');
  app.callAi=async()=>{throw new Error('已采用目录不应再次花费API额度');};
  await vm.runInContext('ensureOutlineReferenceParsed(null)',app);
  app.project.paper.materials=JSON.parse(JSON.stringify(materials));
  await vm.runInContext('ensureOutlineReferenceParsed(null)',app);
  assert.equal(effectiveReferenceText(app.project.paper.materials),candidate,'重新载入仍以已采用目录写作');

  $('paper-outline-reference').value=candidate.replace('3.4 PCB电路板图设计','3.4 PCB布局布线设计');
  assert.equal(updateReferenceEditorText(app.project.paper.materials,$('paper-outline-reference').value),true);
  assert.equal(app.project.paper.materials.outlineReferenceAnalysis.status,'needs-review');
  await vm.runInContext('confirmOutlineReference()',app);
  assert.ok(effectiveReferenceText(app.project.paper.materials).includes('PCB布局布线设计'));
  assert.equal(app.project.paper.materials.outlineReferenceAnalysis.warnings.length,0,'已修改结果不沿用旧识别提醒');
  await vm.runInContext('ensureOutlineReferenceParsed(null)',app);
  scenarios++;

  // The single visible editor shows the interpretation while capture of other
  // fields preserves its source, cache, and optional edits.
  const saved=app.project.paper.materials;
  assert.ok(referenceEditorText(saved).includes('PCB布局布线设计'));
  assert.equal(updateReferenceEditorText(saved,referenceEditorText(saved)),false);
  assert.equal(saved.outlineReferenceText,reference);
  assert.equal(saved.outlineReferenceAnalysis.status,'ready');
  const editorText=referenceEditorText(saved);
  let interpreted='';
  app.callAi=async messages=>{
    interpreted=messages.map(item=>item.content).join('\n');
    return JSON.stringify({outlineText:editorText,warnings:[]});
  };
  await vm.runInContext('ensureOutlineReferenceParsed(null,{force:true})',app);
  assert.ok(interpreted.includes('PCB布局布线设计'),'重新解读以框内当前目录为准');
  assert.equal(saved.outlineReferenceAnalysis.status,'ready');
  assert.equal(referenceEditorText(JSON.parse(JSON.stringify(saved))),editorText,'刷新后同一个框仍显示解读结果');

  Object.assign(app,{MIN_BODY_CHARS:15000,sanitizeTechnicalText:text=>text,clampReferenceCount:()=>15,
    updateProjectNameFromTitle(){},resetHardwareAnalysis(){},activeChapterRecords:()=>[]});
  vm.runInContext(extract('capturePaperMaterials'),app);
  $('paper-outline-reference').value=editorText;
  await vm.runInContext('capturePaperMaterials({invalidate:false})',app);
  assert.equal(saved.outlineReferenceText,reference,'其他资料保存不能把可见目录当作新原文清空解读');
  assert.equal(saved.outlineReferenceAnalysis.status,'ready');
  $('paper-outline-reference').value=editorText.replace('PCB布局布线设计','PCB工艺设计');
  await vm.runInContext('capturePaperMaterials({invalidate:false})',app);
  assert.ok(saved.outlineReferenceAnalysis.draftText.includes('PCB工艺设计'));
  assert.equal(saved.outlineReferenceText,reference,'编辑解读目录仍保留原始资料');
  const duringEdit=referenceEditorText(saved);
  app.callAi=async()=>{
    updateReferenceEditorText(saved,duringEdit.replace('PCB工艺设计','PCB接口设计'));
    return JSON.stringify({outlineText:duringEdit,warnings:[]});
  };
  await assert.rejects(vm.runInContext('ensureOutlineReferenceParsed(null,{force:true})',app),/在解读期间已改变/);
  assert.ok(referenceEditorText(saved).includes('PCB接口设计'),'迟到的AI响应不能覆盖期间的新编辑');
  assert.equal(updateReferenceEditorText(saved,''),true);
  assert.equal(saved.outlineReferenceText,'');assert.equal(saved.outlineReferenceAnalysis,null);
  assert.equal(referenceEditorText(saved),'','清空后不能因旧缓存重新出现目录');
  scenarios++;
}
console.log(JSON.stringify({scenarios,status:'passed'}));
