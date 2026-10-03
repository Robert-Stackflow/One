const {_electron:electron,expect}=require('@playwright/test'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{build}=require('esbuild');
async function run(){
 const output=path.resolve(process.env.ONE_TEST_OUTPUT_DIR||'work/current/search-entry-smoke'),profile=path.join(output,'profile'),root=path.join(output,'fixtures');await fs.mkdir(profile,{recursive:true});await fs.mkdir(root,{recursive:true});
 await build({entryPoints:['src/shared/settings.ts'],outfile:path.join(output,'settings.cjs'),bundle:true,platform:'node'});
 await build({entryPoints:['src/main/focused-program.ts'],outfile:path.join(output,'focused-program.cjs'),bundle:true,platform:'node',external:['koffi']});
 const settings=require(path.join(output,'settings.cjs')).defaultSettings();settings.diskMonitor.enabled=false;settings.search.roots=[root];await fs.writeFile(path.join(profile,'settings.json'),JSON.stringify(settings));
 const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;const app=await electron.launch({args:[path.resolve('.')],env}),errors=[];app.on('window',page=>page.on('pageerror',error=>errors.push(String(error))));
 try{
  const main=await app.firstWindow();await main.waitForSelector('#overview-index');await main.locator('[data-page=search]').click();await expect(main.locator('#search-programShortcut')).toHaveValue('Ctrl+Alt+P');
  await app.evaluate(({globalShortcut,shell})=>{
   const register=globalShortcut.register.bind(globalShortcut),reveal=shell.showItemInFolder;
   global.__entryTest={callbacks:new Map(),revealed:[],restore(){globalShortcut.register=register;shell.showItemInFolder=reveal;}};
   globalShortcut.register=(key,callback)=>{global.__entryTest.callbacks.set(key,callback);return register(key,callback);};shell.showItemInFolder=file=>global.__entryTest.revealed.push(file);
  });
  // Use the shared recorder and normal preferences IPC, not a test-only settings path.
  await main.locator('#search-programShortcut').focus();await main.keyboard.press('Control+Alt+Y');await expect(main.locator('#search-programShortcut')).toHaveValue('Ctrl+Alt+Y');await expect.poll(()=>main.evaluate(async()=>(await window.one.searchPreferences()).programShortcut)).toBe('Ctrl+Alt+Y');
  const fixture=await app.evaluate(async({BrowserWindow})=>{const window=new BrowserWindow({width:400,height:240,title:'One program path fixture'});await window.loadURL('data:text/html,<title>One program path fixture</title>Executable path fixture');window.show();window.focus();return {hwnd:Number(window.getNativeWindowHandle().readBigUInt64LE()),exe:process.execPath};});
  const ffi=require('koffi'),front=ffi.load('user32.dll').func('uintptr_t __stdcall GetForegroundWindow()');await expect.poll(()=>front()).toBe(fixture.hwnd);
  const captured=require(path.join(output,'focused-program.cjs')).focusedProgramPath();assert.equal(captured.toLowerCase(),fixture.exe.toLowerCase());
  const revealed=await app.evaluate(()=>{global.__entryTest.callbacks.get('Control+Alt+Y')();return global.__entryTest.revealed;});assert.deepEqual(revealed,[captured]);assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().filter(w=>w.webContents.getURL().includes('view=search')&&w.isVisible()).length),0);
  await app.evaluate(({BrowserWindow})=>{BrowserWindow.getAllWindows().find(w=>w.getTitle()==='One program path fixture').close();const main=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('view=main'));main.show();main.focus();});
  await main.locator('#search-tab-index').click();await expect(main.locator('#index-roots .index-priority-row')).toHaveCount(4);await expect(main.locator('#index-uncommon .index-priority-row')).toHaveCount(8);
  const preferences=await main.evaluate(()=>window.one.searchPreferences());assert.equal(preferences.priorityDefaultsVersion,1);assert.equal(preferences.priorities.length,11);assert.deepEqual(preferences.roots,[root]);
  await main.screenshot({path:path.join(output,'default-priorities.png')});
  const first=preferences.priorities[0].path;await main.locator('#index-roots').getByRole('button',{name:'移除 '+first,exact:true}).click();await expect.poll(()=>main.evaluate(async()=>(await window.one.searchPreferences()).priorities.length)).toBe(10);
  await main.locator('#search-tab-entry').click();await main.locator('#search-programShortcut').focus();await main.keyboard.press('Backspace');await expect.poll(()=>main.evaluate(async()=>(await window.one.searchPreferences()).programShortcut)).toBe('');await main.locator('#search-tab-index').click();await main.screenshot({path:path.join(output,'priority-removed.png')});assert.deepEqual(errors,[]);
  await app.evaluate(()=>global.__entryTest.restore());await app.close();
  const persisted=JSON.parse(await fs.readFile(path.join(profile,'settings.json'),'utf8'));assert.equal(persisted.search.programShortcut,'');assert.ok(!persisted.search.priorities.some(r=>r.path===first));
  const second=await electron.launch({args:[path.resolve('.')],env});try{const page=await second.firstWindow();await page.waitForSelector('#overview-index');const restored=await page.evaluate(()=>window.one.searchPreferences());assert.equal(restored.programShortcut,'');assert.equal(restored.priorities.length,10);assert.ok(!restored.priorities.some(r=>r.path===first));}finally{await second.close();}
  console.log(JSON.stringify({result:'PASS',nativeFocusedExecutable:captured,explorerSelection:true,shortcutRecorder:true,clearAndRestart:true,normalDirectories:3,uncommonDirectories:8,removedDefaultNotReinserted:true,errors},null,2));
 }finally{await app.close().catch(()=>{});}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
