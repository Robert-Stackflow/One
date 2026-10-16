import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {readFile,readdir,writeFile,stat} from 'node:fs/promises';
import sharp from 'sharp';
import {ScrollStitch,type PixelFrame} from '../../src/shared/capture/scroll-stitch';
import {scrollDefaults} from '../../src/shared/capture/scroll-capture';
import {scrollDimensions,scrollEditSize,SCROLL_PIXELS,SCROLL_EDGE,SCROLL_THUMBNAIL_BYTES} from '../../src/shared/capture/scroll-limits';
import {imageDimensions} from '../../src/shared/capture/image-limits';
import {createScrollDirectory,cleanScrollDirectory,ScrollDiskStorage} from '../../src/main/capture/scroll-storage';
import {exportScrollPng} from '../../src/main/capture/scroll-export';

function frame(width:number,height:number,xOffset=0,yOffset=0):PixelFrame{
  const pixels=new Uint8Array(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const xx=x+xOffset,yy=y+yOffset,seed=(Math.imul(yy+17,1103515245)^Math.imul(xx+3,2654435761))>>>0,at=(y*width+x)*4;
    const ink=xx%24<15&&yy%22<12&&(seed&7)<4;
    pixels[at]=ink?(seed>>>18)&255:255;pixels[at+1]=ink?(seed>>>11)&255:255;pixels[at+2]=ink?seed&255:255;pixels[at+3]=255;
  }
  return {width,height,pixels};
}
function rgba(frame:PixelFrame){const bytes=Buffer.from(frame.pixels);for(let i=0;i<bytes.length;i+=4){const blue=bytes[i];bytes[i]=bytes[i+2];bytes[i+2]=blue;}return bytes;}

test('long-image limits are independent of capture/editor limits and scale copies to a valid canvas',()=>{
  assert.deepEqual(scrollDimensions(2000,22000),{width:2000,height:22000});assert.throws(()=>imageDimensions(2000,22000));
  assert.deepEqual(scrollDimensions(1,SCROLL_EDGE),{width:1,height:SCROLL_EDGE});assert.throws(()=>scrollDimensions(1,SCROLL_EDGE+1));
  assert.doesNotThrow(()=>scrollDimensions(10000,SCROLL_PIXELS/10000));assert.throws(()=>scrollDimensions(10000,SCROLL_PIXELS/10000+1));
  for(const [width,height] of [[2000,22000],[131072,96],[96,131072],[16000,10000]]){const copy=scrollEditSize(width,height);assert.equal(copy.scaled,true);assert.doesNotThrow(()=>imageDimensions(copy.width,copy.height));assert.ok(Math.abs(copy.width/copy.height-width/height)<.02);}
  assert.deepEqual(scrollEditSize(96,160),{width:96,height:160,scaled:false});
});

test('streaming PNG preserves BGRA pixels, axis orientation, fixed strips and undo',async()=>{
  for(const horizontal of [false,true])for(const fixed of [false,true]){
    const lease=await createScrollDirectory(),engine=new ScrollStitch(new ScrollDiskStorage(lease.directory,lease.token));
    try{
      const width=horizontal?160:96,height=horizontal?96:160;engine.configure({...scrollDefaults(),axis:horizontal?'horizontal':'vertical',autoFixed:false,retainStart:fixed?16:0,retainEnd:fixed?20:0},{width,height});engine.sample(frame(width,height));
      for(const offset of [39,79])assert.equal(engine.sample(frame(width,height,horizontal?offset:0,horizontal?0:offset)).match,'accepted');
      const expected=engine.output(),result=await exportScrollPng(engine,lease),decoded=await sharp(result.file).ensureAlpha().raw().toBuffer();assert.deepEqual(decoded,rgba(expected));
      assert.equal(result.scaled,false);assert.equal(result.width,expected.width);assert.equal(result.height,expected.height);assert.ok(!(await readdir(lease.directory)).some(name=>/\.part$|\.raw$/.test(name)));
      engine.undo();const retry=await exportScrollPng(engine,lease);assert.deepEqual(await sharp(retry.file).ensureAlpha().raw().toBuffer(),rgba(engine.output()));
      const bad={...lease,token:'not-the-owner'};await assert.rejects(exportScrollPng(engine,bad),/目录已失效/);
      // Damaged raw strips must fail export and remove partial output, retaining the session.
      const strip=(await readdir(lease.directory)).filter(name=>name.endsWith('.bgra')).sort((a,b)=>parseInt(a)-parseInt(b)).at(-1)!;await writeFile(join(lease.directory,strip),Buffer.alloc(4));
      await assert.rejects(exportScrollPng(engine,lease),/条带已改变/);assert.ok(!(await readdir(lease.directory)).some(name=>/\.part$|\.raw$/.test(name)));
    }finally{await cleanScrollDirectory(lease);}
  }
});

test('a 44-million-pixel screenshot crosses both former limits and exports at original size',async()=>{
  const lease=await createScrollDirectory(),engine=new ScrollStitch(new ScrollDiskStorage(lease.directory,lease.token)),width=2000,height=480,shift=320;
  try{
    engine.configure({...scrollDefaults(),autoFixed:false},{width,height});engine.sample(frame(width,height));
    for(let step=1;step<=68;step++)assert.equal(engine.sample(frame(width,height,0,step*shift)).match,'accepted');
    const size=engine.status();assert.equal(size.height,22240);assert.ok(size.width*size.height>40_000_000);
    const metrics=engine.storageStats();assert.ok(metrics.thumbnailBytes<=SCROLL_THUMBNAIL_BYTES);assert.ok(metrics.residentBytes<128*1024*1024);
    const started=performance.now(),result=await exportScrollPng(engine,lease),info=await sharp(result.file).metadata();
    assert.equal(info.width,width);assert.equal(info.height,size.height);assert.equal(result.scaled,false);
    for(const top of [0,11000,size.height-64]){const pixels=await sharp(result.file).extract({left:0,top,width,height:64}).ensureAlpha().raw().toBuffer();assert.deepEqual(pixels,rgba(frame(width,64,0,top)));}
    const copy=await exportScrollPng(engine,lease,true),copyInfo=await sharp(copy.file).metadata();assert.equal(copy.scaled,true);assert.equal(copyInfo.width,copy.width);assert.equal(copyInfo.height,copy.height);assert.doesNotThrow(()=>imageDimensions(copy.width,copy.height));
    console.log(JSON.stringify({pixels:size.width*size.height,height:size.height,residentMiB:Math.round(metrics.residentBytes/1024**2),diskMiB:Math.round(metrics.diskBytes/1024**2),pngMiB:Math.round((await stat(result.file)).size/1024**2),exportAndCheckMs:Math.round(performance.now()-started)}));
  }finally{await cleanScrollDirectory(lease);}
});

test('horizontal capture reaches the new long edge, preserves the frontier at the limit and remains exportable',async()=>{
  const lease=await createScrollDirectory(),engine=new ScrollStitch(new ScrollDiskStorage(lease.directory,lease.token)),width=160,height=64,shift=120;
  try{
    engine.configure({...scrollDefaults(),axis:'horizontal',autoFixed:false},{width,height});engine.sample(frame(width,height));
    const steps=Math.floor((SCROLL_EDGE-width)/shift);
    for(let step=1;step<=steps;step++)assert.equal(engine.sample(frame(width,height,step*shift)).match,'accepted');
    const before=engine.status();assert.ok(before.width>130000);assert.throws(()=>engine.sample(frame(width,height,(steps+1)*shift)),/131,072/);assert.deepEqual(engine.status(),before);
    const exported=await exportScrollPng(engine,lease),info=await sharp(exported.file).metadata();assert.equal(info.width,before.width);assert.equal(info.height,height);
    for(const left of [0,65000,before.width-64])assert.deepEqual(await sharp(exported.file).extract({left,top:0,width:64,height}).ensureAlpha().raw().toBuffer(),rgba(frame(64,height,left)));
    engine.undo();assert.equal(engine.status().width,before.width-shift);
  }finally{await cleanScrollDirectory(lease);}
});
