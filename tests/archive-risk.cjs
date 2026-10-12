const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const Module=require('node:module');
const JSZip=require('jszip');
const {build}=require('esbuild');
const {spawnSync}=require('node:child_process');
const {randomBytes}=require('node:crypto');

async function main(){
 await fs.mkdir('work/temp',{recursive:true});const root=await fs.mkdtemp(path.resolve('work/temp/one-archive-risk-'));let service;
 const keys=['ONE_TEST_MODE','ONE_ARCHIVE_DRAG_TEST_TARGET','TEMP','TMP','ONE_ARCHIVE_RISK_REVISION','ONE_ARCHIVE_EXTRACT_MAX_BYTES','ONE_ARCHIVE_EXTRACT_MAX_MS'];const old=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 try{
  Object.assign(process.env,{ONE_TEST_MODE:'1',ONE_ARCHIVE_DRAG_TEST_TARGET:'1',TEMP:root,TMP:root,ONE_ARCHIVE_RISK_REVISION:'bad inherited value',ONE_ARCHIVE_EXTRACT_MAX_BYTES:'1',ONE_ARCHIVE_EXTRACT_MAX_MS:'1'});
  const built=await build({entryPoints:['src/main/archive-service.ts','src/main/archive-cli.ts','src/main/archive-tasks.ts'],outdir:'virtual',bundle:true,platform:'node',format:'cjs',write:false});
  const load=name=>{const filename=path.resolve('dist/main/'+name+'-risk-test.cjs'),module=new Module(filename);module.filename=filename;module.paths=require.main.paths;module._compile(built.outputFiles.find(file=>file.path.endsWith(name+'.js')).text,filename);return module.exports;};
  const {ArchiveService}=load('archive-service'),{parseCli,runCli}=load('archive-cli'),{ArchiveTasks}=load('archive-tasks');const logs=[],history=new ArchiveTasks(path.join(root,'tasks/history.json'));
  service=new ArchiveService(path.join(root,'cache'),()=>{},()=> '0',(event,detail)=>logs.push({event,detail}),false,history,()=>({threads:1,memoryMiB:256}));
  const run=request=>service.run(1,request),parent=path.join(root,'output');await fs.mkdir(parent);await fs.writeFile(path.join(parent,'keep.txt'),'original');
  await assert.rejects(run(null));await assert.rejects(run({operation:'extract'}));assert.equal(service.pendingTasks,0);
  const approve=(result,limits={})=>{assert(result.risk,'risk confirmation is required');assert.equal(result.count,0);return {revision:result.risk.revision,maxBytes:64*1024**3,maxMilliseconds:30*60000,...limits};};
  const ordinary=new JSZip();ordinary.file('plain.txt','plain');const inner=path.join(root,'inner.zip');await fs.writeFile(inner,await ordinary.generateAsync({type:'nodebuffer'}));
  const safe=path.join(root,'safe.txt');await fs.writeFile(safe,'selected safe item');
  await assert.rejects(run({operation:'extract',path:inner,parent,extractionLimits:{maxBytes:1,maxMilliseconds:60000}}),error=>error.code==='safety');assert.deepEqual(await fs.readdir(parent),['keep.txt']);
  for(const format of ['zip','7z','tar','tar.gz','tar.xz']){
   const archive=path.join(root,'nested.'+format);await run({operation:'create',path:archive,sources:[inner,safe],level:1});
   const listing=await run({operation:'list',path:archive});assert.equal(listing.total,2,'a normal compound wrapper does not require approval');
   const request={operation:'extract',path:archive,parent};const result=await run(request);assert(!result.risk,'nested entries alone do not require approval');assert.equal(await fs.readFile(path.join(result.path,'safe.txt'),'utf8'),'selected safe item');assert.deepEqual(await fs.readFile(path.join(result.path,'inner.zip')),await fs.readFile(inner));await fs.rm(result.path,{recursive:true});
   await assert.rejects(run({...request,extractionLimits:{maxBytes:1,maxMilliseconds:60000}}),error=>error.code==='safety');assert.deepEqual(await fs.readdir(parent),['keep.txt']);
   // Selecting an ordinary file must not warn about unrelated entries.
   const index=listing.entries.find(entry=>entry.name==='safe.txt').index;
   const selected=await run({...request,selected:[index]});assert(!selected.risk);assert.deepEqual(await fs.readdir(selected.path),['safe.txt']);await fs.rm(selected.path,{recursive:true});
   if(['zip','7z'].includes(format)){
    const nestedIndex=listing.entries.find(entry=>entry.name==='inner.zip').index;
    const drag={operation:'drag',path:archive,revision:listing.revision,selected:[nestedIndex]};const copied=await run(drag);assert.equal(copied.count,1);assert(!copied.risk);
   }
   const again=await run(request);assert(!again.risk);await fs.rm(again.path,{recursive:true});
  }
  for(const format of ['gz','xz']){
   const archive=path.join(root,'inner.zip.'+format);await run({operation:'create',path:archive,sources:[inner]});const extracted=await run({operation:'extract',path:archive,parent});assert(!extracted.risk);assert.deepEqual(await fs.readFile(path.join(extracted.path,'inner.zip')),await fs.readFile(inner));await fs.rm(extracted.path,{recursive:true});
  }
  const random=path.join(root,'random.bin');await fs.writeFile(random,randomBytes(2500000));
  for(const format of ['zip','7z']){
   const target=path.join(root,'split.'+format),created=await run({operation:'create',path:target,sources:[random,inner],volumeBytes:1024**2}),archive=created.path;const extracted=await run({operation:'extract',path:archive,parent});assert(!extracted.risk);assert.deepEqual(await fs.readFile(path.join(extracted.path,'random.bin')),await fs.readFile(random));await fs.rm(extracted.path,{recursive:true});
  }
  const subtree=new JSZip();for(let i=0;i<205;i++)subtree.file('picked/item-'+i+'.txt','child',{createFolders:false});subtree.file('picked/zzz.zip','nested',{createFolders:false});subtree.file('outside.txt','safe');const folderArchive=path.join(root,'subtree.zip');await fs.writeFile(folderArchive,await subtree.generateAsync({type:'nodebuffer'}));
  const folderResult=await run({operation:'extract',path:folderArchive,parent,selectedFolders:['picked/']});assert(!folderResult.risk);assert.equal(folderResult.count,206,'implicit selected folders include off-page descendants');await fs.rm(folderResult.path,{recursive:true});
  const high=path.join(root,'high.zip'),highZip=new JSZip();highZip.file('zeros.bin',Buffer.alloc(80*1024**2));
  await fs.writeFile(high,await highZip.generateAsync({type:'nodebuffer',compression:'DEFLATE',compressionOptions:{level:9}}));
  let request={operation:'extract',path:high,parent},result=await run(request);assert.equal(result.risk.highRatio,true);assert.equal(result.risk.nested,0);assert.equal(result.risk.bytes,80*1024**2);
  const approved=approve(result);await assert.rejects(run({...request,riskApproval:{...approved,maxMilliseconds:1}}),error=>error.code==='timeout');assert.deepEqual(await fs.readdir(parent),['keep.txt']);
  const extracted=await run({...request,riskApproval:approved});assert.equal((await fs.stat(path.join(extracted.path,'zeros.bin'))).size,80*1024**2);
  const wrapper=path.join(root,'high-wrapper.tar.gz'),tar=path.join(root,'high-wrapper.tar');await run({operation:'create',path:tar,sources:[path.join(extracted.path,'zeros.bin')]});await fs.writeFile(wrapper,require('node:zlib').gzipSync(await fs.readFile(tar),{level:9}));await fs.rm(tar);await fs.rm(extracted.path,{recursive:true});
  const probe=await run({operation:'list',path:wrapper});assert.equal(probe.risk?.highRatio,true,JSON.stringify({probe,packed:(await fs.stat(wrapper)).size}));const wrapperApproval=approve(probe),listed=await run({operation:'list',path:wrapper,riskApproval:wrapperApproval});assert.equal(listed.total,1);
  const wrapperRequest={operation:'extract',path:wrapper,parent,revision:listed.revision};const wrapperRisk=await run(wrapperRequest);assert.equal(wrapperRisk.risk.highRatio,true,'an approved wrapper cache cannot authorize another request');
  const wrapperOutput=await run({...wrapperRequest,riskApproval:{...wrapperApproval,maxBytes:2*1024**3}});assert.equal((await fs.stat(path.join(wrapperOutput.path,'zeros.bin'))).size,80*1024**2);await fs.rm(wrapperOutput.path,{recursive:true});
  await fs.appendFile(high,'changed');await assert.rejects(run({...request,riskApproval:approved}),error=>error.code==='safety'&&/变化/.test(error.message));assert.deepEqual(await fs.readdir(parent),['keep.txt']);
  // Hostile declared sizes warn before any payload write or decompression.
  const huge=path.join(root,'huge.zip'),fake=Buffer.from(await ordinary.generateAsync({type:'nodebuffer'}));const cd=fake.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));
  // A ZIP64 extra field supplies an otherwise tiny entry's 64 GiB size.
  const nameLength=fake.readUInt16LE(cd+28),extraLength=fake.readUInt16LE(cd+30),extraAt=cd+46+nameLength+extraLength;
  const zip64=Buffer.alloc(12);zip64.writeUInt16LE(1);zip64.writeUInt16LE(8,2);zip64.writeBigUInt64LE(64n*1024n**3n,4);
  fake.writeUInt32LE(0xffffffff,cd+24);fake.writeUInt16LE(extraLength+12,cd+30);const enlarged=Buffer.concat([fake.subarray(0,extraAt),zip64,fake.subarray(extraAt)]);enlarged.writeUInt32LE(enlarged.readUInt32LE(enlarged.length-10)+12,enlarged.length-10);await fs.writeFile(huge,enlarged);
  result=await run({operation:'extract',path:huge,parent});assert.equal(result.risk.bytes,64*1024**3);assert.deepEqual(await fs.readdir(parent),['keep.txt']);
  // Directory count is a separate risk even with no expanded bytes.
  const many=new JSZip();for(let i=0;i<100000;i++)many.folder('d'+i);const crowded=path.join(root,'crowded.zip');await fs.writeFile(crowded,await many.generateAsync({type:'nodebuffer'}));
  result=await run({operation:'extract',path:crowded,parent});assert.equal(result.risk.entries,100000);assert.equal(result.risk.bytes,0);assert.deepEqual(await fs.readdir(parent),['keep.txt']);
  for(const value of [null,{}, {revision:approved.revision,maxBytes:0,maxMilliseconds:1},{revision:approved.revision,maxBytes:64*1024**3,maxMilliseconds:86400001},{...approved,maxBytes:'100'}])await assert.rejects(run({...request,riskApproval:value}));
  const cli=async args=>{const lines=[];const command=parseCli(args,root);const code=await runCli(command,service,{out:async line=>lines.push(...line.trim().split('\n').filter(Boolean).map(JSON.parse)),err:async()=>{},signal:new AbortController().signal,password:async()=>''});return {code,lines};};
  const nestedArchive=path.join(root,'nested.zip');const direct=await cli(['extract','--json','--output',parent,nestedArchive]);assert.equal(direct.code,0);await fs.rm(direct.lines.find(line=>line.type==='result').path,{recursive:true});
  const archive=wrapper;const denied=await cli(['extract','--json','--output',parent,archive]);assert.equal(denied.code,13);assert.equal(denied.lines.find(line=>line.type==='error').risk.highRatio,true);assert(!denied.lines.some(line=>line.type==='result'));
  const accepted=await cli(['extract','--json','--allow-risk','--max-extract-gib','1','--max-extract-minutes','1','--output',parent,archive]);assert.equal(accepted.code,0);assert(accepted.lines.some(line=>line.type==='risk-approved'));const published=accepted.lines.find(line=>line.type==='result');await fs.rm(published.path,{recursive:true});
  assert.throws(()=>parseCli(['extract','--max-extract-gib','1','--output',parent,archive],root));assert.throws(()=>parseCli(['extract','--allow-risk','--max-extract-minutes','1441','--output',parent,archive],root));
  const impossible=await cli(['extract','--json','--allow-risk','--max-extract-gib','1','--output',parent,huge]);assert.equal(impossible.code,7);
  const compound=await cli(['list','--json',path.join(root,'nested.tar.gz')]);assert.equal(compound.code,0,'normal wrapper browsing is not an extraction of nested archive entries');
  assert(logs.some(value=>value.event==='archive-extraction-risk'));assert.deepEqual(await fs.readdir(parent),['keep.txt']);assert.equal(await fs.readFile(path.join(parent,'keep.txt'),'utf8'),'original');
  if(process.env.ONE_ARCHIVE_RISK_CLI){
   const executable=path.resolve(process.env.ONE_ARCHIVE_RISK_CLI),profile=path.join(root,'actual-cli-profile');
   const actual=(args,status)=>{const result=spawnSync(executable,['archive','extract','--json','--output',parent,...args,archive],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:1024**2,env:{...process.env,ONE_DATA_DIR:profile,ONE_ARCHIVE_CLI_PROFILE:profile}});assert.equal(result.status,status,result.stdout+'\n'+result.stderr+'\n'+result.error);return result.stdout.trim().split(/\r?\n/).map(JSON.parse);};
   assert.equal(actual([],13).find(line=>line.type==='error').risk.highRatio,true);const confirmed=actual(['--allow-risk','--max-extract-gib','1'],0);assert(confirmed.some(line=>line.type==='risk-approved'));await fs.rm(confirmed.find(line=>line.type==='result').path,{recursive:true});assert.deepEqual(await fs.readdir(path.join(profile,'archive-cli/temp')),[]);
   console.log('Actual standalone CLI risk refusal, explicit approval, native extraction and temporary cleanup passed.');
  }
  console.log('Extraction risks passed: ZIP/7Z/TAR/GZ/XZ/composites/split, nested and off-page selection/drag, task history, 100,000 directories, ZIP64 declared size, real high-ratio expansion, explicit budgets/deadlines, stale approvals, cache isolation, CLI refusal/approval and unpublished cleanup.');
 }finally{
  await service?.stop();for(const [key,value]of Object.entries(old))if(value===undefined)delete process.env[key];else process.env[key]=value;
  const relative=path.relative(path.resolve('work/temp'),root);assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));await fs.rm(root,{recursive:true,force:true});
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
