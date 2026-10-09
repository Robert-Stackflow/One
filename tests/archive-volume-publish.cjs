// Private native group publication, not a claim that public split editing or
// restart restore is connected. All originals and failures are isolated here.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {spawn,spawnSync}=require('node:child_process');
const {randomBytes,randomUUID,createHash}=require('node:crypto');
const Module=require('node:module');
const {build}=require('esbuild');
const kernel=require('koffi').load('kernel32.dll');
const create=kernel.func('intptr_t __stdcall CreateFileW(str16 path,uint32 access,uint32 share,void *security,uint32 disposition,uint32 flags,intptr_t templateFile)'),info=kernel.func('bool __stdcall GetFileInformationByHandle(intptr_t file,_Out_ uint8_t *information)'),close=kernel.func('bool __stdcall CloseHandle(intptr_t file)');
function nativeStamp(file){const handle=create(file,0x80,7,null,3,0x200000,0);assert(handle!==-1&&handle!==-1n);try{const bytes=Buffer.alloc(52);assert(info(handle,bytes));assert(!(bytes.readUInt32LE(0)&0x410));return[28,44,48,32,36,24,20].map(offset=>bytes.readUInt32LE(offset)).join(':');}finally{close(handle);}}
const helper=path.resolve('dist/native/One.Archive.exe');
const secret=password=>{const bytes=Buffer.from(password),header=Buffer.alloc(4);header.writeUInt32LE(bytes.length);return Buffer.concat([header,bytes]);};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const table=Array.from({length:256},(_,i)=>{let v=i;for(let bit=0;bit<8;bit++)v=v&1?0xedb88320^(v>>>1):v>>>1;return v>>>0;});
function crc32(previous,text){let v=previous^0xffffffff;for(const byte of Buffer.from(text))v=table[(v^byte)&255]^(v>>>8);return(v^0xffffffff)>>>0;}
async function compile(entry){const result=await build({entryPoints:[entry],bundle:true,platform:'node',format:'cjs',write:false}),filename=path.resolve('dist/main/archive-volume-publish-test.cjs'),mod=new Module(filename);mod.filename=filename;mod.paths=Module._nodeModulePaths(path.dirname(filename));mod._compile(result.outputFiles[0].text,filename);return mod.exports;}
async function records(directory){let crc=0;const text=await fs.readFile(path.join(directory,'manifest.jsonl'),'utf8');assert(text.endsWith('\n'));return text.trimEnd().split('\n').map((line,i)=>{const value=JSON.parse(line),end=line.lastIndexOf(',"crc32":');assert.equal(value.sequence,i);crc=crc32(crc,line.slice(0,end));assert.equal(value.crc32,crc.toString(16).padStart(8,'0'));return value.record;});}
async function main(){
 await fs.mkdir('work/temp',{recursive:true});const root=await fs.mkdtemp(path.resolve('work/temp/one-volume-publish-'));let service,serial=0;const live=new Set();
 const env={...process.env,TEMP:root,TMP:root,ONE_TEST_MODE:'0'};
 const exists=async file=>{try{await fs.lstat(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
 const fingerprint=async file=>({hash:hash(await fs.readFile(file)),ino:(await fs.stat(file,{bigint:true})).ino,stamp:nativeStamp(file)});
 const native=(args,input,status=0,extra={})=>{const result=spawnSync(helper,args,{input,env:{...env,...extra},windowsHide:true,encoding:'utf8',timeout:60000,maxBuffer:4*1024**2});assert([status].flat().includes(result.status),JSON.stringify(result));return result.stdout.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);};
 const publishArgs=job=>['volume-publish',job.source,job.primary,job.recovery,'0',job.oldRevision,job.newRevision];
 const publish=(job,status=0,extra={},ack=1)=>native(publishArgs(job),Buffer.concat([secret(job.password),Buffer.from([ack].flat())]),status,extra);
 const seven=(args)=>{const result=spawnSync('7z',args,{env,windowsHide:true,encoding:'utf8',timeout:60000,maxBuffer:4*1024**2});assert.equal(result.status,0,result.stdout+'\n'+result.stderr);};
 const pending=async job=>{
  const child=spawn(helper,publishArgs(job),{env,windowsHide:true,stdio:'pipe'});live.add(child);let output='',timer,readyResolve,readyReject;
  const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});ready.catch(()=>{});
  const result=new Promise((resolve,reject)=>{timer=setTimeout(()=>{child.kill();reject(Error('volume publisher timeout'));},30000);child.on('error',reject);child.stdin.on('error',()=>{});
   child.stdout.on('data',data=>{output+=data;if(output.includes('"type":"ready"'))readyResolve();});child.on('close',(code,signal)=>{clearTimeout(timer);live.delete(child);readyReject(Error(output));resolve({code,signal,messages:output.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse)});});});result.catch(()=>{});child.stdin.write(secret(job.password));await ready;return{child,result};
 };
 try{
  const {ArchiveService}=await compile('src/main/archive-service.ts'),{archiveEditPacket}=await compile('src/main/archive-update.ts');service=new ArchiveService(path.join(root,'cache'),()=>{});const run=request=>service.run(1,request);
  const input=path.join(root,'keep.bin'),grow=path.join(root,'grow.bin'),small=path.join(root,'small.txt');await fs.writeFile(input,randomBytes(3*1024**2));await fs.writeFile(grow,randomBytes(4*1024**2));await fs.writeFile(small,'small preserved');
  const fixture=async(format='7z',kind='grow',password='',passwordEncoding=65001)=>{
   const parent=path.join(root,'中文 group '+serial++);await fs.mkdir(parent);const target=path.join(parent,'source.'+format),created=await run({operation:'create',path:target,sources:[kind==='single'?small:input],volumeBytes:1024**2,level:0,password,passwordEncoding});
   const source=created.path,listing=await run({operation:'list',path:source,password,passwordEncoding}),oldNames=await fs.readdir(parent),old={};for(const name of oldNames)old[name]=await fingerprint(path.join(parent,name));
   const stage=path.join(parent,'.one-update-'+randomUUID()),recovery=path.join(parent,'.one-volume-recovery-'+randomUUID());
   const changes=kind==='shrink'?[{kind:'delete',indexes:[0]},{kind:'add',source:small,name:'small.txt'}]:kind==='empty'?[{kind:'delete',indexes:[0]}]:[{kind:'add',source:grow,name:'added.bin'}];
   const extra={ONE_ARCHIVE_PASSWORD_ENCODING:String(passwordEncoding)};
   const staged=native(['update-stage',source,stage,'0',listing.revision],Buffer.concat([secret(password),await archiveEditPacket(changes)]),0,extra).find(value=>value.type==='result');
   assert(staged.staged);const next={};for(const name of await fs.readdir(stage))next[name]=await fingerprint(path.join(stage,name));
   return{format,kind,parent,source,primary:staged.path,stage,recovery,oldRevision:listing.revision,newRevision:staged.revision,old,next,password,extra};
  };
  const original=async job=>{for(const [name,info]of Object.entries(job.old))assert.deepEqual(await fingerprint(path.join(job.parent,name)),info,'old volume identity/content preserved');};
  const staged=async job=>{for(const [name,info]of Object.entries(job.next))assert.deepEqual(await fingerprint(path.join(job.stage,name)),info,'new volume returned to staging');};
  const published=async job=>{for(const [name,info]of Object.entries(job.next))assert.deepEqual(await fingerprint(path.join(job.parent,name)),info,'published verified volume');for(const name of Object.keys(job.old))if(!job.next[name])assert(!await exists(path.join(job.parent,name)),'obsolete old tail absent');};
  // Real grow, shrink, empty and one-part .7z.001 transitions. External 7-Zip
  // independently reads the final family; no Explorer is opened by these tests.
  for(const format of ['zip','7z'])for(const kind of ['grow','shrink','empty'])for(const password of ['','publish secret']){
   const job=await fixture(format,kind,password),rows=publish(job),result=rows.find(row=>row.type==='result');assert(result.committed&&!result.cleanupPending);assert.equal(result.volumes,Object.keys(job.next).length);assert.equal(result.removedVolumes,Object.keys(job.old).filter(name=>!job.next[name]).length);
   await published(job);assert(!await exists(job.stage));assert(!await exists(job.recovery));native(['test',job.source,'0'],secret(password));seven(['t',job.source,...(password?['-p'+password]:[])]);
   const final=await run({operation:'list',path:job.source,password});assert.equal(final.total,kind==='grow'?2:kind==='shrink'?1:0);
   if(kind!=='empty'){const out=await run({operation:'extract',path:job.source,parent:root,password});assert.deepEqual(await fs.readFile(path.join(out.path,kind==='grow'?'added.bin':'small.txt')),await fs.readFile(kind==='grow'?grow:small));}
  }
  let job=await fixture('7z','single');assert.equal(Object.keys(job.old).length,1);assert(Object.keys(job.next).length>1);publish(job);await published(job);seven(['t',job.source]);
  const singletonStage=path.join(job.parent,'.one-update-'+randomUUID()),singletonList=await run({operation:'list',path:job.source}),singleResult=native(['update-stage',job.source,singletonStage,'0',singletonList.revision],Buffer.concat([secret(''),await archiveEditPacket([{kind:'delete',indexes:[singletonList.entries.find(row=>row.name==='added.bin').index]}])])).find(row=>row.type==='result');assert.equal(singleResult.volumes,1);const recovered=path.join(job.parent,'.one-volume-recovery-'+randomUUID());native(['volume-publish',job.source,singleResult.path,recovered,'0',singletonList.revision,singleResult.revision],Buffer.concat([secret(''),Buffer.from([1])]));seven(['t',job.source]);assert.equal((await run({operation:'list',path:job.source})).total,1);
  job=await fixture('zip','grow','中文密码',936);const encoded=publish(job,0,job.extra).find(row=>row.type==='result');assert(encoded.committed);await run({operation:'test',path:job.source,password:job.password,passwordEncoding:936});
  // No ACK, negative ACK and normal exceptions restore all originals AND the
  // prepared family by identity. Removed tails are not discarded on rollback.
  for(const format of ['zip','7z'])for(const point of ['prepared','backup:0','published:0','commit']){
   job=await fixture(format,point==='backup:0'?'shrink':'grow');const messages=publish(job,2,{ONE_TEST_MODE:'1',ONE_ARCHIVE_VOLUME_FAIL_POINT:point});try{await original(job);await staged(job);assert(!await exists(job.recovery));}catch(error){throw new Error(`Rollback failed (${format}, ${point}): ${JSON.stringify(messages)}`,{cause:error});}
  }
  // An early queued cancel can arrive during read-only planning or at ACK;
  // both paths must report cancellation and preserve every original/staged file.
  job=await fixture();assert(publish(job,[0,2],{},2).some(row=>row.cancelled||row.type==='error'&&row.code==='cancelled'));await original(job);await staged(job);assert(!await exists(job.recovery));
  job=await fixture();assert(native(publishArgs(job),secret('')).some(row=>row.cancelled));await original(job);await staged(job);
  // Persisted complete plan and both generations survive abrupt exits. Progress
  // records may be buffered; infer positions using the durable identities.
  for(const format of ['zip','7z'])for(const point of ['prepared','backup:0','backup:last','published:0','published:1','published:last','committed','cleanup:0','cleanup:last']){
   job=await fixture(format,point==='published:1'||point==='published:last'?'grow':'shrink');const actualPoint=point.replace(':last',':'+(new Set([...Object.keys(job.old),...Object.keys(job.next)]).size-1));publish(job,77,{ONE_TEST_MODE:'1',ONE_ARCHIVE_VOLUME_CRASH_POINT:actualPoint});const log=await records(job.recovery),header=log[0],items=log.filter(row=>row.type==='item');
   assert.equal(header.version,3);assert.equal(header.kind,'volume-update');assert.equal(header.parent,job.parent);assert.equal(header.stage,job.stage);assert.equal(header.recovery,job.recovery);assert.equal(header.oldVolumes,Object.keys(job.old).length);assert.equal(header.newVolumes,Object.keys(job.next).length);
   for(const key of ['parentIdentity','stageIdentity','recoveryIdentity'])assert.match(header[key],/^\d+:\d+:\d+$/);
   assert.equal(items.length,new Set([...Object.keys(job.old),...Object.keys(job.next)]).size);assert(log.some(row=>row.type==='prepared'&&row.items===items.length));if(job.kind==='shrink')assert(items.some(row=>!row.source&&row.targetStamp&&!row.sourceStamp),'old-only tails explicitly journaled');
   for(const [i,item]of items.entries()){
    assert.equal(item.index,i);assert.equal(item.backup,path.join(job.recovery,i+'.original'));const name=path.basename(item.target);assert.equal(item.target,path.join(job.parent,name));
    if(job.old[name]){assert.equal(item.targetStamp,job.old[name].stamp);const candidate=await exists(item.backup)?item.backup:item.target;const deleted=actualPoint.startsWith('cleanup:')&&i<=Number(actualPoint.split(':')[1]);if(!deleted)assert.deepEqual(await fingerprint(candidate),job.old[name]);}
    if(job.next[name]){assert.equal(item.sourceStamp,job.next[name].stamp);assert.equal(item.source,path.join(job.stage,name));assert.deepEqual(await fingerprint(await exists(item.source)?item.source:item.target),job.next[name]);}
   }
   if(point==='prepared')await original(job);
   if(point==='committed'||point.startsWith('cleanup:')){assert.deepEqual(log.at(-1),{type:'committed',count:header.newVolumes,removed:Object.keys(job.old).filter(name=>!job.next[name]).length});await published(job);seven(['t',job.source]);}
   else assert(!log.some(row=>row.type==='committed'));
  }
  // Journal failure during the commit decision preserves both generations and
  // never deletes backups. The caller must inspect/recover instead of retrying.
  job=await fixture();const union=new Set([...Object.keys(job.old),...Object.keys(job.next)]).size,commitSequence=union+2+Object.keys(job.old).length+Object.keys(job.next).length;
  assert(publish(job,2,{ONE_TEST_MODE:'1',ONE_ARCHIVE_VOLUME_JOURNAL_FAIL_AT_SEQUENCE:String(commitSequence)}).some(row=>row.type==='error'&&row.code==='recovery'));await published(job);const uncertain=await records(job.recovery);assert(!uncertain.some(row=>row.type==='committed'));for(const item of uncertain.filter(row=>row.type==='item'&&row.targetStamp))assert.deepEqual(await fingerprint(item.backup),job.old[path.basename(item.target)]);
  job=await fixture();assert(publish(job,2,{ONE_TEST_MODE:'1',ONE_ARCHIVE_VOLUME_FAIL_POINT:'commit-flush'}).some(row=>row.type==='error'&&row.code==='recovery'));await published(job);const writtenDecision=await records(job.recovery);assert.equal(writtenDecision.at(-1).type,'committed');for(const item of writtenDecision.filter(row=>row.type==='item'&&row.targetStamp))assert.deepEqual(await fingerprint(item.backup),job.old[path.basename(item.target)]);
  job=await fixture();const beforePublishSequence=new Set([...Object.keys(job.old),...Object.keys(job.next)]).size+2;assert(publish(job,2,{ONE_TEST_MODE:'1',ONE_ARCHIVE_VOLUME_JOURNAL_FAIL_AT_SEQUENCE:String(beforePublishSequence)}).some(row=>row.type==='error'&&row.code==='recovery'));await original(job);await staged(job);assert((await records(job.recovery)).some(row=>row.type==='prepared'));
  job=await fixture();const clean=publish(job,0,{ONE_TEST_MODE:'1',ONE_ARCHIVE_VOLUME_FAIL_POINT:'cleanup:0'}).find(row=>row.type==='result');assert(clean.committed&&clean.cleanupPending&&clean.recovery===job.recovery);await published(job);assert.equal((await records(job.recovery)).at(-1).type,'committed');
  // Refuse stale members, unknown numeric siblings, hard links, unrelated stage
  // contents, reparse ancestors and caller-supplied non-private scope.
  for(const scenario of ['old-stale','new-stale','extra-tail','stage-extra','hard-link','stage-name','existing-recovery']){
   job=await fixture('7z');let foreign;
   if(scenario.endsWith('stale')){const file=scenario==='old-stale'?job.source:job.primary,bytes=await fs.readFile(file),stat=await fs.stat(file);await fs.writeFile(file+'.replacement',bytes);await fs.utimes(file+'.replacement',stat.atime,stat.mtime);await fs.rename(file+'.replacement',file);}
   if(scenario==='extra-tail'){foreign=job.source.slice(0,-3)+'4097';await fs.writeFile(foreign,'foreign tail');}
   if(scenario==='stage-extra'){foreign=path.join(job.stage,'unrelated');await fs.writeFile(foreign,'foreign stage content');}
   if(scenario==='hard-link'){foreign=path.join(root,'hardlink-'+randomUUID());await fs.link(job.primary,foreign);}
   if(scenario==='stage-name'){const moved=path.join(job.parent,'not-private');await fs.rename(job.stage,moved);job.primary=path.join(moved,path.basename(job.primary));}
   if(scenario==='existing-recovery'){await fs.mkdir(job.recovery);foreign=path.join(job.recovery,'user-file');await fs.writeFile(foreign,'keep');}
   publish(job,2);if(scenario!=='old-stale')await original(job);if(foreign)assert(await exists(foreign));
  }
  job=await fixture();const link=path.join(root,'parent-link');await fs.symlink(job.parent,link,'junction');publish({...job,source:path.join(link,path.basename(job.source)),primary:path.join(link,path.basename(job.stage),path.basename(job.primary)),recovery:path.join(link,path.basename(job.recovery))},2);await original(job);await fs.rmdir(link);
  job=await fixture('zip','grow','correct password');publish({...job,password:'wrong password'},2);await original(job);await staged(job);assert(!await exists(job.recovery));
  // Readers denying delete access are detected before any original is moved.
  for(const side of ['old','new']){job=await fixture();const file=side==='old'?job.source:job.primary,reader=create(file,0x80000000,3,null,3,0x200000,0);assert(reader!==-1&&reader!==-1n);try{publish(job,2);await original(job);await staged(job);assert(!await exists(job.recovery));}finally{close(reader);}}
  // Hold at the handshake: OS locks deny writes/renames of every family member.
  // A late collision at a NEW target is preserved and triggers complete rollback.
  job=await fixture();let waiting=await pending(job);waiting.child.stdin.end(Buffer.from([2]));const cancelled=await waiting.result;assert.equal(cancelled.code,0);assert(cancelled.messages.some(row=>row.type==='result'&&row.cancelled&&!row.committed));await original(job);await staged(job);assert(!await exists(job.recovery));
  job=await fixture();const queuedStop=publish(job,0,{},[1,2]);assert(queuedStop.some(row=>row.type==='result'&&row.cancelled&&!row.committed));await original(job);await staged(job);assert(!await exists(job.recovery));
  job=await fixture();waiting=await pending(job);for(const file of [job.source,path.join(job.parent,Object.keys(job.old).at(-1))])await assert.rejects(fs.writeFile(file,'tamper'));for(const file of [job.primary,path.join(job.stage,Object.keys(job.next).at(-1))])await assert.rejects(fs.rename(file,file+'.moved'));
  const newName=Object.keys(job.next).find(name=>!job.old[name]);assert(newName);const foreignTarget=path.join(job.parent,newName);await fs.writeFile(foreignTarget,'unowned target');waiting.child.stdin.end(Buffer.from([1]));assert.equal((await waiting.result).code,2);await original(job);await staged(job);assert.equal(await fs.readFile(foreignTarget,'utf8'),'unowned target');assert(!await exists(job.recovery));
  job=await fixture();waiting=await pending(job);const unowned=path.join(job.recovery,'unknown.txt');await fs.writeFile(unowned,'unowned recovery');waiting.child.stdin.end(Buffer.from([1]));const kept=await waiting.result;assert.equal(kept.code,0);assert(kept.messages.some(row=>row.type==='result'&&row.committed&&row.cleanupPending));await published(job);assert.equal(await fs.readFile(unowned,'utf8'),'unowned recovery');
  job=await fixture();waiting=await pending(job);const extraTail=job.source.slice(0,-3)+'4097';await fs.writeFile(extraTail,'late foreign volume');waiting.child.stdin.end(Buffer.from([1]));assert.equal((await waiting.result).code,2);await original(job);await staged(job);assert.equal(await fs.readFile(extraTail,'utf8'),'late foreign volume');assert(!await exists(job.recovery));
  for(const side of ['old','new']){job=await fixture();waiting=await pending(job);const victim=side==='old'?job.source:job.primary,alias=path.join(root,'late-link-'+randomUUID());await fs.link(victim,alias);waiting.child.stdin.end(Buffer.from([1]));assert.equal((await waiting.result).code,2);await original(job);await staged(job);assert.deepEqual(await fingerprint(alias),await fingerprint(victim));assert(!await exists(job.recovery));}
  // Download ADS survives group replacement, including newly grown volumes.
  job=await fixture('zip');const mark='[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=https://example.invalid/local-test\r\n';await fs.writeFile(job.source+':Zone.Identifier',mark);job.oldRevision=(await run({operation:'list',path:job.source})).revision;
  publish(job);for(const name of Object.keys(job.next))assert.equal(await fs.readFile(path.join(job.parent,name)+':Zone.Identifier','utf8'),mark);seven(['t',job.source]);
  job=await fixture('7z');await fs.writeFile(job.source+':Zone.Identifier',mark);job.oldRevision=(await run({operation:'list',path:job.source})).revision;publish(job,77,{ONE_TEST_MODE:'1',ONE_ARCHIVE_VOLUME_CRASH_POINT:'committed'});for(const item of (await records(job.recovery)).filter(row=>row.type==='item'&&row.sourceStamp)){assert.equal(item.sourceStamp,nativeStamp(item.target),'Journal stamp remains valid after mark flush and handle close');assert.equal(await fs.readFile(item.target+':Zone.Identifier','utf8'),mark);}
  job=await fixture();publish(job,0,{ONE_TEST_MODE:'0',ONE_ARCHIVE_VOLUME_CRASH_POINT:'committed',ONE_ARCHIVE_VOLUME_FAIL_POINT:'published:0'});await published(job);assert(!await exists(job.recovery));
  await assert.rejects(run({operation:'volume-publish',path:'fake'}),/请求无效/);
  console.log('Volume publication passed: ZIP/7Z grow/shrink/empty/single-part transitions, encrypted/CP936 archives, external test/extraction, complete CRC-chained plans, ACK/cancel/exception rollback, abrupt exits, uncertain commit preservation, accurate cleanup-pending outcome, identity/scope/link/late-collision guards, OS locks, origin streams and production fault isolation. Public split editing and restart recovery remain separate.');
 }finally{
  for(const child of live){const closed=new Promise(resolve=>child.once('close',resolve));child.kill();await closed;}
  await service?.stop();assert.equal(path.dirname(root),path.resolve('work/temp'));await fs.rm(root,{recursive:true,force:true});
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
