import {openSync,closeSync,writeSync,readSync,statfsSync} from 'node:fs';
import {unlink,rename,stat,readFile,lstat,realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {Readable} from 'node:stream';
import {createDeflate} from 'node:zlib';
import sharp from 'sharp';
import type {ScrollStitch} from '../../shared/capture/scroll-stitch';
import {scrollDimensions,scrollEditSize,SCROLL_PIXELS,SCROLL_DISK_BYTES} from '../../shared/capture/scroll-limits';
import {IMAGE_BYTES} from '../../shared/capture/image-limits';
import type {ScrollDirectory} from './scroll-storage';

const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function checksum(parts:Uint8Array[]){let n=0xffffffff;for(const bytes of parts)for(const value of bytes)n=crcTable[(n^value)&255]^(n>>>8);return (n^0xffffffff)>>>0;}
function writeAll(fd:number,bytes:Uint8Array,position?:number){let at=0;while(at<bytes.length){const n=writeSync(fd,bytes,at,bytes.length-at,position===undefined?null:position+at);if(!n)throw Error('长截图写入失败');at+=n;}}
function readAll(fd:number,bytes:Uint8Array,position:number){let at=0;while(at<bytes.length){const n=readSync(fd,bytes,at,bytes.length-at,position+at);if(!n)throw Error('长截图缓存不完整');at+=n;}}
function chunk(fd:number,type:string,data:Uint8Array){const name=Buffer.from(type),header=Buffer.alloc(8),tail=Buffer.alloc(4);header.writeUInt32BE(data.length);name.copy(header,4);tail.writeUInt32BE(checksum([name,data]));writeAll(fd,header);writeAll(fd,data);writeAll(fd,tail);}
// PNG Sub filtering improves screenshot compression without a full-image buffer.
function filtered(bytes:Uint8Array,width:number,rows:number){
  const stride=width*4,output=Buffer.allocUnsafe(rows*(stride+1));
  for(let y=0;y<rows;y++){const from=y*stride,to=y*(stride+1);output[to]=1;for(let x=0;x<stride;x++){const channel=x%4,source=channel===0?x+2:channel===2?x-2:x,left=x<4?0:bytes[from+source-4];output[to+1+x]=(bytes[from+source]-left)&255;}}
  return output;
}

/** Runs only in the stitch worker. Vertical strips feed zlib directly; horizontal
 * strips first form a disk raster so each original strip is read just once. */
export async function exportScrollPng(engine:ScrollStitch,lease:ScrollDirectory,edit=false){
  if((await lstat(lease.directory)).isSymbolicLink()||await realpath(lease.directory)!==resolve(lease.directory)||(await lstat(join(lease.directory,'owner.json'))).isSymbolicLink()||JSON.parse(await readFile(join(lease.directory,'owner.json'),'utf8')).token!==lease.token)throw Error('长截图导出目录已失效');
  const {width,height}=scrollDimensions(engine.status().width,engine.status().height),size=scrollEditSize(width,height);
  const file=join(lease.directory,'export.png'),part=file+'.part',raw=join(lease.directory,'export.raw'),editFile=join(lease.directory,'edit.png');
  for(const path of [part,raw,editFile,file])await unlink(path).catch(error=>{if(error.code!=='ENOENT')throw error;});
  let rawFd:number|undefined,fd:number|undefined,tiles:ReturnType<ScrollStitch['outputTiles']>|undefined;
  try{
    tiles=engine.outputTiles();const first=tiles.next();if(first.done)throw Error('还没有采集图像');
    const vertical=first.value.width===width;
    const free=statfsSync(lease.directory);if(free.bavail*free.bsize<(vertical?0:width*height*4)+64*1024*1024){tiles.return(undefined);throw Error('磁盘空间不足，已有内容已保留。');}
    function* allTiles(){try{yield first.value!;yield* tiles!;}finally{tiles?.return(undefined);}}
    function* rows():Generator<Uint8Array>{
      const perBatch=Math.max(1,Math.floor(1024*1024/(width*4+1)));
      if(vertical){
        for(const tile of allTiles())for(let y=0;y<tile.height;y+=perBatch){const count=Math.min(perBatch,tile.height-y);yield filtered(tile.pixels.subarray(y*width*4,(y+count)*width*4),width,count);}
      }else{
        rawFd=openSync(raw,'wx+',0o600);
        for(const tile of allTiles())for(let y=0;y<height;y++)writeAll(rawFd,tile.pixels.subarray(y*tile.width*4,(y+1)*tile.width*4),(y*width+tile.x)*4);
        for(let y=0;y<height;y+=perBatch){const count=Math.min(perBatch,height-y),bytes=Buffer.allocUnsafe(count*width*4);try{readAll(rawFd,bytes,y*width*4);yield filtered(bytes,width,count);}finally{bytes.fill(0);}}
      }
    }
    fd=openSync(part,'wx',0o600);writeAll(fd,Buffer.from([137,80,78,71,13,10,26,10]));
    const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;chunk(fd,'IHDR',header);
    const input=Readable.from(rows(),{objectMode:false,highWaterMark:1024*1024}),deflater=createDeflate({level:3,chunkSize:64*1024});
    input.on('error',error=>deflater.destroy(error));input.pipe(deflater);let encoded=0;
    try{for await(const bytes of deflater){encoded+=bytes.length;if(encoded>SCROLL_DISK_BYTES)throw Error('长截图导出文件过大，已有内容已保留。');chunk(fd,'IDAT',bytes);}}
    finally{input.destroy();deflater.destroy();}
    chunk(fd,'IEND',Buffer.alloc(0));closeSync(fd);fd=undefined;
    await rename(part,file);
    if(edit&&size.scaled){
      await sharp(file,{limitInputPixels:SCROLL_PIXELS}).resize(size.width,size.height,{fit:'fill'}).png().toFile(editFile);
      if((await stat(editFile)).size>IMAGE_BYTES)throw Error('编辑副本文件过大，请先保存原图。');
      return {file:editFile,width:size.width,height:size.height,originalWidth:width,originalHeight:height,scaled:true};
    }
    return {file,width,height,originalWidth:width,originalHeight:height,scaled:false};
  }finally{
    tiles?.return(undefined);
    if(fd!==undefined)closeSync(fd);if(rawFd!==undefined)closeSync(rawFd);
    for(const path of [part,raw])await unlink(path).catch(()=>{});
  }
}
