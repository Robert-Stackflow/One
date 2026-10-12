import {contextBridge,ipcRenderer} from 'electron';
import type {ScrollAPI} from '../shared/capture/scroll-capture';
import type {OneAPI} from '../shared/types';
const invoke=(name:string,...args:unknown[])=>ipcRenderer.invoke('one:'+name,...args);
const listen=(name:string,callback:(value:any)=>void)=>{const handler=(_event:Electron.IpcRendererEvent,value:unknown)=>callback(value);ipcRenderer.on('one:'+name,handler);return()=>ipcRenderer.removeListener('one:'+name,handler);};
const scrollCapture:ScrollAPI={state:()=>invoke('scroll-state'),command:(token,command)=>invoke('scroll-command',token,command),onChange:callback=>listen('scroll-view',callback),onCloseRequest:callback=>listen('scroll-close-request',callback),answerClose:(token,accepted)=>invoke('scroll-close-answer',token,accepted)};
const common:Pick<OneAPI,'appearance'|'onAppearance'|'uiFontSource'|'diagnosticsReport'|'windowAction'|'windowState'|'onWindowState'>={
  appearance:()=>invoke('appearance'),onAppearance:callback=>listen('appearance',callback),uiFontSource:family=>invoke('ui-font-source',family),diagnosticsReport:(kind,detail)=>invoke('diagnostics-report',kind,detail),
  windowAction:action=>invoke('window-action',action),windowState:()=>invoke('window-state'),onWindowState:callback=>listen('window-state',callback),
};
contextBridge.exposeInMainWorld('one',{...common,scrollCapture});
