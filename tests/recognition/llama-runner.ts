import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { LlamaRunner } from '../../src/main/recognition/llama-runner';
import { LlamaSession, NativeInferenceError } from '../../src/main/recognition/llama-session';
import type { LocalModelStore } from '../../src/main/local-model-store';
import type { LlamaRuntimeStore } from '../../src/main/recognition/llama-runtime-store';
import { LocalInferenceScheduler } from '../../src/main/local-inference-scheduler';
import type { InferenceDevices } from '../../src/shared/inference-devices';
const gpu={id:'00000000:00000003',deviceId:19,name:'NVIDIA fixture',vendorId:0x10de,pciDeviceId:1,dedicatedMemory:8*1024**3,sharedMemory:0,d3d12:true,cudaDeviceId:3,cudaDriverVersion:12040};
const devices:InferenceDevices={gpus:[gpu]};
const png=()=>sharp({create:{width:8,height:8,channels:3,background:'#fff'}}).png().toBuffer();
async function setup(config:{failGPU?:string;failWeights?:boolean;failClose?:boolean;idleMs?:number;missingCUDA?:boolean;response?:string}={}){
  const directory=await mkdtemp(join(process.env.ONE_MODEL_TEST_ROOT!,'runner-'));
  const files=[{role:'language',path:join(directory,'language')},{role:'vision',path:join(directory,'vision')}],executable=join(directory,'server.exe');
  for(const path of [...files.map(file=>file.path),executable])await writeFile(path,'fixture');
  const stats={weightLeases:0,runtimeLeases:0,acquires:0,deviceQueries:0,starts:[] as any[],inputs:[] as Buffer[],closed:0};
  let failClose=!!config.failClose;
  const weights={async acquire(model:any,signal?:AbortSignal){signal?.throwIfAborted();stats.acquires++;if(config.failWeights)throw Error('模型校验失败');stats.weightLeases++;
    return {model,files,release(){stats.weightLeases--;}};}} as unknown as LocalModelStore;
  const runtimes={async state(backend:string){return {ready:backend!=='cuda'||!config.missingCUDA};},async acquire(){stats.runtimeLeases++;return {executable,release(){stats.runtimeLeases--;}};}} as unknown as LlamaRuntimeStore;
  const scheduler=new LocalInferenceScheduler();
  const runner=new LlamaRunner(weights,runtimes,join(directory,'control'),{scheduler,idleMs:config.idleMs,deviceReader:async()=>{stats.deviceQueries++;return devices;},
    sessionFactory:options=>{
      let alive=false;
      return {get alive(){return alive;},peakRSSMiB:42,async start(signal:AbortSignal){signal.throwIfAborted();alive=true;stats.starts.push(options);},
        async recognize(bytes:Buffer,signal:AbortSignal){signal.throwIfAborted();stats.inputs.push(Buffer.from(bytes));
          if(options.backend==='cuda'&&config.failGPU)throw new NativeInferenceError('fixture GPU failure',config.failGPU as any);return config.response??'ONE OCR 2026';},
        async close(){if(failClose){failClose=false;throw Error('fixture process has not stopped');}alive=false;stats.closed++;}} as unknown as LlamaSession;
    }});
  return {runner,stats,scheduler,files};
}
test('runner reuses exactly the selected model, snapshots input, and emits honest text without fabricated geometry',async()=>{
  const {runner,stats}=await setup();
  try{
    const input=await png(),hash=createHash('sha256').update(input).digest('hex'),size={width:8,height:8},preference={mode:'cpu' as const};
    const first=runner.run(input,size,'eng','deepseek-ocr-v1',preference);input.fill(0);size.width=100;
    const result=await first;assert.equal(result.document!.source.sha256,hash);assert.equal(result.width,8);
    assert.equal(result.document!.engine.model,'q8-7086620c-b11588');assert.deepEqual(result.document!.blocks,[]);assert.deepEqual(result.words,[]);
    assert.equal(result.document!.engine.confidenceScale,undefined);assert.equal(result.peakRSSMiB,42);
    await runner.run(await png(),{width:8,height:8},'eng','deepseek-ocr-v1',{mode:'cpu'});
    assert.equal(stats.acquires,1);assert.equal(stats.starts.length,1);assert.equal(stats.deviceQueries,0);
    assert.equal(stats.weightLeases,1);await runner.close();assert.equal(stats.weightLeases,0);assert.equal(stats.runtimeLeases,0);
  }finally{await runner.close();}
});
test('model, budget or installed-file changes unload before reacquiring',async()=>{
  const {runner,stats,files}=await setup();
  try{
    const input=await png();await runner.run(input,{width:8,height:8},'eng','deepseek-ocr-v1',{mode:'cpu'});
    await writeFile(files[0].path,'changed weights');await runner.run(input,{width:8,height:8},'eng','deepseek-ocr-v1',{mode:'cpu'});
    await runner.run(input,{width:8,height:8},'eng','deepseek-ocr-v2',{mode:'cpu'});
    await runner.run(input,{width:8,height:8},'eng','deepseek-ocr-v2',{mode:'cpu'},()=>{},4096);
    assert.equal(stats.starts.length,4);assert.equal(stats.closed,3);assert.equal(stats.weightLeases,1);assert.equal(stats.runtimeLeases,1);
  }finally{await runner.close();}
});
test('auto CUDA failure retries the same model once on CPU using the matched CUDA ordinal',async()=>{
  const {runner,stats}=await setup({failGPU:'resource'});
  try{
    const result=await runner.run(await png(),{width:8,height:8},'eng','deepseek-ocr-v2',{mode:'auto',gpu:gpu.id});
    assert.equal(result.actualBackend,'cpu');assert.match(result.fallbackReason!,/fixture GPU/);
    assert.deepEqual(stats.starts.map(value=>[value.preset.id,value.backend,value.deviceId]),[['deepseek-ocr-v2','cuda',3],['deepseek-ocr-v2','cpu',undefined]]);
    assert.equal(stats.closed,1);assert.equal(stats.weightLeases,1);
  }finally{await runner.close();}
});
test('auto can use the same model on CPU when a newly available GPU package has not been prepared',async()=>{
  const {runner,stats}=await setup({missingCUDA:true});
  try{
    const result=await runner.run(await png(),{width:8,height:8},'eng','deepseek-ocr-v2',{mode:'auto'});
    assert.equal(result.actualBackend,'cpu');assert.match(result.fallbackReason!,/CUDA 运行包尚未准备/);
    assert.deepEqual(stats.starts.map(value=>[value.preset.id,value.backend]),[['deepseek-ocr-v2','cpu']]);
    assert.equal(stats.weightLeases,1);assert.equal(stats.runtimeLeases,1);
  }finally{await runner.close();}
});
for(const config of [{failGPU:'resource',mode:'gpu'},{failGPU:'protocol',mode:'auto'},{failWeights:true,mode:'auto'}] as const)
test('runner preserves errors instead of substituting a model: '+JSON.stringify(config),async()=>{
  const {runner,stats}=await setup(config);
  try{
    await assert.rejects(runner.run(await png(),{width:8,height:8},'eng','deepseek-ocr-v1',{mode:config.mode,gpu:gpu.id}),
      config.mode==='gpu'?/切换 CPU/:/GPU failure|校验失败/);
    assert.equal(stats.starts.length,'failWeights'in config?0:1);assert.equal(stats.weightLeases,0);assert.equal(stats.runtimeLeases,0);
  }finally{await runner.close();}
});
test('queued cancellation never reads model weights and another engine unloads a retained model',async()=>{
  const {runner,stats,scheduler}=await setup();const abort=new AbortController();let release!:()=>void;
  const blocker={owner:Symbol('other')},blocked=scheduler.run(blocker,abort.signal,()=>new Promise<void>(resolve=>{release=resolve;}));
  try{
    const task=runner.run(await png(),{width:8,height:8},'eng','deepseek-ocr-v1',{mode:'cpu'});void task.catch(()=>{});
    assert.ok(runner.waiting);await runner.cancel();await assert.rejects(task,/取消/);assert.equal(stats.acquires,0);
    release();await blocked;
    await runner.run(await png(),{width:8,height:8},'eng','deepseek-ocr-v1',{mode:'cpu'});
    await scheduler.run(blocker,abort.signal,async()=>{assert.equal(stats.weightLeases,0);assert.equal(stats.runtimeLeases,0);});
  }finally{release?.();await runner.close();}
});
test('failed cleanup retains file leases until native termination is confirmed',async()=>{
  const {runner,stats}=await setup({failClose:true});
  try{
    await runner.run(await png(),{width:8,height:8},'eng','deepseek-ocr-v1',{mode:'cpu'});
    await assert.rejects(runner.unload(),/not stopped/);assert.equal(stats.weightLeases,1);assert.equal(stats.runtimeLeases,1);
    await runner.unload();assert.equal(stats.weightLeases,0);assert.equal(stats.runtimeLeases,0);
  }finally{await runner.close();}
});
test('idle unload ignores removal of a different model and close rejects new work',async()=>{
  const {runner,stats}=await setup({idleMs:30});
  try{
    await runner.run(await png(),{width:8,height:8},'eng','deepseek-ocr-v1',{mode:'cpu'});
    await runner.unload('deepseek-ocr-v2');await new Promise(resolve=>setTimeout(resolve,100));assert.equal(stats.weightLeases,0);
    await runner.close();await assert.rejects(runner.run(await png(),{width:8,height:8},'eng','deepseek-ocr-v1',{mode:'cpu'}),/关闭/);
  }finally{await runner.close();}
});

test('runner attaches native region provenance without exposing tags or fabricating characters',async()=>{
  const {runner}=await setup({response:'<|ref|>ONE OCR 2026<|/ref|><|det|>[[0,0,999,999]]<|/det|><｜end▁of▁sentence｜>'});
  try{const result=await runner.run(await png(),{width:8,height:8},'eng','deepseek-ocr-v2',{mode:'cpu'});
    assert.equal(result.text,'ONE OCR 2026');assert.equal(result.words.length,1);
    const token=result.document!.blocks[0].lines[0].tokens[0];assert.equal(token.geometry,'region');assert.equal(token.confidence,undefined);
    assert.ok(result.document!.engine.version.endsWith('+grounding-v1'));
  }finally{await runner.close();}
});
