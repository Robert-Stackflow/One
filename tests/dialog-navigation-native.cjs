const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{spawn,execFile}=require('node:child_process'),{promisify}=require('node:util'),koffi=require('koffi');
const execute=promisify(execFile),pause=ms=>new Promise(r=>setTimeout(r,ms));
async function run(){
 const out=path.resolve(process.env.ONE_TEST_OUTPUT_DIR||'work/current/dialog-navigation-native'),first=path.join(out,'fixtures','起点'),target=path.join(out,'fixtures','目录 中文 & $()');await fs.mkdir(first,{recursive:true});await fs.mkdir(target,{recursive:true});const helper=path.resolve(process.env.ONE_DIALOG_TEST_HELPER||'dist/native/One.Search.exe');
 const user=koffi.load('user32.dll'),post=user.func('bool __stdcall PostMessageW(uintptr_t hwnd,uint32 message,uintptr_t wparam,intptr_t lparam)'),front=user.func('uintptr_t __stdcall GetForegroundWindow()');
 for(const kind of ['open','save']){
  const child=spawn(path.resolve(process.env.ONE_DIALOG_TEST_FIXTURE||helper),['fixture-dialog',kind,first],{windowsHide:true,env:{...process.env,ONE_TEST_MODE:'1'}}),events=[];let buffer='',hwnd=0;child.stdout.on('data',part=>{buffer+=part;let i;while((i=buffer.indexOf('\n'))>=0){events.push(JSON.parse(buffer.slice(0,i)));buffer=buffer.slice(i+1);}});child.stderr.on('data',part=>console.error(String(part)));
  try{
   for(let i=0;i<100&&!events.length;i++)await pause(25);hwnd=events[0]?.hwnd;assert.ok(hwnd);const context=JSON.parse((await execute(helper,['context',String(hwnd)],{windowsHide:true})).stdout);assert.equal(context.pid,child.pid);await pause(100);const previousFront=front();
   const result=await execute(helper,['jump',String(hwnd),String(context.pid),context.created,target],{windowsHide:true,timeout:5000});assert.deepEqual(JSON.parse(result.stdout),{ok:true});
   for(let i=0;i<100&&events.filter(e=>e.event==='fixture-folder').at(-1)?.path!==target;i++)await pause(20);assert.equal(events.filter(e=>e.event==='fixture-folder').at(-1)?.path,target);assert.equal(events.filter(e=>e.event==='fixture-folder').at(-1)?.filename,'keep filename.txt');assert.equal(front(),previousFront,'COM navigation must not change focus');assert.ok(!events.some(e=>e.event==='fixture-file-ok'));console.log(JSON.stringify({kind,result:'PASS',directInterfaceNavigation:true,filenamePreserved:true,noAcceptOrFocusChange:true,events}));
  }finally{if(hwnd)post(hwnd,0x10,0,0);for(let i=0;i<100&&child.exitCode===null;i++)await pause(20);if(child.exitCode===null)child.kill();}
 }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
