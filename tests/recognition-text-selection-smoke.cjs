const { _electron: electron, expect } = require('@playwright/test');
const { build } = require('esbuild');
const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');
(async () => {
  const root = path.resolve('work/current/capture-reconstruction');
  await fs.mkdir(root, { recursive: true });
  const directory = await fs.mkdtemp(path.join(root, 'text-layer-'));
  let app;
  try {
    await build({ entryPoints: ['tests/recognition/text-selection-view.ts'], outfile: path.join(directory, 'view.js'),
      bundle: true, platform: 'browser', format: 'iife', logLevel: 'warning' });
    await fs.writeFile(path.join(directory, 'index.html'), `<!doctype html><html><head><link rel="stylesheet" href="view.css"><style>
      :root{--bg:#151515;--fg:#eee;--muted:#999;--line:#444;--soft:#222}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px system-ui}section{width:100vw;height:100vh}button{color:var(--fg);background:var(--soft);border:1px solid var(--line);border-radius:6px}
      </style></head><body data-view="recognition"><section class="source-preview"><img alt="Long image fixture"></section><script src="view.js"></script></body></html>`);
    await fs.writeFile(path.join(directory, 'main.cjs'), `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(directory, 'profile'))});app.whenReady().then(()=>{const win=new BrowserWindow({width:800,height:600,show:true});win.loadFile(${JSON.stringify(path.join(directory, 'index.html'))});});`);
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({ args: [path.join(directory, 'main.cjs')], env });
    const page = await app.firstWindow(), errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.waitForFunction(() => window.fixtureReady);
    const viewport = page.locator('.text-image-viewport'), layer = page.locator('.text-selection-layer');
    await expect.poll(() => page.locator('.text-selection-unit').count()).toBeGreaterThan(0);
    const total = await page.evaluate(() => window.fixtureTokenCount);
    assert.ok(total > 30000);
    assert.ok(await page.locator('.text-selection-unit').count() < 3000);
    const first = await page.locator('.text-selection-unit[data-token="0"]').boundingBox();
    const second = await page.locator('.text-selection-unit[data-token="1"]').boundingBox();
    const before = await page.locator('.text-image-stage').evaluate(node => node.style.width);
    await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2); await page.mouse.down();
    await viewport.evaluate(async node => {
      node.style.width = '600px';
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    assert.equal(await page.locator('.text-image-stage').evaluate(node => node.style.width), before, 'active selection must retain its coordinate transform');
    await page.mouse.move(second.x + second.width / 2, second.y + second.height / 2, { steps: 3 }); await page.mouse.up();
    await page.locator('[data-text-action=copy]').click();
    await expect.poll(() => page.evaluate(() => window.fixtureCopied)).toBe('Li');
    await viewport.evaluate(node => { node.style.width = ''; });
    await viewport.focus(); await viewport.press('Control+a'); await viewport.press('Control+c');
    await expect.poll(() => page.evaluate(() => window.fixtureCopied === window.fixtureFull)).toBe(true);
    await viewport.press('Control+End');
    await expect(viewport).toHaveAttribute('data-selection-end', String(total - 1));
    await expect.poll(() => page.locator(`.text-selection-unit[data-token="${total - 1}"]`).count()).toBe(1);
    assert.ok(await page.locator('.text-selection-unit').count() < 3000);
    await page.locator('[data-text-action=rotate]').click();
    await expect.poll(() => layer.getAttribute('data-rendered-tokens')).toBe('0');
    await expect(page.locator('.text-image-status')).toContainText('请放大后选字');
    await viewport.focus(); await viewport.press('Control+a'); await viewport.press('Control+c');
    await expect.poll(() => page.evaluate(() => window.fixtureCopied === window.fixtureFull)).toBe(true);
    await page.locator('[data-text-action=rotate]').click();
    await page.locator('[data-text-action=rotate]').click();
    await page.locator('[data-text-action=rotate]').click();
    await viewport.evaluate(node => { node.scrollTop = 0; });
    await expect.poll(() => page.locator('.text-selection-unit').count()).toBeGreaterThan(0);
    await viewport.focus(); await viewport.press('Space');
    assert.equal(await viewport.evaluate(node => node.classList.contains('panning')), false, 'keyup must release pan mode');
    assert.deepEqual(errors, []);
    console.log(`Text layer: ${total} glyphs in a 16000px image; viewport DOM below 3000, copy across unrendered lines, keyboard navigation, dense-view recovery and pan release passed.`);
  } finally {
    if (app) await app.close();
    const actual = await fs.realpath(directory);
    assert.equal(path.dirname(actual), await fs.realpath(root)); assert.ok(path.basename(actual).startsWith('text-layer-'));
    await fs.rm(actual, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
