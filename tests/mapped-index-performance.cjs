// Experimental immutable image only. The live index is never opened or changed.
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{spawn,execFile}=require('node:child_process'),{promisify}=require('node:util'),{createHash}=require('node:crypto'),koffi=require('koffi');
const {frozen,run,queries}=require('./index-load-memory.cjs'),execute=promisify(execFile),delay=ms=>new Promise(r=>setTimeout(r,ms));
const Memory=koffi.struct('OneMappedMemory',{cb:'uint32',PageFaultCount:'uint32',PeakWorkingSetSize:'size_t',WorkingSetSize:'size_t',QuotaPeakPagedPoolUsage:'size_t',QuotaPagedPoolUsage:'size_t',QuotaPeakNonPagedPoolUsage:'size_t',QuotaNonPagedPoolUsage:'size_t',PagefileUsage:'size_t',PeakPagefileUsage:'size_t',PrivateUsage:'size_t'});
const kernel=koffi.load('kernel32.dll'),psapi=koffi.load('psapi.dll'),open=kernel.func('void * __stdcall OpenProcess(uint32,int,uint32)'),close=kernel.func('int __stdcall CloseHandle(void *)'),getMemory=psapi.func('int __stdcall GetProcessMemoryInfo(void *, _Out_ OneMappedMemory *, uint32)');
function memory(handle){const value={cb:koffi.sizeof(Memory)};assert.ok(getMemory(handle,value,value.cb));return{resident:value.WorkingSetSize,private:value.PrivateUsage,peakResident:value.PeakWorkingSetSize,peakPrivate:value.PeakPagefileUsage};}
const FileTime=koffi.struct('OneMappedTime',{low:'uint32',high:'uint32'}),getTimes=kernel.func('int __stdcall GetProcessTimes(void *, _Out_ OneMappedTime *, _Out_ OneMappedTime *, _Out_ OneMappedTime *, _Out_ OneMappedTime *)');
function cpuTime(handle){const c={},e={},s={},u={};assert.ok(getTimes(handle,c,e,s,u));return(s.high*2**32+s.low+u.high*2**32+u.low)/10000;}
async function mapped(exe,image,cases,verifyConcurrency=false){
 const start=performance.now(),child=spawn(exe,['mapped-query',image],{windowsHide:true}),handle=open(0x410,0,child.pid);assert.ok(handle);
 let buffer='',ready,count,serial=0;const pending=new Map(),errors=[];
 const send=value=>child.stdin.write(JSON.stringify(value)+'\n');
 const exited=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('Probe exit '+code)));});exited.catch(()=>{});
 child.stderr.on('data',data=>errors.push(data.toString()));child.stdout.setEncoding('utf8');
 child.stdout.on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\n'))>=0){const value=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);
  if(value.ready){ready=performance.now()-start;count=value.count;continue;}
  const item=pending.get(value.id);if(!item)continue;
  if(value.result?.partial){item.partial={...value.result,wallMs:performance.now()-item.start};continue;}
  clearTimeout(item.timer);pending.delete(value.id);value.error?item.reject(Error(value.error)):item.resolve({result:value.result,partial:item.partial,wallMs:performance.now()-item.start,cpuMs:cpuTime(handle)-item.cpu});
 }});
 const query=options=>new Promise((resolve,reject)=>{const id=++serial,start=performance.now(),cpu=cpuTime(handle);pending.set(id,{resolve,reject,start,cpu,timer:setTimeout(()=>{pending.delete(id);reject(Error('Probe timeout '+options.query));},30000)});send({type:'query',id,fuzzy:true,pinyin:true,currentFolder:'D:\\Repositories\\One',...options});});
 try{
  const until=performance.now()+10000;while(ready===undefined&&performance.now()<until){assert.equal(child.exitCode,null);await delay(20);}assert.ok(ready!==undefined);
  await delay(100);const loaded=memory(handle),results=[];
  for(const options of cases){const timings=[];let value;for(let n=0;n<2;n++){value=await query(options);assert.ok(!value.result.cancelled);timings.push({wallMs:value.wallMs,nativeMs:value.result.elapsed,partialMs:value.partial?.wallMs,cpuMs:value.cpuMs});}results.push({query:options.query,options,total:value.result.total,items:value.result.items,timings,partial:value.partial});}
  let concurrency;
  if(verifyConcurrency){
   const qq=results.find(r=>r.query==='QQ'),doc=results.find(r=>r.query==='ext:json package');assert.ok(qq&&doc);
   const mixed=await Promise.all([query({query:'QQ',scope:901}),query({query:'ext:json package',scope:902}),query({query:'QQ',scope:901})]);
   for(const [value,expected]of [[mixed[1],doc],[mixed[2],qq]]){assert.ok(!value.result.cancelled);assert.equal(value.result.total,expected.total);assert.deepEqual(value.result.items,expected.items);}
   const at=performance.now();const burst=await Promise.all(Array.from({length:20},(_,n)=>query({query:n===19?'QQ':'reprot',scope:903})));
   assert.ok(!burst.at(-1).result.cancelled);assert.deepEqual(burst.at(-1).result.items,qq.items);assert.equal(burst.at(-1).result.total,qq.total);
   for(const value of burst.filter(v=>v.result.cancelled)){assert.deepEqual(value.result.items,[]);assert.equal(value.result.total,0);}
   assert.ok(burst.filter(v=>v.result.cancelled).length>=18,'Superseded queries should not accumulate');
   const burstMs=performance.now()-at;assert.ok(burstMs<5000,'Typing should not queue twenty complete scans');
   await assert.rejects(query({query:'x'.repeat(4001),scope:904}),/搜索条件过长/);
   const recovered=await query({query:'QQ',scope:904});assert.deepEqual(recovered.result.items,qq.items);
   concurrency={independentScopes:true,supersededCancelled:burst.filter(v=>v.result.cancelled).length,burstMs,errorRecovery:true};
  }
  // Remapping never keeps the large index resident between requests.
  await delay(200);const settled=memory(handle);assert.deepEqual(errors,[]);send({type:'stop'});child.stdin.end();await exited;
  return{count,readyMs:ready,loaded,settled,queries:results,concurrency};
 }finally{for(const item of pending.values())clearTimeout(item.timer);close(handle);if(child.exitCode===null){child.kill();await exited.catch(()=>{});}}
}
async function main(){
 const out=path.resolve(process.env.ONE_TEST_OUTPUT_DIR||'work/current/mapped-index-performance'),profile=path.join(out,'profile');await fs.mkdir(profile,{recursive:true});
 const source=await frozen(path.resolve(process.env.ONE_AUDIT_INDEX||'work/dev-profile/file-index.bin'));
 const baseline=path.join(out,'before.exe'),exe=path.resolve('work/rust-search/release/one-index.exe'),cache=path.join(profile,'file-index.bin'),image=path.join(profile,'mapped.bin'),config=path.join(profile,'config.json');
 const rules=[{path:'D:\\Repositories',priority:'uncommon'},{path:'D:\\Repositories\\One',priority:'high'},{path:'C:\\Users',priority:'high'},{path:'D:\\Ruida',priority:'normal'},{path:'C:\\Windows',priority:'uncommon'}];
 const cases=[...queries.map(query=>({query})),{query:'ext:json package',priorities:rules},{query:'folder: downloads',priorities:rules},{query:'ext:json package',fuzzy:false,pinyin:false},{query:'jdbg',fuzzy:false,pinyin:true},{query:'ext:json package',currentFolder:''},{query:'"repositories\\one\\package.json"',currentFolder:'D:\\Repositories\\One'}];
 const before=await run(baseline,cache,source,cases);
 // Generic search access must also preserve the ordinary mutable engine.
 const after=await run(exe,cache,source,cases);
 await fs.writeFile(config,JSON.stringify(source.config));
 const built=await execute(exe,['mapped-build',cache,image,config],{windowsHide:true,timeout:60000,maxBuffer:1024*1024});const build=JSON.parse(built.stdout.trim());
 const disk=await mapped(exe,image,[...cases,{query:'ext:json package',progressive:true}]);
 assert.equal(before.count,after.count);assert.equal(before.count,disk.count);
 for(let i=0;i<cases.length;i++)for(const candidate of [after,disk]){
  assert.equal(candidate.queries[i].total,before.queries[i].total,cases[i].query);
  assert.deepEqual(candidate.queries[i].items,before.queries[i].items,cases[i].query);
 }
 assert.ok(disk.queries.at(-1).partial);assert.deepEqual(disk.queries.at(-1).items,disk.queries[4].items);
 assert.ok(disk.loaded.private<32*1024**2);assert.ok(disk.settled.private<32*1024**2);assert.ok(disk.settled.resident<32*1024**2);
 const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
 const report={date:new Date().toISOString(),note:'Diagnostic immutable image. Same real snapshot and delta; no active app changes. OS disk cache is warm from image creation. No update/watcher or cold-storage guarantee.',hashes:{before:hash(await fs.readFile(baseline)),candidate:hash(await fs.readFile(exe)),snapshot:hash(source.bytes),delta:source.delta?hash(source.delta):null},sourceBytes:source.sourceBytes,deltaBytes:source.deltaBytes,build,before,after,mapped:disk,resultsIdentical:true,result:'PASS'};
 await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({result:'PASS',count:disk.count,sourceMiB:source.sourceBytes/1024**2,imageMiB:build.bytes/1024**2,heapPrivateMiB:before.loaded.private/1024**2,mappedIdlePrivateMiB:disk.settled.private/1024**2,mappedIdleResidentMiB:disk.settled.resident/1024**2,readyMs:disk.readyMs,resultsIdentical:true}));
}
module.exports={mapped};
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
