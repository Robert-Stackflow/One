const {build}=require('esbuild'),{mkdtemp,realpath,rm,writeFile}=require('node:fs/promises');
const {resolve,join,dirname}=require('node:path'),{execFile}=require('node:child_process'),{promisify}=require('node:util'),assert=require('node:assert/strict');
(async()=>{
  const root=resolve('work/current/capture-reconstruction'),directory=await mkdtemp(join(root,'presets-runtime-'));
  try{
    await build({entryPoints:['tests/recognition/paddle-presets-runtime.ts'],outfile:join(directory,'test.mjs'),bundle:true,format:'esm',platform:'node',target:'node22',packages:'external',logLevel:'warning'});
    await build({entryPoints:['src/main/recognition/paddle-worker.ts'],outfile:join(directory,'paddle-worker.cjs'),bundle:true,format:'cjs',platform:'node',target:'node22',packages:'external',logLevel:'warning'});
    const result=await promisify(execFile)(process.execPath,[join(directory,'test.mjs')],{env:{...process.env,ONE_MODEL_TEST_ROOT:directory},windowsHide:true,maxBuffer:1024*1024});
    await writeFile(join(root,'paddle-presets-runtime.log'),result.stdout+result.stderr);console.log(result.stdout.trim());
  }catch(error){await writeFile(join(root,'paddle-presets-runtime.log'),(error.stdout||'')+(error.stderr||'')+(error.stack||''));console.error('Preset runtime failed; see work/current/capture-reconstruction/paddle-presets-runtime.log');process.exitCode=1;}
  finally{const actual=await realpath(directory);assert.equal(dirname(actual),await realpath(root));await rm(actual,{recursive:true,force:true});}
})();
