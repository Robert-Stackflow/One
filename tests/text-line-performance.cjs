const path=require('node:path'),assert=require('node:assert/strict');
const operations=['clean','trim','empty','paragraphSpace','indent','layout','unique'];
if(process.argv[2]==='--fixture'){
 const {transform}=require(process.argv[3]),{createHash}=require('node:crypto'),operation=process.argv[4],text='\t 甲🙂  \r\n\r \t\n'.repeat(600000);
 text.charCodeAt(text.length-1);process.send({ready:true,inputCharacters:text.length});
 process.on('message',message=>{if(message.stop){process.disconnect();return;}const cpu=process.cpuUsage(),at=performance.now(),result=transform({operation,text}),elapsedMs=performance.now()-at,used=process.cpuUsage(cpu);process.send({done:true,elapsedMs,cpuMs:(used.user+used.system)/1000,length:result.length,sha256:createHash('sha256').update(result,'utf8').digest('hex')});});
}else{
 const fs=require('node:fs/promises'),{spawn}=require('node:child_process'),{build}=require('esbuild'),koffi=require('koffi'),electron=require('electron');
 const Memory=koffi.struct('OneTextLineMemory',{cb:'uint32',PageFaultCount:'uint32',PeakWorkingSetSize:'size_t',WorkingSetSize:'size_t',QuotaPeakPagedPoolUsage:'size_t',QuotaPagedPoolUsage:'size_t',QuotaPeakNonPagedPoolUsage:'size_t',QuotaNonPagedPoolUsage:'size_t',PagefileUsage:'size_t',PeakPagefileUsage:'size_t',PrivateUsage:'size_t'}),kernel=koffi.load('kernel32.dll'),psapi=koffi.load('psapi.dll'),open=kernel.func('void * __stdcall OpenProcess(uint32,int,uint32)'),close=kernel.func('int __stdcall CloseHandle(void *)'),getMemory=psapi.func('int __stdcall GetProcessMemoryInfo(void *,_Out_ OneTextLineMemory *,uint32)');
 const memory=handle=>{const value={cb:koffi.sizeof(Memory)};assert.ok(getMemory(handle,value,value.cb));return{private:value.PrivateUsage,peakPrivate:value.PeakPagefileUsage,resident:value.WorkingSetSize,peakResident:value.PeakWorkingSetSize};};
 async function run(bundle,operation){
  const child=spawn(electron,[__filename,'--fixture',bundle,operation],{windowsHide:true,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:['ignore','pipe','pipe','ipc']}),handle=open(0x410,0,child.pid);assert.ok(handle);let stderr='',timer,base,inputCharacters;child.stdout.resume();child.stderr.on('data',d=>stderr+=d);const exit=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
  try{const result=await new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('Text line timeout: '+operation)),15000);child.once('error',reject);child.on('message',message=>{if(message.ready){inputCharacters=message.inputCharacters;base=memory(handle);child.send({run:true});}else if(message.done){const final=memory(handle);resolve({...message,inputCharacters,base,final,peakAddedPrivateMiB:Math.max(base.private,final.private,final.peakPrivate)-base.private});}});child.once('exit',code=>reject(Error('Text fixture exited early: '+code+' '+stderr)));});child.send({stop:true});assert.equal((await exit).code,0,stderr);return{...result,peakAddedPrivateMiB:result.peakAddedPrivateMiB/1024**2};}
  finally{clearTimeout(timer);close(handle);if(child.exitCode===null){child.kill();await exit;}}
 }
 async function main(){
  const out=path.resolve(process.env.ONE_TEST_OUTPUT_DIR||'work/current/text-line-performance');await fs.mkdir(out,{recursive:true});const before=path.join(out,'before.cjs'),after=path.join(out,'after.cjs');await fs.access(before);await build({entryPoints:['src/shared/text.ts'],outfile:after,bundle:true,platform:'node',target:'node22',external:['opencc-js']});
  const report={date:new Date().toISOString(),rounds:[],note:'Fresh Electron Node process per operation; 7.8 million input characters, mixed CRLF/CR/LF and Unicode. Whole output SHA-256 and lengths must match. Native peak private commit includes transient allocations.'};
  for(let n=0;n<2;n++){
   const round={};for(const side of n%2?['after','before']:['before','after']){round[side]=[];for(const operation of operations)round[side].push({operation,...await run(side==='before'?before:after,operation)});console.log(JSON.stringify({round:n+1,side}));}
   for(let i=0;i<operations.length;i++){assert.equal(round.before[i].length,round.after[i].length,operations[i]);assert.equal(round.before[i].sha256,round.after[i].sha256,operations[i]);}report.rounds.push(round);
  }
  const avg=(side,i,key)=>report.rounds.reduce((sum,r)=>sum+r[side][i][key],0)/report.rounds.length;
  report.operations=operations.map((operation,i)=>({operation,beforeMs:avg('before',i,'elapsedMs'),afterMs:avg('after',i,'elapsedMs'),beforeCpuMs:avg('before',i,'cpuMs'),afterCpuMs:avg('after',i,'cpuMs'),beforeAddedMiB:avg('before',i,'peakAddedPrivateMiB'),afterAddedMiB:avg('after',i,'peakAddedPrivateMiB')}));report.result='MEASURED';await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2));
  for(const row of report.operations){assert.ok(row.afterMs<=row.beforeMs*1.15+10,'Response regression: '+row.operation);assert.ok(row.afterAddedMiB<row.beforeAddedMiB*.7,'Expected materially lower temporary memory: '+row.operation);}report.result='PASS';await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({result:'PASS',operations:report.operations,completeOutputsIdentical:true}));
 }
 main().catch(error=>{console.error(error);process.exitCode=1;});
}
