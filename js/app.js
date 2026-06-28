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
        lastResult: '',
    };

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
            // 完全没有 # 标题 → 删开头所有内容（保留正文）
            return cleaned.replace(/^[\s\S]*?(?=\n[^\s])/, '').trim();
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
        setLoading(button, true);

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
            renderOutput(result);
            showToast('生成成功！', 'success');
        } catch (err) {
            console.error(err);
            showToast(err.message || '生成失败', 'error');
        } finally {
            setLoading(button, false);
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

    // ========== 初始化 ==========

    async function init() {
        await loadPrompt();

        bindSelectCustom();
        bindLevelCards();

        dom.generateBtn.addEventListener('click', onGenerate);
        dom.regenerateBtn.addEventListener('click', onGenerate);
        dom.copyBtn.addEventListener('click', onCopy);
        dom.docxBtn.addEventListener('click', onDownloadDocx);
        dom.templateBtn.addEventListener('click', onUseTemplate);
        dom.clearDescBtn.addEventListener('click', onClearDesc);

        dom.topic.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                dom.description.focus();
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();