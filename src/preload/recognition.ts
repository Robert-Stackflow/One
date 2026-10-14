import { contextBridge, ipcRenderer } from 'electron';
import type { OCRAPI } from '../shared/recognition/ocr';
const call = (name: string, ...args: unknown[]) => ipcRenderer.invoke('one:recognition-' + name, ...args);
const api: OCRAPI = {
  dedicatedServices:()=>call('translation-services'),
  taskProfiles:()=>call('translation-profiles'),verifyServiceImage:ref=>call('translation-verify',ref),cancelServiceCheck:()=>call('translation-check-cancel'),migrateService:rev=>call('translation-migrate',rev),restoreService:rev=>call('translation-restore',rev),manageServices:()=>call('translation-manage'),
  region:(token,language,selection)=>call('region',token,language,selection),
  correct:(token,selection,text)=>call('correct',token,selection,text),
  ready: () => call('ready'),
  openFormula: token => call('open-formula', token),
  returnToCapture: (token, id) => call('workflow-back', token, id),
  workflowResult: (token, id) => call('workflow-result', token, id),
  state: () => call('state'),
  imagePreview:(token,region)=>call('image-preview',token,region),
  run: (token, language) => call('run', token, language),
  cancel: () => call('cancel'),
  install: () => call('install'),
  cancelInstall: () => call('cancel-install'),
  localModels: (refresh) => call('local-models', refresh),
  saveLocalModel: (purpose, choice, revision) => call('local-model-save', purpose, choice, revision),
  installLocalModel: (id,preference) => call('local-model-install', id,preference),
  cancelLocalModelInstall: (id) => call('local-model-cancel', id),
  deleteLocalModel: (id) => call('local-model-delete', id),
  refreshInferenceDevices: () => call('local-model-devices'),
  copy: (text) => call('copy', text),
  translationConfig: () => call('translation-config'),
  saveTranslation: (value) => call('translation-save', value),
  clearTranslation: (revision) => call('translation-clear', revision),
  translate: (token, text, target, revision, selection) => call('translate', token, text, target, revision, selection),
  cancelTranslation: () => call('translation-cancel'),
  imageTranslation:(token,id,revision)=>call('image-translation',token,id,revision),
  outputImageTranslation:(token,id,mode,png)=>call('image-translation-output',token,id,mode,png),
  editImageTranslation:(token,id,document,past)=>call('image-translation-editor',token,id,document,past),
  partialTranslation:(token,revision,selection)=>call('translation-partial',token,revision,selection),retryTranslation:(token,id,parts,revision,selection)=>call('translation-retry',token,id,parts,revision,selection),
};
const listen=(name:string,callback:(value:any)=>void)=>{const handler=(_event:Electron.IpcRendererEvent,value:unknown)=>callback(value);ipcRenderer.on('one:'+name,handler);return()=>ipcRenderer.removeListener('one:'+name,handler);};
contextBridge.exposeInMainWorld('one',{recognition:api,appearance:()=>ipcRenderer.invoke('one:appearance'),onAppearance:(callback:(value:unknown)=>void)=>listen('appearance',callback),uiFontSource:(family:string)=>ipcRenderer.invoke('one:ui-font-source',family),diagnosticsReport:(kind:string,detail:string)=>ipcRenderer.invoke('one:diagnostics-report',kind,detail),windowAction:(action:string)=>ipcRenderer.invoke('one:window-action',action),windowState:()=>ipcRenderer.invoke('one:window-state'),onWindowState:(callback:(value:unknown)=>void)=>listen('window-state',callback)});
