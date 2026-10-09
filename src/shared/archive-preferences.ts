import {archiveResources,archiveLevel,defaultArchiveResources,type ArchiveResources} from './archive-options';
export const archiveFormats=['zip','7z','tar','tar.gz','tar.xz','gz','xz'] as const;
export interface ArchivePreferences extends ArchiveResources {
  doubleClick:'smart'|'browse';
  defaultFormat:typeof archiveFormats[number];
  openCompleted:boolean;
  propagateZone:boolean;
  conflict:import('./archive').ArchiveConflict;
  compressionLevel:number;
}
export const defaultArchivePreferences=():ArchivePreferences=>({doubleClick:'smart',defaultFormat:'zip',openCompleted:false,propagateZone:true,conflict:'rename',compressionLevel:6,...defaultArchiveResources()});
export function validateArchivePreferences(value:unknown):ArchivePreferences {
  const defaults=defaultArchivePreferences();
  if(value===undefined)return defaults;
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('压缩与解压设置无效');
  const input=value as ArchivePreferences;
  if(!['smart','browse'].includes(input.doubleClick)||!archiveFormats.includes(input.defaultFormat)||typeof input.openCompleted!=='boolean')throw Error('压缩与解压设置无效');
  const conflict=input.conflict??defaults.conflict;if(!['rename','skip','replace'].includes(conflict))throw Error('解压同名文件设置无效');
  const propagateZone=input.propagateZone===undefined?defaults.propagateZone:input.propagateZone;
  if(typeof propagateZone!=='boolean')throw Error('来源标记设置无效');
  return {doubleClick:input.doubleClick,defaultFormat:input.defaultFormat,openCompleted:input.openCompleted,propagateZone,conflict,compressionLevel:archiveLevel(input.compressionLevel===undefined?defaults.compressionLevel:input.compressionLevel),...archiveResources(input)};
}
export interface ArchiveAssociationState {registered:boolean;available:boolean}
