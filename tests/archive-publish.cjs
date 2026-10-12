const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const Module=require('node:module');
const {spawn,spawnSync}=require('node:child_process');
const {once}=require('node:events');
const {build}=require('esbuild');
const JSZip=require('jszip');
const helper=path.resolve('dist/native/One.Archive.exe');
async function main(){
 await fs.mkdir('work/temp',{recursive:true});const root=await fs.mkdtemp(path.resolve('work/temp/one-archive-publish-'));
 let child,closed,service;
 try{
  let serial=0;
  const fixture=async(contents={'a.txt':'new'},existing={'a.txt':'old'})=>{
   const parent=path.join(root,'case-'+serial++);await fs.mkdir(parent);
   const stage=path.join(parent,'.one-extract-'+crypto.randomUUID()),recovery=path.join(parent,'.one-recovery-'+crypto.randomUUID());await fs.mkdir(stage);
   for(const [name,text] of Object.entries(contents)){const file=path.join(stage,name);await fs.mkdir(path.dirname(file),{recursive:true});if(text===null)await fs.mkdir(file);else await fs.writeFile(file,text);}
   for(const [name,text] of Object.entries(existing)){const file=path.join(parent,name);await fs.mkdir(path.dirname(file),{recursive:true});if(text===null)await fs.mkdir(file);else await fs.writeFile(file,text);}
   return {parent,stage,recovery};
  };
  const env={...process.env,ONE_TEST_MODE:'1',TEMP:root,TMP:root};
  const run=(job,policy='rename',extra={},status=0,ack=1)=>{
   const result=spawnSync(helper,['publish',job.stage,job.parent,job.recovery,policy],{env:{...env,...extra},input:Buffer.from([0,0,0,0,...[ack].flat()]),encoding:'utf8',timeout:30000});
   assert.equal(result.status,status,result.stdout+'\n'+result.stderr+'\n'+result.error);
   return result.stdout.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse).at(-1);
  };
  const noRecovery=job=>assert.rejects(fs.stat(job.recovery),{code:'ENOENT'});
  let job=await fixture();assert.equal(run(job).count,1);assert.equal(await fs.readFile(path.join(job.parent,'a.txt'),'utf8'),'old');assert.equal(await fs.readFile(path.join(job.parent,'a (2).txt'),'utf8'),'new');await noRecovery(job);
  job=await fixture();const queuedStop=run(job,'replace',{},0,[1,2]);assert(queuedStop.cancelled);assert.equal(await fs.readFile(path.join(job.parent,'a.txt'),'utf8'),'old');assert.equal(await fs.readFile(path.join(job.stage,'a.txt'),'utf8'),'new');await noRecovery(job);
  job=await fixture();assert.equal(run(job,'skip').skipped,1);assert.equal(await fs.readFile(path.join(job.parent,'a.txt'),'utf8'),'old');await noRecovery(job);
  job=await fixture();assert.equal(run(job,'replace').count,1);assert.equal(await fs.readFile(path.join(job.parent,'a.txt'),'utf8'),'new');await noRecovery(job);
  job=await fixture({'目录/a.txt':'新','目录/empty':null},{'目录/a.txt':'旧','目录/keep.txt':'keep'});run(job,'replace');assert.equal(await fs.readFile(path.join(job.parent,'目录/a.txt'),'utf8'),'新');assert.equal(await fs.readFile(path.join(job.parent,'目录/keep.txt'),'utf8'),'keep');await fs.stat(path.join(job.parent,'目录/empty'));await noRecovery(job);
  job=await fixture({'a.txt':'new','newdir/b.txt':'new-b'});assert.equal(run(job,'replace',{ONE_ARCHIVE_PUBLISH_FAIL_AFTER:'1'},2).type,'error');assert.equal(await fs.readFile(path.join(job.parent,'a.txt'),'utf8'),'old');await assert.rejects(fs.stat(path.join(job.parent,'newdir')),{code:'ENOENT'});await noRecovery(job);
  job=await fixture({'a.txt':'new','newdir/b.txt':'new-b'});run(job,'replace',{ONE_ARCHIVE_PUBLISH_FAIL_AFTER:'3'},2);assert.equal(await fs.readFile(path.join(job.parent,'a.txt'),'utf8'),'old');await assert.rejects(fs.stat(path.join(job.parent,'newdir')),{code:'ENOENT'});await noRecovery(job);
  job=await fixture();const busy=await fs.open(path.join(job.parent,'a.txt'),'r+');try{assert.match(run(job,'replace',{},2).message,/lock/);}finally{await busy.close();}assert.equal(await fs.readFile(path.join(job.parent,'a.txt'),'utf8'),'old');await noRecovery(job);
  job=await fixture({'dir/a.txt':'data'},{dir:'file'});run(job,'rename');assert.equal(await fs.readFile(path.join(job.parent,'dir (2)/a.txt'),'utf8'),'data');assert.equal(await fs.readFile(path.join(job.parent,'dir'),'utf8'),'file');await noRecovery(job);
  job=await fixture({'dir/a.txt':'data'},{dir:'file'});assert.equal(run(job,'skip').skipped,2);await noRecovery(job);
  job=await fixture({'dir/a.txt':'data'},{dir:'file'});assert.match(run(job,'replace',{},2).message,/folder/i);await noRecovery(job);
  job=await fixture({'a.txt':'new'},{'a.txt':null});assert.match(run(job,'replace',{},2).message,/folder/i);await noRecovery(job);
  const outside=path.join(root,'outside');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'keep.txt'),'keep');
  job=await fixture({'dir/a.txt':'data'},{});await fs.symlink(outside,path.join(job.parent,'dir'),'junction');assert.match(run(job,'replace',{},2).message,/link|junction/);assert.equal(await fs.readFile(path.join(outside,'keep.txt'),'utf8'),'keep');await noRecovery(job);
  const live=async(job,policy,ready,progress,extra={})=>{
   child=spawn(helper,['publish',job.stage,job.parent,job.recovery,policy],{env:{...env,...extra},windowsHide:true,stdio:'pipe'});closed=once(child,'close');child.stdin.on('error',()=>{});
   let buffered='',failure,terminal;const steps=[];let timer;
   const completion=new Promise((resolve,reject)=>{
    timer=setTimeout(()=>{child.kill();reject(Error('Publisher timeout'));},30000);
    child.stdout.on('data',bytes=>{buffered+=bytes;let end;while((end=buffered.indexOf('\n'))>=0){const line=buffered.slice(0,end);buffered=buffered.slice(end+1);if(!line.trim())continue;const message=JSON.parse(line);steps.push((async()=>{if(message.type==='ready'){await ready?.();child.stdin.write(Buffer.from([1]));}else if(message.type==='progress')await progress?.(message);else if(message.type==='result'||message.type==='error')terminal=message;})().catch(error=>{failure=error;child.kill();}));}});
    child.once('error',reject);child.once('close',()=>resolve());
   });
   child.stdin.write(Buffer.alloc(4));await completion.finally(()=>clearTimeout(timer));await Promise.all(steps);await closed;child=null;if(failure)throw failure;return terminal;
  };
  job=await fixture({'a.txt':'new','z.txt':'new-z'},{'a.txt':'old','z.txt':'old-z'});
  const changed=await live(job,'replace',async()=>{await assert.rejects(fs.rename(job.parent,job.parent+'-moved'));await fs.writeFile(path.join(job.parent,'z.txt'),'external update');});
  assert.match(changed.message,/changed/);assert.equal(await fs.readFile(path.join(job.parent,'a.txt'),'utf8'),'old');assert.equal(await fs.readFile(path.join(job.parent,'z.txt'),'utf8'),'external update');await noRecovery(job);
  job=await fixture();assert.equal((await live(job,'replace',null,()=>child.stdin.write(Buffer.from([2])),{ONE_ARCHIVE_PUBLISH_WAIT_AFTER:'1'})).cancelled,true);assert.equal(await fs.readFile(path.join(job.parent,'a.txt'),'utf8'),'old');await noRecovery(job);
  job=await fixture();assert.equal((await live(job,'replace',()=>child.stdin.write(Buffer.from([2])))).cancelled,true);assert.equal(await fs.readFile(path.join(job.parent,'a.txt'),'utf8'),'old');await noRecovery(job);
  job=await fixture();const protectedChange=await live(job,'replace',null,async()=>{await fs.writeFile(path.join(job.parent,'a.txt'),'user edit');child.stdin.write(Buffer.from([2]));},{ONE_ARCHIVE_PUBLISH_WAIT_AFTER:'1'});
  assert.match(protectedChange.message,/recovery retained/);assert.equal(await fs.readFile(path.join(job.parent,'a.txt'),'utf8'),'user edit');assert.equal(await fs.readFile(path.join(job.recovery,'0.original'),'utf8'),'old');await fs.stat(path.join(job.recovery,'manifest.jsonl'));

  const output=await build({entryPoints:['src/main/archive-service.ts'],bundle:true,platform:'node',format:'cjs',write:false});const filename=path.resolve('dist/main/archive-publish-test.cjs'),module=new Module(filename);module.filename=filename;module.paths=Module._nodeModulePaths(path.dirname(filename));module._compile(output.outputFiles[0].text,filename);
  const parent=path.join(root,'service');await fs.mkdir(parent);const zip=new JSZip();zip.file('a.txt','service new');zip.file('dir/文件.txt','文件');const source=path.join(root,'archive.zip');await fs.writeFile(source,await zip.generateAsync({type:'nodebuffer'}));await fs.writeFile(path.join(parent,'a.txt'),'service old');
  let cancelBefore=false,cancelNext=false,stopNext=false,stopped;service=new module.exports.ArchiveService(path.join(root,'cache'),(owner,p)=>{const task=service.active.get(p.id);if(cancelBefore&&task?.cooperative&&!task.committing){cancelBefore=false;assert.equal(service.cancel(p.id,owner),true);}else if(task?.cooperative&&task.committing&&p.done>=1){if(cancelNext){cancelNext=false;assert.equal(service.cancel(p.id,999),false);assert.equal(service.cancel(p.id,owner),true);}else if(stopNext){stopNext=false;stopped=service.stop();}}});
  assert.equal((await service.run(1,{operation:'extract',path:source,parent,destination:'here'})).count,3);assert.equal(await fs.readFile(path.join(parent,'a.txt'),'utf8'),'service old');assert.equal(await fs.readFile(path.join(parent,'a (2).txt'),'utf8'),'service new');
  cancelBefore=true;assert.equal((await service.run(1,{operation:'extract',path:source,parent,destination:'here',conflict:'replace'})).cancelled,true);assert.equal(await fs.readFile(path.join(parent,'a.txt'),'utf8'),'service old');assert(!(await fs.readdir(parent)).some(name=>name.startsWith('.one-')));
  const priorMode=process.env.ONE_TEST_MODE,priorWait=process.env.ONE_ARCHIVE_PUBLISH_WAIT_AFTER;process.env.ONE_TEST_MODE='1';process.env.ONE_ARCHIVE_PUBLISH_WAIT_AFTER='1';cancelNext=true;
  try{assert.equal((await service.run(1,{operation:'extract',path:source,parent,destination:'here',conflict:'replace'})).cancelled,true);stopNext=true;assert.equal((await service.run(1,{operation:'extract',path:source,parent,destination:'here',conflict:'replace'})).cancelled,true);await stopped;}
  finally{if(priorMode===undefined)delete process.env.ONE_TEST_MODE;else process.env.ONE_TEST_MODE=priorMode;if(priorWait===undefined)delete process.env.ONE_ARCHIVE_PUBLISH_WAIT_AFTER;else process.env.ONE_ARCHIVE_PUBLISH_WAIT_AFTER=priorWait;}
  assert.equal(await fs.readFile(path.join(parent,'a.txt'),'utf8'),'service old');assert(!(await fs.readdir(parent)).some(name=>name.startsWith('.one-')));await service.stop();service=null;
  const self=new JSZip();self.file('self.zip','would destroy source');const selfPath=path.join(parent,'self.zip');const original=await self.generateAsync({type:'nodebuffer'});await fs.writeFile(selfPath,original);
  service=new module.exports.ArchiveService(path.join(root,'cache'),()=>{});const selfRequest={operation:'extract',path:selfPath,parent,destination:'here',conflict:'replace'};await assert.rejects(service.run(1,selfRequest),/source archive/);assert.deepEqual(await fs.readFile(selfPath),original);await service.stop();service=null;
  const splitInput=path.join(root,'split-input');await fs.mkdir(splitInput);await fs.writeFile(path.join(splitInput,'split.z01'),'would replace a volume');await fs.writeFile(path.join(splitInput,'data.bin'),crypto.randomBytes(3*1024*1024));
  service=new module.exports.ArchiveService(path.join(root,'cache'),()=>{});const split=path.join(parent,'split.zip');await service.run(1,{operation:'create',path:split,sources:[path.join(splitInput,'split.z01'),path.join(splitInput,'data.bin')],volumeBytes:1024**2});const part=await fs.readFile(path.join(parent,'split.z01'));
  await assert.rejects(service.run(1,{operation:'extract',path:split,parent,destination:'here',conflict:'replace'}),/source archive/);assert.deepEqual(await fs.readFile(path.join(parent,'split.z01')),part);await assert.rejects(fs.stat(path.join(parent,'data.bin')),{code:'ENOENT'});await service.stop();service=null;
  service=new module.exports.ArchiveService(path.join(root,'cache'),()=>{});const sample=path.join(root,'格式.txt');await fs.writeFile(sample,'formats sample');
  for(const format of ['7z','tar','tar.gz','tar.xz','gz','xz']){
   const archive=path.join(root,'format.'+format),target=path.join(root,'format-output-'+format);await fs.mkdir(target);
   const password=format==='7z'?'空 格 password':'';await service.run(1,{operation:'create',path:archive,sources:[sample],password});
   const listing=await service.run(1,{operation:'list',path:archive,password});const outputFile=path.join(target,listing.entries.find(item=>!item.directory).name);await fs.writeFile(outputFile,'original');
   if(password){await assert.rejects(service.run(1,{operation:'extract',path:archive,parent:target,destination:'here',conflict:'replace',password:'wrong'}),/password|open|extract|密码|无法打开/i);assert.equal(await fs.readFile(outputFile,'utf8'),'original');}
   assert.equal((await service.run(1,{operation:'extract',path:archive,parent:target,destination:'here',conflict:'replace',password})).count,1);assert.equal(await fs.readFile(outputFile,'utf8'),'formats sample',format+': '+JSON.stringify(await fs.readdir(target)));
  }
  for(const format of ['rar4','rar5']){const archive=path.resolve(`tests/fixtures/${format}-sample.rar`),target=path.join(root,format);await fs.mkdir(target);const list=await service.run(1,{operation:'list',path:archive});const selected=list.entries.find(item=>!item.directory).index;assert((await service.run(1,{operation:'extract',path:archive,parent:target,destination:'here',selected:[selected],conflict:'replace'})).count>0);}
  await service.stop();service=null;
  console.log('Extract-here passed: rename/skip/replace, merging, type/link rejection, directory locks, late changes, failure/cancel rollback and preserved recovery. No Explorer windows.');
 }finally{if(child){child.kill();await closed;}if(service)await service.stop();const scope=path.relative(path.resolve('work/temp'),root);assert(scope&&!scope.startsWith('..')&&!path.isAbsolute(scope));await fs.rm(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
