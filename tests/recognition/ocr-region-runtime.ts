import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire,syncBuiltinESMExports } from 'node:module';
import sharp from 'sharp';
import { decodedOCRTiles } from '../../src/main/recognition/ocr-tile-reader';
const require=createRequire(import.meta.url),cp=require('node:child_process'),originalFork=cp.fork;
const children:{child:import('node:child_process').ChildProcess;exited:boolean}[]=[];
cp.fork=(...args:unknown[])=>{const child=originalFork(...args),state={child,exited:false};children.push(state);child.once('exit',()=>state.exited=true);return child;};syncBuiltinESMExports();
const worker=join(process.env.ONE_OCR_REGION_ROOT!,'ocr-tile-worker.cjs');
try{
  const size={width:680,height:10000},source=await sharp(Buffer.from('<svg width="680" height="10000"><rect width="680" height="10000" fill="white"/><rect x="80" y="8350" width="420" height="900" fill="red" fill-opacity=".5"/></svg>')).png().toBuffer();
  const hash=createHash('sha256').update(source).digest('hex'),region={left:80,top:8400,width:420,height:600};let count=0;
  for await(const {tile,png,decodeRSSMiB}of decodedOCRTiles(source,size,new AbortController().signal,worker,region)){
    assert.equal(tile.left,80);assert.equal(tile.top,8400);assert.equal(tile.width,420);assert.equal(tile.height,600);
    assert.deepEqual(await sharp(png).raw().toBuffer(),await sharp(source).extract(region).raw().toBuffer());assert.ok(decodeRSSMiB<=384);count++;
  }
  assert.equal(count,1);assert.equal(createHash('sha256').update(source).digest('hex'),hash);
  const abort=new AbortController();const iterator=decodedOCRTiles(source,size,abort.signal,worker,{left:0,top:7000,width:680,height:2400});await iterator.next();abort.abort();await assert.rejects(iterator.next());
  const small={width:800,height:800},interlaced=await sharp({create:{...small,channels:4,background:{r:120,g:40,b:70,alpha:.4}}}).png({progressive:true}).toBuffer();assert.equal(interlaced[28],1);
  for await(const {png}of decodedOCRTiles(interlaced,small,new AbortController().signal,worker,{left:30,top:60,width:320,height:240}))assert.deepEqual(await sharp(png).raw().toBuffer(),await sharp(interlaced).extract({left:30,top:60,width:320,height:240}).raw().toBuffer());
  const longInterlaced=await sharp(source).png({progressive:true}).toBuffer();await assert.rejects(async()=>{for await(const _ of decodedOCRTiles(longInterlaced,size,new AbortController().signal,worker,region)){}},/交错 PNG/);
  assert.equal(children.length,4);assert.ok(children.every(state=>state.exited));console.log('Regional decoder: exact bottom-of-long-image crop, original coordinates/hash, alpha, small interlaced input, cancellation and four actual child exits passed');
}finally{cp.fork=originalFork;syncBuiltinESMExports();}
