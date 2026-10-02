// Freeze one real snapshot for both binaries. Only copied cache files are opened
// by the helpers; the running app retains its original roots and settings.
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),koffi=require('koffi');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const Memory=koffi.struct('OneRestoreMemory',{cb:'uint32',PageFaultCount:'uint32',PeakWorkingSetSize:'size_t',WorkingSetSize:'size_t',QuotaPeakPagedPoolUsage:'size_t',QuotaPagedPoolUsage:'size_t',QuotaPeakNonPagedPoolUsage:'size_t',QuotaNonPagedPoolUsage:'size_t',PagefileUsage:'size_t',PeakPagefileUsage:'size_t',PrivateUsage:'size_t'});
const kernel=koffi.load('kernel32.dll'),psapi=koffi.load('psapi.dll'),open=kernel.func('void * __stdcall OpenProcess(uint32, int, uint32)'),close=kernel.func('int __stdcall CloseHandle(void *)'),getMemory=psapi.func('int __stdcall GetProcessMemoryInfo(void *, _Out_ OneRestoreMemory *, uint32)');
const queries=['QQ','季度','jidubaogao','jdbg','ext:json package','folder: downloads','x beauty','reprot','无匹配_2049','"QQ"','"d:\\repositories\\one"','"repositories\\one\\package.json"','"D:/Repositories/One"'];
function memory(handle){const m={cb:koffi.sizeof(Memory)};assert.ok(getMemory(handle,m,m.cb));return{resident:m.WorkingSetSize,private:m.PrivateUsage,peakResident:m.PeakWorkingSetSize,peakPrivate:m.PeakPagefileUsage};}
async function frozen(source){
 let base,delta;
 for(let n=0;n<5;n++){
  const a=await fs.stat(source),da=await fs.stat(source+'.delta').catch(()=>null);
  base=await fs.readFile(source);delta=da?await fs.readFile(source+'.delta'):null;
  const b=await fs.stat(source),db=await fs.stat(source+'.delta').catch(()=>null);
  if(a.size===b.size&&a.mtimeMs===b.mtimeMs&&da?.size===db?.size&&da?.mtimeMs===db?.mtimeMs)break;
  if(n===4)throw Error('Live cache changed during every snapshot');await delay(250);
 }
 assert.equal(base.subarray(0,8).toString(),'ONEIDX06');
 const length=base.readUInt32LE(8),original=JSON.parse(base.subarray(12,12+length)),config={...original,roots:[],excluded:[]},text=Buffer.from(JSON.stringify(config)),head=Buffer.alloc(12);
 base.copy(head,0,0,8);head.writeUInt32LE(text.length,8);
 return{bytes:Buffer.concat([head,text,base.subarray(12+length)]),delta,config,count:Number(base.readBigUInt64LE(28+length)),sourceBytes:base.length,deltaBytes:delta?.length||0};
}
async function run(exe,cache,source){
 await fs.writeFile(cache,source.bytes);await fs.rm(cache+'.delta',{force:true});if(source.delta)await fs.writeFile(cache+'.delta',source.delta);
 const at=performance.now(),child=spawn(exe,[cache],{windowsHide:true}),handle=open(0x410,0,child.pid);assert.ok(handle);
 let buffer='',state,ready=false,running=false,readyMs,id=0,peakResident=0,peakPrivate=0;const pending=new Map(),errors=[];
 const sample=()=>{const m=memory(handle);peakResident=Math.max(peakResident,m.peakResident);peakPrivate=Math.max(peakPrivate,m.peakPrivate);return m;};
 const timer=setInterval(sample,50),send=value=>child.stdin.write(JSON.stringify(value)+'\n');
 const exit=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('Index exited: '+code)));});exit.catch(()=>{});
 child.stderr.on('data',data=>errors.push(data.toString()));child.stdout.setEncoding('utf8');
 child.stdout.on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\n'))>=0){const value=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);if(value.state){state=value.state;if(state.running)running=true;if(running&&!state.running){ready=true;readyMs??=performance.now()-at;}}else{const request=pending.get(value.id);if(request){clearTimeout(request.timer);pending.delete(value.id);value.error?request.reject(Error(value.error)):request.resolve(value.result);}}}});
 const query=(text,includeLaunchers=false)=>new Promise((resolve,reject)=>{const serial=++id;pending.set(serial,{resolve,reject,timer:setTimeout(()=>{pending.delete(serial);reject(Error('Query timeout: '+text));},20000)});send({type:'query',id:serial,scope:1,query:text,fuzzy:true,pinyin:true,currentFolder:'D:\\Repositories\\One',includeLaunchers});});
 try{
  send({type:'init',settings:source.config});const until=performance.now()+60000;
  while(!ready&&performance.now()<until){assert.equal(child.exitCode,null,'Index stopped while loading');await delay(20);}assert.ok(ready,'Cache restore timeout');assert.ok(state.count>0&&state.count<=source.config.maxEntries,JSON.stringify(state));
  await delay(250);const loaded=sample(),results=[];
  for(const text of queries){const timings=[];let result;for(let n=0;n<2;n++){const start=performance.now();result=await query(text);assert.ok(!result.cancelled);timings.push({wallMs:performance.now()-start,nativeMs:result.elapsed});}results.push({query:text,total:result.total,items:result.items,timings});}
  // Deterministic launcher entries isolate filtering cost from application discovery.
  send({type:'launchers',items:[{path:'one-launcher:app:QQ',name:'QQ',directory:false,size:0,modified:0},{path:'one-launcher:setting:display',name:'显示器 分辨率 缩放',directory:false,size:0,modified:0}]});
  const launcherQueries=[];for(const text of ['app: QQ','setting: 显示','setting: xianshiqi']){const timings=[];let result;for(let n=0;n<3;n++){const start=performance.now();result=await query(text,true);assert.ok(!result.cancelled);assert.equal(result.total,1);timings.push(performance.now()-start);}launcherQueries.push({query:text,items:result.items,timings});}
  const settled=sample();assert.deepEqual(errors,[]);send({type:'stop'});child.stdin.end();await exit;
  return{count:state.count,readyMs,loaded,settled,peakResident,peakPrivate,queries:results,launcherQueries};
 }finally{clearInterval(timer);for(const request of pending.values())clearTimeout(request.timer);close(handle);if(child.exitCode===null){child.kill();await exit.catch(()=>{});}}
}
async function main(){
 const out=path.resolve(process.env.ONE_TEST_OUTPUT_DIR||'work/current/index-load-memory'),source=await frozen(path.resolve(process.env.ONE_AUDIT_INDEX||'work/dev-profile/file-index.bin')),profile=path.join(out,'profile');await fs.mkdir(profile,{recursive:true});
 const before=path.join(out,'before.exe'),after=path.resolve(process.env.ONE_INDEX_AFTER||'work/rust-search/release/one-index.exe'),report={date:new Date().toISOString(),sourceBytes:source.sourceBytes,deltaBytes:source.deltaBytes,snapshotCount:source.count,rounds:[],note:'Same real cache and delta; only verification copies use empty roots. Native helper memory, not whole-app memory.'};
 for(let n=0;n<Number(process.env.ONE_INDEX_ROUNDS||2);n++){
  const round={};for(const side of n%2?['after','before']:['before','after']){round[side]=await run(side==='before'?before:after,path.join(profile,'file-index.bin'),source);console.log(JSON.stringify({round:n+1,side,count:round[side].count,readyMs:round[side].readyMs,privateMiB:round[side].loaded.private/1024**2,peakPrivateMiB:round[side].peakPrivate/1024**2}));}
  assert.equal(round.after.count,round.before.count);for(let i=0;i<queries.length;i++){assert.equal(round.after.queries[i].total,round.before.queries[i].total,queries[i]);assert.deepEqual(round.after.queries[i].items,round.before.queries[i].items,queries[i]);}for(let i=0;i<round.before.launcherQueries.length;i++)assert.deepEqual(round.after.launcherQueries[i].items,round.before.launcherQueries[i].items);report.rounds.push(round);
 }
 const avg=(side,get)=>report.rounds.reduce((sum,r)=>sum+get(r[side]),0)/report.rounds.length;
 report.privateReductionPercent=100*(1-avg('after',r=>r.loaded.private)/avg('before',r=>r.loaded.private));report.load={beforeMs:avg('before',r=>r.readyMs),afterMs:avg('after',r=>r.readyMs)};report.peakPrivate={before:avg('before',r=>r.peakPrivate),after:avg('after',r=>r.peakPrivate)};
 report.queryTimings=queries.map((query,i)=>({query,beforeMs:avg('before',r=>r.queries[i].timings.reduce((n,t)=>n+t.wallMs,0)/2),afterMs:avg('after',r=>r.queries[i].timings.reduce((n,t)=>n+t.wallMs,0)/2)}));
 report.launcherTimings=report.rounds[0].before.launcherQueries.map((r,i)=>({query:r.query,beforeMs:avg('before',r=>r.launcherQueries[i].timings.reduce((n,t)=>n+t,0)/3),afterMs:avg('after',r=>r.launcherQueries[i].timings.reduce((n,t)=>n+t,0)/3)}));
 report.resultsIdentical=true;report.result='MEASURED';await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2));
 assert.ok(report.privateReductionPercent>15,'Expected materially lower memory');assert.ok(report.peakPrivate.after<=report.peakPrivate.before*1.05,'Restore peak memory regression');assert.ok(report.load.afterMs<=report.load.beforeMs*1.3+1000,'Restore latency regression');for(const query of report.queryTimings)assert.ok(query.afterMs<=query.beforeMs*1.25+12,'Query latency regression: '+query.query);
 for(const query of report.launcherTimings)assert.ok(query.afterMs<20,'Launcher filter should not traverse the file index: '+query.query);
 report.result='PASS';await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({result:'PASS',count:report.rounds[0].after.count,privateReductionPercent:report.privateReductionPercent,load:report.load,peakPrivate:report.peakPrivate,resultsIdentical:true}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
