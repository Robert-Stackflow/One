export type ImageConvertFormat='original'|'png'|'jpeg'|'webp'|'gif'|'tiff';
export interface ImageConvertOptions {format:ImageConvertFormat;quality:number;maxWidth?:number;maxHeight?:number;preserveMetadata:boolean}
export interface ImageConvertResult {source:string;output?:string;before:number;after?:number;status:'done'|'error'|'cancelled';message?:string}
export interface ImageConvertProgress {done:number;total:number;current?:string;result?:ImageConvertResult}
export interface ImageConvertSummary {results:ImageConvertResult[];cancelled:boolean}
export const imageConvertExtensions=['png','jpg','jpeg','webp','gif','tif','tiff'] as const;
export function imageConvertOptions(value:unknown):ImageConvertOptions{
 if(!value||typeof value!=='object')throw Error('转换设置无效');const v=value as ImageConvertOptions;
 if(!['original','png','jpeg','webp','gif','tiff'].includes(v.format)||!Number.isInteger(v.quality)||v.quality<1||v.quality>100||typeof v.preserveMetadata!=='boolean')throw Error('转换设置无效');
 for(const key of ['maxWidth','maxHeight'] as const){const dimension=v[key];if(dimension!==undefined&&(!Number.isInteger(dimension)||dimension<1||dimension>16384))throw Error('尺寸需在 1 至 16384 像素之间');}
 return {format:v.format,quality:v.quality,maxWidth:v.maxWidth,maxHeight:v.maxHeight,preserveMetadata:v.preserveMetadata};
}
