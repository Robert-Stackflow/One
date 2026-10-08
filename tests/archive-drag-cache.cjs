const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const Module=require('node:module');
const {spawn,spawnSync}=require('node:child_process');
const {once}=require('node:events');
const {build}=require('esbuild');
const JSZip=require('jszip');

async function compiled(file){
 const output=await build({entryPoints:[`src/main/${file}.ts`],bundle:true,platform:'node',format:'cjs',write:false});
 const filename=path.resolve(`dist/main/${file}-test.cjs`),module=new Module(filename);
 module.filename=filename;module.paths=Module._nodeModulePaths(path.dirname(filename));module._compile(output.outputFiles[0].text,filename);return module.exports;
}
async function main(){
 await fs.mkdir('work/temp',{recursive:true});
 const root=await fs.mkdtemp(path.resolve('work/temp/one-archive-drag-cache-'));
 let child,closed,service;
 try{
  const {ArchiveDragCache}=await compiled('archive-drag-cache');
  const {ArchiveService}=await compiled('archive-service');
  const reports=[],cacheRoot=path.join(root,'cache'),cache=new ArchiveDragCache(cacheRoot,value=>reports.push(value));
  const fresh=crypto.randomUUID(),expired=crypto.randomUUID(),unknown=crypto.randomUUID();
  const freshJob=await cache.create(fresh),oldJob=await cache.create(expired);
  const age=async(id,job)=>fs.writeFile(path.join(job.directory,'.one-archive-drag.json'),JSON.stringify({kind:'one-archive-drag',version:1,id,created:Date.now()-25*60*60*1000}));
  await age(expired,oldJob);
  const foreign=path.join(cacheRoot,'drag-'+unknown);await fs.mkdir(foreign);await fs.writeFile(path.join(foreign,'user.txt'),'keep');
  assert.deepEqual(await cache.sweep(),{removed:1,busy:0,failures:[]});
  await assert.rejects(fs.stat(oldJob.directory),{code:'ENOENT'});await fs.stat(freshJob.directory);await fs.stat(foreign);
  await assert.rejects(cache.create(fresh),{code:'EEXIST'});await fs.stat(freshJob.lease);
  await assert.rejects(cache.create('../outside'),/编号/);
  assert.equal(await cache.release(unknown),false);

  // Removing generated contents must unlink junctions rather than visit them.
  const outside=path.join(root,'outside');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'keep.txt'),'outside');
  await fs.symlink(outside,freshJob.payload,'junction');
  assert.equal(await cache.release(fresh),true);assert.equal(await fs.readFile(path.join(outside,'keep.txt'),'utf8'),'outside');
  const resumed=crypto.randomUUID(),resumedJob=await cache.create(resumed);await age(resumed,resumedJob);
  await fs.rename(resumedJob.lease,path.join(resumedJob.directory,'lease.claimed'));
  assert.equal((await cache.sweep()).removed,1,'resume cleanup after a previous claim');
  const malformed=crypto.randomUUID(),badJob=await cache.create(malformed);
  await fs.writeFile(path.join(badJob.directory,'.one-archive-drag.json'),'{');
  assert.equal((await cache.sweep()).failures.length,1);await fs.stat(badJob.directory);
  await age(malformed,badJob);assert.equal(await cache.release(malformed),true);
  assert(reports.some(value=>value.failures.length));

  const linkedRoot=new ArchiveDragCache(path.join(root,'link'));
  await fs.symlink(outside,path.join(root,'link'),'junction');
  await assert.rejects(linkedRoot.create(crypto.randomUUID()),/普通目录/);
  assert.equal((await linkedRoot.sweep()).failures.length,1);
  assert.deepEqual(await fs.readdir(outside),['keep.txt']);

  // A real native handle denies FILE_SHARE_DELETE: cleanup cannot claim the
  // lease while a helper is alive, even after an application restart.
  const live=crypto.randomUUID(),liveJob=await cache.create(live);await age(live,liveJob);
  const zip=path.join(root,'source.zip'),source=new JSZip();source.file('file.txt','native lease');
  await fs.writeFile(zip,await source.generateAsync({type:'nodebuffer'}));
  const helper=path.resolve('dist/native/One.Archive.exe');
  const env={...process.env,ONE_TEST_MODE:'1',TEMP:root,TMP:root};
  const listing=spawnSync(helper,['list',zip,'0','200','0'],{input:Buffer.alloc(4),encoding:'utf8',env,timeout:30000});
  assert.equal(listing.status,0,listing.stdout+listing.stderr);
  const revision=listing.stdout.trim().split(/\r?\n/).map(JSON.parse).find(value=>value.type==='meta').revision;
  child=spawn(helper,['drag-test',zip,liveJob.payload,'0',revision,'0',liveJob.lease],{env,windowsHide:true,stdio:'pipe'});
  closed=once(child,'close');child.stdin.on('error',()=>{});
  const packet=Buffer.alloc(12);packet.writeUInt32LE(1,4);child.stdin.write(packet);
  let timer;
  await new Promise((resolve,reject)=>{
   let output='';timer=setTimeout(()=>reject(Error('Native lease ready timeout')),30000);
   child.once('error',reject);child.stdout.on('data',chunk=>{output+=chunk;if(output.includes('"type":"ready"'))resolve();});
   child.once('close',code=>reject(Error(`Native lease exited early: ${code} ${output}`)));
  }).finally(()=>clearTimeout(timer));
  assert.equal(await cache.release(live),false,'live lease prevents cleanup');
  assert.deepEqual(await cache.sweep(),{removed:0,busy:1,failures:[]});
  service=new ArchiveService(cacheRoot,()=>{});await service.stop();service=null;
  await fs.stat(liveJob.lease);await fs.stat(foreign);
  child.kill();await closed;child=null;
  assert.equal((await cache.sweep()).removed,1,'dead helper lease is reclaimed after TTL');
  await fs.stat(foreign);await cache.removeEmptyRoot();await fs.stat(cacheRoot);
  await fs.rm(foreign,{recursive:true});await cache.removeEmptyRoot();await assert.rejects(fs.stat(cacheRoot),{code:'ENOENT'});
  console.log('Archive drag cache passed: TTL, ownership, live native lease, restart/exit, interrupted cleanup, junctions and failures. No Explorer windows.');
 }finally{
  if(child){child.kill();await closed;}if(service)await service.stop();
  const relative=path.relative(path.resolve('work/temp'),root);assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));
  await fs.rm(root,{recursive:true,force:true});
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
