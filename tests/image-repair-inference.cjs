const assert=require('node:assert/strict');
const {Worker}=require('node:worker_threads');
const {mkdtemp,readFile,readdir,rm,stat}=require('node:fs/promises');
const {join}=require('node:path');
const {tmpdir}=require('node:os');
const sharp=require('sharp');

async function run(job,onProgress){
 const worker=new Worker(join(__dirname,'../dist/main/image-repair-worker.cjs'),{workerData:job});
 try{return await new Promise((resolve,reject)=>{worker.on('message',message=>{if(message.type==='progress'){onProgress?.(message.progress);return;}resolve(message);});worker.once('error',reject);worker.once('exit',code=>reject(Error(`worker exited ${code}`)));});}
 finally{await worker.terminate();}
}

(async()=>{
 const model=process.env.ONE_REPAIR_MODEL;if(!model)throw Error('Set ONE_REPAIR_MODEL to the verified MI-GAN ONNX model path');
 assert.equal((await stat(model)).size,28079181);
 const folder=await mkdtemp(join(tmpdir(),'one-repair-inference-'));
 try{
  const width=320,height=240,source=join(folder,'source.png'),output=join(folder,'repaired.png'),temporary=join(folder,'pending.png');
  const pixels=Buffer.alloc(width*height*4),marks=Buffer.alloc(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   const i=(y*width+x)*4;pixels[i]=x%256;pixels[i+1]=y%256;pixels[i+2]=120;pixels[i+3]=x<12?0:255;
   if(x>=140&&x<148){marks[i]=marks[i+1]=marks[i+2]=marks[i+3]=255;}
  }
  await sharp(pixels,{raw:{width,height,channels:4}}).png().toFile(source);
  const mask='data:image/png;base64,'+(await sharp(marks,{raw:{width,height,channels:4}}).png().toBuffer()).toString('base64');
  const original=await readFile(source),cancelBuffer=new SharedArrayBuffer(4);
  const message=await run({source,output,temporary,model,mask,cancelBuffer});
  assert.equal(message.type,'result');assert.equal(message.result.width,width);assert.equal(message.result.height,height);
  assert.deepEqual(await readFile(source),original);
  const result=await sharp(output).ensureAlpha().raw().toBuffer();
  assert.equal(result[(100*width+4)*4+3],0);assert.equal(result[(100*width+144)*4+3],255);
  const unmodified=await sharp(source).rotate().toColourspace('srgb').ensureAlpha().raw().toBuffer();
  for(const x of [4,50,200])assert.deepEqual(result.subarray((100*width+x)*4,(100*width+x)*4+4),unmodified.subarray((100*width+x)*4,(100*width+x)*4+4));
  const turnedSource=join(folder,'turned.jpg'),turnedOutput=join(folder,'turned-repaired.png');
  await sharp(source).flatten({background:'#fff'}).jpeg().withMetadata({orientation:6}).toFile(turnedSource);
  const turnedMask=Buffer.alloc(240*320*4);
  for(let y=30;y<280;y++)for(let x=110;x<118;x++){const i=(y*240+x)*4;turnedMask[i]=turnedMask[i+1]=turnedMask[i+2]=turnedMask[i+3]=255;}
  const turnedMaskUrl='data:image/png;base64,'+(await sharp(turnedMask,{raw:{width:240,height:320,channels:4}}).png().toBuffer()).toString('base64');
  const rotated=await run({source:turnedSource,output:turnedOutput,temporary:join(folder,'turned-pending.png'),model,mask:turnedMaskUrl,cancelBuffer:new SharedArrayBuffer(4)});
  assert.equal(rotated.type,'result');assert.equal(rotated.result.width,240);assert.equal(rotated.result.height,320);
  const cancelledOutput=join(folder,'cancelled.png'),cancelFlag=new Int32Array(new SharedArrayBuffer(4));
  const promise=run({source,output:cancelledOutput,temporary:join(folder,'cancel-pending.png'),model,mask,cancelBuffer:cancelFlag.buffer},()=>Atomics.store(cancelFlag,0,1));
  const stopped=await promise;assert.equal(stopped.type,'error');assert.match(stopped.message,/已取消/);
  assert.equal((await readdir(folder)).includes('cancelled.png'),false);
  console.log('image-repair-inference: CPU result, EXIF rotation, preserved source/alpha and cooperative cancellation passed');
 }finally{await rm(folder,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
