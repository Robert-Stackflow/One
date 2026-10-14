import {ocrRect,type OCRRect} from './ocr-tiles';
import type {TextRotation} from './text-geometry';
export const FORMULA_SVG_BYTES=5*1024*1024,FORMULA_PNG_BYTES=8*1024*1024,FORMULA_RENDER_PIXELS=8_000_000;
export interface FormulaCrop {region:OCRRect;rotation:TextRotation}
export function formulaCrop(value:unknown,size:{width:number;height:number}):FormulaCrop{
  const crop=value as FormulaCrop;
  if(!crop||typeof crop!=='object'||Array.isArray(crop)||Object.keys(crop).length!==2||!Object.hasOwn(crop,'region')||!Object.hasOwn(crop,'rotation')||![0,1,2,3].includes(crop.rotation))throw Error('公式裁剪参数无效');
  const region=ocrRect(crop.region,size);if(region.width*region.height>4_000_000)throw Error('裁剪区域超过 400 万像素，请缩小范围');
  return {region,rotation:crop.rotation};
}
export type FormulaImageOutput='copy'|'png'|'svg';
