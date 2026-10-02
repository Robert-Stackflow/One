import {parseLyrics} from '../shared/preview';
import {extname} from 'node:path';
import {readWorkbook} from './workbook';
import { parentPort, workerData } from 'node:worker_threads';
import { open, type Entry, type ZipFile } from 'yauzl';
import { readFile,stat } from 'node:fs/promises';
import { parseFile } from 'music-metadata';
import exifr from 'exifr';
import type { FileEntry } from '../shared/types';

// Only enumerate archives; never extract or run their contents. Bound decompression before Office rendering.
function archive(path: string, office: boolean) {
  return new Promise<{entries:FileEntry[];metadata:Record<string,string>}>((resolve,reject) => {
    open(path,{lazyEntries:true,autoClose:true,validateEntrySizes:true},(error,zip) => {
      if(error || !zip) return reject(error || new Error('无法读取压缩文件'));
      const entries:FileEntry[]=[]; const metadata:Record<string,string>={}; let total=0,packed=0,manifest:Entry|undefined,settled=false;
      const fail=(error:unknown)=>{if(settled)return;settled=true;zip.close();reject(error);};
      zip.on('error',fail);
      zip.on('entry',(entry:Entry)=>{
        if(entries.length >= 20000) return fail(new Error('压缩包超过 20,000 项，无法预览'));
        total+=entry.uncompressedSize; packed+=entry.compressedSize;
        if(office && (total > 128*1024*1024 || entry.uncompressedSize > 32*1024*1024 || (entry.uncompressedSize > 1024*1024 && entry.uncompressedSize/Math.max(1,entry.compressedSize)>1000))) return fail(new Error('文档解压后过大，无法预览'));
        entries.push({name:entry.fileName.split('/').filter(Boolean).pop() || entry.fileName,path:entry.fileName,directory:entry.fileName.endsWith('/'),size:entry.uncompressedSize,packedSize:entry.compressedSize});
        if(entry.fileName==='AndroidManifest.xml' && entry.uncompressedSize<=4*1024*1024) manifest=entry;
        if(office){zip.openReadStream(entry,(error,stream)=>{if(error||!stream)return fail(error||new Error('无法校验文档内容'));let actual=0;stream.on('data',chunk=>{actual+=chunk.length;if(actual>32*1024*1024){stream.destroy(new Error('文档解压后过大'));}});stream.on('error',fail);stream.on('end',()=>{if(!settled)zip.readEntry();});});}else zip.readEntry();
      });
      zip.on('end',async()=>{
        if(settled)return; settled=true;
        metadata['项目']=String(entries.length); metadata['解压大小']=`${(total/1024/1024).toFixed(2)} MB`;metadata['压缩率']=total?`${Math.round((1-packed/total)*100)}%`:'—';
        // Reopen for the one bounded manifest entry; the enumeration descriptor is already closed.
        if(manifest) {try{Object.assign(metadata,parseAndroidManifest(await zipEntry(path,'AndroidManifest.xml')));}catch{metadata['清单']='无法解析 Android 清单';}}
        resolve({entries,metadata});
      });
      zip.readEntry();
    });
  });
}
function zipEntry(path:string,name:string):Promise<Buffer>{return new Promise((resolve,reject)=>{open(path,{lazyEntries:true},(error,zip)=>{
  if(error||!zip)return reject(error);let found=false;zip.on('error',reject);zip.on('end',()=>{if(!found)reject(new Error('未找到清单'));});
  zip.on('entry',(entry:Entry)=>{if(entry.fileName!==name){zip.readEntry();return;}found=true;if(entry.uncompressedSize>4*1024*1024){zip.close();reject(new Error('清单过大'));return;}zip.openReadStream(entry,(error,stream)=>{if(error||!stream){zip.close();reject(error);return;}const chunks:Buffer[]=[];let size=0;stream.on('data',chunk=>{size+=chunk.length;if(size>4*1024*1024){stream.destroy(new Error('清单过大'));return;}chunks.push(chunk);});stream.on('error',error=>{zip.close();reject(error);});stream.on('end',()=>{zip.close();resolve(Buffer.concat(chunks));});});});zip.readEntry();
});});}
export function parseAndroidManifest(b:Buffer):Record<string,string>{
  if(b.length<8||b.readUInt16LE(0)!==3) throw new Error('非二进制清单');
  const strings:string[]=[];const meta:Record<string,string>={};
  const names:Record<string,string>={package:'包名',versionName:'版本',versionCode:'版本代码',minSdkVersion:'最低 SDK',targetSdkVersion:'目标 SDK',label:'应用名'};
  for(let offset=8;offset+8<=b.length;){const type=b.readUInt16LE(offset),header=b.readUInt16LE(offset+2),length=b.readUInt32LE(offset+4);if(length<8||offset+length>b.length)throw new Error('清单块无效');
    if(type===1&&header>=28){const count=b.readUInt32LE(offset+8),flags=b.readUInt32LE(offset+16),start=offset+b.readUInt32LE(offset+20);if(count>100000||offset+header+count*4>offset+length)throw new Error('清单字符串过多');
      for(let i=0;i<count;i++){let p=start+b.readUInt32LE(offset+header+i*4);const len8=()=>{let n=b[p++];if(n&128)n=((n&127)<<8)|b[p++];return n;};const len16=()=>{let n=b.readUInt16LE(p);p+=2;if(n&32768){n=((n&32767)<<16)|b.readUInt16LE(p);p+=2;}return n;};if(flags&256){len8();const size=len8();strings.push(b.toString('utf8',p,p+size));}else{const size=len16();strings.push(b.toString('utf16le',p,p+size*2));}}
    }else if(type===0x102&&length>=36){const attributeStart=b.readUInt16LE(offset+24),attributeSize=b.readUInt16LE(offset+26),count=b.readUInt16LE(offset+28);if(attributeSize<20)throw new Error('清单属性无效');
      for(let i=0;i<count;i++){const p=offset+16+attributeStart+i*attributeSize;if(p+20>offset+length)throw new Error('清单属性越界');const name=strings[b.readUInt32LE(p+4)],raw=b.readUInt32LE(p+8),kind=b[p+15],value=b.readUInt32LE(p+16);if(names[name] && !meta[names[name]])meta[names[name]]=raw!==0xffffffff?strings[raw]:kind===3?strings[value]:kind===1?`资源 @${value.toString(16)}`:String(value);}
    }offset+=length;
  }return meta;
}
async function run(){
  const {path,kind}=workerData;
  if(kind==='workbook'){const result=await archive(path,true);return {...result,workbook:await readWorkbook(path)};}
  if(['archive','docx','pptx','epub'].includes(kind))return archive(path,kind!=='archive');
  if(kind==='media'){const {format,common}=await parseFile(path,{skipCovers:false,duration:true});const metadata:Record<string,string>={};for(const [name,value] of Object.entries({'编码':format.codec,'容器':format.container,'时长':format.duration===undefined?undefined:`${format.duration.toFixed(2)} 秒`,'比特率':format.bitrate?`${Math.round(format.bitrate/1000)} kbps`:undefined,'采样率':format.sampleRate?`${format.sampleRate} Hz`:undefined,'声道':format.numberOfChannels,'标题':common.title,'艺术家':common.artist,'专辑':common.album}))if(value!==undefined)metadata[name]=String(value);
    const picture=common.picture?.find(p=>/^image\/(jpeg|png|webp)$/.test(p.format)&&p.data.length<=5*1024*1024);
    const cover=picture?'data:'+picture.format+';base64,'+Buffer.from(picture.data).toString('base64'):undefined;
    let lyrics='';const sidecar=path.slice(0,-extname(path).length)+'.lrc';try{if((await stat(sidecar)).size<=200000){const b=await readFile(sidecar);if(b.length<=200000)lyrics=b.toString('utf8');}}catch{}
    if(!lyrics)for(const l of common.lyrics||[]){if(l.text)lyrics+=l.text+'\n';else if(l.syncText)lyrics+=l.syncText.map(t=>'['+Math.floor((t.timestamp||0)/60000)+':'+(((t.timestamp||0)/1000)%60).toFixed(2)+']'+t.text).join('\n');}
    return {metadata,cover,lyrics:parseLyrics(lyrics)};}
  if(kind==='image'){const data=await exifr.parse(path,{gps:false,exif:true,tiff:true,icc:false,iptc:false,xmp:false})||{};const metadata:Record<string,string>={};for(const [key,name] of Object.entries({Make:'设备品牌',Model:'设备型号',LensModel:'镜头',DateTimeOriginal:'拍摄时间',ExposureTime:'曝光时间',FNumber:'光圈',ISO:'ISO',ColorSpace:'色彩空间',Orientation:'方向'}))if(data[key]!==undefined)metadata[name]=String(data[key]);return {metadata};}
  return {};
}
if(parentPort)run().then(result=>parentPort!.postMessage({result})).catch(error=>parentPort!.postMessage({error:error.message}));
