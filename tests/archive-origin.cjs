const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const sync=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const {spawnSync}=require('node:child_process');
const {build}=require('esbuild');
const JSZip=require('jszip');
const canonical=zone=>`[ZoneTransfer]\r\nZoneId=${zone}\r\n`;
async function main(){
 await fs.mkdir('work/temp',{recursive:true});const root=await fs.mkdtemp(path.resolve('work/temp/one-archive-origin-'));let service;
 const helper=path.resolve('dist/native/One.Archive.exe');
 const native=(args,env={},expected=0,extra=Buffer.alloc(0))=>{const result=spawnSync(helper,args,{input:Buffer.concat([Buffer.alloc(4),extra]),env:{...process.env,TEMP:root,TMP:root,...env},encoding:'utf8',timeout:60000,maxBuffer:4*1024**2,windowsHide:true});assert.equal(result.status,expected,result.stdout+'\n'+result.stderr+'\n'+result.error);return result.stdout.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);};
 const ads=file=>file+':Zone.Identifier';const absent=async file=>assert.rejects(fs.readFile(ads(file)),{code:'ENOENT'});
 try{
  const compiled=await build({entryPoints:['src/main/archive-service.ts','src/main/archive-cli.ts','src/shared/settings.ts'],outdir:'virtual',bundle:true,platform:'node',format:'cjs',write:false});
  const load=name=>{const filename=path.resolve('dist/main/'+name+'-origin-test.cjs'),mod=new Module(filename);mod.filename=filename;mod.paths=module.paths;mod._compile(compiled.outputFiles.find(file=>file.path.endsWith(name+'.js')).text,filename);return mod.exports;};
  const {ArchiveService}=load('archive-service'),{parseCli,CliFailure}=load('archive-cli'),{defaultSettings,validateSettings,mergeSettings}=load('settings');
  const old=defaultSettings();delete old.archive.propagateZone;assert.equal(validateSettings(old).archive.propagateZone,true);
  const disabled=mergeSettings(defaultSettings(),{archive:{propagateZone:false}});assert.equal(validateSettings(JSON.parse(JSON.stringify(disabled))).archive.propagateZone,false);
  for(const value of [null,0,1,'false',{}])assert.throws(()=>mergeSettings(defaultSettings(),{archive:{propagateZone:value}}));
  assert.equal(parseCli(['extract','--output',root,'--no-zone','file.zip'],root).jobs[0].request.propagateZone,false);
  assert.equal(parseCli(['extract','--output',root,'file.zip'],root).jobs[0].request.propagateZone,true);
  for(const args of [['list','--no-zone','a.zip'],['create','--no-zone','--output','a.zip','input'],['extract','--no-zone=true','--output',root,'a.zip']])assert.throws(()=>parseCli(args,root),CliFailure);
  const archive=path.join(root,'download.zip'),zip=new JSZip();zip.file('first.cmd','echo safe fixture');zip.file('folder/readme.txt','source origin');zip.file('empty.bin','');zip.folder('empty-dir');await fs.writeFile(archive,await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}));
  const original=await fs.readFile(archive);let preferences={propagateZone:true},inject=false;const events=[];
  service=new ArchiveService(path.join(root,'cache'),(_owner,progress)=>{if(inject&&progress.operation==='extract'&&progress.done===1){const dirs=sync.readdirSync(root).filter(name=>name.startsWith('.one-extract-'));if(dirs.length)sync.writeFileSync(ads(path.join(root,dirs[0],'first.cmd')),canonical(4));inject=false;}},()=> '0',(event,detail)=>events.push({event,detail}),false,undefined,()=>({...preferences,threads:2,memoryMiB:256}));
  const run=request=>service.run(1,request),extract=extra=>run({operation:'extract',path:archive,parent:root,...extra});
  const unmarked=await extract();await absent(path.join(unmarked.path,'first.cmd'));
  const metadata='[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=https://user:secret@example.test/download?token=private\r\nReferrerUrl=https://example.test/\r\n';await fs.writeFile(ads(archive),metadata);
  const folder=await extract();for(const name of ['first.cmd','folder/readme.txt','empty.bin'])assert.equal(await fs.readFile(ads(path.join(folder.path,name)),'utf8'),canonical(3));await absent(path.join(folder.path,'empty-dir'));
  const selectedList=await run({operation:'list',path:archive});const selected=await extract({selected:[selectedList.entries.find(item=>item.name==='folder/readme.txt').index]});assert.equal(await fs.readFile(ads(path.join(selected.path,'folder/readme.txt')),'utf8'),canonical(3));assert(!sync.existsSync(path.join(selected.path,'first.cmd')));
  const smart=await extract({destination:'smart'});assert.equal(await fs.readFile(ads(path.join(smart.path,'folder/readme.txt')),'utf8'),canonical(3));
  const parent=path.join(root,'existing');await fs.mkdir(parent);const existing=path.join(parent,'first.cmd');await fs.writeFile(existing,'keep');await fs.writeFile(ads(existing),canonical(4));
  const skipped=await extract({parent,destination:'here',conflict:'skip'});assert.equal(skipped.skipped,1);assert.equal(await fs.readFile(existing,'utf8'),'keep');assert.equal(await fs.readFile(ads(existing),'utf8'),canonical(4));
  await extract({parent,destination:'here',conflict:'replace'});assert.equal(await fs.readFile(existing,'utf8'),'echo safe fixture');assert.equal(await fs.readFile(ads(existing),'utf8'),canonical(3));
  preferences.propagateZone=false;const noDefault=await extract();await absent(path.join(noDefault.path,'first.cmd'));
  const override=await extract({propagateZone:true});assert.equal(await fs.readFile(ads(path.join(override.path,'first.cmd')),'utf8'),canonical(3));preferences.propagateZone=true;
  const noRequest=await extract({propagateZone:false});await absent(path.join(noRequest.path,'first.cmd'));
  await assert.rejects(extract({propagateZone:'false'}),/来源标记/);
  // Only source metadata changes: the cached composite contents must still
  // use the latest original archive's zone, never the unmarked inner TAR.
  const source=path.join(root,'input.txt');await fs.writeFile(source,'origin formats');
  const single=path.join(root,'single.zip');await run({operation:'create',path:single,sources:[source]});await fs.writeFile(ads(single),canonical(3));const singleResult=await run({operation:'extract',path:single,parent:root,destination:'smart'});assert.equal(await fs.readFile(ads(singleResult.path),'utf8'),canonical(3));assert((await fs.stat(singleResult.path)).isFile());
  for(const format of ['7z','tar','gz','xz','tar.gz','tar.xz']){
   const archive=path.join(root,'format.'+format);await run({operation:'create',path:archive,sources:[source],level:1});await fs.writeFile(ads(archive),canonical(3));
   const request={operation:'extract',path:archive,parent:root,destination:'folder'};const first=await run(request);
   const outputFiles=await fs.readdir(first.path);assert.equal(outputFiles.length,1);assert.equal(await fs.readFile(ads(path.join(first.path,outputFiles[0])),'utf8'),canonical(3));
   await fs.writeFile(ads(archive),Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from('[zonetransfer]\r\n zoneid = 4\r\nHostUrl=测试\r\n','utf16le')]));
   const second=await run(request);assert.equal(await fs.readFile(ads(path.join(second.path,outputFiles[0])),'utf8'),canonical(4));
  }
  const split=path.join(root,'split.7z');await run({operation:'create',path:split,sources:[source],volumeBytes:1024**2});await fs.writeFile(ads(split+'.001'),canonical(4));const splitResult=await run({operation:'extract',path:split+'.001',parent:root});assert.equal(await fs.readFile(ads(path.join(splitResult.path,'input.txt')),'utf8'),canonical(4));
  for(const fixture of ['rar4-sample.rar','rar5-sample.rar']){const source=path.join(root,fixture);await fs.copyFile(path.resolve('tests/fixtures',fixture),source);await fs.writeFile(ads(source),canonical(3));const result=await run({operation:'extract',path:source,parent:root});const scan=async folder=>{for(const item of await fs.readdir(folder,{withFileTypes:true})){if(item.isDirectory())await scan(path.join(folder,item.name));else assert.equal(await fs.readFile(ads(path.join(folder,item.name)),'utf8'),canonical(3));}};await scan(result.path);}
  for(const format of ['zip','7z']){
   const edited=path.join(root,'edited.'+format);await run({operation:'create',path:edited,sources:[source],password:'origin-test'});await fs.writeFile(ads(edited),metadata);
   const listed=await run({operation:'list',path:edited,password:'origin-test'});await run({operation:'update',path:edited,password:'origin-test',revision:listed.revision,changes:[{kind:'rename',index:0,name:'renamed.txt'}]});assert.equal(await fs.readFile(ads(edited),'utf8'),metadata,'Atomic archive editing must preserve existing source streams');
   const result=await run({operation:'extract',path:edited,parent:root,password:'origin-test'});assert.equal(await fs.readFile(ads(path.join(result.path,'renamed.txt')),'utf8'),canonical(3));
  }
  for(const zone of [0,1,2]){await fs.writeFile(ads(archive),canonical(zone));const result=await extract();await absent(path.join(result.path,'first.cmd'));}
  await fs.writeFile(ads(archive),'\uFEFF[ZoneTransfer]\nZoneId=4\nHostUrl=任意 URL\n');const restricted=await extract();assert.equal(await fs.readFile(ads(path.join(restricted.path,'empty.bin')),'utf8'),canonical(4));
  for(const mark of ['','[ZoneTransfer]\nZoneId=5','[ZoneTransfer]\nZoneId=-1','[ZoneTransfer]\nZoneId=3\nZoneId=2','[ZoneTransfer]\nZoneId=3\n[ZoneTransfer]\nZoneId=4','[Other]\nZoneId=3','[ZoneTransfer]\nZoneId=3\0',canonical(3)+'x'.repeat(4096),Buffer.from([0xff,0xfe,0x41]),Buffer.from([0xff,0xfe,0,0xd8])]){
   await fs.writeFile(ads(archive),mark);await assert.rejects(extract(),error=>error.code==='safety');assert(!(await fs.readdir(root)).some(name=>name.startsWith('.one-extract-')));
  }
  const ignoreMalformed=await extract({propagateZone:false});await absent(path.join(ignoreMalformed.path,'first.cmd'));
  await fs.writeFile(ads(archive),canonical(3));const listing=await run({operation:'list',path:archive});
  const packet=Buffer.alloc(9);packet.writeUInt32LE(1);packet.writeUInt32LE(listing.entries.find(item=>item.name==='first.cmd').index,4);packet[8]=1;
  const stage=path.join(root,'drag-stage'),drag=native(['drag-test',archive,stage,'0',listing.revision],{ONE_TEST_MODE:'1'},0,packet);assert(drag.some(item=>item.type==='drag-origin'&&item.untrusted));assert.equal(await fs.readFile(ads(path.join(stage,'first.cmd')),'utf8'),canonical(3));
  const noStage=path.join(root,'drag-disabled'),noDrag=native(['drag-test',archive,noStage,'0',listing.revision],{ONE_TEST_MODE:'1',ONE_ARCHIVE_PROPAGATE_ZONE:'0'},0,packet);assert(noDrag.some(item=>item.type==='drag-origin'&&!item.untrusted));await absent(path.join(noStage,'first.cmd'));
  const invalid=native(['extract',archive,path.join(root,'invalid-stamp'),'','0'],{ONE_ARCHIVE_ZONE_STAMP:'wrong'},2);assert.equal(invalid.at(-1).code,'safety');assert(!sync.existsSync(path.join(root,'invalid-stamp')));
  // Real CREATE_NEW stream failure after extraction: pre-existing metadata
  // is never overwritten, and the service must not publish any output.
  const failureZip=new JSZip();failureZip.file('first.cmd','first');failureZip.file('large.bin',Buffer.alloc(32*1024**2,42));const failedArchive=path.join(root,'write-failure.zip');await fs.writeFile(failedArchive,await failureZip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}));await fs.writeFile(ads(failedArchive),canonical(3));inject=true;
  await assert.rejects(run({operation:'extract',path:failedArchive,parent:root}),error=>error.code==='write');assert.equal(inject,false);assert(!sync.existsSync(path.join(root,'write-failure')));assert(!(await fs.readdir(root)).some(name=>name.startsWith('.one-extract-')));
  assert.deepEqual(await fs.readFile(archive),original);assert.equal(await fs.readFile(ads(archive),'utf8'),canonical(3));
  assert(events.some(item=>item.event==='archive-source-zone'));assert(!JSON.stringify(events).includes('secret'));assert(!JSON.stringify(events).includes('HostUrl'));
  console.log('Archive origin passed: settings/backup/CLI policy, ZIP/7Z/TAR/GZ/XZ/composites/split 7Z, smart/here/skip/replace, source-only URL privacy, UTF-8/UTF-16 metadata, malformed bounds, real stream failure rollback and untrusted virtual drag metadata.');
 }finally{if(service)await service.stop();const relative=path.relative(path.resolve('work/temp'),root);assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));await fs.rm(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
