export interface AwakeConfig { mode:'off'|'indefinite'|'timed'|'until'; display:boolean; expiresAt:number }
export interface TopmostConfig { enabled:boolean; shortcut:string; excludedApps:string; border:boolean; color:string; pauseFullscreen:boolean; opacity:number; thickness:number;sound:boolean;contextMenu:boolean }
export interface ClickerConfig { enabled:boolean; button:'left'|'right'|'middle'; double:boolean; method:'mouseEvent'|'sendInput'; intervalMs:number; repeat:number; target:'cursor'|'fixed'; x:number; y:number; restore:boolean; shortcut:string }
export interface UtilitySettings { awake:AwakeConfig; topmost:TopmostConfig; clicker:ClickerConfig }
export interface AwakeState extends AwakeConfig { active:boolean; locked:boolean; remaining:number; error:string }
export interface WindowEntry { id:number; pid:number; title:string; process:string; managed:boolean; topmost:boolean }
export interface ClickerState { running:boolean; clicks:number; remaining:number; error:string }
export interface UtilityState { awake:AwakeState; pinned:number; shortcutError:string; clicker:ClickerState }
export const defaultUtilities=():UtilitySettings=>({awake:{mode:'off',display:false,expiresAt:0},topmost:{enabled:false,shortcut:'Ctrl+Alt+T',excludedApps:'',border:true,color:'#4c8bf5',pauseFullscreen:true,opacity:80,thickness:3,sound:false,contextMenu:false},clicker:{enabled:false,button:'left',double:false,method:'mouseEvent',intervalMs:500,repeat:0,target:'cursor',x:0,y:0,restore:false,shortcut:'F6'}});
export function validateUtilities(value:unknown):UtilitySettings {
  if(value===undefined)return defaultUtilities();if(!value||typeof value!=='object')throw new Error('桌面工具设置无效');
  const v=value as UtilitySettings,a=v.awake,t=v.topmost,c={...defaultUtilities().clicker,...v.clicker};
  if(!a||!['off','indefinite','timed','until'].includes(a.mode)||typeof a.display!=='boolean'||!Number.isSafeInteger(a.expiresAt)||a.expiresAt<0)throw new Error('唤醒设置无效');
  if(['timed','until'].includes(a.mode)&&a.expiresAt===0)throw new Error('请选择唤醒结束时间');
  if(!t||typeof t.enabled!=='boolean'||typeof t.border!=='boolean'||typeof t.pauseFullscreen!=='boolean'||!/^#[a-f\d]{6}$/i.test(t.color)||typeof t.excludedApps!=='string'||t.excludedApps.length>2000||typeof t.shortcut!=='string'||t.shortcut.length>100||t.shortcut&&!/^(?:(?:Control|Ctrl|Alt|Shift|Super|Meta|Win)\+)+(?:[A-Z0-9]|F(?:[1-9]|1\d|2[0-4]))$/i.test(t.shortcut))throw new Error('置顶设置无效');
  const merged={...defaultUtilities().topmost,...t};if(!Number.isInteger(merged.opacity)||merged.opacity<0||merged.opacity>100||!Number.isInteger(merged.thickness)||merged.thickness<1||merged.thickness>20||typeof merged.sound!=='boolean'||typeof merged.contextMenu!=='boolean')throw new Error('置顶提示设置无效');
  if(typeof c.enabled!=='boolean'||!['left','right','middle'].includes(c.button)||typeof c.double!=='boolean'||!['mouseEvent','sendInput'].includes(c.method)||!Number.isInteger(c.intervalMs)||c.intervalMs<10||c.intervalMs>3600000||!Number.isInteger(c.repeat)||c.repeat<0||c.repeat>1000000||!['cursor','fixed'].includes(c.target)||!Number.isInteger(c.x)||!Number.isInteger(c.y)||Math.abs(c.x)>100000||Math.abs(c.y)>100000||typeof c.restore!=='boolean'||typeof c.shortcut!=='string'||!/^((?:Ctrl|Control|Alt|Shift|Win|Meta)\+)*(?:[A-Z0-9]|F(?:[1-9]|1\d|2[0-4]))$/i.test(c.shortcut))throw new Error('鼠标连点设置无效');
  return {awake:{...a},topmost:merged,clicker:c};
}
export function awakeEffective(config:AwakeConfig,locked:boolean,now=Date.now()){
  const expired=['timed','until'].includes(config.mode)&&config.expiresAt<=now;
  return {active:config.mode!=='off'&&!expired&&!locked,expired,remaining:['timed','until'].includes(config.mode)?Math.max(0,config.expiresAt-now):0};
}
