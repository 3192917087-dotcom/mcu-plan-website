// ============================================================
// shared/thesis-docx-export.js
// ============================================================
// 论文专用 .docx 导出器
// 继承自 docx-export.js 的最小 .docx 写入能力
// + 增加：
//   - 首行缩进 2 字符（XML 注入）
//   - H1/H2/H3 标题样式
//   - 流程图作为引用块插入
//   - 摘要 + 致谢 + 参考文献的格式化
// ============================================================

// 用 JSZip 生成 .docx（zip 结构）
// 引用 ../shared/vendor/jszip.min.js（通过 window.JSZip）

const THESIS_DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    {body}
  </w:body>
</w:document>`;

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Normal" w:default="1">
    <w:name w:val="Normal"/>
    <w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="SimSun" w:hAnsi="Times New Roman"/><w:sz w:val="24"/><w:b/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:pPr><w:jc w:val="center"/><w:outlineLvl w:val="0"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="SimHei" w:hAnsi="Times New Roman"/><w:sz w:val="32"/><w:b/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:pPr><w:outlineLvl w:val="1"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="SimHei" w:hAnsi="Times New Roman"/><w:sz w:val="28"/><w:b/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/>
    <w:pPr><w:outlineLvl w:val="2"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="SimHei" w:hAnsi="Times New Roman"/><w:sz w:val="24"/><w:b/></w:rPr>
  </w:style>
</w:styles>`;

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// === trim English/Number runs 与连续英文/数字前后的空格 ===
// 类似于 "STM 32" → "STM32" / "OLED 显示" → "OLED显示" / "主控 STM32" → "主控STM32"
function trimAroundEnglish(s) {
  let prev;
  let cur = String(s);
  // 贪心循环：例如 "主 控  STM 32" 需多步压缩
  do {
    prev = cur;
    // 连续英文字母中间的空格去除："STM 32" "S TM 3 2" → 一个单词
    cur = cur.replace(/([A-Za-z])\s+([A-Za-z0-9])/g, '$1$2');
    // 连续数字/字母中间的空格去除："1 . 5" "STM32  F103" → 一个串
    cur = cur.replace(/([0-9])\s+([A-Za-z0-9])/g, '$1$2');
    cur = cur.replace(/([A-Za-z])\s+([0-9])/g, '$1$2');
    // 数字点数字中间的空格去除："1 . 5" "3 . 14V" → 保留小数点
    cur = cur.replace(/([0-9])\s*\.\s*([0-9])/g, '$1.$2');
    // 连字符/破折号两侧的空格去除："HC - SR501" "STM32 - 51" → 紧凑
    cur = cur.replace(/([A-Za-z0-9])\s+([\-—–])\s+([A-Za-z0-9])/g, '$1$2$3');
    // CJK 与 CJK 之间的空格去除："控 制 器"
    cur = cur.replace(/([一-鿿])\s+([一-鿿])/g, '$1$2');
    // CJK 后跟英文/数字 中间空格去除："STM32 控制器" / "控制器 STM32" / "5V 电源"
    cur = cur.replace(/([A-Za-z0-9])\s+([一-鿿])/g, '$1$2');
    cur = cur.replace(/([一-鿿])\s+([A-Za-z0-9])/g, '$1$2');
  } while (cur !== prev);
  return cur;
}

// === 段落（含首行缩进 2 字符）===
function inlineRuns(line) {
  const cleaned = trimAroundEnglish(line);
  // v15.10.5：解析 **xxx** 为加粗 run，其余普通
  const runs = [];
  const parts = cleaned.split(/(\*\*[^\*]+\*\*)/g);
  for (const part of parts) {
    if (!part) continue;
    const bold = part.startsWith('**') && part.endsWith('**') && part.length > 4;
    const text = bold ? part.slice(2, -2) : part;
    const rPr = bold ? '<w:rPr><w:b/></w:rPr>' : '';
    runs.push(`<w:r>${rPr}<w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r>`);
  }
  return runs.join('');
}

function bodyParagraph(text, opts = {}) {
  const indent = opts.indent !== false;
  const firstLineChars = '200';
  const firstLine = '480';

  const styleXml = opts.style ? `<w:pStyle w:val="${opts.style}"/>` : '';
  const indentXml = indent
    ? `<w:ind w:firstLineChars="${firstLineChars}" w:firstLine="${firstLine}"/>`
    : '';

  const runs = text.split('\n').map((line, i) => {
    if (i > 0) return '<w:br/>';
    return inlineRuns(line);
  }).join('');

  return '<w:p><w:pPr>' + styleXml + indentXml + '</w:pPr>' + runs + '</w:p>';
}

// === 标题段落（无首行缩进）===
function headingParagraph(text, level) {
  return bodyParagraph(text, { style: 'Heading' + level, indent: false });
}

// === 等宽字体段落（流程图代码块）===
function codeParagraph(text) {
  // 单行等宽字体段落
  const lines = text.split('\n');
  const runs = [];
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) runs.push('<w:br/>');
    runs.push(`<w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">${xmlEscape(lines[i] || ' ')}</w:t></w:r>`);
  }
  return `<w:p><w:pPr><w:pBdr><w:top w:val="single" w:sz="4" w:space="1" w:color="cccccc"/><w:left w:val="single" w:sz="4" w:space="4" w:color="cccccc"/><w:bottom w:val="single" w:sz="4" w:space="1" w:color="cccccc"/><w:right w:val="single" w:sz="4" w:space="4" w:color="cccccc"/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="f5f5f5"/></w:pPr>${runs.join('')}</w:p>`;
}

// === 居中段落（流程图标题 / 摘要 Abstract 致谢 参考文献等）的标题 ===
function centerParagraph(text) {
  const t = trimAroundEnglish(text);
  return `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="SimHei" w:hAnsi="Times New Roman"/><w:sz w:val="22"/><w:b/></w:rPr><w:t xml:space="preserve">${xmlEscape(t)}</w:t></w:r></w:p>`;
}

// === 主入口 ===
export async function exportPaperDocx({ topic, chapters, abstractCn, abstractEn, ack, refs, flowcharts }) {
  if (!window.JSZip) throw new Error('JSZip 未加载');

  const bodyElements = [];

  // === 摘要 ===
  bodyElements.push(centerParagraph('摘要'));
  bodyElements.push(bodyParagraph(abstractCn));
  bodyElements.push(bodyParagraph('关键词：STM32；智能家居；环境监测；OneNET；ESP-01S；MQTT'));

  bodyElements.push(centerParagraph('Abstract'));
  bodyElements.push(bodyParagraph(abstractEn));
  bodyElements.push(bodyParagraph('Keywords: STM32; smart home; environment monitoring; OneNET; ESP-01S; MQTT'));

  bodyElements.push(centerParagraph('目  录'));
  bodyElements.push(bodyParagraph('【目录将在 Word 生成时自动插入。按 F9 更新。】', { indent: false }));

  // === 6 章 ===
  for (const id of [1, 2, 3, 4, 5, 6]) {
    bodyElements.push(headingParagraph(id + ' ' + chapterTitle(id), 1));

    const lines = (chapters[id] || '').split('\n');
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;

      if (/^###\s+/.test(t)) {
        bodyElements.push(headingParagraph(t.replace(/^###\s+/, ''), 3));
      } else if (/^##\s+/.test(t)) {
        bodyElements.push(headingParagraph(t.replace(/^##\s+/, ''), 2));
      } else if (/^#\s+/.test(t)) {
        bodyElements.push(headingParagraph(t.replace(/^#\s+/, ''), 1));
      } else {
        bodyElements.push(bodyParagraph(t));
      }
    }

    // Ch4：嵌入流程图
    if (id === 4 && flowcharts) {
      bodyElements.push(headingParagraph('附录：流程图（ASCII + Mermaid）', 2));
      const figs = flowcharts.split(/^## 图 \d+-\d+ /gm).filter(Boolean);
      for (const fig of figs) {
        // 解析 "图4-1 主程序流程图"
        const titleMatch = fig.match(/^([\d\-]+)\s+(.+?)\n/);
        const title = titleMatch ? `图 ${titleMatch[1]} ${titleMatch[2]}` : '流程图';
        bodyElements.push(centerParagraph(title));

        // ASCII 框图
        const asciiMatch = fig.match(/```\n([\s\S]*?)\n```/);
        if (asciiMatch) {
          bodyElements.push(bodyParagraph('【ASCII 框图】', { indent: false }));
          bodyElements.push(codeParagraph(asciiMatch[1]));
        }

        // Mermaid
        const mermaidMatch = fig.match(/```mermaid\n([\s\S]*?)\n```/);
        if (mermaidMatch) {
          bodyElements.push(bodyParagraph('【Mermaid 源码】', { indent: false }));
          bodyElements.push(codeParagraph(mermaidMatch[1]));
          bodyElements.push(bodyParagraph('💡 复制以上代码到 https://mermaid.live 即可渲染为 PNG/SVG', { indent: false }));
        }
      }
    }
  }

  // === 致谢 ===
  bodyElements.push(centerParagraph('致  谢'));
  for (const line of (ack || '').split('\n')) {
    if (line.trim() && !line.match(/^#/)) {
      bodyElements.push(bodyParagraph(line.trim()));
    }
  }

  // === 参考文献 ===
  bodyElements.push(centerParagraph('参考文献'));
  for (const line of (refs || '').split('\n')) {
    const t = line.trim();
    if (t && t.match(/^\[\d+\]/)) {
      bodyElements.push(bodyParagraph(t));
    }
  }

  const documentXml = THESIS_DOCUMENT_XML.replace('{body}', bodyElements.join('\n'));

  // === 用 JSZip 打包 .docx ===
  const zip = new window.JSZip();
  zip.file('[Content_Types].xml', CONTENT_TYPES);
  zip.folder('_rels').file('.rels', RELS);
  zip.folder('word').file('document.xml', documentXml);
  zip.folder('word').file('styles.xml', STYLES_XML);

  const blob = await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  return blob;
}

function chapterTitle(id) {
  return {
    1: '绪论',
    2: '系统总体方案设计',
    3: '系统硬件设计',
    4: '系统软件设计',
    5: '系统测试与结果分析',
    6: '总结与展望',
  }[id] || ('第 ' + id + ' 章');
}
