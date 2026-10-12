const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {execFile}=require('node:child_process'),{promisify}=require('node:util'),{build}=require('esbuild');
async function main(){
  const root=path.resolve('work/current/capture-migration');await fs.mkdir(root,{recursive:true});
  const directory=await fs.mkdtemp(path.join(root,'acquisition-native-'));
  try{
    const entry=path.join(directory,'fixture.cjs');
    await build({entryPoints:['tests/capture/acquisition-native.ts'],outfile:entry,bundle:true,platform:'node',format:'cjs',external:['electron','koffi'],define:{__dirname:JSON.stringify(path.resolve('dist/main'))}});
    const env={...process.env,ONE_ACQUISITION_TEST_DIR:directory};delete env.ELECTRON_RUN_AS_NODE;
    const result=await promisify(execFile)(require('electron'),[entry],{cwd:process.cwd(),env,windowsHide:true,timeout:45000,maxBuffer:64*1024});
    const report=result.stdout.split(/\r?\n/).find(line=>line.startsWith('{"result"'));assert.ok(report,result.stdout+result.stderr);assert.equal(JSON.parse(report).result,'PASS');console.log(report);
  }catch(error){console.error(String(error.stderr||error.message).slice(0,4000));process.exitCode=1;}
  finally{const actual=await fs.realpath(directory);assert.equal(path.dirname(actual),await fs.realpath(root));assert.ok(path.basename(actual).startsWith('acquisition-native-'));await fs.rm(actual,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
