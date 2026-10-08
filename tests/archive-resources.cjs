const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const Module=require('node:module');
const {spawnSync}=require('node:child_process');
const {build}=require('esbuild');
async function main(){
 await fs.mkdir('work/temp',{recursive:true});const root=await fs.mkdtemp(path.resolve('work/temp/one-archive-resources-'));let service;
 const helper=path.resolve('dist/native/One.Archive.exe');
 const native=(args,options={},expected=0)=>{const result=spawnSync(helper,args,{input:Buffer.alloc(4),env:{...process.env,TEMP:root,TMP:root,...options},encoding:'utf8',timeout:60000,maxBuffer:4*1024**2,windowsHide:true});assert.equal(result.status,expected,result.stdout+'\n'+result.stderr+'\n'+result.error);return result.stdout.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);};
 try{
  const compiled=await build({entryPoints:['src/main/archive-service.ts','src/main/archive-cli.ts','src/shared/settings.ts'],outdir:'virtual',bundle:true,platform:'node',format:'cjs',write:false});
  const load=name=>{const filename=path.resolve('dist/main/'+name+'-resources-test.cjs'),mod=new Module(filename);mod.filename=filename;mod.paths=module.paths;mod._compile(compiled.outputFiles.find(file=>file.path.endsWith(name+'.js')).text,filename);return mod.exports;};
  const {ArchiveService}=load('archive-service'),{parseCli,CliFailure,cliExit}=load('archive-cli'),{defaultSettings,validateSettings,mergeSettings}=load('settings');
  const legacy=defaultSettings();delete legacy.archive.compressionLevel;delete legacy.archive.threads;delete legacy.archive.memoryMiB;
  assert.deepEqual(validateSettings(legacy).archive,defaultSettings().archive);
  const saved=mergeSettings(validateSettings(legacy),{archive:{compressionLevel:0,threads:1,memoryMiB:128}});assert.equal(validateSettings(JSON.parse(JSON.stringify(saved))).archive.memoryMiB,128);
  for(const patch of [{compressionLevel:10},{compressionLevel:'6'},{compressionLevel:null},{threads:0},{threads:65},{threads:1.5},{threads:null},{memoryMiB:127},{memoryMiB:8193},{memoryMiB:'1024'},{memoryMiB:null}])assert.throws(()=>mergeSettings(defaultSettings(),{archive:patch}));
  for(const args of [['create','--output','a.zip','--level','10','input'],['create','--output','a.tar','--level','6','input'],['create','--output','a.zip','--level','1.5','input'],['test','--threads','0','a.zip'],['list','--memory-mib','127','a.zip'],['test','--level','1','a.zip']])assert.throws(()=>parseCli(args,root),CliFailure);
  const cli=parseCli(['create','--output','a.zip','--level','0','--threads','1','--memory-mib','128','input'],root).jobs[0].request;
  assert.equal(cli.level,0);assert.equal(cli.threads,1);assert.equal(cli.memoryMiB,128);assert.equal(cliExit({code:'resource'}),9);
  const source=path.join(root,'compressible.txt');await fs.writeFile(source,'archive resource policy\n'.repeat(260000));
  const configured={compressionLevel:0,threads:1,memoryMiB:128},events=[];
  service=new ArchiveService(path.join(root,'cache'),()=>{},()=> '0',(event,detail)=>events.push({event,detail}),false,undefined,()=>configured);
  const run=request=>service.run(1,request);
  const stored=path.join(root,'stored.zip');await run({operation:'create',path:stored,sources:[source]});
  const zipped=path.join(root,'compressed.zip');await run({operation:'create',path:zipped,sources:[source],level:9});
  assert((await fs.stat(zipped)).size<(await fs.stat(stored)).size/10);
  assert.equal((await run({operation:'list',path:stored})).entries[0].compressed,(await fs.stat(source)).size);
  for(const format of ['7z','gz','xz','tar.gz','tar.xz']){
   const target=path.join(root,'compressed.'+format);await run({operation:'create',path:target,sources:[source],level:1,threads:2,memoryMiB:256});
   await run({operation:'test',path:target});assert((await fs.stat(target)).size<(await fs.stat(source)).size/10);
   const external=spawnSync('7z',['t','-y',target],{encoding:'utf8',windowsHide:true});assert.equal(external.status,0,external.stdout+'\n'+external.stderr);
  }
  const copy=path.join(root,'stored.7z');await run({operation:'create',path:copy,sources:[source],level:0});assert((await fs.stat(copy)).size>(await fs.stat(source)).size);
  for(const format of ['gz','xz'])for(const level of [0,6,9])await run({operation:'create',path:path.join(root,`level-${level}.${format}`),sources:[source],level,threads:1,memoryMiB:1024});
  const probe=native(['test',stored,'0'],{ONE_ARCHIVE_LEVEL:'0',ONE_ARCHIVE_THREADS:'3',ONE_ARCHIVE_MEMORY_MIB:'192'});assert.deepEqual(probe.find(item=>item.type==='resources'),{type:'resources',level:0,threads:3,memoryMiB:192});
  for(const option of [{ONE_ARCHIVE_LEVEL:'10'},{ONE_ARCHIVE_THREADS:'0'},{ONE_ARCHIVE_MEMORY_MIB:'127'},{ONE_ARCHIVE_MEMORY_MIB:'1024junk'}])assert.equal(native(['test',stored,'0'],option,2).at(-1).code,'resource');
  for(const options of [{level:10},{threads:0},{memoryMiB:127}])await assert.rejects(run({operation:'create',path:path.join(root,'invalid.zip'),sources:[source],...options}));
  // Force the real allocator against a small Windows commit limit. This is a
  // legitimate 64 MiB source, not a mocked engine or just an option echo.
  const big=path.join(root,'large.txt'),handle=await fs.open(big,'w');try{const block=Buffer.alloc(1024**2,65);for(let i=0;i<64;i++)await handle.write(block);}finally{await handle.close();}
  const failed=path.join(root,'budget.7z');await assert.rejects(run({operation:'create',path:failed,sources:[big],level:9,threads:2,memoryMiB:128}),error=>error.code==='resource');await assert.rejects(fs.stat(failed),{code:'ENOENT'});
  const cliTarget=path.join(root,'cli-budget.7z'),cliResult=spawnSync(path.resolve('dist/native/One.Cli.exe'),['archive','create','--json','--output',cliTarget,'--level','9','--memory-mib','128',big],{input:'',env:{...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:path.join(root,'cli-profile'),ONE_ARCHIVE_CLI_PROFILE:path.join(root,'cli-profile'),TEMP:root,TMP:root},encoding:'utf8',timeout:20000,maxBuffer:1024**2,windowsHide:true});
  assert.equal(cliResult.status,9,cliResult.stdout+'\n'+cliResult.stderr+'\n'+cliResult.error);assert(cliResult.stdout.trim().split(/\r?\n/).map(JSON.parse).some(item=>item.type==='error'&&item.exitCode===9));await assert.rejects(fs.stat(cliTarget),{code:'ENOENT'});
  assert(!(await fs.readdir(root)).some(name=>name.startsWith('.one-archive-')),'Failed creation must clean unpublished staging');assert(events.some(item=>item.event==='archive-resource-error'));
  await run({operation:'test',path:stored});assert(events.filter(item=>item.event==='archive-resources').every(item=>JSON.parse(item.detail).memoryMiB>=128));
  console.log('Archive resources passed: legacy/backup defaults, validated GUI/CLI requests, real ZIP/7Z/GZ/XZ/composite levels, Windows commit limits, actual allocation failure, clean staging and retry.');
 }finally{await service?.stop();const child=path.relative(path.resolve('work/temp'),root);assert(child&&!child.startsWith('..')&&!path.isAbsolute(child));await fs.rm(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
