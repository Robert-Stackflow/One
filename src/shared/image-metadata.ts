import type {ImageConvertProgress,ImageConvertSummary} from './image-convert';

export interface ImageMetadataOptions {removeExif:boolean;removeGps:boolean;removeXmp:boolean;removeIptc:boolean}
export type ImageMetadataProgress=ImageConvertProgress;
export type ImageMetadataSummary=ImageConvertSummary;

export function imageMetadataOptions(value:unknown):ImageMetadataOptions{
 if(!value||typeof value!=='object')throw Error('元数据清理设置无效');
 const options=value as ImageMetadataOptions;
 if([options.removeExif,options.removeGps,options.removeXmp,options.removeIptc].some(item=>typeof item!=='boolean')||![options.removeExif,options.removeGps,options.removeXmp,options.removeIptc].some(Boolean))throw Error('请至少选择一类要移除的元数据');
 return {removeExif:options.removeExif,removeGps:options.removeGps,removeXmp:options.removeXmp,removeIptc:options.removeIptc};
}
