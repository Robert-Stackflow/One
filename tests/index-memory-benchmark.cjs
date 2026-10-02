// Compare identical copied cache contents. Empty roots keep verification read-only
// and prevent live filesystem changes from changing the two sets of search results.
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),koffi=require('koffi');
const kernel=koffi.load('kernel32.dll'),psapi=koffi.load('psapi.dll');
const Memory=koffi.struct('OneBenchmarkMemory',{cb:'uint32',PageFaultCount:'uint32',PeakWorkingSetSize:'size_t',WorkingSetSize:'size_t',QuotaPeakPagedPoolUsage:'size_t',QuotaPagedPoolUsage:'size_t',QuotaPeakNonPagedPoolUsage:'size_t',QuotaNonPagedPoolUsage:'size_t',PagefileUsage:'size_t',PeakPagefileUsage:'size_t',PrivateUsage:'size_t'});
const open=kernel.func('void * __stdcall OpenProcess(uint32, int, uint32)'),close=kernel.func('int __stdcall CloseHandle(void *)');
const getMemory=psapi.func('int __stdcall GetProcessMemoryInfo(void *, _Out_ OneBenchmarkMemory *, uint32)');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const queries=['QQ','季度','jidubaogao','jdbg','ext:json package','folder: downloads','x beauty','reprot','无匹配_2049','"QQ"'];
function memory(handle){const value={cb:koffi.sizeof(Memory)};assert.ok(getMemory(handle,value,value.cb));return {resident:value.WorkingSetSize,private:value.PrivateUsage,peakResident:value.PeakWorkingSetSize};}
async function snapshot(folder){
 const source=process.env.ONE_BENCH_CACHE||path.join(process.env.APPDATA,'One','file-index.bin');
 let base,delta;
 for(let i=0;i<5;i++){
  const before=await fs.stat(source),dBefore=await fs.stat(source+'.delta').catch(()=>null);
  base=await fs.readFile(source);delta=dBefore?await fs.readFile(source+'.delta'):null;
  const after=await fs.stat(source),dAfter=await fs.stat(source+'.delta').catch(()=>null);
  if(before.mtimeMs===after.mtimeMs&&before.size===after.size&&dBefore?.mtimeMs===dAfter?.mtimeMs&&dBefore?.size===dAfter?.size)break;
  if(i===4)throw Error('The live cache changed during every snapshot; leave it untouched and retry later.');
  await delay(250);
 }
 assert.equal(base.subarray(0,8).toString(),'ONEIDX06');
 const length=base.readUInt32LE(8),original=JSON.parse(base.subarray(12,12+length)),config={...original,roots:[],excluded:[]};
 const settings=Buffer.from(JSON.stringify(config)),header=Buffer.alloc(12);base.copy(header,0,0,8);header.writeUInt32LE(settings.length,8);
 const bytes=Buffer.concat([header,settings,base.subarray(12+length)]),count=Number(base.readBigUInt64LE(28+length));
 await fs.writeFile(path.join(folder,'snapshot.bin'),bytes);if(delta)await fs.writeFile(path.join(folder,'snapshot.bin.delta'),delta);
 return {bytes,delta,config,count,sourceBytes:base.length};
}
async function run(exe,cache,source){
 await fs.writeFile(cache,source.bytes);if(source.delta)await fs.writeFile(cache+'.delta',source.delta);
 const started=performance.now(),child=spawn(exe,[cache],{windowsHide:true}),handle=open(0x410,0,child.pid);
 assert.ok(handle);let buffer='',state,loaded,running=false,ready=false,loadMs,readyMs,maxResident=0,maxPrivate=0,id=0;
 const requests=new Map(),samples=[];let timer;
 const sample=()=>{const m=memory(handle);maxResident=Math.max(maxResident,m.resident);maxPrivate=Math.max(maxPrivate,m.private);return m;};
 child.stderr.resume();child.stdout.on('data',chunk=>{buffer+=chunk;let at;while((at=buffer.indexOf('\n'))>=0){const v=JSON.parse(buffer.slice(0,at));buffer=buffer.slice(at+1);if(v.state){state=v.state;if(!loaded&&state.count){loaded=sample();loadMs=performance.now()-started;}if(state.running)running=true;if(running&&!state.running){ready=true;readyMs??=performance.now()-started;}}else{const request=requests.get(v.id);if(request){requests.delete(v.id);clearTimeout(request.timer);v.error?request.reject(Error(v.error)):request.resolve(v.result);}}}});
 const send=value=>child.stdin.write(JSON.stringify(value)+'\n');
 const query=text=>new Promise((resolve,reject)=>{const serial=++id;requests.set(serial,{resolve,reject,timer:setTimeout(()=>reject(Error('Query timeout')),30000)});send({type:'query',id:serial,query:text,fuzzy:true,pinyin:true});});
 const exited=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code)=>code===0?resolve():reject(Error(`Index exited: ${code}`)));});
 try{
  timer=setInterval(sample,100);send({type:'init',settings:source.config});
  const until=performance.now()+120000;while(!ready&&performance.now()<until){if(child.exitCode!==null)throw Error('Index exited before ready');await delay(20);}assert.ok(ready,'Cache verification timeout');assert.ok(state.count>=source.count);
  const settled=sample();
  for(const text of queries){const rounds=[];let result;for(let i=0;i<3;i++){result=await query(text);assert.ok(!result.cancelled);rounds.push(result.elapsed);}samples.push({query:text,total:result.total,elapsedMs:rounds.sort((a,b)=>a-b)[1],items:result.items});}
  sample();send({type:'stop'});child.stdin.end();await exited;
  return {count:state.count,loadMs,readyMs,loaded,settled,maxResident,maxPrivate,queries:samples};
 }finally{clearInterval(timer);for(const request of requests.values())clearTimeout(request.timer);close(handle);if(child.exitCode===null)child.kill();}
}
async function main(){
 const directory=path.resolve(process.env.ONE_INDEX_OUTPUT||'work/index-memory');await fs.mkdir(directory,{recursive:true});const folder=await fs.mkdtemp(path.join(directory,'run-')),source=await snapshot(folder);
 const old=path.resolve(process.env.ONE_INDEX_BEFORE||path.join(directory,'One.Index.before.exe')),next=path.resolve(process.env.ONE_INDEX_AFTER||'dist/native/One.Index.exe'),rounds=[];
 for(let i=0;i<2;i++){
  let before,after;if(i%2){after=await run(next,path.join(folder,`after-${i}.bin`),source);before=await run(old,path.join(folder,`before-${i}.bin`),source);}else{before=await run(old,path.join(folder,`before-${i}.bin`),source);after=await run(next,path.join(folder,`after-${i}.bin`),source);}
  assert.equal(after.count,before.count);for(let n=0;n<queries.length;n++){assert.equal(after.queries[n].total,before.queries[n].total,queries[n]);assert.deepEqual(after.queries[n].items,before.queries[n].items,queries[n]);}
  rounds.push({before,after});console.log(JSON.stringify({round:i+1,count:after.count,before:{loaded:before.loaded,settled:before.settled,loadMs:before.loadMs},after:{loaded:after.loaded,settled:after.settled,loadMs:after.loadMs},resultsIdentical:true}));
 }
 const avg=(side,key,phase='settled')=>rounds.reduce((sum,r)=>sum+(phase?r[side][phase][key]:r[side][key]),0)/rounds.length;
 const report={result:'PASS',beforeExe:old,afterExe:next,date:new Date().toISOString(),sourceBytes:source.sourceBytes,count:rounds[0].after.count,comparison:'Same real cache, verification roots disabled to freeze search results; process memory only, not the whole app. Settled resident memory varies with Windows trimming; report load/peak resident and committed private memory separately.',loadedResidentReductionPercent:100*(1-avg('after','resident','loaded')/avg('before','resident','loaded')),peakResidentReductionPercent:100*(1-avg('after','maxResident',null)/avg('before','maxResident',null)),settledResidentChangePercent:100*(avg('after','resident')/avg('before','resident')-1),privateReductionPercent:100*(1-avg('after','private')/avg('before','private')),rounds};
 report.result=report.privateReductionPercent>15?'PASS':'FAIL';
 await fs.writeFile(path.join(folder,'result.json'),JSON.stringify(report,null,2));await fs.writeFile(path.join(directory,'latest.json'),JSON.stringify(report,null,2));
 assert.ok(report.privateReductionPercent>15,'Expected materially smaller committed memory');console.log(JSON.stringify({result:report.result,count:report.count,loadedResidentReductionPercent:report.loadedResidentReductionPercent,peakResidentReductionPercent:report.peakResidentReductionPercent,privateReductionPercent:report.privateReductionPercent,report:path.join(folder,'result.json')}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
