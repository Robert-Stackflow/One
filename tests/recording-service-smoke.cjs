const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {execFile}=require('node:child_process'),{promisify}=require('node:util'),{build}=require('esbuild');
async function main(){
  const evidence=path.resolve('work/current/capture-migration');await fs.mkdir(evidence,{recursive:true});
  const directory=await fs.mkdtemp(path.join(evidence,'recording-service-'));
  await fs.writeFile(path.join(directory,'.one-fixture'),'One recording service tests');
  try{
    const entry=path.join(directory,'test.cjs');
    await build({entryPoints:['tests/recording/service-main.ts'],outfile:entry,bundle:true,platform:'node',target:'node22',format:'cjs',external:['electron','koffi'],define:{__dirname:JSON.stringify(path.resolve('dist/main'))}});
    await build({entryPoints:['tests/recording/service-client.ts'],outfile:path.join(directory,'client.js'),bundle:true,platform:'browser',target:'chrome132'});
    await build({stdin:{contents:"import {contextBridge,ipcRenderer} from 'electron';import {recording} from './src/preload/recording';contextBridge.exposeInMainWorld('one',{recording});contextBridge.exposeInMainWorld('recordingFixture',{display:audio=>ipcRenderer.invoke('fixture:display',audio)});",resolveDir:process.cwd(),loader:'ts'},outfile:path.join(directory,'main-preload.cjs'),bundle:true,platform:'node',format:'cjs',external:['electron']});
    await fs.writeFile(path.join(directory,'empty-preload.cjs'),'');
    const {preloadOptions}=await import('../scripts/bundle-options.mjs');const names=['recording-player','recording-export','recording-toolbar','recording-input-overlay','recording-camera-overlay','recording-annotation-overlay','recording-region-overlay','recording-countdown'];
    await build({...preloadOptions,entryPoints:names.map(name=>'src/preload/'+name+'.ts'),outdir:directory});
    const env={...process.env,ONE_RECORDING_TEST_DIRECTORY:directory,TEMP:directory,TMP:directory};delete env.ELECTRON_RUN_AS_NODE;
    let result;
    try{result=await promisify(execFile)(require('electron'),[entry],{cwd:process.cwd(),env,windowsHide:true,timeout:65000,maxBuffer:256*1024});}
    catch(error){await fs.writeFile(path.join(evidence,'recording-service-detail.log'),String(error.stdout||'')+String(error.stderr||''));throw Error('Recording service tests failed; see work/current/capture-migration/recording-service-detail.log');}
    await fs.writeFile(path.join(evidence,'recording-service-detail.log'),result.stdout+result.stderr);
    const report=result.stdout.split(/\r?\n/).find(line=>line.startsWith('{"result"'));assert.ok(report);assert.equal(JSON.parse(report).result,'PASS');console.log(report);
  }finally{
    const actual=await fs.realpath(directory);assert.equal(path.dirname(actual),await fs.realpath(evidence));assert.ok(path.basename(actual).startsWith('recording-service-'));
    assert.equal(await fs.readFile(path.join(actual,'.one-fixture'),'utf8'),'One recording service tests');await fs.rm(actual,{recursive:true,force:true});
  }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
