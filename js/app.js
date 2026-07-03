/* ========================================
   app.js (v5 - 极简版)
   ======================================== */

(function () {
    'use strict';

    // ========== 配置 ==========

    const GITHUB_USER = '3192917087-dotcom';
    const MODEL_NAME = 'MiniMax-M3';
    const EMBEDDED_PROMPT = `# 单片机方案设计 Prompt · v6.0

## 角色
你是单片机方案设计师，专为大学生毕业设计/课程设计生成简洁方案。

## 输出格式（严格三段式）

只输出这三部分，**不要任何其他内容**：

# <题目>

**器件**：<类别1（说明）>、<类别2（说明）>、...

**功能**：

- [ ] <功能 1>
- [ ] <功能 2>
...

## 示例输出

# 智能台灯

**器件**：STM32F103C8T6（主控）、光敏电阻（光照检测）、人体红外（有人检测）、继电器+LED灯（自动调光）、蜂鸣器（提示）、OLED（显示）

**功能**：

- [ ] 光照采集：光敏电阻实时采集环境亮度
- [ ] 人体检测：人体红外感知是否有人
- [ ] 自动调光：检测到人 + 光照低 → LED 灯亮

## 10 条硬规则

1. **禁思考块**：绝对不要输出 \`<think>\` \`<thinking>\` \`Think:\` 等任何思考/推理/分析。
2. **禁开场白**：不写"以下是"、"我帮你设计"、"根据你的需求"等。
3. **禁元信息**：不写"依据"、"原理"、"参考文献"、"设计原则"、"等级"等。
4. **禁子标题**：不写"（C002 · STM32）"、"精简方案"等副标题。
5. **禁功能类型**：不写"故障自检"、"多级报警"、"手动复位"、"Flash存储"、"临时授权"、"多设备联动"等。但**仅当用户描述里明确要求这些功能时**，才解禁（可以生成）。默认都是禁止的。
6. **禁其他段落**：不写"设计思路"、"项目背景"、"技术架构"、"系统组成"等。
7. **器件可多行**：**器件**部分可多行（推荐 6-12 个器件），每行一个器件类别，格式为 \`型号（说明）\`。
8. **器件格式**：格式为 \`型号（说明）\`，**类别说明写在括号里**，不是前面。
   - ✅ 正确：\`LCD1602（显示）\`
   - ❌ 错误：\`显示：LCD1602\`
9. **功能格式**：\`- [ ] 功能类别：实现方式\`。
10. **执行设备**：默认 5V 继电器驱动（如"继电器+水泵"）。
11. **优先用器件库**：器件选型必须优先从下方"器件选型库"中选，没有再自由发挥。生成的器件型号必须在器件库里或与库中型号一致。

## 等级决定功能数量与器件（生成用，不输出）

- **C 级（简单）**：5 个以下功能。不含云平台、APP、复杂通信。
- **B 级（中等）**：5-10 条功能。可含蓝牙/WiFi 通信。不含云平台。
- **A 级（复杂）**：10-15 条功能。**必须含云平台（OneNET）+ APP**。

## 器件选型库（优先从这里选）

{device_library}

## 用户消息

{user_message}

请按上述规则输出。只输出 题目 + 器件 + 功能，三段式。`;

    // ========== DOM ==========

    const $ = (id) => document.getElementById(id);

    const dom = {
        topic: $('topic'),
        description: $('description'),
        templateBtn: $('template-btn'),
        clearDescBtn: $('clear-desc-btn'),
        mcuSelect: $('mcu-select'),
        mcuCustom: $('mcu-custom'),
        displaySelect: $('display-select'),
        displayCustom: $('display-custom'),
        powerSelect: $('power-select'),
        powerCustom: $('power-custom'),
        generateBtn: $('generate-btn'),
        regenerateBtn: $('regenerate-btn'),
        copyBtn: $('copy-btn'),
        docxBtn: $('docx-btn'),
        outputCard: $('output-card'),
        outputContent: $('output-content'),
        toast: $('toast'),
    };

    // ========== 状态 ==========

    const state = {
        promptText: '',
        // 设计 tab 的结果。taskbook tab 自己的 state 由 taskbook.js 单独管。
        lastResult: '',
        // 22 级库 catalog。启动时 load22jiCatalog() 加载。
        catalog22ji: [],
    };

    // ========== 22 级库 catalog ==========

    async function load22jiCatalog() {
        try {
            const r = await fetch('library/22ji-catalog.json');
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const data = await r.json();
            state.catalog22ji = Array.isArray(data) ? data : [];
            console.log('[22ji catalog] loaded ' + state.catalog22ji.length + ' projects');
        } catch (err) {
            console.warn('[22ji catalog] load failed:', err.message);
            state.catalog22ji = [];
        }
    }

    function match22ji(query) {
        if (!query || !state.catalog22ji.length) return [];
        const q = query.trim();
        if (!q) return [];
        const keywords = q.split(/[\s,,、，]+/).filter(function (k) { return k.length > 0; });
        if (!keywords.length) return [];
        const hits = state.catalog22ji
            .map(function (p) {
                const name = p.name || '';
                const matchCount = keywords.filter(function (k) { return name.includes(k); }).length;
                return { p: p, matchCount: matchCount };
            })
            .filter(function (x) { return x.matchCount > 0; })
            .sort(function (a, b) { return b.matchCount - a.matchCount; })
            .slice(0, 5)
            .map(function (x) { return x.p; });
        return hits;
    }

    function escapeHtml(s) {
        const div = document.createElement('div');
        div.textContent = s || '';
        return div.innerHTML;
    }

    function renderTopicSuggest(query) {
        const box = document.getElementById('topic-suggest');
        if (!box) return;
        const list = box.querySelector('.topic-suggest-list');
        const title = box.querySelector('.topic-suggest-title');
        const hits = match22ji(query);
        if (!query || !query.trim()) {
            box.classList.add('hidden');
            return;
        }
        box.classList.remove('hidden');
        if (!hits.length) {
            title.textContent = '⚠️ 22 级库里没找到类似的（可按其他题目或参考出）';
            list.innerHTML = '';
            return;
        }
        const count = hits.length;
        title.textContent = '📚 22 级库类似项目（' + count + ' 个 · 点击直接使用该项目方案）：';
        const html = hits.map(function (p) {
            return '<li data-id="' + p.id + '" data-name="' + p.name + '" data-content="' + p.contentFile + '"><strong>' + p.id + '</strong> - ' + p.name + '</li>';
        }).join('');
        list.innerHTML = html;
        list.querySelectorAll('li').forEach(function (li) {
            li.addEventListener('click', function () {
                const id = li.dataset.id;
                const name = li.dataset.name;
                const contentFile = li.dataset.content;
                load22jiScheme(id, name, contentFile);
            });
        });
    }

    function bindTopicSuggest() {
        if (!dom.topic) return;
        dom.topic.addEventListener('input', function (e) { renderTopicSuggest(e.target.value); });
        dom.topic.addEventListener('focus', function (e) { renderTopicSuggest(e.target.value); });
    }

    async function load22jiScheme(id, name, contentFile) {
        try {
            const r = await fetch(contentFile);
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const data = await r.json();
            show22jiModal(id, name, data);
        } catch (err) {
            showToast('加载 ' + id + ' 方案失败: ' + err.message, 'error');
            console.error(err);
        }
    }

    function show22jiModal(id, name, data) {
        let modal = document.getElementById('scheme-22ji-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'scheme-22ji-modal';
            modal.className = 'modal-overlay hidden';
            modal.innerHTML = '<div class="modal-box">' +
                '<div class="modal-header">' +
                '<h2 id="m-title"></h2>' +
                '<button class="modal-close" type="button">×</button>' +
                '</div>' +
                '<div class="modal-body">' +
                '<div class="modal-section"><strong>器件：</strong><span id="m-devices"></span></div>' +
                '<div class="modal-section"><strong>功能：</strong><ul id="m-functions"></ul></div>' +
                '</div>' +
                '<div class="modal-footer">' +
                '<button class="btn btn-secondary" id="m-copy" type="button">📋 复制全文</button>' +
                '<button class="btn btn-primary" id="m-use" type="button">✅ 使用此方案</button>' +
                '</div>' +
                '</div>';
            document.body.appendChild(modal);
            modal.querySelector('.modal-close').addEventListener('click', function () { modal.classList.add('hidden'); });
            modal.addEventListener('click', function (e) { if (e.target === modal) modal.classList.add('hidden'); });
        }
        modal.querySelector('#m-title').textContent = id + ' - ' + name + '（22 级库原方案）';
        modal.querySelector('#m-devices').textContent = data.devices || '(无)';
        const ul = modal.querySelector('#m-functions');
        const funcs = data.functions || [];
        ul.innerHTML = funcs.map(function (f) { return '<li>' + escapeHtml(f) + '</li>'; }).join('');
        modal.querySelector('#m-copy').onclick = function () {
            const text = '# ' + (data.title || name) + '\n\n**器件**：' + (data.devices || '') + '\n\n**功能**：\n' + funcs.map(function (f) { return '- [ ] ' + f; }).join('\n');
            navigator.clipboard.writeText(text).then(function () { showToast('已复制到剪贴板', 'success'); }).catch(function () { showToast('复制失败', 'error'); });
        };
        modal.querySelector('#m-use').onclick = function () {
            use22jiScheme(id, name, data);
            modal.classList.add('hidden');
        };
        modal.classList.remove('hidden');
    }

    function use22jiScheme(id, name, data) {
        const funcs = data.functions || [];
        const md = '# ' + (data.title || name) + '\n\n**器件**：' + (data.devices || '') + '\n\n**功能**：\n' + funcs.map(function (f) { return '- [ ] ' + f; }).join('\n');
        const container = document.getElementById('scheme-22ji-output');
        console.log('[use22jiScheme] id=' + id + ' container=' + (container ? 'FOUND' : 'NULL') + ' md.length=' + md.length);
        if (!container) {
            showToast('输出区不存在', 'error');
            return;
        }
        // 检查父级链是否隐藏
        let p = container.parentElement;
        let hiddenChain = [];
        while (p && p.tagName !== 'BODY') {
            const cs = window.getComputedStyle(p);
            if (cs.display === 'none') hiddenChain.push(p.id || p.className);
            p = p.parentElement;
        }
        console.log('[use22jiScheme] 父级 hidden 链: ' + (hiddenChain.length ? hiddenChain.join(' -> ') : '(无)'));
        container.classList.remove('hidden');
        container.innerHTML = '<div class="output-card">' +
            '<div class="output-header">' +
            '<h3>✅ ' + id + ' - ' + name + '</h3>' +
            '<span class="output-source">来源：22 级库原方案</span>' +
            '</div>' +
            '<div class="output-content">' +
            '<pre>' + escapeHtml(md) + '</pre>' +
            '</div>' +
            '<div class="output-actions">' +
            '<button class="btn btn-secondary" id="m22ji-download" type="button">📥 下载 .docx</button>' +
            '<button class="btn btn-primary btn-next" id="m22ji-next" type="button">下一步：开题报告 <span class="next-step-arrow">→</span></button>' +
            '</div>' +
            '</div>';
        state.lastResult = md;
        state.lastScheme = md;
        state.lastTopic = state.lastTopic || name;
        const dlBtn = container.querySelector('#m22ji-download');
        if (dlBtn && window.DocxExporter) {
            dlBtn.addEventListener('click', async function () {
                try {
                    const filename = id + '-' + name + '.docx';
                    await window.DocxExporter.exportToDocx(md, filename);
                    showToast('已下载 ' + filename, 'success');
                } catch (err) { showToast('下载失败: ' + err.message, 'error'); }
            });
        }

        // 下一步按钮：保存到共享数据 + 跳到开题报告（与 AI 方案同级）
        const nextBtn = container.querySelector('#m22ji-next');
        if (nextBtn) {
            nextBtn.addEventListener('click', function () {
                if (!state.lastScheme) { showToast('请先选择 22 级库方案', 'error'); return; }
                syncShared({
                    scheme: state.lastScheme,
                    topic: state.lastTopic || shared.topic || name,
                    sourceMode: 'topic',
                });
                nextBtn.disabled = true;
                nextBtn.textContent = '✓ 已共享 · 准备下游';
                showToast('共享数据已保存 · 题目：' + (shared.topic || name), 'success');
                if (window.switchTab) window.switchTab('taskbook');
            });
        }

        showToast('已使用 22 级库方案: ' + id + ' - ' + name, 'success');
    }


    // ========== 跨区共享数据 ==========
    // 同一个题目在 4 个区域间共享。
    // - shared.topic              题目
    // - shared.scheme             方案 markdown（区域 ①输出）
    // - shared.taskbook           开题报告 markdown（区域 ②输出）—— 占位预留
    // - shared.thesis             论文 markdown（区域 ③输出）—— 占位预留
    // - shared.sourceMode         'topic' | 'taskbook'
    const shared = window.__shared__ = window.__shared__ || {
        topic: '',
        scheme: '',
        taskbook: '',
        thesis: '',
        ppt: '',
        sourceMode: 'topic',
        updatedAt: Date.now(),
    };

    function syncShared(patch) {
        Object.assign(shared, patch, { updatedAt: Date.now() });
    }
    window.syncShared = syncShared;

    // ========== 工具 ==========

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
            button.innerHTML = '<span class="spinner"></span> 生成中…';
            button.disabled = true;
        } else {
            button.innerHTML = button.dataset.originalText || button.innerHTML;
            button.disabled = false;
        }
    }

    // 为了避免同时出现 loading overlay + button spinner，提供个一体化包装
    function setBusyUI(button, isLoading) {
        setLoading(button, isLoading);
        setLoadingOverlay(isLoading, { title: '正在生成方案...' });
    }

    function trim(s) { return (s || '').trim(); }

    function stripThinking(text) {
        if (!text) return '';

        let cleaned = text;

        // 1. 删完整 <thinking>...</thinking> 标签（全局、多次）
        cleaned = cleaned.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');

        // 2. 删 <think> （任何位置、可能无闭标签）
        cleaned = cleaned.replace(/<think>[\s\S]*?(?=\n# |\n\n# |\Z)/gi, '');

        // 3. 删 </think> 未配对闭标签
        cleaned = cleaned.replace(/<\/think>/gi, '');

        // 4. 删 "Think:" / "Thinking:" / "思考:" 开头的思考区
        cleaned = cleaned.replace(/^(Think|Thinking|思考)[\s:][\s\S]*?(?=\n# |\n\n# |\Z)/gim, '');

        // 5. 找到最后一个 "# " 位置，保留之后的正式方案到讨论关键词或文件末尾
        // 先找到最后一个 "\n# " 位置
        const lastHashIdx = cleaned.lastIndexOf('\n# ');
        if (lastHashIdx < 0) {
            // Fallback 1：找 "1. 题目" / "2. 器件" / "3. 功能" 这种编号列表
            // 注：中文后 \b 不生效，用 lookahead (?=\s|$) 代替
            const numMatch = cleaned.match(/\n\s*\d+\.\s*(题目|器件|功能|方案)(?=\s|$)/m);
            if (numMatch) {
                let afterNum = cleaned.substring(numMatch.index + 1).trim();
                // 截断讨论区（如果 AI 在最终方案后又写了思考）
                const discuss = afterNum.match(/\n\s*\n\s*(Wait|Actually|Hmm|Let me|Finally|OK so|Looking|So the|Now let|Let me revise|Let me double|Let me finalize|Combine)\b/i);
                if (discuss) afterNum = afterNum.substring(0, discuss.index).trim();
                return afterNum;
            }
            // Fallback 2：找 "题目" / "器件" / "功能" 关键词开头
            const kwMatch = cleaned.match(/\n\s*(题目|器件|功能)(?=[：:\s])/);
            if (kwMatch) {
                return cleaned.substring(kwMatch.index + 1).trim();
            }
            // Fallback 3：都找不到 → 返原文（保守不误删）
            return cleaned.trim();
        }

        // 取出从最后一个 # 标题开始的内容
        let afterHash = cleaned.substring(lastHashIdx);

        // 6. 在 afterHash 里找下一个讨论关键词位置，截断
        const discussionMatch = afterHash.match(/\n\s*\n\s*(Wait|Actually|Hmm|Let me|Finally|OK so|Looking|So the|Now let|Let me revise|Let me double|Let me finalize)/i);
        if (discussionMatch) {
            afterHash = afterHash.substring(0, discussionMatch.index);
        }

        // 7. 删除任何 "<数字>. " 开头的列表（"1. No thinking blocks" 之类的）
        // 这是审查清单，不是方案内容
        afterHash = afterHash.replace(/^\d+\.\s+[^\n]*$/gm, '');

        // 8. 删末尾的 "That's N features" / "N features for B level" 这类总结
        afterHash = afterHash.replace(/\n+(That'"'"'s|These are|All features|Total features|\d+\s+features?\s+for.*?(?:level|perfect|good|done)).*$/gim, '');

        // 9. 删末尾的 "Perfect" / "Good" / "Done" 单词行
        afterHash = afterHash.replace(/\n+(Perfect|Good|Done|Nice)\.\s*$/im, '');

        return afterHash.trim();
    }

    // ========== 模板 ==========

    const TEMPLATE_TEXT = `请描述器件需求（可删/改/加）：
- 传感器：数量 + 型号（如 2 个：光敏电阻、人体红外）
- 执行器：数量 + 型号（如 3 个：LED 灯、蜂鸣器、舵机）
- 通信：型号（如 WiFi ESP-01S / 蓝牙 HC-05 / 不需要）
- 云平台：平台（如 OneNET / 不需要）
- APP：需要 / 不需要
- 显示：OLED / LCD1602 / 不需要
- 阈值：xxx（如 光照 < 300 lux 触发）
- 其他功能：夜灯模式、久坐提醒、自动调光等`;

    // ========== 等级选择 ==========

    function getSelectedLevel() {
        const r = document.querySelector('input[name="level"]:checked');
        return r ? r.value : 'B';
    }

    function bindLevelCards() {
        document.querySelectorAll('input[name="level"]').forEach(radio => {
            radio.addEventListener('change', () => {
                document.querySelectorAll('.level-card').forEach(c => c.classList.remove('active'));
                const card = radio.closest('.level-card');
                if (card) card.classList.add('active');
            });
        });
    }

    // ========== 自定义下拉 → 显示输入框 ==========

    function bindSelectCustom() {
        const pairs = [
            [dom.mcuSelect, dom.mcuCustom],
            [dom.displaySelect, dom.displayCustom],
            [dom.powerSelect, dom.powerCustom],
        ];

        pairs.forEach(([select, input]) => {
            if (!select || !input) return;
            select.addEventListener('change', () => {
                if (select.value === '__custom__') {
                    input.style.display = 'block';
                    input.focus();
                } else {
                    input.style.display = 'none';
                    input.value = '';
                }
            });
        });
    }

    // ========== 收集高级选项 ==========

    function getAdvancedSpec() {
        function getSelValue(select, customInput) {
            if (!select) return '';
            if (select.value === '__custom__') {
                return trim(customInput ? customInput.value : '');
            }
            return trim(select.value);
        }

        return {
            mcu: getSelValue(dom.mcuSelect, dom.mcuCustom),
            display: getSelValue(dom.displaySelect, dom.displayCustom),
            power: getSelValue(dom.powerSelect, dom.powerCustom),
        };
    }

    // ========== 生成 ==========

    async function onGenerate() {
        const topic = trim(dom.topic.value);
        const description = trim(dom.description.value);
        const level = getSelectedLevel();

        if (!topic) {
            showToast('请填写题目', 'error');
            dom.topic.focus();
            return;
        }
        if (!state.promptText) {
            showToast('Prompt 模板未加载，请稍候或刷新页面', 'error');
            return;
        }

        const button = dom.outputCard.style.display === 'none' ||
            dom.outputCard.style.display === ''
            ? dom.generateBtn : dom.regenerateBtn;
        setBusyUI(button, true);

        const advanced = getAdvancedSpec();
        const userMsg = buildUserMessage(topic, description, advanced, level);
        // 用 userMsg 替换 Prompt 里的 {user_message} 占位符
        const finalPrompt = state.promptText.replace('{user_message}', userMsg);

        try {
            const result = await ApiClient.chat({
                systemPrompt: finalPrompt,
                userMessage: userMsg,
                model: MODEL_NAME,
                temperature: 0.7,
            });

            state.lastResult = result;
            // 清掉之前的 22 级库方案输出（生成新方案后旧库方案消失）
            const old22ji = document.getElementById('scheme-22ji-output');
            if (old22ji) {
                old22ji.innerHTML = '';
                old22ji.classList.add('hidden');
            }
            renderOutput(result);
            showToast('生成成功！', 'success');
        } catch (err) {
            console.error(err);
            showToast(err.message || '生成失败', 'error');
        } finally {
            setBusyUI(button, false);
        }
    }

    function buildUserMessage(topic, description, advanced, level) {
        const lines = [];
        lines.push(`题目：${topic}`);
        lines.push(`等级：${level}`);
        if (description) {
            lines.push('');
            lines.push('=== 用户需求描述 ===');
            lines.push(description);
        }

        // 高级选项（只在有值时附加）
        const advancedLines = [];
        if (advanced.mcu) advancedLines.push(`主控（用户指定）：${advanced.mcu}`);
        if (advanced.display && advanced.display !== '不需要') {
            advancedLines.push(`显示（用户指定）：${advanced.display}`);
        }
        if (advanced.power) advancedLines.push(`电源（用户指定）：${advanced.power}`);

        if (advancedLines.length > 0) {
            lines.push('');
            lines.push('=== 高级选项（强制使用） ===');
            lines.push(...advancedLines);
        }

        return lines.join('\n');
    }

    function renderOutput(markdown) {
        const cleaned = stripThinking(markdown);
        const html = marked.parse(cleaned);
        dom.outputContent.innerHTML = html;
        dom.outputCard.style.display = 'block';

        // ❗ 不再自动保存到 shared.scheme
        // 仅在本地 state 暂存，用户点「下一步」时才写入共享数据
        state.lastScheme = cleaned;
        state.lastTopic = trim(dom.topic.value) || shared.topic;

        // 显示「下一步」提示条
        const nextBar = document.getElementById('next-step-bar');
        if (nextBar) {
            nextBar.style.display = 'flex';
            // 重置一下提示文案，让用户知道还未共享
            const label = nextBar.querySelector('.next-step-label');
            if (label) label.innerHTML = '✅ 方案已生成 · <strong>点下一步保存到共享数据</strong>';
        }

        setTimeout(() => {
            dom.outputCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
    }

    // ========== 复制 / 下载 ==========

    async function onCopy() {
        if (!state.lastResult) return showToast('没有可复制的内容', 'error');
        const cleaned = stripThinking(state.lastResult);
        try {
            await navigator.clipboard.writeText(cleaned);
            showToast('已复制 Markdown 到剪贴板', 'success');
        } catch {
            const ta = document.createElement('textarea');
            ta.value = cleaned;
            document.body.appendChild(ta);
            ta.select();
            try {
                document.execCommand('copy');
                showToast('已复制', 'success');
            } catch {
                showToast('复制失败，请手动选择', 'error');
            }
            document.body.removeChild(ta);
        }
    }

    async function onDownloadDocx() {
        if (!state.lastResult) return showToast('没有可下载的内容', 'error');

        const cleaned = stripThinking(state.lastResult);
        const filename = DocxExporter.suggestFilename(cleaned);
        setLoading(dom.docxBtn, true);
        try {
            await DocxExporter.exportToDocx(cleaned, filename);
            showToast(`已下载：${filename}`, 'success');
        } catch (err) {
            console.error(err);
            showToast(`下载失败：${err.message}`, 'error');
        } finally {
            setLoading(dom.docxBtn, false);
        }
    }

    // ========== Tab 按钮绑定 ==========

    function bindTabButtons() {
        document.querySelectorAll('.tab-btn:not(.disabled)').forEach(btn => {
            btn.addEventListener('click', () => {
                window.switchTab(btn.dataset.tab);
            });
        });
    }

    // ========== 模板 / 清空 ==========

    function onUseTemplate() {
        console.log('[模板] 触发, TEMPLATE_TEXT 长度:', TEMPLATE_TEXT.length);
        dom.description.value = TEMPLATE_TEXT;
        dom.description.focus();
        showToast('模板已填入，请修改后生成', 'success');
        console.log('[模板] 描述框当前值长度:', dom.description.value.length);
    }

    function onClearDesc() {
        if (!dom.description.value || confirm('确认清空描述？')) {
            dom.description.value = '';
            dom.description.focus();
        }
    }

    // ========== Prompt 加载 ==========

    async function loadPrompt() {
        // 直接使用内嵌 Prompt（不走 GitHub，保证规则生效）
        state.promptText = EMBEDDED_PROMPT.replace('{device_library}', DeviceLibrary.getText());
    }

    // ========== Loading 状态（全局进度+耗时） ==========
    const loadingState = {
        timer: null,
        startTime: 0,
        steps: [
            { pct: 15, text: '准备请求...' },
            { pct: 30, text: '发送题目到 AI...' },
            { pct: 55, text: 'AI 思考中...（这一步要 10-30 秒）' },
            { pct: 80, text: '生成中...' },
            { pct: 95, text: '即将完成...' },
        ],
    };

    function setLoadingOverlay(show, opts = {}) {
        const overlay = document.getElementById('loading-overlay');
        if (!overlay) return;
        if (!show) {
            overlay.style.display = 'none';
            if (loadingState.timer) { clearInterval(loadingState.timer); loadingState.timer = null; }
            return;
        }
        // 显示并启动计时
        document.getElementById('loading-title').textContent = opts.title || '生成中...';
        document.getElementById('loading-step').textContent = loadingState.steps[0].text;
        document.getElementById('loading-progress-bar').style.width = loadingState.steps[0].pct + '%';
        document.getElementById('loading-elapsed').textContent = '已耗时 0 秒';
        overlay.style.display = 'flex';
        loadingState.startTime = Date.now();
        let stepIdx = 0;
        loadingState.timer = setInterval(() => {
            const elapsed = Math.floor((Date.now() - loadingState.startTime) / 1000);
            document.getElementById('loading-elapsed').textContent = `已耗时 ${elapsed} 秒`;
            if (stepIdx < loadingState.steps.length - 1 && elapsed > (stepIdx + 1) * 4) {
                stepIdx++;
                document.getElementById('loading-step').textContent = loadingState.steps[stepIdx].text;
                document.getElementById('loading-progress-bar').style.width = loadingState.steps[stepIdx].pct + '%';
            }
        }, 1000);
    }

    // ========== 初始化 ==========

    async function init() {
        await loadPrompt();
        await load22jiCatalog();

        bindTabButtons();
        bindSelectCustom();
        bindLevelCards();
        bindTopicSuggest();

        dom.generateBtn.addEventListener('click', onGenerate);
        dom.regenerateBtn.addEventListener('click', onGenerate);
        dom.copyBtn.addEventListener('click', onCopy);
        dom.docxBtn.addEventListener('click', onDownloadDocx);
        dom.templateBtn.addEventListener('click', onUseTemplate);
        dom.clearDescBtn.addEventListener('click', onClearDesc);

        // 下一步按钮：点击时才把方案保存到 shared
        const nextStepBtn = document.getElementById('next-step-btn');
        if (nextStepBtn) {
            nextStepBtn.addEventListener('click', () => {
                if (!state.lastScheme) { showToast('请先生成方案', 'error'); return; }
                // ✅ 点击时才保存到共享数据（未点不共享）
                syncShared({
                    scheme: state.lastScheme,
                    topic: state.lastTopic || shared.topic,
                    sourceMode: 'topic',
                });
                // 提示文案变成「已共享」
                const nextBar = document.getElementById('next-step-bar');
                if (nextBar) {
                    const label = nextBar.querySelector('.next-step-label');
                    if (label) label.innerHTML = '✅ 方案已共享 · 下游区域可读取';
                }
                showToast(`共享数据已保存。题目：${shared.topic || '未填'}（区域 ② 占位中）`, 'success');
                // ✅ 下一步按钮的设计意图：跳到"区域 ② 开题报告"继续处理
                //（区域 ② 还只是占位中，等后面实装）
                if (window.switchTab) window.switchTab('taskbook');
            });
        }

        dom.topic.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                dom.description.focus();
            }
        });

        // submode 切换
        bindSubmodeButtons();

        // 恢复上次输入
        if (shared.topic && dom.topic && !dom.topic.value) {
            dom.topic.value = shared.topic;
        }
    }

    function bindSubmodeButtons() {
        const buttons = document.querySelectorAll('.submode-btn');
        buttons.forEach(btn => {
            btn.addEventListener('click', () => {
                const mode = btn.dataset.submode;
                if (!mode) return;
                // 切换按钮激活态
                buttons.forEach(b => b.classList.toggle('active', b === btn));
                // 切换 submode-panel
                document.querySelectorAll('.submode-panel').forEach(p => p.classList.remove('active'));
                const targetId = mode === 'topic' ? 'submode-topic' : 'submode-taskbook';
                const target = document.getElementById(targetId);
                if (target) target.classList.add('active');
                syncShared({ sourceMode: mode });
            });
        });
    }

    // ========== 导出给 taskbook.js 使用 ==========

    /**
     * 把生成结果渲染到指定 tab 的输出区。
     * @param {string} markdown - AI 返回的原始 markdown
     * @param {string} [targetTab] - 'design'（默认）或 'taskbook'
     *
     * 行为：
     * - 'design'：渲染到 design tab 的 #output-content
     * - 'taskbook'：渲染到 taskbook tab 的 #tb-output-content，自动切到 taskbook tab
     * - 两个 tab 的输出区都在各自 panel 内，CSS 的 .tab-panel { display:none }
     *   已经自动处理隐藏/显示，无需 JS 手动藏对方输出
     */
    window.showOutput = function(markdown, targetTab) {
        const cleaned = stripThinking(markdown);

        if (targetTab === 'taskbook') {
            // ❗ 不再自动切换 tab。tb-output-card 在 submode-taskbook 内，
            // 只要该子模式是 active 的（属于 scheme-panel），输出区就可见。
            // 如果自动切换会把用户跳到「区域 ② 开题报告」（同名陷阱）
            const tbCard = document.getElementById('tb-output-card');
            const tbContent = document.getElementById('tb-output-content');
            if (!tbCard || !tbContent) return;
            tbContent.innerHTML = marked.parse(cleaned);
            tbCard.style.display = 'block';
            setTimeout(() => tbCard.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
        } else {
            // 默认 scheme-panel 的题目生成子模式
            renderOutput(cleaned);
        }
    };

    /**
     * 切换 tab。所有输出区都在各自 panel 内，CSS 的 .tab-panel { display:none }
     * 自动处理隐藏/显示，不需要手动藏对方 tab 的输出。
     */
    window.switchTab = function(tabName) {
        document.querySelectorAll('.tab-btn:not(.disabled)').forEach(b => {
            b.classList.toggle('active', b.dataset.tab === tabName);
        });
        document.querySelectorAll('.tab-panel').forEach(p => {
            p.classList.toggle('active', p.id === `${tabName}-panel`);
        });
    };
    window.showToast = showToast;
    window.stripThinking = stripThinking;
    window.setLoadingOverlay = setLoadingOverlay;
    window.generateFromPrompt = async function(prompt) {
        // 直接走 ApiClient（api.js 里 hardcode 了 KEY）
        return await ApiClient.chat({
            systemPrompt: '你是单片机方案设计助手，遵循用户提供的规则输出。',
            userMessage: prompt
        });
    };

    window.deviceLibraryText = ''; // 由 device-library.js 设置

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();