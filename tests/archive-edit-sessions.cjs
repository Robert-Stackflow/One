// Real ZIP/7Z transactions and persistent edit copies, without launching apps.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {randomUUID,createHash}=require('node:crypto'),Module=require('node:module'),{build}=require('esbuild');
async function compile(entry){const result=await build({entryPoints:[entry],bundle:true,platform:'node',format:'cjs',write:false}),file=path.resolve('dist/main/archive-edit-sessions-test.cjs'),mod=new Module(file);mod.filename=file;mod.paths=Module._nodeModulePaths(path.dirname(file));mod._compile(result.outputFiles[0].text,file);return mod.exports;}
const hash=async file=>createHash('sha256').update(await fs.readFile(file)).digest('hex');
async function main(){
 await fs.mkdir('work/temp',{recursive:true});const root=await fs.mkdtemp(path.resolve('work/temp/one-archive-edit-sessions-'));
 const prior={TEMP:process.env.TEMP,TMP:process.env.TMP};process.env.TEMP=root;process.env.TMP=root;
 let service,checks=0;const pass=()=>checks++;
 try{
  const {ArchiveService}=await compile('src/main/archive-service.ts'),{ArchiveEditSessions}=await compile('src/main/archive-edit-sessions.ts');
  const profile=path.join(root,'profile');await fs.mkdir(profile);
  const launches=[];service=new ArchiveService(path.join(profile,'cache'),()=>{},undefined,undefined,false,undefined,undefined,undefined,async file=>{launches.push(file);return '';});
  const sources=path.join(root,'资料');await fs.mkdir(sources);await fs.writeFile(path.join(sources,'说明.txt'),'original');await fs.writeFile(path.join(sources,'run.cmd'),'echo executable');
  const run=request=>service.run(41,request);
  for(const [format,password,volumeBytes] of [['zip','',0],['7z','',0],['zip',' secret 中文 ',0],['7z',' secret 中文 ',0],['zip','',1048576],['7z','',1048576]]){
   const tag=`${format}-${password?'encrypted':'plain'}-${volumeBytes?'split':'single'}`,archive=path.join(root,tag+'.'+format),created=await run({operation:'create',path:archive,sources:[sources],password,volumeBytes});
   const target=created.path,listing=await run({operation:'list',path:target,password});assert.ok(listing.revision);const chosen=listing.entries.find(e=>e.name.replaceAll('\\','/')==='资料/说明.txt');assert.ok(chosen,tag+': '+listing.entries.map(e=>e.name).join(', '));const index=chosen.index;
   const request={path:target,revision:listing.revision,index,password};const before=await hash(target);
   const edit=await service.edits.start(41,request,randomUUID());assert.equal(await fs.readFile(edit.file,'utf8'),'original');assert.equal((await service.edits.check(edit.id)).changed,false);pass();
   await service.edits.open(edit.id);assert.equal(launches.at(-1),edit.file);pass();
   const journal=await fs.readFile(path.join(path.dirname(edit.file),'session.json'),'utf8');assert.ok(!journal.includes('secret'));assert.ok(!journal.includes('password"'));pass();
   await fs.writeFile(edit.file,'changed '+tag);const changed=await service.edits.check(edit.id);assert.equal(changed.changed,true);
   await fs.writeFile(edit.file,'newer '+tag);await assert.rejects(service.edits.save(41,edit.id,changed.token,password),/确认后已变化/);assert.equal(await hash(target),before);assert.equal(await fs.readFile(edit.file,'utf8'),'newer '+tag);pass();
   const token=(await service.edits.check(edit.id)).token;
   await assert.rejects(service.edits.discard(edit.id,changed.token),/确认后已变化/);pass();
   const restarted=new ArchiveEditSessions(path.join(profile,'archive-edits'),(owner,request,id)=>service.run(owner,request,id),async()=> 'association failure');
   assert.ok((await restarted.list()).items.some(item=>item.id===edit.id));assert.equal((await restarted.check(edit.id)).token,token);await assert.rejects(restarted.open(edit.id),/association failure/);pass();
   // Two copies opened at the same original revision must not overwrite each other.
   const stale=await service.edits.start(41,request);await fs.writeFile(stale.file,'stale edit');const staleToken=(await service.edits.check(stale.id)).token;
   const outcome=await service.edits.save(41,edit.id,token,password,randomUUID());assert.equal(outcome.path,target);assert.equal((await service.edits.check(edit.id)).state,'saved');pass();
   const after=await hash(target);assert.notEqual(after,before);await assert.rejects(service.edits.save(41,stale.id,staleToken,password),/变化|重新|revision/i);assert.equal(await hash(target),after);assert.equal(await fs.readFile(stale.file,'utf8'),'stale edit');pass();
   await assert.rejects(service.edits.save(41,edit.id,token,password),/已经保存/);pass();
   const extracted=await run({operation:'extract',path:target,parent:root,destination:'folder',password});assert.equal(await fs.readFile(path.join(extracted.path,'资料','说明.txt'),'utf8'),'newer '+tag);await run({operation:'test',path:target,password});pass();
   if(password){await assert.rejects(service.edits.start(41,{...request,password:'wrong'}));assert.equal(await hash(target),after);pass();}
   const savedCopy=await service.edits.check(edit.id);await fs.writeFile(path.join(path.dirname(edit.file),'editor-backup.txt'),'keep');await assert.rejects(service.edits.discard(edit.id,savedCopy.token),/其他资料/);assert.equal(await fs.readFile(edit.file,'utf8'),'newer '+tag);await fs.unlink(path.join(path.dirname(edit.file),'editor-backup.txt'));pass();
   await service.edits.discard(edit.id,savedCopy.token);await service.edits.discard(stale.id,staleToken);assert.equal((await service.edits.list()).items.length,0);pass();
  }
  const archive=path.join(root,'cancel.zip');await run({operation:'create',path:archive,sources:[sources]});const listing=await run({operation:'list',path:archive});const request={path:archive,revision:listing.revision,index:listing.entries.find(e=>e.name.endsWith('说明.txt')).index};
  const executable=listing.entries.find(e=>e.name.endsWith('.cmd'));await assert.rejects(service.edits.start(41,{...request,index:executable.index}),/文档、文本和图片/);pass();
  await assert.rejects(service.edits.start(41,{...request,index:listing.entries.find(e=>e.directory).index}),/普通文件/);pass();
  // Cancellation before native work must not create orphan copies or write originals.
  const before=await hash(archive),startId=randomUUID(),starting=service.edits.start(41,request,startId);assert.equal(service.cancel(startId,41),true);
  await assert.rejects(starting,/取消|停止/);assert.equal((await service.edits.list()).items.length,0);assert.equal(await hash(archive),before);pass();
  const edit=await service.edits.start(41,request);await fs.writeFile(edit.file,Buffer.alloc(8*1024*1024,7));const token=(await service.edits.check(edit.id)).token;
  const saveId=randomUUID(),saving=service.edits.save(41,edit.id,token,undefined,saveId);assert.equal(service.cancel(saveId,99),false);assert.equal(service.cancel(saveId,41),true);await assert.rejects(saving,/停止/);assert.equal(await hash(archive),before);assert.equal((await service.edits.check(edit.id)).state,'ready');pass();
  // Unknown/corrupt journal data never grants a path outside the edit directory.
  const recordFile=path.join(path.dirname(edit.file),'session.json'),original=JSON.parse(await fs.readFile(recordFile,'utf8'));
  await fs.writeFile(recordFile,JSON.stringify({...original,file:path.join(root,'victim.txt')}));await assert.rejects(service.edits.check(edit.id),/记录无效/);assert.ok((await service.edits.list()).items[0].error);await fs.writeFile(recordFile,JSON.stringify(original));pass();
  await assert.rejects(service.edits.check('../escape'),/标识无效/);pass();
  // A crash during writeback stays ambiguous; it is never automatically replayed.
  await fs.writeFile(recordFile,JSON.stringify({...original,state:'writing'}));await assert.rejects(service.edits.save(41,edit.id,token),/尚未确认/);assert.equal(await hash(archive),before);await fs.writeFile(recordFile,JSON.stringify(original));pass();
  // Hard-linked and junction-replaced edit files/roots cannot be read or deleted.
  const copy=path.join(root,'copy.txt');await fs.link(edit.file,copy);await assert.rejects(service.edits.check(edit.id),/链接/);await assert.rejects(service.edits.discard(edit.id,token),/链接/);await fs.unlink(copy);pass();
  const folder=path.dirname(edit.file),moved=folder+'-original';await fs.rename(folder,moved);await fs.symlink(root,folder,'junction');await assert.rejects(service.edits.check(edit.id),/替换/);await fs.unlink(folder);await fs.rename(moved,folder);pass();
  await service.edits.discard(edit.id,token);await service.stop();assert.equal(service.pendingTasks,0);await assert.rejects(service.edits.list(),/关闭/);pass();
  console.log(JSON.stringify({result:'PASS',checks,formats:'ZIP/7Z plain/encrypted/split',scope:'edit sessions, immutable approval snapshot, source conflicts, restart, cancellation, corrupt metadata and link safety'}));
 }finally{await service?.stop();for(const [key,value]of Object.entries(prior)){if(value===undefined)delete process.env[key];else process.env[key]=value;}assert.ok(root.startsWith(path.resolve('work/temp')+path.sep));await fs.rm(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
