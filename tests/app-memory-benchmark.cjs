const {_electron:electron,expect}=require('@playwright/test'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {execFile}=require('node:child_process'),{promisify}=require('node:util'),koffi=require('koffi');
const {processTree,totals}=require('./process-tree.cjs');
const execute=promisify(execFile),delay=ms=>new Promise(r=>setTimeout(r,ms));
const Memory=koffi.struct('OneAppBenchmarkMemory',{cb:'uint32',PageFaultCount:'uint32',PeakWorkingSetSize:'size_t',WorkingSetSize:'size_t',QuotaPeakPagedPoolUsage:'size_t',QuotaPagedPoolUsage:'size_t',QuotaPeakNonPagedPoolUsage:'size_t',QuotaNonPagedPoolUsage:'size_t',PagefileUsage:'size_t',PeakPagefileUsage:'size_t',PrivateUsage:'size_t',PrivateWorkingSetSize:'size_t',SharedCommitUsage:'size_t'});
const Time=koffi.struct('OneAppBenchmarkTime',{low:'uint32',high:'uint32'}),kernel=koffi.load('kernel32.dll'),psapi=koffi.load('psapi.dll');
const open=kernel.func('void * __stdcall OpenProcess(uint32, int, uint32)'),close=kernel.func('int __stdcall CloseHandle(void *)');
const getMemory=psapi.func('int __stdcall GetProcessMemoryInfo(void *, _Out_ OneAppBenchmarkMemory *, uint32)');
const times=kernel.func('int __stdcall GetProcessTimes(void *, _Out_ OneAppBenchmarkTime *, _Out_ OneAppBenchmarkTime *, _Out_ OneAppBenchmarkTime *, _Out_ OneAppBenchmarkTime *)');
function readProcessCounters(list){
 const processes=[];for(const p of list){const pid=p.ProcessId??p.pid,name=p.Name??p.name,h=open(0x410,0,pid);if(!h)continue;try{const m={cb:koffi.sizeof(Memory)},creation={},exit={},system={},user={};if(!times(h,creation,exit,system,user))continue;const created=((BigInt(creation.high)<<32n)|BigInt(creation.low)).toString();if(p.created&&p.created!==created||!getMemory(h,m,m.cb))continue;const toSeconds=t=>(t.high*4294967296+t.low)/1e7;processes.push({pid,name,parentPid:p.ParentProcessId??p.parentPid,created,resident:m.WorkingSetSize,privateResident:m.PrivateWorkingSetSize,private:m.PrivateUsage,cpuSeconds:toSeconds(system)+toSeconds(user)});}finally{close(h);}}
 return totals(processes);
}
async function snapshot(app,rootOverride){
 const root=rootOverride??await app.evaluate(()=>process.pid),created=readProcessCounters([{pid:root}]).processes[0]?.created;if(!created)throw Error('Root process unavailable for sampling');
 const {stdout}=await execute('powershell.exe',['-NoProfile','-NonInteractive','-Command','Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress'],{windowsHide:true,maxBuffer:4*1024*1024});
 const list=JSON.parse(stdout),owned=new Set([root]);let changed=true;while(changed){changed=false;for(const p of list)if(owned.has(p.ParentProcessId)&&!owned.has(p.ProcessId)){owned.add(p.ProcessId);changed=true;}}
 const raw=readProcessCounters(list.filter(p=>owned.has(p.ProcessId))),selected=processTree(raw.processes,root,created),counters=totals(selected,raw.at),selectedIds=new Set(selected.map(p=>p.pid));
 const windows=app?await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>({view:new URL(w.webContents.getURL()).searchParams.get('view'),query:new URL(w.webContents.getURL()).search,visible:w.isVisible(),pid:w.webContents.getOSProcessId()}))):[];
 return {...counters,excludedProcesses:raw.processes.filter(p=>!selectedIds.has(p.pid)).map(p=>({pid:p.pid,name:p.name,parentPid:p.parentPid,created:p.created,reason:'parent PID reused; creation order cannot establish ancestry'})),windows};
}
async function main(){
 const out=path.resolve(process.env.ONE_APP_OUTPUT||'work/app-memory');await fs.mkdir(out,{recursive:true});const name=process.env.ONE_BENCH_NAME||'current',profile=await fs.mkdtemp(path.join(out,name+'-'));
 const files=await fs.mkdtemp(path.join(out,'files-'));await fs.writeFile(path.join(files,'benchmark result.txt'),'benchmark');
 // Do not enable hooks or notifications in the user's running One instance.
 await require('esbuild').build({entryPoints:['src/shared/settings.ts'],outfile:path.join(out,'settings.cjs'),bundle:true,platform:'node'});
 const {mergeSettings,defaultSettings}=require(path.join(out,'settings.cjs'));
 let expectedCount=2,searchSettings={roots:[files],maxEntries:1000};
 if(process.env.ONE_BENCH_BIG_CACHE){const source=path.resolve(process.env.ONE_BENCH_BIG_CACHE),data=await fs.readFile(source);assert.equal(data.subarray(0,8).toString(),'ONEIDX06');const length=data.readUInt32LE(8),config=JSON.parse(data.subarray(12,12+length));assert.deepEqual(config.roots,[],'Use a frozen copied cache with verification roots disabled');expectedCount=Number(data.readBigUInt64LE(28+length));searchSettings=config;await fs.writeFile(path.join(profile,'file-index.bin'),data);const delta=await fs.readFile(source+'.delta').catch(()=>null);if(delta)await fs.writeFile(path.join(profile,'file-index.bin.delta'),delta);}
 const settings=mergeSettings(defaultSettings(),{search:searchSettings,diskMonitor:{enabled:true,notify:false},appearance:{mode:'light'}});
 await fs.writeFile(path.join(profile,'settings.json'),JSON.stringify(settings));
 const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
 const exe=process.env.ONE_PACKAGED_EXE,started=performance.now(),app=await electron.launch(exe?{executablePath:exe,args:[],env}:{args:[path.resolve('.')],env}),errors=[];
 app.on('window',page=>page.on('pageerror',e=>errors.push(String(e))));
 try{
  const main=await app.firstWindow();await main.waitForSelector('#overview-index');await expect.poll(()=>main.evaluate(async()=>(await window.one.searchState()).count),{timeout:30000}).toBe(expectedCount);await expect.poll(()=>main.evaluate(async()=>(await window.one.searchState()).running),{timeout:120000}).toBe(false);
  let query='benchmark result';if(process.env.ONE_BENCH_BIG_CACHE){const results=await main.evaluate(()=>window.one.searchFiles('"package.json"'));for(const item of results.items){if(!item.path.startsWith('one-launcher:')&&(await fs.stat(item.path).catch(()=>null))?.isFile()){query='"'+item.path+'"';break;}}assert.notEqual(query,'benchmark result','Need an existing indexed file for a read-only menu test');}
  const readyMs=performance.now()-started;await delay(1500);const startup=await snapshot(app);
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().filter(w=>w.webContents.getURL().includes('view=main')).forEach(w=>w.hide()));
  await delay(2500);const idleStart=await snapshot(app),idleSamples=[],idleUntil=performance.now()+Number(process.env.ONE_BENCH_IDLE_WINDOW_MS||5000);
  do {await delay(Math.min(5000,Math.max(0,idleUntil-performance.now())));idleSamples.push(await snapshot(app));} while(performance.now()<idleUntil);
  const idle=idleSamples.at(-1);
  await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('view=main'));w.show();w.focus();});
  await app.evaluate(({app,BrowserWindow})=>{globalThis.benchSearchShownAt=0;const watch=w=>w.on('show',()=>{const url=w.webContents.getURL();if(url&&new URL(url).searchParams.get('view')==='search'&&!url.includes('embedded'))globalThis.benchSearchShownAt=Date.now();});for(const w of BrowserWindow.getAllWindows())watch(w);app.on('browser-window-created',(_event,w)=>watch(w));});
  let at=performance.now();const calledAt=await main.evaluate(async()=>{const calledAt=Date.now();await window.one.showSearch();return calledAt;});
  await expect.poll(()=>app.windows().some(p=>p.url().includes('view=search')&&!p.url().includes('menu'))).toBe(true);
  let search=app.windows().find(p=>p.url().includes('view=search')&&!p.url().includes('menu'));
  await expect(search.locator('#file-query')).toBeVisible();await expect.poll(()=>app.evaluate(()=>globalThis.benchSearchShownAt)).toBeGreaterThan(0);const searchOpenMs=performance.now()-at,nativeSearchShowMs=await app.evaluate(()=>globalThis.benchSearchShownAt)-calledAt;
  await search.locator('#file-query').fill(query);await expect(search.locator('.search-result').first()).toBeVisible();
  // Give predictive prewarming the same amount of human think time in both builds.
  await delay(300);at=performance.now();await search.locator('.search-result').first().click({button:'right'});
  await expect.poll(()=>app.windows().some(p=>p.url().includes('view=file-context')&&!p.url().includes('submenu'))).toBe(true);
  const menu=app.windows().find(p=>p.url().includes('view=file-context')&&!p.url().includes('submenu'));
  await expect(menu.locator('[data-file-action=rename]')).toBeVisible();const contextOpenMs=performance.now()-at;
  await menu.locator('[data-file-action=apps]').hover();await expect.poll(()=>app.windows().some(p=>p.url().includes('submenu=apps'))).toBe(true);
  const submenu=app.windows().find(p=>p.url().includes('submenu=apps'));await expect(submenu.locator('[data-file-action=choose]')).toBeVisible();
  const used=await snapshot(app);await menu.evaluate(()=>window.one.fileMenuClose(false));await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.hide()));
  await delay(Number(process.env.ONE_BENCH_IDLE_MS||6000));const afterUse=await snapshot(app);
  const cpuPercentOneCore=(idle.cpuSeconds-idleStart.cpuSeconds)/(idle.at-idleStart.at)*100000;
  if(process.env.ONE_EXPECT_RECLAIM==='1')assert.ok(afterUse.windows.every(w=>w.view!=='file-context'&&w.view!=='search'),'hidden search and menu renderers must be reclaimed');
  await main.evaluate(()=>window.one.showSearch());await expect.poll(()=>app.windows().some(p=>p.url().includes('view=search')&&!p.url().includes('menu'))).toBe(true);search=app.windows().find(p=>p.url().includes('view=search')&&!p.url().includes('menu'));await search.locator('#file-query').fill(query);await expect(search.locator('.search-result').first()).toBeVisible();
  at=performance.now();await search.locator('.search-result').first().click({button:'right'});await expect.poll(()=>app.windows().some(p=>p.url().includes('view=file-context')&&!p.url().includes('submenu'))).toBe(true);
  const reopened=app.windows().find(p=>p.url().includes('view=file-context')&&!p.url().includes('submenu'));await expect(reopened.locator('[data-file-action=rename]')).toBeVisible();const reopenContextMs=performance.now()-at;
  await reopened.locator('[data-file-action=apps]').hover();await expect.poll(()=>app.windows().some(p=>p.url().includes('submenu=apps'))).toBe(true);await expect(app.windows().find(p=>p.url().includes('submenu=apps')).locator('[data-file-action=choose]')).toBeVisible();
  const report={name,indexCount:expectedCount,readyMs,searchOpenMs,nativeSearchShowMs,contextOpenMs,reopenContextMs,cpuPercentOneCore,startup,idleStart,idleSamples,idle,used,afterUse,errors};
  assert.deepEqual(errors,[]);await fs.writeFile(path.join(out,name+'.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({name,readyMs,searchOpenMs,nativeSearchShowMs,contextOpenMs,reopenContextMs,cpuPercentOneCore,startupMB:startup.resident/1024**2,idleMB:idle.resident/1024**2,idlePrivateResidentMB:idle.privateResident/1024**2,afterUseMB:afterUse.resident/1024**2,afterUsePrivateResidentMB:afterUse.privateResident/1024**2,windows:startup.windows.map(w=>w.query),errors}));
 }finally{await app.close();}
}
module.exports={snapshot,readProcessCounters};
if(require.main===module){const work=process.env.ONE_LIVE_PID?snapshot(null,Number(process.env.ONE_LIVE_PID)).then(async report=>{const out=path.resolve('work/app-memory/live-snapshot.json');await fs.mkdir(path.dirname(out),{recursive:true});await fs.writeFile(out,JSON.stringify({date:new Date().toISOString(),note:'Read-only snapshot of a running instance; current workload is unknown, not a pure idle baseline.',...report},null,2));console.log(JSON.stringify({residentMB:report.resident/1024**2,privateResidentMB:report.privateResident/1024**2,privateMB:report.private/1024**2,processes:report.processes.length}));}):main();work.catch(e=>{console.error(e);process.exitCode=1;});}
