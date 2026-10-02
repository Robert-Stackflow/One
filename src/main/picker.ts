import { app, BrowserWindow, screen } from 'electron';
import { stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import type { PickerData, PickerEntry, PickerOpened, PickerPlaces, PickerPreferences, PickerBounds } from '../shared/picker';
import { PickerStore, pickerPath, uniquePickerPaths } from './picker-store';
import { fitPickerBounds } from '../shared/picker';
interface State {
 mode: PickerData['mode']; title: string; path: string; name: string; ready: Promise<void>;
 revision: number; reading: boolean; cancel?: () => void; settle(path: string | null): void;
}
const states = new Map<number, State>();
let store: PickerStore | undefined;
let logicalDrives:(()=>number)|undefined;
const windows=new Set<BrowserWindow>();let flushing=false;
const normalBounds=new Map<BrowserWindow,PickerBounds>();
function windowBounds(window:BrowserWindow) {
 if(!window.isMaximized()&&!window.isMinimized())normalBounds.set(window,window.getBounds());
 return normalBounds.get(window)||window.getNormalBounds();
}
let bookmarks = () => [] as string[], opened = async () => [] as {path: string}[];
export function configurePicker(bookmarkSource: () => string[], openedSource: () => Promise<{path: string}[]>) {
 bookmarks = bookmarkSource; opened = openedSource;
}
function history() { return store ||= new PickerStore(join(app.getPath('userData'),'picker-state.json')); }
function stateFor(id: number) { const state = states.get(id); if (!state) throw new Error('选择窗口已关闭'); return state; }
export async function pickerWindowBounds() {
 const saved=history();await saved.load();
 return saved.bounds ? fitPickerBounds(saved.bounds,screen.getDisplayMatching(saved.bounds).workArea) : undefined;
}
export function trackPickerWindow(window: BrowserWindow) {
 windows.add(window);
 windowBounds(window);
 let timer:ReturnType<typeof setTimeout>|undefined;
 const save=()=>{clearTimeout(timer);timer=undefined;if(!flushing&&!window.isDestroyed())void history().windowBounds(windowBounds(window)).catch(error=>console.warn('无法保存选择窗口位置',error));};
 const schedule=()=>{if(!window.isDestroyed())windowBounds(window);clearTimeout(timer);timer=setTimeout(save,200);};
 window.on('move',schedule);window.on('resize',schedule);window.on('close',save);
 window.once('closed',()=>{clearTimeout(timer);windows.delete(window);normalBounds.delete(window);});
}
export async function flushPickerState() {
 flushing=true;
 for(const state of states.values()){state.cancel?.();state.settle(null);}
 try{for(const window of windows)if(!window.isDestroyed())await history().windowBounds(windowBounds(window));if(store)await store.flush();}
 catch(error){console.warn('无法保存选择窗口位置',error);}
}
export function pick(window: BrowserWindow, mode: PickerData['mode'], title: string, name = '', initialPath?: string): Promise<string | null> {
 return new Promise(accept => {
  const id = window.webContents.id, state: State = {mode,title,path:app.getPath('documents'),name,ready:Promise.resolve(),revision:0,reading:false,settle:accept};
  states.set(id,state);
  state.ready = (async () => {
   const saved = history(); await saved.load();
   for (const candidate of uniquePickerPaths([initialPath,...saved.recent,state.path],22)) {
    try { const info = await stat(candidate);
     if (info.isDirectory()) { state.path = candidate; break; }
     if (info.isFile() && candidate === initialPath) { state.path = dirname(candidate); if (mode === 'file') state.name = basename(candidate); break; }
    } catch { /* A remembered removable drive may be offline. */ }
   }
  })();
  window.once('closed', () => { state.cancel?.(); state.settle(null); states.delete(id); });
 });
}
export async function pickerData(id: number, path?: string): Promise<PickerData> {
 const state = stateFor(id), revision = ++state.revision; state.cancel?.(); state.reading = true;
 try {
  await state.ready;
  const current = path === undefined ? state.path : path;
  if (!pickerPath(current)) throw new Error('目录无效');
  if (states.get(id) !== state || revision !== state.revision) throw new Error('目录读取已取消');
  const location = resolve(current), preferences = {...history().preferences};
  const entries = await new Promise<PickerEntry[]>((accept,reject) => {
   const worker = new Worker(join(__dirname,'picker-directory-worker.cjs'), {workerData:{path:location, mode:state.mode, showHidden:preferences.showHidden}});
   let done = false;
   const finish = (error?: Error, result?: PickerEntry[]) => {
    if (done) return; done = true; if (state.cancel === cancel) state.cancel = undefined;
    void worker.terminate(); if (error) reject(error); else accept(result!);
   };
   const cancel = () => finish(new Error('目录读取已取消')); state.cancel = cancel;
   worker.once('message', value => finish(value.error ? new Error(value.error) : undefined,value.entries));
   worker.once('error', error => finish(error)); worker.once('exit', () => finish(new Error('目录读取中断')));
  });
  if (states.get(id) !== state || revision !== state.revision) throw new Error('目录读取已取消');
  state.path = location;
  return {mode:state.mode,title:state.title,path:location,parent:dirname(location),name:state.name,preferences,entries};
 } finally { if (revision === state.revision) state.reading = false; }
}
function places(paths: string[]) { return uniquePickerPaths(paths,64).map(path => ({path,name:basename(path) || path})); }
export async function pickerPlaces(id: number): Promise<PickerPlaces> {
 stateFor(id); const saved = history(); await saved.load();
 const common = (['desktop','documents','downloads','pictures','music','videos'] as const).map((kind,i) => ({path:app.getPath(kind), name:['桌面','文档','下载','图片','音乐','视频'][i]}));
 // Enumerating mounted drive letters does not touch offline/removable roots.
 if(process.platform === 'win32')logicalDrives ||= require('koffi').load('kernel32.dll').func('uint32 __stdcall GetLogicalDrives()');
 const mask = logicalDrives?.()||0;
 const drives = process.platform === 'win32' ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').filter((_,i) => mask & (1 << i)).map(letter => letter + ':\\') : ['/'];
 return {common,bookmarks:places(bookmarks()),recent:places(saved.recent),drives:places(drives)};
}
export async function pickerOpened(id: number): Promise<PickerOpened> {
 stateFor(id); try { return {places:places((await opened()).map(folder => folder.path)),error:''}; }
 catch { return {places:[],error:'暂时无法读取资源管理器，请刷新重试'}; }
}
export async function pickerPreferences(id: number, value: PickerPreferences) {
 stateFor(id); return history().update(value);
}
export async function pickerClearRecent(id: number) { stateFor(id); await history().clearRecent(); }
export async function choose(window: BrowserWindow, path: string, overwrite = false): Promise<{overwrite: boolean}> {
 const id = window.webContents.id, state = stateFor(id);
 if (state.reading) throw new Error('请等待当前目录读取完成');
 if (!pickerPath(path)) throw new Error('路径无效'); path = resolve(path);
 if (state.mode === 'save') {
  if (dirname(path) !== state.path || !basename(path) || /[\x00-\x1f<>:"|?*]/.test(basename(path)) || /[. ]$/.test(basename(path)) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i.test(basename(path))) throw new Error('文件名无效');
  try { const info = await stat(path); if (!info.isFile()) throw new Error('目标不是文件'); if (!overwrite) return {overwrite:true}; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
 } else { const info = await stat(path); if (state.mode === 'file' && !info.isFile()) throw new Error('请选择文件'); if (state.mode === 'directory' && !info.isDirectory()) throw new Error('请选择目录'); }
 await history().remember(state.mode === 'directory' ? path : dirname(path));
 if (states.get(id) !== state) throw new Error('选择窗口已关闭');
 state.settle(path); states.delete(id); setTimeout(() => { if (!window.isDestroyed()) window.close(); },30); return {overwrite:false};
}
