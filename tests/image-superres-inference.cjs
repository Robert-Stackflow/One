const assert=require('node:assert/strict');
const {Worker}=require('node:worker_threads');
const {mkdtemp,readFile,rm,stat}=require('node:fs/promises');
const {join}=require('node:path');
const {tmpdir}=require('node:os');
const sharp=require('sharp');

(async()=>{
 const model=process.env.ONE_SUPERRES_MODEL;if(!model)throw Error('Set ONE_SUPERRES_MODEL to the verified ONNX model path');
 assert.equal((await stat(model)).size,4945202);
 const folder=await mkdtemp(join(tmpdir(),'one-superres-inference-'));
 try{
  const source=join(folder,'sample.png'),output=join(folder,'result.png'),temporary=join(folder,'pending.png'),width=267,height=139;
  const pixels=Buffer.alloc(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   const index=(y*width+x)*4;pixels[index]=x%256;pixels[index+1]=y%256;pixels[index+2]=(x+y)%256;pixels[index+3]=x<20?0:255;
  }
  await sharp(pixels,{raw:{width,height,channels:4}}).png().toFile(source);
  const original=await readFile(source),progress=[];
  const result=await new Promise((resolve,reject)=>{
   const worker=new Worker(join(__dirname,'../dist/main/image-superres-worker.cjs'),{workerData:{source,output,temporary,model}});
   worker.on('message',message=>{if(message.type==='progress')progress.push(message.progress);else if(message.type==='result')resolve(message.result);else if(message.type==='error')reject(Error(message.message));});
   worker.on('error',reject);worker.on('exit',code=>{if(code)reject(Error('worker exited '+code));});
  });
  const metadata=await sharp(output).metadata();assert.equal(result.width,width*4);assert.equal(result.height,height*4);assert.equal(metadata.hasAlpha,true);
  assert.deepEqual(progress.at(-1),{phase:'process',done:6,total:6,message:'正在本地超分'});
  const corner=await sharp(output).extract({left:0,top:0,width:1,height:1}).raw().toBuffer();assert.equal(corner[3],0);
  assert.deepEqual(await readFile(source),original);
  console.log('image-superres-inference: actual CPU model, tiled output, original alpha and source unchanged');
 }finally{await rm(folder,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
