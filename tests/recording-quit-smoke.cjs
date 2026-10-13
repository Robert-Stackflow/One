const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {execFile}=require('node:child_process'),{promisify}=require('node:util'),{build}=require('esbuild');
async function main(){
  const evidence=path.resolve('work/current/capture-migration/recording-quit');await fs.mkdir(evidence,{recursive:true});
  const directory=await fs.mkdtemp(path.join(evidence,'fixture-'));await fs.writeFile(path.join(directory,'.one-fixture'),'One recording quit tests');
  try{
    const entry=path.join(directory,'test.cjs');await build({entryPoints:['tests/recording/quit-main.ts'],outfile:entry,bundle:true,platform:'node',target:'node22',external:['electron','koffi']});
    const env={...process.env,ONE_RECORDING_TEST_DIRECTORY:directory};delete env.ELECTRON_RUN_AS_NODE;
    let output;try{output=await promisify(execFile)(require('electron'),[entry],{env,windowsHide:true,timeout:25000,maxBuffer:256*1024});}catch(error){await fs.writeFile(path.join(evidence,'detail.log'),String(error.stdout||'')+String(error.stderr||''));throw Error('Recording quit tests failed; see recording-quit/detail.log');}
    await fs.writeFile(path.join(evidence,'detail.log'),output.stdout+output.stderr);const line=output.stdout.split(/\r?\n/).find(line=>line.startsWith('{"result"'));assert.ok(line);await fs.writeFile(path.join(evidence,'result.json'),line+'\n');console.log(line);
  }finally{const actual=await fs.realpath(directory);assert.equal(path.dirname(actual),await fs.realpath(evidence));assert.ok(path.basename(actual).startsWith('fixture-'));assert.equal(await fs.readFile(path.join(actual,'.one-fixture'),'utf8'),'One recording quit tests');await fs.rm(actual,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
