import {parentPort} from 'node:worker_threads';
import koffi from 'koffi';
// A small live GDI surface, not an overlay of a captured desktop. This thread owns
// the low-level hooks and pumps their Windows messages without blocking Electron.
const port=parentPort!;const user=koffi.load('user32.dll'),gdi=koffi.load('gdi32.dll');
const point=koffi.struct('PickerPoint',{x:'int32',y:'int32'});
const message=koffi.struct('PickerMessage',{hwnd:'uintptr_t',message:'uint32',wParam:'uintptr_t',lParam:'intptr_t',time:'uint32',pt:point,lPrivate:'uint32'});
const hookProc=koffi.proto('intptr_t __stdcall PickerHook(int code, uintptr_t wParam, intptr_t lParam)');
const hook=user.func('void * __stdcall SetWindowsHookExW(int id, PickerHook *fn, void *module, uint32 thread)'),unhook=user.func('bool __stdcall UnhookWindowsHookEx(void *hook)'),next=user.func('intptr_t __stdcall CallNextHookEx(void *hook, int code, uintptr_t wParam, intptr_t lParam)');
const peek=user.func('bool __stdcall PeekMessageW(_Out_ PickerMessage *msg, void *hwnd, uint32 min, uint32 max, uint32 remove)'),translate=user.func('bool __stdcall TranslateMessage(const PickerMessage *msg)'),dispatch=user.func('intptr_t __stdcall DispatchMessageW(const PickerMessage *msg)');
const cursor=user.func('bool __stdcall GetCursorPos(_Out_ PickerPoint *point)'),getDC=user.func('void * __stdcall GetDC(void *hwnd)'),release=user.func('int __stdcall ReleaseDC(void *hwnd, void *dc)');
const compatible=gdi.func('void * __stdcall CreateCompatibleDC(void *dc)'),create=gdi.func('void * __stdcall CreateDIBSection(void *dc, const void *info, uint32 usage, _Out_ void **bits, void *section, uint32 offset)'),select=gdi.func('void * __stdcall SelectObject(void *dc, void *object)'),copy=gdi.func('bool __stdcall BitBlt(void *dest, int x, int y, int width, int height, void *source, int sx, int sy, uint32 operation)'),remove=gdi.func('bool __stdcall DeleteObject(void *object)'),removeDC=gdi.func('bool __stdcall DeleteDC(void *dc)');
const flush=gdi.func('bool __stdcall GdiFlush()');
const awareness=user.func('intptr_t __stdcall SetThreadDpiAwarenessContext(intptr_t value)'),previousDpi=awareness(-4);
const size=31;let dc:any,memory:any,bitmap:any,previous:any,bits:any,mouse:any,keyboard:any,mouseFn:any,keyFn:any,timer:NodeJS.Timeout|undefined,done=false,pending:string|undefined,last=0,pixels=11;
function stop(){if(done)return;done=true;clearInterval(timer);if(mouse)unhook(mouse);if(keyboard)unhook(keyboard);if(mouseFn)koffi.unregister(mouseFn);if(keyFn)koffi.unregister(keyFn);if(previous)select(memory,previous);if(bitmap)remove(bitmap);if(memory)removeDC(memory);if(dc)release(null,dc);if(previousDpi)awareness(previousDpi);port.close();}
function sample(){const p={x:0,y:0};if(!cursor(p))return null;if(!copy(memory,0,0,size,size,dc,p.x-15,p.y-15,0x40cc0020))return null;flush();const data=Buffer.from(koffi.decode(bits,'uint8_t',size*size*4));for(let i=3;i<data.length;i+=4)data[i]=255;const n=(15*size+15)*4,hex='#'+[data[n+2],data[n+1],data[n]].map(n=>n.toString(16).padStart(2,'0')).join('').toUpperCase();const value={x:p.x,y:p.y,width:size,height:size,data,hex,pixels};port.postMessage({sample:value});return hex;}
try{
  dc=getDC(null);memory=compatible(dc);const info=Buffer.alloc(40);info.writeUInt32LE(40);info.writeInt32LE(size,4);info.writeInt32LE(-size,8);info.writeUInt16LE(1,12);info.writeUInt16LE(32,14);const address=[null];bitmap=create(dc,info,0,address,null,0);bits=address[0];if(!dc||!memory||!bitmap||!bits)throw new Error('无法读取桌面像素');previous=select(memory,bitmap);
  mouseFn=koffi.register((code:number,w:number,l:number)=>{if(code<0)return next(null,code,w,l);if(w===0x201||w===0x204||w===0x207){pending=w===0x204?'cancel':sample()||undefined;return 1;}if(w===0x202||w===0x205||w===0x208){if(pending){port.postMessage(pending==='cancel'?{cancel:true}:{pick:pending});pending=undefined;}return 1;}if(w===0x20a){const delta=koffi.decode(l+8,'uint32')>>>16;pixels=Math.max(5,Math.min(25,pixels+(delta<32768?-2:2)));return 1;}return next(null,code,w,l);},koffi.pointer(hookProc));
  keyFn=koffi.register((code:number,w:number,l:number)=>{if(code<0)return next(null,code,w,l);const key=koffi.decode(l,'uint32');if(key===27||key===13){if(w===0x100||w===0x104)pending=key===27?'cancel':sample()||undefined;else if(pending){port.postMessage(pending==='cancel'?{cancel:true}:{pick:pending});pending=undefined;}return 1;}return next(null,code,w,l);},koffi.pointer(hookProc));
  mouse=hook(14,mouseFn,null,0);keyboard=hook(13,keyFn,null,0);if(!mouse||!keyboard)throw new Error('无法启动取色输入监听');port.postMessage({ready:true});
  timer=setInterval(()=>{try{const msg:any={};let count=0;while(count++<100&&peek(msg,null,0,0,1)){translate(msg);dispatch(msg);}if(Date.now()-last>=16){last=Date.now();sample();}}catch(error){port.postMessage({error:String(error)});stop();}},8);
  port.on('message',value=>{if(value==='stop')stop();});
}catch(error){port.postMessage({error:(error as Error).message});stop();}
