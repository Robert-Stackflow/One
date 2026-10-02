export interface AwakeConfig { mode:'off'|'indefinite'|'timed'|'until'; display:boolean; expiresAt:number }
export interface TopmostConfig { enabled:boolean; shortcut:string; excludedApps:string; border:boolean; color:string; pauseFullscreen:boolean; opacity:number; thickness:number;sound:boolean;contextMenu:boolean }
export interface UtilitySettings { awake:AwakeConfig; topmost:TopmostConfig }
export interface AwakeState extends AwakeConfig { active:boolean; locked:boolean; remaining:number; error:string }
export interface WindowEntry { id:number; pid:number; title:string; process:string; managed:boolean; topmost:boolean }
export interface UtilityState { awake:AwakeState; pinned:number; shortcutError:string }
export const defaultUtilities=():UtilitySettings=>({awake:{mode:'off',display:false,expiresAt:0},topmost:{enabled:false,shortcut:'Ctrl+Alt+T',excludedApps:'',border:true,color:'#4c8bf5',pauseFullscreen:true,opacity:80,thickness:3,sound:false,contextMenu:false}});
export function validateUtilities(value:unknown):UtilitySettings {
  if(value===undefined)return defaultUtilities();if(!value||typeof value!=='object')throw new Error('桌面工具设置无效');
  const v=value as UtilitySettings,a=v.awake,t=v.topmost;
  if(!a||!['off','indefinite','timed','until'].includes(a.mode)||typeof a.display!=='boolean'||!Number.isSafeInteger(a.expiresAt)||a.expiresAt<0)throw new Error('唤醒设置无效');
  if(['timed','until'].includes(a.mode)&&a.expiresAt===0)throw new Error('请选择唤醒结束时间');
  if(!t||typeof t.enabled!=='boolean'||typeof t.border!=='boolean'||typeof t.pauseFullscreen!=='boolean'||!/^#[a-f\d]{6}$/i.test(t.color)||typeof t.excludedApps!=='string'||t.excludedApps.length>2000||typeof t.shortcut!=='string'||t.shortcut.length>100||t.shortcut&&!/^(?:(?:Control|Ctrl|Alt|Shift|Super|Meta|Win)\+)+(?:[A-Z0-9]|F(?:[1-9]|1\d|2[0-4]))$/i.test(t.shortcut))throw new Error('置顶设置无效');
  const merged={...defaultUtilities().topmost,...t};if(!Number.isInteger(merged.opacity)||merged.opacity<0||merged.opacity>100||!Number.isInteger(merged.thickness)||merged.thickness<1||merged.thickness>20||typeof merged.sound!=='boolean'||typeof merged.contextMenu!=='boolean')throw new Error('置顶提示设置无效');
  return {awake:{...a},topmost:merged};
}
export function awakeEffective(config:AwakeConfig,locked:boolean,now=Date.now()){
  const expired=['timed','until'].includes(config.mode)&&config.expiresAt<=now;
  return {active:config.mode!=='off'&&!expired&&!locked,expired,remaining:['timed','until'].includes(config.mode)?Math.max(0,config.expiresAt-now):0};
}
