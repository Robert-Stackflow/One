// Exercise real menu creation/IPC in an isolated Electron instance without installing global hooks.
async function installMenuBridge(app){
 await app.evaluate(()=>{
  const childProcess=process.getBuiltinModule('child_process'),{EventEmitter}=process.getBuiltinModule('events'),spawn=childProcess.spawn;
  globalThis.popupMainErrors=[];process.on('uncaughtException',e=>globalThis.popupMainErrors.push(String(e)));process.on('unhandledRejection',e=>globalThis.popupMainErrors.push(String(e)));
  childProcess.spawn=function(file,args,options){
   if(!/One\.Search\.exe$/i.test(file)||args[0]!=='watch')return spawn.call(this,file,args,options);
   const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin=new EventEmitter();child.stdout.setEncoding=()=>child.stdout;child.stdin.writable=true;
   child.stdin.end=()=>{child.stdin.writable=false;};child.kill=()=>{setImmediate(()=>child.emit('close',0));return true;};
   child.stdin.write=text=>{const [command,id]=text.trim().split(' ');if(command==='context')setImmediate(()=>child.stdout.emit('data',JSON.stringify({event:'context',request:Number(id),value:{kind:'menu',hwnd:0,pid:0,created:'',folders:[]}})+'\n'));return true;};
   globalThis.popupBridge=child;return child;
  };
 });
}
const triggerMenuBridge=app=>app.evaluate(()=>globalThis.popupBridge.stdout.emit('data',JSON.stringify({event:'menu',hwnd:0})+'\n'));
module.exports={installMenuBridge,triggerMenuBridge};
