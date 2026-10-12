const {_electron:electron,expect}=require('@playwright/test');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),{once}=require('node:events'),{createInterface}=require('node:readline');
(async()=>{
  const root=path.resolve('work/current/capture-migration');await fs.mkdir(root,{recursive:true});
  const directory=await fs.mkdtemp(path.join(root,'capture-page-')),fixtures=[],errors=[];let app;
  try{
    for(let i=0;i<2;i++){const child=spawn(path.resolve('dist/native/One.CaptureProbe.exe'),['--fixture'],{windowsHide:true,stdio:'pipe'});fixtures.push(child);const lines=createInterface({input:child.stdout});await once(lines,'line');lines.close();}
    const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:directory};delete env.ELECTRON_RUN_AS_NODE;
    app=await electron.launch({args:[path.resolve('.')],env});app.on('window',page=>page.on('pageerror',error=>errors.push(page.url()+' '+(error.stack||String(error)))));
    const main=await app.firstWindow();await main.waitForFunction(()=>!!window.one?.captureState);
    await app.evaluate(({dialog})=>{global.captureImports=0;dialog.showOpenDialog=async()=>{global.captureImports++;return {canceled:true,filePaths:[]};};});
    const nav=main.locator('.nav[data-page=capture]'),tabs=main.locator('#capture-modes');
    await nav.click();await expect(main.locator('#page-name')).toHaveText('截图');await expect(tabs.locator('[role=tab]')).toHaveCount(8);
    await expect(main.locator('[data-display]')).not.toHaveCount(0);assert.equal(await main.locator('#page-capture iframe,#page-capture webview').count(),0);
    await tabs.getByRole('tab',{name:'区域',exact:true}).focus();await main.keyboard.press('ArrowRight');await expect(tabs.getByRole('tab',{name:'显示器',exact:true})).toHaveAttribute('aria-selected','true');
    await tabs.getByRole('tab',{name:'窗口',exact:true}).click();
    const owned=main.locator('[data-capture-window]').filter({hasText:'One capture native verification'});await expect(owned).toHaveCount(2);await owned.first().click();
    async function captureWindow(){
      let id;await expect.poll(async()=>id=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().endsWith('?view=capture')&&window.isVisible())?.webContents.id||0),{timeout:15000}).toBeGreaterThan(0);
      for(const page of app.windows().filter(page=>page.url().endsWith('?view=capture')&&!page.isClosed())){try{const handle=await app.browserWindow(page),actual=await handle.evaluate(window=>window.webContents.id);await handle.dispose();if(actual===id){await page.waitForFunction(()=>document.body.dataset.captureReady==='true');return page;}}catch{}}
      throw Error('Active capture renderer missing');
    }
    async function cancelCapture(){const overlay=await captureWindow();await overlay.evaluate(()=>{setTimeout(()=>document.getElementById('cancel').click(),20);});await expect.poll(()=>overlay.isClosed()).toBe(true);await expect(main.locator('#custom-capture')).toBeEnabled();}
    await main.locator('#take-capture-menu').click();await main.locator('#take-capture-hide').click();await captureWindow();assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().endsWith('?view=main')).isVisible()),false);
    await cancelCapture();assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().endsWith('?view=main')).isVisible()),true);
    await tabs.getByRole('tab',{name:'多窗口',exact:true}).click();await main.locator('#composition-search').fill('One capture native verification');
    const choices=main.locator('.composition-source');await expect(choices).toHaveCount(2);await choices.nth(0).click();await choices.nth(1).click();await expect(main.locator('#composition-count')).toHaveText('2 / 8');
    await main.locator('#composition-x').fill('45');await main.locator('#composition-x').press('Tab');await expect(main.locator('#composition-x')).toHaveValue('45');
    await main.locator('#composition-down').click();await main.locator('#composition-undo').click();
    await main.evaluate(()=>window.one.patchSettings({capture:{uiScale:150}}));await expect(main.locator('.capture-page')).toHaveAttribute('data-capture-scale','150');
    const box=await main.locator('.capture-page').evaluate(node=>({width:node.clientWidth,scroll:node.scrollWidth}));assert.ok(box.scroll<=box.width);
    await main.evaluate(()=>window.one.patchSettings({capture:{uiScale:100}}));
    await require('sharp')(await main.screenshot({scale:'css'})).resize({width:1120,height:820,fit:'inside',withoutEnlargement:true}).png().toFile(path.join(root,'capture-page-composition.png'));
    await main.locator('#take-capture').click();const composition=await captureWindow(),data=await composition.evaluate(()=>window.one.capture.data());assert.equal(data.layers.length,2);await cancelCapture();
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().endsWith('?view=main')).setSize(850,700));
    await main.evaluate(()=>window.one.patchSettings({capture:{uiScale:150},appearance:{mode:'dark'}}));
    await main.locator('#custom-capture').click();const dialog=main.locator('#custom-capture-dialog');await expect(dialog).toBeVisible();
    const geometry=await dialog.evaluate(node=>{const r=node.getBoundingClientRect();return {width:node.clientWidth,scroll:node.scrollWidth,inside:[...node.querySelectorAll('button,input')].filter(item=>item.getClientRects().length).every(item=>{const box=item.getBoundingClientRect();return box.left>=r.left&&box.right<=r.right;})};});assert.ok(geometry.scroll<=geometry.width&&geometry.inside,JSON.stringify(geometry));
    await dialog.locator('#use-size').check();await dialog.locator('#cw').fill('200');await dialog.locator('#ch').fill('120');await dialog.locator('#preset-add').click();
    await dialog.locator('#custom-save').click();await expect(dialog).toHaveCount(0);
    const saved=await main.evaluate(()=>window.one.settings());assert.equal(saved.capture.custom.width,200);assert.ok(saved.capture.custom.presets.some(value=>value.width===200&&value.height===120));
    await main.locator('#custom-capture').click();await expect(dialog.locator('#cw')).toHaveValue('200');await dialog.locator('#custom-presets').click();await main.getByRole('option',{name:'200 × 120',exact:true}).click();
    await dialog.locator('#use-delay').check();await dialog.locator('#cd').fill('1');await dialog.locator('#custom-start').click();await expect(dialog.locator('.custom-capture-status')).toContainText('秒后截图');await main.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
    await main.waitForTimeout(1200);assert.equal((await main.evaluate(()=>window.one.captureState())).active,false);
    await main.locator('#custom-capture').click();await dialog.locator('#use-delay').uncheck();await dialog.locator('#custom-start').click();const custom=await captureWindow(),customData=await custom.evaluate(()=>window.one.capture.data());assert.deepEqual(customData.initialSelection,{x:Math.floor((customData.width-200)/2),y:Math.floor((customData.height-120)/2),width:200,height:120});await cancelCapture();
    await main.locator('[data-capture-action=import]').click();await expect.poll(()=>app.evaluate(()=>global.captureImports)).toBe(1);
    await app.evaluate(({desktopCapturer})=>{global.captureGetSources=desktopCapturer.getSources;desktopCapturer.getSources=async()=>{throw Error('Capture source verification failure');};});
    await main.locator('#composition-refresh').click();await expect(main.locator('.capture-error')).toContainText('Capture source verification failure');
    await app.evaluate(({desktopCapturer})=>{desktopCapturer.getSources=global.captureGetSources;});await main.locator('[data-capture-retry]').click();await expect(main.locator('#composition-stage')).toBeVisible();await expect(main.locator('.capture-error')).toBeHidden();
    const cdp=await main.context().newCDPSession(main);await cdp.send('HeapProfiler.collectGarbage');const before=await cdp.send('Memory.getDOMCounters');
    for(let i=0;i<8;i++){await main.locator('.nav[data-page=materials]').click();await nav.click();await expect(main.locator('#composition-stage')).toBeVisible();await main.locator('#composition-search').fill('One capture native verification');await expect(main.locator('.composition-source')).toHaveCount(2);}
    await cdp.send('HeapProfiler.collectGarbage');const after=await cdp.send('Memory.getDOMCounters');assert.ok(after.jsEventListeners<=before.jsEventListeners+8,JSON.stringify({before,after}));await cdp.detach();
    assert.deepEqual(errors,[]);
    console.log('Capture page: native route, keyboard modes, window/hide/cancel, two-window composition, 850px dark/150% custom dialog, presets/delay cancel/region, import cancellation, source retry and eight page reactivations passed. Listener delta: '+(after.jsEventListeners-before.jsEventListeners));
  }catch(error){if(errors.length)console.error('Renderer errors:',JSON.stringify(errors));throw error;}finally{
    if(app)await app.close();for(const child of fixtures)if(child.exitCode===null){const done=once(child,'close');child.stdin.write('quit\n');await done;}
    const actual=await fs.realpath(directory);assert.equal(path.dirname(actual),await fs.realpath(root));assert.ok(path.basename(actual).startsWith('capture-page-'));await fs.rm(actual,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
