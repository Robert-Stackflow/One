// Public GUI/CLI service save lifecycle, using real native helpers and an
// isolated profile. No Explorer, installed profile or desktop automation.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const cp=require('node:child_process');
const {randomUUID,randomBytes,createHash}=require('node:crypto');
const Module=require('node:module');
const {build}=require('esbuild');
async function compile(entry){const output=await build({entryPoints:[entry],bundle:true,platform:'node',format:'cjs',write:false}),filename=path.resolve('dist/main/volume-update-test.cjs'),mod=new Module(filename);mod.filename=filename;mod.paths=Module._nodeModulePaths(path.dirname(filename));mod._compile(output.outputFiles[0].text,filename);return mod.exports;}
async function main(){
 await fs.mkdir('work/temp',{recursive:true});const root=await fs.mkdtemp(path.resolve('work/temp/one-volume-update-'));
 const keys=['TEMP','TMP','ONE_TEST_MODE','ONE_ARCHIVE_TEST_BUDGET_SCOPE','ONE_ARCHIVE_VOLUME_FAIL_POINT','ONE_ARCHIVE_VOLUME_CRASH_POINT','ONE_ARCHIVE_RECOVER_CRASH_POINT','ONE_ARCHIVE_VOLUME_JOURNAL_FAIL_AT_SEQUENCE'];
 const prior=Object.fromEntries(keys.map(key=>[key,process.env[key]])),spawn=cp.spawn;let service,serial=0,intercept='',currentId='',hooked=false;const progress=[],events=[];
 const exists=async file=>{try{await fs.lstat(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
 const hash=async file=>createHash('sha256').update(await fs.readFile(file)).digest('hex');
 try{
  for(const key of keys)delete process.env[key];Object.assign(process.env,{TEMP:root,TMP:root,ONE_TEST_MODE:'1',ONE_ARCHIVE_TEST_BUDGET_SCOPE:'volume-save-'+randomUUID()});
  // Observe real protocol boundaries without adding production timing hooks.
  cp.spawn=function(file,args,options){const child=spawn.call(this,file,args,options);if(args?.[0]==='volume-publish'&&intercept||['update-stage','update-recorded-stage'].includes(args?.[0])&&intercept==='stage'){let text='';child.stdout.prependListener('data',data=>{text+=data;if(!hooked&&(intercept==='ack'&&text.includes('"type":"ready"')||intercept==='committed'&&text.includes('"committed":true')||intercept==='stage'&&text.includes('"type":"progress"'))){hooked=true;assert.equal(service.cancel(currentId,1),true);}});}return child;};
  const {ArchiveService}=await compile('src/main/archive-service.ts'),{ArchiveTasks}=await compile('src/main/archive-tasks.ts'),{parseCli,runCli}=await compile('src/main/archive-cli.ts');
  const cache=path.join(root,'profile','archive-cache'),history=path.join(root,'profile','tasks','history.json');
  const open=()=>new ArchiveService(cache,(_owner,value)=>progress.push(value),undefined,(event,detail)=>events.push({event,detail}),false,new ArchiveTasks(history));service=open();
  const run=(request,id)=>service.run(1,request,id),input=path.join(root,'original.bin'),added=path.join(root,'added.bin'),small=path.join(root,'small.txt');await fs.writeFile(input,randomBytes(2200*1024));await fs.writeFile(added,randomBytes(2400*1024));await fs.writeFile(small,'small 中文 😀');
  const fixture=async(format='7z',password='',single=false)=>{const parent=path.join(root,'中文 😀 group '+serial++);await fs.mkdir(parent);const created=await run({operation:'create',path:path.join(parent,'source.'+format),sources:[single?small:input],volumeBytes:1024**2,level:0,password}),source=created.path,listing=await run({operation:'list',path:source,password}),old={};assert(listing.editable);for(const file of await fs.readdir(parent))old[file]=await hash(path.join(parent,file));return{parent,source,password,listing,old};};
  const original=async job=>{for(const [file,value]of Object.entries(job.old))assert.equal(await hash(path.join(job.parent,file)),value);};
  const update=(job,changes,id=randomUUID())=>{currentId=id;return run({operation:'update',path:job.source,password:job.password,revision:job.listing.revision,changes},id);};
  const grow=[{kind:'add',source:added,name:'子目录/added.bin'},{kind:'mkdir',name:'空目录'}];
  const refresh=async job=>job.listing=await run({operation:'list',path:job.source,password:job.password});
  const extractCheck=async(job,names)=>{const output=path.join(root,'extracted-'+serial++);await fs.mkdir(output);await run({operation:'test',path:job.source,password:job.password});const result=await run({operation:'extract',path:job.source,password:job.password,parent:output,destination:'folder'});for(const [name,source]of Object.entries(names))assert.equal(await hash(path.join(result.path,...name.split('/'))),await hash(source));};
  const clean=async()=>assert.equal((await service.recoveryPage()).total,0,'Successful saves remove their recovery index and empty stage');
  for(const format of ['zip','7z'])for(const password of ['', ' 密码 😀 ']){
   const job=await fixture(format,password);const result=await update(job,[...grow,...(format==='zip'?[{kind:'comment',text:'分卷修改备注'}]:[])]);assert.equal(result.count,3);assert(!result.recovery);await clean();await refresh(job);assert.equal(job.listing.total,3);if(format==='zip')assert.equal(job.listing.comment,'分卷修改备注');await extractCheck(job,{'original.bin':input,'子目录/added.bin':added});
   const changed=await update(job,[{kind:'rename-folder',folder:'子目录',name:'移动后'},{kind:'delete',indexes:[job.listing.entries.find(row=>row.name==='original.bin').index]}]);assert.equal(changed.count,2);await refresh(job);await extractCheck(job,{'移动后/added.bin':added});
   await update(job,[{kind:'delete',indexes:job.listing.entries.map(row=>row.index)}]);await refresh(job);assert.equal(job.listing.total,0);await run({operation:'test',path:job.source,password});await clean();
   await update(job,grow);await refresh(job);assert.equal(job.listing.total,2);await extractCheck(job,{'子目录/added.bin':added});await clean();
  }
  let job=await fixture('7z','',true);assert.equal(Object.keys(job.old).length,1);assert(!job.listing.revision.startsWith('v2:'));await update(job,grow);await refresh(job);assert(job.listing.revision.startsWith('v2:'));await extractCheck(job,{'small.txt':small,'子目录/added.bin':added});
  await update(job,[{kind:'delete',indexes:[],folders:['子目录','空目录']}]);await refresh(job);assert.equal(job.listing.total,1);assert(!await exists(job.source.replace(/001$/,'002')));await clean();

  // CLI uses the exact same revision and transaction flow, including .7z.001.
  for(const format of ['zip','7z']){
   job=await fixture(format);const changesFile=path.join(root,'changes-'+serial+++'.json');await fs.writeFile(changesFile,JSON.stringify([{kind:'mkdir',name:'CLI目录'}]));const lines=[];
   const code=await runCli(parseCli(['update','--json','--changes',changesFile,job.source],root),service,{out:async line=>lines.push(JSON.parse(line)),err:async()=>{},signal:new AbortController().signal,password:async()=>''});assert.equal(code,0,JSON.stringify(lines));assert(lines.some(row=>row.type==='result'));await refresh(job);assert(job.listing.entries.some(row=>row.name.replace(/\/$/,'')==='CLI目录'));await clean();
   lines.length=0;await fs.writeFile(changesFile,JSON.stringify([{kind:'mkdir',name:'CLI待清理'}]));process.env.ONE_ARCHIVE_VOLUME_FAIL_POINT='cleanup-stage-directory';
   assert.equal(await runCli(parseCli(['update','--json','--changes',changesFile,job.source],root),service,{out:async line=>lines.push(JSON.parse(line)),err:async()=>{},signal:new AbortController().signal,password:async()=>''}),0,JSON.stringify(lines));delete process.env.ONE_ARCHIVE_VOLUME_FAIL_POINT;assert(lines.some(row=>row.type==='result'&&row.recovery));const pending=(await service.recoveryPage()).items.find(row=>row.archive===job.source);assert(pending);await service.cleanupRecovery(1,pending.id);await clean();
  }
  // A cleanup failure is successful saving with actionable recovery details,
  // and task history must retain that distinction after restart.
  for(const point of ['cleanup:0','cleanup-stage-directory']){
   job=await fixture('zip');process.env.ONE_ARCHIVE_VOLUME_FAIL_POINT=point;const id=randomUUID(),result=await update(job,grow,id);delete process.env.ONE_ARCHIVE_VOLUME_FAIL_POINT;assert(result.recovery);await extractCheck(job,{'original.bin':input,'子目录/added.bin':added});
   await service.stop();service=open();const recent=(await service.taskOverview()).recent.find(row=>row.id===id);assert.equal(recent.state,'completed');assert.equal(recent.result.recovery,result.recovery);const checked=await service.inspectRecovery(1,id);assert.equal(checked.state,'committed');await assert.rejects(service.restoreRecovery(1,id));await service.cleanupRecovery(1,id);await clean();
  }
  for(const format of ['zip','7z'])for(const point of ['prepared','backup:0','published:0','committed','cleanup-stage-directory']){
   job=await fixture(format,point==='prepared'?' 密码 ':'');process.env.ONE_ARCHIVE_VOLUME_CRASH_POINT=point;const id=randomUUID();await assert.rejects(update(job,grow,id),/恢复资料/);delete process.env.ONE_ARCHIVE_VOLUME_CRASH_POINT;
   await service.stop();service=open();const checked=await service.inspectRecovery(1,id);assert.equal(checked.state,['committed','cleanup-stage-directory'].includes(point)?'committed':'pending');if(checked.state==='pending'){await service.restoreRecovery(1,id);await original(job);}else await extractCheck(job,{'original.bin':input,'子目录/added.bin':added});await service.cleanupRecovery(1,id);await clean();
  }
  for(const format of ['zip','7z'])for(const point of ['backup:0','published:0','commit']){
   job=await fixture(format);process.env.ONE_ARCHIVE_VOLUME_FAIL_POINT=point;const id=randomUUID();await assert.rejects(update(job,grow,id),/恢复资料/);delete process.env.ONE_ARCHIVE_VOLUME_FAIL_POINT;await original(job);assert.equal((await service.inspectRecovery(1,id)).state,'rolled-back');await service.cleanupRecovery(1,id);await clean();
  }
  // Cancellation before publication rolls back; cancellation arriving after
  // the durable result cannot turn a successful save into a cancelled task.
  for(const mode of ['ack','committed']){
   job=await fixture();intercept=mode;hooked=false;const id=randomUUID();if(mode==='ack'){await assert.rejects(update(job,grow,id),/取消/);await original(job);const item=(await service.recoveryPage()).items.find(row=>row.id===id);assert(item);assert.equal((await service.inspectRecovery(1,id)).state,'rolled-back','Recorded staging remains explicitly cleanable after rollback');await service.cleanupRecovery(1,id);}
   else{const result=await update(job,grow,id);assert(!result.recovery);assert.equal((await service.taskOverview()).recent.find(row=>row.id===id).state,'completed');await extractCheck(job,{'original.bin':input,'子目录/added.bin':added});}assert(hooked);intercept='';await clean();
  }
  // Staging errors never touch originals and retain discoverable partial data.
  job=await fixture();const queuedId=randomUUID(),queued=update(job,grow,queuedId);assert.equal(service.cancel(queuedId,1),true);await assert.rejects(queued,/取消/);await original(job);await clean();
  job=await fixture();intercept='stage';hooked=false;const stagedId=randomUUID();await assert.rejects(update(job,grow,stagedId),/取消/);intercept='';assert(hooked);await original(job);const stagedRecord=(await service.recoveryPage()).items.find(row=>row.id===stagedId);if(stagedRecord){const checked=await service.inspectRecovery(1,stagedId);assert.equal(checked.state,'staged');await service.cleanupRecovery(1,stagedId,checked.stage.token);}await clean();
  job=await fixture('zip','correct');job.password='wrong';const id=randomUUID();await assert.rejects(update(job,grow,id));await original(job);const item=(await service.recoveryPage()).items.find(row=>row.id===id);if(item){const checked=await service.inspectRecovery(1,id);assert.equal(checked.state,'staged');await service.cleanupRecovery(1,id,checked.stage.token);}await clean();
  job=await fixture();const blockedIndex=path.join(root,'blocked-index');await fs.writeFile(blockedIndex,'Not a directory');const guarded=new ArchiveService(path.join(root,'guarded','cache'),()=>{},undefined,undefined,false,undefined,undefined,blockedIndex);try{await assert.rejects(guarded.run(1,{operation:'update',path:job.source,revision:job.listing.revision,changes:grow}));await original(job);assert.deepEqual((await fs.readdir(job.parent)).sort(),Object.keys(job.old).sort(),'Index failure must occur before any staging or original mutation');}finally{await guarded.stop();}
  assert(events.some(row=>row.event==='archive-volume-cleanup-pending'));assert(events.some(row=>row.event==='archive-volume-recovery-retained'));assert(progress.some(row=>row.operation==='update'));assert(!progress.some(row=>row.operation.startsWith('volume-')));
  console.log('Public split update passed: ZIP/7Z encrypted grow/shrink/empty/single-part saves, directory edits/comments/content hashes, GUI service and CLI, successful stage/index cleanup, cleanup-pending success/history/restart, hard exits/recovery, ACK cancellation, late cancellation, password failure and original preservation.');
 }finally{intercept='';cp.spawn=spawn;await service?.stop();for(const key of keys)if(prior[key]===undefined)delete process.env[key];else process.env[key]=prior[key];assert.equal(path.dirname(root),path.resolve('work/temp'));await fs.rm(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
