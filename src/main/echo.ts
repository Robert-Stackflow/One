import {BrowserWindow,screen} from 'electron';
import type {Settings} from '../shared/types';
import type {EchoChannel,EchoPlacement} from '../shared/echo';
export class EchoService {
 private windows=new Map<string,BrowserWindow>();private timers=new Map<string,NodeJS.Timeout>();private editor?:BrowserWindow;private editorOrigin?:{x:number;y:number};
 constructor(private create:(view:string,options:Electron.BrowserWindowConstructorOptions,query?:string)=>BrowserWindow,private settings:()=>Settings,private save:(placement:Pick<EchoPlacement,'x'|'y'|'display'>)=>Promise<unknown>,private changed:()=>void){}
 private options={width:380,height:108,minWidth:100,minHeight:30,frame:false,titleBarOverlay:false as const,transparent:true,backgroundColor:'#00000000',hasShadow:false,thickFrame:false,resizable:false,focusable:false,alwaysOnTop:true,skipTaskbar:true};
 private place(window:BrowserWindow,channel:EchoChannel|'level'){
  const c=channel==='level'?{x:.5,y:.92,display:'cursor'}:this.settings().echo[channel];const displays=screen.getAllDisplays(),d=displays.find(d=>String(d.id)===c.display)||screen.getDisplayNearestPoint(screen.getCursorScreenPoint());const a=d.workArea,{width,height}=this.options;window.setBounds({x:Math.round(a.x+(a.width-width)*c.x),y:Math.round(a.y+(a.height-height)*c.y),width,height},false);
 }
 show(text:string,channel:EchoChannel|'level'='level'){
  if(this.editor)return;const key=channel==='level'?'level':'hint';let w=this.windows.get(key);const created=!w||w.isDestroyed();if(created){w=this.create('echo',this.options,'&channel='+key);w.setIgnoreMouseEvents(true);w.setAlwaysOnTop(true,'screen-saver');this.windows.set(key,w);}const window=w!;
  const send=()=>{if(window.isDestroyed()||this.editor)return;const enter=!window.isVisible();if(enter)this.place(window,channel);window.webContents.send('one:echo',{text,channel,enter});if(enter)window.showInactive();clearTimeout(this.timers.get(key));this.timers.set(key,setTimeout(()=>{if(window.isDestroyed())return;window.webContents.send('one:echo-hide');this.timers.set(key,setTimeout(()=>{if(!window.isDestroyed())window.hide();},140));},channel==='level'?1300:this.settings().echo[channel].duration));};if(created||window.webContents.isLoading())window.webContents.once('did-finish-load',send);else send();
 }
 edit(){if(this.editor&&!this.editor.isDestroyed()){this.editor.show();this.editor.focus();return;}this.hide();const window=this.create('echo',{...this.options,focusable:true,movable:true},'&edit=1');this.editor=window;this.editorOrigin=undefined;window.setAlwaysOnTop(true,'screen-saver');window.once('ready-to-show',()=>{if(window.isDestroyed())return;this.place(window,'keys');const {x,y}=window.getBounds();this.editorOrigin={x,y};window.show();window.focus();});window.on('closed',()=>{if(this.editor===window){this.editor=undefined;this.editorOrigin=undefined;}});}
 async finish(window:BrowserWindow){if(this.editor!==window)throw new Error('位置编辑窗口无效');const b=window.getBounds();if(!this.editorOrigin||b.x!==this.editorOrigin.x||b.y!==this.editorOrigin.y){const d=screen.getDisplayMatching(b),a=d.workArea;await this.save({display:String(d.id),x:Math.max(0,Math.min(1,(b.x-a.x)/Math.max(1,a.width-b.width))),y:Math.max(0,Math.min(1,(b.y-a.y)/Math.max(1,a.height-b.height)))});}if(!window.isDestroyed())window.close();this.changed();}
 cancelEdit(){this.editor?.close();}
 hide(){for(const w of this.windows.values())if(!w.isDestroyed())w.hide();for(const t of this.timers.values())clearTimeout(t);this.timers.clear();}
 stop(){this.hide();for(const w of this.windows.values())if(!w.isDestroyed())w.destroy();this.windows.clear();this.editor?.destroy();}
}
