import { imageDimensions } from '../capture/image-limits';
import { OCR_EDGE, OCR_PIXELS } from './ocr-limits';
export interface OCRRect { left:number;top:number;width:number;height:number }
export interface OCRTile extends OCRRect { index:number;core:OCRRect }
export const OCR_TILE_EDGE=2048,OCR_TILE_OVERLAP=128;
export function needsOCRTiles(size:{width:number;height:number}){
  imageDimensions(size.width,size.height);
  return size.width>OCR_EDGE||size.height>OCR_EDGE||size.width*size.height>OCR_PIXELS;
}
/** Non-overlapping ownership regions plus context on every internal edge. */
export function planOCRTiles(size:{width:number;height:number}):OCRTile[]{
  imageDimensions(size.width,size.height);
  const step=OCR_TILE_EDGE-2*OCR_TILE_OVERLAP,tiles:OCRTile[]=[];
  for(let top=0;top<size.height;top+=step)for(let left=0;left<size.width;left+=step){
    const core={left,top,width:Math.min(step,size.width-left),height:Math.min(step,size.height-top)};
    const x=Math.max(0,left-OCR_TILE_OVERLAP),y=Math.max(0,top-OCR_TILE_OVERLAP);
    tiles.push({index:tiles.length,left:x,top:y,width:Math.min(size.width,left+core.width+OCR_TILE_OVERLAP)-x,
      height:Math.min(size.height,top+core.height+OCR_TILE_OVERLAP)-y,core});
  }
  return tiles;
}
