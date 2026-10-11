import type {ImageConvertResult} from './image-convert';

export interface ImageMetadataOptions {removeExif:boolean;removeGps:boolean;removeXmp:boolean;removeIptc:boolean}
export interface ImageMetadataChange {tag:string;before?:string;after?:string}
export interface ImageMetadataDiff {count:number;changes:ImageMetadataChange[];truncated:boolean}
export interface ImageMetadataResult extends ImageConvertResult {metadataDiff?:ImageMetadataDiff}
export interface ImageMetadataProgress {done:number;total:number;current?:string;result?:ImageMetadataResult}
export interface ImageMetadataSummary {results:ImageMetadataResult[];cancelled:boolean}

export function imageMetadataDiff(before:Record<string,unknown>,after:Record<string,unknown>):ImageMetadataDiff{
 const changes:ImageMetadataChange[]=[];let count=0;
 const display=(value:unknown)=>typeof value==='string'?value.slice(0,160):JSON.stringify(value)?.slice(0,160)??String(value).slice(0,160);
 for(const tag of new Set([...Object.keys(before),...Object.keys(after)])){
  if(tag==='SourceFile')continue;
  const old=before[tag],next=after[tag];if(JSON.stringify(old)===JSON.stringify(next))continue;
  count++;if(changes.length<100)changes.push({tag,before:old===undefined?undefined:display(old),after:next===undefined?undefined:display(next)});
 }
 return {count,changes,truncated:count>changes.length};
}

export function imageMetadataOptions(value:unknown):ImageMetadataOptions{
 if(!value||typeof value!=='object')throw Error('元数据清理设置无效');
 const options=value as ImageMetadataOptions;
 if([options.removeExif,options.removeGps,options.removeXmp,options.removeIptc].some(item=>typeof item!=='boolean')||![options.removeExif,options.removeGps,options.removeXmp,options.removeIptc].some(Boolean))throw Error('请至少选择一类要移除的元数据');
 return {removeExif:options.removeExif,removeGps:options.removeGps,removeXmp:options.removeXmp,removeIptc:options.removeIptc};
}
