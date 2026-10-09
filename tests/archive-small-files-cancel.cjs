const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const Module=require('node:module');
const crypto=require('node:crypto');
const {performance}=require('node:perf_hooks');
const {build}=require('esbuild');

async function main(){
 const evidence=path.resolve('work/current/archive-small-files-perf'),source=path.join(evidence,'small-files.zip');
 const manifest=JSON.parse(await fs.readFile(source.replace(/\.zip$/,'.json'),'utf8'));assert.equal(manifest.count,100000);
 const runtime=path.join(evidence,'runtime-cancel');await fs.mkdir(path.join(runtime,'native'),{recursive:true});await fs.mkdir(path.join(runtime,'main'),{recursive:true});
 for(const name of ['One.Archive.exe','One.ArchiveBudget.dll','7z.dll'])await fs.copyFile(path.resolve('dist/native',name),path.join(runtime,'native',name));
 await fs.mkdir('work/temp',{recursive:true});const root=await fs.mkdtemp(path.resolve('work/temp/one-small-cancel-')),previous={TEMP:process.env.TEMP,TMP:process.env.TMP};Object.assign(process.env,{TEMP:root,TMP:root});let service,cancelAt,cancelDone,cancelled=false;
 try{
  const bundle=await build({entryPoints:['src/main/archive-service.ts'],bundle:true,platform:'node',format:'cjs',write:false});const filename=path.join(runtime,'main/service.cjs'),mod=new Module(filename);mod.filename=filename;mod.paths=module.paths;mod._compile(bundle.outputFiles[0].text,filename);
  const parent=path.join(root,'output');await fs.mkdir(parent);await fs.writeFile(path.join(parent,'keep.txt'),'preserve');
  service=new mod.exports.ArchiveService(path.join(root,'cache'),(owner,progress)=>{if(!cancelled&&progress.operation==='extract'&&progress.done>=1000){cancelAt=performance.now();cancelDone=progress.done;cancelled=service.cancel(progress.id,owner);assert(cancelled);}});
  const request={operation:'extract',path:source,parent,destination:'folder',scan:false,propagateZone:true},risk=await service.run(1,request);assert(risk.risk);assert.equal(risk.risk.entries,100000);assert.deepEqual(await fs.readdir(parent),['keep.txt']);
  await assert.rejects(service.run(1,{...request,riskApproval:{revision:risk.risk.revision,maxBytes:64*1024**3,maxMilliseconds:30*60000}}),error=>error.code==='cancelled');
  const cancellationMilliseconds=performance.now()-cancelAt;assert(cancelled&&cancelDone>=1000&&cancelDone<100000);assert.deepEqual(await fs.readdir(parent),['keep.txt']);assert.equal(await fs.readFile(path.join(parent,'keep.txt'),'utf8'),'preserve');
  const helperSha256=crypto.createHash('sha256').update(await fs.readFile(path.join(runtime,'native/One.Archive.exe'))).digest('hex');
  await fs.writeFile(path.join(evidence,'cancel.json'),JSON.stringify({date:new Date().toISOString(),helperSha256,sourceSha256:manifest.sha256,cancelDone,cancellationMilliseconds,preservedParent:true,noStagingOrRecovery:true},null,2)+'\n');
  console.log(`100,000-file extraction cancellation passed at ${cancelDone} files; complete helper exit and staging cleanup ${cancellationMilliseconds.toFixed(1)}ms; existing output preserved.`);
 }finally{await service?.stop();for(const [key,value] of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;await fs.rm(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(String(error.stack||error).slice(-6000));process.exitCode=1;});
