import {planOCRSeamRepairs,type OCRSeamRepair} from './ocr-seam-repair';
import { createHash } from 'node:crypto';
import type { OCRResult } from '../../shared/recognition/ocr';
import { needsOCRTiles,planOCRRegionTiles,ocrRect,type OCRRect } from '../../shared/recognition/ocr-tiles';
import { decodedOCRTiles } from './ocr-tile-reader';
import { mergeOCRTiles,type OCRTileResult } from './ocr-tile-merge';
export async function recognizeOCRImage(png:Buffer,size:{width:number;height:number},signal:AbortSignal,
  recognize:(png:Buffer,size:{width:number;height:number},progress:(value:number)=>void)=>Promise<OCRResult>,
  progress:(value:number)=>void,worker?:string,region?:OCRRect,options:{forceTiles?:boolean;tileEdge?:number}={}):Promise<OCRResult>{
  signal.throwIfAborted();if(!region&&!options.forceTiles&&!needsOCRTiles(size))return recognize(png,size,progress);
  const dimensions={...size},target=region?ocrRect(region,dimensions):undefined,edge=options.tileEdge,count=planOCRRegionTiles(dimensions,target,edge).length;
  const input=Buffer.from(png),results:OCRTileResult[]=[];
  try{
    let words=0,tokens=0;let repairs:OCRSeamRepair[]=[];
    for await(const {tile,png:chunk} of decodedOCRTiles(input,dimensions,signal,worker,target,edge,()=>{repairs=planOCRSeamRepairs(results,dimensions,target,edge);return repairs.map(value=>value.tile);})){
      const update=(value:number)=>progress(tile.index<count ? .9*(tile.index+Math.max(0,Math.min(1,value)))/count:.9+.1*(tile.index-count+Math.max(0,Math.min(1,value)))/repairs.length);
      const result=await recognize(chunk,{width:tile.width,height:tile.height},update);
      signal.throwIfAborted();words+=result.words.length;
      tokens+=result.document?.blocks.reduce((sum,block)=>sum+block.lines.reduce((sum,line)=>sum+line.tokens.length,0),0)||0;
      if(words>100000||tokens>400000)throw Error('长图识别结果过多，输入已保留，请裁剪后重试');
      results.push({tile,result,...(tile.index>=count?{repair:repairs[tile.index-count]}:{})});update(1);
    }
    signal.throwIfAborted();const result=mergeOCRTiles(results,dimensions,createHash('sha256').update(input).digest('hex'));progress(1);return result;
  }finally{input.fill(0);}
}
