const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {fork,spawn,execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {build}=require('esbuild');
const JSZip=require('jszip');
const workers=[],helpers=[];
function observe(child){
 const events=[],listeners=new Set();let exited=false;child.on('message',message=>{events.push(message);for(const listener of [...listeners])listener();});child.once('exit',()=>{exited=true;for(const listener of [...listeners])listener();});
 return {child,events,send:value=>child.send(value),wait(predicate,timeout=12000){return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{listeners.delete(check);reject(Error('Timed out: '+JSON.stringify(events.slice(-8))));},timeout);
  const check=()=>{const found=events.find(predicate);if(found){clearTimeout(timer);listeners.delete(check);resolve(found);}else if(exited){clearTimeout(timer);listeners.delete(check);reject(Error('Worker exited: '+JSON.stringify(events.slice(-8))));}};listeners.add(check);check();
 });},exit:()=>exited};
}
const pause=()=>new Promise(resolve=>setTimeout(resolve,250));
async function main(){
 await fs.mkdir('work/temp',{recursive:true});const root=await fs.mkdtemp(path.resolve('work/temp/one-archive-shared-budget-'));
 try{
  const execute=promisify(execFile),vswhere=path.join(process.env['ProgramFiles(x86)'],'Microsoft Visual Studio/Installer/vswhere.exe');
  const found=await execute(vswhere,['-latest','-products','*','-requires','Microsoft.VisualStudio.Component.VC.Tools.x86.x64','-property','installationPath'],{windowsHide:true});
  const command=path.join(root,'native-test.cmd'),unit=path.join(root,'native-test.exe');
  await fs.writeFile(command,`@echo off\r\ncall "${found.stdout.trim()}\\VC\\Auxiliary\\Build\\vcvars64.bat" >nul\r\nif errorlevel 1 exit /b 1\r\ncl /nologo /std:c++20 /EHsc /MT /O2 /UNDEBUG /utf-8 /DUNICODE /D_UNICODE "${path.resolve('tests/archive-shared-budget.cpp')}" /Fe:"${unit}" /Fo:"${path.join(root,'native-test.obj')}" /link /IMPLIB:"${path.join(root,'native-test.lib')}" advapi32.lib bcrypt.lib\r\n`);
  await execute('cmd.exe',['/d','/c',command],{cwd:root,windowsHide:true});process.stdout.write((await execute(unit,['test-'+randomUUID()],{windowsHide:true})).stdout);
  const compiled=await build({entryPoints:['src/main/archive-shared-budget.ts','src/main/archive-service.ts'],outdir:root,bundle:true,platform:'node',format:'cjs',write:false});
  for(const file of compiled.outputFiles)await fs.writeFile(file.path,file.text);
  const asarSource=path.join(root,'asar-source'),asarPath=path.join(root,'packaged/resources/app.asar');await fs.mkdir(path.join(asarSource,'dist/main'),{recursive:true});await fs.mkdir(path.join(asarSource,'dist/native'),{recursive:true});await fs.mkdir(path.dirname(asarPath),{recursive:true});
  await fs.writeFile(path.join(asarSource,'dist/main/probe.cjs'),compiled.outputFiles.find(file=>file.path.endsWith('archive-shared-budget.js')).text+`\n(async()=>{const b=new module.exports.ArchiveSharedBudget({maxConcurrent:1,totalMemoryMiB:128,totalThreads:1});try{const lease=await b.acquire('${randomUUID()}',{memoryMiB:128,threads:1},new AbortController().signal,()=>{});await lease.release();console.log('ASAR shared budget loaded');}catch(error){console.error(error,error.cause);process.exitCode=1;}finally{await b.close();}})();`);
  await fs.copyFile(path.resolve('dist/native/One.ArchiveBudget.dll'),path.join(asarSource,'dist/native/One.ArchiveBudget.dll'));
  for(const dependency of ['koffi','@koromix/koffi-win32-x64'])await fs.cp(path.resolve('node_modules',dependency),path.join(asarSource,'node_modules',dependency),{recursive:true});
  await require('@electron/asar').createPackageWithOptions(asarSource,asarPath,{unpackDir:'dist/native',unpack:'**/*.node'});
  async function linkRuntime(from,to){await fs.mkdir(to,{recursive:true});for(const entry of await fs.readdir(from,{withFileTypes:true})){if(entry.isDirectory())await linkRuntime(path.join(from,entry.name),path.join(to,entry.name));else await fs.link(path.join(from,entry.name),path.join(to,entry.name==='electron.exe'?'One.exe':entry.name));}}
  await linkRuntime(path.resolve('node_modules/electron/dist'),path.dirname(path.dirname(asarPath)));
  process.stdout.write((await execute(path.join(root,'packaged/One.exe'),[path.join(asarPath,'dist/main/probe.cjs')],{windowsHide:true,env:{...process.env,ELECTRON_RUN_AS_NODE:'1',ONE_TEST_MODE:'1',ONE_ARCHIVE_TEST_BUDGET_SCOPE:'test-'+randomUUID(),TEMP:root,TMP:root}})).stdout);
  const start=async(scope,budget,kind='budget')=>{
   const child=fork(path.resolve('tests/archive-shared-budget-worker.cjs'),[path.join(root,kind==='budget'?'archive-shared-budget.js':'archive-service.js'),kind,JSON.stringify({...budget,cache:path.join(root,randomUUID())})],{stdio:['ignore','pipe','pipe','ipc'],windowsHide:true,env:{...process.env,ONE_TEST_MODE:'1',ONE_ARCHIVE_TEST_BUDGET_SCOPE:scope,TEMP:root,TMP:root}});
   let stderr='';child.stderr.on('data',bytes=>stderr+=bytes.toString());const worker=observe(child);worker.stderr=()=>stderr;workers.push(worker);await worker.wait(event=>event.type==='ready');return worker;
  };
  const close=async worker=>{if(worker.exit())return;worker.send({action:'close'});await worker.wait(event=>event.type==='closed');};
  const reserve=(worker,resources={memoryMiB:256,threads:2})=>{const id=randomUUID();worker.send({action:'reserve',id,resources});return id;};
  const release=async(worker,id)=>{worker.send({action:'release',id});await worker.wait(event=>event.type==='released'&&event.id===id);};
  for(const limits of [{maxConcurrent:1,totalMemoryMiB:1024,totalThreads:8},{maxConcurrent:8,totalMemoryMiB:256,totalThreads:8},{maxConcurrent:8,totalMemoryMiB:1024,totalThreads:2}]){
   const scope='test-'+randomUUID(),first=await start(scope,limits),second=await start(scope,limits);
   const a=reserve(first);await first.wait(event=>event.type==='admitted'&&event.id===a);const b=reserve(second);await second.wait(event=>event.type==='waiting'&&event.id===b);await pause();assert(!second.events.some(event=>event.type==='admitted'&&event.id===b));
   await release(first,a);await second.wait(event=>event.type==='admitted'&&event.id===b);await release(second,b);await close(first);await close(second);
  }
  {
   const scope='test-'+randomUUID(),limits={maxConcurrent:4,totalMemoryMiB:512,totalThreads:8};const a=await start(scope,limits),b=await start(scope,limits),c=await start(scope,limits);
   const hold=reserve(a,{memoryMiB:128,threads:1});await a.wait(event=>event.type==='admitted'&&event.id===hold);
   const head=reserve(b,{memoryMiB:512,threads:1});await b.wait(event=>event.type==='waiting'&&event.id===head);
   const tail=reserve(c,{memoryMiB:128,threads:1});await c.wait(event=>event.type==='waiting'&&event.id===tail&&event.position===2);await pause();assert(!c.events.some(event=>event.type==='admitted'&&event.id===tail),'a smaller cross-process job cannot bypass the FIFO head');
   b.send({action:'cancel',id:head});await b.wait(event=>event.type==='failure'&&event.id===head);await c.wait(event=>event.type==='admitted'&&event.id===tail);await release(a,hold);await release(c,tail);
   const oversized=reserve(c,{memoryMiB:1024,threads:1});await c.wait(event=>event.type==='failure'&&event.id===oversized&&event.code==='resource');
   await close(a);await close(b);await close(c);
  }
  const source=path.join(root,'source.zip'),zip=new JSZip();zip.file('sample.txt','shared reservation');await fs.writeFile(source,await zip.generateAsync({type:'nodebuffer'}));
  {
   const scope='test-'+randomUUID(),strict={maxConcurrent:1,totalMemoryMiB:256,totalThreads:2},loose={maxConcurrent:4,totalMemoryMiB:1024,totalThreads:8},a=await start(scope,strict),b=await start(scope,loose);
   const hold=reserve(a,{memoryMiB:128,threads:1});await a.wait(event=>event.type==='admitted'&&event.id===hold);
   const next=reserve(b,{memoryMiB:128,threads:1});await b.wait(event=>event.type==='waiting'&&event.id===next);a.send({action:'configure',id:'raise',value:loose});await a.wait(event=>event.type==='configured');await b.wait(event=>event.type==='admitted'&&event.id===next);
   // Lowering does not revoke either admitted job. A later over-budget job
   // fails explicitly instead of waiting forever behind an impossible limit.
   a.send({action:'configure',id:'lower',value:strict});await a.wait(event=>event.type==='configured'&&event.id==='lower');
   const impossible=reserve(b,{memoryMiB:512,threads:1});await b.wait(event=>event.type==='failure'&&event.id===impossible&&event.code==='resource');
   await release(a,hold);await release(b,next);await close(a);await close(b);
  }
  {
   const scope='test-'+randomUUID(),limits={maxConcurrent:1,totalMemoryMiB:256,totalThreads:1},a=await start(scope,limits),b=await start(scope,limits);
   const hold=reserve(a,{memoryMiB:128,threads:1});await a.wait(event=>event.type==='admitted'&&event.id===hold);
   const next=reserve(b,{memoryMiB:128,threads:1});await b.wait(event=>event.type==='waiting'&&event.id===next);a.child.kill();await b.wait(event=>event.type==='admitted'&&event.id===next);await release(b,next);await close(b);
  }
  {
   // The parent retains stdin to the real helper after the lease owner's
   // process dies. Heartbeat proves native attachment happened, not just spawn.
   const scope='test-'+randomUUID(),limits={maxConcurrent:1,totalMemoryMiB:256,totalThreads:1},a=await start(scope,limits),b=await start(scope,limits),hold=reserve(a,{memoryMiB:128,threads:1});
   const admitted=await a.wait(event=>event.type==='admitted'&&event.id===hold);
   const helper=spawn(path.resolve('dist/native/One.Archive.exe'),['list',source,'0','200','0'],{windowsHide:true,env:{...process.env,...admitted.environment,ONE_ARCHIVE_MEMORY_MIB:'128',ONE_ARCHIVE_THREADS:'1',TEMP:root,TMP:root}});helpers.push(helper);
   let output='',stderr='';helper.stdout.on('data',bytes=>output+=bytes.toString());helper.stderr.on('data',bytes=>stderr+=bytes.toString());
   const end=Date.now()+8000;while(!output.includes('"type":"heartbeat"')){assert.equal(helper.exitCode,null,output+stderr);assert(Date.now()<end,output+stderr);await new Promise(resolve=>setTimeout(resolve,25));}
   const next=reserve(b,{memoryMiB:128,threads:1});await b.wait(event=>event.type==='waiting'&&event.id===next);a.child.kill();await pause();assert.equal(helper.exitCode,null);assert(!b.events.some(event=>event.type==='admitted'&&event.id===next),'orphaned live native helper still consumes the reservation');
   const completed=new Promise(resolve=>helper.once('exit',resolve));helper.stdin.end(Buffer.alloc(4));assert.equal(await completed,0,output+stderr);await b.wait(event=>event.type==='admitted'&&event.id===next);await release(b,next);await close(b);
   const stale=spawn(path.resolve('dist/native/One.Archive.exe'),['list',source,'0','200','0'],{windowsHide:true,env:{...process.env,...admitted.environment,ONE_ARCHIVE_MEMORY_MIB:'128',ONE_ARCHIVE_THREADS:'1'}});helpers.push(stale);let denied='';stale.stdout.on('data',bytes=>denied+=bytes.toString());stale.stdin.end(Buffer.alloc(4));assert.equal(await new Promise(resolve=>stale.once('exit',resolve)),2);assert.match(denied,/reservation/);assert(!denied.includes('"type":"meta"'));
  }
  {
   const scope='test-'+randomUUID(),limits={maxConcurrent:1,totalMemoryMiB:256,totalThreads:1,memoryMiB:128,threads:1},a=await start(scope,limits,'service'),b=await start(scope,limits,'service');
   const first=randomUUID(),cancel=randomUUID(),next=randomUUID();a.send({action:'run',id:first,hold:true,request:{operation:'test',path:source}});await a.wait(event=>event.type==='phase-held'&&event.id===first);
   b.send({action:'run',id:cancel,request:{operation:'test',path:source}});await b.wait(event=>event.type==='progress'&&event.id===cancel&&event.operation==='queue');b.send({action:'cancel',id:cancel});await b.wait(event=>event.type==='failure'&&event.id===cancel&&event.code==='cancelled');
   b.send({action:'run',id:next,request:{operation:'test',path:source}});await b.wait(event=>event.type==='progress'&&event.id===next&&event.operation==='queue');await pause();assert(!b.events.some(event=>event.type==='completed'&&event.id===next));
   a.send({action:'resume',id:first});assert.equal((await a.wait(event=>event.type==='completed'&&event.id===first)).result.count,1);assert.equal((await b.wait(event=>event.type==='completed'&&event.id===next)).result.count,1);await close(a);await close(b);
  }
  console.log('Shared archive budgets passed: actual independent processes, three ceilings, weighted FIFO, cancellation, oversized jobs, crashed owners, live orphan helper retention, stale native attachment refusal, full service-stage reservation, queued cancellation and native handoff. No Explorer windows.');
 }finally{
  for(const helper of helpers)if(helper.exitCode===null)helper.kill();for(const worker of workers)if(!worker.exit())worker.child.kill();
  await Promise.all([...helpers,...workers.map(worker=>worker.child)].filter(child=>child.exitCode===null&&child.signalCode===null).map(child=>new Promise(resolve=>child.once('exit',resolve))));
  const relative=path.relative(path.resolve('work/temp'),root);assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));await fs.rm(root,{recursive:true,force:true});
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
