const {_electron:electron,expect}=require('@playwright/test');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');

async function scenario(kind,expectedErrors=0){
 const out=path.resolve('work/graceful-exit'),profile=await fs.mkdtemp(path.join(out,kind+'-'));
 const files=await fs.mkdtemp(path.join(out,'fixtures-'));
 const log=path.join(out,'logs',path.basename(profile)+'.jsonl'),file=path.join(files,'preview.txt');
 await fs.writeFile(file,'Shutdown regression fixture');
 const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch(process.env.ONE_PACKAGED_EXE?{executablePath:process.env.ONE_PACKAGED_EXE,args:[],env}:{args:[path.resolve('.')],env});
 const child=app.process();let pid=0,exited=false,validated=false,stderr='',textCache='';child.stderr?.on('data',data=>stderr+=data);
 const exit=new Promise(resolve=>child.once('exit',(code,signal)=>{exited=true;resolve({code,signal});}));
 try{
  pid=await app.evaluate(()=>process.pid);
  await app.evaluate(({app,dialog,BrowserWindow},{log,profile})=>{
   const fs=process.getBuiltinModule('fs'),record=value=>fs.appendFileSync(log,JSON.stringify({at:Date.now(),...value})+'\n');
   // Capture exceptions only in this isolated test process; production keeps Electron's error handling.
   process.on('uncaughtException',error=>record({event:'uncaught',message:error.message,stack:error.stack}));
   process.on('unhandledRejection',error=>record({event:'rejection',message:String(error),stack:error?.stack}));
   dialog.showErrorBox=(title,content)=>record({event:'error-box',title,content});
   record({event:'started',pid:process.pid});process.on('exit',code=>record({event:'process-exit',code}));
   app.on('before-quit',()=>record({event:'before-quit'}));
   app.on('will-quit',()=>record({event:'will-quit'}));
   if(profile){
    for(const event of ['before-quit','will-quit'])for(const [index,listener]of app.rawListeners(event).entries()){
     app.removeListener(event,listener);app.on(event,function(...args){record({event:'listener-start',phase:event,index});try{return Reflect.apply(listener,this,args);}finally{record({event:'listener-end',phase:event,index});}});
    }
    for(const window of BrowserWindow.getAllWindows())for(const event of ['close','closed'])window.on(event,()=>record({event:'window-'+event,id:window.id}));
    const tracked=new Set(),inspect=()=>{
     const handles=process._getActiveHandles();record({event:'resources',resources:process.getActiveResourcesInfo(),handles:handles.map(handle=>({type:handle.constructor.name,pid:handle.pid,exitCode:handle.exitCode,spawnfile:handle.spawnfile}))});
     for(const handle of handles)if(handle.constructor.name==='ChildProcess'&&!tracked.has(handle)){tracked.add(handle);handle.once('exit',(code,signal)=>record({event:'child-exit',pid:handle.pid,code,signal,spawnfile:handle.spawnfile}));}
    };
    inspect();const timer=setInterval(inspect,250);timer.unref();
    const {Worker}=process.getBuiltinModule('worker_threads'),terminate=Worker.prototype.terminate;
    Worker.prototype.terminate=function(...args){const id=this.threadId;record({event:'worker-terminate',id});return Reflect.apply(terminate,this,args).finally(()=>record({event:'worker-terminated',id}));};
   }
   return process.pid;
  },{log,profile:process.env.ONE_PROFILE_EXIT==='1'});
  const main=await app.firstWindow();await main.waitForSelector('[data-page=text]');await main.locator('[data-page=text]').click();await main.waitForSelector('#source');
  await main.evaluate(async files=>{
   await window.one.patchSettings({search:{roots:[files],explorerTyping:true,explorerMenu:true},preview:{held:true}});
   await window.one.patchSettings({search:{explorerTyping:false,explorerMenu:false}});
  },files);
  const searchWindows=()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().filter(w=>new URL(w.webContents.getURL()||'about:blank').searchParams.get('view')==='search').map(w=>({id:w.webContents.id,embedded:w.webContents.getURL().includes('embedded=1')})));
  await expect.poll(async()=> (await searchWindows()).length).toBe(2);
  for(const page of app.windows().filter(p=>/view=search(?:&|$)/.test(p.url())))await page.waitForSelector('#file-query');
  if(kind==='text'){
   const report=await main.evaluate(()=>window.one.textCompare('original🙂\n'.repeat(50000),'revised🙂\n'.repeat(50000),false));assert.ok(report.count>100);
   textCache=await app.evaluate((_electron,id)=>{const fs=process.getBuiltinModule('fs'),path=process.getBuiltinModule('path'),base=path.join(process.getBuiltinModule('os').tmpdir(),'One.Text');return fs.readdirSync(base).map(name=>path.join(base,name,id)).find(dir=>fs.existsSync(dir));},report.id);assert.ok(textCache);
   await main.evaluate(()=>new Promise(resolve=>{const unsubscribe=window.one.onTextProgress(()=>{unsubscribe();resolve(true);});window.pendingTextExit=window.one.textPipeline('a'.repeat(100000)+'!',[{operation:'replace',pattern:'(a+)+$',replacement:'x',regex:true}]).catch(error=>String(error));}));
  }
  if(kind==='recreate'){
   const originalIds=(await searchWindows()).map(w=>w.id);
   await app.evaluate(({BrowserWindow})=>{for(const w of BrowserWindow.getAllWindows())if(new URL(w.webContents.getURL()||'about:blank').searchParams.get('view')==='search')w.close();});
   await expect.poll(async()=> (await searchWindows()).length).toBe(0);
   await main.evaluate(async()=>{
    await window.one.patchSettings({search:{explorerTyping:true,explorerMenu:true}});
    await window.one.patchSettings({search:{explorerTyping:false,explorerMenu:false}});
    await window.one.showSearch();
   });
   await expect.poll(async()=> (await searchWindows()).length).toBe(2);
   assert.ok((await searchWindows()).every(w=>!originalIds.includes(w.id)));
   const search=app.windows().find(p=>p.url().includes('view=search')&&!p.url().includes('embedded=1')&&!p.url().includes('menu'));
   await search.waitForSelector('#file-query');await search.locator('#file-query').fill('preview');
   await expect(search.locator('.search-result').filter({hasText:'preview.txt'})).toHaveCount(1);
   await search.evaluate(()=>window.one.fileIcons([...document.querySelectorAll('[data-file-icon]')].map(e=>e.dataset.fileIcon)));
  }
  if(kind==='menus'){
   await main.evaluate(file=>window.one.preview(file),file);
   await main.evaluate(()=>window.one.showSearch());
   const search=app.windows().find(p=>p.url().includes('view=search')&&!p.url().includes('embedded=1')&&!p.url().includes('menu'));
   await search.waitForSelector('#file-query');
   await search.evaluate(file=>window.one.searchContextMenu(file,{x:100,y:90}),file);
   await expect.poll(()=>app.windows().some(p=>p.url().includes('view=file-context')&&!p.url().includes('submenu'))).toBe(true);
   const menu=app.windows().find(p=>p.url().includes('view=file-context')&&!p.url().includes('submenu'));
   await menu.locator('.file-context-list>*').last().waitFor({state:'visible'});
   const geometry=page=>page.evaluate(()=>{const list=document.querySelector('.file-context-list'),last=list.lastElementChild;return{padding:innerHeight-last.getBoundingClientRect().bottom,overflow:list.scrollHeight-list.clientHeight,height:innerHeight};});
   await expect.poll(async()=>Math.abs((await geometry(menu)).padding-7)).toBeLessThanOrEqual(1);
   assert.equal((await geometry(menu)).overflow,0);
   assert.equal(await menu.locator('[data-file-action=apps]>svg[data-lucide-icon=chevron]').count(),1);
   const menuHeight=(await geometry(menu)).height;
   for(let i=0;i<4;i++){
    await search.evaluate(file=>window.one.searchContextMenu(file,{x:100,y:90}),file);
    await expect.poll(async()=> (await geometry(menu)).height).toBe(menuHeight);
   }
   // Exercise the no-recommended-app case independently of this machine's file associations.
   await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('one:file-menu-apps');ipcMain.handle('one:file-menu-apps',()=>[]);});
   await menu.locator('[data-file-action=apps]').click();
   await expect.poll(()=>app.windows().some(p=>p.url().includes('view=file-context')&&p.url().includes('submenu=apps'))).toBe(true);
   const submenu=app.windows().find(p=>p.url().includes('view=file-context')&&p.url().includes('submenu=apps'));
   await expect(submenu.locator('[data-file-action=choose]')).toBeVisible();
   await expect.poll(async()=>Math.abs((await geometry(submenu)).padding-7)).toBeLessThanOrEqual(1);
   assert.equal((await geometry(submenu)).overflow,0);assert.equal(await submenu.locator('hr').count(),0);
   assert.equal(await submenu.locator('.file-context-heading').count(),0);
   await menu.screenshot({path:path.join(out,'root-menu.png')});await submenu.screenshot({path:path.join(out,'empty-apps-menu.png')});
   await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().filter(w=>w.webContents.getURL().includes('view=file-context')&&w.isVisible()).length)).toBe(2);
   await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().some(w=>w.webContents.getURL().includes('view=preview')))).toBe(true);
  }
  await main.evaluate(()=>new Promise(resolve=>setTimeout(resolve,250)));
  const start=Date.now();
  // Disconnect the test's Node debugger before quit so it cannot hold native shutdown open.
  await app.evaluate(()=>{setTimeout(()=>process.getBuiltinModule('inspector').close(),20);});
  // Use the real quit IPC, rather than app.close() followed by killing the process.
  await main.evaluate(()=>{setTimeout(()=>{void window.one.quit();},100);});
  const result=await Promise.race([exit,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Graceful quit exceeded 30 seconds\n'+stderr)),30000).unref())]);
  const records=(await fs.readFile(log,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
  const errors=records.filter(r=>r.event==='uncaught'||r.event==='rejection'||r.event==='error-box');
  assert.equal(errors.length,expectedErrors,JSON.stringify(errors,null,2));
  if(expectedErrors)assert.ok(errors.every(r=>r.message==='Object has been destroyed'),JSON.stringify(errors));
  assert.ok(records.some(r=>r.event==='will-quit'),'The app did not complete normal shutdown');
  assert.equal(result.code,0,JSON.stringify(result));assert.equal(result.signal,null);
  assert.throws(()=>process.kill(pid,0),'The Electron main process must exit naturally');
  if(textCache)assert.equal(await fs.stat(path.dirname(textCache)).then(()=>true,()=>false),false,'Own comparison cache must be cleaned before exit');
  validated=true;
  const before=records.find(r=>r.event==='listener-start'&&r.phase==='before-quit')||records.find(r=>r.event==='before-quit'),finished=records.find(r=>r.event==='process-exit');
  return{scenario:kind,quitMs:Date.now()-start,cleanupMs:finished.at-before.at,exitCode:result.code,errors:errors.length,...(textCache?{comparisonCacheCleaned:true,pendingTextCancelled:true}:{}),log};
 }finally{
  // A timeout is a failed test; terminate only this test's process so it cannot leave modal dialogs behind.
  if(!exited){if(pid)try{process.kill(pid,'SIGKILL');}catch{}if(child.exitCode===null)child.kill('SIGKILL');}
  if(validated){
   const root=await fs.realpath(out);
   for(const directory of [profile,files]){
    const resolved=await fs.realpath(directory);
    assert.equal(path.dirname(resolved).toLowerCase(),root.toLowerCase(),'Cleanup must stay inside the test workspace');
    await fs.rm(resolved,{recursive:true,force:true,maxRetries:3,retryDelay:100});
   }
  }
 }
}
async function run(){
 await fs.mkdir(path.resolve('work/graceful-exit/logs'),{recursive:true});
 const oldErrors=Number(process.env.ONE_EXPECT_EXIT_ERRORS||0),results=[];
 for(const kind of process.env.ONE_EXIT_SCENARIO?[process.env.ONE_EXIT_SCENARIO]:oldErrors?['quit']:['quit','recreate','menus'])results.push(await scenario(kind,oldErrors));
 console.log(JSON.stringify({result:'PASS',results},null,2));
}
run().catch(error=>{console.error(error);process.exitCode=1;});
