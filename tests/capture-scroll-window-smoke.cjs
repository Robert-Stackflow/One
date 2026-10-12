const {_electron:electron,expect}=require('@playwright/test');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),{once}=require('node:events'),{createInterface}=require('node:readline');
const sharp=require('sharp'),buildFixture=require('./capture/build-scroll-fixture.cjs');
function expected(width,height){const pixels=Buffer.alloc(width*height*4);for(let y=0;y<height;y++)for(let x=0;x<width;x++){let v=Math.imul(x+17,1103515245)^Math.imul(y+31,2654435761);v^=v>>>13;v=Math.imul(v,2246822519);v^=v>>>16;pixels.set([(v>>>16)&255,(v>>>8)&255,v&255,255],(y*width+x)*4);}return pixels;}
(async()=>{
  const root=path.resolve('work/current/capture-migration');await fs.mkdir(root,{recursive:true});const directory=await fs.mkdtemp(path.join(root,'scroll-window-'));
  let app,fixture,lines,target;const errors=[];
  try{
    const executable=await buildFixture(directory);fixture=spawn(executable,[],{windowsHide:true,stdio:'pipe'});lines=createInterface({input:fixture.stdout});target=JSON.parse((await once(lines,'line'))[0]);
    const fixtureCommand=async command=>{const next=once(lines,'line');fixture.stdin.write(command+'\n');target=JSON.parse((await next)[0]);};
    const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:path.join(directory,'profile')};delete env.ELECTRON_RUN_AS_NODE;
    app=await electron.launch({args:[path.resolve('.')],env});app.on('window',page=>page.on('pageerror',error=>errors.push(page.url()+' '+(error.stack||String(error)))));
    const main=await app.firstWindow();await main.waitForFunction(()=>!!window.one?.captureScroll);
    async function visible(view){
      let id;await expect.poll(async()=>id=await app.evaluate(({BrowserWindow},view)=>BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().endsWith('?view='+view)&&window.isVisible())?.webContents.id||0,view),{timeout:15000}).toBeGreaterThan(0);
      for(const page of app.windows().filter(page=>page.url().endsWith('?view='+view)&&!page.isClosed())){try{const handle=await app.browserWindow(page),actual=await handle.evaluate(window=>window.webContents.id);await handle.dispose();if(actual===id)return page;}catch{}}
      throw Error('Missing visible '+view);
    }
    async function begin(){
      await fixtureCommand('step 0');await fixtureCommand('focus');
      await main.locator('.nav[data-page=capture]').click();await main.locator('#capture-modes').getByRole('tab',{name:'长截图',exact:true}).click();await expect(main.locator('#take-capture')).toBeEnabled();
      await main.locator('#take-capture-menu').click();await main.locator('#take-capture-hide').click();
      const select=await visible('capture');await select.waitForFunction(()=>document.body.dataset.captureReady==='true');
      const physical=await app.evaluate(({screen},target)=>{const d=screen.getDisplayNearestPoint(screen.screenToDipPoint({x:target.x,y:target.y}));return screen.dipToScreenRect(null,d.bounds);},target);
      await select.evaluate(rect=>{setTimeout(()=>void window.one.capture.data().then(data=>window.one.capture.complete({token:data.token,actions:[],selection:rect})).catch(()=>{}),20);},{x:target.x-physical.x,y:target.y-physical.y,width:target.width,height:target.height});
      const control=await visible('scroll-capture');await control.waitForFunction(()=>document.body.dataset.scrollReady==='true'||!!document.body.dataset.scrollError);assert.equal(await control.evaluate(()=>document.body.dataset.scrollError||''),'');
      const state=await control.evaluate(()=>window.one.scrollCapture.state());assert.deepEqual(state.source,{width:target.width,height:target.height});
      await control.locator('#trim-start').fill('20');await control.locator('#trim-end').fill('12');return control;
    }
    const control=await begin();assert.equal(await control.evaluate(()=>typeof window.one.settings),'undefined');
    await assert.rejects(control.evaluate(()=>window.one.scrollCapture.command('stale',{kind:'sample'})),/失效/);
    await assert.rejects(app.evaluate(async({ipcMain,BrowserWindow})=>{const sender=BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().endsWith('?view=main')).webContents;return ipcMain._invokeHandlers.get('one:scroll-state')({sender,senderFrame:sender.mainFrame});}),/调用来源无效/);
    await control.locator('#sample').click();await expect.poll(()=>control.evaluate(()=>window.one.scrollCapture.state().then(value=>value.count))).toBe(1);
    await fixtureCommand('step 57');await control.locator('#sample').click();await expect.poll(()=>control.evaluate(()=>window.one.scrollCapture.state().then(value=>value.count))).toBe(2);
    await main.evaluate(()=>window.one.patchSettings({capture:{uiScale:150}}));await expect(control.locator('body')).toHaveAttribute('data-capture-scale','150');
    await require('sharp')(await control.screenshot({scale:'css'})).resize({width:800,height:1000,fit:'inside',withoutEnlargement:true}).png().toFile(path.join(root,'scroll-control.png'));
    await app.evaluate(({app})=>app.quit());const confirmation=control.getByRole('dialog',{name:'退出 One',exact:true});await expect(confirmation).toBeVisible();await confirmation.getByRole('button',{name:'取消',exact:true}).click();await expect(confirmation).toHaveCount(0);
    assert.equal((await control.evaluate(()=>window.one.scrollCapture.state())).count,2);
    await control.locator('#undo').click();await expect.poll(()=>control.evaluate(()=>window.one.scrollCapture.state().then(value=>value.count))).toBe(1);await control.locator('#sample').click();await expect.poll(()=>control.evaluate(()=>window.one.scrollCapture.state().then(value=>value.count))).toBe(2);
    await control.locator('#finish').click();await expect.poll(()=>control.evaluate(()=>window.one.scrollCapture.state().then(value=>value.phase))).toBe('review');
    await control.evaluate(()=>{setTimeout(()=>document.getElementById('edit').click(),20);});const editor=await visible('image-editor');await editor.waitForFunction(()=>document.body.dataset.editorReady==='true');
    const png=Buffer.from(await editor.evaluate(async()=>{const state=await window.one.imageEditor.state();return [...new Uint8Array(await(await fetch(state.url)).arrayBuffer())];}));const {data,info}=await sharp(png).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    assert.equal(info.width,target.width);assert.equal(info.height,target.height-32+57);assert.deepEqual(data,expected(info.width,info.height));assert.equal((await main.evaluate(()=>window.one.materialsState())).images.length,1);
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().endsWith('?view=image-editor')).close());await expect.poll(()=>editor.isClosed()).toBe(true);
    const next=await begin();await next.locator('#sample').click();await expect.poll(()=>next.evaluate(()=>window.one.scrollCapture.state().then(value=>value.count))).toBe(1);
    await app.evaluate(({app})=>app.quit());const quit=next.getByRole('dialog',{name:'退出 One',exact:true});await expect(quit).toBeVisible();
    const ended=once(app.process(),'exit');await quit.getByRole('button',{name:'放弃并退出',exact:true}).evaluate(button=>{setTimeout(()=>button.click(),20);});const [code]=await ended;assert.equal(code,0);app=undefined;assert.deepEqual(errors,[]);
    console.log('Scroll capture: actual One page/selection/native pixels/worker, restricted bridge, two-frame exact output, trim/undo/review/editor/material, scale, cancelled exit recovery and confirmed exit passed.');
  }catch(error){if(errors.length)console.error('Renderer errors:',JSON.stringify(errors));throw error;}finally{
    if(app){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}
    if(fixture&&fixture.exitCode===null){const closed=once(fixture,'close');fixture.stdin.write('quit\n');await closed;}lines?.close();
    const actual=await fs.realpath(directory);assert.equal(path.dirname(actual),await fs.realpath(root));assert.ok(path.basename(actual).startsWith('scroll-window-'));await fs.rm(actual,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
