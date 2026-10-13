const {build}=require('esbuild');
const {mkdtemp,rm,realpath}=require('node:fs/promises');
const {join,resolve,dirname,basename}=require('node:path');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const assert=require('node:assert/strict');
(async()=>{
  const root=resolve('work/current/capture-reconstruction'),runtime=process.argv.includes('--runtime');
  const directory=await mkdtemp(join(root,'inference-devices-'));
  try{
    await build({entryPoints:[runtime?'tests/inference-devices-runtime.ts':'tests/inference-devices.ts'],outfile:join(directory,runtime?'test.mjs':'test.cjs'),bundle:true,format:runtime?'esm':'cjs',platform:'node',target:'node22',packages:'external',logLevel:'warning'});
    const env={...process.env};delete env.NODE_TEST_CONTEXT;
    const result=await promisify(execFile)(process.execPath,[...(runtime?[]:['--test']),join(directory,runtime?'test.mjs':'test.cjs')],{env,windowsHide:true,maxBuffer:64*1024});
    console.log(runtime?result.stdout.trim():result.stdout.split('\n').filter(line=>/^# (tests|pass|fail) /.test(line)).join('; '));
  }catch(error){console.error(((error.stdout||'')+(error.stderr||'')||error.stack).slice(-5000));process.exitCode=1;}
  finally{const path=await realpath(directory);assert.equal(dirname(path),await realpath(root));assert.ok(basename(path).startsWith('inference-devices-'));await rm(path,{recursive:true,force:true});}
})();
