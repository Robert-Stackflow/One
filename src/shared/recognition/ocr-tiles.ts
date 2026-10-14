import { imageDimensions } from '../capture/image-limits';
import { OCR_EDGE, OCR_PIXELS } from './ocr-limits';
export interface OCRRect { left:number;top:number;width:number;height:number }
export interface OCRTile extends OCRRect { index:number;core:OCRRect }
export const OCR_TILE_EDGE=2048,OCR_TILE_OVERLAP=128;
export function ocrRect(value:unknown,size:{width:number;height:number}):OCRRect{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==4||!['left','top','width','height'].every(key=>Object.hasOwn(value,key)))throw Error('局部识别区域无效');
  const rect=value as OCRRect;
  if(!Object.values(rect).every(Number.isSafeInteger)||rect.left<0||rect.top<0||rect.width<1||rect.height<1||rect.left+rect.width>size.width||rect.top+rect.height>size.height)throw Error('局部识别区域超出原图');
  return {...rect};
}
export function planOCRRegionTiles(size:{width:number;height:number},region?:OCRRect):OCRTile[]{
  imageDimensions(size.width,size.height);
  if(!region)return planOCRTiles(size);
  const rect=ocrRect(region,size);
  return planOCRTiles(rect).map(tile=>({...tile,left:tile.left+rect.left,top:tile.top+rect.top,core:{...tile.core,left:tile.core.left+rect.left,top:tile.core.top+rect.top}}));
}
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
