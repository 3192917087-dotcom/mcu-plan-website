/* ============================================================
 * template-parser.js
 * v0.6 模板适配 第 1 步：本地骨架提取
 * - 用 mammoth 提取 .docx 纯文本
 * - 用启发式识别章节标题、表格占位、签字页
 * - 输出"骨架清单"（不含 meta 噪声）
 * ============================================================ */

const TemplateParser = (() => {
  /**
   * 从 .docx 提取骨架
   * @param {File} file - 用户上传的 .docx 模板
   * @returns {Promise<{skeleton: Array, rawText: string, filename: string, size: number}>}
   */
  async function parse(file) {
    if (!file) throw new Error('未选择模板文件');
    if (!window.mammoth) throw new Error('mammoth 库未加载，请刷新页面');

    const buffer = await file.arrayBuffer();
    const result = await window.mammoth.extractRawText({ arrayBuffer: buffer });
    const rawText = (result.value || '').trim();

    const skeleton = extractSkeleton(rawText);

    return {
      skeleton,
      rawText,
      filename: file.name,
      size: file.size,
    };
  }

  /**
   * 从纯文本提取骨架
   * - 章节标题：`## ` `### ` 标记 或 中文「第 X 章」「X.Y」
   * - 表格占位：检测"专业" / "学号" / "指导教师" 等字段名
   * - 签字页：检测"指导教师" + "签字" / "日期"
   */
  function extractSkeleton(text) {
    const lines = text.split(/\r?\n/);
    const items = [];

    for (let i = 0; i < lines.length; i++) {
      // 标准化：去空白、Tab 转空格、去首尾空白
      const line = lines[i].replace(/\t/g, ' ').replace(/\s+/g, ' ').trim();
      if (!line) continue;

      // === 章节标题识别 ===
      // 1. Markdown 风格：## 1 立题依据 / ### 1.1 研究背景
      const mdMatch = line.match(/^#{1,3}\s+(.+)$/);
      if (mdMatch) {
        items.push({ type: 'heading', level: line.match(/^#+/)[0].length, text: mdMatch[1].trim() });
        continue;
      }

      // 2. 中文「第 X 章」「第 X 部分」
      const cnChapter = line.match(/^第\s*([一二三四五六七八九十\d]+)\s*(章|部分)\s*(.+)?$/);
      if (cnChapter) {
        items.push({ type: 'heading', level: 1, text: line });
        continue;
      }

      // 3. 阿拉伯章节：1 / 1.1 / 1.1.1（数字开头 + 标题特征词）
      //    宽容：多个空格 / 全角空格 / Tab 都被前面标准化
      const arMatch = line.match(/^(\d+(?:\.\d+){0,2})\s+(.{2,40})$/);
      if (arMatch) {
        const num = arMatch[1];
        const title = arMatch[2].trim();
        const dots = (num.match(/\./g) || []).length;
        // 过滤：进度安排表格行（如“年月～年月 毕业设计（论文）xx”）
        if (/[年].*[月].*~.*[年].*[月]/.test(title)) continue;
        // 过滤掉"参考文献列表"风格的编号（数字. 空格 后跟很长的内容）
        // 也过滤纯数字标题（如 "1." 或 "1 "）
        if (title.length >= 2 && title.length <= 40 && !/^\d+$/.test(title)) {
          items.push({ type: 'heading', level: dots + 1, num, text: title });
          continue;
        }
      }

      // 4. 中文（一）（二）（三）
      const cnSub = line.match(/^[（(]\s*[一二三四五六七八九十]+\s*[)）]\s*(.{2,40})$/);
      if (cnSub) {
        items.push({ type: 'heading', level: 2, text: line });
        continue;
      }

      // === 表格占位识别 ===
      // 包容匹配：“学号”或“专业”或“学院”出现的行
      if (/专业|学号|学院|姓名|指导教师|选题类型|教研室|题目\s*[：:]/i.test(line)) {
        items.push({ type: 'table-field', text: line });
        continue;
      }

      // === 签字页识别 ===
      // “签字”或“签名”或“意见”且行较短
      if (/意见|签字|签名|日期/.test(line) && line.length < 25) {
        items.push({ type: 'signature', text: line });
      }
    }

    // === 降噪：过滤被误识别为骨架的"表格字段"中包含主控型号的（如“STM32F103C8T6（主控）”） ===
    // （保留，不作修改）

    return items;
  }

  /**
   * 格式化为骨架摘要（给 AI 看）
   */
  function formatSkeleton(skeleton) {
    if (!skeleton || skeleton.length === 0) return '（未识别到骨架）';
    return skeleton
      .map(item => {
        if (item.type === 'heading') {
          const prefix = '#'.repeat(Math.min(item.level || 1, 6));
          return `${prefix} ${item.text}`;
        }
        if (item.type === 'table-field') return `  [表] ${item.text}`;
        if (item.type === 'signature') return `  [签] ${item.text}`;
        return `  ${item.text}`;
      })
      .join('\n');
  }

  /**
   * 格式化为骨架预览（给用户看）
   */
  function previewSkeleton(skeleton) {
    if (!skeleton || skeleton.length === 0) return '（未识别到骨架）';
    return skeleton
      .map(item => {
        if (item.type === 'heading') {
          const indent = '  '.repeat(Math.max(0, (item.level || 1) - 1));
          return `${indent}📑 ${item.text}`;
        }
        if (item.type === 'table-field') return `  📋 ${item.text}`;
        if (item.type === 'signature') return `  ✍️  ${item.text}`;
        return `  ${item.text}`;
      })
      .join('\n');
  }

  return { parse, extractSkeleton, formatSkeleton, previewSkeleton };
})();

window.TemplateParser = TemplateParser;
export default TemplateParser;