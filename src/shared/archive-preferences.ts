export const archiveFormats=['zip','7z','tar','tar.gz','tar.xz','gz','xz'] as const;
export interface ArchivePreferences {
  doubleClick:'smart'|'browse';
  defaultFormat:typeof archiveFormats[number];
  openCompleted:boolean;
}
export const defaultArchivePreferences=():ArchivePreferences=>({doubleClick:'smart',defaultFormat:'zip',openCompleted:false});
export function validateArchivePreferences(value:unknown):ArchivePreferences {
  const defaults=defaultArchivePreferences();
  if(value===undefined)return defaults;
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('压缩与解压设置无效');
  const input=value as ArchivePreferences;
  if(!['smart','browse'].includes(input.doubleClick)||!archiveFormats.includes(input.defaultFormat)||typeof input.openCompleted!=='boolean')throw Error('压缩与解压设置无效');
  return {doubleClick:input.doubleClick,defaultFormat:input.defaultFormat,openCompleted:input.openCompleted};
}
export interface ArchiveAssociationState {registered:boolean;available:boolean}
