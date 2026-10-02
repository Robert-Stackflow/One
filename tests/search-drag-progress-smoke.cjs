const {_electron:electron,expect}=require('@playwright/test'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const execute=promisify(execFile);
async function run(){
 const out=path.resolve(process.env.ONE_TEST_OUTPUT_DIR||'work/current/search-drag-progress-smoke'),profile=path.join(out,'profile'),folder=path.join(profile,'中文 files');await fs.mkdir(folder,{recursive:true});
 const files=[path.join(folder,'search one.txt'),path.join(folder,'search two.txt')];for(const file of files)await fs.writeFile(file,'Native drag fixture');
 await require('esbuild').build({entryPoints:['src/shared/settings.ts'],outfile:path.join(out,'settings.cjs'),bundle:true,platform:'node'});const settings=require(path.join(out,'settings.cjs')).defaultSettings();settings.diskMonitor.enabled=false;settings.search.roots=[];settings.search.explorerTyping=true;settings.search.shortcut='';await fs.writeFile(path.join(profile,'settings.json'),JSON.stringify(settings));
 const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({args:[path.resolve('.')],env}),errors=[],reports=[];app.on('window',p=>p.on('pageerror',e=>errors.push(String(e))));
 try{
  const main=await app.firstWindow();await main.waitForSelector('#overview-index');await expect.poll(()=>app.windows().filter(p=>new URL(p.url()||'about:blank').searchParams.get('view')==='search').length).toBe(2);
  await app.evaluate(({BrowserWindow,ipcMain},files)=>{
   global.dragFixtureFiles=files;global.dragInvocations=[];const drag=ipcMain._invokeHandlers.get('one:start-file-drag');ipcMain.removeHandler('one:start-file-drag');ipcMain.handle('one:start-file-drag',async(e,p)=>{global.dragInvocations.push(p);return drag(e,p);});
   ipcMain.removeHandler('one:search-files');ipcMain.handle('one:search-files',async(e,query,only,token)=>{
    const text=query.trim(),entries=files.map((file,n)=>({path:file,name:text+' '+(n+1)+'.txt',directory:false,size:19,modified:0}));
    const partial={items:entries,total:2,elapsed:1,partial:true,localTotal:2};
    if(text==='slow')await new Promise(r=>setTimeout(r,180));
    e.sender.send('one:search-progress',{token,result:partial});await new Promise(r=>setTimeout(r,220));
    const extra=Array.from({length:18},(_,n)=>({path:files[0]+'-'+n,name:text+' outside '+n,directory:false,size:0,modified:0}));
    return{items:[...entries,...extra],total:20,localTotal:2,elapsed:220};
   });
   for(const w of BrowserWindow.getAllWindows()){w.removeAllListeners('blur');w.hide();}
  },files);
  await app.evaluate(({BrowserWindow,screen})=>{const area=screen.getPrimaryDisplay().workArea,w=global.dragReceiver=new BrowserWindow({x:area.x+20,y:area.y+100,width:280,height:260,frame:false,alwaysOnTop:true,webPreferences:{nodeIntegration:true,contextIsolation:false,sandbox:false}});w.loadURL('data:text/html,'+encodeURIComponent(`<body style="margin:0;background:#f2f2f2;font:16px sans-serif;display:grid;place-items:center;height:100vh">拖拽验证<div id="drop">等待文件</div><script>window.received=[];document.ondragover=e=>e.preventDefault();document.ondrop=e=>{e.preventDefault();window.received=[...e.dataTransfer.files].map(f=>({path:require('electron').webUtils.getPathForFile(f),name:f.name,size:f.size}));document.querySelector('#drop').textContent=JSON.stringify(window.received);};</script></body>`));});
  await expect.poll(()=>app.windows().some(p=>p.url().startsWith('data:text/html'))).toBe(true);const drop=app.windows().find(p=>p.url().startsWith('data:text/html'));await drop.waitForSelector('#drop');
  for(const embedded of [false,true]){
   const page=app.windows().find(p=>new URL(p.url()||'about:blank').searchParams.get('view')==='search'&&p.url().includes('embedded=1')===embedded),win=await app.browserWindow(page);await page.waitForSelector('#file-query');
   await win.evaluate((w,{embedded,folder})=>{w.setBounds({x:400,y:160,width:embedded?540:740,height:440});w.setAlwaysOnTop(true);w.show();w.moveTop();w.focus();w.webContents.send('one:search-reset');w.webContents.send('one:search-context',{kind:embedded?'explorer':'search',hwnd:0,pid:0,created:'',currentFolder:folder,folders:[]});},{embedded,folder});
   await page.locator('#file-query').fill('stage');await expect(page.locator('.search-result')).toHaveCount(2);await expect(page.locator('#search-results')).toHaveAttribute('aria-busy','true');await expect(page.locator('#search-summary')).toContainText('本文件夹');
   await page.keyboard.press('ArrowDown');await page.evaluate(()=>{window.kept=document.querySelectorAll('.search-result')[1];});await expect(page.locator('.search-result')).toHaveCount(20);await expect(page.locator('#search-results')).toHaveAttribute('aria-busy','false');assert.equal(await page.evaluate(()=>window.kept===document.querySelector('.search-result.selected')),true);
   await page.locator('#file-query').fill('slow');await page.waitForTimeout(95);await page.locator('#file-query').fill('latest');await expect(page.locator('.search-result').first()).toContainText('latest');await page.waitForTimeout(430);await expect(page.locator('.search-result').first()).toContainText('latest');
   const row=page.locator('.search-result').nth(1);assert.equal(await row.getAttribute('draggable'),'true');await expect(row.locator('.windows-file-icon')).toHaveCount(1);await row.scrollIntoViewIfNeeded();
   // Move only the test windows, then use a guarded OS gesture. A real drop must carry Files.
   const box=await row.boundingBox(),coordinates=await app.evaluate(({BrowserWindow,screen},{box,embedded})=>{const windows=BrowserWindow.getAllWindows(),search=windows.find(w=>new URL(w.webContents.getURL()).searchParams.get('view')==='search'&&w.webContents.getURL().includes('embedded=1')===embedded),b=search.getContentBounds(),target=global.dragReceiver.getContentBounds();search.moveTop();search.focus();return{pids:[process.pid,...windows.map(w=>w.webContents.getOSProcessId())],from:screen.dipToScreenPoint({x:Math.round(b.x+box.x+120),y:Math.round(b.y+box.y+box.height/2)}),to:screen.dipToScreenPoint({x:target.x+target.width/2,y:target.y+target.height/2})};},{box,embedded});
   await drop.evaluate(()=>{window.received=[];});await execute(process.execPath,['tests/file-drag-mouse.cjs',JSON.stringify(coordinates)],{cwd:process.cwd(),windowsHide:true,timeout:12000});
   try{await expect.poll(()=>drop.evaluate(()=>window.received.map(f=>f.path)),{timeout:5000}).toEqual([files[1]]);}catch(error){console.error('Native drag diagnostic',JSON.stringify({embedded,coordinates,calls:await app.evaluate(()=>global.dragInvocations),received:await drop.evaluate(()=>window.received),row:await row.evaluate(e=>e.outerHTML),toast:await page.locator('#toast').textContent()}));throw error;}await expect.poll(()=>app.evaluate(()=>global.dragInvocations.at(-1))).toBe(files[1]);
   reports.push({embedded,localBeforeGlobal:true,selectionAndRowPreserved:true,staleProgressIgnored:true,nativeDrop:true,received:await drop.evaluate(()=>window.received)});await win.evaluate(w=>w.hide());
  }
  await assert.rejects(()=>main.evaluate(file=>window.one.startFileDrag(file),files[0]));assert.deepEqual(errors,[]);const result={result:'PASS',cases:reports,mainWindowCannotStartNativeDrag:true,errors};await fs.writeFile(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{await app.close();}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
