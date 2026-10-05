const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

async function main() {
  const executablePath = process.env.ONE_PACKAGED_EXE;
  if (!executablePath) throw new Error('ONE_PACKAGED_EXE is required');
  const root = await fs.mkdtemp(path.join(process.env.TEMP || 'C:\\Windows\\Temp', 'one-drop-'));
  const sample = path.join(root, 'sample.txt');
  await fs.writeFile(sample, 'sample');
  const env = { ...process.env, ONE_TEST_MODE: '1', ONE_DATA_DIR: path.join(root, 'profile') };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath, env });
  try {
    const page = await app.firstWindow();
    await page.waitForSelector('[data-page=locksmith]');
    await page.locator('[data-page=locksmith]').click();
    await page.waitForSelector('#lock-targets');
    const input = await page.evaluate(() => {
      const element = document.createElement('input');
      element.type = 'file';
      document.body.append(element);
      return true;
    });
    assert.equal(input, true);
    await page.locator('input[type=file]').setInputFiles(sample);
    const pathFromFile = await page.evaluate(() => window.one.droppedFile(document.querySelector('input[type=file]').files[0]));
    assert.equal(pathFromFile, sample);
    const target = await page.locator('#page-locksmith').boundingBox();
    const client = await page.context().newCDPSession(page);
    const x = Math.round(target.x + target.width / 2), y = Math.round(target.y + target.height / 2);
    const data = { items: [], files: [sample], dragOperationsMask: 1 };
    for (const type of ['dragEnter', 'dragOver', 'drop']) await client.send('Input.dispatchDragEvent', { type, x, y, data });
    await expect(page.locator('#lock-targets')).toContainText('sample.txt');
    const inbox = path.join(root, 'profile', 'shell-requests');
    await fs.mkdir(inbox, { recursive: true });
    await fs.writeFile(path.join(inbox, `${crypto.randomUUID()}.json`), JSON.stringify({ tool: 'rename', paths: [sample] }));
    await expect.poll(() => app.windows().some(window => window.url().includes('view=file-action&tool=rename')), { timeout: 10000 }).toBe(true);
    console.log(JSON.stringify({ result: 'PASS', pathFromFile, dropped: true, recoveredShellRequest: true }));
  } finally { await app.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
