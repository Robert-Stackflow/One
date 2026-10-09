// Actual process exits across generation -> publication. All files and profiles
// belong to this test, and no Explorer or installed user data is used.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {spawn,spawnSync}=require('node:child_process'),{randomUUID,randomBytes,createHash}=require('node:crypto');
const Module=require('node:module'),{build}=require('esbuild');
const engine=path.resolve(process.env.ONE_ARCHIVE_HANDOFF_BUILD||'dist'),helper=path.join(engine,'native','One.Archive.exe');
const secret=password=>{const bytes=Buffer.from(password),header=Buffer.alloc(4);header.writeUInt32LE(bytes.length);return Buffer.concat([header,bytes]);};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function compile(entry){const bundle=await build({entryPoints:[entry],bundle:true,platform:'node',format:'cjs',write:false}),filename=path.join(engine,'main','handoff-test.cjs'),mod=new Module(filename);mod.filename=filename;mod.paths=Module._nodeModulePaths(path.resolve('node_modules/..'));mod._compile(bundle.outputFiles[0].text,filename);return mod.exports;}
async function main(){
 await fs.mkdir('work/temp',{recursive:true});const root=await fs.mkdtemp(path.resolve('work/temp/one-stage-handoff-'));
 const keys=['TEMP','TMP','ONE_TEST_MODE','ONE_ARCHIVE_TEST_BUDGET_SCOPE','ONE_ARCHIVE_RECOVER_CRASH_POINT','ONE_ARCHIVE_VOLUME_CRASH_POINT','ONE_ARCHIVE_VOLUME_FAIL_POINT','ONE_ARCHIVE_VOLUME_JOURNAL_FAIL_AT_SEQUENCE'];
 const prior=Object.fromEntries(keys.map(key=>[key,process.env[key]]));let service,cases=0,serial=0;
 const exists=async file=>{try{await fs.lstat(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
 try{
  for(const key of keys)delete process.env[key];Object.assign(process.env,{TEMP:root,TMP:root,ONE_TEST_MODE:'1',ONE_ARCHIVE_TEST_BUDGET_SCOPE:'handoff-'+randomUUID()});
  const {ArchiveService}=await compile('src/main/archive-service.ts'),{archiveEditPacket}=await compile('src/main/archive-update.ts');service=new ArchiveService(path.join(root,'profile','cache'),()=>{});const run=request=>service.run(1,request);
  const keep=path.join(root,'keep.bin'),added=path.join(root,'added.bin');await fs.writeFile(keep,randomBytes(1300*1024));await fs.writeFile(added,randomBytes(1400*1024));
  const packet=await archiveEditPacket([{kind:'add',source:added,name:'added.bin'}]);
  const native=(args,input=secret(''),expected=0,extra={})=>{
   const result=spawnSync(helper,args,{env:{...process.env,...extra},input,windowsHide:true,encoding:'utf8',timeout:60000,maxBuffer:2*1024**2});
   assert.equal(result.status,expected,JSON.stringify({status:result.status,error:result.error?.message,stdout:result.stdout?.slice(-4000),stderr:result.stderr?.slice(-1000)}));
   return result.stdout.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
  };
  const fingerprint=async file=>{const stat=await fs.stat(file,{bigint:true});return{ino:stat.ino,size:stat.size,mtime:stat.mtimeNs,hash:hash(await fs.readFile(file))};};
  for(const format of ['zip','7z'])for(const password of ['','handoff secret']){
   const base=path.join(root,'base-'+serial++);await fs.mkdir(base);const created=await run({operation:'create',path:path.join(base,'source.'+format),sources:[keep],password,volumeBytes:1024**2,level:0});
   const names=await fs.readdir(base),primaryName=path.basename(created.path);
   const fixture=async(staging=true)=>{
    const parent=path.join(root,'case-'+serial++);await fs.mkdir(parent);for(const name of names)await fs.copyFile(path.join(base,name),path.join(parent,name));
    const source=path.join(parent,primaryName),listing=await run({operation:'list',path:source,password});
    const job={source,password,parent,revision:listing.revision,stage:path.join(parent,'.one-update-'+randomUUID()),recovery:path.join(parent,'.one-volume-recovery-'+randomUUID())};
    job.before=await Promise.all(names.map(async name=>[name,await fingerprint(path.join(parent,name))]));
    if(staging){const staged=native(['update-recorded-stage',source,job.stage,job.recovery,'0',job.revision],Buffer.concat([secret(password),packet])).find(row=>row.type==='result');job.prepared=staged.path;job.preparedRevision=staged.revision;}return job;
   };
   const unchanged=async job=>{for(const [name,before] of job.before)assert.deepEqual(await fingerprint(path.join(job.parent,name)),before);};
   const publish=(job,expected=0,extra={},ack=1)=>native(['volume-publish',job.source,job.prepared,job.recovery,'0',job.revision,job.preparedRevision],Buffer.concat([secret(password),Buffer.from([ack])]),expected,extra);
   const cancelReady=job=>new Promise((resolve,reject)=>{
    const child=spawn(helper,['volume-publish',job.source,job.prepared,job.recovery,'0',job.revision,job.preparedRevision],{env:process.env,windowsHide:true,stdio:'pipe'});
    let output='',ready=false;const timer=setTimeout(()=>{child.kill();reject(Error('Publication handshake timed out'));},30000);
    child.on('error',error=>{clearTimeout(timer);reject(error);});child.stdin.on('error',()=>{});
    child.stdout.on('data',data=>{output+=data;assert(output.length<2*1024**2);if(!ready&&output.includes('"type":"ready"')){ready=true;child.stdin.end(Buffer.from([2]));}});
    child.on('close',code=>{clearTimeout(timer);try{assert(ready,output);assert.equal(code,0,output);resolve(output.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse));}catch(error){reject(error);}});
    child.stdin.write(secret(password));
   });
   const stageCleanup=job=>{
    const state=native(['stage-inspect',job.source,job.stage,job.recovery]).find(row=>row.type==='stage-inspection');assert(state.sealed);
    native(['stage-cleanup',job.source,job.stage,job.recovery,state.token],Buffer.concat([secret(''),Buffer.from([1])]));return state;
   };
   const recover=job=>native(['volume-recover',job.parent,job.recovery],Buffer.concat([secret(''),Buffer.from([1])]));
   const cleanup=job=>native(['volume-cleanup',job.parent,job.recovery],Buffer.concat([secret(''),Buffer.from([1])]));
   for(const point of ['handoff-verified','handoff-created','handoff-recorded','handoff-published','handoff-retired','prepared','backup:0','published:0','committed']){
    const job=await fixture(),handoff=point.startsWith('handoff-');publish(job,77,{[handoff?'ONE_ARCHIVE_RECOVER_CRASH_POINT':'ONE_ARCHIVE_VOLUME_CRASH_POINT']:point});
    if(['handoff-verified','handoff-recorded'].includes(point)){await unchanged(job);const state=stageCleanup(job);assert.equal(state.missing,0);}
    else if(point==='handoff-created'){
     await unchanged(job);native(['stage-inspect',job.source,job.stage,job.recovery],secret(''),2);assert(await exists(path.join(job.recovery,'.manifest.pending')),'Unrecorded file must be retained');
    }else if(point==='committed'){
     const listing=await run({operation:'list',path:job.source,password});assert(listing.entries.some(item=>item.name==='added.bin'));await run({operation:'test',path:job.source,password});
     native(['volume-recover',job.parent,job.recovery],Buffer.concat([secret(''),Buffer.from([1])]),2);cleanup(job);
    }else{
     if(point==='handoff-published'){
      assert(await exists(path.join(job.recovery,'stage.jsonl')));assert(await exists(path.join(job.recovery,'manifest.jsonl')));
      native(['stage-inspect',job.source,job.stage,job.recovery],secret(''),2);
      // An otherwise valid manifest copied to a different file identity cannot
      // gain authority from the matching stage journal or its two filenames.
      const manifest=path.join(job.recovery,'manifest.jsonl'),replacement=manifest+'.replacement',held=path.join(job.parent,'held-manifest');await fs.copyFile(manifest,replacement);await fs.rename(manifest,held);await fs.rename(replacement,manifest);
      const rejected=native(['volume-recover',job.parent,job.recovery],Buffer.concat([secret(''),Buffer.from([1])]),2);assert(rejected.some(row=>row.type==='error'&&row.message.includes('differs from its staging handoff')));await unchanged(job);await fs.unlink(manifest);await fs.rename(held,manifest);
     }
     recover(job);await unchanged(job);cleanup(job);
    }
    if(point!=='handoff-created'){assert(!await exists(job.stage));assert(!await exists(job.recovery));}++cases;
   }
   for(const sequence of ['0','1','2']){
    const job=await fixture();publish(job,2,{ONE_ARCHIVE_VOLUME_JOURNAL_FAIL_AT_SEQUENCE:sequence});await unchanged(job);stageCleanup(job);assert(!await exists(job.recovery));++cases;
   }
   for(const failure of ['cancel','backup:0','published:0']){
    const job=await fixture(),messages=failure==='cancel'?await cancelReady(job):publish(job,2,{ONE_ARCHIVE_VOLUME_FAIL_POINT:failure});
    if(failure==='cancel')assert(messages.some(row=>row.type==='result'&&row.cancelled));await unchanged(job);assert(await exists(path.join(job.recovery,'manifest.jsonl')),'Rollback retains authority over recorded staged files');cleanup(job);assert(!await exists(job.stage));assert(!await exists(job.recovery));++cases;
   }
   // Success must retire both journals and all task-owned staging, and leave a
   // complete archive whose contents pass the actual format engine.
   const saved=await fixture();assert(publish(saved).some(row=>row.type==='result'&&row.committed));await run({operation:'test',path:saved.source,password});assert((await run({operation:'list',path:saved.source,password})).entries.some(row=>row.name==='added.bin'));assert(!await exists(saved.stage));assert(!await exists(saved.recovery));++cases;
   // Public save must actually generate provenance, survive a service restart,
   // and route the dual-journal window to publication recovery, not stage erase.
   for(const point of ['stage-header','stage-created:0','handoff-recorded','handoff-published','handoff-retired']){
    const job=await fixture(false),id=randomUUID();process.env.ONE_ARCHIVE_RECOVER_CRASH_POINT=point;
    await assert.rejects(service.run(1,{operation:'update',path:job.source,revision:job.revision,password,changes:[{kind:'add',source:added,name:'added.bin'}]},id));delete process.env.ONE_ARCHIVE_RECOVER_CRASH_POINT;
    await unchanged(job);await service.stop();service=new ArchiveService(path.join(root,'profile','cache'),()=>{});
    const checked=await service.inspectRecovery(1,id);assert.equal(checked.state,['handoff-published','handoff-retired'].includes(point)?'pending':'staged');
    if(checked.state==='staged'){assert(checked.stage);assert(!checked.samples.some(row=>row.name==='.manifest.pending'));await service.cleanupRecovery(1,id,checked.stage.token);}
    else{await service.restoreRecovery(1,id);await service.cleanupRecovery(1,id);}
    await unchanged(job);assert.equal((await service.recoveryPage()).total,0);++cases;
   }
  }
  console.log(`Staging handoff passed: ${cases} ZIP/7Z plain/encrypted real exit, journal failure, identity, rollback, cancellation, publication and public service restart cases.`);
 }finally{
  await service?.stop();for(const [key,value] of Object.entries(prior))value===undefined?delete process.env[key]:process.env[key]=value;
  await fs.rm(root,{recursive:true,force:true});
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
