import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {pix2texInput,pix2texTensor,pix2texResize} from '../../src/main/recognition/pix2tex-input';
import {pix2texNative} from '../../src/main/recognition/pix2tex-catalog';
import {FormulaLocalRunner} from '../../src/main/recognition/formula-local-runner';
import type {FormulaModelFiles} from '../../src/main/recognition/formula-local';
import {LocalInferenceScheduler} from '../../src/main/local-inference-scheduler';

async function main(){
 const directory=process.env.ONE_PIX2TEX_TEST_ROOT!,root=resolve('work/current/capture-reconstruction/formula/pix2tex'),hash=(value:Buffer|Uint8Array)=>createHash('sha256').update(value).digest('hex'),manifest=JSON.parse(await readFile(join(root,'native-preprocess-golden.json'),'utf8'));
 assert.equal(manifest.passed,true);const checks=[];
 for(const sample of manifest.cases){
  const folder=join(root,'preprocess-golden'),png=await readFile(join(folder,sample.image)),original=hash(png),image=await pix2texInput(png),expected=await readFile(join(folder,sample.raw));assert.equal(image.width,sample.shape[3]);assert.equal(image.height,sample.shape[2]);assert.deepEqual(Buffer.from(image.data),expected,sample.id+' '+sample.variant+' pixels');
  const pixels=pix2texTensor(image),actual=Buffer.from(pixels.buffer,pixels.byteOffset,pixels.byteLength),tensor=await readFile(join(folder,sample.tensor));assert.equal(hash(actual),sample.sha256,sample.id+' '+sample.variant+' tensor');assert.deepEqual(actual,tensor);
  for(const resize of sample.resizes){const value=pix2texResize(image,resize.width,resize.height,resize.filter==='linear');assert.deepEqual(Buffer.from(value.data),await readFile(join(folder,resize.raw)),sample.id+' '+sample.variant+' '+resize.filter);value.data.fill(0);}
  assert.equal(hash(png),original);image.data.fill(0);pixels.fill(0);checks.push({id:sample.id,variant:sample.variant,passed:true});
 }
 console.log('Native preprocessing: '+checks.length+' input/tensor and '+checks.length*2+' Pillow resize comparisons passed');
 await writeFile(join(directory,'preprocess.json'),JSON.stringify({passed:true,checks},null,2));
 const backend=process.argv.find(value=>value.startsWith('--backend='))?.slice(10);if(!backend)return;assert.ok(['cpu','dml0','dml1'].includes(backend));
 const artifact=(name:'encoder'|'decoder'|'resizer'|'tokenizer')=>({...pix2texNative[name],path:name==='tokenizer'?join(root,'runtime/Lib/site-packages/pix2tex/model/dataset/tokenizer.json'):join(root,'onnx',pix2texNative[name].name)});
 const model:FormulaModelFiles={id:pix2texNative.id,revision:pix2texNative.revision,engine:'pix2tex',onnx:artifact('encoder'),decoder:artifact('decoder'),resizer:artifact('resizer'),config:artifact('tokenizer')},reference=JSON.parse(await readFile(join(root,'greedy-results.json'),'utf8'));assert.equal(reference.greedy,true);
 const runner=new FormulaLocalRunner(undefined,60000,60000,new LocalInferenceScheduler()),prefs={device:backend==='cpu'?'cpu':'gpu',deviceId:backend==='dml1'?1:0} as const,records=[];
 try{
  for(const [index,sample] of reference.results.entries()){
   const png=await readFile(join(root,'../cases',sample.id+'.png')),original=hash(png),phases:string[]=[],started=Date.now(),result=await runner.run(png,model,prefs,(_value,phase)=>phases.push(phase));
   assert.equal(result.text,sample.latex,sample.id+' native greedy text');assert.equal(result.sourceSha256,original);assert.equal(hash(png),original);assert.equal(result.actualBackend,backend==='cpu'?'cpu':'dml');assert.equal(result.deviceId,prefs.device==='gpu'?prefs.deviceId:undefined);assert.equal(phases.filter(value=>value==='loading').length,index===0?1:0,'same model must stay warm');records.push({id:sample.id,milliseconds:Date.now()-started,phases,result});await writeFile(join(directory,'results.json'),JSON.stringify({backend,records},null,2));console.log(JSON.stringify({passed:sample.id,backend,milliseconds:Date.now()-started}));
  }
  const png=await readFile(join(root,'../cases/scripts.png')),sourceHash=hash(png);let cancelling:Promise<void>|undefined;
  await assert.rejects(runner.run(png,model,prefs,(value,phase)=>{if(value>.2&&phase==='recognizing'&&!cancelling)cancelling=runner.cancel();}),/取消|abort/i);await cancelling;assert.ok(cancelling);assert.equal(hash(png),sourceHash);
  const retry=await runner.run(png,model,prefs);assert.equal(retry.text,reference.results.find((value:any)=>value.id==='scripts').latex);assert.equal(hash(png),sourceHash);
  const bad=structuredClone(model);bad.decoder!.sha256='0'.repeat(64);const failures:string[]=[];await assert.rejects(runner.run(png,bad,{device:'auto',automaticBackend:'dml',deviceId:prefs.deviceId},(_value,phase)=>failures.push(phase)),/预设|配置/);assert.ok(!failures.includes('cpu-fallback'));
  if(backend==='cpu'){
   const phases:string[]=[],fallback=await runner.run(png,model,{device:'auto',automaticBackend:'dml',deviceId:31},(_value,phase)=>phases.push(phase));assert.equal(fallback.actualBackend,'cpu');assert.ok(fallback.fallbackReason);assert.equal(phases.filter(value=>value==='cpu-fallback').length,1);assert.equal(fallback.text,retry.text);assert.equal(hash(png),sourceHash);
   const forced:string[]=[];await assert.rejects(runner.run(png,model,{device:'gpu',deviceId:31},(_value,phase)=>forced.push(phase)));assert.ok(!forced.includes('cpu-fallback'));assert.equal(hash(png),sourceHash);
  }
  await writeFile(join(directory,'lifecycle.json'),JSON.stringify({passed:true,backend,cancelledDuringDecode:true,retry:true,integrityNoFallback:true,sourcePreserved:true,...(backend==='cpu'?{realDmlFailureCPUFallback:true,forcedGpuNoFallback:true}:{})},null,2));
 }finally{await runner.close();}
}
void main().catch(error=>{console.error(String(error).slice(0,1800));process.exitCode=1;});
