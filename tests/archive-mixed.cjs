const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),{fork}=require('node:child_process'),{performance}=require('node:perf_hooks'),{build}=require('esbuild'),JSZip=require('jszip');
const workers=[],records=[];let root;
const id=()=>crypto.randomUUID(),started=performance.now();
function observe(child){
 const events=[],listeners=new Set();let exited=false;
 child.on('message',message=>{const event={...message,at:performance.now()-started};events.push(event);for(const listener of [...listeners])listener();});
 child.on('exit',()=>{exited=true;for(const listener of [...listeners])listener();});
 return {child,events,send:message=>child.send(message),wait(predicate,timeout=30000){return new Promise((resolve,reject)=>{
  const done=(error,value)=>{clearTimeout(timer);listeners.delete(check);error?reject(error):resolve(value);};
  const check=()=>{const found=events.find(predicate);if(found)done(null,found);else if(exited)done(Error('Mixed worker exited'));};
  const timer=setTimeout(()=>done(Error('Mixed task timed out; last events: '+JSON.stringify(events.slice(-3)))),timeout);listeners.add(check);check();
 });}};
}
async function main(){
 const fixture=path.resolve(process.argv[2]||'work/current/archive-solid'),manifest=JSON.parse(await fs.readFile(path.join(fixture,'manifest.json'),'utf8')),source=path.join(fixture,manifest.archive.name);
 assert.equal(crypto.createHash('sha256').update(await fs.readFile(source)).digest('hex'),manifest.archive.sha256);
 await fs.mkdir('work/temp',{recursive:true});root=await fs.mkdtemp(path.resolve('work/temp/one-archive-mixed-'));
 const compiled=await build({entryPoints:['src/main/archive-service.ts'],bundle:true,platform:'node',format:'cjs',write:false}),bundle=path.join(root,'service.cjs');await fs.writeFile(bundle,compiled.outputFiles[0].text);
 const small=path.join(root,'small.zip'),zip=new JSZip();for(let i=0;i<128;i++)zip.file('entry-'+i+'.txt','mixed task '+i);await fs.writeFile(small,await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}));
 const input=path.join(root,'input.bin'),handle=await fs.open(input,'wx'),digest=crypto.createHash('sha256');
 try{for(let i=0;i<32;i++){const block=crypto.createHash('sha256').update('mixed-input-'+i).digest();const bytes=Buffer.alloc(256*1024);for(let at=0;at<bytes.length;at+=block.length)block.copy(bytes,at);digest.update(bytes);await handle.write(bytes);}}finally{await handle.close();}
 const inputHash=digest.digest('hex'),scope='test-'+id();
 try{
  for(let i=0;i<3;i++){
   const options={cache:path.join(root,'worker-'+i,'cache'),threads:1,memoryMiB:256,maxConcurrent:2,totalMemoryMiB:512,totalThreads:2};
   const child=fork(path.resolve('tests/archive-shared-budget-worker.cjs'),[bundle,'service',JSON.stringify(options)],{windowsHide:true,stdio:['ignore','ignore','pipe','ipc'],env:{...process.env,ONE_ARCHIVE_TEST_BUDGET_SCOPE:scope}}),worker=observe(child);workers.push(worker);
   let error='';child.stderr.on('data',data=>{error=(error+data).slice(-1000);});child.on('error',cause=>{error=String(cause);});await worker.wait(event=>event.type==='ready');
  }
  const [a,b,c]=workers;
  const run=(worker,request)=>{const job=id();worker.send({action:'run',id:job,request});return job;};
  const completed=(worker,job)=>worker.wait(event=>['completed','failure'].includes(event.type)&&event.id===job).then(event=>{assert.equal(event.type,'completed',event.message);return event;});
  const progress=(worker,job,operation)=>worker.wait(event=>event.id===job&&(event.type==='failure'||event.type==='progress'&&event.operation===operation)).then(event=>{assert.notEqual(event.type,'failure',event.message);return event;});
  const queued=(worker,job)=>progress(worker,job,'queue');
  const extracting=(worker,job)=>progress(worker,job,'extract');
  const configure=async value=>{for(const worker of workers){const job=id();worker.send({action:'configure',id:job,value});await worker.wait(event=>event.type==='configured'&&event.id===job);}};
  const tail=async(label,worker,resources={})=>{const listing=await completed(worker,run(worker,{operation:'list',path:source})),output=path.join(root,label);await fs.mkdir(output);const job=run(worker,{operation:'extract',path:source,parent:output,destination:'folder',selected:[2],revision:listing.result.revision,threads:1,memoryMiB:256,...resources});await extracting(worker,job);return {job,output};};
  const checkTail=async(worker,current)=>{const result=await completed(worker,current.job),file=path.join(result.result.path,manifest.expected[2].name);assert.equal(crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex'),manifest.expected[2].sha256);return result;};
  // Real decoding overlaps unrelated browser, writer and validator helpers.
  const concurrent=await tail('concurrent',a),browse=run(b,{operation:'list',path:small,memoryMiB:128,threads:1}),browseResult=await completed(b,browse);assert.equal(browseResult.result.entries.length,128);
  assert(!a.events.some(event=>event.id===concurrent.job&&event.type==='completed'),'Browse must finish while solid decoding is active');
  const outputZip=path.join(root,'mixed.zip'),create=run(b,{operation:'create',path:outputZip,sources:[input],memoryMiB:128,threads:1,level:1}),createResult=await completed(b,create);
  const test=run(b,{operation:'test',path:outputZip,memoryMiB:128,threads:1}),testResult=await completed(b,test),tailResult=await checkTail(a,concurrent);assert(createResult.at<tailResult.at&&testResult.at<tailResult.at,'Writer and validator must finish during solid decoding');
  const outputParent=path.join(root,'verify-created');await fs.mkdir(outputParent);const extraction=run(b,{operation:'extract',path:outputZip,parent:outputParent,destination:'folder',memoryMiB:128,threads:1}),extracted=await completed(b,extraction);
  assert.equal(crypto.createHash('sha256').update(await fs.readFile(path.join(extracted.result.path,'input.bin'))).digest('hex'),inputHash);
  records.push({case:'concurrent-browse-create-test',browseMilliseconds:browseResult.at-a.events.find(event=>event.id===concurrent.job&&event.operation==='extract').at,createCompletedAt:createResult.at,testCompletedAt:testResult.at,tailCompletedAt:tailResult.at,hashes:2});
  // A single slot queues heterogeneous operations and preserves FIFO after cancellation.
  await configure({maxConcurrent:1,totalMemoryMiB:512,totalThreads:2});
  const serial=await tail('serial',a),cancelPath=path.join(root,'cancelled.zip'),cancel=run(b,{operation:'create',path:cancelPath,sources:[input],memoryMiB:256,threads:1});await queued(b,cancel);
  const nextPath=path.join(root,'next.zip'),next=run(b,{operation:'create',path:nextPath,sources:[input],memoryMiB:256,threads:1});await queued(b,next);
  const last=run(b,{operation:'test',path:small,memoryMiB:128,threads:1});await queued(b,last);b.send({action:'cancel',id:cancel});
  const cancelled=await b.wait(event=>event.type==='failure'&&event.id===cancel);assert.equal(cancelled.code,'cancelled');
  const serialResult=await checkTail(a,serial),nextResult=await completed(b,next),lastResult=await completed(b,last);
  assert(serialResult.at<nextResult.at&&nextResult.at<lastResult.at,'FIFO completion for sequential native jobs');assert.equal(await fs.stat(cancelPath).catch(()=>null),null);
  records.push({case:'single-slot-fifo-and-queued-cancel',hashes:1});
  // Across independent processes, a later fitting job cannot bypass a heavier head.
  await configure({maxConcurrent:3,totalMemoryMiB:512,totalThreads:4});
  const weighted=await tail('weighted',a,{memoryMiB:384}),heavyPath=path.join(root,'heavy-cancelled.zip'),heavy=run(b,{operation:'create',path:heavyPath,sources:[input],memoryMiB:256,threads:1});await queued(b,heavy);
  const fitting=run(c,{operation:'list',path:small,memoryMiB:128,threads:1});await queued(c,fitting);
  assert(!c.events.some(event=>event.id===fitting&&event.type==='completed'));
  b.send({action:'cancel',id:heavy});assert.equal((await b.wait(event=>event.type==='failure'&&event.id===heavy)).code,'cancelled');
  const fittingResult=await completed(c,fitting);assert.equal(fittingResult.result.entries.length,128);const weightedResult=await checkTail(a,weighted);assert(fittingResult.at<weightedResult.at,'Cancelling the head must admit the fitting job before the active decoder finishes');assert.equal(await fs.stat(heavyPath).catch(()=>null),null);
  records.push({case:'cross-process-memory-fifo-and-cancel',hashes:1});
  // Thread reservations also apply across processes; cancelling a running decoder releases them.
  await configure({maxConcurrent:3,totalMemoryMiB:1024,totalThreads:2});
  const threads=await tail('threads',a,{threads:2});await new Promise(resolve=>setTimeout(resolve,300));assert(!a.events.some(event=>event.id===threads.job&&event.type==='completed'));const waiting=run(b,{operation:'test',path:small,memoryMiB:128,threads:1});await queued(b,waiting);
  a.send({action:'cancel',id:threads.job});assert.equal((await a.wait(event=>event.type==='failure'&&event.id===threads.job)).code,'cancelled');await completed(b,waiting);assert.deepEqual(await fs.readdir(threads.output),[]);
  for(const worker of workers)await completed(worker,run(worker,{operation:'test',path:small,memoryMiB:128,threads:1}));
  records.push({case:'cross-process-threads-running-cancel-and-reuse',hashes:0});
  const report=process.env.ONE_ARCHIVE_MIXED_REPORT;if(report){assert(!await fs.stat(report).catch(()=>null),'Refuse overwriting mixed evidence');await fs.writeFile(report,JSON.stringify({fixture:manifest.archive,records,events:workers.map(worker=>worker.events.map(({type,id,operation,done,total,queuePosition,code,at})=>({type,id,operation,done,total,queuePosition,code,at})))},null,2)+'\n');}
  console.log('Mixed archive tasks passed: three independent services, real solid decoding with browse/create/test, FIFO, memory/thread ceilings, queued/running cancellation, four output hashes and reuse.');
 }finally{
  for(const worker of workers)if(worker.child.exitCode===null&&worker.child.signalCode===null)worker.send({action:'close'});
  await Promise.all(workers.map(worker=>new Promise(resolve=>{if(worker.child.exitCode!==null||worker.child.signalCode!==null)return resolve();const timer=setTimeout(()=>worker.child.kill(),5000);worker.child.once('exit',()=>{clearTimeout(timer);resolve();});})));
  const actual=await fs.realpath(root),parent=await fs.realpath('work/temp'),relative=path.relative(parent,actual);assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));await fs.rm(actual,{recursive:true,force:true,maxRetries:3,retryDelay:100});
 }
}
main().catch(error=>{console.error(String(error.stack||error).slice(-2500));process.exitCode=1;});
