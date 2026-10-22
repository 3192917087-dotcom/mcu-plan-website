import { normalizeReferenceSource } from './reference-text.js?v=20261018-3';
// Reference outlines are writing instructions, including incomplete and OCR-derived headings.
export const OUTLINE_POLICY_VERSION = 8;
export const CORE_CHAPTER_ROLES = ['introduction', 'overall', 'hardware', 'software', 'test', 'conclusion'];
export const SELECTION_HEADING = /选型|选用|选取|器件选择|模块选择|器件比较|器件对比|方案论证|(?:主控|微控制器|传感器|芯片).{0,12}(?:选择|比较|对比)/;
export const PCB_HEADING = /PCB|印制(?:电路)?板|电路板(?:图|设计|布局|布线)|制板|布板/i;

// A carrier/interface PCB can coexist with the user's minimum-system board.
// Explicit project facts override this default; a template is not project evidence.
export function pcbDesignPolicy(facts = {}, materials = {}) {
  const evidence = [materials.sourceNotes || '', materials.toolsText || '', materials.connectionsText || '', materials.schemeRawText || '', ...(facts.fixedFacts || [])].join('\n');
  const disabled = /(?:不使用|不采用|无需|不用|没有|不涉及|未设计|不做|不制作)\s*(?:定制|独立|自制)?\s*(?:PCB|印制(?:电路)?板|电路板)|(?:仅|只)(?:使用|采用|用)?(?:面包板|洞洞板|杜邦线)/i.test(evidence);
  const namedTool = evidence.match(/(?:制图软件|EDA软件|PCB软件)(?:为|是|使用|采用|[：:])\s*([^\n。；]{2,40})/i)?.[1]
    || evidence.match(/(?:PCB|电路板|原理图).{0,16}(?:软件|工具)(?:为|是|使用|采用|[：:])\s*([^\n。；]{2,30})/i)?.[1];
  return { enabled: !disabled, tool: namedTool || '嘉立创专业版', source: disabled ? 'explicit' : 'default',
    description: disabled ? '用户明确不使用PCB，不得声称已制作PCB' : '默认使用PCB；主控开发板可保留，PCB作为承载或接口连接板，不改写成裸芯片自制最小系统' };
}

export function effectiveReferenceText(materials = {}) {
  const analysis=materials.outlineReferenceAnalysis;
  return analysis?.status==='ready' && analysis.inputText===String(materials.outlineReferenceText || '').trim()
    ? analysis.outlineText : String(materials.outlineReferenceText || '').trim();
}

export function referenceSelectionChapterIds(reference = {}) {
  return [...new Set([...(reference.units || []).filter(unit=>unit.chapterId && SELECTION_HEADING.test(unit.text)).map(unit=>unit.chapterId),
    ...(reference.chapters || []).filter(chapter=>SELECTION_HEADING.test(chapter.title)).map(chapter=>chapter.id)])];
}
export function referenceHasSelection(reference = {}) {
  return referenceSelectionChapterIds(reference).length>0 || (reference.units || []).some(unit=>SELECTION_HEADING.test(unit.text));
}

export function ensurePcbOutline(outline = [], facts = {}, materials = {}) {
  if (!pcbDesignPolicy(facts,materials).enabled || outline.some(chapter=>(chapter.sections || []).some(section=>PCB_HEADING.test(section)))) return outline;
  const reference=parseReferenceOutline(effectiveReferenceText(materials));
  const required=reference.units.find(unit=>PCB_HEADING.test(unit.text) && unit.chapterId);
  const requiredChapter=required?.chapterId || reference.chapters.find(chapter=>PCB_HEADING.test(chapter.title))?.id;
  const chapter=outline.find(item=>item.id===requiredChapter) || findRoleChapter(outline,'hardware');
  if (!chapter) return outline;
  const summary=chapter.sections.find(section=>/^\d+\.\d+\s+.*(?:本章小结|本章总结|章节小结)/.test(section));
  const summaryNumber=summary?.match(/^\d+\.\d+/)?.[0];
  const sections=chapter.sections.filter(section=>!summaryNumber || !(section.startsWith(summaryNumber+' ') || section.startsWith(summaryNumber+'.')));
  let last=Math.max(0,...sections.filter(section=>/^\d+\.\d+\s/.test(section)).map(section=>Number(section.match(/^\d+\.(\d+)/)[1])));
  sections.push(`${chapter.id}.${++last} PCB电路板设计`);
  if (summary) sections.push(`${chapter.id}.${++last} ${summary.replace(/^\d+\.\d+\s+/,'')}`);
  return outline.map(item=>item===chapter?{...chapter,sections}:item);
}

export function chapterRoles(chapter = {}) {
  if (Array.isArray(chapter.roles) && chapter.roles.length) return [...new Set(chapter.roles.filter(role => CORE_CHAPTER_ROLES.includes(role)))];
  if (chapter.kind === 'implementation') return ['hardware', 'software'];
  return CORE_CHAPTER_ROLES.includes(chapter.kind) ? [chapter.kind] : [];
}
export function hasChapterRole(chapter, role) { return chapterRoles(chapter).includes(role); }
export function findRoleChapter(outline = [], role) { return outline.find(chapter => hasChapterRole(chapter, role)); }
export function activeChapterRecords(paper = {}) {
  return (paper?.outline || []).map(chapter => paper.chapters?.[chapter.id]).filter(Boolean);
}
export function chapterProgressLabel(chapter, action = '') {
  const label = chapter ? `第${chapter.id}章 ${chapter.title}` : '正文';
  return action ? `${label} · ${action}` : label;
}
// Keep a recoverable snapshot when the new reference changes chapter identities.
// Obsolete chapters must not enter word counts, audits or the exported document.
export function applyPlannedOutline(paper, outline, savedAt) {
  const identity = chapters => (chapters || []).map(chapter => ({id:chapter.id,title:chapter.title,kind:chapter.kind,roles:chapterRoles(chapter),sections:chapter.sections}));
  const changed = JSON.stringify(identity(paper.outline)) !== JSON.stringify(identity(outline));
  if (changed && Object.values(paper.chapters || {}).some(chapter => chapter?.content)) {
    paper.outlineHistory = [...(paper.outlineHistory || []), structuredClone({savedAt,outline:paper.outline,chapters:paper.chapters,artifacts:paper.artifacts})];
  }
  const active = {};
  for (const chapter of outline) {
    const saved = paper.chapters?.[chapter.id];
    const previous = (paper.outline || []).find(item=>item.id===chapter.id);
    const sameIdentity = JSON.stringify(identity([previous].filter(Boolean))) === JSON.stringify(identity([chapter]));
    if (saved && (!changed || sameIdentity)) active[chapter.id] = changed && saved.content ? {...saved,status:'stale'} : saved;
  }
  paper.outline = outline;
  paper.chapters = active;
  return changed;
}
export function insertChapterSupplement(content, addition, chapter = {}) {
  const text = String(content || '').trim();
  const heading = (chapter.sections || []).find(section => /本章(?:小结|总结)|章节小结/.test(section));
  const number = heading?.match(/^\d+(?:\.\d+){1,2}/)?.[0];
  const escaped = number?.replace(/\./g,'\\.');
  const marker = escaped ? new RegExp(`^\\s*#{0,6}\\s*${escaped}\\s+[^\\n]*$`,'m') : /^\s*#{0,6}\s*\d+(?:\.\d+){1,2}\s+(?:本章小结|本章总结|章节小结)\s*$/m;
  const match = marker.exec(text);
  const at = match ? match.index : text.length;
  return [text.slice(0,at).trim(),String(addition || '').trim(),text.slice(at).trim()].filter(Boolean).join('\n\n');
}
export function selectionChapter(outline = []) {
  return outline.find(chapter => SELECTION_HEADING.test(chapter.title) || (chapter.sections || []).some(section => SELECTION_HEADING.test(section)))
    || outline.find(chapter => String(chapter.id) === '2') || findRoleChapter(outline, 'overall');
}
export function scopeRoleChapter(chapter, role) {
  if (!chapter || chapterRoles(chapter).length <= 1) return chapter;
  const patterns = {overall:/总体|方案|框架|原理/,hardware:/硬件|电路|接口|供电|电源/,software:/软件|程序|逻辑|算法|开发环境/,test:/测试|验证|调试|稳定性/,conclusion:/总结|结论|展望/};
  const sections = chapter.sections || [];
  const roots = sections.filter(section => /^\d+\.\d+\s/.test(section) && patterns[role]?.test(section)).map(section => section.match(/^\d+\.\d+/)[0]);
  return roots.length ? {...chapter,sections:sections.filter(section => roots.some(number => section.startsWith(number+' ') || section.startsWith(number+'.')))} : chapter;
}

export function normalizeReferenceUsage(records = [], outline = [], referenceText = '', facts = {}) {
  const reference=parseReferenceOutline(referenceText);
  const numbers=new Set(outline.flatMap(chapter=>(chapter.sections || []).map(section=>section.match(/^\d+(?:\.\d+){1,2}/)?.[0]).filter(Boolean)));
  const actualTopics=JSON.stringify({devices:facts.devices || [],functions:facts.functions || []});
  return records.map(record=>{
    const unit=reference.units.find(unit=>unit.id===record.referenceId);
    const optional=unit?.text.match(/APP|上位机/i)?.[0];
    const absent=optional && !new RegExp(optional,'i').test(actualTopics)
      && new RegExp(`(?:方案|本(?:设计|系统|项目))[^。；]{0,12}(?:无|没有|不涉及|不需要|未(?:采用|涉及|要求|设计))\\s*${optional}`,'i').test(record.reason || '');
    if (record.action==='adapted' && absent) return {...record,action:'not-applicable',sections:[]};
    if (/^(?:本章小结|本章总结|章节小结)\s*$/.test(unit?.title || '')) {
      const summary=outline.find(chapter=>chapter.id===unit.chapterId)?.sections?.find(section=>/本章(?:小结|总结)|章节小结/.test(section));
      if (summary) return {...record,sections:[summary.match(/^\d+\.\d+/)[0]]};
    }
    const sections=(record.sections || []).map(value=>{
      const original=String(value).trim();
      let number=original;
      // A generated fourth-level child refers to its retained third-level parent.
      if (number.split('.').length>3) number=number.split('.').slice(0,3).join('.');
      if (numbers.has(number)) return number;
      const chapter=!original.includes('.') && outline.find(chapter=>chapter.id===number);
      return chapter?.sections?.find(section=>new RegExp(`^${number}\\.\\d+\\s`).test(section))?.match(/^\d+\.\d+/)?.[0] || String(value);
    });
    return {...record,sections:[...new Set(sections)]};
  });
}

export function completePartialIntroduction(outline = [], referenceText = '') {
  const reference=parseReferenceOutline(referenceText);
  if (reference.mode!=='partial') return outline;
  const introReference=reference.chapters.find(chapter=>chapter.id==='1');
  if (introReference?.sectionCount>=2) return outline;
  const intro=findRoleChapter(outline,'introduction');
  if (!intro) return outline;
  const headings=(intro.sections || []).join('\n');
  const missing=[];
  if (!/主要(?:研究)?内容|研究内容|设计内容|研究任务|主要工作|本文工作/.test(headings)) missing.push('主要研究内容');
  if (!/论文结构|结构安排|组织结构|章节安排|论文安排/.test(headings)) missing.push('论文结构安排');
  if (!missing.length) return outline;
  const summary=intro.sections.find(section=>/^\d+\.\d+\s+.*(?:本章小结|本章总结|章节小结)/.test(section));
  const summaryNumber=summary?.match(/^\d+\.\d+/)?.[0];
  const sections=intro.sections.filter(section=>!summaryNumber || !(section.startsWith(summaryNumber+' ') || section.startsWith(summaryNumber+'.')));
  let last=Math.max(0,...sections.filter(section=>/^\d+\.\d+\s/.test(section)).map(section=>Number(section.match(/^\d+\.(\d+)/)[1])));
  for (const title of missing) sections.push(`${intro.id}.${++last} ${title}`);
  if (summary) sections.push(`${intro.id}.${++last} ${summary.replace(/^\d+\.\d+\s+/,'')}`);
  return outline.map(chapter=>chapter===intro?{...chapter,sections}:chapter);
}
function chapterNumber(value = '') {
  if (/^\d+$/.test(value)) return Number(value);
  const digits = {零:0,一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9};
  const parts = value.split('十');
  return parts.length === 2 ? (digits[parts[0]] || 1) * 10 + (digits[parts[1]] || 0) : digits[value];
}

const TOPICS = [
  ['background', /背景/, /背景/],
  ['purpose', /目的|意义|价值/, /目的|意义|价值/],
  ['research', /研究现状|国内外|国内研究|国外研究/, /研究现状|国内|国外|相关研究/],
  ['content', /主要内容|研究内容|设计内容/, /主要内容|研究内容|设计内容|研究任务/],
  ['organization', /论文结构|结构安排|组织结构/, /论文结构|结构安排|组织结构|章节安排/],
  ['selection', /选型|器件选择|(?:主控|微控制器).*选择|器件对比/, /选型|选用|选取|选择|比较|对比|论证/],
  ['pcb', PCB_HEADING, PCB_HEADING],
  ['architecture', /整体框架|总体结构|总体设计|系统架构/, /框架|总体|架构|结构|组成/],
  ['acquisition', /采集|传感|检测/, /采集|传感|检测|测量|感知/],
  ['control', /执行|控制|调节/, /执行|控制|调节|驱动|联动/],
  ['communication', /通信|蓝牙|无线|联网|APP|协议/i, /通信|蓝牙|无线|联网|APP|协议|交互|远程/i],
  ['algorithm', /算法|滤波|融合/, /算法|滤波|融合|处理|判定|判断/],
  ['safety', /报警|预警|安全/, /报警|预警|安全|异常/],
  ['initialization', /初始化|主程序|整体功能流程/, /初始化|主程序|任务调度|主循环|运行流程|整体流程/],
  ['environment', /开发环境|开发软件|设计语言/, /环境|工具|语言|软件平台/],
  ['test', /测试|验证|调试/, /测试|验证|调试|实验/],
  ['summary', /本章小结|章节小结/, /本章小结|章节小结/],
];

export function parseReferenceOutline(value = '') {
  const source = normalizeReferenceSource(value).text;
  // DOCX extraction often puts a chapter after the preceding paragraph on the
  // same line. Tabs/dot leaders followed by numbers are TOC page numbers.
  const inputLines = source.replace(/([^\n])[\t \u3000]{2,}(第\s*[一二两三四五六七八九十\d]+\s*章)/g,'$1\n$2').split('\n').map(line=>line.trim()
    .replace(/^#{1,6}\s*/, '').replace(/．/g,'.')
    .replace(/(?:\t+|\.{2,}|…{2,}|·{3,}|[ \u3000]{2,})\s*[\divxIVX]+\s*$/,'').replace(/\t+/g,' ').trim());
  const chapterPattern = /^第\s*([一二两三四五六七八九十\d]+)\s*[章音]\s*(.+)$/;
  const explicitChapterIds=new Set(inputLines.map(line=>line.match(chapterPattern)?.[1]).filter(Boolean).map(value=>String(chapterNumber(value))));
  const hasHeadings = inputLines.some(line=>chapterPattern.test(line) || /^\d+\.\d+/.test(line));
  const placeholder = text=>/[*＊?？]|[一二三123]级标题|章节标题/.test(text);
  const notes = [];
  const units = [];
  const directions=[];
  const byNumber = new Map();
  const chapters = new Map();
  const ensureChapter = id => {
    if (!chapters.has(id)) chapters.set(id, { id, title: '', sectionCount: 0, hasSummary: false });
    return chapters.get(id);
  };
  for (let line of inputLines) {
    const direction=line.match(/^【(?:章节|小节|内容)方向[：:]\s*(\d+(?:\.\d+){0,2})】\s*(.+)$/);
    if(direction) {directions.push({number:direction[1],text:direction[2]});continue;}
    if (!line || /^(?:目录|参考文献|致谢|摘要|Abstract|Contents|毕业设计|毕业论文|本科毕业设计|本科毕业论文|学士学位论文)\d*$/i.test(line.replace(/\s/g,''))) continue;
    if (/本学位论文作者|本学位论文的全部|独创性声明|原创性声明|版权使用授权|学位论文使用授权|作者签名|指导教师签名/.test(line)) continue;
    const compact=line.replace(/\s/g,'');
    if (/^(?:结论|总结(?:与展望)?|结束语)$/.test(compact)) { notes.push(`保留未编号的${compact}部分`);continue; }
    const bareChapter=line.match(/^([1-9]|1[0-2])\s+[、.]?\s*([^\d].+)$/);
    const chapterMatch = line.match(chapterPattern)
      || (bareChapter && !explicitChapterIds.has(bareChapter[1]) ? bareChapter : null);
    if (chapterMatch) {
      const id = String(chapterNumber(chapterMatch[1]));
      const chapter = ensureChapter(id);
      const title = chapterMatch[2].trim();
      // Concrete blocks supersede generic templates. A repeated chapter header
      // on a continuation screenshot must retain earlier concrete subsections.
      const priorUnits=units.filter(unit=>unit.chapterId===id);
      const genericBlock=priorUnits.every(unit=>placeholder(unit.title) && unit.children.every(placeholder));
      const changedTitle=chapter.title.replace(/\s/g,'')!==title.replace(/\s/g,'');
      if (chapter.title && (!placeholder(title) || placeholder(chapter.title)) && (changedTitle || genericBlock)) {
        for (let i=units.length-1;i>=0;i--) if (units[i].chapterId===id) { byNumber.delete(units[i].number);units.splice(i,1); }
        chapter.sectionCount=0;chapter.hasSummary=false;
      }
      if (!chapter.title || !placeholder(title) || placeholder(chapter.title)) chapter.title = title;
      continue;
    }
    let match = line.match(/^(\d+)\.(\d+)(?:\.(\d+))?\s*[、.]?\s*(\S.*)$/);
    // Common OCR loss: "42软件初始化" means section 4.2, not a new chapter 42.
    if (!match) {
      const ocr = line.match(/^([1-9])([1-9])\s*([^\d\s].{2,})$/);
      if (ocr) match = [ocr[0], ocr[1], ocr[2], undefined, ocr[3]];
    }
    if (match) {
      const parentNumber = `${Number(match[1])}.${Number(match[2])}`;
      const number = match[3] ? `${parentNumber}.${Number(match[3])}` : parentNumber;
      let unit = byNumber.get(parentNumber);
      if (!unit) {
        unit = { id: `reference-${units.length + 1}`, number: parentNumber, chapterId: String(Number(match[1])), title: '', text: '', children: [] };
        units.push(unit); byNumber.set(parentNumber, unit);
      }
      if (match[3]) {
        const childIndex=unit.children.findIndex(child=>child.startsWith(`${number} `));
        if (childIndex<0) unit.children.push(`${number} ${match[4]}`);
        else unit.children[childIndex]=`${number} ${match[4]}`;
      } else unit.title = match[4];
      unit.text = [unit.title ? `${parentNumber} ${unit.title}` : '', ...unit.children].filter(Boolean).join('\n');
      const chapter = ensureChapter(String(Number(match[1])));
      chapter.sectionCount = units.filter(item=>item.chapterId===chapter.id).length;
      if (/本章(?:小结|总结)|章节小结/.test(match[4])) chapter.hasSummary = true;
    } else if (line.length >= 3 && (!hasHeadings || (line.length<=140 && /要求|必须|请|保留|分成|分为|合并|不设|不需要|不必|(?:每|各|所有).*章|(?:共|全文|总计).{0,10}章|按.*(?:组织|结构)/.test(line)))
      && !/字体|字号|宋体|黑体|行距|页边距|Times New Roman/.test(line)) {
      if (!notes.includes(line)) notes.push(line);
    }
  }
  const bySection=(a,b)=>a.localeCompare(b,undefined,{numeric:true});
  units.sort((a,b)=>bySection(a.number || '',b.number || ''));
  for(const unit of units) {unit.children.sort(bySection);unit.text=[unit.title ? `${unit.number} ${unit.title}` : '',...unit.children].filter(Boolean).join('\n');}
  const structure = [...chapters.values()].sort((a,b) => Number(a.id) - Number(b.id));
  for(const direction of directions) {
    const parent=direction.number.split('.').slice(0,2).join('.');
    const unit=units.find(item=>item.number===parent);
    if(unit) {
      unit.guidance=[...(unit.guidance || []),{sectionId:direction.number,text:direction.text}];
      unit.text+='\n'+`【小节方向：${direction.number}】${direction.text}`;
    } else {
      units.push({number:'',chapterId:direction.number.split('.')[0],title:`第${direction.number}部分内容方向`,text:`【章节方向：${direction.number}】${direction.text}`,children:[],guidance:[{sectionId:direction.number,text:direction.text}]});
    }
  }
  // Only the recovered framework and explicit structural instructions are sent
  // downstream; unrelated body prose and template tables are not requirements.
  notes.forEach(line=>units.push({number:'',chapterId:'',title:line,text:line,children:[]}));
  units.forEach((unit,index)=>unit.id=`reference-${index+1}`);
  const raw = [...structure.flatMap(chapter=>[chapter.title?`第${chapter.id}章 ${chapter.title}`:'',...units.filter(unit=>unit.chapterId===chapter.id).map(unit=>unit.text)]),...notes].filter(Boolean).join('\n');
  const declared = raw.match(/(?:共(?:分为|分)?|全文(?:分为|分成)|总计)\s*([一二两三四五六七八九十\d]+)\s*(?:个)?章/);
  const last = structure.at(-1);
  const count = declared ? chapterNumber(declared[1]) : last && /总结|结论|结束语/.test(last.title) ? Number(last.id) : null;
  const detailed = Boolean(count && structure.length === count && structure.every(chapter => chapter.title && !placeholder(chapter.title) && chapter.sectionCount >= 2)
    && !units.some(unit=>placeholder(unit.title)));
  return { rawText: raw, units, chapters: structure, chapterCount: count, minimumChapterCount: Number(last?.id || 0),
    mode: !raw ? 'none' : detailed ? 'detailed' : 'partial', unnumberedConclusion:notes.some(note=>/保留未编号的(?:结论|总结|结束语)/.test(note)),
    allChaptersHaveSummary: /(?:每(?:个)?|各(?:个)?|所有)章(?:节)?[^\n。]{0,12}(?:小结|总结)/.test(raw) };
}

export function referenceAdoptionIssues(plan = {}, referenceText = '', { facts = {}, materials = {} } = {}) {
  const reference = parseReferenceOutline(referenceText);
  if (!reference.units.length) return [];
  const headings = (plan.chapters || []).flatMap(chapter => chapter.sections || []);
  const usage = Array.isArray(plan.referenceUsage) ? plan.referenceUsage : [];
  const issues = [];
  for (const unit of reference.units) {
    const records = usage.filter(item => item.referenceId === unit.id);
    if (records.length !== 1) { issues.push(`参考目录“${unit.text}”缺少唯一的采纳说明（${unit.id}）`); continue; }
    const record = records[0];
    if (!['adopted', 'adapted', 'not-applicable'].includes(record.action)) { issues.push(`${unit.id}的采纳方式无效`); continue; }
    if (!String(record.reason || '').trim()) issues.push(`${unit.id}需要解释如何保留或调整参考目录意图`);
    const numbers = Array.isArray(record.sections) ? record.sections : [];
    const targets = numbers.map(number => headings.find(heading => heading.startsWith(`${number} `)));
    if (targets.some(item => !item)) issues.push(`${unit.id}指向了实际目录中不存在的小节`);
    if (record.action === 'not-applicable') {
      if (/背景|目的|意义|研究现状|研究内容|主要内容|论文结构|本章小结/.test(unit.text)) issues.push(`不能直接忽略参考目录的基础结构要求“${unit.text}”`);
      if (SELECTION_HEADING.test(unit.text)) issues.push(`参考已指定选型位置“${unit.text}”，不能将它判为不适用`);
      if (PCB_HEADING.test(unit.text) && pcbDesignPolicy(facts, materials).enabled) issues.push(`参考要求“${unit.text}”，当前默认使用PCB，不能删去此内容`);
      continue;
    }
    if (!targets.length) { issues.push(`${unit.id}没有对应的实际目录位置`); continue; }
    if (unit.chapterId && numbers.some(number => number.split('.')[0] !== unit.chapterId)) issues.push(`参考“${unit.title || unit.text}”应保留在第${unit.chapterId}章，不能迁往其他章节`);
    const adoptedText = headings.filter(heading => numbers.some(number => heading.startsWith(`${number} `) || heading.startsWith(`${number}.`))).join('\n');
    // A microcontroller is a hardware topic; its name alone does not request a
    // control-function subsection. Otherwise valid MCU-selection mappings fail.
    // Prose directions describe what to write, not extra heading keywords.
    // A summary's retrospective list belongs in its prose; requiring all of
    // those topics in its title creates false errors and costly repair loops.
    const headingText=[unit.title,...unit.children].join('\n');
    const isSummary=/^(?:本章小结|本章总结|章节小结)\s*$/.test(unit.title || '');
    const expectedTopics = TOPICS.filter(([topic, from]) => {
      const source=!isSummary && ['selection','pcb'].includes(topic) ? unit.text : headingText;
      return unit.number && from.test(topic === 'control' ? source.replace(/微控制器/g, '主控芯片') : source);
    });
    expectedTopics.forEach(([, from, to]) => {
      if (!to.test(adoptedText)) issues.push(`参考目录“${unit.title || unit.text}”中的“${unit.text.match(from)?.[0]}”尚未落实到所指向的标题`);
    });
    // Generic school-provided introduction headings are a contract, even if
    // the rest of the reference is partial. Project-specific headings may adapt.
    if (unit.chapterId === '1') {
      for (const line of [unit.title ? `${unit.number} ${unit.title}` : '', ...unit.children].filter(Boolean)) {
        const title = line.replace(/^\d+(?:\.\d+){1,2}\s+/, '');
        if (/[*＊?？]|[A-Za-z]{2,}\d/.test(title)) continue;
        if (!/^(?:课题|研究|课题研究|本课题|国内|国外|国内外|相关研究|论文|本文|主要|本章|技术路线|章节|组织)/.test(title)) continue;
        const key = title.replace(/[\s及与和、：:]/g, '');
        const number=line.match(/^\d+(?:\.\d+){1,2}/)?.[0];
        if (!targets.some(Boolean) || !headings.filter(heading=>heading.startsWith(number+' ')).some(heading=>heading.replace(/^\d+(?:\.\d+){1,2}\s+/, '').replace(/[\s及与和、：:]/g, '') === key)) issues.push(`第一章应保留参考标题“${title}”及其位置，不能套用默认绪论标题替代`);
      }
    }
  }
  return [...new Set(issues)];
}

export function validateOutlineStructure(plan = {}, referenceText = '', { facts = {}, materials = {} } = {}) {
  const outline = plan.chapters || [];
  const issues = [];
  const reference = parseReferenceOutline(referenceText);
  if (outline.length < 3 || outline.length > 12 || outline.some((chapter,index) => String(chapter.id) !== String(index + 1))) issues.push('目录章节须连续编号，支持3至12章');
  if (reference.chapterCount && outline.length !== reference.chapterCount) issues.push(`参考目录明确共${reference.chapterCount}章，不应改为${outline.length}章`);
  if (outline.length < reference.minimumChapterCount) issues.push('目录遗漏了参考中已明确存在的章节');
  if (reference.unnumberedConclusion && !reference.chapterCount && !outline.some(chapter=>Number(chapter.id)>reference.minimumChapterCount && hasChapterRole(chapter,'conclusion'))) issues.push('参考另列未编号的结论部分，应保留为独立末章，不能揉入测试章或本章小结');
  for (const role of CORE_CHAPTER_ROLES) if (!findRoleChapter(outline, role)) issues.push(`目录缺少${role}内容职责，可归入合并章节而非强行增加章数`);
  if (!hasChapterRole(outline[0], 'introduction')) issues.push('首章应承担研究引入与文献综述');
  const introUnits=reference.units.filter(unit=>unit.chapterId==='1' && unit.number);
  if(introUnits.length>=2 && reference.chapters.some(chapter=>chapter.id==='2')) {
    const actual=(outline[0]?.sections || []).filter(section=>/^1\.\d+\s/.test(section) && !/本章(?:小结|总结)|章节小结/.test(section));
    const expected=introUnits.filter(unit=>!/本章(?:小结|总结)|章节小结/.test(unit.title));
    if(actual.length!==expected.length) issues.push(`第一章参考已给出${expected.length}个二级分组，应沿用该框架；主要内容和论文安排可在原分组内补充，不能改成默认四节`);
    for(const unit of expected.filter(unit=>unit.children.length)) {
      const children=(outline[0]?.sections || []).filter(section=>section.startsWith(unit.number+'.'));
      if(children.length!==unit.children.length) issues.push(`第一章参考${unit.number}下有${unit.children.length}个三级分组，应保留该层级安排，不能另套默认结构`);
    }
  }
  for (const chapter of outline) {
    const sections = chapter.sections || [];
    const parsed = sections.map(section => String(section).match(/^(\d+)\.(\d+)(?:\.(\d+))?\s+(.+)$/));
    if (parsed.some(match => !match || match[1] !== String(chapter.id))) issues.push(`第${chapter.id}章存在编号无效或跨章的标题`);
    const h2 = parsed.filter(match => match && !match[3]);
    if (!h2.length) issues.push(`第${chapter.id}章需要二级标题`);
    h2.forEach((match, index) => { if (Number(match[2]) !== index + 1) issues.push(`第${chapter.id}章二级标题须连续且不重复`); });
    const counts = new Map();
    let currentParent = '';
    parsed.filter(Boolean).forEach(match => {
      const parent = `${match[1]}.${match[2]}`;
      if (!match[3]) currentParent = parent;
      else if (parent !== currentParent) issues.push(`${parent}.${match[3]}须紧随所属父级安排，不能跨小节交错`);
    });
    parsed.filter(match => match?.[3]).forEach(match => {
      const parent = `${match[1]}.${match[2]}`;
      if (!h2.some(item => item[1] === match[1] && item[2] === match[2])) issues.push(`${parent}.${match[3]}缺少父级标题`);
      const count = (counts.get(parent) || 0) + 1;
      counts.set(parent, count);
      if (Number(match[3]) !== count) issues.push(`${parent}的三级标题须连续且不重复`);
    });
    const names = parsed.filter(Boolean).map(match => match[4].replace(/[\s：:、，,。；;（）()]/g, ''));
    if (new Set(names).size !== names.length) issues.push(`第${chapter.id}章存在重复标题`);
    const summaries = h2.filter(match=>/本章(?:小结|总结)|章节小结/.test(match[4]));
    if (summaries.length && summaries.at(-1) !== h2.at(-1)) issues.push(`第${chapter.id}章小结应放在本章最后，不能在小结后安排新的设计内容`);
    const referenceChapter = reference.chapters.find(item => item.id === String(chapter.id));
    const roleNames = {introduction:/绪\s*论|前言|引言/,hardware:/硬件|电路/,software:/软件|程序/,test:/测试|验证|调试/,conclusion:/结论|总结与展望|结束语/};
    for (const [role,pattern] of Object.entries(roleNames)) {
      if (['hardware','software'].includes(role) && /测试|验证|调试/.test(referenceChapter?.title || '') && !/设计|实现/.test(referenceChapter?.title || '')) continue;
      if (referenceChapter?.title && pattern.test(referenceChapter.title) && !hasChapterRole(chapter,role)) issues.push(`第${chapter.id}章未落实参考章名“${referenceChapter.title}”所要求的${role}内容职责`);
    }
    if (reference.mode === 'detailed' && referenceChapter?.title && !/[*＊?？]/.test(referenceChapter.title) && chapter.title.replace(/\s/g,'') !== referenceChapter.title.replace(/\s/g,'')) issues.push(`第${chapter.id}章应沿用清楚参考目录的章名“${referenceChapter.title}”`);
    if ((referenceChapter?.hasSummary || reference.allChaptersHaveSummary) && !/本章(?:小结|总结)|章节小结/.test(sections.join('\n'))) issues.push(`第${chapter.id}章遗漏参考要求的本章小结`);
    if (reference.mode === 'detailed' && !referenceChapter?.hasSummary && !reference.allChaptersHaveSummary && /本章(?:小结|总结)|章节小结/.test(sections.join('\n'))) issues.push(`第${chapter.id}章参考结构未安排小结，不应机械追加`);
  }
  if (!outline.some(chapter => (chapter.sections || []).some(section => SELECTION_HEADING.test(section)))) issues.push('目录未安排关键器件的简要选型');
  const explicitSelection = referenceHasSelection(reference);
  if (!explicitSelection && !(outline.find(chapter => String(chapter.id) === '2')?.sections || []).some(section => SELECTION_HEADING.test(section))) issues.push('参考未安排选型时，应在第二章合适位置简要补充');
  const selectionChapters = referenceSelectionChapterIds(reference);
  for (const id of new Set(selectionChapters)) if (!(outline.find(chapter=>chapter.id===id)?.sections || []).some(section=>SELECTION_HEADING.test(section))) issues.push(`参考将模块选型安排在第${id}章，应在该章保留，不能默认移至第二章`);
  if (selectionChapters.length && outline.some(chapter=>!selectionChapters.includes(chapter.id) && (chapter.sections || []).some(section=>SELECTION_HEADING.test(section)))) issues.push('参考已明确选型所在章节，其他章节不再重复新增选型');
  if (pcbDesignPolicy(facts, materials).enabled && !outline.some(chapter=>(chapter.sections || []).some(section=>PCB_HEADING.test(section)))) issues.push('默认使用PCB，目录需要在硬件对应位置安排PCB电路板设计内容');
  if (!pcbDesignPolicy(facts, materials).enabled && outline.some(chapter=>(chapter.sections || []).some(section=>PCB_HEADING.test(section)))) issues.push('用户明确不使用PCB，应将参考PCB要求标记不适用并改为实际装配内容，不能仍写PCB设计');
  return [...new Set(issues)];
}

export function chapterReferenceContract(chapter, referenceText = '', usage = []) {
  const reference = parseReferenceOutline(referenceText);
  return { mode: reference.mode, chapter: reference.chapters.find(item=>item.id===chapter.id) || null,
    requirements: reference.units.filter(unit=>unit.chapterId===chapter.id).map(unit=>({ ...unit, adoption:usage.find(item=>item.referenceId===unit.id) || null })),
    instruction: '遵从这些标题和内容方向；项目事实允许的要求必须落实，不得改回默认章节。方向只规定写什么，例文中的行业、旧课题术语、器件、统计数据不能移植，始终围绕当前项目。仅对已说明的事实冲突做必要调整。' };
}

export function organizationCoverageIssues(content = '', outline = []) {
  const prose = String(content).replace(/^\s*\d+(?:\.\d+){1,2}\s+[^\n]+$/gm, '');
  return outline.filter(chapter=>!prose.includes(chapter.title) || !new RegExp(`第\\s*(?:${chapter.id}|${['','一','二','三','四','五','六','七','八','九','十','十一','十二'][Number(chapter.id)]})\\s*章`).test(prose))
    .map(chapter=>`论文结构安排遗漏第${chapter.id}章“${chapter.title}”，必须按实际目录介绍全部${outline.length}个一级章节`);
}

// Generate the chapter inventory from the same outline used for writing/export.
// Only organization prose is replaced; research/background/citations stay intact.
export function synchronizePaperOrganization(content = '', chapter = {}, outline = []) {
  if (!hasChapterRole(chapter, 'introduction') || !outline.length) return content;
  const sections = chapter.sections || [];
  const organizationCandidates=sections.filter(section=>/论文.*(?:结构|安排|组织)|结构安排|组织结构|章节安排/.test(section));
  const organization = organizationCandidates.find(section=>!/研究内容|主要工作|主要内容/.test(section)) || organizationCandidates[0];
  const paragraph = `全文共分为${outline.length}章，各章安排如下。\n\n` + outline.map(item=>{
    const topics=(item.sections || []).filter(section=>/^\d+\.\d+\s/.test(section) && !/本章(?:小结|总结)|章节小结/.test(section)).map(section=>section.replace(/^\d+\.\d+\s+/, '')).slice(0,3);
    return `第${item.id}章为“${item.title}”，主要围绕${topics.join('、') || item.title}展开论述。`;
  }).join('\n\n');
  const lines=String(content).split('\n');
  const number=organization?.match(/^\d+(?:\.\d+){1,2}/)?.[0];
  const index=number ? lines.findIndex(line=>line.trim().replace(/^#{1,6}\s*/, '').startsWith(number+' ')) : -1;
  if (index>=0) {
    let end=index+1;
    const depth=number.split('.').length;
    while (end<lines.length) {
      const heading=lines[end].match(/^\s*(\d+(?:\.\d+){1,2})\s+/);
      if(heading && heading[1].split('.').length<=depth) break;
      end++;
    }
    const combined=/研究内容|主要工作|主要内容/.test(organization);
    // Preserve an unusual child hierarchy while removing its stale inventory.
    if(lines.slice(index+1,end).some(line=>/^\s*\d+(?:\.\d+){1,2}\s+/.test(line))) {
      const retained=lines.slice(index+1,end).join('\n').split(/\n{2,}/).filter(block=>!/(?:全文|本论文).{0,15}(?:章|结构)|第\s*[一二三四五六七八九十\d]+\s*章/.test(block)).join('\n\n').trim();
      return [...lines.slice(0,index+1),'',retained,paragraph,'',...lines.slice(end)].join('\n').replace(/\n{3,}/g,'\n\n').trim();
    }
    const preserved=combined ? lines.slice(index+1,end).join('\n').split(/\n{2,}/).filter(block=>!/(?:全文|本论文).{0,15}(?:章|结构)|第\s*[一二三四五六七八九十\d]+\s*章/.test(block)).join('\n\n').trim() : '';
    return [...lines.slice(0,index+1), '', preserved, paragraph, '', ...lines.slice(end)].filter((line,i,a)=>line!=='' || a[i-1]!=='').join('\n').trim();
  }
  // Detailed references may place organization in prose without a dedicated heading.
  const blocks=String(content).split(/\n{2,}/);
  const isInventory=block=>!/^(?:\s*#{1,6}\s*)?\d+(?:\.\d+){1,2}\s+/.test(block) && /(?:全文|本论文).{0,15}(?:分为|分成|共|包括).{0,8}章|第\s*[一二三四五六七八九十\d]+\s*章/.test(block);
  const old=blocks.findIndex(isInventory);
  if (old>=0) return [...blocks.slice(0,old),paragraph,...blocks.slice(old).filter(block=>!isInventory(block))].join('\n\n');
  if (!organizationCoverageIssues(content,outline).length) return content;
  return insertChapterSupplement(content,paragraph,chapter);
}

// Attach figures/tables to the actual outline, rather than assuming 2.4, 4.3 or 5.4.
export function findOutlineSection(chapter, patterns = [], { preferTertiary = false } = {}) {
  const sections = chapter?.sections || [];
  const match = section => patterns.some(pattern => pattern.test(section.replace(/^\d+(?:\.\d+){1,2}\s+/, '')));
  const matches = sections.filter(match);
  const preferred = matches.find(section => preferTertiary ? /^\d+\.\d+\.\d+\s/.test(section) : /^\d+\.\d+\s/.test(section));
  return (preferred || matches[0] || sections[0] || '').match(/^\d+(?:\.\d+){1,2}/)?.[0] || '';
}
