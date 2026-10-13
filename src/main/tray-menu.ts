export type TrayMenuAction='open'|'search'|'preview'|'disk'|'pins'|'pins-restore'|'pins-toggle'|'pins-next-group'|'pause'|'startup'|'restart'|'quit'|'materials'|'settings'|import('../shared/capture/shortcuts').CaptureSystemCommand;
export interface TrayMenuState {paused:boolean;launchAtLogin:boolean}
export interface TrayMenuEntry {id:TrayMenuAction;label:string;group:'primary'|'tools'|'system';icon:string;active?:boolean;tone?:'danger'}
export interface TrayMenuView {entries:TrayMenuEntry[];paused:boolean}

export function trayMenuEntries(state:TrayMenuState):TrayMenuEntry[]{
 return [
  {id:'open',label:'打开 One',group:'primary',icon:'home'},
  {id:'search',label:'文件搜索',group:'primary',icon:'search'},
  {id:'materials',label:'素材',group:'primary',icon:'materials'},
  {id:'capture-region',label:'区域截图',group:'tools',icon:'capture'},
  {id:'capture-copy',label:'截屏并自动复制',group:'tools',icon:'copy'},
  {id:'capture-custom',label:'自定义截屏',group:'tools',icon:'settings'},
  {id:'capture-screen',label:'显示器截图',group:'tools',icon:'monitor'},
  {id:'capture-clipboard',label:'编辑剪贴板图片',group:'tools',icon:'clipboard'},
  {id:'capture-recording',label:'录屏与录音',group:'tools',icon:'recording'},
  {id:'pins-clipboard',label:'贴出剪贴板',group:'tools',icon:'pin'},
  {id:'preview',label:'快速预览',group:'tools',icon:'preview'},
  {id:'disk',label:'空间分析',group:'tools',icon:'disk'},
  {id:'pins',label:'管理贴图',group:'tools',icon:'pin'},
  {id:'pins-restore',label:'恢复贴图交互',group:'tools',icon:'mouse'},
  {id:'pins-toggle',label:'隐藏 / 显示全部贴图',group:'tools',icon:'preview'},
  {id:'pins-next-group',label:'切换贴图分组',group:'tools',icon:'refresh'},
  {id:'pause',label:state.paused?'恢复操作增强':'暂停操作增强',group:'system',icon:state.paused?'play':'pause',active:state.paused},
  {id:'startup',label:'开机自启动',group:'system',icon:'power',active:state.launchAtLogin},
  {id:'settings',label:'One 设置',group:'system',icon:'settings'},
  {id:'restart',label:'重启 One',group:'system',icon:'refresh'},
  {id:'quit',label:'退出 One',group:'system',icon:'close',tone:'danger'}
 ];
}
