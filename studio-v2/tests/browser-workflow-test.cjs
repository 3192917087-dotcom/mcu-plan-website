// Run with Playwright available via NODE_PATH or PLAYWRIGHT_MODULE.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fixtures = path.join(__dirname, 'fixtures', 'program-files');
const url = 'http://127.0.0.1:8765/studio-v2/';

function schematic(name, text) {
  const stream = `BT /F1 12 Tf 50 700 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let result = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => {
    const offset = Buffer.byteLength(result);
    result += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = Buffer.byteLength(result);
  result += `xref\n0 6\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return {name, mimeType:'application/pdf', buffer:Buffer.from(result)};
}

async function storedProject(page) {
  return page.evaluate(async () => {
    const store = await import('./storage.js?v=20261118-1');
    return store.getProject(store.getActiveProjectId());
  });
}
async function hasText(page, selector, text) {
  await page.waitForFunction(({ selector, text }) => document.querySelector(selector)?.textContent.includes(text), { selector, text });
}
async function saved(page) {
  await page.waitForFunction(() => document.querySelector('#project-save-status')?.dataset.state === 'saved');
}
async function newProject(page, name) {
  await page.locator('#btn-new-project').click();
  await page.locator('#new-project-name').fill(name);
  await page.locator('#new-project-form button[type="submit"]').click();
  await hasText(page, '#active-project-select', name);
  await saved(page);
}
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  let checks = 0;
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    let paidApiCalls = 0;
    await context.route('**/*', route => {
      if (route.request().method() === 'POST') { paidApiCalls++; return route.abort(); }
      return route.continue();
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url + '#projects');
    await newProject(page, '资料导入检查 A');
    const projectA = (await storedProject(page)).id;
    await page.locator('#paper-advanced-section > summary').click();

    // Real disk paths in two different folders, with the native input confirmed twice.
    await page.locator('#paper-code-folder').setInputFiles(path.join(fixtures, '主板', 'main.c'));
    await hasText(page, '#code-file-summary', '1 个');
    await page.locator('#paper-code-folder').setInputFiles(path.join(fixtures, '从板', 'main.c'));
    await hasText(page, '#code-file-summary', '2 个');
    assert.equal((await storedProject(page)).paper.materials.codeFiles.length, 2);
    checks++;

    // Only one entry remains; it still supports multiselect and later additions.
    assert.equal(await page.locator('#paper-code-directory, #program-picker-dialog, #paper-code-group').count(), 0);
    assert.equal(await page.locator('label[for="paper-code-folder"]').count(), 1);
    await page.locator('#paper-code-folder').setInputFiles([path.join(fixtures, '主板', 'config.h'), path.join(fixtures, '从板', 'config.h')]);
    await hasText(page, '#code-file-summary', '4 个');
    await page.locator('#paper-code-folder').setInputFiles(path.join(fixtures, '主板', 'main.c'));
    await hasText(page, '#code-import-status', '跳过 1');
    assert.equal((await storedProject(page)).paper.materials.codeFiles.length, 4);
    checks++;

    await page.locator('#code-file-search').fill('main');
    assert.equal(await page.locator('#code-file-list [data-remove-code-file]').count(), 2);
    assert.equal((await storedProject(page)).paper.materials.codeFiles.length, 4);
    await page.locator('#code-file-search').fill('');
    await hasText(page, '#paper-materials-summary', '程序 4 份');
    checks++;

    // Schematics follow the same append semantics, including identical names.
    await page.locator('#paper-schematic-file').setInputFiles(schematic('电路.pdf', 'MAIN PA0'));
    await hasText(page, '#schematic-file-summary', '1 份');
    await page.locator('#paper-schematic-file').setInputFiles(schematic('电路.pdf', 'SLAVE D2'));
    await hasText(page, '#schematic-file-summary', '2 份');
    await page.locator('#paper-schematic-file').setInputFiles(schematic('电路.pdf', 'SLAVE D2'));
    await hasText(page, '#schematic-import-status', '跳过 1');
    assert.equal((await storedProject(page)).paper.materials.schematicFiles.length, 2);
    checks++;

    // A queued edit must be saved to A before creating B, then loaded from the database.
    await page.locator('#paper-title-input').fill('A项目最后一刻的题目');
    await page.locator('[data-route="projects"]').first().click();
    await newProject(page, '资料导入检查 B');
    const projectB = (await storedProject(page)).id;
    await page.locator('#active-project-select').selectOption(projectA);
    await hasText(page, '#code-file-summary', '4 个');
    assert.equal(await page.locator('#paper-title-input').inputValue(), 'A项目最后一刻的题目');
    await saved(page);
    await page.reload();
    await hasText(page, '#code-file-summary', '4 个');
    await hasText(page, '#schematic-file-summary', '2 份');
    checks++;

    // Verify data and controls on both wide and narrow screens.
    if (!(await page.locator('#paper-advanced-section').evaluate(el => el.open))) await page.locator('#paper-advanced-section > summary').click();
    await page.locator('label[for="paper-code-folder"]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(__dirname, 'output', 'materials-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('label[for="paper-code-folder"]').scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(__dirname, 'output', 'materials-mobile.png') });
    await page.setViewportSize({ width: 1440, height: 1000 });
    checks++;

    // Two tabs holding A: the older one cannot silently overwrite newly saved attachments.
    await saved(page);
    const second = await context.newPage();
    await second.goto(url + '#paper');
    await saved(second);
    await second.locator('#paper-title-input').fill('另一页面保存的新题目');
    await saved(second);
    await page.locator('#paper-title-input').fill('旧页面的修改不能覆盖新资料');
    await page.waitForFunction(() => document.querySelector('#project-save-status').dataset.state === 'error');
    await hasText(page, '#project-save-status', '另一页面');
    assert.equal((await storedProject(second)).title, '另一页面保存的新题目');
    assert.equal((await storedProject(second)).paper.materials.codeFiles.length, 4);
    assert.equal(await page.locator('#btn-backup-unsaved').isVisible(), true);
    checks++;

    // Working data may be exported even when the browser cannot save it.
    const download = page.waitForEvent('download');
    await page.locator('#btn-backup-unsaved').click();
    assert.ok((await download).suggestedFilename().endsWith('.json'));
    checks++;

    // Other project state must remain independent.
    const b = await second.evaluate(async id => (await import('./storage.js?v=20261118-1')).getProject(id), projectB);
    assert.equal(b.paper.materials.codeFiles.length, 0);
    assert.deepEqual(errors, []);
    assert.equal(paidApiCalls, 0);

    // A newer deployment is made visible without replacing unsaved page data.
    const updatePage = await context.newPage();
    await updatePage.route('**/build-info.json?*', route => route.fulfill({json:{version:'future-test-version'}}));
    await updatePage.goto(url + '#paper');
    await updatePage.locator('#update-notice').waitFor({state:'visible'});
    await hasText(updatePage, '#btn-update-app', '保存并更新');
    checks++;
    console.log(JSON.stringify({ status: 'passed', checks, paidApiCalls, browser: 'Edge', projectIsolation: true }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
