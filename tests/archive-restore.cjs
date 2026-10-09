const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {crc32}=require('node:zlib');
const {spawnSync,spawn}=require('node:child_process');
const {build}=require('esbuild');
const Module=require('node:module');
const helper=path.resolve('dist/native/One.Archive.exe');
async function compile(entry){const result=await build({entryPoints:[entry],bundle:true,platform:'node',format:'cjs',write:false});const filename=path.resolve('dist/main/archive-restore-test.cjs'),mod=new Module(filename);mod.filename=filename;mod.paths=Module._nodeModulePaths(path.dirname(filename));mod._compile(result.outputFiles[0].text,filename);return mod.exports;}
function journal(rows){let crc=0;return rows.map((record,sequence)=>{const prefix=JSON.stringify({sequence,record}).slice(0,-1);crc=crc32(Buffer.from(prefix),crc);return prefix+',"crc32":"'+crc.toString(16).padStart(8,'0')+'"}\n';}).join('');}
async function main(){
 await fs.mkdir('work/temp',{recursive:true});const root=await fs.mkdtemp(path.resolve('work/temp/one-archive-restore-'));let serial=0,live,service;
 const priorCrash=process.env.ONE_ARCHIVE_RECOVER_CRASH_POINT,priorTest=process.env.ONE_TEST_MODE;
 const env={...process.env,ONE_TEST_MODE:'1',TEMP:root,TMP:root};delete env.ONE_ARCHIVE_PUBLISH_CRASH_POINT;delete env.ONE_ARCHIVE_RECOVER_CRASH_POINT;
 const read=(job,name)=>fs.readFile(path.join(job.parent,name),'utf8');
 const missing=file=>assert.rejects(fs.stat(file),{code:'ENOENT'});
 const run=(job,extra={},status=0,ack=1)=>{const result=spawnSync(helper,['recover',job.parent,job.recovery],{env:{...env,...extra},input:Buffer.from([0,0,0,0,ack]),encoding:'utf8',timeout:30000});assert.equal(result.status,status,JSON.stringify(result));return result;};
 const fixture=async(point='published:0',uppercase=false)=>{
  const id=uppercase?randomUUID().toUpperCase():randomUUID(),parent=path.join(root,'中文 😀 '+serial++),stage=path.join(parent,'.one-extract-'+id),recovery=path.join(parent,'.one-recovery-'+id);await fs.mkdir(stage,{recursive:true});
  for(const name of ['a.txt','b.txt']){await fs.writeFile(path.join(parent,name),'old '+name);await fs.writeFile(path.join(stage,name),'new '+name);}
  await fs.mkdir(path.join(stage,'目录'));await fs.writeFile(path.join(stage,'目录','文件.txt'),'新文件');
  const result=spawnSync(helper,['publish',stage,parent,recovery,'replace'],{env:{...env,ONE_ARCHIVE_PUBLISH_CRASH_POINT:point},input:Buffer.from([0,0,0,0,1]),encoding:'utf8',timeout:30000});assert.equal(result.status,77,JSON.stringify(result));return{id,parent,stage,recovery,manifest:path.join(recovery,'manifest.jsonl')};
 };
 try{
  for(const point of ['prepared','backup:0','published:0','published:1','published:3']){
   const job=await fixture(point),before=await fs.readFile(job.manifest);await fs.rm(job.stage,{recursive:true});
   const result=run(job);assert.match(result.stdout,/"retained":true/);assert.equal(await read(job,'a.txt'),'old a.txt');assert.equal(await read(job,'b.txt'),'old b.txt');await missing(path.join(job.parent,'目录','文件.txt'));
   assert.deepEqual(await fs.readFile(job.manifest),before,'Immutable original journal is retained');
   const again=run(job);assert.match(again.stdout,/"count":0,"displaced":0/,'Restore can be repeated');
  }
  for(const point of ['committed','cleanup:0']){const job=await fixture(point);assert.match(run(job,{},2).stdout,/committed/);assert.equal(await read(job,'a.txt'),'new a.txt');}
  for(const point of ['displaced:0','restored:0','restored:1']){
   const job=await fixture('published:3');run(job,{ONE_ARCHIVE_RECOVER_CRASH_POINT:point},77);run(job);assert.equal(await read(job,'a.txt'),'old a.txt');assert.equal(await read(job,'b.txt'),'old b.txt');assert.equal(await fs.readFile(path.join(job.recovery,'0.displaced'),'utf8'),'new a.txt');
  }
  const ordinary=await fixture();run(ordinary,{ONE_TEST_MODE:'0',ONE_ARCHIVE_RECOVER_CRASH_POINT:'displaced:0'});assert.equal(await read(ordinary,'a.txt'),'old a.txt','Production ignores recovery fault injection');
  // Ordinary conflicts are found across the complete plan before any move.
  let job=await fixture('published:1');await fs.writeFile(path.join(job.parent,'b.txt'),'user edit');assert.match(run(job,{},2).stdout,/modified/);assert.equal(await read(job,'a.txt'),'new a.txt');assert.equal(await read(job,'b.txt'),'user edit');assert.equal(await fs.readFile(path.join(job.recovery,'0.original'),'utf8'),'old a.txt');
  job=await fixture();await fs.writeFile(path.join(job.recovery,'0.original'),'modified backup');assert.match(run(job,{},2).stdout,/original copy changed/);assert.equal(await read(job,'a.txt'),'new a.txt');
  job=await fixture();await fs.unlink(path.join(job.recovery,'0.original'));assert.match(run(job,{},2).stdout,/copy is missing/);assert.equal(await read(job,'a.txt'),'new a.txt');
  job=await fixture();await fs.writeFile(path.join(job.recovery,'0.displaced'),'occupied');assert.match(run(job,{},2).stdout,/displaced file changed/);assert.equal(await read(job,'a.txt'),'new a.txt');
  job=await fixture();await fs.link(path.join(job.parent,'a.txt'),path.join(job.parent,'extra-link'));assert.match(run(job,{},2).stdout,/link/);assert.equal(await read(job,'a.txt'),'new a.txt');
  job=await fixture();await fs.unlink(path.join(job.parent,'a.txt'));await fs.mkdir(path.join(job.parent,'a.txt'));assert.match(run(job,{},2).stdout,/incompatible|lock recovery path/);
  job=await fixture('published:3');await fs.rename(path.join(job.parent,'目录'),path.join(job.parent,'old-dir'));await fs.symlink(path.join(job.parent,'old-dir'),path.join(job.parent,'目录'),'junction');assert.match(run(job,{},2).stdout,/link/);assert.equal(await read(job,'a.txt'),'new a.txt');
  job=await fixture('committed');let recorded=(await fs.readFile(job.manifest,'utf8')).trimEnd().split('\n').map(line=>JSON.parse(line).record);recorded.pop();await fs.writeFile(job.manifest,journal(recorded));await fs.rename(path.join(job.parent,'目录'),path.join(job.parent,'old-dir'));await fs.mkdir(path.join(job.parent,'目录'));assert.match(run(job,{},2).stdout,/directory changed/);assert.equal(await read(job,'a.txt'),'new a.txt');
  job=await fixture();const good=await fs.readFile(job.manifest,'utf8'),rows=good.trimEnd().split('\n').map(line=>JSON.parse(line).record);
  for(const bad of [good.slice(0,-1),good.replace('"version":2','"version":3'),journal([{...rows[0],version:3},...rows.slice(1)]),journal([rows[0],{...rows[1],target:path.join(root,'escape.txt')},...rows.slice(2)]),journal([rows[0],{...rows[1],sourceStamp:rows[1].targetStamp},...rows.slice(2)]),journal([rows[0],rows[1],rows[1],...rows.slice(2)]),journal([...rows,{type:'committed',count:4,skipped:0}])]){await fs.writeFile(job.manifest,bad);run(job,{},2);assert.equal(await read(job,'a.txt'),'new a.txt');}
  await fs.writeFile(job.manifest,good);run(job,{},2,2);assert.equal(await read(job,'a.txt'),'new a.txt','Cancellation before acknowledgement does not move files');
  // First restorer holds the manifest and all inspected directory ancestors.
  live=spawn(helper,['recover',job.parent,job.recovery],{env,stdio:'pipe',windowsHide:true});let output='';let readyResolve,readyReject;const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
  const timer=setTimeout(()=>readyReject(Error('Recovery did not become ready')),10000);const ended=new Promise(resolve=>live.once('close',resolve));
  live.stdout.on('data',chunk=>{output+=chunk;if(output.includes('"type":"ready"'))readyResolve();});live.once('error',readyReject);live.stdin.write(Buffer.from([0,0,0,0]));await ready;clearTimeout(timer);
  assert.match(run(job,{},2).stdout,/lock recovery path/);await assert.rejects(fs.rename(job.recovery,job.recovery+'-moved'));
  await fs.writeFile(path.join(job.parent,'a.txt'),'late user edit');live.stdin.end(Buffer.from([1]));assert.equal(await ended,2);live=undefined;assert.equal(await read(job,'a.txt'),'late user edit');
  // The public recovery entry uses the same resource queue, owner cancellation,
  // persisted task history and native helper, without opening Explorer.
  const {ArchiveService}=await compile('src/main/archive-service.ts'),{ArchiveRecoveryRegistry}=await compile('src/main/archive-recovery.ts'),{ArchiveTasks}=await compile('src/main/archive-tasks.ts');
  const profile=path.join(root,'profile'),cache=path.join(profile,'archive-cache'),registry=new ArchiveRecoveryRegistry(path.join(profile,'tasks','archive-recovery')),taskFile=path.join(profile,'tasks','history.json');
  let tasks=new ArchiveTasks(taskFile);service=new ArchiveService(cache,()=>{},undefined,undefined,false,tasks);
  job=await fixture('published:3');await registry.register(job.id,path.join(root,'source.zip'),job.parent);const original=await fs.readFile(job.manifest);
  let result=await service.restoreRecovery(1,job.id.toUpperCase());assert.equal(result.count,2);assert.equal(result.path,job.recovery);assert.equal(await read(job,'a.txt'),'old a.txt');assert.deepEqual(await fs.readFile(job.manifest),original);assert.equal((await service.recoveryPage()).total,1);assert.equal((await service.inspectRecovery(1,job.id)).state,'pending','Inspection reports original publication records');
  assert.equal((await service.restoreRecovery(1,job.id)).count,0);await assert.rejects(service.run(1,{operation:'recover',path:'fake',record:{}}),/请求无效/);
  job=await fixture('published:0',true);await registry.register(job.id,path.join(root,'source.zip'),job.parent);assert.equal((await service.restoreRecovery(1,job.id)).count,1);assert.equal(await read(job,'a.txt'),'old a.txt','Canonical record ID can reopen an uppercase original staging name');
  await service.stop();tasks=new ArchiveTasks(taskFile);service=new ArchiveService(cache,()=>{},undefined,undefined,false,tasks);assert((await service.taskOverview()).recent.some(task=>task.operation==='recover'&&task.state==='completed'));
  job=await fixture();await registry.register(job.id,path.join(root,'source.zip'),job.parent);const concurrent=await Promise.allSettled([service.restoreRecovery(1,job.id),service.restoreRecovery(2,job.id)]);assert.equal(concurrent.filter(value=>value.status==='fulfilled').length,1);assert.equal(await read(job,'a.txt'),'old a.txt');
  await service.stop();job=await fixture();await registry.register(job.id,path.join(root,'source.zip'),job.parent);let cancelled=false;
  service=new ArchiveService(cache,(_owner,progress)=>{if(progress.operation==='recover'&&!cancelled){cancelled=true;assert.equal(service.cancel(progress.id,2),false);assert.equal(service.cancel(progress.id,1),true);}});
  await assert.rejects(service.restoreRecovery(1,job.id));assert(cancelled);assert.equal(await read(job,'a.txt'),'new a.txt');await service.stop();
  // A native restore crash retains both its index and already displaced data.
  job=await fixture('published:3');await registry.register(job.id,path.join(root,'source.zip'),job.parent);process.env.ONE_TEST_MODE='1';process.env.ONE_ARCHIVE_RECOVER_CRASH_POINT='displaced:0';service=new ArchiveService(cache,()=>{});await assert.rejects(service.restoreRecovery(1,job.id));await service.stop();delete process.env.ONE_ARCHIVE_RECOVER_CRASH_POINT;service=new ArchiveService(cache,()=>{});result=await service.restoreRecovery(1,job.id);assert.equal(result.count,2);assert.equal(await read(job,'a.txt'),'old a.txt');assert.equal(await fs.readFile(path.join(job.recovery,'0.displaced'),'utf8'),'new a.txt');await service.stop();service=undefined;
  console.log('Native extraction restore passed: real crash boundaries, repeat/restart after individual moves, retained new contents, stage removal, committed rejection, modified/missing copies, links, forged/corrupt journals, exclusive locks, cancellation and late user edits.');
 }finally{if(priorCrash===undefined)delete process.env.ONE_ARCHIVE_RECOVER_CRASH_POINT;else process.env.ONE_ARCHIVE_RECOVER_CRASH_POINT=priorCrash;if(priorTest===undefined)delete process.env.ONE_TEST_MODE;else process.env.ONE_TEST_MODE=priorTest;await service?.stop();if(live){live.kill();await new Promise(resolve=>live.once('close',resolve));}assert.equal(path.dirname(root),path.resolve('work/temp'));await fs.rm(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1});
