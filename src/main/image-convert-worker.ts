import {parentPort,workerData} from 'node:worker_threads';
import {rename,rm,stat,writeFile} from 'node:fs/promises';
import sharp from 'sharp';
import {optimize} from 'svgo';
import {encodeIco,icoSizes} from './image-ico';
import {readSafeSvg,validateSvg} from './image-svg';
import {inspectMotionPhoto} from './motion-photo';
import {imageCropBounds,imageResizeDimensions,type ImageConvertOptions,type ImageConvertResult} from '../shared/image-convert';

interface Entry {source:string;output:string;temp:string}
const {entries,options}=workerData as {entries:Entry[];options:ImageConvertOptions};
sharp.cache(false);sharp.concurrency(1);

async function convert(entry:Entry):Promise<ImageConvertResult>{
 let before=0;
 try{
  before=(await stat(entry.source)).size;
  if(before>100*1024*1024)throw Error('单张图片超过 100 MB 上限');
  const svg=entry.source.toLowerCase().endsWith('.svg')?await readSafeSvg(entry.source):undefined,input=svg?Buffer.from(svg):entry.source;
  let pipeline=sharp(input,{animated:true,limitInputPixels:50_000_000,failOn:'error'});
  const metadata=await pipeline.metadata(),pages=metadata.pages||1;
  if(!metadata.width||!metadata.height||metadata.width*(metadata.pageHeight||metadata.height)*pages>100_000_000)throw Error('图片像素或总帧数超过处理上限');
  if(!['png','jpeg','webp','gif','tiff','svg'].includes(metadata.format||''))throw Error('暂不支持该图片编码');
  if(metadata.format==='svg'&&!svg)throw Error('SVG 文件扩展名与实际编码不一致');
  let motionStill=false;if(metadata.format==='jpeg'){
   let motionNotice='';const motion=await inspectMotionPhoto(entry.source,message=>{motionNotice=message;});
   if(motion||motionNotice){if(options.motionPolicy!=='still')throw Error('检测到动态照片；勾选“仅导出静态照片”后再转换，视频不会写入结果');motionStill=true;}
  }
  if(pages>1&&metadata.format==='png')throw Error('动画 PNG 尚未验证转换，原文件未修改');
  if(options.crop&&pages>1)throw Error('裁剪暂不支持动图或多页图片，原文件未修改');
  if(options.enhance&&pages>1)throw Error('画质优化暂不支持动图或多页图片，原文件未修改');
  const target=options.format==='original'?metadata.format:options.format;
  if(options.compressionMode==='lossless'&&!['png','webp','tiff'].includes(target))throw Error('此格式不支持无损像素优化，请改选 PNG、WebP 或 TIFF');
  if(options.format==='original'){const suffix=entry.output.split('.').pop()?.toLowerCase(),expected=metadata.format==='jpeg'?['jpg','jpeg']:metadata.format==='tiff'?['tif','tiff']:[metadata.format];if(!suffix||!expected.includes(suffix))throw Error('扩展名与实际图片格式不一致，请选择明确的目标格式转换');}
  if(pages>1&&!['gif','webp','tiff'].includes(target))throw Error('目标格式不能保留动画或多页内容，请选择 GIF、WebP 或 TIFF');
  if(target==='svg'){
   if(!svg)throw Error('位图不能直接恢复成 SVG 矢量，请选择 PNG、JPEG、WebP 等输出格式');
   const optimized=validateSvg(optimize(svg,{multipass:true}).data);await writeFile(entry.temp,optimized,'utf8');
   const output=await sharp(Buffer.from(optimized),{limitInputPixels:50_000_000}).metadata();if(!output.width||!output.height||output.width*output.height>50_000_000)throw Error('优化后的 SVG 尺寸无效');
   await rename(entry.temp,entry.output);return {source:entry.source,output:entry.output,before,after:Buffer.byteLength(optimized),width:output.width,height:output.height,pages:1,status:'done',message:Buffer.byteLength(optimized)>before?'优化结果比原文件大':'已优化矢量结构'};
  }
  if(target==='ico'){
   await writeFile(entry.temp,await encodeIco(input));
   const output=await stat(entry.temp);if(output.size<6||output.size>50*1024*1024)throw Error('ICO 输出大小无效');
   await rename(entry.temp,entry.output);
   return {source:entry.source,output:entry.output,before,after:output.size,width:256,height:256,pages:icoSizes.length,status:'done',message:motionStill?'已仅导出静态图标；动态视频未写入结果':'已生成 16、24、32、48、64、128、256 像素图标'};
  }
  pipeline=pipeline.rotate();
  if(options.crop){const swapped=[5,6,7,8].includes(metadata.orientation||1),width=swapped?metadata.height:metadata.width,height=swapped?metadata.width:metadata.height;pipeline=pipeline.extract(imageCropBounds(options.crop,width,height));}
  if(options.resize){const swapped=[5,6,7,8].includes(metadata.orientation||1),width=swapped?(metadata.pageHeight||metadata.height):metadata.width,height=swapped?metadata.width:(metadata.pageHeight||metadata.height),size=imageResizeDimensions(options.resize,width,height);if(size.width*size.height*pages>100_000_000)throw Error('缩放结果的总像素超过 1 亿上限');pipeline=pipeline.resize({width:size.width,height:size.height,fit:'fill'});}
  if(options.maxWidth||options.maxHeight)pipeline=pipeline.resize({width:options.maxWidth,height:options.maxHeight,fit:'inside',withoutEnlargement:true});
  if(options.enhance){const enhance=options.enhance;if(enhance.denoise)pipeline=pipeline.median(3);if(enhance.contrast)pipeline=pipeline.normalise({lower:1,upper:99});if(enhance.brightness!==1||enhance.saturation!==1)pipeline=pipeline.modulate({brightness:enhance.brightness,saturation:enhance.saturation});if(enhance.sharpen===1)pipeline=pipeline.sharpen();else if(enhance.sharpen===2)pipeline=pipeline.sharpen({sigma:2,m1:0,m2:3});}
  if(options.metadataPolicy==='all')pipeline=pipeline.keepMetadata();else if(options.metadataPolicy==='color')pipeline=pipeline.keepIccProfile();
  switch(target){
   case 'png':pipeline=pipeline.png({compressionLevel:9});break;
   case 'jpeg':pipeline=pipeline.flatten({background:'#ffffff'}).jpeg({quality:options.quality,mozjpeg:true});break;
   case 'webp':pipeline=pipeline.webp({quality:options.quality,lossless:options.compressionMode==='lossless',effort:options.compressionMode==='lossless'?6:4,loop:metadata.loop||0,delay:metadata.delay});break;
   case 'gif':pipeline=pipeline.gif({effort:5,keepDuplicateFrames:true,loop:metadata.loop||0,delay:metadata.delay});break;
   case 'tiff':pipeline=pipeline.tiff({quality:options.quality,compression:'lzw'});break;
  }
  await pipeline.toFile(entry.temp);
  const output=await sharp(entry.temp,{animated:true}).metadata();if(pages>1&&(output.pages||1)!==pages)throw Error('输出未能保留全部动画帧或 TIFF 页面');
  await rename(entry.temp,entry.output);
  const after=(await stat(entry.output)).size;
  const messages:string[]=[];if(motionStill)messages.push('已仅导出静态照片，动态视频未写入结果');if(options.enhance)messages.push('已应用画质调整');if(target==='jpeg'&&metadata.hasAlpha)messages.push('透明区域已填充白色');if(after>before)messages.push('输出体积大于原图');
  return {source:entry.source,output:entry.output,before,after,width:output.width,height:output.pageHeight||output.height,pages:output.pages||1,status:'done',message:messages.join('；')||undefined};
 }catch(error){await rm(entry.temp,{force:true}).catch(()=>{});return {source:entry.source,before,status:'error',message:(error as Error).message.slice(0,300)};}
}

void(async()=>{for(const entry of entries){parentPort!.postMessage({type:'current',source:entry.source});parentPort!.postMessage({type:'result',result:await convert(entry)});}parentPort!.postMessage({type:'complete'});})().catch(error=>parentPort!.postMessage({type:'fatal',message:(error as Error).message.slice(0,300)}));
