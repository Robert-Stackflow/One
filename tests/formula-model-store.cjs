const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto'),{build}=require('esbuild');
const root=path.resolve('work/current/capture-reconstruction/formula'),sha=value=>createHash('sha256').update(value).digest('hex');
const offline=async()=>{throw Error('Unexpected network request');};
async function until(check){const deadline=Date.now()+3000;while(!await check()){if(Date.now()>deadline)throw Error('Preparation fixture not started');await new Promise(resolve=>setTimeout(resolve,5));}}
async function main(){
  await fs.mkdir(root,{recursive:true});const testRoot=await fs.mkdtemp(path.join(root,'model-store-'));const stores=[];
  try{
    const options={bundle:true,platform:'node',format:'cjs',target:'node22',packages:'external',logLevel:'warning'};
    await build({...options,entryPoints:['src/main/recognition/formula-model-store.ts'],outfile:path.join(testRoot,'store.cjs')});
    const {FormulaModelStore}=require(path.join(testRoot,'store.cjs'));
    const artifacts=[['inference.json','graph','graph'],['inference.pdiparams','weights','weights'],['config.json','config','config']].map(([name,role,text])=>({name,role,bytes:Buffer.byteLength(text),sha256:sha(text),url:'https://fixture.invalid/'+name,text}));
    const profile={source:{id:'formula-fixture',revision:'1',title:'Fixture',size:'S',purpose:'formula',languages:['en'],weightLicense:{name:'fixture',source:'https://fixture.invalid'},backends:['cpu'],precision:'fp32',runtime:'fixture',artifacts:artifacts.map(({text,...file})=>file)},recipe:'fixture-v1',output:{name:'model.onnx',bytes:6,sha256:sha('native')}};
    const sources={};for(const file of artifacts){const target=path.join(testRoot,file.name);await fs.writeFile(target,file.text);sources[file.role]=target;}
    let prepared=0,leased=0,builds=0,alive=false,gate,wait=false,wrong=false;
    const runtime={state:async()=>({ready:true}),install:async signal=>{signal.throwIfAborted();prepared++;},acquire:async()=>{leased++;let released=false;return {executable:'fixture.exe',directory:testRoot,release(){if(!released){released=true;leased--;}}};}};
    const builder=async({destination,signal})=>{builds++;alive=true;try{if(wait)await new Promise((resolve,reject)=>{gate=resolve;signal.addEventListener('abort',()=>setTimeout(()=>reject(Error('fixture canceled')),25),{once:true});});signal.throwIfAborted();await fs.writeFile(path.join(destination,'model.onnx'),wrong?'broken':'native');}finally{alive=false;}};
    const store=new FormulaModelStore(path.join(testRoot,'cache'),runtime,{transport:offline,profile,build:builder});stores.push(store);
    wait=true;const first=new AbortController(),second=new AbortController(),phases=[];
    const a=store.install(first.signal,p=>phases.push(p.phase),sources);void a.catch(()=>{});const progress=[];const b=store.install(second.signal,p=>progress.push({...p}),sources);
    await until(()=>alive);first.abort();await assert.rejects(a,/取消/);assert.equal(alive,true);gate();await b;assert.equal(builds,1);assert.equal(leased,0);assert.equal((await store.state()).ready,true);assert.ok(!phases.includes('ready'));
    assert.ok(progress.every((item,index)=>item.total===progress[0].total&&(!index||item.received>=progress[index-1].received)));assert.equal(progress.at(-1).received,progress.at(-1).total);
    const lease=await store.acquire();await assert.rejects(store.remove(),/使用/);await assert.rejects(store.install(new AbortController().signal),/使用/);lease.release();
    wait=false;await store.install(new AbortController().signal);assert.equal(builds,1);assert.equal(prepared,1,'ready native model must not prepare runtime again');
    await fs.writeFile(lease.model.onnx.path,'tamper');await assert.rejects(store.acquire(),/校验失败/);assert.equal((await store.state()).ready,false);await store.install(new AbortController().signal);assert.equal(builds,2);assert.equal((await store.state()).ready,true);
    const note=path.join(path.dirname(lease.model.onnx.path),'notes.txt');await fs.writeFile(note,'user data');await assert.rejects(store.remove(),/外来/);await fs.writeFile(lease.model.onnx.path,'tamper');await assert.rejects(store.install(new AbortController().signal),/外来/);assert.equal(await fs.readFile(note,'utf8'),'user data');assert.equal(builds,2);await fs.rm(note);await store.install(new AbortController().signal);
    const sourceRoot=path.join(testRoot,'cache','sources'),sourceDirectory=(await fs.readdir(sourceRoot)).find(name=>!name.endsWith('.partial')),sourceNote=path.join(sourceRoot,sourceDirectory,'notes.txt');await fs.writeFile(sourceNote,'source user data');await assert.rejects(store.remove(),/外来/);assert.equal((await store.state()).ready,true);assert.equal(await fs.readFile(sourceNote,'utf8'),'source user data');await fs.rm(sourceNote);
    await store.remove();assert.equal((await store.state()).ready,false);
    wait=true;const canceled=new AbortController(),pending=store.install(canceled.signal,undefined,sources);void pending.catch(()=>{});await until(()=>alive);canceled.abort();await assert.rejects(pending,/取消/);assert.equal(alive,false,'last cancellation must wait for converter cleanup');assert.equal(leased,0);assert.equal((await store.state()).ready,false);
    wait=false;wrong=true;await assert.rejects(store.install(new AbortController().signal),/校验失败/);assert.equal((await store.state()).ready,false);assert.equal(leased,0);
    wrong=false;await store.install(new AbortController().signal);assert.equal((await store.state()).ready,true);await store.stop();await assert.rejects(store.acquire(),/关闭/);await assert.rejects(store.install(new AbortController().signal),/关闭/);
    assert.ok((await fs.readdir(path.join(testRoot,'cache','prepared'))).every(name=>!name.startsWith('.preparing-')&&!name.startsWith('.obsolete-')));
    console.log('Formula model store: shared preparation, scoped cancellation/cleanup, leases, bounded metadata, integrity repair, foreign-file protection, verified publication and offline reuse passed.');
    const combined=[];const missingRuntime={...runtime,state:async()=>({ready:false}),install:async(_signal,report)=>{const total=combined[0].total-artifacts.reduce((sum,file)=>sum+file.bytes,0);for(const received of [0,Math.floor(total/2),total])report({phase:'downloading',received,total});}};
    const combinedStore=new FormulaModelStore(path.join(testRoot,'combined'),missingRuntime,{transport:offline,profile,build:builder});stores.push(combinedStore);await combinedStore.install(new AbortController().signal,value=>combined.push({...value}),sources);assert.ok(combined.every((item,index)=>item.total===combined[0].total&&(!index||item.received>=combined[index-1].received)));assert.equal(combined.at(-1).received,combined.at(-1).total);
    if(process.argv.includes('--medium')){
      await Promise.all(['formula-runtime-store','formula-models','formula-model-catalog','formula-local-runner','formula-local-worker'].map(name=>build({...options,entryPoints:['src/main/recognition/'+name+'.ts'],outfile:path.join(testRoot,name+'.cjs')})));
      const {FormulaRuntimeStore}=require(path.join(testRoot,'formula-runtime-store.cjs')),{FormulaModels}=require(path.join(testRoot,'formula-models.cjs')),{formulaPlusM,formulaPlusS}=require(path.join(testRoot,'formula-model-catalog.cjs')),{FormulaLocalRunner}=require(path.join(testRoot,'formula-local-runner.cjs'));
      const runtime=new FormulaRuntimeStore(path.join(root,'managed-runtime'),offline),registry=new FormulaModels(path.join(root,'managed-models'),runtime,offline);stores.push(registry,runtime);
      const smallBefore=await registry.state(formulaPlusS.source.id),localSources=Object.fromEntries(formulaPlusM.source.artifacts.map(file=>[file.role,path.join(root,'plus-m',file.name)]));
      assert.throws(()=>registry.acquire('unknown'),/未适配/);
      const started=Date.now();await registry.install(formulaPlusM.source.id,new AbortController().signal,undefined,localSources);const lease=await registry.acquire(formulaPlusM.source.id);
      const runner=new FormulaLocalRunner(path.join(testRoot,'formula-local-worker.cjs'));
      try{
        assert.equal(lease.model.id,formulaPlusM.source.id);assert.equal(lease.model.onnx.sha256,formulaPlusM.output.sha256);assert.equal((await registry.state(formulaPlusS.source.id)).ready,smallBefore.ready);
        const png=await fs.readFile(path.join(root,'official-sample.png')),reference=JSON.parse(await fs.readFile(path.join(root,'plus-m/paddle-cpu.json'),'utf8')),results=[];
        for(const [device,deviceId] of [['cpu',0],['gpu',0],['gpu',1],['cpu',0]]){
          const start=Date.now(),result=await runner.run(png,lease.model,{device,deviceId});assert.equal(result.text,reference.results[0].latex);assert.equal(result.actualBackend,device==='cpu'?'cpu':'dml');results.push({device,deviceId,elapsedMs:Date.now()-start,peakRSSMiB:result.peakRSSMiB});
        }
        await fs.writeFile(path.join(root,'plus-m/managed-runtime.json'),JSON.stringify({elapsedMs:Date.now()-started,results},null,2));
        console.log('Actual plus-M registry: fixed conversion/hash/checker, independent S/M ownership, CPU → NVIDIA → AMD → CPU with official Paddle text parity passed.');
      }finally{await runner.close();lease.release();}
    }
    if(process.argv.includes('--runtime')){
      await Promise.all(['formula-runtime-store','formula-model-catalog','formula-model-builder','formula-local-runner','formula-local-worker'].map(name=>build({...options,entryPoints:['src/main/recognition/'+name+'.ts'],outfile:path.join(testRoot,name+'.cjs')})));
      const {FormulaRuntimeStore}=require(path.join(testRoot,'formula-runtime-store.cjs')),{formulaPlusS}=require(path.join(testRoot,'formula-model-catalog.cjs')),{FormulaLocalRunner}=require(path.join(testRoot,'formula-local-runner.cjs'));
      const actualRuntime=new FormulaRuntimeStore(path.join(root,'managed-runtime'),offline),actual=new FormulaModelStore(path.join(root,'managed-models'),actualRuntime,{transport:offline});stores.push(actual,actualRuntime);
      const localSources=Object.fromEntries(formulaPlusS.source.artifacts.map(file=>[file.role,path.join(root,'plus-S',file.name)]));
      const started=Date.now();await actual.install(new AbortController().signal,undefined,localSources);const ready=await actual.acquire();
      const runner=new FormulaLocalRunner(path.join(testRoot,'formula-local-worker.cjs'));
      try{const png=await fs.readFile(path.join(root,'official-sample.png')),result=await runner.run(png,ready.model,{device:'cpu',deviceId:0});assert.equal(result.sourceSha256,sha(png));assert.equal(result.model,formulaPlusS.source.id);assert.equal(result.actualBackend,'cpu');assert.ok(result.text.length>10);require('katex').renderToString(result.text,{throwOnError:true,strict:'ignore',trust:false});}
      finally{await runner.close();ready.release();}
      console.log('Actual pinned FormulaNet: managed runtime + official source cache -> guarded conversion -> SHA-verified native model -> isolated CPU inference passed offline in '+(Date.now()-started)+' ms.');
      const runtimeLease=await actualRuntime.acquire(),cancelDirectory=path.join(testRoot,'cancel-conversion');await fs.mkdir(cancelDirectory);const abort=new AbortController(),{buildFormulaModel}=require(path.join(testRoot,'formula-model-builder.cjs'));
      let task;try{
        task=buildFormulaModel({executable:runtimeLease.executable,source:path.join(root,'plus-S'),destination:cancelDirectory,signal:abort.signal});void task.catch(()=>{});
        const {promisify}=require('node:util'),execFile=promisify(require('node:child_process').execFile);
        await until(()=>fs.stat(path.join(cancelDirectory,'_convert.py')).then(()=>true,()=>false));
        const snapshot=await execFile('powershell.exe',['-NoProfile','-Command',`Get-CimInstance Win32_Process -Filter "ParentProcessId = ${process.pid} AND Name = 'python.exe'" | Select-Object -ExpandProperty ProcessId`],{windowsHide:true,maxBuffer:4096});
        const pid=Number(snapshot.stdout.trim());assert.ok(Number.isSafeInteger(pid)&&pid>0,'converter must be live before cancel');const canceledAt=Date.now();abort.abort();await assert.rejects(task,/取消/);assert.ok(Date.now()-canceledAt<5000);assert.throws(()=>process.kill(pid,0),/ESRCH/);assert.deepEqual(await fs.readdir(cancelDirectory),[]);
        console.log('Actual converter cancellation: live Python PID exited and staging files cleared before the task rejected.');
      }finally{abort.abort();await task?.catch(()=>{});runtimeLease.release();}
    }
  }finally{
    for(const store of stores)await store.stop();const actual=await fs.realpath(testRoot);assert.equal(path.dirname(actual),await fs.realpath(root));assert.ok(path.basename(actual).startsWith('model-store-'));await fs.rm(actual,{recursive:true,force:true});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
