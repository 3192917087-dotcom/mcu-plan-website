// ============================================================
// thesis/thesis-helpers.js - 论文生成专用工具
// ============================================================
// - getHardcodedApiKey(): 从 shared/api.js 读取 hardcoded API Key
// - callMinimax(): 强制 thinking disabled（避免 token 被吃掉）
// - extractFromDocx(): 浏览器端用 mammoth 读 .docx 提取纯文本
// - aiParsePlan(): AI 拆解开题报告/任务书/方案文档
// - countCnChars(): 统计中文字符数
// ============================================================

// === 从 shared/api.js 读取 hardcoded API Key ===
export function getHardcodedApiKey() {
  if (window.ApiClient && window.ApiClient.DEFAULT_CONFIG) {
    return window.ApiClient.DEFAULT_CONFIG.apiKey || '';
  }
  return '';
}

// === callMinimax（强制 thinking:disabled）===
export async function callMinimax(apiKey, messages, options = {}) {
  const {
    temperature = 0.7,
    max_tokens = 4000,
    model = 'MiniMax-M3',
    signal,
  } = options;

  const response = await fetch('https://api.minimaxi.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens,
      stream: false,
      thinking: { type: 'disabled' },
    }),
    signal,
  });

  if (!response.ok) {
    let errMsg = 'HTTP ' + response.status;
    try {
      const errBody = await response.json();
      errMsg = errBody.error?.message || errBody.message || errMsg;
    } catch (e) {}
    throw new Error(errMsg);
  }

  const data = await response.json();
  let text = data.choices?.[0]?.message?.content || '';

  text = text.replace(/<!--[\s\S]*?-->/g, '');
  text = text.replace(/<\|.*?\|>/g, '');

  return {
    text,
    finishReason: data.choices?.[0]?.finish_reason || '?',
    usage: data.usage || {},
  };
}

// === 读 .docx 提取纯文本 ===
export async function extractFromDocx(file) {
  if (!window.mammoth) {
    throw new Error('mammoth.js 未加载');
  }
  const arrayBuffer = await file.arrayBuffer();
  const result = await window.mammoth.extractRawText({ arrayBuffer });
  return result.value || '';
}

// === AI 拆解开题报告/任务书/方案文档 ===
export async function aiParsePlan(apiKey, rawText) {
  const systemPrompt = `你是一位单片机/嵌入式系统专家，擅长从开题报告/任务书/方案文档中精确提取关键信息。

【任务】
从用户提供的文本中提取：
- topic: 论文题目（保留完整题目）
- devices: 器件清单（数组，按顺序，每项一个器件）
- funcs: 功能清单（数组，每项一个功能，15 字左右）
- abstract: 1 句话项目描述（30 字以内）

【输出严格 JSON】
{
  "topic": "基于 STM32 的智能家居环境监测与控制系统设计",
  "devices": ["STM32F103C8T6", "DHT11", "MQ-2"],
  "funcs": [
    "DHT11 实时采集温湿度",
    "MQ-2 检测烟雾浓度"
  ],
  "abstract": "智能家居环境监测与控制系统的设计与实现"
}

【规则】
1. 题目去掉"基于"等前缀，但保留主要信息
2. 器件去除冗余描述，只保留型号
3. 功能每条 10-25 字
4. 器件至少 5 项，功能至少 5 项
5. 没明确信息时填空数组
6. 输出纯 JSON（不要任何解释或 markdown 代码块标记）`;

  const userPrompt = `【用户提供的开题报告/任务书/方案文档】
${rawText.slice(0, 6000)}

【输出 JSON】`;

  const result = await callMinimax(apiKey, [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ], { temperature: 0.3, max_tokens: 2500 });

  let jsonText = result.text.trim();
  jsonText = jsonText.replace(/^`{3}json\s*/i, '').replace(/^`{3}\s*/i, '').replace(/`{3}$/i, '');
  const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('AI 拆解失败：未找到 JSON');
  }
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      topic: parsed.topic || '',
      devices: Array.isArray(parsed.devices) ? parsed.devices : [],
      funcs: Array.isArray(parsed.funcs) ? parsed.funcs : [],
      abstract: parsed.abstract || '',
    };
  } catch (e) {
    throw new Error('AI 拆解 JSON 解析失败：' + e.message);
  }
}

// === 中文字数统计 ===
export function countCnChars(s) {
  if (!s) return 0;
  return [...s].filter(c => '\u4e00' <= c && c <= '\u9fff').length;
}