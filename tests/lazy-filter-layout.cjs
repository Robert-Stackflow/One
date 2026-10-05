const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {_electron: electron} = require('@playwright/test');

async function main() {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'one-filter-layout-'));
  const env = {...process.env, ONE_TEST_MODE: '1', ONE_DATA_DIR: profile};
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({args: [path.resolve('.')], env});
  try {
    const page = await app.firstWindow();
    await page.locator('#page-home:not([hidden])').waitFor();
    const eagerSystemRules = await page.evaluate(() => {
      const rules = [...document.styleSheets].flatMap(sheet => {
        try { return [...sheet.cssRules].map(rule => rule.cssText); } catch { return []; }
      }).join('\n');
      return {
        maintenance: rules.includes('#maintenance-scan-panel .maintenance-layout'),
        information: rules.includes('.information-layout'),
        tools: rules.includes('.file-tools-toolbar'),
        text: rules.includes('.text-tool-row'),
        disk: rules.includes('.disk-workspace'),
        color: rules.includes('.color-workbench')
      };
    });
    assert.deepEqual(eagerSystemRules, {maintenance: true, information: true, tools: true, text: true, disk: true, color: true},
      'Main-workspace layout rules must be available before first navigation');
    const layouts = [];
    for (const [pageId, fieldId] of [['system', 'maintenance-query'], ['hardware', 'information-query']]) {
      await page.locator(`[data-page="${pageId}"]`).click();
      await page.locator(`#page-${pageId}:not([hidden])`).waitFor();
      const layout = await page.locator(`#${fieldId}`).evaluate(input => {
        const field = input.closest('.filter-field');
        const icon = field.querySelector('.icon');
        const a = field.getBoundingClientRect();
        const b = input.getBoundingClientRect();
        const c = icon.getBoundingClientRect();
        return {display: getComputedStyle(field).display, width: a.width, height: a.height,
          inputWidth: b.width, inputY: b.y + b.height / 2, iconY: c.y + c.height / 2,
          border: getComputedStyle(field).borderTopWidth};
      });
      assert.equal(layout.display, 'flex', `${pageId} filter field must be horizontal before disk styles load`);
      assert.ok(layout.inputWidth > 80, `${pageId} filter input is too narrow`);
      assert.ok(Math.abs(layout.inputY - layout.iconY) < 5, `${pageId} filter icon and text are misaligned`);
      assert.ok(parseFloat(layout.border) > 0);
      layouts.push({pageId, ...layout});
    }
    console.log(JSON.stringify(layouts));
  } finally {
    await app.close();
    await fs.rm(profile, {recursive: true, force: true});
  }
}
main().catch(error => {console.error(error); process.exitCode = 1;});
