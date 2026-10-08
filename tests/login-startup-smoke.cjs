const { _electron: electron, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

async function launch(args, visibleAtStart) {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'one-login-startup-'));
  const env = { ...process.env, ONE_TEST_MODE: '1', ONE_DATA_DIR: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [path.resolve('.'), ...args], env });
  const mainVisible = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.getTitle() === 'One')?.isVisible());
  try {
    const page = await app.firstWindow();
    await page.waitForSelector('[data-page=home]');
    await expect.poll(mainVisible).toBe(visibleAtStart);
    if (!visibleAtStart) {
      await app.evaluate(({ app }) => app.emit('second-instance', {}, ['--one-login-startup'], process.cwd(), {}));
      await page.waitForTimeout(150);
      assert.equal(await mainVisible(), false, 'a repeated login launch must not raise the main window');
      await app.evaluate(({ app }) => app.emit('second-instance', {}, [], process.cwd(), {}));
      await expect.poll(mainVisible).toBe(true);
    }
  } finally {
    await app.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
}

(async () => {
  await launch(['--one-login-startup'], false);
  await launch([], true);
  console.log(JSON.stringify({ result: 'PASS', loginStartsHidden: true, repeatedLoginStaysHidden: true, manualOpenShowsMain: true, ordinaryLaunchShowsMain: true }));
})().catch(error => { console.error(error); process.exitCode = 1; });
