const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {_electron:electron,expect}=require('@playwright/test');
const {snapshot}=require('./app-memory-benchmark.cjs');

async function main(){
 const output=path.resolve('work/app-memory');await fs.mkdir(output,{recursive:true});
 const profile=await fs.mkdtemp(path.join(os.tmpdir(),'one-navigation-retention-'));
 const roots=await fs.mkdtemp(path.join(os.tmpdir(),'one-navigation-roots-'));
 const {buildSync}=require('esbuild');
 buildSync({entryPoints:['src/shared/settings.ts'],outfile:path.join(output,'page-settings.cjs'),bundle:true,platform:'node'});
 const {mergeSettings,defaultSettings}=require(path.join(output,'page-settings.cjs'));
 await fs.writeFile(path.join(profile,'settings.json'),JSON.stringify(mergeSettings(defaultSettings(),{search:{roots:[roots],maxEntries:1000},diskMonitor:{enabled:false,notify:false}})));
 const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch(process.env.ONE_PACKAGED_EXE?{executablePath:path.resolve(process.env.ONE_PACKAGED_EXE),args:[],env}:{args:[path.resolve('.')],env});
 try{
  const page=await app.firstWindow();await page.locator('#page-home:not([hidden])').waitFor();
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const ids=[...(process.env.ONE_NAVIGATION_PAGES||'tools,text,search,disk,hardware,settings').split(',').filter(Boolean),'home'];
  const tour=async()=>{for(const id of ids){await page.locator(`[data-page="${id}"]`).click();await page.locator(`#page-${id}:not([hidden])`).waitFor();if(id==='hardware')await expect(page.locator('#information-footer')).toContainText('更新于',{timeout:30000});}};
  const measure=async()=>{
   await cdp.send('HeapProfiler.collectGarbage');
   const counters=await cdp.send('Memory.getDOMCounters');
   const heap=(await cdp.send('Performance.getMetrics')).metrics.find(item=>item.name==='JSHeapUsedSize').value;
   const memory=await snapshot(app);
   const mainWindow=memory.windows.find(item=>item.view==='main');
   const renderer=memory.processes.find(item=>item.pid===mainWindow?.pid);
   const connected=await page.evaluate(()=>({nodes:document.querySelectorAll('*').length,byPage:Object.fromEntries([...document.querySelectorAll('.page')].map(item=>[item.id,item.querySelectorAll('*').length]))}));
   return {nodes:counters.nodes,listeners:counters.jsEventListeners,heapMiB:heap/1048576,rendererPrivateMiB:renderer.privateResident/1048576,totalPrivateMiB:memory.privateResident/1048576,connected};
  };
  await tour();await page.waitForTimeout(1000);
  let hardwareRedraws;
  if(ids.includes('hardware')){
   await page.evaluate(()=>{window.navigationMutations=0;window.navigationObserver=new MutationObserver(entries=>window.navigationMutations+=entries.filter(entry=>entry.type==='childList').length);window.navigationObserver.observe(document.querySelector('#information-groups'),{childList:true});});
   await page.locator('[data-page="hardware"]').click();await page.locator('#page-hardware:not([hidden])').waitFor();await page.waitForTimeout(250);
   hardwareRedraws=await page.evaluate(()=>{window.navigationObserver.disconnect();return window.navigationMutations;});
   if(process.env.ONE_EXPECT_INFORMATION_CACHE==='1'){
    assert.equal(hardwareRedraws,0,'Recent system information should not redraw on revisit');
    const created=await page.evaluate(async()=> (await window.one.systemInformation('overview')).created);
    await page.locator('#information-refresh').click();
    await expect.poll(()=>page.evaluate(async()=> (await window.one.systemInformation('overview')).created),{timeout:30000}).toBeGreaterThan(created);
   }
   await page.locator('[data-page="home"]').click();await page.locator('#page-home:not([hidden])').waitFor();
  }
  const first=await measure(),series=[{tours:1,...first}];
  const cycles=Number(process.env.ONE_NAVIGATION_CYCLES||10);
  for(let cycle=1;cycle<=cycles;cycle++){await tour();if(cycle%10===0||cycle===cycles){await page.waitForTimeout(1000);series.push({tours:cycle+1,...await measure()});}}
  const repeated=series.at(-1);
  const result={result:'PASS',pages:ids.slice(0,-1),tours:cycles+1,hardwareRedraws,first,repeated,series,delta:Object.fromEntries(['nodes','listeners','heapMiB','rendererPrivateMiB','totalPrivateMiB'].map(key=>[key,repeated[key]-first[key]]))};
  console.log(JSON.stringify(result));
  assert.ok(repeated.nodes-first.nodes<30,`DOM nodes kept growing: ${first.nodes} → ${repeated.nodes}`);
  assert.ok(repeated.listeners-first.listeners<30,`Listeners kept growing: ${first.listeners} → ${repeated.listeners}`);
  await fs.writeFile(path.join(output,'navigation-retention.json'),JSON.stringify(result,null,2));
  await cdp.detach();
 }finally{await app.close();await fs.rm(profile,{recursive:true,force:true});await fs.rm(roots,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
