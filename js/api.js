/* ========================================
   api.js
   调用 MiniMax API（OpenAI 兼容格式）
   ======================================== */

const ApiClient = (() => {
    const DEFAULT_BASE_URL = 'https://api.minimaxi.com/v1';
    const DEFAULT_MODEL = 'MiniMax-M3';

    /**
     * 调用 MiniMax chat completion API
     * @param {object} opts
     * @param {string} opts.apiKey
     * @param {string} opts.baseUrl
     * @param {string} opts.model
     * @param {string} opts.systemPrompt
     * @param {string} opts.userMessage
     * @param {function} opts.onChunk - 流式回调（可选）
     * @returns {Promise<string>}
     */
    async function chat({
        apiKey,
        baseUrl = DEFAULT_BASE_URL,
        model = DEFAULT_MODEL,
        systemPrompt,
        userMessage,
        temperature = 0.7,
    }) {
        if (!apiKey) {
            throw new Error('未设置 API Key，请先在"设置"里填写');
        }

        const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;

        const body = {
            model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userMessage },
            ],
            temperature,
            max_tokens: 4096,
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const errText = await response.text();
            let errMsg;
            try {
                const errJson = JSON.parse(errText);
                errMsg = errJson.error?.message || errJson.message || errText;
            } catch {
                errMsg = errText || `HTTP ${response.status}`;
            }
            throw new Error(formatApiError(response.status, errMsg));
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;
        if (!content) {
            throw new Error('API 返回内容为空');
        }
        return content;
    }

    /**
     * 格式化 API 错误信息
     */
    function formatApiError(status, msg) {
        if (status === 401) {
            return `🔑 API Key 无效（401）。请检查 key 是否正确，或去 platform.minimax.io 重新生成`;
        }
        if (status === 402) {
            return `💰 余额不足（402）。请去 platform.minimax.io 充值`;
        }
        if (status === 404) {
            return `🔍 模型或端点不存在（404）。请检查 Base URL 和模型名`;
        }
        if (status === 429) {
            return `⏱️ 请求过快（429）。请稍后再试`;
        }
        if (status >= 500) {
            return `🌐 服务器错误（${status}）。请稍后再试：${msg}`;
        }
        return `❌ API 错误（${status}）：${msg}`;
    }

    return {
        chat,
        DEFAULT_BASE_URL,
        DEFAULT_MODEL,
    };
})();
