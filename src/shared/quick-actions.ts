export interface QuickActions {volume:boolean;copy:boolean;paste:boolean;move:boolean;naturalScroll:boolean;volumeStep:number}
export const defaultQuickActions=():QuickActions=>({volume:false,copy:false,paste:false,move:false,naturalScroll:false,volumeStep:2});
export function validateQuickActions(value:unknown):QuickActions{
 const d=defaultQuickActions();if(value===undefined)return d;
 if(!value||typeof value!=='object')throw new Error('快捷操作设置无效');
 const v=value as QuickActions;for(const k of ['volume','copy','paste','move','naturalScroll'] as const){if(typeof v[k]!=='boolean')throw new Error('快捷操作开关无效');d[k]=v[k];}
 if(!Number.isInteger(v.volumeStep)||v.volumeStep<1||v.volumeStep>20)throw new Error('音量步长超出范围');d.volumeStep=v.volumeStep;return d;
}
export interface CapsPreferences {persistent:boolean;autoOff:boolean;seconds:number}
export const defaultCapsPreferences=():CapsPreferences=>({persistent:false,autoOff:false,seconds:30});
export function validateCapsPreferences(value:unknown):CapsPreferences{
 if(value===undefined)return defaultCapsPreferences();const v=value as CapsPreferences;
 if(!v||typeof v.persistent!=='boolean'||typeof v.autoOff!=='boolean'||!Number.isInteger(v.seconds)||v.seconds<1||v.seconds>3600)throw new Error('大写锁定设置无效');return {persistent:v.persistent,autoOff:v.autoOff,seconds:v.seconds};
}
/** An unrelated settings save must not restart the Caps Lock deadline. */
export class CapsDeadline {
 private active=false;private since=0;private automatic=false;private seconds=30;
 update(active:boolean,prefs:CapsPreferences,now:number){
  if(active&&(!this.active||prefs.autoOff&&!this.automatic))this.since=now;
  this.active=active;this.automatic=prefs.autoOff;this.seconds=prefs.seconds;
  return active&&prefs.autoOff&&now-this.since>=this.seconds*1000;
 }
 reset(){this.active=false;this.since=0;this.automatic=false;}
}
