const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const Module=require('node:module');
const {spawnSync,execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {build}=require('esbuild');
const execute=promisify(execFile);

async function main(){
 await fs.mkdir('work/temp',{recursive:true});const root=await fs.mkdtemp(path.resolve('work/temp/one-archive-space-'));let service;
 const keys=['ONE_TEST_MODE','ONE_ARCHIVE_SPACE_TEST_AFTER_BYTES','ONE_ARCHIVE_SPACE_TEST_AVAILABLE_BYTES','ONE_ARCHIVE_DRAG_TEST_TARGET','TEMP','TMP'];
 const old=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 const reserve=256*1024**2,helper=path.resolve('dist/native/One.Archive.exe');
 const native=(args,env={})=>{
  const result=spawnSync(helper,args,{input:Buffer.alloc(4),env:{...process.env,...env},encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:2*1024**2});
  assert(!result.error,String(result.error));return {status:result.status,events:result.stdout.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse)};
 };
 const fault=(after,available)=>{process.env.ONE_ARCHIVE_SPACE_TEST_AFTER_BYTES=String(after);process.env.ONE_ARCHIVE_SPACE_TEST_AVAILABLE_BYTES=String(available);};
 const clearFault=()=>{delete process.env.ONE_ARCHIVE_SPACE_TEST_AFTER_BYTES;delete process.env.ONE_ARCHIVE_SPACE_TEST_AVAILABLE_BYTES;};
 const cacheEntries=()=>fs.readdir(path.join(root,'cache')).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
 try{
  Object.assign(process.env,{ONE_TEST_MODE:'1',TEMP:root,TMP:root});clearFault();
  // Query scheduling and arithmetic are deterministic, with no real disk filling.
  const vswhere=path.join(process.env['ProgramFiles(x86)']||'C:\\Program Files (x86)','Microsoft Visual Studio/Installer/vswhere.exe');
  const found=await execute(vswhere,['-latest','-products','*','-requires','Microsoft.VisualStudio.Component.VC.Tools.x86.x64','-property','installationPath'],{windowsHide:true});
  const installation=found.stdout.trim();assert(installation);
  const command=path.join(root,'space-test.cmd'),unit=path.join(root,'space-test.exe');
  await fs.writeFile(command,`@echo off\r\ncall "${installation}\\VC\\Auxiliary\\Build\\vcvars64.bat" >nul\r\nif errorlevel 1 exit /b 1\r\ncl /nologo /std:c++20 /EHsc /MT /O2 /UNDEBUG /utf-8 /DUNICODE /D_UNICODE /I"${path.resolve('native/archive')}" "${path.resolve('tests/archive-space.cpp')}" "${path.resolve('native/archive/extract-space.cpp')}" /Fe:"${unit}"\r\n`);
  const built=await execute('cmd.exe',['/d','/c',command],{cwd:root,windowsHide:true});assert(!built.stderr,built.stderr);
  const checked=await execute(unit,[],{windowsHide:true});process.stdout.write(checked.stdout);
  const compiled=await build({entryPoints:['src/main/archive-service.ts','src/main/archive-cli.ts'],outdir:'virtual',bundle:true,platform:'node',format:'cjs',write:false});
  const load=name=>{const filename=path.resolve(`dist/main/${name}-space-test.cjs`),mod=new Module(filename);mod.filename=filename;mod.paths=module.paths;mod._compile(compiled.outputFiles.find(file=>file.path.endsWith(name+'.js')).text,filename);return mod.exports;};
  const {ArchiveService}=load('archive-service'),{cliExit}=load('archive-cli');
  service=new ArchiveService(path.join(root,'cache'),()=>{},()=> '0',()=>{},false,undefined,()=>({threads:1,memoryMiB:256}));
  const run=request=>service.run(1,request),source=path.join(root,'large.bin'),small=path.join(root,'small.txt');
  await fs.writeFile(source,Buffer.alloc(24*1024**2,65));await fs.writeFile(small,'preserved selection');
  const archives=[];
  for(const format of ['zip','7z','tar','gz','xz','tar.gz','tar.xz']){
   const file=path.join(root,'contents.'+format);await run({operation:'create',path:file,sources:['gz','xz'].includes(format)?[source]:[source,small],level:1});archives.push(file);
  }
  const safeParent=path.join(root,'output');await fs.mkdir(safeParent);const keep=path.join(safeParent,'keep.txt');await fs.writeFile(keep,'original');
  for(const archive of archives){
   fault(0,reserve+1024**2);await assert.rejects(run({operation:'extract',path:archive,parent:safeParent}),error=>error.code==='write'&&/可用空间不足/.test(error.message));
   fault(1024**2,reserve-1);await assert.rejects(run({operation:'extract',path:archive,parent:safeParent}),error=>error.code==='write'&&/可用空间不足/.test(error.message));
   assert.deepEqual(await fs.readdir(safeParent),['keep.txt']);assert.equal(await fs.readFile(keep,'utf8'),'original');
   assert.deepEqual(await cacheEntries(),[],'failed composite preparation must release its intermediate files');
   clearFault();
  }
  // Exercise a mid-stream native space refusal and writer cleanup behavior.
  for(const archive of archives.slice(0,2)){
   fault(1024**2,reserve-1);const stage=path.join(root,'native-'+path.extname(archive).slice(1));const result=native(['extract',archive,stage,'','0']);
   assert.equal(result.status,2);assert.equal(result.events.at(-1).code,'write');assert(!result.events.some(item=>item.type==='result'));
   if(path.extname(archive)==='.7z')await assert.rejects(fs.stat(stage),{code:'ENOENT'});
   else{const actual=(await fs.stat(path.join(stage,'large.bin'))).size;assert(actual>0&&actual<=24*1024**2);}
   clearFault();
  }
  // A built-in test receiver requests real lazy streams without opening Explorer.
  process.env.ONE_ARCHIVE_DRAG_TEST_TARGET='1';
  for(const archive of archives.slice(0,2)){
   const listing=await run({operation:'list',path:archive}),index=listing.entries.find(entry=>entry.name==='large.bin').index;
   fault(1024**2,reserve-1);
   await assert.rejects(run({operation:'drag',path:archive,revision:listing.revision,selected:[index]}),error=>error.code==='write'&&/可用空间不足/.test(error.message));
   assert.deepEqual(await cacheEntries(),[],'failed drag must release its private cache');clearFault();
  }
  delete process.env.ONE_ARCHIVE_DRAG_TEST_TARGET;
  // The budget uses only selected output, not unrelated large entries.
  for(const archive of archives.slice(0,3)){
   const listing=await run({operation:'list',path:archive}),index=listing.entries.find(entry=>entry.name==='small.txt').index;
   fault(0,reserve+1024**2);const selected=await run({operation:'extract',path:archive,parent:safeParent,selected:[index]});
   assert.deepEqual(await fs.readdir(selected.path),['small.txt']);assert.equal(await fs.readFile(path.join(selected.path,'small.txt'),'utf8'),'preserved selection');clearFault();
  }
  const finishSource=path.join(root,'finish.bin');await fs.writeFile(finishSource,Buffer.alloc(65536,7));const finishArchive=path.join(root,'finish.zip');await run({operation:'create',path:finishArchive,sources:[finishSource]});
  fault(65536,reserve-1);const finished=native(['extract',finishArchive,path.join(root,'finish-stage'),'','0']);assert.equal(finished.status,2);assert.equal(finished.events.at(-1).code,'write');assert.equal((await fs.stat(path.join(root,'finish-stage','finish.bin'))).size,65536);clearFault();
  // Metadata/browser/test paths do not require output space. Outside test mode,
  // even deliberately malformed test settings have no effect on real reads.
  fault(0,0);await run({operation:'list',path:archives[0]});await run({operation:'test',path:archives[0]});
  const normal=native(['extract',finishArchive,path.join(root,'normal-stage'),'','0'],{ONE_TEST_MODE:'0',ONE_ARCHIVE_SPACE_TEST_AFTER_BYTES:'bad',ONE_ARCHIVE_SPACE_TEST_AVAILABLE_BYTES:'bad'});assert.equal(normal.status,0);clearFault();
  assert.equal(cliExit({code:'write'}),6);
  const retry=await run({operation:'extract',path:archives[0],parent:safeParent});assert.equal((await fs.stat(path.join(retry.path,'large.bin'))).size,24*1024**2);
  assert(!(await fs.readdir(safeParent)).some(name=>name.startsWith('.one-')));
  console.log('Extraction space integration passed: real ZIP/7Z/TAR/GZ/XZ/composite writes, drag preparation, selected output, preflight/mid-stream/final failures, unpublished cleanup, test isolation and retry.');
 }finally{
  await service?.stop();for(const [key,value] of Object.entries(old))if(value===undefined)delete process.env[key];else process.env[key]=value;
  const relative=path.relative(path.resolve('work/temp'),root);assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));await fs.rm(root,{recursive:true,force:true});
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
