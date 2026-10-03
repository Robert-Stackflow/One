import koffi from 'koffi';
import {win32} from 'node:path';

interface ProgramWindows {
 foreground():number;
 pid(hwnd:number):number;
 image(pid:number):string;
 children(hwnd:number):number[];
}
let windows:ProgramWindows|undefined;
function nativeWindows():ProgramWindows{
 if(windows)return windows;
 const user=koffi.load('user32.dll'),kernel=koffi.load('kernel32.dll');
 const front=user.func('uintptr_t __stdcall GetForegroundWindow()');
 const pid=user.func('uint32 __stdcall GetWindowThreadProcessId(uintptr_t hwnd,_Out_ uint32 *pid)');
 const enumerate=user.func('bool __stdcall EnumChildWindows(uintptr_t hwnd,void *callback,intptr_t value)');
 const visible=user.func('bool __stdcall IsWindowVisible(uintptr_t hwnd)');
 const open=kernel.func('uintptr_t __stdcall OpenProcess(uint32 access,bool inherit,uint32 pid)');
 const image=kernel.func('bool __stdcall QueryFullProcessImageNameW(uintptr_t process,uint32 flags,void *buffer,_Inout_ uint32 *size)');
 const close=kernel.func('bool __stdcall CloseHandle(uintptr_t handle)');
 const childCallback=koffi.proto('bool __stdcall OneProgramChild(uintptr_t hwnd,intptr_t value)');
 windows={foreground:front,pid(hwnd){const result=[0];pid(hwnd,result);return result[0];},image(pid){
  const handle=open(0x1000,false,pid);if(!handle)throw new Error('无法读取该程序路径，程序可能已退出或权限不足');
  try{const buffer=Buffer.alloc(65536),length=[32768];if(!image(handle,0,buffer,length))throw new Error('无法读取该程序的可执行文件路径');return buffer.toString('utf16le',0,length[0]*2);}finally{close(handle);}
 },children(hwnd){const result:number[]=[];const callback=koffi.register((child:number)=>{if(visible(child))result.push(child);return true;},koffi.pointer(childCallback));try{enumerate(hwnd,callback,0);}finally{koffi.unregister(callback);}return result;}};
 return windows;
}

/** Capture before Explorer takes focus; never resolve a later foreground window. */
export function focusedProgramPath(source:ProgramWindows=nativeWindows()):string{
 const hwnd=source.foreground(),pid=hwnd?source.pid(hwnd):0;
 if(!pid)throw new Error('当前没有可定位的程序窗口');
 let path=source.image(pid);
 // Windows' frame host is not the executable of the hosted Store application.
 if(win32.basename(path).toLowerCase()==='applicationframehost.exe'){
  const candidates=new Map<number,string>();
  for(const child of source.children(hwnd)){
   const childPid=source.pid(child);if(!childPid||childPid===pid||candidates.has(childPid))continue;
   try{candidates.set(childPid,source.image(childPid));}catch{}
  }
  const paths=[...new Set(candidates.values())];
  if(paths.length!==1)throw new Error('无法确定当前窗口所承载程序的实际路径');
  path=paths[0];
 }
 if(source.pid(hwnd)!==pid)throw new Error('目标窗口已关闭，请重新操作');
 if(!win32.isAbsolute(path)||!path.toLowerCase().endsWith('.exe'))throw new Error('当前窗口没有有效的可执行文件路径');
 return path;
}
