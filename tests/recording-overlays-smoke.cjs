const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {execFile}=require('node:child_process'),{promisify}=require('node:util'),{build}=require('esbuild');
async function main(){
  const evidence=path.resolve('work/current/capture-migration');await fs.mkdir(evidence,{recursive:true});
  const directory=await fs.mkdtemp(path.join(evidence,'recording-overlays-'));
  await fs.writeFile(path.join(directory,'.one-fixture'),'One recording overlay tests');
  try{
    const entry=path.join(directory,'test.cjs');
    await build({entryPoints:['tests/recording/overlays-main.ts'],outfile:entry,bundle:true,platform:'node',target:'node22',format:'cjs',external:['electron']});
    const names=['recording-toolbar','recording-input-overlay','recording-camera-overlay','recording-annotation-overlay','recording-region-overlay','recording-countdown','recording-player','recording-export'];
    const {preloadOptions}=await import('../scripts/bundle-options.mjs');for(const name of names)assert.ok(preloadOptions.entryPoints.includes('src/preload/'+name+'.ts'));
    const footer=`{const {contextBridge,ipcRenderer}=require('electron');const events=[];for(const name of ['one:recording-countdown-tick','one:recording-input-changed','one:recording-camera-changed','one:recording-annotation-changed','one:recording-changed','one:recording-menu-dismiss'])ipcRenderer.on(name,(_event,value)=>{events.push({name,value});if(events.length>32)events.shift();});contextBridge.exposeInMainWorld('recordingFixture',{events:()=>events});}`;
    await build({...preloadOptions,entryPoints:names.map(name=>'src/preload/'+name+'.ts'),outdir:directory,footer:{js:footer}});
    const env={...process.env,ONE_RECORDING_TEST_DIRECTORY:directory,TEMP:directory,TMP:directory};delete env.ELECTRON_RUN_AS_NODE;
    let result;
    try{result=await promisify(execFile)(require('electron'),[entry],{cwd:process.cwd(),env,windowsHide:true,timeout:60000,maxBuffer:128*1024});}
    catch(error){await fs.writeFile(path.join(evidence,'recording-overlays-detail.log'),String(error.stdout||'')+String(error.stderr||''));throw Error('Recording overlay tests failed; see work/current/capture-migration/recording-overlays-detail.log');}
    await fs.writeFile(path.join(evidence,'recording-overlays-detail.log'),result.stdout+result.stderr);
    const report=result.stdout.split(/\r?\n/).find(line=>line.startsWith('{"result"'));assert.ok(report);assert.equal(JSON.parse(report).result,'PASS');console.log(report);
  }finally{
    const actual=await fs.realpath(directory);assert.equal(path.dirname(actual),await fs.realpath(evidence));assert.ok(path.basename(actual).startsWith('recording-overlays-'));
    assert.equal(await fs.readFile(path.join(actual,'.one-fixture'),'utf8'),'One recording overlay tests');await fs.rm(actual,{recursive:true,force:true});
  }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
