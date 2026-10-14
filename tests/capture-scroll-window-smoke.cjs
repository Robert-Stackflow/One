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
    app=await electron.launch({args:[path.resolve('.')],env});app.process().stdout.on('data',chunk=>{const text=String(chunk);if(text.includes('Scroll activation'))process.stdout.write(text.slice(0,1500));});app.on('window',page=>page.on('pageerror',error=>errors.push(page.url()+' '+(error.stack||String(error)))));
    const main=await app.firstWindow();await main.waitForFunction(()=>!!window.one?.captureScroll);
    async function visible(view){
      let id;await expect.poll(async()=>id=await app.evaluate(({BrowserWindow},view)=>BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().endsWith('?view='+view)&&window.isVisible())?.webContents.id||0,view),{timeout:15000}).toBeGreaterThan(0);
      for(const page of app.windows().filter(page=>page.url().endsWith('?view='+view)&&!page.isClosed())){try{const handle=await app.browserWindow(page),actual=await handle.evaluate(window=>window.webContents.id);await handle.dispose();if(actual===id)return page;}catch{}}
      throw Error('Missing visible '+view);
    }
    async function nativeClick(page,selector){
      const button=await page.locator(selector).boundingBox();assert.ok(button);const handle=await app.browserWindow(page),bounds=await handle.evaluate(window=>window.getContentBounds());await handle.dispose();
      const point=await app.evaluate(({screen},point)=>screen.dipToScreenPoint(point),{x:Math.round(bounds.x+button.x+button.width/2),y:Math.round(bounds.y+button.y+button.height/2)});
      await fixtureCommand('click '+point.x+' '+point.y);
    }
    async function begin(handoff=false){
      await fixtureCommand('step 0');await fixtureCommand('focus');
      await main.locator('.nav[data-page=capture]').click();await main.locator('#capture-modes').getByRole('tab',{name:handoff?'区域':'长截图',exact:true}).click();await expect(main.locator('#take-capture')).toBeEnabled();
      await main.locator('#take-capture-menu').click();await main.locator('#take-capture-hide').click();
      const select=await visible('capture');await select.waitForFunction(()=>document.body.dataset.captureReady==='true');
      const physical=await app.evaluate(({screen},target)=>{const d=screen.getDisplayNearestPoint(screen.screenToDipPoint({x:target.x,y:target.y}));return screen.dipToScreenRect(null,d.bounds);},target);
      const rect={x:target.x-physical.x,y:target.y-physical.y,width:target.width,height:target.height};
      if(handoff){const data=await select.evaluate(()=>window.one.capture.data());assert.equal(data.canScroll,true);const ratio=await select.evaluate(()=>({x:innerWidth,y:innerHeight}));await select.mouse.move(rect.x/data.width*ratio.x,rect.y/data.height*ratio.y);await select.mouse.down();await select.mouse.move((rect.x+rect.width)/data.width*ratio.x,(rect.y+rect.height)/data.height*ratio.y,{steps:5});await select.mouse.up();await select.locator('#capture-more').click();await expect(select.locator('#start-scroll')).toBeVisible();await select.locator('#start-scroll').click();
      }else await select.evaluate(rect=>{setTimeout(()=>void window.one.capture.data().then(data=>window.one.capture.complete({token:data.token,actions:[],selection:rect})).catch(()=>{}),20);},rect);
      const control=await visible('scroll-capture');await control.waitForFunction(()=>document.body.dataset.scrollReady==='true'||!!document.body.dataset.scrollError);assert.equal(await control.evaluate(()=>document.body.dataset.scrollError||''),'');
      const state=await control.evaluate(()=>window.one.scrollCapture.state());assert.deepEqual(state.source,{width:target.width,height:target.height});
      await control.evaluate(async()=>{const state=await window.one.scrollCapture.state();await window.one.scrollCapture.command(state.token,{kind:'pause'});});await control.locator('#setup').evaluate(node=>{node.open=true;});await expect(control.locator('#trim-start')).toBeEnabled();await control.locator('#trim-start').fill('20');await control.locator('#trim-end').fill('12');await control.locator('#apply-settings').click();const confirmation=control.getByRole('dialog',{name:'重新开始长截图',exact:true});if(await confirmation.isVisible())await confirmation.getByRole('button',{name:'重新开始',exact:true}).click();await expect(control.locator('#setup')).not.toHaveAttribute('open');return control;
    }
    const control=await begin(true);assert.equal(await control.evaluate(()=>typeof window.one.settings),'undefined');
    await assert.rejects(control.evaluate(()=>window.one.scrollCapture.command('stale',{kind:'sample'})),/失效/);
    await assert.rejects(app.evaluate(async({ipcMain,BrowserWindow})=>{const sender=BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().endsWith('?view=main')).webContents;return ipcMain._invokeHandlers.get('one:scroll-state')({sender,senderFrame:sender.mainFrame});}),/调用来源无效/);
    await nativeClick(control,'#manual');await expect.poll(()=>control.evaluate(()=>window.one.scrollCapture.state().then(value=>value.count)),{timeout:10000}).toBe(1);
    await fixtureCommand('step 57');await expect.poll(()=>control.evaluate(()=>window.one.scrollCapture.state().then(value=>value.count)),{timeout:10000}).toBe(2);await control.locator('#pause').click();
    const markers=await control.evaluate(()=>({viewport:parseFloat(document.getElementById('preview-viewport').style.height),addition:parseFloat(document.getElementById('preview-addition').style.height)}));assert.ok(Math.abs(markers.viewport-328/385*100)<.01);assert.ok(Math.abs(markers.addition-57/385*100)<.01);
    await control.locator('#preview-toggle').click();await expect(control.locator('.scroll-preview')).toBeHidden();await control.locator('#preview-toggle').click();await expect(control.locator('#preview-paper')).toBeVisible();
    await main.evaluate(()=>window.one.patchSettings({capture:{uiScale:150}}));await expect(control.locator('body')).toHaveAttribute('data-capture-scale','150');
    await expect.poll(()=>control.locator('main').evaluate(node=>node.scrollHeight-node.clientHeight)).toBeLessThanOrEqual(1);
    await require('sharp')(await control.screenshot({scale:'css'})).resize({width:800,height:1000,fit:'inside',withoutEnlargement:true}).png().toFile(path.join(root,'scroll-control.png'));
    await app.evaluate(({app})=>app.quit());const confirmation=control.getByRole('dialog',{name:'退出 One',exact:true});await expect(confirmation).toBeVisible();await confirmation.getByRole('button',{name:'取消',exact:true}).click();await expect(confirmation).toHaveCount(0);
    assert.equal((await control.evaluate(()=>window.one.scrollCapture.state())).count,2);
    await control.locator('#undo').click();await expect.poll(()=>control.evaluate(()=>window.one.scrollCapture.state().then(value=>value.count))).toBe(1);await nativeClick(control,'#manual');await expect.poll(()=>control.evaluate(()=>window.one.scrollCapture.state().then(value=>value.count)),{timeout:10000}).toBe(2);await control.locator('#pause').click();
    await control.locator('#finish').click();await expect.poll(()=>control.evaluate(()=>window.one.scrollCapture.state().then(value=>value.phase))).toBe('review');
    await control.evaluate(()=>{setTimeout(()=>document.getElementById('edit').click(),20);});const editor=await visible('image-editor');await editor.waitForFunction(()=>document.body.dataset.editorReady==='true');
    const png=Buffer.from(await editor.evaluate(async()=>{const state=await window.one.imageEditor.state();return [...new Uint8Array(await(await fetch(state.url)).arrayBuffer())];}));const {data,info}=await sharp(png).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    assert.equal(info.width,target.width);assert.equal(info.height,target.height-32+57);assert.deepEqual(data,expected(info.width,info.height));assert.equal((await main.evaluate(()=>window.one.materialsState())).images.length,1);
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().endsWith('?view=image-editor')).close());await expect.poll(()=>editor.isClosed()).toBe(true);
    const next=await begin();await nativeClick(next,'#manual');await expect.poll(()=>next.evaluate(()=>window.one.scrollCapture.state().then(value=>value.count)),{timeout:10000}).toBe(1);await next.locator('#pause').click();
    await nativeClick(next,'#auto');await expect.poll(()=>next.evaluate(()=>window.one.scrollCapture.state().then(value=>value.count)),{timeout:10000}).toBeGreaterThan(1);await next.locator('#pause').click();
    const automatic=await next.evaluate(()=>window.one.scrollCapture.state());assert.equal(automatic.mode,'auto');await fixtureCommand('state');assert.ok(target.offsetY>0,'native automatic wheel input must move the confirmed target');
    await nativeClick(next,'#manual');await expect.poll(()=>next.evaluate(()=>window.one.scrollCapture.state().then(value=>value.phase))).toBe('running');await fixtureCommand('step '+Math.min(180,target.offsetY+17));await expect.poll(()=>next.evaluate(()=>window.one.scrollCapture.state().then(value=>value.count)),{timeout:10000}).toBe(automatic.count+1);await next.locator('#pause').click();assert.equal((await next.evaluate(()=>window.one.scrollCapture.state())).mode,'manual');
    await app.evaluate(({app})=>app.quit());const quit=next.getByRole('dialog',{name:'退出 One',exact:true});await expect(quit).toBeVisible();
    const ended=once(app.process(),'exit');await quit.getByRole('button',{name:'放弃并退出',exact:true}).evaluate(button=>{setTimeout(()=>button.click(),20);});const [code]=await ended;assert.equal(code,0);app=undefined;assert.deepEqual(errors,[]);
    console.log('Scroll capture: normal screenshot handoff, manual monitoring, native automatic scrolling and manual continuation, preview markers/collapse, exact pixels, trim/undo/review/editor/material, scale and exit recovery passed.');
  }catch(error){if(app){const page=app.windows().find(page=>page.url().endsWith('?view=scroll-capture'));if(page)console.error('Scroll diagnostic:',await page.evaluate(async()=>{const state=await window.one.scrollCapture.state();return {phase:state.phase,mode:state.mode,count:state.count,source:state.source,options:state.options,message:state.message};}).catch(()=>null));}if(errors.length)console.error('Renderer errors:',JSON.stringify(errors));throw error;}finally{
    if(app){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}
    if(fixture&&fixture.exitCode===null){const closed=once(fixture,'close');fixture.stdin.write('quit\n');await closed;}lines?.close();
    const actual=await fs.realpath(directory);assert.equal(path.dirname(actual),await fs.realpath(root));assert.ok(path.basename(actual).startsWith('scroll-window-'));await fs.rm(actual,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
