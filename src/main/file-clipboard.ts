import koffi from 'koffi';
/** CF_HDROP, so exported recordings paste as files in Explorer/other apps. */
export function copyFileToClipboard(file: string) {
  copyFilesToClipboard([file]);
}
export function copyFilesToClipboard(files: string[]) {
  if (
    !files.length ||
    files.length > 64 ||
    files.some((f) => typeof f !== 'string' || !f || f.length > 32760 || f.includes('\0'))
  )
    throw Error('文件列表无效');
  const u = koffi.load('user32.dll'),
    k = koffi.load('kernel32.dll'),
    open = u.func('bool __stdcall OpenClipboard(uintptr_t)'),
    close = u.func('bool __stdcall CloseClipboard()'),
    empty = u.func('bool __stdcall EmptyClipboard()'),
    set = u.func('uintptr_t __stdcall SetClipboardData(uint32,uintptr_t)'),
    alloc = k.func('uintptr_t __stdcall GlobalAlloc(uint32,uintptr_t)'),
    lock = k.func('void* __stdcall GlobalLock(uintptr_t)'),
    unlock = k.func('bool __stdcall GlobalUnlock(uintptr_t)'),
    free = k.func('uintptr_t __stdcall GlobalFree(uintptr_t)'),
    move = k.func('void __stdcall RtlMoveMemory(void*,void*,uintptr_t)');
  const text = Buffer.from(files.join('\0') + '\0\0', 'utf16le'),
    data = Buffer.alloc(20 + text.length);
  data.writeUInt32LE(20);
  data.writeUInt32LE(1, 16);
  text.copy(data, 20);
  let handle = alloc(2, data.length);
  if (!handle) throw Error('无法复制文件');
  try {
    const pointer = lock(handle);
    if (!pointer) throw Error('无法复制文件');
    move(pointer, data, data.length);
    unlock(handle);
    if (!open(0)) throw Error('剪贴板忙，请重试');
    try {
      if (!empty() || !set(15, handle)) throw Error('无法复制文件');
      handle = 0;
    } finally {
      close();
    }
  } finally {
    if (handle) free(handle);
  }
}

/** Read CF_HDROP as file references; never read arbitrary clipboard handles as strings. */
export function readClipboardFiles(): string[] {
  const u = koffi.load('user32.dll'),
    s = koffi.load('shell32.dll'),
    available = u.func('bool __stdcall IsClipboardFormatAvailable(uint32)'),
    open = u.func('bool __stdcall OpenClipboard(uintptr_t)'),
    close = u.func('bool __stdcall CloseClipboard()'),
    get = u.func('uintptr_t __stdcall GetClipboardData(uint32)'),
    query = s.func('uint32 __stdcall DragQueryFileW(uintptr_t,uint32,void*,uint32)');
  if (!available(15)) return [];
  if (!open(0)) throw Error('剪贴板忙，请重试');
  try {
    const handle = get(15);
    if (!handle) throw Error('无法读取剪贴板文件');
    const count = query(handle, 0xffffffff, null, 0);
    if (!count || count > 64) throw Error('文件贴图支持 1–64 个文件');
    const files: string[] = [];
    for (let i = 0; i < count; i++) {
      const length = query(handle, i, null, 0);
      if (!length || length > 32760) throw Error('剪贴板文件路径无效');
      const buffer = Buffer.alloc((length + 1) * 2);
      if (query(handle, i, buffer, length + 1) !== length) throw Error('无法读取剪贴板文件路径');
      files.push(buffer.subarray(0, length * 2).toString('utf16le'));
    }
    return files;
  } finally {
    close();
  }
}
