const {_electron:electron,expect}=require('@playwright/test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {installMenuBridge,triggerMenuBridge}=require('./menu-bridge-fixture.cjs');

async function run(){
 const out=path.resolve(process.env.ONE_TEST_OUTPUT_DIR||'work/current/popup-idle-reclaim');
 await fs.mkdir(out,{recursive:true});const profile=await fs.mkdtemp(path.join(out,'profile-'));
 const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({args:[path.resolve('.')],env});
 try{
  const main=await app.firstWindow();await main.waitForSelector('[data-page=search]');
  await installMenuBridge(app);
  await main.evaluate(()=>window.one.patchSettings({search:{explorerMenu:true}}));
  await triggerMenuBridge(app);
  const count=view=>app.evaluate(({BrowserWindow},view)=>BrowserWindow.getAllWindows().filter(w=>!w.isDestroyed()&&new URL(w.webContents.getURL()||'about:blank').searchParams.get('view')===view).length,view);
  await expect.poll(()=>count('search-menu')).toBeGreaterThan(0);
  // Shorten only the popup idle timers in this isolated main process.
  await app.evaluate(()=>{const original=globalThis.setTimeout;globalThis.setTimeout=function(callback,delay,...args){return original(callback,delay===60000||delay===15000?80:delay===300000?500:delay,...args);};});
  await main.evaluate(()=>window.one.showSearch());
  await expect.poll(()=>count('search')).toBeGreaterThan(0);
  const search=app.windows().find(page=>new URL(page.url()||'about:blank').searchParams.get('view')==='search');
  await search.waitForSelector('#file-query');await search.evaluate(()=>window.one.closeWindow());
  await expect.poll(()=>count('search-menu')).toBe(0);
  await expect.poll(()=>count('search')).toBe(0);
  await main.evaluate(()=>window.one.patchSettings({search:{explorerTyping:true}}));
  await expect.poll(()=>count('search')).toBe(1);
  const inline=app.windows().find(page=>page.url().includes('embedded=1'));await inline.waitForSelector('#file-query');
  const oldId=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('embedded=1')).webContents.id);
  await expect.poll(()=>count('search')).toBe(0);
  await app.evaluate(()=>globalThis.popupBridge.stdout.emit('data',JSON.stringify({event:'typing',hwnd:0})+'\n'));
  await expect.poll(()=>count('search')).toBe(1);
  await app.windows().find(page=>page.url().includes('embedded=1')).waitForSelector('#file-query');
  assert.notEqual(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('embedded=1')).webContents.id),oldId);
  assert.deepEqual(await app.evaluate(()=>globalThis.popupMainErrors),[]);
  console.log(JSON.stringify({result:'PASS',hiddenSearchReleased:true,hiddenMenuReleased:true,embeddedSearchReclaimedAndRecreated:true}));
 }finally{
  await app.close();
  const resolved=await fs.realpath(profile),parent=await fs.realpath(out);
  assert.equal(path.dirname(resolved).toLowerCase(),parent.toLowerCase());
  await fs.rm(resolved,{recursive:true,force:true,maxRetries:3,retryDelay:100});
 }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
