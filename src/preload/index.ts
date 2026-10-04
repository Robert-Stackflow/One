import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { OneAPI, ScanSummary } from '../shared/types';
const invoke = (name: string, ...args: unknown[]) => ipcRenderer.invoke('one:' + name, ...args);
const listen = (name: string, callback: (value: any) => void) => { const handler = (_event: Electron.IpcRendererEvent, value: unknown) => callback(value); ipcRenderer.on('one:' + name, handler); return () => ipcRenderer.removeListener('one:' + name, handler); };
async function scan(path:string):Promise<ScanSummary>{
  const id=crypto.randomUUID();let complete!:(value:{result?:ScanSummary;error?:string})=>void;
  const finished=new Promise<{result?:ScanSummary;error?:string}>(resolve=>{complete=resolve;});
  const unsubscribe=listen('scan-complete',value=>{if(value.id===id)complete(value);});
  try{
    await invoke('scan',path,id);
    // This notification shares the ordered send stream with all progress patches.
    // An invoke reply can arrive before the last patch in a very small scan.
    const value=await finished;if(value.error)throw new Error(value.error);return value.result!;
  }finally{unsubscribe();}
}
const api: OneAPI = {
  explorerMenuState:()=>invoke('explorer-menu-state'),setExplorerMenu:value=>invoke('explorer-menu-set',value),fileActionData:()=>invoke('file-action-data'),openFileAction:(tool,paths)=>invoke('file-action-open',tool,paths),
  dialogBarData:()=>invoke('dialog-bar-data'),onDialogBarData:callback=>listen('dialog-bar-data',callback),onDialogBarCollapse:callback=>listen('dialog-bar-collapse',callback),dialogBarChoose:path=>invoke('dialog-bar-choose',path),dialogBarSize:(rows,active)=>invoke('dialog-bar-size',rows,active),dialogBarCollapse:()=>invoke('dialog-bar-collapse'),dialogBarSettings:()=>invoke('dialog-bar-settings'),
  fileToolsRun:task=>invoke('file-tools-run',task),fileToolsCancel:kind=>invoke('file-tools-cancel',kind),fileToolsPage:(id,page,group)=>invoke('file-tools-page',id,page,group),fileToolsHistory:()=>invoke('file-tools-history'),fileToolsOverview:active=>invoke('file-tools-overview',active),onFileToolsProgress:callback=>listen('file-tools-progress',callback),
  systemInformation:(kind,refresh)=>invoke('system-information',kind,refresh),onSystemInformationProgress:cb=>listen('system-information-progress',cb),onSystemInformationGroup:cb=>listen('system-information-group',cb),exportSystemInformation:reports=>invoke('export-system-information',reports),
  diskMonitor:(active,source)=>invoke('disk-monitor',active,source),diskTrace:enabled=>invoke('disk-trace',enabled),onDiskMonitor:cb=>listen('disk-monitor',cb),onDiskAlertOpen:cb=>listen('disk-alert-open',cb),onDiskAlert:cb=>listen('disk-alert',cb),onMaintenanceProgress:cb=>listen('maintenance-progress',cb),
  onPreviewLoading:cb=>listen('preview-loading',cb),
  previewPreferences:value=>invoke('preview-preferences',value),previewOpenWith:()=>invoke('preview-open-with'),previewOpenIn:id=>invoke('preview-open-in',id),
  echoReady:()=>invoke('echo-ready'),echoDisplays:()=>invoke('echo-displays'),positionEcho:()=>invoke('echo-position'),finishEchoPosition:()=>invoke('echo-finish'),onEchoPosition:cb=>listen('echo-position',cb),
  maintenanceScan:kind=>invoke('maintenance-scan',kind),maintenanceCancel:kind=>invoke('maintenance-cancel',kind),maintenanceApply:(report,ids)=>invoke('maintenance-apply',report,ids),maintenanceReceipts:()=>invoke('maintenance-receipts'),maintenanceRestore:id=>invoke('maintenance-restore',id),maintenanceManage:kind=>invoke('maintenance-manage',kind),
  patchSettings:value=>invoke('patch-settings',value),appInfo:()=>invoke('app-info'),
  installedFonts:refresh=>invoke('installed-fonts',refresh),
  uiFontSource:family=>invoke('ui-font-source',family),
  fileIcons:paths=>invoke('file-icons',paths),menuPresets:()=>invoke('menu-presets'),menuConfirmationData:()=>invoke('menu-confirmation-data'),menuConfirmationAnswer:accepted=>invoke('menu-confirmation-answer',accepted),
  fileMenuData:()=>invoke('file-menu-data'),onFileMenu:callback=>listen('file-menu',callback),fileMenuAction:(session,action,value)=>invoke('file-menu-action',session,action,value),fileMenuApps:session=>invoke('file-menu-apps',session),fileMenuClose:(focus,childOnly)=>invoke('file-menu-close',focus,childOnly),fileMenuSubmenu:(session,top,focus)=>invoke('file-menu-submenu',session,top,focus),onFileMenuExpanded:callback=>listen('file-menu-expanded',callback),fileMenuSize:(session,height)=>invoke('file-menu-size',session,height),onSearchFilesChanged:callback=>listen('search-files-changed',callback),
  menuOpen:(id,anchor)=>invoke('menu-open',id,anchor),menuBack:()=>invoke('menu-back'),onMenuReset:callback=>listen('menu-reset',callback),searchContextMenu:(path,point,directory)=>invoke('search-context-menu',path,point,directory),searchSize:(rows,active)=>invoke('search-size',rows,active),searchMenu:()=>invoke('search-menu'),menuChildren:id=>invoke('menu-children',id),menuExecute:id=>invoke('menu-execute',id),menuSize:size=>invoke('menu-size',size),menuFavorite:()=>invoke('menu-favorite'),menuSettings:()=>invoke('menu-settings'),onSearchSettings:callback=>listen('search-settings',callback),
  menuBar:()=>invoke('menu-bar'),onMenuBar:callback=>listen('menu-bar',callback),onSearchPreferences:callback=>listen('search-preferences',callback),onNavigatePage:callback=>listen('navigate-page',callback),
  textPipeline:(text,steps)=>invoke('text-pipeline',text,steps),cancelText:()=>invoke('text-cancel'),onTextProgress:callback=>listen('text-progress',callback),textCompare:(left,right,ignoreWhitespace)=>invoke('text-compare',left,right,ignoreWhitespace),textDifferencePage:(id,page)=>invoke('text-difference-page',id,page),clearTextComparison:id=>invoke('text-comparison-clear',id),textBatch:request=>invoke('text-batch',request),
  searchState:()=>invoke('search-state'),searchFiles:(query,foldersOnly,token)=>invoke('search-files',query,foldersOnly,token),rebuildSearch:()=>invoke('search-rebuild'),cancelSearchIndex:()=>invoke('search-cancel'),showSearch:()=>invoke('search-show'),searchContext:()=>invoke('search-context'),searchChoose:path=>invoke('search-choose',path),searchReady:()=>invoke('search-ready'),searchPreferences:()=>invoke('search-preferences'),onSearchState:callback=>listen('search-state',callback),onSearchContext:callback=>listen('search-context',callback),onSearchReset:callback=>listen('search-reset',callback),onSearchProgress:callback=>listen('search-progress',callback),
  inspectLocks:path=>invoke('inspect-locks',path),onLockTarget:callback=>listen('lock-target',callback),
  lockState:()=>invoke('lock-state'),scanLocks:paths=>invoke('lock-scan',paths),cancelLocks:()=>invoke('lock-cancel'),endLockProcess:token=>invoke('lock-end',token),onLocks:callback=>listen('locks',callback),
  utilityState:()=>invoke('utility-state'),topmostWindows:()=>invoke('topmost-windows'),toggleTopmost:id=>invoke('topmost-toggle',id),clearTopmost:()=>invoke('topmost-clear'),onUtilityState:callback=>listen('utility-state',callback),
  onColorSample:callback=>listen('color-sample',callback),colorFrame:()=>invoke('color-frame'),recordShortcut:active=>invoke('record-shortcut',active),onPreviewClosing:callback=>listen('preview-closing',callback),
  selectPreview:path=>invoke('select-preview',path),directoryOpen:path=>invoke('directory-open',path),directoryPage:(id,offset,limit,query)=>invoke('directory-page',id,offset,limit,query),directoryRelease:id=>invoke('directory-release',id),previewFlags:value=>invoke('preview-flags',value),previewResource:path=>invoke('preview-resource',path),previewImage:path=>invoke('preview-image',path),previewThumbnail:url=>invoke('preview-thumbnail',url),previewLinkCard:url=>invoke('preview-link-card',url),previewOpenLink:url=>invoke('preview-open-link',url),
  appearance:()=>invoke('appearance'),onAppearance:callback=>listen('appearance',callback),pickColor:()=>invoke('pick-color'),colorCapture:()=>invoke('color-capture'),chooseColor:hex=>invoke('choose-color',hex),onColor:callback=>listen('color',callback),
  showColorEditor:hex=>invoke('color-editor-show',hex),colorState:()=>invoke('color-state'),onColorSettings:callback=>listen('color-settings',callback),onColorEditorOpen:callback=>listen('color-editor-open',callback),colorEditorSize:height=>invoke('color-editor-size',height),clearColorHistory:()=>invoke('color-history-clear'),
  colorShortcutStatus:()=>invoke('color-shortcut-status'),retryColorShortcut:()=>invoke('color-shortcut-retry'),onColorShortcutStatus:callback=>listen('color-shortcut-status',callback),
  windowAction: action => invoke('window-action',action), windowState: () => invoke('window-state'), onWindowState: callback => listen('window-state',callback), brightnessStatus: () => invoke('brightness-status'),
  settings: () => invoke('settings'), saveSettings: value => invoke('save-settings', value), inputStatus: () => invoke('input-status'),
  pickerData: path => invoke('picker-data', path), pickerChoose: (path, overwrite) => invoke('picker-choose', path, overwrite),
  pickerPlaces: () => invoke('picker-places'), pickerOpened: () => invoke('picker-opened'), pickerPreferences: value => invoke('picker-preferences', value),
  pickerClearRecent: () => invoke('picker-clear-recent'),
  transform: request => invoke('transform', request), openText: encoding => invoke('open-text', encoding), saveText: (text, encoding) => invoke('save-text', text, encoding), copyText: text => invoke('copy-text', text),
  pickFile: path => invoke('pick-file', path), droppedFile: file => webUtils.getPathForFile(file), preview: path => invoke('preview', path), previewData: () => invoke('preview-data'), navigatePreview: step => invoke('navigate-preview', step),
  openFile: path => invoke('open-file', path), revealFile: path => invoke('reveal-file', path), startFileDrag:path=>invoke('start-file-drag',path),searchText: text => invoke('search-text', text), sendToWorkbench: text => invoke('send-workbench', text),
  pickDirectory: path => invoke('pick-directory', path), scan, cancelScan: () => invoke('cancel-scan'), scanMaintenance: kind => invoke('maintenance', kind), exportMaintenance: rows => invoke('export-maintenance', rows),
  quit: () => invoke('quit'), closeWindow: () => invoke('close-window'), onProgress: callback => listen('progress', callback), onReceiveText: callback => listen('receive-text', callback), onEcho: callback => listen('echo', callback),onEchoHide:callback=>listen('echo-hide',callback), onCopyText: callback => listen('copy-text', callback), onPreviewChanged: callback => listen('preview-changed', callback)
};
contextBridge.exposeInMainWorld('one', api);
