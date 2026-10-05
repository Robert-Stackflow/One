import {BrowserWindow,screen,type Rectangle} from 'electron';
import type {TrayMenuView} from './tray-menu';

const width=296,height=356;
const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
export function trayMenuBounds(anchor:Rectangle,area:Rectangle):Rectangle{
 const menuWidth=Math.min(width,area.width),menuHeight=Math.min(height,area.height);
 const x=clamp(Math.round(anchor.x+anchor.width/2-menuWidth/2),area.x,area.x+area.width-menuWidth);
 const below=anchor.y+anchor.height+8,above=anchor.y-menuHeight-8;
 const y=below+menuHeight<=area.y+area.height?below:above>=area.y?above:clamp(Math.round(anchor.y+anchor.height/2-menuHeight/2),area.y,area.y+area.height-menuHeight);
 return {x,y,width:menuWidth,height:menuHeight};
}

export class TrayMenuPanel{
 window?:BrowserWindow;
 private opened=false;
 private loaded=false;
 private idleTimer?:NodeJS.Timeout;
 private focusTimer?:NodeJS.Timeout;
 constructor(private create:()=>BrowserWindow,private state:()=>TrayMenuView){}
 view(sender:Electron.WebContents){this.verify(sender);return this.state();}
 ready(sender:Electron.WebContents){this.verify(sender);this.loaded=true;this.show();}
 verify(sender:Electron.WebContents){if(!this.opened||this.window?.webContents!==sender)throw new Error('托盘菜单已关闭');}
 changed(){if(this.opened&&this.window&&!this.window.isDestroyed())this.window.webContents.send('one:tray-menu-changed');}
 toggle(anchor?:Rectangle){if(this.opened&&this.window?.isVisible())this.close();else this.open(anchor);}
 open(anchor?:Rectangle){
  this.close();clearTimeout(this.idleTimer);this.idleTimer=undefined;this.opened=true;
  const point=screen.getCursorScreenPoint(),target=anchor&&anchor.width>0&&anchor.height>0?anchor:{...point,width:1,height:1};
  const area=screen.getDisplayNearestPoint({x:target.x+target.width/2,y:target.y+target.height/2}).workArea,bounds=trayMenuBounds(target,area);
  if(this.window&&!this.window.isDestroyed()){this.window.setBounds(bounds);if(this.loaded)this.show();return;}
  const window=this.create();this.window=window;this.loaded=false;window.setBounds(bounds);
  window.on('blur',()=>{if(this.opened)this.close();});
  window.on('closed',()=>{if(this.window===window){this.window=undefined;this.loaded=false;this.opened=false;}});
 }
 private show(){const window=this.window;if(!this.loaded||!this.opened||!window||window.isDestroyed())return;window.show();window.focus();clearTimeout(this.focusTimer);this.focusTimer=setTimeout(()=>{if(this.opened&&this.window===window&&window.isVisible())window.focus();},80);}
 close(){this.opened=false;clearTimeout(this.focusTimer);this.focusTimer=undefined;const window=this.window;if(!window||window.isDestroyed())return;if(window.isVisible())window.hide();clearTimeout(this.idleTimer);this.idleTimer=setTimeout(()=>{if(this.window===window&&!this.opened){this.window=undefined;this.loaded=false;window.destroy();}},8_000);this.idleTimer.unref();}
 dispose(){this.close();clearTimeout(this.idleTimer);const window=this.window;this.window=undefined;this.loaded=false;if(window&&!window.isDestroyed())window.destroy();}
}
