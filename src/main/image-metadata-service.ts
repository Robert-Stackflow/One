import {spawn, type ChildProcess} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {basename,extname,join,resolve} from 'node:path';
import {copyFile,rename,rm,stat} from 'node:fs/promises';
import sharp from 'sharp';
import {imageMetadataOptions,imageMetadataDiff,type ImageMetadataOptions,type ImageMetadataProgress,type ImageMetadataSummary,type ImageMetadataResult} from '../shared/image-metadata';
import {inspectMotionPhoto} from './motion-photo';

sharp.cache({files:0});
const executable=(require('exiftool-vendored.exe') as string).replace('app.asar\\','app.asar.unpacked\\');
const formats=new Set(['png','jpeg','webp','gif','tiff']);
const tiffStructure=new Set(['ImageWidth','ImageHeight','BitsPerSample','Compression','PhotometricInterpretation','PreviewImageStart','PreviewImageLength','PreviewImage','Orientation','SamplesPerPixel','RowsPerStrip','StripOffsets','StripByteCounts','XResolution','YResolution','PlanarConfiguration','ResolutionUnit','SampleFormat','JPEGTables','ReferenceBlackWhite','Predictor','ExtraSamples','TileWidth','TileLength','TileOffsets','TileByteCounts','SubfileType','NewSubfileType','FillOrder','ColorMap','PageNumber']);
interface Entry {source:string;temp:string;oriented:string;output:string}
interface Session {cancelled:boolean;child?:ChildProcess;task?:Promise<ImageMetadataSummary>}

export class ImageMetadataService{
 private sessions=new Map<number,Session>();
 get pendingTasks(){return this.sessions.size>0;}
 async start(owner:number,paths:unknown,directory:unknown,settings:unknown,notify:(value:ImageMetadataProgress)=>void):Promise<ImageMetadataSummary>{
  if(this.sessions.has(owner))throw Error('已有元数据清理任务正在进行');
  if(!Array.isArray(paths)||paths.length<1||paths.length>100||paths.some(path=>typeof path!=='string'||!path||path.length>32768||path.includes('\0')))throw Error('每次请选择 1 至 100 张图片');
  if(typeof directory!=='string'||!directory||directory.length>32768||directory.includes('\0'))throw Error('输出目录无效');
  const outputDir=resolve(directory),info=await stat(outputDir).catch(()=>null);if(!info?.isDirectory())throw Error('输出目录不存在');
  const options=imageMetadataOptions(settings),unique=new Set((paths as string[]).map(path=>resolve(path).toLowerCase()));if(unique.size!==paths.length)throw Error('图片列表含重复路径');
  const entries=(paths as string[]).map(path=>{const source=resolve(path),id=randomUUID(),extension=extname(source).toLowerCase();if(!['.png','.jpg','.jpeg','.webp','.gif','.tif','.tiff'].includes(extension))throw Error('暂不支持该图片格式');const name=basename(source,extname(source)).slice(0,90)||'image';return {source,temp:join(outputDir,`.one-metadata-${id}.tmp${extension}`),oriented:join(outputDir,`.one-metadata-${id}.oriented${extension}`),output:join(outputDir,`${name}-clean-${id.slice(0,8)}${extension}`)};});
  const session:Session={cancelled:false};this.sessions.set(owner,session);
  const task=this.run(entries,options,session,notify).finally(()=>this.sessions.delete(owner));session.task=task;return task;
 }
 cancel(owner:number){const session=this.sessions.get(owner);if(!session)return false;session.cancelled=true;session.child?.kill();return true;}
 async stopAll(){const tasks=[...this.sessions.values()].map(session=>session.task).filter((task):task is Promise<ImageMetadataSummary>=>!!task);for(const owner of this.sessions.keys())this.cancel(owner);await Promise.all(tasks);}
 private async command(session:Session,args:string[]):Promise<string>{
  if(session.cancelled)throw Error('已取消');
  return new Promise((resolveCommand,reject)=>{
   const child=spawn(executable,['-charset','filename=utf8',...args],{windowsHide:true});session.child=child;let output='',errors='',settled=false;
   const finish=(error?:Error)=>{if(settled)return;settled=true;if(session.child===child)session.child=undefined;clearTimeout(timeout);if(error)reject(error);else resolveCommand(output);};
   const timeout=setTimeout(()=>{child.kill();finish(Error('元数据处理超时'));},30000);
   child.stdout?.on('data',(chunk:Buffer)=>{output+=chunk.toString('utf8');if(output.length>131072){child.kill();finish(Error('元数据输出过大'));}});
   child.stderr?.on('data',(chunk:Buffer)=>{errors=(errors+chunk.toString('utf8')).slice(-2000);});
   child.on('error',error=>finish(error));child.on('close',code=>finish(session.cancelled?Error('已取消'):code===0?undefined:Error((errors||output||`ExifTool 退出码 ${code}`).slice(0,300))));
  });
 }
 private async tags(session:Session,path:string):Promise<Record<string,unknown>>{
  const data=await this.command(session,['-j','-G1','-a','-s','-EXIF:all','-GPS:all','-XMP:all','-IPTC:all',path]);
  const parsed=JSON.parse(data) as Record<string,unknown>[];return parsed[0]||{};
 }
 private async process(entry:Entry,options:ImageMetadataOptions,session:Session):Promise<ImageMetadataResult>{
  let before=0;
  try{
   before=(await stat(entry.source)).size;if(before>100*1024*1024)throw Error('单张图片超过 100 MB 上限');
   const metadata=await sharp(entry.source,{animated:true,limitInputPixels:50_000_000,failOn:'error'}).metadata();if(!formats.has(metadata.format||''))throw Error('暂不支持该图片编码');
   if(metadata.format==='jpeg'){let notice='';const motion=await inspectMotionPhoto(entry.source,message=>{notice=message;});if(motion||notice)throw Error('动态照片暂不支持元数据清理，以免视频或配对关系丢失');}
   const pages=metadata.pages||1;if(!metadata.width||!metadata.height||metadata.width*(metadata.pageHeight||metadata.height)*pages>100_000_000)throw Error('图片像素或总帧数超过处理上限');
   const beforeTags=await this.tags(session,entry.source);
   if(options.removeExif&&metadata.orientation&&metadata.orientation!==1){
    if(pages>1)throw Error('多帧图片含方向标记，暂无法安全校正方向');
    await sharp(entry.source,{limitInputPixels:50_000_000}).rotate().keepMetadata().toFile(entry.oriented);
    await rename(entry.oriented,entry.temp);
   }else await copyFile(entry.source,entry.temp);
   const args=['-overwrite_original'];if(options.removeExif){args.push('-EXIF:all=');if(metadata.format==='tiff'){
    const originalTags=await this.tags(session,entry.temp);
    for(const key of Object.keys(originalTags)){const match=/^(IFD\d*):(.+)$/.exec(key);if(match&&!tiffStructure.has(match[2]))args.push(`-${key}=`);}
   }}if(options.removeGps)args.push('-GPS:all=','-XMP:Geotag=');
   if(options.removeXmp)args.push('-XMP:all=');if(options.removeIptc)args.push('-IPTC:all=');
   await this.command(session,[...args,entry.temp]);
   const output=await sharp(entry.temp,{animated:true}).metadata();if((output.pages||1)!==pages)throw Error('输出帧数与原图不一致');
   if(Boolean(metadata.icc)!==Boolean(output.icc)||metadata.icc&&output.icc&&!metadata.icc.equals(output.icc))throw Error('输出色彩配置与原图不一致');
   if(options.removeExif&&output.orientation&&output.orientation!==1)throw Error('输出仍含旋转方向标记');
   const tags=await this.tags(session,entry.temp),names=Object.keys(tags);
   if(options.removeExif&&names.some(key=>{const match=/^(IFD\d*|ExifIFD|GPS|InteropIFD|MakerNotes|SubIFD):(.+)$/.exec(key);return match&&(metadata.format!=='tiff'||!/^IFD\d*$/.test(match[1])||!tiffStructure.has(match[2]));}))throw Error('EXIF 未完全移除');
   if(options.removeGps&&names.some(key=>/^GPS:|^XMP-.*:(GPS|Geotag)/i.test(key)))throw Error('GPS 未完全移除');
   if(options.removeXmp&&names.some(key=>/^XMP[-:]/.test(key)))throw Error('XMP 未完全移除');
   if(options.removeIptc&&names.some(key=>/^IPTC:/.test(key)))throw Error('IPTC 未完全移除');
   if(session.cancelled)throw Error('已取消');await rename(entry.temp,entry.output);
   return {source:entry.source,output:entry.output,before,after:(await stat(entry.output)).size,width:output.width,height:output.pageHeight||output.height,pages,status:'done',message:'已核验所选元数据与色彩配置',metadataDiff:imageMetadataDiff(beforeTags,tags)};
  }catch(error){return {source:entry.source,before,status:session.cancelled?'cancelled':'error',message:(error as Error).message.slice(0,300)};}
  finally{await rm(entry.temp,{force:true}).catch(()=>{});await rm(entry.oriented,{force:true}).catch(()=>{});}
 }
 private async run(entries:Entry[],options:ImageMetadataOptions,session:Session,notify:(value:ImageMetadataProgress)=>void):Promise<ImageMetadataSummary>{
  const results:ImageMetadataResult[]=[];
  for(const entry of entries){if(session.cancelled){results.push({source:entry.source,before:0,status:'cancelled',message:'已取消'});continue;}notify({done:results.length,total:entries.length,current:entry.source});const result=await this.process(entry,options,session);results.push(result);notify({done:results.length,total:entries.length,result});}
  return {results,cancelled:session.cancelled};
 }
}
