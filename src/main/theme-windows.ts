import {execFile} from 'node:child_process';
import {join} from 'node:path';
import {promisify} from 'node:util';
import type {ScheduledTheme} from '../shared/theme-schedule';
import {parseNightLight} from './night-light';
const run=promisify(execFile);
export interface WindowsThemeState {apps?:ScheduledTheme;system?:ScheduledTheme;nightLight?:boolean;detail:string}
export class WindowsThemeBridge {
 constructor(private helper=join(__dirname,'../native/One.Theme.exe').replace('app.asar\\','app.asar.unpacked\\'),private extra:string[]=[]){ }
 private async invoke(args:string[],signal:AbortSignal){
  signal.throwIfAborted();
  try{const result=await run(this.helper,[...args,...this.extra],{windowsHide:true,timeout:8000,maxBuffer:192*1024,encoding:'utf8',signal});return JSON.parse(result.stdout);}
  catch{signal.throwIfAborted();throw Error('Windows 主题服务暂时不可用，请重试');}
 }
 async read(signal:AbortSignal):Promise<WindowsThemeState>{
  const result=await this.invoke(['read'],signal);
  const night=typeof result.nightData==='string'&&result.nightError===0&&/^(?:[0-9a-f]{2}){4,65536}$/.test(result.nightData)?parseNightLight(Buffer.from(result.nightData,'hex')):{detail:'暂时无法读取 Windows 夜间模式；请在 Windows 设置中配置后重试'};
  return {apps:['light','dark'].includes(result.apps)?result.apps:undefined,system:['light','dark'].includes(result.system)?result.system:undefined,nightLight:night.active,detail:night.detail};
 }
 async apply(mode:ScheduledTheme,targets:{windowsApps:boolean;windowsSystem:boolean},signal:AbortSignal){
  if(!['light','dark'].includes(mode)||typeof targets.windowsApps!=='boolean'||typeof targets.windowsSystem!=='boolean')throw Error('Windows 主题请求无效');
  if(!targets.windowsApps&&!targets.windowsSystem)return;
  const scope=targets.windowsApps&&targets.windowsSystem?'both':targets.windowsApps?'apps':'system';
  const result=await this.invoke(['apply',mode,scope],signal),errors:string[]=[];
  if(targets.windowsApps&&result.appsError!==0)errors.push('Windows 应用主题');
  if(targets.windowsSystem&&result.systemError!==0)errors.push('Windows 系统界面');
  if(errors.length)throw Error(`${errors.join('、')}未能应用；其他已选择范围可能已切换，请检查权限后重试`);
  if(result.notifyError!==0)throw Error('Windows 主题值已更新，但窗口刷新未完成，请稍后重试');
 }
}
