import {defaultThemeSchedule,evaluateThemeSchedule,validateThemeSchedule,type ScheduledTheme,type ThemeSchedulePreferences,type ThemeScheduleStatus} from '../shared/theme-schedule';

export interface ThemeScheduleDependencies {
 clock():Date;
 nightLight(signal:AbortSignal):Promise<boolean|undefined>;
 currentMode(signal:AbortSignal):ScheduledTheme|Promise<ScheduledTheme>;
 apply(mode:ScheduledTheme,targets:ThemeSchedulePreferences['targets'],signal:AbortSignal):Promise<void>;
 release?(signal:AbortSignal):Promise<void>;
 publish(value:ThemeScheduleStatus):void;
}
/** One serialized owner for automatic, manual and wake-up synchronization. */
export class ThemeScheduleService {
 private preferences=defaultThemeSchedule();
 private revision=0;
 private stopped=false;
 private pending?:Promise<void>;
 private dirty=false;
 private timer?:ReturnType<typeof setTimeout>;
 private cancellation=new AbortController();
 private override?:{mode:ScheduledTheme;token:string};
 private manualRequests:{mode:ScheduledTheme|'toggle';revision:number}[]=[];
 private applied?:{mode:ScheduledTheme;targets:string};
 private value:ThemeScheduleStatus={phase:'off',token:'off',detail:'自动切换已关闭',updated:0};
 constructor(private dependencies:ThemeScheduleDependencies){}
 state():ThemeScheduleStatus{return {...this.value,next:this.value.next?{...this.value.next}:undefined};}
 configure(value:unknown):Promise<void>{
  if(this.stopped)return Promise.reject(Error('自动主题服务已关闭'));
  const next=validateThemeSchedule(value);
  if(JSON.stringify(next)!==JSON.stringify(this.preferences)){
   const schedule=({targets,shortcut,...plan}:ThemeSchedulePreferences)=>JSON.stringify(plan);
   const planChanged=schedule(next)!==schedule(this.preferences)&&(next.enabled||this.preferences.enabled),targetsChanged=JSON.stringify(next.targets)!==JSON.stringify(this.preferences.targets);
   if(planChanged)this.override=undefined;
   this.preferences=next;this.revision++;this.manualRequests=[];if(planChanged||targetsChanged)this.applied=undefined;
  }
  return this.sync();
 }
 manual(mode:ScheduledTheme|'toggle'):Promise<void>{
  if(!['light','dark','toggle'].includes(mode))return Promise.reject(Error('主题切换请求无效'));
  if(this.stopped)return Promise.reject(Error('自动主题服务已关闭'));
  if(this.manualRequests.length>=32)return Promise.reject(Error('主题切换请求过于频繁，请稍后重试'));
  this.manualRequests.push({mode,revision:this.revision});return this.sync();
 }
 resumeSchedule():Promise<void>{this.override=undefined;this.manualRequests=[];this.applied=undefined;return this.sync();}
 sync():Promise<void>{
  if(this.stopped)return Promise.resolve();
  clearTimeout(this.timer);this.dirty=true;
  if(this.pending)return this.pending;
  const work=Promise.resolve().then(()=>this.drain());this.pending=work;
  return work.finally(()=>{this.pending=undefined;if(!this.stopped&&this.preferences.enabled){const until=this.value.next?.at;const wait=until===undefined?30000:Math.max(100,Math.min(30000,until-this.dependencies.clock().getTime()));this.timer=setTimeout(()=>void this.sync(),wait);this.timer.unref?.();}});
 }
 private async drain(){
  while(this.dirty&&!this.stopped){
   this.dirty=false;const revision=this.revision,p=this.preferences,signal=this.cancellation.signal;
   try{
    let night:boolean|undefined;
    if(p.enabled&&p.source==='night-light')try{night=await this.dependencies.nightLight(signal);}catch{if(this.stopped)return;}
    if(revision!==this.revision){this.dirty=true;continue;}
    if(this.stopped)return;
    let plan=evaluateThemeSchedule(p,this.dependencies.clock(),night);
    const request=this.manualRequests.shift();
    if(request&&request.revision===revision){
     const current=request.mode==='toggle'?await this.dependencies.currentMode(signal):undefined;
     if(this.stopped)return;
     if(revision!==this.revision){this.dirty=true;continue;}
     plan=evaluateThemeSchedule(p,this.dependencies.clock(),night);
     this.override={mode:request.mode==='toggle'?(current==='dark'?'light':'dark'):request.mode,token:plan.token};
    }
    if(this.manualRequests.length)this.dirty=true;
    if(this.override?.token==='night-light:unknown'&&plan.phase==='automatic')this.override.token=plan.token;
    if(this.override&&plan.phase!=='unavailable'&&this.override.token!==plan.token)this.override=undefined;
    const mode=this.override?.mode||plan.mode,targets=JSON.stringify(p.targets);
    if(mode&&(this.override||plan.phase!=='unavailable')&&(!this.applied||this.applied.mode!==mode||this.applied.targets!==targets)){
     await this.dependencies.apply(mode,{...p.targets},signal);
     if(this.stopped)return;
     if(revision!==this.revision){this.dirty=true;continue;}
     this.applied={mode,targets};
    }
    if(!mode&&plan.phase==='off')await this.dependencies.release?.(signal);
    if(this.stopped)return;
    if(revision!==this.revision){this.dirty=true;continue;}
    this.value={...plan,mode:this.override?.mode||plan.mode,phase:this.override?'manual':plan.phase,detail:this.override?(p.enabled?'手动主题持续到下一次计划切换':'已手动切换，自动切换处于关闭状态'):plan.detail,updated:this.dependencies.clock().getTime()};
    this.dependencies.publish(this.state());
   }catch(error){
    if(this.stopped)return;
    if(revision!==this.revision){this.dirty=true;continue;}
    this.value={phase:'error',token:'error',detail:error instanceof Error?error.message:'自动主题切换失败',updated:this.dependencies.clock().getTime()};
    this.dependencies.publish(this.state());
   }
  }
 }
 stop(){this.stopped=true;clearTimeout(this.timer);this.dirty=false;this.manualRequests=[];this.cancellation.abort();}
}
