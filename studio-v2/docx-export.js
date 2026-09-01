'use strict';

const {
  AlignmentType,
  Bookmark,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  LevelFormat,
  LineRuleType,
  NumberFormat,
  NumberedItemReference,
  SimpleField,
  PageBreak,
  PageNumber,
  PageOrientation,
  Packer,
  Paragraph,
  SectionType,
  Table,
  TableCell,
  TableLayoutType,
  TableOfContents,
  TableRow,
  TextRun,
  VerticalAlign,
  VerticalAlignSection,
  WidthType,
  convertMillimetersToTwip,
} = globalThis.docx || {};

if (!Document || !Packer || !Bookmark || !NumberedItemReference || !SimpleField) {
  throw new Error('DOCX 浏览器组件加载失败');
}

const PAGE_WIDTH = convertMillimetersToTwip(210);
const PAGE_HEIGHT = convertMillimetersToTwip(297);
const MARGIN_TOP = convertMillimetersToTwip(25);
const MARGIN_BOTTOM = convertMillimetersToTwip(25);
const MARGIN_LEFT = convertMillimetersToTwip(30);
const MARGIN_RIGHT = convertMillimetersToTwip(25);
const HEADER_DISTANCE = convertMillimetersToTwip(15);
const FOOTER_DISTANCE = convertMillimetersToTwip(17.5);
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;
const BODY_LINE = 360;
const BODY_FIRST_LINE = 480;
const TABLE_CELL_MARGIN = 100;
const CN_BODY_FONT = '宋体';
const CN_HEADING_FONT = '黑体';
const LATIN_FONT = 'Times New Roman';

const FONT_BODY = { ascii: LATIN_FONT, hAnsi: LATIN_FONT, eastAsia: CN_BODY_FONT, cs: LATIN_FONT };
const FONT_HEADING = { ascii: LATIN_FONT, hAnsi: LATIN_FONT, eastAsia: CN_HEADING_FONT, cs: LATIN_FONT };
const FONT_LATIN = { ascii: LATIN_FONT, hAnsi: LATIN_FONT, eastAsia: LATIN_FONT, cs: LATIN_FONT };
const FONT_MONO = { ascii: 'Consolas', hAnsi: 'Consolas', eastAsia: '等线', cs: 'Consolas' };
let ACTIVE_REFERENCE_BOOKMARKS = null;

// WPS生成的本科论文模板使用下面这组内置样式身份。仅把样式显示名称写成
// “正文/标题 1”仍可能被WPS当成另一套样式，因此导出时统一改为真实内置ID。
const WPS_BUILTIN_PARAGRAPH_STYLES = [
  { from: 'Normal', to: '1', name: 'Normal' },
  { from: 'Heading1', to: '2', name: 'heading 1' },
  { from: 'Heading2', to: '3', name: 'heading 2' },
  { from: 'Heading3', to: '4', name: 'heading 3' },
  { from: 'Caption', to: '5', name: 'caption' },
];

function cleanText(value, maxLength = 200000) {
  return String(value || '')
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .slice(0, maxLength)
    .trim();
}

function normalizedFigureKey(major, minor) {
  return `${Number(major)}-${Number(minor)}`;
}

function normalizeRepeatedFigureIntroductions(value) {
  const source = String(value || '').replace(/\r\n?/g, '\n');
  const seenPlaceholders = new Set();
  const outputLines = [];
  let removeFollowingInstruction = false;
  let skippingInstruction = false;
  const placeholderPattern = /【\s*图\s*(\d+)\s*[-－—]\s*(\d+)[^】]*(?:待插入|待添加|预留)[^】]*】/g;

  for (const line of source.split('\n')) {
    const trimmed = line.trim();
    if (skippingInstruction) {
      if (trimmed.includes('【非正文结束】')) skippingInstruction = false;
      continue;
    }
    if (removeFollowingInstruction) {
      if (!trimmed) continue;
      if (trimmed.startsWith('【非正文·')) {
        if (!trimmed.includes('【非正文结束】')) skippingInstruction = true;
        removeFollowingInstruction = false;
        continue;
      }
      removeFollowingInstruction = false;
    }

    let removedDuplicate = false;
    const nextLine = line.replace(placeholderPattern, (full, major, minor) => {
      const key = normalizedFigureKey(major, minor);
      if (seenPlaceholders.has(key)) {
        removedDuplicate = true;
        return '';
      }
      seenPlaceholders.add(key);
      return full;
    }).replace(/[ \t]{2,}/g, ' ').trimEnd();
    if (removedDuplicate && !nextLine.trim()) {
      removeFollowingInstruction = true;
      continue;
    }
    outputLines.push(nextLine);
  }

  const seenIntroductions = new Set();
  const introPattern = /(?:如(?:下)?图|图)\s*(\d+)\s*[-－—]\s*(\d+)\s*(?:中)?所示([ \t]*[，,:：。！？；;]?)/g;
  return outputLines.join('\n').replace(introPattern, (full, major, minor, trailing, offset, whole) => {
    const key = normalizedFigureKey(major, minor);
    if (!seenIntroductions.has(key)) {
      seenIntroductions.add(key);
      return full;
    }
    const previous = whole.slice(0, offset).match(/\S(?=\s*$)/)?.[0] || '';
    if (!previous || /[。！？；;\n]/.test(previous)) return '';
    return `前述图示${trailing || ''}`;
  }).replace(/\n{3,}/g, '\n\n').trim();
}

function normalizePayload(input = {}) {
  const chapters = (Array.isArray(input.chapters) ? input.chapters : [])
    .map((chapter, index) => ({
      id: cleanText(chapter?.id || index + 1, 20),
      title: cleanText(chapter?.title || `第${index + 1}章`, 200),
      content: normalizeRepeatedFigureIntroductions(cleanText(chapter?.content, 300000)),
    }))
    .filter(chapter => chapter.content);
  const references = (Array.isArray(input.references) ? input.references : [])
    .map(reference => ({
      authors: Array.isArray(reference?.authors)
        ? reference.authors.map(author => cleanText(author, 100)).filter(Boolean).join('，')
        : cleanText(reference?.authors, 300),
      title: cleanText(reference?.title, 500),
      documentType: cleanText(reference?.documentType || reference?.type, 20).toUpperCase(),
      source: cleanText(reference?.source || reference?.containerTitle || reference?.publication?.containerTitle, 500),
      year: cleanText(reference?.year || reference?.publication?.year, 20),
      volume: cleanText(reference?.volume || reference?.publication?.volume, 50),
      issue: cleanText(reference?.issue || reference?.publication?.issue, 50),
      pages: cleanText(reference?.pages || reference?.publication?.pages, 100),
      institution: cleanText(reference?.institution || reference?.publication?.institution, 500),
      publisher: cleanText(reference?.publisher || reference?.publication?.publisher, 500),
      place: cleanText(reference?.place || reference?.publication?.place, 200),
      formatted: cleanText(reference?.formatted || reference?.formattedCitation || reference?.raw, 2000).replace(/^\s*\[\d+\]\s*/, ''),
    }))
    .filter(reference => reference.authors || reference.title || reference.formatted);
  return {
    title: cleanText(input.title || '单片机本科毕业论文', 300),
    titleEn: cleanText(input.titleEn, 500),
    abstractCn: cleanText(input.abstractCn, 10000),
    abstractEn: cleanText(input.abstractEn, 15000),
    keywords: cleanText(input.keywords, 1000),
    keywordsEn: cleanText(input.keywordsEn, 1500),
    acknowledgment: cleanText(input.acknowledgment, 10000),
    chapters,
    references,
  };
}

function pageSetup({ pageNumbers } = {}) {
  return {
    size: { width: PAGE_WIDTH, height: PAGE_HEIGHT, orientation: PageOrientation.PORTRAIT },
    margin: {
      top: MARGIN_TOP,
      bottom: MARGIN_BOTTOM,
      left: MARGIN_LEFT,
      right: MARGIN_RIGHT,
      header: HEADER_DISTANCE,
      footer: FOOTER_DISTANCE,
      gutter: 0,
    },
    ...(pageNumbers ? { pageNumbers } : {}),
  };
}

function pageNumberFooter() {
  return new Footer({
    children: [new Paragraph({
      style: 'ThesisPageNumber',
      children: [new TextRun({ children: [PageNumber.CURRENT] })],
    })],
  });
}

function bodyRun(text, options = {}) {
  const run = { text };
  if (options.font) run.font = options.font;
  if (options.size) run.size = options.size;
  if (options.bold) run.bold = true;
  if (options.italics) run.italics = true;
  if (options.superScript) run.superScript = true;
  if (options.color) run.color = options.color;
  if (options.break) run.break = options.break;
  return new TextRun(run);
}

function referenceField(number) {
  const bookmarkId = ACTIVE_REFERENCE_BOOKMARKS?.get(Number(number));
  if (!bookmarkId) return null;
  const field = new NumberedItemReference(bookmarkId, String(number), { hyperlink: true, referenceFormat: 'none' });
  // 只保留上标语义，字号继承正文样式，修改WPS“正文”后可同步变化。
  if (Array.isArray(field.root) && field.root[1]) field.root[1] = bodyRun(String(number), { superScript: true });
  return field;
}

function inlineRuns(text, options = {}) {
  const source = cleanText(text, 100000);
  if (!source) return [bodyRun('')];
  const parts = source.split(/(\*\*[^*]+\*\*|\[\d+\])/g).filter(Boolean);
  return parts.flatMap(part => {
    const bold = /^\*\*[^*]+\*\*$/.test(part);
    const citation = /^\[\d+\]$/.test(part);
    if (citation) {
      const number = part.match(/^\[(\d+)\]$/)?.[1];
      const field = referenceField(number);
      if (field) return [bodyRun('[', { superScript: true }), field, bodyRun(']', { superScript: true })];
    }
    return bodyRun(bold ? part.slice(2, -2) : part, { ...options, bold: options.bold || bold, superScript: options.superScript || citation });
  });
}

function headingParagraph(text, level, { pageBreakBefore = false } = {}) {
  return new Paragraph({
    style: level === 1 ? 'Heading1' : level === 2 ? 'Heading2' : 'Heading3',
    pageBreakBefore,
    children: inlineRuns(text),
  });
}

function bodyParagraph(text, options = {}) {
  const style = options.style || 'Normal';
  const paragraph = {
    style,
    children: inlineRuns(text, { bold: options.bold, italics: options.italics }),
  };
  // 正文的字号、缩进、行距和对齐完全由段落样式控制，避免直接格式压过WPS样式修改。
  if (options.alignment) paragraph.alignment = options.alignment;
  return new Paragraph(paragraph);
}

function annotationParagraph(text) {
  const clean = cleanText(text, 1000)
    .replace(/^【非正文·插图位置[：:]\s*/, '插图位置：')
    .replace(/^【非正文·(?:Mermaid图|Mermaid流程图)[：:]\s*/, 'Mermaid绘图代码：')
    .replace(/^【非正文·?/, '')
    .replace(/】$/, '')
    .trim();
  return new Paragraph({
    style: 'ThesisFigurePlaceholder',
    children: [bodyRun(`${clean}（非正文）`)],
  });
}

function mermaidCodeParagraph(lines) {
  return new Paragraph({
    style: 'ThesisMermaidCode',
    children: lines.map((line, index) => bodyRun(line || ' ', { break: index ? 1 : 0 })),
  });
}

function captionParagraph(text) {
  return new Paragraph({
    style: 'Caption',
    children: [bodyRun(text)],
  });
}

function formulaParagraph(text) {
  return new Paragraph({
    style: 'ThesisFormula',
    children: inlineRuns(text),
  });
}

function abstractParagraphs(text, options = {}) {
  const source = cleanText(text, 20000);
  if (!source) return [];
  const paragraphs = source.split(/\n\s*\n/).map(item => item.trim()).filter(Boolean);
  const normalized = paragraphs.length > 1 ? paragraphs : source.split(/\n/).map(item => item.trim()).filter(Boolean);
  return normalized.map(item => bodyParagraph(item, options));
}

function listParagraph(text, ordered) {
  return new Paragraph({
    style: 'ThesisList',
    numbering: { reference: ordered ? 'thesis-decimal' : 'thesis-bullet', level: 0 },
    children: inlineRuns(text),
  });
}

function parseTableRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
}

function isTableSeparator(line) {
  const cells = parseTableRow(line);
  return cells.length > 1 && cells.every(cell => /^:?-{3,}:?$/.test(cell.replace(/\s/g, '')));
}

function tableFromLines(lines) {
  const rows = lines.map(parseTableRow).filter(row => row.length > 1);
  if (rows.length > 1 && rows[1].every(cell => /^:?-{3,}:?$/.test(cell.replace(/\s/g, '')))) rows.splice(1, 1);
  const columnCount = Math.max(...rows.map(row => row.length));
  const baseWidth = Math.floor(CONTENT_WIDTH / columnCount);
  const widths = Array.from({ length: columnCount }, (_, index) => index === columnCount - 1
    ? CONTENT_WIDTH - baseWidth * (columnCount - 1)
    : baseWidth);
  const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const line = { style: BorderStyle.SINGLE, size: 8, color: '000000' };
  const strong = { style: BorderStyle.SINGLE, size: 12, color: '000000' };
  const tableRows = rows.map((row, rowIndex) => new TableRow({
    tableHeader: rowIndex === 0,
    cantSplit: true,
    children: widths.map((width, cellIndex) => new TableCell({
      width: { size: width, type: WidthType.DXA },
      margins: { top: TABLE_CELL_MARGIN, bottom: TABLE_CELL_MARGIN, left: TABLE_CELL_MARGIN, right: TABLE_CELL_MARGIN },
      verticalAlign: VerticalAlign.CENTER,
      borders: {
        top: rowIndex === 0 ? strong : none,
        bottom: rowIndex === 0 ? line : rowIndex === rows.length - 1 ? strong : none,
        left: none,
        right: none,
      },
      children: [new Paragraph({
        style: rowIndex === 0 ? 'ThesisTableHeader' : 'ThesisTableText',
        children: inlineRuns(row[cellIndex] || ''),
      })],
    })),
  }));
  return new Table({
    rows: tableRows,
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: widths,
    layout: TableLayoutType.FIXED,
    borders: { top: strong, bottom: strong, left: none, right: none, insideHorizontal: none, insideVertical: none },
    margins: { top: TABLE_CELL_MARGIN, bottom: TABLE_CELL_MARGIN, left: TABLE_CELL_MARGIN, right: TABLE_CELL_MARGIN },
  });
}

function numberedHeadingLevel(text, allowCompact = false) {
  const value = cleanText(text, 1000).trim();
  // 一级章标题由 buildPaperDocx() 根据章节记录统一生成。
  // “第1章为绪论……”这类论文组织结构说明是正文，不能进入目录。
  if (/^第\s*[一二三四五六七八九十百\d]+\s*章/.test(value)) return 0;
  if (/^\d+[.．]\d+\s*[Vv](?=\s|[\u3400-\u9fff]|$)/.test(value)) return 0;
  const thirdLevel = allowCompact
    ? /^\d+[.．]\d+[.．]\d+(?=\s|[、：:）)]|[\u3400-\u9fff])/
    : /^\d+[.．]\d+[.．]\d+(?=\s|[、：:）)])/;
  const secondLevel = allowCompact
    ? /^\d+[.．]\d+(?=\s|[、：:）)]|[\u3400-\u9fff])/
    : /^\d+[.．]\d+(?=\s|[、：:）)])/;
  if (thirdLevel.test(value)) return 3;
  if (secondLevel.test(value)) return 2;
  return 0;
}

function headingLevelFromLine(line) {
  const value = cleanText(line, 1000).trim();
  const hash = value.match(/^(#{1,6})\s*(\S.*)$/);
  const text = (hash ? hash[2] : value).trim();
  const semanticText = text.replace(/^\*\*(.+)\*\*$/, '$1').trim();
  if (/^第\s*[一二三四五六七八九十百\d]+\s*章/.test(semanticText)) return { level: 0, text };
  const numberedLevel = numberedHeadingLevel(text, Boolean(hash));
  if (numberedLevel) return { level: numberedLevel, text };
  // 正式论文标题必须有 N.N 或 N.N.N 编号。仅有 Markdown 井号的文字
  // 只作正文处理并去掉井号，避免普通加粗提示意外进入 Word 目录。
  return hash ? { level: 0, text } : null;
}

function compactParagraphLength(value) {
  return String(value || '').replace(/\s+/g, '').length;
}

function sentenceSegments(value) {
  return String(value || '').match(/[^。！？!?；;]+[。！？!?；;]?/g) || [String(value || '')];
}

function splitLongBodyParagraph(value, maximum = 420) {
  const text = cleanText(value, 100000);
  if (!text || compactParagraphLength(text) <= maximum) return text ? [text] : [];
  const output = [];
  let current = '';
  sentenceSegments(text).forEach(sentence => {
    const next = `${current}${sentence}`;
    if (current && compactParagraphLength(next) > maximum) {
      output.push(current.trim());
      current = sentence;
    } else {
      current = next;
    }
  });
  if (current.trim()) output.push(current.trim());
  return output.length > 1 ? output : [text];
}

function contentBlocks(content) {
  const lines = cleanText(content, 300000).split('\n');
  const blocks = [];
  let paragraphLines = [];
  const flushParagraph = () => {
    const text = paragraphLines.join('').trim();
    splitLongBodyParagraph(text).forEach(paragraph => blocks.push(bodyParagraph(paragraph)));
    paragraphLines = [];
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) {
      flushParagraph();
      continue;
    }
    if (/^```mermaid\s*$/i.test(line)) {
      flushParagraph();
      const mermaidLines = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index].trim())) {
        mermaidLines.push(lines[index].trimEnd());
        index += 1;
      }
      if (mermaidLines.length) blocks.push(mermaidCodeParagraph(mermaidLines));
      continue;
    }
    if (line.includes('|') && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
      flushParagraph();
      const tableLines = [line, lines[index + 1]];
      index += 2;
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        tableLines.push(lines[index]);
        index += 1;
      }
      index -= 1;
      blocks.push(tableFromLines(tableLines));
      continue;
    }
    const heading = headingLevelFromLine(line);
    if (heading) {
      flushParagraph();
      blocks.push(heading.level > 0 ? headingParagraph(heading.text, heading.level) : bodyParagraph(heading.text));
      continue;
    }
    const ordered = line.match(/^(?:\d+[)）、]\s*|\d+\.\s+)(.+)$/);
    const bullet = line.match(/^[-*+]\s+(.+)$/);
    if (ordered || bullet) {
      flushParagraph();
      blocks.push(listParagraph((ordered || bullet)[1].trim(), Boolean(ordered)));
      continue;
    }
    if (/^【非正文结束】/.test(line)) {
      flushParagraph();
      continue;
    }
    if (/^【非正文/.test(line)) {
      flushParagraph();
      blocks.push(annotationParagraph(line));
      continue;
    }
    if (/[=＝]/.test(line) && /[（(]\s*\d+\s*[-－—.]\s*\d+\s*[）)]\s*$/.test(line)) {
      flushParagraph();
      blocks.push(formulaParagraph(line));
      continue;
    }
    if (/^(?:图|表)\s*\d+(?:[-.]\d+)?\s|^【(?:图|表)/.test(line)) {
      flushParagraph();
      blocks.push(captionParagraph(line));
      continue;
    }
    paragraphLines.push(line);
  }
  flushParagraph();
  return blocks;
}

function stripLeadingChapterHeading(content, id, title) {
  const lines = cleanText(content, 300000).split('\n');
  while (lines.length && !lines[0].trim()) lines.shift();
  if (!lines.length) return '';
  const first = lines[0].replace(/^#+\s*/, '').replace(/^\*\*(.+)\*\*$/, '$1').trim();
  const idPattern = String(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const titlePattern = String(title || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const explicitHeading = new RegExp(`^第\\s*${idPattern}\\s*章(?:\\s+|[、：:]\\s*)?(?:${titlePattern})?\\s*$`);
  if (first === title || explicitHeading.test(first)) lines.shift();
  return lines.join('\n').trim();
}

function frontHeading(text, { english = false, pageBreakBefore = false } = {}) {
  return new Paragraph({
    style: english ? 'ThesisFrontHeadingEnglish' : 'ThesisFrontHeading',
    pageBreakBefore,
    children: [bodyRun(text)],
  });
}

function keywordParagraph(keywords, { english = false } = {}) {
  return new Paragraph({
    style: english ? 'ThesisKeywordsEnglish' : 'ThesisKeywords',
    children: [
      bodyRun(english ? 'Keywords: ' : '关键词：', { bold: true }),
      bodyRun(keywords),
    ],
  });
}

function englishTitleParagraph(title, { pageBreakBefore = false, cover = false } = {}) {
  return new Paragraph({
    style: cover ? 'ThesisCoverTitleEnglish' : 'ThesisEnglishTitle',
    pageBreakBefore,
    children: [bodyRun(title)],
  });
}

function referenceParagraph(reference, index) {
  let entry = reference.formatted;
  if (!entry) {
    const head = `${reference.authors}${reference.authors ? '. ' : ''}${reference.title}${reference.documentType ? `[${reference.documentType}]` : ''}`;
    let tail = '';
    if (reference.documentType === 'J') {
      tail = `${reference.source}, ${reference.year}, ${reference.volume}${reference.issue ? `(${reference.issue})` : ''}${reference.pages ? `: ${reference.pages}` : ''}`;
    } else if (reference.documentType === 'D') {
      tail = `${reference.place ? `${reference.place}: ` : ''}${reference.institution || reference.source}, ${reference.year}`;
    } else if (reference.documentType === 'M') {
      tail = `${reference.place ? `${reference.place}: ` : ''}${reference.publisher || reference.source}, ${reference.year}`;
    } else {
      tail = [reference.source || reference.institution || reference.publisher, reference.year, reference.volume, reference.issue, reference.pages].filter(Boolean).join(', ');
    }
    entry = `${head}${tail ? `. ${tail}` : ''}.`.replace(/\s+([,.:])/g, '$1').replace(/\.{2,}$/g, '.');
  }
  const number = index + 1;
  const bookmarkId = `Ref${number}`;
  const sequenceField = new SimpleField(' SEQ ThesisReference ', String(number));
  if (Array.isArray(sequenceField.root) && sequenceField.root[1]) sequenceField.root[1] = bodyRun(String(number));
  const referenceNumber = new Bookmark({ id: bookmarkId, children: [sequenceField] });
  return new Paragraph({
    style: 'ThesisReference',
    children: [
      bodyRun('['),
      referenceNumber,
      bodyRun('] '),
      bodyRun(entry),
    ],
  });
}

function documentStyles() {
  return {
    default: {
      document: {
        run: { font: FONT_BODY, size: 24, color: '000000', language: { value: 'zh-CN', eastAsia: 'zh-CN' } },
        paragraph: { alignment: AlignmentType.JUSTIFIED, indent: { firstLine: BODY_FIRST_LINE }, spacing: { before: 0, after: 0, line: BODY_LINE, lineRule: LineRuleType.AUTO }, widowControl: true },
      },
      heading1: {
        name: '标题 1',
        run: { font: FONT_HEADING, size: 32, bold: true, color: '000000' },
        paragraph: { alignment: AlignmentType.CENTER, keepNext: true, outlineLevel: 0, indent: { firstLine: 0 }, spacing: { before: 0, after: 240, line: BODY_LINE, lineRule: LineRuleType.AUTO } },
      },
      heading2: {
        name: '标题 2',
        run: { font: FONT_HEADING, size: 28, bold: true, color: '000000' },
        paragraph: { alignment: AlignmentType.LEFT, keepNext: true, outlineLevel: 1, indent: { firstLine: 0 }, spacing: { before: 240, after: 120, line: BODY_LINE, lineRule: LineRuleType.AUTO } },
      },
      heading3: {
        name: '标题 3',
        run: { font: FONT_HEADING, size: 24, bold: true, color: '000000' },
        paragraph: { alignment: AlignmentType.LEFT, keepNext: true, outlineLevel: 2, indent: { firstLine: 0 }, spacing: { before: 120, after: 60, line: BODY_LINE, lineRule: LineRuleType.AUTO } },
      },
    },
    paragraphStyles: [
      {
        id: 'Normal',
        name: '正文',
        next: 'Normal',
        quickFormat: true,
        uiPriority: 0,
        run: { font: FONT_BODY, size: 24, color: '000000', language: { value: 'zh-CN', eastAsia: 'zh-CN' } },
        paragraph: { alignment: AlignmentType.JUSTIFIED, indent: { firstLine: BODY_FIRST_LINE }, spacing: { before: 0, after: 0, line: BODY_LINE, lineRule: LineRuleType.AUTO }, widowControl: true },
      },
      {
        id: 'ThesisCoverType',
        name: '论文封面类型',
        basedOn: 'Normal',
        next: 'ThesisCoverTitle',
        quickFormat: true,
        run: { font: FONT_HEADING, size: 36, bold: true, color: '000000' },
        paragraph: { alignment: AlignmentType.CENTER, spacing: { before: 0, after: 720 }, indent: { firstLine: 0 } },
      },
      {
        id: 'ThesisCoverTitle',
        name: '论文封面题目',
        basedOn: 'Normal',
        next: 'ThesisCoverTitleEnglish',
        quickFormat: true,
        run: { font: FONT_HEADING, size: 44, bold: true, color: '000000' },
        paragraph: { alignment: AlignmentType.CENTER, spacing: { before: 0, after: 0, line: 480, lineRule: LineRuleType.AUTO }, indent: { firstLine: 0 } },
      },
      {
        id: 'ThesisCoverTitleEnglish',
        name: '论文封面英文题目',
        basedOn: 'ThesisCoverTitle',
        next: 'Normal',
        quickFormat: true,
        run: { font: FONT_LATIN, size: 28, bold: true, color: '000000', language: { value: 'en-US' } },
        paragraph: { alignment: AlignmentType.CENTER, spacing: { before: 360, after: 0, line: 360, lineRule: LineRuleType.AUTO }, indent: { firstLine: 0 } },
      },
      {
        id: 'ThesisFrontHeading',
        name: '论文前置标题',
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        run: { font: FONT_HEADING, size: 32, bold: true, color: '000000' },
        paragraph: { alignment: AlignmentType.CENTER, keepNext: true, spacing: { before: 0, after: 240, line: BODY_LINE, lineRule: LineRuleType.AUTO } },
      },
      {
        id: 'ThesisFrontHeadingEnglish',
        name: '论文英文前置标题',
        basedOn: 'ThesisFrontHeading',
        next: 'Normal',
        quickFormat: true,
        run: { font: FONT_LATIN, size: 32, bold: true, color: '000000', language: { value: 'en-US' } },
      },
      {
        id: 'ThesisEnglishTitle',
        name: '论文英文题目',
        basedOn: 'Normal',
        next: 'ThesisFrontHeadingEnglish',
        quickFormat: true,
        run: { font: FONT_LATIN, size: 32, bold: true, color: '000000', language: { value: 'en-US' } },
        paragraph: { alignment: AlignmentType.CENTER, keepNext: true, indent: { firstLine: 0 }, spacing: { before: 0, after: 240, line: BODY_LINE, lineRule: LineRuleType.AUTO } },
      },
      {
        id: 'ThesisKeywords',
        name: '论文关键词',
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        paragraph: { alignment: AlignmentType.LEFT, indent: { firstLine: 0 }, spacing: { before: 240, after: 0, line: BODY_LINE, lineRule: LineRuleType.AUTO } },
      },
      {
        id: 'ThesisKeywordsEnglish',
        name: '论文英文关键词',
        basedOn: 'ThesisKeywords',
        next: 'Normal',
        quickFormat: true,
        run: { font: FONT_LATIN, size: 24, color: '000000', language: { value: 'en-US' } },
      },
      {
        id: 'Caption',
        name: '题注',
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        run: { font: FONT_BODY, size: 21, color: '000000' },
        paragraph: { alignment: AlignmentType.CENTER, keepNext: true, indent: { firstLine: 0 }, spacing: { before: 120, after: 120, line: 300, lineRule: LineRuleType.AUTO } },
      },
      {
        id: 'ThesisFigurePlaceholder',
        name: '论文插图提示',
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        run: { font: FONT_BODY, size: 21, bold: true, color: '2F6757' },
        paragraph: { alignment: AlignmentType.CENTER, indent: { firstLine: 0 }, spacing: { before: 120, after: 120, line: 300, lineRule: LineRuleType.AUTO }, shading: { fill: 'EAF3EF' }, border: { top: { style: BorderStyle.DASHED, size: 6, color: '8DB4A6' }, bottom: { style: BorderStyle.DASHED, size: 6, color: '8DB4A6' }, left: { style: BorderStyle.DASHED, size: 6, color: '8DB4A6' }, right: { style: BorderStyle.DASHED, size: 6, color: '8DB4A6' } } },
      },
      {
        id: 'ThesisMermaidCode',
        name: 'Mermaid流程图代码',
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        run: { font: FONT_MONO, size: 19, color: '333333' },
        paragraph: { alignment: AlignmentType.LEFT, indent: { left: 240, right: 240, firstLine: 0 }, spacing: { before: 60, after: 60, line: 280, lineRule: LineRuleType.AUTO }, shading: { fill: 'F4F6F8' }, keepLines: true },
      },
      {
        id: 'ThesisTableText',
        name: '论文表格文字',
        basedOn: 'Normal',
        next: 'ThesisTableText',
        quickFormat: true,
        run: { font: FONT_BODY, size: 21, color: '000000' },
        paragraph: { alignment: AlignmentType.LEFT, indent: { firstLine: 0 }, spacing: { before: 0, after: 0, line: 300, lineRule: LineRuleType.AUTO } },
      },
      {
        id: 'ThesisTableHeader',
        name: '论文表头文字',
        basedOn: 'ThesisTableText',
        next: 'ThesisTableText',
        quickFormat: true,
        run: { bold: true },
        paragraph: { alignment: AlignmentType.CENTER, indent: { firstLine: 0 }, spacing: { before: 0, after: 0, line: 300, lineRule: LineRuleType.AUTO } },
      },
      {
        id: 'ThesisFormula',
        name: '论文公式',
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        run: { font: FONT_BODY, size: 24, color: '000000' },
        paragraph: { alignment: AlignmentType.CENTER, indent: { firstLine: 0 }, spacing: { before: 120, after: 120, line: BODY_LINE, lineRule: LineRuleType.AUTO }, keepLines: true },
      },
      {
        id: 'ThesisReference',
        name: '论文参考文献',
        basedOn: 'Normal',
        next: 'ThesisReference',
        quickFormat: true,
        paragraph: { alignment: AlignmentType.JUSTIFIED, indent: { left: BODY_FIRST_LINE, hanging: BODY_FIRST_LINE }, spacing: { before: 0, after: 0, line: BODY_LINE, lineRule: LineRuleType.AUTO } },
      },
      {
        id: 'ThesisList',
        name: '论文列表',
        basedOn: 'Normal',
        next: 'ThesisList',
        quickFormat: true,
        paragraph: { alignment: AlignmentType.JUSTIFIED, indent: { firstLine: 0 }, spacing: { before: 0, after: 0, line: BODY_LINE, lineRule: LineRuleType.AUTO } },
      },
      {
        id: 'ThesisPageNumber',
        name: '论文页码',
        basedOn: 'Normal',
        next: 'Normal',
        run: { font: FONT_LATIN, size: 18, color: '000000' },
        paragraph: { alignment: AlignmentType.CENTER, indent: { firstLine: 0 }, spacing: { before: 0, after: 0 } },
      },
      {
        id: 'ThesisSchemeTitle',
        name: '方案题目',
        basedOn: 'Normal',
        next: 'Heading2',
        quickFormat: true,
        run: { font: FONT_HEADING, size: 40, bold: true, color: '000000' },
        paragraph: { alignment: AlignmentType.CENTER, indent: { firstLine: 0 }, spacing: { before: 0, after: 480 } },
      },
    ],
  };
}

function numberingConfig() {
  const paragraph = { indent: { left: 720, hanging: 360 }, spacing: { before: 0, after: 0, line: BODY_LINE, lineRule: LineRuleType.AUTO } };
  return {
    config: [
      { reference: 'thesis-bullet', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph } }] },
      { reference: 'thesis-decimal', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph } }] },
    ],
  };
}

function replaceStyleReference(xml, from, to) {
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let output = xml.replace(new RegExp(`w:styleId="${escaped}"`, 'g'), `w:styleId="${to}"`);
  ['pStyle', 'basedOn', 'next', 'link'].forEach(tag => {
    output = output.replace(new RegExp(`(<w:${tag}\\b[^>]*w:val=")${escaped}("[^>]*\\/?>)`, 'g'), `$1${to}$2`);
  });
  return output;
}

function canonicalizeWpsStyleDefinitions(stylesXml) {
  let output = stylesXml;
  WPS_BUILTIN_PARAGRAPH_STYLES.forEach(({ from, to, name }) => {
    output = replaceStyleReference(output, from, to);
    const styleBlock = new RegExp(`(<w:style\\b[^>]*w:styleId="${to}"[^>]*>[\\s\\S]*?<w:name w:val=")[^"]*("\\/>)`);
    output = output.replace(styleBlock, `$1${name}$2`);
  });
  return output;
}

async function packWpsCompatibleDocx(doc) {
  if (!Packer.compiler?.compile) throw new Error('DOCX样式转换组件不可用');
  const zip = Packer.compiler.compile(doc);
  const xmlPaths = Object.keys(zip.files).filter(path => path.startsWith('word/') && path.endsWith('.xml'));
  await Promise.all(xmlPaths.map(async path => {
    const file = zip.file(path);
    if (!file) return;
    let xml = await file.async('string');
    if (path === 'word/styles.xml') xml = canonicalizeWpsStyleDefinitions(xml);
    else WPS_BUILTIN_PARAGRAPH_STYLES.forEach(({ from, to }) => { xml = replaceStyleReference(xml, from, to); });
    zip.file(path, xml);
  }));
  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    compression: 'DEFLATE',
  });
}

async function buildPaperDocx(input) {
  const data = normalizePayload(input);
  if (!data.title) throw new Error('论文题目不能为空');
  if (data.chapters.length < 1) throw new Error('论文正文不能为空');
  ACTIVE_REFERENCE_BOOKMARKS = new Map(data.references.map((_, index) => [index + 1, `Ref${index + 1}`]));

  const coverChildren = [
    new Paragraph({
      style: 'ThesisCoverType',
      children: [bodyRun('本科毕业设计（论文）')],
    }),
    new Paragraph({
      style: 'ThesisCoverTitle',
      children: [bodyRun(data.title)],
    }),
    ...(data.titleEn ? [englishTitleParagraph(data.titleEn, { cover: true })] : []),
  ];

  const frontChildren = [
    frontHeading('摘  要'),
    ...(data.abstractCn ? abstractParagraphs(data.abstractCn) : [bodyParagraph('摘要内容待补充。')]),
    ...(data.keywords ? [keywordParagraph(data.keywords)] : []),
    ...(data.titleEn ? [englishTitleParagraph(data.titleEn, { pageBreakBefore: true })] : [frontHeading('Abstract', { english: true, pageBreakBefore: true })]),
    ...(data.titleEn ? [frontHeading('Abstract', { english: true })] : []),
    ...(data.abstractEn ? abstractParagraphs(data.abstractEn, { font: FONT_LATIN }) : [bodyParagraph('Abstract pending.', { font: FONT_LATIN })]),
    ...(data.keywordsEn ? [keywordParagraph(data.keywordsEn, { english: true })] : []),
    frontHeading('目  录', { pageBreakBefore: true }),
    new TableOfContents('论文目录', { hyperlink: true, headingStyleRange: '1-3', useAppliedParagraphOutlineLevel: true }),
  ];

  const bodyChildren = [];
  data.chapters.forEach((chapter, index) => {
    const heading = /^第\s*\d+\s*章/.test(chapter.title) ? chapter.title : `第${chapter.id}章 ${chapter.title}`;
    bodyChildren.push(headingParagraph(heading, 1, { pageBreakBefore: index > 0 }));
    bodyChildren.push(...contentBlocks(stripLeadingChapterHeading(chapter.content, chapter.id, chapter.title)));
  });
  if (data.references.length) {
    bodyChildren.push(headingParagraph('参考文献', 1, { pageBreakBefore: true }));
    data.references.forEach((reference, index) => bodyChildren.push(referenceParagraph(reference, index)));
  }
  if (data.acknowledgment) {
    bodyChildren.push(headingParagraph('致  谢', 1, { pageBreakBefore: true }));
    bodyChildren.push(bodyParagraph(data.acknowledgment));
  }

  const doc = new Document({
    creator: '单片机方案与论文工作台',
    lastModifiedBy: '单片机方案与论文工作台',
    title: data.title,
    subject: '本科毕业设计（论文）',
    description: '按本科论文通用版式生成的可编辑 DOCX 文档',
    styles: documentStyles(),
    numbering: numberingConfig(),
    features: { updateFields: true },
    sections: [
      {
        properties: {
          type: SectionType.NEXT_PAGE,
          verticalAlign: VerticalAlignSection.CENTER,
          page: pageSetup(),
        },
        children: coverChildren,
      },
      {
        properties: {
          type: SectionType.NEXT_PAGE,
          page: pageSetup({ pageNumbers: { start: 1, formatType: NumberFormat.LOWER_ROMAN } }),
        },
        footers: { default: pageNumberFooter() },
        children: frontChildren,
      },
      {
        properties: {
          type: SectionType.NEXT_PAGE,
          page: pageSetup({ pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL } }),
          grid: { linePitch: BODY_LINE, charSpace: 0 },
        },
        footers: { default: pageNumberFooter() },
        children: bodyChildren,
      },
    ],
  });
  try {
    return await packWpsCompatibleDocx(doc);
  } finally {
    ACTIVE_REFERENCE_BOOKMARKS = null;
  }
}

async function buildSchemeDocx(input = {}) {
  const title = cleanText(input.title || '单片机项目设计方案', 300);
  const devices = (Array.isArray(input.devices) ? input.devices : []).map(item => ({ model: cleanText(item?.model, 200), role: cleanText(item?.role, 200) })).filter(item => item.model);
  const functions = (Array.isArray(input.functions) ? input.functions : []).map(item => cleanText(typeof item === 'string' ? item : item?.name || item?.description, 1000)).filter(Boolean);
  const children = [
    new Paragraph({ style: 'ThesisSchemeTitle', children: [bodyRun(title)] }),
    headingParagraph('器件', 2),
    bodyParagraph(devices.map(item => `${item.model}${item.role ? `  （${item.role}）` : ''}`).join('，') || '器件清单待补充。'),
    headingParagraph('功能', 2),
    ...(functions.length ? functions.map(item => listParagraph(item, true)) : [bodyParagraph('功能要求待补充。')]),
  ];
  const doc = new Document({
    creator: '单片机方案与论文工作台',
    lastModifiedBy: '单片机方案与论文工作台',
    title,
    subject: '单片机项目设计方案',
    description: '可在WPS或Word中继续编辑的DOCX方案文档',
    styles: documentStyles(),
    numbering: numberingConfig(),
    sections: [{ properties: { page: pageSetup() }, children }],
  });
  return packWpsCompatibleDocx(doc);
}

globalThis.PaperDocx = {
  buildPaperDocx,
  buildSchemeDocx,
  normalizePayload,
  normalizeRepeatedFigureIntroductions,
  thesisLayout: {
    page: 'A4 portrait',
    marginsMm: { top: 25, bottom: 25, left: 30, right: 25, header: 15, footer: 17.5 },
    body: '小四宋体/Times New Roman，1.5倍行距，首行缩进2字符',
    styles: ['WPS内置正文（ID 1）', 'WPS内置标题1/2/3（ID 2/3/4）', 'WPS内置题注（ID 5）', 'ThesisTableText', 'ThesisFormula', 'ThesisReference', 'ThesisMermaidCode'],
    tables: '标准三线表（顶线、表头线、底线）',
  },
};
