import koffi from 'koffi';
import {BrowserWindow,screen} from 'electron';
import {dialogBarBounds} from '../shared/dialog-bar';
const user=koffi.load('user32.dll'),rect=koffi.struct('OneDialogOverlayRect',{left:'int32',top:'int32',right:'int32',bottom:'int32'});
const valid=user.func('bool __stdcall IsWindow(uintptr_t hwnd)'),visible=user.func('bool __stdcall IsWindowVisible(uintptr_t hwnd)'),minimized=user.func('bool __stdcall IsIconic(uintptr_t hwnd)'),foreground=user.func('uintptr_t __stdcall GetForegroundWindow()'),getRect=user.func('bool __stdcall GetWindowRect(uintptr_t hwnd,_Out_ OneDialogOverlayRect *rect)'),pid=user.func('uint32 __stdcall GetWindowThreadProcessId(uintptr_t hwnd,_Out_ uint32 *pid)'),owner=user.func('intptr_t __stdcall SetWindowLongPtrW(uintptr_t hwnd,int index,intptr_t value)'),focus=user.func('bool __stdcall SetForegroundWindow(uintptr_t hwnd)');
const className=user.func('int __stdcall GetClassNameW(uintptr_t hwnd,void *buffer,int count)'),child=user.func('uintptr_t __stdcall FindWindowExW(uintptr_t hwnd,uintptr_t after,str16 className,str16 title)');
const related=user.func('uintptr_t __stdcall GetWindow(uintptr_t hwnd,uint32 relation)'),style=user.func('intptr_t __stdcall GetWindowLongPtrW(uintptr_t hwnd,int index)'),position=user.func('bool __stdcall SetWindowPos(uintptr_t hwnd,intptr_t after,int x,int y,int width,int height,uint32 flags)');
const eventProc=koffi.proto('void __stdcall OneDialogWinEvent(uintptr_t hook,uint32 event,uintptr_t hwnd,int32 object,int32 child,uint32 thread,uint32 time)'),hookEvent=user.func('uintptr_t __stdcall SetWinEventHook(uint32 first,uint32 last,uintptr_t module,OneDialogWinEvent *callback,uint32 process,uint32 thread,uint32 flags)'),unhookEvent=user.func('bool __stdcall UnhookWinEvent(uintptr_t hook)');
export function dialogProcess(hwnd:number){const name=Buffer.alloc(512),actual=[0];if(!valid(hwnd))return 0;className(hwnd,name,256);if(name.toString('utf16le').replace(/\0.*$/s,'')!=='#32770'||!child(hwnd,0,'DUIViewWndClassName',null))return 0;pid(hwnd,actual);return actual[0];}
export class DialogOverlay{
 private timer?:NodeJS.Timeout;private rows=0;private active=false;private handle:number;private hooks:number[]=[];private callback?:ReturnType<typeof koffi.register>;
 constructor(private window:BrowserWindow,readonly hwnd:number,private process:number,private collapse:()=>void,private ended:()=>void){this.handle=Number(window.getNativeWindowHandle().readBigUInt64LE());}
 private alive(){const actual=[0];pid(this.hwnd,actual);return valid(this.hwnd)&&actual[0]===this.process;}
 attach(){
  if(!this.alive())return false;owner(this.handle,-8,this.hwnd);this.place();
  this.callback=koffi.register((_hook:number,event:number,hwnd:number,object:number,child:number)=>{if(event===3||hwnd===this.hwnd&&object===0&&child===0)this.place();},koffi.pointer(eventProc));
  // Only the owner's location/destroy notifications and foreground changes are
  // observed. Moving the dialog updates the bar without a polling-frame delay.
  this.hooks=[hookEvent(0x800b,0x800b,0,this.callback,this.process,0,0),hookEvent(0x8001,0x8001,0,this.callback,this.process,0,0),hookEvent(3,3,0,this.callback,0,0,0)].filter(Boolean);
  this.timer=setInterval(()=>this.place(),500);this.timer.unref();return true;
 }
 interactive(){const front=foreground();return this.alive()&&(front===this.hwnd||front===this.handle);}
 resize(rows:number,active=false){if(this.rows===rows&&this.active===active)return;this.rows=rows;this.active=active;this.place();}
 focusOwner(){if(this.interactive())focus(this.hwnd);}
 private place(){
  if(this.window.isDestroyed()||!this.alive()){this.detach();this.ended();return;}
  if(minimized(this.hwnd)||!visible(this.hwnd)){if(this.window.isVisible()){this.window.hide();this.collapse();}return;}
  const front=foreground();if(front!==this.handle&&this.active){this.active=false;this.collapse();}
  const r:any={};if(!getRect(this.hwnd,r))return;
  const bounds=screen.screenToDipRect(null,{x:r.left,y:r.top,width:r.right-r.left,height:r.bottom-r.top}),area=screen.getDisplayMatching(bounds).workArea,next=dialogBarBounds(bounds,area,this.rows,this.active),old=this.window.getBounds();
  if(Object.keys(next).some(key=>Math.abs(next[key as keyof typeof next]-old[key as keyof typeof old])>1))this.window.setBounds(next,false);
  if(!this.window.isVisible())this.window.showInactive();
  // Changing the native owner does not insert an already-created Chromium
  // window above it. Keep the bar immediately above its dialog, preserving the
  // foreground window and the dialog's position among unrelated applications.
  const previous=related(this.hwnd,3);
  // An explicitly focused bar may already be above an intervening window;
  // lowering it back toward its owner would make input clicks hit that window.
  if(front!==this.handle&&previous!==this.handle){
   const targetTopmost=!!(style(this.hwnd,-20)&8),previousTopmost=!!(previous&&style(previous,-20)&8);
   const after=targetTopmost&&!previousTopmost?-1:previousTopmost&&!targetTopmost?0:previous;
   position(this.handle,after,0,0,0,0,0x213); // NOMOVE | NOSIZE | NOACTIVATE | NOOWNERZORDER
  }
 }
 detach(){clearInterval(this.timer);this.timer=undefined;for(const hook of this.hooks)unhookEvent(hook);this.hooks=[];if(this.callback){koffi.unregister(this.callback);this.callback=undefined;}if(!this.window.isDestroyed()){owner(this.handle,-8,0);this.window.hide();}}
}
