/* ============================================================
 * ui-kit.js
 * UI 组件库：Toast / 动画工具 / 主题切换 / 进度更新
 * ============================================================ */

const UIContainer = (() => {
  let toastContainer = null;
  let progressContainer = null;
  let abortController = null;

  // === 初始化容器 ===
  function ensureToastContainer() {
    if (!toastContainer) {
      toastContainer = document.createElement('div');
      toastContainer.id = 'toast-container';
      toastContainer.style.cssText = `
        position: fixed;
        top: 80px;
        right: 24px;
        z-index: var(--z-toast);
        display: flex;
        flex-direction: column;
        gap: 8px;
        pointer-events: none;
      `;
      document.body.appendChild(toastContainer);
    }
    return toastContainer;
  }

  // === Toast 通知 ===
  function toast(message, type = 'info', duration = 3000) {
    const container = ensureToastContainer();
    const el = document.createElement('div');
    el.className = 'toast toast-' + type;
    el.textContent = message;
    el.style.cssText = `
      padding: 12px 20px;
      border-radius: var(--radius-md);
      background: var(--color-surface);
      color: var(--color-text);
      box-shadow: var(--shadow-lg);
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
      pointer-events: auto;
      border-left: 4px solid var(--color-${type === 'info' ? 'info' : type});
      animation: slideInRight var(--duration-slow) var(--ease-out);
      max-width: 360px;
      word-break: break-word;
    `;
    container.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity var(--duration-base) ease, transform var(--duration-base) ease';
      el.style.opacity = '0';
      el.style.transform = 'translateX(20px)';
      setTimeout(() => el.remove(), 200);
    }, duration);
  }

  // === 进度更新（按钮内显示） ===
  function setButtonProgress(button, percent, text) {
    if (!button) return;
    if (!button.dataset.origHtml) {
      button.dataset.origHtml = button.innerHTML;
    }
    button.disabled = percent < 100;
    if (percent === 100) {
      button.innerHTML = button.dataset.origHtml;
      delete button.dataset.origHtml;
    } else {
      const safeText = text || `${Math.round(percent)}%`;
      button.innerHTML = `
        <span class="btn-spinner"></span>
        <span>${safeText}</span>
      `;
    }
  }

  // === 生成中状态（中央进度） ===
  function showProgress(title = '正在生成...') {
    hideProgress();
    abortController = new AbortController();
    progressContainer = document.createElement('div');
    progressContainer.id = 'progress-overlay';
    progressContainer.innerHTML = `
      <div class="progress-card">
        <div class="progress-spinner"></div>
        <div class="progress-title">${title}</div>
        <div class="progress-stage">准备中...</div>
        <div class="progress-bar"><div class="progress-bar-fill"></div></div>
        <button class="progress-cancel" type="button">取消</button>
      </div>
    `;
    progressContainer.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.5);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: var(--z-modal);
      animation: fadeIn var(--duration-base) var(--ease-out);
    `;
    const card = progressContainer.querySelector('.progress-card');
    card.style.cssText = `
      background: var(--color-surface);
      padding: 32px 40px;
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-xl);
      min-width: 320px;
      max-width: 480px;
      text-align: center;
      animation: fadeInUp var(--duration-slow) var(--ease-spring);
    `;
    const style = document.createElement('style');
    style.textContent = `
      .progress-spinner {
        width: 48px; height: 48px;
        border: 4px solid var(--color-border);
        border-top-color: var(--color-primary);
        border-radius: 50%;
        margin: 0 auto 20px;
        animation: spin 0.8s linear infinite;
      }
      .progress-title {
        font-size: var(--font-size-lg);
        font-weight: var(--font-weight-semibold);
        margin-bottom: 8px;
      }
      .progress-stage {
        font-size: var(--font-size-sm);
        color: var(--color-text-muted);
        margin-bottom: 24px;
        min-height: 20px;
      }
      .progress-bar {
        height: 6px;
        background: var(--color-border);
        border-radius: var(--radius-full);
        overflow: hidden;
        margin-bottom: 20px;
      }
      .progress-bar-fill {
        height: 100%;
        background: linear-gradient(90deg, var(--color-primary), var(--color-accent));
        border-radius: var(--radius-full);
        width: 0%;
        transition: width var(--duration-slow) var(--ease-out);
        background-size: 200% 100%;
        animation: shimmer 1.5s linear infinite;
      }
      .progress-cancel {
        background: transparent;
        border: 1px solid var(--color-border);
        color: var(--color-text-muted);
        padding: 8px 20px;
        border-radius: var(--radius-sm);
        cursor: pointer;
        font-size: var(--font-size-sm);
        transition: all var(--duration-base) var(--ease-out);
      }
      .progress-cancel:hover {
        background: var(--color-surface-hover);
        border-color: var(--color-border-hover);
        color: var(--color-text);
      }
      .btn-spinner {
        display: inline-block;
        width: 14px; height: 14px;
        border: 2px solid currentColor;
        border-top-color: transparent;
        border-radius: 50%;
        animation: spin 0.6s linear infinite;
        vertical-align: middle;
        margin-right: 6px;
      }
    `;
    document.head.appendChild(style);
    progressContainer.querySelector('.progress-cancel').addEventListener('click', () => {
      if (abortController) abortController.abort();
    });
    document.body.appendChild(progressContainer);
    return abortController;
  }

  function updateProgress(percent, stage) {
    if (!progressContainer) return;
    const fill = progressContainer.querySelector('.progress-bar-fill');
    const stageEl = progressContainer.querySelector('.progress-stage');
    if (fill) fill.style.width = percent + '%';
    if (stageEl && stage) stageEl.textContent = stage;
  }

  function hideProgress() {
    if (progressContainer) {
      progressContainer.style.animation = 'fadeIn var(--duration-base) reverse';
      setTimeout(() => {
        if (progressContainer) progressContainer.remove();
        progressContainer = null;
      }, 200);
    }
    abortController = null;
  }

  // === 主题切换 ===
  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('mcu.theme', next);
    return next;
  }

  function initTheme() {
    const saved = localStorage.getItem('mcu.theme');
    if (saved) {
      document.documentElement.setAttribute('data-theme', saved);
    } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  }

  // === 错误提示 ===
  function showError(err) {
    let msg = '发生未知错误';
    if (typeof err === 'string') msg = err;
    else if (err.message) msg = err.message;
    else if (err.error) msg = err.error;
    console.error(err);
    toast(msg, 'error', 5000);
  }

  return {
    toast,
    setButtonProgress,
    showProgress,
    updateProgress,
    hideProgress,
    toggleTheme,
    initTheme,
    showError,
  };
})();

window.UIContainer = UIContainer;
export default UIContainer;