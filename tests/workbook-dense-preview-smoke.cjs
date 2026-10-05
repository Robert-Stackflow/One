const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {performance}=require('node:perf_hooks');
const {_electron:electron,expect}=require('@playwright/test');
const {snapshot}=require('./app-memory-benchmark.cjs');

async function main(){
 const output=path.resolve(process.env.ONE_TEST_OUTPUT_DIR||'work/current/workbook-dense');
 const format=process.env.ONE_WORKBOOK_FORMAT==='ods'?'ods':'xlsx',file=path.join(output,`dense.${format}`);assert.ok((await fs.stat(file)).isFile(),'Run workbook-dense-performance.cjs first');
 const profile=await fs.mkdtemp(path.join(output,'preview-profile-'));
 const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch(process.env.ONE_PACKAGED_EXE?{executablePath:path.resolve(process.env.ONE_PACKAGED_EXE),args:[],env}:{args:[path.resolve('.')],env});
 try{
  const main=await app.firstWindow();await main.waitForSelector('[data-page=text]');
  await app.evaluate(({app})=>app.on('browser-window-created',(_event,window)=>setImmediate(()=>window.removeAllListeners('blur'))));
  if(process.env.ONE_WORKBOOK_RETAIN_FOR_TEST==='1')await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('one:preview-workbook-ready');ipcMain.handle('one:preview-workbook-ready',()=>{});});
  const before=await snapshot(app);
  await main.evaluate(()=>{window.workbookGaps=[];let previous=performance.now();window.workbookHeartbeat=setInterval(()=>{const next=performance.now();window.workbookGaps.push(next-previous);previous=next;},20);});
  const opening=app.waitForEvent('window'),started=performance.now();await main.evaluate(file=>window.one.preview(file),file);const preview=await opening;
  await expect(preview.locator('.sheet-table tbody tr')).toHaveCount(100,{timeout:30000});const firstPageMs=performance.now()-started;
  await expect(preview.locator('#sheet-count')).toContainText('15,000 行');await expect(preview.locator('.sheet-table tbody')).toContainText(format==='ods'?'行 0 & 正文':'行 0 & shared 中文内容 0');
  await preview.locator('#preview-hold').click();
  const pageTurnAt=performance.now();await preview.locator('#sheet-next').click();await expect(preview.locator('#sheet-page')).toHaveText('2 / 150');const pageTurnMs=performance.now()-pageTurnAt;
  await preview.locator('#sheet-filter').fill('行');await expect(preview.locator('#sheet-page')).toHaveText('1 / 150');await expect(preview.locator('#sheet-count')).toContainText('15,000 行');
  const filteredPageTurnAt=performance.now();await preview.locator('#sheet-next').click();await expect(preview.locator('#sheet-page')).toHaveText('2 / 150');const filteredPageTurnMs=performance.now()-filteredPageTurnAt;
  const filteredDrawMs=await preview.evaluate(()=>{const next=document.querySelector('#sheet-next'),prev=document.querySelector('#sheet-prev'),samples=[];for(let index=0;index<5;index++){const started=performance.now();next.click();samples.push(performance.now()-started);prev.click();}return samples.sort((a,b)=>a-b)[2];});
  const last=format==='ods'?'覆盖 14999':'第 14999 行',filteredAt=performance.now();await preview.locator('#sheet-filter').fill(last);await expect(preview.locator('#sheet-count')).toContainText('1 行');
  await expect(preview.locator('.sheet-table tbody')).toContainText(last);const filterMs=performance.now()-filteredAt;
  if(format==='ods'){
   await preview.locator('#sheet-select').click();await preview.getByRole('option',{name:'Repeats'}).click();
   if(process.env.ONE_PACKAGED_EXE&&process.env.ONE_EXPECT_NEW_WORKBOOK_UI!=='1'){await expect(preview.locator('#sheet-count')).toContainText('0 行');await preview.locator('#sheet-filter').fill('');}
   else{await expect(preview.locator('#sheet-count')).toContainText('筛选结果 0 行（共 3 行）');await expect(preview.locator('.sheet-empty-state')).toBeVisible();await expect(preview.locator('.sheet-empty-state')).toContainText('没有匹配的行');await expect(preview.locator('#sheet-copy')).toBeDisabled();await preview.screenshot({path:path.join(output,'filtered-empty-ods.png')});await preview.locator('#sheet-clear-filter').click();}
   await expect(preview.locator('#sheet-count')).toContainText('3 行');await expect(preview.locator('.sheet-table tbody')).toContainText('重复');
  }
  const gaps=await main.evaluate(()=>{clearInterval(window.workbookHeartbeat);return window.workbookGaps;});
  const visibleSettleMs=Number(process.env.ONE_PREVIEW_VISIBLE_SETTLE_MS||0);if(visibleSettleMs)await new Promise(resolve=>setTimeout(resolve,visibleSettleMs));
  const memory=await snapshot(app),closedSettleMs=Number(process.env.ONE_PREVIEW_CLOSED_SETTLE_MS||5000);await preview.close();await new Promise(resolve=>setTimeout(resolve,closedSettleMs));const closed=await snapshot(app);
  const byProcess=memory.processes.map(process=>({role:process.type||process.name,view:memory.windows.find(window=>window.pid===process.pid)?.view,privateResidentMiB:Math.round(process.privateResident/1048576),deltaMiB:Math.round((process.privateResident-(before.processes.find(item=>item.pid===process.pid)?.privateResident||0))/1048576)}));
  const report={result:'PASS',format,packaged:!!process.env.ONE_PACKAGED_EXE,retainWorkbookForTest:process.env.ONE_WORKBOOK_RETAIN_FOR_TEST==='1',firstPageMs,pageTurnMs,filteredPageTurnMs,filteredDrawMs,filterMs,mainHeartbeatMaxMs:Math.max(...gaps),beforePrivateResidentMiB:before.privateResident/1048576,privateResidentMiB:memory.privateResident/1048576,visibleSettleMs,closedPrivateResidentMiB:closed.privateResident/1048576,closedSettleMs,privateCommittedMiB:memory.private/1048576,processes:memory.processes.length,byProcess};
  await fs.writeFile(path.join(output,`preview-${format}-result.json`),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await app.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
