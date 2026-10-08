const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const Module=require('node:module');
const {spawn,spawnSync}=require('node:child_process');
const {build}=require('esbuild');
const crypto=require('node:crypto');
const helper=path.resolve('dist/native/One.Archive.exe');
const name=value=>value.replaceAll('\\','/').replace(/\/$/,'');
const secret=value=>{const bytes=Buffer.from(value),head=Buffer.alloc(4);head.writeUInt32LE(bytes.length);return Buffer.concat([head,bytes]);};
async function main(){
 await fs.mkdir('work/temp',{recursive:true});const root=await fs.mkdtemp(path.resolve('work/temp/one-seven-update-'));let service;
 const native=(args,password='',expected=0)=>{const result=spawnSync(helper,args,{input:secret(password),env:{...process.env,TEMP:root,TMP:root},encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024});assert.equal(result.status,expected,result.stdout+'\n'+result.stderr+'\n'+result.error);return result.stdout.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);};
 try{
  const compiled=await build({entryPoints:['src/main/archive-service.ts','src/main/archive-update.ts'],bundle:true,platform:'node',format:'cjs',write:false,outdir:'virtual'});
  const load=(name,source)=>{const filename=path.resolve('dist/main/'+name+'-test.cjs'),mod=new Module(filename);mod.filename=filename;mod.paths=module.paths;mod._compile(source,filename);return mod.exports;};
  const {ArchiveService}=load('seven-update',compiled.outputFiles.find(file=>file.path.endsWith('archive-service.js')).text);
  const {archiveEditPacket}=load('seven-update-packet',compiled.outputFiles.find(file=>file.path.endsWith('archive-update.js')).text);
  const progress=[];let cancelNext=false;
  service=new ArchiveService(path.join(root,'cache'),(owner,value)=>{progress.push(value);if(value.operation==='commit')assert.equal(service.cancel(value.id,owner),false);else if(cancelNext&&value.operation==='update'&&value.done>0){cancelNext=false;assert.equal(service.cancel(value.id,owner),true);}});
  const run=request=>service.run(1,request),list=(file,password='')=>run({operation:'list',path:file,password});
  const dir=path.join(root,'原目录');await fs.mkdir(path.join(dir,'子目录'),{recursive:true});const data=Buffer.from('retained data\n'.repeat(2000));
  await fs.writeFile(path.join(dir,'keep.bin'),data);await fs.writeFile(path.join(dir,'子目录','remove.txt'),'remove');await fs.writeFile(path.join(dir,'子目录','retain.txt'),'retained nested');await fs.mkdir(path.join(dir,'empty'));
  const add=path.join(root,'added.txt'),replacement=path.join(root,'replacement.txt');await fs.writeFile(add,'new data');await fs.writeFile(replacement,'replace content');
  for(const password of ['',' secret 密码 ']){
   const file=path.join(root,password?'encrypted.7z':'plain.7z');await run({operation:'create',path:file,sources:[dir],password});
   const before=await list(file,password);assert(before.editable);const at=name=>before.entries.find(item=>item.name.replaceAll('\\','/').replace(/\/$/,'')===name).index;
   const original=await fs.readFile(file);
   if(password){await assert.rejects(run({operation:'update',path:file,revision:before.revision,password:'wrong',changes:[{kind:'delete',indexes:[0]}]}));assert.deepEqual(await fs.readFile(file),original);}
   await run({operation:'update',path:file,revision:before.revision,password,changes:[{kind:'rename',index:at('原目录/keep.bin'),name:'原目录/renamed.bin'}]});
   const renamed=await list(file,password),renamedBytes=await fs.readFile(file);
   const packed=before.entries.reduce((sum,item)=>sum+item.compressed,0);assert(packed>0);assert.deepEqual(renamedBytes.subarray(32,32+packed),original.subarray(32,32+packed),'rename-only update preserves the original packed data block');
   const indexes=name=>renamed.entries.find(item=>item.name.replaceAll('\\','/').replace(/\/$/,'')===name).index;
   await run({operation:'update',path:file,revision:renamed.revision,password,changes:[
    {kind:'rename',index:indexes('原目录'),name:'移动后'},
    {kind:'delete',indexes:[indexes('原目录/子目录/remove.txt')]},
    {kind:'mkdir',name:'新增空目录'},
    {kind:'add',source:add,name:'移动后/added.txt'},
    {kind:'add',source:replacement,name:'移动后/renamed.bin',replace:true}
   ]});
   const after=await list(file,password);assert.notEqual(after.revision,renamed.revision);assert(after.entries.some(item=>name(item.name)==='移动后/added.txt'));assert(!after.entries.some(item=>item.name.endsWith('remove.txt')));
   const extracted=await run({operation:'extract',path:file,parent:root,password});assert.equal(await fs.readFile(path.join(extracted.path,'移动后/renamed.bin'),'utf8'),'replace content');assert.equal(await fs.readFile(path.join(extracted.path,'移动后/子目录/retain.txt'),'utf8'),'retained nested');assert((await fs.stat(path.join(extracted.path,'新增空目录'))).isDirectory());
   if(password){assert(after.entries.filter(item=>!item.directory&&item.size).every(item=>item.encrypted));native(['test',file,'0'],password);native(['list',file,'0','1','0'],'',2);}
   else{assert(after.entries.every(item=>!item.encrypted));}
   const bytes=await fs.readFile(file);
   for(const changes of [
    [{kind:'mkdir',name:'../escape'}],
    [{kind:'mkdir',name:'移动后/added.txt'}],
    [{kind:'add',source:add,name:'移动后/added.txt'}],
    [{kind:'rename',index:after.entries.find(item=>name(item.name)==='移动后/added.txt').index,name:'移动后/renamed.bin/child'}],
    [{kind:'add',source:file,name:'itself.7z'}],
    [{kind:'comment',text:'unsupported'}]
   ]){await assert.rejects(run({operation:'update',path:file,revision:after.revision,password,changes}));assert.deepEqual(await fs.readFile(file),bytes);}
   await assert.rejects(run({operation:'update',path:file,revision:before.revision,password,changes:[{kind:'mkdir',name:'stale'}]}),/changed/);
   cancelNext=true;await assert.rejects(run({operation:'update',path:file,revision:after.revision,password,changes:[{kind:'add',source:add,name:'cancelled.txt'}]}));assert.equal(cancelNext,false);assert.deepEqual(await fs.readFile(file),bytes);
   const top=after.entries.find(item=>name(item.name)==='移动后');await run({operation:'update',path:file,revision:after.revision,password,changes:[{kind:'delete',indexes:[top.index]}]});assert(!(await list(file,password)).entries.some(item=>name(item.name).startsWith('移动后/')));
  }
  const empty=path.join(root,'empty.7z');await run({operation:'create',path:empty,sources:[add]});let listed=await list(empty);await run({operation:'update',path:empty,revision:listed.revision,changes:[{kind:'delete',indexes:listed.entries.map(item=>item.index)}]});listed=await list(empty);assert.equal(listed.total,0);await run({operation:'update',path:empty,revision:listed.revision,changes:[{kind:'add',source:add,name:'again.txt'}]});assert.equal((await list(empty)).total,1);
  const current=await list(empty),original=await fs.readFile(empty),packet=await archiveEditPacket([{kind:'mkdir',name:'not-committed'}]),temporary=path.join(root,'staging.7z'),backup=path.join(root,'recovery.7z');
  await new Promise((resolve,reject)=>{const child=spawn(helper,['update',empty,temporary,backup,'0',current.revision],{windowsHide:true,stdio:'pipe',env:{...process.env,TEMP:root,TMP:root}});let output='',ready=false;const timer=setTimeout(()=>{child.kill();reject(Error('commit handshake timeout'));},30000);child.stdout.on('data',chunk=>{output+=chunk;if(output.includes('"type":"ready"')){ready=true;child.kill();}});child.on('error',reject);child.on('close',()=>{clearTimeout(timer);ready?resolve():reject(Error(output));});child.stdin.on('error',()=>{});child.stdin.write(Buffer.concat([secret(''),packet]));});assert.deepEqual(await fs.readFile(empty),original);await fs.rm(temporary,{force:true});
  const large=path.join(root,'large.bin'),split=path.join(root,'split.7z');await fs.writeFile(large,crypto.randomBytes(2*1024**2));await run({operation:'create',path:split,sources:[large],volumeBytes:1024**2});const splitList=await list(split+'.001');assert.equal(splitList.editable,false);await assert.rejects(run({operation:'update',path:split+'.001',revision:splitList.revision,changes:[{kind:'mkdir',name:'bad'}]}),/单卷/);
  const corrupt=path.join(root,'corrupt.7z');await fs.copyFile(empty,corrupt);const bad=await fs.readFile(corrupt);bad[32]^=255;await fs.writeFile(corrupt,bad);const corruptList=await list(corrupt);await assert.rejects(run({operation:'update',path:corrupt,revision:corruptList.revision,changes:[{kind:'delete',indexes:corruptList.entries.map(item=>item.index)}]}));assert.deepEqual(await fs.readFile(corrupt),bad);
  const seven=(args)=>{const result=spawnSync('7z',args,{env:{...process.env,TEMP:root,TMP:root},encoding:'utf8',timeout:60000,maxBuffer:2*1024**2});assert.equal(result.status,0,result.stdout+'\n'+result.stderr+'\n'+result.error);return result.stdout;};
  for(const [solid,password] of [[true,'external secret'],[false,'']]){
   const file=path.join(root,solid?'external-solid.7z':'external-blocks.7z');seven(['a','-t7z',solid?'-ms=on':'-ms=off','-mhe=off',...(password?['-p'+password]:[]),file,dir]);
   const before=await list(file);assert(before.editable);if(password)assert(before.entries.some(item=>item.encrypted),'encrypted data with visible headers');
   const index=before.entries.find(item=>name(item.name).endsWith('remove.txt')).index;
   if(password){const original=await fs.readFile(file);await assert.rejects(run({operation:'update',path:file,revision:before.revision,password:'wrong',changes:[{kind:'delete',indexes:[index]}]}));assert.deepEqual(await fs.readFile(file),original);}
   await run({operation:'update',path:file,revision:before.revision,password,changes:[{kind:'delete',indexes:[index]},{kind:'add',source:add,name:'外部追加.txt'}]});
   const after=await list(file);assert(!after.entries.some(item=>item.name.endsWith('remove.txt')));assert(after.entries.some(item=>name(item.name)==='外部追加.txt'));
   seven(['t',file,...(password?['-p'+password]:[])]);
   const out=path.join(root,solid?'external-solid-out':'external-blocks-out');seven(['x','-y','-o'+out,file,...(password?['-p'+password]:[])]);
   assert.deepEqual(await fs.readFile(path.join(out,'原目录/keep.bin')),data);assert.equal(await fs.readFile(path.join(out,'外部追加.txt'),'utf8'),'new data');
  }
  const unicode=path.join(root,'unicode.7z');await run({operation:'create',path:unicode,sources:[add]});const unicodeList=await list(unicode);await assert.rejects(run({operation:'update',path:unicode,revision:unicodeList.revision,changes:[{kind:'mkdir',name:'Ä目录'},{kind:'mkdir',name:'ä目录'}]}),/Duplicate/);
  const lockedBytes=await fs.readFile(unicode),powerShell=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
  const lockScript=`$f=[IO.File]::Open('${unicode.replaceAll("'","''")}','Open','Read','Read'); [Console]::WriteLine('locked'); [Console]::ReadLine() | Out-Null; $f.Dispose()`;
  const holder=spawn(powerShell,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(lockScript,'utf16le').toString('base64')],{windowsHide:true,stdio:'pipe',env:{...process.env,TEMP:root,TMP:root}});
  try{await new Promise((resolve,reject)=>{holder.stdout.once('data',resolve);holder.once('error',reject);holder.once('exit',code=>reject(Error('lock process exited '+code)));});
   await assert.rejects(run({operation:'update',path:unicode,revision:unicodeList.revision,changes:[{kind:'mkdir',name:'blocked'}]}),/replace|retained/i);assert.deepEqual(await fs.readFile(unicode),lockedBytes);
  }finally{holder.stdin.end('\n');await new Promise(resolve=>holder.once('close',resolve));}
  const links=path.join(root,'links');await fs.mkdir(links);await fs.symlink(dir,path.join(links,'junction'),'junction');
  await assert.rejects(run({operation:'update',path:unicode,revision:unicodeList.revision,changes:[{kind:'add',source:links,name:'linked'}]}),/link|junction/i);assert.deepEqual(await fs.readFile(unicode),lockedBytes);
  await run({operation:'update',path:unicode,revision:unicodeList.revision,password:'unused',changes:[{kind:'add',source:add,name:'plain.txt'}]});assert((await list(unicode)).entries.every(item=>!item.encrypted),'entering a password must not encrypt a plain archive');
  assert(progress.some(value=>value.operation==='commit'));assert(!(await fs.readdir(root)).some(name=>name.startsWith('.one-update-')));
  console.log('7Z update passed: raw packed-data rename, solid edits, encrypted/visible headers, external 7-Zip interoperability, empty archives, Unicode collisions, locks/junctions, cancellation, commit handshake and split rejection.');
 }finally{if(service)await service.stop();const relative=path.relative(path.resolve('work/temp'),root);assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));await fs.rm(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
