import {BrowserWindow,screen} from 'electron';
import type {ColorState} from '../shared/colors';
import {restorePickerBounds,type PickerBounds} from '../shared/picker';
export class ColorEditor {
 private window:BrowserWindow|undefined;private requested=false;private stopped=false;private resume=false;private selected='';private height=360;
 constructor(private create:()=>BrowserWindow,private state:()=>Omit<ColorState,'selected'>){}
 snapshot():ColorState{return {...this.state(),selected:this.selected||this.state().history[0]||'#4479D8'};}
 remember(hex:string){this.selected=hex;}
 show(hex?:string){
  if(this.stopped)return;this.selected=hex||this.state().history[0]||this.selected||'#4479D8';this.requested=true;
  let window=this.window;if(!window||window.isDestroyed()){
   window=this.create();this.window=window;const own=window;
   window.on('close',event=>{if(!this.stopped){event.preventDefault();this.requested=false;own.hide();}});
   window.once('closed',()=>{if(this.window===own)this.window=undefined;});
   window.once('ready-to-show',()=>{if(this.requested&&!this.stopped&&this.window===own)this.present(own);});
  }else if(!window.webContents.isLoading())this.present(window);
 }
 private present(window:BrowserWindow){
  if(window.isDestroyed()||window.webContents.isDestroyed())return;
  const area=screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea,width=Math.min(420,area.width-32),height=Math.min(this.height,560,area.height-32);
  this.bounds(window,{x:Math.round(area.x+(area.width-width)/2),y:Math.round(area.y+Math.max(16,(area.height-height)/3)),width,height});
  window.webContents.send('one:color-editor-open',this.selected);window.show();window.focus();
 }
 startPicking(){this.resume=!!this.window?.isVisible();this.requested=false;this.window?.hide();}
 finishPicking(cancelled:boolean){const resume=this.resume;this.resume=false;if(cancelled&&resume&&!this.stopped)this.show(this.selected);}
 resize(height:number){
  this.height=Math.ceil(height);const window=this.window;if(!window||window.isDestroyed())return;const b=window.getContentBounds(),area=screen.getDisplayMatching(b).workArea;
  const next=Math.min(this.height,560,area.height-32),y=Math.max(area.y+16,Math.min(b.y,area.y+area.height-next-16));
  if(Math.abs(b.height-next)>1||Math.abs(b.y-y)>1)this.bounds(window,{...b,height:next,y});
 }
 private bounds(window:BrowserWindow,target:PickerBounds){restorePickerBounds({getBounds:()=>window.getContentBounds(),setBounds:bounds=>window.setContentBounds(bounds,false)},target);}
 stop(){this.stopped=true;this.requested=false;this.resume=false;}
}
