import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { writeFile,readFile,mkdir,copyFile } from 'node:fs/promises';
import { createRequire,syncBuiltinESMExports } from 'node:module';
import sharp from 'sharp';
import { decodedOCRTiles } from '../../src/main/recognition/ocr-tile-reader';
import { recognizeOCRImage } from '../../src/main/recognition/ocr-image-task';
import { planOCRTiles } from '../../src/shared/recognition/ocr-tiles';
import { textDocument,readingTokens,selectedText } from '../../src/shared/recognition/text-document';
import { OCRRunner } from '../../src/main/recognition/ocr-runner';
import { OCRModels } from '../../src/main/recognition/ocr-models';
import { PaddleRunner } from '../../src/main/recognition/paddle-runner';
import type { PaddleModelFiles } from '../../src/main/recognition/paddle-job';
const root=process.env.ONE_OCR_TILES_ROOT!,worker=join(root,'ocr-tile-worker.cjs'),size={width:680,height:10000};
const require=createRequire(import.meta.url),processes:any[]=[],childProcess=require('node:child_process'),fork=childProcess.fork;
childProcess.fork=(...args:any[])=>{const child=fork(...args);processes.push(child);return child;};
syncBuiltinESMExports();
const lines=[100,1806,3596,5390,7185,8976,9800];
const png=await sharp(Buffer.from(`<svg width="680" height="10000"><rect width="100%" height="100%" fill="white"/><g fill="black" font-family="Arial" font-size="42">${lines.map((y,index)=>`<text x="24" y="${y}">ONE ROW ${index+1} END</text>`).join('')}</g></svg>`)).png().toBuffer();
const hash=createHash('sha256').update(png).digest('hex');
try{
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
  for(let index=0;index<lines.length;index++)assert.match(second.text,new RegExp(`ONE ROW ${index+1} END`));
  assert.equal((second.text.match(/ONE ROW/g)||[]).length,lines.length);assert.ok(readingTokens(second.document!).some(token=>token.geometry==='ctc'&&token.quad[0].y>9000));
  assert.equal(second.document!.engine.device,dml?'dml':'cpu');
  assert.ok(processes.length>=8,'process cleanup check must observe the actual forked children');
  await writeFile(join(root,'results.json'),JSON.stringify({size,chunks,decodePeakMiB,tesseract:{text:first.text,words:first.words.length},paddle:{text:second.text,words:second.words.length,backend:dml?'dml':'cpu',device},sourceHash:hash,processes:processes.length}));
  await writeFile(join(root,'input.png'),png);
  assert.ok(processes.every(child=>child.exitCode!==null||child.signalCode!==null),'decode/inference children have exited');
  console.log('Long image: exact sequential crops, cancel/truncated/interlaced recovery, 10000px Tesseract/Paddle OCR, seam deduplication, global glyph coordinates and child cleanup passed');
}finally{childProcess.fork=fork;syncBuiltinESMExports();png.fill(0);}
