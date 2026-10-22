import assert from 'node:assert/strict';
import { requestPolicy, buildAiPayload, resolveAiProfile, readAiStream, requestAi, applyExactPatches } from '../ai-runtime.js';
import { AI_SCHEMAS } from '../ai-schemas.js';
import { validateKimiBrief, sampledCode, inputStamp } from '../kimi-workflow.js';

const kimi = { provider: 'moonshot', chatModel: 'kimi-k3', reasoningModel: 'kimi-k3', apiUrl: 'https://api.moonshot.cn/v1/chat/completions', apiKey: 'test-only' };
const deepseek = { ...kimi, provider: 'deepseek', chatModel: 'deepseek-v4-pro', reasoningModel: 'deepseek-reasoner', apiUrl: 'https://api.deepseek.com/chat/completions' };
const messages = [{ role: 'user', content: '测试资料，不包含真实用户信息' }];
let assertions = 0;
const check = (condition, message) => { assert.ok(condition, message); assertions++; };
function streamResponse(frames, { finish = 'stop', reasoning = '分析内容不可作为正文', fragment = 0 } = {}) {
  const parts = [JSON.stringify({ choices: [{ delta: { reasoning_content: reasoning } }] }), ...frames.map(content => JSON.stringify({ choices: [{ delta: { content } }] }))];
  if (finish) parts.push(JSON.stringify({ choices: [{ delta: {}, finish_reason: finish }] }));
  const bytes = new TextEncoder().encode(': keep-alive\r\n\r\n' + parts.map(part => 'data: ' + part + '\r\n\r\n').join('') + 'data: [DONE]\r\n\r\n');
  return new Response(new ReadableStream({ start(controller) {
    if (fragment) for (let i = 0; i < bytes.length; i += fragment) controller.enqueue(bytes.slice(i, i + fragment));
    else controller.enqueue(bytes);
    controller.close();
  } }), { headers: { 'Content-Type': 'text/event-stream' } });
}
function mockFetch(responses) {
  const calls = [];
  return { calls, fetch: async (url, options) => { calls.push(JSON.parse(options.body)); const response = responses.shift(); if (!response) throw new Error('意外多次调用'); return response; }, delay: async () => {} };
}

check(resolveAiProfile({ ...kimi, provider: 'compatible' }).id === 'kimi-k3', '自定义中转地址仍通过真实模型匹配K3');
check(resolveAiProfile({ ...kimi, provider: 'compatible', chatModel: 'moonshotai/kimi-k3' }).id === 'kimi-k3', '带厂家前缀的K3名称仍匹配策略');
check(resolveAiProfile({ ...kimi, chatModel: 'kimi-k2.6' }).id !== 'kimi-k3', '旧Kimi模型不套用K3策略');
const small = requestPolicy(kimi, { task: 'motivation', maxTokens: 240 });
check(small.effort === 'low' && small.completionTokens >= 4096, '短任务预留思考额度');
check(requestPolicy(kimi, { task: 'hardware' }).effort === 'high', '引脚分析使用较高推理强度');
check(requestPolicy(kimi, { task: 'chapter', reasoning: true }).effort === 'low', '统一理解之后写作使用低推理避免反复长思考');
const kimiPayload = buildAiPayload(kimi, messages, { task: 'motivation', maxTokens: 240, jsonMode: true, schema: AI_SCHEMAS.motivation });
check(kimiPayload.stream && kimiPayload.reasoning_effort === 'low' && kimiPayload.temperature === 1, 'K3参数正确');
check(!('max_tokens' in kimiPayload) && !('thinking' in kimiPayload), 'K3不使用废弃输出参数或关闭思考');
check(kimiPayload.response_format.json_schema.strict === true, '关键任务使用严格Schema');
const dsPayload = buildAiPayload(deepseek, messages, { reasoning: false, jsonMode: true, maxTokens: 7000 });
check(!dsPayload.stream && dsPayload.thinking.type === 'disabled' && dsPayload.max_tokens === 7000, 'DeepSeek保留非流式和任务思考开关');
check(dsPayload.response_format.type === 'json_object', 'DeepSeek保留JSON模式');

const streamed = await readAiStream(streamResponse(['中文', '正文'], { fragment: 1 }));
check(streamed.text === '中文正文' && !streamed.text.includes('分析内容'), '跨字节UTF8和CRLF解析完整，只取最终正文');
check(streamed.message.reasoning_content.includes('分析内容'), '仅为继续对话保留完整assistant消息');
const keptOpen = new Response(new ReadableStream({ start(controller) {
  controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"已完成"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'));
} }), { headers: { 'Content-Type': 'text/event-stream' } });
check((await readAiStream(keptOpen)).text === '已完成', '收到DONE立即结束，避免等待服务端关闭长连接');
await assert.rejects(readAiStream(streamResponse(['半篇正文'], { finish: '' })), error => error.code === 'INCOMPLETE_STREAM'); assertions++;

const continuation = mockFetch([streamResponse(['前半正文'], { finish: 'length' }), streamResponse(['后半正文'])]);
const completed = await requestAi(kimi, messages, { task: 'chapter', maxTokens: 1000 }, continuation);
check(completed.text === '前半正文后半正文' && continuation.calls.length === 2, '长文截断自动从断点继续');
check(continuation.calls[1].messages[1].reasoning_content && continuation.calls[1].messages[2].role === 'user', '续写回传完整assistant推理字段');
check(continuation.calls[1].max_completion_tokens > continuation.calls[0].max_completion_tokens, '截断后增加额度');

const jsonRetry = mockFetch([streamResponse(['{"text":'], { finish: 'length' }), streamResponse(['{"text":"长风破浪会有时"}'])]);
await requestAi(kimi, messages, { task: 'motivation', jsonMode: true, schema: AI_SCHEMAS.motivation, maxTokens: 240 }, jsonRetry);
check(jsonRetry.calls[1].messages.length === 1, 'JSON截断整体重新返回，不拼接两份JSON');

const shapeRetry = mockFetch([streamResponse(['{"wrong":"字段错误"}']), streamResponse(['{"text":"正确字段"}'])]);
await requestAi(kimi, messages, { task: 'motivation', jsonMode: true, schema: AI_SCHEMAS.motivation }, shapeRetry);
check(shapeRetry.calls.length === 2, '字段错误不能通过下游');

const empty = mockFetch([streamResponse([]), streamResponse([]), streamResponse([])]);
await assert.rejects(requestAi(kimi, messages, { jsonMode: true }, empty), error => error.code === 'EMPTY_AI_CONTENT'); assertions++;
check(empty.calls.length === 3, '仅思考无正文有限重试，禁止把思考JSON当结果');

const rate = mockFetch([new Response('{"error":{"message":"限速"}}', { status: 429, headers: { 'retry-after': '7' } }), streamResponse(['正常正文'])]);
let observedDelay = 0;
rate.delay = async ms => { observedDelay = ms; };
await requestAi(kimi, messages, {}, rate);
check(observedDelay >= 7000 && rate.calls[1].model === 'kimi-k3', '限流退避并保持用户所选模型');

const badSchema = mockFetch([new Response('{"error":{"message":"invalid schema"}}', { status: 400 })]);
await assert.rejects(requestAi(kimi, messages, {}, badSchema), error => error.status === 400); assertions++;
check(badSchema.calls.length === 1, '400参数错误不能盲目重试或静默降级');

const brokenResponse = mockFetch([new Response('{broken'), new Response(JSON.stringify({ choices: [{ message: { content: '恢复正文' }, finish_reason: 'stop' }] }))]);
check((await requestAi(deepseek, messages, {}, brokenResponse)).text === '恢复正文', '损坏响应在DeepSeek模式仍可恢复');
const truncated = mockFetch([streamResponse(['a'], { finish: 'length' }), streamResponse(['b'], { finish: 'length' }), streamResponse(['c'], { finish: 'length' })]);
await assert.rejects(requestAi(kimi, messages, { task: 'chapter' }, truncated), error => error.code === 'OUTPUT_TRUNCATED' && error.partialText === 'abc'); assertions++;
const filtered = mockFetch([streamResponse(['拒绝后的残片'], { finish: 'content_filter' })]);
await assert.rejects(requestAi(kimi, messages, {}, filtered), error => error.code === 'UNEXPECTED_FINISH'); assertions++;

const cancelled = new AbortController(); cancelled.abort(new DOMException('用户暂停', 'AbortError'));
await assert.rejects(requestAi(kimi, messages, { signal: cancelled.signal }, { fetch: () => { throw new Error('不能发请求'); } }), error => error.name === 'AbortError'); assertions++;

const patch = applyExactPatches('开头。重复段落。结尾。', [{ find: '重复段落。', replace: '独有分析。' }]);
check(patch.content === '开头。独有分析。结尾。', '补丁精确定位');
assert.throws(() => applyExactPatches('重复重复', [{ find: '重复', replace: '内容' }]), /出现多次/); assertions++;
assert.throws(() => applyExactPatches('abcdef', [{ find: 'abcd', replace: '1' }, { find: 'cdef', replace: '2' }]), /重叠/); assertions++;
assert.throws(() => applyExactPatches('原文', [{ find: '不存在', replace: '内容' }]), /不存在/); assertions++;

check(validateKimiBrief({ overview: '系统', functionCoverage: [{ functionId: 'f1' }] }, { functions: [{ id: 'f1' }, { id: 'f2' }] }).length > 0, '统一理解不能遗漏功能');
check(validateKimiBrief({ overview: '系统', functionCoverage: [{ functionId: 'f1' }, { functionId: 'f1' }] }, { functions: [{ id: 'f1' }] }).length > 0, '统一理解不能重复功能');
const code = sampledCode([{ path: 'main.ino', content: '开头初始化' + '中间程序'.repeat(1000) + '末尾控制逻辑' }], '', 2100);
check(code.includes('末尾控制逻辑') && code.includes('节选'), '长程序包含中段和结尾，明确节选边界');
check(inputStamp({ testInfo: '新测试数据' }) !== inputStamp({ testInfo: '旧测试数据' }), '测试资料变化使理解缓存失效');

console.log(JSON.stringify({ assertions, result: 'passed' }));
