// Provider-specific request policy. Keep credentials inside the browser; never persist them here.
export function resolveAiProfile(config = {}, reasoning = false) {
  const model = String(reasoning ? config.reasoningModel || config.chatModel : config.chatModel || '');
  if (/(?:^|\/)kimi-k3(?:$|[-_.:])/i.test(model)) return { id: 'kimi-k3', model, label: 'Kimi K3' };
  if (config.provider === 'deepseek' || /api\.deepseek\.com/i.test(config.apiUrl || '')) return { id: 'deepseek', model, label: 'DeepSeek' };
  return { id: config.provider || 'compatible', model, label: 'AI' };
}

export function taskFromLabel(label = '', jsonMode = false) {
  if (/连接|API测试/.test(label)) return 'connection';
  if (/励志|鼓励/.test(label)) return 'motivation';
  if (/格式修复/.test(label)) return 'json-repair';
  if (/统一资料|项目理解/.test(label)) return 'brief';
  if (/器件|引脚/.test(label)) return 'hardware';
  if (/论文结构/.test(label)) return 'outline';
  if (/一致性|技术复检/.test(label)) return 'audit';
  if (/摘要|关键词|英文题目/.test(label)) return 'extras';
  if (/局部修复/.test(label)) return 'patch';
  if (/补强|修复/.test(label)) return jsonMode ? 'json-repair' : 'repair';
  if (/章.*写作|章.*补写/.test(label)) return 'chapter';
  if (/方案/.test(label)) return 'scheme';
  if (/文献/.test(label)) return 'references';
  return jsonMode ? 'structured' : 'text';
}

export function requestPolicy(config, options = {}) {
  const profile = resolveAiProfile(config, options.reasoning);
  const task = options.task || taskFromLabel(options.requestLabel, options.jsonMode);
  const finalTokens = Math.min(32768, Math.max(256, Number(options.maxTokens) || 8192));
  const kimi = profile.id === 'kimi-k3';
  const high = ['brief', 'hardware', 'outline', 'audit'].includes(task);
  const reasoningReserve = high ? 8192 : 4096;
  const timeoutMs = kimi
    ? ({ connection: 45000, motivation: 45000, chapter: 300000, audit: 240000, brief: 240000 }[task] || 180000)
    : Number(options.timeoutMs) || (options.reasoning ? 240000 : 180000);
  return {
    ...profile, task, finalTokens,
    effort: high ? 'high' : 'low',
    completionTokens: kimi ? Math.min(65536, Math.max(4096, finalTokens + reasoningReserve)) : finalTokens,
    timeoutMs, idleTimeoutMs: kimi ? 90000 : timeoutMs,
    attempts: kimi ? 3 : 2, stream: kimi,
  };
}

export function buildAiPayload(config, messages, options = {}, policy = requestPolicy(config, options)) {
  const payload = { model: policy.model, messages, stream: policy.stream };
  if (policy.id === 'kimi-k3') {
    payload.temperature = 1;
    payload.reasoning_effort = policy.effort;
    payload.max_completion_tokens = policy.completionTokens;
    if (options.jsonMode) payload.response_format = options.schema
      ? { type: 'json_schema', json_schema: { name: options.schemaName || policy.task.replace(/-/g, '_'), strict: true, schema: options.schema } }
      : { type: 'json_object' };
  } else {
    payload.max_tokens = policy.finalTokens;
    if (policy.id === 'deepseek') {
      payload.thinking = { type: options.reasoning ? 'enabled' : 'disabled' };
      if (!options.reasoning) payload.temperature = 0.35;
    } else if (policy.id === 'moonshot' || policy.id === 'zhipu') {
      payload.temperature = 1;
      if (options.reasoning && policy.id === 'zhipu') payload.thinking = { type: 'enabled' };
    } else if (policy.id === 'openai') {
      delete payload.max_tokens;
      payload.max_completion_tokens = policy.finalTokens;
    } else if (!options.reasoning) payload.temperature = 0.35;
    if (options.jsonMode && ['deepseek', 'zhipu', 'openai'].includes(policy.id)) payload.response_format = { type: 'json_object' };
  }
  return payload;
}

export class AiRequestError extends Error {
  constructor(message, code, details = {}) { super(message); this.name = 'AiRequestError'; this.code = code; Object.assign(this, details); }
}

const flatten = value => typeof value === 'string' ? value : Array.isArray(value)
  ? value.map(item => typeof item === 'string' ? item : item?.text || item?.content || '').join('')
  : value?.text || value?.content || '';

export function readAiResult(data) {
  const choice = data?.choices?.[0];
  const originalMessage = choice?.message || data?.message || {};
  const text = [flatten(originalMessage.content), flatten(data?.output_text), flatten(data?.result), flatten(data?.content),
    Array.isArray(data?.output) ? data.output.flatMap(item => item.content || []).map(item => item.text || '').join('') : '']
    .find(value => String(value || '').trim()) || '';
  // reasoning_content is never final text, even if it happens to contain JSON.
  return { text, finishReason: choice?.finish_reason || '', message: { ...originalMessage, role: 'assistant', content: text }, usage: data?.usage || null };
}

export async function readAiStream(response, { onProgress = () => {}, onActivity = () => {}, signal } = {}) {
  if (!/text\/event-stream/i.test(response.headers.get('content-type') || '')) return readAiResult(await response.json());
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', text = '', reasoning = '', finishReason = '', usage = null, doneMarker = false;
  const dispatch = async frame => {
    const value = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n').trim();
    if (!value) return;
    if (value === '[DONE]') { doneMarker = true; return; }
    let data;
    try { data = JSON.parse(value); } catch { throw new AiRequestError('AI流式响应格式损坏，已保留当前草稿', 'BROKEN_STREAM', { partialText: text }); }
    if (data.error) throw new AiRequestError(String(data.error.message || 'AI流式请求失败'), 'STREAM_ERROR', { partialText: text });
    const choice = data.choices?.[0];
    const delta = choice?.delta || choice?.message || {};
    text += flatten(delta.content);
    reasoning += flatten(delta.reasoning_content);
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    if (data.usage) usage = data.usage;
    await onProgress({ phase: text ? 'writing' : 'thinking', text, reasoningCharacters: reasoning.length });
  };
  try {
    while (!doneMarker) {
      if (signal?.aborted) throw signal.reason;
      const chunk = await reader.read();
      if (chunk.done) break;
      onActivity();
      buffer += decoder.decode(chunk.value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');
      let end;
      while (!doneMarker && (end = buffer.indexOf('\n\n')) >= 0) { await dispatch(buffer.slice(0, end)); buffer = buffer.slice(end + 2); }
    }
    buffer += decoder.decode();
    if (!doneMarker && buffer.trim()) await dispatch(buffer);
    if (!finishReason) throw new AiRequestError('AI连接提前结束，已保留返回的草稿', 'INCOMPLETE_STREAM', { partialText: text, doneMarker });
    return { text, finishReason, message: { role: 'assistant', content: text, ...(reasoning ? { reasoning_content: reasoning } : {}) }, usage };
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function mergeContinuation(previous, next) {
  // Remove only a substantial exact overlap, preserving short repeated words and code fences.
  const limit = Math.min(previous.length, next.length, 2500);
  for (let length = limit; length >= 40; length--) if (previous.endsWith(next.slice(0, length))) return previous + next.slice(length);
  return previous + next;
}

export function validateJsonShape(value, schema, path = '$') {
  if (!schema) return [];
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [`${path}应为对象`];
    const errors = (schema.required || []).filter(key => !Object.hasOwn(value, key)).map(key => `${path}.${key}缺失`);
    for (const [key, item] of Object.entries(value)) {
      if (schema.properties?.[key]) errors.push(...validateJsonShape(item, schema.properties[key], `${path}.${key}`));
      else if (schema.additionalProperties === false) errors.push(`${path}.${key}为未定义字段`);
    }
    return errors;
  }
  if (schema.type === 'array') return !Array.isArray(value) ? [`${path}应为数组`] : value.flatMap((item, i) => validateJsonShape(item, schema.items, `${path}[${i}]`));
  if (schema.type && typeof value !== schema.type) return [`${path}类型错误`];
  if (schema.enum && !schema.enum.includes(value)) return [`${path}取值不符合约定`];
  return [];
}

function abortableDelay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

export async function requestAi(config, messages, options = {}, dependencies = {}) {
  if (!config.apiUrl || !config.apiKey || !config.chatModel) throw new AiRequestError('尚未填写API，请先完成配置', 'MISSING_CONFIG');
  const fetchRequest = dependencies.fetch || globalThis.fetch;
  const delay = dependencies.delay || abortableDelay;
  const signal = options.signal;
  const onProgress = options.onProgress || (() => {});
  const policy = requestPolicy(config, options);
  const payload = buildAiPayload(config, messages, options, policy);
  let prefix = '', continued = false, lastError;
  for (let attempt = 0; attempt < policy.attempts; attempt++) {
    if (signal?.aborted) throw signal.reason || new DOMException('已暂停', 'AbortError');
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason || new DOMException('已暂停', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });
    const attemptTimeout = !attempt ? policy.timeoutMs : policy.id === 'kimi-k3'
      ? Math.min(120000, policy.timeoutMs) : Math.max(45000, Math.min(120000, Math.round(policy.timeoutMs * 0.72)));
    let idleTimer;
    const resetIdle = () => { clearTimeout(idleTimer); idleTimer = setTimeout(() => controller.abort(new DOMException('AI长时间未返回数据', 'TimeoutError')), policy.idleTimeoutMs); };
    const hardTimer = setTimeout(() => controller.abort(new DOMException('AI请求等待超时', 'TimeoutError')), attemptTimeout);
    resetIdle();
    let partialText = '';
    let retryDelay = 0;
    try {
      await onProgress({ phase: attempt ? (continued ? 'continuing' : 'retrying') : 'connecting', text: prefix, attempt, profile: policy.id });
      const response = await fetchRequest(config.apiUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify(payload), signal: controller.signal,
      });
      resetIdle();
      if (!response.ok) {
        const raw = await response.text();
        let data; try { data = JSON.parse(raw); } catch { data = {}; }
        const message = data?.error?.message || data?.message || raw.slice(0, 300);
        if (response.status === 400 && /temperature/i.test(message) && Object.hasOwn(payload, 'temperature') && policy.id !== 'kimi-k3') {
          delete payload.temperature; retryDelay = 300;
        } else if ([408, 425, 429, 500, 502, 503, 504].includes(response.status)) {
          const retryAfter = response.headers.get('retry-after');
          const retryMs = retryAfter && /^\d+(\.\d+)?$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now();
          retryDelay = Math.min(45000, Math.max(3000 * 2 ** attempt + Math.random() * 1000, retryMs || 0));
        } else throw new AiRequestError(message || `API请求失败（${response.status}）`, 'HTTP_ERROR', { status: response.status });
        throw new AiRequestError(message || 'AI服务暂时繁忙', 'RETRYABLE_HTTP', { status: response.status });
      }
      const result = policy.stream ? await readAiStream(response, {
        signal: controller.signal, onActivity: resetIdle,
        onProgress: async progress => { partialText = progress.text; await onProgress({ ...progress, text: prefix + progress.text, attempt, profile: policy.id }); },
      }) : readAiResult(await response.json());
      partialText = result.text;
      const combined = prefix ? mergeContinuation(prefix, result.text) : result.text;
      if (policy.id === 'kimi-k3' && !result.finishReason) throw new AiRequestError('AI没有返回完成标记，已保留当前草稿', 'INCOMPLETE_STREAM', { partialText: combined });
      if (result.finishReason === 'length') {
        if (policy.id === 'kimi-k3') {
          payload.max_completion_tokens = Math.min(65536, Math.max(payload.max_completion_tokens * 2, payload.max_completion_tokens + 8192));
          payload.reasoning_effort = 'low';
          if (!options.jsonMode && result.text.trim()) {
            prefix = combined;
            continued = true;
            payload.messages = [...payload.messages, result.message, { role: 'user', content: '上次达到输出上限。严格接着最后一个字符续写本次任务，完成剩余内容。不要重新开始、不要复述已有段落，不要补写新的章节；若在表格或Mermaid代码块中断，从断点继续，不要重开代码块。' }];
          }
        } else payload[Object.hasOwn(payload, 'max_completion_tokens') ? 'max_completion_tokens' : 'max_tokens'] = Math.min(32768, policy.finalTokens * 2);
        throw new AiRequestError('AI输出达到长度上限，正在增加额度恢复完整内容', 'OUTPUT_TRUNCATED', { partialText: combined });
      }
      if (result.finishReason && result.finishReason !== 'stop') throw new AiRequestError(`AI未完成正文输出（${result.finishReason}）`, 'UNEXPECTED_FINISH', { partialText: combined });
      if (!result.text.trim()) throw new AiRequestError('AI没有返回最终文本', 'EMPTY_AI_CONTENT', { partialText: prefix });
      if (options.jsonMode && policy.id === 'kimi-k3') {
        let value;
        try { value = JSON.parse(combined); } catch { throw new AiRequestError('AI返回的JSON不完整', 'INVALID_JSON'); }
        const errors = validateJsonShape(value, options.schema);
        if (errors.length) throw new AiRequestError(`AI返回字段不完整：${errors.slice(0, 3).join('；')}`, 'INVALID_JSON');
      }
      await onProgress({ phase: 'complete', text: combined, attempt, profile: policy.id });
      return { ...result, text: combined, profile: policy.id, attempts: attempt + 1 };
    } catch (error) {
      if (signal?.aborted) throw signal.reason || error;
      const timedOut = controller.signal.aborted;
      if (error instanceof SyntaxError) error = new AiRequestError('AI返回的数据不完整，正在恢复请求', 'INVALID_JSON', { partialText: prefix + partialText });
      if (timedOut) error = new AiRequestError('AI等待超时，已保留当前进度，可以继续生成', 'TIMEOUT', { partialText: prefix + partialText });
      if (partialText && !error.partialText) error.partialText = prefix + partialText;
      lastError = error;
      const retryable = timedOut || error instanceof TypeError || ['RETRYABLE_HTTP', 'EMPTY_AI_CONTENT', 'OUTPUT_TRUNCATED', 'INVALID_JSON', 'INCOMPLETE_STREAM', 'BROKEN_STREAM'].includes(error.code);
      if (!retryable || attempt + 1 === policy.attempts) throw error;
      if (policy.id === 'kimi-k3') payload.reasoning_effort = 'low';
      else if (policy.id === 'deepseek') { payload.model = config.chatModel; payload.thinking = { type: 'disabled' }; payload.temperature = 0.25; }
      await onProgress({ phase: 'retrying', text: error.partialText || '', attempt: attempt + 1, reason: error.code, profile: policy.id });
      // Do not create overlapping upstream requests by instantly retrying a timed-out long write.
      retryDelay ||= timedOut ? 5000 : 1200;
    } finally {
      clearTimeout(hardTimer); clearTimeout(idleTimer); signal?.removeEventListener('abort', abort);
    }
    await delay(retryDelay, signal);
  }
  throw lastError;
}

export function applyExactPatches(content, patches = []) {
  if (!Array.isArray(patches) || !patches.length) return { content, changed: false };
  const spans = [];
  for (const patch of patches) {
    if (typeof patch.find !== 'string' || !patch.find || typeof patch.replace !== 'string') throw new AiRequestError('局部修复缺少准确原文', 'INVALID_PATCH');
    const start = content.indexOf(patch.find);
    if (start < 0 || content.indexOf(patch.find, start + 1) >= 0) throw new AiRequestError('局部修复原文不存在或出现多次，原稿已保留', 'INVALID_PATCH');
    const end = start + patch.find.length;
    if (spans.some(span => start < span.end && end > span.start)) throw new AiRequestError('局部修复范围互相重叠，原稿已保留', 'INVALID_PATCH');
    spans.push({ start, end, replacement: patch.replace });
  }
  let result = content;
  spans.sort((a, b) => b.start - a.start).forEach(span => { result = result.slice(0, span.start) + span.replacement + result.slice(span.end); });
  return { content: result, changed: result !== content };
}
