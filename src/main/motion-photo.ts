import {open,stat,realpath,readdir,mkdtemp,rm,rmdir} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {tmpdir} from 'node:os';
import {pipeline} from 'node:stream/promises';
import type {FileHandle} from 'node:fs/promises';
import {extname,dirname,join} from 'node:path';
import {open as openZip,type Entry,type ZipFile} from 'yauzl';
export interface FileSegment {offset:number;length:number}
export interface MotionPhotoSource extends FileSegment {path:string;mime:'video/mp4'|'video/quicktime';source:string;presentationTime?:number;paired?:boolean}
export interface LivpTemporary {directory:string;paths:string[]}
export interface LivpContents {still:FileSegment&{path:string;mime:'image/jpeg'|'image/heic'|'image/heif'};movie:MotionPhotoSource|null;temporary?:LivpTemporary}
const maxPhoto=100*1024*1024,maxVideo=512*1024*1024;
const uuid=/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
function appleIdentifier(head:Buffer){
 const start=head.indexOf('Apple iOS\0');if(start<0||start+16>head.length)return undefined;
 const order=head.toString('ascii',start+12,start+14);if(!['MM','II'].includes(order))return undefined;
 const u16=(at:number)=>order==='MM'?head.readUInt16BE(at):head.readUInt16LE(at),u32=(at:number)=>order==='MM'?head.readUInt32BE(at):head.readUInt32LE(at);
 const count=u16(start+14);if(count>512||start+16+count*12>head.length)return undefined;
 for(let i=0;i<count;i++){const at=start+16+i*12;if(u16(at)!==0x11||u16(at+2)!==2)continue;const length=u32(at+4),offset=start+u32(at+8);if(length<36||length>64||offset+length>head.length)return undefined;const value=head.toString('ascii',offset,offset+length).replace(/\0+$/,'');return uuid.test(value)?value.toLowerCase():undefined;}
 return undefined;
}
/** QuickTime keys/ilst index association, rather than any incidental UUID inside the movie. */
function movieIdentifier(data:Buffer):string|undefined{
 function children(start:number,end:number){const list:{type:string;index:number;start:number;end:number}[]=[];for(let at=start;at+8<=end&&list.length<512;){const size=data.readUInt32BE(at);if(size<8||at+size>end)break;list.push({type:data.toString('ascii',at+4,at+8),index:data.readUInt32BE(at+4),start:at+8,end:at+size});at+=size;}return list;}
 function visit(start:number,end:number,depth:number):string|undefined{if(depth>4)return undefined;for(const item of children(start,end)){
  if(['moov','udta'].includes(item.type)){const value=visit(item.start,item.end,depth+1);if(value)return value;}
  if(item.type!=='meta'||item.start+4>item.end)continue;
  const parts=children(item.start+4,item.end),keys=parts.find(p=>p.type==='keys'),ilst=parts.find(p=>p.type==='ilst');if(!keys||!ilst||keys.start+8>keys.end)continue;
  let target=0,at=keys.start+8;const count=Math.min(data.readUInt32BE(keys.start+4),512);
  for(let i=1;i<=count&&at+8<=keys.end;i++){const size=data.readUInt32BE(at);if(size<8||at+size>keys.end)break;if(data.toString('utf8',at+8,at+size)==='com.apple.quicktime.content.identifier')target=i;at+=size;}
  if(!target)continue;for(const entry of children(ilst.start,ilst.end)){if(entry.index!==target)continue;for(const value of children(entry.start,entry.end)){if(value.type!=='data'||value.start+8>value.end||value.end-value.start>80)continue;const id=data.toString('utf8',value.start+8,value.end).replace(/\0+$/,'');if(uuid.test(id))return id.toLowerCase();}}
 }return undefined;}return visit(0,data.length,0);
}
async function bytes(file:FileHandle,offset:number,length:number){const buffer=Buffer.alloc(length);const {bytesRead}=await file.read(buffer,0,length,offset);return buffer.subarray(0,bytesRead);}
async function box(file:FileHandle,offset:number,end:number){
 const h=await bytes(file,offset,16);if(h.length<8)return null;let size=h.readUInt32BE(0),header=8;
 if(size===1){if(h.length<16)return null;const large=h.readBigUInt64BE(8);if(large>BigInt(Number.MAX_SAFE_INTEGER))return null;size=Number(large);header=16;}else if(size===0)size=end-offset;
 const type=h.toString('ascii',4,8);return size>=header&&offset+size<=end&&/^[\w ]{4}$/.test(type)?{type,size,header}:null;
}
async function videoTrack(file:FileHandle,start:number,end:number,depth=0,budget={left:512}):Promise<boolean>{
 if(depth>5)return false;
 for(let at=start;at+8<=end&&budget.left-->0;){const item=await box(file,at,end);if(!item)return false;
  if(item.type==='hdlr'){const data=await bytes(file,at+item.header,12);if(data.length===12&&data.toString('ascii',8,12)==='vide')return true;}
  if(['trak','mdia'].includes(item.type)&&await videoTrack(file,at+item.header,at+item.size,depth+1,budget))return true;at+=item.size;
 }return false;
}
/** Accept only a bounded ISO-BMFF movie with actual video and media data, not an ftyp string. */
async function movie(file:FileHandle,offset:number,length:number){
 if(offset<0||length<32||length>maxVideo)return null;const end=offset+length,first=await box(file,offset,end);if(!first||!['ftyp','wide','moov','free'].includes(first.type))return null;
 let video=false,media=false,at=offset,mime:'video/mp4'|'video/quicktime'='video/mp4',contentIdentifier:string|undefined;
 for(let count=0;count<512&&at+8<=end;count++){
  const item=await box(file,at,end);if(!item)break;
  if(item.type==='ftyp'){const brand=await bytes(file,at+item.header,4);if(brand.toString('ascii')==='qt  ')mime='video/quicktime';}
  if(item.type==='moov'){video=await videoTrack(file,at+item.header,at+item.size)||video;if(item.size<=2*1024*1024)contentIdentifier=movieIdentifier(await bytes(file,at,item.size));}
  if(item.type==='mdat'&&item.size>item.header)media=true;at+=item.size;
 }
 return video&&media?{offset,length:at-offset,mime,contentIdentifier}:null;
}
function xmpNumber(text:string,name:string){const match=new RegExp(`(?:[\\w-]+:)?${name}(?:\\s*=\\s*["'](\\d+)["']|\\s*>\\s*(\\d+)\\s*<)`,'i').exec(text);const n=Number(match?.[1]||match?.[2]);return Number.isSafeInteger(n)&&n>=0?n:undefined;}
async function samsung(file:FileHandle,size:number):Promise<FileSegment|null>{
 // SEF directories use little-endian negative offsets; mpv2 stores a big-endian absolute slice.
 let end=size;
 for(let block=0;block<8&&end>=20;block++){
  const tail=await bytes(file,end-8,8),length=tail.readUInt32LE(0);if(length<12||length>65536||length+8>=end)return null;
  const start=end-length-8;end=start;if(tail.toString('ascii',4)!=='SEFT')continue;
  const directory=await bytes(file,start,length);if(directory.toString('ascii',0,4)!=='SEFH')return null;
  const count=directory.readUInt32LE(8);if(count>1024||12+12*count>length)return null;
  for(let i=0;i<count;i++){const at=12+i*12;if(directory.readUInt16LE(at+2)!==0x0a30)continue;
   const negative=directory.readUInt32LE(at+4),blockSize=directory.readUInt32LE(at+8),entry=start-negative;if(entry<0||blockSize<8||blockSize>negative)continue;
   const header=await bytes(file,entry,8);if(header.length<8)continue;const nameSize=header.readUInt32LE(4);if(nameSize>256||8+nameSize>=blockSize)continue;
   const name=await bytes(file,entry+8,nameSize);if(name.toString('ascii')!=='MotionPhoto_Data')continue;
   const offset=entry+8+nameSize,dataSize=blockSize-8-nameSize,data=await bytes(file,offset,12);
   if(dataSize===12&&data.toString('ascii',0,4)==='mpv2'){const offset=data.readUInt32BE(4),length=data.readUInt32BE(8);if(offset+length<=size)return {offset,length};}
   else return {offset,length:dataSize};
  }return null;
 }return null;
}
export async function inspectMotionPhoto(path:string,notice?:(message:string)=>void):Promise<MotionPhotoSource|null>{
 if(!/\.(jpe?g|heic|heif|avif)$/i.test(path))return null;
 const size=(await stat(path)).size;if(size<16||size>maxPhoto)return null;const file=await open(path,'r');let photoIdentifier:string|undefined,motionMarked=false;
 try{
  const head=await bytes(file,0,Math.min(size,1024*1024)),text=head.toString('utf8'),timestamp=xmpNumber(text,'MotionPhotoPresentationTimestampUs')??xmpNumber(text,'MicroVideoPresentationTimestampUs');photoIdentifier=appleIdentifier(head);motionMarked=!!photoIdentifier||xmpNumber(text,'MotionPhoto')===1||xmpNumber(text,'MicroVideo')===1||!!xmpNumber(text,'MicroVideoOffset');
  const result=async(segment:FileSegment|undefined|null,source:string)=>{if(!segment||segment.offset<8||segment.offset+segment.length>size)return null;const found=await movie(file,segment.offset,segment.length);return found?{path,...found,source,...(timestamp===undefined?{}:{presentationTime:timestamp/1e6})}:null;};
  const offset=xmpNumber(text,'MicroVideoOffset');if(offset){const found=await result({offset:size-offset,length:offset},'Google MicroVideo');if(found)return found;}
  // Directory order and secondary-item lengths locate MotionPhoto from EOF, including gain-map photos.
  for(const tag of text.match(/<[\w:-]+\b[^>]*>/g)||[]){if(!/\b(?:[\w-]+:)?Semantic\s*=\s*["']MotionPhoto["']/i.test(tag))continue;motionMarked=true;const length=xmpNumber(tag,'Length');if(length){const found=await result({offset:size-length,length},'Motion Photo');if(found)return found;}}
  const sef=await samsung(file,size),sefMovie=await result(sef,'Samsung SEF');if(sefMovie)return sefMovie;if(sef)motionMarked=true;
  // HEIC/AVIF Motion Photo stores the movie in a top-level mpvd box.
  if(head.toString('ascii',4,8)==='ftyp')for(let at=0,count=0;at+8<=size&&count<256;count++){const item=await box(file,at,size);if(!item)break;if(item.type==='mpvd'){const found=await result({offset:at+item.header,length:item.size-item.header},'Motion Photo mpvd');if(found)return found;}at+=item.size;}
  // Vendor variants may omit standard XMP or add a trailer. Scan bounded chunks, then validate the movie.
  let carry=Buffer.alloc(0),attempts=0;
  for(let at=0;at<size&&attempts<24;at+=65536){const part=await bytes(file,at,Math.min(65536,size-at)),data=Buffer.concat([carry,part]),base=at-carry.length;let index=0;
   while(index<data.length){const matches=['ftyp','wide','moov'].map(type=>data.indexOf(type,index,'ascii')).filter(at=>at>=0);if(!matches.length)break;index=Math.min(...matches);const start=base+index-4;index+=4;if(start<8)continue;attempts++;const found=await result({offset:start,length:size-start},'嵌入式动态照片');if(found)return found;if(attempts>=24)break;}carry=Buffer.from(data.subarray(Math.max(0,data.length-7)));
  }
 }finally{await file.close();}
 // Apple and exported Android photos commonly use a same-basename MOV/MP4 sidecar.
 const stem=path.slice(0,-extname(path).length),seen=new Set<string>(),folder=await realpath(dirname(path));let fallback:MotionPhotoSource|null=null;
 const candidates=['.MOV','.MP4','.mov','.mp4'].map(extension=>({path:stem+extension,sameName:true}));
 if(photoIdentifier){let count=0;for(const name of await readdir(dirname(path))){if(/\.(mov|mp4)$/i.test(name)){candidates.push({path:join(dirname(path),name),sameName:false});if(++count>=64)break;}}}
 for(const item of candidates){const candidate=await realpath(item.path).catch(()=>null);if(!candidate||dirname(candidate).toLowerCase()!==folder.toLowerCase()||seen.has(candidate.toLowerCase()))continue;seen.add(candidate.toLowerCase());const info=await stat(candidate);if(!info.isFile()||info.size>maxVideo)continue;const paired=await open(candidate,'r');try{const found=await movie(paired,0,info.size);if(!found)continue;
   if(photoIdentifier&&found.contentIdentifier&&photoIdentifier!==found.contentIdentifier)continue;
   const matched=photoIdentifier&&photoIdentifier===found.contentIdentifier;if(!item.sameName&&!matched)continue;
   const source={path:candidate,...found,source:matched?'Apple Live Photo（标识匹配）':'同名照片与视频配对',paired:true};if(matched||!photoIdentifier)return source;fallback=source;
  }finally{await paired.close();}}
 if(!fallback&&motionMarked)notice?.(photoIdentifier?'未找到匹配的动态视频，请将照片与视频放在同一目录':'检测到动态照片标记，但未找到可播放的视频片段');return fallback;
}

export async function releaseLivpTemporary(value:LivpTemporary){
 for(const path of value.paths)await rm(path,{force:true});
 await rmdir(value.directory).catch(error=>{if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;});
}
async function extractLivp(zip:ZipFile,photo:Entry,video:Entry|undefined):Promise<LivpContents>{
 const temporary:LivpTemporary={directory:await mkdtemp(join(tmpdir(),'one-livp-')),paths:[]};
 const extract=async(entry:Entry,name:string,limit:number)=>{
  if(![0,8].includes(entry.compressionMethod)||entry.generalPurposeBitFlag&1)throw Error('不支持此 LIVP 压缩方式或加密文件项');
  if(entry.uncompressedSize<16||entry.uncompressedSize>limit)throw Error('LIVP 文件项超过预览上限或已损坏');
  const target=join(temporary.directory,name);temporary.paths.push(target);
  const stream=await new Promise<import('node:stream').Readable>((resolve,reject)=>zip.openReadStream(entry,(error,value)=>error||!value?reject(error||Error('LIVP 文件项无法提取')):resolve(value)));
  let received=0;stream.on('data',(chunk:Buffer)=>{received+=chunk.length;if(received>limit)stream.destroy(Error('LIVP 文件项超过预览上限'));});
  await pipeline(stream,createWriteStream(target,{flags:'wx'}));
  if((await stat(target)).size!==entry.uncompressedSize)throw Error('LIVP 文件项长度无效');
  return target;
 };
 try{
  const extension=extname(photo.fileName).toLowerCase(),jpeg=extension==='.jpg'||extension==='.jpeg';
  const mime=jpeg?'image/jpeg' as const:extension==='.heic'?'image/heic' as const:'image/heif' as const;
  const photoPath=await extract(photo,'photo'+extension,maxPhoto);
  const stillFile=await open(photoPath,'r');let photoHeader:Buffer;
  try{photoHeader=await bytes(stillFile,0,Math.min(photo.uncompressedSize,1024*1024));}finally{await stillFile.close();}
  if(jpeg?photoHeader[0]!==0xff||photoHeader[1]!==0xd8:photoHeader.toString('ascii',4,8)!=='ftyp')throw Error('LIVP 照片内容与文件项类型不符');
  let motion:MotionPhotoSource|null=null;
  if(video){
   const videoPath=await extract(video,'photo'+extname(video.fileName).toLowerCase(),maxVideo);
   const movieFile=await open(videoPath,'r');
   try{const found=await movie(movieFile,0,video.uncompressedSize);
    const identifier=appleIdentifier(photoHeader);
    if(found&&(!identifier||!found.contentIdentifier||identifier===found.contentIdentifier))motion={path:videoPath,...found,source:'LIVP 导出包'};
   }finally{await movieFile.close();}
  }
  return {still:{path:photoPath,offset:0,length:photo.uncompressedSize,mime},movie:motion,temporary};
 }catch(error){await releaseLivpTemporary(temporary).catch(()=>{});throw error;}
}
/** Locate LIVP resources; stored members stay zero-copy, while DEFLATE members use bounded temporary files. */
export async function inspectLivp(path:string):Promise<LivpContents>{
 const size=(await stat(path)).size;
 if(size<64||size>612*1024*1024)throw Error('LIVP 导出包超过预览上限或已损坏');
 const zip=await new Promise<ZipFile>((resolve,reject)=>openZip(path,{lazyEntries:true,autoClose:false,validateEntrySizes:true},(error,value)=>error||!value?reject(error||Error('LIVP 无法读取')):resolve(value)));
 let entries:Entry[],extracted:LivpContents|undefined;
 try{entries=await new Promise<Entry[]>((resolve,reject)=>{
  const selected:Entry[]=[];let seen=0,done=false;
  const fail=(error:Error)=>{if(!done){done=true;reject(error);}};
  zip.on('error',fail);
  zip.on('entry',entry=>{
   if(++seen>64){fail(Error('LIVP 文件项超过预览上限'));return;}
   if(/\.(?:jpe?g|heic|heif|mov|mp4)$/i.test(entry.fileName))selected.push(entry);
   zip.readEntry();
  });
  zip.on('end',()=>{if(!done){done=true;resolve(selected);}});
  zip.readEntry();
 });
  const photos=entries.filter(entry=>/\.(?:jpe?g|heic|heif)$/i.test(entry.fileName));
  const videos=entries.filter(entry=>/\.(?:mov|mp4)$/i.test(entry.fileName));
  if(photos.length!==1||videos.length>1)throw Error('LIVP 照片或视频文件项不明确');
  if([photos[0],...videos].some(entry=>entry.generalPurposeBitFlag&1))throw Error('不支持加密的 LIVP 文件项');
  if([photos[0],...videos].some(entry=>entry.compressionMethod!==0))extracted=await extractLivp(zip,photos[0],videos[0]);
 }finally{zip.close();}
 if(extracted)return extracted;
 const photos=entries.filter(entry=>/\.(?:jpe?g|heic|heif)$/i.test(entry.fileName));
 const videos=entries.filter(entry=>/\.(?:mov|mp4)$/i.test(entry.fileName));
 const file=await open(path,'r');
 try{
  const segment=async(entry:Entry,limit:number):Promise<FileSegment>=>{
   if(entry.compressionMethod!==0||entry.generalPurposeBitFlag&1)throw Error('LIVP 文件项编码无效');
   if(entry.uncompressedSize<16||entry.uncompressedSize>limit||entry.compressedSize!==entry.uncompressedSize)throw Error('LIVP 文件项超过预览上限或已损坏');
   const header=await bytes(file,entry.relativeOffsetOfLocalHeader,30);
   if(header.length!==30||header.readUInt32LE(0)!==0x04034b50)throw Error('LIVP 文件项无效');
   const offset=entry.relativeOffsetOfLocalHeader+30+header.readUInt16LE(26)+header.readUInt16LE(28);
   if(offset<30||offset+entry.uncompressedSize>size)throw Error('LIVP 文件项位置无效');
   return {offset,length:entry.uncompressedSize};
  };
  const still=await segment(photos[0],maxPhoto);
  const photoHeader=await bytes(file,still.offset,Math.min(still.length,1024*1024));
  const extension=extname(photos[0].fileName).toLowerCase();
  const jpeg=extension==='.jpg'||extension==='.jpeg';
  if(jpeg?photoHeader[0]!==0xff||photoHeader[1]!==0xd8:photoHeader.toString('ascii',4,8)!=='ftyp')throw Error('LIVP 照片内容与文件项类型不符');
  const mime=jpeg?'image/jpeg' as const:extension==='.heic'?'image/heic' as const:'image/heif' as const;
  if(!videos.length)return {still:{path,...still,mime},movie:null};
  const video=await segment(videos[0],maxVideo);
  const found=await movie(file,video.offset,video.length);
  if(!found)return {still:{path,...still,mime},movie:null};
  const identifier=appleIdentifier(photoHeader);
  if(identifier&&found.contentIdentifier&&identifier!==found.contentIdentifier)return {still:{path,...still,mime},movie:null};
  return {still:{path,...still,mime},movie:{path,...found,source:'LIVP 导出包'}};
 }finally{await file.close();}
}
