// Persistent version 3 recovery, through the same service used by GUI/CLI.
// Real native crash fixtures, isolated profile, no Explorer or installed data.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {randomUUID,randomBytes,createHash}=require('node:crypto');
const Module=require('node:module');
const {build}=require('esbuild');
const kernel=require('koffi').load('kernel32.dll');
const create=kernel.func('intptr_t __stdcall CreateFileW(str16 path,uint32 access,uint32 share,void *security,uint32 disposition,uint32 flags,intptr_t templateFile)'),info=kernel.func('bool __stdcall GetFileInformationByHandle(intptr_t file,_Out_ uint8_t *information)'),close=kernel.func('bool __stdcall CloseHandle(intptr_t file)');
function stamp(file){const handle=create(file,0x80,7,null,3,0x200000,0);assert(handle!==-1&&handle!==-1n);try{const bytes=Buffer.alloc(52);assert(info(handle,bytes));return[28,44,48,32,36,24,20].map(offset=>bytes.readUInt32LE(offset)).join(':');}finally{close(handle);}}
const table=Array.from({length:256},(_,i)=>{let v=i;for(let bit=0;bit<8;bit++)v=v&1?0xedb88320^(v>>>1):v>>>1;return v>>>0;});
function journal(rows){let crc=0;return rows.map((record,sequence)=>{const prefix=JSON.stringify({sequence,record}).slice(0,-1);let v=crc^0xffffffff;for(const byte of Buffer.from(prefix))v=table[(v^byte)&255]^(v>>>8);crc=(v^0xffffffff)>>>0;return prefix+',"crc32":"'+crc.toString(16).padStart(8,'0')+'"}\n';}).join('');}
async function compile(entry){const result=await build({entryPoints:[entry],bundle:true,platform:'node',format:'cjs',write:false}),filename=path.resolve('dist/main/archive-volume-recovery-test.cjs'),mod=new Module(filename);mod.filename=filename;mod.paths=Module._nodeModulePaths(path.dirname(filename));mod._compile(result.outputFiles[0].text,filename);return mod.exports;}
async function main(){
 await fs.mkdir('work/temp',{recursive:true});const root=await fs.mkdtemp(path.resolve('work/temp/one-volume-recovery-'));let maker,service,serial=0;
 const prior=Object.fromEntries(['ONE_TEST_MODE','ONE_ARCHIVE_RECOVER_CRASH_POINT','TEMP','TMP'].map(key=>[key,process.env[key]]));
 const env={...process.env,TEMP:root,TMP:root,ONE_TEST_MODE:'0'};delete env.ONE_ARCHIVE_VOLUME_CRASH_POINT;delete env.ONE_ARCHIVE_VOLUME_FAIL_POINT;delete env.ONE_ARCHIVE_VOLUME_JOURNAL_FAIL_AT_SEQUENCE;delete env.ONE_ARCHIVE_RECOVER_CRASH_POINT;
 const exists=async file=>{try{await fs.lstat(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
 const fingerprint=async file=>({hash:createHash('sha256').update(await fs.readFile(file)).digest('hex'),stamp:stamp(file)});
 const native=(args,input,status=0,extra={})=>{const run=spawnSync(path.resolve('dist/native/One.Archive.exe'),args,{input,env:{...env,...extra},windowsHide:true,encoding:'utf8',timeout:60000,maxBuffer:4*1024**2});assert.equal(run.status,status,JSON.stringify(run));return run.stdout.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);};
 const secret=password=>{const bytes=Buffer.from(password),header=Buffer.alloc(4);header.writeUInt32LE(bytes.length);return Buffer.concat([header,bytes]);};
 try{
  Object.assign(process.env,{TEMP:root,TMP:root,ONE_TEST_MODE:'0'});delete process.env.ONE_ARCHIVE_RECOVER_CRASH_POINT;
  const {ArchiveRecoveryRegistry,inspectArchiveRecovery}=await compile('src/main/archive-recovery.ts'),{ArchiveService}=await compile('src/main/archive-service.ts'),{ArchiveTasks}=await compile('src/main/archive-tasks.ts'),{archiveEditPacket}=await compile('src/main/archive-update.ts');
  const profile=path.join(root,'profile'),cache=path.join(profile,'archive-cache'),index=path.join(profile,'tasks','archive-recovery'),history=path.join(profile,'tasks','history.json'),registry=new ArchiveRecoveryRegistry(index),events=[],progress=[];
  const open=()=>new ArchiveService(cache,(_owner,value)=>progress.push(value),undefined,(event,detail)=>events.push({event,detail}),false,new ArchiveTasks(history));service=open();maker=new ArchiveService(path.join(root,'maker','cache'),()=>{});
  const input=path.join(root,'original.bin'),added=path.join(root,'added.bin'),small=path.join(root,'small.txt');await fs.writeFile(input,randomBytes(2200*1024));await fs.writeFile(added,randomBytes(2400*1024));await fs.writeFile(small,'small preserved');
  const fixture=async(format='7z',point='published:0',shrink=false,password='')=>{
   const parent=path.join(root,'中文 😀 group '+serial++);await fs.mkdir(parent);const created=await maker.run(1,{operation:'create',path:path.join(parent,'source.'+format),sources:[input],volumeBytes:1024**2,level:0,password});
   const source=created.path,listing=await maker.run(1,{operation:'list',path:source,password}),old={};for(const name of await fs.readdir(parent))old[name]=await fingerprint(path.join(parent,name));
   const id=randomUUID(),stage=path.join(parent,'.one-update-'+randomUUID()),value=await registry.register(id,source,parent,{kind:'volume-update',stage});assert.notEqual(path.basename(stage).slice(12),id);
   const changes=shrink?[{kind:'delete',indexes:[0]},{kind:'add',source:small,name:'small.txt'}]:[{kind:'add',source:added,name:'added.bin'}];
   const staged=native(['update-stage',source,stage,'0',listing.revision],Buffer.concat([secret(password),await archiveEditPacket(changes)])).find(row=>row.type==='result');
   native(['volume-publish',source,staged.path,value.path,'0',listing.revision,staged.revision],Buffer.concat([secret(password),Buffer.from([1])]),77,{ONE_TEST_MODE:'1',ONE_ARCHIVE_VOLUME_CRASH_POINT:point});
   return{id,parent,source,stage,recovery:value.path,value,old,manifest:path.join(value.path,'manifest.jsonl')};
  };
  const original=async job=>{for(const [name,value]of Object.entries(job.old))assert.deepEqual(await fingerprint(path.join(job.parent,name)),value);};
  const restore=job=>service.restoreRecovery(1,job.id),cleanup=job=>service.cleanupRecovery(1,job.id);
  for(const format of ['zip','7z'])for(const point of ['prepared','backup:0','published:0','committed','cleanup:0']){
   const job=await fixture(format,point,point==='published:0',point==='prepared'?' private 密码 ':'');const before=await fs.readFile(job.manifest),rows=before.toString().trimEnd().split('\n').map(line=>JSON.parse(line).record),header=rows[0];
   await service.stop();service=open();const summary=(await service.recoveryPage()).items.find(item=>item.id===job.id);assert.equal(summary.kind,'volume-update');assert.equal(summary.stage,job.stage);assert.equal(summary.active,false);
   assert.deepEqual(await registry.read(job.id.toUpperCase()),job.value);assert.equal(JSON.parse(await fs.readFile(path.join(index,job.id+'.json'),'utf8')).version,2);
   const checked=await service.inspectRecovery(1,job.id.toUpperCase());assert.equal(checked.kind,'volume-update');assert.equal(checked.state,['committed','cleanup:0'].includes(point)?'committed':'pending',JSON.stringify(checked));assert.equal(checked.oldVolumes,header.oldVolumes);assert.equal(checked.newVolumes,header.newVolumes);assert.equal(checked.items,Math.max(header.oldVolumes,header.newVolumes));assert.equal(checked.samples.length,checked.items);assert.deepEqual(await fs.readFile(job.manifest),before,'Inspection never changes the journal');
   if(checked.state==='committed')await assert.rejects(restore(job),/保存已确认完成/);else{await restore(job);await original(job);assert.equal((await restore(job)).count,0,'Restore is repeatable');}
   await cleanup(job);assert(!await exists(job.recovery));assert(!await exists(job.stage));assert(!await exists(path.join(index,job.id+'.json')));if(checked.state!=='committed')await original(job);
  }
  assert(progress.some(value=>value.operation==='recover'));assert(progress.some(value=>value.operation==='cleanup'));assert(!progress.some(value=>value.operation.startsWith('volume-')),'Private native operations never leak into UI/history');
  await service.stop();service=open();assert((await service.taskOverview()).recent.some(task=>task.operation==='cleanup'&&task.state==='completed'),'Persistent recovery task history loads after restart');

  let job=await fixture(),good=await fs.readFile(job.manifest,'utf8'),rows=good.trimEnd().split('\n').map(line=>JSON.parse(line).record);
  const invalid=async change=>{const changed=structuredClone(rows);change(changed);const text=journal(changed);await fs.writeFile(job.manifest,text);const checked=await service.inspectRecovery(1,job.id);assert.equal(checked.state,'invalid',JSON.stringify(checked));await assert.rejects(restore(job));assert.equal(await fs.readFile(job.manifest,'utf8'),text);};
  for(const change of [r=>r[0].version=2,r=>r[0].extra=true,r=>r[0].format=9,r=>r[0].newVolumes=4097,r=>r[0].primary='unrelated.7z.001',r=>r[0].stage=job.recovery,r=>r[0].stageIdentity=r[0].parentIdentity,r=>r[1].target=path.join(root,'outside.7z.001'),r=>r[1].backup=path.join(job.recovery,'1.original'),r=>r[2].sourceStamp=r[1].sourceStamp,r=>r[1].index=2,r=>r.splice(1,1),r=>r.push({type:'unknown'}),r=>r.push({type:'committed',count:r[0].newVolumes,removed:0}),r=>r.splice(1,0,{type:'published',index:0})])await invalid(change);
  await fs.writeFile(job.manifest,good.slice(0,-1));assert.match((await service.inspectRecovery(1,job.id)).message,/截断/);await fs.writeFile(job.manifest,good.replace('"version":3','"version":9'));assert.match((await service.inspectRecovery(1,job.id)).message,/校验/);
  await fs.writeFile(job.manifest,good);const oversized=await fs.open(job.manifest,'r+');await oversized.truncate(64*1024**2+1);await oversized.close();assert.match((await service.inspectRecovery(1,job.id)).message,/上限/);await fs.writeFile(job.manifest,good);
  // Exercise the entire supported 4096-volume plan without retaining a full
  // file listing in the report. Synthetic metadata cannot authorize mutations.
  const header={...rows[0],oldVolumes:4096,newVolumes:4096},names=Array.from({length:4096},(_,index)=>header.primary.slice(0,-3)+String(index+1).padStart(3,'0')).sort();
  const large=[header,...names.map((name,index)=>({type:'item',index,source:path.join(job.stage,name),target:path.join(job.parent,name),backup:path.join(job.recovery,index+'.original'),sourceStamp:`1:0:${10000+index*2}:1:0:0:0`,targetStamp:`1:0:${10001+index*2}:1:0:0:0`})),{type:'prepared',items:4096}];await fs.writeFile(job.manifest,journal(large));
  const report=await service.inspectRecovery(1,job.id);assert.equal(report.state,'pending',JSON.stringify(report));assert.equal(report.items,4096);assert.equal(report.samples.length,30);await assert.rejects(restore(job),'Synthetic plans fail native current-file checks');
  const probe=await fs.open(job.manifest,'r'),prototype=Object.getPrototypeOf(probe),originalStream=prototype.createReadStream;await probe.close();const during=new AbortController();let read=0;
  prototype.createReadStream=function(options){const stream=originalStream.call(this,options);return(async function*(){for await(const bytes of stream){read+=bytes.length;yield bytes;during.abort();}})();};
  try{await assert.rejects(inspectArchiveRecovery(job.value,during.signal));assert(read>0&&read<=64*1024,'Stop during streaming does not read the whole plan');}finally{prototype.createReadStream=originalStream;}
  const reordered=structuredClone(rows);reordered[0]={version:reordered[0].version,...reordered[0]};await fs.writeFile(job.manifest,journal(reordered));assert.equal((await service.inspectRecovery(1,job.id)).state,'invalid','Native record field order is canonical');await fs.writeFile(job.manifest,good);
  let check=service.inspectRecovery(1,job.id);service.cancelRecoveryInspection(2,job.id);assert.equal((await check).state,'pending');check=service.inspectRecovery(1,job.id);const stopped=assert.rejects(check);service.cancelRecoveryInspection(1,job.id);await stopped;
  const controller=new AbortController();controller.abort();await assert.rejects(inspectArchiveRecovery(job.value,controller.signal));
  const indexFile=path.join(index,job.id+'.json'),indexValue=JSON.parse(await fs.readFile(indexFile,'utf8'));await fs.writeFile(indexFile,JSON.stringify({...indexValue,ownerPid:process.ppid}));assert.equal((await service.recoveryPage()).items.find(item=>item.id===job.id).active,true);await assert.rejects(restore(job),/仍在运行/);await assert.rejects(service.forgetRecovery(job.id),/其他实例/);await fs.writeFile(indexFile,JSON.stringify(indexValue));
  await assert.rejects(registry.register(job.id,job.source,job.parent,{kind:'volume-update',stage:job.stage}),{code:'EEXIST'});
  for(const change of [v=>v.kind='extract',v=>v.stage=path.join(root,'.one-update-'+randomUUID()),v=>v.path=path.join(job.parent,'.one-recovery-'+job.id),v=>v.archive=path.join(root,'source.7z.001'),v=>v.extra=true]){const changed=structuredClone(indexValue);change(changed);await fs.writeFile(indexFile,JSON.stringify(changed));await assert.rejects(registry.read(job.id));}await fs.writeFile(indexFile,JSON.stringify(indexValue));
  // Stage identity replacement is rejected even if the journal bytes are intact.
  await fs.rename(job.stage,job.stage+'-original');await fs.mkdir(job.stage);assert.match((await service.inspectRecovery(1,job.id)).message,/身份/);await fs.rmdir(job.stage);await fs.symlink(job.stage+'-original',job.stage,'junction');assert.match((await service.inspectRecovery(1,job.id)).message,/链接/);await fs.unlink(job.stage);await fs.rename(job.stage+'-original',job.stage);
  // Native restore checks current files; read-only inspection is not authority.
  const unknown=path.join(job.stage,'unknown');await fs.writeFile(unknown,'keep');assert.equal((await service.inspectRecovery(1,job.id)).state,'pending');await assert.rejects(restore(job));assert.equal(await fs.readFile(unknown,'utf8'),'keep');await fs.unlink(unknown);await restore(job);await cleanup(job);

  job=await fixture('zip','published:0');process.env.ONE_TEST_MODE='1';process.env.ONE_ARCHIVE_RECOVER_CRASH_POINT='restored:0';await assert.rejects(restore(job));assert(await exists(path.join(index,job.id+'.json')));delete process.env.ONE_ARCHIVE_RECOVER_CRASH_POINT;await service.stop();service=open();await restore(job);await original(job);await cleanup(job);
  job=await fixture('7z','committed');process.env.ONE_ARCHIVE_RECOVER_CRASH_POINT='cleanup:0';await assert.rejects(cleanup(job));assert(await exists(path.join(index,job.id+'.json')));delete process.env.ONE_ARCHIVE_RECOVER_CRASH_POINT;await service.stop();service=open();await cleanup(job);
  job=await fixture('7z','published:0');assert.equal(path.dirname(job.stage),job.parent);assert(job.parent.startsWith(root+path.sep));await fs.rm(job.stage,{recursive:true});assert.equal((await service.inspectRecovery(1,job.id)).state,'pending','Missing stage does not prevent restoring original volumes');await restore(job);await original(job);await cleanup(job);
  // Cooperative cancellation at the service's first progress keeps all copies.
  job=await fixture('7z','published:0');await service.stop();let cancelled=false;service=new ArchiveService(cache,(_owner,value)=>{if(value.id===job.id&&value.operation==='recover'&&!cancelled){cancelled=true;assert.equal(service.cancel(job.id,2),false);assert(service.cancel(job.id,1));}});await assert.rejects(restore(job),error=>error.code==='cancelled');assert(await exists(path.join(index,job.id+'.json')));await service.stop();service=open();await restore(job);await cleanup(job);
  // Loss of a manifest is never permission to delete the independent stage.
  job=await fixture('7z','prepared');await fs.unlink(job.manifest);assert.equal((await service.inspectRecovery(1,job.id)).state,'incomplete');await assert.rejects(cleanup(job),/暂存目录仍存在/);assert(await exists(job.stage));assert(await exists(path.join(index,job.id+'.json')));assert.equal(await registry.clearIfAbsent(job.id),false);await service.forgetRecovery(job.id);assert(await exists(job.stage),'Forgetting only removes the private index');await original(job);
  const missingId=randomUUID(),missingStage=path.join(root,'.one-update-'+randomUUID());await registry.register(missingId,path.join(root,'missing.7z.001'),root,{kind:'volume-update',stage:missingStage});assert.equal((await service.inspectRecovery(1,missingId)).state,'missing');await service.cleanupRecovery(1,missingId);assert(!await exists(path.join(index,missingId+'.json')));
  const legacyId=randomUUID();await registry.register(legacyId,path.join(root,'legacy.zip'),root);assert.equal(JSON.parse(await fs.readFile(path.join(index,legacyId+'.json'),'utf8')).version,1);assert.equal((await service.inspectRecovery(1,legacyId)).kind,'extract');await service.cleanupRecovery(1,legacyId);
  await assert.rejects(service.run(1,{operation:'volume-recover',path:job.source,record:job.value}),/请求无效/);assert(events.some(value=>value.event==='archive-recovery-restored'&&JSON.parse(value.detail).kind==='volume-update'));
  console.log('Persistent split recovery passed: ZIP/7Z crash phases, versioned registry, restart/restore/cleanup/history, strict bounded read-only inspection, forged plans, identity changes, cancellation, missing-manifest stage preservation and legacy records.');
 }finally{
  await service?.stop();await maker?.stop();for(const [key,value]of Object.entries(prior))if(value===undefined)delete process.env[key];else process.env[key]=value;
  assert.equal(path.dirname(root),path.resolve('work/temp'));await fs.rm(root,{recursive:true,force:true});
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
