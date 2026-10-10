const assert=require('node:assert/strict');
const {Worker}=require('node:worker_threads');
const {mkdtemp,rm}=require('node:fs/promises');
const {join}=require('node:path');
const {tmpdir}=require('node:os');
const sharp=require('sharp');

(async()=>{
 const model=process.env.ONE_SUPERRES_MODEL;if(!model)throw Error('Set ONE_SUPERRES_MODEL to the verified ONNX model path');
 const folder=await mkdtemp(join(tmpdir(),'one-superres-limit-'));
 try{
  const source=join(folder,'million.png'),output=join(folder,'result.png'),temporary=join(folder,'pending.png');
  await sharp({create:{width:1000,height:1000,channels:3,background:'#5588bb'}}).png().toFile(source);
  let maximumRss=process.memoryUsage().rss,completed=0;const timer=setInterval(()=>{maximumRss=Math.max(maximumRss,process.memoryUsage().rss);},100);
  const started=Date.now();
  try{
   await new Promise((resolve,reject)=>{
    const worker=new Worker(join(__dirname,'../dist/main/image-superres-worker.cjs'),{workerData:{source,output,temporary,model},resourceLimits:{maxOldGenerationSizeMb:192}});
    worker.on('message',message=>{if(message.type==='progress')completed=message.progress.done;else if(message.type==='result')resolve(message.result);else if(message.type==='error')reject(Error(message.message));});
    worker.on('error',reject);worker.on('exit',code=>{if(code)reject(Error('worker exited '+code));});
   });
  }finally{clearInterval(timer);}
  const metadata=await sharp(output).metadata();assert.equal(metadata.width,4000);assert.equal(metadata.height,4000);assert.equal(completed,64);
  console.log('image-superres-limit: 1 MP to 16 MP in '+((Date.now()-started)/1000).toFixed(1)+' s; peak process RSS '+Math.round(maximumRss/1048576)+' MB');
 }finally{await rm(folder,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
