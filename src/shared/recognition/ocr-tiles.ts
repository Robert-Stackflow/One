import { imageDimensions } from '../capture/image-limits';
import { OCR_EDGE, OCR_PIXELS } from './ocr-limits';
export interface OCRRect { left:number;top:number;width:number;height:number }
export interface OCRTile extends OCRRect { index:number;core:OCRRect }
export const OCR_TILE_EDGE=2048,OCR_TILE_OVERLAP=128;
export const OCR_SEAM_REPAIRS=16,OCR_SEAM_PIXELS=8_000_000,OCR_SEAM_VERSION='seam-1';
export function ocrRect(value:unknown,size:{width:number;height:number}):OCRRect{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==4||!['left','top','width','height'].every(key=>Object.hasOwn(value,key)))throw Error('局部识别区域无效');
  const rect=value as OCRRect;
  if(!Object.values(rect).every(Number.isSafeInteger)||rect.left<0||rect.top<0||rect.width<1||rect.height<1||rect.left+rect.width>size.width||rect.top+rect.height>size.height)throw Error('局部识别区域超出原图');
  return {...rect};
}
export function planOCRRegionTiles(size:{width:number;height:number},region?:OCRRect,tileEdge=OCR_TILE_EDGE):OCRTile[]{
  imageDimensions(size.width,size.height);
  if(!region)return planOCRTiles(size,tileEdge);
  const rect=ocrRect(region,size);
  return planOCRTiles(rect,tileEdge).map(tile=>({...tile,left:tile.left+rect.left,top:tile.top+rect.top,core:{...tile.core,left:tile.core.left+rect.left,top:tile.core.top+rect.top}}));
}
export function needsOCRTiles(size:{width:number;height:number}){
  imageDimensions(size.width,size.height);
  return size.width>OCR_EDGE||size.height>OCR_EDGE||size.width*size.height>OCR_PIXELS;
}
/** Balanced ownership regions avoid a tiny final strip being enlarged by the detector. */
export function planOCRTiles(size:{width:number;height:number},tileEdge=OCR_TILE_EDGE):OCRTile[]{
  imageDimensions(size.width,size.height);
  if(!Number.isSafeInteger(tileEdge)||tileEdge<512||tileEdge>OCR_TILE_EDGE)throw Error('识别分块尺寸无效');
  const step=tileEdge-2*OCR_TILE_OVERLAP,tiles:OCRTile[]=[];
  const columns=size.width<=tileEdge?1:Math.ceil(size.width/step),rows=size.height<=tileEdge?1:Math.ceil(size.height/step);
  for(let row=0;row<rows;row++)for(let column=0;column<columns;column++){
    const left=Math.floor(column*size.width/columns),top=Math.floor(row*size.height/rows);
    const core={left,top,width:Math.floor((column+1)*size.width/columns)-left,height:Math.floor((row+1)*size.height/rows)-top};
    const x=Math.max(0,left-OCR_TILE_OVERLAP),y=Math.max(0,top-OCR_TILE_OVERLAP);
    tiles.push({index:tiles.length,left:x,top:y,width:Math.min(size.width,left+core.width+OCR_TILE_OVERLAP)-x,
      height:Math.min(size.height,top+core.height+OCR_TILE_OVERLAP)-y,core});
  }
  return tiles;
}
