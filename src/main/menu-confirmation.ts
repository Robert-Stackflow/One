import {BrowserWindow,screen} from 'electron';
import type {MenuBuiltin} from '../shared/menu-builtins';
export interface MenuConfirmationData {label:string;message:string;icon:string}
export class MenuConfirmation {
 private pending:{window:BrowserWindow;data:MenuConfirmationData;resolve:(accepted:boolean)=>void}|undefined;private stopped=false;
 constructor(private create:()=>BrowserWindow){}
 request(command:MenuBuiltin):Promise<boolean>{
  if(this.stopped||!command.confirm)return Promise.resolve(false);this.finish(false);
  return new Promise(resolve=>{const window=this.create(),pending=this.pending={window,data:{label:command.label,message:command.confirm!,icon:command.icon},resolve};
   window.once('closed',()=>{if(this.pending===pending)this.finish(false);});window.webContents.once('did-fail-load',()=>{if(this.pending===pending)this.finish(false);});window.webContents.once('render-process-gone',()=>{if(this.pending===pending)this.finish(false);});
   window.once('ready-to-show',()=>{if(this.pending!==pending||window.isDestroyed())return;const area=screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea,bounds=window.getBounds();window.setBounds({...bounds,x:Math.round(area.x+(area.width-bounds.width)/2),y:Math.round(area.y+(area.height-bounds.height)/3)},false);window.show();window.moveTop();window.focus();});
  });
 }
 data(sender:number){if(this.pending?.window.webContents.id!==sender)throw new Error('确认操作已失效');return this.pending.data;}
 answer(sender:number,accepted:boolean){if(this.pending?.window.webContents.id!==sender)throw new Error('确认操作已失效');this.finish(accepted);}
 private finish(accepted:boolean){const pending=this.pending;if(!pending)return;this.pending=undefined;pending.resolve(accepted);if(!pending.window.isDestroyed())pending.window.close();}
 stop(){this.stopped=true;this.finish(false);}
}
