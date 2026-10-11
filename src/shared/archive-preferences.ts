import {archiveResources,archiveLevel,archiveBudget,defaultArchiveResources,type ArchiveResources,type ArchiveBudget} from './archive-options';
import {archiveCompression,defaultArchiveCompression,type ArchiveCompression} from './archive-compression';
export const archiveFormats=['zip','7z','tar','tar.gz','tar.xz','gz','xz'] as const;
export interface ArchivePreferences extends ArchiveResources,ArchiveBudget,ArchiveCompression {
  doubleClick:'smart'|'browse';
  defaultFormat:typeof archiveFormats[number];
  openCompleted:boolean;
  closeOnComplete:boolean;
  propagateZone:boolean;
  scanOnExtract:boolean;
  conflict:import('./archive').ArchiveConflict;
  compressionLevel:number;
}
export const defaultArchivePreferences=():ArchivePreferences=>({doubleClick:'smart',defaultFormat:'zip',openCompleted:false,closeOnComplete:false,propagateZone:true,scanOnExtract:false,conflict:'rename',compressionLevel:6,...defaultArchiveResources(),...archiveBudget(),...defaultArchiveCompression()});
export function validateArchivePreferences(value:unknown):ArchivePreferences {
  const defaults=defaultArchivePreferences();
  if(value===undefined)return defaults;
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('压缩与解压设置无效');
  const input=value as ArchivePreferences;
  if(!['smart','browse'].includes(input.doubleClick)||!archiveFormats.includes(input.defaultFormat)||typeof input.openCompleted!=='boolean')throw Error('压缩与解压设置无效');
  const closeOnComplete=input.closeOnComplete===undefined?defaults.closeOnComplete:input.closeOnComplete;
  if(typeof closeOnComplete!=='boolean')throw Error('自动关闭设置无效');
  const conflict=input.conflict??defaults.conflict;if(!['rename','skip','replace'].includes(conflict))throw Error('解压同名文件设置无效');
  const propagateZone=input.propagateZone===undefined?defaults.propagateZone:input.propagateZone;
  if(typeof propagateZone!=='boolean')throw Error('来源标记设置无效');
  const scanOnExtract=input.scanOnExtract===undefined?defaults.scanOnExtract:input.scanOnExtract;
  if(typeof scanOnExtract!=='boolean')throw Error('解压扫描设置无效');
  const resources=archiveResources(input);
  return {doubleClick:input.doubleClick,defaultFormat:input.defaultFormat,openCompleted:input.openCompleted,closeOnComplete,propagateZone,scanOnExtract,conflict,compressionLevel:archiveLevel(input.compressionLevel===undefined?defaults.compressionLevel:input.compressionLevel),...resources,...archiveBudget(input,resources),...archiveCompression(input)};
}
export interface ArchiveAssociationState {registered:boolean;available:boolean;needsUpdate?:boolean}
