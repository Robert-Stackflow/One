const {_electron: electron, expect} = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
async function renderedFonts(page, selector) {
  await page.waitForFunction(() => document.documentElement.dataset.fontStatus === 'ready');
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('DOM.enable'); await session.send('CSS.enable');
    const {root} = await session.send('DOM.getDocument');
    const {nodeId} = await session.send('DOM.querySelector', {nodeId: root.nodeId, selector});
    return (await session.send('CSS.getPlatformFontsForNode', {nodeId})).fonts;
  } finally {await session.detach();}
}
async function run() {
  const output = path.resolve(process.env.ONE_TEST_OUTPUT_DIR||'work/fonts-smoke'); await fs.mkdir(output, {recursive: true});
  const profile = await fs.mkdtemp(path.join(output, 'profile-'));
  const env = {...process.env, ONE_TEST_MODE: '1', ONE_DATA_DIR: profile}; delete env.ELECTRON_RUN_AS_NODE;
  const launch = () => electron.launch(process.env.ONE_PACKAGED_EXE ? {executablePath: process.env.ONE_PACKAGED_EXE, args: [], env} : {args: [path.resolve('.')], env});
  let app = await launch();
  const errors = [];
  try {
    let page = await app.firstWindow(); page.on('pageerror', e => errors.push(String(e)));
    await page.waitForSelector('[data-page=text]');await page.locator('[data-page=text]').click();await page.waitForSelector('#source'); await page.locator('[data-page=settings]').click();await page.locator('[data-settings-tab=appearance]').click();
    const fonts = await page.evaluate(() => window.one.installedFonts()); assert.ok(fonts.length > 20);
    assert.equal(new Set(fonts.map(f => f.family.toLowerCase())).size, fonts.length);
    const chinese = fonts.find(f => f.family === 'Microsoft YaHei') || fonts.find(f => f.aliases.some(a => /[\u3400-\u9fff]/.test(a)));
    const wenkai = fonts.find(f => f.family === 'LXGW WenKai');
    const chosen = wenkai || chinese || fonts.find(f => f.family === 'Consolas'); assert.ok(chosen);
    await page.locator('#appearance-font').click();
    const search = page.locator('#appearance-font-search'); await expect(search).toBeFocused();
    if (chinese) {await search.fill(chinese.aliases.find(a => /[\u3400-\u9fff]/.test(a)) || chinese.label); await expect(page.getByRole('option', {name: chinese.label, exact: true})).toBeVisible();}
    await search.fill(chosen.family); await expect(page.getByRole('option', {name: chosen.label, exact: true})).toBeVisible();
    await page.getByRole('option', {name: chosen.label, exact: true}).hover();
    assert.ok((await page.locator('.font-sample').evaluate(e => getComputedStyle(e).fontFamily)).includes(chosen.family));
    await page.screenshot({path: path.join(output, 'font-search.png'), animations: 'disabled'});
    await search.press('Enter'); await expect(page.locator('.font-popup')).toHaveCount(0);
    assert.ok((await page.evaluate(() => document.documentElement.style.getPropertyValue('--ui-font'))).includes(chosen.family));
    await expect.poll(()=>page.evaluate(async()=>JSON.stringify((await window.one.settings()).appearance))).toBe(await page.evaluate(async()=>JSON.stringify(await window.one.appearance())));
    await expect.poll(() => page.evaluate(() => window.one.appearance().then(a => a.font))).toBe('installed:' + chosen.family);
    const actual = await renderedFonts(page, '#page-name');
    assert.ok(actual.some(f => f.familyName === chosen.family && f.glyphCount > 0), JSON.stringify(actual));
    if(wenkai) assert.ok(actual.some(f => f.postScriptName === 'LXGWWenKai-Regular' && f.isCustomFont));
    await page.locator('#appearance-font').click(); await page.getByRole('button', {name: '刷新字体列表'}).click(); await expect(page.getByRole('button', {name: '刷新字体列表'})).toBeEnabled();
    await page.locator('#appearance-font-search').fill('no-font-match-892379'); await expect(page.locator('.font-empty')).toHaveText('没有匹配的字体');
    await page.locator('#appearance-font-search').press('Escape'); await expect(page.locator('#appearance-font')).toBeFocused();
    const sample = path.join(output, '中文字体预览.txt'); await fs.writeFile(sample, '字体设置检查');
    const opened = app.waitForEvent('window'); await page.evaluate(p => window.one.preview(p), sample); const preview = await opened;
    await expect.poll(() => preview.evaluate(() => document.documentElement.style.getPropertyValue('--ui-font'))).toContain(chosen.family);
    const previewFonts = await renderedFonts(preview, '#preview-name');
    assert.ok(previewFonts.some(f => f.familyName === chosen.family && f.glyphCount >= 6), JSON.stringify(previewFonts));
    await preview.close();
    await app.close(); app = await launch(); page = await app.firstWindow(); page.on('pageerror', e => errors.push(String(e)));
    await page.waitForSelector('[data-page=text]');await page.locator('[data-page=text]').click();await page.waitForSelector('#source'); await page.locator('[data-page=settings]').click();await page.locator('[data-settings-tab=appearance]').click();
    await expect.poll(() => page.locator('#appearance-font').evaluate(e => e.value)).toBe('installed:' + chosen.family);
    const restartedFonts = await renderedFonts(page, '#page-name');
    assert.ok(restartedFonts.some(f => f.familyName === chosen.family && f.glyphCount > 0));
    await page.locator('#appearance-font').click(); await page.locator('#appearance-font-search').fill(chosen.family);
    await expect(page.getByRole('option', {name: chosen.label, exact: true})).toHaveAttribute('aria-selected', 'true');
    await page.locator('#appearance-font-search').press('Escape');
    await page.locator('[data-mode=dark]').click(); await page.locator('#appearance-font').click(); await page.locator('#appearance-font-search').fill(chosen.family);
    await page.screenshot({path: path.join(output, 'font-dark.png'), animations: 'disabled'}); await page.locator('#appearance-font-search').press('Escape');
    await page.evaluate(async () => {const s = await window.one.settings(); await window.one.saveSettings({...s, appearance: {...s.appearance, font: 'installed:One Missing Font 892379'}});});
    await page.reload(); await page.waitForSelector('[data-page=text]');await page.locator('[data-page=text]').click();await page.waitForSelector('#source'); await page.locator('[data-page=settings]').click();await page.locator('[data-settings-tab=appearance]').click(); await page.locator('#appearance-font').click();
    await expect(page.locator('.font-status')).toHaveText('当前字体未安装，使用系统默认字体。');
    await page.locator('#appearance-font-search').press('Escape'); await page.locator('#appearance-reset').click(); await expect.poll(()=>page.evaluate(async()=>JSON.stringify((await window.one.settings()).appearance))).toBe(await page.evaluate(async()=>JSON.stringify(await window.one.appearance())));
    await expect.poll(() => page.evaluate(() => window.one.appearance().then(a => a.font))).toBe('system');
    assert.deepEqual(errors, []);
    const result = {result: 'PASS', packaged: !!process.env.ONE_PACKAGED_EXE, families: fonts.length, selected: chosen.family, actualChineseGlyphs:actual,previewGlyphs:previewFonts,restartedGlyphs:restartedFonts, chineseSearch: !!chinese, keyboard: true, refresh: true, previewWindow: true, persistedAfterRestart: true, missingFontFallback: true, reset: true};
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
  } finally {await app.close();}
}
run().catch(error => {console.error(error); process.exitCode = 1;});
