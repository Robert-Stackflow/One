import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {join} from 'node:path';
import type {NativePreviewBounds,NativePreviewState} from '../shared/native-preview';
interface PreviewWindow {isDestroyed():boolean;getNativeWindowHandle():Buffer;webContents:{getZoomFactor():number}}
interface Session {token:string;child?:ChildProcessWithoutNullStreams;stopped:boolean;ready:boolean;bounds:NativePreviewBounds;task:Promise<NativePreviewState>;finish?:()=>void}
const missing='未找到可用的表格预览组件。请安装或修复 Excel/WPS 的预览组件，或用默认程序打开。';
const failed='原生表格预览加载失败。可以重试，或用默认程序打开。';
export class NativePreviewService {
 private sessions=new Map<number,Session>();
 constructor(private paths=()=>['One.Preview.exe','One.Preview32.exe'].map(name=>join(__dirname,'../native',name).replace('app.asar\\','app.asar.unpacked\\')),private timeout=12000){}
 start(owner:number,token:string,window:PreviewWindow,file:string,bounds:NativePreviewBounds,notify:(state:NativePreviewState)=>void,escape:()=>void):Promise<NativePreviewState>{
  const previous=this.sessions.get(owner);if(previous?.token===token){this.resize(owner,token,bounds,window);return previous.task;}
  this.stop(owner);const session:Session={token,stopped:false,ready:false,bounds,task:Promise.resolve({token,status:'error'})};this.sessions.set(owner,session);
  session.task=(async()=>{
   let state:NativePreviewState={token,status:'error',message:missing};
   for(const executable of this.paths()){
    if(session.stopped||window.isDestroyed())return {token,status:'error',message:'预览已取消'};
    const value=await this.attempt(session,executable,window,file,notify,escape);
    if(value.status==='ready')return value;
    // Try the other architecture for missing registration or activation failure.
    if(value.message!==missing)state=value;
   }
   if(!session.stopped){notify(state);this.sessions.delete(owner);}return state;
  })();return session.task;
 }
 private attempt(session:Session,executable:string,window:PreviewWindow,file:string,notify:(state:NativePreviewState)=>void,escape:()=>void):Promise<NativePreviewState>{
  return new Promise(resolve=>{
   const token=session.token,zoom=window.webContents.getZoomFactor(),b=session.bounds,handle=window.getNativeWindowHandle(),hwnd=handle.length>=8?handle.readBigUInt64LE():BigInt(handle.readUInt32LE());
   const child=spawn(executable,[String(hwnd),String(process.pid),file,...[b.x,b.y,b.width,b.height].map(n=>String(n*zoom))],{windowsHide:true,stdio:'pipe'});session.child=child;
   let settled=false,buffer='',lastError:NativePreviewState|undefined;
   const finish=(state:NativePreviewState)=>{if(settled)return;settled=true;clearTimeout(timer);session.finish=undefined;resolve(state);};
   session.finish=()=>finish({token,status:'error',message:'预览已取消'});
   const fail=(message:string,code?:string)=>{const state:NativePreviewState={token,status:'error',message,code};lastError=state;if(session.ready&&!session.stopped){notify(state);session.ready=false;}finish(state);if(!child.killed)child.kill();};
   const timer=setTimeout(()=>fail('原生表格预览加载超时。可以重试，或用默认程序打开。'),this.timeout);
   child.stdin.on('error',()=>{});child.stderr.resume();child.stdout.setEncoding('utf8');
   child.on('error',()=>fail('原生预览宿主不可用，请重新构建或安装 One。'));
   child.on('exit',()=>{if(session.child===child&&session.ready&&!session.stopped){session.ready=false;notify({token,status:'error',message:'原生预览组件已退出。可以重试，或用默认程序打开。'});}finish(lastError||{token,status:'error',message:session.stopped?'预览已取消':failed});});
   child.stdout.on('data',(chunk:string)=>{
    buffer+=chunk;if(buffer.length>8192){fail(failed);return;}let end:number;
    while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);let value:{status?:string;event?:string;code?:string};try{value=JSON.parse(line);}catch{fail(failed);return;}
     if(session.stopped||session.child!==child)continue;
     if(value.event==='escape'){escape();continue;}
     if(value.status==='ready'){session.ready=true;const state:NativePreviewState={token,status:'ready'};finish(state);notify(state);this.writeRect(session,window);}
     else if(value.status)fail(value.status==='missing'?missing:failed,typeof value.code==='string'?value.code.slice(0,32):undefined);
    }
   });
  });
 }
 private writeRect(session:Session,window:PreviewWindow){const child=session.child;if(!child||child.killed||!child.stdin.writable||window.isDestroyed())return;const z=window.webContents.getZoomFactor(),b=session.bounds;child.stdin.write('rect '+[b.x,b.y,b.width,b.height].map(n=>Math.round(n*z*100)/100).join(' ')+'\n');}
 resize(owner:number,token:string,bounds:NativePreviewBounds,window:PreviewWindow){const session=this.sessions.get(owner);if(session?.token!==token||session.stopped)return;session.bounds=bounds;if(session.ready)this.writeRect(session,window);}
 stop(owner:number,token?:string){const session=this.sessions.get(owner);if(!session||token&&session.token!==token)return;this.sessions.delete(owner);session.stopped=true;session.finish?.();const child=session.child;if(!child)return;child.stdin.end('close\n');const timer=setTimeout(()=>{if(child.exitCode===null&&!child.killed)child.kill();},800);timer.unref();child.once('exit',()=>clearTimeout(timer));}
 stopAll(){for(const owner of this.sessions.keys())this.stop(owner);}
}
