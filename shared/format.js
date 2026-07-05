/* ============================================================
 * format.js
 * 通用格式化工具（器件列表、字符串清理等）
 * ============================================================ */

const Format = (() => {
  /**
   * 把 storage 中的器件数组格式化为 "型号（角色）" 字符串
   * 每行一个。
   * 输入格式：
   *   - string: 原样返回
   *   - {model, role}: 拼成 "型号（角色）"
   *   - {name, role}: 拼成 "name（role）"
   */
  function devicesToText(devices) {
    if (!Array.isArray(devices)) return '';
    return devices.map(d => {
      if (typeof d === 'string') return d;
      if (d.model && d.role) return `${d.model}（${d.role}）`;
      if (d.model) return d.model;
      if (d.name) return d.name;
      return JSON.stringify(d);
    }).join('\n');
  }

  /**
   * 把 storage 中的功能数组格式化为文本（每行一条）
   */
  function funcsToText(funcs) {
    if (!Array.isArray(funcs)) return '';
    return funcs.map(f => typeof f === 'string' ? f : (f.text || JSON.stringify(f))).join('\n');
  }

  /**
   * 把 textarea 字符串拆成非空行数组
   */
  function textToLines(text) {
    return (text || '').split('\n').map(s => s.trim()).filter(Boolean);
  }

  /**
   * 文件名安全化：去掉 Windows 非法字符
   */
  function sanitizeFilename(name) {
    return (name || '').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
  }

  /**
   * 字节数格式化为可读字符串
   */
  function formatSize(bytes) {
    if (bytes == null) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  }

  return {
    devicesToText,
    funcsToText,
    textToLines,
    sanitizeFilename,
    formatSize,
  };
})();

export default Format;