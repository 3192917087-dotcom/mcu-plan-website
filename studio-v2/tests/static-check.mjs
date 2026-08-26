import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const prompts = await readFile(new URL('../prompts.js', import.meta.url), 'utf8');
const docx = await readFile(new URL('../docx-export.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const storage = await readFile(new URL('../storage.js', import.meta.url), 'utf8');
const referenceLibrary = await readFile(new URL('../reference-library.js', import.meta.url), 'utf8');
const pdfWorker = await readFile(new URL('../vendor/pdf.worker.min.js', import.meta.url), 'utf8');
const mockServer = await readFile(new URL('./mock-server.mjs', import.meta.url), 'utf8');
const referencedIds = [...app.matchAll(/\$\('([^']+)'\)/g)].map(match => match[1]);
const htmlIds = [...html.matchAll(/id="([^"]+)"/g)].map(match => match[1]);
const dynamicIds = new Set(['ack-ai-conflicts']);
const missing = [...new Set(referencedIds.filter(id => !htmlIds.includes(id) && !dynamicIds.has(id)))];
const duplicates = [...new Set(htmlIds.filter((id, index) => htmlIds.indexOf(id) !== index))];
const assertions = [
  ['API无内置Key', /apiKey:\s*''/.test(app) && !/PAGE_CONFIG\.apiKey/.test(app)],
  ['新建项目名称可选', /id="new-project-name"(?![^>]*required)/.test(html)],
  ['屏幕规格统一为1.8寸TFT', html.includes('1.8寸TFT') && !html.includes('2.8寸TFT')],
  ['器件分析使用快速非推��请求', /buildHardwareMessages[\s\S]{0,1200}reasoning:\s*false[\s\S]{0,300}timeoutMs:\s*100000/.test(app)],
  ['空文本与损坏JSON可自动恢复', app.includes('EMPTY_AI_CONTENT') && app.includes('parseAiJson')],
  ['摘要限定300至500字且分段', prompts.includes('300至500字') && prompts.includes('2至3个自然段')],
  ['图表之间要求实质正文', prompts.includes('任意两项视觉内容之间') && prompts.includes('图与图、图与表、表与图、表与表均不得连续出现') && app.includes('consecutiveVisualIssues')],
  ['插图占位与正文区分', prompts.includes('【非正文·插图位置：图名】') && docx.includes("name: '论文插图提示'")],
  ['引脚表不含信号方向列', prompts.includes('外设信号、主控引脚、连接说明') && prompts.includes('禁止“信号方向”列')],
  ['默认硬件规则完整', prompts.includes('最小系统开发板') && prompts.includes('10 kΩ') && prompts.includes('1.8寸')],
  ['9898中转站专用预设', app.includes('newapi9898') && app.includes('gpt-5.5') && html.includes('9898.ai 中转站（GPT）') && app.includes('https://www.9898.ai/v1')],
  ['PDF原理图读取入口', html.includes('id="paper-schematic-file"') && app.includes('extractPdfTextFallback') && prompts.includes('schematicText')],
  ['STM32F103完整I2C复用脚', /i2c_scl:\s*\['PB6','PB8','PB10'\]/.test(await readFile(new URL('../pin-data.js', import.meta.url), 'utf8')) && /i2c_sda:\s*\['PB7','PB9','PB11'\]/.test(await readFile(new URL('../pin-data.js', import.meta.url), 'utf8'))],
  ['程序文件显示具体名称', html.includes('id="code-file-list"') && app.includes('renderCodeFileList')],
  ['PDF worker已内置', html.includes('vendor/pdf.worker.min.js') && pdfWorker.includes('WorkerMessageHandler')],
  ['真实引脚优先保留', app.includes('allPins(controller)') && app.includes('真实GPIO优先保留')],
  ['原理图引脚不被误判', app.includes("source: schematicPins.has(proposed) ? 'schematic' : 'ai'") && app.includes('原理图识别')],
  ['旧版项目只迁移一次', storage.includes('LEGACY_MIGRATION_KEY') && storage.includes('hasMigratedLegacyProject') && app.includes('!Store.hasMigratedLegacyProject()')],
  ['删除最后项目清理旧版来源', app.includes('if (!projects.length) Store.clearLegacyProject()')],
  ['表格超长触发自动修复', app.includes('必须按功能或模块拆分') && prompts.includes('主动按功能、模块或测试项目拆成多张表')],
  ['公式集中在第四章', prompts.includes('formula') && app.includes('公式应放在第四章软件设计，不应放在第五章') && !prompts.includes("makeArtifact('formula', test")],
  ['第二章按器件拆分选型表', prompts.includes('选型对比表') && prompts.includes('selectionSection') && prompts.includes('每个实际器件的选型分析后分别生成该器件专用对比表')],
  ['摘要中英文分别成段', docx.includes('function abstractParagraphs') && prompts.includes('中文摘要和英文摘要都必须分为2至3个自然段')],
  ['正文引用导出为上标', docx.includes('superScript') && docx.includes('const citation')],
  ['多路继电器按对象保留', prompts.includes('多路继电器处理规则') && prompts.includes('按被控对象分别建立功能') && prompts.includes('多路继电器按被控对象分别写控制通道')],
  ['独立文献题目可清空并持久化', app.includes("standalone-reference-title', 'standalone-reference-notes'") && app.includes('standaloneReferenceState.title = event.target.value')],
  ['重复型号只建立一套器件计划', app.includes('plannedDeviceKeys') && app.includes('plannedDevices.forEach') && prompts.includes('seenDeviceModels')],
  ['励志语去除今日并偏向逆风名句', html.includes('长风破浪会有时') && !html.includes('今日</span>') && prompts.includes('逆风翻盘风格')],
  ['正文使用内置Normal样式', docx.includes("style = options.style ||") && !docx.includes("id: 'Normal',")],
  ['文献库完整导入551条', referenceLibrary.includes('count:551') && (referenceLibrary.match(/"id":"lib-/g) || []).length === 551],
  ['独立文献工具入口完整', ['view-tools', 'standalone-reference-form', 'standalone-reference-title', 'standalone-reference-count', 'standalone-reference-list', 'btn-copy-standalone-references'].every(id => html.includes(`id="${id}"`)) && app.includes("currentRoute === 'tools'")],
  ['独立文献结果可清除', html.includes('id="btn-standalone-clear-results"') && app.includes('function clearStandaloneReferenceResults') && app.includes("btn-standalone-clear-results').addEventListener")],
  ['每日励志语有本地回退并按日调用AI', html.includes('id="daily-motivation-text"') && app.includes('function refreshDailyMotivation') && app.includes('void refreshDailyMotivation()') && prompts.includes('buildDailyMotivationMessages')],
  ['励志语每十分钟刷新并横向滚动', app.includes('MOTIVATION_REFRESH_MS = 10 * 60 * 1000') && app.includes('scheduleDailyMotivationRefresh') && app.includes('restartMotivationTicker') && html.includes('daily-motivation-viewport') && styles.includes('daily-motivation-marquee')],
  ['励志语按绝对时间补更新', app.includes('function motivationRefreshDue') && app.includes('updatedAt: Date.now()') && app.includes("document.visibilityState === 'visible'") && app.includes("window.addEventListener('focus'")],
  ['励志语更新保证可见变化', app.includes('const previousText = rotateFallbackMotivation()') && app.includes('text !== previousText') && prompts.includes('avoidTexts')],
  ['重复标题与视觉内容可拦截', app.includes('function duplicateHeadingIssues') && app.includes('function duplicateVisualIssues') && app.includes('duplicate-heading-') && app.includes('duplicate-visual-')],
  ['器件图位绑定目录小节', app.includes('artifact.sectionId') && app.includes('没有放在${artifact.sectionId}对应正文之后')],
  ['质量修复失败不丢失已生成章节', app.includes('自动修复阶段暂未完成') && app.includes('保留当前稿并可下载') && app.includes('已保存已完成章节，可以继续生成或下载当前稿')],
  ['章节图表补强失败仍保存正文', app.includes('图表补强暂未完成') && app.includes('章正文已保存，图表补强稍后自动处理')],
  ['正文补写失败不阻断后续阶段', app.includes('字数补写请求未完成，继续进行摘要和检查')],
  ['论文参考文献开关与自定义篇数', html.includes('id="paper-use-references"') && html.includes('id="paper-reference-count"') && app.includes('useReferencesInPaper') && app.includes('referenceRecommendationCount')],
  ['空白文献按开关自动推荐', app.includes("project.paper.materials.useReferencesInPaper !== false && !project.paper.materials.referencesText.trim()") && app.includes("recommendReferences({ automatic: true") && app.includes("generation.phase = 'references'")],
  ['文献中外文比例固定7比3', app.includes('Math.round(total * 0.7)') && app.includes('balanceReferenceSelection') && prompts.includes('languageTargets') && prompts.includes('中外文比例固定约7:3')],
  ['用户文献优先保留并顺序编号', app.includes('const existing = referenceTextEntries(materials.referencesText)') && app.includes('existing.map((item, index) => `[${index + 1}] ${item}`)') && app.includes("keys.add(`title:${titleKey}`)")],
  ['推荐请求总会恢复按钮状态', /async function recommendReferences[\s\S]+?finally\s*\{[\s\S]+?button\.disabled = false/.test(app)],
  ['第三章不再生成重复硬件框架图', !prompts.includes("makeArtifact('hardware-block'") && app.includes('第三章不得重复生成系统硬件组成图')],
  ['引脚表按器件拆分', prompts.includes('deviceMappings') && prompts.includes('引脚连接关系表') && prompts.includes('不与其他器件合并')],
  ['每张图表固定编号且只引用一次', app.includes('FIGURE_ARTIFACT_TYPES') && app.includes('figureNumber') && app.includes('artifactFigureReferenceIssues') && prompts.includes('每张图和每张表都已给出编号') && prompts.includes('如表x-x所示')],
  ['全文图表引用台账校验', app.includes('function artifactCitationLedgerIssues') && app.includes('visual-missing-') && app.includes('visual-unknown-') && app.includes('artifactCitationLedgerIssues().forEach')],
  ['参考文献按正文首次引用重排', app.includes('function synchronizeReferenceOrder') && app.includes('firstSeen') && app.includes('{{REF_')],
  ['DOCX参考文献使用SEQ与REF交叉引用', docx.includes('NumberedItemReference') && docx.includes('referenceField') && docx.includes('SimpleField') && docx.includes('new Bookmark') && docx.includes('SEQ ThesisReference')],
  ['参考文献编号与正文同为12磅', docx.includes("bodyRun(String(number), { size: 24 })") && docx.includes("bodyRun('[', { size: 24 })") && docx.includes('citation ? 24')],
  ['流程图终止节点与复杂度受控', prompts.includes('A([开始])') && prompts.includes('最多2个判断节点') && app.includes('开始和结束必须使用圆角终止节点') && app.includes('精简到9个节点以内')],
  ['无摘要文献禁止虚构结论', prompts.includes('abstract为空') && prompts.includes('实验数据、性能提升和研究结论')],
  ['不再使用固定默认文献', !app.includes('DEFAULT_REFERENCES')],
  ['推荐候选排除出版信息不完整条目', app.includes('function referencePublicationReady') && app.includes('REFERENCE_LIBRARY.filter(referencePublicationReady)')],
  ['库内文献使用结构化出版信息', app.includes('const libraryByCitation = new Map') && app.includes("region: library.language === '中文' ? 'domestic'")],
  ['模拟服务覆盖AI文献筛选', mockServer.includes("system.includes('参考文献筛选员')") && mockServer.includes('parsed.candidateReferences')],
];
const failedAssertions = assertions.filter(([, passed]) => !passed).map(([name]) => name);

if (missing.length || duplicates.length || failedAssertions.length) {
  console.error(JSON.stringify({ missing, duplicates, failedAssertions }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ referencedIds: new Set(referencedIds).size, htmlIds: htmlIds.length, assertions: assertions.length, missing, duplicates, failedAssertions }));
}
