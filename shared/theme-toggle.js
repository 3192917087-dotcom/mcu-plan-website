/* ============================================================
 * theme-toggle.js
 * 主题切换按钮：每个页面右上角都有 #theme-toggle，统一行为
 * 用法：ThemeToggle.init()
 * ============================================================ */

const ThemeToggle = (() => {
  function init() {
    const btn = document.getElementById('theme-toggle');
    if (!btn) return;

    const icon = btn.querySelector('.theme-icon');
    const currentTheme = document.documentElement.getAttribute('data-theme') ||
                         (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    if (icon) icon.textContent = currentTheme === 'dark' ? '🌙' : '☀️';

    btn.addEventListener('click', () => {
      // toggleTheme 由 UIContainer 提供
      const next = window.UIContainer?.toggleTheme?.() || null;
      if (next && icon) icon.textContent = next === 'dark' ? '🌙' : '☀️';
    });
  }

  return { init };
})();

export default ThemeToggle;