import {BrowserWindow,clipboard,screen,shell} from 'electron';
import {basename,dirname,join,extname} from 'node:path';
import {stat} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {copyShellItem,renameShellItem,openWithApplications,openInApplication} from './open-with';
import {renameDestinationName,type FileMenuTarget,type FileMenuAction} from '../shared/file-menu';
import type {OpenWithApp} from '../shared/preview';
import {PopupReadiness,deferPopupBlur} from './popup-lifecycle';
interface Callbacks{create(submenu:boolean):BrowserWindow;focus(window:BrowserWindow):void;active(owner:number,value:boolean):void;open(path:string):Promise<void>;preview(path:string):Promise<void>;system(path:string,owner:BrowserWindow,point:{x:number;y:number}):Promise<void>;changed():void}
export class FileContextMenu{
 private window?:BrowserWindow;private child?:BrowserWindow;private owner?:BrowserWindow;private target?:FileMenuTarget;
 private readiness=new WeakMap<BrowserWindow,PopupReadiness>();
 private point={x:0,y:0};private childTop=0;private childSession='';private childRevision=0;
 private applications=new Map<string,{time:number;items:OpenWithApp[]}>();private pendingApps=new Map<string,Promise<OpenWithApp[]>>();
 constructor(private callbacks:Callbacks){}
 warm(submenu=false){const existing=submenu?this.child:this.window;if(existing&&!existing.isDestroyed())return existing;const w=this.callbacks.create(submenu);this.readiness.set(w,new PopupReadiness(w));if(submenu)this.child=w;else this.window=w;
  let idleCleanup:NodeJS.Timeout|undefined;
  const clearIdle=()=>{clearTimeout(idleCleanup);idleCleanup=undefined;};
  const scheduleIdle=()=>{clearIdle();idleCleanup=setTimeout(()=>{if(!w.isDestroyed()&&!w.isVisible())w.destroy();},5000);idleCleanup.unref();};
  w.on('hide',scheduleIdle);w.on('show',clearIdle);
  w.on('blur',()=>{const session=this.target?.session;deferPopupBlur(w,()=>{if(session!==this.target?.session)return false;const focused=BrowserWindow.getFocusedWindow();return focused!==this.window&&focused!==this.child;},()=>this.hide(false),100);});
  w.on('closed',()=>{clearIdle();if(submenu){if(this.child===w){this.child=undefined;this.hideChild(false);}}else if(this.window===w){this.window=undefined;this.hide(false);}});scheduleIdle();return w;
 }
 show(owner:BrowserWindow,path:string,point:{x:number;y:number},directory=false,launchKind?:'app'|'setting',name=basename(path)){
  if(this.owner!==owner)this.hide(false);this.hideChild(false);this.owner=owner;const session=randomUUID();this.target={session,path,name,directory,launchKind};this.callbacks.active(owner.webContents.id,true);
  const b=owner.getContentBounds();this.point={x:b.x+point.x,y:b.y+point.y};const w=this.warm();const display=()=>{if(this.target?.session!==session||owner.isDestroyed()||w.isDestroyed())return;this.resize(session,launchKind?116:directory?344:374);w.webContents.send('one:file-menu',this.target);this.callbacks.focus(w);if(!directory&&!launchKind)setTimeout(()=>{if(this.target?.session===session&&!w.isDestroyed()&&w.isVisible())this.warm(true);},50).unref();};this.readiness.get(w)!.run(display);
 }
 data(sender?:number){return this.target?{...this.target,...(sender===this.child?.webContents.id?{submenu:'apps' as const}:{})}:null;}
 private require(session:string){if(!this.target||this.target.session!==session||!this.owner||this.owner.isDestroyed())throw new Error('菜单已关闭');return this.target;}
 resize(session:string,height:number,sender?:number){this.require(session);if(!Number.isFinite(height))throw new Error('菜单尺寸无效');const submenu=sender===this.child?.webContents.id&&sender!==undefined,w=this.warm(submenu),parent=this.window?.getBounds();
  const area=screen.getDisplayNearestPoint(submenu&&parent?{x:parent.x,y:parent.y}:this.point).workArea,h=Math.min(Math.max(40,Math.ceil(height)),area.height-16),width=240;
  let x=this.point.x,y=this.point.y;if(submenu&&parent){x=parent.x+parent.width-4;if(x+width>area.x+area.width-8)x=parent.x-width+4;y=this.childTop;}
  w.setBounds({x:Math.round(Math.max(area.x+8,Math.min(x,area.x+area.width-width-8))),y:Math.round(Math.max(area.y+8,Math.min(y,area.y+area.height-h-8))),width,height:h},false);
 }
 submenu(session:string,top:number,focus=false){const target=this.require(session);if(target.directory||target.launchKind)return;if(!Number.isFinite(top))throw new Error('子菜单位置无效');const parent=this.window!;
  if(this.child?.isVisible()&&this.childSession===session){if(focus)this.callbacks.focus(this.child);return;}
  const b=parent.getContentBounds();this.childTop=b.y+Math.max(0,Math.min(b.height,top));this.childSession=session;const revision=++this.childRevision,w=this.warm(true);
  const display=()=>{if(this.childRevision!==revision||this.target?.session!==session||parent.isDestroyed()||!parent.isVisible())return;this.resize(session,90,w.webContents.id);w.webContents.send('one:file-menu',{...target,submenu:'apps'});w.setAlwaysOnTop(true,'pop-up-menu');w.showInactive();w.moveTop();parent.webContents.send('one:file-menu-expanded',true);if(focus)this.callbacks.focus(w);};this.readiness.get(w)!.run(display);
 }
 hideChild(focus=false){this.childRevision++;this.childSession='';if(this.child&&!this.child.isDestroyed())this.child.hide();if(this.window&&!this.window.isDestroyed()){this.window.webContents.send('one:file-menu-expanded',false);if(focus&&this.window.isVisible())this.callbacks.focus(this.window);}}
 close(sender:number,focus=false,childOnly=false){if(sender===this.child?.webContents.id||childOnly)this.hideChild(focus);else this.hide(focus);}
 hide(focus=false){const owner=this.owner;this.owner=undefined;this.target=undefined;this.hideChild(false);if(this.window&&!this.window.isDestroyed())this.window.hide();if(owner&&!owner.isDestroyed()){this.callbacks.active(owner.webContents.id,false);if(focus&&owner.isVisible())this.callbacks.focus(owner);else if(!owner.isFocused())owner.hide();}}
 private finish(session:string,focus:boolean){if(this.target?.session===session)this.hide(focus);}
 async apps(session:string){const target=this.require(session);if(target.directory||target.launchKind)return [];const key=extname(target.path).toLowerCase(),cached=this.applications.get(key);if(cached&&Date.now()-cached.time<120000)return cached.items;const pending=this.pendingApps.get(key);if(pending)return pending;
  const task=openWithApplications(target.path).then(items=>{if(this.applications.size>=128)this.applications.delete(this.applications.keys().next().value!);this.applications.set(key,{time:Date.now(),items});return items;}).finally(()=>this.pendingApps.delete(key));this.pendingApps.set(key,task);return task;
 }
 async run(session:string,action:FileMenuAction,value?:string){const target=this.require(session),owner=this.owner!;if(!['open','preview','reveal','copy-path','copy-name','copy','cut','rename','trash','open-with','native'].includes(action))throw new Error('菜单操作无效');if(target.launchKind&&action!=='open'&&action!=='copy-name')throw new Error('此项目不支持该操作');
  if(action==='native'){const p=screen.dipToScreenPoint(this.point);this.finish(session,true);await this.callbacks.system(target.path,owner,p);return;}
  if(action==='open'){await this.callbacks.open(target.path);this.finish(session,false);return;}
  if(action==='preview'){await this.callbacks.preview(target.path);this.finish(session,false);return;}
  if(action==='reveal'){shell.showItemInFolder(target.path);this.finish(session,false);return;}
  if(action==='copy-path'||action==='copy-name'){clipboard.writeText(action==='copy-path'?target.path:target.name);this.finish(session,true);return;}
  await stat(target.path);
  if(action==='copy'||action==='cut')await copyShellItem(target.path,action==='cut');
  else if(action==='rename'){const name=renameDestinationName(value);if(name!==basename(target.path))await renameShellItem(target.path,join(dirname(target.path),name));this.callbacks.changed();}
  else if(action==='trash'){await shell.trashItem(target.path);this.callbacks.changed();}
  else if(action==='open-with'){await openInApplication(target.path,value||':choose');this.finish(session,false);return;}
  this.finish(session,true);
 }
}
