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
  const app = await electron.launch({ args: [path.resolve(process.env.ONE_TEST_APP_ROOT || '.')], env });
  try {
    const page = await app.firstWindow();
    await page.locator('[data-page=images]').click();
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
    await page.keyboard.press('Alt+Shift+X');
    await expect(page.locator('#color-shortcut')).toHaveValue('Alt+Shift+X');
    await expect.poll(() => page.evaluate(async () => (await window.one.settings()).colorShortcut)).toBe('Alt+Shift+X');
    await expect.poll(() => page.evaluate(async () => (await window.one.colorShortcutStatus()).error)).toContain('已被占用');
    await expect(page.locator('#color-shortcut-notice')).toBeVisible();
    await expect(page.locator('#color-shortcut-message')).toContainText('快捷键已被占用');
    await expect(page.locator('.color-shortcut-field .shortcut-conflict-hint')).toHaveCount(0);
    const messageBox = await page.locator('#color-shortcut-notice').boundingBox();
    const inputBox = await page.locator('.color-shortcut-field .shortcut-control').boundingBox();
    const fieldBox = await page.locator('.color-shortcut-field .shortcut-field').boundingBox();
    const labelBox = await page.locator('label[for="color-shortcut"]').boundingBox();
    const nextRow = await page.locator('label[for="color-default-format"]').boundingBox();
    assert.ok(messageBox && nextRow && (messageBox.x + messageBox.width <= nextRow.x || nextRow.x + nextRow.width <= messageBox.x || messageBox.y + messageBox.height <= nextRow.y || nextRow.y + nextRow.height <= messageBox.y), `conflict notice should not cover the next setting: ${JSON.stringify({ messageBox, nextRow })}`);
    assert.ok(inputBox && fieldBox && labelBox && Math.abs(messageBox.x - inputBox.x) < 2 && Math.abs(messageBox.width - inputBox.width) < 2 && Math.abs(labelBox.y + labelBox.height / 2 - (fieldBox.y + fieldBox.height / 2)) < 3, 'notice should align with input and row label should be vertically centered');
    await page.screenshot({ path: path.join(output, 'conflict.png') });
    await expect(page.locator('#toast')).toBeHidden();
    await app.evaluate(({ globalShortcut }) => { globalShortcut.register = () => true; });
    await page.locator('#color-shortcut-details').click();
    await expect(page.locator('#color-shortcut-details-dialog [data-shortcut-status]')).toContainText('已被占用');
    await page.locator('#color-shortcut-retry').click();
    await expect(page.locator('#color-shortcut-notice')).toBeHidden();
    assert.deepEqual(await page.evaluate(() => window.one.colorShortcutStatus()), { active: true, error: '' });
    assert.equal(await page.locator('#color-shortcut').getAttribute('aria-describedby'), null);
    await page.locator('[data-page=search]').click();
    for (const id of ['search-shortcut', 'search-programShortcut']) {
      await expect(page.locator(`#${id}`).locator('..').locator('..')).toHaveClass(/shortcut-field/);
    }
    await app.evaluate(({ globalShortcut }) => { globalShortcut.register = () => false; });
    await page.locator('#search-shortcut').focus();
    await page.keyboard.press('Alt+Shift+Y');
    await expect(page.locator('#search-shortcut-notice')).toContainText('已被占用');
    await expect(page.locator('#search-shortcut-notice')).toBeVisible();
    assert.equal(await page.locator('#search-shortcut-notice').evaluate(element => getComputedStyle(element).position), 'static');
    await page.locator('[data-page=input]').click();
    for (const id of ['clicker-shortcut', 'topmost-shortcut', 'shortcut-TL', 'shortcut-TR', 'shortcut-BL', 'shortcut-BR']) {
      await expect(page.locator(`#${id}`).locator('..').locator('..')).toHaveClass(/shortcut-field/);
    }
    await page.locator('#enhancement-tab-clicker').click();
    await page.locator('#clicker-shortcut').focus();
    await page.keyboard.press('Alt+Shift+Z');
    await expect(page.locator('#clicker-shortcut-notice')).toBeVisible();
    await page.locator('#enhancement-tab-topmost').click();
    await page.locator('#topmost-shortcut').focus();
    await page.keyboard.press('Alt+Shift+U');
    await expect(page.locator('#topmost-shortcut-notice')).toBeVisible();
    await page.locator('#enhancement-tab-edges').click();
    await page.locator('#corner-TL').click();
    await page.getByRole('option', { name: '自定义快捷键', exact: true }).click();
    await page.locator('#shortcut-TL').focus();
    await page.keyboard.press('Alt+Shift+V');
    await expect(page.locator('#shortcut-TL-notice')).toBeVisible();
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
