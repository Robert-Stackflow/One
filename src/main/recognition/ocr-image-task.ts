import { createHash } from 'node:crypto';
import type { OCRResult } from '../../shared/recognition/ocr';
import { needsOCRTiles,planOCRRegionTiles,type OCRRect } from '../../shared/recognition/ocr-tiles';
import { decodedOCRTiles } from './ocr-tile-reader';
import { mergeOCRTiles,type OCRTileResult } from './ocr-tile-merge';
export async function recognizeOCRImage(png:Buffer,size:{width:number;height:number},signal:AbortSignal,
  recognize:(png:Buffer,size:{width:number;height:number},progress:(value:number)=>void)=>Promise<OCRResult>,
  progress:(value:number)=>void,worker?:string,region?:OCRRect,options:{forceTiles?:boolean;tileEdge?:number}={}):Promise<OCRResult>{
  signal.throwIfAborted();if(!region&&!options.forceTiles&&!needsOCRTiles(size))return recognize(png,size,progress);
  const input=Buffer.from(png),dimensions={...size},count=planOCRRegionTiles(dimensions,region,options.tileEdge).length,results:OCRTileResult[]=[];
  try{
    let words=0,tokens=0;
    for await(const {tile,png:chunk} of decodedOCRTiles(input,dimensions,signal,worker,region,options.tileEdge)){
      const result=await recognize(chunk,{width:tile.width,height:tile.height},value=>progress((tile.index+Math.max(0,Math.min(1,value)))/count));
      signal.throwIfAborted();words+=result.words.length;
      tokens+=result.document?.blocks.reduce((sum,block)=>sum+block.lines.reduce((sum,line)=>sum+line.tokens.length,0),0)||0;
      if(words>100000||tokens>400000)throw Error('长图识别结果过多，输入已保留，请裁剪后重试');
      results.push({tile,result});progress((tile.index+1)/count);
    }
    signal.throwIfAborted();return mergeOCRTiles(results,dimensions,createHash('sha256').update(input).digest('hex'));
  }finally{input.fill(0);}
}
