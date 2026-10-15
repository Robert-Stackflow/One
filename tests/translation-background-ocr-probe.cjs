// Offline quality gate. Real OCR produces inference masks; font alpha is used only for scoring.
// This candidate does not enable automatic MI-GAN repair in the product.
const {Worker}=require('node:worker_threads');
const {createHash}=require('node:crypto');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),sharp=require('sharp');
const width=512,height=320,pixels=width*height;
const hash=value=>createHash('sha256').update(value).digest('hex');
async function workerResult(file,data,accept,timeout=90000){
  const worker=new Worker(file,{workerData:data,resourceLimits:{maxOldGenerationSizeMb:256}});
  let timer;
  try{return await new Promise((resolve,reject)=>{
    timer=setTimeout(()=>reject(Error('Local quality probe worker timed out')),timeout);
    worker.on('message',message=>{try{const value=accept(message);if(value!==undefined)resolve(value);}catch(error){reject(error);}});
    worker.once('error',reject);worker.once('exit',code=>reject(Error('Quality probe worker exited before its result: '+code)));
  });}finally{clearTimeout(timer);await worker.terminate();}
}
function dilate(mask,radius){
  const result=new Uint8Array(pixels);
  for(let at=0;at<pixels;at++)if(mask[at]){
    const x=at%width,y=Math.floor(at/width);
    for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++)if(x+dx>=0&&x+dx<width&&y+dy>=0&&y+dy<height)result[(y+dy)*width+x+dx]=1;
  }
  return result;
}
function otsu(histogram,total){
  let sum=0,weight=0,part=0,best=-1,threshold=0;
  for(let i=0;i<256;i++)sum+=i*histogram[i];
  for(let i=0;i<255;i++){
    weight+=histogram[i];if(!weight)continue;if(weight===total)break;part+=i*histogram[i];
    const distance=part/weight-(sum-part)/(total-weight),variance=weight*(total-weight)*distance*distance;
    if(variance>best){best=variance;threshold=i;}
  }
  return threshold;
}
function ocrMask(rgba,words){
  const mask=new Uint8Array(pixels);let symbols=0,rejected=0;
  const luminance=at=>Math.round(rgba[at*4]*.299+rgba[at*4+1]*.587+rgba[at*4+2]*.114);
  for(const word of words)for(const glyph of word.symbols?.length?word.symbols:[word]){
    if(!glyph.text.trim())continue;symbols++;
    const x=Math.max(0,Math.floor(glyph.x)),y=Math.max(0,Math.floor(glyph.y)),right=Math.min(width,Math.ceil(glyph.x+glyph.width)),bottom=Math.min(height,Math.ceil(glyph.y+glyph.height));
    if(right<=x||bottom<=y||glyph.confidence<30){rejected++;continue;}
    const histogram=new Uint32Array(256),border=[];let total=0,min=255,max=0;
    for(let yy=Math.max(0,y-2);yy<Math.min(height,bottom+2);yy++)for(let xx=Math.max(0,x-2);xx<Math.min(width,right+2);xx++){
      const at=yy*width+xx;if(rgba[at*4+3]<250)continue;const value=luminance(at);histogram[value]++;total++;min=Math.min(min,value);max=Math.max(max,value);
      if(xx<x||xx>=right||yy<y||yy>=bottom)border.push(value);
    }
    if(!total||max-min<24||!border.length){rejected++;continue;}
    const threshold=otsu(histogram,total);border.sort((a,b)=>a-b);const dark=border[Math.floor(border.length/2)]>threshold;
    const local=new Uint8Array((right-x)*(bottom-y)),queue=new Uint32Array(local.length),w=right-x,h=bottom-y;
    for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++){
      const at=(y+yy)*width+x+xx;if(rgba[at*4+3]>=250&&(dark?luminance(at)<=threshold:luminance(at)>threshold))local[yy*w+xx]=1;
    }
    for(let start=0;start<local.length;start++)if(local[start]===1){
      let head=0,count=1,minX=w,maxX=0,minY=h,maxY=0;queue[0]=start;local[start]=2;
      while(head<count){const at=queue[head++],xx=at%w,yy=Math.floor(at/w);minX=Math.min(minX,xx);maxX=Math.max(maxX,xx);minY=Math.min(minY,yy);maxY=Math.max(maxY,yy);
        for(const next of [xx?at-1:-1,xx+1<w?at+1:-1,yy?at-w:-1,yy+1<h?at+w:-1])if(next>=0&&local[next]===1){local[next]=2;queue[count++]=next;}}
      if(maxX-minX+1>12*(maxY-minY+1)&&h>3*(maxY-minY+1))continue;
      for(let i=0;i<count;i++){const at=queue[i];mask[(y+Math.floor(at/w))*width+x+at%w]=1;}
    }
  }
  return {core:mask,merge:dilate(mask,1),inference:dilate(mask,4),symbols,rejected};
}
async function main(){
  const model=path.resolve(process.argv[2]||'work/current/migan-probe/migan_pipeline_v2.onnx'),folder=path.resolve('work/current/translation-background-ocr-eval');await fs.mkdir(folder,{recursive:true});
  const modelHash=hash(await fs.readFile(model));assert.equal(modelHash,'6f1f3530a1a2324b19752018ce756088b07973cda8d7d890034ace5c8a48c40b');
  const packs=await Promise.all(['chi_sim','eng'].map(async code=>({code,data:await fs.readFile(path.resolve('work/current/fixtures/recognition-models',code+'.traineddata'))})));
  const report={schema:1,synthetic:true,candidateOnly:true,modelHash,backend:'cpu',ocr:'real bundled Tesseract chi_sim+eng with symbol boxes',mask:'per-glyph Otsu; polarity from surrounding pixels; reject confidence <30; preserve long thin components; infer +4px, merge +1px',groundTruth:'independent clean background and font alpha, used only for scoring',cases:[]};
  const scenes={flat:'<rect width="100%" height="100%" fill="#f4f4f4"/>',gradient:'<defs><linearGradient id="bg"><stop stop-color="#e5e5b0"/><stop offset="1" stop-color="#a8c8f0"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#bg)"/>',texture:'<defs><pattern id="bg" width="32" height="24" patternUnits="userSpaceOnUse"><rect width="32" height="24" fill="#d4b894"/><path d="M0 4 Q12 19 32 5 M0 18 Q20 2 32 19" stroke="#a98c6c" fill="none" stroke-width="2"/></pattern></defs><rect width="100%" height="100%" fill="url(#bg)"/>',lines:'<rect width="100%" height="100%" fill="#eeeeee"/><path d="M0 153 H512 M110 0 V320" stroke="#787878" stroke-width="2"/><rect x="125" y="130" width="75" height="55" fill="#7cb0c4"/>'};
  for(const [scene,background] of Object.entries(scenes))for(const fontSize of [12,18,28])for(const light of [false,true]){
    const name=scene+'-'+fontSize+(light?'-light':'-dark'),sourcePath=path.join(folder,name+'-source.png'),repairPath=path.join(folder,name+'-repair.png');
    const base=await sharp(Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${background}<rect x="430" y="30" width="40" height="70" fill="#ff4040"/></svg>`)).ensureAlpha().raw().toBuffer();
    const clean=Buffer.from(base);if(light)for(let i=0;i<pixels;i++)for(let c=0;c<3;c++)clean[i*4+c]=255-clean[i*4+c];
    const cleanHash=hash(clean),alpha=await sharp(Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><text x="72" y="160" font-family="Arial,Microsoft YaHei" font-size="${fontSize}" fill="${light?'#eeeeee':'#111111'}">OCR 文本 2026</text></svg>`)).ensureAlpha().raw().toBuffer();
    const original=Buffer.from(clean),truth=new Uint8Array(pixels);
    for(let i=0;i<pixels;i++){const opacity=alpha[i*4+3]/255;for(let c=0;c<3;c++)original[i*4+c]=Math.round(alpha[i*4+c]*opacity+clean[i*4+c]*(1-opacity));if(alpha[i*4+3]>16)truth[i]=1;}
    const png=await sharp(original,{raw:{width,height,channels:4}}).png().toBuffer();await fs.writeFile(sourcePath,png);
    const ocr=await workerResult(path.resolve('dist/main/recognition/ocr-worker.cjs'),{png,width,height,language:'chi_sim+eng',packs},message=>{if(message.ok===false)throw Error(message.error);return message.ok===true?message.result:undefined;});
    const masks=ocrMask(original,ocr.words),selected=masks.inference.reduce((sum,value)=>sum+value,0),maskPixels=Buffer.alloc(pixels*4);for(let i=0;i<pixels;i++)if(masks.inference[i])maskPixels.set([255,255,255,255],i*4);
    let repaired=original,elapsedMs=0,skipped='';
    if(selected<10||selected>pixels*.4)skipped='OCR mask is empty or exceeds repair capacity';
    else{
      const mask=await sharp(maskPixels,{raw:{width,height,channels:4}}).png().toBuffer(),start=Date.now();
      await workerResult(path.resolve('dist/main/image-repair-worker.cjs'),{source:sourcePath,output:repairPath,temporary:repairPath+'.part.png',model,mask:'data:image/png;base64,'+mask.toString('base64'),mode:'remove',cancelBuffer:new SharedArrayBuffer(4)},message=>{if(message.type==='error')throw Error(message.message);return message.type==='result'?message.result:undefined;});
      elapsedMs=Date.now()-start;repaired=await sharp(repairPath).ensureAlpha().raw().toBuffer();
    }
    const merged=Buffer.from(original);let ink=0,covered=0,mergePixels=0,nonText=0,error=0,baselineError=0,outsideInference=0,outsideMerge=0,knownBackground=0,backgroundError=0,changedBackground=0;
    for(let i=0;i<pixels;i++){
      if(masks.merge[i]){mergePixels++;repaired.copy(merged,i*4,i*4,i*4+4);if(!truth[i])nonText++;}
      if(truth[i]){ink++;if(masks.merge[i])covered++;for(let c=0;c<3;c++){error+=Math.abs(merged[i*4+c]-clean[i*4+c]);baselineError+=Math.abs(original[i*4+c]-clean[i*4+c]);}}
      if(!masks.inference[i]&&!repaired.subarray(i*4,i*4+4).equals(original.subarray(i*4,i*4+4)))outsideInference++;
      if(!masks.merge[i]&&!merged.subarray(i*4,i*4+4).equals(original.subarray(i*4,i*4+4)))outsideMerge++;
      if(masks.merge[i]&&alpha[i*4+3]===0){knownBackground++;let difference=0;for(let c=0;c<3;c++)difference+=Math.abs(merged[i*4+c]-clean[i*4+c]);backgroundError+=difference;if(difference>0)changedBackground++;}
    }
    assert.equal(hash(clean),cleanHash,'Ground truth must remain immutable');assert.equal(outsideInference,0);assert.equal(outsideMerge,0);
    await sharp(merged,{raw:{width,height,channels:4}}).png().toFile(path.join(folder,name+'-merged.png'));await sharp(clean,{raw:{width,height,channels:4}}).png().toFile(path.join(folder,name+'-truth.png'));await fs.writeFile(path.join(folder,name+'-mask.png'),await sharp(maskPixels,{raw:{width,height,channels:4}}).png().toBuffer());
    const entry={scene,fontSize,light,sourceHash:hash(png),cleanHash,ocrText:ocr.text.trim(),recognitionExact:ocr.text.replace(/\s/g,'')==='OCR文本2026',symbols:masks.symbols,rejectedSymbols:masks.rejected,inferencePixels:selected,mergePixels,inkPixels:ink,inkRecall:ink?Number((covered/ink).toFixed(4)):0,nonTextMergeRatio:mergePixels?Number((nonText/mergePixels).toFixed(4)):0,inkMAE:Number((error/Math.max(1,ink*3)).toFixed(3)),baselineInkMAE:Number((baselineError/Math.max(1,ink*3)).toFixed(3)),knownBackground,changedBackground,backgroundMAE:knownBackground?Number((backgroundError/(knownBackground*3)).toFixed(3)):0,outsideInference,outsideMerge,elapsedMs,...(skipped?{skipped}:{})};
    entry.sampleGate=!skipped&&entry.recognitionExact&&entry.inkRecall>=.98&&entry.inkMAE<=3&&entry.backgroundMAE<=1.5;report.cases.push(entry);
    await fs.writeFile(path.join(folder,'report.json'),JSON.stringify(report,null,2));console.log(name+': glyphs '+entry.symbols+', recall '+entry.inkRecall+', ink MAE '+entry.inkMAE+', outside '+outsideMerge+(skipped?' (skipped)':''));
  }
  assert.equal(report.cases.length,24);assert.ok(report.cases.some(entry=>entry.symbols>0));
  report.sampleGate='per-sample check only: exact OCR, ink recall >=98%, ink MAE <=3, known-background merge MAE <=1.5; passing synthetic samples never enables product repair';
  report.passingCases=report.cases.filter(entry=>entry.sampleGate).length;await fs.writeFile(path.join(folder,'report.json'),JSON.stringify(report,null,2));
  console.log('Actual OCR mask evaluation complete: '+report.passingCases+'/24 sample gates passed; no remote requests or model downloads; report remains local.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
