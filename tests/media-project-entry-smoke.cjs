const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{buildSync}=require('esbuild');
const {_electron:electron,expect}=require('@playwright/test');
const execute=require('node:util').promisify(require('node:child_process').execFile);
const fixture={exports:{}},bundle=buildSync({entryPoints:['tests/capture/system-entry-fixtures.ts'],bundle:true,platform:'node',format:'cjs',write:false,external:['koffi']});
new Function('module','exports','require',bundle.outputFiles[0].text)(fixture,fixture.exports,require);

async function run(){
  const out=path.resolve(process.env.ONE_TEST_OUTPUT_DIR||'work/current/capture-migration/media-project-entry');await fs.mkdir(out,{recursive:true});
  const root=await fs.mkdtemp(path.join(out,'fixture-')),files=await fixture.exports.createEntryFixtures(root),apps=[],errors=[];
  const originals=new Map(await Promise.all(Object.values(files).map(async file=>[file,await fs.readFile(file)])));
  async function launch(args,name){
    const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:path.join(root,name)};delete env.ELECTRON_RUN_AS_NODE;
    const app=await electron.launch({args:[path.resolve('.'),...args],env});apps.push(app);
    for(const page of app.windows())page.on('pageerror',error=>errors.push(String(error)));
    app.on('window',page=>page.on('pageerror',error=>errors.push(String(error))));
    return app;
  }
  async function pageFor(app,role){
    await expect.poll(()=>app.windows().some(page=>page.url().includes(`view=${role}`)),{timeout:20000}).toBe(true);
    return app.windows().find(page=>page.url().includes(`view=${role}`));
  }
  const dialogs=app=>app.evaluate(()=>globalThis.oneEntryDialogs);
  const invoke=(app,args,directory=root)=>app.evaluate(({app},{args,directory})=>app.emit('second-instance',{},args,directory,{}),{args,directory});
  async function nativeInvoke(app,args){
    assert.equal(await app.evaluate(({app})=>app.requestSingleInstanceLock()),true);
    const sender=path.join(root,'second-instance.cjs');
    await fs.writeFile(sender,"const {app}=require('electron');app.setPath('userData',process.env.ONE_ENTRY_PROFILE);if(app.requestSingleInstanceLock()){console.error('Primary One lock was not found');app.exit(2);}else app.quit();\n");
    const env={...process.env,ONE_ENTRY_PROFILE:await app.evaluate(({app})=>app.getPath('userData'))};delete env.ELECTRON_RUN_AS_NODE;
    await execute(require('electron'),[sender,...args],{cwd:root,env,windowsHide:true,timeout:15000,maxBuffer:64*1024});
  }
  const ready=(page,previous='')=>expect.poll(async()=>{const state=await page.evaluate(()=>window.one.recording.state());return state.phase==='ready'&&!state.projectBusy&&!!state.token&&state.token!==previous;},{timeout:20000}).toBe(true);
  try{
    const app=await launch([files.image,`--one-project=${files.image}`],'cold-image');
    const main=await pageFor(app,'main'),image=await pageFor(app,'image-editor');await image.waitForFunction(()=>!!window.one?.imageEditor);
    const imageState=await image.evaluate(()=>window.one.imageEditor.state());
    assert.equal(imageState.name,'启动 中文 图');assert.equal(imageState.document.effects.border.color,'#123456');assert.ok(imageState.history);
    assert.equal(app.windows().filter(page=>page.url().includes('view=image-editor')).length,1);
    assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().includes('view=main')).isVisible()),false);
    await app.evaluate(({dialog})=>{
      globalThis.oneEntryDialogs=[];globalThis.oneEntryResponse=0;
      dialog.showMessageBox=async(_owner,options)=>{globalThis.oneEntryDialogs.push(options);return {response:globalThis.oneEntryResponse,checkboxChecked:false};};
    });
    await image.evaluate(async()=>{const state=await window.one.imageEditor.state();await window.one.imageEditor.dirty(state.token,true);});
    await invoke(app,[files.otherImage]);await expect.poll(async()=>(await dialogs(app)).length).toBe(1);
    assert.equal((await image.evaluate(()=>window.one.imageEditor.state())).token,imageState.token);
    await invoke(app,['--one-project=不存在.oneimage']);await expect.poll(async()=>(await dialogs(app)).length).toBe(2);
    assert.match((await dialogs(app))[1].detail,/不存在/);
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().includes('view=image-editor')).destroy());
    await nativeInvoke(app,[path.basename(files.recording)]);await ready(main);
    await expect(main.locator('.content')).toHaveAttribute('data-current-page','recording');
    const first=await main.evaluate(()=>window.one.recording.state());assert.equal(first.phase,'ready');assert.equal(first.projectDirty,false);
    const materialId=(await main.evaluate(()=>window.one.materialsState())).recordings[0].id;
    const materialState=path.join(root,'cold-image','materials','recordings',materialId,'state.json');
    await fs.rename(materialState,materialState+'.held');await fs.mkdir(materialState);
    await main.evaluate(()=>window.one.recording.openPlayer());const player=await pageFor(app,'recording-player');await player.waitForFunction(()=>!!window.one?.recordingPlayer);
    await player.evaluate(async()=>{const state=await window.one.recordingPlayer.state();if(state.playback.speed!==1.5)throw Error('original playback lost');await window.one.recordingPlayer.edit(state.token,{...state.playback,speed:1.75});});
    await expect.poll(async()=> (await main.evaluate(()=>window.one.recording.state())).projectDirty).toBe(true);
    await expect.poll(async()=> /素材工程保存失败/.test((await main.evaluate(()=>window.one.recording.state())).message)).toBe(true);
    await invoke(app,[`--one-project=${files.otherRecording}`]);await expect.poll(async()=>(await dialogs(app)).some(item=>item.message==='替换当前尚未保存的录制？')).toBe(true);
    await expect.poll(async()=> (await main.evaluate(()=>window.one.recording.state())).projectBusy).toBe(false);
    assert.equal((await main.evaluate(()=>window.one.recording.state())).token,first.token);
    assert.equal((await player.evaluate(()=>window.one.recordingPlayer.state())).playback.speed,1.75);
    await fs.rmdir(materialState);await fs.rename(materialState+'.held',materialState);
    await app.evaluate(()=>{globalThis.oneEntryResponse=1;});await invoke(app,[`--one-project=${files.otherRecording}`]);
    await ready(main,first.token);
    const replacement=await main.evaluate(()=>window.one.recording.state());assert.notEqual(replacement.token,first.token);
    assert.ok([0,403,404].includes(await main.evaluate(url=>fetch(url).then(response=>response.status,()=>0),first.url)));
    await main.evaluate(file=>window.one.openFile(file),files.corrupt);
    assert.equal((await main.evaluate(()=>window.one.recording.state())).token,replacement.token);
    assert.equal((await dialogs(app)).at(-1).message,'无法打开 One 工程');
    await main.evaluate(file=>window.one.openFile(file),files.image);
    const reopened=await pageFor(app,'image-editor');await reopened.waitForFunction(()=>!!window.one?.imageEditor);
    assert.equal((await reopened.evaluate(()=>window.one.imageEditor.state())).name,'启动 中文 图');
    await main.evaluate(()=>window.one.recording.cancel());
    const coldRecording=await launch(['--one-login-startup',`--one-project=${files.recording}`],'cold-recording');
    const recordingMain=await pageFor(coldRecording,'main');await ready(recordingMain);
    await expect(recordingMain.locator('.content')).toHaveAttribute('data-current-page','recording');
    assert.equal(await coldRecording.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().includes('view=main')).isVisible()),true);
    await recordingMain.evaluate(()=>window.one.recording.cancel());
    for(const [file,bytes] of originals)assert.deepEqual(await fs.readFile(file),bytes);
    assert.deepEqual(errors,[]);
    const result={result:'PASS',coldImage:true,coldRecording:true,loginArgumentWithProject:true,duplicateArguments:true,nativeSecondInstance:true,relativeSecondInstance:true,imageEditsPreserved:true,recordingReplacementCancelAndAccept:true,corruptionPreservesCurrent:true,revokedOriginalPreview:true,openFileIPC:true,originalsUnchanged:true};
    await fs.writeFile(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(result);
    await fs.unlink(path.join(out,'failure.json')).catch(error=>{if(error.code!=='ENOENT')throw error;});
  }catch(error){
    const records=[];
    for(const entry of await fs.readdir(root,{withFileTypes:true}))if(entry.isDirectory()){
      const text=(await Promise.all(['main.jsonl','errors.jsonl'].map(name=>fs.readFile(path.join(root,entry.name,'logs',name),'utf8').catch(()=>'')))).join('\n');
      records.push({profile:entry.name,events:text.split('\n').filter(Boolean).map(line=>JSON.parse(line)).filter(row=>/media-project|error|fatal/.test(row.event)).slice(-12).map(row=>({event:row.event,detail:row.detail.slice(0,1200)}))});
    }
    await fs.writeFile(path.join(out,'failure.json'),JSON.stringify({error:String(error),records},null,2));throw error;
  }finally{
    for(const app of apps.reverse())await app.close();
    const actual=await fs.realpath(root);assert.ok(actual.startsWith(out+path.sep));await fs.rm(actual,{recursive:true,force:true});
  }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
