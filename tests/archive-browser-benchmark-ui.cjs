const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {performance}=require('node:perf_hooks');
const {_electron:electron,expect}=require('@playwright/test');
async function main(){
 const dataset=path.resolve(process.env.ONE_ARCHIVE_BROWSER_BENCHMARK_ROOT||'work/current/archive-browser-perf');for(const name of ['root','nested'])assert.equal(JSON.parse(await fs.readFile(path.join(dataset,name+'.json'),'utf8')).entries,1000000,'Generate million-entry datasets first');
 await fs.mkdir('work/temp',{recursive:true});const root=await fs.mkdtemp(path.resolve('work/temp/one-browser-benchmark-ui-'));let app;
 try{
  const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:path.join(root,'profile'),TEMP:root,TMP:root};delete env.ELECTRON_RUN_AS_NODE;
  app=await electron.launch({args:[path.resolve('.')],env});const page=await app.firstWindow(),errors=[],results=[];page.on('pageerror',error=>errors.push(String(error)));
  await app.evaluate(({ipcMain})=>{globalThis.browseBenchmark=[];const previous=ipcMain._invokeHandlers.get('one:archive-run');ipcMain.removeHandler('one:archive-run');ipcMain.handle('one:archive-run',async(event,request,id)=>{const started=performance.now(),result=await previous(event,request,id);if(request.operation==='list')globalThis.browseBenchmark.push({milliseconds:performance.now()-started,total:result.total,matched:result.matched,returned:result.entries?.length,offset:request.offset??0});return result;});});
  await page.waitForSelector('[data-page="archive"]');await page.locator('[data-page="archive"]').click();await page.locator('[data-archive-mode="browse"]').click();
  const memory=()=>app.evaluate(({app})=>app.getAppMetrics().map(item=>({type:item.type,pid:item.pid,integrity:item.integrityLevel,workingBytes:item.memory.workingSetSize*1024,peakWorkingBytes:item.memory.peakWorkingSetSize*1024,privateBytes:(item.memory.privateBytes??0)*1024})));
  const baselineMemory=await memory();
  async function measure(name,action,count,first){
   const before=await app.evaluate(()=>globalThis.browseBenchmark.length);await page.evaluate(()=>{globalThis.benchTicks=0;globalThis.benchMaxGap=0;let last=performance.now();globalThis.benchTimer=setInterval(()=>{const now=performance.now();globalThis.benchMaxGap=Math.max(globalThis.benchMaxGap,now-last);last=now;globalThis.benchTicks++;},16);});
   const started=performance.now();await action();await expect.poll(()=>app.evaluate(()=>globalThis.browseBenchmark.length),{timeout:30000}).toBeGreaterThan(before);await expect(page.locator('#archive-open')).toBeEnabled();await expect(page.locator('.archive-entry')).toHaveCount(count);await expect(page.locator('.archive-entry-name').first()).toHaveText(first);
   const renderer=await page.evaluate(()=>{clearInterval(globalThis.benchTimer);return {ticks:globalThis.benchTicks,maxTimerGapMilliseconds:globalThis.benchMaxGap,rows:document.querySelectorAll('.archive-entry').length,domNodes:document.querySelectorAll('*').length};});assert(renderer.ticks>0);assert(renderer.rows<=200);
   results.push({name,milliseconds:performance.now()-started,ipc:await app.evaluate(()=>globalThis.browseBenchmark.at(-1)),renderer,memory:await memory()});
  }
  await page.locator('#archive-source').fill(path.join(dataset,'root.zip'));await measure('root-first',()=>page.locator('#archive-open').click(),200,'entry-0000000.txt');
  await measure('root-second-page',()=>page.locator('#archive-more').click(),200,'entry-0000200.txt');
  await measure('root-flat',async()=>{await page.locator('#archive-list-head').click();await page.locator('#archive-flat').check();},200,'entry-0000000.txt');
  await page.locator('#archive-search').fill('entry-0999');await measure('root-search',()=>page.locator('#archive-search-run').click(),200,'entry-0999000.txt');
  await page.locator('#archive-search').fill('');await measure('search-clear',()=>page.locator('#archive-search-run').click(),200,'entry-0000000.txt');
  await measure('flat-off',async()=>{await page.locator('#archive-list-head').click();await page.locator('#archive-flat').uncheck();},200,'entry-0000000.txt');
  await page.locator('#archive-source').fill(path.join(dataset,'nested.zip'));await measure('nested-root',()=>page.locator('#archive-open').click(),1,'共享');
  await measure('nested-folders',()=>page.locator('[data-archive-directory="共享/"]').first().click(),200,'branch-0000');
  await measure('nested-leaves',()=>page.locator('[data-archive-directory="共享/branch-0007/"]').first().click(),200,'entry-0000007.txt');
  await page.locator('#archive-source').fill(path.join(dataset,'root.zip'));await page.locator('#archive-open').click();await expect(page.locator('#archive-cancel')).toBeEnabled();const cancelStarted=performance.now();await page.locator('#archive-cancel').click();await expect(page.locator('#archive-open')).toBeEnabled();await expect(page.locator('#archive-status-text')).toContainText(/取消|停止/);const cancelMilliseconds=performance.now()-cancelStarted;
  await measure('reopen-after-cancel',()=>page.locator('#archive-open').click(),200,'entry-0000000.txt');assert.deepEqual(errors,[]);
  const evidence=path.resolve('verification/archive-browser-perf');await fs.mkdir(evidence,{recursive:true});await fs.writeFile(path.join(evidence,'ui.json'),JSON.stringify({date:new Date().toISOString(),dataset:'Two generated million-entry empty Store ZIP64 archives; same as native comparison',settings:'Isolated profile; real Electron/ArchiveService/helper; no Explorer or extraction; inherited developer process token, no elevation requested',memoryUnits:'Bytes converted from Electron MemoryInfo kilobytes',memoryReference:'https://www.electronjs.org/docs/latest/api/structures/memory-info',baselineMemory,results,cancelMilliseconds},null,2)+'\n');
  console.log(`Million-entry browser UI passed: ${results.length} measured flows, at most 200 rows, live renderer timer, real cancellation/reopen (${cancelMilliseconds.toFixed(1)} ms), per-process memory retained.`);
 }finally{await app?.close();const relative=path.relative(path.resolve('work/temp'),root);assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));await fs.rm(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
