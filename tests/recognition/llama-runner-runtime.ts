import assert from 'node:assert/strict';
import { link, mkdir, readFile, readdir } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import sharp from 'sharp';
import { LocalModelStore, localModelIdentity } from '../../src/main/local-model-store';
import { LlamaRuntimeStore } from '../../src/main/recognition/llama-runtime-store';
import { llamaRuntimeProfiles } from '../../src/main/recognition/llama-runtime-catalog';
import { deepseekOCRPresets } from '../../src/main/recognition/deepseek-models';
import {readingTokens,selectedText} from '../../src/shared/recognition/text-document';
import { LlamaRunner } from '../../src/main/recognition/llama-runner';
import { LlamaSession } from '../../src/main/recognition/llama-session';
import { LocalInferenceScheduler } from '../../src/main/local-inference-scheduler';

async function main(){
  const directory=process.env.ONE_MODEL_TEST_ROOT!,fixtures=resolve('work/current/capture-reconstruction/deepseek');
  const helper=resolve(process.env.ONE_INFERENCE_MONITOR||'work/current/capture-reconstruction/One.Monitor.Inference.exe');
  let network=0;const offline=async()=>{network++;throw Error('Native runner test must stay offline');};
  const weights=new LocalModelStore(join(directory,'weights'),offline),runtimes=new LlamaRuntimeStore(join(directory,'runtime'),offline);
  for(const preset of deepseekOCRPresets){
    const installed=join(weights.root,localModelIdentity(preset));await mkdir(installed,{recursive:true});
    // Read-only fixture links avoid copying another 7 GB; acquire still hashes the real fixed artifacts.
    for(const artifact of preset.artifacts)await link(join(fixtures,basename(new URL(artifact.url).pathname)),join(installed,artifact.name));
  }
  for(const backend of ['cpu','cuda'] as const){
    const profile=llamaRuntimeProfiles.find(value=>value.backend===backend)!;
    await runtimes.install(backend,new AbortController().signal,()=>{},Object.fromEntries(profile.archives.map(archive=>[archive.id,join(fixtures,archive.name)])));
  }
  let acquires=0;const acquire=weights.acquire.bind(weights);weights.acquire=async(...args)=>{acquires++;return acquire(...args);};
  const scheduler=new LocalInferenceScheduler(),controlDirectory=join(directory,'control');
  const runner=new LlamaRunner(weights,runtimes,controlDirectory,{helper,scheduler});
  const png=await readFile(join(fixtures,'english.png')),mixed=await readFile(join(fixtures,'mixed-dark.png'));
  const size=await sharp(png).metadata(),mixedSize=await sharp(mixed).metadata();
  const results:unknown[]=[];
  try{
    let verificationCancelled:Promise<void>|undefined;
    const verifying=runner.run(png,{width:size.width!,height:size.height!},'eng','deepseek-ocr-v2',{mode:'gpu'},phase=>{
      if(phase==='verifying')setTimeout(()=>{verificationCancelled=runner.cancel();void verificationCancelled.catch(()=>{});},10);
    });
    await assert.rejects(verifying,/abort|取消/i);await verificationCancelled;
    assert.equal((await weights.state(deepseekOCRPresets[1],undefined,false)).inUse,false);
    const previousAcquires=acquires;
    const first=await runner.run(png,{width:size.width!,height:size.height!},'eng','deepseek-ocr-v2',{mode:'gpu'});
    assert.equal(first.actualBackend,'cuda');assert.match(first.text.replace(/\s/g,''),/ONEOCR2026/);
    assert.equal(first.document!.engine.model,deepseekOCRPresets[1].revision);
    const tokens=readingTokens(first.document!);assert.ok(tokens.length>0&&tokens.every(token=>token.geometry==='region'));
    assert.equal(selectedText(tokens,0,tokens.length-1),first.text);assert.ok(!first.text.includes('<|'));
    await assert.rejects(weights.remove(deepseekOCRPresets[1]),/使用/);
    const second=await runner.run(mixed,{width:mixedSize.width!,height:mixedSize.height!},'chi_sim+eng','deepseek-ocr-v2',{mode:'gpu'});
    assert.match(second.text,/截图识别测试/);assert.match(second.text,/sample@example\.com/);assert.equal(acquires,previousAcquires+1);
    assert.equal(second.words.length,3);assert.equal(readingTokens(second.document!).length,3);
    await scheduler.run({owner:Symbol('other-engine')},new AbortController().signal,async()=>{
      assert.equal((await weights.state(deepseekOCRPresets[1],undefined,false)).inUse,false);
      assert.equal((await runtimes.state('cuda')).inUse,false);
    });
    let cancelling:Promise<void>|undefined;
    const cancelled=runner.run(mixed,{width:mixedSize.width!,height:mixedSize.height!},'chi_sim+eng','deepseek-ocr-v1',{mode:'gpu'},phase=>{
      if(phase==='recognizing')setTimeout(()=>{cancelling=runner.cancel();void cancelling.catch(()=>{});},100);
    });
    await assert.rejects(cancelled,/取消/);await cancelling;
    assert.equal((await weights.state(deepseekOCRPresets[0],undefined,false)).inUse,false);
    assert.equal((await runtimes.state('cuda')).inUse,false);await runner.close();
    const fallback=new LlamaRunner(weights,runtimes,controlDirectory,{helper,scheduler,
      sessionFactory:options=>new LlamaSession({...options,...(options.backend==='cuda'?{memoryMiB:128}:{})})});
    try{
      const result=await fallback.run(png,{width:size.width!,height:size.height!},'eng','deepseek-ocr-v1',{mode:'auto'});
      assert.equal(result.actualBackend,'cpu');assert.match(result.text.replace(/\s/g,''),/ONEOCR2026/);
      assert.match(result.fallbackReason!,/内存|退出/);assert.equal(result.document!.engine.model,deepseekOCRPresets[0].revision);
      assert.ok(readingTokens(result.document!).length>0&&readingTokens(result.document!).every(token=>token.geometry==='region'));
      results.push({case:'actual-quota-cuda-to-same-model-cpu',backend:result.actualBackend,peakRSSMiB:Math.round(result.peakRSSMiB)});
    }finally{await fallback.close();}
    assert.deepEqual(await readdir(controlDirectory),[]);assert.equal(network,0);
    for(const preset of deepseekOCRPresets)await weights.remove(preset);
    console.log(JSON.stringify({passed:['hash-cancel','verified-GGUF-lease','CUDA-v2','warm-changed-image','cross-engine-unload','active-cancel','quota-CPU-fallback','safe-remove'],acquires,network,results}));
  }finally{png.fill(0);mixed.fill(0);await runner.close();await runtimes.stop();}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
