/* ============================================================
 * api.js
 * API 客户端：OpenAI 兼容协议
 * 支持：流式 / 非流式 / 取消（AbortController）
 * ============================================================ */

const ApiClient = (() => {
  // === 默认配置（API key 写死） ===
  const DEFAULT_CONFIG = {
    baseUrl: 'https://api.minimaxi.com/v1',
        apiKey: 'sk-api-q17nGc67dm7W2XzdtisNfclEVSV7LgQiz84j-bCt7UG5p3bdxnXAmnAgRe9DnrngHvm0RxTAGMngK4eNa0WO3WnBh4Z877b6Ul25PUtY1OY_EmnOMUtbLpE',
    model: 'MiniMax-M3',
  };

  // === 加载用户自定义配置（如果 localStorage 有） ===
  function loadConfig() {
    try {
      const saved = localStorage.getItem('mcu.apiConfig');
      if (saved) {
        const parsed = JSON.parse(saved);
        return { ...DEFAULT_CONFIG, ...parsed };
      }
    } catch (e) {
      console.warn('Failed to load api config:', e);
    }
    return DEFAULT_CONFIG;
  }

  // === 保存配置 ===
  function saveConfig(config) {
    try {
      localStorage.setItem('mcu.apiConfig', JSON.stringify(config));
    } catch (e) {
      console.warn('Failed to save api config:', e);
    }
  }

  // === 非流式对话 ===
  async function chat({ systemPrompt, userMessage, temperature = 0.7, signal }) {
    const config = loadConfig();
    const response = await fetch(config.baseUrl + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + config.apiKey,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
          { role: 'user', content: userMessage },
        ],
        temperature,
        stream: false,
      }),
      signal,
    });

    if (!response.ok) {
      let errMsg = `HTTP ${response.status}`;
      try {
        const errBody = await response.json();
        errMsg = errBody.error?.message || errBody.message || errMsg;
      } catch (e) {
        // ignore
      }
      throw new Error(errMsg);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  }

  // === 流式对话 ===
  async function chatStream({ systemPrompt, userMessage, temperature = 0.7, onChunk, signal }) {
    const config = loadConfig();
    const response = await fetch(config.baseUrl + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + config.apiKey,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
          { role: 'user', content: userMessage },
        ],
        temperature,
        stream: true,
      }),
      signal,
    });

    if (!response.ok) {
      let errMsg = `HTTP ${response.status}`;
      try {
        const errBody = await response.json();
        errMsg = errBody.error?.message || errBody.message || errMsg;
      } catch (e) {
        // ignore
      }
      throw new Error(errMsg);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let nlIdx;
      while ((nlIdx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nlIdx).trim();
        buffer = buffer.slice(nlIdx + 1);
        if (!line || !line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') continue;
        try {
          const json = JSON.parse(payload);
          const delta = json.choices?.[0]?.delta?.content || '';
          if (delta) {
            fullText += delta;
            if (onChunk) onChunk(delta, fullText);
          }
        } catch (e) {
          // skip malformed chunk
        }
      }
    }
    return fullText;
  }

  return {
    DEFAULT_CONFIG,
    loadConfig,
    saveConfig,
    chat,
    chatStream,
  };
})();

window.ApiClient = ApiClient;
