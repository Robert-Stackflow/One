const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{execFile}=require('node:child_process'),{promisify}=require('node:util'),{build}=require('esbuild'),koffi=require('koffi');
const execute=promisify(execFile),delay=ms=>new Promise(r=>setTimeout(r,ms)),user=koffi.load('user32.dll');
const callback=koffi.proto('bool __stdcall OneEnvironmentWindow(uintptr_t hwnd,intptr_t value)'),enumerate=user.func('bool __stdcall EnumWindows(OneEnvironmentWindow *callback,intptr_t value)'),children=user.func('bool __stdcall EnumChildWindows(uintptr_t parent,OneEnvironmentWindow *callback,intptr_t value)'),pid=user.func('uint32 __stdcall GetWindowThreadProcessId(uintptr_t hwnd,_Out_ uint32 *pid)'),visible=user.func('bool __stdcall IsWindowVisible(uintptr_t hwnd)'),text=user.func('int __stdcall GetWindowTextW(uintptr_t hwnd,void *text,int count)'),className=user.func('int __stdcall GetClassNameW(uintptr_t hwnd,void *text,int count)'),post=user.func('bool __stdcall PostMessageW(uintptr_t hwnd,uint32 message,uintptr_t wparam,intptr_t lparam)');
const read=(fn,hwnd)=>{const buffer=Buffer.alloc(2048);fn(hwnd,buffer,1024);return buffer.toString('utf16le').split('\0')[0];};
function windows(processId){const result=[];enumerate(hwnd=>{const owner=[0];pid(hwnd,owner);if(owner[0]===processId&&visible(hwnd)){const controls=[];children(hwnd,child=>{controls.push({className:read(className,child),text:read(text,child)});return true;},0);result.push({hwnd,title:read(text,hwnd),controls});}return true;},0);return result;}
async function run(){
 const out=path.resolve(process.env.ONE_TEST_OUTPUT_DIR||'work/current/menu-environment-native');await fs.mkdir(out,{recursive:true});
 const bundled=await build({entryPoints:['src/main/menu-builtins.ts'],bundle:true,platform:'node',format:'cjs',write:false}),m={exports:{}};new Function('module','exports','require',bundled.outputFiles[0].text)(m,m.exports,require);
 const plan=m.exports.builtinPlan('environment'),helper=path.resolve('dist/native/One.OpenWith.exe'),started=Date.now();let opened;
 try{
  opened=JSON.parse((await execute(helper,['launch',plan.file,'',plan.windowsVerbatimArguments?'verbatim':'quoted',...plan.args],{windowsHide:true,timeout:10000})).stdout);assert.ok(opened.pid);
  let observed=[];for(let i=0;i<60;i++){observed=windows(opened.pid);if(observed.length)break;await delay(100);}
  await fs.writeFile(path.join(out,'observed.json'),JSON.stringify({plan,pid:opened.pid,windows:observed},null,2));
  const environment=observed.find(w=>/环境变量|Environment Variables/i.test(w.title));assert.ok(environment,'No visible Environment Variables dialog: '+JSON.stringify(observed));assert.ok(environment.controls.filter(c=>c.className==='SysListView32').length>=2,'User and system environment lists must both be visible');
  const result={result:'PASS',visibleEnvironmentVariablesDialog:true,userAndSystemLists:true,elapsedMs:Date.now()-started,settingsModified:false};await fs.writeFile(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{if(opened?.pid)for(const window of windows(opened.pid))post(window.hwnd,0x10,0,0);}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
