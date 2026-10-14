import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { OCRImagePreview } from '../../src/main/recognition/image-preview';
const root=process.env.ONE_IMAGE_PREVIEW_ROOT!,worker=join(root,'ocr-tile-worker.cjs'),size={width:680,height:10000};
const source=await sharp(Buffer.from('<svg width="680" height="10000"><rect x="0" y="4500" width="680" height="1000" fill="red" fill-opacity=".5"/></svg>')).png().toBuffer();
const hash=createHash('sha256').update(source).digest('hex'),preview=new OCRImagePreview(source,size,worker);
try{
  const region={view:0,left:0,top:0,...size,downsample:10};
  const bytes=await preview.request(region),info=await sharp(bytes).metadata();assert.equal(info.width,68);assert.equal(info.height,1000);
  const expected=await sharp(source).resize({width:68,height:1000,fit:'fill'}).raw().toBuffer();assert.deepEqual(await sharp(bytes).raw().toBuffer(),expected);
  const first=preview.request({view:1,left:0,top:4000,width:680,height:1000,downsample:1});
  const stale=preview.request({view:1,left:0,top:4500,width:680,height:1000,downsample:1});
  const fresh=preview.request({view:2,left:0,top:4800,width:680,height:800,downsample:1});
  const results=await Promise.allSettled([first,stale,fresh]);assert.equal(results[1].status,'rejected');assert.equal(results[2].status,'fulfilled');
  if(results[2].status==='fulfilled')assert.deepEqual(await sharp(results[2].value).raw().toBuffer(),await sharp(source).extract({left:0,top:4800,width:680,height:800}).raw().toBuffer());
  await assert.rejects(preview.request({...region,view:0}),/更新/);
  assert.throws(()=>preview.request({...region,view:2,height:16385}),/范围/);
  assert.equal(createHash('sha256').update(source).digest('hex'),hash);
}finally{const child=(preview as any).child;await preview.close();assert.ok(child&&(child.exitCode!==null||child.signalCode!==null));}
const queued=new OCRImagePreview(source,size,worker),jobs=[];
for(let index=0;index<40;index++)jobs.push(queued.request({view:0,left:0,top:4500,width:680,height:500,downsample:1}));
const outcomes=Promise.allSettled(jobs);await queued.close();const rejected=await outcomes;
assert.ok(rejected.some(value=>value.status==='rejected'&&/过多/.test(String(value.reason))));
await assert.rejects(queued.request({view:1,left:0,top:0,width:10,height:10,downsample:1}),/关闭|退出/);
source.fill(0);console.log('Image preview: exact bounded PNG/alpha, stale view replacement, queue limit, owner close and original preservation passed');
