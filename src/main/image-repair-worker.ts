import {parentPort,workerData} from 'node:worker_threads';
import {rename,rm,stat} from 'node:fs/promises';
import sharp from 'sharp';
import * as ort from 'onnxruntime-node';
import {inspectMotionPhoto} from './motion-photo';
import type {ImageAiResult,ImageRepairMode} from '../shared/image-ai';

interface Job {source:string;output:string;temporary:string;model:string;mask:string;mode?:ImageRepairMode;cancelBuffer:SharedArrayBuffer}
const job=workerData as Job;
const cancelFlag=new Int32Array(job.cancelBuffer);
const checkCancelled=()=>{if(Atomics.load(cancelFlag,0))throw Error('已取消 AI 图片任务');};
sharp.cache(false);sharp.concurrency(1);

async function repair():Promise<ImageAiResult>{
 const before=(await stat(job.source)).size;
 if(before>25*1024*1024)throw Error('AI 修复仅支持 25 MB 以内的静态图片');
 const metadata=await sharp(job.source,{animated:true,limitInputPixels:2_000_000,failOn:'error'}).metadata();
 if(!['png','jpeg','webp','tiff'].includes(metadata.format||'')||!metadata.width||!metadata.height||metadata.width*metadata.height>2_000_000||Math.max(metadata.width,metadata.height)>2048)throw Error('AI 修复仅支持不超过 200 万像素、单边 2048 像素的 PNG、JPEG、WebP 或 TIFF');
 if((metadata.pages||1)>1)throw Error('AI 修复仅支持静态单页图片');
 if(metadata.depth&&metadata.depth!=='uchar')throw Error('AI 修复暂不支持高位深图片，请先转换为 8 位图片');
 if(metadata.format==='jpeg'&&await inspectMotionPhoto(job.source))throw Error('动态照片包含视频，AI 修复暂不处理');
 const turned=[5,6,7,8].includes(metadata.orientation||1),width=turned?metadata.height:metadata.width,height=turned?metadata.width:metadata.height,pixels=width*height;
 checkCancelled();
 const maskBytes=Buffer.from(job.mask.slice('data:image/png;base64,'.length),'base64');
 if(maskBytes.length>1_500_000)throw Error('修复选区太大');
 const maskInfo=await sharp(maskBytes,{limitInputPixels:614_400,failOn:'error'}).metadata();
 if(maskInfo.format!=='png'||!maskInfo.width||!maskInfo.height||maskInfo.width>960||maskInfo.height>640||!maskInfo.hasAlpha||Math.abs(maskInfo.width/maskInfo.height-width/height)>0.02)throw Error('修复选区与图片尺寸不匹配');
 const marked=await sharp(maskBytes,{limitInputPixels:614_400}).extractChannel('alpha').resize(width,height,{kernel:'nearest'}).raw().toBuffer();
 const mask=new Uint8Array(pixels),rgb=new Uint8Array(pixels*3);
 let selected=0;for(let i=0;i<pixels;i++){mask[i]=marked[i]>127?0:255;if(!mask[i])selected++;}
 if(selected<10)throw Error('请先在图片上涂抹要修复的区域');
 if(selected>pixels*0.4)throw Error('选区超过图片的 40%，请缩小修复范围');
 checkCancelled();
 const original=await sharp(job.source,{limitInputPixels:2_000_000}).rotate().toColourspace('srgb').ensureAlpha().raw().toBuffer();
 const flattened=await sharp(job.source,{limitInputPixels:2_000_000}).rotate().toColourspace('srgb').flatten({background:'#ffffff'}).removeAlpha().raw().toBuffer();
 if(flattened.length!==pixels*3||original.length!==pixels*4)throw Error('图片像素解码尺寸异常');
 for(let i=0;i<pixels;i++)for(let channel=0;channel<3;channel++)rgb[channel*pixels+i]=flattened[i*3+channel];
 checkCancelled();
 const session=await ort.InferenceSession.create(job.model,{executionProviders:['cpu'],intraOpNumThreads:2,interOpNumThreads:1,graphOptimizationLevel:'all'});
 let result:ort.Tensor;
 try{
  checkCancelled();
  parentPort?.postMessage({type:'progress',progress:{phase:'process',message:'正在本地填补选区'}});
  const outputs=await session.run({image:new ort.Tensor('uint8',rgb,[1,3,height,width]),mask:new ort.Tensor('uint8',mask,[1,1,height,width])});
  checkCancelled();
  result=outputs.result;
  if(!result||result.type!=='uint8'||result.dims.join(',')!==[1,3,height,width].join(','))throw Error('修复模型返回了错误尺寸');
 }finally{await session.release();}
 checkCancelled();
 const output=Buffer.alloc(pixels*4),values=result.data as Uint8Array;
 for(let i=0;i<pixels;i++){
  if(mask[i]===0){for(let channel=0;channel<3;channel++)output[i*4+channel]=values[channel*pixels+i];output[i*4+3]=255;}
  else original.copy(output,i*4,i*4,i*4+4);
 }
 try{
  await sharp(output,{raw:{width,height,channels:4}}).png({compressionLevel:9}).toFile(job.temporary);
  const saved=await sharp(job.temporary).metadata();
  if(saved.width!==width||saved.height!==height)throw Error('AI 修复输出校验失败');
  checkCancelled();
  await rename(job.temporary,job.output);
  return {source:job.source,output:job.output,before,after:(await stat(job.output)).size,width,height,message:job.mode==='remove'?'物体已移除；请检查边缘和纹理':'选区已修复；请检查细节'};
 }catch(error){await rm(job.temporary,{force:true}).catch(()=>{});throw error;}
}

void repair().then(result=>parentPort?.postMessage({type:'result',result})).catch(error=>parentPort?.postMessage({type:'error',message:(error as Error).message.slice(0,300)}));
