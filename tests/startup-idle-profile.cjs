const {_electron:electron,expect}=require('@playwright/test'),fs=require('fs/promises'),path=require('path'),assert=require('assert/strict');
const {snapshot}=require('./app-memory-benchmark.cjs');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
 const out=path.resolve(process.env.ONE_PROFILE_OUTPUT||'C:/Users/ruida/Documents/Codex/2026-09-13/dioa/work/startup-idle');await fs.mkdir(out,{recursive:true});
 const profile=await fs.mkdtemp(path.join(out,'profile-'));
 await require('esbuild').build({entryPoints:['src/shared/settings.ts'],outfile:path.join(out,'settings.cjs'),bundle:true,platform:'node'});
 const {mergeSettings,defaultSettings}=require(path.join(out,'settings.cjs'));
 const frozen=await fs.readFile(process.env.ONE_BENCH_BIG_CACHE||'D:/Repositories/One/work/index-memory/run-kqm1CD/snapshot.bin');assert.equal(frozen.subarray(0,8).toString(),'ONEIDX06');const n=frozen.readUInt32LE(8),settings=JSON.parse(frozen.subarray(12,12+n));assert.deepEqual(settings.roots,[]);const count=Number(frozen.readBigUInt64LE(28+n));
 await fs.writeFile(path.join(profile,'file-index.bin'),frozen);await fs.writeFile(path.join(profile,'settings.json'),JSON.stringify(mergeSettings(defaultSettings(),{search:settings,diskMonitor:{enabled:true,notify:false},appearance:{mode:'light'}})));
 const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;const at=performance.now(),stages=[];const stage=name=>{const value={name,elapsedMs:performance.now()-at};stages.push(value);console.log(JSON.stringify(value));};
 const app=await electron.launch(process.env.ONE_PACKAGED_EXE?{executablePath:process.env.ONE_PACKAGED_EXE,args:[],env}:{args:[path.resolve('.')],env}),errors=[];stage('debuggerConnected');app.on('window',p=>p.on('pageerror',e=>errors.push(String(e))));
 try{
  const page=await app.firstWindow();stage('firstWindow');await page.waitForSelector('#overview-index');stage('mainDOMReady');
  await expect.poll(()=>page.evaluate(async()=>(await window.one.searchState()).count),{timeout:30000}).toBe(count);stage('indexLoaded');await expect.poll(()=>page.evaluate(async()=>(await window.one.searchState()).running),{timeout:120000}).toBe(false);stage('indexReady');
  const found=await page.evaluate(()=>window.one.searchFiles('"package.json"'));stage('menuFixtureQuery');let fileChecks=0;for(const item of found.items){fileChecks++;if(!item.path.startsWith('one-launcher:')&&(await fs.stat(item.path).catch(()=>null))?.isFile())break;}stage('menuFixtureLookup');
  await delay(1500);const windows=app.windows(),sessions=[];for(const p of windows){const view=new URL(p.url()).searchParams.get('view');if(!['main','search'].includes(view))continue;await p.evaluate(()=>{window.profileMutations=0;window.profileObserver=new MutationObserver(r=>window.profileMutations+=r.length);window.profileObserver.observe(document.documentElement,{subtree:true,childList:true,attributes:true,characterData:true});});const session=await app.context().newCDPSession(p);await session.send('Profiler.enable');await session.send('Profiler.setSamplingInterval',{interval:10000});await session.send('Profiler.start');sessions.push({view,page:p,session});}
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.hide()));await delay(2500);for(const p of windows)await p.evaluate(()=>window.profileMutations=0);const before=await snapshot(app);await delay(20000);const after=await snapshot(app),profiles=[];
  for(const {view,page,session}of sessions){const result=await session.send('Profiler.stop'),hits=new Map();for(const id of result.profile.samples||[])hits.set(id,(hits.get(id)||0)+1);const nodes=result.profile.nodes.filter(n=>hits.has(n.id)).map(n=>({...n.callFrame,hits:hits.get(n.id)})).sort((a,b)=>b.hits-a.hits);profiles.push({view,dom:await page.evaluate(()=>({hidden:document.hidden,mutations:window.profileMutations})),top:nodes.slice(0,30)});await fs.writeFile(path.join(profile,view+'.cpuprofile'),JSON.stringify(result.profile));await session.detach();}
  const windowsState=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>({view:new URL(w.webContents.getURL()).searchParams.get('view'),visible:w.isVisible(),throttled:w.webContents.getBackgroundThrottling(),pid:w.webContents.getOSProcessId()})));
  const report={profile,count,stages,fileChecks,before,after,windowsState,profiles,errors};assert.deepEqual(errors,[]);await fs.writeFile(path.join(out,(process.env.ONE_PROFILE_NAME||'current')+'.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({stages,fileChecks,windowsState,profiles},null,2));
 }finally{await app.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
