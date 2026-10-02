import koffi from 'koffi';
import {globalShortcut} from 'electron';
import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {join} from 'node:path';
import {foreground} from './native';
import {defaultUtilities,type TopmostConfig,type WindowEntry} from '../shared/utilities';
const user=koffi.load('user32.dll'),kernel=koffi.load('kernel32.dll'),dwm=koffi.load('dwmapi.dll');
const callback=koffi.proto('bool __stdcall OneEnumWindow(uintptr_t hwnd,intptr_t value)');
const enumerate=user.func('bool __stdcall EnumWindows(OneEnumWindow *callback,intptr_t value)'),visible=user.func('bool __stdcall IsWindowVisible(uintptr_t hwnd)'),valid=user.func('bool __stdcall IsWindow(uintptr_t hwnd)'),text=user.func('int __stdcall GetWindowTextW(uintptr_t hwnd,void *text,int count)'),pid=user.func('uint32 __stdcall GetWindowThreadProcessId(uintptr_t hwnd,_Out_ uint32 *pid)'),style=user.func('intptr_t __stdcall GetWindowLongPtrW(uintptr_t hwnd,int index)'),position=user.func('bool __stdcall SetWindowPos(uintptr_t hwnd,intptr_t after,int x,int y,int cx,int cy,uint32 flags)');
const open=kernel.func('uintptr_t __stdcall OpenProcess(uint32 access,bool inherit,uint32 pid)'),close=kernel.func('bool __stdcall CloseHandle(uintptr_t handle)'),image=kernel.func('bool __stdcall QueryFullProcessImageNameW(uintptr_t process,uint32 flags,void *text,_Inout_ uint32 *count)'),times=kernel.func('bool __stdcall GetProcessTimes(uintptr_t process,void *created,void *exit,void *kernel,void *user)');
const getBorder=dwm.func('int32 __stdcall DwmGetWindowAttribute(uintptr_t hwnd,uint32 attribute,void *value,uint32 size)'),setBorder=dwm.func('int32 __stdcall DwmSetWindowAttribute(uintptr_t hwnd,uint32 attribute,const void *value,uint32 size)');
interface Identity {pid:number;created:string;process:string;title:string}
function identity(hwnd:number):Identity|null {
  if(!valid(hwnd))return null;const p=[0];pid(hwnd,p);const handle=open(0x1000,false,p[0]);if(!handle)return null;
  try {const created=Buffer.alloc(8),scratch=Buffer.alloc(8),name=Buffer.alloc(65536),count=[32768],title=Buffer.alloc(4096);if(!times(handle,created,scratch,scratch,scratch)||!image(handle,0,name,count))return null;text(hwnd,title,2048);return {pid:p[0],created:created.toString('hex'),process:name.toString('utf16le',0,count[0]*2),title:title.toString('utf16le').replace(/\0.*$/s,'')};}finally{close(handle);}
}
export class TopmostService {
  private config=defaultUtilities().topmost;
  private pinned=new Map<number,Identity>();
  private helper?:ChildProcessWithoutNullStreams;
  private hotkey='';private recording=false;error='';private timer:NodeJS.Timeout;
  constructor(private changed:()=>void,private notify:(text:string)=>void){this.timer=setInterval(()=>this.prune(),250);this.timer.unref();}
  private send(message:string){if(!this.helper){const child=spawn(join(__dirname,'../native/One.Windows.exe').replace('app.asar\\','app.asar.unpacked\\'),[],{windowsHide:true,stdio:'pipe'});this.helper=child;let buffer='';child.stdout.setEncoding('utf8');child.stdout.on('data',part=>{buffer+=part;let at;while((at=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,at);buffer=buffer.slice(at+1);try{const v=JSON.parse(line);if(v.toggle){try{this.toggle(v.toggle);}catch(e){this.notify((e as Error).message);}}if(v.unpin&&this.pinned.delete(v.unpin))this.changed();}catch{}}});child.stderr.resume();child.stdin.on('error',()=>{});child.on('error',e=>{this.error=e.message;this.changed();});child.on('exit',()=>{if(this.helper===child)this.helper=undefined;});}this.helper.stdin.write(message+'\n');}
  private sync(){if(!this.config.enabled&&!this.helper)return;const c=this.config;this.send(`config ${+c.enabled} ${+c.border} ${parseInt(c.color.slice(1),16)} ${c.opacity} ${c.thickness} ${+c.contextMenu}`);}
  private same(hwnd:number,item:Identity){const now=identity(hwnd);return !!now&&now.pid===item.pid&&now.created===item.created;}
  private prune(){let changed=false;for(const [hwnd,item] of this.pinned)if(!this.same(hwnd,item)||!(Number(style(hwnd,-20))&8)){this.pinned.delete(hwnd);this.send(`unpin ${hwnd}`);changed=true;}if(changed)this.changed();}
  private restore(hwnd:number,item:Identity){if(this.same(hwnd,item)&&!position(hwnd,-2,0,0,0,0,0x13))throw new Error('无法取消此窗口置顶');this.send(`unpin ${hwnd}`);}
  update(config:TopmostConfig){const hotkeyChanged=config.enabled!==this.config.enabled||config.shortcut!==this.config.shortcut;this.config={...config};if(!config.enabled)this.clear();this.sync();if(hotkeyChanged)this.register();this.changed();}
  private register(){if(this.hotkey)globalShortcut.unregister(this.hotkey);this.hotkey='';this.error='';if(!this.config.enabled||this.recording||!this.config.shortcut)return;const name=this.config.shortcut.replace(/\bCtrl\b/gi,'Control').replace(/\b(Win|Meta)\b/gi,'Super');if(!globalShortcut.register(name,()=>{const target=foreground();if(!target||this.config.pauseFullscreen&&target.fullscreen)return;try{this.toggle(target.hwnd);this.notify(this.pinned.has(target.hwnd)?'窗口已置顶':'已取消置顶');}catch(error){this.notify((error as Error).message);}})){this.error='置顶快捷键已被占用，请重新录入';return;}this.hotkey=name;}
  record(active:boolean){this.recording=active;this.register();}
  list():WindowEntry[]{this.prune();const result:WindowEntry[]=[];enumerate((hwnd:number)=>{const cloaked=Buffer.alloc(4);getBorder(hwnd,14,cloaked,4);if(!visible(hwnd)||cloaked.readUInt32LE()||Number(style(hwnd,-20))&0x80)return true;const item=identity(hwnd);if(item?.title)result.push({id:hwnd,pid:item.pid,title:item.title,process:item.process,managed:this.pinned.has(hwnd),topmost:!!(Number(style(hwnd,-20))&8)});return true;},0);return result;}
  toggle(hwnd:number){if(!Number.isSafeInteger(hwnd)||hwnd<=0)throw new Error('窗口无效');const previous=this.pinned.get(hwnd);if(previous){this.restore(hwnd,previous);this.pinned.delete(hwnd);this.beep(false);this.changed();return;}
    if(!this.config.enabled)throw new Error('请先开启始终置顶');const item=identity(hwnd);if(!item||!visible(hwnd)||!item.title)throw new Error('此窗口已关闭或不可访问');
    if(this.config.excludedApps.split(/[,;\n]/).map(x=>x.trim().toLowerCase()).filter(Boolean).some(x=>item.process.split('\\').pop()!.toLowerCase().includes(x)))throw new Error('此应用已被排除');
    if(Number(style(hwnd,-20))&8)throw new Error('此窗口已由其他功能置顶');if(!position(hwnd,-1,0,0,0,0,0x13))throw new Error('无法置顶此窗口，可能需要与目标相同的权限');this.pinned.set(hwnd,item);this.sync();this.send(`pin ${hwnd} ${item.pid}`);this.beep(true);this.changed();
  }
  private beep(pinned:boolean){if(this.config.sound)user.func('bool __stdcall MessageBeep(uint32 type)')(pinned?0x40:0);}
  clear(){for(const [hwnd,item] of this.pinned){try{this.restore(hwnd,item);this.pinned.delete(hwnd);}catch{}}this.error=this.pinned.size?`${this.pinned.size} 个窗口未能取消置顶，请检查权限后重试`:'';this.changed();}
  count(){return this.pinned.size;}
  stop(){clearInterval(this.timer);if(this.hotkey)globalShortcut.unregister(this.hotkey);this.clear();this.helper?.stdin.end('stop\n');}
}
