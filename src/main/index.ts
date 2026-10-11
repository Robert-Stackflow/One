import {previewArchive} from './preview-archive';
import {FileContextMenu} from './file-menu';
import {explorerMenuState,setExplorerMenu} from './explorer-menu';
import {readShellRequest} from './shell-request';
import {ShellRequestInbox} from './shell-request-inbox';
import {runtimeLog,runtimeWarning,runtimeOperation,runtimeError,runtimeFatal,diagnosticsList,diagnosticsRecent,diagnosticsDelete,diagnosticsExport} from './runtime-log';
import type {FileActionTarget} from '../shared/explorer-menu';
import type {ArchiveRequest} from '../shared/archive';
import {PopupLifecycle,PopupReadiness,deferPopupBlur} from './popup-lifecycle';
import {FileToolsService} from './file-tools-service';
import {ArchiveService} from './archive-service';
import {ArchiveTasks} from './archive-tasks';
import {archiveAssociation} from './archive-associations';
import {archiveLaunchPath} from './archive-launch';
import {archiveShellAction,isArchivePath,type ArchiveOpenAction} from '../shared/archive-actions';
import {LauncherService} from './launcher-service';
import {openWithApplications,openInApplication,activatePreviewWindow,showFileContextMenu} from './open-with';
import {DiskService} from './disk-service';
import {MaintenanceClient} from './maintenance-client';
import {SystemInformationService} from './system-info-service';
import {ProxyDiagnosticsService} from './proxy-service';
import {checkDns} from './dns-check';
import {DiskMonitorService} from './disk-monitor';
import {validInformationKind} from '../shared/system-info';
import {EchoService} from './echo';
import {nativeScan,nativeMaintenance} from './native-scan';
import {installedFonts,fontSource} from './fonts';
import {ExplorerOverlay} from './explorer-overlay';
import {inlineSearchBaseHeight} from '../shared/overlay';
import {SearchMenu} from './search-menu';
import {TrayMenuPanel} from './tray-menu-panel';
import {trayMenuEntries,type TrayMenuAction} from './tray-menu';
import {DialogBar} from './dialog-bar';
import {oneMenuTarget} from './one-menu-target';
import {FileIcons} from './file-icons';
import {shellFileImage} from './shell-icons';
import {programPath} from './program-path';
import {MenuPresets} from './menu-presets';
import {builtinImagePath} from './menu-builtins';
import {MenuConfirmation} from './menu-confirmation';
import {TextService} from './text-service';
import {validateSteps} from '../shared/text-tools';
import {LocksmithService} from './locksmith';
import {SearchService} from './search-service';
import {SearchBridge} from './search-bridge';
import {ShortcutCapture} from './shortcut-capture';
import {locateHotkeyOwner,cancelHotkeyOwner} from './hotkey-owner';
import type {SearchContext} from '../shared/search';
import {AwakeService} from './awake';
import {TopmostService} from './topmost';
import {PortService} from './port-service';
import {ClickerService} from './clicker';
import {elevationCommand} from './elevation-command';
import {ThemeAutomation} from './theme-automation';
import {ThemeLocationService} from './theme-location';
import {BarcodeCapture,barcodeFile,barcodeClipboard} from './barcode';
import {ImageConvertService} from './image-convert-service';
import {ImageAiService} from './image-ai-service';
import {ImageMetadataService} from './image-metadata-service';
import {imageCodecCapabilities} from './image-codec';
import {DeveloperHashService} from './developer-hash-service';
import {generateQr} from './developer-qr';
import {exportMotionPhotoVideo} from './motion-photo-export';
import {inspectMotionPhoto,inspectLivp,releaseLivpTemporary,type LivpTemporary} from './motion-photo';
import {imageCropPreview} from './image-crop-preview';
import {imageColorPreview,imageColorSample} from './image-color';
import {normalizeBase64,maxBase64FileBytes} from '../shared/base64';
import {barcodeURL} from '../shared/barcode';
import {DisplayShortcutController} from './display-shortcuts';
import {DisplayProfilesService} from './display-profiles';
import {DisplayManagementService} from './display-management';
import { app, BrowserWindow, clipboard, ClipboardItem, crashReporter, dialog, globalShortcut, ipcMain, Menu, nativeImage, net, protocol, screen, session, shell, Tray, Notification, nativeTheme, powerMonitor } from 'electron';
import { readFile, writeFile, mkdir, mkdtemp, rm, rmdir, stat, readdir, rename, realpath, lstat } from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {tmpdir} from 'node:os';
import {pipeline} from 'node:stream/promises';
import { join, dirname, basename, extname, isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { defaultSettings, validateSettings, mergeSettings } from '../shared/settings';
import type { Settings, TextRequest, ScanSummary, PreviewData, MaintenanceRow } from '../shared/types';
import { brightness } from './brightness';
import { readText, saveText } from './text-files';
import { initNative, foreground } from './native';
import {migrateSearchDefaults} from './search-defaults';
import {colorFormats} from '../shared/colors';
import {ColorEditor} from './color-editor';
import {fileResponse} from './file-response';
import type {ScreenCapture} from '../shared/types';
import {preparePreview as loadPreview,reloadWorkbook} from './preview-service';
import {NativePreviewService} from './native-preview';
import {nativePreviewBounds} from '../shared/native-preview';
import {NativeTooltipService} from './native-tooltip';
import {nativeTooltipData} from '../shared/native-tooltip';
const nativeOfficePreview=new NativePreviewService(process.env.ONE_TEST_MODE==='1'&&process.env.ONE_TEST_NATIVE_PREVIEW_HOST?()=>[process.env.ONE_TEST_NATIVE_PREVIEW_HOST!]:undefined);
const nativeTooltips=new NativeTooltipService(parent=>windowFor('native-tooltip',{parent,width:1,height:1,minWidth:1,minHeight:1,frame:false,thickFrame:false,transparent:true,backgroundColor:'#00000000',hasShadow:false,roundedCorners:false,focusable:false,skipTaskbar:true,resizable:false,movable:false,minimizable:false,maximizable:false,fullscreenable:false}));
import {isAnimatedPng,previewImageDimensions,previewResourcePath} from './preview-resource';
import {externalURL,linkCard} from './link-card';
import {DirectoryService} from './directory-service';
const directories=new DirectoryService();
import { InputService } from './input';
import { pick, pickerData, pickerPlaces, pickerOpened, pickerPreferences, pickerClearRecent, pickerWindowBounds, trackPickerWindow, flushPickerState, configurePicker, choose } from './picker';
import {restorePickerBounds} from '../shared/picker';
const execute = promisify(execFile);
app.setName('One');
const testMode = process.env.ONE_TEST_MODE === '1';
const developmentMode = !app.isPackaged && process.env.ONE_DEVELOPMENT === '1';
const loginStartupArg = '--one-login-startup';
app.setAppUserModelId(developmentMode ? 'local.one.desktop.dev' : 'local.one.desktop');
let starting:Promise<void>|undefined;let developmentQuitRequested=false;
if (process.env.ONE_DATA_DIR && (testMode || developmentMode)) app.setPath('userData', resolve(process.env.ONE_DATA_DIR));
crashReporter.start({uploadToServer:false,productName:'One'});
process.on('uncaughtExceptionMonitor',error=>runtimeFatal(app.getPath('userData'),'main-uncaught-exception',error));
process.on('unhandledRejection',reason=>runtimeError(app.getPath('userData'),'main-unhandled-rejection',reason));
app.on('child-process-gone',(_event,details)=>runtimeError(app.getPath('userData'),'child-process-gone',JSON.stringify(details)));
if (developmentMode) app.commandLine.appendSwitch('disk-cache-size', String(64 * 1024 ** 2));
protocol.registerSchemesAsPrivileged([{ scheme: 'one', privileges: { standard: true, secure: true, supportFetchAPI: true } }, { scheme: 'one-file', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
const roles = new Map<number, string>(); const previews = new Map<number, PreviewData>(); const assets = new Map<string, { path: string; owner: number; mime: string; segment?:import('./motion-photo').FileSegment; temporary?:LivpTemporary }>();
const motionVideoExports=new Map<number,AbortController>();
const workbookReloads=new WeakMap<PreviewData,Promise<import('../shared/workbook').WorkbookData>>();
const displayAssets=new Map<string,{owner:number;bytes:Buffer}>();let displayAssetBytes=0;
async function scaledPreviewImage(path:string,width:number,height:number):Promise<Buffer>{
 try{
  const helper=join(__dirname,'../native/One.Thumbnail.exe').replace('app.asar\\','app.asar.unpacked\\');
  const {stdout}=await execute(helper,[path,String(width),String(height)],{windowsHide:true,timeout:5000,maxBuffer:9*1024*1024,encoding:'buffer'});
  const bytes=Buffer.isBuffer(stdout)?stdout:Buffer.from(stdout);
  if(bytes.length<8||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new Error('Thumbnail decoder returned invalid PNG');
  return bytes;
 }catch{/* Fall back when a codec or thumbnail provider cannot decode this file. */}
 let image=await nativeImage.createThumbnailFromPath(path,{width,height});if(image.isEmpty())throw new Error('Thumbnail unavailable');
 const actual=image.getSize(),limit=Math.min(1280/actual.width,960/actual.height,1);
 if(limit<1)image=image.resize({width:Math.max(1,Math.round(actual.width*limit)),height:Math.max(1,Math.round(actual.height*limit)),quality:'good'});
 return image.toPNG();
}
async function scaledPreviewAsset(asset:{path:string;mime:string;segment?:import('./motion-photo').FileSegment},width:number,height:number):Promise<Buffer>{
 if(!asset.segment)return scaledPreviewImage(asset.path,width,height);
 const {offset,length}=asset.segment,size=(await stat(asset.path)).size;
 if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(length)||offset<0||length<16||length>100*1024*1024||offset+length>size)throw Error('照片文件项已变化');
 const folder=await mkdtemp(join(tmpdir(),'one-livp-'));
 const file=join(folder,asset.mime==='image/heif'?'photo.heif':'photo.heic');
 try{
  await pipeline(createReadStream(asset.path,{start:offset,end:offset+length-1}),createWriteStream(file,{flags:'wx'}));
  return await scaledPreviewImage(file,width,height);
 }finally{await rm(file,{force:true}).catch(()=>{});await rmdir(folder).catch(()=>{});}
}
function releasePreviewAssets(owner:number){
 const temporary=new Set<LivpTemporary>();
 for(const [token,asset] of assets)if(asset.owner===owner){assets.delete(token);if(asset.temporary)temporary.add(asset.temporary);}
 for(const [token,asset] of displayAssets)if(asset.owner===owner){displayAssetBytes-=asset.bytes.length;displayAssets.delete(token);}
 for(const item of temporary)setTimeout(()=>{void releaseLivpTemporary(item).catch(()=>{setTimeout(()=>{void releaseLivpTemporary(item).catch(()=>{});},2000);});},1000);
}
if(developmentMode)process.on('message',(message:any)=>{
 if(message?.type==='one:dev-reload'){for(const window of BrowserWindow.getAllWindows())if(!window.isDestroyed())window.webContents.reload();}
 else if(message?.type==='one:dev-quit'&&!developmentQuitRequested){
  developmentQuitRequested=true;
  // A rebuild can arrive before Electron is ready or while services are still
  // starting. Finish that lifecycle stage before running normal shutdown.
  void app.whenReady().then(()=>starting).then(()=>app.quit()).catch(error=>{console.error(error);app.quit();});
 }
});
// The development IPC listener keeps Node's event loop alive after Chromium quits.
// Disconnect only after normal shutdown has flushed application state.
if(developmentMode)app.once('will-quit',()=>{if(process.connected)process.disconnect();});
const fontAssets = new Map<string,{path:string;mime:string;segment?:undefined}>();
const fontSources = new Map<string,Promise<import('../shared/fonts').UIFontSource|null>>();
const previewQueues = new Map<number,Promise<void>>();
const flags = new Map<number,{pinned:boolean;held:boolean}>();
let colorWindow:BrowserWindow|null=null,colorZoomWindow:BrowserWindow|null=null,colorWorker:Worker|null=null,colorFollower:Worker|null=null,colorSample:ScreenCapture|undefined,colorSentSample:ScreenCapture|undefined,colorFramePending=false,recordingShortcut=false,hotkeyProbeRunning=false;let themeAutomation:ThemeAutomation|undefined;const themeLocation=new ThemeLocationService();
const displayManagement=new DisplayManagementService(()=>{if(main&&!main.isDestroyed())main.webContents.send('one:display-changed');},undefined,()=>settings.displays);
const barcodeCapture=new BarcodeCapture(bounds=>windowFor('barcode-capture',{...bounds,minWidth:1,minHeight:1,frame:false,hasShadow:false,roundedCorners:false,resizable:false,movable:false,skipTaskbar:true,alwaysOnTop:true,title:'屏幕框选 · One'}));
const imageConvert=new ImageConvertService();
const imageAi=new ImageAiService(app.getPath('userData'));
const imageMetadata=new ImageMetadataService();
const developerHash=new DeveloperHashService();
const qrImages=new Map<number,Buffer>();
if(testMode&&process.env.ONE_TEST_BARCODE==='1')(globalThis as typeof globalThis&{oneTestBarcodeCapture?:BarcodeCapture}).oneTestBarcodeCapture=barcodeCapture;
let displayShortcuts:DisplayShortcutController|undefined;let displayShortcutRefresh=false,lastDisplayShortcutError='';
const displayProfiles=new DisplayProfilesService(displayManagement,()=>settings.displays.profiles,async change=>(await saveSettings(current=>mergeSettings(current,{displays:{profiles:change(current.displays.profiles)}}))).displays.profiles);
if(testMode&&process.env.ONE_TEST_DISPLAY_MANAGEMENT==='1')(globalThis as typeof globalThis&{oneTestDisplayManagement?:DisplayManagementService}).oneTestDisplayManagement=displayManagement;
if(testMode&&process.env.ONE_TEST_THEME_LOCATION==='1')(globalThis as typeof globalThis&{oneTestThemeLocation?:ThemeLocationService}).oneTestThemeLocation=themeLocation;
let registeredColorShortcut='',colorShortcutError='';let colorEditor:ColorEditor;
let colorFreezeWindows:BrowserWindow[]=[],colorFreezeBusy=false,colorSession=0;
let colorZoomActive=false,colorZoomCardBounds:Electron.Rectangle|undefined;
const shortcutCapture=new ShortcutCapture();let activeShortcutToken='';
let rulerWindows:BrowserWindow[]=[],rulerOpening=false,rulerEscapeRegistered=false;
const workers = new Set<Worker>();let diskService:DiskService;let maintenance:MaintenanceClient;let systemInformation:SystemInformationService;let proxyDiagnostics:ProxyDiagnosticsService;let diskMonitor:DiskMonitorService;let echoes:EchoService;
let main: BrowserWindow; let tray: Tray; let trayMenuPanel:TrayMenuPanel|undefined; let inputPaused=false;
let textService:TextService;let fileTools:FileToolsService;let archiveService:ArchiveService;let locksmith:LocksmithService;let awake:AwakeService;let topmost:TopmostService;let clicker:ClickerService;let ports:PortService;
let launcher:LauncherService,fileMenu:FileContextMenu;
let search:SearchService,searchBridge:SearchBridge,searchWindow:BrowserWindow|null=null,searchRevision=0,searchTyping=false;
let dialogBar:DialogBar;
const searchReadyWindows=new Set<number>();
function replaySearchInput(window:BrowserWindow,revision:number){
 if(!searchTyping||!window.isVisible()||!searchReadyWindows.has(window.webContents.id))return;
 searchTyping=false;const hwnd=Number(window.getNativeWindowHandle().readBigUInt64LE());
 setTimeout(()=>{if(window.isDestroyed()||window!==searchWindow||revision!==searchRevision||!window.isVisible())return;window.focus();searchBridge.replay(hwnd);},80);
}
let searchContext:SearchContext={kind:'search',hwnd:0,pid:0,created:'',folders:[]};
function searchState(){return {...search.state(),bridgeError:searchBridge?.error||''};}
function searchChanged(){if(!search)return;for(const w of BrowserWindow.getAllWindows())if(!w.isDestroyed()&&['main','search','dialog-bar'].includes(roles.get(w.webContents.id)||'')&&(roles.get(w.webContents.id)==='main'||w.isVisible()))w.webContents.send('one:search-state',searchState());}
let inlineSearch=false,overlay:ExplorerOverlay|undefined,menuWindow:BrowserWindow|null=null,menuService:SearchMenu,menuNodes:import('../shared/search').MenuNode[]=[];
let menuExecuting=false,menuRevision=0,menuContextReady:Promise<void>=Promise.resolve();
const cachedSearch=new Map<boolean,BrowserWindow>(),nativeMenus=new Set<number>();
const popupLifecycle=new PopupLifecycle();
const fileIcons=new FileIcons(async path=>{if(path.startsWith('one-builtin:')){const file=builtinImagePath(path.slice(12));return file?shellFileImage(file):'';}if(path.startsWith('one-program:'))return shellFileImage(await programPath(path.slice(12)));const entry=launcher?.get(path);if(entry&&!entry.iconPath)return launcher.icon(path);return shellFileImage(entry?.iconPath||path);});
const menuPresets=new MenuPresets(()=>launcher?.programFiles()||[]);
const menuConfirmation=new MenuConfirmation(()=>windowFor('command-confirm',{width:420,height:280,minWidth:420,minHeight:280,resizable:false,minimizable:false,maximizable:false,skipTaskbar:true,alwaysOnTop:true,title:'确认操作 · One'}));
type MenuPanel={window:BrowserWindow;readiness:PopupReadiness;depth:number;point:{x:number;y:number};items:import('../shared/search').MenuNode[];bar:import('../shared/search').MenuBar;source:string;revision:number;left:boolean};
const menuPanels:MenuPanel[]=[];
function menuFor(sender:number){return menuPanels.find(p=>!p.window.isDestroyed()&&p.window.webContents.id===sender);}
let menuIdleCleanup:NodeJS.Timeout|undefined;
function hideMenus(from=0){for(const p of menuPanels)if(p.depth>=from&&!p.window.isDestroyed())p.window.hide();if(!from){menuRevision++;clearTimeout(menuIdleCleanup);if(menuPanels.some(p=>!p.window.isDestroyed())){menuIdleCleanup=setTimeout(()=>{for(const p of menuPanels)if(!p.window.isDestroyed()&&!p.window.isVisible())p.window.destroy();},60000);menuIdleCleanup.unref();}}}
function popupFocus(w:BrowserWindow){if(w.isDestroyed())return;w.setAlwaysOnTop(true,'pop-up-menu');w.show();w.moveTop();w.focus();const hwnd=Number(w.getNativeWindowHandle().readBigUInt64LE());if(!searchBridge?.activate(hwnd))void activatePreviewWindow(hwnd).catch(()=>{});}
function menuPanel(depth:number){let p=menuPanels[depth];if(p&&!p.window.isDestroyed())return p;
 const w=windowFor('search-menu',{width:286,height:100,minWidth:260,minHeight:40,frame:false,skipTaskbar:true,resizable:false,hasShadow:true},'&depth='+depth);
 p={window:w,readiness:new PopupReadiness(w),depth,point:{x:0,y:0},items:[],bar:{top:[],bottom:[]},source:'',revision:0,left:false};menuPanels[depth]=p;if(!depth)menuWindow=w;
 w.on('blur',()=>{const revision=menuRevision;deferPopupBlur(w,()=>{if(menuExecuting||revision!==menuRevision)return false;const focused=BrowserWindow.getFocusedWindow();return !focused||roles.get(focused.webContents.id)!=='search-menu';},()=>hideMenus(),180);});
 w.on('close',e=>{if(!quitting&&!testMode){e.preventDefault();hideMenus(depth);}});w.on('closed',()=>{if(menuPanels[depth]?.window!==w)return;hideMenus(depth+1);if(!depth){menuRevision++;if(menuWindow===w)menuWindow=null;}});return p;
}
function positionMenu(p:MenuPanel,width:number,height:number){if(p.window.isDestroyed())return;const area=screen.getDisplayNearestPoint(p.point).workArea;const w=Math.min(320,area.width,Math.round(width)),h=Math.min(620,area.height,Math.round(height));let x=p.point.x;
 p.left=false;if(p.depth){const parent=menuPanels[p.depth-1];if(!parent||parent.window.isDestroyed()){p.window.hide();return;}const b=parent.window.getBounds();p.left=parent.left||x+w>area.x+area.width;if(p.left){x=b.x-w+4;if(x<area.x){p.left=false;x=b.x+b.width-4;}}}
 p.window.setBounds({x:Math.max(area.x,Math.min(x,area.x+area.width-w)),y:Math.max(area.y,Math.min(p.point.y,area.y+area.height-h)),width:w,height:h},false);
}
async function favoriteCurrentFolder(){await menuContextReady;const path=searchContext.currentFolder;if(!path)throw new Error('当前文件夹不可用');if(!settings.search.bookmarks.includes(path))await saveSettings(current=>{if(current.search.bookmarks.length>=64)throw new Error('收藏最多包含 64 个文件夹');return {...current,search:{...current.search,bookmarks:[...new Set([...current.search.bookmarks,path])]}};});}
function sendMenu(p:MenuPanel){if(!p.depth)p.window.webContents.send('one:menu-bar',p.bar);p.window.webContents.send('one:menu-reset',p.items);}
async function showMenu(hwnd:number,focus=0){hideMenus();clearTimeout(menuIdleCleanup);searchWindow?.hide();const revision=menuRevision,p=menuPanel(0);p.point=screen.getCursorScreenPoint();p.source='';positionMenu(p,286,250);
 searchContext={kind:'menu',hwnd,pid:0,created:'',folders:[]};
 menuContextReady=searchBridge.context(hwnd,focus).then(c=>{if(revision===menuRevision){searchContext={...c,kind:'menu'};menuService.updateContext(searchContext);}}).catch(e=>{if(revision===menuRevision)echo(e.message);});
 menuNodes=await menuService.open(searchContext);if(revision!==menuRevision)return;p.items=menuNodes;p.bar=menuService.toolbar();menuService.updateContext(searchContext);positionMenu(p,286,Math.max(40,menuNodes.reduce((n,i)=>n+(i.kind==='separator'?13:35),16+(p.bar.top.length?40:0)+(p.bar.bottom.length?40:0))));sendMenu(p);
 p.readiness.run(()=>{if(revision===menuRevision){sendMenu(p);popupFocus(p.window);}});
 // First child is prepared while the user moves to a menu item.
 menuPanel(1);
}
function searchPopup(embedded:boolean){let w=cachedSearch.get(embedded);if(w&&!w.isDestroyed())return w;
 w=windowFor('search',{width:embedded?520:740,height:embedded?inlineSearchBaseHeight:64,minWidth:embedded?240:520,minHeight:embedded?inlineSearchBaseHeight:64,frame:false,titleBarStyle:'default',titleBarOverlay:false,hasShadow:!embedded,thickFrame:!embedded,transparent:embedded,...(embedded?{backgroundColor:'#00000000',roundedCorners:false}:{}),resizable:false,skipTaskbar:true},embedded?'&embedded=1':'');cachedSearch.set(embedded,w);const own=w,windowId=w.webContents.id;
 let idleCleanup:NodeJS.Timeout|undefined;
 const scheduleIdleCleanup=()=>{clearTimeout(idleCleanup);idleCleanup=setTimeout(()=>{if(!own.isDestroyed()&&!own.isVisible())own.destroy();},embedded?300000:5000);idleCleanup.unref();};
 w.on('hide',scheduleIdleCleanup);
 w.on('show',()=>clearTimeout(idleCleanup));
 // Direct typing still gets a prewarmed popup after startup, but an unused
 // renderer need not remain resident for the entire application session.
 if(embedded)scheduleIdleCleanup();
 w.on('blur',()=>{setTimeout(()=>{if(!own.isDestroyed()&&!nativeMenus.has(windowId)&&!own.isFocused())own.hide();},150);});
 // The BrowserWindow and its webContents are already destroyed when 'closed' fires.
 w.on('close',e=>{if(!quitting&&!testMode){e.preventDefault();own.hide();}});w.on('closed',()=>{clearTimeout(idleCleanup);if(cachedSearch.get(embedded)===own)cachedSearch.delete(embedded);searchReadyWindows.delete(windowId);nativeMenus.delete(windowId);if(searchWindow===own){searchWindow=null;searchRevision++;searchTyping=false;overlay?.detach();overlay=undefined;}});return w;
}
function showSearch(kind:SearchContext['kind']='search',hwnd=foreground(true)?.hwnd||0,typing=false,focus=0){
 if(!focus){const source=foreground(true);if(source?.hwnd===hwnd)focus=source.focus;}
 if(kind==='dialog'){void dialogBar?.show(hwnd).catch(error=>echo(error.message));return;}
 fileMenu?.hide(false);launcher?.refresh();if(kind==='menu'){void showMenu(hwnd,focus).catch(error=>echo(error.message));return;}hideMenus();searchWindow?.hide();overlay?.detach();overlay=undefined;
 const embedded=kind==='explorer',revision=++searchRevision;searchTyping=typing;inlineSearch=embedded;searchContext={kind,hwnd,pid:0,created:'',folders:[]};const w=searchPopup(embedded);searchWindow=w;
 const show=()=>{if(revision!==searchRevision||w.isDestroyed())return;if(embedded){overlay=new ExplorerOverlay(w);overlay.attach(hwnd);}else{const a=screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea,width=Math.min(740,a.width-32);w.setBounds({x:Math.round(a.x+(a.width-width)/2),y:Math.round(a.y+a.height*.2),width,height:64},false);}w.webContents.send('one:search-reset');w.webContents.send('one:search-context',searchContext);popupFocus(w);replaySearchInput(w,revision);};
 if(w.webContents.isLoading())w.once('ready-to-show',show);else show();
 // Prepare the result menu after the search input has appeared, not at startup.
 setTimeout(()=>{if(!quitting&&searchWindow===w&&!w.isDestroyed()&&w.isVisible())fileMenu?.warm();},80).unref();
 void searchBridge.context(hwnd,focus).then(context=>{if(revision!==searchRevision)return;searchContext={...context,kind};w.webContents.send('one:search-context',searchContext);}).catch(error=>{if(revision===searchRevision){searchBridge.error=(error as Error).message;searchChanged();}});
}
function warmSearchPopups(){if(quitting||!main||main.isDestroyed())return;launcher?.refresh();if(settings.search.explorerTyping)searchPopup(true);dialogBar?.warm();}
async function chooseSearch(value:unknown){const item=typeof value==='string'?launcher.get(value):undefined;if(item){if(item.launchKind==='setting')await shell.openExternal(item.target);else await launcher.open(item.path);searchWindow?.hide();return;}const path=filePath(value),info=await stat(path);if(info.isDirectory())await menuService.remember(path);if(searchContext.kind==='dialog'&&!info.isDirectory())throw new Error('请选择文件夹');if(info.isDirectory()&&searchContext.kind!=='search'){searchWindow?.hide();try{if(searchContext.kind==='explorer'&&!searchContext.tab){const failure=await shell.openPath(path);if(failure)throw new Error(failure);}else await searchBridge.jump(searchContext,path);}catch(error){if(searchContext.kind==='explorer'&&/Explorer tab (?:could not be identified|is no longer available)/.test(String(error))){const failure=await shell.openPath(path);if(!failure)return;error=new Error(failure);}searchWindow?.show();searchWindow?.focus();throw error;}}else{if(!info.isDirectory()&&isArchivePath(path)){searchWindow?.hide();await shellInvocation([`--one-archive=${path}`],'search-open');return;}const error=await shell.openPath(path);if(error)throw new Error(error);searchWindow?.hide();}}
function utilityState(){return {awake:awake?.state()||{...settings.utilities.awake,active:false,locked:false,remaining:0,error:''},pinned:topmost?.count()||0,shortcutError:topmost?.error||'',clicker:clicker?.state()||{running:false,clicks:0,remaining:0,error:''}};}
function utilityChanged(){if(!awake||!topmost||!clicker)return;for(const w of BrowserWindow.getAllWindows())if(!w.isDestroyed()&&roles.get(w.webContents.id)==='main')w.webContents.send('one:utility-state',utilityState());}
let applicationIcon: Electron.NativeImage;
let settings: Settings = defaultSettings(); let input: InputService; let quitting = false;let finishingQuit:Promise<unknown>|undefined;let pickerQuitReady=false;
const settingsPath = () => join(app.getPath('userData'), 'settings.json');
function windowFor(view: string, options: Electron.BrowserWindowConstructorOptions = {},query='') {
  const a=themeAutomation?.appearance()||settings.appearance;const dark=a.mode==='dark'||a.mode==='system'&&nativeTheme.shouldUseDarkColors;
  const window = new BrowserWindow({ width: 1240, height: 840, minWidth: 840, minHeight: 620, backgroundColor: dark?a.darkBackground:a.lightBackground, title: 'One', show: false,
    ...(['main','preview','picker','search','color-editor','command-confirm','dialog-bar'].includes(view)?{titleBarStyle:'hidden' as const,titleBarOverlay:false,frame:true,thickFrame:true,hasShadow:true}:{frame:false}), roundedCorners: true, icon: applicationIcon, ...options,
    webPreferences: { preload: join(__dirname, '../preload/index.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true,autoplayPolicy:'no-user-gesture-required',backgroundThrottling:true } });
  const windowId = window.webContents.id; roles.set(windowId, view);
  if(['main','file-action','search','color-picker'].includes(view))runtimeLog(app.getPath('userData'),'window-created',`role=${view} id=${windowId}`);
  // The open-with submenu is cheap to recreate and rarely reopened after a pause.
  // Keep the parent menu warm for repeated right-clicks, but release its extra renderer sooner.
  if(view==='file-context'&&query.includes('submenu='))popupLifecycle.track(window,8_000);
  else if(view==='file-context')popupLifecycle.track(window,12_000);
  else if(view==='search-menu')popupLifecycle.track(window);
  else if(view==='dialog-bar')popupLifecycle.track(window,300_000);
  const sendWindowState = () => {
    if(window.isDestroyed()||window.webContents.isDestroyed())return;
    const visible=window.isVisible()&&!window.isMinimized();
    if(['echo','color-picker','search','search-menu','dialog-bar'].includes(view))window.webContents.setBackgroundThrottling(!visible);
    if(view==='main'&&!visible)for(const source of ['overview','maintenance','information'])diskMonitor?.subscribe(false,source);
    window.webContents.send('one:window-state',{maximized:window.isMaximized(),visible});
  };
  window.on('maximize',sendWindowState);window.on('unmaximize',sendWindowState);
  window.on('show',sendWindowState);window.on('hide',sendWindowState);
  window.on('minimize',sendWindowState);window.on('restore',sendWindowState);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('did-fail-load',(_event,code,description,url)=>{if(code!==-3)runtimeError(app.getPath('userData'),`window-load:${view}`,`${code} ${description} ${url}`);});
  window.webContents.on('console-message',details=>{if(details.level==='error')runtimeError(app.getPath('userData'),`renderer-console:${view}`,`${details.message} (${details.sourceId}:${details.lineNumber})`);});
  window.webContents.on('render-process-gone',(_event,details)=>runtimeError(app.getPath('userData'),`renderer-gone:${view}`,JSON.stringify(details)));
  window.webContents.on('unresponsive',()=>runtimeWarning(app.getPath('userData'),`renderer-unresponsive:${view}`));
  window.webContents.on('responsive',()=>runtimeLog(app.getPath('userData'),`renderer-responsive:${view}`));
  window.webContents.on('will-navigate', event => event.preventDefault());
  if(view==='preview'){const stop=()=>{nativeOfficePreview.stop(windowId);nativeTooltips.dispose(windowId);};window.webContents.on('did-start-loading',stop);window.webContents.on('render-process-gone',stop);}
  window.on('close',()=>{if(view==='preview'){nativeOfficePreview.stop(windowId);nativeTooltips.dispose(windowId);}if(view==='preview'&&!window.webContents.isDestroyed()){window.webContents.setAudioMuted(true);window.webContents.send('one:preview-closing');}});
  window.on('closed', () => {if(['main','file-action','search','color-picker'].includes(view))runtimeLog(app.getPath('userData'),'window-closed',`role=${view} id=${windowId}`);fileTools?.cancel(windowId);imageConvert.cancel(windowId);imageAi.cancel(windowId);imageMetadata.cancel(windowId);developerHash.cancel(windowId);qrImages.delete(windowId);motionVideoExports.get(windowId)?.abort();if(view==='preview'){archiveService?.cancelOwner(windowId);nativeOfficePreview.stop(windowId);}textService?.release(windowId);search?.releaseScope(windowId);directories.close(windowId);roles.delete(windowId); previews.delete(windowId); flags.delete(windowId);previewQueues.delete(windowId);releasePreviewAssets(windowId); });
  void window.loadURL(`one://app/index.html?view=${view}${query}`);
  return window;
}
function showMain() { if (!main || main.isDestroyed()) return; if (main.isMinimized()) main.restore(); main.show(); main.focus(); }
const fileActions=new Map<number,FileActionTarget>();
const fileLocks=new Map<number,LocksmithService>();
const locksFor=(id:number)=>fileLocks.get(id)||locksmith;
function openFileAction(target:FileActionTarget){
 if(quitting||finishingQuit)throw Error('应用正在退出');
 const title=target.tool==='rename'?'批量重命名':'文件占用';
 const window=windowFor('file-action',{width:target.tool==='rename'?1000:840,height:720,minWidth:780,minHeight:560,title:title+' · One',frame:true,titleBarStyle:'hidden',hasShadow:true},'&tool='+target.tool);
 const id=window.webContents.id;fileActions.set(id,target);
 if(target.tool==='locksmith')fileLocks.set(id,new LocksmithService(state=>{if(!window.isDestroyed()&&!window.webContents.isDestroyed())window.webContents.send('one:locks',state);}));
 window.once('ready-to-show',()=>{if(!window.isDestroyed()){window.show();window.focus();}});window.on('closed',()=>{fileActions.delete(id);fileLocks.get(id)?.stop();fileLocks.delete(id);});
}
let shellQueue=Promise.resolve();
const queuedShellRequests=new Set<string>();
let shellInbox:ShellRequestInbox|undefined;
async function shellInvocation(args:string[],source='launch'){
 const argument=args.find(value=>value.startsWith('--one-shell-request='));
 if(!argument){
  if(!args.some(value=>value.startsWith('--one-archive='))){showMain();return;}
  const run=async()=>{
   try{
    await app.whenReady();
    if(starting)await starting;
    const archive=archiveLaunchPath(args)!;
    const info=await lstat(archive);if(!info.isFile()||info.isSymbolicLink())throw Error('请选择一个普通压缩文件');
    runtimeLog(app.getPath('userData'),'archive-launch',`source=${source} action=${settings.archive.doubleClick}`);
    navigateArchive(settings.archive.doubleClick==='smart'?'smart':'extract',[archive]);
   }catch(error){
    runtimeError(app.getPath('userData'),'archive-launch-error',error);if(quitting||!main||main.isDestroyed())return;showMain();
    const detail=(error as NodeJS.ErrnoException).code==='ENOENT'?'压缩文件不存在，可能已移动或删除。':error instanceof Error?error.message:String(error);
    await dialog.showMessageBox(main,{type:'error',message:'无法打开压缩包',detail});
   }
  };
  const next=shellQueue.then(run,run);shellQueue=next;return next;
 }
 const path=argument.slice('--one-shell-request='.length);
 if(queuedShellRequests.has(path))return;
 queuedShellRequests.add(path);
 const run=async()=>{
  try{
   await app.whenReady();
   if(starting)await starting;
   const target=await readShellRequest(args,app.getPath('userData'));
   if(!target)return;
   runtimeLog(app.getPath('userData'),'shell-request-open',`source=${source} tool=${target.tool} count=${target.paths.length}`);
   const archiveAction=archiveShellAction(target.tool);
   if(archiveAction){
    navigateArchive(archiveAction,target.paths);
   }else openFileAction(target);
  }catch(error){
   if((error as NodeJS.ErrnoException).code==='ENOENT')return;
   runtimeLog(app.getPath('userData'),'shell-request-error',String(error));
   console.error('右键菜单启动失败',error);
  }finally{queuedShellRequests.delete(path);}
 };
 const next=shellQueue.then(run,run);
 shellQueue=next;
 return next;
}
function navigateArchive(action:ArchiveOpenAction,paths:string[]){
 const send=()=>{if(!quitting&&!main.isDestroyed()&&!main.webContents.isDestroyed()){showMain();main.webContents.send('one:navigate-page',{page:'archive',action,paths});}};
 if(main.webContents.isLoadingMainFrame())main.webContents.once('did-finish-load',send);else send();
}
async function pickPath(mode: 'file'|'directory'|'save', title: string, name = '', initialPath?: string,owner=main) { const bounds=await pickerWindowBounds();if(quitting||finishingQuit||!owner||owner.isDestroyed())throw new Error('应用正在退出');const area=screen.getDisplayMatching(bounds||owner.getBounds()).workArea;const window = windowFor('picker', { width:Math.min(860,area.width),height:Math.min(640,area.height),...bounds,minWidth:Math.min(620,area.width),minHeight:Math.min(500,area.height),parent: owner, modal: true, skipTaskbar: true });if(bounds)restorePickerBounds(window,bounds);trackPickerWindow(window); const result = pick(window, mode, title, name, initialPath); window.once('ready-to-show', () => { if (!window.isDestroyed()){if(bounds)restorePickerBounds(window,bounds);window.show();} }); return result; }
function echo(text:string,channel?:import('../shared/echo').EchoChannel){echoes?.show(text,channel);}
function textValue(value: unknown, limit = 10_000_000): string { if (typeof value !== 'string' || value.length > limit) throw new Error('文本参数无效或超过长度上限'); return value; }
function filePath(value: unknown): string { if (typeof value !== 'string' || value.length > 32768 || !isAbsolute(value) || value.includes('\0')) throw new Error('文件路径无效'); return resolve(value); }
const fileActionIPC=new Set(['file-action-data','window-action','window-state','settings','app-info','file-icons','file-icon','shell-icons','file-tools-run','file-tools-cancel','file-tools-page','file-tools-history','lock-state','lock-scan','lock-cancel','lock-end','pick-file','pick-directory','drop-path-kinds','open-file','reveal-file','native-context-menu','preview','copy-text','file-tools-overview','appearance']);
const auditedIPC=new Set(['archive-edit-export','archive-edit-inspect','archive-edit-resolve','archive-edit-start','archive-edit-save','archive-edit-discard','archive-edit-open','archive-recovery-cleanup','archive-recovery-restore','archive-recovery-inspect','archive-recovery-forget','archive-association','patch-settings','settings-backup-export','settings-backup-import','file-tools-run','file-tools-cancel','archive-run','archive-cancel','archive-cancel-id','lock-scan','lock-end','maintenance-scan','maintenance-apply','maintenance-restore','search-rebuild','search-cancel','explorer-menu-set','restart','restart-normal','elevate','hotkey-owner']);
function handle(name: string, handler: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown, allowed = ['main']) {
  ipcMain.handle(`one:${name}`, async(event, ...args) => {const start=performance.now(),role=roles.get(event.sender.id)||'unknown';try{if (!(allowed.includes(role)||role==='file-action'&&fileActionIPC.has(name)) || event.senderFrame !== event.sender.mainFrame || !event.senderFrame.url.startsWith('one://app/')) throw new Error('调用来源无效');const result=await handler(event,...args);if(auditedIPC.has(name))runtimeOperation(app.getPath('userData'),name,role,performance.now()-start,'ok');return result;}catch(error){if(auditedIPC.has(name))runtimeOperation(app.getPath('userData'),name,role,performance.now()-start,'error');runtimeError(app.getPath('userData'),`ipc:${name}`,error);throw error;} });
}
const privilegePowerShell=join(process.env.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
async function administrator(){
 if(process.platform!=='win32')return false;
 try{const {stdout}=await execute(privilegePowerShell,['-NoProfile','-NonInteractive','-Command','([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)'],{windowsHide:true,timeout:4000,maxBuffer:1024,encoding:'utf8'});return stdout.trim().toLowerCase()==='true';}catch{return false;}
}
async function elevate(){
 if(process.platform!=='win32')throw new Error('管理员权限仅适用于 Windows');
 if(await administrator())return {administrator:true,restarting:false};
 if(testMode)return {administrator:false,restarting:false};
 const command=elevationCommand(process.execPath,process.argv.slice(1).filter(value=>!value.startsWith('--one-shell-request=')));
 app.releaseSingleInstanceLock();
 try{await execute(privilegePowerShell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',command],{windowsHide:true,timeout:30000,maxBuffer:4096,encoding:'utf8'});}catch(error){app.requestSingleInstanceLock();console.error('Unable to restart One with administrator rights:',error);throw new Error('管理员权限请求未完成，请重试。');}
 setTimeout(()=>app.quit(),150).unref();
  return {administrator:false,restarting:true};
}
async function restartNormal(){
 if(testMode)return;
 if(!await administrator()){restartOne();return;}
 const helper=join(__dirname,'../native/One.LaunchNormal.exe').replace('app.asar\\','app.asar.unpacked\\');
 app.releaseSingleInstanceLock();
 try{await execute(helper,[process.execPath],{windowsHide:true,timeout:10000,maxBuffer:4096});}
 catch(error){app.requestSingleInstanceLock();runtimeLog(app.getPath('userData'),'normal-restart-error',String(error));throw new Error('无法以普通权限重新启动，请退出 One 后从开始菜单打开。');}
 setTimeout(()=>app.quit(),150).unref();
}
function restartOne(){
 if(testMode)return;
 app.relaunch();
 app.quit();
}
async function runMaintenance(mode: 'startup' | 'registry') {
  if(mode==='registry')return nativeMaintenance(mode);
  const exe = join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const script = join(__dirname, 'maintenance.ps1').replace('app.asar\\', 'app.asar.unpacked\\');
  const result = await execute(exe, ['-NoProfile', '-NonInteractive', '-File', script, '-Mode', 'tasks'], { windowsHide: true, timeout: 30000, maxBuffer: 10 * 1024 * 1024, encoding: 'utf8' });
  const rows=JSON.parse(result.stdout.trim() || '[]');return [...await nativeMaintenance('startup'),...rows];
}
async function preparePreview(path: string, owner: number): Promise<PreviewData> {
  nativeOfficePreview.stop(owner);
  releasePreviewAssets(owner);
  const held:string[]=[];try{const next=await loadPreview(path,(path,mime,segment,temporary)=>{if(!roles.has(owner))throw new Error('预览窗口已关闭');const token=randomUUID();assets.set(token,{path,owner,mime,segment,temporary});return `one-file://asset/${token}/${encodeURIComponent(basename(path))}`;},async(directory,target)=>{if(!roles.has(owner))throw new Error('预览窗口已关闭');const info=await directories.open(owner,directory,target);held.push(info.id);return info;});if(next.workbook)next.workbookToken=randomUUID();if(next.type==='native-office')next.nativeOfficeToken=randomUUID();const previous=previews.get(owner);for(const info of [previous?.directory,previous?.navigation])if(info)directories.release(owner,info.id);return next;}catch(error){releasePreviewAssets(owner);for(const id of held)directories.release(owner,id);throw error;}
}
function foregroundPreview(window:BrowserWindow){
 if(window.isDestroyed())return;if(window.isMinimized())window.restore();
 window.setAlwaysOnTop(true,'pop-up-menu');window.show();window.moveTop();window.focus();
 setTimeout(()=>{void (async()=>{try{if(!window.isDestroyed()&&!window.isFocused())await activatePreviewWindow(Number(window.getNativeWindowHandle().readBigUInt64LE()));}catch{}finally{if(!window.isDestroyed()){window.focus();window.setAlwaysOnTop(!!flags.get(window.webContents.id)?.pinned,'pop-up-menu');}}})();},60);
}
async function preview(path: string) {
 for(const [id,data] of previews)if(data.path===path){const w=BrowserWindow.fromWebContents(ElectronContents(id));if(w)foregroundPreview(w);return;}
 const window=windowFor('preview',{width:1120,height:800,minWidth:720,minHeight:480,titleBarOverlay:false,skipTaskbar:true});
 const id=window.webContents.id;flags.set(id,{pinned:settings.preview.pinned,held:settings.preview.held});
 window.once('ready-to-show',()=>foregroundPreview(window));
 window.on('blur',()=>{setTimeout(()=>{if(!window.isDestroyed()&&previews.has(id)&&!window.isFocused()&&!flags.get(id)?.held)window.close();},220);});
 try{const data=await preparePreview(path,id);if(window.isDestroyed())return;previews.set(id,data);if(window.webContents.isLoading())window.webContents.once('did-finish-load',()=>window.webContents.send('one:preview-changed'));else window.webContents.send('one:preview-changed');}
 catch(error){if(!window.isDestroyed())window.close();throw error;}
}
function ElectronContents(id: number) { const window = BrowserWindow.getAllWindows().find(w => w.webContents.id === id); if (!window) throw new Error('预览窗口已关闭'); return window.webContents; }
async function persistSettings(next:Settings){await mkdir(app.getPath('userData'),{recursive:true});const temporary=settingsPath()+'.tmp';await writeFile(temporary,JSON.stringify(next,null,2),'utf8');await rename(temporary,settingsPath());settings=next;}
let saving:Promise<unknown>=Promise.resolve();
function saveSettings(value:Settings|((current:Settings)=>Settings),{allowShortcutConflict=false}:{allowShortcutConflict?:boolean}={}){
  const task=saving.catch(()=>{}).then(async()=>{const previous=settings,next=validateSettings(typeof value==='function'?value(settings):value);
    const changed=(key:keyof Settings)=>JSON.stringify(previous[key])!==JSON.stringify(next[key]);
    if(changed('colorShortcut')&&!recordingShortcut){try{colorShortcut(next.colorShortcut);}catch(error){if(!allowShortcutConflict){try{colorShortcut(previous.colorShortcut);}catch{}throw error;}}}
    const themeShortcutChanged=next.themeSchedule.shortcut!==previous.themeSchedule.shortcut;
    if(themeShortcutChanged&&!recordingShortcut){try{themeAutomation?.registerShortcut(next.themeSchedule.shortcut);}catch(error){if(!allowShortcutConflict){try{themeAutomation?.registerShortcut(previous.themeSchedule.shortcut);}catch{}if(changed('colorShortcut'))try{colorShortcut(previous.colorShortcut);}catch{}throw error;}}}
    try{await persistSettings(next);}catch(error){if(changed('colorShortcut')&&!recordingShortcut)try{colorShortcut(previous.colorShortcut);}catch{}if(themeShortcutChanged&&!recordingShortcut)try{themeAutomation?.registerShortcut(previous.themeSchedule.shortcut);}catch{}throw error;}
    if(themeShortcutChanged&&!recordingShortcut)try{themeAutomation?.registerShortcut(next.themeSchedule.shortcut);}catch{}
    if(JSON.stringify(next.displays.shortcuts)!==JSON.stringify(previous.displays.shortcuts)&&!recordingShortcut&&!inputPaused)displayShortcuts?.configure(next.displays.shortcuts);
    if(changed('themeSchedule'))void themeAutomation?.configure(next.themeSchedule);
    const inputKeys=['quickActions','capsLock','echo','keyEcho','onlyCombinations','edgeScroll','copyMenu','explorerPreview','pauseFullscreen','excludedApps','dwellMs','cornerPixels','cooldownMs','copyIntervalMs','volumeStep','edgePixels','corners','edges','cornerBindings','utilities'] as const;
    if(inputKeys.some(changed)){if(inputPaused)input?.stop();else input?.update(next);}
    if(changed('search')){
      const bridgeKeys=['shortcut','programShortcut','doubleCtrl','explorerTyping','explorerMenu','dialogSwitch'] as const;
      if(bridgeKeys.some(k=>next.search[k]!==previous.search[k]))searchBridge?.update(next.search);
      if(!next.search.dialogSwitch)dialogBar?.stop();search?.configure(next.search);if(main&&!main.isDestroyed())warmSearchPopups();
      if(JSON.stringify([previous.search.roots,previous.search.excluded,previous.search.maxEntries])!==JSON.stringify([next.search.roots,next.search.excluded,next.search.maxEntries]))search?.rebuild(next.search);
      for(const w of BrowserWindow.getAllWindows())if(!w.isDestroyed()&&!w.webContents.isDestroyed()&&['main','search','dialog-bar'].includes(roles.get(w.webContents.id)||''))w.webContents.send('one:search-preferences',next.search);
    }
    if(changed('utilities')){if(JSON.stringify(previous.utilities.awake)!==JSON.stringify(next.utilities.awake))awake?.update(next.utilities.awake);if(JSON.stringify(previous.utilities.topmost)!==JSON.stringify(next.utilities.topmost))topmost?.update(next.utilities.topmost);if(JSON.stringify(previous.utilities.clicker)!==JSON.stringify(next.utilities.clicker))clicker?.update(next.utilities.clicker);}
    if(changed('diskMonitor'))diskMonitor?.configure(next.diskMonitor);
    if(changed('archive')&&main&&!main.isDestroyed()&&!main.webContents.isDestroyed())main.webContents.send('one:archive-preferences',next.archive);
    if(changed('appearance')){refreshWindowAppearance();if(JSON.stringify(previous.appearance.popupPlacement)!==JSON.stringify(next.appearance.popupPlacement))echoes?.reposition();}
    if(changed('colorWheelZoom'))colorWorker?.postMessage({wheelZoomEnabled:next.colorWheelZoom});
    if(['colorHistory','colorVisibleFormats','colorFormat','colorShowEditor','colorWheelZoom'].some(key=>changed(key as keyof Settings)))for(const w of BrowserWindow.getAllWindows())if(!w.isDestroyed()&&!w.webContents.isDestroyed()&&['main','color-editor','color-picker'].includes(roles.get(w.webContents.id)||''))w.webContents.send('one:color-settings');
    if(previous.general.launchAtLogin!==next.general.launchAtLogin){if(app.isPackaged&&!testMode)app.setLoginItemSettings({openAtLogin:next.general.launchAtLogin,...(next.general.launchAtLogin?{args:[loginStartupArg]}:{})});trayMenuPanel?.changed();}
    if(previous.keyEcho&&!next.keyEcho)echoes?.hideTransient();if(previous.keyEcho&&!next.keyEcho)echoes?.cancelEdit();
    const keys=(Object.keys(previous) as (keyof Settings)[]).filter(changed);if(keys.length)runtimeLog(app.getPath('userData'),'settings-updated',keys.join(','));
    return next;
  });saving=task;return task;
}
type SettingsBackup={format:'one-settings-backup';schema:1;exportedAt:string;settings:Settings};
function backupFileName(){const stamp=new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);return `One-settings-${stamp}.json`;}
async function exportSettingsBackup(){
  const result=await dialog.showSaveDialog(main,{title:'导出 One 设置',defaultPath:join(app.getPath('documents'),backupFileName()),filters:[{name:'One 设置备份',extensions:['json']}]});
  if(result.canceled||!result.filePath)return {saved:false};
  const backup:SettingsBackup={format:'one-settings-backup',schema:1,exportedAt:new Date().toISOString(),settings};
  await writeFile(result.filePath,JSON.stringify(backup,null,2),'utf8');return {saved:true,path:result.filePath};
}
async function importSettingsBackup(){
  const result=await dialog.showOpenDialog(main,{title:'导入 One 设置',properties:['openFile'],filters:[{name:'One 设置备份',extensions:['json']}]});
  const path=result.filePaths[0];if(result.canceled||!path)return {imported:false};
  const source=await readFile(path,'utf8');if(source.length>4*1024*1024)throw new Error('备份文件过大');
  let backup:unknown;try{backup=JSON.parse(source);}catch{throw new Error('备份文件不是有效的 JSON');}
  if(!backup||typeof backup!=='object'||(backup as Partial<SettingsBackup>).format!=='one-settings-backup'||(backup as Partial<SettingsBackup>).schema!==1)throw new Error('不是 One 设置备份文件');
  const value=validateSettings((backup as SettingsBackup).settings);await saveSettings(value,{allowShortcutConflict:true});
  const shortcutError=[themeAutomation?.state().shortcutError,colorShortcutError,topmost?.error,searchBridge?.error].filter(error=>error&&/快捷键/.test(error)).join('；');
  return {imported:true,exportedAt:(backup as SettingsBackup).exportedAt,shortcutError};
}
function colorDisplays(){return screen.getAllDisplays().map(d=>({bounds:screen.dipToScreenRect(null,d.bounds),workArea:screen.dipToScreenRect(null,d.workArea),scaleFactor:d.scaleFactor}));}
function refreshColorDisplays(){colorFollower?.postMessage({displays:colorDisplays()});}
function sendColorFrame(){if(!colorWindow||colorWindow.isDestroyed()||colorWindow.webContents.isLoading()||colorFramePending||!colorSample||colorSample===colorSentSample)return;colorSentSample=colorSample;colorFramePending=true;colorWindow.webContents.send('one:color-sample',colorSample);if(colorZoomWindow&&!colorZoomWindow.isDestroyed()&&!colorZoomWindow.webContents.isLoading())colorZoomWindow.webContents.send('one:color-sample',colorSample);}
function updateColorZoom(active:boolean,x=0,y=0){
 const window=colorWindow;if(!window||window.isDestroyed()||colorZoomActive===active)return;colorZoomActive=active;
 if(!active){colorZoomCardBounds=undefined;const zoom=colorZoomWindow;colorZoomWindow=null;if(zoom&&!zoom.isDestroyed())zoom.destroy();colorFollower?.postMessage('resume');colorWorker?.postMessage({resetZoomViewport:true});return;}
 colorFollower?.postMessage('pause');
 const point=screen.screenToDipPoint({x,y}),display=screen.getDisplayNearestPoint(point),area=display.workArea;
 const bounds={x:Math.round(Math.max(area.x,Math.min(point.x-160,area.x+area.width-320))),y:Math.round(Math.max(area.y,Math.min(point.y-160,area.y+area.height-320))),width:320,height:320};
 const zoom=windowFor('color-zoom',{...bounds,minWidth:1,minHeight:1,frame:false,thickFrame:false,hasShadow:false,roundedCorners:false,resizable:false,movable:false,fullscreenable:false,focusable:true,transparent:true,backgroundColor:'#00000000',alwaysOnTop:true,skipTaskbar:true});
 colorZoomWindow=zoom;zoom.setAlwaysOnTop(true,'screen-saver');zoom.once('ready-to-show',()=>{if(!zoom.isDestroyed()&&colorZoomWindow===zoom){zoom.showInactive();zoom.moveTop();window.moveTop();sendColorFrame();}});
 const cardX=bounds.x+bounds.width+8+216<=area.x+area.width?bounds.x+bounds.width+8:bounds.x-224>=area.x?bounds.x-224:bounds.x+Math.round((bounds.width-216)/2);
 const cardY=cardX>=bounds.x&&cardX<bounds.x+bounds.width?bounds.y+bounds.height+8:bounds.y+Math.round((bounds.height-276)/2);
 colorZoomCardBounds={x:Math.round(Math.max(area.x,Math.min(cardX,area.x+area.width-216))),y:Math.round(Math.max(area.y,Math.min(cardY,area.y+area.height-276))),width:216,height:276};
 const physical=screen.dipToScreenRect(null,{x:bounds.x+10,y:bounds.y+10,width:300,height:300});
 colorWorker?.postMessage({zoomViewport:{x:physical.x,y:physical.y,width:physical.width,height:physical.height}});
}
function clearColorFreeze(){const windows=colorFreezeWindows;colorFreezeWindows=[];for(const window of windows)if(!window.isDestroyed())window.destroy();if(colorWorker&&colorWindow&&!colorWindow.isDestroyed()){colorWindow.webContents.send('one:color-frozen',false);if(!colorWindow.isVisible())colorWindow.showInactive();colorWindow.moveTop();}}
async function freezeColor(){
 if(colorFreezeBusy||!colorWorker||colorFreezeWindows.length)return;
 const session=colorSession,worker=colorWorker;colorFreezeBusy=true;
 try{
  if(colorWindow&&!colorWindow.isDestroyed())colorWindow.hide();
  const displays=screen.getAllDisplays(),active=screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const ready:Promise<void>[]=[];
  for(const display of displays){
   const window=windowFor('color-freeze',{...display.bounds,minWidth:1,minHeight:1,frame:false,thickFrame:false,hasShadow:false,roundedCorners:false,resizable:false,movable:false,fullscreenable:false,focusable:true,transparent:true,backgroundColor:'#00000000',alwaysOnTop:true,skipTaskbar:true});
   colorFreezeWindows.push(window);window.setAlwaysOnTop(true,'screen-saver');
   ready.push(new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('冻结取色层加载超时')),5000);window.once('ready-to-show',()=>{clearTimeout(timer);if(colorWorker!==worker||session!==colorSession||window.isDestroyed()){resolve();return;}if(display.id===active.id){window.show();window.focus();}else window.showInactive();resolve();});window.once('closed',()=>{clearTimeout(timer);reject(new Error('冻结取色层已关闭'));});}));
  }
  await Promise.all(ready);if(colorWorker!==worker||session!==colorSession)return;
  if(colorWindow&&!colorWindow.isDestroyed()){colorWindow.showInactive();colorWindow.moveTop();colorWindow.webContents.send('one:color-frozen',true);}
 }catch(error){if(colorWorker===worker&&session===colorSession)clearColorFreeze();throw error;}
 finally{if(session===colorSession)colorFreezeBusy=false;}
}
function toggleColorFreeze(){if(colorFreezeBusy||!colorWorker)return;if(colorFreezeWindows.length)clearColorFreeze();else void freezeColor().catch(error=>echo((error as Error).message));}
function closeColors(cancelled=true){colorSession++;screen.removeListener('display-added',refreshColorDisplays);screen.removeListener('display-removed',refreshColorDisplays);screen.removeListener('display-metrics-changed',refreshColorDisplays);const worker=colorWorker,follower=colorFollower;colorWorker=null;colorFollower=null;worker?.postMessage('stop');follower?.postMessage('stop');clearColorFreeze();const zoom=colorZoomWindow;colorZoomWindow=null;if(zoom&&!zoom.isDestroyed())zoom.destroy();const window=colorWindow;colorWindow=null;if(window&&!window.isDestroyed())window.close();colorSample=undefined;colorSentSample=undefined;colorFramePending=false;colorFreezeBusy=false;colorZoomActive=false;colorZoomCardBounds=undefined;input?.setModalActive(recordingShortcut);colorEditor?.finishPicking(cancelled);}
function closeScreenRuler(){const windows=rulerWindows;rulerWindows=[];if(rulerEscapeRegistered){globalShortcut.unregister('Escape');rulerEscapeRegistered=false;}for(const window of windows)if(!window.isDestroyed())window.close();input?.setModalActive(recordingShortcut);}
type ScreenRulerMode='live'|'static';
function openScreenRuler(mode:ScreenRulerMode='live'){
 if(quitting||finishingQuit||rulerWindows.length||rulerOpening)return;
 rulerOpening=true;
 try{
  if(colorWindow)closeColors();
  const displays=screen.getAllDisplays();
  if(mode==='live'){
   if(!globalShortcut.register('Escape',()=>closeScreenRuler()))throw new Error('Esc 快捷键已被占用，无法启动实时屏幕尺');
   rulerEscapeRegistered=true;
  }
  input?.setModalActive(true);
  const pointer=screen.getCursorScreenPoint(),active=screen.getDisplayNearestPoint(pointer);
  for(const display of displays){
   const window=windowFor('screen-ruler',{...display.bounds,minWidth:1,minHeight:1,frame:false,thickFrame:false,hasShadow:false,roundedCorners:false,resizable:false,movable:false,fullscreenable:false,focusable:mode!=='live',transparent:true,backgroundColor:'#00000000',alwaysOnTop:true,skipTaskbar:true},`&scale=${display.scaleFactor}&mode=${mode}`);
   rulerWindows.push(window);
   window.setAlwaysOnTop(true,'screen-saver');window.on('closed',()=>{rulerWindows=rulerWindows.filter(item=>item!==window);if(rulerWindows.length){closeScreenRuler();return;}if(rulerEscapeRegistered){globalShortcut.unregister('Escape');rulerEscapeRegistered=false;}input?.setModalActive(recordingShortcut);});
   window.once('ready-to-show',()=>{if(!window.isDestroyed()&&rulerWindows.includes(window)){if(mode==='static'&&display.id===active.id){window.show();window.focus();}else window.showInactive();}});
  }
 }catch(error){closeScreenRuler();throw error;}finally{rulerOpening=false;}
}
async function acceptColor(hex:string,fromScreen=false){clipboard.writeText(colorFormats(hex)[settings.colorFormat]);closeColors(false);colorEditor.remember(hex);await saveSettings(current=>({...current,colorHistory:[hex,...current.colorHistory.filter(c=>c.toUpperCase()!==hex)].slice(0,20)}));if(quitting||finishingQuit)return;for(const w of BrowserWindow.getAllWindows())if(!w.isDestroyed()&&!w.webContents.isDestroyed())w.webContents.send('one:color',hex);if(fromScreen&&settings.colorShowEditor)colorEditor.show(hex);}
async function pickColor(mode:'live'|'frozen'='live'){
  if(colorWorker||quitting||finishingQuit)return;if(rulerWindows.length)closeScreenRuler();colorSession++;colorZoomActive=false;colorEditor?.startPicking();input?.setModalActive(true);
  const point=screen.getCursorScreenPoint();const window=windowFor('color-picker',{x:point.x+24,y:point.y+24,width:216,height:276,minWidth:1,minHeight:1,resizable:false,movable:false,focusable:false,transparent:true,backgroundColor:'#00000000',alwaysOnTop:true,skipTaskbar:true,hasShadow:false,thickFrame:false},settings.colorWheelZoom?'&wheelZoom=1':'');
  colorWindow=window;window.setIgnoreMouseEvents(true);window.setAlwaysOnTop(true,'screen-saver');window.on('closed',()=>{if(colorWindow===window)closeColors();});
  let windowReady=false,inputReady=false;
  const showLoupe=()=>{if(windowReady&&inputReady&&mode==='live'&&!window.isDestroyed()&&colorWindow===window){window.showInactive();sendColorFrame();}};
  window.once('ready-to-show',()=>{windowReady=true;showLoupe();});
  const follower=new Worker(join(__dirname,'color-position-worker.cjs'),{workerData:{hwnd:Number(window.getNativeWindowHandle().readBigUInt64LE()),displays:colorDisplays()}});colorFollower=follower;
  follower.on('message',message=>{if(message.paused&&colorFollower===follower&&colorZoomCardBounds&&!window.isDestroyed()){window.setBounds(colorZoomCardBounds,false);window.moveTop();}if(message.error&&colorFollower===follower){closeColors();echo(message.error);}});follower.once('error',error=>{if(colorFollower===follower){closeColors();echo(error.message);}});follower.once('exit',()=>{if(colorFollower===follower)closeColors();});
  screen.on('display-added',refreshColorDisplays);screen.on('display-removed',refreshColorDisplays);screen.on('display-metrics-changed',refreshColorDisplays);
  const worker=new Worker(join(__dirname,'color-worker.cjs'),{workerData:{wheelZoomEnabled:settings.colorWheelZoom}});colorWorker=worker;
  let resolveReady!:()=>void,rejectReady!:(error:Error)=>void;const ready=new Promise<void>((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
  worker.on('message',message=>{if(colorWorker!==worker||window.isDestroyed())return;
    if(message.ready){inputReady=true;resolveReady();showLoupe();return;}
    if(message.error){if(!inputReady)rejectReady(new Error(message.error));else{closeColors();echo(message.error);}return;}
    if(message.toggleFreeze){updateColorZoom(false);toggleColorFreeze();return;}
    if(message.cancel){closeColors();return;}if(message.pick){void acceptColor(message.pick,true).catch(error=>echo(error.message));return;}
    if(message.sample){const s=message.sample;updateColorZoom(!!s.zoomFrozen,s.x,s.y);colorSample={url:'',data:s.data,width:s.width,height:s.height,hex:s.hex,pixels:s.pixels,x:s.x,y:s.y,centerX:s.centerX,centerY:s.centerY,cropX:s.cropX,cropY:s.cropY,zoomFrozen:s.zoomFrozen};
      sendColorFrame();
    }
  });worker.once('error',error=>{if(colorWorker===worker){if(!inputReady)rejectReady(error);else{closeColors();echo(error.message);}}});worker.once('exit',()=>{if(colorWorker===worker){if(!inputReady)rejectReady(new Error('取色输入监听已退出'));else closeColors();}});
  const timeout=setTimeout(()=>rejectReady(new Error('取色输入监听未能启动')),4000);
  try{await ready;if(mode==='frozen'&&colorWorker===worker)await freezeColor();}
  catch(error){if(colorWorker===worker)closeColors();throw error;}
  finally{clearTimeout(timeout);}
}
function refreshWindowAppearance(){const a=themeAutomation?.appearance()||settings.appearance,dark=a.mode==='dark'||a.mode==='system'&&nativeTheme.shouldUseDarkColors;for(const w of BrowserWindow.getAllWindows()){if(w.isDestroyed()||w.webContents.isDestroyed())continue;const role=roles.get(w.webContents.id);if(['main','preview','picker','search','color-editor','command-confirm','tray-menu'].includes(role||'')){w.setBackgroundColor(dark?a.darkBackground:a.lightBackground);}w.webContents.send('one:appearance',a);}}
function syncThemeAfterWake(){void themeAutomation?.sync();}
function colorShortcutStatus(){return {active:!!registeredColorShortcut,error:colorShortcutError};}
function hotkeyConflict(shortcut:string,field:string){
 if(!recordingShortcut||typeof shortcut!=='string'||shortcut.length>100||typeof field!=='string'||field.length>80)throw new Error('快捷键查询无效');
 const normalize=(value:string)=>value.toLowerCase().replace(/\b(control|ctrl)\b/g,'ctrl').replace(/\b(super|meta|win)\b/g,'win').split('+').map(part=>part.trim()).sort().join('+');
 const wanted=normalize(shortcut);
 const own:[string,string,string,boolean][]=[['display-shortcut-increase','显示器调亮',settings.displays.shortcuts.increase,true],['display-shortcut-decrease','显示器调暗',settings.displays.shortcuts.decrease,true],['theme-shortcut','主题切换',settings.themeSchedule.shortcut,true],['color-shortcut','屏幕取色',settings.colorShortcut,true],['topmost-shortcut','窗口置顶',settings.utilities.topmost.shortcut,settings.utilities.topmost.enabled],['clicker-shortcut','鼠标连点',settings.utilities.clicker.shortcut,settings.utilities.clicker.enabled],['search-shortcut','文件搜索',settings.search.shortcut,true],['search-programShortcut','程序搜索',settings.search.programShortcut,true]];
 const match=own.find(([id,,value,enabled])=>id!==field&&enabled&&value&&normalize(value)===wanted);
 if(match)return {source:'one' as const,label:`One 的「${match[1]}」正在使用`};
 const accelerator=shortcut.replace(/\bCtrl\b/gi,'Control').replace(/\b(Win|Meta)\b/gi,'Super');
 try{if(globalShortcut.isRegistered(accelerator))return {source:'external' as const,label:'热键已注册'};if(!globalShortcut.register(accelerator,()=>{}))return {source:'external' as const,label:'其他程序或 Windows 已占用'};globalShortcut.unregister(accelerator);return {source:'none' as const,label:''};}
 catch{return {source:'external' as const,label:'此组合键无法注册；可能是 Windows 保留快捷键'};}
}
function colorShortcut(value:string){
  try{
    if(registeredColorShortcut)globalShortcut.unregister(registeredColorShortcut);registeredColorShortcut='';
    if(value){const normalized=value.replace(/\b(Ctrl)\b/gi,'Control').replace(/\b(Win|Meta)\b/gi,'Super');if(!globalShortcut.register(normalized,()=>void pickColor().catch(error=>echo(error.message))))throw new Error('取色快捷键已被占用，请更换组合键');registeredColorShortcut=normalized;}
    colorShortcutError='';
  }catch(error){colorShortcutError=String((error as Error).message||error);throw error;}
  finally{if(main&&!main.isDestroyed()&&!main.webContents.isDestroyed())main.webContents.send('one:color-shortcut-status',colorShortcutStatus());}
}
function stopShortcutRecording(token?:string){
  if(token&&token!==activeShortcutToken)return;
  activeShortcutToken='';shortcutCapture.stop();
  if(!recordingShortcut)return;
  recordingShortcut=false;input.setModalActive(!!colorWorker);topmost.record(false);searchBridge.record(false);
  try{colorShortcut(settings.colorShortcut);}catch{}
  try{themeAutomation?.registerShortcut(settings.themeSchedule.shortcut);}catch{}
  if(!inputPaused)displayShortcuts?.configure(settings.displays.shortcuts);
}
async function startShortcutRecording(token:string){
  stopShortcutRecording();activeShortcutToken=token;recordingShortcut=true;
  input.setModalActive(true);topmost.record(true);searchBridge.record(true);themeAutomation?.pauseShortcut();displayShortcuts?.pause();
  if(registeredColorShortcut)globalShortcut.unregister(registeredColorShortcut);registeredColorShortcut='';
  const hwnd=main.getNativeWindowHandle().readBigUInt64LE();
  await shortcutCapture.start(hwnd,key=>{
    if(activeShortcutToken===token&&!main.isDestroyed()&&!main.webContents.isDestroyed())main.webContents.send('one:shortcut-captured',{token,...key});
  });
}
async function previewExplorerSelection(hwnd:number,focus:number){
 const context=await searchBridge.context(hwnd,focus),current=foreground(true);
 if(current?.hwnd!==hwnd||current.focus!==focus||context.kind!=='explorer'||context.selected?.length!==1)return;
 await preview(filePath(context.selected[0]));
}
function registerIPC() {
  handle('diagnostics-list',()=>diagnosticsList(app.getPath('userData'),app.getPath('crashDumps')),['main']);
  handle('diagnostics-recent',()=>diagnosticsRecent(app.getPath('userData'),app.getPath('crashDumps')),['main']);
  handle('diagnostics-delete',(_event,ids)=>diagnosticsDelete(app.getPath('userData'),app.getPath('crashDumps'),ids),['main']);
  handle('diagnostics-export',async(_event,ids)=>{if(!Array.isArray(ids)||ids.length>100)throw new Error('导出列表无效');const target=await pickPath('directory','选择诊断资料保存位置');return target?diagnosticsExport(app.getPath('userData'),app.getPath('crashDumps'),target,ids):null;},['main']);
  handle('diagnostics-open',()=>shell.openPath(join(app.getPath('userData'),'logs')),['main']);
  handle('diagnostics-report',(_event,kind,detail)=>{if(typeof kind!=='string'||kind.length>60||typeof detail!=='string'||detail.length>16*1024)throw new Error('错误报告无效');runtimeError(app.getPath('userData'),`renderer:${kind}`,detail);},['main']);
  handle('explorer-menu-state',()=>explorerMenuState());
  handle('explorer-menu-set',(_event,value)=>setExplorerMenu(value));
  handle('file-action-data',event=>{const target=fileActions.get(event.sender.id);if(!target)throw Error('文件操作窗口无效');return target;});
  handle('file-action-open',(_event,tool,paths)=>{if(!['rename','locksmith'].includes(tool)||!Array.isArray(paths)||paths.length>(tool==='locksmith'?32:4096))throw Error('文件操作请求无效');openFileAction({tool,paths:paths.map(filePath)});});
  handle('file-tools-run',(event,task)=>fileTools.run(event.sender.id,task));
  handle('archive-run',(event,request:ArchiveRequest,id?:string)=>archiveService.run(event.sender.id,request,id));
  handle('archive-edit-start',(event,request:import('../shared/archive-edit-session').ArchiveEditStart,id?:string)=>archiveService.edits.start(event.sender.id,request,id),['main']);
  handle('archive-edit-list',()=>archiveService.edits.list(),['main']);
  handle('archive-edit-check',(_event,id:string)=>archiveService.edits.check(id),['main']);
  handle('archive-edit-open',(_event,id:string,choose?:boolean)=>archiveService.edits.open(id,choose===true),['main']);
  handle('archive-edit-save',(event,id:string,token:string,password?:string,taskId?:string)=>archiveService.edits.save(event.sender.id,id,token,password,taskId),['main']);
  handle('archive-edit-discard',(_event,id:string,token:string)=>archiveService.edits.discard(id,token),['main']);
  handle('archive-edit-inspect',(event,id:string,password?:string,taskId?:string)=>archiveService.edits.inspect(event.sender.id,id,password,taskId),['main']);
  handle('archive-edit-resolve',(event,id:string,token:string,password?:string,taskId?:string)=>archiveService.edits.resolve(event.sender.id,id,token,password,taskId),['main']);
  handle('archive-edit-export',async(event,id:string,token:string)=>{const item=await archiveService.edits.check(id);if(item.token!==token)throw Error('编辑文件已变化，请重新检查');const window=BrowserWindow.fromWebContents(event.sender);if(!window)throw Error('编辑窗口已关闭');const selected=await dialog.showSaveDialog(window,{title:'另存编辑副本',defaultPath:join(app.getPath('documents'),basename(item.file)),properties:['showOverwriteConfirmation']});if(selected.canceled||!selected.filePath)return null;return archiveService.edits.export(id,token,selected.filePath);},['main']);
  handle('archive-recovery-list',(_event,offset?:number)=>archiveService.recoveryPage(offset),['main']);
  handle('archive-recovery-inspect',(event,id:string)=>archiveService.inspectRecovery(event.sender.id,id),['main']);
  handle('archive-recovery-restore',(event,id:string)=>archiveService.restoreRecovery(event.sender.id,id),['main']);
  handle('archive-recovery-cleanup',(event,id:string,stageToken?:string)=>archiveService.cleanupRecovery(event.sender.id,id,stageToken),['main']);
  handle('archive-recovery-cancel',(event,id:string)=>archiveService.cancelRecoveryInspection(event.sender.id,id),['main']);
  handle('archive-recovery-forget',(_event,id:string)=>archiveService.forgetRecovery(id),['main']);
  handle('archive-cancel',(event,id:string)=>archiveService.cancel(id,event.sender.id),['main','preview']);
  handle('preview-archive',(event,request:import('../shared/archive').PreviewArchiveRequest,id:string)=>previewArchive(()=>previews.get(event.sender.id),request,id,(value,task)=>archiveService.run(event.sender.id,value,task)),['preview']);
  handle('archive-cancel-id',(_event,id:string)=>{if(typeof id!=='string'||!(/^[a-f0-9-]{36}$/i).test(id))throw Error('任务标识无效');const owner=archiveService.cancelId(id),window=BrowserWindow.getAllWindows().find(w=>!w.isDestroyed()&&w.webContents.id===owner);window?.webContents.send('one:archive-cancel-requested',id);},['main']);
  handle('archive-association',(_event,operation)=>archiveAssociation(operation));
  handle('file-tools-cancel',(event,kind)=>fileTools.cancel(event.sender.id,kind));
  handle('file-tools-cancel-id',(_event,id)=>{if(typeof id!=='string'||!(/^[a-f0-9-]{36}$/).test(id))throw Error('任务标识无效');return fileTools.cancelId(id);},['main']);
  handle('file-tools-page',(_event,id,page,group)=>fileTools.page(id,page,group));
  handle('file-tools-history',()=>fileTools.history());
  handle('file-tools-overview',async(event,active)=>{if(active!==undefined&&typeof active!=='boolean')throw Error('概览请求无效');const w=BrowserWindow.fromWebContents(event.sender);if(active!==undefined)diskMonitor.subscribe(active&&!!w?.isVisible()&&!w.isMinimized(),'overview');const [recent,archive]=await Promise.all([fileTools.history(),archiveService.taskOverview()]);return({version:app.getVersion(),index:{count:search.state().count,running:search.state().running,error:search.state().error},disk:diskService.state(),volumes:diskMonitor.state.volumes,active:fileTools.active(),failures:fileTools.recentFailures(),recent,archive});});
  handle('echo-displays',()=>screen.getAllDisplays().map(d=>({id:String(d.id),name:d.label||'显示器 '+d.id,width:d.workArea.width,height:d.workArea.height})));
  handle('echo-ready',e=>echoes.ready(BrowserWindow.fromWebContents(e.sender)!),['echo']);
  handle('echo-position',()=>echoes.edit());handle('echo-finish',e=>echoes.finish(BrowserWindow.fromWebContents(e.sender)!),['echo']);
  handle('system-information',(_e,kind,refresh)=>{if(!validInformationKind(kind)||refresh!==undefined&&typeof refresh!=='boolean')throw new Error('系统信息请求无效');return systemInformation.read(kind,refresh);});
  handle('proxy-diagnostics',(_e,refresh)=>{if(refresh!==undefined&&typeof refresh!=='boolean')throw new Error('代理检测请求无效');return proxyDiagnostics.read(refresh);});
  handle('proxy-connectivity',(_e,request)=>proxyDiagnostics.test(request));
  handle('proxy-connectivity-cancel',(_e,id)=>proxyDiagnostics.cancel(id));
  handle('dns-check',(_e,domain)=>checkDns(domain),['main']);
  handle('export-system-information',async(_e,reports)=>{if(!Array.isArray(reports)||reports.length>16||JSON.stringify(reports).length>8*1024*1024)throw new Error('系统信息报告无效');const path=await pickPath('save','导出系统信息','系统信息.json');if(!path)return null;await writeFile(path,JSON.stringify({created:new Date().toISOString(),reports},null,2),'utf8');return path;});
  handle('disk-monitor',(event,active,source='maintenance')=>{if(!['maintenance','information'].includes(source)||active!==undefined&&typeof active!=='boolean')throw new Error('磁盘监控请求无效');const w=BrowserWindow.fromWebContents(event.sender);return active===undefined?diskMonitor.state:diskMonitor.subscribe(active&&!!w?.isVisible()&&!w.isMinimized(),source);});
  handle('disk-trace',(_e,enabled)=>{if(typeof enabled!=='boolean')throw new Error('跟踪请求无效');return diskMonitor.trace(enabled);});
  handle('maintenance-scan',(_e,kind)=>maintenance.scan(kind));handle('maintenance-cancel',(_e,kind)=>maintenance.cancel(kind));handle('maintenance-apply',(_e,report,ids)=>maintenance.apply(report,ids));handle('maintenance-receipts',()=>maintenance.receipts());handle('maintenance-restore',(_e,id)=>maintenance.restore(id));handle('maintenance-manage',(_e,kind)=>maintenance.manage(kind));
  handle('file-icons',(_event,paths)=>{if(!Array.isArray(paths)||paths.length>150)throw new Error('文件图标请求无效');for(const path of paths)if(typeof path==='string'&&path.startsWith('one-builtin:')){if(!builtinImagePath(path.slice(12)))throw new Error('系统图标无效');}else if(typeof path==='string'&&path.startsWith('one-program:')){if(!/^[\w .+-]+\.exe$/i.test(path.slice(12)))throw new Error('程序图标无效');}else if(typeof path!=='string'||!launcher?.get(path))filePath(path);return fileIcons.read(paths);},['main','search','search-menu','file-context','picker','dialog-bar']);
  handle('search-size',(event,rows,active)=>{const w=BrowserWindow.fromWebContents(event.sender);if(!w||w!==searchWindow||typeof rows!=='number'||!Number.isFinite(rows)||rows<0)return;if(inlineSearch)overlay?.resize(rows,!!active);else {const b=w.getBounds(),area=screen.getDisplayMatching(b).workArea;const height=active?Math.min(560,Math.max(320,area.height-64)):settings.search.savedQueries.length?112:64;const y=active?Math.max(area.y,Math.min(b.y,area.y+area.height-height-16)):b.y;if(Math.abs(b.height-height)>1||Math.abs(b.y-y)>1)w.setBounds({...b,y,height},false);}},['search']);
  handle('search-menu',event=>menuFor(event.sender.id)?.items||[],['search-menu']);
  handle('menu-bar',event=>menuFor(event.sender.id)?.bar||{top:[],bottom:[]},['search-menu']);
  handle('menu-presets',()=>menuPresets.read());
  handle('menu-confirmation-data',event=>menuConfirmation.data(event.sender.id),['command-confirm']);
  handle('menu-confirmation-answer',(event,accepted)=>{if(typeof accepted!=='boolean')throw new Error('确认操作无效');menuConfirmation.answer(event.sender.id,accepted);},['command-confirm']);
  handle('menu-children',async(_event,id)=>{await menuContextReady;return menuService.children(textValue(id,100));},['search-menu']);
  handle('menu-open',async(event,id,anchor)=>{const parent=menuFor(event.sender.id);if(!parent)return;const request=++parent.revision;hideMenus(parent.depth+1);if(id===null)return;const item=[...parent.items,...parent.bar.top,...parent.bar.bottom].find(n=>n.id===textValue(id,100));if(!item||!anchor||![anchor.top,anchor.right].every(Number.isFinite))throw new Error('菜单位置无效');const rootRevision=menuRevision;await menuContextReady;const items=item.children||await menuService.children(item.id);if(rootRevision!==menuRevision||parent.revision!==request||parent.window.isDestroyed()||!parent.window.isVisible())return;
   const p=menuPanel(parent.depth+1),bounds=parent.window.getBounds();p.point={x:bounds.x+Math.min(bounds.width,Math.max(0,anchor.right))-4,y:bounds.y+Math.max(0,Math.min(bounds.height,anchor.top))-7};p.source=item.id;p.items=items;positionMenu(p,286,Math.max(40,Math.min(620,items.length?items.reduce((n,i)=>n+(i.kind==='separator'?13:35),16):70)));sendMenu(p);p.readiness.run(()=>{if(rootRevision===menuRevision&&parent.revision===request&&!parent.window.isDestroyed()&&parent.window.isVisible()&&!p.window.isDestroyed()){sendMenu(p);p.window.setAlwaysOnTop(true,'pop-up-menu');p.window.showInactive();p.window.moveTop();if(anchor.focus)popupFocus(p.window);}});
  },['search-menu']);
  handle('menu-back',event=>{const p=menuFor(event.sender.id);if(p?.depth){hideMenus(p.depth);popupFocus(menuPanels[p.depth-1].window);}},['search-menu']);
  handle('menu-execute',async(_event,id)=>{menuExecuting=true;await menuContextReady;hideMenus();const revision=menuRevision;try{await menuService.execute(textValue(id,100));}catch(error){if(revision===menuRevision&&menuWindow&&!menuWindow.isDestroyed())popupFocus(menuWindow);throw error;}finally{menuExecuting=false;}},['search-menu']);
  handle('menu-size',(event,value)=>{const p=menuFor(event.sender.id);if(p&&value&&[value.width,value.height].every(n=>Number.isFinite(n)&&n>0))positionMenu(p,value.width,value.height);},['search-menu']);
  handle('menu-favorite',async()=>{await favoriteCurrentFolder();hideMenus(1);menuNodes=await menuService.open(searchContext);const p=menuPanel(0);p.items=menuNodes;p.bar=menuService.toolbar();sendMenu(p);return menuNodes;},['search-menu']);
  handle('menu-settings',()=>{hideMenus();showMain();main.webContents.send('one:search-settings');},['search-menu']);
  handle('search-context-menu',(event,value,point,directory)=>{const owner=BrowserWindow.fromWebContents(event.sender);if(!owner||!point||![point.x,point.y].every(Number.isFinite))throw new Error('右键菜单位置无效');const item=typeof value==='string'?launcher.get(value):undefined,path=item?item.path:filePath(value),b=owner.getContentBounds();fileMenu.show(owner,path,{x:Math.max(0,Math.min(b.width,point.x)),y:Math.max(0,Math.min(b.height,point.y))},directory===true,item?.launchKind==='action'?undefined:item?.launchKind,item?launcher.enrich(item).name:undefined);},['search']);
  handle('file-menu-data',event=>fileMenu.data(event.sender.id),['file-context']);
  handle('file-menu-submenu',(_e,session,top,focus)=>fileMenu.submenu(textValue(session,100),top,focus===true),['file-context']);
  handle('file-menu-apps',(_e,session)=>fileMenu.apps(textValue(session,100)),['file-context']);
  handle('file-menu-size',(event,session,height)=>fileMenu.resize(textValue(session,100),height,event.sender.id),['file-context']);
  handle('file-menu-close',(event,focus,childOnly)=>fileMenu.close(event.sender.id,focus===true,childOnly===true),['file-context']);
  handle('file-menu-action',(_e,session,action,value)=>fileMenu.run(textValue(session,100),action,value===undefined?undefined:textValue(value,32768)),['file-context']);
  handle('search-state',()=>searchState(),['main','search']);handle('search-preferences',()=>settings.search,['main','search']);
  handle('port-snapshot',(_event,refresh)=>{if(refresh!==undefined&&typeof refresh!=='boolean')throw Error('端口扫描参数无效');return ports.snapshot(refresh===true);},['main']);
  handle('search-saved-query',async(_event,operation,value)=>{
    if(operation!=='add'&&operation!=='remove')throw Error('搜索条件操作无效');
    if(operation==='remove'&&(typeof value!=='string'||!(/^[\w-]{1,80}$/).test(value)))throw Error('搜索条件标识无效');
    const next=await saveSettings(current=>{
      const savedQueries=operation==='add'?[...current.search.savedQueries,value]:current.search.savedQueries.filter(item=>item.id!==value);
      return mergeSettings(current,{search:{savedQueries}});
    });
    return next.search;
  },['search']);
  handle('search-files',async(event,query,foldersOnly,token,rootScope)=>{
    if(token!==undefined&&(typeof token!=='string'||!/^[a-f0-9-]{36}$/.test(token)))throw new Error('搜索标识无效');
    if(rootScope!==undefined&&rootScope!==''&&(roles.get(event.sender.id)!=='search'||typeof rootScope!=='string'||!settings.search.savedQueries.some(saved=>saved.folder===rootScope)))throw new Error('搜索范围无效');
    const role=roles.get(event.sender.id),include=role==='search'&&!event.sender.getURL().includes('embedded')&&!foldersOnly;
    if(role==='dialog-bar')foldersOnly=true;
    const folder=role==='search'?searchContext.currentFolder:role==='dialog-bar'?dialogBar.context?.currentFolder:'';
    const enrich=(result:import('../shared/search').SearchResult)=>({...result,items:result.items.map(item=>launcher.enrich(item))});
    const progress=token?(result:import('../shared/search').SearchResult)=>{if(!event.sender.isDestroyed())event.sender.send('one:search-progress',{token,result:enrich(result)});}:undefined;
    return enrich(await search.query(query,foldersOnly,folder,event.sender.id,include,progress,rootScope||''));
  },['main','search','dialog-bar']);handle('search-rebuild',()=>search.rebuild(settings.search));handle('search-cancel',()=>search.cancel());handle('search-show',()=>showSearch());
  handle('dialog-bar-data',event=>{if(!dialogBar.owns(event.sender.id))throw Error('目录栏已失效');return dialogBar.data();},['dialog-bar']);
  handle('dialog-bar-choose',(event,path)=>{if(!dialogBar.owns(event.sender.id))throw Error('目录栏已失效');return dialogBar.choose(filePath(path));},['dialog-bar']);
  handle('dialog-bar-size',(_event,rows,active)=>{if(!Number.isFinite(rows)||rows<0||typeof active!=='boolean')throw Error('目录栏尺寸无效');dialogBar.resize(rows,active);},['dialog-bar']);
  handle('dialog-bar-collapse',()=>dialogBar.closeResults(),['dialog-bar']);
  handle('dialog-bar-settings',()=>{showMain();main.webContents.send('one:search-settings','entry');},['dialog-bar']);
  handle('search-context',()=>searchContext,['search']);handle('search-ready',(event)=>{const window=BrowserWindow.fromWebContents(event.sender);if(window){searchReadyWindows.add(event.sender.id);if(window===searchWindow)replaySearchInput(window,searchRevision);}},['search']);
  handle('search-choose',(_e,value)=>chooseSearch(value),['search']);
  handle('search-action',async(_event,id)=>{
    const pages=['home','tools','archive','text','search','input','disk','locksmith','system','hardware','ports','preview','color','settings'];
    if(typeof id!=='string'||!['preview','diff','rename','locksmith','disk','integrity','tasks',...pages.map(page=>'page:'+page)].includes(id))throw Error('搜索动作无效');
    const selected=(searchContext.selected||[]).slice(0,32).map(filePath),folder=searchContext.currentFolder;
    searchWindow?.hide();showMain();
    if(id.startsWith('page:')){main.webContents.send('one:navigate-page',{page:id.slice(5)});return;}
    if(id==='preview'&&selected[0]){await preview(selected[0]);return;}
    if(id==='locksmith'){main.webContents.send('one:navigate-page',{page:'locksmith',paths:selected.length?selected:folder?[filePath(folder)]:[]});return;}
    if(id==='disk'){main.webContents.send('one:navigate-page',{page:'disk',...(folder?{folder:filePath(folder)}:{})});return;}
    if(id==='tasks'){main.webContents.send('one:navigate-page',{page:'home',section:'tasks'});return;}
    if(id==='preview'){main.webContents.send('one:navigate-page',{page:'preview'});return;}
    main.webContents.send('one:navigate-page',{page:'tools',tool:id==='integrity'?'integrity':id,paths:selected,...(folder?{folder:filePath(folder)}:{})});
  },['search']);
  handle('inspect-locks',(_event,value)=>{const path=filePath(value);showMain();main.webContents.send('one:lock-target',path);},['main','preview','search']);
  handle('lock-state',event=>locksFor(event.sender.id).state());handle('lock-scan',(event,paths)=>locksFor(event.sender.id).scan(paths));handle('lock-cancel',event=>locksFor(event.sender.id).cancel());handle('lock-end',(event,token)=>locksFor(event.sender.id).end(token));
  handle('utility-state',()=>utilityState());handle('topmost-windows',()=>topmost.list());handle('topmost-toggle',(_event,id)=>topmost.toggle(id));handle('topmost-clear',()=>topmost.clear());handle('clicker-state',()=>clicker.state());handle('clicker-start',()=>clicker.start());handle('clicker-stop',()=>clicker.stop());handle('clicker-capture',()=>clicker.capture());
  handle('window-action', (event, action) => { const window = BrowserWindow.fromWebContents(event.sender); if (!window) return; if (action === 'minimize') window.minimize(); else if (action === 'maximize') { if (window.isMaximized()) window.unmaximize(); else window.maximize(); } else if (action === 'close') window.close(); else throw new Error('窗口操作无效'); }, ['main','preview','picker','search','color-editor','command-confirm','dialog-bar']);
  handle('window-state', event => {const w=BrowserWindow.fromWebContents(event.sender);return {maximized:w?.isMaximized()??false,visible:!!w?.isVisible()&&!w.isMinimized()};}, ['main','preview','picker','search','color-editor','command-confirm','dialog-bar']);
  handle('brightness-status', () => brightness.status());
  handle('settings', () => settings);
  handle('tray-menu-state',event=>trayMenuPanel?.view(event.sender),['tray-menu']);
  handle('tray-menu-ready',event=>trayMenuPanel?.ready(event.sender),['tray-menu']);
  handle('tray-menu-hide',event=>{trayMenuPanel?.verify(event.sender);trayMenuPanel?.close();},['tray-menu']);
  handle('tray-menu-action',async(event,value)=>{
    trayMenuPanel?.verify(event.sender);
    if(typeof value!=='string'||!trayMenuEntries({paused:inputPaused,launchAtLogin:settings.general.launchAtLogin}).some(item=>item.id===value))throw new Error('托盘菜单操作不可用');
    const action=value as TrayMenuAction;
    if(action!=='pause'&&action!=='startup')trayMenuPanel?.close();
    if(action==='open')showMain();
    else if(action==='search')showSearch();
    else if(action==='preview'||action==='disk'){showMain();main.webContents.send('one:navigate-page',{page:action});}
    else if(action==='pause'){inputPaused=!inputPaused;if(inputPaused){input.stop();displayShortcuts?.pause();echoes?.hide();}else{input.update(settings);displayShortcuts?.configure(settings.displays.shortcuts);}trayMenuPanel?.changed();}
    else if(action==='startup')await saveSettings(current=>({...current,general:{...current.general,launchAtLogin:!current.general.launchAtLogin}}));
    else if(action==='restart')restartOne();
    else if(action==='quit')app.quit();
  },['tray-menu']);
  handle('save-settings', (_event,value)=>saveSettings(validateSettings(value)));
  handle('patch-settings',(_event,patch)=>saveSettings(current=>mergeSettings(current,patch)));
  handle('app-info',async()=>({version:app.getVersion(),dataPath:app.getPath('userData'),packaged:app.isPackaged,administrator:await administrator()}));
  handle('elevate',()=>elevate());
  handle('restart-normal',()=>restartNormal());
  handle('restart',()=>restartOne());
  handle('settings-backup-export',()=>exportSettingsBackup());
  handle('settings-backup-import',()=>importSettingsBackup());
  handle('appearance',()=>themeAutomation?.appearance()||settings.appearance,['main','preview','copy','picker','echo','color-picker','color-editor','command-confirm','search','search-menu','tray-menu','file-context','dialog-bar']);
  handle('installed-fonts',(_event,refresh)=>{if(refresh===true)fontSources.clear();return installedFonts(refresh===true);});
  handle('ui-font-source',async(event,family)=>{
    if(roles.get(event.sender.id)!=='main'&&family!==settings.appearance.font.slice(10))throw new Error('字体未被选择');
    if(typeof family!=='string')throw new Error('字体名称无效');
    let pending=fontSources.get(family);
    if(!pending){pending=fontSource(family).then(source=>{if(!source)return null;let url:string|undefined;if(source.path){const token=randomUUID();fontAssets.set(token,{path:source.path,mime:extname(source.path).toLowerCase()==='.otf'?'font/otf':'font/ttf'});url=`one-file://asset/${token}/font`;}return{url,local:source.local};}).catch(error=>{fontSources.delete(family);throw error;});fontSources.set(family,pending);}
    return pending;
  },['main','preview','copy','picker','echo','color-picker','color-editor','command-confirm','search','search-menu','tray-menu','file-context','dialog-bar']);
  handle('pick-color',(_event,mode)=>{if(mode!==undefined&&mode!=='live'&&mode!=='frozen')throw new Error('取色模式无效');return pickColor(mode);},['main','color-editor']);
  handle('color-frozen-status',()=>colorFreezeWindows.length>0,['color-picker']);
  handle('screen-ruler-open',(_event,mode)=>{if(mode!==undefined&&mode!=='live'&&mode!=='static')throw new Error('屏幕尺模式无效');return openScreenRuler(mode);},['main']);
  handle('screen-ruler-close',()=>closeScreenRuler(),['screen-ruler']);
  handle('color-editor-show',(_event,hex)=>{if(hex!==undefined&&(typeof hex!=='string'||!/^#[0-9a-f]{6}$/i.test(hex)))throw new Error('颜色无效');colorEditor.show(hex?.toUpperCase());});
  handle('color-state',()=>colorEditor.snapshot(),['main','color-editor']);
  handle('color-editor-size',(_event,height)=>{if(typeof height!=='number'||!Number.isFinite(height)||height<200||height>1800)throw new Error('窗口尺寸无效');colorEditor.resize(height);},['color-editor']);
  handle('display-list',()=>displayManagement.list(),['main']);
  handle('display-probe',(_event,id)=>displayManagement.probe(id),['main']);
  handle('display-set',(_event,id,parameter,value)=>displayManagement.set(id,parameter,value),['main']);
  handle('display-set-brightness',(_event,id,value)=>displayManagement.setBrightness(id,value),['main']);
  handle('display-profile-save',(_event,name,id)=>displayProfiles.save(name,id),['main']);
  handle('display-profile-rename',(_event,id,name)=>displayProfiles.rename(id,name),['main']);
  handle('display-profile-delete',(_event,id)=>displayProfiles.remove(id),['main']);
  handle('display-profile-apply',(_event,id)=>displayProfiles.apply(id),['main']);
  handle('barcode-file',(_event,path)=>barcodeFile(path));
  handle('image-pick-files',async event=>{const owner=BrowserWindow.fromWebContents(event.sender)||main;if(!owner||owner.isDestroyed())throw Error('窗口已关闭');const result=await dialog.showOpenDialog(owner,{title:'选择图片',properties:['openFile','multiSelections'],filters:[{name:'常见图片',extensions:['png','jpg','jpeg','webp','gif','tif','tiff']}]});return result.canceled?[]:result.filePaths;});
  handle('image-convert-pick-files',async event=>{const owner=BrowserWindow.fromWebContents(event.sender)||main;if(!owner||owner.isDestroyed())throw Error('窗口已关闭');const result=await dialog.showOpenDialog(owner,{title:'选择图片或 SVG',properties:['openFile','multiSelections'],filters:[{name:'图片和 SVG',extensions:['png','jpg','jpeg','webp','gif','tif','tiff','heic','heif','svg']}]});return result.canceled?[]:result.filePaths;},['main']);
  handle('image-convert-start',(event,paths,directory,options)=>imageConvert.start(event.sender.id,paths,directory,options,progress=>{if(!event.sender.isDestroyed())event.sender.send('one:image-convert-progress',progress);}));
  handle('image-convert-cancel',event=>imageConvert.cancel(event.sender.id));
  handle('image-convert-capabilities',()=>imageCodecCapabilities(),['main']);
  handle('image-ai-model-status',async()=>({ready:await imageAi.modelReady(),bytes:imageAi.modelBytes}),['main']);
  handle('image-ai-start',(event,source,directory)=>imageAi.start(event.sender.id,source,directory,progress=>{if(!event.sender.isDestroyed())event.sender.send('one:image-ai-progress',progress);}),['main']);
  handle('image-superres-model-status',async()=>({ready:await imageAi.superResolutionReady(),bytes:imageAi.superResolutionBytes}),['main']);
  handle('image-superres-start',(event,source,directory)=>imageAi.startSuperResolution(event.sender.id,source,directory,progress=>{if(!event.sender.isDestroyed())event.sender.send('one:image-superres-progress',progress);}),['main']);
  handle('image-repair-model-status',async()=>({ready:await imageAi.repairReady(),bytes:imageAi.repairBytes}),['main']);
  handle('image-repair-start',(event,source,directory,mask)=>imageAi.startRepair(event.sender.id,source,directory,mask,progress=>{if(!event.sender.isDestroyed())event.sender.send('one:image-repair-progress',progress);}),['main']);
  handle('image-ai-cancel',event=>imageAi.cancel(event.sender.id),['main']);
  handle('image-metadata-start',(event,paths,directory,options)=>imageMetadata.start(event.sender.id,paths,directory,options,progress=>{if(!event.sender.isDestroyed())event.sender.send('one:image-metadata-progress',progress);}),['main']);
  handle('image-metadata-cancel',event=>imageMetadata.cancel(event.sender.id),['main']);
  handle('image-crop-preview',(_event,path)=>imageCropPreview(filePath(path)),['main']);
  handle('image-color-preview',(_event,path)=>imageColorPreview(filePath(path)),['main']);
  handle('image-color-sample',(_event,path,x,y)=>imageColorSample(filePath(path),x,y),['main']);
  handle('base64-export-file',async(_event,value)=>{const source=normalizeBase64(textValue(value,10_000_000)),bytes=Buffer.from(source,'base64');if(!bytes.length||bytes.length>maxBase64FileBytes)throw Error('解码后的文件不能超过 6 MB');const path=await pickPath('save','保存解码文件','解码文件.bin');if(!path)return null;await writeFile(path,bytes);return path;},['main']);
  handle('developer-hash-start',(event,request)=>developerHash.start(event.sender.id,request,progress=>{if(!event.sender.isDestroyed())event.sender.send('one:developer-hash-progress',progress);}),['main']);
  handle('developer-hash-cancel',event=>developerHash.cancel(event.sender.id),['main']);
  handle('developer-qr-generate',async(event,request)=>{qrImages.delete(event.sender.id);const png=await generateQr(request);qrImages.set(event.sender.id,png);return {url:`data:image/png;base64,${png.toString('base64')}`,size:(request as {size:number}).size,bytes:png.length};},['main']);
  handle('developer-qr-copy',event=>{const png=qrImages.get(event.sender.id);if(!png)throw Error('请先生成二维码');return clipboard.write([new ClipboardItem({'image/png':new Blob([new Uint8Array(png)],{type:'image/png'})})]);},['main']);
  handle('developer-qr-export',async event=>{const png=qrImages.get(event.sender.id);if(!png)throw Error('请先生成二维码');const owner=BrowserWindow.fromWebContents(event.sender)||main;const selected=await dialog.showSaveDialog(owner,{title:'导出二维码 PNG',defaultPath:join(app.getPath('pictures'),'One-QR.png'),filters:[{name:'PNG 图片',extensions:['png']}],properties:['showOverwriteConfirmation']});if(selected.canceled||!selected.filePath)return null;const target=selected.filePath.toLowerCase().endsWith('.png')?selected.filePath:`${selected.filePath}.png`;await writeFile(target,png);return target;},['main']);
  handle('barcode-clipboard',()=>barcodeClipboard());
  handle('barcode-capture',()=>barcodeCapture.start(main));
  handle('barcode-cancel-capture',event=>barcodeCapture.cancel(event.sender.id));
  handle('barcode-capture-data',event=>barcodeCapture.data(event.sender.id),['barcode-capture']);
  handle('barcode-capture-choose',(event,rect)=>barcodeCapture.choose(event.sender.id,rect),['barcode-capture']);
  handle('barcode-open-link',async(_event,text)=>{const url=typeof text==='string'&&text.length<=8192?barcodeURL(text):null;if(!url)throw Error('只允许主动打开有效的 HTTP/HTTPS 链接');await shell.openExternal(url);});
  handle('barcode-preview',event=>{const data=previews.get(event.sender.id);if(data?.type!=='image')throw Error('当前预览不是图片');showMain();main.webContents.send('one:navigate-page',{page:'barcode',path:data.path});},['preview']);
  handle('display-shortcut-status',()=>displayShortcuts!.state(),['main']);
  handle('display-shortcut-retry',()=>{if(!recordingShortcut&&!inputPaused)displayShortcuts!.configure(settings.displays.shortcuts);return displayShortcuts!.state();},['main']);
  handle('display-cancel',()=>displayManagement.cancel(),['main']);
  handle('theme-locate',()=>{if(!main||main.isDestroyed()||!main.isVisible()||!main.isFocused())return {state:'unavailable',detail:'请在 One 窗口中获取当前位置，或手动填写经纬度。'};return themeLocation.locate();},['main']);
  handle('theme-location-cancel',()=>themeLocation.cancel(),['main']);
  handle('theme-status',()=>themeAutomation!.state(),['main']);
  handle('theme-manual',(_event,mode)=>themeAutomation!.manual(mode),['main']);
  handle('theme-resume',()=>themeAutomation!.resume(),['main']);
  handle('theme-sync',()=>themeAutomation!.sync(),['main']);
  handle('theme-shortcut-retry',()=>{try{if(!recordingShortcut)themeAutomation!.registerShortcut(settings.themeSchedule.shortcut);}catch{}return themeAutomation!.state();},['main']);
  handle('theme-one-mode',async(_event,mode)=>{
    if(!['system','light','dark'].includes(mode))throw Error('One 外观模式无效');
    let releaseOnlyOne=false;
    await saveSettings(current=>{
      const themeSchedule={...current.themeSchedule,targets:{...current.themeSchedule.targets}};
      if(themeSchedule.targets.one){
        if(themeSchedule.targets.windowsApps||themeSchedule.targets.windowsSystem)themeSchedule.targets.one=false;
        else{themeSchedule.enabled=false;releaseOnlyOne=true;}
      }
      return {...current,appearance:{...current.appearance,mode},themeSchedule};
    });
    if(releaseOnlyOne)await themeAutomation!.resume();
    refreshWindowAppearance();return themeAutomation!.appearance();
  },['main']);
  handle('color-shortcut-status',()=>colorShortcutStatus(),['main']);
  handle('color-shortcut-retry',()=>{try{colorShortcut(settings.colorShortcut);}catch{}return colorShortcutStatus();},['main']);
  handle('color-history-clear',()=>saveSettings(current=>({...current,colorHistory:[]})).then(()=>{}),['main','color-editor']);
  handle('color-capture',()=>colorSample||null,['color-picker','color-zoom']);
  handle('color-frame',()=>{colorFramePending=false;sendColorFrame();},['color-picker']);
  handle('choose-color',async(event,value)=>{if(typeof value!=='string'||!/^#[0-9a-f]{6}$/i.test(value))throw new Error('颜色无效');await acceptColor(value.toUpperCase(),roles.get(event.sender.id)==='color-picker');},['color-picker','color-editor','main']);
    handle('record-shortcut',(_event,active,token)=>{if(typeof active!=='boolean'||typeof token!=='string'||!token||token.length>80)throw new Error('参数无效');return active?startShortcutRecording(token):stopShortcutRecording(token);},['main']);
    handle('hotkey-conflict',(_event,shortcut,field)=>hotkeyConflict(shortcut,field),['main']);
    handle('hotkey-owner',async(_event,shortcut,mode,elevated)=>{
      if(mode!=='auto'&&mode!=='manual'||typeof elevated!=='boolean')throw new Error('热键诊断方式无效');
      if(hotkeyProbeRunning)return {status:'error',message:'热键诊断正在运行'};
      hotkeyProbeRunning=true;stopShortcutRecording();
      runtimeLog(app.getPath('userData'),'hotkey-probe-start',`mode=${mode} elevated=${elevated}`);
      try{
        globalShortcut.setSuspended(true);
        const result=await locateHotkeyOwner(shortcut,mode,elevated);
        runtimeLog(app.getPath('userData'),'hotkey-probe-result',`status=${result.status}${result.status==='found'?` pid=${result.pid}`:''}`);
        return result;
      }catch(error){runtimeError(app.getPath('userData'),'hotkey-probe-error',error);throw error;}
      finally{globalShortcut.setSuspended(false);hotkeyProbeRunning=false;}
    },['main']);
  // The default floating level reorders behind the taskbar, which can clear WS_EX_TOPMOST on Windows.
  handle('preview-preferences',async(_event,value)=>{if(value===undefined)return settings.preview;return (await saveSettings(current=>mergeSettings(current,{preview:value}))).preview;},['preview']);
  handle('preview-open-with',event=>{const data=previews.get(event.sender.id);if(!data)throw new Error('预览尚未准备');return openWithApplications(data.path);},['preview']);
  handle('preview-open-in',async(event,id)=>{const data=previews.get(event.sender.id);if(!data)throw new Error('预览尚未准备');await openInApplication(data.path,id);},['preview']);
  handle('preview-motion-export',async event=>{
   const ownerId=event.sender.id,data=previews.get(ownerId);if(data?.type!=='image'||!data.motionPhoto)throw Error('当前预览没有可导出的动态视频');
   if(motionVideoExports.has(ownerId))throw Error('动态视频正在导出');
   const controller=new AbortController();motionVideoExports.set(ownerId,controller);let temporary:LivpTemporary|undefined;
   try{
    const source=await stat(data.path);if(source.size!==data.size||source.mtimeMs!==data.modified)throw Error('动态照片已变化，请重新打开照片');
    const contents=extname(data.path).toLowerCase()==='.livp'?await inspectLivp(data.path):undefined;
    temporary=contents?.temporary;
    const motion=contents?contents.movie:await inspectMotionPhoto(data.path);
    if(!motion)throw Error('动态视频已失效，请重新打开照片');
    const extension=motion.mime==='video/quicktime'?'mov':'mp4',owner=BrowserWindow.fromWebContents(event.sender);if(!owner)throw Error('预览窗口已关闭');
    const selected=await dialog.showSaveDialog(owner,{title:'导出动态照片视频',defaultPath:join(app.getPath('videos'),`${basename(data.path,extname(data.path))}-motion.${extension}`),filters:[{name:extension.toUpperCase()+' 视频',extensions:[extension]}],properties:['showOverwriteConfirmation']});
    if(selected.canceled||!selected.filePath)return null;
    if(controller.signal.aborted||previews.get(ownerId)?.path!==data.path)throw Error('已取消动态视频导出');
    const target=selected.filePath.toLowerCase().endsWith(`.${extension}`)?selected.filePath:`${selected.filePath}.${extension}`;
    await exportMotionPhotoVideo(motion,target,controller.signal);return target;
   }finally{motionVideoExports.delete(ownerId);if(temporary)await releaseLivpTemporary(temporary).catch(()=>{});}
  },['preview']);
  handle('preview-motion-export-cancel',event=>{const controller=motionVideoExports.get(event.sender.id);if(!controller)return false;controller.abort();return true;},['preview']);
  handle('preview-flags',async(event,value)=>{const state=flags.get(event.sender.id);if(!state)throw new Error('预览已关闭');if(value){for(const key of ['pinned','held'] as const)if(value[key]!==undefined){if(typeof value[key]!=='boolean')throw new Error('参数无效');state[key]=value[key];}BrowserWindow.fromWebContents(event.sender)?.setAlwaysOnTop(state.pinned,'pop-up-menu');await saveSettings(current=>mergeSettings(current,{preview:{pinned:state.pinned,held:state.held}}));}return state;},['preview']);
  handle('directory-open',(event,path)=>directories.open(event.sender.id,filePath(path)),['preview']);
  handle('directory-page',(event,id,offset,limit,query='')=>directories.page(event.sender.id,textValue(id,100),offset,limit,textValue(query,1000)),['preview']);
  handle('directory-release',(event,id)=>directories.release(event.sender.id,textValue(id,100)),['preview']);
  handle('preview-resource',async(event,value)=>{const data=previews.get(event.sender.id);if(!data||typeof value!=='string')return null;try{const path=await previewResourcePath(data.path,value);if(!path)return null;const extension=extname(path).toLowerCase(),mime:Record<string,string>={'.png':'image/png','.apng':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.svg':'image/svg+xml','.css':'text/css'};if(!mime[extension]||(await stat(path)).size>10*1024*1024)return null;const token=randomUUID();assets.set(token,{path,owner:event.sender.id,mime:mime[extension]});return `one-file://asset/${token}/${encodeURIComponent(basename(path))}`;}catch{return null;}},['preview']);
  handle('preview-image',async(event,value)=>{const data=previews.get(event.sender.id);if(!data||typeof value!=='string')return null;try{const path=await previewResourcePath(data.path,value);if(!path)return null;const mime:Record<string,string>={'.png':'image/png','.apng':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.svg':'image/svg+xml'},kind=mime[extname(path).toLowerCase()];if(!kind||(await stat(path)).size>10*1024*1024)return null;const dimensions=await previewImageDimensions(path);const token=randomUUID();assets.set(token,{path,owner:event.sender.id,mime:kind});return {url:`one-file://asset/${token}/${encodeURIComponent(basename(path))}`,...(dimensions||{})};}catch{return null;}},['preview']);
  handle('preview-display-image',async(event,value,targetWidth,targetHeight)=>{
    if(typeof value!=='string'||value.length>4096||!Number.isInteger(targetWidth)||targetWidth<128||targetWidth>1280||!Number.isInteger(targetHeight)||targetHeight<128||targetHeight>960)return null;
    try{
      const url=new URL(value);if(url.protocol!=='one-file:'||url.host!=='asset')return null;
      const sourceToken=url.pathname.split('/')[1],asset=assets.get(sourceToken);
      if(!asset||asset.owner!==event.sender.id||!asset.mime.startsWith('image/')||(await stat(asset.path)).size>10*1024*1024)return null;
      // Leave GIF/WebP animation and SVG vectors at their original resolution.
      if(!['image/png','image/jpeg'].includes(asset.mime)||asset.mime==='image/png'&&await isAnimatedPng(asset.path))return value;
      const dimensions=await previewImageDimensions(asset.path);if(!dimensions)return null;
      const scale=Math.min(targetWidth/dimensions.width,targetHeight/dimensions.height,1);if(scale>=1)return value;
      const width=Math.max(1,Math.round(dimensions.width*scale)),height=Math.max(1,Math.round(dimensions.height*scale));
      const bytes=await scaledPreviewImage(asset.path,width,height);if(!assets.has(sourceToken)||bytes.length>8*1024*1024||displayAssetBytes+bytes.length>64*1024*1024||!roles.has(event.sender.id))return null;
      const token=randomUUID();displayAssets.set(token,{owner:event.sender.id,bytes});displayAssetBytes+=bytes.length;
      return `one-file://display/${token}/preview.png`;
    }catch{return null;}
  },['preview']);
  handle('preview-still-image',async(event,value)=>{
    if(typeof value!=='string'||value.length>4096)return null;
    try{const url=new URL(value);if(url.protocol!=='one-file:'||url.host!=='asset')return null;
      const sourceToken=url.pathname.split('/')[1],asset=assets.get(sourceToken);
      if(!asset||asset.owner!==event.sender.id||!['image/heic','image/heif'].includes(asset.mime)||(await stat(asset.path)).size>100*1024*1024)return null;
      const bytes=await scaledPreviewAsset(asset,1280,960);
      if(!assets.has(sourceToken)||!roles.has(event.sender.id)||bytes.length>8*1024*1024||displayAssetBytes+bytes.length>64*1024*1024)return null;
      const token=randomUUID();displayAssets.set(token,{owner:event.sender.id,bytes});displayAssetBytes+=bytes.length;return `one-file://display/${token}/preview.png`;
    }catch{return null;}
  },['preview']);
  handle('preview-release-display-image',(event,value)=>{if(typeof value!=='string'||value.length>4096)return;try{const url=new URL(value);if(url.protocol!=='one-file:'||url.host!=='display')return;const token=url.pathname.split('/')[1],asset=displayAssets.get(token);if(asset?.owner===event.sender.id){displayAssetBytes-=asset.bytes.length;displayAssets.delete(token);}}catch{/* Ignore stale image URLs. */}},['preview']);
  handle('preview-thumbnail',async(event,value)=>{if(typeof value!=='string'||value.length>4096)return null;try{const url=new URL(value);if(url.protocol!=='one-file:'||url.host!=='asset')return null;const token=url.pathname.split('/')[1],asset=assets.get(token);if(!asset||asset.owner!==event.sender.id||!asset.mime.startsWith('image/')||(await stat(asset.path)).size>10*1024*1024)return null;let image=await nativeImage.createThumbnailFromPath(asset.path,{width:96,height:84});if(image.isEmpty()||!assets.has(token)||event.sender.isDestroyed())return null;const {width,height}=image.getSize();if(!width||!height)return null;const scale=Math.min(96/width,84/height,1);if(scale<1)image=image.resize({width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale)),quality:'good'});return image.toDataURL();}catch{return null;}},['preview']);
  handle('preview-link-card',(_event,value)=>linkCard(value),['preview']);
  handle('preview-open-link',async(_event,value)=>{await shell.openExternal(externalURL(value).href);},['preview']);
  handle('select-preview',(event,path)=>{const id=event.sender.id,target=filePath(path);motionVideoExports.get(id)?.abort();const task=(previewQueues.get(id)||Promise.resolve()).catch(()=>{}).then(async()=>{if(event.sender.isDestroyed())return;event.sender.send('one:preview-loading');const data=await preparePreview(target,id);if(event.sender.isDestroyed())return;previews.set(id,data);event.sender.send('one:preview-changed');});previewQueues.set(id,task);return task;},['preview']);
  handle('input-status', () => input.status());
  handle('transform', (event, request) => {textValue(request?.text);return textService.run<string>(event.sender.id,{kind:'pipeline',text:request.text,steps:validateSteps([request])});}, ['main', 'copy']);
  handle('text-pipeline',(event,text,steps)=>textService.run<string>(event.sender.id,{kind:'pipeline',text:textValue(text),steps:validateSteps(steps)}));handle('text-cancel',event=>textService.cancel(event.sender.id));handle('text-compare',(event,left,right,ignoreWhitespace)=>{if(typeof ignoreWhitespace!=='boolean')throw new Error('比较参数无效');return textService.run(event.sender.id,{kind:'compare',left:textValue(left),right:textValue(right),ignoreWhitespace});});handle('text-difference-page',(event,id,page)=>textService.page(event.sender.id,id,page));handle('text-comparison-clear',(event,id)=>textService.clear(event.sender.id,id));handle('text-batch',(event,request)=>{if(!request||typeof request.recursive!=='boolean'||typeof request.merge!=='boolean')throw new Error('批处理参数无效');return textService.run(event.sender.id,{kind:'batch',request:{...request,output:filePath(request.output),steps:validateSteps(request.steps)}});});
  handle('copy-text', (event, text) => clipboard.writeText(textValue(text,roles.get(event.sender.id)==='preview'?50*1024*1024:10_000_000)), ['main', 'copy','preview','color-editor']);
  handle('send-workbench', (_event, text) => { showMain(); main.webContents.send('one:receive-text', textValue(text)); }, ['copy']);
  handle('open-text', async (_event, encoding) => { const path = await pickPath('file','打开文本文件'); if (!path) return null; return { path, text: await readText(path, textValue(encoding, 20)) }; });
  handle('read-text-path',async(_event,value,encoding)=>{const path=filePath(value);return{path,text:await readText(path,textValue(encoding,20))};});
  handle('drop-path-kinds',async(_event,values)=>{if(!Array.isArray(values)||values.length>64)throw new Error('拖入项目过多');return Promise.all(values.map(async value=>{const path=filePath(value);const info=await stat(path);return{path,kind:info.isDirectory()?'directory':info.isFile()?'file':'other'};}));});
  handle('save-text', async (_event, text, encoding) => { textValue(text); const path = await pickPath('save','保存处理结果','处理结果.txt'); if (!path) return null; await saveText(path, text, textValue(encoding, 20)); return path; });
  handle('pick-file', (event,path) => pickPath('file','选择文件','',path === undefined ? undefined : filePath(path),BrowserWindow.fromWebContents(event.sender)||main));
  handle('picker-data', (event, path) => pickerData(event.sender.id, path === undefined ? undefined : filePath(path)), ['picker']);
  handle('picker-places', event => pickerPlaces(event.sender.id), ['picker']);
  handle('picker-opened', event => pickerOpened(event.sender.id), ['picker']);
  handle('picker-clear-recent', event => pickerClearRecent(event.sender.id), ['picker']);
  handle('picker-preferences', (event,value) => pickerPreferences(event.sender.id,value), ['picker']);
  handle('picker-choose', (event, path, overwrite) => { if (overwrite !== undefined && typeof overwrite !== 'boolean') throw new Error('覆盖参数无效'); return choose(BrowserWindow.fromWebContents(event.sender)!, filePath(path), overwrite); }, ['picker']);
  handle('preview', (_event, path) => preview(filePath(path)),['main','search']);
  handle('preview-data', async(event,knownWorkbookToken)=>{
    const data=previews.get(event.sender.id);if(!data)throw new Error('预览正在准备');
    if(data.type!=='workbook'||!data.workbookToken||data.workbook||data.error||knownWorkbookToken===data.workbookToken)return {...data};
    let pending=workbookReloads.get(data);
    if(!pending){pending=reloadWorkbook(data.path);workbookReloads.set(data,pending);}
    try{const workbook=await pending;if(previews.get(event.sender.id)!==data)throw new Error('预览已切换');data.workbook=workbook;return {...data};}
    catch(error){if(previews.get(event.sender.id)!==data)throw error;return {...data,type:'unsupported',error:(error as Error).message};}
    finally{if(workbookReloads.get(data)===pending)workbookReloads.delete(data);}
  },['preview']);
  handle('native-preview-start',(event,token,value)=>{const owner=event.sender.id,data=previews.get(owner),window=BrowserWindow.fromWebContents(event.sender);if(!window||data?.type!=='native-office'||typeof token!=='string'||token!==data.nativeOfficeToken)throw Error('预览文件已切换');nativeTooltips.prepare(window);return nativeOfficePreview.start(owner,token,window,data.path,nativePreviewBounds(value),state=>{if(!event.sender.isDestroyed()&&previews.get(owner)?.nativeOfficeToken===token)event.sender.send('one:native-preview-state',state);},()=>{if(!window.isDestroyed()&&previews.get(owner)?.nativeOfficeToken===token)window.close();});},['preview']);
  handle('native-preview-bounds',(event,token,value)=>{const window=BrowserWindow.fromWebContents(event.sender);if(window&&typeof token==='string')nativeOfficePreview.resize(event.sender.id,token,nativePreviewBounds(value),window);},['preview']);
  handle('native-preview-stop',(event,token)=>{if(typeof token!=='string')throw Error('预览会话无效');nativeOfficePreview.stop(event.sender.id,token);if(previews.get(event.sender.id)?.nativeOfficeToken===token)nativeTooltips.hide(event.sender.id);},['preview']);
  handle('native-preview-tooltip',(event,token,value)=>{const data=previews.get(event.sender.id),window=BrowserWindow.fromWebContents(event.sender);if(!window||data?.type!=='native-office'||data.nativeOfficeToken!==token)return;nativeTooltips.update(window,nativeTooltipData(value));},['preview']);
  handle('native-tooltip-ready',event=>nativeTooltips.ready(event.sender.id),['native-tooltip']);
  handle('native-tooltip-painted',event=>nativeTooltips.painted(event.sender.id),['native-tooltip']);
  handle('preview-workbook-ready',(event,token)=>{const data=previews.get(event.sender.id);if(data?.type==='workbook'&&typeof token==='string'&&token===data.workbookToken)delete data.workbook;},['preview']);
  handle('navigate-preview', (event, step) => {
    if (step !== -1 && step !== 1) throw new Error('方向无效'); const id = event.sender.id;
    const task = (previewQueues.get(id) || Promise.resolve()).catch(() => {}).then(async () => {
      if (event.sender.isDestroyed()) return; const previous = previews.get(id); if (!previous) return;
      const directory=previous.navigation;if(!directory)return;const next=directory.position+step;if(next<0||next>=directory.count)return;const target=(await directories.page(id,directory.id,next,1)).entries[0];if(!target||event.sender.isDestroyed())return;
      motionVideoExports.get(id)?.abort();event.sender.send('one:preview-loading');const data = await preparePreview(target.path,id);
      if (event.sender.isDestroyed()) { releasePreviewAssets(id); return; }
      previews.set(id,data); event.sender.send('one:preview-changed');
    });
    previewQueues.set(id,task); void task.finally(() => { if (previewQueues.get(id) === task) previewQueues.delete(id); }).catch(() => {}); return task;
  }, ['preview']);
  handle('open-file', async (_event, path) => {const file=filePath(path);if(isArchivePath(file)&&(await stat(file)).isFile())return shellInvocation([`--one-archive=${file}`],'file-open');const error=await shell.openPath(file);if(error)throw new Error(error);}, ['main','preview','search']);
  handle('reveal-file', (_event, path) => shell.showItemInFolder(filePath(path)), ['main','preview','search']);
  handle('start-file-drag',async(event,value)=>{
    const path=filePath(value),info=await stat(path);
    if(!info.isFile()&&!info.isDirectory())throw new Error('此项目无法拖拽');
    if(event.sender.isDestroyed())return;
    const cached=fileIcons.cached(path),image=cached?nativeImage.createFromDataURL(cached):applicationIcon;
    const id=event.sender.id;nativeMenus.add(id);
    try{event.sender.startDrag({file:path,icon:image.isEmpty()?applicationIcon:image});}
    finally{nativeMenus.delete(id);}
  },['search']);
  handle('search-text', async (_event, text) => { const query = textValue(text, 5000); await shell.openExternal(`https://www.bing.com/search?q=${encodeURIComponent(query)}`); }, ['copy']);
  handle('pick-directory', (event,path) => pickPath('directory','选择文件夹','',path === undefined ? undefined : filePath(path),BrowserWindow.fromWebContents(event.sender)||main));
  handle('scan',(event,path,id)=>{const target=filePath(path);if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))throw new Error('扫描标识无效');diskService.start(target,(result,error)=>{if(!event.sender.isDestroyed())event.sender.send('one:scan-complete',{id,result,error});});});
  handle('cancel-scan',()=>diskService.stop());
  handle('maintenance', (_event, kind) => { if (kind !== 'startup' && kind !== 'registry') throw new Error('检查类型无效'); return runMaintenance(kind); });
  handle('export-maintenance', async (_event, rows: MaintenanceRow[]) => { if (!Array.isArray(rows) || rows.length > 50000) throw new Error('报告无效'); const path = await pickPath('save','导出检查报告','检查报告.csv'); if (!path) return null; const quote = (text: unknown) => '"' + String(text).replace(/^[=+@-]/, "'$&").replace(/"/g, '""') + '"'; const lines = ['名称,来源,状态,命令,位置', ...rows.map(row => [row.name,row.source,row.status,row.command,row.location].map(quote).join(','))]; await writeFile(path, '\ufeff' + lines.join('\r\n'), 'utf8'); return path; });
  handle('close-window', event => {const role=roles.get(event.sender.id);if(role==='color-picker')return closeColors();if(role==='search-menu'){hideMenus();}else if(role==='search'){searchWindow?.hide();searchRevision++;}else BrowserWindow.fromWebContents(event.sender)?.close();if(role==='search'&&searchContext.kind==='explorer'||role==='search-menu')void searchBridge.focus(searchContext).catch(()=>{});}, ['main','preview','copy','picker','color-picker','color-editor','search','search-menu','echo']);
  handle('quit', () => app.quit());
}
async function start() {
  Menu.setApplicationMenu(null);
  const iconSizes = [16, 20, 24, 28, 30, 32, 36, 40, 48, 56, 64, 96, 128, 256];
  const displayScale = screen.getPrimaryDisplay().scaleFactor;
  const closestIconSize = (pixels:number) => iconSizes.reduce((best, size) => Math.abs(size - pixels) < Math.abs(best - pixels) ? size : best);
  const windowIconSize = closestIconSize(24 * displayScale);
  const trayIconSize = closestIconSize(16 * displayScale);
  const iconBytes = (size:number,taskbar:boolean) => readFile(join(__dirname, `../icons/one-${taskbar && size <= 64 ? 'taskbar-' : ''}${size}.png`));
  applicationIcon = nativeImage.createFromBuffer(await iconBytes(windowIconSize,true));
  for (const size of iconSizes) if (size > windowIconSize) {
    applicationIcon.addRepresentation({scaleFactor: size / windowIconSize, buffer: await iconBytes(size,true)});
  }
  try { settings = validateSettings(JSON.parse(await readFile(settingsPath(), 'utf8'))); } catch {}
  // Upgrade existing login items without changing an entry disabled in Windows settings.
  if(app.isPackaged&&!testMode&&settings.general.launchAtLogin&&app.getLoginItemSettings().openAtLogin&&!app.getLoginItemSettings({args:[loginStartupArg]}).openAtLogin)
    app.setLoginItemSettings({openAtLogin:true,args:[loginStartupArg]});
  const migratedSearch=migrateSearchDefaults(settings.search,process.env);
  if(migratedSearch!==settings.search)await persistSettings({...settings,search:migratedSearch});
  themeAutomation=new ThemeAutomation({appearance:()=>settings.appearance,systemDark:()=>nativeTheme.shouldUseDarkColors,changedAppearance:refreshWindowAppearance,
    publish:status=>{if(main&&!main.isDestroyed()&&!main.webContents.isDestroyed())main.webContents.send('one:theme-status',status);},
    register:(shortcut,callback)=>globalShortcut.register(shortcut,callback),unregister:shortcut=>globalShortcut.unregister(shortcut)});
  void themeAutomation.configure(settings.themeSchedule);
  displayShortcuts=new DisplayShortcutController({register:(key,callback)=>!globalShortcut.isRegistered(key)&&globalShortcut.register(key,callback),unregister:key=>globalShortcut.unregister(key),enabled:()=>!inputPaused&&!recordingShortcut,
    point:()=>{const display=screen.getDisplayNearestPoint(screen.getCursorScreenPoint()),p=screen.dipToScreenPoint({x:Math.round(display.bounds.x+display.bounds.width/2),y:Math.round(display.bounds.y+display.bounds.height/2)});return {key:String(display.id),...p};},adjust:(point,delta,current)=>displayManagement.adjustBrightness(point,delta,current),
    complete:results=>{if(results.length){displayShortcutRefresh=true;const c=results[0].control;if(!testMode&&c?.supported)echoes?.level({action:'brightness',value:c.value!});}},
    publish:state=>{if(main&&!main.isDestroyed()&&!main.webContents.isDestroyed()){main.webContents.send('one:display-shortcut-state',state);if(!state.busy&&displayShortcutRefresh){displayShortcutRefresh=false;main.webContents.send('one:display-adjusted');}}if(!testMode&&state.operationError&&state.operationError!==lastDisplayShortcutError)echo(state.operationError);lastDisplayShortcutError=state.operationError;}});
  if(testMode&&process.env.ONE_TEST_DISPLAY_MANAGEMENT==='1')(globalThis as typeof globalThis&{oneTestDisplayShortcuts?:DisplayShortcutController}).oneTestDisplayShortcuts=displayShortcuts;
  screen.on('display-added',()=>displayManagement.invalidate());screen.on('display-removed',()=>displayManagement.invalidate());screen.on('display-metrics-changed',()=>displayManagement.invalidate());
  powerMonitor.on('resume',()=>displayManagement.invalidate());
  const renderer = resolve(__dirname, '../renderer');
  protocol.handle('one', request => { const url = new URL(request.url); const path = resolve(renderer, '.' + decodeURIComponent(url.pathname)); const rel = relative(renderer, path); if (url.host !== 'app' || rel.startsWith('..') || isAbsolute(rel)) return new Response('Forbidden', { status: 403 }); return net.fetch(pathToFileURL(path).toString()); });
  protocol.handle('one-file', async request => { const url = new URL(request.url); const token=url.pathname.split('/')[1];if(url.host==='display'){const asset=displayAssets.get(token);if(!asset)return new Response('Not found',{status:404});const headers={'Content-Type':'image/png','Content-Length':String(asset.bytes.length),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Access-Control-Allow-Origin':'one://app'};return new Response(request.method==='HEAD'?null:Uint8Array.from(asset.bytes),{headers});}const asset = assets.get(token)||fontAssets.get(token); if (!asset || url.host !== 'asset') return new Response('Not found', { status: 404 }); return fileResponse(asset.path,asset.mime,request,'segment' in asset?asset.segment:undefined); });
  const canFullscreen=(contents:Electron.WebContents|null,permission:string,details:{isMainFrame:boolean;requestingUrl?:string})=>{
    if(permission!=='fullscreen'||!contents||contents.isDestroyed()||roles.get(contents.id)!=='preview'||!details.isMainFrame)return false;
    return contents.getURL()==='one://app/index.html?view=preview'&&details.requestingUrl===contents.getURL();
  };
  session.defaultSession.setPermissionRequestHandler((contents,permission,callback,details)=>callback(canFullscreen(contents,permission,details)));
  session.defaultSession.setPermissionCheckHandler((contents,permission,_origin,details)=>canFullscreen(contents,permission,details));
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*','https://*/*'] }, (_details, callback) => callback({ cancel: true }));
  diskService=new DiskService(p=>{if(main&&!main.isDestroyed())main.webContents.send('one:progress',p);});maintenance=new MaintenanceClient(join(app.getPath('userData'),'maintenance-backups'),value=>{if(main&&!main.isDestroyed())main.webContents.send('one:maintenance-progress',value);});
  systemInformation=new SystemInformationService(value=>{if(main&&!main.isDestroyed())main.webContents.send('one:system-information-progress',value);},value=>{if(main&&!main.isDestroyed())main.webContents.send('one:system-information-group',value);});
  proxyDiagnostics=new ProxyDiagnosticsService(value=>{if(main&&!main.isDestroyed())main.webContents.send('one:proxy-diagnostics-progress',value);});
  ports=new PortService();
  diskMonitor=new DiskMonitorService(value=>{if(main&&!main.isDestroyed()&&main.isVisible()&&!main.isMinimized())main.webContents.send('one:disk-monitor',value);},(drive,state)=>{const volume=state.volumes.find(v=>v.drive===drive);if(main&&!main.isDestroyed())main.webContents.send('one:disk-alert',{drive,free:volume?.free||0});if(!testMode&&Notification.isSupported()){const notice=new Notification({title:'One · 磁盘空间不足',body:drive+' 剩余 '+((volume?.free||0)/1024**3).toFixed(2)+' GB'});notice.on('click',()=>{showMain();main.webContents.send('one:disk-alert-open');});notice.show();}});
  diskMonitor.configure(settings.diskMonitor);
  echoes=new EchoService(windowFor,()=>settings,placement=>saveSettings(current=>({...current,appearance:{...current.appearance,popupPlacement:placement}})),()=>{if(main&&!main.isDestroyed())main.webContents.send('one:echo-position');});
  initNative(); foreground(); clicker=new ClickerService(settings.utilities.clicker,utilityChanged); input = new InputService(settings, { echo, level:value=>echoes.level(value),caps:active=>echoes.caps(active),show: showMain, color:()=>void pickColor().catch(error=>echo(error.message)), preview:previewExplorerSelection,clicker:()=>clicker.toggle() });
  locksmith=new LocksmithService(state=>{for(const w of BrowserWindow.getAllWindows())if(!w.isDestroyed()&&roles.get(w.webContents.id)==='main')w.webContents.send('one:locks',state);});
  awake=new AwakeService(utilityChanged);topmost=new TopmostService(utilityChanged,echo);awake.update(settings.utilities.awake);topmost.update(settings.utilities.topmost);
  search=new SearchService(join(app.getPath('userData'),'file-index.ndjson'),settings.search,searchChanged,process.env.ONE_SEARCH_BACKEND==='memory'?'memory':'disk');searchBridge=new SearchBridge(showSearch,searchChanged,echo);
  configurePicker(() => settings.search.bookmarks, async () => (await searchBridge.context(0)).folders);
  launcher=new LauncherService(items=>{search.launchers(items);searchChanged();});search.launchers(launcher.entries());launcher.refresh();
  fileMenu=new FileContextMenu({create:submenu=>windowFor('file-context',{width:240,height:374,minWidth:240,minHeight:40,frame:false,resizable:false,skipTaskbar:true,hasShadow:true},submenu?'&submenu=apps':''),focus:popupFocus,active:(id,value)=>{if(value)nativeMenus.add(id);else nativeMenus.delete(id);},open:chooseSearch,preview:path=>preview(filePath(path)),archive:navigateArchive,system:async(path,owner,point)=>{if(owner.isDestroyed())return;const ownerId=owner.webContents.id;nativeMenus.add(ownerId);try{await showFileContextMenu(path,Number(owner.getNativeWindowHandle().readBigUInt64LE()),point);}finally{nativeMenus.delete(ownerId);if(!owner.isDestroyed()&&owner.isVisible())popupFocus(owner);}},changed:()=>{for(const w of cachedSearch.values())if(!w.isDestroyed())w.webContents.send('one:search-files-changed');}},()=>settings.search.roots);
  menuService=new SearchMenu(join(app.getPath('userData'),'search-history.json'),()=>settings.search,searchBridge,()=>{showMain();main.webContents.send('one:search-settings');},()=>showSearch('search',searchContext.hwnd,false,searchContext.tab),undefined,command=>menuConfirmation.request(command),favoriteCurrentFolder,async(command,context)=>{if(command.onePage){const target=await oneMenuTarget(command,context);showMain();main.webContents.send('one:navigate-page',target);}else if(command.oneAction==='pick-color')await pickColor();else if(command.oneAction==='screen-ruler')await openScreenRuler();});
  textService=new TextService((owner,value)=>{const window=BrowserWindow.getAllWindows().find(w=>w.webContents.id===owner);if(window&&!window.webContents.isDestroyed())window.webContents.send('one:text-progress',value);});
  fileTools=new FileToolsService(join(app.getPath('userData'),'file-tools'),(owner,value)=>{const window=BrowserWindow.getAllWindows().find(w=>!w.isDestroyed()&&w.webContents.id===owner);window?.webContents.send('one:file-tools-progress',value);});
  const archiveTasks=new ArchiveTasks(join(app.getPath('userData'),'tasks','archive.json'),()=>{if(main&&!main.isDestroyed())main.webContents.send('one:archive-tasks-changed');},message=>runtimeWarning(app.getPath('userData'),'archive-task-history',message));
  archiveService=new ArchiveService(join(app.getPath('userData'),'archive-cache'),(owner,value)=>{const window=BrowserWindow.getAllWindows().find(w=>!w.isDestroyed()&&w.webContents.id===owner);window?.webContents.send('one:archive-progress',value);},owner=>{const window=BrowserWindow.getAllWindows().find(w=>!w.isDestroyed()&&w.webContents.id===owner);if(!window)throw Error('拖出窗口已关闭');return window.getNativeWindowHandle().readBigUInt64LE().toString();},(event,detail,warning)=>{(warning?runtimeWarning:runtimeLog)(app.getPath('userData'),event,detail);},false,archiveTasks,()=>settings.archive,undefined,undefined,item=>{if(main&&!main.isDestroyed())main.webContents.send('one:archive-edit-changed',item);});
  void archiveService.edits.list().catch(error=>runtimeWarning(app.getPath('userData'),'archive-edit-restore',String(error)));
  app.on('browser-window-focus',(_event,window)=>{if(window===main)archiveService.edits.refresh();});
  colorEditor=new ColorEditor(()=>windowFor('color-editor',{width:420,height:360,minWidth:320,minHeight:200,resizable:false,minimizable:false,maximizable:false,skipTaskbar:true,title:'颜色 · One'}),()=>({history:settings.colorHistory,formats:settings.colorVisibleFormats,format:settings.colorFormat,showEditor:settings.colorShowEditor}));
  dialogBar=new DialogBar(()=>windowFor('dialog-bar',{width:700,height:60,minWidth:240,minHeight:60,frame:false,transparent:true,backgroundColor:'#00000000',roundedCorners:false,hasShadow:false,thickFrame:false,resizable:false,skipTaskbar:true}),searchBridge,()=>settings.search,menuService);
  searchBridge.update(settings.search);
  registerIPC(); main = windowFor('main');
  trayMenuPanel=new TrayMenuPanel(()=>windowFor('tray-menu',{width:296,height:356,minWidth:296,minHeight:200,frame:false,resizable:false,maximizable:false,minimizable:false,skipTaskbar:true,alwaysOnTop:true,hasShadow:true,roundedCorners:true,title:'One 菜单'}),()=>({entries:trayMenuEntries({paused:inputPaused,launchAtLogin:settings.general.launchAtLogin}),paused:inputPaused}));
  if(testMode&&process.env.ONE_TEST_TRAY_MENU==='1')(globalThis as typeof globalThis&{oneTestTrayMenu?:TrayMenuPanel}).oneTestTrayMenu=trayMenuPanel;
  main.once('ready-to-show', () => {if(!process.argv.includes(loginStartupArg)&&!process.argv.some(a=>a.startsWith('--one-shell-request=')||a.startsWith('--one-archive=')))main.show();setTimeout(()=>{if(!quitting){warmSearchPopups();}},500).unref();});
  nativeTheme.on('updated',refreshWindowAppearance);
  powerMonitor.on('resume',syncThemeAfterWake);powerMonitor.on('unlock-screen',syncThemeAfterWake);
  main.on('blur',()=>stopShortcutRecording());
  main.on('close', event => { if(!quitting&&!testMode){event.preventDefault();if(settings.general.closeToTray)main.hide();else app.quit();} });
  if (!testMode) {
    const trayIcon=nativeImage.createFromBuffer(await iconBytes(trayIconSize,false));
    for(const size of iconSizes)if(size>trayIconSize)trayIcon.addRepresentation({scaleFactor:size/trayIconSize,buffer:await iconBytes(size,false)});
    tray = new Tray(trayIcon);tray.setToolTip('One');tray.on('click',()=>{trayMenuPanel?.close();showMain();});tray.on('right-click',()=>trayMenuPanel?.toggle(tray.getBounds()));
    if (!globalShortcut.register('CommandOrControl+Alt+O', showMain)) console.warn('Ctrl+Alt+O 已被其他程序使用，可从托盘打开 One');
    try{colorShortcut(settings.colorShortcut);}catch(error){console.warn(String(error));}
    try{themeAutomation.registerShortcut(settings.themeSchedule.shortcut);}catch(error){console.warn(String(error));}
    displayShortcuts.configure(settings.displays.shortcuts);
    input.update(settings);
  }
}
if (!testMode && !app.requestSingleInstanceLock()) app.quit(); else if(process.argv.includes('--one-quit-for-install')) app.quit(); else {
 app.on('second-instance',(_event,args)=>{if(args.includes('--one-quit-for-install')){app.quit();return;}if(args.includes(loginStartupArg)&&!args.some(value=>value.startsWith('--one-shell-request=')||value.startsWith('--one-archive='))){runtimeLog(app.getPath('userData'),'second-instance','login-startup-already-running');return;}runtimeLog(app.getPath('userData'),'second-instance',args.some(value=>value.startsWith('--one-shell-request='))?'shell-request':'show-main');void shellInvocation(args,'second-instance');});
 app.whenReady().then(()=>{if(developmentQuitRequested||quitting)return;runtimeLog(app.getPath('userData'),'main-start',`version=${app.getVersion()} mode=${app.isPackaged?'packaged':'development'} platform=${process.platform} arch=${process.arch}`);starting=start();return starting.finally(()=>{starting=undefined;});}).then(async()=>{
  runtimeLog(app.getPath('userData'),'main-ready');
  if(process.argv.some(a=>a.startsWith('--one-shell-request=')||a.startsWith('--one-archive=')))await shellInvocation(process.argv);
  shellInbox=new ShellRequestInbox(app.getPath('userData'),path=>shellInvocation([`--one-shell-request=${path}`],'inbox'));
  await shellInbox.start();
 }).catch(error => { runtimeLog(app.getPath('userData'),'main-start-error',String(error));console.error(error); app.quit(); });
}
app.on('before-quit', event => { if(finishingQuit){event.preventDefault();return;}if(!pickerQuitReady||fileTools?.pendingTasks||textService?.pendingTasks||archiveService?.pendingTasks||imageConvert.pendingTasks||imageAi.pendingTasks||imageMetadata.pendingTasks||developerHash.pendingTasks){event.preventDefault();finishingQuit=Promise.all([fileTools?.stop(),textService?.stop(),archiveService?.stop(),imageConvert.stopAll(),imageAi.stopAll(),imageMetadata.stopAll(),developerHash.stopAll(),flushPickerState()]);void finishingQuit.then(()=>{pickerQuitReady=true;finishingQuit=undefined;app.quit();});return;}fileTools?.stop();void archiveService?.stop(); quitting=true;nativeOfficePreview.stopAll();nativeTooltips.stopAll();barcodeCapture.stop();displayShortcuts?.stop();displayManagement.stop();themeLocation.cancel();themeAutomation?.stop();powerMonitor.removeListener('resume',syncThemeAfterWake);powerMonitor.removeListener('unlock-screen',syncThemeAfterWake);cancelHotkeyOwner();shellInbox?.stop();runtimeLog(app.getPath('userData'),'main-quit');menuConfirmation.stop();colorEditor?.stop();popupLifecycle.stop();launcher?.stop();fileMenu?.hide(false);trayMenuPanel?.dispose();maintenance?.stop();systemInformation?.stop();proxyDiagnostics?.stop();diskMonitor?.stop();diskService?.stop();echoes?.stop();void textService?.stop();dialogBar?.stop();searchBridge?.stop();void search?.stop();locksmith?.stop();for(const service of fileLocks.values())service.stop();awake?.stop();topmost?.stop();clicker?.stop();closeScreenRuler();closeColors(); brightness.stop(); input?.stop(); globalShortcut.unregisterAll(); for (const worker of workers) void worker.terminate(); tray?.destroy(); });
app.on('window-all-closed', () => { if (testMode) app.quit(); });
