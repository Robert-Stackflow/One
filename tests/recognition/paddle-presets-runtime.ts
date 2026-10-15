import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import sharp from 'sharp';
import { LocalModelStore } from '../../src/main/local-model-store';
import { paddleSmallModel, paddleMediumModel, paddleV5MobileModel, paddleV5ServerModel } from '../../src/main/local-model-catalog';
import { acquirePaddleModel } from '../../src/main/recognition/paddle-models';
import { PaddleRunner } from '../../src/main/recognition/paddle-runner';

const directory=process.env.ONE_MODEL_TEST_ROOT!,root=resolve('work/current/capture-reconstruction');
const v5=process.env.ONE_PADDLE_TEST_FAMILY==='v5',gpu=process.env.ONE_PADDLE_TEST_GPU!==undefined,deviceId=Number(process.env.ONE_PADDLE_TEST_GPU||0);
assert.ok(Number.isSafeInteger(deviceId)&&deviceId>=0&&deviceId<=15);
const store=new LocalModelStore(join(directory,'cache'),async()=>{throw Error('preset verification must remain offline');});
const suffixes:Record<string,string>={detection:'det.onnx',detectionConfig:'det.yml',recognition:'rec.onnx',recognitionConfig:'rec.yml'};
const english=await sharp(Buffer.from('<svg width="680" height="120"><rect width="680" height="120" fill="white"/><text x="15" y="85" font-family="Arial" font-size="58">ONE OCR 2026</text></svg>')).rotate(180).png().toBuffer();
const mixed=await sharp(Buffer.from('<svg width="900" height="260"><rect width="900" height="260" fill="#222"/><g fill="#eee"><text x="20" y="70" font-family="Arial" font-size="50">ONE OCR 2026</text><text x="20" y="150" font-family="Microsoft YaHei" font-size="50">截图识别测试</text><text x="20" y="230" font-family="Arial" font-size="42">sample@example.com</text></g></svg>')).png().toBuffer();
const cases=[{id:'upside-down',png:english,expected:['ONEOCR2026']},{id:'mixed-dark',png:mixed,expected:['ONEOCR2026','截图识别测试','sample@example.com']}];
if(v5){cases.push({id:'english',png:await sharp(english).rotate(180).png().toBuffer(),expected:['ONEOCR2026']},
  {id:'mixed-light',png:await sharp(mixed).negate({alpha:false}).png().toBuffer(),expected:['ONEOCR2026','截图识别测试','sample@example.com']},
  {id:'quarter-turn',png:await sharp(english).rotate(270).png().toBuffer(),expected:['ONEOCR2026']});}
const reports=[];
const runner=new PaddleRunner(join(directory,'paddle-worker.cjs'),90000,60000);
let previous:ChildProcess|undefined;
try{for(const preset of v5?[paddleV5MobileModel,paddleV5ServerModel,paddleV5MobileModel]:[paddleSmallModel,paddleMediumModel,paddleSmallModel]){
  const files=Object.fromEntries(preset.artifacts.map(file=>[file.role,join(root,file.role==='orientation'?'pp-textline-orientation.onnx':file.role==='orientationConfig'?'pp-textline-orientation.yml':v5?`paddle-v5/${preset.size}-${suffixes[file.role]}`:`pp-ocrv6-${preset.size}-${suffixes[file.role]}`)]));
  await store.install(preset,new AbortController().signal,()=>{},files);
  await assert.rejects(acquirePaddleModel(store,{...preset,revision:preset.revision+'-unknown'}),/尚未适配/);
  await assert.rejects(acquirePaddleModel(store,{...preset,artifacts:preset.artifacts.filter(file=>file.role!=='orientation')}),/尚未适配/);
  const lease=await acquirePaddleModel(store,preset.id);let current:ChildProcess|undefined;
  try{
    assert.equal(lease.preset,preset);assert.ok(lease.model.orientation&&lease.model.orientationConfig);
    await assert.rejects(store.remove(preset),/使用/);
    for(const item of cases){
      const metadata=await sharp(item.png).metadata(),started=performance.now();
      const result=await runner.run(item.png,{width:metadata.width!,height:metadata.height!},'chi_sim+eng',lease.model,{device:gpu?'gpu':'cpu',deviceId,memoryMiB:lease.preset.memoryBudgetMiB});
      const child=(runner as unknown as {child:ChildProcess}).child;
      if(!current){if(previous){assert.notEqual(child.pid,previous.pid);assert.ok(previous.exitCode!==null||previous.signalCode!==null,'previous native model process exits before replacement runs');}current=child;previous=child;}
      else assert.equal(child.pid,current.pid,'same-preset warm tasks reuse the native process');
      const text=result.text.replace(/\s/g,'');for(const expected of item.expected)assert.ok(text.includes(expected),`${preset.id}/${item.id}: missing ${expected}`);
      assert.equal(result.document!.engine.model,preset.revision);assert.equal(result.actualBackend,gpu?'dml':'cpu');
      assert.equal(result.document!.source.sha256,createHash('sha256').update(item.png).digest('hex'));
      assert.ok(result.peakRSSMiB!>0&&result.peakRSSMiB!<=preset.memoryBudgetMiB);
      reports.push({preset:preset.id,revision:preset.revision,case:item.id,backend:result.actualBackend,milliseconds:Math.round(performance.now()-started),peakRSSMiB:Math.ceil(result.peakRSSMiB!),budgetMiB:preset.memoryBudgetMiB});
    }
  }finally{lease.release();}
  await store.remove(preset);assert.equal((await store.state(preset)).ready,false);
}}finally{await runner.close();}
await writeFile(join(root,`paddle-${v5?'v5':'presets'}-${gpu?'dml-'+deviceId:'cpu'}-runtime-report.json`),JSON.stringify(reports,null,2));
console.log('Paddle '+(v5?'v5 mobile/server':'v6 small/medium')+': pinned cache, orientation, mixed/dark text, budgets, warm reuse, model switching and lease cleanup passed ('+reports.length+' '+(gpu?'DML '+deviceId:'CPU')+' cases)');
