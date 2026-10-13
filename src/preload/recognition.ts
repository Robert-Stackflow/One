import { contextBridge, ipcRenderer } from 'electron';
import type { OCRAPI } from '../shared/recognition/ocr';
const call = (name: string, ...args: unknown[]) => ipcRenderer.invoke('one:recognition-' + name, ...args);
const api: OCRAPI = {
  returnToCapture: (token, id) => call('workflow-back', token, id),
  workflowResult: (token, id) => call('workflow-result', token, id),
  state: () => call('state'),
  run: (token, language) => call('run', token, language),
  cancel: () => call('cancel'),
  install: () => call('install'),
  cancelInstall: () => call('cancel-install'),
  copy: (text) => call('copy', text),
  translationConfig: () => call('translation-config'),
  saveTranslation: (value) => call('translation-save', value),
  clearTranslation: (revision) => call('translation-clear', revision),
  translate: (token, text, target, revision) => call('translate', token, text, target, revision),
  cancelTranslation: () => call('translation-cancel'),
  formulaConfig: () => call('formula-config'),
  saveFormula: (value) => call('formula-save', value),
  clearFormula: (revision) => call('formula-clear', revision),
  recognizeFormula: (token, revision) => call('formula-recognize', token, revision),
  cancelFormula: () => call('formula-cancel'),
  copyFormula: (text) => call('formula-copy', text),
};
const listen=(name:string,callback:(value:any)=>void)=>{const handler=(_event:Electron.IpcRendererEvent,value:unknown)=>callback(value);ipcRenderer.on('one:'+name,handler);return()=>ipcRenderer.removeListener('one:'+name,handler);};
contextBridge.exposeInMainWorld('one',{recognition:api,appearance:()=>ipcRenderer.invoke('one:appearance'),onAppearance:(callback:(value:unknown)=>void)=>listen('appearance',callback),uiFontSource:(family:string)=>ipcRenderer.invoke('one:ui-font-source',family),diagnosticsReport:(kind:string,detail:string)=>ipcRenderer.invoke('one:diagnostics-report',kind,detail),windowAction:(action:string)=>ipcRenderer.invoke('one:window-action',action),windowState:()=>ipcRenderer.invoke('one:window-state'),onWindowState:(callback:(value:unknown)=>void)=>listen('window-state',callback)});
