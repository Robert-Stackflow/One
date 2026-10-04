import {execFile,spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {promisify} from 'node:util';
import {join} from 'node:path';
import {globalShortcut,shell} from 'electron';
import {foreground} from './native';
import {focusedProgramPath} from './focused-program';
import type {SearchSettings,SearchContext} from '../shared/search';
const execute=promisify(execFile);
export class SearchBridge {
 private helper=join(__dirname,'../native/One.Search.exe').replace('app.asar\\','app.asar.unpacked\\');private child:ChildProcessWithoutNullStreams|null=null;private restart?:NodeJS.Timeout;private stopped=false;private shortcuts:string[]=[];private config?:SearchSettings;private recording=false;private lastExplorer=0;error='';
 private requests=new Map<number,{resolve:(value:SearchContext)=>void;reject:(error:Error)=>void;timer:NodeJS.Timeout}>();private request=0;
 constructor(private show:(kind:SearchContext['kind'],hwnd:number,typing:boolean,focus?:number)=>void,private changed:()=>void,private notify:(message:string)=>void=()=>{}){}
 async context(hwnd=foreground()?.hwnd||0,focus=0):Promise<SearchContext>{let value:SearchContext;if(this.child?.stdin.writable){value=await new Promise<SearchContext>((resolve,reject)=>{const id=++this.request,timer=setTimeout(()=>{this.requests.delete(id);reject(new Error('资源管理器上下文读取超时'));},4000);this.requests.set(id,{resolve,reject,timer});this.child!.stdin.write(`context ${id} ${hwnd} ${focus}\n`);});}else{const {stdout}=await execute(this.helper,['context',String(hwnd),String(focus)],{windowsHide:true,timeout:4000,maxBuffer:1024*1024});value=JSON.parse(stdout);}value.folders.sort((a,b)=>Number(b.hwnd===this.lastExplorer)-Number(a.hwnd===this.lastExplorer)||Number(b.active)-Number(a.active));return value;}
 private cancelRequests(){for(const r of this.requests.values()){clearTimeout(r.timer);r.reject(new Error('资源管理器连接已重置'));}this.requests.clear();}

 async jump(context:SearchContext,path:string){if(!context.hwnd||!context.created)throw new Error('目标窗口已失效，请重新打开搜索');try{await execute(this.helper,['jump',String(context.hwnd),String(context.pid),context.created,path,String(context.tab||0)],{windowsHide:true,timeout:4000});}catch(error){if(context.kind==='dialog')throw new Error('当前文件对话框无法直接跳转到该目录',{cause:error});throw error;}}
 async focus(context:SearchContext){if(context.hwnd&&context.created)await execute(this.helper,['focus',String(context.hwnd),String(context.pid),context.created],{windowsHide:true,timeout:4000});}
 activate(hwnd:number){if(!this.child?.stdin.writable)return false;this.child.stdin.write(`focus ${hwnd}\n`);return true;}
 replay(hwnd:number){this.child?.stdin.write(`replay ${hwnd}\n`);}
 update(settings:SearchSettings,attempt=0){clearTimeout(this.restart);this.stopped=false;this.config=settings;this.register();this.cancelRequests();this.child?.stdin.end('stop\n');this.child?.kill();this.child=null;const flags=Number(settings.doubleCtrl)|Number(settings.explorerTyping)<<1|Number(settings.explorerMenu)<<2|Number(settings.dialogSwitch)<<3;if(!flags||this.recording)return;const child=spawn(this.helper,['watch',String(flags),String(process.pid)],{windowsHide:true,stdio:'pipe',env:{...process.env,ONE_TEST_MODE:'0'}});this.child=child;child.stdin.on('error',()=>{});let buffer='';child.stdout.setEncoding('utf8');child.stdout.on('data',data=>{buffer+=data;if(buffer.length>1024*1024){buffer='';return;}let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);try{const event=JSON.parse(line);if(this.child!==child)continue;if(event.event==='context'){const r=this.requests.get(event.request);if(r){this.requests.delete(event.request);clearTimeout(r.timer);if(event.error)r.reject(new Error(event.error));else r.resolve(event.value);}}else if(event.event==='error'){this.error=event.message;this.changed();}else if(event.event==='explorer-active')this.lastExplorer=event.hwnd;else if(['search','typing','menu','dialog'].includes(event.event)){if(event.event==='typing'||event.event==='menu')this.lastExplorer=event.hwnd;this.show(event.event==='typing'?'explorer':event.event,event.hwnd,event.event==='typing',event.focus||0);}}catch{}}});child.on('error',e=>{this.error=e.message;this.changed();});child.on('close',()=>{if(this.child===child){this.child=null;this.cancelRequests();this.error=attempt<3?'正在重新连接资源管理器…':'资源管理器连接失败，请重启 One';this.changed();if(attempt<3&&!this.stopped)this.restart=setTimeout(()=>{if(this.config&&!this.recording&&!this.stopped)this.update(this.config,attempt+1);},1000*(attempt+1));}});}
 private unregister(){for(const shortcut of this.shortcuts)globalShortcut.unregister(shortcut);this.shortcuts=[];}
 private register(){
  this.unregister();this.error='';if(!this.config||this.recording){this.changed();return;}
  const failures:string[]=[];
  const register=(value:string,label:string,run:()=>void)=>{
   if(!value)return;const key=value.replace(/\bCtrl\b/gi,'Control').replace(/\b(Win|Meta)\b/gi,'Super');
   try{if(!globalShortcut.register(key,run))failures.push(label+'快捷键已被占用');else this.shortcuts.push(key);}catch{failures.push(label+'快捷键无法注册，请更换组合键');}
  };
  register(this.config.shortcut,'搜索',()=>{const source=foreground(true);this.show('search',source?.hwnd||0,false,source?.focus||0);});
  register(this.config.programShortcut,'程序定位',()=>{try{shell.showItemInFolder(focusedProgramPath());}catch(error){this.notify((error as Error).message);}});
  this.error=failures.join(' · ');this.changed();
 }
 record(value:boolean){if(this.recording===value)return;this.recording=value;if(this.config)this.update(this.config);}
 stop(){this.stopped=true;this.cancelRequests();clearTimeout(this.restart);this.unregister();const child=this.child;this.child=null;child?.stdin.end('stop\n');child?.kill();}
}
