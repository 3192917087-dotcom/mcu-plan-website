/* ========================================
   docx-export.js
   把生成的 Markdown 方案导出为 .docx
   使用 docx@8.5.0 (CDN UMD, 全局变量 docx)
   ======================================== */

const DocxExporter = (() => {

    /**
     * 解析 Markdown 为结构化元素
     */
    function parseMarkdown(md) {
        const lines = md.split(/\r?\n/);
        const elements = [];

        for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line) continue;

            // 标题：# 题目
            if (line.startsWith('# ')) {
                elements.push({
                    type: 'heading',
                    text: line.slice(2).trim(),
                });
                continue;
            }

            // 段落（带粗体标签）：**器件：** 内容
            if (line.startsWith('**')) {
                const match = line.match(/^\*\*(.+?)[:：]\*\*\s*(.*)$/);
                if (match) {
                    elements.push({
                        type: 'para',
                        runs: [
                            { text: match[1] + '：', bold: true },
                            { text: match[2] || '' },
                        ],
                    });
                } else {
                    elements.push({
                        type: 'para',
                        runs: [{ text: line.replace(/\*\*/g, '') }],
                    });
                }
                continue;
            }

            // 列表项：- [ ] xxx 或 - [x] xxx
            if (/^- \[[ x]\] /.test(line)) {
                const checked = line.startsWith('- [x]');
                const text = line.replace(/^- \[[ x]\] /, '');
                elements.push({
                    type: 'list-item',
                    text,
                    checked,
                });
                continue;
            }

            // 普通段落
            elements.push({
                type: 'para',
                runs: [{ text: line.replace(/\*\*/g, '') }],
            });
        }

        return elements;
    }

    /**
     * 构造 docx 文档并下载
     */
    async function exportToDocx(markdown, filename) {
        if (typeof docx === 'undefined') {
            throw new Error('docx 库未加载，请检查网络');
        }

        const elements = parseMarkdown(markdown);
        const children = [];

        elements.forEach((el) => {
            if (el.type === 'heading') {
                children.push(
                    new docx.Paragraph({
                        heading: docx.HeadingLevel.HEADING_1,
                        children: [
                            new docx.TextRun({
                                text: el.text,
                                bold: true,
                                size: 36, // 18pt
                            }),
                        ],
                        spacing: { before: 300, after: 200 },
                    })
                );
            } else if (el.type === 'para') {
                const runs = el.runs.map(
                    (r) => new docx.TextRun({ text: r.text, bold: !!r.bold })
                );
                children.push(
                    new docx.Paragraph({
                        children: runs,
                        spacing: { before: 100, after: 100 },
                    })
                );
            } else if (el.type === 'list-item') {
                const bullet = el.checked ? '☑ ' : '☐ ';
                children.push(
                    new docx.Paragraph({
                        children: [
                            new docx.TextRun({ text: bullet + el.text }),
                        ],
                        spacing: { before: 50, after: 50 },
                        indent: { left: 360 }, // 0.25 inch
                    })
                );
            }
        });

        const doc = new docx.Document({
            creator: '单片机方案设计器',
            title: filename.replace(/\.docx$/i, ''),
            sections: [
                {
                    properties: {
                        page: {
                            margin: {
                                top: 1440,    // 1 inch
                                right: 1440,
                                bottom: 1440,
                                left: 1440,
                            },
                        },
                    },
                    children,
                },
            ],
        });

        const blob = await docx.Packer.toBlob(doc);
        saveAs(blob, filename);
    }

    /**
     * 从 Markdown 提取文件名建议（基于 # 标题）
     */
    function suggestFilename(markdown, prefix = '') {
        const firstLine = markdown.split(/\r?\n/)[0] || '方案';
        const title = firstLine.replace(/^#\s*/, '').trim();
        const safe = title.replace(/[\\/:*?"<>|]/g, '');
        if (prefix) {
            return `${prefix}-${safe}方案.docx`;
        }
        return `${safe}方案.docx`;
    }

    return {
        exportToDocx,
        suggestFilename,
        parseMarkdown,
    };
})();
