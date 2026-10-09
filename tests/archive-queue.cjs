const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const Module=require('node:module');
const {randomUUID}=require('node:crypto');
const {build}=require('esbuild');
const gates=[];
const defer=()=>{let resolve;const promise=new Promise(done=>resolve=done);gates.push(resolve);return {promise,resolve};};
const settle=async()=>{for(let i=0;i<4;i++)await new Promise(setImmediate);};
const wait=async(predicate)=>{const end=Date.now()+10000;while(!await predicate()){assert(Date.now()<end,'Timed out waiting for a specific queue transition');await new Promise(done=>setTimeout(done,10));}};
async function main(){
 await fs.mkdir('work/temp',{recursive:true});const root=await fs.mkdtemp(path.resolve('work/temp/one-archive-queue-'));let service;
 try{
  const compiled=await build({entryPoints:['src/main/archive-scheduler.ts','src/main/archive-service.ts','src/main/archive-tasks.ts','src/shared/settings.ts'],outdir:'virtual',bundle:true,platform:'node',format:'cjs',write:false});
  const load=name=>{const filename=path.resolve('dist/main/'+name+'-queue-test.cjs'),mod=new Module(filename);mod.filename=filename;mod.paths=module.paths;mod._compile(compiled.outputFiles.find(file=>file.path.endsWith(name+'.js')).text,filename);return mod.exports;};
  const {ArchiveScheduler}=load('archive-scheduler'),{ArchiveService}=load('archive-service'),{ArchiveTasks}=load('archive-tasks'),{defaultSettings,validateSettings,mergeSettings}=load('settings');
  const prefs=defaultSettings().archive;assert.equal(prefs.maxConcurrent,2);assert.equal(prefs.totalMemoryMiB,2048);assert.equal(prefs.totalThreads,4);
  const old=defaultSettings();for(const key of ['maxConcurrent','totalMemoryMiB','totalThreads'])delete old.archive[key];old.archive.memoryMiB=8192;old.archive.threads=64;
  const migrated=validateSettings(old).archive;assert.equal(migrated.totalMemoryMiB,8192);assert.equal(migrated.totalThreads,64);
  const saved=mergeSettings(defaultSettings(),{archive:{maxConcurrent:3,totalMemoryMiB:3072,totalThreads:6}});assert.deepEqual(validateSettings(JSON.parse(JSON.stringify(saved))).archive,saved.archive);
  for(const patch of [{maxConcurrent:0},{maxConcurrent:9},{maxConcurrent:1.5},{maxConcurrent:'2'},{maxConcurrent:null},{totalMemoryMiB:127},{totalMemoryMiB:32769},{totalMemoryMiB:null},{totalThreads:0},{totalThreads:65},{totalThreads:null}])assert.throws(()=>mergeSettings(defaultSettings(),{archive:patch}));
  // Each independent ceiling controls admission; no timers or real sleeps
  // are needed to release a reservation or cancel a waiting request.
  for(const limits of [{maxConcurrent:1,totalMemoryMiB:4096,totalThreads:8},{maxConcurrent:8,totalMemoryMiB:256,totalThreads:8},{maxConcurrent:8,totalMemoryMiB:4096,totalThreads:2}]){
   const scheduler=new ArchiveScheduler();scheduler.configure(limits);const a=new AbortController(),b=new AbortController(),positions=[];
   const releaseA=await scheduler.acquire({memoryMiB:256,threads:2},a.signal,()=>{});let admitted=false;
   const pending=scheduler.acquire({memoryMiB:256,threads:2},b.signal,value=>positions.push(value)).then(release=>{admitted=true;return release;});await settle();assert(!admitted);assert.deepEqual(positions,[1]);releaseA();const releaseB=await pending;releaseA();releaseB();
   const releaseC=await scheduler.acquire({memoryMiB:256,threads:2},new AbortController().signal,()=>{});releaseC();
  }
  const scheduler=new ArchiveScheduler();scheduler.configure({maxConcurrent:4,totalMemoryMiB:512,totalThreads:8});
  const release=await scheduler.acquire({memoryMiB:256,threads:1},new AbortController().signal,()=>{}),head=new AbortController(),tail=new AbortController();const order=[];
  const heavy=scheduler.acquire({memoryMiB:512,threads:1},head.signal,()=>{}).then(done=>{order.push('heavy');return done;});
  const small=scheduler.acquire({memoryMiB:128,threads:1},tail.signal,()=>{}).then(done=>{order.push('small');return done;});await settle();assert.deepEqual(order,[],'small jobs cannot starve a heavy head');release();const releaseHeavy=await heavy;assert.deepEqual(order,['heavy']);releaseHeavy();(await small)();
  await assert.rejects(scheduler.acquire({memoryMiB:1024,threads:1},new AbortController().signal,()=>{}),error=>error.code==='resource');
  const releaseHold=await scheduler.acquire({memoryMiB:512,threads:1},new AbortController().signal,()=>{}),cancel=new AbortController();
  const aborted=scheduler.acquire({memoryMiB:128,threads:1},cancel.signal,()=>{});cancel.abort(Error('cancelled queue'));await assert.rejects(aborted,/cancelled queue/);releaseHold();
  // A queue callback can synchronously cancel its own entry without removing
  // another waiter or losing admission when it was the head.
  const hold=await scheduler.acquire({memoryMiB:512,threads:1},new AbortController().signal,()=>{}),self=new AbortController();
  const selfPromise=scheduler.acquire({memoryMiB:128,threads:1},self.signal,()=>{self.abort(Error('self cancel'));throw Error('callback failed');});await assert.rejects(selfPromise,/self cancel/);hold();
  const callbackHold=await scheduler.acquire({memoryMiB:256,threads:1},new AbortController().signal,()=>{}),callbackHead=new AbortController();
  const ahead=scheduler.acquire({memoryMiB:512,threads:1},callbackHead.signal,()=>{});
  const failingHead=scheduler.acquire({memoryMiB:512,threads:1},new AbortController().signal,value=>{if(value===1)throw Error('bad notification');});
  const callbackTail=scheduler.acquire({memoryMiB:128,threads:1},new AbortController().signal,()=>{});
  callbackHead.abort(Error('head cancelled'));await assert.rejects(ahead,/head cancelled/);await assert.rejects(failingHead,/bad notification/);(await callbackTail)();callbackHold();
  const resizing=new ArchiveScheduler();resizing.configure({maxConcurrent:1,totalMemoryMiB:1024,totalThreads:8});const held=await resizing.acquire({memoryMiB:512,threads:4},new AbortController().signal,()=>{});
  const tooBig=resizing.acquire({memoryMiB:512,threads:4},new AbortController().signal,()=>{});resizing.configure({maxConcurrent:1,totalMemoryMiB:256,totalThreads:2});await assert.rejects(tooBig,error=>error.code==='resource');held();
  const reentrant=new ArchiveScheduler();reentrant.configure({maxConcurrent:1,totalMemoryMiB:1024,totalThreads:8});const reentrantHold=await reentrant.acquire({memoryMiB:512,threads:4},new AbortController().signal,()=>{});
  await assert.rejects(reentrant.acquire({memoryMiB:512,threads:4},new AbortController().signal,()=>reentrant.configure({maxConcurrent:1,totalMemoryMiB:256,totalThreads:2})),error=>error.code==='resource');reentrantHold();
  const raising=new ArchiveScheduler();raising.configure({maxConcurrent:1,totalMemoryMiB:512,totalThreads:2});const initial=await raising.acquire({memoryMiB:256,threads:1},new AbortController().signal,()=>{});let raised=false;
  const waitingRaise=raising.acquire({memoryMiB:256,threads:1},new AbortController().signal,()=>{}).then(done=>{raised=true;return done;});await settle();assert(!raised);raising.configure({maxConcurrent:2,totalMemoryMiB:512,totalThreads:2});const raisedRelease=await waitingRaise;initial();raisedRelease();
  const bounded=new ArchiveScheduler();bounded.configure({maxConcurrent:1,totalMemoryMiB:256,totalThreads:1});const boundedRelease=await bounded.acquire({memoryMiB:128,threads:1},new AbortController().signal,()=>{});const waiting=[];
  for(let i=0;i<32;i++){const controller=new AbortController();waiting.push({controller,promise:bounded.acquire({memoryMiB:128,threads:1},controller.signal,()=>{}).catch(error=>error)});}
  await assert.rejects(bounded.acquire({memoryMiB:128,threads:1},new AbortController().signal,()=>{}),error=>error.code==='resource');for(const item of waiting)item.controller.abort(Error('stop'));await Promise.all(waiting.map(item=>item.promise));boundedRelease();
  const history=new ArchiveTasks(path.join(root,'history.json')),events=[],started=[];let config={threads:1,memoryMiB:256,maxConcurrent:4,totalMemoryMiB:384,totalThreads:4};
  service=new ArchiveService(path.join(root,'cache'),(_owner,value)=>events.push(value),()=> '0',()=>{},false,history,()=>config);
  const source=path.join(root,'input.txt');await fs.writeFile(source,'queue source');const first=randomUUID(),second=randomUUID(),third=randomUUID(),between=defer(),resume=defer();
  const execute=service.execute.bind(service);service.execute=async(...args)=>{started.push({id:args[1],operation:args[2]});if(args[1]===first&&args[2]==='test'){between.resolve();await resume.promise;}return execute(...args);};
  const one=service.run(1,{operation:'create',path:path.join(root,'one.zip'),sources:[source]},first);await between.promise;
  assert.equal(service.active.size,0,'first native stage finished but the whole job still reserves its budget');
  const two=service.run(1,{operation:'create',path:path.join(root,'two.zip'),sources:[source]},second);
  const three=service.run(1,{operation:'create',path:path.join(root,'three.zip'),sources:[source]},third);const cancelled=assert.rejects(two,error=>error.code==='cancelled');
  await wait(()=>events.some(value=>value.id===third&&value.operation==='queue'&&value.queuePosition===2));
  const metadataId=randomUUID(),metadata=service.run(1,{operation:'list',path:path.join(root,'one.zip')},metadataId);const cancelledMetadata=assert.rejects(metadata,error=>error.code==='cancelled');
  await wait(()=>events.some(value=>value.id===metadataId&&value.queuePosition===3));assert(!started.some(value=>value.id===metadataId));service.cancelId(metadataId);await cancelledMetadata;
  let overview=await service.taskOverview();assert.equal(overview.active.find(task=>task.id===second).phase,'queue');assert.equal(overview.active.find(task=>task.id===third).queuePosition,2);assert(!started.some(value=>value.id===second||value.id===third));
  assert.equal(service.cancel(second,2),false);assert.equal(service.cancel(second,1),true);await cancelled;
  await wait(()=>events.some(value=>value.id===third&&value.queuePosition===1));assert(!started.some(value=>value.id===second));resume.resolve();await one;await three;
  assert(started.findIndex(value=>value.id===third)>started.map(value=>value.id).lastIndexOf(first),'all stages complete before the next helper begins');overview=await service.taskOverview();assert.equal(overview.active.length,0);assert.equal(overview.recent.find(task=>task.id===second).state,'cancelled');assert.equal(overview.recent.find(task=>task.id===third).state,'completed');
  await assert.rejects(service.run(1,{operation:'test',path:path.join(root,'one.zip'),memoryMiB:512}),error=>error.code==='resource');
  // The existing per-helper OS cap still applies once a real job is admitted.
  assert.equal((await service.run(1,{operation:'test',path:path.join(root,'one.zip')})).count,1);
  // Two admitted readers can share TAR preparation. Cancelling its owner
  // must not poison the other job or leak the first owner's staging.
  config={...config,totalMemoryMiB:1024};service.execute=execute;
  const composite=path.join(root,'shared.tar.gz');await service.run(1,{operation:'create',path:composite,sources:[source]});
  const owner=randomUUID(),reader=randomUUID(),prepared=defer(),continuePrepare=defer();
  service.execute=async(...args)=>{const result=await execute(...args);if(args[1]===owner&&args[2]==='extract'&&args[5]==='prepare'){prepared.resolve();await continuePrepare.promise;}return result;};
  const sharedOne=service.run(1,{operation:'extract',path:composite,parent:root},owner);await prepared.promise;
  const sharedTwo=service.run(1,{operation:'extract',path:composite,parent:root},reader);await settle();assert.equal(service.jobs.size,2);
  const sharedCancelled=assert.rejects(sharedOne,error=>error.code==='cancelled');service.cancelId(owner);continuePrepare.resolve();await sharedCancelled;
  const surviving=await sharedTwo;assert.equal(await fs.readFile(path.join(surviving.path,'input.txt'),'utf8'),'queue source');
  config={...config,totalMemoryMiB:384};
  const shutdownGate=defer(),shutdownReady=defer();service.execute=async(...args)=>{if(args[2]==='test'){shutdownReady.resolve();await shutdownGate.promise;}return execute(...args);};
  const active=service.run(1,{operation:'test',path:path.join(root,'one.zip')});await shutdownReady.promise;const queued=service.run(1,{operation:'test',path:path.join(root,'one.zip')});const abortedAll=Promise.all([assert.rejects(active,error=>error.code==='cancelled'),assert.rejects(queued,error=>error.code==='cancelled')]);await wait(async()=> (await service.taskOverview()).active.some(task=>task.phase==='queue'));
  const stopped=service.stop();shutdownGate.resolve();await stopped;await abortedAll;assert.equal(service.pendingTasks,0);
  assert.deepEqual((await new ArchiveTasks(path.join(root,'history.json')).overview()).recent.map(task=>task.state),(await history.overview()).recent.map(task=>task.state));
  const recoveryFile=path.join(root,'queue-recovery.json'),recovery=new ArchiveTasks(recoveryFile),interruptedId=randomUUID();await recovery.begin(interruptedId,'extract',path.join(root,'one.zip'),'queue');
  const restored=await new ArchiveTasks(recoveryFile).overview();assert.equal(restored.error,'');assert.equal(restored.recent[0].id,interruptedId);assert.equal(restored.recent[0].state,'interrupted');assert.equal(restored.recent[0].phase,'queue');
  console.log('Archive queue passed: three admission ceilings, FIFO fairness, cancellation/reentrancy, resized budgets, bounds, migration/backup, real multi-stage reservation, queued owner cancellation, queue positions/history, budget failure and shutdown.');
 }finally{for(const release of gates)release();await service?.stop();const child=path.relative(path.resolve('work/temp'),root);assert(child&&!child.startsWith('..')&&!path.isAbsolute(child));await fs.rm(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
