// Native mouse gestures are restricted to this test's two Electron windows.
const koffi=require('koffi'),assert=require('node:assert/strict'),data=JSON.parse(process.argv[2]);
const Point=koffi.struct('OneDragTestPoint',{x:'int32',y:'int32'}),user=koffi.load('user32.dll');
const at=user.func('void * __stdcall WindowFromPoint(OneDragTestPoint)'),pid=user.func('uint32 __stdcall GetWindowThreadProcessId(void *, _Out_ uint32 *)'),get=user.func('int __stdcall GetCursorPos(_Out_ OneDragTestPoint *)'),move=user.func('int __stdcall SetCursorPos(int,int)'),mouse=user.func('void __stdcall mouse_event(uint32,uint32,uint32,uint32,uintptr_t)');
const root=user.func('void * __stdcall GetAncestor(void *, uint32)');
user.func('int __stdcall SetProcessDpiAwarenessContext(intptr_t)')(-4);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function run(){const original={x:0,y:0};get(original);let held=false;try{
 for(const point of [data.from,data.to]){const owner=[0];pid(root(at(point),2),owner);assert.ok(data.pids.includes(owner[0]),'Gesture must stay within owned test processes: '+JSON.stringify({point,owner:owner[0],pids:data.pids}));}
 move(data.from.x,data.from.y);await sleep(100);mouse(2,0,0,0,0);held=true;
 for(let n=1;n<=24;n++){move(Math.round(data.from.x+(data.to.x-data.from.x)*n/24),Math.round(data.from.y+(data.to.y-data.from.y)*n/24));await sleep(30);}
 await sleep(200);mouse(4,0,0,0,0);held=false;await sleep(100);
 }finally{if(held)mouse(4,0,0,0,0);move(original.x,original.y);}}
run().catch(e=>{console.error(e);process.exitCode=1;});
