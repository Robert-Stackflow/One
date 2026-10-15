import sharp from 'sharp';
import { parentPort,workerData } from 'node:worker_threads';
import {ScrollDiskStorage} from './scroll-storage';
import {ScrollCaptureLimit,type ScrollDynamicRegion} from '../../shared/capture/scroll-capture';
import { ScrollStitch } from '../../shared/capture/scroll-stitch';
import { ScrollSettle } from '../../shared/capture/scroll-settle';
import type {PixelFrame} from '../../shared/capture/scroll-stitch';
const storage=workerData?.directory?new ScrollDiskStorage(workerData.directory,workerData.token):undefined;
let engine = new ScrollStitch(storage,true);
let settling: ScrollSettle;
let staged:PixelFrame|undefined;
let stagedRegions:ScrollDynamicRegion[]=[];
let previewDirty=false;
function clearStage(){staged?.pixels.fill(0);staged=undefined;stagedRegions=[];}
let previewTask:Promise<void>|undefined,previewEpoch=0;
async function encodePreview(preview:PixelFrame){
  try{
    // Native bitmap bytes are BGRA; encoding never blocks capture or matching.
    const pixels=preview.pixels;
    for(let i=0;i<pixels.length;i+=4){const blue=pixels[i];pixels[i]=pixels[i+2];pixels[i+2]=blue;}
    const png=await sharp(Buffer.from(pixels.buffer,pixels.byteOffset,pixels.byteLength),{raw:{width:preview.width,height:preview.height,channels:4}}).png({compressionLevel:1}).toBuffer();
    return 'data:image/png;base64,'+png.toString('base64');
  }finally{preview.pixels.fill(0);}
}
async function reply(id:number,result:unknown,preview:PixelFrame|null,encoded:boolean,extra:Record<string,unknown>={},background=false){
  if(!preview||!encoded){parentPort!.postMessage({id,result,preview,...extra},preview?[preview.pixels.buffer as ArrayBuffer]:[]);return;}
  if(!background){await previewTask;parentPort!.postMessage({id,result,previewImage:await encodePreview(preview),...extra});return;}
  if(previewTask){preview.pixels.fill(0);previewDirty=true;parentPort!.postMessage({id,result,...extra});return;}
  const epoch=previewEpoch;
  const task=encodePreview(preview).then(previewImage=>{if(epoch===previewEpoch)parentPort!.postMessage({event:'preview',previewImage});}).catch(error=>{if(epoch===previewEpoch)parentPort!.postMessage({event:'preview-error',error:error instanceof Error?error.message:String(error)});}).finally(()=>{if(previewTask===task)previewTask=undefined;});
  previewTask=task;parentPort!.postMessage({id,result,previewQueued:true,...extra});
}
parentPort!.on('message', async ({ id, kind, value,encodePreview=false }) => {
  try {
    let result;
    if (kind === 'configure'||kind==='restart') {
      clearStage();previewEpoch++;
      if(kind==='restart'){storage?.reset();engine=new ScrollStitch(storage,true);}
      result = engine.configure(value.options, value.source);
      previewDirty=true;
      settling = new ScrollSettle(value.options, value.source);
    } else if(kind==='track'||kind==='track-batch'){
      clearStage();const frames=(kind==='track'?[value.frame]:value.frames) as (PixelFrame&{capturedAt?:number})[];
      if(!Array.isArray(frames)||!frames.length||frames.length>16)throw Error('采集帧队列无效');
      try{
        let result=engine.status(),rejected=0;
        // Preserve every forward frontier before a possible reversal in this batch.
        // Preview rendering is coalesced below; matching stays chronological.
        for(const frame of frames){
          const stable=settling.observe(frame,frame.capturedAt??performance.now());
          result=engine.sample(frame,stable?settling.dynamicRegions():[],true);
          if(result.match==='first'||result.match==='accepted')previewDirty=true;
          if(result.match==='ambiguous')rejected++;
        }
        if(result.fixed)settling.excludeFixed(result.fixed.start,result.fixed.end);
        const preview=value.preview&&previewDirty&&!previewTask?engine.preview():null;if(preview)previewDirty=false;
        await reply(id,result,preview,encodePreview,{rejected},true);
      }finally{for(const frame of frames)frame.pixels.fill(0);}
      return;
    } else if(kind==='inspect'){
      const height=Math.min(engine.status().height,Math.max(96,Math.min(640,value.height))),y=Math.max(0,Math.min(engine.status().height-height,Math.round(value.position*engine.status().height-height/2)));
      const preview=engine.preview({y,height});parentPort!.postMessage({id,preview},preview?[preview.pixels.buffer as ArrayBuffer]:[]);return;
    } else if(kind==='preview'){
      await previewTask;const preview=engine.preview();previewDirty=false;await reply(id,engine.status(),preview,encodePreview);return;
    } else if(kind==='stage'){
      clearStage();const frame=value.frame as PixelFrame;
      if(!frame||!(frame.pixels instanceof Uint8Array))throw Error('采集像素帧无效');
      const stable=!value.monitored||settling.observe(frame,performance.now(),value.fast?80:280);
      if(!stable&&value.moving&&engine.status().count&&!engine.status().pending){
        try{
          const result=engine.sample(frame,[],true);
          if(result.match==='accepted'){
            const preview=engine.preview();
            await reply(id,result,preview,encodePreview,{stable:false,moving:true},true);return;
          }
        }finally{frame.pixels.fill(0);}
        parentPort!.postMessage({id,stable:false});return;
      }
      if(stable){staged=frame;stagedRegions=value.monitored?settling.dynamicRegions():[];}else frame.pixels.fill(0);
      parentPort!.postMessage({id,stable});return;
    } else if(kind==='release-frame'){
      clearStage();parentPort!.postMessage({id});return;
    } else if(kind==='metrics'){
      parentPort!.postMessage({id,...engine.storageStats()});return;
    } else if(kind==='commit'){
      if(!staged)throw Error('稳定像素帧已失效');
      if(value?.recover&&engine.status().pending)engine.discard();
      try{result=engine.sample(staged,stagedRegions);}finally{clearStage();}
    } else if (kind === 'settle-reset' || kind === 'observe') {
      if (!settling) throw Error('长截图尚未设置');
      if (kind === 'settle-reset') {clearStage();settling.reset();}
      parentPort!.postMessage({
        id,
        stable: kind === 'observe' && settling.observe(value, performance.now()),
      });
      return;
    } else if (kind === 'sample') result = engine.sample(value);
    else if (kind === 'join') result = engine.join(value);
    else if (kind === 'undo') {previewEpoch++;result = engine.undo();}
    else if (kind === 'discard') result = engine.discard();
    else if (kind === 'output') {
      const output = engine.output();
      parentPort!.postMessage({ id, output }, [output.pixels.buffer as ArrayBuffer]);
      return;
    } else throw Error('拼接操作无效');
    if(result?.fixed)settling.excludeFixed(result.fixed.start,result.fixed.end);
    const preview = (kind==='commit'||kind==='sample')&&['unchanged','ambiguous','backwards'].includes(result!.match)?null:engine.preview();
    await reply(id,result,preview,encodePreview,{},kind!=='undo');
  } catch (error) {
    if(kind==='stage'&&value?.frame?.pixels instanceof Uint8Array)value.frame.pixels.fill(0);
    parentPort!.postMessage({ id, error: error instanceof Error ? error.message : String(error),limit:error instanceof ScrollCaptureLimit });
  }
});
