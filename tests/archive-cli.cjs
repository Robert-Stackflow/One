const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {spawn,execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {build}=require('esbuild');
const JSZip=require('jszip');
const asar=require('@electron/asar');
const execute=promisify(execFile);

async function main(){
 await fs.mkdir('work/temp',{recursive:true});const parent=path.resolve('work/temp'),root=await fs.mkdtemp(path.join(parent,'archive-cli-test-'));
 const profile=path.join(root,'profile'),cli=path.resolve('dist/native/One.Cli.exe');
 const env={...process.env,ONE_TEST_MODE:'1',ONE_DATA_DIR:profile,TEMP:root,TMP:root};
 try{
  const unit=path.join(root,'cli-unit.cjs');await build({entryPoints:['src/main/archive-cli.ts'],outfile:unit,bundle:true,platform:'node'});
  const {parseCli,runCli,CliFailure}=require(unit);
  for(const args of [['create','--output','x.zip'],['create','--output','x.zip','--volume-size','1','a'],['list','--encoding','42','a.zip'],['test','--output','x','a.zip'],['extract','--output','out','--select','-1','a.zip'],['create','--output','x.zip','--format','7z','a'],['create','--output','x.tar.gz','--format','gz','a'],['list','--json','--json','a.zip'],['list','--password=SECRET','a.zip']])assert.throws(()=>parseCli(args,root),CliFailure);
  assert.equal(parseCli(['create','--output','x.7z','--volume-size','2MiB','a'],root).jobs[0].request.volumeBytes,2*1024**2);
  const slow=new AbortController(),lines=[];let cancelled=0;
  const fake={run:async()=>{await new Promise(resolve=>setTimeout(resolve,100));throw Error('stopped');},cancel:()=>{cancelled++;return true;}};
  const pending=runCli(parseCli(['test','--json','a.zip','b.zip'],root),fake,{out:async line=>lines.push(JSON.parse(line)),err:async()=>{},signal:slow.signal,password:async()=>''});
  // Ordinary source validation uses real files even with a controlled engine.
  await pending;assert.equal(lines.at(-1).exitCode,5);
  await fs.writeFile(path.join(root,'a.zip'),'fixture');await fs.writeFile(path.join(root,'b.zip'),'fixture');lines.length=0;
  const running=runCli(parseCli(['test','--json','a.zip','b.zip'],root),fake,{out:async line=>lines.push(JSON.parse(line)),err:async()=>{},signal:slow.signal,password:async()=>''});setTimeout(()=>slow.abort(),20);
  assert.equal(await running,130);assert(cancelled>0);assert.equal(lines.at(-1).cancelled,2);
  let calls=0;assert.equal(await runCli(parseCli(['list','--json','a.zip'],root),{run:async()=>{calls++;return {total:201,offset:calls===1?0:200,entries:calls===1?Array.from({length:200},(_,index)=>({index,name:String(index),size:0,compressed:0,directory:false,encrypted:false})):[],revision:'x',comment:''};},cancel:()=>false},{out:async()=>{},err:async()=>{},signal:new AbortController().signal,password:async()=>''}),4);

  const run=async(args,input='',expected=0,host=cli,cwd=root)=>{
   const child=spawn(host,['archive',...args],{cwd,env,windowsHide:true,stdio:'pipe'});let out='',err='';child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',chunk=>out+=chunk);child.stderr.on('data',chunk=>err+=chunk);child.stdin.on('error',()=>{});child.stdin.end(input);
   const timer=setTimeout(()=>child.kill(),20000);const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});clearTimeout(timer);
   assert.equal(code,expected,`${args[0]}: ${out}\n${err}`);const records=args.includes('--json')?out.trim().split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line)):[];
   return {out,err,records};
  };
  assert((await run(['--help'])).out.includes('One.Cli.exe'));
  const input=path.join(root,'中文 & input');await fs.mkdir(input);await fs.writeFile(path.join(input,'hello.txt'),'hello CLI');await fs.writeFile(path.join(input,'-leading $().txt'),'literal');
  const stored=path.join(root,'store-only.zip');await run(['create','--json','--output',stored,'--level','0','--threads','1','--memory-mib','128',path.join(input,'hello.txt')]);
  const storedZip=await JSZip.loadAsync(await fs.readFile(stored));assert.equal(storedZip.file('hello.txt')._data.compressedSize,Buffer.byteLength('hello CLI'));
  await run(['create','--json','--output','invalid-level.zip','--level','10',input],'',2);await run(['test','--json','--memory-mib','127',stored],'',2);
  await run(['create','--json','--output',path.join(root,'literal.zip'),'--','-leading $().txt'],'',0,cli,input);
  await run(['create','--json','--output','中文 archive.zip',input]);
  const archive=path.join(root,'中文 archive.zip');
  const zone='[ZoneTransfer]\r\nZoneId=3\r\n';await fs.writeFile(archive+':Zone.Identifier',zone);
  await run(['create','--json','--output',archive,input],'',6);
  const listed=await run(['list','--json',archive]);assert.equal(listed.records.filter(item=>item.type==='entry').length,3);assert.equal(listed.records.at(-1).completed,1);
  await run(['test','--json',archive]);
  const outdir=path.join(root,'out');await fs.mkdir(outdir);const extracted=await run(['extract','--json','--destination','smart','--output',outdir,archive]);
  assert.equal(await fs.readFile(path.join(extracted.records.find(item=>item.type==='result').path,'hello.txt'),'utf8'),'hello CLI');
  assert.equal(await fs.readFile(path.join(extracted.records.find(item=>item.type==='result').path,'hello.txt')+':Zone.Identifier','utf8'),zone);
  const noZone=await run(['extract','--json','--no-zone','--output',outdir,archive]);await assert.rejects(fs.readFile(path.join(noZone.records.find(item=>item.type==='result').path,path.basename(input),'hello.txt')+':Zone.Identifier'),{code:'ENOENT'});
  for(const [mode,exitCode,state] of [['passed',0,'passed'],['unavailable',10,'incomplete'],['failure',10,'incomplete'],['blocked',11,'blocked'],['stall',10,'incomplete']]){
   env.ONE_ARCHIVE_SCAN_TEST=mode;env.ONE_ARCHIVE_SCAN_TIMEOUT_MS='100';const before=await fs.readdir(outdir);
   const scanned=await run(['extract','--json','--scan','--output',outdir,archive],'',exitCode);
   const report=scanned.records.find(item=>item.type===(exitCode?'error':'result')).scan;assert.equal(report.state,state);
   if(!exitCode)assert.equal(report.files,2);else assert.deepEqual(await fs.readdir(outdir),before,'failed scan cannot publish output');
  }
  const scanOff=await run(['extract','--json','--no-scan','--output',outdir,archive]);assert.equal(scanOff.records.find(item=>item.type==='result').scan,undefined);
  delete env.ONE_ARCHIVE_SCAN_TEST;delete env.ONE_ARCHIVE_SCAN_TIMEOUT_MS;
  await run(['extract','--json','--scan','--no-scan','--output',outdir,archive],'',2);
  const selection=listed.records.find(item=>item.type==='entry'&&item.name.endsWith('hello.txt')).index;
  await run(['extract','--json','--destination','here','--select',String(selection),'--output',outdir,archive]);assert.equal(await fs.readFile(path.join(outdir,path.basename(input),'hello.txt'),'utf8'),'hello CLI');
  const secret='  私密 $() " spaces  ';await run(['create','--json','--output','secret.zip','--password-stdin',path.join(input,'hello.txt')],secret+'\r\n');
  await run(['test','--json',path.join(root,'secret.zip')],'',3);await run(['test','--json','--password-stdin',path.join(root,'secret.zip')],'wrong',3);
  await run(['test','--json','--password-stdin',path.join(root,'secret.zip')],secret,0);await run(['test','--json','--password-stdin',archive],'x\nx\n',2);
  const invalid=path.join(root,'broken.zip');await fs.writeFile(invalid,'not an archive');await run(['test','--json',invalid],'',4);
  await run(['test','--json',archive,path.join(root,'missing.zip')],'',8);
  const blocked=path.join(root,'blocked-parent');await fs.writeFile(blocked,'ordinary file');await run(['create','--json','--output',path.join(blocked,'write.zip'),input],'',6);
  await run(['list','--json','--password=DO_NOT_ECHO',archive],'',2).then(value=>assert(!value.out.includes('DO_NOT_ECHO')));
  const unsafe=new JSZip();unsafe.file('../escape.txt','bad');const unsafePath=path.join(root,'unsafe.zip');await fs.writeFile(unsafePath,await unsafe.generateAsync({type:'nodebuffer'}));await run(['extract','--json','--output',outdir,unsafePath],'',7);
  const changes=path.join(root,'changes.json');await fs.writeFile(changes,JSON.stringify([{kind:'rename',index:selection,name:'renamed.txt'},{kind:'comment',text:'CLI 备注'}]));await run(['update','--json','--changes',changes,archive]);
  const updated=await run(['list','--json',archive]);assert.equal(updated.records.find(item=>item.type==='meta').comment,'CLI 备注');assert(updated.records.some(item=>item.name==='renamed.txt'));
  await fs.writeFile(changes,JSON.stringify([{kind:'add',source:'中文 & input/hello.txt',name:'added.txt'}]));await run(['update','--json','--changes',changes,archive]);
  await fs.writeFile(changes,JSON.stringify([{kind:'comment',text:'x',password:'NO'}]));await run(['update','--json','--changes',changes,archive],'',2);
  for(const format of ['7z','tar.gz','tar.xz']){const name=path.join(root,'roundtrip.'+format);await run(['create','--json','--output',name,input]);await run(['test','--json',name]);await run(['extract','--json','--output',outdir,name]);}
  await run(['create','--json','--password-stdin','--output','secret.7z',input],secret);await run(['test','--json',path.join(root,'secret.7z')],'',3);await run(['test','--json','--password-stdin',path.join(root,'secret.7z')],secret);
  const seven=path.join(root,'secret.7z'),sevenBefore=await run(['list','--json','--password-stdin',seven],secret);
  const sevenIndex=sevenBefore.records.find(item=>item.type==='entry'&&item.name.endsWith('hello.txt')).index;
  await fs.writeFile(changes,JSON.stringify([{kind:'rename',index:sevenIndex,name:'改名.txt'},{kind:'mkdir',name:'空目录'},{kind:'add',source:'中文 & input/hello.txt',name:'新文件.txt'}]));
  await run(['update','--json','--password-stdin','--changes',changes,seven],secret);
  const sevenAfter=await run(['list','--json','--password-stdin',seven],secret);assert(sevenAfter.records.some(item=>item.name==='改名.txt'));assert(sevenAfter.records.some(item=>item.name==='新文件.txt'));
  await run(['test','--json','--password-stdin',seven],secret);await run(['list','--json',seven],'',3);
  await fs.writeFile(changes,JSON.stringify([{kind:'comment',text:'unsupported'}]));const sevenBytes=await fs.readFile(seven);
  await run(['update','--json','--password-stdin','--changes',changes,seven],secret,1);assert.deepEqual(await fs.readFile(seven),sevenBytes);
  const volumeSource=path.join(root,'volume.bin');await fs.writeFile(volumeSource,require('node:crypto').randomBytes(3*1024**2));
  for(const format of ['zip','7z']){const archive=path.join(root,'volume.'+format);const created=await run(['create','--json','--volume-size','1MiB','--output',archive,volumeSource]);const first=created.records.find(item=>item.type==='result').path;await run(['test','--json',first]);await run(['extract','--json','--output',outdir,first]);}
  const largeDir=path.join(root,'many');await fs.mkdir(largeDir);await Promise.all(Array.from({length:425},(_,index)=>fs.writeFile(path.join(largeDir,index+'.txt'),String(index))));
  await run(['create','--json','--output','many.zip',largeDir]);const many=await run(['list','--json',path.join(root,'many.zip')]);assert.equal(many.records.filter(item=>item.type==='entry').length,426);
  const plan=path.join(root,'jobs.json');await fs.writeFile(plan,JSON.stringify([['create','--output','batch.zip','中文 & input'],['test','batch.zip'],['extract','--output','out','--destination','folder','batch.zip'],['list','missing.zip']]));
  const batch=await run(['batch','--json','--jobs',plan],'',8);assert.equal(batch.records.at(-1).completed,3);assert.equal(batch.records.at(-1).failed,1);
  await fs.writeFile(plan,JSON.stringify([['create','--output','should-not-exist.zip','中文 & input'],['batch','--jobs','jobs.json']]));await run(['batch','--json','--jobs',plan],'',2);await assert.rejects(()=>fs.stat(path.join(root,'should-not-exist.zip')));

  // Verify installed file layout and ASAR resolution without installing or
  // launching a GUI. Hard links keep the private runtime lightweight.
  const packaged=path.join(root,'packaged'),source=path.join(root,'asar-source');await fs.mkdir(path.join(source,'dist/main'),{recursive:true});await fs.mkdir(path.join(source,'dist/native'),{recursive:true});await fs.mkdir(path.join(packaged,'resources'),{recursive:true});
  async function linkTree(from,to){await fs.mkdir(to,{recursive:true});for(const item of await fs.readdir(from,{withFileTypes:true})){if(item.isDirectory())await linkTree(path.join(from,item.name),path.join(to,item.name));else await fs.link(path.join(from,item.name),path.join(to,item.name==='electron.exe'?'One.exe':item.name));}}
  await linkTree(path.resolve('node_modules/electron/dist'),packaged);
  await fs.copyFile(path.resolve('dist/main/archive-cli-entry.cjs'),path.join(source,'dist/main/archive-cli-entry.cjs'));
  await fs.writeFile(path.join(source,'package.json'),JSON.stringify({version:'0.16.20'}));
  for(const file of ['One.Archive.exe','7z.dll'])await fs.copyFile(path.resolve('dist/native',file),path.join(source,'dist/native',file));
  await asar.createPackageWithOptions(source,path.join(packaged,'resources/app.asar'),{unpackDir:'dist/native'});await fs.copyFile(cli,path.join(packaged,'One.Cli.exe'));
  await run(['create','--json','--output','packaged.zip',input],'',0,path.join(packaged,'One.Cli.exe'));await run(['test','--json',path.join(root,'packaged.zip')],'',0,path.join(packaged,'One.Cli.exe'));
  const candidate=path.join(root,'release-check');await fs.mkdir(candidate);await fs.rename(packaged,path.join(candidate,'win-unpacked'));await fs.copyFile(cli,path.join(source,'dist/native/One.Cli.exe'));
  const {validateRelease}=await import('../scripts/release.mjs');assert.equal((await validateRelease(candidate,source,'0.16.20')).checked,4);

  // Real Windows console cancellation; isolated helper process group means
  // the service, rather than the console, owns cleanup of archive publication.
  const vswhere=path.join(process.env['ProgramFiles(x86)'],'Microsoft Visual Studio/Installer/vswhere.exe');const {stdout}=await execute(vswhere,['-latest','-products','*','-requires','Microsoft.VisualStudio.Component.VC.Tools.x86.x64','-property','installationPath'],{windowsHide:true});
  const script=path.join(root,'console.cmd'),harness=path.join(root,'console.exe');await fs.writeFile(script,`@echo off\r\ncall "${stdout.trim()}\\VC\\Auxiliary\\Build\\vcvars64.bat" >nul\r\ncl /nologo /std:c++20 /EHsc /MT /O2 /DUNICODE /D_UNICODE "${path.resolve('tests/archive-cli-console.cpp')}" /Fe:"${harness}" /Fo:"${path.join(root,'console.obj')}"\r\n`);await execute('cmd.exe',['/d','/c',script],{cwd:root,env,windowsHide:true});
  const big=path.join(root,'big.bin');const handle=await fs.open(big,'w');try{const block=require('node:crypto').randomBytes(1024**2);for(let index=0;index<96;index++)await handle.write(block);}finally{await handle.close();}
  for(const event of ['break','c']){
   const captured=path.join(root,`cancel-${event}.jsonl`),errors=path.join(root,`cancel-${event}.stderr`),target=path.join(root,`cancel-${event}.zip`);
   const interrupted=spawn(harness,[captured,errors,cli,'archive','create','--json','--progress','--output',target,big],{env:{...env,ONE_TEST_CONSOLE_EVENT:event},windowsHide:true,stdio:'pipe'});const exit=await new Promise((resolve,reject)=>{interrupted.on('error',reject);interrupted.on('close',resolve);});
   assert.equal(exit,130,await fs.readFile(captured,'utf8')+'\n'+await fs.readFile(errors,'utf8'));await assert.rejects(()=>fs.stat(target));assert(!(await fs.readdir(root)).some(name=>name.startsWith('.one-archive-')));
  }
  const sessions=await fs.readdir(path.join(profile,'archive-cli/temp'));assert.deepEqual(sessions,[]);
  const log=await fs.readFile(path.join(profile,'logs/cli.jsonl'),'utf8');assert(log.includes('archive-cli-operation'));assert(!log.includes(secret));assert(!log.includes('hello.txt'));
  console.log('Archive CLI: parser, encrypted/format roundtrips, editing, pagination, batch errors, ASAR and real console cancellation passed');
 }finally{const child=path.relative(parent,root);if(child&&!child.startsWith('..')&&!path.isAbsolute(child))await fs.rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:200});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
