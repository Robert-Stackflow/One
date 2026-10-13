const {_electron:electron,expect}=require('@playwright/test');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),{once}=require('node:events'),{createInterface}=require('node:readline');
async function run(){
  const native=process.argv.includes('--native'),unavailable=process.argv.includes('--unavailable-library');
  const root=path.resolve('work/current/capture-migration/recording-main'+(unavailable?'-unavailable':native?'-native':''));await fs.mkdir(root,{recursive:true});
  const profile=await fs.mkdtemp(path.join(root,'fixture-'));await fs.writeFile(path.join(profile,'.one-fixture'),'One recording main tests');
  const saved=path.join(root,path.basename(profile)+'.onerec'),errors=[];let app,probe,closed=false;
  try{
    if(unavailable)await fs.writeFile(path.join(profile,'materials'),'fixture: unavailable material library');
    else {probe=spawn(path.resolve('dist/native/One.CaptureProbe.exe'),['--fixture'],{windowsHide:true,stdio:'pipe'});const lines=createInterface({input:probe.stdout});await once(lines,'line');lines.close();}
    const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
    app=await electron.launch({args:[path.resolve('.')],env});
    const observed=new WeakSet();const observe=page=>{if(observed.has(page))return;observed.add(page);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>{errors.push('Unexpected browser dialog: '+dialog.type());void dialog.dismiss().catch(()=>{});});};
    app.on('window',observe);app.windows().forEach(observe);
    const main=await app.firstWindow();await main.waitForFunction(()=>!!window.one?.recording);
    if(unavailable){
      await main.locator('.nav[data-page=recording]').click();await expect(main.locator('.recording-page')).toBeVisible();
      await main.locator('.nav[data-page=materials]').click();await expect(main.locator('.materials-error')).toBeVisible();
      await assert.rejects(main.evaluate(()=>window.one.materialsImportRecording('video')));
      await main.locator('.nav[data-page=home]').click();await expect(main.locator('#page-name')).toHaveText('概览');
      const close=app.waitForEvent('close',{timeout:15000});await app.evaluate(({app})=>{setTimeout(()=>app.quit(),0);});await close;closed=true;
      const report={result:'PASS',actualOneMain:true,materialFailureContained:true,recordingPageAvailable:true,quitWithoutMaterialLibrary:true};await fs.writeFile(path.join(root,'result.json'),JSON.stringify(report)+'\n');console.log(JSON.stringify(report));return;
    }
    await app.evaluate(({dialog},saved)=>{
      global.quitAnswer=2;global.quitQuestions=0;global.saveQuestions=0;global.openQuestions=0;global.cancelSave=true;
      dialog.showMessageBox=async(_owner,options)=>{if(options.title==='退出 One'){global.quitQuestions++;return {response:global.quitAnswer,checkboxChecked:false};}throw Error('Unexpected dialog: '+options.message);};
      dialog.showSaveDialog=async(_owner,options)=>{if(options.filters[0].extensions[0]==='gif')return {canceled:false,filePath:saved+'.gif'};global.saveQuestions++;return {canceled:global.cancelSave,filePath:global.cancelSave?undefined:saved};};
      dialog.showOpenDialog=async()=>{global.openQuestions++;return {canceled:true,filePaths:[]};};
    },saved);
    const recordingNav=main.locator('.nav[data-page=recording]');await recordingNav.click();
    await expect(main.locator('#page-name')).toHaveText('录制');await expect(main.locator('.recording-page')).toHaveCount(1);
    assert.equal(await main.locator('#page-recording iframe,#page-recording webview').count(),0);
    assert.deepEqual(await main.locator('.sidebar-group[aria-label="截图与录制"] .nav').evaluateAll(nodes=>nodes.map(n=>n.dataset.page)),['capture','recording','materials','pins']);
    await main.locator('#recording-windows').click();
    const source=main.locator('#recording-sources button').filter({hasText:'One capture native verification'});await expect(source).toHaveCount(1,{timeout:20000});await source.click();
    await main.evaluate(()=>window.one.patchSettings({capture:{uiScale:150}}));await expect(main.locator('.recording-page')).toHaveAttribute('data-capture-scale','150');
    await expect(main.locator('#recording-heading-actions')).toHaveAttribute('data-capture-scale','150');
    assert.equal(await main.locator('.recording-page').evaluate(p=>p.scrollWidth>p.clientWidth+1),false);
    await main.evaluate(()=>window.one.patchSettings({capture:{uiScale:100}}));await expect(main.locator('.recording-page')).toHaveAttribute('data-capture-scale','100');
    await main.locator('#recording-record-container').click();await main.getByRole('option',{name:native?'MP4':'WebM',exact:true}).click();
    await main.evaluate(()=>{for(const id of ['recording-system-audio','recording-microphone']){const input=document.getElementById(id);input.checked=false;input.dispatchEvent(new Event('change',{bubbles:true}));}});
    await expect(main.locator('#recording-start')).toBeEnabled();
    // An owned path collision simulates a failed automatic material save; the user must still be able to save or cancel exit.
    const recordingDirectory=path.join(profile,'materials','recordings');await fs.rmdir(recordingDirectory);await fs.writeFile(recordingDirectory,'fixture: automatic save unavailable');
    await main.locator('#recording-start').click();
    const state=()=>main.evaluate(()=>window.one.recording.state());
    await expect.poll(async()=>{const value=await state();return value.phase==='recording'&&value.bytes>0;},{timeout:20000}).toBe(true);
    const before=(await state()).bytes;
    await main.locator('.nav[data-page=materials]').click();
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('?view=main')).hide());
    await expect.poll(async()=>(await state()).bytes,{timeout:15000}).toBeGreaterThan(before);
    assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('?view=main')).webContents.getBackgroundThrottling()),false);
    await app.evaluate(({app})=>{setTimeout(()=>app.quit(),0);});
    await expect.poll(()=>app.evaluate(()=>global.quitQuestions),{timeout:25000}).toBe(1);
    await expect.poll(async()=>(await state()).phase).toBe('ready');assert.ok((await state()).bytes>before);
    await fs.unlink(recordingDirectory);await fs.mkdir(recordingDirectory);
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('?view=main')).show());
    await recordingNav.click();assert.ok((await main.evaluate(()=>window.one.recording.sources('window'))).length>0);
    assert.equal(await main.locator('.recording-page').evaluate(p=>p.scrollWidth>p.clientWidth+1),false);
    await main.evaluate(()=>window.one.recording.openPlayer());
    let player;await expect.poll(()=>{player=app.windows().find(p=>p.url().endsWith('?view=recording-player'));return !!player;}).toBe(true);
    await player.waitForFunction(()=>document.getElementById('preview')?.videoWidth>0);
    assert.equal(await player.evaluate(()=>{const video=document.getElementById('preview'),canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;const ctx=canvas.getContext('2d');ctx.drawImage(video,0,0);return ctx.getImageData(0,0,1,1).data.length;}),4);
    assert.equal(await player.evaluate(()=>typeof window.one.recordingPlayer.state),'function');
    assert.equal(await player.evaluate(()=>window.one.recording===undefined),true);
    if(native){
      await player.locator('[aria-controls=export-settings]').click();await player.locator('#export-format').click();await player.getByRole('option',{name:'GIF',exact:true}).click();
      await expect(player.locator('#export-start')).toBeEnabled();await player.locator('#export-start').click();
      await expect.poll(async()=>(await state()).export?.phase,{timeout:45000}).toBe('saved');
      assert.match((await fs.readFile(saved+'.gif')).subarray(0,6).toString(),/^GIF8[79]a$/);await fs.copyFile(saved+'.gif',path.join(root,'composed.gif'));
    }
    const media=(await state()).url;
    assert.equal(await app.evaluate(async({BrowserWindow},url)=>{const w=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true}});try{await w.loadURL('one://app/index.html?view=recording-region-outline');return await w.webContents.executeJavaScript(`fetch(${JSON.stringify(url)}).then(()=>false,()=>true)`);}finally{w.destroy();}},media),true);
    await app.evaluate(({app})=>{global.quitAnswer=0;setTimeout(()=>app.quit(),0);});
    await expect.poll(()=>app.evaluate(()=>global.saveQuestions)).toBe(1);
    await expect.poll(async()=>{try{await main.evaluate(()=>window.one.recording.sources('window'));return true;}catch{return false;}}).toBe(true);
    assert.equal((await state()).phase,'ready');assert.deepEqual(errors,[]);
    await main.locator('.nav[data-page=materials]').click();await main.locator('#material-recordings').click();
    const importVideo=main.locator('[data-material-action=import-video]');await expect(importVideo).toBeEnabled();await importVideo.click();
    await expect.poll(()=>app.evaluate(()=>global.openQuestions)).toBe(1);await expect(importVideo).toBeEnabled();
    const close=app.waitForEvent('close',{timeout:25000});await app.evaluate(({app})=>{global.cancelSave=false;setTimeout(()=>app.quit(),0);});await close;closed=true;
    assert.deepEqual(errors,[]);
    assert.equal((await fs.readFile(saved)).subarray(0,8).toString(),'ONERECRD');
    await fs.copyFile(saved,path.join(root,'saved.onerec'));
    const report={result:'PASS',actualOneMain:true,nativeRoute:true,windowCaptureFixture:true,container:native?'mp4':'webm',centralDisplayPermission:!native,nativeWgc:native,productionGifExport:native,hiddenCaptureContinued:true,tailDrained:true,quitCancelled:true,saveCancelled:true,saveAndQuit:true,productionPlayer:true,resourceIsolation:true,materialImportCancel:true};
    await fs.writeFile(path.join(root,'result.json'),JSON.stringify(report)+'\n');console.log(JSON.stringify(report));
  }catch(error){
    const page=app?.windows().find(p=>p.url().endsWith('?view=main'));
    const detail={error:String(error.stack||error),state:await page?.evaluate(()=>window.one.recording.state()).catch(e=>String(e)),windows:await app?.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>({url:w.webContents.getURL(),visible:w.isVisible()}))).catch(()=>[]),dialogs:await app?.evaluate(()=>({quit:global.quitQuestions,save:global.saveQuestions})).catch(()=>null)};
    await fs.writeFile(path.join(root,'failure.log'),JSON.stringify(detail,null,2));
    const logDirectory=path.join(profile,'logs');for(const file of await fs.readdir(logDirectory).catch(()=>[])){if(/error|runtime/.test(file)){const data=await fs.readFile(path.join(logDirectory,file),'utf8').catch(()=>'');await fs.writeFile(path.join(root,'last-'+file),data.slice(-12000));}}
    throw error;
  }
  finally{
    if(app&&!closed){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}
    if(probe&&probe.exitCode===null){probe.kill();await once(probe,'exit').catch(()=>{});}
    const actual=await fs.realpath(profile);assert.equal(path.dirname(actual),await fs.realpath(root));assert.ok(path.basename(actual).startsWith('fixture-'));assert.equal(await fs.readFile(path.join(actual,'.one-fixture'),'utf8'),'One recording main tests');await fs.rm(actual,{recursive:true,force:true});for(const file of [saved,saved+'.gif'])await fs.unlink(file).catch(error=>{if(error.code!=='ENOENT')throw error;});
  }
}
run().catch(error=>{console.error(String(error.stack||error).slice(0,3500));process.exitCode=1;});
