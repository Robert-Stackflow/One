export type ImageConvertFormat='original'|'png'|'jpeg'|'webp'|'gif'|'tiff';
export interface ImageCropRule {x:number;y:number;width:number;height:number;ratio?:number}
export interface ImageConvertOptions {format:ImageConvertFormat;quality:number;maxWidth?:number;maxHeight?:number;preserveMetadata:boolean;crop?:ImageCropRule}
export interface ImageConvertResult {source:string;output?:string;before:number;after?:number;status:'done'|'error'|'cancelled';message?:string}
export interface ImageConvertProgress {done:number;total:number;current?:string;result?:ImageConvertResult}
export interface ImageConvertSummary {results:ImageConvertResult[];cancelled:boolean}
export interface ImageCropPreview {url:string;width:number;height:number;format:string}
export const imageConvertExtensions=['png','jpg','jpeg','webp','gif','tif','tiff'] as const;
export function imageCropRule(value:unknown):ImageCropRule{
 if(!value||typeof value!=='object')throw Error('裁剪区域无效');const rule=value as ImageCropRule;
 if(![rule.x,rule.y,rule.width,rule.height].every(Number.isFinite)||rule.x<0||rule.y<0||rule.width<=0||rule.height<=0||rule.x+rule.width>1.000001||rule.y+rule.height>1.000001)throw Error('裁剪区域需位于图片范围内');
 if(rule.ratio!==undefined&&(!Number.isFinite(rule.ratio)||rule.ratio<0.1||rule.ratio>10))throw Error('裁剪比例无效');
 return {x:rule.x,y:rule.y,width:rule.width,height:rule.height,ratio:rule.ratio};
}
export function imageCropBounds(rule:ImageCropRule,width:number,height:number){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1)throw Error('图片尺寸无效');
 let cropWidth=Math.max(1,Math.min(width,Math.round(rule.width*width))),cropHeight=Math.max(1,Math.min(height,Math.round(rule.height*height)));
 if(rule.ratio){if(cropWidth/cropHeight>rule.ratio)cropWidth=Math.max(1,Math.floor(cropHeight*rule.ratio));else cropHeight=Math.max(1,Math.floor(cropWidth/rule.ratio));}
 const centerX=(rule.x+rule.width/2)*width,centerY=(rule.y+rule.height/2)*height;
 const left=Math.max(0,Math.min(width-cropWidth,Math.round(centerX-cropWidth/2))),top=Math.max(0,Math.min(height-cropHeight,Math.round(centerY-cropHeight/2)));
 return {left,top,width:cropWidth,height:cropHeight};
}
export function imageConvertOptions(value:unknown):ImageConvertOptions{
 if(!value||typeof value!=='object')throw Error('转换设置无效');const v=value as ImageConvertOptions;
 if(!['original','png','jpeg','webp','gif','tiff'].includes(v.format)||!Number.isInteger(v.quality)||v.quality<1||v.quality>100||typeof v.preserveMetadata!=='boolean')throw Error('转换设置无效');
 for(const key of ['maxWidth','maxHeight'] as const){const dimension=v[key];if(dimension!==undefined&&(!Number.isInteger(dimension)||dimension<1||dimension>16384))throw Error('尺寸需在 1 至 16384 像素之间');}
 const crop=v.crop===undefined?undefined:imageCropRule(v.crop);
 if(crop&&(v.format!=='original'||v.maxWidth!==undefined||v.maxHeight!==undefined))throw Error('裁剪任务必须保持原格式，不能同时缩放');
 return {format:v.format,quality:v.quality,maxWidth:v.maxWidth,maxHeight:v.maxHeight,preserveMetadata:v.preserveMetadata,crop};
}
