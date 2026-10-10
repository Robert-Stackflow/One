export interface NativePreviewBounds {x:number;y:number;width:number;height:number}
export interface NativePreviewState {token:string;status:'ready'|'error';message?:string;code?:string}
export function nativePreviewBounds(value:unknown):NativePreviewBounds{
 if(!value||typeof value!=='object')throw Error('预览区域无效');
 const result={} as NativePreviewBounds;
 for(const key of ['x','y','width','height'] as const){const n=(value as NativePreviewBounds)[key];if(typeof n!=='number'||!Number.isFinite(n)||n<0||n>32768)throw Error('预览区域无效');result[key]=n;}
 return result;
}
