const {_electron:electron,expect}=require('@playwright/test');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {snapshot,readProcessCounters}=require('./app-memory-benchmark.cjs');
const delay=ms=>new Promise(r=>setTimeout(r,ms)),MiB=1024**2;

async function run(){
 const output=path.resolve('work/file-tools-memory');await fs.mkdir(output,{recursive:true});
 const own=await fs.mkdtemp(path.join(output,'run-')),profile=path.join(own,'profile');await fs.mkdir(profile);
 // Write actual contents, rather than benchmarking sparse files that Windows can skip reading.
 const block=crypto.randomBytes(MiB),cases=[];
 for(const sizeMiB of [64,512]){
  const root=path.join(own,'files-'+sizeMiB);await fs.mkdir(root);
  const a=path.join(root,'a.bin'),b=path.join(root,'b.bin'),handle=await fs.open(a,'wx');
  try{for(let n=0;n<sizeMiB;n++)await handle.write(block);await handle.sync();}finally{await handle.close();}
  await fs.copyFile(a,b);cases.push({sizeMiB,root,a,b});
 }
 await require('esbuild').build({entryPoints:['src/shared/settings.ts'],outfile:path.join(own,'settings.cjs'),bundle:true,platform:'node'});
 const {mergeSettings,defaultSettings}=require(path.join(own,'settings.cjs'));
 await fs.writeFile(path.join(profile,'settings.json'),JSON.stringify(mergeSettings(defaultSettings(),{search:{roots:[cases[0].root],maxEntries:1000},diskMonitor:{enabled:true,notify:false},appearance:{mode:'light'}})));
 const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch(process.env.ONE_PACKAGED_EXE?{executablePath:process.env.ONE_PACKAGED_EXE,args:[],env}:{args:[path.resolve('.')],env}),errors=[],results=[];
 app.on('window',page=>page.on('pageerror',e=>errors.push(String(e))));
 try{
  const page=await app.firstWindow();await page.waitForSelector('#overview-index');
  await expect.poll(()=>page.evaluate(async()=>(await window.one.searchState()).running)).toBe(false);
  await delay(1000);await page.locator('[data-page=tools]').click();await page.waitForSelector('#tool-run');
  const tree=await snapshot(app);
  for(const item of cases){
   await page.evaluate(()=>{
    window.benchmarkGaps=[];window.benchmarkProgress=[];window.benchmarkResult=null;window.benchmarkError='';
    let last=performance.now();window.benchmarkHeartbeat=setInterval(()=>{const at=performance.now();window.benchmarkGaps.push(at-last);last=at;},20);
    window.benchmarkProgressOff=window.one.onFileToolsProgress(value=>window.benchmarkProgress.push(value));
   });
   const before=readProcessCounters(tree.processes),samples=[before],timer=setInterval(()=>samples.push(readProcessCounters(tree.processes)),100);
   const at=performance.now();
   try{
    await page.evaluate(root=>{void window.one.fileToolsRun({kind:'duplicates',roots:[root],recursive:true,minBytes:0,extensions:''}).then(report=>window.benchmarkResult=report).catch(e=>window.benchmarkError=String(e));},item.root);
    if(item.sizeMiB===512)await expect.poll(()=>page.evaluate(()=>window.benchmarkProgress.some(p=>p.phase==='校验完整内容')||Boolean(window.benchmarkResult)),{intervals:[25,50,100],timeout:30000}).toBe(true);
    const navigationWhileRunning=await page.evaluate(()=>!window.benchmarkResult&&!window.benchmarkError);
    if(item.sizeMiB===512)assert.ok(navigationWhileRunning,'The large-file navigation must happen while hashing is active');
    const nav=performance.now();await page.locator('[data-page=home]').click();await expect(page.locator('#page-name')).toHaveText('概览');const navigationMs=performance.now()-nav;
    await expect.poll(()=>page.evaluate(()=>Boolean(window.benchmarkResult||window.benchmarkError)),{timeout:60000}).toBe(true);
    const durationMs=performance.now()-at;
    samples.push(readProcessCounters(tree.processes));
    const data=await page.evaluate(()=>{clearInterval(window.benchmarkHeartbeat);window.benchmarkProgressOff();return{report:window.benchmarkResult,error:window.benchmarkError,gaps:window.benchmarkGaps,progress:window.benchmarkProgress};});
    assert.equal(data.error,'');assert.equal(data.report.count,1);assert.equal(data.report.stats.duplicateFiles,2);assert.equal(data.report.stats.wasted,item.sizeMiB*MiB);assert.equal(data.report.issueCount,0);
    assert.ok(data.report.stats.bytesRead>=2*item.sizeMiB*MiB,'Both files must be fully hashed');
    const peakResident=Math.max(...samples.map(s=>s.privateResident)),peakCommit=Math.max(...samples.map(s=>s.private)),gaps=data.gaps.sort((a,b)=>a-b),heartbeatP95Ms=gaps[Math.floor(gaps.length*.95)];
    const record={sizeMiB:item.sizeMiB,totalInputMiB:item.sizeMiB*2,durationMs,navigationMs,navigationWhileRunning,heartbeatP95Ms,heartbeatMaxMs:gaps.at(-1),sampleIntervalMs:100,sampleCount:samples.length,beforePrivateResidentMiB:before.privateResident/MiB,peakPrivateResidentMiB:peakResident/MiB,addedPrivateResidentMiB:Math.max(0,peakResident-before.privateResident)/MiB,beforePrivateCommitMiB:before.private/MiB,peakPrivateCommitMiB:peakCommit/MiB,addedPrivateCommitMiB:Math.max(0,peakCommit-before.private)/MiB,report:data.report,progressPhases:[...new Set(data.progress.map(p=>p.phase))],samples};
    assert.ok(heartbeatP95Ms<100,'The renderer must stay responsive');
    if(item.sizeMiB===512)assert.ok(record.addedPrivateCommitMiB<256,'Streaming a 512 MiB file must not allocate its entire contents');
    results.push(record);console.log(JSON.stringify({...record,report:undefined,samples:undefined}));
   }finally{clearInterval(timer);}
   await page.locator('[data-page=tools]').click();await delay(500);
  }
  assert.deepEqual(errors,[]);await fs.writeFile(path.join(output,'latest.json'),JSON.stringify({date:new Date().toISOString(),package:process.env.ONE_PACKAGED_EXE,profile:own,note:'Same known owned process tree sampled every 100 ms; workers share the main process. Transient helper processes are not included. Windows cache and residency affect results.',results,errors},null,2));
 }finally{
  await app.close();
  // Remove only the four newly generated, explicitly named data files from this owned run.
  const resolvedOwn=await fs.realpath(own);assert.equal(path.dirname(resolvedOwn).toLowerCase(),(await fs.realpath(output)).toLowerCase());
  for(const item of cases)for(const file of [item.a,item.b]){const target=await fs.realpath(file);assert.ok(target.toLowerCase().startsWith(resolvedOwn.toLowerCase()+path.sep));await fs.unlink(target);}
 }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
