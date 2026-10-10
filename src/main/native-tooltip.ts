import {BrowserWindow} from 'electron';
import type {EventEmitter} from 'node:events';
import {nativeTooltipMargin,type NativeTooltipData} from '../shared/native-tooltip';
interface TooltipSession {owner:BrowserWindow;window:BrowserWindow;ready:boolean;data:NativeTooltipData|null;remove:()=>void}
/** An owned, non-activating transparent window can compose above a native Office child. */
export class NativeTooltipService {
 private sessions=new Map<number,TooltipSession>();
 constructor(private create:(parent:BrowserWindow)=>BrowserWindow){}
 prepare(owner:BrowserWindow){
  if(this.sessions.has(owner.webContents.id)||owner.isDestroyed())return;
  const window=this.create(owner),id=owner.webContents.id;
  window.setIgnoreMouseEvents(true);window.setMenu(null);window.webContents.setBackgroundThrottling(false);
  const hide=()=>this.hide(id),close=()=>this.dispose(id);
  const events=['blur','hide','minimize','move','resize'],emitter:EventEmitter=owner;
  for(const event of events)emitter.on(event,hide);owner.once('closed',close);
  const session:TooltipSession={owner,window,ready:false,data:null,remove:()=>{for(const event of events)emitter.removeListener(event,hide);owner.removeListener('closed',close);}};
  this.sessions.set(id,session);
  window.webContents.on('render-process-gone',()=>this.dispose(id));
  window.once('closed',()=>{if(this.sessions.get(id)===session){session.remove();this.sessions.delete(id);}});
 }
 ready(sender:number){for(const session of this.sessions.values())if(session.window.webContents.id===sender){session.ready=true;this.present(session);break;}}
 update(owner:BrowserWindow,data:NativeTooltipData|null){if(!data){this.hide(owner.webContents.id);return;}this.prepare(owner);const session=this.sessions.get(owner.webContents.id)!;session.data=data;this.present(session);}
 private present(session:TooltipSession){
  const {owner,window,data}=session;if(!session.ready||!data||window.isDestroyed()||owner.isDestroyed()||!owner.isVisible()||owner.isMinimized())return;
  const z=owner.webContents.getZoomFactor(),b=data.bounds,origin=owner.getContentBounds(),m=nativeTooltipMargin;
  window.webContents.setZoomFactor(z);window.setBounds({x:Math.round(origin.x+(b.x-m)*z),y:Math.round(origin.y+(b.y-m)*z),width:Math.ceil((b.width+2*m)*z),height:Math.ceil((b.height+2*m)*z)});
  window.webContents.send('one:native-tooltip',data);
 }
 painted(sender:number){for(const session of this.sessions.values())if(session.window.webContents.id===sender&&session.data&&!session.owner.isDestroyed()&&session.owner.isVisible()&&!session.owner.isMinimized()){session.window.showInactive();break;}}
 hide(owner:number){const session=this.sessions.get(owner);if(!session)return;session.data=null;if(!session.window.isDestroyed())session.window.hide();}
 dispose(owner:number){const session=this.sessions.get(owner);if(!session)return;this.sessions.delete(owner);session.remove();if(!session.window.isDestroyed())session.window.destroy();}
 stopAll(){for(const owner of this.sessions.keys())this.dispose(owner);}
}
