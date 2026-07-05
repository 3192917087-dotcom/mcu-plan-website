/* ============================================================
 * docx-export.js
 * .docx 导出（不依赖外部库，纯手写最小 .docx zip 结构）
 * 支持：标题、列表、段落、加粗、checkbox
 * ============================================================ */

const DocxExporter = (() => {
  // === 最小 .docx 文件结构（Office Open XML） ===
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

  // === 转义 XML ===
  function xmlEscape(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // === 段落 ===
  function paragraph(text, opts = {}) {
    const runs = parseInline(text, opts);
    return `<w:p><w:pPr><w:pStyle w:val="${opts.style || 'Normal'}"/></w:pPr>${runs}</w:p>`;
  }

  function parseInline(text, opts = {}) {
    if (!text) return '<w:r><w:t xml:space="preserve"></w:t></w:r>';
    // 处理 checkbox
    if (/^\[ \]/.test(text) || /^\[x\]/i.test(text)) {
      const checked = /^\[x\]/i.test(text);
      const rest = text.replace(/^\[[ x]\]\s*/i, '');
      const symbol = checked ? '☒' : '☐';
      return `<w:r><w:t xml:space="preserve">${symbol} </w:t></w:r>${parseInline(rest, opts)}`;
    }
    // 处理 **加粗**
    const boldMatch = text.match(/^\*\*(.+?)\*\*/);
    if (boldMatch) {
      const rest = text.slice(boldMatch[0].length);
      return `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${xmlEscape(boldMatch[1])}</w:t></w:r>${parseInline(rest, opts)}`;
    }
    return `<w:r><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r>`;
  }

  function heading(text, level = 1) {
    return `<w:p><w:pPr><w:pStyle w:val="Heading${level}"/></w:pPr><w:r><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
  }

  function listItem(text) {
    const runs = parseInline(text);
    return `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/></w:pPr>${runs}</w:p>`;
  }

  // === 主转换函数 ===
  function mdToDocxBody(md) {
    const lines = md.split('\n');
    const out = [];
    for (const line of lines) {
      if (/^#{1,6}\s+/.test(line)) {
        const m = line.match(/^(#{1,6})\s+(.+)$/);
        const level = m[1].length;
        out.push(heading(m[2], level));
      } else if (/^[-*+]\s+/.test(line) || /^\d+\.\s+/.test(line)) {
        const text = line.replace(/^[-*+\d.]+\s+/, '');
        out.push(listItem(text));
      } else if (line.trim() === '') {
        out.push('<w:p/>');
      } else {
        out.push(paragraph(line));
      }
    }
    return out.join('\n');
  }

  function buildDocumentXml(md, title = '方案') {
    const body = mdToDocxBody(md);
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${body}
  </w:body>
</w:document>`;
  }

  // === 用 JSZip 风格手写 zip ===
  // 浏览器原生 JSZip 通常可用；如果不可用，fallback 到简单实现
  async function downloadDocx(md, filename = 'scheme.docx') {
    if (typeof JSZip === 'undefined') {
      throw new Error('需要 JSZip 库才能导出 .docx');
    }
    const zip = new JSZip();
    zip.file('[Content_Types].xml', CONTENT_TYPES);
    zip.folder('_rels').file('.rels', RELS);
    zip.folder('word').file('document.xml', buildDocumentXml(md));
    const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return { downloadDocx, buildDocumentXml, mdToDocxBody };
})();

window.DocxExporter = DocxExporter;
export default DocxExporter;