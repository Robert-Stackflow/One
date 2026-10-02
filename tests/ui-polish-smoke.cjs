const {_electron: electron, expect} = require('@playwright/test');
const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');
async function run() {
  const output = path.resolve(process.env.ONE_TEST_OUTPUT_DIR||'work/ui-polish-smoke'); await fs.mkdir(output, {recursive:true});
  const profile = await fs.mkdtemp(path.join(output, 'profile-'));
  const env = {...process.env, ONE_TEST_MODE:'1', ONE_DATA_DIR:profile}; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch(process.env.ONE_PACKAGED_EXE ? {executablePath:process.env.ONE_PACKAGED_EXE,args:[],env} : {args:[path.resolve('.')],env});
  const errors = [], layouts = [];
  app.on('window', p => p.on('pageerror', e => errors.push(String(e))));
  try {
    const page = await app.firstWindow(); await page.waitForSelector('[data-page=text]');await page.locator('[data-page=text]').click();await page.waitForSelector('#source');
    const main = await app.browserWindow(page);
    assert.equal(await page.evaluate(() => navigator.windowControlsOverlay.visible), false);
    for (const mode of ['light','dark']) {
      await page.locator('[data-page=settings]').click();await page.locator('[data-settings-tab=appearance]').click(); await page.locator(`[data-mode=${mode}]`).click();
      for (const width of [1240,840]) {
        await main.evaluate((w,width) => w.setSize(width,780), width);
        for (const id of ['home','tools','text','disk','system','hardware','input','preview','color','search','settings']) {
          await page.locator(`[data-page=${id}]`).click();
          const layout = await page.locator('.content').evaluate(e => ({width:e.clientWidth,scroll:e.scrollWidth}));
          assert.ok(layout.scroll <= layout.width + 1, `${id}/${mode}/${width}: ${JSON.stringify(layout)}`);
          await expect(page.locator(`.nav[data-page=${id}]`)).toHaveAttribute('aria-current','page');
          await expect(page.locator('#page-'+id)).toBeVisible(); layouts.push({id,mode,width,...layout});
          if (width===1240 && ['text','input','appearance','utilities'].includes(id) || width===840&&id==='color') await page.screenshot({path:path.join(output,`${id}-${mode}-${width}.png`),animations:'disabled'});
        }
      }
    }
    await page.locator('[data-page=input]').click();await page.locator('#enhancement-tab-topmost').click();
    await page.locator('#enhancement-tab-awake').click();await page.locator('#awake-mode').click(); await page.getByRole('option',{name:'持续一段时间',exact:true}).click();
    const sizes=await page.evaluate(()=>Object.fromEntries(['#awake-mode','#awake-minutes','#awake-start'].map(selector=>{let e=document.querySelector(selector);if(e.parentElement.matches('.number-control,.shortcut-control'))e=e.parentElement;const s=getComputedStyle(e);return[selector,{height:e.getBoundingClientRect().height,radius:s.borderRadius,border:s.borderWidth}];})));
    for(const size of Object.values(sizes)){assert.equal(size.height,32);assert.equal(size.radius,sizes['#awake-mode'].radius);assert.equal(size.border,sizes['#awake-mode'].border);assert.ok(parseFloat(size.border)>0&&parseFloat(size.border)<=1);}
    await page.locator('#awake-minutes').fill('30'); await page.getByRole('button',{name:'增加唤醒分钟',exact:true}).click(); await expect(page.locator('#awake-minutes')).toHaveValue('31');
    await page.locator('#enhancement-tab-topmost').click();await page.locator('#topmost-shortcut').focus(); await page.locator('#topmost-shortcut').press('Control+Shift+Y'); await page.locator('#topmost-excluded').click(); await expect(page.locator('#topmost-shortcut')).toHaveValue('Ctrl+Shift+Y');
    await page.locator('#enhancement-tab-awake').click();await page.locator('#awake-mode').focus(); await page.keyboard.press('ArrowDown'); await expect(page.locator('.select-popup')).toBeVisible(); await page.keyboard.press('Escape'); await expect(page.locator('.select-popup')).toHaveCount(0); await expect(page.locator('#awake-mode')).toBeFocused();
    await page.locator('#sidebar-toggle').click(); await expect(page.locator('.shell')).toHaveClass(/sidebar-collapsed/);
    await page.locator('[data-page=text]').click(); await expect(page.locator('#source')).toBeVisible(); await page.reload(); await page.waitForSelector('[data-page=text]');await page.locator('[data-page=text]').click();await page.waitForSelector('#source'); await expect(page.locator('.shell')).toHaveClass(/sidebar-collapsed/); await page.locator('#sidebar-toggle').click();
    await page.locator('[data-page=settings]').click();await page.locator('[data-settings-tab=appearance]').click(); await page.locator('#appearance-density').click(); await page.getByRole('option',{name:'紧凑',exact:true}).click();
    await page.locator('[data-page=input]').click();await page.locator('#enhancement-tab-topmost').click(); assert.equal(await page.locator('#topmost-shortcut').evaluate(e=>e.parentElement.getBoundingClientRect().height),28);
    const file=path.join(output,'中文预览.md');await fs.writeFile(file,'# 预览\n\n字体与工具栏检查。\n\n'+('一段很长的内容。'.repeat(150)));
    const opening=app.waitForEvent('window');await page.evaluate(p=>window.one.preview(p),file);const preview=await opening;await expect(preview.locator('#preview-name')).toHaveText('中文预览.md');
    assert.equal(await preview.evaluate(()=>navigator.windowControlsOverlay.visible),false);assert.equal(await preview.locator('.preview-head').evaluate(e=>e.getBoundingClientRect().height),56);
    await preview.locator('#preview-hold').click();await preview.locator('#preview-files').click();if(await preview.locator('#preview-files').getAttribute('aria-pressed')!=='true')await preview.locator('#preview-files').click();await preview.locator('#side-details').click();
    await expect(preview.locator('#preview-file-panel')).toBeVisible();await expect(preview.locator('#preview-information')).toBeVisible();
    assert.ok(await preview.locator('.preview-shell').evaluate(e=>e.scrollWidth<=e.clientWidth+1));await preview.screenshot({path:path.join(output,'preview-panels.png'),animations:'disabled'});await preview.close();
    await page.emulateMedia({reducedMotion:'reduce'});await page.locator('[data-page=input]').click();assert.equal(await page.locator('#page-input').evaluate(e=>getComputedStyle(e).animationName),'none');
    assert.deepEqual(errors,[]);
    const result={result:'PASS',packaged:!!process.env.ONE_PACKAGED_EXE,layouts,sizes,shortcutCapture:true,numberStepper:true,dropdownKeyboard:true,sidebarPersistence:true,compactControls:true,previewPanels:true,reducedMotion:true};
    await fs.writeFile(path.join(output,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({result:'PASS',layouts:layouts.length,sizes,packaged:result.packaged}));
  }finally{await app.close();}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
