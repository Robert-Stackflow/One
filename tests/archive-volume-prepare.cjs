const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {randomBytes,createHash}=require('node:crypto');
const Module=require('node:module');
const {build}=require('esbuild');
const helper=path.resolve('dist/native/One.Archive.exe');
const name=value=>value.replaceAll('\\','/').replace(/\/$/,'');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function compile(entry){const result=await build({entryPoints:[entry],bundle:true,platform:'node',format:'cjs',write:false});const filename=path.resolve('dist/main/archive-volume-prepare-test.cjs'),mod=new Module(filename);mod.filename=filename;mod.paths=Module._nodeModulePaths(path.dirname(filename));mod._compile(result.outputFiles[0].text,filename);return mod.exports;}
async function main(){
 await fs.mkdir('work/temp',{recursive:true});const root=await fs.mkdtemp(path.resolve('work/temp/one-volume-prepare-'));let service,serial=0;
 const {archiveEditPacket}=await compile('src/main/archive-update.ts'),{ArchiveService}=await compile('src/main/archive-service.ts');
 const env={...process.env,TEMP:root,TMP:root};
 const seven=args=>{const result=spawnSync('7z',args,{env,windowsHide:true,encoding:'utf8',timeout:60000,maxBuffer:4*1024**2});assert.equal(result.status,0,result.stdout+'\n'+result.stderr+'\n'+result.error);return result.stdout;};
 const native=(args,secret='',packet=Buffer.alloc(0),expected=0)=>{const bytes=Buffer.from(secret),header=Buffer.alloc(4);header.writeUInt32LE(bytes.length);const result=spawnSync(helper,args,{env,input:Buffer.concat([header,bytes,packet]),encoding:'utf8',timeout:60000,maxBuffer:4*1024**2});assert.equal(result.status,expected,JSON.stringify(result));return result.stdout.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);};
 const sourceHashes=async files=>Promise.all(files.map(async file=>({path:file,hash:hash(await fs.readFile(file)),ino:(await fs.stat(file,{bigint:true})).ino})));
 const prepare=async(source,listing,changes,password='',expected=0,extension)=>{
  const format=/\.zip$/i.test(source)?'zip':'7z',target=path.join(root,`prepared-${serial++}.${extension??format}`),backup=target+'.original';
  const messages=native(['update-prepare',source,target,backup,'0',listing.revision],password,await archiveEditPacket(changes),expected);
  await assert.rejects(fs.stat(backup),{code:'ENOENT'});assert(!messages.some(message=>message.type==='ready'),'Preparation must never request a commit handshake');return{target,messages,result:messages.find(message=>message.type==='result')};
 };
 try{
  service=new ArchiveService(path.join(root,'cache'),()=>{});const run=request=>service.run(1,request);
  const dir=path.join(root,'原目录');await fs.mkdir(path.join(dir,'子目录'),{recursive:true});await fs.mkdir(path.join(dir,'空目录'));
  const data=randomBytes(3*1024**2);await fs.writeFile(path.join(dir,'keep.bin'),data);await fs.writeFile(path.join(dir,'子目录','delete.txt'),'delete');await fs.writeFile(path.join(dir,'子目录','retain.txt'),'retained nested');
  const add=path.join(root,'added.txt'),replacement=path.join(root,'replacement.txt');await fs.writeFile(add,'added data');await fs.writeFile(replacement,'replacement content');
  for(const format of ['zip','7z'])for(const password of ['','secret 密码']){
   const target=path.join(root,`${format}-${password?'encrypted':'plain'}.${format==='zip'?'ZIP':'7z'}`),created=await run({operation:'create',path:target,sources:[dir],volumeBytes:1024**2,level:0,password});
   const source=created.path,listing=await run({operation:'list',path:source,password}),at=value=>listing.entries.find(item=>name(item.name)===value).index;
   assert(!listing.editable,'UI remains read-only until transactional family publication is connected');assert.match(listing.revision,/^v2:/);
   const members=(await fs.readdir(root)).filter(file=>format==='zip'?file.toLowerCase()===path.basename(source).toLowerCase()||file.startsWith(path.basename(target).slice(0,-4)+'.z'):file.startsWith(path.basename(target)+'.')).map(file=>path.join(root,file));assert(members.length>=3);
   const before=await sourceHashes(members);
   const renamed=await prepare(source,listing,[{kind:'rename',index:at('原目录/keep.bin'),name:'原目录/renamed.bin'}],password);
   const observedSize=format==='zip'?Math.max(...await Promise.all(members.filter(file=>file!==source).map(async file=>(await fs.stat(file)).size))):(await fs.stat(source)).size;
   assert.equal(renamed.result.prepared,true);assert.equal(renamed.result.volumes,members.length);assert.equal(renamed.result.volumeBytes,observedSize);native(['test',renamed.target,'0'],password);
   const renamedList=await run({operation:'list',path:renamed.target,password});assert(renamedList.entries.some(item=>name(item.name)==='原目录/renamed.bin'));
   // External ZIP tools use their local password code page; the explicit
   // encoding compatibility matrix is covered in archive-password.cjs.
   if(format==='7z'||!password)seven(['t',renamed.target,...(password?['-p'+password]:[])]);
   if(format==='7z'){
    const volumeBytes=Buffer.concat(await Promise.all(members.sort().map(file=>fs.readFile(file)))),packed=listing.entries.reduce((sum,item)=>sum+item.compressed,0);assert(packed>0);assert.deepEqual((await fs.readFile(renamed.target)).subarray(32,32+packed),volumeBytes.subarray(32,32+packed),'Split 7Z rename copies existing packed data');
   }
   const changes=[{kind:'rename-folder',folder:'原目录',name:'移动后'},{kind:'delete',indexes:[at('原目录/子目录/delete.txt')]},{kind:'mkdir',name:'新增空目录'},{kind:'add',source:add,name:'移动后/added.txt'},{kind:'add',source:replacement,name:'移动后/keep.bin',replace:true},...(format==='zip'?[{kind:'comment',text:'分卷重写备注'}]:[])];
   const updated=await prepare(source,listing,changes,password),after=await run({operation:'list',path:updated.target,password});assert.equal(after.total,updated.result.count);assert(after.entries.some(item=>name(item.name)==='移动后/added.txt'));assert(!after.entries.some(item=>item.name.endsWith('delete.txt')));if(format==='zip')assert.equal(after.comment,'分卷重写备注');
   assert(after.entries.filter(item=>!item.directory&&item.size).every(item=>item.encrypted===!!password),'Encryption state is retained for replacements and new files');
   const output=await run({operation:'extract',path:updated.target,parent:root,password});assert.equal(await fs.readFile(path.join(output.path,'移动后','keep.bin'),'utf8'),'replacement content');assert.equal(await fs.readFile(path.join(output.path,'移动后','子目录','retain.txt'),'utf8'),'retained nested');assert.equal(await fs.readFile(path.join(output.path,'移动后','added.txt'),'utf8'),'added data');assert((await fs.stat(path.join(output.path,'新增空目录'))).isDirectory());
   assert.deepEqual(await sourceHashes(members),before,'Preparation never replaces or changes source members');
   if(password)await prepare(source,listing,[{kind:'delete',indexes:[at('原目录/keep.bin')]}],'wrong',2);
   await prepare(source,listing,[{kind:'mkdir',name:'../escape'}],password,2);
   await prepare(source,listing,[{kind:'mkdir',name:'原目录/keep.bin/child'}],password,2);
   for(const member of [source,members.find(file=>file!==source)]){
    const rejected=await prepare(source,listing,[{kind:'add',source:member,name:'self.bin'}],password,2);assert(rejected.messages.some(item=>item.type==='error'&&item.message.includes('own update')));
   }
   const alias=path.join(root,'source-volume-alias-'+serial);await fs.link(members.find(file=>file!==source),alias);await prepare(source,listing,[{kind:'add',source:alias,name:'alias.bin'}],password,2);await fs.unlink(alias);
   await prepare(source,listing,[{kind:'mkdir',name:'valid'}],password,2,format==='zip'?'7z':'zip');
   assert.deepEqual(await sourceHashes(members),before,'Failures also retain every source volume');
   const later=members.find(file=>file!==source),bytes=await fs.readFile(later),info=await fs.stat(later),newFile=later+'.new';await fs.writeFile(newFile,bytes);await fs.utimes(newFile,info.atime,info.mtime);await fs.rename(newFile,later);
   const stale=await prepare(source,listing,[{kind:'mkdir',name:'stale'}],password,2);assert(stale.messages.some(item=>item.type==='error'&&item.message.includes('changed')));await assert.rejects(fs.stat(stale.target),{code:'ENOENT'});
   const fresh=await run({operation:'list',path:source,password});const gone=later+'.missing';await fs.rename(later,gone);try{await prepare(source,fresh,[{kind:'mkdir',name:'missing'}],password,2);}finally{await fs.rename(gone,later);}
   // Removing everything still verifies the original before producing a valid
   // empty container. A corrupted removed entry is never silently discarded.
   const empty=await prepare(source,fresh,[{kind:'delete',folders:['原目录'],indexes:[]}],password);assert.equal(empty.result.count,0);native(['test',empty.target,'0'],password);
   const corrupt=await fs.open(later,'r+');try{await corrupt.write(Buffer.from([bytes[200]^255]),0,1,200);}finally{await corrupt.close();}const corruptList=await run({operation:'list',path:source,password}).catch(()=>undefined);
   if(corruptList)await prepare(source,corruptList,[{kind:'delete',folders:['原目录'],indexes:[]}],password,2);
  }
  for(const solid of [true,false]){
   const password=solid?'external secret':'',target=path.join(root,`external-${solid?'solid':'blocks'}.7z`);
   seven(['a','-t7z',solid?'-ms=on':'-ms=off','-mhe=off','-v1m',...(password?['-p'+password]:[]),target,dir]);
   const source=target+'.001',listing=await run({operation:'list',path:source,password});assert.match(listing.revision,/^v2:/);
   const members=(await fs.readdir(root)).filter(file=>file.startsWith(path.basename(target)+'.')).map(file=>path.join(root,file)),before=await sourceHashes(members);assert(members.length>=3);
   const retained=listing.entries.find(item=>name(item.name)==='原目录/子目录/retain.txt').index;
   const updated=await prepare(source,listing,[{kind:'rename-folder',folder:'原目录',name:'移动后'},{kind:'delete',indexes:[retained]},{kind:'add',source:add,name:'追加.txt'}],password);
   seven(['t',updated.target,...(password?['-p'+password]:[])]);
   const out=path.join(root,'external-out-'+serial);seven(['x','-y','-o'+out,updated.target,...(password?['-p'+password]:[])]);
   assert.deepEqual(await fs.readFile(path.join(out,'移动后','keep.bin')),data);assert.equal(await fs.readFile(path.join(out,'追加.txt'),'utf8'),'added data');await assert.rejects(fs.stat(path.join(out,'移动后','子目录','retain.txt')),{code:'ENOENT'});
   const after=await run({operation:'list',path:updated.target,password});assert(after.entries.filter(item=>!item.directory&&item.size).every(item=>item.encrypted===!!password));if(password)assert.equal((await run({operation:'list',path:updated.target})).total,after.total,'Visible headers remain visible');
   assert.deepEqual(await sourceHashes(members),before,'External solid/non-solid source volumes remain unchanged');
  }
  // Preparation is internal. The normal GUI/service entry must not accept a
  // forged request that bypasses the future group publication protocol.
  await assert.rejects(run({operation:'update-prepare',path:'fake'}),/请求无效/);
  console.log('Volume rewrite preparation passed: ZIP/7Z, encryption and headers, packed-data rename, external 7-Zip and solid/visible-header archives, recursive edits, additions/replacements/deletion/comments, empty output, source identities/hashes preserved, stale/missing/corrupt volumes and own-volume aliases rejected. Group publication remains separate.');
 }finally{await service?.stop();assert.equal(path.dirname(root),path.resolve('work/temp'));await fs.rm(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
