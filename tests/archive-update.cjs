const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {spawnSync,spawn}=require('node:child_process');
const Module=require('node:module');
const {build}=require('esbuild');
const JSZip=require('jszip');

const helper=path.resolve('dist/native/One.Archive.exe');
const secret=value=>{const bytes=Buffer.from(value),head=Buffer.alloc(4);head.writeUInt32LE(bytes.length);return Buffer.concat([head,bytes]);};
function native(args,password=''){const out=spawnSync(helper,args,{input:secret(password),encoding:'utf8',maxBuffer:16*1024*1024});assert.equal(out.status,0,out.stdout+'\n'+out.stderr);return out.stdout.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);}
async function main(){
 await fs.mkdir('work/temp',{recursive:true});const root=await fs.mkdtemp(path.resolve('work/temp/one-archive-update-'));
 let service;
 try{
  const compiled=await build({entryPoints:['src/main/archive-service.ts'],bundle:true,platform:'node',format:'cjs',write:false});
  const filename=path.resolve('dist/main/archive-update-test.cjs'),mod=new Module(filename);mod.filename=filename;mod.paths=module.paths;mod._compile(compiled.outputFiles[0].text,filename);
  let cancelNext=false;
  const progress=[];service=new mod.exports.ArchiveService(path.join(root,'cache'),(_owner,value)=>{
   progress.push(value);
   if(value.operation==='commit')assert.equal(service.cancel(value.id,1),false,'commit must not be interruptible');
   if(cancelNext&&value.operation==='update'&&value.done>0){cancelNext=false;assert.equal(service.cancel(value.id,2),false,'another window cannot cancel this task');assert.equal(service.cancel(value.id,1),true);}
  });
  const run=request=>service.run(1,request),list=zip=>run({operation:'list',path:zip});
  const base=new JSZip();base.comment='original ZIP comment';base.file('keep.txt','Retained bytes');base.folder('old');base.file('old/nested.txt','nested',{comment:'entry comment',date:new Date('2025-01-02T12:34:56Z')});base.file('delete.txt','remove');
  const zip=path.join(root,'editable.zip');await fs.writeFile(zip,await base.generateAsync({type:'nodebuffer',compression:'DEFLATE'}));
  const before=await list(zip);assert(before.editable);assert.match(before.revision,/^\d+(?::\d+){6}$/);
  const at=name=>before.entries.find(e=>e.name===name).index;
  const add=path.join(root,'added.txt'),replace=path.join(root,'replacement.txt');await fs.writeFile(add,'added content');await fs.writeFile(replace,'replacement content');
  const changes=[{kind:'rename',index:at('old/'),name:'renamed/'},{kind:'delete',indexes:[at('delete.txt')]},{kind:'mkdir',name:'empty'},{kind:'add',source:add,name:'renamed/added.txt'},{kind:'add',source:replace,name:'keep.txt',replace:true},{kind:'comment',text:'新备注'}];
  const result=await run({operation:'update',path:zip,revision:before.revision,changes});assert.equal(result.path,zip);
  assert(progress.some(p=>p.operation==='commit'));assert(progress.some(p=>p.operation==='update'));
  const after=await list(zip);assert.equal(after.comment,'新备注');assert.notEqual(after.revision,before.revision);
  assert.deepEqual(after.entries.map(e=>e.name).sort(),['empty/','keep.txt','renamed/','renamed/added.txt','renamed/nested.txt'].sort());
  const extracted=path.join(root,'extract');native(['extract',zip,extracted,'','0']);assert.equal(await fs.readFile(path.join(extracted,'keep.txt'),'utf8'),'replacement content');assert.equal(await fs.readFile(path.join(extracted,'renamed/nested.txt'),'utf8'),'nested');
  const rewritten=await JSZip.loadAsync(await fs.readFile(zip));assert.equal(rewritten.file('renamed/nested.txt').comment,'entry comment');assert.equal(rewritten.file('renamed/nested.txt').date.toISOString(),'2025-01-02T12:34:56.000Z');
  const sourceParsed=await JSZip.loadAsync(await base.generateAsync({type:'nodebuffer',compression:'DEFLATE'}));assert.deepEqual(Buffer.from(rewritten.file('renamed/nested.txt')._data.compressedContent),Buffer.from(sourceParsed.file('old/nested.txt')._data.compressedContent),'retained payload should not be recompressed');
  const bytes=await fs.readFile(zip);
  cancelNext=true;await assert.rejects(run({operation:'update',path:zip,revision:after.revision,changes:[{kind:'mkdir',name:'cancelled'}]}),/cancel|failed|取消|失败/i);assert.deepEqual(await fs.readFile(zip),bytes);
  await assert.rejects(run({operation:'update',path:zip,revision:before.revision,changes:[{kind:'mkdir',name:'stale'}]}),/changed/i);
  for(const invalid of [
   [{kind:'mkdir',name:'../escape'}],
   [{kind:'mkdir',name:'KEEP.txt'}],
   [{kind:'add',source:add,name:'keep.txt'}],
   [{kind:'rename',index:after.entries.find(e=>e.name==='keep.txt').index,name:'empty/file'},{kind:'rename',index:after.entries.find(e=>e.name==='renamed/nested.txt').index,name:'empty/file/child'}],
   [{kind:'add',source:zip,name:'itself.zip'}]
  ]){await assert.rejects(run({operation:'update',path:zip,revision:after.revision,changes:invalid}));assert.deepEqual(await fs.readFile(zip),bytes);}
  // Another process can read the ZIP while denying deletion. OS replacement
  // then fails safely; the original bytes and path remain intact.
  const powerShell=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
  const lockScript=`$f=[IO.File]::Open('${zip.replaceAll("'","''")}','Open','Read','Read'); [Console]::WriteLine('locked'); [Console]::ReadLine() | Out-Null; $f.Dispose()`;
  const holder=spawn(powerShell,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(lockScript,'utf16le').toString('base64')],{windowsHide:true,stdio:'pipe'});
  try{await new Promise((resolve,reject)=>{holder.stdout.once('data',resolve);holder.once('error',reject);holder.once('exit',code=>reject(Error('lock process exited '+code)));});
   await assert.rejects(run({operation:'update',path:zip,revision:after.revision,changes:[{kind:'mkdir',name:'blocked'}]}),/replace|retained/i);assert.deepEqual(await fs.readFile(zip),bytes);
  }finally{holder.stdin.end('\n');await new Promise(resolve=>holder.once('close',resolve));}
  // External replacement invalidates indexes even when the path remains the same.
  const originalCopy=path.join(root,'copy.zip');await fs.copyFile(zip,originalCopy);await fs.rename(zip,path.join(root,'previous.zip'));await fs.rename(originalCopy,zip);
  await assert.rejects(run({operation:'update',path:zip,revision:after.revision,changes:[{kind:'mkdir',name:'stale-again'}]}),/changed/i);
  // AES payloads are copied raw; new files preserve encryption and require the right password.
  const secure=path.join(root,'secure.zip');native(['create',secure,add],'secret');const secureBefore=await list(secure),secureBytes=await fs.readFile(secure);
  await assert.rejects(run({operation:'update',path:secure,revision:secureBefore.revision,password:'wrong',changes:[{kind:'rename',index:0,name:'renamed.txt'}]}));assert.deepEqual(await fs.readFile(secure),secureBytes);
  await run({operation:'update',path:secure,revision:secureBefore.revision,password:'secret',changes:[{kind:'rename',index:0,name:'renamed.txt'},{kind:'add',source:replace,name:'new.txt'}]});
  const secureAfter=await list(secure);assert(secureAfter.entries.every(e=>e.encrypted));native(['test',secure,'0'],'secret');
  const secureOut=path.join(root,'secure-out');native(['extract',secure,secureOut,'','0'],'secret');assert.equal(await fs.readFile(path.join(secureOut,'renamed.txt'),'utf8'),'added content');
  // A directory deletion includes its descendants, including redundantly selected children.
  const selected=await list(zip),directory=selected.entries.find(e=>e.name==='renamed/');
  await run({operation:'update',path:zip,revision:selected.revision,changes:[{kind:'delete',indexes:[directory.index,selected.entries.find(e=>e.name==='renamed/nested.txt').index]}]});
  assert(!(await list(zip)).entries.some(e=>e.name.startsWith('renamed/')));
  // Deleting every item produces a valid empty ZIP, which can accept files again.
  const deleteAll=await list(zip);await run({operation:'update',path:zip,revision:deleteAll.revision,changes:[{kind:'delete',indexes:deleteAll.entries.map(e=>e.index)}]});
  const empty=await list(zip);assert.equal(empty.total,0);await run({operation:'update',path:zip,revision:empty.revision,changes:[{kind:'add',source:add,name:'again.txt'}]});assert.equal((await list(zip)).total,1);
  // Manual legacy codepages and Info-ZIP Unicode paths remain usable after an edit.
  const legacy=path.join(root,'legacy.zip'),legacyData=new JSZip();legacyData.file('中文.txt','legacy contents');
  await fs.writeFile(legacy,await legacyData.generateAsync({type:'nodebuffer',encodeFileName:name=>name==='中文.txt'?Buffer.from([0xd6,0xd0,0xce,0xc4,0x2e,0x74,0x78,0x74]):Buffer.from(name)}));
  const legacyAuto=await list(legacy);assert.equal(legacyAuto.entries[0].name,'中文.txt','Unicode extra path should take precedence in auto mode');
  const legacyManual=await run({operation:'list',path:legacy,encoding:936});assert.equal(legacyManual.entries[0].name,'中文.txt');
  await run({operation:'update',path:legacy,revision:legacyManual.revision,encoding:936,changes:[{kind:'rename',index:0,name:'新名称.txt'}]});assert.equal((await list(legacy)).entries[0].name,'新名称.txt');
  const legacyOut=path.join(root,'legacy-out');native(['extract',legacy,legacyOut,'','0']);assert.equal(await fs.readFile(path.join(legacyOut,'新名称.txt'),'utf8'),'legacy contents');
  const split=path.join(root,'split.zip'),large=path.join(root,'large.bin');await fs.writeFile(large,require('node:crypto').randomBytes(2*1024*1024));native(['create',split,'--volume=1048576',large]);
  const splitInfo=await list(split),splitBytes=await fs.readFile(split);assert.equal(splitInfo.editable,false);await assert.rejects(run({operation:'update',path:split,revision:splitInfo.revision,changes:[{kind:'mkdir',name:'unsupported'}]}),/split/i);assert.deepEqual(await fs.readFile(split),splitBytes);
  const broken=path.join(root,'broken.zip'),brokenZip=new JSZip();brokenZip.file('broken.txt','corrupt contents');const brokenBytes=await brokenZip.generateAsync({type:'nodebuffer',compression:'STORE'});brokenBytes[brokenBytes.indexOf(Buffer.from('corrupt contents'))]^=1;await fs.writeFile(broken,brokenBytes);
  const brokenInfo=await list(broken);await assert.rejects(run({operation:'update',path:broken,revision:brokenInfo.revision,changes:[{kind:'delete',indexes:[0]}]}),/integrity/i);assert.deepEqual(await fs.readFile(broken),brokenBytes,'corrupt original must not be silently discarded');
  const links=path.join(root,'links'),linkedFolder=path.join(root,'linked-folder');await fs.mkdir(links);await fs.mkdir(linkedFolder);await fs.writeFile(path.join(linkedFolder,'outside.txt'),'outside');await fs.symlink(linkedFolder,path.join(links,'junction'),'junction');
  const protectedInfo=await list(zip),protectedBytes=await fs.readFile(zip);await assert.rejects(run({operation:'update',path:zip,revision:protectedInfo.revision,changes:[{kind:'add',source:links,name:'links'}]}),/link|junction/i);assert.deepEqual(await fs.readFile(zip),protectedBytes);
  // Killing before the commit handshake cannot modify the original.
  const cancellationBefore=await list(zip),cancellationBytes=await fs.readFile(zip);
  const {archiveEditPacket}=await importPacket();const packet=await archiveEditPacket([{kind:'mkdir',name:'never-committed'}]);
  const temp=path.join(root,'cancel-stage.zip'),backup=path.join(root,'cancel-backup.zip');
  await new Promise((resolve,reject)=>{const child=spawn(helper,['update',zip,temp,backup,'0',cancellationBefore.revision],{windowsHide:true,stdio:'pipe'});let text='',ready=false;
   const timeout=setTimeout(()=>{child.kill();reject(Error('update handshake timeout'));},30000);
   child.stdout.on('data',chunk=>{text+=chunk;if(text.includes('"type":"ready"')){ready=true;child.kill();}});
   child.on('error',reject);child.on('close',()=>{clearTimeout(timeout);ready?resolve():reject(Error(text));});child.stdin.on('error',()=>{});child.stdin.write(Buffer.concat([secret(''),packet]));
  });assert.deepEqual(await fs.readFile(zip),cancellationBytes);await fs.rm(temp,{force:true});
  assert(!(await fs.readdir(root)).some(n=>n.startsWith('.one-update-')),'all service staging files should be cleaned');
  // PKWARE encryption interoperability, when 7-Zip is installed.
  const pk=path.join(root,'pk.zip'),pkResult=spawnSync('7z',['a','-tzip','-mem=ZipCrypto','-psecret','-y',pk,add],{encoding:'utf8'});
  if(!pkResult.error){assert.equal(pkResult.status,0,pkResult.stdout);const info=await list(pk);await run({operation:'update',path:pk,revision:info.revision,password:'secret',changes:[{kind:'rename',index:0,name:'pk-renamed.txt'}]});const verify=spawnSync('7z',['t','-psecret','-y',pk],{encoding:'utf8'});assert.equal(verify.status,0,verify.stdout+verify.stderr);}
  console.log('Archive update passed: staged edits, raw payload/metadata, directory deletion, empty ZIP, comments, AES/ZipCrypto, legacy Unicode/codepages, file locks, split guard, revision/collision/self-add protection and pre-commit cancellation.');
 }finally{if(service)await service.stop();const relative=path.relative(path.resolve('work/temp'),root);assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));await fs.rm(root,{recursive:true,force:true});}
}
async function importPacket(){const compiled=await build({entryPoints:['src/main/archive-update.ts'],bundle:true,platform:'node',format:'cjs',write:false});const filename=path.resolve('dist/main/archive-update-packet-test.cjs'),mod=new Module(filename);mod.filename=filename;mod.paths=module.paths;mod._compile(compiled.outputFiles[0].text,filename);return mod.exports;}
main().catch(error=>{console.error(error);process.exitCode=1;});
