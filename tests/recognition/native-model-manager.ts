import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { LocalModelManager } from '../../src/main/local-model-manager';
import { OCRModels } from '../../src/main/recognition/ocr-models';
import { deepseekOCRPresets } from '../../src/main/recognition/deepseek-models';
import type { LlamaRuntimeStore } from '../../src/main/recognition/llama-runtime-store';
import { llamaRuntimeProfiles } from '../../src/main/recognition/llama-runtime-catalog';
const gpu={id:'00000000:00000003',deviceId:19,name:'NVIDIA fixture',vendorId:0x10de,pciDeviceId:1,dedicatedMemory:8*1024**3,sharedMemory:0,d3d12:true,cudaDeviceId:3,cudaDriverVersion:12040};
async function setup(config:{weightsReady?:boolean;cpuReady?:boolean;stallCUDA?:boolean}={}){
  const root=await mkdtemp(join(process.env.ONE_MODEL_TEST_ROOT!,'native-manager-'));
  const ready=new Set(config.weightsReady?deepseekOCRPresets.map(value=>value.id):[]),backends=new Set(config.cpuReady?['cpu']:[]);
  let began!:()=>void;const started=new Promise<void>(resolve=>began=resolve);
  const stats={models:[] as string[],runtimes:[] as string[],unloaded:[] as (string|undefined)[],queries:0,cached:false,stall:!!config.stallCUDA};
  const runtime={async state(backend:'cpu'|'cuda'){return {ready:backends.has(backend)};},async install(backend:'cpu'|'cuda',signal:AbortSignal,progress:Function){
    signal.throwIfAborted();stats.runtimes.push(backend);
    const total=llamaRuntimeProfiles.find(value=>value.backend===backend)!.archives.reduce((sum,file)=>sum+file.bytes,0);
    progress({phase:'downloading',received:total/4,total});began();
    if(stats.stall&&backend==='cuda')await new Promise<void>((_resolve,reject)=>{
      const abort=()=>{signal.removeEventListener('abort',abort);reject(Error('运行包准备已取消'));};signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
    });
    signal.throwIfAborted();backends.add(backend);progress({phase:'ready',received:total,total});
  }} as unknown as LlamaRuntimeStore;
  const manager=new LocalModelManager(root,new OCRModels(join(root,'recognition','models')),fetch,async()=>{stats.queries++;return {gpus:[gpu]};},
    {runtimes:runtime,unloadNative:async id=>{stats.unloaded.push(id);stats.cached=false;}});
  const inspect=manager.store.state.bind(manager.store);
  manager.store.state=async(model,signal,verify)=>{
    if(!model.id.startsWith('deepseek-'))return inspect(model,signal,verify);
    assert.equal(verify,false,'model management never hashes large weights');
    const total=model.artifacts.reduce((sum,file)=>sum+file.bytes,0),installed=ready.has(model.id);
    return {ready:installed,totalBytes:total,diskBytes:installed?total:0,downloadedBytes:installed?total:0,downloading:false,inUse:stats.cached};
  };
  manager.store.install=async(model,signal,progress=()=>{})=>{
    signal.throwIfAborted();stats.models.push(model.id);const total=model.artifacts.reduce((sum,file)=>sum+file.bytes,0);
    progress({phase:'downloading',received:total/2,total});ready.add(model.id);progress({phase:'ready',received:total,total});return 'fixture';
  };
  manager.store.remove=async model=>{assert.equal(stats.cached,false,'idle server is unloaded before removing its files');ready.delete(model.id);};
  return {manager,stats,started,runtime,root};
}
test('native apply prepares only required packages, reuses installed weights without hashing, and persists CUDA preference',async()=>{
  const {manager,stats,runtime,root}=await setup();
  try{
    await manager.install('deepseek-ocr-v1',{mode:'cpu'});
    assert.deepEqual(stats.models,['deepseek-ocr-v1']);assert.deepEqual(stats.runtimes,['cpu']);assert.equal(stats.queries,0);
    await manager.install('deepseek-ocr-v1',{mode:'cpu'});assert.equal(stats.models.length,1);assert.equal(stats.runtimes.length,1);
    await manager.install('deepseek-ocr-v1',{mode:'gpu',gpu:gpu.id});assert.deepEqual(stats.runtimes,['cpu','cuda']);assert.equal(stats.models.length,1);
    const state=await manager.state(false,'ocr'),entry=state.entries.find(value=>value.id==='deepseek-ocr-v1')!;
    assert.equal(entry.ready,true);assert.equal(entry.progress,1);assert.deepEqual(entry.runtimeReady,{cpu:true,cuda:true});
    await manager.save('ocr',{modelId:entry.id,device:{mode:'gpu',gpu:gpu.id}},state.revision);
    const reloaded=new LocalModelManager(root,new OCRModels(join(root,'recognition','models')),fetch,async()=>({gpus:[]}),{runtimes:runtime});
    assert.deepEqual(await reloaded.selection('ocr'),{modelId:entry.id,device:{mode:'gpu',gpu:gpu.id}});await reloaded.stop();
  }finally{await manager.stop();}
});
test('aggregate runtime download progress counts installed weights and cancellation is resumable without an error',async()=>{
  const {manager,stats,started}=await setup({weightsReady:true,cpuReady:true,stallCUDA:true});
  try{
    const task=manager.install('deepseek-ocr-v2',{mode:'gpu',gpu:gpu.id});void task.catch(()=>{});await started;
    await assert.rejects(manager.install('deepseek-ocr-v2',{mode:'cpu'}),/正在下载/);
    let entry=(await manager.state(false,'ocr')).entries.find(value=>value.id==='deepseek-ocr-v2')!;
    assert.ok(entry.downloading);assert.ok(entry.progress>.8&&entry.progress<1);assert.equal(entry.runtimeReady?.cuda,false);
    manager.cancel(entry.id);await assert.rejects(task,/取消/);
    entry=(await manager.state(false,'ocr')).entries.find(value=>value.id===entry.id)!;assert.equal(entry.error,'');assert.equal(entry.downloading,false);
    stats.stall=false;await manager.install(entry.id,{mode:'gpu',gpu:gpu.id});
    assert.deepEqual(stats.models,[]);assert.deepEqual(stats.runtimes,['cuda','cuda']);
  }finally{await manager.stop();}
});
test('idle native caches remain deletable while active task usage protects the model',async()=>{
  const {manager,stats}=await setup({weightsReady:true,cpuReady:true});
  try{
    stats.cached=true;const entry=(await manager.state(false,'ocr')).entries.find(value=>value.id==='deepseek-ocr-v1')!;
    assert.equal(entry.inUse,false);const release=manager.use(entry.id),count=stats.unloaded.length;
    await assert.rejects(manager.remove(entry.id),/正在使用/);assert.equal(stats.unloaded.length,count);
    release();await manager.remove(entry.id);assert.equal(stats.unloaded.at(-1),entry.id);assert.equal(stats.cached,false);
    assert.equal((await manager.state(false,'ocr')).entries.find(value=>value.id===entry.id)!.ready,false);
  }finally{await manager.stop();}
});
test('invalid native GPU choices fail before any package or weight download',async()=>{
  const {manager,stats}=await setup();
  try{
    await assert.rejects(manager.install('deepseek-ocr-v2',{mode:'gpu',gpu:'00000000:000000ff'}),/所选显卡已不可用/);
    assert.deepEqual(stats.models,[]);assert.deepEqual(stats.runtimes,[]);
    await manager.install('deepseek-ocr-v2',{mode:'cpu'});assert.equal((await manager.state(false,'ocr')).entries.find(value=>value.id==='deepseek-ocr-v2')!.error,'');
  }finally{await manager.stop();}
});
