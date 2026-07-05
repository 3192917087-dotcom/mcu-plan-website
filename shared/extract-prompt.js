/* ============================================================
 * extract-prompt.js
 * 文档导入抽取的 system prompt + JSON 解析
 * 用途：从 .docx / .txt 文档原文抽取 {topic, devices, funcs}
 * ============================================================ */

const ExtractPrompt = (() => {
  /**
   * 生成抽取用的 system prompt
   */
  function build() {
    return `你是方案抽取助手。你的任务是从用户上传的文档原文中抽取【题目】、【器件】、【功能】三项，生成一个精简的项目方案。

【严格规则】
1. 【题目】：抽取原文中明确的课题/项目名称，去除"参考资料/进度安排/研究背景"等元信息。如有多个候选，选最接近标题的。原文未明说主题时返回空字符串，不要反推。
2. 【器件】：抽取原文中明说的元器件型号或类别名称。原文未明的型号不要反推、不要补充。
3. 【功能】：抽取原文中明确描述的功能点。不得添加原文未提的功能。
4. 不得调整/夸大描述，每个功能只能提取原文表述。
5. 输出严格 JSON，不要 markdown 代码块、不要思考过程、不要多余文本。

【输出格式】
{
  "topic": "抽取出的题目（字符串）",
  "devices": ["器件1", "器件2", ...],
  "funcs": ["功能1", "功能2", ...]
}`;
  }

  /**
   * 解析 AI 返回的文本为结构化 JSON
   * 容错：去掉 markdown 代码块包裹、提取 {…} 块
   */
  function parse(text) {
    const empty = { topic: '', devices: [], funcs: [] };
    if (!text) return empty;
    let t = String(text).trim();
    t = t.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');

    const jsonMatch = t.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const obj = JSON.parse(jsonMatch[0]);
        return {
          topic: (obj.topic || '').toString().trim(),
          devices: Array.isArray(obj.devices)
            ? obj.devices.filter(Boolean).map(s => String(s).trim())
            : [],
          funcs: Array.isArray(obj.funcs)
            ? obj.funcs.filter(Boolean).map(s => String(s).trim())
            : [],
        };
      } catch (e) {
        console.warn('[ExtractPrompt] JSON parse failed:', e);
      }
    }
    return empty;
  }

  /**
   * 完整入口：构造 userMessage + 调用 AI + 解析
   * 调用方需要传 ApiClient.chat 调用结果，自己控制温度和 abort
   */
  return { build, parse };
})();

export default ExtractPrompt;