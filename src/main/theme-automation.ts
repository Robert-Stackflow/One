import type {Appearance} from '../shared/types';
import {defaultThemeSchedule,validateThemeSchedule,type ScheduledTheme,type ThemeSchedulePreferences,type ThemeAutomationStatus,type ThemeScheduleStatus} from '../shared/theme-schedule';
import {ThemeScheduleService} from './theme-schedule-service';
import {WindowsThemeBridge} from './theme-windows';

export interface ThemeAutomationDependencies {
 appearance():Appearance;
 systemDark():boolean;
 changedAppearance():void;
 publish(status:ThemeAutomationStatus):void;
 register(shortcut:string,callback:()=>void):boolean;
 unregister(shortcut:string):void;
 clock?():Date;
 windows?:Pick<WindowsThemeBridge,'read'|'apply'>;
}
/** Owns temporary One appearance separately from the user's persisted appearance. */
export class ThemeAutomation {
 private preferences=defaultThemeSchedule();
 private forcedOne?:ScheduledTheme;
 private shortcut='';
 private shortcutError='';
 private nightDetail='';
 private stopped=false;
 private service:ThemeScheduleService;
 constructor(private dependencies:ThemeAutomationDependencies){
  const windows=dependencies.windows||new WindowsThemeBridge();
  this.service=new ThemeScheduleService({
   clock:dependencies.clock||(()=>new Date()),
   nightLight:async signal=>{const state=await windows.read(signal);this.nightDetail=state.detail;return state.nightLight;},
   currentMode:async signal=>{
    const targets=this.preferences.targets;
    if(targets.one){const mode=this.appearance().mode;return mode==='system'?(dependencies.systemDark()?'dark':'light'):mode;}
    const state=await windows.read(signal),mode=targets.windowsApps?state.apps:state.system;
    if(!mode)throw Error('无法读取当前 Windows 主题，请选择深色或浅色后重试');
    return mode;
   },
   apply:async(mode,targets,signal)=>{
    this.setOne(targets.one?mode:undefined);
    if(targets.windowsApps||targets.windowsSystem)await windows.apply(mode,targets,signal);
   },
   release:async()=>this.setOne(undefined),
   publish:()=>this.publish()
  });
 }
 private setOne(mode:ScheduledTheme|undefined){if(this.forcedOne!==mode){this.forcedOne=mode;this.dependencies.changedAppearance();}}
 appearance():Appearance{const baseline=this.dependencies.appearance();return {...baseline,...(this.forcedOne?{mode:this.forcedOne}:{})};}
 state():ThemeAutomationStatus{
  const value:ThemeScheduleStatus=this.service.state();
  if(value.phase==='unavailable'&&this.preferences.source==='night-light'&&this.nightDetail)value.detail=this.nightDetail;
  return {...value,preferences:validateThemeSchedule(this.preferences),shortcutActive:!!this.shortcut,shortcutError:this.shortcutError};
 }
 private publish(){if(!this.stopped)this.dependencies.publish(this.state());}
 configure(value:unknown){this.preferences=validateThemeSchedule(value);if(!this.preferences.targets.one)this.setOne(undefined);return this.service.configure(this.preferences);}
 manual(mode:ScheduledTheme|'toggle'){return this.service.manual(mode).then(()=>this.state());}
 resume(){return this.service.resumeSchedule().then(()=>this.state());}
 sync(){return this.service.sync().then(()=>this.state());}
 registerShortcut(value:string){
  const normalized=value.replace(/\bCtrl\b/gi,'Control').replace(/\b(Win|Meta)\b/gi,'Super');
  if(normalized===this.shortcut&&!this.shortcutError)return;
  this.pauseShortcut();
  try{
   if(value){const accelerator=normalized;
    if(!this.dependencies.register(accelerator,()=>{void this.manual('toggle').catch(()=>{});}))throw Error('主题切换快捷键已被占用，请更换组合键');
    this.shortcut=accelerator;
   }
   this.shortcutError='';
  }catch(error){this.shortcutError=error instanceof Error?error.message:'主题快捷键注册失败';throw error;}
  finally{this.publish();}
 }
 pauseShortcut(){if(this.shortcut)this.dependencies.unregister(this.shortcut);this.shortcut='';}
 stop(){this.stopped=true;this.pauseShortcut();this.service.stop();}
}
