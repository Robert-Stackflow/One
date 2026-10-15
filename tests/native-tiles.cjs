const {build}=require('esbuild'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
(async()=>{
 const output=path.resolve('work/current/capture-reconstruction/deepseek');await fs.mkdir(output,{recursive:true});const directory=await fs.mkdtemp(path.join(output,'native-tiles-')),entry=path.join(directory,'run.cjs');let child;
 try{
  await build({entryPoints:['src/main/recognition/ocr-tile-worker.ts'],outfile:path.join(directory,'recognition/ocr-tile-worker.cjs'),bundle:true,platform:'node',format:'cjs',target:'node22',packages:'external',logLevel:'warning'});
  await build({entryPoints:['tests/recognition/native-tiles.ts'],outfile:entry,bundle:true,platform:'node',format:'cjs',target:'node22',packages:'external',logLevel:'warning'});
  const env={...process.env,ONE_NATIVE_TILES_ROOT:directory};delete env.ELECTRON_RUN_AS_NODE;child=spawn(process.execPath,[entry,...process.argv.slice(2)],{env,windowsHide:true,stdio:'inherit'});
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
  const tag=process.argv.find(value=>value.startsWith('--backend='))?.slice(10)||'contract';assert.ok(['contract','cpu','cuda','auto'].includes(tag));const destination=path.join(output,'native-tiles-'+tag+'-'+path.basename(directory).slice('native-tiles-'.length));await fs.mkdir(destination,{recursive:true});await fs.writeFile(path.join(destination,'outcome.json'),JSON.stringify({exitCode:code,passed:code===0}));
  for(const name of await fs.readdir(directory))if(/\.(json|png)$/.test(name))await fs.copyFile(path.join(directory,name),path.join(destination,name));
  await fs.mkdir(path.join(destination,'runtime/recognition'),{recursive:true});await fs.copyFile(entry,path.join(destination,'runtime/run.cjs'));await fs.copyFile(path.join(directory,'recognition/ocr-tile-worker.cjs'),path.join(destination,'runtime/recognition/ocr-tile-worker.cjs'));console.log('Evidence: '+destination);if(code!==0)throw Error('Native tile verification failed');
 }finally{if(child&&child.exitCode===null&&child.signalCode===null)throw Error('Native verification is still running; preserve its owned directory');const actual=await fs.realpath(directory);assert.equal(path.dirname(actual),await fs.realpath(output));assert.ok(path.basename(actual).startsWith('native-tiles-'));await fs.rm(actual,{recursive:true,force:true});}
})().catch(error=>{console.error(String(error).slice(0,1200));process.exitCode=1;});
