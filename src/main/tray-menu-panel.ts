import {BrowserWindow,screen,type Rectangle} from 'electron';
import type {TrayMenuView} from './tray-menu';

const width=296;
const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
export function trayMenuBounds(anchor:Rectangle,area:Rectangle,items=8):Rectangle{
 const menuWidth=Math.min(width,area.width),menuHeight=Math.min(102+items*37,area.height);
 const x=clamp(Math.round(anchor.x+anchor.width/2-menuWidth/2),area.x,area.x+area.width-menuWidth);
 const below=anchor.y+anchor.height+8,above=anchor.y-menuHeight-8;
 const y=below+menuHeight<=area.y+area.height?below:above>=area.y?above:clamp(Math.round(anchor.y+anchor.height/2-menuHeight/2),area.y,area.y+area.height-menuHeight);
 return {x,y,width:menuWidth,height:menuHeight};
}
export function trayMoreBounds(root:Rectangle,top:number,area:Rectangle,items:number,groups:number):Rectangle{
 const menuWidth=Math.min(width,area.width),menuHeight=Math.min(64+items*37+groups*30,area.height);
 const right=root.x+root.width+6,left=root.x-menuWidth-6;
 return {x:clamp(right+menuWidth<=area.x+area.width?right:left,area.x,area.x+area.width-menuWidth),y:clamp(Math.round(root.y+top),area.y,area.y+area.height-menuHeight),width:menuWidth,height:menuHeight};
}

export class TrayMenuPanel{
 window?:BrowserWindow;
 moreWindow?:BrowserWindow;
 private opened=false;
 private loaded=false;
 private moreOpened=false;
 private moreLoaded=false;
 private idleTimer?:NodeJS.Timeout;
 private focusTimer?:NodeJS.Timeout;
 private dismissTimer?:NodeJS.Timeout;
 constructor(private create:()=>BrowserWindow,private state:()=>TrayMenuView){}
 view(sender:Electron.WebContents){this.verify(sender);const state=this.state();return sender===this.moreWindow?.webContents?{...state,entries:state.moreEntries,submenu:true}:{...state,submenu:false};}
 ready(sender:Electron.WebContents){
  if(sender===this.window?.webContents){this.loaded=true;if(this.opened)this.show();}
  else if(sender===this.moreWindow?.webContents){this.moreLoaded=true;if(this.opened&&this.moreOpened)this.showMore();}
  else throw new Error('托盘菜单不可用');
 }
 verify(sender:Electron.WebContents){if(!this.opened||(this.window?.webContents!==sender&&(!this.moreOpened||this.moreWindow?.webContents!==sender)))throw new Error('托盘菜单已关闭');}
 changed(){for(const window of [this.window,this.moreOpened?this.moreWindow:undefined])if(this.opened&&window&&!window.isDestroyed())window.webContents.send('one:tray-menu-changed');}
 toggle(anchor?:Rectangle){if(this.opened&&this.window?.isVisible())this.close();else this.open(anchor);}
 open(anchor?:Rectangle){
  this.close();clearTimeout(this.idleTimer);this.idleTimer=undefined;this.opened=true;
  const point=screen.getCursorScreenPoint(),target=anchor&&anchor.width>0&&anchor.height>0?anchor:{...point,width:1,height:1};
  const area=screen.getDisplayNearestPoint({x:target.x+target.width/2,y:target.y+target.height/2}).workArea,bounds=trayMenuBounds(target,area,this.state().entries.length);
  if(this.window&&!this.window.isDestroyed()){this.window.setBounds(bounds);if(this.loaded){this.changed();this.show();}return;}
  const window=this.create();this.window=window;this.loaded=false;window.setBounds(bounds);
  window.on('blur',()=>this.dismiss());
  window.on('closed',()=>{if(this.window===window){this.window=undefined;this.loaded=false;this.opened=false;this.destroyMore();}});
 }
 openMore(sender:Electron.WebContents,top:unknown){
  this.verify(sender);if(sender!==this.window?.webContents||typeof top!=='number'||!Number.isFinite(top))throw new Error('更多菜单位置无效');
  if(this.moreOpened&&this.moreWindow?.isVisible()){clearTimeout(this.dismissTimer);this.showMore();return;}
  const root=this.window.getContentBounds(),state=this.state(),area=screen.getDisplayMatching(root).workArea;
  const bounds=trayMoreBounds(root,clamp(top*sender.getZoomFactor(),0,root.height),area,state.moreEntries.length,new Set(state.moreEntries.map(item=>item.group)).size);
  this.moreOpened=true;clearTimeout(this.focusTimer);clearTimeout(this.dismissTimer);
  if(this.moreWindow&&!this.moreWindow.isDestroyed()){this.moreWindow.setBounds(bounds);if(this.moreLoaded){this.changed();this.showMore();}return;}
  const window=this.create();this.moreWindow=window;this.moreLoaded=false;window.setBounds(bounds);
  window.on('blur',()=>this.dismiss());window.on('closed',()=>{if(this.moreWindow===window){this.moreWindow=undefined;this.moreLoaded=false;this.moreOpened=false;}});
 }
 closeMore(sender:Electron.WebContents){this.verify(sender);if(sender!==this.window?.webContents)throw new Error('托盘主菜单不可用');if(!this.moreOpened)return;this.moreOpened=false;this.moreWindow?.hide();clearTimeout(this.dismissTimer);this.window?.focus();}
 hide(sender:Electron.WebContents){this.verify(sender);if(sender===this.moreWindow?.webContents){this.moreOpened=false;this.moreWindow.hide();clearTimeout(this.dismissTimer);this.window?.focus();}else this.close();}
 private dismiss(){clearTimeout(this.dismissTimer);this.dismissTimer=setTimeout(()=>{if(this.opened&&!this.window?.isFocused()&&!this.moreWindow?.isFocused())this.close();},100);}
 private show(){const window=this.window;if(!this.loaded||!this.opened||!window||window.isDestroyed())return;window.show();window.focus();clearTimeout(this.focusTimer);this.focusTimer=setTimeout(()=>{if(this.opened&&!this.moreOpened&&this.window===window&&window.isVisible())window.focus();},80);}
 private showMore(){if(this.opened&&this.moreOpened&&this.moreLoaded&&this.moreWindow&&!this.moreWindow.isDestroyed()){this.moreWindow.show();this.moreWindow.focus();}}
 private destroyMore(){const window=this.moreWindow;this.moreWindow=undefined;this.moreOpened=false;this.moreLoaded=false;if(window&&!window.isDestroyed())window.destroy();}
 close(){
  this.opened=false;this.moreOpened=false;clearTimeout(this.focusTimer);clearTimeout(this.dismissTimer);clearTimeout(this.idleTimer);
  for(const window of [this.window,this.moreWindow])if(window&&!window.isDestroyed()&&window.isVisible())window.hide();
  this.idleTimer=setTimeout(()=>{if(!this.opened){this.destroyMore();const window=this.window;this.window=undefined;this.loaded=false;if(window&&!window.isDestroyed())window.destroy();}},8_000);this.idleTimer.unref();
 }
 dispose(){this.close();clearTimeout(this.idleTimer);this.destroyMore();const window=this.window;this.window=undefined;this.loaded=false;if(window&&!window.isDestroyed())window.destroy();}
}
