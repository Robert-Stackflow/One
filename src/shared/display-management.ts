export const displayParameters=['brightness','contrast','volume'] as const;
export type DisplayParameter=typeof displayParameters[number];
import {validateDisplayProfiles,type DisplayProfile} from './display-profiles';
export interface DisplayPreferences {linkedBrightness:boolean;excluded:string[];profiles:DisplayProfile[]}
export const defaultDisplayPreferences=():DisplayPreferences=>({linkedBrightness:false,excluded:[],profiles:[]});
export function validateDisplayPreferences(value:unknown):DisplayPreferences {
 if(value===undefined)return defaultDisplayPreferences();
 const p=value as DisplayPreferences;
 if(!p||typeof p!=='object'||typeof p.linkedBrightness!=='boolean'||!Array.isArray(p.excluded)||p.excluded.length>128||p.excluded.some(id=>typeof id!=='string'||!/^[0-9a-f]{64}$/.test(id)))throw Error('显示器联动设置无效');
 return {linkedBrightness:p.linkedBrightness,excluded:[...new Set(p.excluded)],profiles:validateDisplayProfiles(p.profiles)};
}
export interface DisplayWriteResult {id:string;control?:DisplayControl;error?:string}
export interface DisplayControl {supported:boolean;method:string;error:string;value?:number;minimum?:number;maximum?:number;raw?:number}
export interface ManagedDisplay {
 id:string;identity:'serial'|'connection';name:string;source:string;internal:boolean;virtual:boolean;primary:boolean;cloned:boolean;
 width:number;height:number;left:number;top:number;rotation:number;refreshRate:number;
 controls?:Record<DisplayParameter,DisplayControl>;error?:string;
}
