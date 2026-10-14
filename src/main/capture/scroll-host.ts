import {screen,type BrowserWindow} from 'electron';
import {randomUUID} from 'node:crypto';
import {ScrollCaptureService,SCROLL_URL,type ScrollContext} from './scroll-service';
import {captureOptions,type CaptureOptions} from '../../shared/capture/api';
import type {Region} from '../../shared/capture/region';
type Context=Omit<ScrollContext,'blocked'> & {blocked():boolean;assertAvailable():void;preferredDisplay():number;cancelSelection():void};
/** One coordinates selection, output, confirmation and draining before other services stop. */
export class ScrollCaptureHost {
  readonly service:ScrollCaptureService;
  private tasks=new Set<Promise<unknown>>();
  private choosing=false;
  private preparing=false;
  private approved=false;
  private closing=false;
  private stopping?:Promise<void>;
  private confirmation?:{window:BrowserWindow;token:string;finish:(accepted:boolean)=>void};
  constructor(private context:Context){
    this.service=new ScrollCaptureService({...context,blocked:()=>this.closing||this.preparing||context.blocked(),choose:async(...args)=>{this.choosing=true;try{return await context.choose(...args);}finally{this.choosing=false;}}});
    context.register('scroll-close-answer',(event,token,accepted)=>{
      const pending=this.confirmation;
      if(!pending||event.sender!==pending.window.webContents||event.senderFrame!==event.sender.mainFrame||event.senderFrame.url!==SCROLL_URL||pending.token!==token||typeof accepted!=='boolean')throw Error('长截图退出确认已失效');
      pending.finish(accepted);
    });
  }
  open(displayId?:number,options?:CaptureOptions){
    if(this.closing||this.preparing||this.context.blocked())throw Error('长截图服务已关闭');
    this.context.assertAvailable();
    const id=displayId??this.context.preferredDisplay();if(!Number.isSafeInteger(id)||!screen.getAllDisplays().some(item=>item.id===id))throw Error('显示器已断开');
    const task=this.service.open(id,captureOptions(options).hideMainWindow);this.tasks.add(task);void task.then(()=>this.tasks.delete(task),()=>this.tasks.delete(task));return task;
  }
  get pendingTasks(){return this.tasks.size+this.service.pendingTasks;}
  openRegion(region:Region,windows:BrowserWindow[]=[]){
    if(this.closing||this.preparing||this.context.blocked())throw Error('长截图服务已关闭');this.context.assertAvailable();
    const task=this.service.open(region.displayId,true,region,true,windows);this.tasks.add(task);void task.then(()=>this.tasks.delete(task),()=>this.tasks.delete(task));return task;
  }
  get needsQuitPreparation(){return !this.approved&&(this.service.active||this.pendingTasks>0);}
  resetQuitApproval(){this.approved=false;this.preparing=false;}
  private confirm(window:BrowserWindow){
    return new Promise<boolean>(resolve=>{
      const token=randomUUID(),closed=()=>finish(false),finish=(accepted:boolean)=>{
        if(this.confirmation?.token!==token)return;this.confirmation=undefined;
        window.removeListener('closed',closed);window.webContents.removeListener('render-process-gone',closed);resolve(accepted);
      };
      this.confirmation={window,token,finish};window.once('closed',closed);window.webContents.once('render-process-gone',closed);
      if(window.isMinimized())window.restore();window.show();window.focus();window.webContents.send('one:scroll-close-request',token);
    });
  }
  async prepareQuit(){
    this.preparing=true;
    try{
      if(this.choosing)this.context.cancelSelection();
      await Promise.allSettled([...this.tasks]);await this.service.idle();
      this.approved=!this.service.hasUnsaved||!!this.service.window&&await this.confirm(this.service.window);
      if(!this.approved)this.preparing=false;
      return this.approved;
    }catch(error){this.resetQuitApproval();throw error;}
  }
  stop(){
    if(this.stopping)return this.stopping;
    this.closing=true;this.confirmation?.finish(false);if(this.choosing)this.context.cancelSelection();
    return this.stopping=(async()=>{await Promise.allSettled([...this.tasks]);await this.service.idle();this.service.cancel();await this.service.stopped();})();
  }
}
