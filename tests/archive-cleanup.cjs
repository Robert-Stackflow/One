const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {spawn,spawnSync}=require('node:child_process');
const {build}=require('esbuild');
const Module=require('node:module');
const helper=path.resolve('dist/native/One.Archive.exe');
async function compile(entry){const result=await build({entryPoints:[entry],bundle:true,platform:'node',format:'cjs',write:false});const filename=path.resolve('dist/main/archive-cleanup-test.cjs'),mod=new Module(filename);mod.filename=filename;mod.paths=Module._nodeModulePaths(path.dirname(filename));mod._compile(result.outputFiles[0].text,filename);return mod.exports;}
async function main(){
 await fs.mkdir('work/temp',{recursive:true});const root=await fs.mkdtemp(path.resolve('work/temp/one-archive-cleanup-'));let serial=0,live,service;
 const prior={ONE_TEST_MODE:process.env.ONE_TEST_MODE,ONE_ARCHIVE_RECOVER_CRASH_POINT:process.env.ONE_ARCHIVE_RECOVER_CRASH_POINT};
 const env={...process.env,ONE_TEST_MODE:'1',TEMP:root,TMP:root};delete env.ONE_ARCHIVE_PUBLISH_CRASH_POINT;delete env.ONE_ARCHIVE_RECOVER_CRASH_POINT;
 const missing=file=>assert.rejects(fs.stat(file),{code:'ENOENT'});
 const run=(job,mode='cleanup',extra={},status=0,ack=1)=>{const result=spawnSync(helper,[mode,job.parent,job.recovery],{env:{...env,...extra},input:Buffer.from([0,0,0,0,...[ack].flat()]),encoding:'utf8',timeout:30000});assert.equal(result.status,status,JSON.stringify(result));return result;};
 const read=(job,name)=>fs.readFile(path.join(job.parent,name),'utf8');
 const fixture=async(point='committed')=>{
  const id=randomUUID(),parent=path.join(root,'中文 😀 '+serial++),stage=path.join(parent,'.one-extract-'+id),recovery=path.join(parent,'.one-recovery-'+id);await fs.mkdir(stage,{recursive:true});
  for(const name of ['a.txt','b.txt']){await fs.writeFile(path.join(parent,name),'old '+name);await fs.writeFile(path.join(stage,name),'new '+name);}
  await fs.mkdir(path.join(stage,'目录'));await fs.writeFile(path.join(stage,'目录','文件.txt'),'new nested');
  const result=spawnSync(helper,['publish',stage,parent,recovery,'replace'],{env:{...env,ONE_ARCHIVE_PUBLISH_CRASH_POINT:point},input:Buffer.from([0,0,0,0,1]),encoding:'utf8',timeout:30000});assert.equal(result.status,77,JSON.stringify(result));await fs.rm(stage,{recursive:true,force:true});return{id,parent,recovery,manifest:path.join(recovery,'manifest.jsonl')};
 };
 const ready=async job=>{
  live=spawn(helper,['cleanup',job.parent,job.recovery],{env,stdio:'pipe',windowsHide:true});let output='';let yes,no;const waiting=new Promise((resolve,reject)=>{yes=resolve;no=reject;});const ended=new Promise(resolve=>live.once('close',resolve));
  const timer=setTimeout(()=>no(Error('Cleanup did not become ready: '+output)),10000);live.stdout.on('data',chunk=>{output+=chunk;if(output.includes('"type":"ready"'))yes();});live.stderr.resume();live.once('error',no);live.stdin.write(Buffer.alloc(4));try{await waiting;}finally{clearTimeout(timer);}return {ended};
 };
 try{
  for(const point of ['committed','cleanup:0','cleanup:1']){
   const job=await fixture(point);run(job);await missing(job.recovery);assert.equal(await read(job,'a.txt'),'new a.txt');assert.equal(await read(job,'b.txt'),'new b.txt');assert.equal(await read(job,'目录/文件.txt'),'new nested');assert.match(run(job).stdout,/"count":0/);
  }
  for(const point of ['prepared','backup:0','published:0','published:3']){
   const job=await fixture(point);if(point!=='prepared'){const before=await fs.readFile(job.manifest);run(job,'cleanup',{},2);assert.deepEqual(await fs.readFile(job.manifest),before);}
   run(job,'recover');run(job);await missing(job.recovery);assert.equal(await read(job,'a.txt'),'old a.txt');assert.equal(await read(job,'b.txt'),'old b.txt');await missing(path.join(job.parent,'目录','文件.txt'));if(point==='published:3')assert((await fs.stat(path.join(job.parent,'目录'))).isDirectory(),'Cleanup never deletes target directories');
  }
  for(const restored of [false,true])for(const point of ['cleanup:0','cleanup:1','cleanup-manifest','cleanup-directory']){
   const job=await fixture(restored?'published:3':'committed');if(restored)run(job,'recover');run(job,'cleanup',{ONE_ARCHIVE_RECOVER_CRASH_POINT:point},77);run(job);await missing(job.recovery);assert.equal(await read(job,'a.txt'),restored?'old a.txt':'new a.txt');
  }
  let job=await fixture('published:3');run(job,'recover',{ONE_ARCHIVE_RECOVER_CRASH_POINT:'restored:0'},77);run(job,'cleanup',{},2);assert.equal(await fs.readFile(path.join(job.recovery,'0.displaced'),'utf8'),'new a.txt','Partially restored recovery copies must remain');run(job,'recover');run(job);
  // Every conflict is checked across the whole plan before deleting any copy.
  job=await fixture();await fs.writeFile(path.join(job.parent,'b.txt'),'user edit');assert.match(run(job,'cleanup',{},2).stdout,/changed/);assert.equal(await fs.readFile(path.join(job.recovery,'0.original'),'utf8'),'old a.txt');
  job=await fixture();await fs.writeFile(path.join(job.recovery,'1.original'),'changed backup');run(job,'cleanup',{},2);assert.equal(await fs.readFile(path.join(job.recovery,'0.original'),'utf8'),'old a.txt');
  job=await fixture('published:3');run(job,'recover');await fs.writeFile(path.join(job.recovery,'1.displaced'),'changed displaced');run(job,'cleanup',{},2);assert.equal(await fs.readFile(path.join(job.recovery,'0.displaced'),'utf8'),'new a.txt');
  job=await fixture();await fs.link(path.join(job.recovery,'1.original'),path.join(job.parent,'backup-link'));run(job,'cleanup',{},2);assert.equal(await fs.readFile(path.join(job.recovery,'0.original'),'utf8'),'old a.txt');
  job=await fixture();await fs.link(path.join(job.parent,'b.txt'),path.join(job.parent,'target-link'));run(job,'cleanup',{},2);assert.equal(await fs.readFile(path.join(job.recovery,'0.original'),'utf8'),'old a.txt');
  for(const type of ['file','directory','junction']){
   job=await fixture();const extra=path.join(job.recovery,'unrelated');if(type==='file')await fs.writeFile(extra,'keep');else if(type==='directory')await fs.mkdir(extra);else await fs.symlink(root,extra,'junction');run(job,'cleanup',{},2);assert.equal(await fs.readFile(path.join(job.recovery,'0.original'),'utf8'),'old a.txt');assert(await fs.lstat(extra));
  }
  job=await fixture();await fs.unlink(path.join(job.parent,'b.txt'));run(job,'cleanup',{},2);assert.equal(await fs.readFile(path.join(job.recovery,'0.original'),'utf8'),'old a.txt');
  job=await fixture();const valid=await fs.readFile(job.manifest);for(const text of [valid.toString().slice(0,-1),valid.toString().replace('"version":2','"version":3')]){await fs.writeFile(job.manifest,text);run(job,'cleanup',{},2);assert.equal(await fs.readFile(path.join(job.recovery,'0.original'),'utf8'),'old a.txt');}await fs.writeFile(job.manifest,valid);
  await fs.rename(job.recovery,job.recovery+'-original');await fs.mkdir(job.recovery);for(const name of await fs.readdir(job.recovery+'-original'))await fs.copyFile(path.join(job.recovery+'-original',name),path.join(job.recovery,name));run(job,'cleanup',{},2);assert.equal(await fs.readFile(path.join(job.recovery,'0.original'),'utf8'),'old a.txt');
  job=await fixture();await fs.rename(path.join(job.parent,'目录'),path.join(job.parent,'old-dir'));await fs.symlink(path.join(job.parent,'old-dir'),path.join(job.parent,'目录'),'junction');run(job,'cleanup',{},2);assert.equal(await fs.readFile(path.join(job.recovery,'0.original'),'utf8'),'old a.txt');
  // Empty final directory is resumable, but a missing manifest never permits
  // deleting unknown children. Scope is explicit, nonrecursive and UUID-bound.
  job=await fixture();await fs.unlink(job.manifest);run(job,'cleanup',{},2);assert.equal(await fs.readFile(path.join(job.recovery,'0.original'),'utf8'),'old a.txt');
  for(const name of await fs.readdir(job.recovery))await fs.unlink(path.join(job.recovery,name));run(job);await missing(job.recovery);
  const outside={parent:root,recovery:path.join(root,'ordinary')};await fs.mkdir(outside.recovery);run(outside,'cleanup',{},2);assert((await fs.stat(outside.recovery)).isDirectory());
  job=await fixture();run(job,'cleanup',{},2,2);assert.equal(await fs.readFile(path.join(job.recovery,'0.original'),'utf8'),'old a.txt');
  run(job,'cleanup',{},2,[1,2]);assert.equal(await fs.readFile(path.join(job.recovery,'0.original'),'utf8'),'old a.txt','Stop immediately after ACK preserves every recovery copy');
  let {ended}=await ready(job);run(job,'cleanup',{},2);run(job,'recover',{},2);await assert.rejects(fs.rename(job.recovery,job.recovery+'-moved'));await fs.writeFile(path.join(job.parent,'a.txt'),'late edit');live.stdin.end(Buffer.from([1]));assert.equal(await ended,2);live=undefined;assert.equal(await fs.readFile(path.join(job.recovery,'0.original'),'utf8'),'old a.txt');
  job=await fixture();({ended}=await ready(job));await fs.writeFile(path.join(job.recovery,'unknown'),'late unknown');live.stdin.end(Buffer.from([1]));assert.equal(await ended,2);live=undefined;assert.equal(await fs.readFile(path.join(job.recovery,'unknown'),'utf8'),'late unknown');assert(await fs.stat(job.manifest),'Unknown late child retains manifest for inspection');
  job=await fixture();run(job,'cleanup',{ONE_TEST_MODE:'0',ONE_ARCHIVE_RECOVER_CRASH_POINT:'cleanup:0'});await missing(job.recovery);
  const {ArchiveService}=await compile('src/main/archive-service.ts'),{ArchiveRecoveryRegistry,inspectArchiveRecovery}=await compile('src/main/archive-recovery.ts'),{ArchiveTasks}=await compile('src/main/archive-tasks.ts');
  const profile=path.join(root,'profile'),cache=path.join(profile,'archive-cache'),registry=new ArchiveRecoveryRegistry(path.join(profile,'tasks','archive-recovery')),taskFile=path.join(profile,'tasks','history.json');
  let tasks=new ArchiveTasks(taskFile);service=new ArchiveService(cache,()=>{},undefined,undefined,false,tasks);
  job=await fixture();await registry.register(job.id,path.join(root,'source.zip'),job.parent);let result=await service.cleanupRecovery(1,job.id.toUpperCase());assert.equal(result.count,2);assert.equal(result.path,job.parent);assert.equal((await service.recoveryPage()).total,0);await missing(job.recovery);await assert.rejects(service.run(1,{operation:'cleanup',path:'fake',record:{}}),/请求无效/);await service.stop();
  tasks=new ArchiveTasks(taskFile);service=new ArchiveService(cache,()=>{},undefined,undefined,false,tasks);assert((await service.taskOverview()).recent.some(task=>task.operation==='cleanup'&&task.state==='completed'));
  job=await fixture('published:3');await registry.register(job.id,path.join(root,'source.zip'),job.parent);await assert.rejects(service.cleanupRecovery(1,job.id),/先还原/);await service.restoreRecovery(1,job.id);result=await service.cleanupRecovery(1,job.id);assert.equal(result.count,3);assert.equal(await read(job,'a.txt'),'old a.txt');await service.stop();
  for(const point of ['cleanup:0','cleanup-manifest','cleanup-directory']){
   job=await fixture();const record=await registry.register(job.id,path.join(root,'source.zip'),job.parent);process.env.ONE_TEST_MODE='1';process.env.ONE_ARCHIVE_RECOVER_CRASH_POINT=point;service=new ArchiveService(cache,()=>{});await assert.rejects(service.cleanupRecovery(1,job.id));await service.stop();assert(await registry.read(job.id),'Crash retains index until absence is confirmed by successful cleanup');delete process.env.ONE_ARCHIVE_RECOVER_CRASH_POINT;
   if(point==='cleanup-manifest')assert.equal((await inspectArchiveRecovery(record)).state,'empty');if(point==='cleanup-directory')assert.equal((await inspectArchiveRecovery(record)).state,'missing');
   service=new ArchiveService(cache,()=>{});await service.cleanupRecovery(1,job.id);await assert.rejects(registry.read(job.id),{code:'ENOENT'});await missing(job.recovery);await service.stop();
  }
  job=await fixture();await registry.register(job.id,path.join(root,'source.zip'),job.parent);let cancelled=false;service=new ArchiveService(cache,(_owner,progress)=>{if(progress.operation==='cleanup'&&!cancelled){cancelled=true;assert.equal(service.cancel(progress.id,2),false);assert.equal(service.cancel(progress.id,1),true);}});await assert.rejects(service.cleanupRecovery(1,job.id));assert(cancelled);assert.equal(await fs.readFile(path.join(job.recovery,'0.original'),'utf8'),'old a.txt');await service.stop();
  job=await fixture();await registry.register(job.id,path.join(root,'source.zip'),job.parent);service=new ArchiveService(cache,()=>{});const both=await Promise.allSettled([service.cleanupRecovery(1,job.id),service.cleanupRecovery(2,job.id)]);assert.equal(both.filter(value=>value.status==='fulfilled').length,1);await missing(job.recovery);
  console.log('Extraction recovery cleanup passed: committed/restored copies, full-plan conflicts, interrupted deletion and manifest/directory gaps, unknown content, identity/link protections, cancellation, exclusive access, service restart and task history.');
 }finally{for(const [key,value] of Object.entries(prior))if(value===undefined)delete process.env[key];else process.env[key]=value;await service?.stop();if(live&&live.exitCode===null&&live.signalCode===null){const ended=new Promise(resolve=>live.once('close',resolve));live.kill();await ended;}assert.equal(path.dirname(root),path.resolve('work/temp'));await fs.rm(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
