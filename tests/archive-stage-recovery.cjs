// Private native inspection and explicit cleanup of recorded partial stages.
// No UI, Explorer, installed data, or public stage lifecycle is changed here.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {spawn,spawnSync}=require('node:child_process'),{randomUUID,randomBytes,createHash}=require('node:crypto');
const Module=require('node:module'),{build}=require('esbuild');
const helper=path.resolve('dist/native/One.Archive.exe'),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const secret=password=>{const bytes=Buffer.from(password),header=Buffer.alloc(4);header.writeUInt32LE(bytes.length);return Buffer.concat([header,bytes]);};
const table=Array.from({length:256},(_,i)=>{let v=i;for(let bit=0;bit<8;bit++)v=v&1?0xedb88320^(v>>>1):v>>>1;return v>>>0;});
function crc32(previous,text){let v=previous^0xffffffff;for(const byte of Buffer.from(text))v=table[(v^byte)&255]^(v>>>8);return(v^0xffffffff)>>>0;}
async function compile(entry){const result=await build({entryPoints:[entry],bundle:true,platform:'node',format:'cjs',write:false}),filename=path.resolve('dist/main/stage-recovery-test.cjs'),mod=new Module(filename);mod.filename=filename;mod.paths=Module._nodeModulePaths(path.dirname(filename));mod._compile(result.outputFiles[0].text,filename);return mod.exports;}
async function main(){
 await fs.mkdir('work/temp',{recursive:true});const root=await fs.mkdtemp(path.resolve('work/temp/one-stage-recovery-'));let service;const live=new Set();
 const keys=['TEMP','TMP','ONE_TEST_MODE','ONE_ARCHIVE_TEST_BUDGET_SCOPE','ONE_ARCHIVE_RECOVER_CRASH_POINT','ONE_ARCHIVE_STAGE_JOURNAL_FAIL_AT_SEQUENCE'],prior=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 const exists=async file=>{try{await fs.lstat(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
 try{
  for(const key of keys)delete process.env[key];Object.assign(process.env,{TEMP:root,TMP:root,ONE_TEST_MODE:'1',ONE_ARCHIVE_TEST_BUDGET_SCOPE:'stage-recovery-'+randomUUID()});
  const {ArchiveService}=await compile('src/main/archive-service.ts'),{archiveEditPacket}=await compile('src/main/archive-update.ts');service=new ArchiveService(path.join(root,'profile','cache'),()=>{});const run=request=>service.run(1,request);
  const original=path.join(root,'input.bin'),add=path.join(root,'added.bin');await fs.writeFile(original,randomBytes(2200*1024));await fs.writeFile(add,randomBytes(2400*1024));
  const raw=(args,input=secret(''),expected=0,env={})=>{const result=spawnSync(helper,args,{env:{...process.env,...env},windowsHide:true,input,encoding:'utf8',timeout:60000,maxBuffer:4*1024**2});assert.equal(result.status,expected,JSON.stringify(result));return result.stdout.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);};
  const records=async job=>(await fs.readFile(path.join(job.recovery,'stage.jsonl'),'utf8')).trimEnd().split('\n').map(line=>JSON.parse(line).record);
  const rewrite=async(job,rows)=>{let crc=0;await fs.writeFile(path.join(job.recovery,'stage.jsonl'),rows.map((record,sequence)=>{const prefix=JSON.stringify({sequence,record}).slice(0,-1);crc=crc32(crc,prefix);return prefix+',"crc32":"'+crc.toString(16).padStart(8,'0')+'"}\n';}).join(''));};
  const inspect=(job,expected=0)=>{const messages=raw(['stage-inspect',job.source,job.stage,job.recovery],secret(''),expected);assert(!messages.some(item=>item.type==='ready'));return expected?messages:messages.find(item=>item.type==='stage-inspection');};
  const cleanup=(job,token,expected=0,env={},ack=Buffer.from([1]))=>raw(['stage-cleanup',job.source,job.stage,job.recovery,token],Buffer.concat([secret(''),ack]),expected,env);
  const pending=async(job,token)=>{
   const child=spawn(helper,['stage-cleanup',job.source,job.stage,job.recovery,token],{env:process.env,windowsHide:true,stdio:'pipe'});live.add(child);let output='',timer,readyResolve;let ready=false;
   const atReady=new Promise(resolve=>{readyResolve=resolve;}),done=new Promise((resolve,reject)=>{timer=setTimeout(()=>{child.kill();reject(Error('Stage cleanup timeout'));},30000);child.once('error',reject);child.stdout.on('data',data=>{output+=data;if(!ready&&output.includes('"type":"ready"')){ready=true;readyResolve();}});child.once('close',(code,signal)=>{clearTimeout(timer);live.delete(child);resolve({code,signal,output});readyResolve();});});done.catch(()=>{});child.stdin.on('error',()=>{});child.stdin.write(secret(''));await atReady;assert(ready,output);return{child,done};
  };
  for(const format of ['zip','7z'])for(const password of ['','recovery secret']){
   const target=path.join(root,`${format}-${password?'encrypted':'plain'}.${format}`),source=(await run({operation:'create',path:target,sources:[original],password,volumeBytes:1024**2,level:0})).path,listing=await run({operation:'list',path:source,password});
   const base=path.basename(target),members=(await fs.readdir(root)).filter(name=>format==='zip'?name===base||name.startsWith(base.slice(0,-4)+'.z'):name.startsWith(base+'.')).map(name=>path.join(root,name));
   const fingerprint=async()=>Promise.all(members.map(async file=>{const stat=await fs.stat(file,{bigint:true});return{file,ino:stat.ino,size:stat.size,mtime:stat.mtimeNs,hash:hash(await fs.readFile(file))};})),before=await fingerprint();
   const make=async(point='stage-sealed')=>{const job={source,stage:path.join(root,'.one-update-'+randomUUID()),recovery:path.join(root,'.one-volume-recovery-'+randomUUID())};raw(['update-recorded-stage',source,job.stage,job.recovery,'0',listing.revision],Buffer.concat([secret(password),await archiveEditPacket([{kind:'add',source:add,name:'added.bin'}])]),77,{ONE_ARCHIVE_RECOVER_CRASH_POINT:point});return job;};
   for(const point of ['stage-header','stage-created:0','stage-created:2','stage-sealed']){
    const job=await make(point),first=inspect(job);assert.match(first.token,/^[0-9a-f]{64}$/);assert.deepEqual(inspect(job),first,'Read-only inspection is stable');assert.equal(first.sealed,point==='stage-sealed');assert(first.samples.length<=30);assert.equal(first.samples.length,Math.min(first.files,30));
    assert.equal(first.created,first.files+first.missing+first.retired);assert.equal(first.retired,format==='7z'&&point==='stage-sealed'?1:0);assert.equal(first.missing,0);
    const rejected=cleanup(job,'0'.repeat(64),2);assert(!rejected.some(item=>item.type==='ready'));assert.deepEqual(inspect(job),first);
    const messages=cleanup(job,first.token),result=messages.find(item=>item.type==='result');assert.equal(result.count,first.files);assert(!await exists(job.stage));assert(!await exists(job.recovery));
    const missing=inspect(job);assert(missing.stageMissing&&missing.recoveryMissing);assert.equal(cleanup(job,missing.token).find(item=>item.type==='result').count,0);
   }
   const probe=await make(),deletePoints=(await records(probe)).filter(row=>row.type==='snapshot'&&row.stamp).map(row=>'stage-cleanup:'+row.index);let useProbe=true;
   for(const point of [...deletePoints,'stage-cleanup-directory','stage-cleanup-journal','stage-cleanup-recovery']){
    const job=useProbe?probe:await make();useProbe=false;const first=inspect(job);cleanup(job,first.token,77,{ONE_ARCHIVE_RECOVER_CRASH_POINT:point});const second=inspect(job);assert.notEqual(second.token,first.token);cleanup(job,second.token);assert(!await exists(job.stage));assert(!await exists(job.recovery));
   }
   const cancelled=await make(),cancelledState=inspect(cancelled);cleanup(cancelled,cancelledState.token,2,{},Buffer.from([2]));assert.deepEqual(inspect(cancelled),cancelledState);cleanup(cancelled,cancelledState.token,2,{},Buffer.from([1,2]));assert.deepEqual(inspect(cancelled),cancelledState);cleanup(cancelled,cancelledState.token);
   const changed=await make('stage-created:2'),previous=inspect(changed),created=(await records(changed)).filter(item=>item.type==='created'),empty=path.join(changed.stage,created.at(-1).name);await fs.appendFile(empty,'manual changes');const next=inspect(changed);assert.notEqual(next.token,previous.token);cleanup(changed,previous.token,2);assert.equal((await fs.readFile(empty)).toString(),'manual changes');cleanup(changed,next.token);
   const sealed=await make(),sealedFiles=await fs.readdir(sealed.stage),firstFile=path.join(sealed.stage,sealedFiles[0]);await fs.appendFile(firstFile,'changed');inspect(sealed,2);assert(await exists(firstFile));
   const replaced=await make(),names=await fs.readdir(replaced.stage),replace=path.join(replaced.stage,names[0]),copy=replace+'.replacement';await fs.copyFile(replace,copy);await fs.unlink(replace);await fs.rename(copy,replace);inspect(replaced,2);
   for(const where of ['stage','recovery']){
    const job=await make(),state=inspect(job),unknown=path.join(job[where],'unrelated.txt');await fs.writeFile(unknown,'keep');inspect(job,2);cleanup(job,state.token,2);assert.equal(await fs.readFile(unknown,'utf8'),'keep');await fs.unlink(unknown);cleanup(job,inspect(job).token);
   }
   const publishing=await make(),publishingState=inspect(publishing);await fs.writeFile(path.join(publishing.recovery,'manifest.jsonl'),'a publication may have begun');inspect(publishing,2);cleanup(publishing,publishingState.token,2);assert((await fs.readdir(publishing.stage)).length,'A publication manifest disables staging-only cleanup');
   // The confirmation handshake keeps current files locked, then validates the
   // full directory again before the first deletion. A new unknown file survives.
   const afterAck=await make(),ackState=inspect(afterAck),waiting=await pending(afterAck,ackState.token),unknown=path.join(afterAck.stage,'after-ready.txt');await fs.writeFile(unknown,'keep');
   const heldFile=path.join(afterAck.stage,(await fs.readdir(afterAck.stage)).find(name=>name!==path.basename(unknown)));await assert.rejects(fs.appendFile(heldFile,'blocked'));
   cleanup(afterAck,ackState.token,2);inspect(afterAck,2);
   waiting.child.stdin.end(Buffer.from([1]));assert.equal((await waiting.done).code,2);assert.equal(await fs.readFile(unknown,'utf8'),'keep');await fs.unlink(unknown);assert.deepEqual(inspect(afterAck),ackState);cleanup(afterAck,ackState.token);
   const linked=await make(),linkedName=path.join(linked.stage,(await fs.readdir(linked.stage))[0]),alias=path.join(root,'alias-'+randomUUID());await fs.link(linkedName,alias);inspect(linked,2);await fs.unlink(alias);cleanup(linked,inspect(linked).token);
   const changedStage=await make(),oldStage=changedStage.stage+'.old';await fs.rename(changedStage.stage,oldStage);await fs.mkdir(changedStage.stage);inspect(changedStage,2);assert(await exists(oldStage));
   const changedRecovery=await make(),oldRecovery=changedRecovery.recovery+'.old';await fs.rename(changedRecovery.recovery,oldRecovery);await fs.mkdir(changedRecovery.recovery);await fs.copyFile(path.join(oldRecovery,'stage.jsonl'),path.join(changedRecovery.recovery,'stage.jsonl'));inspect(changedRecovery,2);assert(await exists(oldRecovery));
   const junction=await make(),junctionOld=junction.stage+'.old';await fs.rename(junction.stage,junctionOld);await fs.symlink(junctionOld,junction.stage,'junction');inspect(junction,2);await fs.rmdir(junction.stage);
   const missingJournal=await make();await fs.unlink(path.join(missingJournal.recovery,'stage.jsonl'));inspect(missingJournal,2);assert((await fs.readdir(missingJournal.stage)).length);
   const bad=await make(),file=path.join(bad.recovery,'stage.jsonl'),valid=await fs.readFile(file),rows=await records(bad);
   for(const transform of [
    rows=>{rows[0].stage=path.join(root,'.one-update-'+randomUUID());},
    rows=>{rows[1].name='../escape';},
    rows=>{rows[1].identity=rows[2].identity;},
    rows=>{rows[0].unexpected=true;},
    rows=>{rows.at(-1).files++;},
    rows=>{rows[1].index=1;},
    rows=>{rows.splice(1,0,{type:'unknown'});},
   ]){const changed=structuredClone(rows);transform(changed);await rewrite(bad,changed);inspect(bad,2);await fs.writeFile(file,valid);}
   await fs.writeFile(file,valid.subarray(0,valid.length-1));inspect(bad,2);await fs.writeFile(file,Buffer.concat([valid,Buffer.from('garbage\n')]));inspect(bad,2);await fs.writeFile(file,valid);cleanup(bad,inspect(bad).token);
   if(format==='zip'&&!password){
    const oversized=await make(),oversizedFile=path.join(oversized.recovery,'stage.jsonl'),originalJournal=await fs.readFile(oversizedFile);await fs.truncate(oversizedFile,64*1024**2+1);inspect(oversized,2);await fs.writeFile(oversizedFile,Buffer.alloc(512*1024+1,0x20));inspect(oversized,2);await fs.writeFile(oversizedFile,originalJournal);cleanup(oversized,inspect(oversized).token);
   }
   const unsafe=await make();raw(['stage-inspect',source,unsafe.stage,path.join(root,'wrong-recovery')],secret(''),2);raw(['stage-cleanup',source,unsafe.stage,unsafe.recovery,'bad'],secret(''),2);
   assert.deepEqual(await fingerprint(),before,'Inspect and cleanup never modify original archive members');
  }
  for(const operation of ['stage-inspect','stage-cleanup'])await assert.rejects(run({operation,path:'fake'}),/请求无效/);
  console.log('Stage recovery passed: strict CRC/order/scope/identity parsing, stable snapshot tokens and reinspection, plain/encrypted ZIP/7Z partial/sealed cleanup, every cleanup hard-exit boundary and retry, cancellation/ACK, locked files, post-confirmation unknown content, modified/replaced/linked/junction/missing/corrupt journal protection, and unchanged originals. Public lifecycle integration remains separate.');
 }finally{
  for(const child of live){const closed=new Promise(resolve=>child.once('close',resolve));child.kill();await closed;}
  await service?.stop();for(const key of keys)if(prior[key]===undefined)delete process.env[key];else process.env[key]=prior[key];
  assert.equal(path.dirname(root),path.resolve('work/temp'));await fs.rm(root,{recursive:true,force:true});
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
