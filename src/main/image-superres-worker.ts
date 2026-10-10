import {parentPort,workerData} from 'node:worker_threads';
import {rename,rm,stat} from 'node:fs/promises';
import sharp from 'sharp';
import * as ort from 'onnxruntime-node';
import {inspectMotionPhoto} from './motion-photo';
import {upscaleRgbTiles} from './image-superres-tiles';
import type {ImageAiResult} from '../shared/image-ai';

interface Job {source:string;output:string;temporary:string;model:string}
const job=workerData as Job;
let cancelled=false;
const onCancel=(message:{type?:string})=>{if(message?.type==='cancel')cancelled=true;};
parentPort?.on('message',onCancel);
sharp.cache(false);sharp.concurrency(1);

async function superResolve():Promise<ImageAiResult>{
 const before=(await stat(job.source)).size;
 if(before>30*1024*1024)throw Error('AI 超分仅支持 30 MB 以内的静态图片');
 const metadata=await sharp(job.source,{animated:true,limitInputPixels:1_000_000,failOn:'error'}).metadata();
 if(!['png','jpeg','webp','tiff'].includes(metadata.format||'')||!metadata.width||!metadata.height||metadata.width*metadata.height>1_000_000||Math.max(metadata.width,metadata.height)>2048)throw Error('AI 超分仅支持不超过 100 万像素、单边 2048 像素的 PNG、JPEG、WebP 或 TIFF');
 if((metadata.pages||1)>1)throw Error('AI 超分仅支持静态单页图片');
 if(metadata.format==='jpeg'&&await inspectMotionPhoto(job.source))throw Error('动态照片包含视频，AI 超分暂不处理');
 const turned=[5,6,7,8].includes(metadata.orientation||1),width=turned?metadata.height:metadata.width,height=turned?metadata.width:metadata.height;
 const rgb=await sharp(job.source,{limitInputPixels:1_000_000}).rotate().flatten({background:'#ffffff'}).removeAlpha().raw().toBuffer();
 const session=await ort.InferenceSession.create(job.model,{executionProviders:['cpu'],intraOpNumThreads:2,interOpNumThreads:1,graphOptimizationLevel:'all'});
 let enlarged:Buffer;
 try{
  enlarged=await upscaleRgbTiles(rgb,width,height,async(input,tileWidth,tileHeight)=>{
   if(cancelled)throw Error('已取消 AI 图片任务');
   const outputs=await session.run({input:new ort.Tensor('float32',input,[1,3,tileHeight,tileWidth])}),tensor=outputs.output;
   if(cancelled)throw Error('已取消 AI 图片任务');
   if(!tensor||tensor.type!=='float32'||tensor.dims.join(',')!==[1,3,tileHeight*4,tileWidth*4].join(','))throw Error('超分模型返回了错误尺寸');
   return tensor.data as Float32Array;
  },progress=>parentPort?.postMessage({type:'progress',progress:{phase:'process',done:progress.done,total:progress.total,message:'正在本地超分'}}));
 }finally{await session.release();}
 const outputWidth=width*4,outputHeight=height*4;
 if(cancelled)throw Error('已取消 AI 图片任务');
 try{
  let pipeline=sharp(enlarged,{raw:{width:outputWidth,height:outputHeight,channels:3}});
  if(metadata.hasAlpha){
   const alpha=await sharp(job.source,{limitInputPixels:1_000_000}).rotate().extractChannel('alpha').resize(outputWidth,outputHeight,{fit:'fill',kernel:'lanczos3'}).raw().toBuffer();
   pipeline=pipeline.joinChannel(alpha,{raw:{width:outputWidth,height:outputHeight,channels:1}});
  }
  await pipeline.png({compressionLevel:9}).toFile(job.temporary);
  const result=await sharp(job.temporary).metadata();
  if(result.width!==outputWidth||result.height!==outputHeight)throw Error('AI 超分输出校验失败');
  if(cancelled)throw Error('已取消 AI 图片任务');
  await rename(job.temporary,job.output);
  return {source:job.source,output:job.output,before,after:(await stat(job.output)).size,width:outputWidth,height:outputHeight,message:'已使用本地 Real-ESRGAN 模型生成 4× PNG；细节由模型推测，请检查结果'};
 }catch(error){await rm(job.temporary,{force:true}).catch(()=>{});throw error;}
}

void superResolve().then(result=>parentPort?.postMessage({type:'result',result})).catch(error=>parentPort?.postMessage({type:'error',message:(error as Error).message.slice(0,300)})).finally(()=>parentPort?.removeListener('message',onCancel));
