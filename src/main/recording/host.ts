import type {BrowserWindow} from 'electron';
import {RecordingService,type RecordingContext} from './service';

type Context=Omit<RecordingContext,'background'|'availabilityChanged'> & {mainWindow():BrowserWindow|undefined};
const completionChannels=new Set(['recording-state','recording-started','recording-chunk','recording-heartbeat','recording-paused','recording-finish','recording-fail','recording-native-stop','recording-native-gain','recording-microphones-end','recording-start-availability']);
const playerReads=new Set(['state','input-events','annotation-events','camera-layouts','cursor-events','cursor-shapes','cancel-export']);

/** Coordinate One's quit decision without blocking the recorder's final media writes. */
export class RecordingHost {
  readonly service:RecordingService;
  readonly initialized:Promise<void>;
  private tasks=new Set<Promise<unknown>>();
  private pageActive=false;
  private preparing=false;
  private approved=false;
  private discard=false;
  private stopping?:Promise<void>;
  private preparation?:Promise<boolean>;
  private throttled?:boolean;
  constructor(private context:Context,create=(ctx:RecordingContext)=>new RecordingService(ctx)){
    const guard=(name:string,args:unknown[],main:boolean)=>{
      if(!this.preparing&&!this.approved)return;
      if(main&&(completionChannels.has(name)||name==='recording-page-active'&&args[0]===false||name==='recording-camera-setup'&&!args[0]||name==='recording-audio-test'&&args[1]===false||name==='recording-cancel-import'))return;
      if(!main&&(!name.startsWith('recording-player-')||playerReads.has(name.slice('recording-player-'.length))))return;
      throw Error('正在准备退出，请先完成保存或取消退出');
    };
    this.service=create({...context,
      register:(name,handler)=>context.register(name,(event,...args)=>{
        guard(name,args,true);
        return this.track(Promise.resolve().then(()=>handler(event,...args)).then(value=>{
          if(name==='recording-page-active')this.pageActive=args[0]===true;
          return value;
        }));
      }),
      windowHost:{...context.windowHost,register:(name,handler,roles)=>context.windowHost.register(name,(event,...args)=>{
        guard(name,args,false);return this.track(Promise.resolve().then(()=>handler(event,...args)));
      },roles)},
      background:task=>this.track(task),availabilityChanged:()=>this.syncThrottling(),
    });
    this.initialized=this.service.init();
  }
  private track<T>(task:Promise<T>){this.tasks.add(task);void task.then(()=>this.tasks.delete(task),()=>this.tasks.delete(task));return task;}
  private syncThrottling(){const window=this.context.mainWindow(),next=!this.service?.active;if(window&&!window.isDestroyed()&&!window.webContents.isDestroyed()&&this.throttled!==next){window.webContents.setBackgroundThrottling(next);this.throttled=next;}}
  bindClient(window:BrowserWindow){this.service.bindClient(window);this.throttled=undefined;this.syncThrottling();}
  private action<T>(run:()=>Promise<T>){if(this.preparing||this.approved||this.context.blocked())throw Error('One 正在退出');return this.track(this.initialized.then(()=>this.context.materialsReady?.()).then(()=>{if(this.preparing||this.approved||this.context.blocked())throw Error('One 正在退出');return run();}));}
  importMaterial(kind:'project'|'video'){return this.action(()=>this.service.importMaterial(kind));}
  openMaterial(id:string){return this.action(()=>this.service.openMaterial(id));}
  removeMaterial(id:string){return this.action(()=>this.service.removeMaterial(id));}
  get pendingTasks(){return this.tasks.size;}
  get needsQuitPreparation(){return !this.approved&&(this.service.hasUnsaved||this.service.state().export?.busy||this.pendingTasks>0);}
  resetQuitApproval(){
    this.approved=false;this.discard=false;this.preparing=false;
    return this.service.pageActive(this.pageActive);
  }
  prepareQuit(){
    if(this.preparation)return this.preparation;
    this.preparing=true;
    const task=(async()=>{
      try{
        await this.initialized;await this.service.finishCapture();
        // A quality preview is an outstanding renderer request until encoding completes.
        // Ask before cancelling it; do not hold the quit dialog behind that request.
        if(!this.service.state().export?.busy)await Promise.allSettled([...this.tasks]);
        const unsaved=this.service.hasUnsaved,exporting=this.service.state().export?.busy;
        if(unsaved||exporting){
          const owner=this.context.mainWindow();if(!owner||owner.isDestroyed())throw Error('录制主窗口已关闭，请先恢复并保存录制');
          const answer=await this.context.confirm(owner,{type:'question',title:'退出 One',message:unsaved?'保存录制后退出？':'停止导出并退出？',
            detail:unsaved?'录制已停止。保存工程可保留原片、独立轨道和编辑内容。'+(exporting?'退出将停止当前导出。':''):'当前导出尚未完成，停止后可以重新导出。',
            buttons:unsaved?['保存工程并退出','放弃并退出','取消']:['停止导出并退出','取消'],defaultId:0,cancelId:unsaved?2:1,noLink:true});
          if(answer.response===(unsaved?2:1)){await this.resetQuitApproval();return false;}
          await this.service.cancelExport();
          await Promise.allSettled([...this.tasks]);
          if(unsaved&&answer.response===0){if(!await this.service.saveCurrentProject()||this.service.hasUnsaved){await this.resetQuitApproval();return false;}}
          this.discard=unsaved&&answer.response===1;
        }
        this.approved=true;return true;
      }catch(error){await this.resetQuitApproval();throw error;}
    })();
    this.preparation=task;
    void task.finally(()=>{if(this.preparation===task)this.preparation=undefined;}).catch(()=>{});
    return task;
  }
  stop(){
    if(this.stopping)return this.stopping;
    const task=(async()=>{await this.initialized;await this.service.dispose(this.discard);await Promise.allSettled([...this.tasks]);this.syncThrottling();})();
    this.stopping=task;void task.catch(()=>{if(this.stopping===task)this.stopping=undefined;});return task;
  }
}
