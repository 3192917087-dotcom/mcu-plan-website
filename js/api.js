/* ========================================
   api.js (v3 - 直接调 MiniMax)
   ⚠️ Key 写死在源码里，仅适合信任用户/内部工具
   ======================================== */

const ApiClient = (() => {
    // ========== 配置（部署前手动填） ==========
    const API_KEY = 'sk-api-_jtmHSbE7dYB76q7j-DGDmaSE4VYKM_l9OhHTB7l6aACjISl2IY1XJh0WAiyaQhKGOuPHmjYee00Pl3R6UAM14cz7R4mSq8-LlzPw5nD_H1TjBLHZwo9jys';
    const BASE_URL = 'https://api.minimaxi.com/v1';
    const MODEL = 'MiniMax-M3';

    async function chat({
        systemPrompt,
        userMessage,
        model = MODEL,
        temperature = 0.7,
    }) {
        if (API_KEY.includes('REPLACE-WITH-YOUR-KEY')) {
            throw new Error('API Key 未配置：请编辑 js/api.js 填入你的 Key');
        }

        const response = await fetch(`${BASE_URL}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${API_KEY}`,
            },
            body: JSON.stringify({
                model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userMessage },
                ],
                temperature,
                max_tokens: 4096,
            }),
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
            throw new Error(formatError(response.status, errMsg));
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;
        if (!content) throw new Error('API 返回内容为空');
        return content;
    }

    function formatError(status, msg) {
        if (status === 401) return '🔑 API Key 无效（请检查 js/api.js 里的 Key）';
        if (status === 402) return '💰 余额不足（去 platform.minimax.io 充值）';
        if (status === 403) return '🚫 访问被拒绝（Key 权限问题）';
        if (status === 429) return '⏱️ 请求过快（稍后再试）';
        if (status >= 500) return `🌐 API 服务器错误（${status}）：${msg}`;
        return `❌ 错误（${status}）：${msg}`;
    }

    return { chat };
})();
