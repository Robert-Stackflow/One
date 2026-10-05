const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {_electron: electron, expect} = require('@playwright/test');

async function main() {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'one-actions-profile-'));
  const files = await fs.mkdtemp(path.join(os.tmpdir(), 'one-actions-files-'));
  await fs.writeFile(path.join(files, 'sample.txt'), 'original');
  const env = {...process.env, ONE_TEST_MODE: '1', ONE_DATA_DIR: profile};
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({args: [path.resolve('.')], env});
  const errors = [];
  app.on('window', page => page.on('pageerror', error => errors.push(String(error))));
  try {
    const main = await app.firstWindow();
    await main.locator('#page-home:not([hidden])').waitFor();
    await main.evaluate(() => window.one.showSearch());
    await expect.poll(() => app.windows().find(page => page.url().includes('view=search') && !page.url().includes('embedded'))).toBeTruthy();
    const search = app.windows().find(page => page.url().includes('view=search') && !page.url().includes('embedded'));
    await search.locator('#file-query').fill('>完整性');
    await expect(search.locator('.search-result')).toHaveCount(1);
    await expect(search.locator('.search-result')).toContainText('完整性校验');
    await search.evaluate(() => window.one.searchAction('integrity'));
    await expect(main.locator('#page-tools:not([hidden])')).toBeVisible();
    await expect(main.locator('#tool-tab-integrity')).toHaveAttribute('aria-selected', 'true');

    await main.locator('#integrity-root').fill(files);
    await main.locator('#tool-run').click();
    await expect(main.locator('#tool-result-title')).toContainText('完整性清单', {timeout: 20000});
    const manifests = (await fs.readdir(files)).filter(name => name.endsWith('.sha256.json'));
    assert.equal(manifests.length, 1);
    const manifest = path.join(files, manifests[0]);

    await fs.writeFile(path.join(files, 'sample.txt'), 'modified');
    await main.locator('[data-integrity-mode="verify"]').click();
    await main.locator('#integrity-manifest').fill(manifest);
    await main.locator('#tool-run').click();
    await expect(main.locator('#tool-result-title')).toContainText('变化', {timeout: 20000});
    await expect(main.locator('.tool-file-row').filter({hasText: 'sample.txt'})).toHaveCount(1);

    await main.locator('[data-page="home"]').click();
    await expect(main.locator('#overview-task-center')).toBeVisible();
    await expect(main.locator('#overview-history>button')).toHaveCount(2);
    await main.evaluate(() => window.one.showSearch());
    await search.locator('#file-query').fill('sample');
    await search.evaluate(() => document.querySelector('#search-save').click());
    await expect(search.locator('.search-saved-item')).toHaveCount(1);
    const saved = await main.evaluate(() => window.one.searchPreferences().then(settings => settings.savedQueries));
    assert.equal(saved[0].query, 'sample');
    await search.evaluate(() => document.querySelector('#search-clear').click());
    await search.evaluate(() => document.querySelector('[data-saved-id]').click());
    await expect(search.locator('#file-query')).toHaveValue('sample');
    await search.evaluate(() => document.querySelector('[data-saved-remove]').click());
    await expect(search.locator('.search-saved-item')).toHaveCount(0);
    const scoped = path.join(files, 'scoped');
    const outside = path.join(files, 'outside');
    await fs.mkdir(scoped);
    await fs.mkdir(outside);
    await fs.writeFile(path.join(scoped, 'needle-inside.txt'), 'inside');
    await fs.writeFile(path.join(outside, 'needle-outside.txt'), 'outside');
    await main.evaluate(root => window.one.patchSettings({search: {roots: [root]}}), files);
    await expect.poll(() => main.evaluate(() => window.one.searchState().then(state => state.count)), {timeout: 20000}).toBeGreaterThanOrEqual(4);
    await search.evaluate(folder => window.one.searchSavedQuery('add', {id: crypto.randomUUID(), name: '当前目录', query: 'needle', filter: '', folder}), scoped);
    await expect(search.locator('.search-saved-item')).toHaveCount(1);
    await search.evaluate(() => document.querySelector('[data-saved-id]').click());
    await expect(search.locator('.search-result')).toHaveCount(1, {timeout: 20000});
    await expect(search.locator('.search-result')).toContainText('needle-inside.txt');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({actions: true, savedScopedSearch: true, integrity: true, taskHistory: true}));
  } finally {
    await app.close();
    await fs.rm(profile, {recursive: true, force: true});
    await fs.rm(files, {recursive: true, force: true});
  }
}
main().catch(error => {console.error(error); process.exitCode = 1;});
