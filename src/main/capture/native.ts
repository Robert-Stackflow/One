import koffi from 'koffi';
let api: any;
export function initCaptureNative() {
  if (api) return;
  if (process.platform !== 'win32' || process.arch !== 'x64') throw Error('截图采集需要 Windows x64');
  const u = koffi.load('user32.dll'),
    k = koffi.load('kernel32.dll'),
    dwm = koffi.load('dwmapi.dll');
  const point = koffi.struct({ x: 'int32_t', y: 'int32_t' });
  api = {
    pid: u.func('uint32 __stdcall GetWindowThreadProcessId(uintptr_t,_Out_ uint32*)'),
    isWindow: u.func('bool __stdcall IsWindow(uintptr_t)'),
    visible: u.func('bool __stdcall IsWindowVisible(uintptr_t)'),
    isIconic: u.func('bool __stdcall IsIconic(uintptr_t)'),
    rect: u.func('bool __stdcall GetWindowRect(uintptr_t,void*)'),
    dwm: dwm.func('int32 __stdcall DwmGetWindowAttribute(uintptr_t,uint32,void*,uint32)'),
    setDwm: dwm.func('int32 __stdcall DwmSetWindowAttribute(uintptr_t,uint32,void*,uint32)'),
    flushDwm: dwm.func('int32 __stdcall DwmFlush()'),
    cursor: u.func('bool __stdcall GetCursorPos(void*)'),
    setCursor: u.func('bool __stdcall SetCursorPos(int,int)'),
    position: u.func('bool __stdcall SetWindowPos(uintptr_t,uintptr_t,int,int,int,int,uint32)'),
    dpiContext: u.func('intptr_t __stdcall SetThreadDpiAwarenessContext(intptr_t)'),
    monitorFromPoint: u.func('MonitorFromPoint', 'uintptr_t', [point, 'uint32_t']),
    monitorInfo: u.func('bool __stdcall GetMonitorInfoW(uintptr_t,void*)'),
    openProcess: k.func('uintptr_t __stdcall OpenProcess(uint32,bool,uint32)'),
    image: k.func(
      'bool __stdcall QueryFullProcessImageNameW(uintptr_t,uint32,void*,_Inout_ uint32*)',
    ),
    close: k.func('bool __stdcall CloseHandle(uintptr_t)'),
  };
}
export function flushDesktopComposition() {
  initCaptureNative();
  return api?.flushDwm() === 0;
}
/** A desktop snapshot must appear at its final bounds, without DWM zoom/fade. */
export function disableWindowTransitions(hwnd: number) {
  initCaptureNative();
  if (!api || !Number.isSafeInteger(hwnd) || !hwnd || !api.isWindow(hwnd)) return false;
  const disabled = Buffer.alloc(4);
  disabled.writeInt32LE(1);
  // DWMWA_TRANSITIONS_FORCEDISABLED takes a Win32 BOOL (four bytes).
  return api.setDwm(hwnd, 3, disabled, disabled.length) === 0;
}
/** DIP window bounds can round outward by several pixels on mixed-DPI screens. */
export function alignCaptureWindow(hwnd:number,bounds:{x:number;y:number;width:number;height:number}) {
  initCaptureNative();
  if(!api||!Number.isSafeInteger(hwnd)||!hwnd||![bounds.x,bounds.y,bounds.width,bounds.height].every(Number.isSafeInteger)||bounds.width<1||bounds.height<1)return false;
  const previous=api.dpiContext(-4); // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2
  if(!previous)return false;
  // SWP_NOSENDCHANGING prevents Chromium's WINDOWPOSCHANGING handler from
  // converting the exact size through rounded DIPs again. WINDOWPOSCHANGED
  // still updates the renderer's viewport normally.
  try{return !!api.position(hwnd,0,bounds.x,bounds.y,bounds.width,bounds.height,0x0614);}
  finally{api.dpiContext(previous);}
}
export function windowExists(hwnd: number) {
  initCaptureNative();
  return !!api?.isWindow(hwnd);
}
export function physicalCursor() {
  initCaptureNative();
  const point = Buffer.alloc(8);
  if (!api?.cursor(point)) throw Error('无法获取鼠标位置');
  return { x: point.readInt32LE(0), y: point.readInt32LE(4) };
}
/** Exact pixel bounds; multiplying rounded DIP dimensions can overrun a monitor. */
export function nativeMonitorBounds(point: { x: number; y: number }) {
  initCaptureNative();
  if (!api || ![point.x, point.y].every(Number.isSafeInteger)) throw Error('显示器坐标无效');
  const monitor = api.monitorFromPoint(point, 0),
    info = Buffer.alloc(40);
  info.writeUInt32LE(info.length);
  if (!monitor || !api.monitorInfo(monitor, info)) throw Error('无法读取显示器像素范围');
  const x = info.readInt32LE(4),
    y = info.readInt32LE(8),
    width = info.readInt32LE(12) - x,
    height = info.readInt32LE(16) - y;
  if (width < 1 || height < 1) throw Error('显示器像素范围无效');
  return { x, y, width, height };
}
export function nativeMonitorHandle(point: { x: number; y: number }) {
  initCaptureNative();
  if (!api || ![point.x, point.y].every(Number.isSafeInteger)) throw Error('显示器坐标无效');
  const handle = Number(api.monitorFromPoint(point, 0));
  if (!Number.isSafeInteger(handle) || handle <= 0) throw Error('无法读取显示器身份');
  return handle;
}
export function movePhysicalCursor(x: number, y: number) {
  initCaptureNative();
  if (
    ![x, y].every(Number.isSafeInteger) ||
    Math.abs(x) > 100000 ||
    Math.abs(y) > 100000 ||
    !api?.setCursor(x, y)
  )
    throw Error('无法移动鼠标');
}
export function captureWindowBounds(hwnd: number) {
  initCaptureNative();
  if (
    !api ||
    !Number.isSafeInteger(hwnd) ||
    !hwnd ||
    !api.isWindow(hwnd) ||
    !api.visible(hwnd) ||
    api.isIconic(hwnd)
  )
    return null;
  const rect = Buffer.alloc(16);
  if (api.dwm(hwnd, 9, rect, 16) !== 0 && !api.rect(hwnd, rect)) return null;
  const width = rect.readInt32LE(8) - rect.readInt32LE(0),
    height = rect.readInt32LE(12) - rect.readInt32LE(4);
  if (width < 2 || height < 2) return null;
  return { x: rect.readInt32LE(0), y: rect.readInt32LE(4), width, height };
}
export function captureWindowInfo(hwnd: number) {
  const bounds = captureWindowBounds(hwnd);
  if (!bounds) return null;
  const ids = [0];
  api.pid(hwnd, ids);
  if (!ids[0]) return null;
  let executable = '';
  const handle = api.openProcess(0x1000, false, ids[0]);
  if (handle)
    try {
      const data = Buffer.alloc(65536),
        size = [32768];
      if (api.image(handle, 0, data, size)) executable = data.toString('utf16le', 0, size[0] * 2);
    } finally {
      api.close(handle);
    }
  return {
    hwnd,
    pid: ids[0],
    name: executable.split('\\').pop() || '',
    executable,
    ...bounds,
  };
}
export function limitChildProcess(pid: number, memoryMiB: number) {
  initCaptureNative();
  const k = koffi.load('kernel32.dll'),
    create = k.func('uintptr_t __stdcall CreateJobObjectW(void*,str16)'),
    configure = k.func('bool __stdcall SetInformationJobObject(uintptr_t,int,void*,uint32)'),
    assign = k.func('bool __stdcall AssignProcessToJobObject(uintptr_t,uintptr_t)'),
    open = k.func('uintptr_t __stdcall OpenProcess(uint32,bool,uint32)'),
    close = k.func('bool __stdcall CloseHandle(uintptr_t)');
  const job = create(null, null),
    process = open(0x101, false, pid);
  try {
    if (!job || !process) throw Error('无法限制预览进程');
    const limits = Buffer.alloc(144);
    limits.writeUInt32LE(0x2100, 16);
    limits.writeBigUInt64LE(BigInt(memoryMiB) * 1024n * 1024n, 112);
    if (!configure(job, 9, limits, 144) || !assign(job, process)) throw Error('无法限制预览进程');
    return () => close(job);
  } catch (error) {
    if (job) close(job);
    throw error;
  } finally {
    if (process) close(process);
  }
}
