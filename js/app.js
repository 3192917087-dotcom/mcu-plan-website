/* ========================================
   app.js
   主逻辑：表单处理、状态管理、UI 更新
   ======================================== */

(function () {
    'use strict';

    // ========== DOM 引用 ==========

    const $ = (id) => document.getElementById(id);

    const dom = {
        // 输入
        topic: $('topic'),
        description: $('description'),
        levelRadios: () => document.querySelectorAll('input[name="level"]'),

        // 顶部显示
        modelNameDisplay: $('model-name-display'),
        promptVersionDisplay: $('prompt-version-display'),

        // 按钮
        generateBtn: $('generate-btn'),
        settingsBtn: $('settings-btn'),
        regenerateBtn: $('regenerate-btn'),
        copyBtn: $('copy-btn'),
        docxBtn: $('docx-btn'),

        // 输出
        outputCard: $('output-card'),
        outputContent: $('output-content'),

        // Toast
        toast: $('toast'),

        // 设置弹窗
        settingsModal: $('settings-modal'),
        settingsClose: $('settings-close'),
        settingsCancel: $('settings-cancel'),
        settingsSave: $('settings-save'),
        apiKey: $('api-key'),
        toggleKeyVisibility: $('toggle-key-visibility'),
        clearKey: $('clear-key'),
        baseUrl: $('base-url'),
        modelName: $('model-name'),
        githubUser: $('github-user'),
        promptUrlPreview: $('prompt-url-preview'),
        promptVersionInfo: $('prompt-version-info'),
        refreshPromptBtn: $('refresh-prompt-btn'),
    };

    // ========== 状态 ==========

    const state = {
        promptText: '',
        promptSource: '',
        promptTimestamp: 0,
        lastResult: '', // 最新生成的 Markdown
    };

    // ========== localStorage keys ==========

    const LS = {
        apiKey: 'mcu-plan:api-key',
        baseUrl: 'mcu-plan:base-url',
        modelName: 'mcu-plan:model-name',
        githubUser: 'mcu-plan:github-user',
    };

    // ========== 工具函数 ==========

    function showToast(msg, type = '') {
        dom.toast.textContent = msg;
        dom.toast.className = 'toast' + (type ? ' ' + type : '');
        dom.toast.style.display = 'block';
        clearTimeout(showToast._timer);
        showToast._timer = setTimeout(() => {
            dom.toast.style.display = 'none';
        }, 3000);
    }

    function setLoading(button, isLoading) {
        if (isLoading) {
            button.dataset.originalText = button.innerHTML;
            button.innerHTML = '<span class="spinner"></span> 处理中...';
            button.disabled = true;
        } else {
            button.innerHTML = button.dataset.originalText || button.innerHTML;
            button.disabled = false;
        }
    }

    function getSelectedLevel() {
        for (const r of dom.levelRadios()) {
            if (r.checked) return r.value;
        }
        return 'A';
    }

    function sanitize(s) {
        return (s || '').trim();
    }

    // ========== 初始化 ==========

    async function init() {
        // 从 localStorage 恢复设置
        const savedBaseUrl = localStorage.getItem(LS.baseUrl);
        const savedModel = localStorage.getItem(LS.modelName);
        const savedGithubUser = localStorage.getItem(LS.githubUser);
        const savedApiKey = localStorage.getItem(LS.apiKey);

        if (savedBaseUrl) dom.baseUrl.value = savedBaseUrl;
        else dom.baseUrl.value = ApiClient.DEFAULT_BASE_URL;

        if (savedModel) dom.modelName.value = savedModel;
        else dom.modelName.value = ApiClient.DEFAULT_MODEL;

        if (savedGithubUser) dom.githubUser.value = savedGithubUser;

        if (savedApiKey) dom.apiKey.value = savedApiKey;

        updateModelDisplay();
        updatePromptUrlPreview();

        // 加载 prompt（先尝试缓存）
        await loadPrompt(false);

        // 绑定事件
        bindEvents();
    }

    function updateModelDisplay() {
        const model = dom.modelName.value || ApiClient.DEFAULT_MODEL;
        dom.modelNameDisplay.textContent = model;
    }

    function updatePromptUrlPreview() {
        const user = dom.githubUser.value.trim();
        if (!user) {
            dom.promptUrlPreview.textContent = '请先填 GitHub 用户名';
            return;
        }
        const url = PromptLoader.buildUrl(user);
        dom.promptUrlPreview.textContent = url || 'URL 拼装失败';
    }

    async function loadPrompt(forceRefresh) {
        try {
            const result = await PromptLoader.load(forceRefresh);
            state.promptText = result.text;
            state.promptSource = result.source;
            state.promptTimestamp = result.timestamp;

            const version = PromptLoader.extractVersion(result.text);
            dom.promptVersionDisplay.textContent = `v${version}`;
            dom.promptVersionInfo.textContent =
                `v${version} · ${PromptLoader.formatTimestamp(result.timestamp)}`;
        } catch (err) {
            console.warn('prompt load failed:', err);
            const cached = localStorage.getItem('mcu-plan:prompt-cache');
            if (cached) {
                state.promptText = cached;
                const version = PromptLoader.extractVersion(cached);
                dom.promptVersionDisplay.textContent = `v${version} (缓存)`;
                dom.promptVersionInfo.textContent =
                    `v${version} · 缓存 · 远程拉取失败：${err.message}`;
            } else {
                dom.promptVersionDisplay.textContent = '未加载';
                dom.promptVersionInfo.textContent =
                    `加载失败：${err.message}。请在设置里填 GitHub 用户名`;
            }
        }
    }

    // ========== 事件绑定 ==========

    function bindEvents() {
        dom.generateBtn.addEventListener('click', onGenerate);
        dom.regenerateBtn.addEventListener('click', onGenerate);

        dom.settingsBtn.addEventListener('click', openSettings);
        dom.settingsClose.addEventListener('click', closeSettings);
        dom.settingsCancel.addEventListener('click', closeSettings);
        dom.settingsSave.addEventListener('click', saveSettings);

        dom.settingsModal.addEventListener('click', (e) => {
            if (e.target === dom.settingsModal) closeSettings();
        });

        dom.toggleKeyVisibility.addEventListener('click', () => {
            dom.apiKey.type = dom.apiKey.type === 'password' ? 'text' : 'password';
        });

        dom.clearKey.addEventListener('click', () => {
            if (confirm('确定要清空 API Key 吗？')) {
                dom.apiKey.value = '';
                localStorage.removeItem(LS.apiKey);
                showToast('已清空 API Key', 'success');
            }
        });

        dom.githubUser.addEventListener('input', updatePromptUrlPreview);
        dom.modelName.addEventListener('change', updateModelDisplay);

        dom.refreshPromptBtn.addEventListener('click', async () => {
            setLoading(dom.refreshPromptBtn, true);
            try {
                await loadPrompt(true);
                showToast('Prompt 已刷新', 'success');
            } catch (err) {
                showToast(err.message, 'error');
            } finally {
                setLoading(dom.refreshPromptBtn, false);
            }
        });

        dom.copyBtn.addEventListener('click', onCopy);
        dom.docxBtn.addEventListener('click', onDownloadDocx);

        // 回车快捷键
        dom.topic.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onGenerate();
            }
        });
    }

    // ========== 设置弹窗 ==========

    function openSettings() {
        dom.settingsModal.style.display = 'flex';
        updatePromptUrlPreview();
    }

    function closeSettings() {
        dom.settingsModal.style.display = 'none';
    }

    function saveSettings() {
        const apiKey = dom.apiKey.value.trim();
        const baseUrl = dom.baseUrl.value.trim() || ApiClient.DEFAULT_BASE_URL;
        const modelName = dom.modelName.value || ApiClient.DEFAULT_MODEL;
        const githubUser = dom.githubUser.value.trim();

        if (!baseUrl.startsWith('http')) {
            showToast('Base URL 必须以 http 开头', 'error');
            return;
        }

        localStorage.setItem(LS.apiKey, apiKey);
        localStorage.setItem(LS.baseUrl, baseUrl);
        localStorage.setItem(LS.modelName, modelName);
        localStorage.setItem(LS.githubUser, githubUser);

        updateModelDisplay();

        // 如果 GitHub 用户名变了，刷新 prompt
        closeSettings();
        showToast('设置已保存', 'success');

        if (githubUser) {
            loadPrompt(false);
        }
    }

    // ========== 生成方案 ==========

    async function onGenerate() {
        const topic = sanitize(dom.topic.value);
        const description = sanitize(dom.description.value);
        const level = getSelectedLevel();

        if (!topic) {
            showToast('请先填写题目', 'error');
            dom.topic.focus();
            return;
        }

        const apiKey = localStorage.getItem(LS.apiKey) || '';
        if (!apiKey) {
            showToast('请先在设置里填 API Key', 'error');
            openSettings();
            return;
        }

        if (!state.promptText) {
            showToast('Prompt 模板未加载，请刷新或检查 GitHub 用户名', 'error');
            return;
        }

        const button = dom.regenerateBtn.style.display === 'none' ||
            dom.outputCard.style.display === 'none'
            ? dom.generateBtn : dom.regenerateBtn;
        setLoading(button, true);

        // 构造用户消息
        let userMsg = `题目：${topic}\n等级：${level}`;
        if (description) {
            userMsg += `\n补充描述：${description}`;
        }
        userMsg += `\n\n请按规则输出方案。`;

        try {
            const result = await ApiClient.chat({
                apiKey,
                baseUrl: dom.baseUrl.value.trim() || ApiClient.DEFAULT_BASE_URL,
                model: dom.modelName.value || ApiClient.DEFAULT_MODEL,
                systemPrompt: state.promptText,
                userMessage: userMsg,
                temperature: 0.7,
            });

            state.lastResult = result;
            renderOutput(result);
            showToast('生成成功！', 'success');
        } catch (err) {
            console.error(err);
            showToast(err.message || '生成失败', 'error');
        } finally {
            setLoading(button, false);
        }
    }

    function renderOutput(markdown) {
        // 用 marked 渲染 Markdown → HTML
        const html = marked.parse(markdown);
        dom.outputContent.innerHTML = html;
        dom.outputCard.style.display = 'block';

        // 平滑滚动到结果区
        setTimeout(() => {
            dom.outputCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
    }

    // ========== 复制 Markdown ==========

    async function onCopy() {
        if (!state.lastResult) {
            showToast('没有可复制的内容', 'error');
            return;
        }
        try {
            await navigator.clipboard.writeText(state.lastResult);
            showToast('已复制 Markdown 到剪贴板', 'success');
        } catch {
            // fallback
            const ta = document.createElement('textarea');
            ta.value = state.lastResult;
            document.body.appendChild(ta);
            ta.select();
            try {
                document.execCommand('copy');
                showToast('已复制 Markdown 到剪贴板', 'success');
            } catch {
                showToast('复制失败，请手动选择', 'error');
            }
            document.body.removeChild(ta);
        }
    }

    // ========== 下载 .docx ==========

    async function onDownloadDocx() {
        if (!state.lastResult) {
            showToast('没有可下载的内容', 'error');
            return;
        }

        const filename = DocxExporter.suggestFilename(state.lastResult);
        setLoading(dom.docxBtn, true);
        try {
            await DocxExporter.exportToDocx(state.lastResult, filename);
            showToast(`已下载：${filename}`, 'success');
        } catch (err) {
            console.error(err);
            showToast(`下载失败：${err.message}`, 'error');
        } finally {
            setLoading(dom.docxBtn, false);
        }
    }

    // ========== 启动 ==========

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
