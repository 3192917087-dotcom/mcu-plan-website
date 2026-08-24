/* ============================================================
 * api.js
 * 本地后端 API 客户端：支持流式 / 非流式 / 取消（AbortController）
 * DeepSeek API Key 只存在于本机服务端配置中，不会发送到浏览器。
 * ============================================================ */

const ApiClient = (() => {
  const DEFAULT_CONFIG = {
    model: 'deepseek-v4-pro',
  };

  function loadConfig() {
    return { ...DEFAULT_CONFIG };
  }

  async function status() {
    try {
      const response = await fetch('/api/status', { cache: 'no-store' });
      if (!response.ok) throw await createApiError(response);
      return await response.json();
    } catch (error) {
      throw normalizeNetworkError(error);
    }
  }

  async function chat({ systemPrompt, userMessage, temperature = 0.7, signal }) {
    const config = loadConfig();
    const response = await postChat({ config, systemPrompt, userMessage, temperature, stream: false, signal });

    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  }

  async function chatStream({ systemPrompt, userMessage, temperature = 0.7, onChunk, signal }) {
    const config = loadConfig();
    const response = await postChat({ config, systemPrompt, userMessage, temperature, stream: true, signal });

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
        fullText = appendSsePayload(payload, fullText, onChunk);
      }
    }
    const finalLine = buffer.trim();
    if (finalLine.startsWith('data:')) {
      fullText = appendSsePayload(finalLine.slice(5).trim(), fullText, onChunk);
    }
    return fullText;
  }

  async function postChat({ config, systemPrompt, userMessage, temperature, stream, signal }) {
    try {
      const response = await fetch('/api/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.model,
          messages: [
            ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
            { role: 'user', content: userMessage },
          ],
          temperature,
          stream,
        }),
        signal,
      });
      if (!response.ok) throw await createApiError(response);
      return response;
    } catch (error) {
      throw normalizeNetworkError(error);
    }
  }

  function appendSsePayload(payload, fullText, onChunk) {
    if (!payload || payload === '[DONE]') return fullText;
    try {
      const json = JSON.parse(payload);
      const delta = json.choices?.[0]?.delta?.content || '';
      if (delta) {
        const nextText = fullText + delta;
        onChunk?.(delta, nextText);
        return nextText;
      }
    } catch (error) {
      // 跳过心跳或非文本 SSE 片段。
    }
    return fullText;
  }

  async function createApiError(response) {
    let detail = '';
    try {
      const body = await response.json();
      detail = body.error?.message || body.message || '';
    } catch (error) {
      // 非 JSON 错误响应使用状态码映射。
    }

    const messages = {
      400: '当前请求参数不兼容，请刷新页面后重试。',
      401: 'DeepSeek API 密钥无效或已失效，请更新本机后台密钥。',
      402: 'DeepSeek API 账户余额不足，请充值后再试。',
      403: '当前 API 密钥没有访问此模型的权限。',
      404: '当前模型暂不可用，请检查后台模型配置。',
      408: 'AI 响应超时，请稍后重试。',
      413: '本次提交内容过长，请减少材料后重试。',
      429: '请求过于频繁或已达到额度限制，请稍后重试。',
      500: 'DeepSeek 服务暂时异常，请稍后重试。',
      502: '暂时无法连接 DeepSeek，请检查网络后重试。',
      503: 'AI 服务尚未配置完成，请检查本机后台设置。',
      504: 'DeepSeek 响应超时，请稍后重试。',
    };
    const message = messages[response.status]
      || (response.status >= 500 ? 'AI 服务暂时异常，请稍后重试。' : detail || `请求失败（${response.status}）`);
    const error = new Error(message);
    error.status = response.status;
    error.detail = detail;
    error.isApiError = true;
    return error;
  }

  function normalizeNetworkError(error) {
    if (error?.isApiError || error?.name === 'AbortError') return error;
    const networkError = new Error('无法连接本机 AI 服务，请确认网站后台正在运行。');
    networkError.cause = error;
    return networkError;
  }

  return { DEFAULT_CONFIG, loadConfig, status, chat, chatStream };
})();

window.ApiClient = ApiClient;
export default ApiClient;
