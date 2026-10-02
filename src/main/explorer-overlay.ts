import koffi from 'koffi';
import {BrowserWindow,screen} from 'electron';
import {inlineSearchBaseHeight,inlineSearchHeight} from '../shared/overlay';
const user=koffi.load('user32.dll');
const rect=koffi.struct('OneOverlayRect',{left:'int32',top:'int32',right:'int32',bottom:'int32'});
const visible=user.func('bool __stdcall IsWindowVisible(uintptr_t hwnd)');
const getRect=user.func('bool __stdcall GetWindowRect(uintptr_t hwnd,_Out_ OneOverlayRect *rect)'),valid=user.func('bool __stdcall IsWindow(uintptr_t hwnd)'),minimized=user.func('bool __stdcall IsIconic(uintptr_t hwnd)'),foreground=user.func('uintptr_t __stdcall GetForegroundWindow()'),find=user.func('uintptr_t __stdcall FindWindowExW(uintptr_t parent,uintptr_t after,str16 className,str16 title)'),parent=user.func('intptr_t __stdcall SetWindowLongPtrW(uintptr_t hwnd,int index,intptr_t value)'),pid=user.func('uint32 __stdcall GetWindowThreadProcessId(uintptr_t hwnd,_Out_ uint32 *pid)');
function listView(hwnd:number,depth=0):number{if(depth>8)return 0;const direct=find(hwnd,0,'SHELLDLL_DefView',null);if(direct&&visible(direct))return direct;let child=0,count=0;while((child=find(hwnd,child,null,null))&&count++<150){if(!visible(child))continue;const found=listView(child,depth+1);if(found)return found;}return 0;}
export class ExplorerOverlay{
 private timer?:NodeJS.Timeout;private owner=0;private process=0;private height=inlineSearchBaseHeight;
 constructor(private window:BrowserWindow){}
 attach(hwnd:number){this.detach();this.owner=hwnd;const p=[0];pid(hwnd,p);this.process=p[0];const handle=Number(this.window.getNativeWindowHandle().readBigUInt64LE());parent(handle,-8,hwnd);this.place();this.timer=setInterval(()=>{if(this.window.isDestroyed())return this.detach();const p=[0];pid(this.owner,p);if(!valid(this.owner)||p[0]!==this.process){this.window.hide();this.detach();return;}if(minimized(this.owner)){this.window.hide();return;}if(this.window.isVisible())this.place();},80);this.timer.unref();}
 resize(rows:number,active=false){this.height=inlineSearchHeight(rows,active);this.place();}
 private place(){if(this.window.isDestroyed()||!valid(this.owner))return;const r:any={};if(!getRect(listView(this.owner)||this.owner,r))return;const bounds=screen.screenToDipRect(null,{x:r.left,y:r.top,width:r.right-r.left,height:r.bottom-r.top}),area=screen.getDisplayMatching(bounds).workArea;const width=Math.max(240,Math.min(540,bounds.width-16,area.width-16)),height=Math.max(inlineSearchBaseHeight,Math.min(this.height,bounds.height-16,area.height-16));const x=Math.max(area.x,Math.min(bounds.x+bounds.width-width-8,area.x+area.width-width)),y=Math.max(area.y,Math.min(bounds.y+bounds.height-height-8,area.y+area.height-height));const next={x:Math.round(x),y:Math.round(y),width:Math.round(width),height:Math.round(height)};const old=this.window.getBounds();if(Object.keys(next).some(k=>Math.abs(next[k as keyof typeof next]-old[k as keyof typeof old])>1))this.window.setBounds(next,false);}
 isOwnerForeground(){return foreground()===this.owner;}
 detach(){clearInterval(this.timer);this.timer=undefined;}
}
