/* ============================================================
 * docx-reader.js
 * 浏览器端读取 .docx / .txt 文本
 * 依赖：mammoth.browser.min.js（window.mammoth）
 * ============================================================ */

const DocxReader = (() => {
  /**
   * 从 File 对象读取文本
   * @param {File} file - 用户选择的文件
   * @returns {Promise<{text: string, meta: {filename, size, type}}>}
   */
  async function read(file) {
    if (!file) throw new Error('未选择文件');

    const filename = file.name;
    const size = file.size;
    const type = file.type;

    // 文本类直接读
    if (/\.txt$/i.test(filename) || type === 'text/plain' || type === 'text/markdown') {
      const text = await file.text();
      return { text, meta: { filename, size, type: 'txt' } };
    }

    // docx 用 mammoth
    if (/\.docx$/i.test(filename) ||
        type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      if (!window.mammoth) {
        throw new Error('mammoth 库未加载，请刷新页面重试');
      }
      const buffer = await file.arrayBuffer();
      const result = await window.mammoth.extractRawText({ arrayBuffer: buffer });
      let text = (result.value || '').trim();
      // mammoth 的 warnings 一般是“图片/表格未能提取”之类的提示，
      // 对“只抽文本”功能无影响，不需要在控制台警告（避免噪音）。
      // 如需调试，可以打开下面一行：
      // if (result.messages?.length) console.debug('[docx-reader] mammoth messages:', result.messages);
      return { text, meta: { filename, size, type: 'docx' } };
    }

    // doc 老格式不支持
    if (/\.doc$/i.test(filename) || type === 'application/msword') {
      throw new Error('暂不支持 .doc 格式（请先在 Word 里另存为 .docx）');
    }

    throw new Error('不支持的文件类型：' + (type || filename));
  }

  return { read };
})();

window.DocxReader = DocxReader;
export default DocxReader;