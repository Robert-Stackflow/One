const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const Module=require('node:module');
const {build}=require('esbuild');
const JSZip=require('jszip');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const executeFile=promisify(execFile);
const gates=[],aborters=[],runs=[];
const gate=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});gates.push(resolve);return {promise,resolve,reject};};
const settle=async()=>{for(let i=0;i<5;i++)await new Promise(setImmediate);};
const wait=async(predicate)=>{const end=Date.now()+10000;while(!await predicate()){assert(Date.now()<end,'Timed out waiting for a parallel job transition');await new Promise(done=>setTimeout(done,10));}};
async function main(){
 await fs.mkdir('work/temp',{recursive:true});const root=await fs.mkdtemp(path.resolve('work/temp/one-archive-cli-parallel-'));let service,readHandle;
 try{
  const compiled=await build({entryPoints:['src/main/archive-cli.ts','src/main/archive-service.ts','src/main/archive-cli-plan.ts'],outdir:'virtual',bundle:true,platform:'node',format:'cjs',write:false});
  const load=name=>{const filename=path.resolve('dist/main/'+name+'-parallel-test.cjs'),mod=new Module(filename);mod.filename=filename;mod.paths=module.paths;mod._compile(compiled.outputFiles.find(file=>file.path.endsWith(name+'.js')).text,filename);return mod.exports;};
  const {parseCli,runCli,CliFailure}=load('archive-cli'),{ArchiveService}=load('archive-service'),{archiveCliDependencies}=load('archive-cli-plan');
  for(const args of [['test','--concurrency','0','a.zip'],['test','--concurrency','9','a.zip'],['test','--concurrency','1.5','a.zip'],['batch','--jobs','jobs.json','--total-memory-mib','127'],['test','--total-threads','65','a.zip'],['test','--total-memory-mib','32769','a.zip'],['test','--concurrency','2','--concurrency','3','a.zip']])assert.throws(()=>parseCli(args,root),CliFailure);
  assert.deepEqual(parseCli(['test','--concurrency','3','--total-memory-mib','512','--total-threads','4','a.zip'],root).queue,{maxConcurrent:3,totalMemoryMiB:512,totalThreads:4});
  const files=[];for(let i=0;i<4;i++){const file=path.join(root,`fixture-${i}.zip`),zip=new JSZip();zip.file('input.txt','parallel fixture');await fs.writeFile(file,await zip.generateAsync({type:'nodebuffer'}));files.push(file);}
  const io=()=>{const controller=new AbortController(),records=[],progress=[];aborters.push(controller);let writing=0,peakWrites=0;
   return {controller,records,progress,get peakWrites(){return peakWrites;},value:{out:async line=>{writing++;peakWrites=Math.max(writing,peakWrites);await new Promise(setImmediate);records.push(JSON.parse(line));writing--;},err:async line=>progress.push(JSON.parse(line)),signal:controller.signal,password:async()=>''}};};
  const tracked=new Map(),calls=[];let active=0,peak=0;
  const fake={setBudget:value=>calls.push({budget:value}),run:async(_owner,request,id)=>{const waiting=gate();active++;peak=Math.max(peak,active);tracked.set(id,{waiting,request});calls.push({id,request});try{await waiting.promise;return {path:request.path,count:1};}finally{active--;tracked.delete(id);}},cancel:id=>{const item=tracked.get(id);if(!item)return false;item.waiting.reject(Object.assign(Error('cancelled'),{code:'cancelled'}));return true;}};
  const memory=io(),memoryRun=runCli(parseCli(['test','--json','--progress','--concurrency','3','--threads','1','--memory-mib','256','--total-memory-mib','512',...files],root),fake,memory.value);runs.push(memoryRun);
  await wait(()=>tracked.size===2&&memory.progress.some(item=>item.operation==='queue'));assert.equal(peak,2);assert.equal(calls.filter(item=>item.request).length,2);assert.equal(calls[0].budget.maxConcurrent,3);
  [...tracked.values()][0].waiting.resolve();await wait(()=>calls.filter(item=>item.request).length===3);assert.equal(peak,2);
  for(const item of [...tracked.values()])item.waiting.resolve();await wait(()=>calls.filter(item=>item.request).length===4);for(const item of tracked.values())item.waiting.resolve();assert.equal(await memoryRun,0);
  assert.equal(memory.peakWrites,1,'stdout writes must respect backpressure and serialize JSON lines');assert.equal(memory.records.at(-1).completed,4);assert.equal(memory.records.at(-1).total,4);
  for(let job=0;job<4;job++){const events=memory.records.filter(item=>item.job===job);assert.deepEqual(events.map(item=>item.type),['start','result']);assert.equal(events[0].id,events[1].id);assert(calls.some(item=>item.id===events[0].id));}
  for(const [options,expected] of [[[],1],[['--concurrency','4','--total-threads','2'],1],[['--concurrency','4','--total-threads','8','--total-memory-mib','4096'],4]]){
   let concurrent=0,maximum=0;const output=io(),group=gate();const immediate={run:async(_owner,request)=>{concurrent++;maximum=Math.max(maximum,concurrent);if(concurrent===expected)group.resolve();await group.promise;concurrent--;return {path:request.path,count:1};},cancel:()=>false};
   assert.equal(await runCli(parseCli(['test','--json',...options,...files],root),immediate,output.value),0);assert.equal(maximum,expected);
  }
  const tooSmall=io();let invalidStarts=0;assert.equal(await runCli(parseCli(['test','--json','--concurrency','4','--total-memory-mib','128',...files],root),{run:async()=>{invalidStarts++;},cancel:()=>false},tooSmall.value),9);assert.equal(invalidStarts,0);assert.equal(tooSmall.records.at(-1).failed,4);
  const cancelled=io(),cancelRun=runCli(parseCli(['test','--json','--concurrency','2',...files],root),fake,cancelled.value);runs.push(cancelRun);await wait(()=>tracked.size===2);const beforeCancel=calls.filter(item=>item.request).length;cancelled.controller.abort();assert.equal(await cancelRun,130);assert.equal(calls.filter(item=>item.request).length,beforeCancel);assert.equal(cancelled.records.at(-1).cancelled,4);assert.equal(tracked.size,0);
  const broken=io();const outputFailure=runCli(parseCli(['test','--json','--concurrency','2',...files],root),fake,{...broken.value,out:async line=>{if(JSON.parse(line).type==='result')throw Error('output closed');}});runs.push(outputFailure);await wait(()=>tracked.size===2);[...tracked.values()][0].waiting.resolve();await assert.rejects(outputFailure,/output closed/);assert.equal(tracked.size,0);
  const plan=path.join(root,'jobs.json');for(const option of [['--concurrency','1'],['--total-memory-mib','2048'],['--total-threads','4']]){
   await fs.writeFile(plan,JSON.stringify([['test',files[0]],['test',...option,files[1]]]));const invalid=io();let calls=0;await assert.rejects(runCli(parseCli(['batch','--jobs',plan,'--json'],root),{run:async()=>calls++,cancel:()=>false},invalid.value),CliFailure);assert.equal(calls,0);
  }
  const source=path.join(root,'input.txt');await fs.writeFile(source,'independent native jobs');
  // Verify the library directly: a ZIP can still accept an erroneous zero
  // size, so testing only the final archive misses the metadata sharing bug.
  const vswhere=path.join(process.env['ProgramFiles(x86)'],'Microsoft Visual Studio/Installer/vswhere.exe');
  const installation=(await executeFile(vswhere,['-latest','-products','*','-requires','Microsoft.VisualStudio.Component.VC.Tools.x86.x64','-property','installationPath'],{windowsHide:true})).stdout.trim();assert(installation);
  const sharing=path.join(root,'source-sharing.exe'),compile=path.join(root,'source-sharing.cmd');
  await fs.writeFile(compile,`@echo off\r\ncall "${installation}\\VC\\Auxiliary\\Build\\vcvars64.bat" >nul\r\nif errorlevel 1 exit /b 1\r\ncl /nologo /std:c++20 /EHsc /MT /O2 /utf-8 /I"${path.resolve('vendor/archive/minizip-ng')}" /I"${path.resolve('work/archive-build/minizip-ng')}" "${path.resolve('tests/archive-source-sharing.cpp')}" /Fe:"${sharing}" /Fo:"${path.join(root,'source-sharing.obj')}" /link "${path.resolve('work/archive-build/minizip-ng/Release/minizip-ng.lib')}" "${path.resolve('work/archive-build/zlib/Release/zlibstatic.lib')}" bcrypt.lib crypt32.lib\r\n`);
  await executeFile('cmd.exe',['/d','/c',compile],{windowsHide:true,env:{...process.env,TEMP:root,TMP:root},timeout:15000,maxBuffer:1024**2});
  await executeFile(sharing,[source],{windowsHide:true,timeout:5000});
  // ZIP creation must also remain compatible with an already-open input file.
  readHandle=await fs.open(source,'r');
  const first=path.join(root,'first.zip'),second=path.join(root,'second.zip');await fs.writeFile(plan,JSON.stringify([['create','--output',first,'--threads','1','--memory-mib','256',source],['test',first],['create','--output',second,'--threads','1','--memory-mib','256',source]]));
  const blocked=gate(),reached=gate(),nativeCalls=[];
  service=new ArchiveService(path.join(root,'cache'),()=>{});const execute=service.execute.bind(service);
  service.execute=async(...args)=>{nativeCalls.push({id:args[1],operation:args[2],path:args[3][0]});const result=await execute(...args);if(args[2]==='create'&&args[1]===real.records.find(item=>item.type==='start'&&item.job===0)?.id){reached.resolve();await blocked.promise;}return result;};
  const real=io(),realRun=runCli(parseCli(['batch','--jobs',plan,'--json','--concurrency','2'],root),service,real.value);runs.push(realRun);await reached.promise;await wait(()=>{const failed=real.records.find(item=>item.type==='error'&&item.job===2);if(failed)throw Error(JSON.stringify(failed));return real.records.some(item=>item.type==='result'&&item.job===2);});
  assert(!nativeCalls.some(item=>item.operation==='test'&&item.path===first));assert(!real.records.some(item=>item.type==='start'&&item.job===1));blocked.resolve();assert.equal(await realRun,0);
  assert(real.records.findIndex(item=>item.type==='start'&&item.job===1)>real.records.findIndex(item=>item.type==='result'&&item.job===0));assert.equal(real.records.at(-1).completed,3);
  for(const archive of [first,second]){const listing=await service.run(1,{operation:'list',path:archive});assert.equal(listing.entries[0].size,(await readHandle.stat()).size);await service.run(1,{operation:'test',path:archive});}
  await readHandle.close();readHandle=undefined;
  // Repeated independent creates use no persistent read handle. Keeping one
  // would itself suppress the old transient exclusive-open race.
  const repeated=io();await fs.writeFile(plan,JSON.stringify(Array.from({length:24},(_,index)=>['create','--output',path.join(root,`shared-${index}.zip`),'--threads','1','--memory-mib','128',source])));
  assert.equal(await runCli(parseCli(['batch','--jobs',plan,'--json','--concurrency','4','--total-memory-mib','512','--total-threads','4'],root),service,repeated.value),0,JSON.stringify(repeated.records.filter(item=>item.type==='error')));assert.equal(repeated.records.at(-1).completed,24);
  // Hold two real helpers at their private input frames. Both OS processes
  // must be live together; job promises alone do not prove native parallelism.
  service.execute=execute;const cp=require('node:child_process'),spawn=cp.spawn,held=[];
  cp.spawn=function(file,args,...rest){const child=spawn.call(this,file,args,...rest);if(String(file).endsWith('One.Archive.exe')&&args[0]==='test'&&files.slice(0,2).includes(args[1])){const end=child.stdin.end.bind(child.stdin);child.stdin.end=(...input)=>{const release=()=>end(...input);held.push(release);gates.push(release);return child.stdin;};}return child;};
  try{const nativeParallel=io(),both=runCli(parseCli(['test','--json','--concurrency','2','--threads','1','--memory-mib','256','--total-memory-mib','512',...files.slice(0,2)],root),service,nativeParallel.value);runs.push(both);
   await wait(()=>held.length===2);assert.equal(service.active.size,2);assert.equal(new Set([...service.active.values()].map(item=>item.child.pid)).size,2);assert([...service.active.values()].every(item=>!item.child.killed));for(const release of held)release();assert.equal(await both,0);
  }finally{cp.spawn=spawn;for(const release of held)release();}
  // Update's preliminary list inherits the job's small budget, rather than
  // accidentally requesting the 1024 MiB default and failing admission.
  const changes=path.join(root,'changes.json');await fs.writeFile(changes,JSON.stringify([{kind:'rename',index:0,name:'changed.txt'}]));const edited=io();assert.equal(await runCli(parseCli(['update','--json','--changes',changes,'--threads','1','--memory-mib','128','--total-memory-mib','128','--total-threads','1',first],root),service,edited.value),0);
  assert.equal((await service.run(1,{operation:'list',path:first,threads:1,memoryMiB:128})).entries[0].name,'changed.txt');
  const payload=path.join(root,'nested'),out=path.join(root,'output');await fs.mkdir(payload);await fs.mkdir(out);const alias=path.join(root,'alias');await fs.symlink(payload,alias,'junction');
  const jobs=[{request:{operation:'create',path:path.join(payload,'data.7z'),sources:[source]}},{request:{operation:'test',path:path.join(alias,'data.7z.001')}},{request:{operation:'create',path:path.join(root,'unrelated.zip'),sources:[source]}},{request:{operation:'extract',path:files[0],parent:out}},{request:{operation:'extract',path:files[1],parent:path.join(out,'child')}},{request:{operation:'update',path:first,revision:'',changes:[]}},{request:{operation:'test',path:files[3]}}];
  const dependencies=await archiveCliDependencies(jobs);assert.deepEqual(dependencies[1],[0]);assert.deepEqual(dependencies[2],[]);assert(dependencies[4].includes(3));assert.deepEqual(dependencies[5],[0,1,2,3,4]);assert(dependencies[6].includes(5));
  const matching=await archiveCliDependencies([{request:{operation:'extract',path:files[0],parent:root}},{request:{operation:'create',path:path.join(root,'new.zip'),sources:[source]}}]);assert.deepEqual(matching[1],[0]);
  const splitRead=await archiveCliDependencies([{request:{operation:'create',path:path.join(root,'volumes.zip'),sources:[source]}},{request:{operation:'create',path:path.join(root,'copied.zip'),sources:[path.join(root,'volumes.z01')]}}]);assert.deepEqual(splitRead[1],[0]);
  await service.stop();service=undefined;
  console.log('Parallel CLI passed: parser/outer options, default sequence, weighted admission, ordered JSON/backpressure, all-active cancellation, output failure cleanup, dependency-ready native concurrency, create/test order, low-budget update and canonical/volume/directory dependencies.');
 }finally{for(const controller of aborters)controller.abort();for(const release of gates)release();await Promise.allSettled(runs);await service?.stop();await readHandle?.close();const child=path.relative(path.resolve('work/temp'),root);assert(child&&!child.startsWith('..')&&!path.isAbsolute(child));await fs.rm(root,{recursive:true,force:true});}
}
const watchdog=setTimeout(()=>{console.error('Parallel CLI test did not complete within 20 seconds');process.exitCode=1;for(const controller of aborters)controller.abort();for(const release of gates)release();},20000);
main().then(()=>clearTimeout(watchdog),error=>{clearTimeout(watchdog);console.error(error);process.exitCode=1;});
