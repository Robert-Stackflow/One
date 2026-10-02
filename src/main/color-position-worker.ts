import {parentPort,workerData} from 'node:worker_threads';
import koffi from 'koffi';
import {loupeBounds,overlayDisplay,type OverlayDisplay,type OverlaySides} from '../shared/overlay';

// Pointer following has its own thread: GDI readback and Electron IPC cannot
// delay the next move. All Win32 coordinates on this thread are physical pixels.
const port=parentPort!,user=koffi.load('user32.dll');
const pointType=koffi.struct('LoupeFollowPoint',{x:'int32',y:'int32'}),rectType=koffi.struct('LoupeFollowRect',{left:'int32',top:'int32',right:'int32',bottom:'int32'});
const cursor=user.func('bool __stdcall GetCursorPos(_Out_ LoupeFollowPoint *point)'),getRect=user.func('bool __stdcall GetWindowRect(uintptr_t hwnd,_Out_ LoupeFollowRect *rect)'),move=user.func('bool __stdcall SetWindowPos(uintptr_t hwnd,uintptr_t after,int x,int y,int width,int height,uint32 flags)'),dpi=user.func('intptr_t __stdcall SetThreadDpiAwarenessContext(intptr_t value)');
const previousDpi=dpi(-4),hwnd=workerData.hwnd as number;let displays:OverlayDisplay[]=workerData.displays,sides:OverlaySides|undefined,monitor:OverlayDisplay|undefined,timer:NodeJS.Timeout,stopped=false;
function stop(){if(stopped)return;stopped=true;clearInterval(timer);if(previousDpi)dpi(previousDpi);port.close();}
function follow(){
 const p={x:0,y:0};if(!cursor(p))return;const d=overlayDisplay(p,displays);if(!d)return;if(d!==monitor){monitor=d;sides=undefined;}
 const current={left:0,top:0,right:0,bottom:0};if(!getRect(hwnd,current))return stop();
 const b=loupeBounds(p,d,sides,{width:current.right-current.left,height:current.bottom-current.top});sides=b;if(current.left===b.x&&current.top===b.y)return;
 // NOSIZE is unconditional: moving must never round or renegotiate window size.
 // Electron handles WM_DPICHANGED; read its resulting physical size for clamping.
 move(hwnd,0,b.x,b.y,0,0,0x4000|0x0010|0x0004|0x0200|0x0001);
}
try{follow();timer=setInterval(follow,8);port.on('message',value=>{if(value==='stop')stop();else if(value?.displays){displays=value.displays;monitor=undefined;sides=undefined;}});port.postMessage({ready:true});}catch(error){port.postMessage({error:String(error)});stop();}
