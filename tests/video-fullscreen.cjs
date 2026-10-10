const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');

async function run() {
  const root = path.resolve(process.env.ONE_TEST_APP_ROOT || '.');
  const output = path.resolve('work/current/video-fullscreen');
  await fs.mkdir(output, { recursive: true });
  const profile = await fs.mkdtemp(path.join(output, 'profile-'));
  const video = path.resolve('tests/fixtures/image-preview/motion.mp4');
  const text = path.join(output, 'next.txt');
  await fs.writeFile(text, 'Fullscreen replacement fixture');
  const env = { ...process.env, ONE_TEST_MODE: '1', ONE_DATA_DIR: profile, ONE_SEARCH_BACKEND: 'memory' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [root], env });
  const checks = [], errors = [];
  try {
    const main = await app.firstWindow();
    await main.waitForSelector('[data-page=text]');
    await main.evaluate(() => window.one.patchSettings({ preview: { held: true, pinned: false, files: false } }));
    const opening = app.waitForEvent('window');
    await main.evaluate(file => window.one.preview(file), video);
    const preview = await opening;
    preview.on('pageerror', e => errors.push(e.message));
    await preview.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
    const nativeFullscreen = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=preview'))?.isFullScreen());
    const enter = async () => {
      await preview.locator('#media-fullscreen').click();
      await preview.waitForFunction(() => document.fullscreenElement === document.querySelector('#preview-body'));
      await expect.poll(nativeFullscreen).toBe(true);
      await expect(preview.locator('#media-fullscreen')).toHaveAttribute('aria-label', '退出全屏');
      const size = await preview.locator('#preview-body').evaluate(e => ({ width: e.clientWidth, height: e.clientHeight, screenWidth: screen.width, screenHeight: screen.height }));
      assert.ok(Math.abs(size.width - size.screenWidth) <= 2 && Math.abs(size.height - size.screenHeight) <= 2, JSON.stringify(size));
    };
    const exited = async () => {
      await preview.waitForFunction(() => !document.fullscreenElement);
      await expect.poll(nativeFullscreen).toBe(false);
      assert.equal(preview.isClosed(), false);
    };
    await enter();
    await preview.locator('#media-fullscreen').click();
    await exited();
    await expect(preview.locator('#media-fullscreen')).toHaveAttribute('aria-label', '全屏');
    checks.push('button enters real DOM and native window fullscreen, then exits');
    await enter();
    await preview.keyboard.press('Escape');
    await exited();
    await expect(preview.locator('video')).toBeVisible();
    checks.push('Escape exits fullscreen and keeps the preview open');
    await enter();
    const oldVideo = await preview.locator('video').elementHandle();
    await preview.evaluate(file => window.one.selectPreview(file), text);
    await expect(preview.locator('.cm-content')).toContainText('Fullscreen replacement fixture');
    await exited();
    assert.equal(await oldVideo.evaluate(v => v.paused && !v.hasAttribute('src')), true);
    checks.push('replacing video exits fullscreen and releases its media element');
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ checks, errors }, null, 2));
    console.log(JSON.stringify({ passed: checks.length, errors }));
  } finally { await app.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
