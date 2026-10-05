import koffi from 'koffi';
import { screen } from 'electron';
export interface Foreground { hwnd: number; focus: number; name: string; className: string; fileView: boolean; password: boolean; fullscreen: boolean }
let native: any;
export let nativeError = '';
export function initNative() {
  try {
    const user = koffi.load('user32.dll'); const kernel = koffi.load('kernel32.dll');
    const rect = koffi.struct('OneRect', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' });
    const point = koffi.struct('OnePoint', { x: 'int32', y: 'int32' });
    const mouseInput = koffi.struct('OneMouseInput', { x: 'int32', y: 'int32', data: 'uint32', flags: 'uint32', time: 'uint32', extra: 'uintptr_t' });
    const inputData = koffi.union('OneInputData', { mouse: mouseInput });
    const input = koffi.struct('OneInput', { type: 'uint32', data: inputData });
    const gui = koffi.struct('OneGui', { cbSize: 'uint32', flags: 'uint32', hwndActive: 'uintptr_t', hwndFocus: 'uintptr_t', hwndCapture: 'uintptr_t', hwndMenuOwner: 'uintptr_t', hwndMoveSize: 'uintptr_t', hwndCaret: 'uintptr_t', rcCaret: rect });
    native = {
      foreground: user.func('uintptr_t __stdcall GetForegroundWindow()'),
      className: user.func('int __stdcall GetClassNameW(uintptr_t hwnd, void *buffer, int count)'),
      rect: user.func('int __stdcall GetWindowRect(uintptr_t hwnd, _Out_ OneRect *rect)'),
      gui: user.func('int __stdcall GetGUIThreadInfo(uint32 thread, _Inout_ OneGui *info)'),
      pid: user.func('uint32 __stdcall GetWindowThreadProcessId(uintptr_t hwnd, _Out_ uint32 *pid)'),
      style: user.func('int32 __stdcall GetWindowLongW(uintptr_t hwnd, int index)'),
      sequence: user.func('uint32 __stdcall GetClipboardSequenceNumber()'),
      lock: user.func('bool __stdcall LockWorkStation()'),
      cursor: user.func('bool __stdcall GetCursorPos(_Out_ OnePoint *point)'),
      moveCursor: user.func('bool __stdcall SetCursorPos(int x, int y)'),
      mouseEvent: user.func('void __stdcall mouse_event(uint32 flags, uint32 dx, uint32 dy, uint32 data, uintptr_t extra)'),
      sendInput: user.func('uint32 __stdcall SendInput(uint32 count, _In_ OneInput *input, int size)'), inputSize:koffi.sizeof(input),
      open: kernel.func('uintptr_t __stdcall OpenProcess(uint32 access, bool inherit, uint32 pid)'),
      image: kernel.func('bool __stdcall QueryFullProcessImageNameW(uintptr_t process, uint32 flags, void *buffer, _Inout_ uint32 *size)'),
      close: kernel.func('bool __stdcall CloseHandle(uintptr_t handle)'), guiSize: koffi.sizeof(gui)
    };
  } catch (error) { nativeError = String(error); }
}
function classOf(hwnd: number) { const buffer = Buffer.alloc(512); native.className(hwnd, buffer, 256); return buffer.toString('utf16le').replace(/\0.*$/s, ''); }
let cache: Foreground | null = null; let cacheTime = 0;
export function foreground(fresh=false): Foreground | null {
  if (!native) return null;
  try {
    const hwnd = native.foreground();if(!hwnd)return null;
    if(!fresh&&cache?.hwnd===hwnd&&Date.now()-cacheTime<80)return cache;
    const className = classOf(hwnd); const pid = [0]; native.pid(hwnd, pid);
    let name = ''; const process = native.open(0x1000, false, pid[0]);
    if (process) { try { const buffer = Buffer.alloc(65536); const count = [32768]; if (native.image(process, 0, buffer, count)) name = buffer.toString('utf16le', 0, count[0] * 2).split('\\').pop() || ''; } finally { native.close(process); } }
    const info: any = { cbSize: native.guiSize }; native.gui(0, info);
    const focusClass = info.hwndFocus ? classOf(info.hwndFocus) : '';
    const bounds: any = {}; native.rect(hwnd, bounds);
    const display = screen.getDisplayNearestPoint(screen.screenToDipPoint({ x: bounds.left, y: bounds.top }));
    const a = screen.screenToDipPoint({ x: bounds.left, y: bounds.top }); const b = screen.screenToDipPoint({ x: bounds.right, y: bounds.bottom }); const d = display.bounds;
    const fullscreen = !/^(Progman|WorkerW|Shell_TrayWnd|Shell_SecondaryTrayWnd)$/.test(className) && pid[0] !== processPid() && Math.abs(a.x - d.x) <= 2 && Math.abs(a.y - d.y) <= 2 && Math.abs(b.x - d.x - d.width) <= 2 && Math.abs(b.y - d.y - d.height) <= 2;
    cache = { hwnd, focus:info.hwndFocus||0, name, className, fullscreen, fileView: /^(CabinetWClass|ExploreWClass)$/.test(className) && /^(DirectUIHWND|SysListView32)$/.test(focusClass), password: focusClass === 'Edit' && !!(native.style(info.hwndFocus, -16) & 0x20) }; cacheTime = Date.now(); return cache;
  } catch (error) { nativeError = String(error); return null; }
}
const processPid = () => process.pid;
export const clipboardSequence = () => native ? native.sequence() as number : 0;
export const lockWorkstation = () => { if (!native?.lock()) throw new Error('锁屏失败'); };
export const nativeAvailable = () => !!native;
const mouseFlags:Record<'left'|'right'|'middle',[number,number]>={left:[0x0002,0x0004],right:[0x0008,0x0010],middle:[0x0020,0x0040]};
export function cursorPosition(){if(!native)throw new Error('鼠标服务不可用');const point={x:0,y:0};if(!native.cursor(point))throw new Error('无法读取鼠标位置');return point;}
export function setCursorPosition(x:number,y:number){if(!native?.moveCursor(x,y))throw new Error('无法移动鼠标');}
export function mouseClick(button:'left'|'right'|'middle',double=false,method:'mouseEvent'|'sendInput'='mouseEvent'){
  if(!native?.mouseEvent)throw new Error('鼠标服务不可用');const [down,up]=mouseFlags[button];
  const event=(flags:number)=>{if(method==='mouseEvent')native.mouseEvent(flags,0,0,0,0);else if(native.sendInput(1,{type:0,data:{mouse:{x:0,y:0,data:0,flags,time:0,extra:0}}},native.inputSize)!==1)throw new Error('SendInput 注入失败');};
  const click=()=>{event(down);event(up);};click();if(double)click();
}
const keyUser=koffi.load('user32.dll'),imeLib=koffi.load('imm32.dll');
const keyState=keyUser.func('int16 __stdcall GetKeyState(int key)'),getForeground=keyUser.func('uintptr_t __stdcall GetForegroundWindow()'),threadId=keyUser.func('uint32 __stdcall GetWindowThreadProcessId(uintptr_t hwnd,void *pid)'),layout=keyUser.func('uintptr_t __stdcall GetKeyboardLayout(uint32 thread)'),imeWindow=imeLib.func('uintptr_t __stdcall ImmGetDefaultIMEWnd(uintptr_t hwnd)'),sendTimeout=keyUser.func('intptr_t __stdcall SendMessageTimeoutW(uintptr_t hwnd,uint32 message,uintptr_t wparam,intptr_t lparam,uint32 flags,uint32 timeout,_Out_ uintptr_t *result)');
export function keyboardIndicators(){const hwnd=getForeground(),hkl=layout(threadId(hwnd,null)),language=Number(hkl)&0xffff;let mode=0,opened=0;const ime=imeWindow(hwnd);if(ime){const result=[0];if(sendTimeout(ime,0x283,5,0,2,20,result))opened=result[0];if(sendTimeout(ime,0x283,1,0,2,20,result))mode=result[0];}const lang=language===0x804?'中文':language===0x404?'繁体中文':language===0x411?'日文':language===0x412?'韩文':language===0x409?'英文':`输入法 ${language.toString(16)}`;return {ime:`${opened&&mode&1?'中':'A'} · ${lang}`,caps:!!(keyState(0x14)&1),num:!!(keyState(0x90)&1),scroll:!!(keyState(0x91)&1)};}

const asyncState=keyUser.func('int16 __stdcall GetAsyncKeyState(int key)');
export const capsLockState=()=>!!(keyState(0x14)&1);
export const modifiersHeld=()=>[0x10,0x11,0x12,0x5b,0x5c,0x14].some(key=>!!(asyncState(key)&0x8000));
