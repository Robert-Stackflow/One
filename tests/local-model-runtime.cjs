const {build}=require('esbuild');
const {mkdtemp,rm,realpath}=require('node:fs/promises');
const {join,resolve,dirname,basename}=require('node:path');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const assert=require('node:assert/strict');
(async()=>{
  const root=resolve('work/current/capture-reconstruction');
  const directory=await mkdtemp(join(root,'local-model-runtime-'));
  try{
    await build({entryPoints:['tests/local-model-runtime.ts'],outfile:join(directory,'test.mjs'),bundle:true,format:'esm',platform:'node',target:'node22',packages:'external',logLevel:'warning'});
    const result=await promisify(execFile)(process.execPath,[join(directory,'test.mjs')],{env:{...process.env,ONE_MODEL_TEST_ROOT:directory},windowsHide:true,maxBuffer:64*1024});
    console.log(result.stdout.trim());
  }catch(error){console.error(((error.stdout||'')+(error.stderr||'')||error.stack).slice(-5000));process.exitCode=1;}
  finally{const path=await realpath(directory);assert.equal(dirname(path),await realpath(root));assert.ok(basename(path).startsWith('local-model-runtime-'));await rm(path,{recursive:true,force:true});}
})();
