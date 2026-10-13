export type TrayMenuAction='open'|'search'|'preview'|'disk'|'pins'|'pins-restore'|'pins-toggle'|'pins-next-group'|'pause'|'startup'|'restart'|'quit'|'materials'|'settings'|'more'|import('../shared/capture/shortcuts').CaptureSystemCommand;
export interface TrayShortcut {key:string;active:boolean;error?:string}
export interface TrayMenuState {paused:boolean;launchAtLogin:boolean;shortcuts?:Partial<Record<TrayMenuAction,TrayShortcut>>}
export interface TrayMenuEntry {id:TrayMenuAction;label:string;group:'primary'|'capture'|'pins'|'tools'|'system';icon:string;active?:boolean;tone?:'danger';shortcut?:TrayShortcut}
export interface TrayMenuView {entries:TrayMenuEntry[];moreEntries:TrayMenuEntry[];paused:boolean;submenu?:boolean;headerAction?:TrayMenuEntry}
export const trayMenuGroupLabels={primary:'常用',capture:'截图',pins:'素材与贴图',tools:'工具',system:'One'};
const shortcuts=(entries:TrayMenuEntry[],state:TrayMenuState)=>entries.map(entry=>({...entry,...(state.shortcuts?.[entry.id]?.key?{shortcut:state.shortcuts[entry.id]}:{})}));

export function trayMenuEntries(state:TrayMenuState):TrayMenuEntry[]{
 return shortcuts([
  {id:'open',label:'打开 One',group:'primary',icon:'home'},
  {id:'search',label:'文件搜索',group:'primary',icon:'search'},
  {id:'capture-region',label:'区域截图',group:'tools',icon:'capture'},
  {id:'capture-recording',label:'打开录制',group:'tools',icon:'recording'},
  {id:'pins-clipboard',label:'贴出剪贴板',group:'tools',icon:'pin'},
  {id:'more',label:'更多操作',group:'tools',icon:'ellipsis'},
  {id:'settings',label:'设置',group:'system',icon:'settings'},
  {id:'startup',label:'开机自启动',group:'system',icon:'power',active:state.launchAtLogin},
  {id:'restart',label:'重启 One',group:'system',icon:'refresh'},
  {id:'quit',label:'退出 One',group:'system',icon:'close',tone:'danger'}
 ],state);
}
export function trayMenuMoreEntries(state:TrayMenuState):TrayMenuEntry[]{
 return shortcuts([
  {id:'capture-copy',label:'截屏并自动复制',group:'capture',icon:'copy'},
  {id:'capture-custom',label:'自定义截屏',group:'capture',icon:'settings'},
  {id:'capture-screen',label:'显示器截图',group:'capture',icon:'monitor'},
  {id:'capture-clipboard',label:'编辑剪贴板图片',group:'capture',icon:'clipboard'},
  {id:'materials',label:'素材',group:'pins',icon:'materials'},
  {id:'pins',label:'管理贴图',group:'pins',icon:'pin'},
  {id:'pins-restore',label:'恢复贴图交互',group:'pins',icon:'mouse'},
  {id:'pins-toggle',label:'隐藏 / 显示全部贴图',group:'pins',icon:'preview'},
  {id:'pins-next-group',label:'切换贴图分组',group:'pins',icon:'refresh'},
  {id:'preview',label:'快速预览',group:'tools',icon:'preview'},
  {id:'disk',label:'空间分析',group:'tools',icon:'disk'},
 ],state);
}

export function trayMenuHeaderAction(state:TrayMenuState):TrayMenuEntry{return {id:'pause',label:state.paused?'恢复操作增强':'暂停操作增强',group:'system',icon:state.paused?'play':'pause',active:state.paused};}
