import {displayParameters,type DisplayControl,type DisplayParameter} from './display-management';
export interface DisplayProfileTarget {id:string;name:string;identity:'serial'|'connection';values:Partial<Record<DisplayParameter,number>>}
export interface DisplayProfile {id:string;name:string;targets:DisplayProfileTarget[]}
export interface DisplayProfileWarning {name:string;error:string}
export interface DisplayProfileCapture {targets:DisplayProfileTarget[];warnings:DisplayProfileWarning[]}
export interface DisplayProfileResult {id:string;name:string;controls:Partial<Record<DisplayParameter,DisplayControl>>;errors:Partial<Record<DisplayParameter,string>>;error?:string}
export const validProfileId=(id:unknown):id is string=>typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);
export function profileName(value:unknown):string {
 if(typeof value!=='string'||!value.trim()||value.length>60||/[\x00-\x1f\x7f]/.test(value))throw Error('方案名称需为 1 至 60 个字符');return value.trim();
}
export function validateDisplayProfile(value:unknown):DisplayProfile {
 const p=value as DisplayProfile;if(!p||!validProfileId(p.id)||!Array.isArray(p.targets)||!p.targets.length||p.targets.length>64)throw Error('显示器方案无效');
 const ids=new Set<string>();const targets=p.targets.map(t=>{
  if(!t||typeof t.id!=='string'||!/^[0-9a-f]{64}$/.test(t.id)||ids.has(t.id)||typeof t.name!=='string'||!t.name||t.name.length>2048||!['serial','connection'].includes(t.identity)||!t.values||typeof t.values!=='object'||Array.isArray(t.values))throw Error('方案显示器无效');ids.add(t.id);
  const keys=Object.keys(t.values);if(!keys.length||keys.some(k=>!displayParameters.includes(k as DisplayParameter)))throw Error('方案参数无效');
  const values:DisplayProfileTarget['values']={};for(const key of keys as DisplayParameter[]){const n=t.values[key];if(typeof n!=='number'||!Number.isInteger(n)||n<0||n>100)throw Error('方案参数需为 0 至 100 的整数');values[key]=n;}
  return {id:t.id,name:t.name,identity:t.identity,values};
 });return {id:p.id,name:profileName(p.name),targets};
}
export function validateDisplayProfiles(value:unknown):DisplayProfile[] {
 if(value===undefined)return [];if(!Array.isArray(value)||value.length>16)throw Error('最多保存 16 个显示器方案');
 const profiles=value.map(validateDisplayProfile),ids=new Set<string>(),names=new Set<string>();
 for(const p of profiles){const name=p.name.toLowerCase();if(ids.has(p.id)||names.has(name))throw Error('显示器方案名称或标识重复');ids.add(p.id);names.add(name);}return profiles;
}
