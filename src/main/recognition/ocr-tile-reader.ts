import { fork } from 'node:child_process';
import { join } from 'node:path';
import { IMAGE_BYTES } from '../../shared/capture/image-limits';
import { planOCRRegionTiles,ocrRect,OCR_TILE_EDGE,OCR_SEAM_REPAIRS,OCR_SEAM_PIXELS,type OCRTile,type OCRRect } from '../../shared/recognition/ocr-tiles';
export async function* decodedOCRTiles(png:Buffer,size:{width:number;height:number},signal:AbortSignal,
  worker=join(__dirname,'recognition/ocr-tile-worker.cjs'),region?:OCRRect,tileEdge?:number,additional?:()=>readonly OCRTile[]):AsyncGenerator<{tile:OCRTile;png:Buffer;decodeRSSMiB:number}>{
  const dimensions={...size},target=region?ocrRect(region,dimensions):undefined,tiles=planOCRRegionTiles(dimensions,target,tileEdge);signal.throwIfAborted();
  if(!Buffer.isBuffer(png)||png.length<33||png.length>IMAGE_BYTES)throw Error('长图数据无效');
  const child=fork(worker,[],{execArgv:['--max-old-space-size=128'],serialization:'advanced',windowsHide:true,
    stdio:['ignore','ignore','pipe','ipc'],env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}});
  child.stderr?.resume();child.on('error',()=>{});
  let failure:Error|undefined;
  const failed=(error:Error)=>{failure=error;},exited=(code:number|null)=>{failure ||= Error(code===70?'长图解码超过内存预算，输入已保留':'长图解码进程已退出');};
  child.on('error',failed);child.on('exit',exited);
  const cancel=()=>{child.kill();};signal.addEventListener('abort',cancel,{once:true});
  async function request(packet:{type:'open';png:Buffer;size:{width:number;height:number};region?:OCRRect;tileEdge?:number}|{type:'next';index:number}|{type:'crop';index:number;region:OCRRect}):Promise<any>{
    signal.throwIfAborted();if(failure)throw failure;
    return new Promise((resolve,reject)=>{
      let done=false;
      const finish=(error?:Error,value?:unknown)=>{if(done)return;done=true;clearTimeout(timer);child.off('message',message);child.off('exit',exit);child.off('error',fail);signal.removeEventListener('abort',abort);error?reject(error):resolve(value);};
      const message=(value:any)=>finish(value?.error?Error(String(value.error).slice(0,500)):undefined,value);
      const exit=()=>finish(signal.aborted?Error('文字识别已取消'):failure||Error('长图解码进程已退出'));
      const fail=(error:Error)=>finish(error),abort=()=>finish(Error('文字识别已取消'));
      const timer=setTimeout(()=>{finish(Error('长图解码超时，输入已保留'));child.kill();},30000);timer.unref();
      child.once('message',message);child.once('exit',exit);child.once('error',fail);signal.addEventListener('abort',abort,{once:true});
      try{child.send(packet,error=>{if(error)finish(error);});}catch(error){finish(error as Error);}
    });
  }
  try{
    if(!(await request({type:'open',png,size:dimensions,region:target,tileEdge})).ready)throw Error('长图解码初始化无效');
    async function* decode(list:readonly OCRTile[],extra=false){
      for(const tile of list){
        const {left,top,width,height}=tile,packet=extra?{type:'crop' as const,index:tile.index,region:{left,top,width,height}}:{type:'next' as const,index:tile.index};
        const response=await request(packet),bytes=response?.png;
        if(response?.index!==tile.index||!Buffer.isBuffer(bytes)||bytes.length<33||bytes.length>IMAGE_BYTES||bytes.toString('hex',0,8)!=='89504e470d0a1a0a'||bytes.readUInt32BE(16)!==tile.width||bytes.readUInt32BE(20)!==tile.height)throw Error('长图分块结果无效');
        if(!Number.isFinite(response.peakRSSMiB)||response.peakRSSMiB<1||response.peakRSSMiB>384){bytes.fill(0);throw Error('长图解码内存记录无效');}
        try{signal.throwIfAborted();yield {tile,png:bytes,decodeRSSMiB:response.peakRSSMiB};}finally{bytes.fill(0);}
      }
    }
    yield* decode(tiles);signal.throwIfAborted();
    const extra=(additional?.()||[]).map(tile=>({...tile,core:{...tile.core}})),allowed=target||{left:0,top:0,...dimensions};let pixels=0;
    if(extra.length>OCR_SEAM_REPAIRS)throw Error('接缝裁剪数量超限');
    for(const [index,tile]of extra.entries()){
      const {left,top,width,height}=tile;ocrRect({left,top,width,height},dimensions);const core=ocrRect(tile.core,dimensions);pixels+=width*height;
      if(core.left<left||core.top<top||core.left+core.width>left+width||core.top+core.height>top+height||tile.index!==tiles.length+index||width>(tileEdge||OCR_TILE_EDGE)||height>(tileEdge||OCR_TILE_EDGE)||left<allowed.left||top<allowed.top||left+width>allowed.left+allowed.width||top+height>allowed.top+allowed.height||pixels>OCR_SEAM_PIXELS)throw Error('接缝裁剪区域无效');
    }
    signal.throwIfAborted();yield* decode(extra,true);
  }finally{
    signal.removeEventListener('abort',cancel);
    if(child.pid&&child.exitCode===null&&child.signalCode===null)await new Promise<void>(resolve=>{child.once('exit',()=>resolve());child.kill();});
    child.off('error',failed);child.off('exit',exited);
  }
}
