export const FIGURE_ARTIFACT_TYPES = new Set([
  'device-image', 'result-image', 'circuit', 'system-framework', 'software-architecture', 'flowchart', 'timing',
]);

export const TABLE_ARTIFACT_TYPES = new Set(['comparison-table', 'pin-table', 'test-table']);

function escapeRegExp(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeNumber(value = '') {
  const match = String(value).replace(/[－—.]/g, '-').match(/(\d+)\s*-\s*(\d+)/);
  return match ? `${Number(match[1])}-${Number(match[2])}` : '';
}

function artifactKind(artifact = {}) {
  if (FIGURE_ARTIFACT_TYPES.has(artifact.type)) return 'figure';
  if (TABLE_ARTIFACT_TYPES.has(artifact.type)) return 'table';
  if (artifact.type === 'formula') return 'formula';
  return '';
}

function artifactNumber(artifact = {}, kind = artifactKind(artifact)) {
  if (kind === 'figure') return normalizeNumber(artifact.figureNumber);
  if (kind === 'table') return normalizeNumber(artifact.tableNumber);
  if (kind === 'formula') return normalizeNumber(artifact.formulaNumber);
  return '';
}

function chapterEntries(chapters = {}) {
  return Array.isArray(chapters)
    ? chapters.map((chapter, index) => [String(chapter?.id || index + 1), chapter || {}])
    : Object.entries(chapters || {}).map(([id, chapter]) => [String(chapter?.id || id), chapter || {}]);
}

function nonBodyFigureBlocks(text = '') {
  return [...String(text).matchAll(/【非正文·(?:插图位置|Mermaid(?:图|流程图)?)[：:]\s*([^】]+)】[\s\S]*?【非正文结束】/g)]
    .map(match => ({ text: match[0], label: String(match[1] || '').trim(), start: match.index, end: match.index + match[0].length }));
}

function captionLines(text = '', prefix = '图') {
  const records = [];
  let offset = 0;
  String(text).split('\n').forEach(line => {
    const clean = line.trim();
    const match = clean.match(new RegExp(`^${prefix}\\s*(\\d+)\\s*[-－—.]\\s*(\\d+)\\s+(.+)$`));
    if (match) records.push({ number: `${Number(match[1])}-${Number(match[2])}`, title: match[3].trim(), text: clean, start: offset, end: offset + line.length });
    offset += line.length + 1;
  });
  return records;
}

function formulaLines(text = '') {
  const records = [];
  let offset = 0;
  String(text).split('\n').forEach(line => {
    const clean = line.trim();
    const match = clean.match(/[（(]\s*(\d+)\s*[-－—.]\s*(\d+)\s*[）)]\s*$/);
    if (match && /[=＝]/.test(clean)) records.push({ number: `${Number(match[1])}-${Number(match[2])}`, text: clean, start: offset, end: offset + line.length });
    offset += line.length + 1;
  });
  return records;
}

function markdownTableBlocks(text = '') {
  const records = [];
  let offset = 0;
  const lines = String(text).split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!/^\s*\|.*\|\s*$/.test(line) || !/^\s*\|\s*:?-{3,}/.test(lines[index + 1] || '')) {
      offset += line.length + 1;
      continue;
    }
    const start = offset;
    let end = start + line.length;
    while (index + 1 < lines.length && /^\s*\|.*\|\s*$/.test(lines[index + 1])) {
      index += 1;
      offset += line.length + 1;
      end = offset + lines[index].length;
    }
    records.push({ start, end });
    offset += lines[index].length + 1;
  }
  return records;
}

export function stripArtifactBlocksForProse(value = '') {
  const mask = matched => String(matched).replace(/[^\n]/g, ' ');
  return String(value)
    .replace(/【非正文(?:·[^】]*)?】[\s\S]*?【非正文结束】/g, mask)
    .replace(/```mermaid[\s\S]*?```/gi, mask)
    .replace(/^\s*(?:图|表)\s*\d+\s*[-－—.]\s*\d+\s+[^\n]+$/gm, mask)
    .replace(/^\s*\|.*\|\s*$/gm, mask)
    .replace(/^.*[=＝].*[（(]\s*\d+\s*[-－—.]\s*\d+\s*[）)]\s*$/gm, mask);
}

function referencePattern(kind) {
  if (kind === 'formula') return /如\s*式\s*[（(]\s*(\d+)\s*[-－—.]\s*(\d+)\s*[）)]\s*所示/g;
  return new RegExp(`如\\s*${kind === 'figure' ? '图' : '表'}\\s*(\\d+)\\s*[-－—.]\\s*(\\d+)\\s*所示`, 'g');
}

function kindLabel(kind) {
  return kind === 'figure' ? '图' : kind === 'table' ? '表' : '公式';
}

function expectedReference(kind, number) {
  return kind === 'formula' ? `如式（${number}）所示` : `如${kindLabel(kind)}${number}所示`;
}

function numberPattern(number = '') {
  const [major = '', minor = ''] = normalizeNumber(number).split('-');
  return `${escapeRegExp(major)}\\s*[-－—.]\\s*${escapeRegExp(minor)}`;
}

function rawReferencePattern(kind, number) {
  const numbered = numberPattern(number);
  return kind === 'formula'
    ? new RegExp(`式\\s*[（(]\\s*${numbered}\\s*[）)]`, 'g')
    : new RegExp(`${kindLabel(kind)}\\s*${numbered}`, 'g');
}

function issue(id, chapterId, message) {
  return { id, severity: 'blocking', chapterId: String(chapterId || ''), message, source: 'local' };
}

export function validateArtifactLedger({ artifacts = [], chapters = {} } = {}) {
  const expected = new Map();
  const issues = [];
  const orderedNumbers = new Map();
  const relevant = (artifacts || []).filter(artifact => artifactKind(artifact));

  relevant.forEach((artifact, index) => {
    const kind = artifactKind(artifact);
    const number = artifactNumber(artifact, kind);
    const chapterId = String(artifact.chapterId || '');
    if (!number) {
      issues.push(issue(`artifact-number-missing-${artifact.id || index}`, chapterId, `${artifact.title || '图表公式'}缺少固定编号`));
      return;
    }
    const key = `${kind}:${number}`;
    if (expected.has(key)) issues.push(issue(`artifact-plan-duplicate-${key}`, chapterId, `${kindLabel(kind)}${number}在计划中重复，必须只保留一个`));
    else expected.set(key, { ...artifact, kind, number, chapterId });
    const [major, minor] = number.split('-').map(Number);
    if (String(major) !== chapterId) issues.push(issue(`artifact-number-chapter-${key}`, chapterId, `${artifact.title}编号${number}与第${chapterId}章不一致`));
    const orderKey = `${chapterId}:${kind}`;
    const list = orderedNumbers.get(orderKey) || [];
    list.push({ minor, title: artifact.title, number });
    orderedNumbers.set(orderKey, list);
  });

  orderedNumbers.forEach((list, orderKey) => {
    list.forEach((record, index) => {
      if (record.minor !== index + 1) {
        const [chapterId, kind] = orderKey.split(':');
        issues.push(issue(`artifact-sequence-${kind}-${chapterId}-${index + 1}`, chapterId, `${kindLabel(kind)}编号不连续，${record.title}应为${chapterId}-${index + 1}而不是${record.number}`));
      }
    });
  });

  const references = new Map();
  const visualBlocks = new Map();
  const figureCaptions = new Map();
  const tableCaptions = new Map();
  const equations = new Map();
  const markdownTables = new Map();
  chapterEntries(chapters).forEach(([chapterId, chapter]) => {
    const text = String(chapter?.content || '');
    const prose = stripArtifactBlocksForProse(text);
    ['figure', 'table', 'formula'].forEach(kind => {
      for (const match of prose.matchAll(referencePattern(kind))) {
        const number = `${Number(match[1])}-${Number(match[2])}`;
        const key = `${kind}:${number}`;
        const list = references.get(key) || [];
        list.push({ chapterId, index: match.index, text: match[0] });
        references.set(key, list);
      }
    });
    visualBlocks.set(chapterId, nonBodyFigureBlocks(text));
    figureCaptions.set(chapterId, captionLines(text, '图'));
    tableCaptions.set(chapterId, captionLines(text, '表'));
    equations.set(chapterId, formulaLines(text));
    markdownTables.set(chapterId, markdownTableBlocks(text));
  });

  expected.forEach((artifact, key) => {
    const refs = references.get(key) || [];
    const label = `${kindLabel(artifact.kind)}${artifact.number}`;
    if (refs.length !== 1) {
      issues.push(issue(`artifact-reference-count-${key}`, artifact.chapterId, refs.length
        ? `${label}的“${expectedReference(artifact.kind, artifact.number)}”出现${refs.length}次，只能出现一次`
        : `${artifact.title || label}缺少正文中的“${expectedReference(artifact.kind, artifact.number)}”`));
    }
    const wrongChapter = refs.find(record => record.chapterId !== artifact.chapterId);
    if (wrongChapter) issues.push(issue(`artifact-reference-chapter-${key}`, wrongChapter.chapterId, `${label}应在第${artifact.chapterId}章引用，当前出现在第${wrongChapter.chapterId}章`));
    const rawRefs = chapterEntries(chapters).flatMap(([chapterId, chapter]) => {
      const prose = stripArtifactBlocksForProse(String(chapter?.content || ''));
      return [...prose.matchAll(rawReferencePattern(artifact.kind, artifact.number))]
        .map(match => ({ chapterId, index: match.index, text: match[0] }));
    });
    if (rawRefs.length !== 1) {
      issues.push(issue(`artifact-raw-reference-count-${key}`, artifact.chapterId, rawRefs.length
        ? `${label}在正文中共被提及${rawRefs.length}次；每项图、表或公式只能用规范句引用一次，其他位置改用“该图”“该表”或“该式”`
        : `${label}没有在正文中被引用`));
    }

    if (artifact.kind === 'figure') {
      const blocks = (visualBlocks.get(artifact.chapterId) || []).filter(record => record.label.includes(String(artifact.title || '')));
      const captions = (figureCaptions.get(artifact.chapterId) || []).filter(record => record.number === artifact.number && record.title === artifact.title);
      if (blocks.length !== 1) issues.push(issue(`artifact-figure-block-${key}`, artifact.chapterId, `${artifact.title}应有且只有一个非正文图位或Mermaid图块，当前为${blocks.length}个`));
      if (blocks.length === 1 && !new RegExp(`^图\\s*${escapeRegExp(artifact.number)}\\s+${escapeRegExp(artifact.title)}$`).test(blocks[0].label)) {
        issues.push(issue(`artifact-figure-label-${key}`, artifact.chapterId, `${artifact.title}的图位标签必须准确写为“图${artifact.number} ${artifact.title}”`));
      }
      if (captions.length !== 1) issues.push(issue(`artifact-figure-caption-${key}`, artifact.chapterId, `${artifact.title}必须有且只有一个题注“图${artifact.number} ${artifact.title}”`));
      if (blocks.length === 1 && captions.length === 1 && captions[0].start < blocks[0].end) issues.push(issue(`artifact-figure-caption-order-${key}`, artifact.chapterId, `图${artifact.number}题注必须位于图位或Mermaid代码之后`));
      if (refs.length === 1 && blocks.length === 1 && refs[0].chapterId === artifact.chapterId && refs[0].index > blocks[0].start) issues.push(issue(`artifact-figure-reference-order-${key}`, artifact.chapterId, `${expectedReference('figure', artifact.number)}必须在对应图位之前`));
    } else if (artifact.kind === 'table') {
      const captions = (tableCaptions.get(artifact.chapterId) || []).filter(record => record.number === artifact.number && record.title === artifact.title);
      if (captions.length !== 1) issues.push(issue(`artifact-table-caption-${key}`, artifact.chapterId, `${artifact.title}必须有且只有一个表题“表${artifact.number} ${artifact.title}”`));
      if (refs.length === 1 && captions.length === 1 && refs[0].chapterId === artifact.chapterId && refs[0].index > captions[0].start) issues.push(issue(`artifact-table-reference-order-${key}`, artifact.chapterId, `${expectedReference('table', artifact.number)}必须在对应表题之前`));
      if (captions.length === 1) {
        const allCaptions = tableCaptions.get(artifact.chapterId) || [];
        const nextCaption = allCaptions.find(record => record.start > captions[0].start);
        const tables = (markdownTables.get(artifact.chapterId) || []).filter(record => record.start > captions[0].end && record.start < (nextCaption?.start ?? Infinity) && record.start - captions[0].end < 1000);
        if (tables.length !== 1) issues.push(issue(`artifact-table-data-${key}`, artifact.chapterId, `${artifact.title}表题后必须紧跟且只跟一张可用数据表`));
      }
    } else {
      const displays = (equations.get(artifact.chapterId) || []).filter(record => record.number === artifact.number);
      if (displays.length !== 1) issues.push(issue(`artifact-formula-display-${key}`, artifact.chapterId, `${artifact.title}必须有且只有一个带编号“（${artifact.number}）”的独立公式`));
      if (refs.length === 1 && displays.length === 1 && refs[0].chapterId === artifact.chapterId && refs[0].index > displays[0].start) issues.push(issue(`artifact-formula-reference-order-${key}`, artifact.chapterId, `${expectedReference('formula', artifact.number)}必须在对应公式之前`));
    }
  });

  references.forEach((records, key) => {
    if (expected.has(key)) return;
    const [kind, number] = key.split(':');
    records.forEach(record => issues.push(issue(`artifact-reference-unknown-${kind}-${number}-${record.chapterId}`, record.chapterId, `正文引用了未建立计划的${kindLabel(kind)}${kind === 'formula' ? `（${number}）` : number}`)));
  });

  chapterEntries(chapters).forEach(([chapterId, chapter]) => {
    const prose = stripArtifactBlocksForProse(String(chapter?.content || ''));
    const unnumbered = [
      ...[...prose.matchAll(/如\s*图\s*所示/g)].map(match => ({ kind: 'figure', index: match.index })),
      ...[...prose.matchAll(/如\s*表\s*所示/g)].map(match => ({ kind: 'table', index: match.index })),
      ...[...prose.matchAll(/如\s*式\s*所示/g)].map(match => ({ kind: 'formula', index: match.index })),
    ];
    unnumbered.forEach((record, index) => {
      issues.push(issue(`artifact-reference-unnumbered-${chapterId}-${record.kind}-${index}`, chapterId, `第${chapterId}章存在未带编号的“如${kindLabel(record.kind)}所示”，必须改为对应的固定编号引用`));
    });
    const unnumberedFormulaLines = prose.split('\n').map(line => line.trim()).filter(line =>
      line.length > 3 && line.length < 220 && /[A-Za-z][A-Za-z0-9_{}]*\s*[=＝]/.test(line) && /[+\-*/×÷%]/.test(line)
      && !/[（(]\s*\d+\s*[-－—.]\s*\d+\s*[）)]\s*$/.test(line));
    unnumberedFormulaLines.forEach((line, index) => {
      issues.push(issue(`artifact-formula-unnumbered-${chapterId}-${index}`, chapterId, `第${chapterId}章存在未编号公式“${line.slice(0, 48)}”，公式必须纳入第四章计划并使用固定编号`));
    });
    if (chapterId !== '4' && (equations.get(chapterId) || []).length) {
      issues.push(issue(`artifact-formula-wrong-chapter-${chapterId}`, chapterId, `第${chapterId}章出现编号公式，公式只能放在第四章软件设计`));
    }

    (visualBlocks.get(chapterId) || []).forEach((record, index) => {
      const match = record.label.match(/^图\s*(\d+)\s*[-－—.]\s*(\d+)\s+(.+)$/);
      if (!match) return;
      const number = `${Number(match[1])}-${Number(match[2])}`;
      const planned = expected.get(`figure:${number}`);
      if (!planned || planned.chapterId !== chapterId) issues.push(issue(`artifact-unplanned-figure-block-${chapterId}-${index}`, chapterId, `正文出现未纳入终稿计划的图${number}“${match[3].trim()}”`));
    });
    (tableCaptions.get(chapterId) || []).forEach((record, index) => {
      const planned = expected.get(`table:${record.number}`);
      if (!planned || planned.chapterId !== chapterId) issues.push(issue(`artifact-unplanned-table-${chapterId}-${index}`, chapterId, `正文出现未纳入终稿计划的表${record.number}“${record.title}”`));
    });
    (equations.get(chapterId) || []).forEach((record, index) => {
      const planned = expected.get(`formula:${record.number}`);
      if (!planned || planned.chapterId !== chapterId) issues.push(issue(`artifact-unplanned-formula-${chapterId}-${index}`, chapterId, `正文出现未纳入终稿计划的公式（${record.number}）`));
    });
    (markdownTables.get(chapterId) || []).forEach((record, index) => {
      const caption = (tableCaptions.get(chapterId) || []).filter(item => item.end < record.start && record.start - item.end < 1000).at(-1);
      const firstTableAfterCaption = caption
        ? (markdownTables.get(chapterId) || []).find(item => item.start > caption.end && item.start - caption.end < 1000)
        : null;
      if (!caption || firstTableAfterCaption?.start !== record.start) issues.push(issue(`artifact-table-without-caption-${chapterId}-${index}`, chapterId, `第${chapterId}章存在没有规范表题的Markdown数据表`));
    });
  });

  const seen = new Set();
  return issues.filter(record => {
    const key = `${record.id}|${record.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeReferenceVariants(text, kind, number) {
  const escaped = numberPattern(number);
  const label = kindLabel(kind);
  const exact = expectedReference(kind, number);
  const variant = kind === 'formula'
    ? new RegExp(`(?:见|由|结合|根据)?\\s*式\\s*[（(]\\s*${escaped}\\s*[）)]\\s*(?:中\\s*)?所示`, 'g')
    : new RegExp(`(?:如|见|由|结合|根据)?\\s*${label}\\s*${escaped}\\s*(?:中\\s*)?所示`, 'g');
  let seen = false;
  return String(text).replace(variant, () => {
    if (!seen) {
      seen = true;
      return exact;
    }
    return kind === 'figure' ? '该图' : kind === 'table' ? '该表' : '该式';
  });
}

export function synchronizeArtifactPresentation(content = '', artifacts = []) {
  let text = String(content || '').replace(/\r\n?/g, '\n');
  (artifacts || []).forEach(artifact => {
    const kind = artifactKind(artifact);
    const number = artifactNumber(artifact, kind);
    const title = String(artifact.title || '').trim();
    if (!kind || !number || !title) return;
    text = normalizeReferenceVariants(text, kind, number);
    if (kind === 'figure') {
      const titlePattern = escapeRegExp(title);
      const headerPattern = new RegExp(`【非正文·(插图位置|Mermaid(?:图|流程图)?)[：:]\\s*[^】]*${titlePattern}[^】]*】`);
      const header = text.match(headerPattern)?.[0];
      if (!header) return;
      const headerType = header.match(/^【非正文·([^：:]+)[：:]/)?.[1] || '插图位置';
      const normalizedHeader = `【非正文·${headerType}：图${number} ${title}】`;
      text = text.replace(header, normalizedHeader);
      const blockPattern = new RegExp(`${escapeRegExp(normalizedHeader)}[\\s\\S]*?【非正文结束】`);
      const block = text.match(blockPattern)?.[0];
      if (!block) return;
      const caption = `图${number} ${title}`;
      const afterIndex = text.indexOf(block) + block.length;
      const before = text.slice(0, afterIndex);
      let after = text.slice(afterIndex);
      const leadingCaption = after.match(/^\s*图\s*\d+\s*[-－—.]\s*\d+\s+[^\n]+/);
      if (leadingCaption) after = after.replace(leadingCaption[0], `\n\n${caption}`);
      else after = `\n\n${caption}${after}`;
      text = before + after;
    } else if (kind === 'table') {
      const linePattern = new RegExp(`^\\s*表\\s*\\d+\\s*[-－—.]\\s*\\d+\\s+${escapeRegExp(title)}\\s*$`, 'm');
      if (linePattern.test(text)) text = text.replace(linePattern, `表${number} ${title}`);
    }
  });
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

export function mergeFinalQualityIssues(localIssues = [], aiIssues = []) {
  const seen = new Set();
  return [...(localIssues || []), ...(aiIssues || [])]
    .filter(record => record && !record.autoRepaired && !record.pendingFinalVerification && record.message)
    .filter(record => !isResolvedQualityConclusion(record.message))
    .filter(record => {
      const key = `${record.chapterId || ''}|${record.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

// DeepSeek偶尔会把“核对正确”的说明也放进issues数组。这里仅排除带有明确
// 正向结论且同时明确表示无问题/无需修改的记录，避免把真正的问题误删。
export function isResolvedQualityConclusion(message = '') {
  const text = String(message).replace(/\s+/g, '').replace(/[，,；;。.!！]+$/g, '');
  if (!text) return false;
  return [
    /(?:与|同).{0,30}(?:事实|方案|确认信息|实际|前文)?.{0,12}(?:一致|相符|吻合).{0,16}(?:无|未发现|不存在)(?:明显)?(?:矛盾|冲突|问题)/,
    /(?:描述|内容|接线|引脚|型号|接口|逻辑).{0,20}(?:正确|一致|相符|吻合).{0,16}(?:无需|不需要)(?:修复|修改|调整)/,
    /(?:无|未发现|不存在)(?:明显)?(?:矛盾|冲突|问题).{0,16}(?:无需|不需要)(?:修复|修改|调整)/,
    /^(?:经核对|核对结果[:：]?)?(?:描述|内容|接线|引脚|型号|接口|逻辑)?(?:正确|一致|相符|吻合)(?:且|，|,)?(?:无需|不需要)(?:修复|修改|调整)$/,
  ].some(pattern => pattern.test(text));
}
