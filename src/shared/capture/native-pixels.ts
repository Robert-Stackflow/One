import {imageDimensions} from './image-limits';
import type {PixelFrame} from './scroll-stitch';

export const FRAME_PIXEL_LIMIT=10_000_000*4;
export interface NativePixelInfo {version:1;format:'bgra8';backend:'wgc';width:number;height:number;stride:number;bytes:number;elapsed:number}
/** One packed, top-down BGRA frame in a separately owned, transferable buffer. */
export class NativePixelReader {
  private header=Buffer.alloc(0);
  private pixels?:Buffer;
  private offset=0;
  info?:NativePixelInfo;
  get complete(){return !!this.info&&this.offset===this.info.bytes;}
  append(chunk:Buffer){
    if(!this.info){
      const end=chunk.indexOf(10),length=end<0?chunk.length:end;
      if(this.header.length+length>512)throw Error('原生像素响应头过大');
      this.header=Buffer.concat([this.header,chunk.subarray(0,length)]);
      if(end<0)return;
      const info=JSON.parse(this.header.toString('utf8')) as NativePixelInfo;
      imageDimensions(info.width,info.height);
      if(info.version!==1||info.format!=='bgra8'||info.backend!=='wgc'||![info.width,info.height,info.stride,info.bytes,info.elapsed].every(Number.isSafeInteger)||info.width<2||info.height<2||info.stride!==info.width*4||info.bytes!==info.stride*info.height||info.bytes>FRAME_PIXEL_LIMIT||info.elapsed<0||info.elapsed>12000)throw Error('原生像素响应无效');
      this.info=info;this.header=Buffer.alloc(0);this.pixels=Buffer.allocUnsafeSlow(info.bytes);chunk=chunk.subarray(end+1);
    }
    if(this.offset+chunk.length>this.info.bytes)throw Error('原生采集返回额外像素');
    chunk.copy(this.pixels!,this.offset);this.offset+=chunk.length;
  }
  finish():{info:NativePixelInfo;frame:PixelFrame}{
    if(!this.complete||!this.info||!this.pixels)throw Error('原生像素帧不完整');
    return {info:this.info,frame:{width:this.info.width,height:this.info.height,pixels:new Uint8Array(this.pixels.buffer,this.pixels.byteOffset,this.pixels.byteLength)}};
  }
  clear(){if(this.pixels?.byteLength)this.pixels.fill(0);this.pixels=undefined;this.header.fill(0);this.header=Buffer.alloc(0);this.info=undefined;this.offset=0;}
}
