const {build}=require('esbuild'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const root=path.resolve('work/current/capture-reconstruction/formula');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function main(){
  await fs.mkdir(root,{recursive:true});const directory=await fs.mkdtemp(path.join(root,'local-runtime-'));
  let runners=[];
  try{
    const options={bundle:true,platform:'node',format:'cjs',target:'node22',packages:'external',logLevel:'warning'};
    await Promise.all([build({...options,entryPoints:['src/main/recognition/formula-local-runner.ts'],outfile:path.join(directory,'runner.cjs')}),build({...options,entryPoints:['src/main/recognition/formula-local-worker.ts'],outfile:path.join(directory,'worker.cjs')}),build({...options,entryPoints:['src/main/local-inference-scheduler.ts'],outfile:path.join(directory,'scheduler.cjs')}),build({...options,entryPoints:['src/main/recognition/formula-local.ts'],outfile:path.join(directory,'pipeline.cjs')})]);
    const {FormulaLocalRunner}=require(path.join(directory,'runner.cjs'));
    const {formulaDecoder,formulaInput}=require(path.join(directory,'pipeline.cjs')),vocabulary=Object.fromEntries(Array.from({length:50000},(_,id)=>['token'+id,id]));
    const decode=formulaDecoder({Global:{model_name:'PP-FormulaNet_plus-S'},PostProcess:{character_dict:{fast_tokenizer_file:{decoder:{type:'ByteLevel'},model:{vocab:vocabulary},added_tokens:[0,1,2,3].map(id=>({id,special:true}))}}}});
    assert.equal(decode(new BigInt64Array([4n,2n,1000000n])),'token4');assert.throws(()=>decode(new BigInt64Array([4n])),/完整结束/);assert.throws(()=>decode(new BigInt64Array([1000000n,2n])),/未知字符/);
    const blank=await require('sharp')({create:{width:100,height:100,channels:3,background:'#fff'}}).png().toBuffer();await assert.rejects(formulaInput(blank),/笔画/);
    const fixture=path.join(directory,'fixture.cjs');await fs.writeFile(fixture,`const fs=require('node:fs'),crypto=require('node:crypto');process.on('message',job=>{fs.appendFileSync(${JSON.stringify(path.join(directory,'pids'))},process.pid+'\\n');if(job.model.id==='quota'){const memory=[];setInterval(()=>memory.push(Buffer.alloc(32*1024*1024,1)),5);return;}process.send({id:job.id,phase:'loading',progress:0});if(job.model.id==='stall')return;if(job.model.id==='gpu-fail'&&job.backend==='dml'){process.send({id:job.id,ok:false,kind:'loading',error:'GPU fixture unavailable'});return;}process.send({id:job.id,ok:true,result:{text:'x^2',sourceSha256:crypto.createHash('sha256').update(job.png).digest('hex'),model:job.model.id==='malformed'?'wrong':job.model.id,revision:job.model.revision,actualBackend:job.backend,deviceId:job.backend==='dml'?job.deviceId:undefined,peakRSSMiB:100}});});setInterval(()=>{},1000);`);
    const artifact={path:'unused',bytes:1,sha256:'0'.repeat(64)},model={id:'valid',revision:'fixture',onnx:artifact,config:artifact},png=Buffer.alloc(24,1);
    const runner=new FormulaLocalRunner(fixture,5000,60000);runners.push(runner);
    const copy=Buffer.from(png),task=runner.run(png,model,{device:'cpu',deviceId:0});png.fill(2);const result=await task;assert.equal(result.sourceSha256,sha(copy));assert.equal(result.text,'x^2');assert.ok(png.every(n=>n===2));
    await assert.rejects(runner.run(png,{...model,id:'malformed'},{device:'cpu',deviceId:0}),/不匹配/);
    const fallback=await runner.run(png,{...model,id:'gpu-fail'},{device:'auto',automaticBackend:'dml',deviceId:0});assert.equal(fallback.actualBackend,'cpu');assert.match(fallback.fallbackReason,/GPU/);
    await assert.rejects(runner.run(png,{...model,id:'gpu-fail'},{device:'gpu',deviceId:0}),/GPU/);
    const stopped=runner.run(png,{...model,id:'stall'},{device:'cpu',deviceId:0},()=>void runner.cancel());await assert.rejects(stopped,/取消/);
    await assert.rejects(runner.run(png,{...model,id:'quota'},{device:'cpu',deviceId:0,memoryMiB:256}),/退出|资源/);
    const timed=new FormulaLocalRunner(fixture,100,60000);runners.push(timed);await assert.rejects(timed.run(png,{...model,id:'stall'},{device:'cpu',deviceId:0}),/超时/);
    const {LocalInferenceScheduler}=require(path.join(directory,'scheduler.cjs')),scheduler=new LocalInferenceScheduler();
    const ownerA=new FormulaLocalRunner(fixture,5000,60000,scheduler),ownerB=new FormulaLocalRunner(fixture,5000,60000,scheduler);runners.push(ownerA,ownerB);
    let notified;const ready=new Promise(resolve=>notified=resolve),held=ownerA.run(png,{...model,id:'stall'},{device:'cpu',deviceId:0},()=>notified());await ready;
    const queued=ownerB.run(png,model,{device:'cpu',deviceId:0});assert.equal(ownerB.waiting,true);await ownerB.cancel();await assert.rejects(queued,/取消/);await ownerA.cancel();await assert.rejects(held,/取消/);
    await ownerA.run(png,model,{device:'cpu',deviceId:0});const oldPid=Number((await fs.readFile(path.join(directory,'pids'),'utf8')).trim().split(/\s+/).at(-1));await ownerB.run(png,model,{device:'cpu',deviceId:0});assert.throws(()=>process.kill(oldPid,0));
    await Promise.all(runners.map(item=>item.close()));runners=[];
    const pids=(await fs.readFile(path.join(directory,'pids'),'utf8')).trim().split(/\s+/).map(Number);for(const pid of pids)assert.throws(()=>process.kill(pid,0));
    console.log('Formula contracts: immutable input, owner cache, malformed result, GPU fallback/forced failure, cancel, timeout, hard quota and actual process exit passed.');
    if(process.argv.includes('--runtime')){
      const input=await fs.readFile(path.join(root,'official-sample.png')),gold=JSON.parse(await fs.readFile(path.join(root,'plus-S-paddle-3.1.1.json'),'utf8'));
      const file=async name=>{const location=path.join(root,'plus-S',name),bytes=await fs.readFile(location);return {path:location,bytes:bytes.length,sha256:sha(bytes)};};
      const files={id:'pp-formula-plus-s',revision:'3d46f557-onnx-scalar-v1',onnx:await file('model-scalar.onnx'),config:await file('config.json')};
      const native=new FormulaLocalRunner(path.join(directory,'worker.cjs'));runners.push(native);const phases=[];
      const first=await native.run(input,files,{device:'cpu',deviceId:0},(_,phase)=>phases.push(phase));assert.equal(first.sourceSha256,sha(input));assert.equal(first.text,gold.results[0].latex);assert.ok(phases.includes('loading'));
      phases.length=0;const warm=await native.run(input,files,{device:'cpu',deviceId:0},(_,phase)=>phases.push(phase));assert.equal(warm.text,first.text);assert.ok(!phases.includes('loading'));
      if(process.argv.includes('--cases')){const cases=JSON.parse(await fs.readFile(path.join(root,'cases/cases.json'),'utf8')),results=[];for(const item of cases){const picture=await fs.readFile(path.join(root,'cases',item.id+'.png'));const start=performance.now(),result=await native.run(picture,files,{device:'cpu',deviceId:0});let previewError='';try{require('katex').renderToString(result.text,{throwOnError:true,trust:false});}catch(error){previewError=error.message.slice(0,200);}results.push({id:item.id,expected:item.latex,text:result.text,previewError,sourceSha256:result.sourceSha256,elapsedMs:Math.round(performance.now()-start)});}await fs.writeFile(path.join(root,'local-case-results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));}
      if(process.argv.includes('--gpu')){const results=[];for(const deviceId of [0,1]){const gpu=await native.run(input,files,{device:'gpu',deviceId});assert.equal(gpu.text,first.text);assert.equal(gpu.actualBackend,'dml');assert.equal(gpu.deviceId,deviceId);results.push({deviceId,peakRSSMiB:gpu.peakRSSMiB});}const restored=await native.run(input,files,{device:'cpu',deviceId:0});assert.equal(restored.text,first.text);await fs.writeFile(path.join(root,'local-runtime-gpu.json'),JSON.stringify(results));console.log('Actual formula child CPU → NVIDIA → AMD → CPU switch passed.');}
      await native.close();runners=[];
      await fs.writeFile(path.join(root,'local-runtime-result.json'),JSON.stringify({first,warm},null,2));console.log('Actual formula child: source PNG preprocessing, CPU cold/warm model reuse and exact Paddle LaTeX passed.');
    }
  }finally{await Promise.allSettled(runners.map(item=>item.close()));const actual=await fs.realpath(directory);assert.equal(path.dirname(actual),await fs.realpath(root));await fs.rm(actual,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error.stack||String(error));process.exitCode=1;});
