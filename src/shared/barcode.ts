export const barcodeLimits={bytes:32*1024*1024,pixels:16*1024*1024,side:16384,symbols:64,text:1024*1024,totalText:4*1024*1024,timeout:15000} as const;
export interface BarcodeImage {name:string;bytes:Uint8Array}
export interface BarcodePoint {x:number;y:number}
export interface BarcodeResult {format:string;text:string;hex:string;contentType:string;position:BarcodePoint[];rotation:number}
export interface BarcodeDecoded {width:number;height:number;results:BarcodeResult[];warnings:string[];elapsed:number}
export interface BarcodeCrop {x:number;y:number;width:number;height:number}
export interface BarcodeCaptureImage {bytes:Uint8Array;width:number;height:number}
export function barcodeURL(text:string){try{const url=new URL(text);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?url.href:null;}catch{return null;}}
export function validateBarcodeCrop(value:unknown,width:number,height:number):BarcodeCrop {
 const r=value as BarcodeCrop;if(!r||!['x','y','width','height'].every(k=>Number.isInteger(r[k as keyof BarcodeCrop]))||r.x<0||r.y<0||r.width<2||r.height<2||r.x+r.width>width||r.y+r.height>height)throw Error('框选区域无效');return {x:r.x,y:r.y,width:r.width,height:r.height};
}
