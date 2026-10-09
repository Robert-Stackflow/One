const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {execFile,spawnSync}=require('node:child_process'),{promisify}=require('node:util'),{randomUUID}=require('node:crypto');
const execute=promisify(execFile);
async function aclIntegration(root,binary){
 const helper=path.resolve('dist/native/One.Archive.exe'),env={...process.env,ONE_TEST_MODE:'1',TEMP:root,TMP:root};
 for(const key of ['ONE_ARCHIVE_PUBLISH_CRASH_POINT','ONE_ARCHIVE_PUBLISH_FAIL_AFTER','ONE_ARCHIVE_RECOVER_CRASH_POINT'])delete env[key];
 const acl=(file,deny)=>execute(binary,[deny?'--deny-payload-read':'--allow-payload-read',file],{windowsHide:true,timeout:10000,maxBuffer:65536});
 const run=(args,extra={},status=0)=>{const result=spawnSync(helper,args,{env:{...env,...extra},input:Buffer.from([0,0,0,0,1]),encoding:'utf8',windowsHide:true,timeout:30000});assert.equal(result.status,status,JSON.stringify(result).slice(-6000));return result;};
 const fixture=async label=>{const parent=path.join(root,label),id=randomUUID(),stage=path.join(parent,'.one-extract-'+id),recovery=path.join(parent,'.one-recovery-'+id),source=path.join(stage,'payload.bin'),target=path.join(parent,'payload.bin');await fs.mkdir(stage,{recursive:true});await fs.writeFile(source,'new');await fs.writeFile(target,'old');await acl(source,true);await acl(target,true);return{parent,stage,recovery,source,target};};
 const publish=(job,extra={},status=0)=>run(['publish',job.stage,job.parent,job.recovery,'replace'],extra,status);
 const missing=file=>assert.rejects(fs.stat(file),{code:'ENOENT'});
 const read=async(file,text)=>{await acl(file,false);assert.equal(await fs.readFile(file,'utf8'),text);};
 const success=await fixture('acl-success');publish(success);await missing(success.recovery);await read(success.target,'new');
 const rollback=await fixture('acl-rollback');publish(rollback,{ONE_ARCHIVE_PUBLISH_FAIL_AFTER:'1'},2);await missing(rollback.recovery);await read(rollback.target,'old');await read(rollback.source,'new');
 const restore=await fixture('acl-restore');publish(restore,{ONE_ARCHIVE_PUBLISH_CRASH_POINT:'published:0'},77);
 const manifest=path.join(restore.recovery,'manifest.jsonl');await acl(manifest,true);
 run(['recover',restore.parent,restore.recovery],{},2);assert(await fs.stat(manifest));await acl(manifest,false);
 const restored=run(['recover',restore.parent,restore.recovery]);assert.match(restored.stdout,/"displaced":1/);await read(restore.target,'old');
 const retained=(await fs.readdir(restore.recovery)).filter(name=>name!=='manifest.jsonl');assert.equal(retained.length,1);const displaced=path.join(restore.recovery,retained[0]);await read(displaced,'new');await acl(displaced,true);
 run(['cleanup',restore.parent,restore.recovery]);await missing(restore.recovery);assert.equal(await fs.readFile(restore.target,'utf8'),'old');
 const committed=await fixture('acl-committed');publish(committed,{ONE_ARCHIVE_PUBLISH_CRASH_POINT:'committed'},77);
 const committedManifest=path.join(committed.recovery,'manifest.jsonl');await acl(committedManifest,true);run(['cleanup',committed.parent,committed.recovery],{},2);assert(await fs.stat(committedManifest));await acl(committedManifest,false);
 run(['cleanup',committed.parent,committed.recovery]);await missing(committed.recovery);await read(committed.target,'new');
 console.log('Payload ReadData-deny ACL passed: publish/backup removal, automatic rollback, crash restore/displaced cleanup, committed backup cleanup; unreadable journals remain protected.');
}
async function main(){
 await fs.mkdir('work/temp',{recursive:true});const root=await fs.mkdtemp(path.resolve('work/temp/one-publish-access-'));
 try{
  for(const label of ['original','minimal','original-readonly','minimal-readonly']){const base=path.join(root,label);await fs.mkdir(base);for(const [name,text] of Object.entries({'source.bin':'payload','occupied.bin':'old','blocked.bin':'blocked'}))await fs.writeFile(path.join(base,name),text);}
  const vswhere=path.join(process.env['ProgramFiles(x86)']||'C:\\Program Files (x86)','Microsoft Visual Studio/Installer/vswhere.exe'),found=await execute(vswhere,['-latest','-products','*','-requires','Microsoft.VisualStudio.Component.VC.Tools.x86.x64','-property','installationPath'],{windowsHide:true}),installation=found.stdout.trim();assert(installation);
  const binary=path.join(root,'access.exe'),script=path.join(root,'access.cmd');await fs.writeFile(script,`@echo off\r\ncall "${installation}\\VC\\Auxiliary\\Build\\vcvars64.bat" >nul\r\nif errorlevel 1 exit /b 1\r\ncl /nologo /std:c++20 /EHsc /MT /O2 /UNDEBUG /W4 /WX /utf-8 /DUNICODE /D_UNICODE /I"${path.resolve('native/archive')}" "${path.resolve('tests/archive-publish-access.cpp')}" /Fe:"${binary}" /Fo:"${path.join(root,'access.obj')}" advapi32.lib\r\n`);
  await execute('cmd.exe',['/d','/c',script],{cwd:root,windowsHide:true,maxBuffer:128*1024,timeout:120000});const result=await execute(binary,[root],{cwd:root,windowsHide:true,maxBuffer:65536,timeout:30000});assert.match(result.stdout,/Publishing access passed/);
  for(const label of ['original','minimal','original-readonly','minimal-readonly']){assert.deepEqual((await fs.readdir(path.join(root,label))).sort(),['blocked.bin','occupied.bin']);assert.equal(await fs.readFile(path.join(root,label,'occupied.bin'),'utf8'),'old');assert.equal(await fs.readFile(path.join(root,label,'blocked.bin'),'utf8'),'blocked');}
  console.log(result.stdout.trim());
  await aclIntegration(root,binary);
 }finally{await fs.rm(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(String(error.stderr||error.stdout||error.stack||error).slice(-6000));process.exitCode=1;});
