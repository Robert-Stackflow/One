const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {execFile}=require('node:child_process'),{promisify}=require('node:util');
const run=promisify(execFile),hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
async function main(){
 const fixtures=path.resolve('tests/fixtures/archives/egg'),manifest=JSON.parse(await fs.readFile(path.join(fixtures,'manifest.json'),'utf8')),source=manifest.sourceArchive;
 assert.equal(hash(await fs.readFile(path.join(fixtures,source.name))),source.sha256);
 const root=path.resolve('work/archive-build/egg-reference-'+source.sha256.slice(0,12));await fs.mkdir(path.join(root,'reference'),{recursive:true});
 await run('tar.exe',['-xzf',path.join(fixtures,source.name),'-C',path.join(root,'reference')],{windowsHide:true,maxBuffer:65536});
 for(const file of source.files){const relative=path.relative(path.join(root,'reference'),path.resolve(root,'reference',file.path));assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));const data=await fs.readFile(path.join(root,'reference',file.path));assert.equal(data.length,file.bytes);assert.equal(hash(data),file.sha256);}
 for(const name of ['Program.cs','oracle.csproj'])await fs.copyFile(path.join(fixtures,'oracle',name),path.join(root,name));
 const options={windowsHide:true,timeout:60000,maxBuffer:128*1024,env:{...process.env,DOTNET_NOLOGO:'1',DOTNET_CLI_TELEMETRY_OPTOUT:'1'}};
 try{const built=await run('dotnet',['build',path.join(root,'oracle.csproj'),'--nologo','--verbosity','quiet'],options);await fs.writeFile(path.join(root,'build.log'),built.stdout+built.stderr);}
 catch(error){await fs.writeFile(path.join(root,'build.log'),(error.stdout||'')+(error.stderr||''));throw Error('EGG reference build failed; see '+path.join(root,'build.log'));}
 for(const volume of manifest.additionalVolumes){const data=await fs.readFile(path.join(fixtures,volume.name));assert.equal(data.length,volume.bytes);assert.equal(hash(data),volume.sha256);}
 let decoded=0,limited=0,known=0;const results=[];
 for(const fixture of manifest.fixtures){
  const data=await fs.readFile(path.join(fixtures,fixture.name));assert.equal(data.length,fixture.bytes);assert.equal(hash(data),fixture.sha256);let result,exit=0;
  try{result=await run('dotnet',[path.join(root,'bin/Debug/net6.0/EggReferenceOracle.dll'),path.join(fixtures,fixture.name),fixture.password||'password12345!'],{...options,timeout:15000,maxBuffer:16384});}
  catch(error){if(typeof error.code!=='number')throw error;exit=error.code;result=error;}
  const actual=JSON.parse(result.stdout.trim());assert.deepEqual(actual,fixture.result,fixture.name);
  if(fixture.oracleStatus==='decoded'){assert.equal(exit,0);for(const entry of actual.entries)assert.equal(entry.actual,entry.size);decoded++;}
  else{assert.notEqual(exit,0);if(fixture.oracleStatus==='output-limit')limited++;else known++;}
  results.push({name:fixture.name,status:fixture.oracleStatus});
 }
 await fs.writeFile(path.join(root,'results.json'),JSON.stringify({date:new Date().toISOString(),sourceCommit:manifest.commit,decoded,limited,known,results},null,2)+'\n');
 console.log(`EGG reference passed: ${decoded} decoded datasets, ${limited} output-limit case, ${known} known parser failure; source and fixture hashes verified. Test-only .NET oracle; no EGG product support claim.`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
