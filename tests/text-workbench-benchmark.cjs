const {_electron:electron,expect}=require('@playwright/test'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {snapshot,readProcessCounters}=require('./app-memory-benchmark.cjs');
async function run(){
 const out=path.resolve('work/text-workbench'),name=process.env.ONE_BENCH_NAME||'current';await fs.mkdir(out,{recursive:true});const profile=await fs.mkdtemp(path.join(out,name+'-'));
 const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch(process.env.ONE_PACKAGED_EXE?{executablePath:process.env.ONE_PACKAGED_EXE,args:[],env}:{args:[path.resolve('.')],env}),errors=[];app.on('window',p=>p.on('pageerror',e=>errors.push(String(e))));let sampling;
 try{
  const page=await app.firstWindow();await page.waitForSelector('[data-page=text]');await page.locator('[data-page=text]').click();await expect(page.locator('#source')).toBeVisible();await page.waitForTimeout(300);
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.webContents.setBackgroundThrottling(false)));
  const virtual=await page.locator('#source .cm-editor').count()>0,baseline=await snapshot(app),processes=baseline.processes.map(p=>({pid:p.pid,name:p.name})),samples=[readProcessCounters(processes)];sampling=setInterval(()=>samples.push(readProcessCounters(processes)),100);
  await page.evaluate(()=>{window.textGaps=[];let last=performance.now();window.textHeartbeat=setInterval(()=>{const now=performance.now();window.textGaps.push(now-last);last=now;},20);});
  const count=350000,content=' 甲乙丙丁  \n'.repeat(count);const at=performance.now();
  await app.evaluate(({BrowserWindow},text)=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('view=main')).webContents.send('one:receive-text',text),content);
  await expect(page.locator('#source-count')).toContainText(content.length.toLocaleString(),{timeout:30000});if(virtual)await expect(page.locator('#source')).toHaveAttribute('aria-busy','false');const loadMs=performance.now()-at;
  const start=performance.now();await page.locator('[data-operation=clean]').click();await expect(page.locator('#text-state')).toHaveText('处理完成',{timeout:30000});const pipelineAndDisplayMs=performance.now()-start;
  const resultLength=await page.locator('#result-count').textContent(),domLines=await page.locator('#source .cm-line').count();
  if(virtual){assert.ok(domLines<150);await page.locator('#source .cm-content').focus();await page.keyboard.press('Control+End');await page.keyboard.insertText('末尾编辑');await expect(page.locator('#source .cm-content')).toContainText('末尾编辑');await page.keyboard.press('Control+z');await expect(page.locator('#source-count')).toContainText(content.length.toLocaleString());}
  const navigation=performance.now();await page.locator('[data-page=home]').click();await expect(page.locator('#page-name')).toHaveText('概览');const navigationMs=performance.now()-navigation;await page.locator('[data-page=text]').click();
  await page.locator('#text-compare').click();await expect(page.locator('#text-cancel')).toBeEnabled();const cmp=performance.now();await expect(page.locator('#text-cancel')).toBeDisabled({timeout:35000});const compareMs=performance.now()-cmp,comparisonVisible=await page.locator('#text-diff-dialog').isVisible();
  if(virtual){assert.equal(comparisonVisible,true);await expect(page.locator('.text-diff-pair')).toBeVisible();await page.screenshot({path:path.join(out,name+'-diff.png'),animations:'disabled'});await page.locator('#text-diff-close').click();await expect(page.locator('#text-diff-dialog')).not.toBeVisible();}
  await page.waitForTimeout(2000);clearInterval(sampling);samples.push(readProcessCounters(processes));const after=await snapshot(app),gaps=await page.evaluate(()=>{clearInterval(window.textHeartbeat);return window.textGaps.sort((a,b)=>a-b);});
  const report={name,virtual,inputCharacters:content.length,lines:count,loadMs,pipelineAndDisplayMs,compareMs,comparisonVisible,resultLength,domLines,navigationMs,heartbeatP95:gaps[Math.floor(gaps.length*.95)],maxGap:gaps.at(-1),peakAddedPrivateMiB:(Math.max(...samples.map(s=>s.private))-samples[0].private)/1024**2,peakAddedPrivateResidentMiB:(Math.max(...samples.map(s=>s.privateResident))-samples[0].privateResident)/1024**2,baseline,after,samplingMs:100,errors};assert.deepEqual(errors,[]);await fs.writeFile(path.join(out,name+'.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,baseline:{privateMiB:baseline.private/1024**2,privateResidentMiB:baseline.privateResident/1024**2},after:{privateMiB:after.private/1024**2,privateResidentMiB:after.privateResident/1024**2}},null,2));await page.screenshot({path:path.join(out,name+'-editor.png'),animations:'disabled'});
 }finally{clearInterval(sampling);await app.close();}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
