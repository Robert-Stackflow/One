const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),Module=require('node:module'),{build}=require('esbuild');
const {createHash,randomUUID}=require('node:crypto'),{until}=require('./archive-edit-test-helpers.cjs');
async function compile(entry){const result=await build({entryPoints:[entry],bundle:true,platform:'node',format:'cjs',write:false}),file=path.resolve('dist/main/archive-edit-recovery-test.cjs'),mod=new Module(file);mod.filename=file;mod.paths=Module._nodeModulePaths(path.dirname(file));mod._compile(result.outputFiles[0].text,file);return mod.exports;}
const hash=async file=>createHash('sha256').update(await fs.readFile(file)).digest('hex');
async function main(){
 await fs.mkdir('work/temp',{recursive:true});const root=await fs.mkdtemp(path.resolve('work/temp/one-archive-edit-recovery-'));const prior={TEMP:process.env.TEMP,TMP:process.env.TMP};process.env.TEMP=root;process.env.TMP=root;
 let service,edits,checks=0;const pass=()=>checks++;
 try{
  const {ArchiveService}=await compile('src/main/archive-service.ts'),{ArchiveEditSessions}=await compile('src/main/archive-edit-sessions.ts');
  const profile=path.join(root,'profile');await fs.mkdir(profile);service=new ArchiveService(path.join(profile,'cache'),()=>{});const run=request=>service.run(51,request);
  const source=path.join(root,'说明.txt'),other=path.join(root,'other.txt'),archive=path.join(root,'edit.zip');await fs.writeFile(source,'original');await fs.writeFile(other,'other');await run({operation:'create',path:archive,sources:[source]});
  let failure='',exit,releases=0;const events=[],launches=[];
  const launcher=async(file,mode)=>{launches.push({file,mode});return{tracked:mode!=='choose',exited:new Promise(resolve=>exit=resolve),release(){releases++;}};};
  const engine=async(owner,request,id)=>{if(request.operation==='update'&&failure==='before')throw Error('simulated loss before commit');const result=await service.run(owner,request,id);if(request.operation==='update'&&failure==='after')throw Error('simulated lost acknowledgement');return result;};
  const create=()=>new ArchiveEditSessions(path.join(profile,'edits'),engine,launcher,item=>events.push(item));edits=create();
  const listing=await run({operation:'list',path:archive});const edit=await edits.start(51,{path:archive,revision:listing.revision,index:listing.entries[0].index});const folder=path.dirname(path.dirname(edit.file)),journal=path.join(folder,'session.json');
  await edits.open(edit.id);assert.equal((await edits.check(edit.id)).editor,'running');await assert.rejects(edits.open(edit.id),/仍在运行/);pass();
  // Atomic save/rename is common in Office and text editors. Directory watching
  // must follow the replacement, rather than the old file's inode.
  const temporary=path.join(path.dirname(edit.file),'atomic.tmp');await fs.writeFile(temporary,'atomic change');await fs.rename(temporary,edit.file);
  await until(()=>events.find(item=>item.id===edit.id&&item.changed&&item.token));pass();
  exit('closed');await until(()=>events.find(item=>item.editor==='closed'));pass();
  await edits.open(edit.id,true);assert.equal(launches.at(-1).mode,'choose');assert.equal((await edits.check(edit.id)).editor,'untracked');exit('unknown');pass();
  let current=await edits.check(edit.id);const exported=path.join(root,'export.txt');await fs.writeFile(edit.file+':Zone.Identifier','[ZoneTransfer]\r\nZoneId=3\r\n');await edits.export(edit.id,current.token,exported);assert.equal(await hash(exported),current.token);assert.match(await fs.readFile(exported+':Zone.Identifier','utf8'),/ZoneId=3/);await assert.rejects(edits.export(edit.id,current.token,exported),/已存在/);assert.equal(await hash(exported),current.token);await assert.rejects(edits.export(edit.id,current.token,path.join(folder,'outside.txt')),/以外/);pass();
  for(const mode of ['before','after']){
   failure=mode;await fs.writeFile(edit.file,'approved '+mode);current=await edits.check(edit.id);const before=await hash(archive);
   await assert.rejects(edits.save(51,edit.id,current.token),/核对原包/);assert.equal((await edits.check(edit.id)).state,'writing');if(mode==='before')assert.equal(await hash(archive),before);else assert.notEqual(await hash(archive),before);
   await assert.rejects(edits.discard(edit.id,current.token),/尚未确认/);pass();
   await edits.stop();edits=create();assert.equal((await edits.list()).items[0].state,'writing');failure='';
   const resolution=await edits.inspect(51,edit.id);assert.equal(resolution.committed,mode==='after');
   if(mode==='after')await fs.writeFile(edit.file,'new edit after interrupted acknowledgement');
   // A durable but unrenamed journal from a crash is recognized and retired.
   await fs.copyFile(journal,path.join(folder,'session.next'));
   const recovered=await edits.resolve(51,edit.id,resolution.token);assert.equal(recovered.state,mode==='after'?'saved':'ready');assert.equal(recovered.changed,true);assert.equal((await fs.readdir(folder)).some(name=>name.startsWith('snapshot-')),false);pass();
   await edits.save(51,edit.id,recovered.token);assert.equal((await edits.check(edit.id)).changed,false);pass();
  }
  const mutate=async changes=>{const live=await run({operation:'list',path:archive});return run({operation:'update',path:archive,revision:live.revision,changes});};
  await fs.writeFile(edit.file,'my change');current=await edits.check(edit.id);await mutate([{kind:'add',source:other,name:'other.txt'}]);await assert.rejects(edits.save(51,edit.id,current.token),/变化/);let resolution=await edits.inspect(51,edit.id);assert.equal(resolution.same,true);pass();
  // A second original-archive change invalidates approval of the first revision.
  await fs.writeFile(other,'new other');await mutate([{kind:'add',source:other,name:'other.txt',replace:true}]);await assert.rejects(edits.resolve(51,edit.id,resolution.token),/确认后又发生变化/);pass();
  resolution=await edits.inspect(51,edit.id);await edits.resolve(51,edit.id,resolution.token);await edits.save(51,edit.id,(await edits.check(edit.id)).token);pass();
  await fs.writeFile(source,'other editor change');await mutate([{kind:'add',source,name:'说明.txt',replace:true}]);resolution=await edits.inspect(51,edit.id);assert.equal(resolution.same,false);assert.equal(resolution.missing,false);await edits.resolve(51,edit.id,resolution.token);assert.equal((await edits.check(edit.id)).changed,true);await edits.save(51,edit.id,(await edits.check(edit.id)).token);pass();
  const latest=await run({operation:'list',path:archive});await mutate([{kind:'delete',indexes:[latest.entries.find(entry=>entry.name==='说明.txt').index]}]);resolution=await edits.inspect(51,edit.id);assert.equal(resolution.missing,true);await edits.resolve(51,edit.id,resolution.token);current=await edits.check(edit.id);assert.equal(current.changed,true);await edits.save(51,edit.id,current.token);assert.ok((await run({operation:'list',path:archive})).entries.some(entry=>entry.name==='说明.txt'));pass();
  // Unknown next-journal data is retained, never overwritten or silently erased.
  resolution=await edits.inspect(51,edit.id);await fs.writeFile(path.join(folder,'session.next'),'unknown user data');await assert.rejects(edits.resolve(51,edit.id,resolution.token));assert.equal(await fs.readFile(path.join(folder,'session.next'),'utf8'),'unknown user data');await fs.unlink(path.join(folder,'session.next'));pass();
  await edits.resolve(51,edit.id,resolution.token);await edits.discard(edit.id,(await edits.check(edit.id)).token);assert.equal((await edits.list()).items.length,0);assert.ok(releases>=1);pass();
  const finalList=await run({operation:'list',path:archive}),last=await edits.start(51,{path:archive,revision:finalList.revision,index:finalList.entries.find(entry=>entry.name==='说明.txt').index}),lastFolder=path.dirname(path.dirname(last.file)),lastJournal=path.join(lastFolder,'session.json');
  let record=JSON.parse(await fs.readFile(lastJournal,'utf8'));const pending={file:'snapshot-'+randomUUID()+'.txt',token:'1'.repeat(64)};await fs.writeFile(path.join(lastFolder,pending.file),'incomplete snapshot');await fs.writeFile(lastJournal,JSON.stringify({...record,state:'writing',pending}));
  resolution=await edits.inspect(51,last.id);assert.equal(resolution.committed,false);await edits.resolve(51,last.id,resolution.token);await assert.rejects(fs.stat(path.join(lastFolder,pending.file)),{code:'ENOENT'});pass();
  record=JSON.parse(await fs.readFile(lastJournal,'utf8'));const retired={file:'snapshot-'+randomUUID()+'.txt',token:'2'.repeat(64)};await fs.writeFile(path.join(lastFolder,retired.file),'interrupted export');await fs.writeFile(lastJournal,JSON.stringify({...record,retired:[retired]}));await edits.stop();edits=create();await edits.list();await assert.rejects(fs.stat(path.join(lastFolder,retired.file)),{code:'ENOENT'});pass();
  await fs.rename(lastJournal,path.join(lastFolder,'session.next'));assert.equal((await edits.check(last.id)).id,last.id);await fs.stat(lastJournal);await assert.rejects(fs.stat(path.join(lastFolder,'session.next')),{code:'ENOENT'});pass();
  record=JSON.parse(await fs.readFile(lastJournal,'utf8'));const inspection='inspect-'+randomUUID(),inspectionRoot=path.join(lastFolder,inspection),inspectionOutput=path.join(inspectionRoot,'edit');await fs.mkdir(inspectionOutput,{recursive:true});await fs.writeFile(path.join(inspectionOutput,'说明.txt'),'partial inspection');await fs.writeFile(lastJournal,JSON.stringify({...record,scratch:[inspection]}));await edits.list();await assert.rejects(fs.stat(inspectionRoot),{code:'ENOENT'});pass();
  const originalArchive=await fs.readFile(archive),JSZip=require('jszip'),duplicates=new JSZip();duplicates.file('说明.txt','first');duplicates.file('备用.txt','second');const duplicateBytes=await duplicates.generateAsync({type:'nodebuffer'}),needle=Buffer.from('备用.txt'),replacement=Buffer.from('说明.txt');for(let offset=0;(offset=duplicateBytes.indexOf(needle,offset))>=0;offset+=needle.length)replacement.copy(duplicateBytes,offset);await fs.writeFile(archive,duplicateBytes);await assert.rejects(edits.inspect(51,last.id),/同名|collid|duplicate/i);await fs.writeFile(archive,originalArchive);resolution=await edits.inspect(51,last.id);await edits.resolve(51,last.id,resolution.token);pass();
  // Existing version-1 copies remain editable after the application upgrade.
  await edits.stop();record=JSON.parse(await fs.readFile(lastJournal,'utf8'));const legacy=path.join(lastFolder,'document.txt');await fs.rename(last.file,legacy);await fs.rmdir(path.dirname(last.file));await fs.writeFile(lastJournal,JSON.stringify({...record,version:1,file:legacy}));edits=create();await edits.list();await fs.writeFile(legacy,'legacy continued');current=await edits.check(last.id);await edits.save(51,last.id,current.token);await edits.discard(last.id,(await edits.check(last.id)).token);pass();
  console.log(JSON.stringify({result:'PASS',checks,scope:'atomic saves, automatic detection, process lifecycle, choose-program fallback, exclusive export and origin mark, continuous editing, pre/post-commit interruption, restart, stale journals, unrelated/conflicting/deleted source entries, expired approval, explicit cleanup'}));
 }finally{await edits?.stop();await service?.stop();for(const [key,value]of Object.entries(prior)){if(value===undefined)delete process.env[key];else process.env[key]=value;}assert.ok(root.startsWith(path.resolve('work/temp')+path.sep));await fs.rm(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
