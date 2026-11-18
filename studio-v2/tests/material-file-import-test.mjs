import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { appendMaterialFiles, programFilePath } from '../material-files.js';

const source = await fs.readFile(new URL('../app.js', import.meta.url), 'utf8');
function extract(name, next) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(next, start + 1);
  assert.ok(start >= 0 && end > start, name);
  return source.slice(source.slice(0, start).endsWith('async ') ? start - 6 : start, end);
}
function fixture() {
  const nodes = new Map();
  const project = { paper: { materials: { codeFiles: [], schematicFiles: [] }, factSheet: { analyzedAt: 'yes' } } };
  const notices = [];
  const ctx = vm.createContext({ project, appendMaterialFiles, programFilePath, nodes, notices, materialImportTasks: new Set(),
    projectWorkBlocked: () => '', setMaterialImportStatus: () => {}, renderMaterialSummary: () => {},
    $: id => { if (!nodes.has(id)) nodes.set(id, { textContent: '', innerHTML: '' }); return nodes.get(id); },
    MAX_PROGRAM_FILE_BYTES: 2 * 1024 * 1024, MAX_PROGRAM_TOTAL_CHARS: 240000,
    PROGRAM_FILE_EXTENSIONS: new Set(['c', 'h', 'ino']),
    bumpFactRevision: () => {}, resetHardwareAnalysis: () => {}, persistProject: async () => {},
    toast: (message, type) => notices.push({ message, type }),
    escapeHtml: text => String(text),
    sanitizeTechnicalText: text => String(text),
    extractSchematicRecord: async file => {
      if (file.fail) throw new Error('PDF不可读');
      return { name: file.name, text: file.content, pageCount: 1 };
    },
  });
  for (const [name, next] of [
    ['programFileExtension', 'function supportedProgramFile'],
    ['supportedProgramFile', 'function rebuildProgramCodeText'],
    ['rebuildProgramCodeText', 'async function readCodeFiles'],
    ['readCodeFiles', 'function removeCodeFile'],
    ['removeCodeFile', 'function renderCodeFileList'],
    ['renderCodeFileList', 'function setMaterialImportStatus'],
    ['readSchematicFile', 'function schematicFileRecords'],
    ['schematicFileRecords', 'function rebuildSchematicText'],
    ['rebuildSchematicText', 'function renderSchematicFileList'],
    ['renderSchematicFileList', 'function removeSchematicFile'],
    ['removeSchematicFile', 'function deviceFromLine'],
    ['readSchemeSourceFile', 'function captureSchemeSourceText'],
    ['readSourceDocumentFile', 'function clearSourceDocument'],
  ]) vm.runInContext(extract(name, next), ctx);
  return { ctx, project, nodes, notices };
}
const file = (name, content) => ({ name, size: content.length, text: async () => content });
const event = files => ({ target: { files, value: 'selected', disabled: false } });
let scenarios = 0;

// Matching browser basenames must never overwrite distinct board programs.
{
  const selected = { name: 'main.c', webkitRelativePath: '工程/Core/Src/main.c' };
  assert.equal(programFilePath(selected), '工程/Core/Src/main.c');
  assert.equal(programFilePath(selected, '主板'), '主板/Core/Src/main.c');
  assert.equal(programFilePath({ name: 'main.c' }, '从板'), '从板/main.c');
  const records = ['主板', '从板'].map(group => ({ path: programFilePath({name:'main.c'}, group), group, content: 'SAME SHARED SOURCE' }));
  assert.equal(appendMaterialFiles([], records).files.length, 2, 'shared code in different boards must remain assigned to both');
  scenarios++;
}
{
  const existing = [{ name: 'main.c', path: 'main.c', content: 'MAIN' }];
  const merged = appendMaterialFiles(existing, [{ name: 'main.c', path: 'main.c', content: 'SLAVE' }]);
  assert.equal(merged.files.length, 2);
  assert.equal(merged.files[0].content, 'MAIN');
  assert.equal(merged.files[1].path, 'main（2）.c');
  assert.equal(existing.length, 1, 'do not mutate saved list');
  const afterReload = JSON.parse(JSON.stringify(merged.files));
  assert.equal(appendMaterialFiles(afterReload, [{ name: 'main.c', path: 'main.c', content: 'SLAVE' }]).duplicates, 1);
  scenarios++;
}
{
  const { ctx, project, nodes } = fixture();
  ctx.e = event([file('main.c', 'MAIN')]);
  await vm.runInContext('readCodeFiles(e)', ctx);
  ctx.e = event([file('main.c', 'SLAVE')]);
  await vm.runInContext('readCodeFiles(e)', ctx);
  assert.equal(project.paper.materials.codeFiles.length, 2);
  assert.match(nodes.get('code-file-summary').textContent, /2 个/);
  assert.match(project.paper.materials.codeText, /MAIN/);
  assert.match(project.paper.materials.codeText, /SLAVE/);
  assert.equal(ctx.e.target.disabled, false);
  await vm.runInContext('readCodeFiles(e)', ctx);
  assert.equal(project.paper.materials.codeFiles.length, 2, 'repeat selection deduplicates');
  vm.runInContext('removeCodeFile("main（2）.c")', ctx);
  assert.equal(project.paper.materials.codeFiles.length, 1);
  assert.doesNotMatch(project.paper.materials.codeText, /SLAVE/);
  scenarios++;
}
// Batched imports keep readable files when another selected file fails.
{
  const { ctx, project, notices } = fixture();
  ctx.e = event([file('ok.c', 'OK'), { name: 'broken.h', size: 1, text: async () => { throw new Error('not readable'); } }]);
  await vm.runInContext('readCodeFiles(e)', ctx);
  assert.equal(project.paper.materials.codeFiles.length, 1);
  assert.equal(notices.at(-1).type, 'error');
  assert.match(notices.at(-1).message, /broken.h/);
  assert.equal(ctx.e.target.disabled, false);
  scenarios++;
}
{
  const { ctx, project, nodes, notices } = fixture();
  for (const [name, content] of [['主板.pdf', 'MAIN PA0'], ['从板.pdf', 'SLAVE D2'], ['从板.pdf', 'SLAVE D2'], ['从板.pdf', 'OTHER D3']]) {
    ctx.e = event([{ name, content }]);
    await vm.runInContext('readSchematicFile(e)', ctx);
  }
  assert.equal(project.paper.materials.schematicFiles.length, 3);
  assert.match(nodes.get('schematic-file-summary').textContent, /3 份/);
  assert.match(nodes.get('schematic-file-list').innerHTML, /从板（2）.pdf/);
  assert.match(project.paper.materials.schematicText, /MAIN PA0/);
  assert.match(project.paper.materials.schematicText, /SLAVE D2/);
  ctx.e = event([{ name: '坏图.pdf', fail: true }, { name: '扩展板.pdf', content: 'EXPANSION' }]);
  await vm.runInContext('readSchematicFile(e)', ctx);
  assert.equal(project.paper.materials.schematicFiles.length, 4);
  assert.match(notices.at(-1).message, /坏图.pdf/);
  assert.equal(ctx.e.target.disabled, false);
  vm.runInContext('removeSchematicFile("从板.pdf")', ctx);
  assert.equal(project.paper.materials.schematicFiles.length, 3);
  assert.doesNotMatch(project.paper.materials.schematicText, /SLAVE D2/);
  assert.match(project.paper.materials.schematicText, /OTHER D3/);
  for (const name of ['主板.pdf', '从板（2）.pdf', '扩展板.pdf']) {
    ctx.name = name;
    vm.runInContext('removeSchematicFile(name)', ctx);
  }
  assert.equal(project.paper.materials.schematicFilename, '');
  assert.equal(project.paper.materials.schematicText, '');
  scenarios++;
}
// A legacy single-PDF project is not lost on its first appended attachment.
{
  const { ctx, project } = fixture();
  Object.assign(project.paper.materials, { schematicFiles: [], schematicFilename: '旧图.pdf', schematicText: 'OLD' });
  ctx.e = event([{ name: '新图.pdf', content: 'NEW' }]);
  await vm.runInContext('readSchematicFile(e)', ctx);
  assert.equal(project.paper.materials.schematicFiles.length, 2);
  assert.match(project.paper.materials.schematicText, /OLD/);
  scenarios++;
}
// Changing projects while file reading is pending must not import into the next project.
{
  const { ctx, project } = fixture();
  let finish;
  ctx.e = event([{ name: 'main.c', size: 1, text: () => new Promise(resolve => { finish = resolve; }) }]);
  const pending = vm.runInContext('readCodeFiles(e)', ctx);
  ctx.project = { paper: { materials: { codeFiles: [] } } };
  finish('MAIN');
  await pending;
  assert.equal(project.paper.materials.codeFiles.length, 0);
  assert.equal(ctx.project.paper.materials.codeFiles.length, 0);
  assert.equal(ctx.e.target.disabled, false);
  scenarios++;
}
for (const name of ['readSchemeSourceFile', 'readSourceDocumentFile']) {
  const { ctx, project } = fixture();
  let finish;
  ctx.e = event([{name:'资料.txt', text:() => new Promise(resolve => { finish = resolve; })}]);
  const pending = vm.runInContext(`${name}(e)`, ctx);
  assert.equal(ctx.materialImportTasks.size, 1);
  ctx.project = { paper: { materials: {} } };
  finish('BACKGROUND');
  await pending;
  assert.equal(ctx.materialImportTasks.size, 0);
  assert.equal(project.paper.materials.sourceDocumentText, undefined);
  assert.equal(ctx.project.paper.materials.schemeRawText, undefined);
  assert.equal(ctx.project.paper.materials.sourceDocumentText, undefined);
  scenarios++;
}
console.log(JSON.stringify({ result: 'passed', scenarios, paidApiCalls: 0 }));
