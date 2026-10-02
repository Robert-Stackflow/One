const {_electron:electron,expect}=require('@playwright/test'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {installMenuBridge,triggerMenuBridge}=require('./menu-bridge-fixture.cjs');
async function run(){
 const out=path.resolve('work/popup-menus');await fs.mkdir(out,{recursive:true});const profile=await fs.mkdtemp(path.join(out,'profile-'));
 const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch(process.env.ONE_PACKAGED_EXE?{executablePath:process.env.ONE_PACKAGED_EXE,args:[],env}:{args:[path.resolve('.')],env}),errors=[];
 app.on('window',page=>page.on('pageerror',e=>errors.push(String(e))));
 try{
  const main=await app.firstWindow();await main.waitForSelector('#overview-index');
  await installMenuBridge(app);
  await app.evaluate(({app,BrowserWindow,ipcMain})=>{
   globalThis.popupEvents=[];
   const windows=()=>BrowserWindow.getAllWindows().filter(w=>w.webContents.getURL().includes('view=search-menu')).map(w=>({id:w.webContents.id,url:w.webContents.getURL(),visible:w.isVisible(),loading:w.webContents.isLoading()}));
   const record=(event,extra={})=>globalThis.popupEvents.push({event,at:Date.now(),focused:BrowserWindow.getFocusedWindow()?.webContents.getURL(),windows:windows(),...extra});
   const observe=w=>{for(const event of ['show','hide','focus','blur','ready-to-show'])w.on(event,()=>record(event,{id:w.webContents.id}));};
   for(const w of BrowserWindow.getAllWindows())observe(w);app.on('browser-window-created',(_,w)=>observe(w));
   for(const [name,handler]of ipcMain._invokeHandlers)if(/(?:menu-open|search-menu|menu-back)$/.test(name))ipcMain._invokeHandlers.set(name,async(event,...args)=>{record(name,{sender:event.sender.id,args});const value=await handler(event,...args);record(name+'-done',{sender:event.sender.id,value});return value;});
  });
  const common={target:'',args:[],cwd:'',icon:'folder',enabled:true},menu=[{...common,id:'group-a',parent:'',kind:'group',label:'一级分组'},{...common,id:'group-b',parent:'group-a',kind:'group',label:'二级分组'},{...common,id:'leaf',parent:'group-b',kind:'builtin',target:'copy-path',label:'三级项目',icon:'copy'}];
  await main.evaluate(menu=>window.one.patchSettings({search:{shortcut:'',roots:[],explorerMenu:true,menu}}),menu);
  assert.ok(await app.evaluate(()=>Boolean(globalThis.popupBridge)));
  const pages=depth=>app.windows().filter(p=>new URL(p.url()||'about:blank').searchParams.get('view')==='search-menu'&&new URL(p.url()).searchParams.get('depth')===String(depth));
  const trigger=()=>triggerMenuBridge(app);
  const visible=depth=>app.evaluate(({BrowserWindow},depth)=>BrowserWindow.getAllWindows().some(w=>new URL(w.webContents.getURL()||'about:blank').searchParams.get('view')==='search-menu'&&new URL(w.webContents.getURL()).searchParams.get('depth')===String(depth)&&w.isVisible()),depth);
  async function openThree(){
   await trigger();await expect.poll(()=>pages(0).length).toBe(1);const root=pages(0)[0];await expect.poll(()=>visible(0)).toBe(true);await expect(root.getByRole('menuitem',{name:'一级分组'})).toBeVisible();
   await root.getByRole('menuitem',{name:'一级分组'}).click();await expect.poll(()=>pages(1).length).toBe(1);const child=pages(1)[0];await expect.poll(()=>visible(1)).toBe(true);await expect(child.getByRole('menuitem',{name:'二级分组'})).toBeVisible();
   await child.getByRole('menuitem',{name:'二级分组'}).click();await expect.poll(()=>pages(2).length).toBe(1);const grandchild=pages(2)[0];await expect.poll(()=>visible(2)).toBe(true);await expect(grandchild.getByRole('menuitem',{name:'三级项目'})).toBeVisible();
   const bounds=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().filter(w=>new URL(w.webContents.getURL()).searchParams.get('view')==='search-menu'&&w.isVisible()).map(w=>({depth:Number(new URL(w.webContents.getURL()).searchParams.get('depth')),bounds:w.getBounds()})));
   assert.equal(bounds.length,3);for(const p of bounds)assert.ok(Math.abs(p.bounds.width-286)<=2,'Native DPI rounding must not widen a parent menu');return{root,child,grandchild};
  }
  let menus=await openThree();
  // Electron may finish its first paint before loading ends. No second ready event follows.
  await app.evaluate(({BrowserWindow})=>{globalThis.popupLoadingMethods=new Map();for(const w of BrowserWindow.getAllWindows())if(w.webContents.getURL().includes('view=search-menu')){const contents=w.webContents;globalThis.popupLoadingMethods.set(contents,contents.isLoading);contents.isLoading=()=>true;}});
  menus=await openThree();
  await app.evaluate(()=>{for(const [contents,original]of globalThis.popupLoadingMethods)contents.isLoading=original;globalThis.popupLoadingMethods.clear();});
  // Exercise late child IPC while an earlier cached parent has already been destroyed.
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>new URL(w.webContents.getURL()).searchParams.get('view')==='search-menu'&&new URL(w.webContents.getURL()).searchParams.get('depth')==='0').destroy());
  let staleError='';try{await menus.child.evaluate(async()=>{await window.one.searchMenu();await window.one.menuSize({width:286,height:64});});}catch(e){staleError=String(e);}
  if(process.env.ONE_EXPECT_STALE_MENU_FAILURE==='1'){assert.match(staleError,/Object has been destroyed/);console.log(JSON.stringify({result:'EXPECTED_BASELINE_FAILURE',staleError}));return;}
  assert.equal(staleError,'');menus=await openThree();
  const previous=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().filter(w=>new URL(w.webContents.getURL()).searchParams.get('view')==='search-menu').map(w=>w.webContents.id));
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().filter(w=>new URL(w.webContents.getURL()).searchParams.get('view')==='search-menu').forEach(w=>w.hide()));
  await new Promise(resolve=>setTimeout(resolve,47000));
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().filter(w=>new URL(w.webContents.getURL()).searchParams.get('view')==='search-menu').length),0);
  const at=performance.now();await openThree();const cascadeReopenMs=performance.now()-at;
  const next=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().filter(w=>new URL(w.webContents.getURL()).searchParams.get('view')==='search-menu').map(w=>w.webContents.id));assert.ok(next.every(id=>!previous.includes(id)));
  assert.deepEqual(await app.evaluate(()=>globalThis.popupMainErrors),[]);assert.deepEqual(errors,[]);
  const report={result:'PASS',firstPaintBeforeLoadCompletion:true,staleChildIpcSafe:true,threeIndependentMenus:true,actualHiddenIdleReclamation:true,recreatedMenus:true,cascadeReopenMs,errors};await fs.writeFile(path.join(out,'events.json'),JSON.stringify(await app.evaluate(()=>globalThis.popupEvents),null,2));await fs.writeFile(path.join(out,'latest.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }catch(error){await fs.writeFile(path.join(out,'failure-events.json'),JSON.stringify(await app.evaluate(()=>globalThis.popupEvents).catch(()=>[]),null,2));throw error;}finally{await app.close();}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
