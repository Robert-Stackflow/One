import {contextBridge,ipcRenderer} from 'electron';
import type {PinAPI} from '../shared/pins';
import type {OneAPI} from '../shared/types';
const invoke=(name:string,...args:unknown[])=>ipcRenderer.invoke('one:'+name,...args);
const listen=(name:string,callback:(value:any)=>void)=>{const handler=(_event:Electron.IpcRendererEvent,value:unknown)=>callback(value);ipcRenderer.on('one:'+name,handler);return()=>ipcRenderer.removeListener('one:'+name,handler);};
const pin:PinAPI={state:()=>invoke('pins-window-state'),action:action=>invoke('pins-window-action',action),drag:(phase,group)=>invoke('pins-window-drag',phase,group),controlsHeight:height=>invoke('pins-window-controls-height',height),onChange:callback=>listen('pins-window-changed',callback)};
const common:Pick<OneAPI,'appearance'|'onAppearance'|'windowAction'|'windowState'|'onWindowState'|'uiFontSource'|'diagnosticsReport'>={appearance:()=>invoke('appearance'),onAppearance:callback=>listen('appearance',callback),windowAction:action=>invoke('window-action',action),windowState:()=>invoke('window-state'),onWindowState:callback=>listen('window-state',callback),uiFontSource:family=>invoke('ui-font-source',family),diagnosticsReport:(kind,detail)=>invoke('diagnostics-report',kind,detail)};
contextBridge.exposeInMainWorld('one',{...common,pin});
