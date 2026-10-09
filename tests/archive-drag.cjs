const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const Module=require('node:module');
const {spawnSync}=require('node:child_process');
const {build}=require('esbuild');
const JSZip=require('jszip');
const helper=path.resolve('dist/native/One.Archive.exe');
const secretPacket=secret=>{const bytes=Buffer.from(secret),header=Buffer.alloc(4);header.writeUInt32LE(bytes.length);return Buffer.concat([header,bytes]);};
const hash=bytes=>{let value=14695981039346656037n;for(const byte of bytes)value=BigInt.asUintN(64,(value^BigInt(byte))*1099511628211n);return String(value);};
const messages=result=>result.stdout.trim().split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
function native(args,secret='',packet=Buffer.alloc(0),expected=0,test=true){
 const env={...process.env};if(test)env.ONE_TEST_MODE='1';else delete env.ONE_TEST_MODE;
 const result=spawnSync(helper,args,{env,input:Buffer.concat([secretPacket(secret),packet]),encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024});
 assert.equal(result.status,expected,result.stdout+'\n'+result.stderr+'\n'+result.error);return messages(result);
}
async function main(){
 await fs.mkdir('work/temp',{recursive:true});const root=await fs.mkdtemp(path.resolve('work/temp/one-archive-drag-'));let service;
 try{
  const source=new JSZip();source.file('parent/folder/a.txt','内容');source.folder('parent/folder/empty');source.file('parent/second.txt','second');source.file('elsewhere/third.bin',Buffer.from([0,255,42]));source.file('zero.txt','');
  const zip=path.join(root,'source.zip');await fs.writeFile(zip,await source.generateAsync({type:'nodebuffer',compression:'DEFLATE'}));
  const listing=(file,secret='')=>{const lines=native(['list',file,'0','200','0'],secret);return {revision:lines.find(m=>m.type==='meta').revision,entries:lines.filter(m=>m.type==='entry')};};
  const listed=listing(zip),at=name=>listed.entries.find(e=>e.name===name).index;
  let sequence=0;
  const drag=(file,selection,secret='',expected=0,revision=listing(file,secret).revision,test=true)=>{
   const packet=Buffer.alloc(5+selection.length*4);packet.writeUInt32LE(selection.length);selection.forEach((index,i)=>packet.writeUInt32LE(index,4+i*4));packet[packet.length-1]=1;
   return native(['drag-test',file,path.join(root,`stage-${sequence++}`),'0',revision],secret,packet,expected,test);
  };
  const entries=lines=>lines.filter(m=>m.type==='drag-entry');
  const alz=path.resolve('tests/fixtures/archives/alz/methods.alz'),alzRow=listing(alz).entries.find(entry=>entry.name==='dlz.txt');
  assert.deepEqual(entries(drag(alz,[alzRow.index])),[{type:'drag-entry',name:'dlz.txt',directory:false,bytes:3200,hash:hash(Buffer.from('One ALZ fixture\n'.repeat(200)))}]);
  const encryptedAlz=path.resolve('tests/fixtures/archives/alz/korean-password.alz');
  assert.deepEqual(entries(drag(encryptedAlz,[0],'비밀')),[{type:'drag-entry',name:'비밀.txt',directory:false,bytes:3200,hash:hash(Buffer.from('One ALZ fixture\n'.repeat(200)))}]);
  const one=drag(zip,[at('parent/folder/a.txt')]);assert.deepEqual(entries(one),[{type:'drag-entry',name:'a.txt',directory:false,bytes:Buffer.byteLength('内容'),hash:hash(Buffer.from('内容'))}]);assert.equal(one.at(-1).count,1);assert.deepEqual(one.find(m=>m.type==='drag-paths'),{type:'drag-paths',count:1});assert.equal(one.at(-1).retainCache,true);
  const folder=drag(zip,[at('parent/folder/'),at('parent/folder/a.txt')]);assert.equal(folder.at(-1).count,1);assert.deepEqual(entries(folder).map(e=>e.name),['folder','folder\\a.txt','folder\\empty']);
  assert(entries(folder).find(e=>e.name==='folder\\empty').directory);
  const siblings=drag(zip,[at('parent/folder/a.txt'),at('parent/second.txt')]);assert.deepEqual(entries(siblings).map(e=>e.name),['folder','folder\\a.txt','second.txt']);
  const distant=drag(zip,[at('parent/folder/a.txt'),at('elsewhere/third.bin')]);assert.deepEqual(entries(distant).map(e=>e.name),['elsewhere','elsewhere\\third.bin','parent','parent\\folder','parent\\folder\\a.txt']);assert.equal(entries(distant).find(e=>e.name.endsWith('third.bin')).hash,hash(Buffer.from([0,255,42])));
  assert.equal(entries(drag(zip,[at('zero.txt')]))[0].bytes,0);
  assert.match(drag(zip,[99999],'',2).at(-1).message,/selection/i);
  assert.match(drag(zip,[at('zero.txt')],'',2,listed.revision,false).at(-1).message,/disabled/i);
  const before=await fs.readFile(zip);await fs.appendFile(zip,Buffer.from('changed'));
  assert.match(drag(zip,[0],'',2,listed.revision).at(-1).message,/changed/i);await fs.writeFile(zip,before);
  const unsafe=new JSZip();unsafe.file('../escape.txt','unsafe');const bad=path.join(root,'unsafe.zip');await fs.writeFile(bad,await unsafe.generateAsync({type:'nodebuffer'}));assert.match(drag(bad,[0],'',2).at(-1).message,/unsafe/i);
  const long=new JSZip();long.file('a'.repeat(260)+'.txt','long');const longZip=path.join(root,'long.zip');await fs.writeFile(longZip,await long.generateAsync({type:'nodebuffer'}));assert.match(drag(longZip,[0],'',2).at(-1).message,/too long/i);
  const dir=path.join(root,'中文文件夹');await fs.mkdir(dir);await fs.writeFile(path.join(dir,'sample.bin'),Buffer.from([1,2,255]));await fs.mkdir(path.join(dir,'empty'));
  for(const format of ['zip','7z','tar','gz','xz']){
   const file=path.join(root,'created.'+format),secret=['zip','7z'].includes(format)?'空 格 password':'';
   native(['create',file,['gz','xz'].includes(format)?path.join(dir,'sample.bin'):dir],secret);
   const current=listing(file,secret);assert.match(current.revision,/^\d+(?::\d+){6}$/);
   const index=current.entries.find(e=>e.name.includes('sample')&&!e.directory)?.index??0;
   const dropped=entries(drag(file,[index],secret));assert.equal(dropped.filter(e=>!e.directory)[0].hash,hash(Buffer.from([1,2,255])));
   if(secret)assert.match(drag(file,[index],'wrong',2,current.revision).at(-1).message,/password|open|extract/i);
  }
  for(const format of ['rar4','rar5']){
   const file=path.resolve(`tests/fixtures/${format}-sample.rar`),current=listing(file);
   const entry=current.entries.find(item=>!item.directory),output=path.join(root,format);
   native(['extract',file,output,String(entry.index),'0']);
   const expected=await fs.readFile(path.join(output,...entry.name.split(/[\\/]/)));
   assert.equal(entries(drag(file,[entry.index]))[0].hash,hash(expected));
  }
  const compiled=await build({entryPoints:['src/main/archive-service.ts'],bundle:true,platform:'node',format:'cjs',write:false});
  const filename=path.resolve('dist/main/archive-drag-test.cjs'),mod=new Module(filename);mod.filename=filename;mod.paths=module.paths;mod._compile(compiled.outputFiles[0].text,filename);
  let ready=0,stopNext=false,stopping;service=new mod.exports.ArchiveService(path.join(root,'cache'),(owner,progress)=>{if(progress.operation==='drag'){++ready;assert.equal(service.cancel(progress.id,owner),false);if(stopNext){stopNext=false;stopping=service.stop();}}});
  const live=await service.run(1,{operation:'list',path:zip});
  // Explicit test cancellation prevents desktop input even if the user happens
  // to hold the mouse button during this isolated service test.
  const previousTest=process.env.ONE_TEST_MODE,previousCancel=process.env.ONE_ARCHIVE_DRAG_TEST_CANCEL;
  process.env.ONE_TEST_MODE='1';process.env.ONE_ARCHIVE_DRAG_TEST_CANCEL='1';
  let cancelled;
  try{cancelled=await service.run(1,{operation:'drag',path:zip,revision:live.revision,selected:[0]});}
  finally{if(previousTest===undefined)delete process.env.ONE_TEST_MODE;else process.env.ONE_TEST_MODE=previousTest;if(previousCancel===undefined)delete process.env.ONE_ARCHIVE_DRAG_TEST_CANCEL;else process.env.ONE_ARCHIVE_DRAG_TEST_CANCEL=previousCancel;}
  assert(cancelled.cancelled);assert.equal(cancelled.count,0);assert.equal(ready,1);
  assert.deepEqual(await fs.readdir(path.join(root,'cache')),[],'cancelled drag must release private cache');
  const previousTarget=process.env.ONE_ARCHIVE_DRAG_TEST_TARGET;
  process.env.ONE_TEST_MODE='1';process.env.ONE_ARCHIVE_DRAG_TEST_TARGET='1';
  try{
   const copied=await service.run(1,{operation:'drag',path:zip,revision:live.revision,selected:[at('parent/folder/'),at('parent/second.txt')]});assert.equal(copied.count,2);assert(!copied.cancelled);assert.deepEqual(await fs.readdir(path.join(root,'cache')),[],'completed copy must release staged contents');
   const encrypted=path.join(root,'created.zip'),encryptedList=await service.run(1,{operation:'list',path:encrypted});
   const encryptedFile=encryptedList.entries.find(entry=>!entry.directory).index;
   await assert.rejects(service.run(1,{operation:'drag',path:encrypted,revision:encryptedList.revision,selected:[encryptedFile],password:'wrong'}),/password|open|extract/i);assert.deepEqual(await fs.readdir(path.join(root,'cache')),[],'password failure must release staged contents');
   for(const format of ['tar.gz','tar.xz']){
    const file=path.join(root,'composite.'+format);await service.run(1,{operation:'create',path:file,sources:[dir]});
    const current=await service.run(1,{operation:'list',path:file});const index=current.entries.find(e=>e.name.includes('sample')&&!e.directory).index;
    assert.equal((await service.run(1,{operation:'drag',path:file,revision:current.revision,selected:[index]})).count,1);
    assert(!(await fs.readdir(path.join(root,'cache'))).some(name=>name.startsWith('drag-')));
   }
   await assert.rejects(service.run(1,{operation:'drag',path:zip,revision:live.revision,selected:[]}),/请选择/);
   await assert.rejects(service.run(1,{operation:'drag',path:zip,revision:live.revision,selected:[1.5]}),/请选择/);
   await assert.rejects(service.run(1,{operation:'drag',path:zip,revision:'bad',selected:[0]}),/重新打开/);
   stopNext=true;await service.run(1,{operation:'drag',path:zip,revision:live.revision,selected:[at('zero.txt')]});await stopping;await assert.rejects(fs.stat(path.join(root,'cache')),error=>error.code==='ENOENT');
  }finally{if(previousTest===undefined)delete process.env.ONE_TEST_MODE;else process.env.ONE_TEST_MODE=previousTest;if(previousTarget===undefined)delete process.env.ONE_ARCHIVE_DRAG_TEST_TARGET;else process.env.ONE_ARCHIVE_DRAG_TEST_TARGET=previousTarget;}
  await assert.rejects(service.run(1,{operation:'drag',path:zip,revision:live.revision,selected:[0]}),/正在关闭/);
  await service.stop();service=null;
  console.log('Archive drag protocol passed: selection hierarchy, directories, Unicode, encrypted ZIP/7Z, TAR/GZ/XZ, contents/size/hash, clone lifetime, stale revision, unsafe paths, cancellation and cache cleanup. No Explorer windows.');
 }finally{if(service)await service.stop();const relative=path.relative(path.resolve('work/temp'),root);assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));await fs.rm(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
