const {_electron:electron,expect} = require('@playwright/test');
const {build} = require('esbuild');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const root = path.resolve('work/current/capture-migration');await fs.mkdir(root,{recursive:true});
  const profile = await fs.mkdtemp(path.join(root,'fonts-profile-'));
  const bundle = await build({stdin:{contents:'export * from "./src/renderer/font-picker"; export * from "./src/renderer/font-runtime";',resolveDir:path.resolve('.')},
    outfile:path.join(root,'font-harness.js'),bundle:true,platform:'browser',format:'iife',globalName:'fonts',write:false});
  const env = {...process.env,ONE_COMPONENT_TEST_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await electron.launch({args:[path.resolve('tests/renderer-components/main.cjs')],env});
    const page = await app.firstWindow(), errors = [];
    page.on('pageerror',error => errors.push(String(error)));
    await page.setContent('<main><button id="appearance-font"><span></span></button></main><button id="outside">Outside</button>');
    await page.addStyleTag({content:bundle.outputFiles.find(file => file.path.endsWith('.css')).text});
    const css = await fs.readFile('src/renderer/styles.css','utf8');
    await page.addStyleTag({content:css.split('\n').filter(line => /^\.(custom-select|select-popup|select-empty|select-option-icon)/.test(line)).join('\n')});
    await page.evaluate(() => {
      window.sources = [];window.lists = [];window.faceLoads = [];
      window.one = {
        uiFontSource:family => new Promise((resolve,reject) => window.sources.push({family,resolve,reject})),
        installedFonts:force => new Promise((resolve,reject) => window.lists.push({force,resolve,reject})),
      };
      const NativeFontFace = window.FontFace;
      window.FontFace = class extends NativeFontFace {
        load() {return new Promise((resolve,reject) => window.faceLoads.push({face:this,finish:() => super.load().then(resolve,reject)}));}
      };
    });
    await page.addScriptTag({content:bundle.outputFiles.find(file => file.path.endsWith('.js')).text});
    await page.evaluate(() => {window.pendingFont = fonts.loadUIFont('installed:Cancelled before source');});
    await expect.poll(() => page.evaluate(() => window.sources.length)).toBe(1);
    await page.evaluate(async () => {
      fonts.releaseUIFont('installed:Cancelled before source');window.sources[0].resolve({local:['Arial']});await window.pendingFont;
    });
    assert.equal(await page.evaluate(() => window.faceLoads.length),0,'Released source requests cannot create font faces');

    await page.evaluate(() => {window.pendingFont = fonts.loadUIFont('installed:Cancelled during load');});
    await expect.poll(() => page.evaluate(() => window.sources.length)).toBe(2);
    await page.evaluate(() => window.sources[1].resolve({local:['Arial']}));
    await expect.poll(() => page.evaluate(() => window.faceLoads.length)).toBe(1);
    await page.evaluate(async () => {
      fonts.releaseUIFont('installed:Cancelled during load');await window.faceLoads[0].finish();await window.pendingFont;
    });
    assert.equal(await page.evaluate(() => document.fonts.has(window.faceLoads[0].face)),false,'Late face loads do not return to the document after release');

    await page.evaluate(() => {window.oldLoad = fonts.loadUIFont('installed:Retry').catch(() => 'failed');});
    await expect.poll(() => page.evaluate(() => window.sources.length)).toBe(3);
    await page.evaluate(() => {fonts.releaseUIFont('installed:Retry');window.newLoad = fonts.loadUIFont('installed:Retry');});
    await expect.poll(() => page.evaluate(() => window.sources.length)).toBe(4);
    await page.evaluate(async () => {window.sources[2].reject(Error('retired request'));await window.oldLoad;});
    assert.equal(await page.evaluate(() => fonts.loadUIFont('installed:Retry') === window.newLoad),true,'An old rejection cannot delete a newer cache entry');
    await page.evaluate(() => window.sources[3].resolve({local:['Arial']}));
    await expect.poll(() => page.evaluate(() => window.faceLoads.length)).toBe(2);
    await page.evaluate(async () => {await window.faceLoads[1].finish();await window.newLoad;});
    assert.equal(await page.evaluate(() => document.fonts.has(window.faceLoads[1].face)),true);
    await page.evaluate(() => fonts.releaseUIFont('installed:Retry'));
    assert.equal(await page.evaluate(() => document.fonts.has(window.faceLoads[1].face)),false);

    await page.evaluate(() => {window.activeFont = fonts.loadUIFont('installed:Active UI',true);});
    await expect.poll(() => page.evaluate(() => window.sources.length)).toBe(5);
    await page.evaluate(() => window.sources[4].resolve({local:['Arial']}));
    await expect.poll(() => page.evaluate(() => window.faceLoads.length)).toBe(3);
    await page.evaluate(async () => {await window.faceLoads[2].finish();await window.activeFont;fonts.releaseUIFont('installed:Active UI');fonts.refreshUIFontCache();});
    assert.equal(await page.evaluate(() => document.fonts.has(window.faceLoads[2].face)),true,'Preview cleanup preserves the active UI font');

    assert.equal(await page.evaluate(() => {
      window.pickerButton = document.querySelector('#appearance-font');window.picker = fonts.setupFontPicker(window.pickerButton);
      return fonts.setupFontPicker(window.pickerButton) === window.picker;
    }),true);
    await page.locator('#appearance-font').click();
    await expect.poll(() => page.evaluate(() => window.lists.length)).toBe(1);
    await page.evaluate(() => window.lists[0].resolve([{family:'Preview',label:'Preview Font',aliases:[]}]));
    await page.locator('#appearance-font-search').fill('Preview');
    await expect(page.getByRole('option')).toHaveCount(1);
    await expect.poll(() => page.evaluate(() => window.sources.length)).toBe(6);
    await page.keyboard.press('Escape');await expect(page.locator('.font-popup')).toHaveCount(0);
    await page.evaluate(async () => {window.sources[5].resolve({local:['Arial']});await Promise.resolve();await Promise.resolve();});
    assert.equal(await page.evaluate(() => window.faceLoads.length),3,'Closing the picker releases its pending preview');
    await expect(page.locator('#appearance-font')).toBeFocused();
    await page.locator('#appearance-font').click();
    await expect.poll(() => page.evaluate(() => window.lists.length)).toBe(2);
    await page.evaluate(() => window.pickerButton.disabled = true);
    await expect(page.locator('.font-popup')).toHaveCount(0);
    await page.evaluate(() => window.pickerButton.remove());
    await expect(page.locator('.font-popup')).toHaveCount(0);
    await page.evaluate(() => window.lists[1].resolve([{family:'Late',label:'Late Font',aliases:[]}]));
    assert.equal(await page.evaluate(() => Object.hasOwn(window.pickerButton,'value')),false);
    assert.equal(await page.evaluate(() => document.fonts.has(window.faceLoads[2].face)),true);
    assert.deepEqual(errors,[]);
    console.log('Font checks passed: idempotent picker, removal, preview release, stale loads, retry and active UI font preservation.');
  } finally {
    await app?.close();const actual = await fs.realpath(profile);assert.ok(actual.startsWith(root+path.sep) && actual === profile);
    await fs.rm(actual,{recursive:true,force:true});
  }
})().catch(error => {console.error(error);process.exitCode=1;});
