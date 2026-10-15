import { contextBridge, ipcRenderer } from 'electron';
import type { FormulaRecognitionAPI } from '../shared/recognition/ocr';
const call = (name:string,...args:unknown[]) => ipcRenderer.invoke('one:formula-recognition-'+name,...args);
const api: FormulaRecognitionAPI = {
  dedicatedServices:()=>call('formula-services'),
  taskProfiles:()=>call('formula-profiles'),verifyServiceImage:ref=>call('formula-verify',ref),cancelServiceCheck:()=>call('formula-check-cancel'),migrateService:rev=>call('formula-migrate',rev),restoreService:rev=>call('formula-restore',rev),manageServices:()=>call('formula-manage'),
  ready:()=>call('ready'),
  localModels:refresh=>call('local-models',refresh),saveLocalModel:(purpose,choice,revision)=>call('local-model-save',purpose,choice,revision),installLocalModel:(id,preference)=>call('local-model-install',id,preference),cancelLocalModelInstall:id=>call('local-model-cancel',id),deleteLocalModel:id=>call('local-model-delete',id),refreshInferenceDevices:()=>call('local-model-devices'),
  imagePreview:(token,region)=>call('image-preview',token,region),
  state:()=>call('state'),formulaConfig:()=>call('formula-config'),saveFormula:value=>call('formula-save',value),clearFormula:revision=>call('formula-clear',revision),
  recognizeFormula:(token,revision,rotation)=>call('formula-recognize',token,revision,rotation),cropFormula:(token,crop)=>call('formula-crop',token,crop),outputFormula:(token,text,mode)=>call('formula-output',token,text,mode),cancelFormula:()=>call('formula-cancel'),copyFormula:text=>call('formula-copy',text),
};
const listen=(name:string,callback:(value:any)=>void)=>{const handler=(_event:Electron.IpcRendererEvent,value:unknown)=>callback(value);ipcRenderer.on('one:'+name,handler);return()=>ipcRenderer.removeListener('one:'+name,handler);};
contextBridge.exposeInMainWorld('one',{formulaRecognition:api,appearance:()=>ipcRenderer.invoke('one:appearance'),onAppearance:(callback:(value:unknown)=>void)=>listen('appearance',callback),uiFontSource:(family:string)=>ipcRenderer.invoke('one:ui-font-source',family),windowAction:(action:string)=>ipcRenderer.invoke('one:window-action',action),windowState:()=>ipcRenderer.invoke('one:window-state'),onWindowState:(callback:(value:unknown)=>void)=>listen('window-state',callback)});
