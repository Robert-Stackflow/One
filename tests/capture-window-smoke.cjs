const {_electron:electron,expect}=require('@playwright/test');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),{once}=require('node:events'),{createInterface}=require('node:readline');
(async()=>{
  const root=path.resolve('work/current/capture-migration');await fs.mkdir(root,{recursive:true});
  const directory=await fs.mkdtemp(path.join(root,'capture-window-')),profile=path.join(directory,'profile'),exported=path.join(directory,'capture.png');
  const frameName=path.basename(directory)+'-child.html',frameFile=path.resolve('dist/renderer',frameName);
  let app,fixture;const errors=[];
  try{
    await fs.writeFile(frameFile,'<!doctype html><html><body>One capture resource isolation fixture</body></html>',{flag:'wx'});
    fixture=spawn(path.resolve('dist/native/One.CaptureProbe.exe'),['--fixture'],{windowsHide:true,stdio:'pipe'});
    const lines=createInterface({input:fixture.stdout});const [line]=await once(lines,'line');const target=JSON.parse(line);lines.close();
    const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
    app=await electron.launch({args:[path.resolve('.')],env});app.on('window',page=>page.on('pageerror',error=>errors.push(page.url()+' '+(error.stack||String(error)))));
    const main=await app.firstWindow();await main.waitForFunction(()=>!!window.one?.captureWindows);
    await app.evaluate(({clipboard,dialog},exported)=>{
      global.captureCopies=[];global.captureCancelSave=true;
      clipboard.write=async items=>{for(const item of items)global.captureCopies.push(Buffer.from(await(await item.getType('image/png')).arrayBuffer()));};
      dialog.showSaveDialog=async()=>global.captureCancelSave?{canceled:true,filePath:undefined}:{canceled:false,filePath:exported};
    },exported);
    await main.evaluate(async()=>{const settings=await window.one.settings();const preset={...settings.capture.workflows[0],id:'integration',name:'复制、保存、贴图',actions:['copy','save','pin']};await window.one.patchSettings({capture:{workflows:[preset],workflowId:preset.id}});});
    async function start(){
      const choices=await main.evaluate(()=>window.one.captureWindows());const choice=choices.find(item=>item.name==='One capture native verification');assert.ok(choice,'Owned fixture must appear in window sources');
      await main.evaluate(token=>{window.captureFinished=false;window.captureFailure='';window.captureOutcome=undefined;void window.one.captureWindow(token,{hideMainWindow:true}).then(value=>{window.captureOutcome=value;window.captureFinished=true;},error=>{window.captureFailure=String(error);window.captureFinished=true;});},choice.token);
      let id;await expect.poll(async()=>id=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().endsWith('?view=capture')&&window.isVisible())?.webContents.id||0),{timeout:15000}).toBeGreaterThan(0);
      let capture;for(const page of app.windows().filter(page=>page.url().endsWith('?view=capture')&&!page.isClosed())){try{const handle=await app.browserWindow(page);const candidate=await handle.evaluate(window=>window.webContents.id);await handle.dispose();if(candidate===id){capture=page;break;}}catch{}}
      assert.ok(capture,'Visible capture owner must have a page');
      await capture.waitForFunction(()=>document.body.dataset.captureReady==='true'||!!document.body.dataset.captureError,{},{timeout:15000}).catch(async error=>{console.error('Capture init:',await main.evaluate(()=>window.captureFailure),await capture.evaluate(()=>({error:document.body.dataset.captureError,text:document.body.innerText.slice(0,900)})));throw error;});
      assert.equal(await capture.evaluate(()=>document.body.dataset.captureError||''),'');return capture;
    }
    let capture=await start();const data=await capture.evaluate(()=>window.one.capture.data());
    assert.equal(data.width,target.window.width);assert.equal(data.height,target.window.height);
    assert.equal(await capture.evaluate(()=>typeof window.one.settings),'undefined');
    await assert.rejects(capture.evaluate(()=>window.one.capture.selectFont('expired','Arial')),/字体选择无效/);
    assert.equal(await main.evaluate(async url=>{try{return(await fetch(url)).ok;}catch{return false;}},data.image),false);
    await capture.evaluate(frameName=>{const child=document.createElement('iframe');child.src='one://app/'+frameName;child.id='capture-test-frame';child.style.cssText='position:absolute;width:1px;height:1px';document.body.append(child);},frameName);
    await expect.poll(()=>capture.frames().length).toBe(2);const child=capture.frames().find(frame=>frame.parentFrame());await child.waitForURL('one://app/'+frameName);
    assert.equal(await child.evaluate(async url=>{try{return(await fetch(url)).ok;}catch{return false;}},data.image),false);
    await capture.evaluate(()=>document.getElementById('capture-test-frame').remove());
    const originalHash=await capture.evaluate(async url=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await(await fetch(url)).arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join(''),data.image);
    await expect(capture.locator('#capture-actions')).toBeVisible();
    await capture.locator('[data-tool=rectangle]:visible').click();const selection=await capture.locator('#selection').boundingBox();assert.ok(selection);
    await capture.mouse.move(selection.x+45,selection.y+45);await capture.mouse.down();await capture.mouse.move(selection.x+180,selection.y+110,{steps:5});await capture.mouse.up();
    await expect(capture.locator('#undo')).toBeEnabled();
    await capture.locator('[data-tool=text]:visible').click();await capture.mouse.click(selection.x+60,selection.y+145);
    await capture.locator('#capture-text-value').fill('One 截图标注');await capture.locator('#capture-text-value').press('Control+Enter');
    const fonts=await capture.evaluate(()=>window.one.capture.fonts());const font=fonts.find(item=>item.family==='Arial')||fonts.find(item=>item.family!=='Segoe UI');assert.ok(font);
    await assert.rejects(capture.evaluate(family=>window.one.uiFontSource(family),font.family),/字体未被选择/);
    await capture.locator('#mark-family').click();await capture.getByRole('option',{name:font.label,exact:true}).click();
    await expect.poll(()=>capture.evaluate(family=>window.one.uiFontSource(family).then(()=>true,()=>false),font.family)).toBe(true);
    await main.evaluate(()=>window.one.patchSettings({capture:{uiScale:150}}));await expect(capture.locator('body')).toHaveAttribute('data-capture-scale','150');
    const geometry=await capture.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(geometry.scroll<=geometry.width);
    await main.evaluate(()=>window.one.patchSettings({capture:{uiScale:100}}));await expect(capture.locator('body')).toHaveAttribute('data-capture-scale','100');
    await require('sharp')(await capture.screenshot({scale:'css'})).resize({width:1280,height:1280,fit:'inside',withoutEnlargement:true}).png().toFile(path.join(root,'capture-window.png'));
    await capture.locator('#capture-more').click();await expect(capture.locator('#capture-workflow-choice')).toContainText('复制、保存、贴图');
    await capture.locator('#run-workflow').click();await expect.poll(()=>app.evaluate(()=>global.captureCopies.length)).toBe(1);
    await expect(capture.locator('#run-workflow')).toBeEnabled();assert.equal(await main.evaluate(()=>window.captureFinished),false);
    await app.evaluate(()=>{global.captureCancelSave=false;});
    // A successful output destroys this native window immediately.
    if(!await capture.locator('#capture-more-menu').evaluate(node=>node.matches(':popover-open')))await capture.locator('#capture-more').click();
    await capture.locator('#run-workflow').dispatchEvent('click');await expect.poll(()=>main.evaluate(()=>window.captureFinished)).toBe(true);
    assert.equal(await main.evaluate(()=>window.captureFailure),'');assert.equal(await app.evaluate(()=>global.captureCopies.length),1);
    assert.deepEqual(await fs.readFile(exported),Buffer.from(await app.evaluate(()=>[...global.captureCopies[0]])));
    const state=await main.evaluate(()=>window.one.materialsState());assert.equal(state.images.length,1);
    const pins=await main.evaluate(()=>window.one.pinsState());assert.equal(pins.pins.length,1);await main.evaluate(()=>window.one.pinsToggle());
    await main.evaluate(id=>window.one.materialsEditImage(id),state.images[0].id);
    const editor=app.windows().find(page=>page.url().endsWith('?view=image-editor'));assert.ok(editor);await editor.waitForFunction(()=>document.body.dataset.editorReady==='true');
    const project=await editor.evaluate(()=>window.one.imageEditor.state());assert.equal(project.document.annotations.length,2);
    const savedHash=await editor.evaluate(async()=>{const item=await window.one.imageEditor.state();return[...new Uint8Array(await crypto.subtle.digest('SHA-256',await(await fetch(item.url)).arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join('');});assert.equal(savedHash,originalHash);
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().endsWith('?view=image-editor')).close());await expect.poll(()=>editor.isClosed()).toBe(true);
    capture=await start();assert.equal(await capture.evaluate(async url=>{try{return(await fetch(url)).ok;}catch{return false;}},data.image),false);await capture.evaluate(()=>{setTimeout(()=>document.getElementById('cancel').click(),20);});await expect.poll(()=>main.evaluate(()=>window.captureFinished)).toBe(true);assert.equal(await main.evaluate(()=>window.captureFailure),'');assert.equal(await main.evaluate(()=>window.captureOutcome),null);assert.equal((await main.evaluate(()=>window.one.materialsState())).images.length,1);
    capture=await start();
    await app.close();app=undefined;assert.equal(capture.isClosed(),true);
    assert.deepEqual(errors,[]);
    console.log('Capture window: One restricted bridge/resources, native window source, annotation, cancel/retry receipts, original preservation, material/editor/pin delivery, cancellation and active-capture quit passed.');
  }catch(error){if(errors.length)console.error('Renderer errors:',JSON.stringify(errors));throw error;}finally{
    if(app)await app.close();if(fixture&&fixture.exitCode===null){const done=once(fixture,'close');fixture.stdin.write('quit\n');await done;}
    await fs.rm(frameFile,{force:true});
    const actual=await fs.realpath(directory);assert.equal(path.dirname(actual),await fs.realpath(root));assert.ok(path.basename(actual).startsWith('capture-window-'));await fs.rm(actual,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
