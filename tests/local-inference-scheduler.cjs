const {build}=require('esbuild'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {execFile}=require('node:child_process'),{promisify}=require('node:util');
(async()=>{
 const root=path.resolve('work/current/capture-reconstruction'),directory=await fs.mkdtemp(path.join(root,'inference-scheduler-'));
 try{
  const runtime=process.argv.includes('--runtime'),entry=path.join(directory,runtime?'runtime.cjs':'test.cjs');
  await build({entryPoints:[runtime?'tests/local-inference-runtime.ts':'tests/local-inference-scheduler.ts'],outfile:entry,bundle:true,format:'cjs',platform:'node',target:'node22',packages:'external',logLevel:'warning'});
  const env={...process.env,ONE_INFERENCE_TEST_ROOT:directory};if(runtime)delete env.ELECTRON_RUN_AS_NODE;
  const result=await promisify(execFile)(runtime?require('electron'):process.execPath,runtime?[entry]:['--test',entry],{env,windowsHide:true,timeout:120000,maxBuffer:64*1024});
  console.log(result.stdout.trim());
 }catch(error){console.error(((error.stdout||'')+(error.stderr||'')||error.stack).slice(-5000));process.exitCode=1;}
 finally{const actual=await fs.realpath(directory);assert.equal(path.dirname(actual),await fs.realpath(root));assert.ok(path.basename(actual).startsWith('inference-scheduler-'));await fs.rm(actual,{recursive:true,force:true});}
})();
