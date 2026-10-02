import {BrowserWindow} from 'electron';
import {stat} from 'node:fs/promises';
import type {SearchBridge} from './search-bridge';
import type {SearchMenu} from './search-menu';
import type {SearchContext,SearchSettings} from '../shared/search';
import type {DialogBarData} from '../shared/dialog-bar';
import {DialogOverlay,dialogProcess} from './dialog-overlay';
export class DialogBar{
 private window?:BrowserWindow;private overlay?:DialogOverlay;private revision=0;private choosing=false;private refreshed=0;
 context?:SearchContext;
 constructor(private create:()=>BrowserWindow,private bridge:SearchBridge,private config:()=>SearchSettings,private history:SearchMenu){}
 owns(id:number){return !!this.window&&!this.window.isDestroyed()&&this.window.webContents.id===id;}
 private view(){
  if(!this.window||this.window.isDestroyed()){
   const window=this.create();this.window=window;
   window.on('closed',()=>{if(this.window===window){this.overlay?.detach();this.overlay=undefined;this.window=undefined;this.context=undefined;this.revision++;}});
  }
  return this.window;
 }
 warm(){if(this.config().dialogSwitch)this.view();}
 async show(hwnd:number){
  if(!this.config().dialogSwitch)return;const process=dialogProcess(hwnd);if(!process)return;
  if(this.overlay?.hwnd===hwnd&&this.context?.pid===process&&Date.now()-this.refreshed<1000)return;
  const revision=++this.revision,same=this.overlay?.hwnd===hwnd,window=this.view();
  if(!same){this.overlay?.detach();this.overlay=undefined;this.context=undefined;}
  // Attach before Shell/COM enumerates Explorer folders. The preloaded view does
  // not wait for other apps and leaves the native file dialog in the foreground.
  const attach=()=>{
   if(revision!==this.revision||window.isDestroyed()||this.overlay?.hwnd===hwnd)return;
   this.collapse();this.overlay=new DialogOverlay(window,hwnd,process,()=>this.collapse(),()=>{if(this.overlay?.hwnd===hwnd){this.context=undefined;this.overlay=undefined;if(!window.isDestroyed())window.hide();}});
   if(!this.overlay.attach()){this.overlay=undefined;return;}
   void this.sendData(window,revision);
  };
  if(window.webContents.isLoading())window.once('ready-to-show',attach);else attach();
  try{
   const context=await this.bridge.context(hwnd);
   if(revision!==this.revision||!this.config().dialogSwitch||window.isDestroyed())return;
   if(context.kind!=='dialog'||context.pid!==process||!context.created){this.overlay?.detach();this.overlay=undefined;return;}
   this.context=context;this.refreshed=Date.now();await this.sendData(window,revision);
  }catch(error){if(revision===this.revision){this.overlay?.detach();this.overlay=undefined;this.context=undefined;}throw error;}
 }
 private async sendData(window:BrowserWindow,revision:number){const data=await this.data();if(revision===this.revision&&!window.isDestroyed())window.webContents.send('one:dialog-bar-data',data);}
 async data():Promise<DialogBarData>{const seen=new Set<string>();return{opened:(this.context?.folders||[]).filter(folder=>{const key=folder.path.toLowerCase();if(!folder.active||seen.has(key))return false;seen.add(key);return true;}).map(folder=>folder.path),bookmarks:[...this.config().bookmarks],recent:await this.history.recentFolders()};}
 resize(rows:number,active:boolean){this.overlay?.resize(rows,active);}
 collapse(){if(this.window&&!this.window.isDestroyed())this.window.webContents.send('one:dialog-bar-collapse');}
 closeResults(){this.collapse();this.overlay?.focusOwner();}
 async choose(path:string){
  const context=this.context;if(!context||!this.overlay?.interactive())throw Error('文件对话框已失去焦点');if(this.choosing)return;
  this.choosing=true;
  try{
   if(!(await stat(path)).isDirectory())throw Error('请选择文件夹');
   if(context.hwnd!==this.context?.hwnd||context.pid!==this.context?.pid||context.created!==this.context?.created||!this.overlay?.interactive())throw Error('文件对话框已失效');
   // Navigate through the native interface while the attached bar stays visible.
   await this.bridge.jump(context,path);await this.history.remember(path);
   if(this.context?.hwnd===context.hwnd)this.closeResults();
  }finally{this.choosing=false;}
 }
 stop(){this.revision++;this.context=undefined;this.overlay?.detach();this.overlay=undefined;if(this.window&&!this.window.isDestroyed())this.window.destroy();this.window=undefined;}
}
