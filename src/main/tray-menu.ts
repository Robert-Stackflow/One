export type TrayMenuAction='open'|'search'|'preview'|'disk'|'pause'|'startup'|'restart'|'quit';
export interface TrayMenuState {paused:boolean;launchAtLogin:boolean}
export interface TrayMenuEntry {id:TrayMenuAction;label:string;group:'primary'|'tools'|'system';icon:string;active?:boolean;tone?:'danger'}
export interface TrayMenuView {entries:TrayMenuEntry[];paused:boolean}

export function trayMenuEntries(state:TrayMenuState):TrayMenuEntry[]{
 return [
  {id:'open',label:'打开 One',group:'primary',icon:'home'},
  {id:'search',label:'文件搜索',group:'primary',icon:'search'},
  {id:'preview',label:'快速预览',group:'tools',icon:'preview'},
  {id:'disk',label:'空间分析',group:'tools',icon:'disk'},
  {id:'pause',label:state.paused?'恢复操作增强':'暂停操作增强',group:'system',icon:state.paused?'play':'pause',active:state.paused},
  {id:'startup',label:'开机自启动',group:'system',icon:'power',active:state.launchAtLogin},
  {id:'restart',label:'重启 One',group:'system',icon:'refresh'},
  {id:'quit',label:'退出 One',group:'system',icon:'close',tone:'danger'}
 ];
}
