import { contextBridge, ipcRenderer } from 'electron';
import type { OCRAPI,FormulaRecognitionAPI } from '../shared/recognition/ocr';
const call = (name: string, ...args: unknown[]) => ipcRenderer.invoke('one:recognition-' + name, ...args);
const api: OCRAPI = {
  codexStatus:()=>call('service-codex-status'),codexLogin:()=>call('service-codex-login'),codexCancelLogin:()=>call('service-codex-cancel-login'),codexLogout:()=>call('service-codex-logout'),codexChooseExecutable:()=>call('service-codex-choose-executable'),codexAutoExecutable:()=>call('service-codex-auto-executable'),codexOpenLogin:()=>call('service-codex-open-login'),codexCopyCode:()=>call('service-codex-copy-code'),
  serviceCatalog:()=>call('service-catalog'),saveAIService:value=>call('service-ai-save',value),aiModelCatalogDraft:value=>call('service-ai-models',value),saveDedicatedService:(kind,value)=>call('service-dedicated-save',kind,value),
  runAI:(token,reference,language,region)=>call('run-ai',token,reference,language,region),
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
  localModels: (refresh,purpose='ocr') => call('local-models', refresh,purpose),
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
const formula:FormulaRecognitionAPI={
  ready:api.ready,state:api.state,imagePreview:api.imagePreview,
  localModels:refresh=>call('local-models',refresh,'formula'),saveLocalModel:api.saveLocalModel,installLocalModel:api.installLocalModel,cancelLocalModelInstall:api.cancelLocalModelInstall,deleteLocalModel:api.deleteLocalModel,refreshInferenceDevices:api.refreshInferenceDevices,
  dedicatedServices:()=>call('formula-services'),taskProfiles:api.taskProfiles,verifyServiceImage:api.verifyServiceImage,cancelServiceCheck:api.cancelServiceCheck,migrateService:rev=>call('formula-migrate',rev),restoreService:rev=>call('formula-restore',rev),manageServices:api.manageServices,
  formulaConfig:()=>call('formula-config'),saveFormula:value=>call('formula-save',value),clearFormula:rev=>call('formula-clear',rev),recognizeFormula:(token,revision,rotation,region)=>call('formula-recognize',token,revision,rotation,region),cropFormula:(token,crop)=>call('formula-crop',token,crop),outputFormula:(token,text,mode)=>call('formula-output',token,text,mode),cancelFormula:()=>call('formula-cancel'),copyFormula:text=>call('formula-copy',text),
};
const listen=(name:string,callback:(value:any)=>void)=>{const handler=(_event:Electron.IpcRendererEvent,value:unknown)=>callback(value);ipcRenderer.on('one:'+name,handler);return()=>ipcRenderer.removeListener('one:'+name,handler);};
contextBridge.exposeInMainWorld('one',{recognition:api,formulaRecognition:formula,appearance:()=>ipcRenderer.invoke('one:appearance'),onAppearance:(callback:(value:unknown)=>void)=>listen('appearance',callback),uiFontSource:(family:string)=>ipcRenderer.invoke('one:ui-font-source',family),diagnosticsReport:(kind:string,detail:string)=>ipcRenderer.invoke('one:diagnostics-report',kind,detail),windowAction:(action:string)=>ipcRenderer.invoke('one:window-action',action),windowState:()=>ipcRenderer.invoke('one:window-state'),onWindowState:(callback:(value:unknown)=>void)=>listen('window-state',callback)});
