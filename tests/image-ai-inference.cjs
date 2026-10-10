const assert=require('node:assert/strict');
const {Worker}=require('node:worker_threads');
const {mkdtemp,rm,stat}=require('node:fs/promises');
const {join}=require('node:path');
const {tmpdir}=require('node:os');
const sharp=require('sharp');

(async()=>{
 const model=process.env.ONE_AI_MODEL;if(!model)throw Error('Set ONE_AI_MODEL to the locally verified u2netp.onnx path');
 assert.equal((await stat(model)).size,4574861);
 const folder=await mkdtemp(join(tmpdir(),'one-ai-inference-'));
 try{
  const source=join(folder,'sample.png'),output=join(folder,'result.png'),temporary=join(folder,'pending.png');
  const pixels=Buffer.alloc(320*320*3,255);for(let y=70;y<250;y++)for(let x=70;x<250;x++){const index=(y*320+x)*3;pixels[index]=30;pixels[index+1]=70;pixels[index+2]=160;}
  await sharp(pixels,{raw:{width:320,height:320,channels:3}}).png().toFile(source);
  const result=await new Promise((resolve,reject)=>{const worker=new Worker(join(__dirname,'../dist/main/image-ai-worker.cjs'),{workerData:{source,output,temporary,model}});worker.on('message',message=>message.type==='result'?resolve(message.result):reject(Error(message.message)));worker.on('error',reject);worker.on('exit',code=>{if(code)reject(Error(`worker exited ${code}`));});});
  const metadata=await sharp(output).metadata();assert.equal(result.output,output);assert.equal(metadata.width,320);assert.equal(metadata.height,320);assert.equal(metadata.hasAlpha,true);
  const {data,info}=await sharp(output).raw().toBuffer({resolveWithObject:true});let minimum=255,maximum=0;for(let index=3;index<data.length;index+=info.channels){minimum=Math.min(minimum,data[index]);maximum=Math.max(maximum,data[index]);}assert.ok(maximum>minimum,`alpha range ${minimum}..${maximum}`);
  console.log(`image-ai-inference: bundled worker and CPU inference passed; alpha ${minimum}..${maximum}`);
 }finally{await rm(folder,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
