const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const {_electron:electron}=require('@playwright/test');
const {snapshot}=require('./app-memory-benchmark.cjs');

async function main(){
 const profile=await fs.mkdtemp(path.join(os.tmpdir(),'one-startup-styles-'));
 const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch(process.env.ONE_PACKAGED_EXE?{executablePath:path.resolve(process.env.ONE_PACKAGED_EXE),args:[],env}:{args:[path.resolve('.')],env});
 try{
  const page=await app.firstWindow();await page.locator('#page-home:not([hidden])').waitFor();
  await page.waitForTimeout(1000);
  const cdp=await page.context().newCDPSession(page);await cdp.send('HeapProfiler.collectGarbage');
  const styles=await page.evaluate(()=>[...document.styleSheets].map(sheet=>sheet.href).filter(Boolean));
  const files=await Promise.all(styles.map(async href=>{const name=path.basename(decodeURIComponent(new URL(href).pathname)),file=path.resolve('dist/renderer/assets',name);return{name,bytes:(await fs.stat(file)).size};}));
  const memory=await snapshot(app),renderer=memory.processes.find(process=>memory.windows.some(window=>window.view==='main'&&window.pid===process.pid));
  const result={packaged:!!process.env.ONE_PACKAGED_EXE,styles:files,totalCssBytes:files.reduce((sum,file)=>sum+file.bytes,0),rendererPrivateMiB:renderer.privateResident/1048576,treePrivateMiB:memory.privateResident/1048576};
  if(process.env.ONE_CHECK_LAZY_STYLES==='1'){
   assert.ok(result.totalCssBytes<175000,'Main window loaded heavyweight preview styles before they were needed');
   assert.equal(await page.evaluate(()=>[...document.styleSheets].some(sheet=>/preview-view-.*\.css/.test(sheet.href||''))),false);
   await page.locator('[data-page="input"]').click();await page.locator('#page-input:not([hidden])').waitFor();
   await page.locator('#enhancement-tab-echo').click();
   assert.equal(await page.locator('.echo-layout').evaluate(element=>getComputedStyle(element).display),'grid');
   assert.ok(await page.evaluate(()=>[...document.styleSheets].some(sheet=>/echo-.*\.css/.test(sheet.href||''))));
   await page.locator('[data-page="color"]').click();await page.locator('#page-color:not([hidden])').waitFor();
   assert.equal(await page.locator('.color-workbench').evaluate(element=>getComputedStyle(element).display),'grid');
   await page.locator('[data-page="preview"]').click();await page.locator('#page-preview:not([hidden])').waitFor();
   assert.equal(await page.locator('#dropzone').evaluate(element=>getComputedStyle(element).borderTopStyle),'dashed');
   assert.equal(await page.evaluate(()=>[...document.styleSheets].some(sheet=>/preview-redesign-.*\.css/.test(sheet.href||''))),false);
   assert.ok(await page.evaluate(()=>[...document.styleSheets].some(sheet=>/main-view-.*\.css/.test(sheet.href||''))),
     'Main-shell layout sheet should be ready before navigation');
   for(const [id,selector,display] of [['text','.text-page','grid'],['disk','.disk-workspace','grid']]){
    await page.locator(`[data-page="${id}"]`).click();await page.locator(`#page-${id}:not([hidden])`).waitFor();
    assert.equal(await page.locator(selector).evaluate(element=>getComputedStyle(element).display),display,`${id} structural style did not load`);
   }
   await page.locator('[data-page="hardware"]').click();await page.locator('#page-hardware:not([hidden])').waitFor();
   assert.equal(await page.locator('.information-layout').evaluate(element=>getComputedStyle(element).display),'grid');
   result.lazyStylesChecked=true;
  }
  console.log(JSON.stringify(result));await cdp.detach();
 }finally{await app.close();await fs.rm(profile,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
