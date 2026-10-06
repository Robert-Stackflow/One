// Hardware integration check: moves brightness by one step and restores it.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawn,execFileSync}=require('node:child_process');
const koffi=require('koffi');

const exe=path.resolve('dist/native/One.Levels.exe');
const fixtureExe=path.resolve('work/current/edge-brightness-native/fixture.exe');
const searchExe=path.resolve('dist/native/One.Search.exe');
const user=koffi.load('user32.dll');
const point=koffi.struct('BrightnessTestPoint',{x:'int32',y:'int32'});
user.func('intptr_t __stdcall SetThreadDpiAwarenessContext(intptr_t value)')(-4);
const cursor=user.func('bool __stdcall SetCursorPos(int x,int y)');
const getCursor=user.func('bool __stdcall GetCursorPos(_Out_ BrightnessTestPoint *point)');
const foreground=user.func('uintptr_t __stdcall GetForegroundWindow()');
const send=user.func('uint32 __stdcall SendInput(uint32 count,void *input,int size)');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(read,timeout=5000){const end=Date.now()+timeout;while(Date.now()<end){const value=read();if(value)return value;await delay(20);}throw new Error('Timed out waiting for native brightness response');}
function messages(child){const rows=[];let buffer='';child.stdout.setEncoding('utf8');child.stdout.on('data',part=>{buffer+=part;let end;while((end=buffer.indexOf('\n'))>=0){rows.push(JSON.parse(buffer.slice(0,end)));buffer=buffer.slice(end+1);}});return rows;}
function wheel(delta){const input=Buffer.alloc(40);input.writeUInt32LE(delta>>>0,16);input.writeUInt32LE(0x800,20);input.writeBigUInt64LE(0x4f4e4554n,32);assert.equal(send(1,input,40),1);}
function outerEdge(display,others){const midX=Math.floor((display.left+display.right)/2),midY=Math.floor((display.top+display.bottom)/2);for(const candidate of [
 {x:display.left,y:midY,outside:{x:display.left-1,y:midY}},
 {x:display.right-1,y:midY,outside:{x:display.right,y:midY}},
 {x:midX,y:display.top,outside:{x:midX,y:display.top-1}},
 {x:midX,y:display.bottom-1,outside:{x:midX,y:display.bottom}}
])if(!others.some(other=>candidate.outside.x>=other.left&&candidate.outside.x<other.right&&candidate.outside.y>=other.top&&candidate.outside.y<other.bottom))return candidate;
 throw new Error('Display has no exposed screen edge');}
function buildFixture(){
 if(fs.existsSync(fixtureExe))return;
 const directory=path.dirname(fixtureExe);fs.mkdirSync(directory,{recursive:true});
 const vswhere=path.join(process.env['ProgramFiles(x86)']||'C:\\Program Files (x86)','Microsoft Visual Studio/Installer/vswhere.exe');
 const installation=execFileSync(vswhere,['-latest','-products','*','-requires','Microsoft.VisualStudio.Component.VC.Tools.x86.x64','-property','installationPath'],{encoding:'utf8',windowsHide:true}).trim();
 assert.ok(installation,'Visual Studio C++ x64 tools are required');
 const script=path.join(directory,'build-fixture.cmd');
 fs.writeFileSync(script,`@echo off\r\ncall "${installation}\\VC\\Auxiliary\\Build\\vcvars64.bat" >nul\r\ncl /nologo /std:c++20 /EHsc /MT /O2 /utf-8 /DUNICODE /D_UNICODE tests\\quick-actions-fixture.cpp /Fe:"${fixtureExe}" /Fo:"${path.join(directory,'fixture.obj')}" /link user32.lib gdi32.lib ole32.lib oleaut32.lib uuid.lib\r\nif errorlevel 1 exit /b 1\r\n`);
 execFileSync('cmd.exe',['/d','/c',script],{cwd:path.resolve('.'),windowsHide:true});
}
async function emergencyRestore(item){
 if(item.method==='WMI'){
  const command=`$methods=@(Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorBrightnessMethods);if($methods.Count -ne 1){throw 'Cannot identify the built-in panel'};Invoke-CimMethod -InputObject $methods[0] -MethodName WmiSetBrightness -Arguments @{Timeout=[uint32]0;Brightness=[byte]${item.before}} | Out-Null`;
  execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,timeout:10000});return;
 }
 const child=spawn(exe,[],{windowsHide:true}),rows=messages(child);child.stdin.on('error',()=>{});
 try{
  let id=0;const call=async(delta,read)=>{const next=++id,x=Math.floor((item.display.left+item.display.right)/2),y=Math.floor((item.display.top+item.display.bottom)/2);child.stdin.write(`brightness ${next} ${x} ${y} ${delta} ${read}\n`);const response=await until(()=>rows.find(row=>row.id===next),10000);assert.ok(response.result,response.error);return response.result.brightness;};
  const current=await call(0,1);if(current!==item.before)assert.equal(await call(item.before-current,0),item.before);
 }finally{child.stdin.end('stop\n');await until(()=>child.exitCode!==null,5000).catch(()=>child.kill());}
}
async function run(){
 assert.ok(fs.existsSync(exe)&&fs.existsSync(searchExe),'Build One before this hardware test');buildFixture();
 const displays=JSON.parse(execFileSync(exe,['--display-info'],{encoding:'utf8',windowsHide:true}));
 const previous={x:0,y:0};getCursor(previous);const previousWindow=foreground();
 const env={...process.env,ONE_TEST_MODE:'1'};
 const fixture=spawn(fixtureExe,[],{env,windowsHide:true});
 const levels=spawn(exe,[],{env,windowsHide:true});levels.stdin.on('error',()=>{});
 const states=messages(fixture),events=messages(levels);
 let sequence=0;
 const request=async(display,delta=0,read=1)=>{const id=++sequence,x=Math.floor((display.left+display.right)/2),y=Math.floor((display.top+display.bottom)/2);levels.stdin.write(`brightness ${id} ${x} ${y} ${delta} ${read}\n`);const response=await until(()=>events.find(item=>item.id===id),10000);assert.ok(response.result,response.error);return response.result;};
 const restore=[];
 try{
  const fixtureWindow=(await until(()=>states[0])).window;
  const context=JSON.parse(execFileSync(searchExe,['context',String(fixtureWindow)],{encoding:'utf8',windowsHide:true}));
  execFileSync(searchExe,['focus',String(fixtureWindow),String(fixture.pid),context.created],{windowsHide:true});
  await until(()=>foreground()===fixtureWindow);
  levels.stdin.write(`quick 0 2 0 0 ${fixture.pid} 8 2 2 2 2 2 2 2 2 -\n`);
  await delay(200);
  for(const display of displays){
   const before=await request(display);if(!['WMI','DDC/CI'].includes(before.method))continue;
   const delta=before.brightness>96?-120:120;
   restore.push({display,before:before.brightness,method:before.method});
   const edge=outerEdge(display,displays.filter(other=>other!==display));
   cursor(edge.x,edge.y);await delay(100);
   const count=events.filter(item=>item.level?.action==='brightness').length;
   const started=performance.now();
   wheel(delta);
   const changed=await until(()=>events.filter(item=>item.level?.action==='brightness')[count],10000);
   const responseMs=Math.round(performance.now()-started);
   assert.equal(changed.level.value,before.brightness+(delta>0?2:-2));
   await delay(1300);const actual=await request(display);
   assert.equal(actual.brightness,changed.level.value,`${before.method} did not apply edge wheel input`);
   const reverted=await request(display,before.brightness-actual.brightness,0);
   assert.equal(reverted.brightness,before.brightness);
   restore.pop();
   console.log(`${before.method}: edge wheel updated ${before.brightness}% -> ${actual.brightness}% in ${responseMs} ms and restored`);
  }
  assert.ok(!events.some(item=>item.levelError),JSON.stringify(events.filter(item=>item.levelError)));
 }finally{
  for(const item of restore){try{const current=await request(item.display);await request(item.display,item.before-current.brightness,0);}catch(error){console.error('Primary brightness restoration failed:',error);try{await emergencyRestore(item);}catch(fallback){console.error('Emergency brightness restoration failed:',fallback);}}}
  cursor(previous.x,previous.y);
  levels.stdin.end('stop\n');fixture.stdin.end('quit\n');
  await Promise.all([until(()=>levels.exitCode!==null,5000).catch(()=>levels.kill()),until(()=>fixture.exitCode!==null,5000).catch(()=>fixture.kill())]);
  if(previousWindow)user.func('bool __stdcall SetForegroundWindow(uintptr_t hwnd)')(previousWindow);
 }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
