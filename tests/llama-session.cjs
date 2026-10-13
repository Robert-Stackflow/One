const {build}=require('esbuild'),fs=require('node:fs/promises'),path=require('node:path');
const {execFile}=require('node:child_process'),{promisify}=require('node:util'),assert=require('node:assert/strict');
(async()=>{
  const root=path.resolve('work/current/capture-reconstruction'),directory=await fs.mkdtemp(path.join(root,'llama-session-')),runtime=process.argv.includes('--runtime');
  try{
    const entry=path.join(directory,'test.cjs');await build({entryPoints:[runtime?'tests/recognition/llama-session-runtime.ts':'tests/recognition/llama-session.ts'],outfile:entry,bundle:true,platform:'node',target:'node22',packages:'external',logLevel:'warning'});
    const env={...process.env,ONE_MODEL_TEST_ROOT:directory};delete env.NODE_TEST_CONTEXT;
    const result=await promisify(execFile)(process.execPath,[...(runtime?[]:['--test']),entry],{env,windowsHide:true,maxBuffer:256*1024,timeout:600000});
    await fs.writeFile(path.join(root,'deepseek',runtime?'native-session-real.log':'native-session-unit.log'),result.stdout+result.stderr);
    console.log(runtime?result.stdout.trim():result.stdout.split('\n').filter(line=>/^# (tests|pass|fail) /.test(line)).join('; '));
  }catch(error){await fs.writeFile(path.join(root,'deepseek',runtime?'native-session-real.log':'native-session-unit.log'),(error.stdout||'')+(error.stderr||'')+(error.stack||''));console.error('Native session failed; see work/current/capture-reconstruction/deepseek/'+(runtime?'native-session-real.log':'native-session-unit.log'));process.exitCode=1;}
  finally{const actual=await fs.realpath(directory);assert.equal(path.dirname(actual),await fs.realpath(root));await fs.rm(actual,{recursive:true,force:true});}
})().catch(error=>{console.error(String(error));process.exitCode=1});
