const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {execFile}=require('node:child_process'),{promisify}=require('node:util'),{build}=require('esbuild');
async function main(){
  const evidence=path.resolve('work/current/capture-migration/recording-overlay-pages');await fs.mkdir(evidence,{recursive:true});
  const directory=await fs.mkdtemp(path.join(evidence,'fixture-'));await fs.writeFile(path.join(directory,'.one-fixture'),'One overlay page tests');
  try{
    const entry=path.join(directory,'test.cjs');await build({entryPoints:['tests/recording/overlay-pages-main.ts'],outfile:entry,bundle:true,platform:'node',target:'node22',external:['electron']});
    const {preloadOptions}=await import('../scripts/bundle-options.mjs');await build({...preloadOptions,entryPoints:['input-overlay','camera-overlay','annotation-overlay','region-overlay','countdown'].map(name=>'src/preload/recording-'+name+'.ts'),outdir:directory});
    const env={...process.env,ONE_RECORDING_TEST_DIRECTORY:directory,ONE_RECORDING_EVIDENCE:evidence,TEMP:directory,TMP:directory};delete env.ELECTRON_RUN_AS_NODE;
    let result;try{result=await promisify(execFile)(require('electron'),[entry],{cwd:process.cwd(),env,windowsHide:true,timeout:60000,maxBuffer:128*1024});}
    catch(error){await fs.writeFile(path.join(evidence,'detail.log'),String(error.stdout||'')+String(error.stderr||''));throw Error('Overlay page tests failed; see work/current/capture-migration/recording-overlay-pages/detail.log');}
    await fs.writeFile(path.join(evidence,'detail.log'),result.stdout+result.stderr);const line=result.stdout.split(/\r?\n/).find(s=>s.startsWith('{"result"'));assert.ok(line);assert.equal(JSON.parse(line).result,'PASS');await fs.writeFile(path.join(evidence,'result.json'),line+'\n');console.log(line);
  }finally{
    const actual=await fs.realpath(directory);assert.equal(path.dirname(actual),await fs.realpath(evidence));assert.ok(path.basename(actual).startsWith('fixture-'));assert.equal(await fs.readFile(path.join(actual,'.one-fixture'),'utf8'),'One overlay page tests');await fs.rm(actual,{recursive:true,force:true});
  }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
