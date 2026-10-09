const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {crc32}=require('node:zlib');
const {spawnSync}=require('node:child_process');
const {build}=require('esbuild');
const Module=require('node:module');
const JSZip=require('jszip');
const helper=path.resolve('dist/native/One.Archive.exe');
async function compile(entry){const result=await build({entryPoints:[entry],bundle:true,platform:'node',format:'cjs',write:false});const filename=path.resolve('dist/main/archive-recovery-test.cjs'),mod=new Module(filename);mod.filename=filename;mod.paths=Module._nodeModulePaths(path.dirname(filename));mod._compile(result.outputFiles[0].text,filename);return mod.exports;}
function journal(rows){let crc=0;return rows.map((record,sequence)=>{const prefix=JSON.stringify({sequence,record}).slice(0,-1);crc=crc32(Buffer.from(prefix),crc);return prefix+',"crc32":"'+crc.toString(16).padStart(8,'0')+'"}\n';}).join('');}
async function main(){
 await fs.mkdir('work/temp',{recursive:true});const root=await fs.mkdtemp(path.resolve('work/temp/one-archive-recovery-'));let service;
 const priorMode=process.env.ONE_TEST_MODE,priorPoint=process.env.ONE_ARCHIVE_PUBLISH_CRASH_POINT;
 try{
  const {ArchiveRecoveryRegistry,inspectArchiveRecovery}=await compile('src/main/archive-recovery.ts'),{ArchiveService}=await compile('src/main/archive-service.ts');
  const registry=new ArchiveRecoveryRegistry(path.join(root,'registry'));assert.equal((await registry.list()).total,0);
  const probe=path.join(root,'probe');await fs.writeFile(probe,'');const probeHandle=await fs.open(probe,'r'),handlePrototype=Object.getPrototypeOf(probeHandle),originalWrite=handlePrototype.writeFile;await probeHandle.close();
  const atomic=randomUUID();let releaseWrite,writing;const reached=new Promise(resolve=>writing=resolve),gate=new Promise(resolve=>releaseWrite=resolve);
  handlePrototype.writeFile=async function(bytes,...args){if(Buffer.isBuffer(bytes)&&bytes.toString().includes(atomic)){writing();await gate;}return originalWrite.call(this,bytes,...args);};
  let registering;
  try{registering=registry.register(atomic,path.join(root,'atomic.zip'),root);await reached;assert.equal((await registry.list()).total,0,'Incomplete private write is not exposed as a recovery entry');await assert.rejects(registry.forget(atomic),{code:'ENOENT'});releaseWrite();await registering;assert.equal((await registry.read(atomic)).id,atomic);await registry.forget(atomic);}
  finally{releaseWrite();await registering;handlePrototype.writeFile=originalWrite;}
  let serial=0;
  const fixture=async(point='prepared')=>{
   const id=randomUUID(),parent=path.join(root,'中文 😀 '+serial++),stage=path.join(parent,'.one-extract-'+id),recovery=path.join(parent,'.one-recovery-'+id);await fs.mkdir(stage,{recursive:true});
   await fs.writeFile(path.join(parent,'a.txt'),'old');await fs.writeFile(path.join(stage,'a.txt'),'new');await fs.mkdir(path.join(stage,'目录'));await fs.writeFile(path.join(stage,'目录','文件 😀.txt'),'内容');
   const value=await registry.register(id,path.join(root,'source.zip'),parent);
   const ran=spawnSync(helper,['publish',stage,parent,recovery,'replace'],{env:{...process.env,ONE_TEST_MODE:'1',ONE_ARCHIVE_PUBLISH_CRASH_POINT:point,TEMP:root,TMP:root},input:Buffer.from([0,0,0,0,1]),encoding:'utf8',timeout:30000});assert.equal(ran.status,77,ran.stdout+ran.stderr);
   return{id,parent,stage,recovery,value,manifest:path.join(recovery,'manifest.jsonl')};
  };
  for(const point of ['prepared','backup:0','published:0','committed','cleanup:0']){
   const job=await fixture(point),original=await fs.readFile(job.manifest),checked=await inspectArchiveRecovery(job.value);
   assert.equal(checked.state,point.startsWith('commit')||point.startsWith('cleanup')?'committed':'pending',JSON.stringify(checked));assert.equal(checked.items,3);assert.equal(checked.replaced,1);assert.equal(checked.samples.length,3);assert.deepEqual(await fs.readFile(job.manifest),original,'Inspection must be read-only');
   await assert.rejects(registry.register(job.id,path.join(root,'different.zip'),job.parent),{code:'EEXIST'});
  }
  let job=await fixture(),good=await fs.readFile(job.manifest,'utf8'),rows=good.trimEnd().split('\n').map(line=>JSON.parse(line).record);
  const invalid=async(text,pattern)=>{await fs.writeFile(job.manifest,text);const checked=await inspectArchiveRecovery(job.value);assert.equal(checked.state,'invalid',JSON.stringify(checked));if(pattern)assert.match(checked.message,pattern);assert.equal(await fs.readFile(path.join(job.parent,'a.txt'),'utf8'),'old');};
  await invalid(good.slice(0,-1),/截断/);await invalid(good.replace('"version":2','"version":9'),/校验/);
  await invalid(journal([{...rows[0],version:9},...rows.slice(1)]),/版本/);
  await invalid(journal([{...rows[0],parent:root},...rows.slice(1)]),/属于/);
  await invalid(journal([rows[0],{...rows[1],target:path.join(root,'escape.txt')},...rows.slice(2)]),/路径/);
  await invalid(journal([...rows,{type:'committed',count:3,skipped:0}]),/完成标记/);
  await invalid(journal([...rows,{type:'mystery'}]),/未知/);
  await invalid(Buffer.from([255,10]));await invalid('x'.repeat(512*1024+1));
  const large=await fs.open(job.manifest,'w');await large.truncate(512*1024**2+1);await large.close();assert.equal((await inspectArchiveRecovery(job.value)).state,'invalid');
  await fs.writeFile(job.manifest,good);
  const manyRows=[rows[0],...Array.from({length:10000},(_,index)=>({...rows[1],index,source:path.join(job.stage,index+'.txt'),target:path.join(job.parent,index+'.txt'),backup:path.join(job.recovery,index+'.original')})),{type:'prepared',items:10000,skipped:0}];
  await fs.writeFile(job.manifest,journal(manyRows));let many=await inspectArchiveRecovery(job.value);assert.equal(many.state,'pending',many.message);assert.equal(many.items,10000);assert.equal(many.samples.length,30);
  const during=new AbortController(),inProgress=inspectArchiveRecovery(job.value,during.signal);setImmediate(()=>during.abort());await assert.rejects(inProgress);
  const readHandle=await fs.open(job.manifest,'r'),prototype=Object.getPrototypeOf(readHandle),originalStream=prototype.createReadStream,reading=new AbortController();await readHandle.close();let consumed=false;
  prototype.createReadStream=function(options){const stream=originalStream.call(this,options);if(options?.signal===reading.signal)stream.once('data',()=>{consumed=true;reading.abort();});return stream;};
  try{await assert.rejects(inspectArchiveRecovery(job.value,reading.signal));assert(consumed,'Cancel after actual journal bytes have been read');}finally{prototype.createReadStream=originalStream;}
  await fs.writeFile(job.manifest,good);
  const moved=job.recovery+'-moved';await fs.rename(job.recovery,moved);await fs.mkdir(job.recovery);await fs.writeFile(job.manifest,good);assert.match((await inspectArchiveRecovery(job.value)).message,/身份/);
  await fs.rm(job.recovery,{recursive:true});await fs.symlink(moved,job.recovery,'junction');assert.match((await inspectArchiveRecovery(job.value)).message,/链接/);await fs.unlink(job.recovery);await fs.rename(moved,job.recovery);
  const aborted=new AbortController();aborted.abort();await assert.rejects(inspectArchiveRecovery(job.value,aborted.signal));
  await registry.forget(job.id);assert.equal(await fs.readFile(job.manifest,'utf8'),good,'Forget only removes index');await assert.rejects(registry.read(job.id),{code:'ENOENT'});
  const missing=randomUUID();await registry.register(missing,path.join(root,'absent.zip'),root);assert.equal((await inspectArchiveRecovery(await registry.read(missing))).state,'missing');await registry.clearIfAbsent(missing);await assert.rejects(registry.read(missing),{code:'ENOENT'});
  const broken=randomUUID();await registry.register(broken,path.join(root,'bad.zip'),root);await fs.writeFile(path.join(root,'registry',broken+'.json'),'bad');assert((await registry.list()).items.find(item=>item.id===broken).error);await registry.forget(broken);
  await assert.rejects(registry.read('../outside'));await assert.rejects(registry.read({}));await assert.rejects(registry.list(1));
  const linkRegistry=path.join(root,'linked-registry');await fs.symlink(path.join(root,'registry'),linkRegistry,'junction');await assert.rejects(new ArchiveRecoveryRegistry(linkRegistry).list(),/链接/);
  const fullDirectory=path.join(root,'full-registry');await fs.mkdir(fullDirectory);const fullIds=Array.from({length:1025},()=>randomUUID());
  for(let at=0;at<fullIds.length;at+=32)await Promise.all(fullIds.slice(at,at+32).map(id=>fs.writeFile(path.join(fullDirectory,id+'.json'),'bad')));
  const full=new ArchiveRecoveryRegistry(fullDirectory),fullPage=await full.list();assert.equal(fullPage.items.length,50);assert.equal(fullPage.total,1024);assert.equal(fullPage.truncated,true);await assert.rejects(full.register(randomUUID(),path.join(root,'source.zip'),root),/已满/);await full.forget(fullIds[0]);assert.equal((await full.list()).truncated,false,'Overflow still allows inspecting and removing records');

  const parent=path.join(root,'service'),source=path.join(root,'source.zip'),cache=path.join(root,'profile','archive-cache');await fs.mkdir(parent);await fs.writeFile(path.join(parent,'a.txt'),'service old');const zip=new JSZip();zip.file('a.txt','service new');await fs.writeFile(source,await zip.generateAsync({type:'nodebuffer'}));
  process.env.ONE_TEST_MODE='1';process.env.ONE_ARCHIVE_PUBLISH_CRASH_POINT='published:0';const id=randomUUID();service=new ArchiveService(cache,()=>{});
  await assert.rejects(service.run(1,{operation:'extract',path:source,parent,destination:'here',conflict:'replace'},id),/恢复资料/);await service.stop();service=new ArchiveService(cache,()=>{});
  assert.equal((await service.recoveryPage()).items[0].id,id);assert.equal((await service.inspectRecovery(1,id.toUpperCase())).state,'pending');assert.equal(await fs.readFile(path.join(parent,'.one-recovery-'+id,'0.original'),'utf8'),'service old');
  let inspection=service.inspectRecovery(1,id);service.cancelRecoveryInspection(2,id);assert.equal((await inspection).state,'pending','Other owner cannot cancel');
  inspection=service.inspectRecovery(1,id);service.cancelRecoveryInspection(1,id);await assert.rejects(inspection);
  inspection=service.inspectRecovery(1,id);await assert.rejects(service.forgetRecovery(id),/进行/);service.cancelOwner(1);await assert.rejects(inspection);
  const indexFile=path.join(root,'profile','tasks','archive-recovery',id+'.json'),indexRecord=JSON.parse(await fs.readFile(indexFile,'utf8'));await fs.writeFile(indexFile,JSON.stringify({...indexRecord,ownerPid:process.ppid}));await assert.rejects(service.inspectRecovery(1,id),/仍在运行/);await assert.rejects(service.forgetRecovery(id),/其他实例/);await fs.writeFile(indexFile,JSON.stringify(indexRecord));
  inspection=service.inspectRecovery(1,id);const rejected=assert.rejects(inspection);await service.stop();await rejected;service=new ArchiveService(cache,()=>{});
  await service.forgetRecovery(id);assert.equal((await service.recoveryPage()).total,0);assert.equal(await fs.readFile(path.join(parent,'.one-recovery-'+id,'0.original'),'utf8'),'service old');
  delete process.env.ONE_ARCHIVE_PUBLISH_CRASH_POINT;const success=randomUUID();await service.run(1,{operation:'extract',path:source,parent,destination:'here',conflict:'replace'},success);assert.equal((await service.recoveryPage()).total,0);await service.stop();service=undefined;
  const blocked=path.join(root,'blocked-registry');await fs.writeFile(blocked,'file');service=new ArchiveService(cache,()=>{},undefined,undefined,false,undefined,undefined,path.join(blocked,'registry'));await fs.writeFile(path.join(parent,'a.txt'),'protected');await assert.rejects(service.run(1,{operation:'extract',path:source,parent,destination:'here',conflict:'replace'},randomUUID()));assert.equal(await fs.readFile(path.join(parent,'a.txt'),'utf8'),'protected');
  console.log('Recovery registry and inspection passed: real native crash decisions, persisted service restart, corrupt/forged/truncated/oversized journals, directory replacement and junctions, cancellation, read-only checks, index-only removal and registration failure protection.');
 }finally{if(priorMode===undefined)delete process.env.ONE_TEST_MODE;else process.env.ONE_TEST_MODE=priorMode;if(priorPoint===undefined)delete process.env.ONE_ARCHIVE_PUBLISH_CRASH_POINT;else process.env.ONE_ARCHIVE_PUBLISH_CRASH_POINT=priorPoint;await service?.stop();assert.equal(path.dirname(root),path.resolve('work/temp'));await fs.rm(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1});
