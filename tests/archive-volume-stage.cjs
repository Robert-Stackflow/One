const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {spawn,spawnSync}=require('node:child_process');
const {randomUUID,randomBytes,createHash}=require('node:crypto');
const Module=require('node:module');
const {build}=require('esbuild');
const helper=path.resolve('dist/native/One.Archive.exe');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const secret=password=>{const value=Buffer.from(password),header=Buffer.alloc(4);header.writeUInt32LE(value.length);return Buffer.concat([header,value]);};
async function compile(entry){const result=await build({entryPoints:[entry],bundle:true,platform:'node',format:'cjs',write:false});const filename=path.resolve('dist/main/archive-volume-stage-test.cjs'),mod=new Module(filename);mod.filename=filename;mod.paths=Module._nodeModulePaths(path.dirname(filename));mod._compile(result.outputFiles[0].text,filename);return mod.exports;}
async function main(){
 await fs.mkdir('work/temp',{recursive:true});const root=await fs.mkdtemp(path.resolve('work/temp/one-volume-stage-'));let service,tinyZip;const live=new Set();
 const env={...process.env,TEMP:root,TMP:root};
 const {ArchiveService}=await compile('src/main/archive-service.ts'),{archiveEditPacket}=await compile('src/main/archive-update.ts');
 const stagePath=()=>path.join(root,'.one-update-'+randomUUID());
 const sourceHashes=async files=>Promise.all(files.map(async file=>({path:file,hash:hash(await fs.readFile(file)),ino:(await fs.stat(file,{bigint:true})).ino})));
 const native=(args,input,expected=0,extraEnv={})=>{const result=spawnSync(helper,args,{env:{...env,...extraEnv},windowsHide:true,input,encoding:'utf8',timeout:60000,maxBuffer:4*1024**2});assert.equal(result.status,expected,JSON.stringify(result));return result.stdout.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);};
 const seven=args=>{const result=spawnSync('7z',args,{env,windowsHide:true,encoding:'utf8',timeout:60000,maxBuffer:4*1024**2});assert.equal(result.status,0,result.stdout+'\n'+result.stderr+'\n'+result.error);};
 const stage=async(source,listing,changes,password='',expected=0,directory=stagePath())=>{
  const messages=native(['update-stage',source,directory,'0',listing.revision],Buffer.concat([secret(password),await archiveEditPacket(changes)]),expected);
  assert(!messages.some(item=>item.type==='ready'),'Staging cannot start a source publication');
  return{directory,messages,result:messages.find(item=>item.type==='result')};
 };
 const held=async(source,listing,password)=>{
  const directory=stagePath(),child=spawn(helper,['update-stage',source,directory,'0',listing.revision],{env,windowsHide:true,stdio:'pipe'});live.add(child);let output='',timer;
  const result=new Promise((resolve,reject)=>{timer=setTimeout(()=>{child.kill();reject(Error('volume stage helper timeout'));},30000);child.on('error',reject);child.stdout.on('data',chunk=>{output+=chunk;});child.on('close',(code,signal)=>{clearTimeout(timer);live.delete(child);resolve({code,signal,output});});});result.catch(()=>{});child.stdin.on('error',()=>{});child.stdin.write(secret(password));
  const start=Date.now();while(true){try{assert((await fs.stat(directory)).isDirectory());break;}catch(error){if(error.code!=='ENOENT')throw error;}assert(child.exitCode===null&&Date.now()-start<10000,'Helper did not create its stage');await new Promise(resolve=>setTimeout(resolve,10));}
  return{child,result,directory};
 };
 try{
  service=new ArchiveService(path.join(root,'cache'),()=>{});const run=request=>service.run(1,request);
  const dir=path.join(root,'原目录');await fs.mkdir(path.join(dir,'子目录'),{recursive:true});await fs.mkdir(path.join(dir,'空目录'));
  const data=randomBytes(3*1024**2);await fs.writeFile(path.join(dir,'keep.bin'),data);await fs.writeFile(path.join(dir,'子目录','retain.txt'),'retained nested');
  const add=path.join(root,'grow.bin'),small=path.join(root,'small.txt');await fs.writeFile(add,randomBytes(4*1024**2));await fs.writeFile(small,'small payload');
  for(const format of ['zip','7z'])for(const password of ['','stage secret']){
   const target=path.join(root,`${format}-${password?'encrypted':'plain'}.${format==='zip'?'ZIP':'7z'}`),created=await run({operation:'create',path:target,sources:[dir],volumeBytes:1024**2,level:0,password});
   const source=created.path,listing=await run({operation:'list',path:source,password});assert.match(listing.revision,/^v2:/);assert(listing.editable);
   const members=(await fs.readdir(root)).filter(file=>format==='zip'?file===path.basename(source)||file.startsWith(path.basename(target).slice(0,-4)+'.z'):file.startsWith(path.basename(target)+'.')).map(file=>path.join(root,file));assert(members.length>=3);const before=await sourceHashes(members);
   const at=value=>listing.entries.find(item=>item.name.replaceAll('\\','/').replace(/\/$/,'')===value).index;
   const grow=await stage(source,listing,[{kind:'rename-folder',folder:'原目录',name:'移动后'},{kind:'add',source:add,name:'added.bin'},...(format==='zip'?[{kind:'comment',text:'新的分卷备注'}]:[])],password);
   assert(grow.result.staged);assert.equal(grow.result.inputVolumes,members.length);assert(grow.result.volumes>members.length);assert.equal(path.dirname(grow.result.path),grow.directory);assert.equal((await fs.readdir(grow.directory)).length,grow.result.volumes);
   assert(format==='zip'?grow.result.path.endsWith('.ZIP'):grow.result.path.endsWith('.7z.001'));
   const grown=await run({operation:'list',path:grow.result.path,password});assert.equal(grown.revision,grow.result.revision);assert.equal(grown.total,grow.result.count);assert(grown.entries.some(item=>item.name==='added.bin'));assert(grown.entries.filter(item=>!item.directory&&item.size).every(item=>item.encrypted===!!password));if(format==='zip')assert.equal(grown.comment,'新的分卷备注');
   native(['test',grow.result.path,'0'],secret(password));seven(['t',grow.result.path,...(password?['-p'+password]:[])]);
   const extracted=await run({operation:'extract',path:grow.result.path,parent:root,password});assert.deepEqual(await fs.readFile(path.join(extracted.path,'移动后','keep.bin')),data);assert.deepEqual(await fs.readFile(path.join(extracted.path,'added.bin')),await fs.readFile(add));
   const shrink=await stage(source,listing,[{kind:'delete',indexes:[at('原目录/keep.bin')]},{kind:'add',source:small,name:'small.txt'}],password);assert(shrink.result.volumes<members.length);native(['test',shrink.result.path,'0'],secret(password));seven(['t',shrink.result.path,...(password?['-p'+password]:[])]);
   const empty=await stage(source,listing,[{kind:'delete',folders:['原目录'],indexes:[]}],password);assert.equal(empty.result.count,0);assert(empty.result.volumes<members.length);assert.equal((await run({operation:'list',path:empty.result.path,password})).total,0);native(['test',empty.result.path,'0'],secret(password));seven(['t',empty.result.path,...(password?['-p'+password]:[])]);
   if(format==='zip'&&!password)tinyZip=empty.result.path;
   assert.deepEqual(await sourceHashes(members),before,'Grow/shrink/empty stages preserve every original volume');
   const existing=stagePath();await fs.mkdir(existing);const marker=path.join(existing,'unrelated');await fs.writeFile(marker,'untouched');await stage(source,listing,[{kind:'mkdir',name:'valid'}],password,2,existing);assert.equal(await fs.readFile(marker,'utf8'),'untouched');
   await stage(source,listing,[{kind:'mkdir',name:'../escape'}],password,2);
   await stage(source,listing,[{kind:'mkdir',name:'valid'}],password,2,path.join(root,'wrong-stage-name'));
   const outside=path.join(root,'nested');await fs.mkdir(outside,{recursive:true});await stage(source,listing,[{kind:'mkdir',name:'valid'}],password,2,path.join(outside,'.one-update-'+randomUUID()));
   if(password)await stage(source,listing,[{kind:'delete',folders:['原目录'],indexes:[]}],'wrong',2);
   // The child creates and locks the directory, then waits for its private
   // plan. Place an unrelated hard link at a future output path to exercise
   // CREATE_NEW rather than rely on a timing-based injection during I/O.
   for(const later of [false,true]){
    const pending=await held(source,listing,password),unrelated=path.join(root,'unrelated-'+randomUUID());await fs.writeFile(unrelated,'do not truncate');
    const collision=format==='zip'?path.join(pending.directory,path.basename(target).slice(0,-4)+(later?'.z02':'.z01')):path.join(pending.directory,path.basename(target)+(later?'.002':''));await fs.link(unrelated,collision);
    pending.child.stdin.end(await archiveEditPacket([{kind:'mkdir',name:'collision'}]));const rejected=await pending.result;assert.equal(rejected.code,2,rejected.output);assert(!rejected.output.includes('"staged":true'));assert.equal(await fs.readFile(unrelated,'utf8'),'do not truncate');
   }
   // Stop while the helper is waiting for its plan: the old family and the
   // unrelated files must remain intact, with no source commit handshake.
   const cancelled=await held(source,listing,password);cancelled.child.kill();const stopped=await cancelled.result;assert(stopped.signal||stopped.code!==0);assert.deepEqual(await sourceHashes(members),before);
   const later=members.find(file=>file!==source),original=await fs.readFile(later),info=await fs.stat(later),replacement=later+'.new';await fs.writeFile(replacement,original);await fs.utimes(replacement,info.atime,info.mtime);await fs.rename(replacement,later);
   const stale=await stage(source,listing,[{kind:'mkdir',name:'stale'}],password,2);assert(stale.messages.some(item=>item.type==='error'&&item.message.includes('changed')));assert.deepEqual(await fs.readdir(stale.directory),[]);
  }
  const external=path.join(root,'external-solid.7z'),externalPassword='external secret';seven(['a','-t7z','-ms=on','-mhe=off','-v1m','-p'+externalPassword,external,dir]);
  const externalSource=external+'.001',externalList=await run({operation:'list',path:externalSource}),externalFiles=(await fs.readdir(root)).filter(file=>file.startsWith('external-solid.7z.')).map(file=>path.join(root,file)),externalBefore=await sourceHashes(externalFiles);
  const solid=await stage(externalSource,externalList,[{kind:'rename-folder',folder:'原目录',name:'移动后'},{kind:'add',source:small,name:'追加.txt'}],externalPassword);
  const visible=await run({operation:'list',path:solid.result.path});assert.equal(visible.total,solid.result.count);assert(visible.entries.filter(item=>!item.directory&&item.size).every(item=>item.encrypted));seven(['t',solid.result.path,'-p'+externalPassword]);assert.deepEqual(await sourceHashes(externalFiles),externalBefore);
  const encodedTarget=path.join(root,'cp936.zip'),encodedPassword='中文密码',encoded=await run({operation:'create',path:encodedTarget,sources:[dir],volumeBytes:1024**2,level:0,password:encodedPassword,passwordEncoding:936}),encodedList=await run({operation:'list',path:encoded.path,password:encodedPassword,passwordEncoding:936});
  const encodedDirectory=stagePath(),encodedMessages=native(['update-stage',encoded.path,encodedDirectory,'0',encodedList.revision],Buffer.concat([secret(encodedPassword),await archiveEditPacket([{kind:'add',source:small,name:'新增.txt'}])]),0,{ONE_ARCHIVE_PASSWORD_ENCODING:'936'}),encodedResult=encodedMessages.find(item=>item.type==='result');assert(encodedResult.staged);
  await run({operation:'test',path:encodedResult.path,password:encodedPassword,passwordEncoding:936});const encodedOut=await run({operation:'extract',path:encodedResult.path,parent:root,password:encodedPassword,passwordEncoding:936});assert.equal(await fs.readFile(path.join(encodedOut.path,'新增.txt'),'utf8'),'small payload');assert.deepEqual(await fs.readFile(path.join(encodedOut.path,'原目录','keep.bin')),data);
  // An empty split ZIP can have a four-byte data disk. Regrowing it uses the
  // public minimum, rather than treating four bytes as the configured limit.
  const tiny=await run({operation:'list',path:tinyZip}),tinyMembers=(await fs.readdir(path.dirname(tinyZip))).map(file=>path.join(path.dirname(tinyZip),file)),tinyBefore=await sourceHashes(tinyMembers);
  assert.match(tiny.revision,/^v2:/);const regrown=await stage(tinyZip,tiny,[{kind:'add',source:add,name:'regrown.bin'}],'',0,path.join(path.dirname(tinyZip),'.one-update-'+randomUUID()));
  assert.equal(regrown.result.volumeBytes,1024**2);assert(regrown.result.volumes<10);native(['test',regrown.result.path,'0'],secret(''));assert.deepEqual(await sourceHashes(tinyMembers),tinyBefore);
  const alias=path.join(root,'parent-alias');await fs.symlink(root,alias,'junction');
  // Use the alias of the actual input parent, not just a differently spelled
  // source name; reparse ancestors are rejected before a directory is created.
  const aliasSource=path.join(alias,path.basename(path.dirname(tinyZip)),path.basename(tinyZip));
  const rejectedAlias=stagePath();native(['update-stage',aliasSource,path.join(path.dirname(aliasSource),path.basename(rejectedAlias)),'0',tiny.revision],Buffer.concat([secret(''),await archiveEditPacket([{kind:'mkdir',name:'alias'}])]),2);
  await assert.rejects(fs.stat(path.join(path.dirname(tinyZip),path.basename(rejectedAlias))),{code:'ENOENT'});await fs.rmdir(alias);
  await assert.rejects(run({operation:'update-stage',path:'fake'}),/请求无效/);
  console.log('Volume staging passed: split ZIP/7Z grow/shrink/empty output, encryption/solid visible headers/CP936 passwords, comments, full native/external verification and extraction, source hashes/identities unchanged, private-plan cancellation, stale revisions, scope/reparse/unsafe paths, bounded tiny ZIP disks and first/later hard-linked output rejection. Publication remains separate.');
 }finally{
  for(const child of live){const closed=new Promise(resolve=>child.once('close',resolve));child.kill();await closed;}
  await service?.stop();assert.equal(path.dirname(root),path.resolve('work/temp'));await fs.rm(root,{recursive:true,force:true});
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
