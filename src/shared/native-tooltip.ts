import {nativePreviewBounds,type NativePreviewBounds} from './native-preview';
// Leave room for the shared popup shadow instead of clipping it at the HWND edge.
export const nativeTooltipMargin=24;
export interface NativeTooltipData {bounds:NativePreviewBounds;text:string;side:'top'|'right'|'bottom'|'left';arrow:number;font:string}
export function nativeTooltipData(value:unknown):NativeTooltipData|null{
 if(value===null)return null;
 if(!value||typeof value!=='object')throw Error('提示信息无效');
 const v=value as NativeTooltipData;
 if(typeof v.text!=='string'||v.text.length>4096||!['top','right','bottom','left'].includes(v.side)||typeof v.arrow!=='number'||!Number.isFinite(v.arrow)||v.arrow<0||v.arrow>32768||typeof v.font!=='string'||v.font.length>512)throw Error('提示信息无效');
 return {bounds:nativePreviewBounds(v.bounds),text:v.text,side:v.side,arrow:v.arrow,font:v.font};
}
