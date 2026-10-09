const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const Module=require('node:module');
const {spawnSync}=require('node:child_process');
const {build}=require('esbuild');
const JSZip=require('jszip');
const {Transform}=require('node:stream');

async function main(){
 await fs.mkdir('work/temp',{recursive:true});const root=await fs.mkdtemp(path.resolve('work/temp/one-archive-scan-'));let service;
 const keys=['ONE_TEST_MODE','ONE_ARCHIVE_SCAN_TEST','ONE_ARCHIVE_SCAN_TIMEOUT_MS','ONE_ARCHIVE_SCAN','TEMP','TMP'];const old=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 const helper=path.resolve('dist/native/One.Archive.exe');
 const native=(args,env={},extra=Buffer.alloc(0))=>{const result=spawnSync(helper,args,{input:Buffer.concat([Buffer.alloc(4),extra]),env:{...process.env,...env},encoding:'utf8',timeout:15000,maxBuffer:4*1024**2,windowsHide:true});assert(!result.error,String(result.error));return {status:result.status,events:result.stdout.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse),stderr:result.stderr};};
 try{
  Object.assign(process.env,{ONE_TEST_MODE:'1',ONE_ARCHIVE_SCAN_TEST:'passed',ONE_ARCHIVE_SCAN:'1',TEMP:root,TMP:root});
  const compiled=await build({entryPoints:['src/main/archive-service.ts','src/main/archive-tasks.ts','src/main/archive-cli.ts','src/shared/settings.ts','src/shared/archive-scan.ts'],outdir:'virtual',bundle:true,platform:'node',format:'cjs',write:false});
  const load=name=>{const filename=path.resolve('dist/main/'+name+'-scan-test.cjs'),mod=new Module(filename);mod.filename=filename;mod.paths=module.paths;mod._compile(compiled.outputFiles.find(file=>file.path.endsWith(name+'.js')).text,filename);return mod.exports;};
  const {ArchiveService}=load('archive-service'),{ArchiveTasks}=load('archive-tasks'),{parseCli,cliExit,runCli,CliFailure}=load('archive-cli'),{defaultSettings,validateSettings,mergeSettings}=load('settings'),{validArchiveScan,copyArchiveScan}=load('archive-scan');
  const legacy=defaultSettings();delete legacy.archive.scanOnExtract;assert.equal(validateSettings(legacy).archive.scanOnExtract,false);
  const enabled=mergeSettings(defaultSettings(),{archive:{scanOnExtract:true}});assert.equal(validateSettings(JSON.parse(JSON.stringify(enabled))).archive.scanOnExtract,true);
  for(const value of [null,0,1,'true',{}])assert.throws(()=>mergeSettings(defaultSettings(),{archive:{scanOnExtract:value}}));
  for(const args of [['extract','--scan','--no-scan','--output',root,'a.zip'],['extract','--scan=true','--output',root,'a.zip'],['test','--scan','a.zip'],['list','--no-scan','a.zip']])assert.throws(()=>parseCli(args,root),CliFailure);
  for(const [flags,expected] of [[[],false],[['--scan'],true],[['--no-scan'],false]])assert.equal(parseCli(['extract',...flags,'--output',root,'a.zip'],root).jobs[0].request.scan,expected);
  assert.equal(cliExit({code:'scan'}),10);assert.equal(cliExit({code:'threat'}),11);
  for(const report of [{state:'passed',files:0,emptyFiles:0},{state:'passed',files:1,emptyFiles:0},{state:'empty',files:1,emptyFiles:0},{state:'disabled',files:0,emptyFiles:1},{state:'passed',files:1000000,emptyFiles:1,provider:'test'},{state:'incomplete',files:-1,emptyFiles:0}])assert.equal(validArchiveScan(report),false);
  assert.deepEqual(copyArchiveScan({state:'empty',files:0,emptyFiles:1,password:'never retain'}),{state:'empty',files:0,emptyFiles:1});
  const archive=path.join(root,'safe.zip'),zip=new JSZip();zip.file('中文 readme.txt','ordinary test data');zip.file('folder/data.bin',Buffer.alloc(130000,42));zip.file('empty','');zip.folder('empty-folder');await fs.writeFile(archive,await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}));
  const original=await fs.readFile(archive);const historyFile=path.join(root,'tasks.json'),tasks=new ArchiveTasks(historyFile),events=[];let preferences={scanOnExtract:false},cancelOnScan=false;
  service=new ArchiveService(path.join(root,'cache'),(owner,value)=>{if(cancelOnScan&&value.operation==='scan'){cancelOnScan=false;assert(service.cancel(value.id,owner));}},()=> '0',(event,detail)=>events.push({event,detail}),false,tasks,()=>({...preferences,threads:2,memoryMiB:256}));
  const run=request=>service.run(1,request),extract=extra=>run({operation:'extract',path:archive,parent:root,...extra});
  // Ambient scan flags cannot silently enable the optional policy.
  const off=await extract();assert.equal(off.scan,undefined);assert(events.some(item=>item.event==='archive-scan'&&JSON.parse(item.detail).state==='disabled'));
  preferences.scanOnExtract=true;
  const passed=await extract();assert.equal(passed.scan.state,'passed');assert.equal(passed.scan.files,2);assert.equal(passed.scan.emptyFiles,1);assert.equal(await fs.readFile(path.join(passed.path,'中文 readme.txt'),'utf8'),'ordinary test data');
  assert.equal((await tasks.overview()).recent[0].scan.state,'passed');assert.equal((await tasks.overview()).recent[0].result.scan,undefined,'store one summary, without duplicate request or result data');
  const disabled=await extract({scan:false});assert.equal(disabled.scan,undefined);await assert.rejects(extract({scan:'true'}),/扫描设置/);
  const listing=await run({operation:'list',path:archive});const selected=await extract({selected:[listing.entries.find(item=>item.name==='中文 readme.txt').index],revision:listing.revision});assert.equal(selected.scan.files,1);assert.equal(selected.scan.emptyFiles,0);
  const emptyZip=new JSZip();emptyZip.file('empty','');emptyZip.folder('dir');const emptyArchive=path.join(root,'empty.zip');await fs.writeFile(emptyArchive,await emptyZip.generateAsync({type:'nodebuffer'}));
  process.env.ONE_ARCHIVE_SCAN_TEST='unavailable';const empty=await run({operation:'extract',path:emptyArchive,parent:root});assert.equal(empty.scan.state,'empty');assert.equal(empty.scan.files,0);assert.equal(empty.scan.emptyFiles,1);
  // Browsing/testing/creating/editing never invokes the scan provider, even
  // with scanning enabled and an intentionally unavailable test provider.
  await run({operation:'list',path:archive});await run({operation:'test',path:archive});
  const source=path.join(root,'source.txt');await fs.writeFile(source,'benign input');
  const encrypted=path.join(root,'encrypted.zip');await run({operation:'create',path:encrypted,sources:[source],password:'private scan password'});const secretList=await run({operation:'list',path:encrypted});await run({operation:'update',path:encrypted,password:'private scan password',revision:secretList.revision,changes:[{kind:'rename',index:0,name:'renamed.txt'}]});
  const target=path.join(root,'existing');await fs.mkdir(target);const existing=path.join(target,'中文 readme.txt');await fs.writeFile(existing,'preserve original');
  for(const [mode,code,state] of [['unavailable','scan','incomplete'],['failure','scan','incomplete'],['blocked','threat','blocked'],['malware','threat','blocked']]){
   process.env.ONE_ARCHIVE_SCAN_TEST=mode;const before=await fs.readdir(root);
   await assert.rejects(extract({parent:target,destination:'here',conflict:'replace'}),error=>error.code===code&&error.scan.state===state&&(state!=='blocked'||error.scan.provider==='Isolated test provider'));
   assert.equal(await fs.readFile(existing,'utf8'),'preserve original');assert.deepEqual(await fs.readdir(target),['中文 readme.txt']);assert.deepEqual(await fs.readdir(root),before);assert.equal((await tasks.overview()).recent[0].scan.state,state);
  }
  process.env.ONE_ARCHIVE_SCAN_TEST='stall';process.env.ONE_ARCHIVE_SCAN_TIMEOUT_MS='100';const started=Date.now();await assert.rejects(extract(),error=>error.code==='scan'&&error.scan.state==='incomplete'&&error.scan.reason.includes('时限'));assert(Date.now()-started<10000);
  cancelOnScan=true;await assert.rejects(extract(),error=>error.code==='cancelled');assert.equal(cancelOnScan,false);
  delete process.env.ONE_ARCHIVE_SCAN_TIMEOUT_MS;
  process.env.ONE_ARCHIVE_SCAN_TEST='passed';
  const merged=await extract({parent:target,destination:'here',conflict:'skip'});assert.equal(merged.scan.files,2);assert.equal(merged.skipped,1);assert.equal(await fs.readFile(existing,'utf8'),'preserve original');
  for(const format of ['7z','tar','gz','xz','tar.gz','tar.xz']){const file=path.join(root,'format.'+format);await run({operation:'create',path:file,sources:[source],level:1});const result=await run({operation:'extract',path:file,parent:root,destination:'smart'});assert.equal(result.scan.state,'passed');assert.equal(result.scan.files,1);assert.equal(await fs.readFile(result.path,'utf8'),'benign input');}
  for(const fixture of ['rar4-sample.rar','rar5-sample.rar']){const file=path.join(root,fixture);await fs.copyFile(path.resolve('tests/fixtures',fixture),file);const result=await run({operation:'extract',path:file,parent:root});assert.equal(result.scan.state,'passed');assert(result.scan.files>0);}
  const decrypted=await run({operation:'extract',path:encrypted,parent:root,password:'private scan password'});assert.equal(decrypted.scan.files,1);
  const packet=Buffer.alloc(9);packet.writeUInt32LE(1);packet.writeUInt32LE(listing.entries.find(item=>item.name==='中文 readme.txt').index,4);packet[8]=1;
  const drag=native(['drag-test',archive,path.join(root,'drag-stage'),'0',listing.revision],{},packet);assert.equal(drag.status,0,drag.stderr);assert(drag.events.some(item=>item.type==='scan'&&item.state==='passed'&&item.files===1));
  const denied=native(['drag-test',archive,path.join(root,'drag-denied'),'0',listing.revision],{ONE_ARCHIVE_SCAN_TEST:'blocked'},packet);assert.notEqual(denied.status,0);assert(denied.events.some(item=>item.type==='scan'&&item.state==='blocked'));
  // A real benign AMSI call: record an honest result, without changing AV
  // settings or sending any malware signature to the installed provider.
  const real=path.join(root,'real-provider');await fs.mkdir(real);await fs.writeFile(path.join(real,'benign.txt'),'One archive scan benign fixture');
  const provider=native(['scan-test',real],{ONE_ARCHIVE_SCAN_TEST:''});const realReport=provider.events.find(item=>item.type==='scan');assert(realReport);assert(['passed','incomplete'].includes(realReport.state));assert.equal(provider.status,realReport.state==='passed'?0:2);console.log('Real benign AMSI:',JSON.stringify(realReport));
  const gated=native(['scan-test',real],{ONE_TEST_MODE:'0',ONE_ARCHIVE_SCAN_TEST:'passed'});assert.equal(gated.status,2);
  const linked=path.join(root,'hard-links');await fs.mkdir(linked);await fs.link(path.join(real,'benign.txt'),path.join(linked,'linked.txt'));const hardLink=native(['scan-test',linked]);assert.equal(hardLink.status,2);assert.equal(hardLink.events.at(-1).code,'safety');assert(hardLink.events.some(item=>item.type==='scan'&&item.state==='incomplete'));await fs.unlink(path.join(linked,'linked.txt'));
  const junction=path.join(root,'junction');await fs.symlink(real,junction,'junction');const linkedPath=native(['scan-test',junction]);assert.equal(linkedPath.status,2);assert.equal(linkedPath.events.at(-1).code,'safety');await fs.unlink(junction);
  const sparse=path.join(root,'large-stream');await fs.mkdir(sparse);const large=path.join(sparse,'over-4GiB.bin');await fs.writeFile(large,'');const sparseFlag=spawnSync('fsutil.exe',['sparse','setflag',large],{encoding:'utf8',windowsHide:true});assert.equal(sparseFlag.status,0,sparseFlag.stdout+sparseFlag.stderr);
  const length=2**32+17,handle=await fs.open(large,'r+');try{await handle.truncate(length);await handle.write(Buffer.from([91]),0,1,length-1);}finally{await handle.close();}
  const stream=native(['scan-test',sparse],{ONE_ARCHIVE_SCAN_TEST:'stream'});assert.equal(stream.status,0,stream.stderr);assert(stream.events.some(item=>item.type==='scan-stream-test'&&item.length===String(length)&&item.tail===91));
  process.env.ONE_ARCHIVE_SCAN_TEST='failure';const output=[];const exit=await runCli(parseCli(['extract','--scan','--json','--output',root,archive],root),service,{out:async line=>output.push(JSON.parse(line)),err:async()=>{},signal:new AbortController().signal,password:async()=>''});assert.equal(exit,10);assert.equal(output.find(item=>item.type==='error').scan.state,'incomplete');
  // Exercise the service's protocol gate using a real helper and staged
  // extraction, with only its terminal report omitted or corrupted in transit.
  process.env.ONE_ARCHIVE_SCAN_TEST='passed';const processes=require('node:child_process'),realSpawn=processes.spawn;
  for(const mode of ['omit','invalid']){let intercepted=false;const before=await fs.readdir(root);try{
   processes.spawn=(...args)=>{const child=realSpawn(...args);if(args[0]===helper&&args[1][0]==='extract'){intercepted=true;let pending='';const filter=new Transform({transform(chunk,_encoding,callback){pending+=chunk.toString('utf8');let end;while((end=pending.indexOf('\n'))>=0){const line=pending.slice(0,end);pending=pending.slice(end+1);const message=JSON.parse(line);if(message.type==='scan'){if(mode==='omit')continue;message.files=0;delete message.provider;}this.push(JSON.stringify(message)+'\n');}callback();}});child.stdout=child.stdout.pipe(filter);}return child;};
   await assert.rejects(extract(),error=>error.code==='scan'&&error.scan.state==='incomplete');assert(intercepted);assert.deepEqual(await fs.readdir(root),before);
  }finally{processes.spawn=realSpawn;}}
  assert.deepEqual(await fs.readFile(archive),original);assert(!(await fs.readdir(root)).some(name=>/^\.one-(extract|recovery)-/.test(name)));assert(!JSON.stringify(events).includes('private scan password'));
  await service.stop();service=undefined;const persisted=await new ArchiveTasks(historyFile).overview();assert(persisted.recent.some(item=>item.scan?.state==='passed'));assert(persisted.recent.some(item=>item.scan?.state==='incomplete'));assert(persisted.recent.some(item=>item.scan?.state==='blocked'));
  console.log('Archive scan passed: optional persisted settings, CLI policy, streaming >4 GiB, real benign provider, selected/encrypted/multi-format/composite files, empty files, virtual drag, failure/timeout/cancellation before publication and persisted results.');
 }finally{await service?.stop();for(const key of keys){if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];}const child=path.relative(path.resolve('work/temp'),root);assert(child&&!child.startsWith('..')&&!path.isAbsolute(child));await fs.rm(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
