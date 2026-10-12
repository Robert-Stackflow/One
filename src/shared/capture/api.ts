import type {Rectangle} from './region';
import type {CustomCapture} from './custom-capture';
import type {CaptureResult} from './capture-workflow';
export type CaptureMode='region'|'screen'|'copy'|'free'|'polygon'|'desktop';
export interface CaptureOptions {hideMainWindow?:boolean}
export function captureOptions(value:unknown):CaptureOptions{
  if(value===undefined)return {};
  if(!value||typeof value!=='object'||Array.isArray(value)||('hideMainWindow' in value&&value.hideMainWindow!==undefined&&typeof value.hideMainWindow!=='boolean'))throw Error('截图窗口选项无效');
  return {hideMainWindow:(value as CaptureOptions).hideMainWindow===true};
}
export interface CaptureScreen {id:number;name:string;width:number;height:number}
export interface CaptureWindowChoice {token:string;name:string;thumbnail:string;bounds:Rectangle}
export interface CaptureCommands {
  captureState():Promise<{screens:CaptureScreen[];displayId:number;active:boolean}>;
  captureDisplays():Promise<{id:number;thumbnail:string}[]>;
  captureTake(mode:CaptureMode,displayId?:number,options?:CaptureOptions):Promise<CaptureResult|null>;
  captureCustom(value:CustomCapture,displayId?:number,options?:CaptureOptions):Promise<CaptureResult|null>;
  captureWindows():Promise<CaptureWindowChoice[]>;
  captureWindow(token:string,options?:CaptureOptions):Promise<CaptureResult|null>;
  captureWindowSet(tokens:string[],options?:CaptureOptions,placements?:{token:string;x:number;y:number}[]):Promise<CaptureResult|null>;
}
