const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {performance}=require('node:perf_hooks');
const {_electron:electron,expect}=require('@playwright/test');

async function main(){
 const output=path.resolve('work/current/workbook-dense');
 const ods=path.join(output,'dense.ods'),xlsx=path.join(output,'dense.xlsx');
 await fs.stat(ods);await fs.stat(xlsx);
 const profile=await fs.mkdtemp(path.join(os.tmpdir(),'one-workbook-release-'));
 const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch(process.env.ONE_PACKAGED_EXE?{executablePath:path.resolve(process.env.ONE_PACKAGED_EXE),args:[],env}:{args:[path.resolve('.')],env});
 try{
  const home=await app.firstWindow();await home.waitForSelector('[data-page=text]');
  await app.evaluate(({app})=>app.on('browser-window-created',(_event,window)=>setImmediate(()=>window.removeAllListeners('blur'))));
  const opening=app.waitForEvent('window');await home.evaluate(file=>window.one.preview(file),ods);const preview=await opening;
  await expect(preview.locator('.sheet-table tbody tr')).toHaveCount(100,{timeout:30000});await preview.locator('#preview-hold').click();
  const initial=await preview.evaluate(()=>window.one.previewData());
  assert.ok(initial.workbookToken&&initial.workbook?.sheets.length,'Initial workbook missing');
  await preview.evaluate(token=>window.one.previewWorkbookReady(token),initial.workbookToken);
  const released=await preview.evaluate(token=>window.one.previewData(token),initial.workbookToken);
  assert.equal(released.workbook,undefined,'Main process retained the acknowledged workbook');
  const reloadAt=performance.now();await preview.reload();
  await expect(preview.locator('.sheet-table tbody tr')).toHaveCount(100,{timeout:30000});
  const reloadMs=performance.now()-reloadAt;
  await expect(preview.locator('#sheet-count')).toContainText('15,000 行');
  const switchAt=performance.now();await preview.evaluate(file=>window.one.selectPreview(file),xlsx);
  await expect(preview.locator('#preview-name')).toHaveText('dense.xlsx');
  await expect(preview.locator('.sheet-table tbody tr')).toHaveCount(100,{timeout:30000});
  const switchMs=performance.now()-switchAt;
  const current=await preview.evaluate(()=>window.one.previewData());
  assert.ok(current.workbookToken&&current.workbook,'New workbook missing');
  assert.notEqual(current.workbookToken,initial.workbookToken,'Workbook token was reused');
  await preview.evaluate(token=>window.one.previewWorkbookReady(token),initial.workbookToken);
  const afterStaleAck=await preview.evaluate(token=>window.one.previewData(token),current.workbookToken);
  assert.ok(afterStaleAck.workbook,'Stale acknowledgement released the new workbook');
  await preview.evaluate(token=>window.one.previewWorkbookReady(token),current.workbookToken);
  const removed=path.join(profile,'removed.ods');await fs.copyFile(ods,removed);
  await preview.evaluate(file=>window.one.selectPreview(file),removed);
  await expect(preview.locator('.sheet-table tbody tr')).toHaveCount(100,{timeout:30000});
  await fs.rm(removed);await preview.reload();
  await expect(preview.locator('.preview-unsupported')).toContainText('无法预览',{timeout:30000});
  console.log(JSON.stringify({result:'PASS',released:true,reloadMs,switchMs,staleAckIgnored:true,missingFileError:true}));
 }finally{await app.close();await fs.rm(profile,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
