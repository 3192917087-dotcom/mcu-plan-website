/* ============================================================
 * markdown.js
 * 轻量 markdown 渲染器（不依赖外部库）
 * 支持：标题、列表、加粗、斜体、代码块、行内代码、链接
 * ============================================================ */

const Markdown = (() => {
  function escapeHtml(s) {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function render(text) {
    if (!text) return '';
    let lines = text.split('\n');
    let html = [];
    let inCode = false;
    let codeBuf = [];
    let codeLang = '';
    let inList = false;
    let listType = null;
    let paraBuf = [];

    function flushPara() {
      if (paraBuf.length > 0) {
        const p = paraBuf.join(' ').trim();
        if (p) html.push(`<p>${inline(p)}</p>`);
        paraBuf = [];
      }
    }

    function flushList() {
      if (inList) {
        html.push(`</${listType}>`);
        inList = false;
        listType = null;
      }
    }

    function inline(s) {
      let t = escapeHtml(s);
      // 行内代码
      t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
      // 加粗
      t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      // 斜体
      t = t.replace(/\*([^*]+)\*/g, '<em>$1</em>');
      // 链接 [text](url)
      t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
      // checkbox [ ] / [x]
      t = t.replace(/\[ \]/g, '<input type="checkbox" disabled>');
      t = t.replace(/\[x\]/gi, '<input type="checkbox" checked disabled>');
      return t;
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // 代码块
      if (/^```/.test(line)) {
        if (inCode) {
          html.push(`<pre><code class="lang-${escapeHtml(codeLang)}">${escapeHtml(codeBuf.join('\n'))}</code></pre>`);
          inCode = false;
          codeBuf = [];
          codeLang = '';
        } else {
          flushPara();
          flushList();
          inCode = true;
          codeLang = line.replace(/^```/, '').trim();
        }
        continue;
      }
      if (inCode) {
        codeBuf.push(line);
        continue;
      }

      // 标题
      const hMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (hMatch) {
        flushPara();
        flushList();
        const level = hMatch[1].length;
        html.push(`<h${level}>${inline(hMatch[2])}</h${level}>`);
        continue;
      }

      // 无序列表
      const ulMatch = line.match(/^[-*+]\s+(.+)$/);
      if (ulMatch) {
        flushPara();
        if (!inList || listType !== 'ul') {
          flushList();
          html.push('<ul>');
          inList = true;
          listType = 'ul';
        }
        html.push(`<li>${inline(ulMatch[1])}</li>`);
        continue;
      }

      // 有序列表
      const olMatch = line.match(/^\d+\.\s+(.+)$/);
      if (olMatch) {
        flushPara();
        if (!inList || listType !== 'ol') {
          flushList();
          html.push('<ol>');
          inList = true;
          listType = 'ol';
        }
        html.push(`<li>${inline(olMatch[1])}</li>`);
        continue;
      }

      // 引用
      const quoteMatch = line.match(/^>\s*(.*)$/);
      if (quoteMatch) {
        flushPara();
        flushList();
        html.push(`<blockquote>${inline(quoteMatch[1])}</blockquote>`);
        continue;
      }

      // 分隔线
      if (/^---+$/.test(line.trim())) {
        flushPara();
        flushList();
        html.push('<hr>');
        continue;
      }

      // 空行 → 段落分隔
      if (line.trim() === '') {
        flushPara();
        flushList();
        continue;
      }

      // 普通行 → 累积到段落
      paraBuf.push(line.trim());
    }

    flushPara();
    flushList();
    if (inCode) {
      html.push(`<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`);
    }

    return html.join('\n');
  }

  function extractMetadata(text) {
    const meta = {
      topic: '',
      devicesRaw: '',
      funcsRaw: [],
      devices: [],        // [{model, role}]
      funcs: [],           // [{text, category}]
    };

    // 提取题目（可能带“（070A）”括号）
    const topicMatch = text.match(/^#\s+(.+)$/m);
    if (topicMatch) {
      meta.topic = topicMatch[1].trim()
        .replace(/[\(（]\s*\d+\s*[A-Z]\s*[\)）]\s*$/, '')  // 去掉“（070A）”后缀
        .trim();
    }

    // 提取器件行
    const devicesMatch = text.match(/\*\*器件\*\*[：:]\s*([^\n]+)/);
    if (devicesMatch) {
      meta.devicesRaw = devicesMatch[1].trim();
      meta.devices = parseDevices(devicesMatch[1]);
    }

    // 提取功能列表
    const funcSection = text.split(/\*\*功能\*\*[：:]/);
    if (funcSection.length > 1) {
      const lines = funcSection[1].split('\n').filter(l => l.trim());
      const list = lines
        .map(l => l.replace(/^[\s*+\-]+/, '').replace(/^\[[ x]\]\s*/i, '').trim())
        .filter(l => l && !/^\*\*.*\*\*[：:]/.test(l));
      meta.funcsRaw = list;
      meta.funcs = list.map(text => ({ text, category: guessFuncCategory(text) }));
    }

    return meta;
  }

  // 解析器件行：拆逗号/顿号 -> 拆“型号（角色）” -> 结构化
  function parseDevices(text) {
    return text
      .split(/[，,、；]/)  // 中英文逗号 + 顿号 + 分号
      .map(s => s.trim())
      .filter(Boolean)
      .map(item => {
        const m = item.match(/^([^(（]+?)\s*[（(]([^)）]+)[)）]\s*$/);
        if (m) {
          return { model: m[1].trim(), role: m[2].trim() };
        }
        return { model: item, role: '' };
      });
  }

  // 按关键词猜测功能类别
  function guessFuncCategory(text) {
    if (/采集|检测|监测|获取|读取|测量|识别/.test(text)) return '采集';
    if (/报警|提醒|提示|报警|响铃|发光|尖叫|警报/.test(text)) return '报警';
    if (/显示|屏|屏幕|数码管|LCD|OLED|TFT/.test(text)) return '显示';
    if (/控制|驱动|调节|开关|开闭|启动|启停|运转/.test(text)) return '控制';
    if (/通信|传输|推送|上传|下发|发送|接收|WiFi|蓝牙|4G|物联网|APP|手机|云平台/.test(text)) return '通信';
    if (/阈值|设置|调节|设定|切换|模式/.test(text)) return '设置';
    if (/按键|交互|输入|中断|点击|触摸|拨码/.test(text)) return '交互';
    return '其他';
  }

  function stripCodeBlocks(text) {
    return text.replace(/```[\s\S]*?```/g, '[代码块]');
  }

  return { render, escapeHtml, extractMetadata, stripCodeBlocks };
})();

window.Markdown = Markdown;
export default Markdown;