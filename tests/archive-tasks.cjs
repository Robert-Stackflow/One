const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const Module=require('node:module');
const {randomUUID}=require('node:crypto');
const {build}=require('esbuild');
async function main(){
 await fs.mkdir('work/temp',{recursive:true});const root=await fs.mkdtemp(path.resolve('work/temp/one-archive-tasks-'));let service;
 try{
  const compiled=await build({entryPoints:['src/main/archive-service.ts','src/main/archive-tasks.ts'],outdir:'virtual',bundle:true,platform:'node',format:'cjs',write:false});
  const load=(name)=>{const filename=path.resolve('dist/main/'+name+'-test.cjs'),mod=new Module(filename);mod.filename=filename;mod.paths=module.paths;mod._compile(compiled.outputFiles.find(file=>file.path.endsWith(name+'.js')).text,filename);return mod.exports;};
  const {ArchiveTasks}=load('archive-tasks'),{ArchiveService}=load('archive-service');
  const file=path.join(root,'tasks/archive.json'),warnings=[];let notifications=0;
  const history=new ArchiveTasks(file,()=>notifications++,message=>warnings.push(message));
  const source=path.join(root,'input.txt'),zip=path.join(root,'created.zip'),secret='PRIVATE PASSWORD 958271';await fs.writeFile(source,'task contents');
  let cancelOnProgress=false,commits=0;
  service=new ArchiveService(path.join(root,'cache'),(owner,value)=>{
   if(value.operation==='commit'){commits++;assert.equal(service.cancel(value.id,owner),false);assert.throws(()=>service.cancelId(value.id),/保存/);}
   else if(cancelOnProgress&&value.operation==='create'){cancelOnProgress=false;assert.equal(service.cancel(value.id,owner),true);}
  },()=> '0',()=>{},false,history);
  const run=request=>service.run(2,request);
  const created=await run({operation:'create',path:zip,sources:[source],password:secret});assert.equal(created.path,zip);
  let snapshot=await service.taskOverview();assert.equal(snapshot.active.length,0);assert.equal(snapshot.recent[0].state,'completed');assert.equal(snapshot.recent[0].operation,'create');assert.equal(snapshot.recent[0].cancellable,false);assert(!JSON.stringify(snapshot).includes(secret));
  const originalCount=snapshot.recent.length,listing=await run({operation:'list',path:zip});await run({operation:'list',path:zip,browse:{directory:'',search:'input',flat:true}});assert.equal((await service.taskOverview()).recent.length,originalCount,'browsing must not fill task history');
  await run({operation:'test',path:zip,password:secret});await run({operation:'extract',path:zip,parent:root,password:secret});await run({operation:'update',path:zip,revision:listing.revision,password:secret,changes:[{kind:'rename',index:0,name:'changed.txt'}]});
  snapshot=await service.taskOverview();assert.deepEqual(snapshot.recent.slice(0,4).map(task=>task.operation),['update','extract','test','create']);assert(snapshot.recent.every(task=>task.state==='completed'));
  await assert.rejects(run({operation:'test',path:path.join(root,'missing.zip')}));snapshot=await service.taskOverview();assert.equal(snapshot.recent[0].state,'failed');assert(snapshot.recent[0].message);
  const cold=randomUUID(),coldPath=path.join(root,'cold.zip'),coldPromise=service.run(2,{operation:'create',path:coldPath,sources:[source]},cold);assert.equal(service.cancel(cold,99),false);service.cancelId(cold);await assert.rejects(coldPromise,error=>error.code==='cancelled');await assert.rejects(fs.stat(coldPath),{code:'ENOENT'});assert.equal((await service.taskOverview()).recent[0].state,'cancelled');
  cancelOnProgress=true;await assert.rejects(run({operation:'create',path:path.join(root,'cancelled.zip'),sources:[source]}),error=>error.code==='cancelled');assert.equal((await service.taskOverview()).recent[0].state,'cancelled');assert.equal(cancelOnProgress,false);
  // A cancelled job between engine stages must not continue into publication.
  const execute=service.execute.bind(service),middle=randomUUID(),middlePath=path.join(root,'between-stages.zip');
  service.execute=async(...args)=>{const result=await execute(...args);if(args[1]===middle&&args[2]==='test')service.cancelId(middle);return result;};
  await assert.rejects(service.run(2,{operation:'create',path:middlePath,sources:[source]},middle),error=>error.code==='cancelled');await assert.rejects(fs.stat(middlePath),{code:'ENOENT'});service.execute=execute;
  assert(commits>=3);await service.stop();assert.equal(service.pendingTasks,0);await assert.rejects(run({operation:'list',path:zip}),/关闭/);
  assert(!JSON.stringify(JSON.parse(await fs.readFile(file,'utf8'))).includes(secret));assert.equal(warnings.length,0);assert(notifications>5);
  const restarted=new ArchiveTasks(file);assert.equal((await restarted.overview()).recent.length,8);assert.equal((await restarted.overview()).active.length,0);
  // Persist running summaries before engine work, recover uncertainty without auto-running jobs.
  const running=randomUUID();await restarted.begin(running,'extract',zip);restarted.progress({id:running,operation:'prepare',done:30,total:100},true);
  const recovered=new ArchiveTasks(file);snapshot=await recovered.overview();assert.equal(snapshot.active.length,0);assert.equal(snapshot.recent[0].id,running);assert.equal(snapshot.recent[0].state,'interrupted');assert.equal(snapshot.recent[0].cancellable,false);assert(snapshot.recent[0].message.includes('检查输出'));const finish=snapshot.recent[0].finished;assert.equal((await new ArchiveTasks(file).overview()).recent[0].finished,finish);
  const beforeProgress=await fs.readFile(file),boundedId=randomUUID();await recovered.begin(boundedId,'test',zip);const startBytes=await fs.readFile(file);
  for(let i=0;i<500;i++)recovered.progress({id:boundedId,operation:'test',done:i,total:500},true);
  assert.deepEqual(await fs.readFile(file),startBytes,'progress does not rewrite history per event');assert.notDeepEqual(startBytes,beforeProgress);await recovered.finish(boundedId,{path:zip,count:1});
  for(let i=0;i<105;i++){const id=randomUUID();await recovered.begin(id,'test',zip);await recovered.finish(id,{path:zip,count:1});}
  assert.equal(JSON.parse(await fs.readFile(file,'utf8')).tasks.length,100);assert.equal((await recovered.overview()).recent.length,30);
  const ordinary=path.join(root,'not-a-directory');await fs.writeFile(ordinary,'keep');const broken=new ArchiveTasks(path.join(ordinary,'tasks.json'));await broken.begin(randomUUID(),'test',zip);assert((await broken.overview()).error);assert.equal(await fs.readFile(ordinary,'utf8'),'keep');
  const files=await fs.readdir(path.dirname(file));assert.deepEqual(files,['archive.json']);assert(!(await fs.readdir(root)).some(name=>name.startsWith('.one-archive-')));
  console.log('Archive task history passed: real operations, saved summaries, password exclusion, browse exclusion, owner/cold/stage cancellation, commit protection, stop, interruption recovery, bounded history and non-blocking persistence failures.');
 }finally{await service?.stop();const child=path.relative(path.resolve('work/temp'),root);assert(child&&!child.startsWith('..')&&!path.isAbsolute(child));await fs.rm(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
