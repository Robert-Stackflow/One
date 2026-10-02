const {_electron:electron,expect}=require('@playwright/test');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {readProcessCounters}=require('./app-memory-benchmark.cjs');
async function main(){
 const root=path.resolve('work/large-diff');await fs.mkdir(root,{recursive:true});const name=process.env.ONE_BENCH_NAME||'current',profile=await fs.mkdtemp(path.join(root,name+'-'));
 const files=await fs.mkdtemp(path.join(root,'files-')),left=path.join(files,'left.txt'),right=path.join(files,'right.txt');
 const lines=Number(process.env.ONE_DIFF_LINES||50000);assert.ok(Number.isInteger(lines)&&lines>0&&lines<=2000000);
 const content=side=>lines>250000?(side+'\n').repeat(lines):Array.from({length:lines},(_,i)=>i%50===0?`shared anchor ${i}\n`:`${side} ${i} ${'sample content '.repeat(4)}\n`).join('');
 await fs.writeFile(left,content('original'));await fs.writeFile(right,content('revised'));
 const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch(process.env.ONE_PACKAGED_EXE?{executablePath:process.env.ONE_PACKAGED_EXE,args:[],env}:{args:[path.resolve('.')],env}),errors=[];app.on('window',page=>page.on('pageerror',error=>errors.push(String(error))));
 let timer;
 try{
  const page=await app.firstWindow();await page.waitForSelector('#overview-index');await page.locator('[data-page=tools]').click();await page.locator('#tool-tab-diff').click();
  await page.locator('#diff-left').fill(left);await page.locator('#diff-right').fill(right);
  const processes=await app.evaluate(({app})=>app.getAppMetrics().map(p=>({pid:p.pid,name:p.type}))),samples=[readProcessCounters(processes)];
  await page.evaluate(()=>{window.diffGaps=[];let last=performance.now();window.diffHeartbeat=setInterval(()=>{const now=performance.now();window.diffGaps.push(now-last);last=now;},20);});
  timer=setInterval(()=>samples.push(readProcessCounters(processes)),100);
  const started=performance.now();await page.locator('#tool-run').click();await expect(page.locator('#tool-stop')).toBeEnabled();
  const navigationAt=performance.now();await page.locator('[data-page=home]').click();await expect(page.locator('#page-name')).toHaveText('概览');const navigationMs=performance.now()-navigationAt;
  await page.locator('[data-page=tools]').click();await expect(page.locator('#tool-run')).toBeEnabled({timeout:35000});const elapsedMs=performance.now()-started;
  const title=await page.locator('#tool-result-title').textContent(),error=(await page.locator('.toast').last().textContent().catch(()=>null))||null,gaps=await page.evaluate(()=>{clearInterval(window.diffHeartbeat);return window.diffGaps.sort((a,b)=>a-b);});
  clearInterval(timer);samples.push(readProcessCounters(processes));
  const report={name,lines,elapsedMs,navigationMs,title,error,heartbeatP95:gaps[Math.floor(gaps.length*.95)],peakAddedPrivateMiB:(Math.max(...samples.map(s=>s.private))-samples[0].private)/1024**2,peakAddedPrivateResidentMiB:(Math.max(...samples.map(s=>s.privateResident))-samples[0].privateResident)/1024**2,samplingMs:100,errors};
  assert.deepEqual(errors,[]);if(process.env.ONE_EXPECT_DIFF_SUCCESS==='1'){assert.match(title,/新增 \d+ 行 · 删除 \d+ 行/);assert.equal(error,null);await expect(page.locator('#tool-result-detail')).toContainText('按连续文本块');await expect(page.locator('.file-diff-hunk').first()).toBeVisible();await page.screenshot({path:path.join(root,name+'.png')});}
  if(lines>250000){
   const history=await page.evaluate(()=>window.one.fileToolsHistory()),result=history.find(r=>r.kind==='diff');assert.equal(result.stats.addedLines,lines);assert.equal(result.stats.removedLines,lines);
   let original='',revised='';for(let n=0;n<Math.ceil(result.count/100);n++){const rows=JSON.parse(await fs.readFile(path.join(profile,'file-tools',result.id,`page-${n}.json`),'utf8'));for(const row of rows){original+=row.leftText;revised+=row.rightText;}}
   assert.equal(original,await fs.readFile(left,'utf8'));assert.equal(revised,await fs.readFile(right,'utf8'));report.persistedContentsVerified=true;
   await page.evaluate(({left,right})=>{
    window.cancelledDiff=null;window.diffStarted=false;window.offDiff=window.one.onFileToolsProgress(p=>{if(p.kind==='diff'&&p.phase==='比较文本')window.diffStarted=true;});
    void window.one.fileToolsRun({kind:'diff',mode:'file',left,right,encoding:'自动',ignoreWhitespace:false}).then(()=>window.cancelledDiff='completed').catch(e=>window.cancelledDiff=String(e));
   },{left,right});
   await expect.poll(()=>page.evaluate(()=>window.diffStarted),{intervals:[10,20,50]}).toBe(true);
   const cancelAt=performance.now();await page.evaluate(()=>window.one.fileToolsCancel('diff'));await expect.poll(()=>page.evaluate(()=>window.cancelledDiff),{intervals:[10,20,50]}).toMatch(/任务已停止/);report.cancelMs=performance.now()-cancelAt;await page.evaluate(()=>window.offDiff());
  }
  await fs.writeFile(path.join(root,name+'.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{clearInterval(timer);await app.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
