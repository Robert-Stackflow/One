import {parentPort,workerData} from 'node:worker_threads';
import {rename,rm,stat} from 'node:fs/promises';
import sharp from 'sharp';
import type {ImageConvertOptions,ImageConvertResult} from '../shared/image-convert';

interface Entry {source:string;output:string;temp:string}
const {entries,options}=workerData as {entries:Entry[];options:ImageConvertOptions};
sharp.cache(false);sharp.concurrency(1);

async function convert(entry:Entry):Promise<ImageConvertResult>{
 let before=0;
 try{
  before=(await stat(entry.source)).size;
  if(before>100*1024*1024)throw Error('单张图片超过 100 MB 上限');
  let pipeline=sharp(entry.source,{animated:true,limitInputPixels:50_000_000,failOn:'error'});
  const metadata=await pipeline.metadata(),pages=metadata.pages||1;
  if(!metadata.width||!metadata.height||metadata.width*(metadata.pageHeight||metadata.height)*pages>100_000_000)throw Error('图片像素或总帧数超过处理上限');
  if(!['png','jpeg','webp','gif','tiff'].includes(metadata.format||''))throw Error('暂不支持该图片编码');
  if(pages>1&&metadata.format==='png')throw Error('动画 PNG 尚未验证转换，原文件未修改');
  if(pages>1&&!['gif','webp','tiff'].includes(options.format))throw Error('目标格式不能保留动画或多页内容，请选择 GIF、WebP 或 TIFF');
  pipeline=pipeline.rotate();
  if(options.maxWidth||options.maxHeight)pipeline=pipeline.resize({width:options.maxWidth,height:options.maxHeight,fit:'inside',withoutEnlargement:true});
  if(options.preserveMetadata)pipeline=pipeline.withMetadata();
  switch(options.format){
   case 'png':pipeline=pipeline.png({compressionLevel:9});break;
   case 'jpeg':pipeline=pipeline.flatten({background:'#ffffff'}).jpeg({quality:options.quality,mozjpeg:true});break;
   case 'webp':pipeline=pipeline.webp({quality:options.quality,effort:4,loop:metadata.loop||0,delay:metadata.delay});break;
   case 'gif':pipeline=pipeline.gif({effort:5,keepDuplicateFrames:true,loop:metadata.loop||0,delay:metadata.delay});break;
   case 'tiff':pipeline=pipeline.tiff({quality:options.quality,compression:'lzw'});break;
  }
  await pipeline.toFile(entry.temp);
  if(pages>1){const output=await sharp(entry.temp,{animated:true}).metadata();if((output.pages||1)!==pages)throw Error('输出未能保留全部动画帧或 TIFF 页面');}
  await rename(entry.temp,entry.output);
  const after=(await stat(entry.output)).size;
  return {source:entry.source,output:entry.output,before,after,status:'done',message:options.format==='jpeg'&&metadata.hasAlpha?'透明区域已填充白色':undefined};
 }catch(error){await rm(entry.temp,{force:true}).catch(()=>{});return {source:entry.source,before,status:'error',message:(error as Error).message.slice(0,300)};}
}

void(async()=>{for(const entry of entries){parentPort!.postMessage({type:'current',source:entry.source});parentPort!.postMessage({type:'result',result:await convert(entry)});}parentPort!.postMessage({type:'complete'});})().catch(error=>parentPort!.postMessage({type:'fatal',message:(error as Error).message.slice(0,300)}));
