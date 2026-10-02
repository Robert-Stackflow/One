import {FileContextMenu} from './file-menu';
import {PopupLifecycle,PopupReadiness,deferPopupBlur} from './popup-lifecycle';
import {FileToolsService} from './file-tools-service';
import {LauncherService} from './launcher-service';
import {openWithApplications,openInApplication,activatePreviewWindow,showFileContextMenu} from './open-with';
import {DiskService} from './disk-service';
import {MaintenanceClient} from './maintenance-client';
import {SystemInformationService} from './system-info-service';
import {DiskMonitorService} from './disk-monitor';
import {validInformationKind} from '../shared/system-info';
import {EchoService} from './echo';
import {nativeScan,nativeMaintenance} from './native-scan';
import {installedFonts,fontSource} from './fonts';
import {ExplorerOverlay} from './explorer-overlay';
import {inlineSearchBaseHeight} from '../shared/overlay';
import {SearchMenu} from './search-menu';
import {FileIcons} from './file-icons';
import {TextService} from './text-service';
import {validateSteps} from '../shared/text-tools';
import {LocksmithService} from './locksmith';
import {SearchService} from './search-service';
import {SearchBridge} from './search-bridge';
import type {SearchContext} from '../shared/search';
import {AwakeService} from './awake';
import {TopmostService} from './topmost';
import { app, BrowserWindow, clipboard, globalShortcut, ipcMain, Menu, nativeImage, net, protocol, screen, session, shell, Tray, Notification, nativeTheme } from 'electron';
import { readFile, writeFile, mkdir, stat, readdir, rename, realpath } from 'node:fs/promises';
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
import {colorFormats} from '../shared/colors';
import {fileResponse} from './file-response';
import type {ScreenCapture} from '../shared/types';
import {preparePreview as loadPreview} from './preview-service';
import {DirectoryService} from './directory-service';
const directories=new DirectoryService();
import { InputService } from './input';
import { pick, pickerData, choose } from './picker';
const execute = promisify(execFile);
app.setName('One');
app.setAppUserModelId('local.one.desktop');
const testMode = process.env.ONE_TEST_MODE === '1';
if (process.env.ONE_DATA_DIR && testMode) app.setPath('userData', resolve(process.env.ONE_DATA_DIR));
protocol.registerSchemesAsPrivileged([{ scheme: 'one', privileges: { standard: true, secure: true, supportFetchAPI: true } }, { scheme: 'one-file', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
const roles = new Map<number, string>(); const previews = new Map<number, PreviewData>(); const assets = new Map<string, { path: string; owner: number; mime: string }>();
const fontAssets = new Map<string,{path:string;mime:string}>();
const fontSources = new Map<string,Promise<import('../shared/fonts').UIFontSource|null>>();
const previewQueues = new Map<number,Promise<void>>();
const flags = new Map<number,{pinned:boolean;held:boolean}>();
let colorWindow:BrowserWindow|null=null,colorWorker:Worker|null=null,colorFollower:Worker|null=null,colorSample:ScreenCapture|undefined,colorSentSample:ScreenCapture|undefined,colorFramePending=false,recordingShortcut=false;let registeredColorShortcut='';
const workers = new Set<Worker>();let diskService:DiskService;let maintenance:MaintenanceClient;let systemInformation:SystemInformationService;let diskMonitor:DiskMonitorService;let echoes:EchoService;
let main: BrowserWindow; let tray: Tray;
let textService:TextService;let fileTools:FileToolsService;let locksmith:LocksmithService;let awake:AwakeService;let topmost:TopmostService;
let launcher:LauncherService,fileMenu:FileContextMenu;
let search:SearchService,searchBridge:SearchBridge,searchWindow:BrowserWindow|null=null,searchRevision=0,searchTyping=false;
const searchReadyWindows=new Set<number>();
function replaySearchInput(window:BrowserWindow,revision:number){
 if(!searchTyping||!window.isVisible()||!searchReadyWindows.has(window.webContents.id))return;
 searchTyping=false;const hwnd=Number(window.getNativeWindowHandle().readBigUInt64LE());
 setTimeout(()=>{if(window.isDestroyed()||window!==searchWindow||revision!==searchRevision||!window.isVisible())return;window.focus();searchBridge.replay(hwnd);},80);
}
let searchContext:SearchContext={kind:'search',hwnd:0,pid:0,created:'',folders:[]};
function searchState(){return {...search.state(),bridgeError:searchBridge?.error||''};}
function searchChanged(){if(!search)return;for(const w of BrowserWindow.getAllWindows())if(!w.isDestroyed()&&['main','search'].includes(roles.get(w.webContents.id)||'')&&(roles.get(w.webContents.id)==='main'||w.isVisible()))w.webContents.send('one:search-state',searchState());}
let inlineSearch=false,overlay:ExplorerOverlay|undefined,menuWindow:BrowserWindow|null=null,menuService:SearchMenu,menuNodes:import('../shared/search').MenuNode[]=[];
let menuExecuting=false,menuRevision=0,menuContextReady:Promise<void>=Promise.resolve();
const cachedSearch=new Map<boolean,BrowserWindow>(),nativeMenus=new Set<number>();
const popupLifecycle=new PopupLifecycle();
const fileIcons=new FileIcons(async path=>{const entry=launcher?.get(path);if(entry&&!entry.iconPath)return launcher.icon(path);const image=await app.getFileIcon(entry?.iconPath||path,{size:'normal'});return image.isEmpty()?'':image.toDataURL();});
type MenuPanel={window:BrowserWindow;readiness:PopupReadiness;depth:number;point:{x:number;y:number};items:import('../shared/search').MenuNode[];source:string;revision:number;left:boolean};
const menuPanels:MenuPanel[]=[];
function menuFor(sender:number){return menuPanels.find(p=>!p.window.isDestroyed()&&p.window.webContents.id===sender);}
function hideMenus(from=0){for(const p of menuPanels)if(p.depth>=from&&!p.window.isDestroyed())p.window.hide();if(!from)menuRevision++;}
function popupFocus(w:BrowserWindow){if(w.isDestroyed())return;w.setAlwaysOnTop(true,'pop-up-menu');w.show();w.moveTop();w.focus();const hwnd=Number(w.getNativeWindowHandle().readBigUInt64LE());if(!searchBridge?.activate(hwnd))void activatePreviewWindow(hwnd).catch(()=>{});}
function menuPanel(depth:number){let p=menuPanels[depth];if(p&&!p.window.isDestroyed())return p;
 const w=windowFor('search-menu',{width:286,height:100,minWidth:260,minHeight:40,frame:false,skipTaskbar:true,resizable:false,hasShadow:true},'&depth='+depth);
 p={window:w,readiness:new PopupReadiness(w),depth,point:{x:0,y:0},items:[],source:'',revision:0,left:false};menuPanels[depth]=p;if(!depth)menuWindow=w;
 w.on('blur',()=>{const revision=menuRevision;deferPopupBlur(w,()=>{if(menuExecuting||revision!==menuRevision)return false;const focused=BrowserWindow.getFocusedWindow();return !focused||roles.get(focused.webContents.id)!=='search-menu';},()=>hideMenus(),180);});
 w.on('close',e=>{if(!quitting&&!testMode){e.preventDefault();hideMenus(depth);}});w.on('closed',()=>{if(menuPanels[depth]?.window!==w)return;hideMenus(depth+1);if(!depth){menuRevision++;if(menuWindow===w)menuWindow=null;}});return p;
}
function positionMenu(p:MenuPanel,width:number,height:number){if(p.window.isDestroyed())return;const area=screen.getDisplayNearestPoint(p.point).workArea;const w=Math.min(320,area.width,Math.round(width)),h=Math.min(620,area.height,Math.round(height));let x=p.point.x;
 p.left=false;if(p.depth){const parent=menuPanels[p.depth-1];if(!parent||parent.window.isDestroyed()){p.window.hide();return;}const b=parent.window.getBounds();p.left=parent.left||x+w>area.x+area.width;if(p.left){x=b.x-w+4;if(x<area.x){p.left=false;x=b.x+b.width-4;}}}
 p.window.setBounds({x:Math.max(area.x,Math.min(x,area.x+area.width-w)),y:Math.max(area.y,Math.min(p.point.y,area.y+area.height-h)),width:w,height:h},false);
}
function sendMenu(p:MenuPanel){p.window.webContents.send('one:menu-reset',p.items);}
async function showMenu(hwnd:number){hideMenus();searchWindow?.hide();const revision=menuRevision,p=menuPanel(0);p.point=screen.getCursorScreenPoint();p.source='';positionMenu(p,286,250);
 searchContext={kind:'menu',hwnd,pid:0,created:'',folders:[]};
 menuContextReady=searchBridge.context(hwnd).then(c=>{if(revision===menuRevision){searchContext={...c,kind:'menu'};menuService.updateContext(searchContext);}}).catch(e=>{if(revision===menuRevision)echo(e.message);});
 menuNodes=await menuService.open(searchContext);if(revision!==menuRevision)return;p.items=menuNodes;menuService.updateContext(searchContext);positionMenu(p,286,Math.max(40,menuNodes.reduce((n,i)=>n+(i.kind==='separator'?13:35),55)));sendMenu(p);
 p.readiness.run(()=>{if(revision===menuRevision){sendMenu(p);popupFocus(p.window);}});
 // First child is prepared while the user moves to a menu item.
 menuPanel(1);
}
function searchPopup(embedded:boolean){let w=cachedSearch.get(embedded);if(w&&!w.isDestroyed())return w;
 w=windowFor('search',{width:embedded?520:740,height:embedded?inlineSearchBaseHeight:64,minWidth:embedded?240:520,minHeight:embedded?inlineSearchBaseHeight:64,frame:false,titleBarStyle:'default',titleBarOverlay:false,hasShadow:!embedded,thickFrame:!embedded,transparent:embedded,...(embedded?{backgroundColor:'#00000000',roundedCorners:false}:{}),resizable:false,skipTaskbar:true},embedded?'&embedded=1':'');cachedSearch.set(embedded,w);const own=w,windowId=w.webContents.id;
 w.on('blur',()=>{setTimeout(()=>{if(!own.isDestroyed()&&!nativeMenus.has(windowId)&&!own.isFocused())own.hide();},150);});
 // The BrowserWindow and its webContents are already destroyed when 'closed' fires.
 w.on('close',e=>{if(!quitting&&!testMode){e.preventDefault();own.hide();}});w.on('closed',()=>{if(cachedSearch.get(embedded)===own)cachedSearch.delete(embedded);searchReadyWindows.delete(windowId);nativeMenus.delete(windowId);if(searchWindow===own){searchWindow=null;searchRevision++;searchTyping=false;overlay?.detach();overlay=undefined;}});return w;
}
function showSearch(kind:SearchContext['kind']='search',hwnd=foreground()?.hwnd||0,typing=false){
 fileMenu?.hide(false);launcher?.refresh();if(kind==='menu'){void showMenu(hwnd).catch(error=>echo(error.message));return;}hideMenus();searchWindow?.hide();overlay?.detach();overlay=undefined;
 const embedded=kind==='explorer',revision=++searchRevision;searchTyping=typing;inlineSearch=embedded;searchContext={kind,hwnd,pid:0,created:'',folders:[]};const w=searchPopup(embedded);searchWindow=w;
 const show=()=>{if(revision!==searchRevision||w.isDestroyed())return;if(embedded){overlay=new ExplorerOverlay(w);overlay.attach(hwnd);}else{const a=screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea,width=Math.min(740,a.width-32);w.setBounds({x:Math.round(a.x+(a.width-width)/2),y:Math.round(a.y+a.height*.2),width,height:64},false);}w.webContents.send('one:search-reset');w.webContents.send('one:search-context',searchContext);popupFocus(w);replaySearchInput(w,revision);};
 if(w.webContents.isLoading())w.once('ready-to-show',show);else show();
 // Prepare the result menu after the search input has appeared, not at startup.
 setTimeout(()=>{if(!quitting&&searchWindow===w&&!w.isDestroyed()&&w.isVisible())fileMenu?.warm();},80).unref();
 void searchBridge.context(hwnd).then(context=>{if(revision!==searchRevision)return;searchContext={...context,kind};w.webContents.send('one:search-context',searchContext);}).catch(error=>{if(revision===searchRevision){searchBridge.error=(error as Error).message;searchChanged();}});
}
function warmSearchPopups(){launcher?.refresh();searchPopup(false);if(settings.search.explorerTyping)searchPopup(true);if(settings.search.explorerMenu)menuPanel(0);}
async function chooseSearch(value:unknown){const item=typeof value==='string'?launcher.get(value):undefined;if(item){if(item.launchKind==='setting')await shell.openExternal(item.target);else await launcher.open(item.path);searchWindow?.hide();return;}const path=filePath(value),info=await stat(path);if(info.isDirectory())await menuService.remember(path);if(searchContext.kind==='dialog'&&!info.isDirectory())throw new Error('请选择文件夹');if(info.isDirectory()&&searchContext.kind!=='search'){searchWindow?.hide();try{await searchBridge.jump(searchContext,path);}catch(error){searchWindow?.show();searchWindow?.focus();throw error;}}else{const error=await shell.openPath(path);if(error)throw new Error(error);searchWindow?.hide();}}
function utilityState(){return {awake:awake.state(),pinned:topmost.count(),shortcutError:topmost.error};}
function utilityChanged(){if(!awake||!topmost)return;for(const w of BrowserWindow.getAllWindows())if(!w.isDestroyed()&&roles.get(w.webContents.id)==='main')w.webContents.send('one:utility-state',utilityState());}
let applicationIcon: Electron.NativeImage;
let settings: Settings = defaultSettings(); let input: InputService; let quitting = false;let finishingQuit:Promise<unknown>|undefined;
const settingsPath = () => join(app.getPath('userData'), 'settings.json');
function windowFor(view: string, options: Electron.BrowserWindowConstructorOptions = {},query='') {
  const a=settings.appearance;const dark=a.mode==='dark'||a.mode==='system'&&nativeTheme.shouldUseDarkColors;
  const window = new BrowserWindow({ width: 1240, height: 840, minWidth: 840, minHeight: 620, backgroundColor: dark?a.darkBackground:a.lightBackground, title: 'One', show: false,
    ...(['main','preview','picker','search'].includes(view)?{titleBarStyle:'hidden' as const,titleBarOverlay:false,frame:true,thickFrame:true,hasShadow:true}:{frame:false}), roundedCorners: true, icon: applicationIcon, ...options,
    webPreferences: { preload: join(__dirname, '../preload/index.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true,autoplayPolicy:'no-user-gesture-required',backgroundThrottling:true } });
  const windowId = window.webContents.id; roles.set(windowId, view);
  if(view==='file-context'||view==='search-menu')popupLifecycle.track(window);
  const sendWindowState = () => {
    if(window.isDestroyed()||window.webContents.isDestroyed())return;
    const visible=window.isVisible()&&!window.isMinimized();
    if(['echo','color-picker','search','search-menu'].includes(view))window.webContents.setBackgroundThrottling(!visible);
    if(view==='main'&&!visible)for(const source of ['overview','maintenance','information'])diskMonitor?.subscribe(false,source);
    window.webContents.send('one:window-state',{maximized:window.isMaximized(),visible});
  };
  window.on('maximize',sendWindowState);window.on('unmaximize',sendWindowState);
  window.on('show',sendWindowState);window.on('hide',sendWindowState);
  window.on('minimize',sendWindowState);window.on('restore',sendWindowState);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.on('close',()=>{if(view==='preview'&&!window.webContents.isDestroyed()){window.webContents.setAudioMuted(true);window.webContents.send('one:preview-closing');}});
  window.on('closed', () => { fileTools?.cancel(windowId);textService?.release(windowId);search?.releaseScope(windowId);directories.close(windowId);roles.delete(windowId); previews.delete(windowId); flags.delete(windowId);previewQueues.delete(windowId); for (const [key, value] of assets) if (value.owner === windowId) assets.delete(key); });
  void window.loadURL(`one://app/index.html?view=${view}${query}`);
  return window;
}
function showMain() { if (!main || main.isDestroyed()) return; if (main.isMinimized()) main.restore(); main.show(); main.focus(); }
function pickPath(mode: 'file'|'directory'|'save', title: string, name = '') { const window = windowFor('picker', { width: 760, height: 620, minWidth: 620, minHeight: 500, parent: main, modal: true, skipTaskbar: true }); const result = pick(window, mode, title, name); window.once('ready-to-show', () => window.show()); return result; }
function echo(text:string,channel?:import('../shared/echo').EchoChannel){echoes?.show(text,channel);}
function textValue(value: unknown, limit = 10_000_000): string { if (typeof value !== 'string' || value.length > limit) throw new Error('文本参数无效或超过长度上限'); return value; }
function filePath(value: unknown): string { if (typeof value !== 'string' || value.length > 32768 || !isAbsolute(value) || value.includes('\0')) throw new Error('文件路径无效'); return resolve(value); }
function handle(name: string, handler: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown, allowed = ['main']) {
  ipcMain.handle(`one:${name}`, (event, ...args) => { const role = roles.get(event.sender.id); if (!role || !allowed.includes(role) || event.senderFrame !== event.sender.mainFrame || !event.senderFrame.url.startsWith('one://app/')) throw new Error('调用来源无效'); return handler(event, ...args); });
}
async function runMaintenance(mode: 'startup' | 'registry' | 'selection') {
  if(mode==='registry')return nativeMaintenance(mode);
  const exe = join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const script = join(__dirname, 'maintenance.ps1').replace('app.asar\\', 'app.asar.unpacked\\');
  const result = await execute(exe, ['-NoProfile', '-NonInteractive', '-File', script, '-Mode', mode==='startup'?'tasks':mode], { windowsHide: true, timeout: 30000, maxBuffer: 10 * 1024 * 1024, encoding: 'utf8' });
  const rows=JSON.parse(result.stdout.trim() || '[]');return mode==='startup'?[...await nativeMaintenance('startup'),...rows]:rows;
}
async function preparePreview(path: string, owner: number): Promise<PreviewData> {
  for (const [key,value] of assets) if(value.owner===owner) assets.delete(key);
  const held:string[]=[];try{const next=await loadPreview(path,(path,mime)=>{if(!roles.has(owner))throw new Error('预览窗口已关闭');const token=randomUUID();assets.set(token,{path,owner,mime});return `one-file://asset/${token}/${encodeURIComponent(basename(path))}`;},async(directory,target)=>{if(!roles.has(owner))throw new Error('预览窗口已关闭');const info=await directories.open(owner,directory,target);held.push(info.id);return info;});const previous=previews.get(owner);for(const info of [previous?.directory,previous?.navigation])if(info)directories.release(owner,info.id);return next;}catch(error){for(const id of held)directories.release(owner,id);throw error;}
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
function saveSettings(value:Settings|((current:Settings)=>Settings)){
  const task=saving.catch(()=>{}).then(async()=>{const previous=settings,next=validateSettings(typeof value==='function'?value(settings):value);
    const changed=(key:keyof Settings)=>JSON.stringify(previous[key])!==JSON.stringify(next[key]);
    if(changed('colorShortcut')&&!recordingShortcut){try{colorShortcut(next.colorShortcut);}catch(error){colorShortcut(previous.colorShortcut);throw error;}}
    try{await persistSettings(next);}catch(error){if(changed('colorShortcut')&&!recordingShortcut)colorShortcut(previous.colorShortcut);throw error;}
    const inputKeys=['echo','keyEcho','onlyCombinations','edgeScroll','copyMenu','explorerPreview','pauseFullscreen','excludedApps','dwellMs','cornerPixels','cooldownMs','copyIntervalMs','volumeStep','edgePixels','corners','edges','cornerBindings'] as const;
    if(inputKeys.some(changed))input?.update(next);
    if(changed('search')){
      const bridgeKeys=['shortcut','doubleCtrl','explorerTyping','explorerMenu','dialogSwitch'] as const;
      if(bridgeKeys.some(k=>next.search[k]!==previous.search[k]))searchBridge?.update(next.search);
      search?.configure(next.search);if(main&&!main.isDestroyed())warmSearchPopups();
      if(JSON.stringify([previous.search.roots,previous.search.excluded,previous.search.maxEntries])!==JSON.stringify([next.search.roots,next.search.excluded,next.search.maxEntries]))search?.rebuild(next.search);
    }
    if(changed('utilities')){if(JSON.stringify(previous.utilities.awake)!==JSON.stringify(next.utilities.awake))awake?.update(next.utilities.awake);if(JSON.stringify(previous.utilities.topmost)!==JSON.stringify(next.utilities.topmost))topmost?.update(next.utilities.topmost);}
    if(changed('diskMonitor'))diskMonitor?.configure(next.diskMonitor);
    if(changed('appearance'))refreshWindowAppearance();
    if(previous.general.launchAtLogin!==next.general.launchAtLogin&&app.isPackaged&&!testMode)app.setLoginItemSettings({openAtLogin:next.general.launchAtLogin});
    if(!next.keyEcho)echoes?.hide();if(previous.keyEcho&&!next.keyEcho)echoes?.cancelEdit();
    return next;
  });saving=task;return task;
}
function colorDisplays(){return screen.getAllDisplays().map(d=>({bounds:screen.dipToScreenRect(null,d.bounds),workArea:screen.dipToScreenRect(null,d.workArea),scaleFactor:d.scaleFactor}));}
function refreshColorDisplays(){colorFollower?.postMessage({displays:colorDisplays()});}
function sendColorFrame(){if(!colorWindow||colorWindow.isDestroyed()||colorWindow.webContents.isLoading()||colorFramePending||!colorSample||colorSample===colorSentSample)return;colorSentSample=colorSample;colorFramePending=true;colorWindow.webContents.send('one:color-sample',colorSample);}
function closeColors(){screen.removeListener('display-added',refreshColorDisplays);screen.removeListener('display-removed',refreshColorDisplays);screen.removeListener('display-metrics-changed',refreshColorDisplays);const worker=colorWorker,follower=colorFollower;colorWorker=null;colorFollower=null;worker?.postMessage('stop');follower?.postMessage('stop');const window=colorWindow;colorWindow=null;if(window&&!window.isDestroyed())window.close();colorSample=undefined;colorSentSample=undefined;colorFramePending=false;input?.setModalActive(recordingShortcut);}
async function acceptColor(hex:string){clipboard.writeText(colorFormats(hex)[settings.colorFormat]);closeColors();await saveSettings(current=>({...current,colorHistory:[hex,...current.colorHistory.filter(c=>c.toUpperCase()!==hex)].slice(0,20)}));for(const w of BrowserWindow.getAllWindows())if(!w.isDestroyed()&&!w.webContents.isDestroyed())w.webContents.send('one:color',hex);}
async function pickColor(){
  if(colorWorker)return;input?.setModalActive(true);
  const point=screen.getCursorScreenPoint();const window=windowFor('color-picker',{x:point.x+24,y:point.y+24,width:216,height:276,minWidth:1,minHeight:1,resizable:false,movable:false,focusable:false,transparent:true,backgroundColor:'#00000000',alwaysOnTop:true,skipTaskbar:true,hasShadow:false,thickFrame:false});
  colorWindow=window;window.setIgnoreMouseEvents(true);window.setAlwaysOnTop(true,'screen-saver');window.on('closed',()=>{if(colorWindow===window)closeColors();});
  window.once('ready-to-show',()=>{if(!window.isDestroyed()&&colorWindow===window){window.showInactive();sendColorFrame();}});
  const follower=new Worker(join(__dirname,'color-position-worker.cjs'),{workerData:{hwnd:Number(window.getNativeWindowHandle().readBigUInt64LE()),displays:colorDisplays()}});colorFollower=follower;
  follower.on('message',message=>{if(message.error&&colorFollower===follower){closeColors();echo(message.error);}});follower.once('error',error=>{if(colorFollower===follower){closeColors();echo(error.message);}});follower.once('exit',()=>{if(colorFollower===follower)closeColors();});
  screen.on('display-added',refreshColorDisplays);screen.on('display-removed',refreshColorDisplays);screen.on('display-metrics-changed',refreshColorDisplays);
  const worker=new Worker(join(__dirname,'color-worker.cjs'));colorWorker=worker;
  worker.on('message',message=>{if(colorWorker!==worker||window.isDestroyed())return;
    if(message.error){closeColors();echo(message.error);return;}if(message.cancel){closeColors();return;}if(message.pick){void acceptColor(message.pick).catch(error=>echo(error.message));return;}
    if(message.sample){const s=message.sample;colorSample={url:'',data:s.data,width:s.width,height:s.height,hex:s.hex,pixels:s.pixels,x:s.x,y:s.y};
      sendColorFrame();
    }
  });worker.once('error',error=>{if(colorWorker===worker){closeColors();echo(error.message);}});worker.once('exit',()=>{if(colorWorker===worker)closeColors();});
}
function refreshWindowAppearance(){const a=settings.appearance,dark=a.mode==='dark'||a.mode==='system'&&nativeTheme.shouldUseDarkColors;for(const w of BrowserWindow.getAllWindows()){if(w.isDestroyed()||w.webContents.isDestroyed())continue;const role=roles.get(w.webContents.id);if(['main','preview','picker','search'].includes(role||'')){w.setBackgroundColor(dark?a.darkBackground:a.lightBackground);}w.webContents.send('one:appearance',a);}}
function colorShortcut(value:string){
  if(registeredColorShortcut)globalShortcut.unregister(registeredColorShortcut);registeredColorShortcut='';
  if(value){const normalized=value.replace(/\b(Ctrl)\b/gi,'Control').replace(/\b(Win|Meta)\b/gi,'Super');if(!globalShortcut.register(normalized,()=>void pickColor().catch(error=>echo(error.message))))throw new Error('取色快捷键已被占用，请更换组合键');registeredColorShortcut=normalized;}
}
function registerIPC() {
  handle('file-tools-run',(event,task)=>fileTools.run(event.sender.id,task));
  handle('file-tools-cancel',(event,kind)=>fileTools.cancel(event.sender.id,kind));
  handle('file-tools-page',(_event,id,page,group)=>fileTools.page(id,page,group));
  handle('file-tools-history',()=>fileTools.history());
  handle('file-tools-overview',async(event,active)=>{if(active!==undefined&&typeof active!=='boolean')throw Error('概览请求无效');const w=BrowserWindow.fromWebContents(event.sender);if(active!==undefined)diskMonitor.subscribe(active&&!!w?.isVisible()&&!w.isMinimized(),'overview');return({version:app.getVersion(),index:{count:search.state().count,running:search.state().running,error:search.state().error},volumes:diskMonitor.state.volumes,recent:await fileTools.history()});});
  handle('echo-displays',()=>screen.getAllDisplays().map(d=>({id:String(d.id),name:d.label||'显示器 '+d.id,width:d.workArea.width,height:d.workArea.height})));
  handle('echo-position',()=>echoes.edit());handle('echo-finish',e=>echoes.finish(BrowserWindow.fromWebContents(e.sender)!),['echo']);
  handle('system-information',(_e,kind,refresh)=>{if(!validInformationKind(kind)||refresh!==undefined&&typeof refresh!=='boolean')throw new Error('系统信息请求无效');return systemInformation.read(kind,refresh);});
  handle('export-system-information',async(_e,reports)=>{if(!Array.isArray(reports)||reports.length>12||JSON.stringify(reports).length>8*1024*1024)throw new Error('系统信息报告无效');const path=await pickPath('save','导出系统信息','系统信息.json');if(!path)return null;await writeFile(path,JSON.stringify({created:new Date().toISOString(),reports},null,2),'utf8');return path;});
  handle('disk-monitor',(event,active,source='maintenance')=>{if(!['maintenance','information'].includes(source)||active!==undefined&&typeof active!=='boolean')throw new Error('磁盘监控请求无效');const w=BrowserWindow.fromWebContents(event.sender);return active===undefined?diskMonitor.state:diskMonitor.subscribe(active&&!!w?.isVisible()&&!w.isMinimized(),source);});
  handle('disk-trace',(_e,enabled)=>{if(typeof enabled!=='boolean')throw new Error('跟踪请求无效');return diskMonitor.trace(enabled);});
  handle('maintenance-scan',(_e,kind)=>maintenance.scan(kind));handle('maintenance-apply',(_e,report,ids)=>maintenance.apply(report,ids));handle('maintenance-receipts',()=>maintenance.receipts());handle('maintenance-restore',(_e,id)=>maintenance.restore(id));handle('maintenance-manage',(_e,kind)=>maintenance.manage(kind));
  handle('file-icons',(_event,paths)=>{if(!Array.isArray(paths)||paths.length>150)throw new Error('文件图标请求无效');for(const path of paths)if(typeof path!=='string'||!launcher?.get(path))filePath(path);return fileIcons.read(paths);},['main','search','search-menu','file-context']);
  handle('search-size',(event,rows,active)=>{const w=BrowserWindow.fromWebContents(event.sender);if(!w||w!==searchWindow||typeof rows!=='number'||!Number.isFinite(rows)||rows<0)return;if(inlineSearch)overlay?.resize(rows,!!active);else {const b=w.getBounds(),area=screen.getDisplayMatching(b).workArea;const height=active?Math.min(560,Math.max(320,area.height-64)):64;const y=active?Math.max(area.y,Math.min(b.y,area.y+area.height-height-16)):b.y;if(Math.abs(b.height-height)>1||Math.abs(b.y-y)>1)w.setBounds({...b,y,height},false);}},['search']);
  handle('search-menu',event=>menuFor(event.sender.id)?.items||[],['search-menu']);
  handle('menu-children',async(_event,id)=>{await menuContextReady;return menuService.children(textValue(id,100));},['search-menu']);
  handle('menu-open',async(event,id,anchor)=>{const parent=menuFor(event.sender.id);if(!parent)return;const request=++parent.revision;hideMenus(parent.depth+1);if(id===null)return;const item=parent.items.find(n=>n.id===textValue(id,100));if(!item||!anchor||![anchor.top,anchor.right].every(Number.isFinite))throw new Error('菜单位置无效');const rootRevision=menuRevision;await menuContextReady;const items=item.children||await menuService.children(item.id);if(rootRevision!==menuRevision||parent.revision!==request||parent.window.isDestroyed()||!parent.window.isVisible())return;
   const p=menuPanel(parent.depth+1),bounds=parent.window.getBounds();p.point={x:bounds.x+Math.min(bounds.width,Math.max(0,anchor.right))-4,y:bounds.y+Math.max(0,Math.min(bounds.height,anchor.top))-7};p.source=item.id;p.items=items;positionMenu(p,286,Math.max(40,Math.min(620,items.length?items.reduce((n,i)=>n+(i.kind==='separator'?13:35),16):70)));sendMenu(p);p.readiness.run(()=>{if(rootRevision===menuRevision&&parent.revision===request&&!parent.window.isDestroyed()&&parent.window.isVisible()&&!p.window.isDestroyed()){sendMenu(p);p.window.setAlwaysOnTop(true,'pop-up-menu');p.window.showInactive();p.window.moveTop();if(anchor.focus)popupFocus(p.window);}});
  },['search-menu']);
  handle('menu-back',event=>{const p=menuFor(event.sender.id);if(p?.depth){hideMenus(p.depth);popupFocus(menuPanels[p.depth-1].window);}},['search-menu']);
  handle('menu-execute',async(_event,id)=>{menuExecuting=true;await menuContextReady;hideMenus();const revision=menuRevision;try{await menuService.execute(textValue(id,100));}catch(error){if(revision===menuRevision&&menuWindow&&!menuWindow.isDestroyed())popupFocus(menuWindow);throw error;}finally{menuExecuting=false;}},['search-menu']);
  handle('menu-size',(event,value)=>{const p=menuFor(event.sender.id);if(p&&value&&[value.width,value.height].every(n=>Number.isFinite(n)&&n>0))positionMenu(p,value.width,value.height);},['search-menu']);
  handle('menu-favorite',async()=>{await menuContextReady;const path=searchContext.currentFolder;if(!path)throw new Error('当前文件夹不可用');if(!settings.search.bookmarks.includes(path))await saveSettings(current=>({...current,search:{...current.search,bookmarks:[...new Set([...current.search.bookmarks,path])].slice(0,64)}}));hideMenus(1);menuNodes=await menuService.open(searchContext);menuPanel(0).items=menuNodes;return menuNodes;},['search-menu']);
  handle('menu-settings',()=>{hideMenus();showMain();main.webContents.send('one:search-settings');},['search-menu']);
  handle('search-context-menu',(event,value,point,directory)=>{const owner=BrowserWindow.fromWebContents(event.sender);if(!owner||!point||![point.x,point.y].every(Number.isFinite))throw new Error('右键菜单位置无效');const item=typeof value==='string'?launcher.get(value):undefined,path=item?item.path:filePath(value),b=owner.getContentBounds();fileMenu.show(owner,path,{x:Math.max(0,Math.min(b.width,point.x)),y:Math.max(0,Math.min(b.height,point.y))},directory===true,item?.launchKind,item?launcher.enrich(item).name:undefined);},['search']);
  handle('file-menu-data',event=>fileMenu.data(event.sender.id),['file-context']);
  handle('file-menu-submenu',(_e,session,top,focus)=>fileMenu.submenu(textValue(session,100),top,focus===true),['file-context']);
  handle('file-menu-apps',(_e,session)=>fileMenu.apps(textValue(session,100)),['file-context']);
  handle('file-menu-size',(event,session,height)=>fileMenu.resize(textValue(session,100),height,event.sender.id),['file-context']);
  handle('file-menu-close',(event,focus,childOnly)=>fileMenu.close(event.sender.id,focus===true,childOnly===true),['file-context']);
  handle('file-menu-action',(_e,session,action,value)=>fileMenu.run(textValue(session,100),action,value===undefined?undefined:textValue(value,32768)),['file-context']);
  handle('search-state',()=>searchState(),['main','search']);handle('search-preferences',()=>settings.search,['main','search']);
  handle('search-files',async(event,query,foldersOnly)=>{const include=roles.get(event.sender.id)==='search'&&!event.sender.getURL().includes('embedded')&&!foldersOnly;const result=await search.query(query,foldersOnly,searchContext.currentFolder,event.sender.id,include);return {...result,items:result.items.map(item=>launcher.enrich(item))};},['main','search']);handle('search-rebuild',()=>search.rebuild(settings.search));handle('search-cancel',()=>search.cancel());handle('search-show',()=>showSearch());
  handle('search-context',()=>searchContext,['search']);handle('search-ready',(event)=>{const window=BrowserWindow.fromWebContents(event.sender);if(window){searchReadyWindows.add(event.sender.id);if(window===searchWindow)replaySearchInput(window,searchRevision);}},['search']);
  handle('search-choose',(_e,value)=>chooseSearch(value),['search']);
  handle('inspect-locks',(_event,value)=>{const path=filePath(value);showMain();main.webContents.send('one:lock-target',path);},['main','preview','search']);
  handle('lock-state',()=>locksmith.state());handle('lock-scan',(_event,paths)=>locksmith.scan(paths));handle('lock-cancel',()=>locksmith.cancel());handle('lock-end',(_event,token)=>locksmith.end(token));
  handle('utility-state',()=>utilityState());handle('topmost-windows',()=>topmost.list());handle('topmost-toggle',(_event,id)=>topmost.toggle(id));handle('topmost-clear',()=>topmost.clear());
  handle('window-action', (event, action) => { const window = BrowserWindow.fromWebContents(event.sender); if (!window) return; if (action === 'minimize') window.minimize(); else if (action === 'maximize') { if (window.isMaximized()) window.unmaximize(); else window.maximize(); } else if (action === 'close') window.close(); else throw new Error('窗口操作无效'); }, ['main','preview','picker','search']);
  handle('window-state', event => {const w=BrowserWindow.fromWebContents(event.sender);return {maximized:w?.isMaximized()??false,visible:!!w?.isVisible()&&!w.isMinimized()};}, ['main','preview','picker','search']);
  handle('brightness-status', () => brightness.status());
  handle('settings', () => settings);
  handle('save-settings', (_event,value)=>saveSettings(validateSettings(value)));
  handle('patch-settings',(_event,patch)=>saveSettings(current=>mergeSettings(current,patch)));
  handle('app-info',()=>({version:app.getVersion(),dataPath:app.getPath('userData'),packaged:app.isPackaged}));
  handle('appearance',()=>settings.appearance,['main','preview','copy','picker','echo','color-picker','search','search-menu','file-context']);
  handle('installed-fonts',(_event,refresh)=>{if(refresh===true)fontSources.clear();return installedFonts(refresh===true);});
  handle('ui-font-source',async(event,family)=>{
    if(roles.get(event.sender.id)!=='main'&&family!==settings.appearance.font.slice(10))throw new Error('字体未被选择');
    if(typeof family!=='string')throw new Error('字体名称无效');
    let pending=fontSources.get(family);
    if(!pending){pending=fontSource(family).then(source=>{if(!source)return null;let url:string|undefined;if(source.path){const token=randomUUID();fontAssets.set(token,{path:source.path,mime:extname(source.path).toLowerCase()==='.otf'?'font/otf':'font/ttf'});url=`one-file://asset/${token}/font`;}return{url,local:source.local};}).catch(error=>{fontSources.delete(family);throw error;});fontSources.set(family,pending);}
    return pending;
  },['main','preview','copy','picker','echo','color-picker','search','search-menu','file-context']);
  handle('pick-color',()=>pickColor());
  handle('color-capture',()=>colorSample||null,['color-picker']);
  handle('color-frame',()=>{colorFramePending=false;sendColorFrame();},['color-picker']);
  handle('choose-color',async(_event,value)=>{if(typeof value!=='string'||!/^#[0-9a-f]{6}$/i.test(value))throw new Error('颜色无效');await acceptColor(value.toUpperCase());},['color-picker','main']);
    handle('record-shortcut',(_event,active)=>{if(typeof active!=='boolean')throw new Error('参数无效');recordingShortcut=active;input.setModalActive(active||!!colorWorker);topmost.record(active);searchBridge.record(active);if(active){if(registeredColorShortcut)globalShortcut.unregister(registeredColorShortcut);}else colorShortcut(settings.colorShortcut);});
  // The default floating level reorders behind the taskbar, which can clear WS_EX_TOPMOST on Windows.
  handle('preview-preferences',async(_event,value)=>{if(value===undefined)return settings.preview;return (await saveSettings(current=>mergeSettings(current,{preview:value}))).preview;},['preview']);
  handle('preview-open-with',event=>{const data=previews.get(event.sender.id);if(!data)throw new Error('预览尚未准备');return openWithApplications(data.path);},['preview']);
  handle('preview-open-in',async(event,id)=>{const data=previews.get(event.sender.id);if(!data)throw new Error('预览尚未准备');await openInApplication(data.path,id);},['preview']);
  handle('preview-flags',async(event,value)=>{const state=flags.get(event.sender.id);if(!state)throw new Error('预览已关闭');if(value){for(const key of ['pinned','held'] as const)if(value[key]!==undefined){if(typeof value[key]!=='boolean')throw new Error('参数无效');state[key]=value[key];}BrowserWindow.fromWebContents(event.sender)?.setAlwaysOnTop(state.pinned,'pop-up-menu');await saveSettings(current=>mergeSettings(current,{preview:{pinned:state.pinned,held:state.held}}));}return state;},['preview']);
  handle('directory-open',(event,path)=>directories.open(event.sender.id,filePath(path)),['preview']);
  handle('directory-page',(event,id,offset,limit,query='')=>directories.page(event.sender.id,textValue(id,100),offset,limit,textValue(query,1000)),['preview']);
  handle('directory-release',(event,id)=>directories.release(event.sender.id,textValue(id,100)),['preview']);
  handle('preview-resource',async(event,value)=>{const data=previews.get(event.sender.id);if(!data||typeof value!=='string'||value.length>4096||/^[a-z][a-z\d+.-]*:|^[\\/]/i.test(value))return null;try{const root=await realpath(dirname(data.path)),path=await realpath(resolve(root,decodeURIComponent(value)));const rel=relative(root,path);if(rel.startsWith('..')||isAbsolute(rel))return null;const extension=extname(path).toLowerCase(),mime:Record<string,string>={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.svg':'image/svg+xml','.css':'text/css'};if(!mime[extension]||(await stat(path)).size>10*1024*1024)return null;const token=randomUUID();assets.set(token,{path,owner:event.sender.id,mime:mime[extension]});return `one-file://asset/${token}/${encodeURIComponent(basename(path))}`;}catch{return null;}},['preview']);
  handle('select-preview',(event,path)=>{const id=event.sender.id,target=filePath(path);const task=(previewQueues.get(id)||Promise.resolve()).catch(()=>{}).then(async()=>{if(event.sender.isDestroyed())return;event.sender.send('one:preview-loading');const data=await preparePreview(target,id);if(event.sender.isDestroyed())return;previews.set(id,data);event.sender.send('one:preview-changed');});previewQueues.set(id,task);return task;},['preview']);
  handle('input-status', () => input.status());
  handle('transform', (event, request) => {textValue(request?.text);return textService.run<string>(event.sender.id,{kind:'pipeline',text:request.text,steps:validateSteps([request])});}, ['main', 'copy']);
  handle('text-pipeline',(event,text,steps)=>textService.run<string>(event.sender.id,{kind:'pipeline',text:textValue(text),steps:validateSteps(steps)}));handle('text-cancel',event=>textService.cancel(event.sender.id));handle('text-compare',(event,left,right,ignoreWhitespace)=>{if(typeof ignoreWhitespace!=='boolean')throw new Error('比较参数无效');return textService.run(event.sender.id,{kind:'compare',left:textValue(left),right:textValue(right),ignoreWhitespace});});handle('text-difference-page',(event,id,page)=>textService.page(event.sender.id,id,page));handle('text-comparison-clear',(event,id)=>textService.clear(event.sender.id,id));handle('text-batch',(event,request)=>{if(!request||typeof request.recursive!=='boolean'||typeof request.merge!=='boolean')throw new Error('批处理参数无效');return textService.run(event.sender.id,{kind:'batch',request:{...request,output:filePath(request.output),steps:validateSteps(request.steps)}});});
  handle('copy-text', (event, text) => clipboard.writeText(textValue(text,roles.get(event.sender.id)==='preview'?50*1024*1024:10_000_000)), ['main', 'copy','preview']);
  handle('send-workbench', (_event, text) => { showMain(); main.webContents.send('one:receive-text', textValue(text)); }, ['copy']);
  handle('open-text', async (_event, encoding) => { const path = await pickPath('file','打开文本文件'); if (!path) return null; return { path, text: await readText(path, textValue(encoding, 20)) }; });
  handle('save-text', async (_event, text, encoding) => { textValue(text); const path = await pickPath('save','保存处理结果','处理结果.txt'); if (!path) return null; await saveText(path, text, textValue(encoding, 20)); return path; });
  handle('pick-file', () => pickPath('file','选择预览文件'));
  handle('picker-data', (event, path) => pickerData(event.sender.id, path === undefined ? undefined : filePath(path)), ['picker']);
  handle('picker-choose', (event, path, overwrite) => { if (overwrite !== undefined && typeof overwrite !== 'boolean') throw new Error('覆盖参数无效'); return choose(BrowserWindow.fromWebContents(event.sender)!, filePath(path), overwrite); }, ['picker']);
  handle('preview', (_event, path) => preview(filePath(path)),['main','search']);
  handle('preview-data', event => { const data = previews.get(event.sender.id); if (!data) throw new Error('预览正在准备'); return data; }, ['preview']);
  handle('navigate-preview', (event, step) => {
    if (step !== -1 && step !== 1) throw new Error('方向无效'); const id = event.sender.id;
    const task = (previewQueues.get(id) || Promise.resolve()).catch(() => {}).then(async () => {
      if (event.sender.isDestroyed()) return; const previous = previews.get(id); if (!previous) return;
      const directory=previous.navigation;if(!directory)return;const next=directory.position+step;if(next<0||next>=directory.count)return;const target=(await directories.page(id,directory.id,next,1)).entries[0];if(!target||event.sender.isDestroyed())return;
      event.sender.send('one:preview-loading');const data = await preparePreview(target.path,id);
      if (event.sender.isDestroyed()) { for (const [token,asset] of assets) if (asset.owner === id) assets.delete(token); return; }
      previews.set(id,data); event.sender.send('one:preview-changed');
    });
    previewQueues.set(id,task); void task.finally(() => { if (previewQueues.get(id) === task) previewQueues.delete(id); }).catch(() => {}); return task;
  }, ['preview']);
  handle('open-file', async (_event, path) => { const error = await shell.openPath(filePath(path)); if (error) throw new Error(error); }, ['main','preview','search']);
  handle('reveal-file', (_event, path) => shell.showItemInFolder(filePath(path)), ['main','preview','search']);
  handle('search-text', async (_event, text) => { const query = textValue(text, 5000); await shell.openExternal(`https://www.bing.com/search?q=${encodeURIComponent(query)}`); }, ['copy']);
  handle('pick-directory', () => pickPath('directory','选择扫描目录'));
  handle('scan',(event,path,id)=>{const target=filePath(path);if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))throw new Error('扫描标识无效');diskService.start(target,(result,error)=>{if(!event.sender.isDestroyed())event.sender.send('one:scan-complete',{id,result,error});});});
  handle('cancel-scan',()=>diskService.stop());
  handle('maintenance', (_event, kind) => { if (kind !== 'startup' && kind !== 'registry') throw new Error('检查类型无效'); return runMaintenance(kind); });
  handle('export-maintenance', async (_event, rows: MaintenanceRow[]) => { if (!Array.isArray(rows) || rows.length > 50000) throw new Error('报告无效'); const path = await pickPath('save','导出检查报告','检查报告.csv'); if (!path) return null; const quote = (text: unknown) => '"' + String(text).replace(/^[=+@-]/, "'$&").replace(/"/g, '""') + '"'; const lines = ['名称,来源,状态,命令,位置', ...rows.map(row => [row.name,row.source,row.status,row.command,row.location].map(quote).join(','))]; await writeFile(path, '\ufeff' + lines.join('\r\n'), 'utf8'); return path; });
  handle('close-window', event => {const role=roles.get(event.sender.id);if(role==='color-picker')return closeColors();if(role==='search-menu'){hideMenus();}else if(role==='search'){searchWindow?.hide();searchRevision++;}else BrowserWindow.fromWebContents(event.sender)?.close();if(role==='search'&&searchContext.kind==='explorer'||role==='search-menu')void searchBridge.focus(searchContext).catch(()=>{});}, ['main','preview','copy','picker','color-picker','search','search-menu','echo']);
  handle('quit', () => app.quit());
}
async function start() {
  Menu.setApplicationMenu(null);
  applicationIcon = nativeImage.createFromBuffer(await readFile(join(__dirname,'../icons/one-256.png')));
  try { settings = validateSettings(JSON.parse(await readFile(settingsPath(), 'utf8'))); } catch {}
  const renderer = resolve(__dirname, '../renderer');
  protocol.handle('one', request => { const url = new URL(request.url); const path = resolve(renderer, '.' + decodeURIComponent(url.pathname)); const rel = relative(renderer, path); if (url.host !== 'app' || rel.startsWith('..') || isAbsolute(rel)) return new Response('Forbidden', { status: 403 }); return net.fetch(pathToFileURL(path).toString()); });
  protocol.handle('one-file', async request => { const url = new URL(request.url); const token=url.pathname.split('/')[1];const asset = assets.get(token)||fontAssets.get(token); if (!asset || url.host !== 'asset') return new Response('Not found', { status: 404 }); return fileResponse(asset.path,asset.mime,request); });
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false)); session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*','https://*/*'] }, (_details, callback) => callback({ cancel: true }));
  diskService=new DiskService(p=>{if(main&&!main.isDestroyed())main.webContents.send('one:progress',p);});maintenance=new MaintenanceClient(join(app.getPath('userData'),'maintenance-backups'),value=>{if(main&&!main.isDestroyed())main.webContents.send('one:maintenance-progress',value);});
  systemInformation=new SystemInformationService(value=>{if(main&&!main.isDestroyed())main.webContents.send('one:system-information-progress',value);},value=>{if(main&&!main.isDestroyed())main.webContents.send('one:system-information-group',value);});
  diskMonitor=new DiskMonitorService(value=>{if(main&&!main.isDestroyed()&&main.isVisible()&&!main.isMinimized())main.webContents.send('one:disk-monitor',value);},(drive,state)=>{const volume=state.volumes.find(v=>v.drive===drive);if(main&&!main.isDestroyed())main.webContents.send('one:disk-alert',{drive,free:volume?.free||0});if(!testMode&&Notification.isSupported()){const notice=new Notification({title:'One · 磁盘空间不足',body:drive+' 剩余 '+((volume?.free||0)/1024**3).toFixed(2)+' GB'});notice.on('click',()=>{showMain();main.webContents.send('one:disk-alert-open');});notice.show();}});
  diskMonitor.configure(settings.diskMonitor);
  echoes=new EchoService(windowFor,()=>settings,placement=>saveSettings(current=>({...current,echo:{...current.echo,keys:{...current.echo.keys,...placement}}})),()=>{if(main&&!main.isDestroyed())main.webContents.send('one:echo-position');});
  initNative(); foreground(); input = new InputService(settings, { echo, show: showMain, color:()=>void pickColor().catch(error=>echo(error.message)), preview: async hwnd => { const selected: { hwnd: number; path: string }[] = await runMaintenance('selection'); if (foreground()?.hwnd !== hwnd) return; const item = selected.find(row => row.hwnd === hwnd); if (item) await preview(filePath(item.path)); } });
  locksmith=new LocksmithService(state=>{for(const w of BrowserWindow.getAllWindows())if(!w.isDestroyed()&&roles.get(w.webContents.id)==='main')w.webContents.send('one:locks',state);});
  awake=new AwakeService(utilityChanged);topmost=new TopmostService(utilityChanged,echo);awake.update(settings.utilities.awake);topmost.update(settings.utilities.topmost);
  search=new SearchService(join(app.getPath('userData'),'file-index.ndjson'),settings.search,searchChanged);searchBridge=new SearchBridge(showSearch,searchChanged);searchBridge.update(settings.search);
  launcher=new LauncherService(items=>{search.launchers(items);searchChanged();});search.launchers(launcher.entries());launcher.refresh();
  fileMenu=new FileContextMenu({create:submenu=>windowFor('file-context',{width:240,height:374,minWidth:240,minHeight:40,frame:false,resizable:false,skipTaskbar:true,hasShadow:true},submenu?'&submenu=apps':''),focus:popupFocus,active:(id,value)=>{if(value)nativeMenus.add(id);else nativeMenus.delete(id);},open:chooseSearch,preview:path=>preview(filePath(path)),system:async(path,owner,point)=>{if(owner.isDestroyed())return;const ownerId=owner.webContents.id;nativeMenus.add(ownerId);try{await showFileContextMenu(path,Number(owner.getNativeWindowHandle().readBigUInt64LE()),point);}finally{nativeMenus.delete(ownerId);if(!owner.isDestroyed()&&owner.isVisible())popupFocus(owner);}},changed:()=>{for(const w of cachedSearch.values())if(!w.isDestroyed())w.webContents.send('one:search-files-changed');}});
  menuService=new SearchMenu(join(app.getPath('userData'),'search-history.json'),()=>settings.search,searchBridge,()=>{showMain();main.webContents.send('one:search-settings');},()=>showSearch());
  textService=new TextService((owner,value)=>{const window=BrowserWindow.getAllWindows().find(w=>w.webContents.id===owner);if(window&&!window.webContents.isDestroyed())window.webContents.send('one:text-progress',value);});
  fileTools=new FileToolsService(join(app.getPath('userData'),'file-tools'),(owner,value)=>{const window=BrowserWindow.getAllWindows().find(w=>!w.isDestroyed()&&w.webContents.id===owner);window?.webContents.send('one:file-tools-progress',value);});
  registerIPC(); main = windowFor('main'); main.once('ready-to-show', () => {main.show();setTimeout(()=>{if(!quitting){warmSearchPopups();}},500).unref();});
  nativeTheme.on('updated',refreshWindowAppearance);
  main.on('blur',()=>{if(recordingShortcut){recordingShortcut=false;input.setModalActive(!!colorWorker);topmost.record(false);searchBridge.record(false);try{colorShortcut(settings.colorShortcut);}catch{}}});
  main.on('close', event => { if(!quitting&&!testMode){event.preventDefault();if(settings.general.closeToTray)main.hide();else app.quit();} });
  if (!testMode) {
    const icon = nativeImage.createEmpty();
    for (const scaleFactor of [1,1.25,1.5,1.75,2,2.25,2.5,3,3.5,4]) icon.addRepresentation({ scaleFactor, buffer: await readFile(join(__dirname,`../icons/one-${16*scaleFactor}.png`)) });
    tray = new Tray(icon); tray.setToolTip('One'); tray.setContextMenu(Menu.buildFromTemplate([{ label: '打开 One', click: showMain }, { type: 'separator' }, { label: '暂停操作增强', click: () => { input.stop(); echoes?.hide(); } }, { label: '恢复操作增强', click: () => input.update(settings) }, { type: 'separator' }, { label: '退出', click: () => app.quit() }])); tray.on('click', showMain);
    if (!globalShortcut.register('CommandOrControl+Alt+O', showMain)) console.warn('Ctrl+Alt+O 已被其他程序使用，可从托盘打开 One');
    try{colorShortcut(settings.colorShortcut);}catch(error){console.warn(String(error));}
    input.update(settings);
  }
}
if (!testMode && !app.requestSingleInstanceLock()) app.quit(); else { app.on('second-instance', showMain); app.whenReady().then(start).catch(error => { console.error(error); app.quit(); }); }
app.on('before-quit', event => { if(finishingQuit){event.preventDefault();return;}if(fileTools?.pendingTasks||textService?.pendingTasks){event.preventDefault();finishingQuit=Promise.all([fileTools?.stop(),textService?.stop()]);void finishingQuit.then(()=>{finishingQuit=undefined;app.quit();});return;}fileTools?.stop(); quitting=true;popupLifecycle.stop();launcher?.stop();fileMenu?.hide(false);maintenance?.stop();systemInformation?.stop();diskMonitor?.stop();diskService?.stop();echoes?.stop();void textService?.stop();searchBridge?.stop();void search?.stop();locksmith?.stop();awake?.stop();topmost?.stop();closeColors(); brightness.stop(); input?.stop(); globalShortcut.unregisterAll(); for (const worker of workers) void worker.terminate(); tray?.destroy(); });
app.on('window-all-closed', () => { if (testMode) app.quit(); });
