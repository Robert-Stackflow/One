import {contextBridge,ipcRenderer} from 'electron';
import type {ImageEditorAPI} from '../shared/capture/image-editor-api';
import type {OneAPI} from '../shared/types';
const invoke=(name:string,...args:unknown[])=>ipcRenderer.invoke('one:'+name,...args);
const listen=(name:string,callback:(value:any)=>void)=>{
  const handler=(_event:Electron.IpcRendererEvent,value:unknown)=>callback(value);
  ipcRenderer.on('one:'+name,handler);return ()=>ipcRenderer.removeListener('one:'+name,handler);
};
const imageEditor:ImageEditorAPI={
  state:()=>invoke('image-project-state'),
  dirty:(token,value)=>invoke('image-project-dirty',token,value),
  save:request=>invoke('image-project-save',request),
  saveProject:(token,document,history)=>invoke('image-project-project',token,document,history),
  fonts:()=>invoke('image-project-fonts'),
  selectFont:(token,family)=>invoke('image-project-select-font',token,family),
  onPreferences:callback=>listen('capture-preferences',callback),
  onCloseRequest:callback=>listen('image-project-close-request',callback),
  answerClose:(token,accepted)=>invoke('image-project-close-answer',token,accepted),
  saveWatermark:(token,value)=>invoke('image-project-watermark',token,value),
  saveAnnotationStyle:(token,tool,style)=>invoke('image-project-annotation-style',token,tool,style),
  chooseWatermarkImage:token=>invoke('image-project-watermark-image',token),
  scanSensitive:(token,png)=>invoke('image-project-sensitive',token,png),
  cancelSensitive:token=>invoke('image-project-sensitive-cancel',token),
};
type WindowAPI=Pick<OneAPI,'appearance'|'onAppearance'|'windowAction'|'windowState'|'onWindowState'|'uiFontSource'|'diagnosticsReport'>;
const common:WindowAPI={
  appearance:()=>invoke('appearance'),onAppearance:callback=>listen('appearance',callback),
  windowAction:action=>invoke('window-action',action),windowState:()=>invoke('window-state'),
  onWindowState:callback=>listen('window-state',callback),uiFontSource:family=>invoke('ui-font-source',family),
  diagnosticsReport:(kind,detail)=>invoke('diagnostics-report',kind,detail),
};
/** This window receives editing and shared window services, never the main One API. */
contextBridge.exposeInMainWorld('one',{...common,imageEditor});
