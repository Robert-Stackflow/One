const {build}=require('esbuild'),fs=require('node:fs/promises'),path=require('node:path'),{spawn}=require('node:child_process');
(async()=>{
 const root=path.resolve('work/current/capture-reconstruction/formula/pix2tex');await fs.mkdir(root,{recursive:true});const directory=await fs.mkdtemp(path.join(root,'native-runtime-')),options={bundle:true,platform:'node',format:'cjs',target:'node22',packages:'external',logLevel:'warning'};
 await build({...options,entryPoints:['src/main/recognition/formula-local-worker.ts'],outfile:path.join(directory,'recognition/formula-local-worker.cjs')});await build({...options,entryPoints:['tests/recognition/pix2tex-runtime.ts'],outfile:path.join(directory,'run.cjs')});
 const env={...process.env,ONE_PIX2TEX_TEST_ROOT:directory};delete env.ELECTRON_RUN_AS_NODE;const child=spawn(process.execPath,[path.join(directory,'run.cjs'),...process.argv.slice(2)],{env,windowsHide:true,stdio:'inherit'}),code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
 await fs.writeFile(path.join(directory,'outcome.json'),JSON.stringify({exitCode:code,passed:code===0}));console.log('Evidence: '+directory);if(code!==0)throw Error('pix2tex native verification failed');
})().catch(error=>{console.error(String(error).slice(0,1400));process.exitCode=1;});
