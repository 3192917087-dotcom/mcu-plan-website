// 开题报告/任务书 → 方案 工作流
// 依赖:JSZip(CDN 加载),prompt-loader.js

(function() {
  'use strict';

  // ---- DOM ----
  const $ = (id) => document.getElementById(id);
  const uploadBtn = $('upload-btn');
  const docxFile = $('docx-file');
  const fileInfo = $('file-info');
  const fileName = $('file-name');
  const clearFileBtn = $('clear-file-btn');
  const topicCard = $('topic-card');
  const tbTopic = $('tb-topic');
  const extractedCard = $('extracted-card');
  const extractedContent = $('extracted-content');
  const descCard = $('desc-card');
  const tbDesc = $('tb-desc');
  const tbGenerateBtn = $('tb-generate-btn');

  let currentFile = null;
  let currentExtracted = null;  // {topic, funcs, raw}
  let tbLastResult = '';        // 最新生成结果(原始 markdown,用于复制/下载)
  let tbLastResultCleaned = ''; // 清理思考后的内容,点「下一步」时才写到 shared
  let tbLastTopic = '';         // 最新生成的题目,同上

  // 跨区共享数据(与 app.js 同一指针)
  const shared = window.__shared__;

  // 注:Tab 切换逻辑已统一在 app.js 的 bindTabButtons(),这里不再重复

  // ---- 输出区按钮事件 ----
  const tbCopyBtn = $('tb-copy-btn');
  const tbDocxBtn = $('tb-docx-btn');
  const tbRegenerateBtn = $('tb-regenerate-btn');

  tbCopyBtn.addEventListener('click', async () => {
    if (!tbLastResult) return showToast('没有可复制的内容', 'error');
    const cleaned = (window.stripThinking || (m => m))(tbLastResult);
    try {
      await navigator.clipboard.writeText(cleaned);
      showToast('已复制 Markdown 到剪贴板', 'success');
    } catch {
      const ta = document.createElement('textarea');
      ta.value = cleaned;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); showToast('已复制', 'success'); }
      catch { showToast('复制失败,请手动选择', 'error'); }
      document.body.removeChild(ta);
    }
  });

  tbDocxBtn.addEventListener('click', async () => {
    if (!tbLastResult) return showToast('没有可下载的内容', 'error');
    const cleaned = (window.stripThinking || (m => m))(tbLastResult);
    const filename = DocxExporter.suggestFilename(cleaned);
    tbDocxBtn.disabled = true;
    try {
      await DocxExporter.exportToDocx(cleaned, filename);
      showToast(`已下载:${filename}`, 'success');
    } catch (err) {
      console.error(err);
      showToast(`下载失败:${err.message}`, 'error');
    } finally {
      tbDocxBtn.disabled = false;
    }
  });

  tbRegenerateBtn.addEventListener('click', () => {
    if (currentExtracted) tbGenerateBtn.click();
    else showToast('请先上传文件', 'error');
  });

  const tbNextStepBtn = $('tb-next-step-btn');
  if (tbNextStepBtn) {
    tbNextStepBtn.addEventListener('click', () => {
      // ✅ 点击时才把开题生成的方案保存到 shared
      if (!tbLastResultCleaned) { showToast('请先生成方案', 'error'); return; }
      if (shared && window.syncShared) {
        window.syncShared({
          scheme: tbLastResultCleaned,
          topic: tbLastTopic || shared.topic,
          sourceMode: 'taskbook',
        });
        const tbNextBar = document.getElementById('tb-next-step-bar');
        if (tbNextBar) {
          const label = tbNextBar.querySelector('.next-step-label');
          if (label) label.innerHTML = '✅ 方案已共享 · 下游区域可读取';
        }
      }
      showToast(`共享数据已保存。题目：${(shared && shared.topic) || '未填'}（区域 ② 占位中）`, 'success');
      if (window.switchTab) window.switchTab('taskbook');
    });
  }

  // ---- 文件上传 ----
  uploadBtn.addEventListener('click', () => docxFile.click());
  docxFile.addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (f) handleFile(f);
  });

  clearFileBtn.addEventListener('click', () => {
    currentFile = null;
    currentExtracted = null;
    docxFile.value = '';
    fileInfo.style.display = 'none';
    topicCard.style.display = 'none';
    extractedCard.style.display = 'none';
    descCard.style.display = 'none';
    tbGenerateBtn.style.display = 'none';
  });

  // ---- 拖拽上传 ----
  const uploadZone = $('upload-zone');
  uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('dragover');
  });
  uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('dragover');
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  });

  async function handleFile(file) {
    currentFile = file;
    fileName.textContent = `${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
    fileInfo.style.display = 'flex';

    showToast('⏳ 解析文件中...', 'info');

    try {
      let text = '';
      if (file.name.toLowerCase().endsWith('.docx')) {
        text = await parseDocx(file);
      } else if (file.name.toLowerCase().endsWith('.doc')) {
        text = await parseDoc(file);
      } else {
        throw new Error('不支持的文件格式');
      }

      if (!text || text.length < 10) {
        throw new Error('文件内容为空或未识别到文字');
      }

      // 隐藏之前的提取结果,等 AI 返回后再填
      currentExtracted = { raw: text, topic: '', funcs: [], devices: [] };
      topicCard.style.display = 'none';
      extractedCard.style.display = 'none';
      tbGenerateBtn.style.display = 'none';

      // 调 AI 读懂全文,提取题目 / 功能 / 器件
      if (window.setLoadingOverlay) window.setLoadingOverlay(true, { title: '正在读懂开题报告...' });
      let info;
      try {
        info = await aiExtractInfo(text);
      } finally {
        if (window.setLoadingOverlay) window.setLoadingOverlay(false);
      }
      currentExtracted = info;

      // 显示题目（优先用共享数据中的题目）
      tbTopic.value = info.topic || (shared && shared.topic) || '';
      // 同步到共享数据
      if (shared) {
        shared.topic = tbTopic.value;
        shared.sourceMode = 'taskbook';
      }
      topicCard.style.display = 'block';

      // 显示提取信息
      renderExtracted(info);
      extractedCard.style.display = 'block';

      // 显示描述卡片
      descCard.style.display = 'block';
      tbDesc.value = '';  // 清空

      // 显示生成按钮
      tbGenerateBtn.style.display = 'block';

      if (!info.topic && (!info.funcs || info.funcs.length === 0)) {
        showToast('⚠️ AI 未识别出题目或功能,请检查描述填写需求', 'error');
      } else {
        showToast('✓ 提取成功', 'success');
      }
    } catch (err) {
      console.error(err);
      showToast('❌ 解析失败:' + err.message, 'error');
      // 即使 AI 失败,也让用户能手动填写(topicCard + descCard + tbGenerateBtn 都可用)
      topicCard.style.display = 'block';
      descCard.style.display = 'block';
      tbGenerateBtn.style.display = 'block';
    }
  }

  async function parseDocx(file) {
    const buf = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(buf);
    const entry = zip.file('word/document.xml');
    if (!entry) throw new Error('不是有效的 .docx 文件');
    const xml = await entry.async('string');
    const re = /<w:t[^>]*>([^<]*)<\/w:t>/g;
    const texts = [];
    let m;
    while ((m = re.exec(xml)) !== null) {
      if (m[1].trim()) texts.push(m[1]);
    }
    return texts.join('\n');
  }

  async function parseDoc(file) {
    // .doc 二进制格式:尝试提取可读 ASCII
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let ascii = '';
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      if (b >= 0x20 && b <= 0x7e) ascii += String.fromCharCode(b);
      else if (b === 0x0a || b === 0x0d) ascii += '\n';
    }
    // .doc 通常需要用 WPS 转 .docx 后再解析,这里做粗略提取
    const chineseRe = /[\u4e00-\u9fa5]{3,}/g;
    const lines = ascii.split('\n');
    const out = [];
    for (const line of lines) {
      // 保留含中文的行 + 部分长 ASCII 行
      if (chineseRe.test(line) || line.trim().length > 10) {
        out.push(line.trim());
        chineseRe.lastIndex = 0;
      }
    }
    return out.join('\n');
  }

  // ---- AI 提取信息(替换旧的 regex 提取)----
  async function aiExtractInfo(text) {
    // 1. 截断:保留前面 6000 字足够识别出题目与功能,后续跳到关键信号词位置再截 1500 字
    //    这样就算文档 100 页也能让 AI 看到中间件的功能描述
    let truncated = text.length > 8000 ? text.substring(0, 6000) : text;
    if (text.length > 8000) {
      // 中间段:找"主要功能""系统功能""设计要求"等后面 1500 字
      const midMatch = text.match(/(主要功能|系统功能|设计要求|设计内容|主要设计|功能要求|任务要求|研究内容|预期成果|主要任务)[\s\S]{0,1500}/);
      if (midMatch) truncated += '\n\n[中段]\n' + midMatch[0];
      // 结尾:最后 800 字
      truncated += '\n\n[结尾]\n' + text.substring(text.length - 800);
    }

    const sys = '你是单片机开题报告/任务书分析助手。' +
      '\n\n任务:阅读用户提供的开题报告/任务书原文,提取三件事:' +
      '\n1. **题目**(项目名称,可能表述为"项目名称""设计题目""论文题目""课题名称"等)。' +
      '\n2. **功能**(项目要实现的具体功能,一条一行,**可以是抽象的功能描述,不必包含具体型号**)。' +
      '\n3. **器件**(文档中明确提到的具体型号,例如 STM32F103C8T6、DHT11、HC-SR501、ESP-01S 等;若文档没有明确型号则返回空数组)。' +
      '\n\n**严格只输出 JSON 对象**(不要任何 markdown 包裹、不要任何说明文字、不要任何开场白):\n' +
      '{"topic":"<题目,空字符串表示未识别>","funcs":["<功能 1>","<功能 2>",...],"devices":["<型号 1>","<型号 2>",...]}' +
      '\n\n功能写法(关键):' +
      '\n- 一条一个具体动作,不要带"1."、"(1)"这类编号' +
      '\n- **功能描述中不一定包含具体型号**——可以写抽象动作,如:' +
      '\n  ✅ "系统支持温度阈值设定与报警"' +
      '\n  ✅ "实现手动/自动模式切换"' +
      '\n  ✅ "上位机可远程控制设备开关"' +
      '\n  ✅ "使用 DS18B20 实时采集水温"' +
      '\n  抽象动作和带型号的动作都是合法功能,都要提取。' +
      '\n- 20-50 字为宜,自然语言描述' +
      '\n- 只写"要求实现什么",不要写"本文将""本研究"' +
      '\n- 不超过 15 条,超出的不要' +
      '\n- 全部都是项目功能;背景、需求、绪论、现状、参考这些都不要' +
      '\n\n❌ **下面这些不是功能,不要提取**(它们是开发流程、文档结构或元描述):' +
      '\n- 开发流程类:电路设计、硬件设计、硬件搭建、原理图设计、PCB 设计、程序设计、程序编写、代码编写、代码调试、' +
      '\n  软件编程、系统调试、联调、整体联调、系统联调、系统测试、稳定性优化、性能优化、功能测试、单元测试、' +
      '\n  焊接、装配、组装、布线、接线、元件选型、器件选型、结构设计、外壳设计' +
      '\n- 文档结构类:摘要、绪论、引言、总结、展望、参考文献、附录、目录、章节标题' +
      '\n- 元描述类:本文将、本研究、该项目、本设计采用、本系统由...组成、研究意义、研究背景、需求分析、' +
      '\n  总体方案、方案论证、技术路线、进度安排、预期成果、关键问题、创新点' +
      '\n- 研究阶段类:第一阶段、第二阶段、第三阶段、初步设计、详细设计、需求阶段、设计阶段、实现阶段、测试阶段、验收阶段' +
      '\n\n器件写法:' +
      '\n- 只要文档**明确写出来的型号**(STM32F103C8T6、DHT11、MQ-5 之类)' +
      '\n- 不要写抽象名("单片机""温度传感器"不算)' +
      '\n- 文档没明确型号就返回 []' +
      '\n- 最多 20 个';

    const userMsg = '请分析以下开题报告/任务书内容,提取题目/功能/器件。\n\n```\n' + truncated + '\n```';

    const raw = await ApiClient.chat({
      systemPrompt: sys,
      userMessage: userMsg,
      temperature: 0.2,
    });

    // 解析 JSON
    let json = null;
    try {
      // 尝试直接 parse
      const direct = raw.match(/\{[\s\S]*\}/);
      if (direct) json = JSON.parse(direct[0]);
    } catch (e) {
      console.error('JSON parse error:', e, raw);
    }

    if (!json) {
      console.warn('AI 返回无法解析为 JSON:', raw);
      return { topic: '', funcs: [], devices: [], raw: text };
    }

    return {
      topic: (json.topic || '').toString().trim(),
      funcs: Array.isArray(json.funcs) ? json.funcs.map(f => String(f).trim()).filter(f => f.length >= 5 && f.length <= 100) : [],
      devices: Array.isArray(json.devices) ? json.devices.map(d => String(d).trim()).filter(d => d.length >= 2) : [],
      raw: text,
    };
  }

  function renderExtracted(info) {
    let html = '';
    if (info.funcs.length > 0) {
      // 检查哪些功能不含型号（模糊功能）
      const modelLikePattern = /[A-Z]{2,}[\-\d]*[A-Z]?|\d{2,}|STM32|ESP|MQ|DS\d|DHT|SR\d|HC-|SW-|HX|TB|LM|AM|SG90|LD2410|RC522|AS608|MAX\d|TFT|OLED|LCD|SSD|NEO|TP508|SIM\d|NRF\d|ITR\d|GL\d|TCS\d|GP2Y|S12SD|PulseSensor|JQ|ASRPRO|TS-|ZJ-|ACS\d|TDS/i;
      const typedCount = info.funcs.filter(f => modelLikePattern.test(f)).length;
      const vagueCount = info.funcs.length - typedCount;

      html += `<h4>📋 识别到 ${info.funcs.length} 项功能</h4><ul>`;
      info.funcs.forEach(f => { html += `<li>${escapeHtml(f)}</li>`; });
      html += `</ul>`;
      if (vagueCount > 0) {
        html += `<p style="color: var(--text-muted); font-size: 12px; margin-top: 4px;">` +
                `💡 其中 ${vagueCount} 项不含具体型号，生成方案时会<strong>从器件库自动补全</strong></p>`;
      }
    } else {
      html += `<h4>⚠️ 未识别出明确功能</h4><p style="color: var(--text-muted);">将在描述中补充,或点生成让 AI 推断</p>`;
    }
    if (info.devices && info.devices.length > 0) {
      html += `<h4 style="margin-top: 12px;">🔧 识别到 ${info.devices.length} 个明确型号</h4>`;
      html += `<p style="color: var(--text-muted); font-size: 13px;">${info.devices.map(escapeHtml).join('、')}</p>`;
    } else {
      html += `<h4 style="margin-top: 12px;">🔧 未识别出明确型号</h4>`;
      html += `<p style="color: var(--text-muted); font-size: 12px;">器件会从库中自动补全（面向学生、主流型号）</p>`;
    }
    html += `<h4 style="margin-top: 12px;">📝 文档原文</h4><p style="color: var(--text-muted);">${info.raw.length} 字</p>`;
    extractedContent.innerHTML = html;
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // ---- 生成按钮 ----
  tbGenerateBtn.addEventListener('click', async () => {
    const topic = tbTopic.value.trim();
    if (!topic) {
      showToast('❌ 请先填题目', 'error');
      return;
    }
    if (!currentExtracted) {
      showToast('❌ 请先上传文件', 'error');
      return;
    }

    const description = tbDesc ? tbDesc.value.trim() : '';

    tbGenerateBtn.disabled = true;
    const originalText = tbGenerateBtn.innerHTML;
    tbGenerateBtn.textContent = '⏳ 生成中...';
    if (window.setLoadingOverlay) window.setLoadingOverlay(true, { title: '生成开题方案...' });

    try {
      const ext = currentExtracted;
      const prompt = buildTaskbookPrompt(topic, ext, description);

      const systemPrompt = '你是单片机方案设计助手。**只输出最终结果**(题目 + 器件 + 功能),**不要任何其他内容**(无开场白、无思考、无元信息、无总结)。\n\n' +
        (typeof window.deviceLibraryText === 'string' && window.deviceLibraryText
          ? '## 器件库参考\n' + window.deviceLibraryText + '\n\n'
          : '') +
        '## 学生项目"从简"原则\n' +
        '- 不推 4G/SIM7600(贵)→ 默认用 ESP-01S WiFi(除非用户描述明确指定 4G)\n' +
        '- 不推毫米波 LD2410 → 默认用 HC-SR501 红外(¥3-5)\n' +
        '- 不推 MPU6050 → 默认用 SW-520D 倾斜开关(¥0.3-1)\n' +
        '- 不推 AS608/Max30102/TCS34725 → 用库里简单替代\n' +
        '- 不推 TB6612/L298N → 默认用 5V 继电器\n' +
        '- 能少一个硬件就少一个\n\n' +
        '## 关键规则\n' +
        '- 用户描述中的内容优先级最高(指定型号必须原样采用,不替换)\n' +
        '- 只输出最终方案(题目 + 器件 + 功能),无开场白、无思考、无元信息、无总结';

      const result = await ApiClient.chat({
        systemPrompt: systemPrompt,
        userMessage: prompt
      });

      if (window.showOutput) {
        tbLastResult = result;
        // ❗ 不再自动保存到 shared。
        // 仅在本地暂存，用户点「下一步」时才写入共享数据
        const cleaned = (window.stripThinking || (m => m))(result);
        tbLastResultCleaned = cleaned;
        tbLastTopic = document.getElementById('tb-topic').value.trim();
        window.showOutput(result, 'taskbook');
      } else {
        alert('生成成功!长度 ' + (result && result.length || 0) + ' 字');
      }
      // 显示下一步按钮
      const tbNextBar = document.getElementById('tb-next-step-bar');
      if (tbNextBar) {
        tbNextBar.style.display = 'flex';
        const label = tbNextBar.querySelector('.next-step-label');
        if (label) label.innerHTML = '✅ 方案已生成 · <strong>点下一步保存到共享数据</strong>';
      }
      showToast('✓ 方案生成成功', 'success');
    } catch (err) {
      console.error(err);
      showToast('❌ 生成失败:' + err.message, 'error');
    } finally {
      tbGenerateBtn.disabled = false;
      tbGenerateBtn.innerHTML = originalText;
      if (window.setLoadingOverlay) window.setLoadingOverlay(false);
    }
  });

  function buildTaskbookPrompt(topic, ext, description) {
    let p = '# 任务\n根据以下开题报告/任务书原文和 AI 提取的信息,生成单片机项目方案。\n\n';
    p += '**只输出最终结果**(题目 + 器件 + 功能),**不要任何其他内容**(无开场白、无思考、无元信息、无总结)。\n\n';
    p += '## 题目\n' + topic + '\n\n';

    // 如果提取出了明确型号,优先采用
    if (ext.devices && ext.devices.length > 0) {
      p += '## ⚠️ 文档中明确指定的器件型号(必须原样采用,不得替换或删除)\n';
      ext.devices.forEach(d => { p += '- ' + d + '\n'; });
      p += '\n';
    }

    if (description && description.trim()) {
      p += '## ⚡ 用户补充描述(最高优先权,必须严格遵守)\n';
      p += description.trim() + '\n\n';
      p += '> ⚠️ 描述中提及的所有器件/型号/参数都必须原样采用,\n';
      p += '> 不得替换(如描述说"用 4G 模块"就用 4G,不能换 ESP-01S)。\n\n';
    }

    if (ext.funcs.length > 0) {
      p += '## 文档中要求的功能(必须全部实现,不多不少)\n';
      ext.funcs.forEach((f, i) => { p += (i + 1) + '. ' + f + '\n'; });
      p += '\n';
      p += '> ⚠️ 以上功能中可能没有具体型号(如"阈值设定"、"模式切换"、"远程控制")。\n';
      p += '> 你需要在生成的方案中,为每条功能**补充对应的具体器件型号**(从下方元器件库选)。\n';
      p += '> 例如"阈值设定"→ 需要按钮调阈值 / OLED 显示当前阈值 / 蜂鸣器超限报警。\n\n';
    }

    p += '## 输出格式(严格遵守)\n\n';
    p += '用以下 markdown 一级标题输出(`# ` 是标题符号,不是编号):\n\n';
    p += '```\n';
    p += '# <题目>\n';
    p += '\n';
    p += '**器件**:<型号>(<角色>),<型号>(<角色>),...\n';
    p += '\n';
    p += '**功能**:\n';
    p += '- [ ] <功能 1>\n';
    p += '- [ ] <功能 2>\n';
    p += '```\n\n';
    p += '### 格式要求\n';
    p += '- 题目用 `# <题目>` 一级标题开头,不加副标题\n';
    p += '- 器件用 `**器件**:` 加粗 + 单行逗号分隔,格式 `型号(角色)`(不写"传感器""模块""显示屏"后缀,不写引脚/GPIO,不分组)\n';
    p += '- 功能用 `**功能**:` 加粗 + `- [ ]` 列表,每条一句一个动作,20-50 字,自然顺口("使用 XXX 实时 XXX")\n';
    p += '- 数量:原文要求几条就写几条,不凑数也不少写\n\n';
    p += '### 严格禁止\n';
    p += '- ❌ 不要任何开场白(不要"以下是"、"我帮你"、"根据你的需求")\n';
    p += '- ❌ 不要思考过程(不要 <think>、不要"我需要考虑..."、"Combine into logical features"、"Functions needed")\n';
    p += '- ❌ 不要元信息(不要"依据"、"参考文献"、"设计原则")\n';
    p += '- ❌ 不要总结(不要 "That\'s N features"、"Perfect"、"Done")\n';
    p += '- ❌ **不要用编号列表**(不要"1. 题目"、"2. 器件"、"3. 功能"--要用 `# 题目` `# 器件` `# 功能` 标题)\n';
    p += '- 直接输出三个一级标题 + 内容,其他一切不要\n\n';

    p += '## 学生项目“从简”原则（默认选型，描述优先）\n';
    p += '- 不推 4G/SIM7600（贵/要 SIM 卡）→ 默认用 ESP-01S WiFi（描述明确说用 4G 除外）\n';
    p += '- 不推毫米波 LD2410 → 默认用 HC-SR501 红外（¥3-5）\n';
    p += '- 不推 MPU6050 → 默认用 SW-520D 倾斜开关（¥0.3-1）\n';
    p += '- 不推 AS608/Max30102/TCS34725 → 用库里简单替代\n';
    p += '- 不推 TB6612/L298N → 默认用 5V 继电器\n';
    p += '- 能少一个硬件就少一个\n\n';

    p += '## 元器件库（器件选用参考）\n';
    p += (window.deviceLibraryText || '详见独立器件库') + '\n\n';

    // 附上原文文档（供 AI 必要时补查上下文）
    if (ext.raw && ext.raw.length > 0) {
      const docText = ext.raw.length > 6000
        ? ext.raw.substring(0, 4000) + '\n... [省略中间] ...\n' + ext.raw.substring(ext.raw.length - 1500)
        : ext.raw;
      p += '## 开题报告/任务书原文（参考用，无需总结）\n';
      p += '```\n' + docText + '\n```\n';
    }

    return p;
  }

  function showToast(msg, type) {
    if (window.showToast) window.showToast(msg, type);
    else alert(msg);
  }
})();