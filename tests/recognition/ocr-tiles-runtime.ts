import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { writeFile,readFile,mkdir,copyFile } from 'node:fs/promises';
import { createRequire,syncBuiltinESMExports } from 'node:module';
import sharp from 'sharp';
import { decodedOCRTiles } from '../../src/main/recognition/ocr-tile-reader';
import { recognizeOCRImage } from '../../src/main/recognition/ocr-image-task';
import { planOCRTiles } from '../../src/shared/recognition/ocr-tiles';
import {paddleDetectionTiles} from '../../src/shared/recognition/paddle-dimensions';
import { textDocument,readingTokens,selectedText } from '../../src/shared/recognition/text-document';
import { OCRRunner } from '../../src/main/recognition/ocr-runner';
import { OCRModels } from '../../src/main/recognition/ocr-models';
import { PaddleRunner } from '../../src/main/recognition/paddle-runner';
import type { PaddleModelFiles } from '../../src/main/recognition/paddle-job';
const root=process.env.ONE_OCR_TILES_ROOT!,worker=join(root,'ocr-tile-worker.cjs'),size={width:680,height:10000};
const require=createRequire(import.meta.url),processes:any[]=[],childProcess=require('node:child_process'),fork=childProcess.fork;
let observeFork:((child:any,args:any[])=>void)|undefined;
childProcess.fork=(...args:any[])=>{const child=fork(...args);processes.push(child);observeFork?.(child,args);return child;};
syncBuiltinESMExports();
const lines=[100,1806,3596,5390,7185,8976,9800];
const png=await sharp(Buffer.from(`<svg width="680" height="10000"><rect width="100%" height="100%" fill="white"/><g fill="black" font-family="Arial" font-size="42">${lines.map((y,index)=>`<text x="24" y="${y}">ONE ROW ${index+1} END</text>`).join('')}</g></svg>`)).png().toBuffer();
const hash=createHash('sha256').update(png).digest('hex');
try{
  // This image is under the generic 12 MP limit but exceeds the v6 detector capacity.
  const capacitySize={width:2500,height:2100},capacityPNG=await sharp({create:{...capacitySize,channels:3,background:'white'}}).png().toBuffer();
  const policy=paddleDetectionTiles(capacitySize),plan=planOCRTiles(capacitySize,policy.tileEdge);let capacityCalls=0;
  const capacityResult=await recognizeOCRImage(capacityPNG,capacitySize,new AbortController().signal,async(chunk,dimensions)=>{
    const tile=plan[capacityCalls++],info=await sharp(chunk).metadata();assert.equal(info.width,dimensions.width);assert.equal(info.height,dimensions.height);
    const value={...dimensions,language:'eng' as const,text:'X'+tile.index,confidence:90,words:[{text:'X'+tile.index,x:tile.core.left-tile.left+10,y:tile.core.top-tile.top+10,width:50,height:20,line:0,confidence:90}]};
    return {...value,document:textDocument(value,createHash('sha256').update(chunk).digest('hex'),{id:'fixture',version:'1',model:'tile-capacity',device:'cpu'})};
  },()=>{},worker,undefined,policy);
  assert.equal(capacityCalls,plan.length);assert.equal(capacityResult.words.length,plan.length);
  assert.deepEqual(capacityResult.words.map(word=>[word.x,word.y]),plan.map(tile=>[tile.core.left+10,tile.core.top+10]));
  assert.equal(capacityResult.document!.source.sha256,createHash('sha256').update(capacityPNG).digest('hex'));capacityPNG.fill(0);
  let chunks=0,decodePeakMiB=0;
  for await(const {tile,png:chunk,decodeRSSMiB} of decodedOCRTiles(png,size,new AbortController().signal,worker)){
    decodePeakMiB=Math.max(decodePeakMiB,decodeRSSMiB);
    const info=await sharp(chunk).metadata();assert.equal(info.width,tile.width);assert.equal(info.height,tile.height);assert.ok(tile.height<=2048);
    const actual=await sharp(chunk).raw().toBuffer(),expected=await sharp(png,{sequentialRead:true}).extract({left:tile.left,top:tile.top,width:tile.width,height:tile.height}).raw().toBuffer();
    assert.deepEqual(actual,expected);chunks++;
  }
  assert.equal(chunks,planOCRTiles(size).length);
  for(const additional of [await sharp(png).rotate(90).png().toBuffer(),await sharp({create:{width:4000,height:4000,channels:3,background:'#284562'}}).png().toBuffer()]){
    const metadata=await sharp(additional).metadata(),dimensions={width:metadata.width!,height:metadata.height!};let count=0;
    for await(const {tile,png:chunk,decodeRSSMiB} of decodedOCRTiles(additional,dimensions,new AbortController().signal,worker)){
      decodePeakMiB=Math.max(decodePeakMiB,decodeRSSMiB);const actual=await sharp(chunk).raw().toBuffer();
      const expected=await sharp(additional,{sequentialRead:true}).extract({left:tile.left,top:tile.top,width:tile.width,height:tile.height}).raw().toBuffer();
      assert.deepEqual(actual,expected);count++;
    }
    assert.equal(count,planOCRTiles(dimensions).length);additional.fill(0);
  }
  const abort=new AbortController();let callbacks=0;
  await assert.rejects(recognizeOCRImage(png,size,abort.signal,async()=>{callbacks++;abort.abort();throw Error('cancelled');},()=>{},worker),/cancelled/);
  assert.equal(callbacks,1);assert.equal(createHash('sha256').update(png).digest('hex'),hash);
  const mutable=Buffer.from(png),mutableSize={...size};let snapshotCalls=0;
  const snapshot=await recognizeOCRImage(mutable,mutableSize,new AbortController().signal,async(chunk,dimensions)=>{
    mutable.fill(0);mutableSize.height=1;snapshotCalls++;
    const value={...dimensions,language:'eng' as const,words:[],text:'',confidence:0};
    return {...value,document:textDocument(value,createHash('sha256').update(chunk).digest('hex'),{id:'fixture',model:'1',version:'1',device:'cpu'})};
  },()=>{},worker);
  assert.equal(snapshot.document!.source.sha256,hash);assert.equal(snapshot.height,10000);assert.equal(snapshotCalls,chunks);
  const interlaced=await sharp(png).png({progressive:true}).toBuffer();
  await assert.rejects(async()=>{for await(const _ of decodedOCRTiles(interlaced,size,new AbortController().signal,worker)){}},/交错/);
  const truncated=png.subarray(0,Math.floor(png.length/2));
  await assert.rejects(async()=>{for await(const _ of decodedOCRTiles(truncated,size,new AbortController().signal,worker)){}},/PNG|png|解码|input|file|stream/i);
  // Additional repair crops reuse the same decoder and match the original source bytes exactly.
  const extraRect={left:40,top:1800,width:300,height:100},extra={...extraRect,index:chunks,core:{...extraRect}},beforeExtra=processes.length;
  let extraChunks=0;for await(const {tile,png:chunk,decodeRSSMiB}of decodedOCRTiles(png,size,new AbortController().signal,worker,undefined,undefined,()=>[extra])){decodePeakMiB=Math.max(decodePeakMiB,decodeRSSMiB);if(tile.index===chunks){const actual=await sharp(chunk).raw().toBuffer(),expected=await sharp(png).extract(extraRect).raw().toBuffer();assert.deepEqual(actual,expected);}extraChunks++;}
  assert.equal(extraChunks,chunks+1);assert.equal(processes.length,beforeExtra+1,'repairs must reuse the original decoder');
  for(const extras of [Array.from({length:17},(_,index)=>({...extra,index:chunks+index})),[{...extra,index:chunks+1}],[{...extra,width:2049}],[{...extra,core:{left:0,top:0,width:1,height:1}}]])await assert.rejects(async()=>{for await(const _of of decodedOCRTiles(png,size,new AbortController().signal,worker,undefined,undefined,()=>extras)){}},/裁剪|区域/);
  const beforeRepairAbort=new AbortController();let repairPlanned=false;await assert.rejects(async()=>{for await(const {tile}of decodedOCRTiles(png,size,beforeRepairAbort.signal,worker,undefined,undefined,()=>{repairPlanned=true;return [extra];}))if(tile.index===chunks-1)beforeRepairAbort.abort();},/取消|abort/i);assert.equal(repairPlanned,false);
  // The worker also enforces the crop protocol and budgets independently of the parent.
  const direct=childProcess.fork(worker,[],{serialization:'advanced',stdio:['ignore','ignore','ignore','ipc'],execArgv:['--max-old-space-size=128'],env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}});
  const request=(packet:unknown)=>new Promise<any>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('direct crop protocol timeout')),30000);direct.once('message',(value:unknown)=>{clearTimeout(timer);resolve(value);});direct.send(packet);});
  try{assert.equal((await request({type:'open',png,size})).ready,true);assert.match((await request({type:'crop',index:0,region:extraRect})).error,/协议/);
    for(let index=0;index<chunks;index++)assert.equal((await request({type:'next',index})).index,index);
    assert.match((await request({type:'crop',index:chunks,region:{left:0,top:0,width:2049,height:10}})).error,/区域/);
    for(let index=0;index<16;index++)assert.equal((await request({type:'crop',index:chunks+index,region:{left:0,top:0,width:32,height:32}})).index,chunks+index);
    assert.match((await request({type:'crop',index:chunks+16,region:extraRect})).error,/区域/);
  }finally{if(direct.exitCode===null&&direct.signalCode===null)await new Promise<void>(resolve=>{direct.once('exit',()=>resolve());direct.kill();});}
  for(const regional of [false,true]){
    const child=childProcess.fork(worker,[],{serialization:'advanced',stdio:['ignore','ignore','ignore','ipc'],env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}}),region=regional?{left:20,top:20,width:500,height:200}:undefined;
    const ask=(packet:unknown)=>new Promise<any>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('crop limit timeout')),30000);child.once('message',(value:unknown)=>{clearTimeout(timer);resolve(value);});child.send(packet);});
    try{assert.equal((await ask({type:'open',png,size,region})).ready,true);const count=regional?1:chunks;for(let index=0;index<count;index++)assert.equal((await ask({type:'next',index})).index,index);
      if(regional){assert.match((await ask({type:'crop',index:count,region:{left:0,top:0,width:32,height:32}})).error,/区域/);assert.equal((await ask({type:'crop',index:count,region:{left:20,top:20,width:32,height:32}})).index,count);}
      else{for(let index=0;index<5;index++)assert.equal((await ask({type:'crop',index:count+index,region:{left:0,top:0,width:680,height:1984}})).index,count+index);assert.match((await ask({type:'crop',index:count+5,region:{left:0,top:0,width:680,height:1984}})).error,/区域/);assert.equal((await ask({type:'crop',index:count+5,region:{left:0,top:0,width:32,height:32}})).index,count+5);}
    }finally{if(child.exitCode===null&&child.signalCode===null)await new Promise<void>(resolve=>{child.once('exit',()=>resolve());child.kill();});}
  }
  const seamSize={width:2200,height:9000},seamPNG=await sharp({create:{...seamSize,channels:3,background:'white'}}).png().toBuffer(),seamPlan=planOCRTiles(seamSize,1984),seamHash=createHash('sha256').update(seamPNG).digest('hex');let seamCalls=0;const progressValues:number[]=[];
  function seamResult(dimensions:{width:number;height:number},index:number){const tile=seamPlan[index];const words=index===0?[{text:'Column reading ol',x:903-tile.left,y:31-tile.top,width:325,height:50,line:0,confidence:95}]:index===1?[{text:'umn reading order',x:972-tile.left,y:31-tile.top,width:328,height:50,line:0,confidence:95}]:index>=seamPlan.length?[{text:'Column reading order',x:51,y:35,width:394,height:46,line:0,confidence:96}]:[];const value={...dimensions,language:'eng' as const,text:words.map(word=>word.text).join(' '),confidence:95,words};return {...value,document:textDocument(value,seamHash,{id:'fixture',version:'1',model:'seam',device:'cpu'})};}
  const repaired=await recognizeOCRImage(seamPNG,seamSize,new AbortController().signal,async(_chunk,dimensions,update)=>{const index=seamCalls++;update(.5);return seamResult(dimensions,index);},value=>progressValues.push(value),worker,undefined,{forceTiles:true,tileEdge:1984});
  assert.equal(seamCalls,seamPlan.length+1);assert.equal(repaired.text,'Column reading order');assert.equal(repaired.words[0].x,904);assert.equal(repaired.document!.source.sha256,seamHash);assert.ok(progressValues.every((value,index)=>value>=0&&value<=1&&(!index||value>=progressValues[index-1])));assert.equal(progressValues.at(-1),1);
  const repairAbort=new AbortController();seamCalls=0;await assert.rejects(recognizeOCRImage(seamPNG,seamSize,repairAbort.signal,async(_chunk,dimensions)=>{const index=seamCalls++;if(index===seamPlan.length){repairAbort.abort();throw Error('repair cancelled');}return seamResult(dimensions,index);},()=>{},worker,undefined,{forceTiles:true,tileEdge:1984}),/cancelled/);assert.equal(seamCalls,seamPlan.length+1);assert.equal(createHash('sha256').update(seamPNG).digest('hex'),seamHash);seamPNG.fill(0);
  const models=new OCRModels(join(root,'profile','recognition','models'));await mkdir(models.directory,{recursive:true});
  for(const name of ['eng','chi_sim'])await copyFile(join('work/current/fixtures/recognition-models',name+'.traineddata'),join(models.directory,name+'.traineddata'));
  const tess=new OCRRunner(models,join(root,'ocr-worker.cjs'),90000);
  const progress:number[]=[];
  const first=await recognizeOCRImage(png,size,new AbortController().signal,(chunk,dimensions,update)=>tess.run(chunk,dimensions,'eng',update),value=>progress.push(value),worker);
  for(let index=0;index<lines.length;index++)assert.match(first.text,new RegExp(`ONE ROW ${index+1} END`));
  assert.equal((first.text.match(/ONE ROW/g)||[]).length,lines.length);assert.equal(first.document!.source.sha256,hash);
  assert.ok(first.words.some(word=>word.y>9000));assert.ok(progress.every((value,index)=>index===0||value>=progress[index-1]));
  const tokens=readingTokens(first.document!);assert.equal(selectedText(tokens,0,tokens.length-1),first.text);
  const artifact=async(name:string)=>{const path=join('work/current/capture-reconstruction',name),bytes=await readFile(path);return {path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};};
  const model:PaddleModelFiles={id:'ppocr-v6-tiny',revision:'long-image-fixture',detection:await artifact('pp-ocrv6-tiny-det.onnx'),recognition:await artifact('pp-ocrv6-tiny-rec.onnx'),detectionConfig:await artifact('pp-ocrv6-tiny-det.yml'),recognitionConfig:await artifact('pp-ocrv6-tiny-rec.yml')};
  const dml=process.argv.includes('--dml'),device=process.argv.includes('--device1')?1:0;
  const paddle=new PaddleRunner(join(root,'paddle-worker.cjs'),90000);
  let second;
  try{second=await recognizeOCRImage(png,size,new AbortController().signal,(chunk,dimensions,update)=>paddle.run(chunk,dimensions,'eng',model,{device:dml?'gpu':'cpu',deviceId:device},update),()=>{},worker);}
  finally{await paddle.close();}
  const cancelNative=new PaddleRunner(join(root,'paddle-worker.cjs'),90000),nativeAbort=new AbortController(),nativeInput=await sharp({create:{...seamSize,channels:3,background:'white'}}).png().toBuffer();let nativeRepairSpawned=false,nativeCancelStarted=0;seamCalls=0;
  observeFork=(child,args)=>{if(args[0]===join(root,'paddle-worker.cjs'))child.once('spawn',()=>{nativeRepairSpawned=true;nativeCancelStarted=Date.now();nativeAbort.abort();void cancelNative.cancel();});};
  try{await assert.rejects(recognizeOCRImage(nativeInput,seamSize,nativeAbort.signal,async(chunk,dimensions)=>{const index=seamCalls++;return index<seamPlan.length?seamResult(dimensions,index):cancelNative.run(chunk,dimensions,'eng',model,{device:dml?'gpu':'cpu',deviceId:device});},()=>{},worker,undefined,{forceTiles:true,tileEdge:1984}),/取消|cancel/);assert.equal(nativeRepairSpawned,true);assert.equal(seamCalls,seamPlan.length+1);assert.ok(Date.now()-nativeCancelStarted<5000,'repair cancellation must settle without the OCR timeout');}
  finally{observeFork=undefined;await cancelNative.close();nativeInput.fill(0);}
  for(let index=0;index<lines.length;index++)assert.match(second.text,new RegExp(`ONE ROW ${index+1} END`));
  assert.equal((second.text.match(/ONE ROW/g)||[]).length,lines.length);assert.ok(readingTokens(second.document!).some(token=>token.geometry==='ctc'&&token.quad[0].y>9000));
  assert.equal(second.document!.engine.device,dml?'dml':'cpu');
  assert.ok(processes.length>=8,'process cleanup check must observe the actual forked children');
  await writeFile(join(root,'results.json'),JSON.stringify({size,chunks,decodePeakMiB,tesseract:{text:first.text,words:first.words.length},paddle:{text:second.text,words:second.words.length,backend:dml?'dml':'cpu',device},sourceHash:hash,repairDecoderReuse:true,repairOriginalCoordinates:true,repairMonotonicProgress:true,nativeRepairCancelled:nativeRepairSpawned,processes:processes.length}));
  await writeFile(join(root,'input.png'),png);
  assert.ok(processes.every(child=>child.exitCode!==null||child.signalCode!==null),'decode/inference children have exited');
  console.log('Long image: exact sequential crops, cancel/truncated/interlaced recovery, 10000px Tesseract/Paddle OCR, seam deduplication, global glyph coordinates, bounded repair crops/replacement/cancel/protocol and child cleanup passed');
}finally{childProcess.fork=fork;syncBuiltinESMExports();png.fill(0);}
