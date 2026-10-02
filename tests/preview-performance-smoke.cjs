const {_electron:electron,expect}=require('@playwright/test');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
async function run(){
 const output=path.resolve(process.env.ONE_TEST_OUTPUT_DIR||'work/preview-performance');await fs.mkdir(output,{recursive:true});const file=path.join(output,'large.log');await fs.writeFile(file,'2026-10-01 INFO continuous document 12345\n'.repeat(600000)+'PERFORMANCE_END');
 const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:await fs.mkdtemp(path.join(output,'profile-'))};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch(process.env.ONE_PACKAGED_EXE?{executablePath:process.env.ONE_PACKAGED_EXE,args:[],env}:{args:[path.resolve('.')],env});
 try{
  const main=await app.firstWindow();await main.waitForSelector('[data-page=text]');await main.locator('[data-page=text]').click();await main.waitForSelector('#source');await main.evaluate(()=>window.one.patchSettings({preview:{held:true,files:false}}));const opening=app.waitForEvent('window',{predicate:p=>p.url().includes('view=preview')}),start=Date.now();await main.evaluate(p=>window.one.preview(p),file);const page=await opening;
  await page.evaluate(()=>{window.frameDelays=[];let last=performance.now();window.heartbeat=setInterval(()=>{const now=performance.now();window.frameDelays.push(now-last);last=now;},50);});
  await page.locator('#preview-files').click();await page.locator('#side-details').click();await expect(page.locator('#side-details')).toHaveAttribute('aria-selected','true');await expect(page.locator('.cm-editor')).toBeVisible({timeout:30000});const readyMs=Date.now()-start;assert.ok(await page.locator('.cm-line').count()<500);
  await page.locator('.cm-scroller').evaluate(e=>e.scrollTop=e.scrollHeight);await expect(page.locator('.cm-content')).toContainText('PERFORMANCE_END');const heartbeat=await page.evaluate(()=>{clearInterval(window.heartbeat);return Math.max(0,...window.frameDelays);});assert.ok(heartbeat<1500,'UI stalled: '+heartbeat);assert.equal(await page.locator('.source-pagination').count(),0);
  await page.locator('#preview-close').click();await expect.poll(()=>page.isClosed()).toBe(true);const result={result:'PASS',packaged:!!process.env.ONE_PACKAGED_EXE,bytes:(await fs.stat(file)).size,lines:600001,readyMs,maxHeartbeatMs:Math.round(heartbeat),continuous:true,cancellable:true};await fs.writeFile(path.join(output,process.env.ONE_PACKAGED_EXE?'packaged.json':'source.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{await app.close();}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
