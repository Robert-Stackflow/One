// Optional local MI-GAN quality probe; it never downloads weights or sends screenshots to a service.
const {Worker}=require('node:worker_threads'),{createHash}=require('node:crypto');
const fs=require('node:fs/promises'),path=require('node:path'),sharp=require('sharp');
const assert=require('node:assert/strict');
const width=512,height=320,pixels=width*height;
async function run(workerPath,source,mask,output,model){
  const worker=new Worker(workerPath,{workerData:{source,output,temporary:output+'.part.png',model,mask,mode:'remove',cancelBuffer:new SharedArrayBuffer(4)},resourceLimits:{maxOldGenerationSizeMb:256}});
  try{return await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('MI-GAN probe timed out')),90000);worker.on('message',message=>{if(message.type==='result'){clearTimeout(timer);resolve(message.result);}else if(message.type==='error'){clearTimeout(timer);reject(Error(message.message));}});worker.once('error',error=>{clearTimeout(timer);reject(error);});worker.once('exit',code=>{clearTimeout(timer);reject(Error('MI-GAN worker exit '+code));});});}finally{await worker.terminate();}
}
async function main(){
  const dilation=Number(process.argv[3]||1);if(!Number.isSafeInteger(dilation)||dilation<1||dilation>8)throw Error('Dilation must be between 1 and 8');
  const model=path.resolve(process.argv[2]||'work/current/migan-probe/migan_pipeline_v2.onnx'),workerPath=path.resolve('dist/main/image-repair-worker.cjs'),folder=path.resolve('work/current/translation-background-eval'+(dilation===1?'':'-d'+dilation));await fs.mkdir(folder,{recursive:true});
  const hash=createHash('sha256').update(await fs.readFile(model)).digest('hex');if(hash!=='6f1f3530a1a2324b19752018ce756088b07973cda8d7d890034ace5c8a48c40b')throw Error('MI-GAN weight hash differs from the pinned model');
  const scenes={
    flat:'<rect width="100%" height="100%" fill="#f4f4f4"/>',
    gradient:'<defs><linearGradient id="bg"><stop stop-color="#e5e5b0"/><stop offset="1" stop-color="#a8c8f0"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#bg)"/>',
    texture:'<defs><pattern id="bg" width="32" height="24" patternUnits="userSpaceOnUse"><rect width="32" height="24" fill="#d4b894"/><path d="M0 4 Q12 19 32 5 M0 18 Q20 2 32 19" stroke="#a98c6c" fill="none" stroke-width="2"/></pattern></defs><rect width="100%" height="100%" fill="url(#bg)"/>',
    lines:'<rect width="100%" height="100%" fill="#eeeeee"/><path d="M0 153 H512 M110 0 V320" stroke="#787878" stroke-width="2"/><rect x="125" y="130" width="75" height="55" fill="#7cb0c4"/>',
  };
  const report={modelHash:hash,backend:'cpu',inferenceDilation:dilation,mask:'ideal glyph alpha plus 1px evaluation mask; predictions merged only into this mask; real OCR segmentation is not evaluated',synthetic:true,cases:[]};
  for(const [name,background] of Object.entries(scenes))for(const fontSize of [12,18,28]){
    const stem=name+'-'+fontSize,source=path.join(folder,stem+'-source.png'),truthPath=path.join(folder,stem+'-truth.png'),output=path.join(folder,stem+'-repaired.png');
    const clean=await sharp(Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${background}<rect x="430" y="30" width="40" height="70" fill="#ff4040"/></svg>`)).ensureAlpha().raw().toBuffer();
    const cleanHash=createHash('sha256').update(clean).digest('hex');
    const text=await sharp(Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><text x="72" y="160" font-family="Arial,Microsoft YaHei" font-size="${fontSize}" fill="#111111">OCR 文本 2026</text></svg>`)).ensureAlpha().raw().toBuffer(),original=Buffer.from(clean),selected=new Uint8Array(pixels),evaluationMask=new Uint8Array(pixels);
    for(let i=0;i<pixels;i++){const alpha=text[i*4+3]/255;for(let channel=0;channel<3;channel++)original[i*4+channel]=Math.round(text[i*4+channel]*alpha+clean[i*4+channel]*(1-alpha));
      if(text[i*4+3]>2){const x=i%width,y=Math.floor(i/width);for(let dy=-dilation;dy<=dilation;dy++)for(let dx=-dilation;dx<=dilation;dx++)if(x+dx>=0&&x+dx<width&&y+dy>=0&&y+dy<height){selected[(y+dy)*width+x+dx]=1;if(Math.abs(dx)<=1&&Math.abs(dy)<=1)evaluationMask[(y+dy)*width+x+dx]=1;}}}
    assert.equal(createHash('sha256').update(clean).digest('hex'),cleanHash,'Ground truth must stay immutable');assert.notDeepEqual(original,clean);
    const maskPixels=Buffer.alloc(pixels*4);for(let i=0;i<pixels;i++)if(selected[i])maskPixels.set([255,255,255,255],i*4);
    const mask=await sharp(maskPixels,{raw:{width,height,channels:4}}).png().toBuffer();await sharp(clean,{raw:{width,height,channels:4}}).png().toFile(truthPath);await sharp(original,{raw:{width,height,channels:4}}).png().toFile(source);
    const start=Date.now();await run(workerPath,source,'data:image/png;base64,'+mask.toString('base64'),output,model);const repaired=await sharp(output).ensureAlpha().raw().toBuffer();
    let count=0,error=0,squared=0,changedOutside=0,maxError=0;const merged=Buffer.from(original);
    for(let i=0;i<pixels;i++){if(evaluationMask[i]){count++;repaired.copy(merged,i*4,i*4,i*4+4);for(let channel=0;channel<3;channel++){const difference=Math.abs(repaired[i*4+channel]-clean[i*4+channel]);error+=difference;squared+=difference*difference;maxError=Math.max(maxError,difference);}}if(!selected[i]&&repaired.subarray(i*4,i*4+4).some((value,channel)=>value!==original[i*4+channel]))changedOutside++;}
    await sharp(merged,{raw:{width,height,channels:4}}).png().toFile(path.join(folder,stem+'-merged.png'));
    const entry={scene:name,fontSize,selectedPixels:count,mae:Number((error/(count*3)).toFixed(3)),psnr:Number((10*Math.log10(255*255/(squared/(count*3)))).toFixed(2)),maxError,changedOutside,elapsedMs:Date.now()-start};report.cases.push(entry);await fs.writeFile(path.join(folder,'report.json'),JSON.stringify(report,null,2));console.log(stem+': MAE '+entry.mae+', outside changes '+changedOutside);
    if(changedOutside)throw Error('Unmasked source pixels changed');
  }
  console.log('MI-GAN small-text probe completed: '+report.cases.length+' synthetic cases; report saved locally.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
