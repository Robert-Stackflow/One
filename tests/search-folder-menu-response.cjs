const {_electron:electron}=require('@playwright/test');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks');
const {installMenuBridge,triggerMenuBridge}=require('./menu-bridge-fixture.cjs');

(async()=>{
 const out=path.resolve('work/search-folder-menu-response');await fs.mkdir(out,{recursive:true});
 const profile=await fs.mkdtemp(path.join(out,'profile-'));
 const directory=process.env.ONE_TOPN_REAL_DIR||'C:/Windows/WinSxS';
 assert((await fs.stat(directory)).isDirectory());
 await require('esbuild').build({entryPoints:['src/shared/settings.ts'],outfile:path.join(out,'settings.cjs'),bundle:true,platform:'node'});
 const settings=require(path.join(out,'settings.cjs')).defaultSettings();
 settings.diskMonitor.enabled=false;settings.search.roots=[];settings.search.shortcut='';
 settings.search.menu=[{id:'large-folder',parent:'',kind:'folder',label:'Large directory',target:directory,args:[],cwd:'',icon:'folder',enabled:true}];
 await fs.writeFile(path.join(profile,'settings.json'),JSON.stringify(settings));
 const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({args:[path.resolve('.')],env});
 try{
  const main=await app.firstWindow();await main.waitForSelector('#overview-index');
  await installMenuBridge(app);
  await main.evaluate(()=>window.one.patchSettings({search:{explorerMenu:true}}));
  for(let attempt=0;attempt<100&&!(await app.evaluate(()=>!!globalThis.popupBridge));attempt++)await new Promise(resolve=>setTimeout(resolve,50));
  assert(await app.evaluate(()=>!!globalThis.popupBridge),'Fixture search bridge did not start');
  await new Promise(resolve=>setTimeout(resolve,600));
  await triggerMenuBridge(app);
  for(let attempt=0;attempt<100&&!app.windows().some(page=>page.url().includes('view=search-menu')&&page.url().includes('depth=0'));attempt++)await new Promise(resolve=>setTimeout(resolve,50));
  const popup=app.windows().find(page=>page.url().includes('view=search-menu')&&page.url().includes('depth=0'));assert(popup,JSON.stringify({windows:app.windows().map(page=>page.url()),bridge:await app.evaluate(()=>({listeners:globalThis.popupBridge?.stdout.listenerCount('data'),errors:globalThis.popupMainErrors}))}));
  const menu=await popup.evaluate(()=>window.one.searchMenu());
  const folder=menu.find(item=>item.label==='Large directory');assert(folder);
  const start=performance.now();
  const children=await popup.evaluate(id=>window.one.menuChildren(id),folder.id);
  const responseMs=performance.now()-start;
  const collator=new Intl.Collator('zh-CN',{numeric:true});
  const expected=(await fs.readdir(directory,{withFileTypes:true})).filter(entry=>!entry.isSymbolicLink()).sort((a,b)=>Number(b.isDirectory())-Number(a.isDirectory())||collator.compare(a.name,b.name)).slice(0,150);
  assert.deepEqual(children.map(item=>item.label),expected.map(item=>item.name));
  assert.equal(children.length,150);
  console.log(JSON.stringify({passed:true,directory,entries:(await fs.readdir(directory)).length,shown:children.length,menuResponseMs:Math.round(responseMs),matchesFullSort:true}));
 }finally{await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
