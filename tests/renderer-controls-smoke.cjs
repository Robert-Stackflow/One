const {_electron:electron,expect} = require('@playwright/test');
const {build} = require('esbuild');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const root = path.resolve('work/current/capture-migration');
  await fs.mkdir(root,{recursive:true});
  const profile = await fs.mkdtemp(path.join(root,'controls-profile-'));
  const bundle = await build({stdin:{contents:'export * from "./src/renderer/controls";',resolveDir:path.resolve('.')},
    bundle:true,platform:'browser',format:'iife',globalName:'controls',write:false});
  const env = {...process.env,ONE_COMPONENT_TEST_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await electron.launch({args:[path.resolve('tests/renderer-components/main.cjs')],env});
    const page = await app.firstWindow(), errors = [];
    page.on('pageerror',error => errors.push(String(error)));
    await page.setContent(`<main id="app"><section id="fields">
      <label for="simple">Source</label><select id="simple" data-field="source"><option value="a">Alpha</option><option value="b" disabled>Blocked</option><option value="c">Camera</option></select>
      <select id="devices" aria-label="Devices" data-searchable="true"><option value="old">Previous device</option></select>
      <select id="second" aria-label="Second"><option value="other">Other</option></select>
      <input id="number" aria-label="count" type="number" min="0" max="4" step="2" value="2">
    </section><button id="outside">outside</button></main>`);
    const css = await fs.readFile('src/renderer/styles.css','utf8');
    // Load the real shared control rules, excluding app-wide page and resource styles.
    await page.addStyleTag({content:css.split('\n').filter(line => /^\.(custom-select|select-popup|select-empty|select-option-icon)/.test(line)).join('\n')});
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.evaluate(() => {
      window.original = document.querySelector('#simple');window.nativeDevice = document.querySelector('#devices');
      window.requests = [];window.loadErrors = 0;window.changes = 0;window.nativeChanges = 0;
      controls.setSelectLoader(window.nativeDevice,signal => new Promise((resolve,reject) => window.requests.push({signal,resolve,reject})));
      controls.customControls(document.querySelector('#app'));controls.customControls(document.querySelector('#app'));
      document.querySelector('#simple').addEventListener('change',() => window.changes++);
      window.original.addEventListener('change',() => window.nativeChanges++);
      document.querySelector('#devices').addEventListener('one:load-error',() => window.loadErrors++);
    });
    const simple = page.locator('#simple'), devices = page.locator('#devices');
    await expect(simple).toHaveAttribute('role','combobox');await expect(simple).toHaveAttribute('data-field','source');
    await expect(page.locator('.number-control')).toHaveCount(1);
    await simple.focus();await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
    assert.equal(await simple.evaluate(el => el.value),'c');
    assert.deepEqual(await page.evaluate(() => [window.changes,window.nativeChanges,window.original.value]),[1,1,'c']);
    await page.evaluate(() => {window.original.options[2].text = 'Renamed camera';window.original.options[2].dataset.icon = 'window';});
    await expect(simple).toHaveText('Renamed camera');await expect(simple.locator('.select-option-icon')).toHaveCount(1);
    await page.evaluate(() => window.original.selectedIndex = 0);await expect(simple).toHaveText('Alpha');
    await simple.click();await page.evaluate(() => window.original.append(new Option('Delta','d')));
    await expect(simple).toHaveAttribute('aria-expanded','false');
    await simple.focus();await page.keyboard.press('End');await page.keyboard.press('Enter');
    assert.equal(await simple.evaluate(el => el.value),'d');

    await devices.click();await expect(devices).toHaveAttribute('aria-busy','true');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => window.requests[0].signal.aborted),true);
    await devices.click();
    await page.evaluate(() => window.requests[1].resolve(Array.from({length:12},(_,index) => ({value:'d'+index,label:'Device '+index,disabled:index === 11,icon:'volume'}))));
    await expect(devices).toHaveAttribute('aria-expanded','true');
    await page.evaluate(() => window.requests[0].resolve([{value:'stale',label:'Stale device'}]));
    await expect(page.getByRole('option',{name:'Stale device',exact:true})).toHaveCount(0);
    const search = page.locator('.select-popup-search');await expect(search).toBeFocused();
    await search.fill('Device 10');await expect(page.getByRole('option')).toHaveCount(1);await page.keyboard.press('Enter');
    assert.equal(await devices.evaluate(el => el.value),'d10');await expect(devices).toBeFocused();
    await expect(devices).not.toHaveAttribute('aria-busy','true');

    await devices.click();await page.evaluate(() => window.requests[2].reject(Error('device enumeration failed')));
    await expect.poll(() => page.evaluate(() => window.loadErrors)).toBe(1);
    await expect(devices).not.toHaveAttribute('aria-busy','true');await expect(devices).toHaveAttribute('aria-expanded','false');
    await devices.focus();await page.keyboard.press('End');
    await page.evaluate(() => window.requests[3].resolve([{value:'x',label:'First'},{value:'y',label:'Last'},{value:'z',label:'Disabled',disabled:true}]));
    await expect(devices).toHaveAttribute('aria-expanded','true');await page.keyboard.press('Enter');
    assert.equal(await devices.evaluate(el => el.value),'y');

    await devices.click();await page.locator('#second').click();
    assert.equal(await page.evaluate(() => window.requests[4].signal.aborted),true);
    await page.evaluate(() => window.requests[4].reject(Error('cancelled old request')));
    assert.equal(await page.evaluate(() => window.loadErrors),1);
    await page.keyboard.press('Escape');
    await page.evaluate(() => controls.setSelectLoader(document.querySelector('#devices'),undefined));
    await devices.click();await expect(devices).toHaveAttribute('aria-expanded','true');
    assert.equal(await page.evaluate(() => window.requests.length),5,'Removing a loader through the visible control also removes the original registration');
    await page.keyboard.press('Escape');
    await page.evaluate(() => controls.updateSelectOptions(document.querySelector('#devices'),[]));
    await expect(devices).toHaveText('没有可选项');assert.equal(await devices.evaluate(el => el.value),'');
    await page.evaluate(() => {controls.updateSelectOptions(document.querySelector('#devices'),[{value:'x',label:'X'}]);document.querySelector('#devices').disabled = true;});
    await expect(devices).toBeDisabled();
    await page.evaluate(() => {controls.updateSelectOptions(document.querySelector('#devices'),[{value:'y',label:'Y'}]);});
    await expect(devices).toBeDisabled();

    await page.evaluate(() => {window.inputEvents = [];document.querySelector('#number').addEventListener('input',() => window.inputEvents.push('input'));document.querySelector('#number').addEventListener('change',() => window.inputEvents.push('change'));});
    await page.getByRole('button',{name:'增加count',exact:true}).click();await page.getByRole('button',{name:'增加count',exact:true}).click();
    await expect(page.locator('#number')).toHaveValue('4');
    assert.deepEqual(await page.evaluate(() => window.inputEvents),['input','change','input','change']);

    await page.evaluate(() => {
      const control = document.querySelector('#devices');control.disabled = false;
      controls.setSelectLoader(control,signal => new Promise(resolve => window.requests.push({signal,resolve})));
    });
    await devices.focus();await page.keyboard.press('D');await page.keyboard.press('e');
    await page.evaluate(() => window.requests[5].resolve([{value:'de',label:'Device'},{value:'x',label:'Camera'}]));
    await expect(page.locator('.select-popup-search')).toHaveValue('De');await expect(page.getByRole('option')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await devices.click();await page.evaluate(() => document.querySelector('#fields').remove());
    await expect.poll(() => page.evaluate(() => window.requests[6].signal.aborted)).toBe(true);
    await page.evaluate(() => window.requests[6].resolve([{value:'late',label:'Late device'}]));
    await expect(page.locator('.select-popup')).toHaveCount(0);
    assert.equal(await page.evaluate(() => Object.hasOwn(window.original,'value')),false,'Removal restores the native property descriptors');
    await page.evaluate(()=>{const source=document.createElement('select');source.id='grouped';source.dataset.searchable='true';document.querySelector('#app').append(source);controls.customControls(document.querySelector('#app'));controls.updateSelectOptions(document.querySelector('#grouped'),[{value:'a',label:'Vision model',group:'AI 服务'},{value:'b',label:'Azure',group:'专用服务'}]);});
    await page.locator('#grouped').click();await expect(page.locator('.select-option-group')).toHaveCount(2);
    await page.locator('.select-popup-search').fill('Azure');await expect(page.getByRole('option')).toHaveCount(1);await expect(page.locator('.select-option-group').filter({hasText:'AI 服务'})).toBeHidden();
    await page.keyboard.press('Enter');await expect(page.locator('#grouped')).toHaveJSProperty('value','b');
    await page.locator('#grouped').click();await page.keyboard.press('Home');await page.keyboard.press('Enter');await expect(page.locator('#grouped')).toHaveJSProperty('value','a');
    assert.deepEqual(errors,[]);
    console.log('Controls checks passed: native synchronization, keyboard/filtering, stale/cancelled loading, retry, removal, icons and numeric events.');
  } finally {
    await app?.close();const actual = await fs.realpath(profile);assert.ok(actual.startsWith(root+path.sep) && actual === profile);
    await fs.rm(actual,{recursive:true,force:true});
  }
})().catch(error => {console.error(error);process.exitCode=1;});
