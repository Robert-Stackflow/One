// Restart recovery uses real staged/published split archives and abrupt native
// exits. Fixtures never use the installed profile or open Explorer.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {spawn,spawnSync}=require('node:child_process');
const {randomBytes,randomUUID,createHash}=require('node:crypto');
const Module=require('node:module');
const {build}=require('esbuild');
const kernel=require('koffi').load('kernel32.dll');
const create=kernel.func('intptr_t __stdcall CreateFileW(str16 path,uint32 access,uint32 share,void *security,uint32 disposition,uint32 flags,intptr_t templateFile)'),info=kernel.func('bool __stdcall GetFileInformationByHandle(intptr_t file,_Out_ uint8_t *information)'),close=kernel.func('bool __stdcall CloseHandle(intptr_t file)');
function stamp(file){const handle=create(file,0x80,7,null,3,0x200000,0);assert(handle!==-1&&handle!==-1n);try{const bytes=Buffer.alloc(52);assert(info(handle,bytes));assert(!(bytes.readUInt32LE(0)&0x410));return[28,44,48,32,36,24,20].map(offset=>bytes.readUInt32LE(offset)).join(':');}finally{close(handle);}}
const helper=path.resolve('dist/native/One.Archive.exe');
const secret=password=>{const bytes=Buffer.from(password),header=Buffer.alloc(4);header.writeUInt32LE(bytes.length);return Buffer.concat([header,bytes]);};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const table=Array.from({length:256},(_,i)=>{let v=i;for(let bit=0;bit<8;bit++)v=v&1?0xedb88320^(v>>>1):v>>>1;return v>>>0;});
function crc32(previous,text){let v=previous^0xffffffff;for(const byte of Buffer.from(text))v=table[(v^byte)&255]^(v>>>8);return(v^0xffffffff)>>>0;}
async function compile(entry){const result=await build({entryPoints:[entry],bundle:true,platform:'node',format:'cjs',write:false}),filename=path.resolve('dist/main/archive-volume-recover-test.cjs'),mod=new Module(filename);mod.filename=filename;mod.paths=Module._nodeModulePaths(path.dirname(filename));mod._compile(result.outputFiles[0].text,filename);return mod.exports;}
async function main(){
 await fs.mkdir('work/temp',{recursive:true});const root=await fs.mkdtemp(path.resolve('work/temp/one-volume-recover-'));let service,serial=0;const live=new Set();
 const env={...process.env,TEMP:root,TMP:root,ONE_TEST_MODE:'0'};
 const exists=async file=>{try{await fs.lstat(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
 const fingerprint=async file=>({hash:hash(await fs.readFile(file)),stamp:stamp(file)});
 const native=(args,input,status=0,extra={})=>{const result=spawnSync(helper,args,{input,env:{...env,...extra},windowsHide:true,encoding:'utf8',timeout:60000,maxBuffer:4*1024**2});assert([status].flat().includes(result.status),JSON.stringify(result));return result.stdout.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);};
 const action=(mode,job,status=0,extra={},ack=1)=>native([mode,job.parent,job.recovery],Buffer.concat([secret(''),Buffer.from([ack])]),status,extra);
 const log=async job=>(await fs.readFile(path.join(job.recovery,'manifest.jsonl'),'utf8')).trimEnd().split('\n').map(line=>JSON.parse(line).record);
 const rewrite=async(job,records)=>{let crc=0;await fs.writeFile(path.join(job.recovery,'manifest.jsonl'),records.map((record,sequence)=>{const prefix=JSON.stringify({sequence,record}).slice(0,-1);crc=crc32(crc,prefix);return prefix+',"crc32":"'+crc.toString(16).padStart(8,'0')+'"}\n';}).join(''));};
 const pending=async(mode,job)=>{
  const child=spawn(helper,[mode,job.parent,job.recovery],{env,windowsHide:true,stdio:'pipe'});live.add(child);let output='',timer,resolveReady,rejectReady;
  const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});ready.catch(()=>{});
  const result=new Promise((resolve,reject)=>{timer=setTimeout(()=>{child.kill();reject(Error('volume recovery timeout'));},30000);child.on('error',reject);child.stdin.on('error',()=>{});
   child.stdout.on('data',data=>{output+=data;if(output.includes('"type":"ready"'))resolveReady();});child.on('close',(code,signal)=>{clearTimeout(timer);live.delete(child);rejectReady(Error(output));resolve({code,signal,messages:output.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse)});});});result.catch(()=>{});child.stdin.write(secret(''));await ready;return{child,result};
 };
 try{
  const {ArchiveService}=await compile('src/main/archive-service.ts'),{archiveEditPacket}=await compile('src/main/archive-update.ts');service=new ArchiveService(path.join(root,'cache'),()=>{});const run=request=>service.run(1,request);
  const input=path.join(root,'keep.bin'),grow=path.join(root,'grow.bin'),small=path.join(root,'small.txt');await fs.writeFile(input,randomBytes(3*1024**2));await fs.writeFile(grow,randomBytes(4*1024**2));await fs.writeFile(small,'small preserved');
  const fixture=async(format='7z',kind='grow',point='published:0',password='',extra={})=>{
   const parent=path.join(root,'中文 group '+serial++);await fs.mkdir(parent);const target=path.join(parent,'source.'+format),created=await run({operation:'create',path:target,sources:[kind==='single'?small:input],volumeBytes:1024**2,level:0,password});
   const source=created.path,listing=await run({operation:'list',path:source,password}),old={};for(const name of await fs.readdir(parent))old[name]=await fingerprint(path.join(parent,name));
   const stage=path.join(parent,'.one-update-'+randomUUID()),recovery=path.join(parent,'.one-volume-recovery-'+randomUUID());
   const changes=kind==='shrink'?[{kind:'delete',indexes:[0]},{kind:'add',source:small,name:'small.txt'}]:kind==='empty'?[{kind:'delete',indexes:[0]}]:[{kind:'add',source:grow,name:'added.bin'}];
   const staged=native(['update-stage',source,stage,'0',listing.revision],Buffer.concat([secret(password),await archiveEditPacket(changes)])).find(value=>value.type==='result');
   const next={};for(const name of await fs.readdir(stage))next[name]=await fingerprint(path.join(stage,name));
   const names=[...new Set([...Object.keys(old),...Object.keys(next)])].sort((a,b)=>a.toLowerCase()<b.toLowerCase()?-1:1);
   const lastName=names.filter(name=>point.startsWith('published:')?next[name]:old[name]).at(-1);point=point.replace(':last',':'+names.indexOf(lastName));
   if(extra.ONE_ARCHIVE_VOLUME_JOURNAL_FAIL_AT_SEQUENCE==='commit')extra={...extra,ONE_ARCHIVE_VOLUME_JOURNAL_FAIL_AT_SEQUENCE:String(names.length+2+Object.keys(old).length+Object.keys(next).length)};
   native(['volume-publish',source,staged.path,recovery,'0',listing.revision,staged.revision],Buffer.concat([secret(password),Buffer.from([1])]),extra.ONE_ARCHIVE_VOLUME_FAIL_POINT||extra.ONE_ARCHIVE_VOLUME_JOURNAL_FAIL_AT_SEQUENCE?2:77,{ONE_TEST_MODE:'1',ONE_ARCHIVE_VOLUME_CRASH_POINT:point,...extra});
   return{format,kind,parent,source,stage,recovery,old,next,password};
  };
  const original=async job=>{for(const [name,value]of Object.entries(job.old))assert.deepEqual(await fingerprint(path.join(job.parent,name)),value);for(const name of Object.keys(job.next))if(!job.old[name])assert(!await exists(path.join(job.parent,name)));};
  const published=async job=>{for(const [name,value]of Object.entries(job.next))assert.deepEqual(await fingerprint(path.join(job.parent,name)),value);for(const name of Object.keys(job.old))if(!job.next[name])assert(!await exists(path.join(job.parent,name)));};
  const preservedNew=async job=>{const items=(await log(job)).filter(row=>row.type==='item');for(const item of items)if(item.sourceStamp){const index=items.indexOf(item),places=[item.source,item.target,path.join(job.recovery,index+'.displaced')];let found=0;for(const file of places)if(await exists(file)&&stamp(file)===item.sourceStamp){found++;assert.deepEqual(await fingerprint(file),job.next[path.basename(item.target)]);}assert.equal(found,1,'new copy preserved exactly once');}};
  const snapshot=async job=>{const result={};for(const dir of [job.parent,job.stage,job.recovery])if(await exists(dir))for(const name of await fs.readdir(dir)){const file=path.join(dir,name);if((await fs.lstat(file)).isFile())result[file]=await fingerprint(file);}return result;};
  // Every interrupted publication phase, including removed old tails and both
  // encrypted formats, restores the original identities without discarding new data.
  for(const format of ['zip','7z'])for(const kind of ['grow','shrink','empty'])for(const point of ['prepared','backup:0','backup:last','published:0','published:last']){
   const job=await fixture(format,kind,point,kind==='shrink'?'recover secret':'');const before=await fs.readFile(path.join(job.recovery,'manifest.jsonl'));
   action('volume-recover',job);await original(job);await preservedNew(job);assert.deepEqual(await fs.readFile(path.join(job.recovery,'manifest.jsonl')),before);
   const repeated=action('volume-recover',job).find(row=>row.type==='result');assert.equal(repeated.count,0);assert.equal(repeated.displaced,0);
   action('volume-cleanup',job);assert(!await exists(job.stage));assert(!await exists(job.recovery));await original(job);action('volume-cleanup',job);
  }
  for(const format of ['zip','7z'])for(const point of ['committed','cleanup:0','cleanup:last']){
   const job=await fixture(format,'shrink',point,'committed secret'),before=await snapshot(job);action('volume-recover',job,2);assert.deepEqual(await snapshot(job),before);
   action('volume-cleanup',job);await published(job);assert(!await exists(job.stage));assert(!await exists(job.recovery));native(['test',job.source,'0'],secret(job.password));
  }
  let job=await fixture('7z','single');action('volume-recover',job);await original(job);action('volume-cleanup',job);
  // A complete commit record survives simulated flush uncertainty. It forbids
  // rollback; a missing commit append instead leaves a recoverable old group.
  job=await fixture('7z','shrink','committed','',{ONE_ARCHIVE_VOLUME_FAIL_POINT:'commit-flush'});action('volume-recover',job,2);action('volume-cleanup',job);await published(job);
  // Header + union items + prepared + old backups + new publications precede
  // the commit append; the actual volume counts determine its sequence.
  job=await fixture('7z','shrink','committed','',{ONE_ARCHIVE_VOLUME_JOURNAL_FAIL_AT_SEQUENCE:'commit'});action('volume-recover',job);await original(job);action('volume-cleanup',job);
  // Recovery itself may exit after any individual move. Retry does not depend
  // on a second mutable journal and completes from actual file identities.
  for(const format of ['zip','7z'])for(const phase of ['displaced','restored']){
   job=await fixture(format,'grow','published:last');const items=(await log(job)).filter(row=>row.type==='item'),indexes=items.map((row,i)=>({row,i})).filter(({row})=>phase==='displaced'?row.sourceStamp:row.targetStamp).map(({i})=>i);
   for(const index of indexes)action('volume-recover',job,77,{ONE_TEST_MODE:'1',ONE_ARCHIVE_RECOVER_CRASH_POINT:phase+':'+index});
   action('volume-recover',job);await original(job);await preservedNew(job);action('volume-cleanup',job);
  }
  // Cleanup retries after each discarded copy, stage removal, manifest removal
  // and directory removal; unrelated original files are never removed.
  for(const committed of [false,true])for(const point of ['cleanup:0','cleanup-stage-directory','cleanup-manifest','cleanup-directory']){
   job=await fixture('7z','grow',committed?'committed':'published:last');if(!committed)action('volume-recover',job);
   action('volume-cleanup',job,77,{ONE_TEST_MODE:'1',ONE_ARCHIVE_RECOVER_CRASH_POINT:point});action('volume-cleanup',job);
   if(committed)await published(job);else await original(job);assert(!await exists(job.stage));assert(!await exists(job.recovery));
  }
  job=await fixture('zip','grow','prepared');action('volume-recover',job);action('volume-cleanup',job,77,{ONE_TEST_MODE:'1',ONE_ARCHIVE_RECOVER_CRASH_POINT:'cleanup-stage:0'});action('volume-cleanup',job);await original(job);
  // A still-pending family cannot be cleaned as though it had been restored.
  job=await fixture();let before=await snapshot(job);action('volume-cleanup',job,2);assert.deepEqual(await snapshot(job),before);
  for(const scenario of ['changed-target','missing-target','unknown-tail','unknown-stage','unknown-recovery']){
   job=await fixture('zip','shrink','committed');const first=(await log(job)).find(row=>row.type==='item'&&row.sourceStamp);
   if(scenario==='changed-target')await fs.writeFile(first.target,'changed');if(scenario==='missing-target')await fs.unlink(first.target);
   if(scenario==='unknown-tail')await fs.writeFile(path.join(job.parent,'source.z4097'),'keep');if(scenario==='unknown-stage')await fs.writeFile(path.join(job.stage,'foreign'),'keep');if(scenario==='unknown-recovery')await fs.writeFile(path.join(job.recovery,'foreign'),'keep');
   before=await snapshot(job);action('volume-cleanup',job,2);assert.deepEqual(await snapshot(job),before,scenario);
  }
  // Strict CRC/canonical payload/scope/member/order checks, with correctly
  // re-chained malicious plans too: CRC alone never grants ownership.
  for(const scenario of ['crc','truncated','incomplete','version','kind','parent','stage','identity','primary','count','index','source','target','backup','stamp','alias','unknown-field','duplicate','publication-order','fake-commit','rollback-after-commit']){
   job=await fixture('7z','shrink',scenario==='rollback-after-commit'?'committed':'prepared');const rows=await log(job),header=rows[0],items=rows.filter(row=>row.type==='item');
   if(scenario==='crc'){const file=path.join(job.recovery,'manifest.jsonl');await fs.writeFile(file,(await fs.readFile(file,'utf8')).replace('volume-update','volume-updatf'));}
   else if(scenario==='truncated'){const file=path.join(job.recovery,'manifest.jsonl'),bytes=await fs.readFile(file);await fs.writeFile(file,bytes.subarray(0,-2));}
   else{
    if(scenario==='incomplete')rows.pop();if(scenario==='version')header.version=2;if(scenario==='kind')header.kind='extract';if(scenario==='parent')header.parent=root;
    if(scenario==='stage')header.stage=path.join(job.parent,'foreign');if(scenario==='identity')header.parentIdentity='0:0:0';if(scenario==='primary')header.primary='../source.7z.001';if(scenario==='count')header.newVolumes++;
    if(scenario==='index')items[0].index++;if(scenario==='source')items[0].source=path.join(root,'foreign');if(scenario==='target')items[0].target=path.join(root,'foreign');if(scenario==='backup')items[0].backup=path.join(root,'foreign');
    if(scenario==='stamp')items[0].sourceStamp='1:2:3';if(scenario==='alias')items[0].sourceStamp=items[0].targetStamp;if(scenario==='unknown-field')items[0].extra='no';
    if(scenario==='duplicate')rows.splice(2,0,items[0]);if(scenario==='publication-order')rows.push({type:'published',index:0});if(scenario==='fake-commit')rows.push({type:'committed',count:header.newVolumes,removed:header.oldVolumes-header.newVolumes});if(scenario==='rollback-after-commit')rows.push({type:'rollback-started'});
    await rewrite(job,rows);
   }
   before=await snapshot(job);action('volume-recover',job,2);action('volume-cleanup',job,2);assert.deepEqual(await snapshot(job),before,scenario);
  }
  for(const scenario of ['changed-target','changed-backup','missing-original','hardlink','unknown-recovery','unknown-stage','unknown-tail','stage-replaced','recovery-replaced','junction']){
   job=await fixture('7z','grow','published:0');const items=(await log(job)).filter(row=>row.type==='item'),first=items[0];
   if(scenario==='changed-target')await fs.writeFile(first.target,'changed');if(scenario==='changed-backup')await fs.writeFile(first.backup,'changed');if(scenario==='missing-original')await fs.unlink(first.backup);
   if(scenario==='hardlink')await fs.link(first.backup,path.join(root,'alias-'+randomUUID()));if(scenario==='unknown-recovery')await fs.writeFile(path.join(job.recovery,'foreign'),'keep');if(scenario==='unknown-stage')await fs.writeFile(path.join(job.stage,'foreign'),'keep');if(scenario==='unknown-tail')await fs.writeFile(job.source.slice(0,-3)+'4097','keep');
   if(scenario==='stage-replaced'||scenario==='recovery-replaced'){const dir=scenario==='stage-replaced'?job.stage:job.recovery;await fs.rename(dir,dir+'.old');await fs.mkdir(dir);for(const name of await fs.readdir(dir+'.old'))await fs.rename(path.join(dir+'.old',name),path.join(dir,name));}
   if(scenario==='junction'){await fs.rename(job.stage,job.stage+'.old');await fs.symlink(job.stage+'.old',job.stage,'junction');}
   before=await snapshot(job);action('volume-recover',job,2);action('volume-cleanup',job,2);assert.deepEqual(await snapshot(job),before,scenario);
   if(scenario==='junction')await fs.rmdir(job.stage);
  }
  // The original group is recoverable even if unpublished new stage data was
  // separately lost. Recovery never requires reconstructing missing new data.
  job=await fixture('7z','grow','published:0');for(const name of await fs.readdir(job.stage))await fs.unlink(path.join(job.stage,name));await fs.rmdir(job.stage);action('volume-recover',job);await original(job);action('volume-cleanup',job);
  for(const mode of ['volume-recover','volume-cleanup']){
   job=await fixture('zip','grow',mode==='volume-cleanup'?'committed':'published:0');before=await snapshot(job);
   action(mode,job,[0,2],{},2);assert.deepEqual(await snapshot(job),before);
   let waiting=await pending(mode,job);await assert.rejects(fs.writeFile(path.join(job.recovery,'manifest.jsonl'),'tamper'));
   for(const item of (await log(job)).filter(row=>row.type==='item'))for(const file of [item.target,item.backup,item.source])if(file&&await exists(file))await assert.rejects(fs.writeFile(file,'tamper'));
   action(mode,job,2);waiting.child.stdin.end(Buffer.from([2]));assert.equal((await waiting.result).code,2);assert.deepEqual(await snapshot(job),before);
   // CreateHardLink is possible despite sharing locks. The complete plan is
   // rechecked after confirmation, before moving/deleting its first file.
   waiting=await pending(mode,job);const victim=(await log(job)).find(row=>row.type==='item'&&row.targetStamp).backup;
   await fs.link(victim,path.join(root,'late-alias-'+randomUUID()));waiting.child.stdin.end(Buffer.from([1]));assert.equal((await waiting.result).code,2);assert.deepEqual(await snapshot(job),before);
   // A queued stop after ACK is honored before the first mutation.
   job=await fixture('7z','grow',mode==='volume-cleanup'?'committed':'published:0');before=await snapshot(job);waiting=await pending(mode,job);waiting.child.stdin.end(Buffer.from([1,2]));assert.equal((await waiting.result).code,2);assert.deepEqual(await snapshot(job),before);
   job=await fixture('7z','grow',mode==='volume-cleanup'?'committed':'published:0');waiting=await pending(mode,job);await fs.writeFile(path.join(job.recovery,'late-foreign'),'keep');before=await snapshot(job);waiting.child.stdin.end(Buffer.from([1]));assert.equal((await waiting.result).code,2);assert.deepEqual(await snapshot(job),before);
  }
  // Unknown content blocks even the manifest-free final directory step.
  job=await fixture('7z','shrink','committed');action('volume-cleanup',job,77,{ONE_TEST_MODE:'1',ONE_ARCHIVE_RECOVER_CRASH_POINT:'cleanup-manifest'});await fs.writeFile(path.join(job.recovery,'foreign'),'keep');action('volume-cleanup',job,2);assert.equal(await fs.readFile(path.join(job.recovery,'foreign'),'utf8'),'keep');
  await assert.rejects(run({operation:'volume-recover',path:'fake'}),/请求无效/);await assert.rejects(run({operation:'volume-cleanup',path:'fake'}),/请求无效/);
  console.log('Volume restart recovery passed: ZIP/7Z encrypted grow/shrink/empty, original identities and new copies preserved, every publication/move/cleanup crash retry, committed decision guards, canonical CRC plans, no-overwrite/link/scope/unknown-content protection, exclusive handles and confirmation cancellation. Public GUI/CLI integration remains separate.');
 }finally{
  for(const child of live){const closed=new Promise(resolve=>child.once('close',resolve));child.kill();await closed;}
  await service?.stop();assert.equal(path.dirname(root),path.resolve('work/temp'));await fs.rm(root,{recursive:true,force:true});
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
