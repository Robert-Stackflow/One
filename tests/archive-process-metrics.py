"""Observe one Windows helper PID without changing its process tree or protocol."""
import ctypes,ctypes.wintypes as w,json,sys
class Memory(ctypes.Structure):
 _fields_=[('cb',w.DWORD),('faults',w.DWORD)]+[(name,ctypes.c_size_t) for name in ('peakWorking','working','peakPagedPool','pagedPool','peakNonpagedPool','nonpagedPool','commit','peakCommit','private')]
class Io(ctypes.Structure):
 _fields_=[(name,ctypes.c_ulonglong) for name in ('readOperations','writeOperations','otherOperations','readBytes','writeBytes','otherBytes')]
kernel=ctypes.WinDLL('kernel32',use_last_error=True);psapi=ctypes.WinDLL('psapi',use_last_error=True)
kernel.OpenProcess.argtypes=[w.DWORD,w.BOOL,w.DWORD];kernel.OpenProcess.restype=w.HANDLE
kernel.CloseHandle.argtypes=[w.HANDLE];kernel.WaitForSingleObject.argtypes=[w.HANDLE,w.DWORD]
kernel.GetProcessTimes.argtypes=[w.HANDLE]+[ctypes.POINTER(w.FILETIME)]*4
kernel.GetProcessIoCounters.argtypes=[w.HANDLE,ctypes.POINTER(Io)]
psapi.GetProcessMemoryInfo.argtypes=[w.HANDLE,ctypes.POINTER(Memory),w.DWORD]
pid=int(sys.argv[1]);handle=kernel.OpenProcess(0x0410|0x100000,False,pid)
if not handle:print(json.dumps({'available':False,'pid':pid,'windowsError':ctypes.get_last_error()}));sys.exit(0)
try:
 memory=Memory();memory.cb=ctypes.sizeof(memory);peakWorking=peakCommit=private=0
 while True:
  if psapi.GetProcessMemoryInfo(handle,ctypes.byref(memory),memory.cb):peakWorking=max(peakWorking,memory.peakWorking);peakCommit=max(peakCommit,memory.peakCommit);private=max(private,memory.private)
  if kernel.WaitForSingleObject(handle,20)!=258:break
 creation,exit,kernelTime,userTime=(w.FILETIME() for _ in range(4));times=kernel.GetProcessTimes(handle,ctypes.byref(creation),ctypes.byref(exit),ctypes.byref(kernelTime),ctypes.byref(userTime));io=Io();ioOk=kernel.GetProcessIoCounters(handle,ctypes.byref(io))
 def value(time):return (time.dwHighDateTime<<32)|time.dwLowDateTime
 print(json.dumps({'available':True,'pid':pid,'peakWorkingBytes':peakWorking,'peakCommitBytes':peakCommit,'sampledPeakPrivateBytes':private,'seconds':(value(exit)-value(creation))/1e7 if times else None,'kernelSeconds':value(kernelTime)/1e7 if times else None,'userSeconds':value(userTime)/1e7 if times else None,'logicalIo':{name:getattr(io,name) for name,_ in Io._fields_} if ioOk else None}))
finally:kernel.CloseHandle(handle)
