import {parentPort,workerData} from 'node:worker_threads';
import {rename,rm,stat} from 'node:fs/promises';
import sharp from 'sharp';
import * as ort from 'onnxruntime-node';
import {inspectMotionPhoto} from './motion-photo';
import type {ImageAiResult} from '../shared/image-ai';

interface Job {source:string;output:string;temporary:string;model:string}
const job=workerData as Job;
sharp.cache(false);sharp.concurrency(1);

async function removeBackground():Promise<ImageAiResult>{
 const before=(await stat(job.source)).size;if(before>50*1024*1024)throw Error('AI 去背景仅支持 50 MB 以内的静态图片');
 const pipeline=sharp(job.source,{animated:true,limitInputPixels:20_000_000,failOn:'error'}),metadata=await pipeline.metadata();
 if(!['png','jpeg','webp','tiff'].includes(metadata.format||'')||!metadata.width||!metadata.height||!metadata.channels||metadata.width*metadata.height>20_000_000||Math.max(metadata.width,metadata.height)>8192)throw Error('请选择不超过 2000 万像素的 PNG、JPEG、WebP 或 TIFF');
 if((metadata.pages||1)>1)throw Error('AI 去背景仅支持静态单页图片');
 if(metadata.format==='jpeg'&&await inspectMotionPhoto(job.source))throw Error('动态照片包含视频，AI 去背景暂不处理');
 const turned=[5,6,7,8].includes(metadata.orientation||1),width=turned?metadata.height:metadata.width,height=turned?metadata.width:metadata.height;
 const preview=await sharp(job.source,{limitInputPixels:20_000_000}).rotate().flatten({background:'#ffffff'}).resize(320,320,{fit:'fill',kernel:'lanczos3'}).removeAlpha().raw().toBuffer();
 let maximum=1;for(const value of preview)maximum=Math.max(maximum,value);
 const tensor=new Float32Array(3*320*320),mean=[.485,.456,.406],std=[.229,.224,.225];
 for(let index=0;index<320*320;index++)for(let channel=0;channel<3;channel++)tensor[channel*320*320+index]=(preview[index*3+channel]/maximum-mean[channel])/std[channel];
 const session=await ort.InferenceSession.create(job.model,{executionProviders:['cpu'],intraOpNumThreads:2,interOpNumThreads:1,graphOptimizationLevel:'all'});
 let values:Float32Array;
 try{const outputs=await session.run({'input.1':new ort.Tensor('float32',tensor,[1,3,320,320])});values=outputs['1959'].data as Float32Array;}finally{await session.release();}
 let minimum=Infinity,maximumMask=-Infinity;for(const value of values){minimum=Math.min(minimum,value);maximumMask=Math.max(maximumMask,value);}
 const mask=Buffer.alloc(320*320),range=maximumMask-minimum;
 for(let index=0;index<mask.length;index++)mask[index]=range>1e-7?Math.max(0,Math.min(255,Math.round((values[index]-minimum)/range*255))):0;
 const enlarged=await sharp(mask,{raw:{width:320,height:320,channels:1}}).resize(width,height,{fit:'fill',kernel:'lanczos3'}).raw().toBuffer();
 if(metadata.hasAlpha){const original=await sharp(job.source).rotate().extractChannel('alpha').raw().toBuffer();for(let index=0;index<enlarged.length;index++)enlarged[index]=Math.round(enlarged[index]*original[index]/255);}
 try{
  const rgb=await sharp(job.source,{limitInputPixels:20_000_000}).rotate().removeAlpha().raw().toBuffer();
  await sharp(rgb,{raw:{width,height,channels:3}}).joinChannel(enlarged,{raw:{width,height,channels:1}}).png({compressionLevel:9}).toFile(job.temporary);
  const result=await sharp(job.temporary).metadata();if(result.width!==width||result.height!==height||!result.hasAlpha)throw Error(`AI 输出校验失败：${result.width}×${result.height}，alpha=${result.hasAlpha}`);
  await rename(job.temporary,job.output);
  return {source:job.source,output:job.output,before,after:(await stat(job.output)).size,width,height,message:'已使用本地 U²-Net-p 模型生成透明 PNG；细节由模型估计，建议检查边缘'};
 }catch(error){await rm(job.temporary,{force:true}).catch(()=>{});throw error;}
}

void removeBackground().then(result=>parentPort?.postMessage({type:'result',result})).catch(error=>parentPort?.postMessage({type:'error',message:(error as Error).message.slice(0,300)}));
