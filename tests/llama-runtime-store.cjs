const {build}=require('esbuild'),fs=require('node:fs/promises'),path=require('node:path');
const {execFile}=require('node:child_process'),{promisify}=require('node:util'),assert=require('node:assert/strict');
(async()=>{
  const root=path.resolve('work/current/capture-reconstruction'),directory=await fs.mkdtemp(path.join(root,'llama-runtime-')),runtime=process.argv.includes('--runtime');
  try{
    const entry=path.join(directory,runtime?'test.mjs':'test.cjs');await build({entryPoints:[runtime?'tests/recognition/llama-runtime-store-runtime.ts':'tests/recognition/runtime-extract.ts'],outfile:entry,bundle:true,format:runtime?'esm':'cjs',platform:'node',target:'node22',packages:'external',logLevel:'warning'});
    const env={...process.env,ONE_MODEL_TEST_ROOT:directory};delete env.NODE_TEST_CONTEXT;
    const result=await promisify(execFile)(process.execPath,[...(runtime?[]:['--test']),entry],{env,windowsHide:true,maxBuffer:1024*1024,timeout:180000});
    await fs.writeFile(path.join(root,'deepseek',runtime?'runtime-cache-real.log':'runtime-extract-unit.log'),result.stdout+result.stderr);
    console.log(runtime?result.stdout.trim():result.stdout.split('\n').filter(line=>/^# (tests|pass|fail) /.test(line)).join('; '));
  }catch(error){await fs.writeFile(path.join(root,'deepseek',runtime?'runtime-cache-real.log':'runtime-extract-unit.log'),(error.stdout||'')+(error.stderr||'')+(error.stack||''));console.error('Runtime cache test failed; see work/current/capture-reconstruction/deepseek/'+(runtime?'runtime-cache-real.log':'runtime-extract-unit.log'));process.exitCode=1;}
  finally{const actual=await fs.realpath(directory);assert.equal(path.dirname(actual),await fs.realpath(root));await fs.rm(actual,{recursive:true,force:true});}
})().catch(error=>{console.error(String(error));process.exitCode=1;});
