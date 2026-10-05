const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {_electron:electron,expect}=require('@playwright/test');
const {snapshot}=require('./app-memory-benchmark.cjs');

async function main(){
 const output=path.resolve(process.env.ONE_TEST_OUTPUT_DIR||'work/current/workbook-dense');
 const format=process.env.ONE_WORKBOOK_FORMAT==='xlsx'?'xlsx':'ods',file=path.join(output,`dense.${format}`);
 assert.ok((await fs.stat(file)).isFile());
 const profile=await fs.mkdtemp(path.join(os.tmpdir(),'one-workbook-heap-'));
 const plain=path.join(profile,'baseline.txt');await fs.writeFile(plain,'A small preview');
 const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch(process.env.ONE_PACKAGED_EXE?{executablePath:path.resolve(process.env.ONE_PACKAGED_EXE),args:[],env}:{args:[path.resolve('.')],env});
 try{
  const home=await app.firstWindow();await home.waitForSelector('[data-page=text]');
  await app.evaluate(({app})=>app.on('browser-window-created',(_event,window)=>setImmediate(()=>window.removeAllListeners('blur'))));
  const opening=app.waitForEvent('window');await home.evaluate(file=>window.one.preview(file),plain);const preview=await opening;
  await expect(preview.locator('#preview-name')).toHaveText('baseline.txt');await preview.locator('#preview-hold').click();
  const cdp=await preview.context().newCDPSession(preview);await cdp.send('Performance.enable');
  const measure=async()=>{
   await cdp.send('HeapProfiler.collectGarbage');
   const memory=await snapshot(app),dom=await cdp.send('Memory.getDOMCounters');
   const heap=(await cdp.send('Performance.getMetrics')).metrics.find(item=>item.name==='JSHeapUsedSize').value;
   const renderer=memory.processes.find(process=>memory.windows.find(window=>window.view==='preview'&&window.pid===process.pid));
   return {heapMiB:heap/1048576,nodes:dom.nodes,documents:dom.documents,listeners:dom.jsEventListeners,rendererPrivateResidentMiB:renderer?.privateResident/1048576,totalPrivateResidentMiB:memory.privateResident/1048576};
  };
  const before=await measure();
  await preview.evaluate(file=>window.one.selectPreview(file),file);
  await expect(preview.locator('.sheet-table tbody tr')).toHaveCount(100,{timeout:30000});
  const after=await measure();
  const firstCell=preview.locator('.sheet-table tbody tr').first().locator('td').first();
  const firstValue=await firstCell.innerText();
  await firstCell.focus();
  await preview.keyboard.press('Enter');
  await expect(preview.locator('#sheet-formula')).toContainText(`A1  ${firstValue}`);
  await preview.keyboard.press('Control+c');
  assert.equal(await app.evaluate(({clipboard})=>clipboard.readText()),firstValue);
  await preview.locator('#sheet-next').click();
  await preview.locator('.sheet-table tbody tr').first().locator('td').first().click();
  await expect(preview.locator('#sheet-formula')).toContainText('A101  ');
  await preview.locator('#sheet-filter').fill(format==='ods'?'覆盖 14999':'第 14999 行');
  await expect(preview.locator('.sheet-table tbody tr')).toHaveCount(1);
  await preview.locator('.sheet-table tbody tr').first().locator('td').first().click();
  await expect(preview.locator('#sheet-formula')).toContainText('A15000  ');
  const report={result:'PASS',format,packaged:!!process.env.ONE_PACKAGED_EXE,before,after,delta:Object.fromEntries(Object.keys(before).map(key=>[key,after[key]-before[key]]))};
  console.log(JSON.stringify(report));await fs.writeFile(path.join(output,`renderer-heap-${format}.json`),JSON.stringify(report,null,2));
  await cdp.detach();
 }finally{await app.close();await fs.rm(profile,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
