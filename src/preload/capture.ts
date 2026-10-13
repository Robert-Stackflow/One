import {contextBridge,ipcRenderer} from 'electron';
import type {CaptureAPI} from '../shared/capture/capture-session';
import type {OneAPI} from '../shared/types';
const invoke=(name:string,...args:unknown[])=>ipcRenderer.invoke('one:'+name,...args);
const listen=(name:string,callback:(value:any)=>void)=>{const handler=(_event:Electron.IpcRendererEvent,value:unknown)=>callback(value);ipcRenderer.on('one:'+name,handler);return()=>ipcRenderer.removeListener('one:'+name,handler);};
const capture:CaptureAPI={
  data:()=>invoke('capture-data'),ready:(token,failure)=>invoke('capture-ready',token,failure),
  complete:request=>invoke('capture-complete',request),refresh:token=>invoke('capture-refresh',token),
  detect:(token,point)=>invoke('capture-detect',token,point),cursorTarget:(token,point)=>invoke('capture-cursor-target',token,point),
  moveCursor:(token,point)=>invoke('capture-cursor',token,point),copyColor:(token,value)=>invoke('capture-color',token,value),
  fonts:()=>invoke('capture-fonts'),selectFont:(token,family)=>invoke('capture-select-font',token,family),
  saveWatermark:(token,preset)=>invoke('capture-watermark',token,preset),chooseWatermarkImage:token=>invoke('capture-watermark-image',token),
  saveAnnotationStyle:(token,tool,style)=>invoke('capture-annotation-style',token,tool,style),
  scanSensitive:(token,png)=>invoke('capture-sensitive',token,png),cancelSensitive:token=>invoke('capture-sensitive-cancel',token),
  onCandidates:callback=>listen('capture-candidates',callback),onPreferences:callback=>listen('capture-preferences',callback),
};
const common:Pick<OneAPI,'appearance'|'onAppearance'|'uiFontSource'|'diagnosticsReport'>={appearance:()=>invoke('appearance'),onAppearance:callback=>listen('appearance',callback),uiFontSource:family=>invoke('ui-font-source',family),diagnosticsReport:(kind,detail)=>invoke('diagnostics-report',kind,detail)};
contextBridge.exposeInMainWorld('one',{...common,capture});
