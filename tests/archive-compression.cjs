const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const Module=require('node:module');
const {randomBytes,createHash}=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {build}=require('esbuild');
async function main(){
 await fs.mkdir('work/temp',{recursive:true});const root=await fs.mkdtemp(path.resolve('work/temp/one-archive-compression-'));let service;
 const previous={TEMP:process.env.TEMP,TMP:process.env.TMP};process.env.TEMP=root;process.env.TMP=root;
 const external=(args)=>{const result=spawnSync('7z',args,{encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:1024**2});assert.equal(result.status,0,result.stdout+'\n'+result.stderr);return result.stdout;};
 const digest=buffer=>createHash('sha256').update(buffer).digest('hex');
 try{
  const compiled=await build({entryPoints:['src/main/archive-service.ts','src/main/archive-cli.ts','src/shared/settings.ts'],outdir:'virtual',bundle:true,platform:'node',format:'cjs',write:false});
  const load=name=>{const filename=path.resolve('dist/main/'+name+'-compression-test.cjs'),mod=new Module(filename);mod.filename=filename;mod.paths=module.paths;mod._compile(compiled.outputFiles.find(file=>file.path.endsWith(name+'.js')).text,filename);return mod.exports;};
  const {ArchiveService}=load('archive-service'),{parseCli,CliFailure}=load('archive-cli'),{defaultSettings,validateSettings,mergeSettings}=load('settings');
  const legacy=defaultSettings();for(const key of ['zipMethod','zipEncryption','sevenMethod','sevenSolid','autoThreads'])delete legacy.archive[key];
  const migrated=validateSettings(legacy);assert.equal(migrated.archive.zipMethod,'deflate');assert.equal(migrated.archive.zipEncryption,'aes256');assert.equal(migrated.archive.threads,2);assert.equal(migrated.archive.autoThreads,false);
  const restored=validateSettings(JSON.parse(JSON.stringify(mergeSettings(migrated,{archive:{zipMethod:'xz',zipEncryption:'zipcrypto',sevenMethod:'lzma',sevenSolid:'off',autoThreads:true}}))));assert.equal(restored.archive.sevenSolid,'off');assert.equal(restored.archive.autoThreads,true);
  for(const patch of [{zipMethod:'lzma'},{zipEncryption:'aes128'},{sevenMethod:'xz'},{sevenSolid:3},{sevenSolid:0},{sevenSolid:'64'},{autoThreads:1},{zipMethod:null},{sevenSolid:null}])assert.throws(()=>mergeSettings(migrated,{archive:patch}));
  const cli=parseCli(['create','--output','test.zip','--zip-method','xz','--zip-encryption','zipcrypto','--threads','auto','file'],root).jobs[0].request;assert.equal(cli.zipMethod,'xz');assert.equal(cli.autoThreads,true);
  assert.equal(parseCli(['create','--output','test.7z','--seven-method','lzma','--solid','1024','file'],root).jobs[0].request.sevenSolid,1024);
  for(const args of [['create','--output','a.tar','--zip-method','xz','file'],['create','--output','a.zip','--solid','64','file'],['create','--output','a.7z','--solid','3','file'],['create','--output','a.zip','--zip-encryption','AES128','file'],['test','--threads','auto','a.zip']])assert.throws(()=>parseCli(args,root),CliFailure);
  const source=path.join(root,'输入 文件');await fs.mkdir(source);const names=['中文.txt','file two.bin','third.bin'],contents=names.map(()=>randomBytes(750000));for(let i=0;i<names.length;i++)await fs.writeFile(path.join(source,names[i]),contents[i]);await fs.mkdir(path.join(source,'empty'));
  const events=[];service=new ArchiveService(path.join(root,'cache'),()=>{},()=> '0',(event,detail)=>events.push({event,detail}));
  const run=request=>service.run(1,request);
  let cases=0;
  for(const method of ['deflate','xz'])for(const encryption of ['none','aes256','zipcrypto'])for(const threads of [1,3])for(const split of [false,true]){
   const target=path.join(root,`zip-${cases++}.zip`),password=encryption==='none'?'':'test password';
   await run({operation:'create',path:target,sources:[source],zipMethod:method,zipEncryption:encryption==='none'?'aes256':encryption,threads,level:1,memoryMiB:512,volumeBytes:split?1024**2:0,password});
   await run({operation:'test',path:target,password});const listing=await run({operation:'list',path:target});assert.equal(listing.total,5);
   const file=listing.entries.find(item=>item.name.endsWith(names[0]));assert.equal(file.encrypted,!!password);
   const details=await run({operation:'details',path:target,index:file.index,revision:listing.revision,password});assert.match(details.details.method,new RegExp(method==='xz'?'XZ':'Deflate','i'));
   const text=external(['l','-slt',...(password?['-p'+password]:[]),target]);assert.match(text,new RegExp(method==='xz'?'XZ':'Deflate','i'));if(password)assert.match(text,encryption==='zipcrypto'?/ZipCrypto/:/AES-256/);
   external(['t','-y',...(password?['-p'+password]:[]),target]);
   const parent=path.join(root,'out-'+cases);await fs.mkdir(parent);const result=await run({operation:'extract',path:target,parent,password,propagateZone:false});
   for(let i=0;i<names.length;i++)assert.equal(digest(await fs.readFile(path.join(result.path,path.basename(source),names[i]))),digest(contents[i]));
   if(method==='xz'&&threads===3&&!split){const name=path.basename(source)+'/renamed.txt';await run({operation:'update',path:target,revision:listing.revision,changes:[{kind:'rename',index:file.index,name}],password});await run({operation:'test',path:target,password});external(['t','-y',...(password?['-p'+password]:[]),target]);}
   assert(!(await fs.readdir(root)).some(name=>name.startsWith('.one-archive-')),'No unpublished archive/worker staging should remain');
  }
  for(const method of ['lzma','lzma2'])for(const solid of ['off',1,2,4,8,16,32,64,128,256,512,1024,'solid']){
   const target=path.join(root,`seven-${cases++}.7z`),password=solid==='off'?'test password':'';
   await run({operation:'create',path:target,sources:[source],sevenMethod:method,sevenSolid:solid,level:1,threads:2,memoryMiB:512,password});await run({operation:'test',path:target,password});
   const info=external(['l','-slt',...(password?['-p'+password]:[]),target]);assert.match(info,method==='lzma'?/Method = LZMA(?:\s|:)/:/Method = LZMA2/);
   const blocks=Number(/\nBlocks = (\d+)/.exec(info)?.[1]);assert.equal(blocks,solid==='off'||solid===1?3:solid===2?2:1,method+' / '+solid);external(['t','-y',...(password?['-p'+password]:[]),target]);
  }
  const auto=path.join(root,'auto.zip');await run({operation:'create',path:auto,sources:[source],autoThreads:true,level:0});await run({operation:'test',path:auto});
  const resource=events.filter(item=>item.event==='archive-resources').map(item=>JSON.parse(item.detail)).findLast(item=>item.autoThreads&&item.operation==='create');assert(resource&&resource.threads>=1&&resource.threads<=4);
  for(const patch of [{zipMethod:'invalid'},{sevenSolid:3},{autoThreads:0}])await assert.rejects(run({operation:'create',path:path.join(root,'invalid.zip'),sources:[source],...patch}));
  const compatible=path.join(root,'legacy-password.zip'),secret='中文密码';await run({operation:'create',path:compatible,sources:[source],zipMethod:'xz',zipEncryption:'zipcrypto',threads:3,level:1,password:secret,passwordEncoding:936});await run({operation:'test',path:compatible,password:secret,passwordEncoding:936});external(['t','-y','-p'+secret,compatible]);
  const collisionId='12345678-1234-1234-1234-123456789012',collision=path.join(root,'.one-archive-'+collisionId+'-stage');await fs.mkdir(collision);await fs.writeFile(path.join(collision,'unrelated.txt'),'preserve');
  await assert.rejects(service.run(1,{operation:'create',path:path.join(root,'collision.zip'),sources:[source],threads:3},collisionId));assert.equal(await fs.readFile(path.join(collision,'unrelated.txt'),'utf8'),'preserve');await fs.rm(collision,{recursive:true});
  const failed=path.join(root,'resource-failure.zip');await assert.rejects(run({operation:'create',path:failed,sources:[source],zipMethod:'xz',level:9,threads:3,memoryMiB:128}),error=>error.code==='resource');await assert.rejects(fs.stat(failed),{code:'ENOENT'});
  const cancelId='22345678-1234-1234-1234-123456789012',cancelTarget=path.join(root,'cancelled.zip'),cancelStage=path.join(root,'.one-archive-'+cancelId+'-stage');
  let cancelled=false,checking=false;const timer=setInterval(async()=>{if(checking)return;checking=true;try{if((await fs.readdir(cancelStage)).length&&!cancelled)cancelled=service.cancel(cancelId,1);}catch{}finally{checking=false;}},5);
  try{await assert.rejects(service.run(1,{operation:'create',path:cancelTarget,sources:[source],zipMethod:'xz',level:9,threads:3,memoryMiB:1024},cancelId));assert(cancelled,'Cancel after real worker part creation');}finally{clearInterval(timer);}
  await assert.rejects(fs.stat(cancelTarget),{code:'ENOENT'});assert(!(await fs.readdir(root)).some(name=>name.startsWith('.one-archive-')),'Cancellation and worker failure must release unpublished parts');
  console.log(`Compression options passed: ${cases} real format/encryption/threads/volume/solid combinations, native and 7-Zip verification, extracted hashes, XZ ZIP updates, settings migration/backup, CLI validation, automatic thread budgeting and staging cleanup.`);
 }finally{await service?.stop();for(const [key,value] of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;const relative=path.relative(path.resolve('work/temp'),root);assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));await fs.rm(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
