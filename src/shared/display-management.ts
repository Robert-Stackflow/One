export const displayParameters=['brightness','contrast','volume'] as const;
export type DisplayParameter=typeof displayParameters[number];
export interface DisplayControl {supported:boolean;method:string;error:string;value?:number;minimum?:number;maximum?:number;raw?:number}
export interface ManagedDisplay {
 id:string;identity:'serial'|'connection';name:string;source:string;internal:boolean;virtual:boolean;primary:boolean;cloned:boolean;
 width:number;height:number;left:number;top:number;rotation:number;refreshRate:number;
 controls?:Record<DisplayParameter,DisplayControl>;error?:string;
}
