import {displayAccelerator} from '../display-shortcuts';

export const captureShortcutDefinitions=[
  {id:'region',label:'区域截图',default:'Ctrl+Shift+F8'},
  {id:'copy',label:'截屏并自动复制',default:''},
  {id:'custom',label:'自定义截屏',default:''},
  {id:'screen',label:'显示器截图',default:''},
  {id:'pinClipboard',label:'贴出剪贴板',default:'Ctrl+Shift+F9'},
  {id:'togglePins',label:'隐藏 / 显示全部贴图',default:''},
  {id:'nextPinGroup',label:'切换贴图分组',default:''},
  {id:'recording',label:'打开录制',default:''},
] as const;
export type CaptureShortcutAction=typeof captureShortcutDefinitions[number]['id'];
export type CaptureShortcuts=Record<CaptureShortcutAction,string>;
export interface CaptureShortcutState {paused:boolean;entries:Record<CaptureShortcutAction,{active:boolean;error:string}>}
export const defaultCaptureShortcuts=():CaptureShortcuts=>Object.fromEntries(captureShortcutDefinitions.map(item=>[item.id,item.default])) as CaptureShortcuts;
export function captureAccelerator(value:string){
  if(/^F(?:[1-9]|1\d|2[0-4])$/i.test(value))return value.toUpperCase();
  return displayAccelerator(value.replace(/\b(Up|Down|Left|Right)\b/gi,key=>'Arrow'+key[0].toUpperCase()+key.slice(1).toLowerCase()));
}
export function validateCaptureShortcuts(value:unknown):CaptureShortcuts{
  if(value===undefined)return defaultCaptureShortcuts();
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('截图与录制快捷键设置无效');
  const result={...defaultCaptureShortcuts(),...value};
  for(const {id} of captureShortcutDefinitions){if(typeof result[id]!=='string')throw Error('截图与录制快捷键设置无效');captureAccelerator(result[id]);}
  return Object.fromEntries(captureShortcutDefinitions.map(({id})=>[id,result[id]])) as CaptureShortcuts;
}
export const captureSystemCommands={
  'capture-region':'region','capture-copy':'copy','capture-custom':'custom','capture-screen':'screen',
  'pins-clipboard':'pinClipboard','pins-toggle':'togglePins','pins-next-group':'nextPinGroup',
  'capture-recording':'recording','capture-clipboard':'editClipboard',
} as const;
export type CaptureSystemCommand=keyof typeof captureSystemCommands;
export type CaptureSystemAction=typeof captureSystemCommands[CaptureSystemCommand];
export const isCaptureSystemCommand=(value:string):value is CaptureSystemCommand=>Object.hasOwn(captureSystemCommands,value);
