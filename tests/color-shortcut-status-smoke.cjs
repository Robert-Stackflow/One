const { _electron: electron, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

async function run() {
  const output = path.resolve(process.env.ONE_TEST_OUTPUT_DIR || 'work/current/color-shortcut-status');
  await fs.mkdir(output, { recursive: true });
  const profile = await fs.mkdtemp(path.join(output, 'profile-'));
  const env = { ...process.env, ONE_TEST_MODE: '1', ONE_DATA_DIR: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [path.resolve('.')], env });
  try {
    const page = await app.firstWindow();
    await page.locator('[data-page=color]').click();
    await expect(page.locator('#color-shortcut')).toBeVisible();
    await app.evaluate(({ globalShortcut }) => {
      globalThis.originalColorRegister = globalShortcut.register;
      globalShortcut.register = () => false;
    });
    const unavailable = await page.evaluate(() => window.one.retryColorShortcut());
    assert.equal(unavailable.active, false);
    assert.match(unavailable.error, /已被占用/);
    await expect(page.locator('#color-shortcut-notice')).toBeVisible();
    await expect(page.locator('#color-shortcut-message')).toContainText('已被占用');
    const notice = await page.locator('#color-shortcut-notice').boundingBox();
    assert.ok(notice && notice.height < 52, `conflict notice should stay compact: ${JSON.stringify(notice)}`);
    await page.locator('#color-shortcut').focus();
    await page.keyboard.press('Control+Alt+P');
    await expect(page.locator('#color-shortcut')).toHaveValue('Ctrl+Alt+P');
    await expect.poll(() => page.evaluate(async () => (await window.one.settings()).colorShortcut)).toBe('Ctrl+Alt+P');
    await expect.poll(() => page.evaluate(async () => (await window.one.colorShortcutStatus()).error)).toContain('已被占用');
    await expect(page.locator('#color-shortcut-notice')).toBeVisible();
    await expect(page.locator('#toast')).toBeHidden();
    await app.evaluate(({ globalShortcut }) => { globalShortcut.register = () => true; });
    await page.locator('#color-shortcut-retry').click();
    await expect(page.locator('#color-shortcut-notice')).toBeHidden();
    assert.deepEqual(await page.evaluate(() => window.one.colorShortcutStatus()), { active: true, error: '' });
    assert.equal(await page.locator('#color-shortcut').getAttribute('aria-describedby'), null);
    console.log(JSON.stringify({ result: 'PASS', failureVisible: true, retryRecovers: true }));
  } finally {
    await app.close();
    const resolved = await fs.realpath(profile);
    const parent = await fs.realpath(output);
    assert.equal(path.dirname(resolved).toLowerCase(), parent.toLowerCase());
    await fs.rm(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
