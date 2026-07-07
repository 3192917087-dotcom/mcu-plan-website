// shared/nav.js — 顶部导航跳转下拉框 + 快捷键
// 在功能页面（topic/、taskbook/）调用 NavJump.init() 即可

const NavJump = (() => {
  const modules = [
    { value: '../index.html', label: '🏠 主页',     key: '0' },
    { value: '../topic/',     label: '📋 方案生成', key: '1' },
    { value: '../taskbook/',  label: '📝 开题报告', key: '2' },
    { value: '../thesis/',    label: '📄 论文生成', key: '3' },
    { value: '../ppt/',       label: '📊 PPT 生成（开发中）',  key: '4', disabled: true },
  ];

  function buildHTML(currentModule) {
    const options = modules.map(m => {
      const isCurrent = m.value.includes(currentModule);
      const selected  = isCurrent ? 'selected' : '';
      const disabled  = m.disabled ? 'disabled' : '';
      const hidden    = isCurrent ? 'style="display:none"' : '';
      return `<option value="${m.value}" ${selected} ${disabled} ${hidden}>${m.label}</option>`;
    }).join('');

    return `
<select id="nav-jump-select" class="nav-jump-select" title="跳转到其他模块（快捷键: Ctrl+G）" aria-label="跳转到其他模块">
  <option value="" disabled selected hidden>🔀 跳转</option>
  ${options}
</select>
    `.trim();
  }

  function init(currentModule) {
    // 找到 nav 容器，注入下拉框（在 theme-toggle 之前）
    const nav = document.querySelector('.app-nav');
    if (!nav) return;

    const themeBtn = document.getElementById('theme-toggle');
    const wrapper = document.createElement('div');
    wrapper.innerHTML = buildHTML(currentModule);
    const select = wrapper.firstElementChild;
    if (themeBtn) {
      nav.insertBefore(select, themeBtn);
    } else {
      nav.appendChild(select);
    }

    // 下拉框 change 事件
    select.addEventListener('change', (e) => {
      const val = e.target.value;
      if (val) window.location.href = val;
      e.target.selectedIndex = 0;
    });

    // 快捷键：Ctrl+G / Cmd+G 打开下拉框
    document.addEventListener('keydown', (e) => {
      const isModifier = e.ctrlKey || e.metaKey;
      if (isModifier && (e.key === 'g' || e.key === 'G')) {
        e.preventDefault();
        select.focus();
        select.click();
      }
    });

    // 快捷键：数字键 1-4 直接跳转（输入框焦点时不触发）
    document.addEventListener('keydown', (e) => {
      const t = e.target;
      if (t && (t.matches('input, textarea, select, [contenteditable]'))) return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      const target = modules.find(m => m.key === e.key && !m.disabled && !m.value.includes(currentModule));
      if (target) {
        e.preventDefault();
        window.location.href = target.value;
      }
    });
  }

  return { init };
})();

export default NavJump;