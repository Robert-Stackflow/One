import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {watch,type FSWatcher} from 'node:fs';
import {join,resolve} from 'node:path';
import type {SearchSettings,SearchState,SearchResult} from '../shared/search';
export class SearchService {
 private child:ChildProcessWithoutNullStreams;private serial=0;private pending=new Map<number,{resolve:(r:SearchResult)=>void;reject:(e:Error)=>void;timer:NodeJS.Timeout;progress?:(r:SearchResult)=>void}>();
 private value:SearchState={running:false,count:0,scanned:0,issues:0,root:'',updated:0,error:'',watching:false};
 private watchers:FSWatcher[]=[];private paths=new Set<string>();private timer?:NodeJS.Timeout;private stopped=false;private watchError='';
 private restartTimer?:NodeJS.Timeout;private healthyTimer?:NodeJS.Timeout;private restartAttempts=0;private launcherItems:import('../shared/search').SearchEntry[]=[];
 private cache:string;private resync=false;private resyncUrgent=false;private resyncDue=0;private resyncTimer?:NodeJS.Timeout;
 private lastFullCheck=Date.now();private fullCheckPending=true;
 constructor(cache:string,private settings:SearchSettings,private changed:(s:SearchState)=>void,private backend:'memory'|'disk'='disk'){
  this.cache=resolve(cache.replace(/\.ndjson$/,'.bin'));
  this.child=this.spawnHelper();this.startWatch();this.send({type:'init',settings});
 }
 private spawnHelper(){
  const child=spawn(join(__dirname,'../native/One.Index.exe').replace('app.asar\\','app.asar.unpacked\\'),this.backend==='disk'?['mapped-service',this.cache]:[this.cache],{windowsHide:true,stdio:'pipe'});
  let buffer='';child.stdout.setEncoding('utf8');child.stdout.on('data',part=>{if(this.stopped||this.child!==child)return;buffer+=part;if(buffer.length>8*1024*1024){this.helperFailed(child,new Error('搜索服务响应过大'));return;}let at;while((at=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,at);buffer=buffer.slice(at+1);try{const message=JSON.parse(line);if(message.state){this.value={...message.state,watching:this.watchers.length===this.settings.roots.length&&!!this.watchers.length,error:[message.state.error,message.state.cacheError,this.watchError].filter(Boolean).join(' · ')};this.changed(this.value);if(!this.value.running)this.settled();}else{const p=this.pending.get(message.id);if(!p)continue;if(message.result?.partial){p.progress?.(message.result);continue;}this.pending.delete(message.id);clearTimeout(p.timer);message.error?p.reject(new Error(message.error)):p.resolve(message.result);}}catch{this.helperFailed(child,new Error('搜索服务返回了无效数据'));return;}}});
  child.on('error',error=>this.helperFailed(child,error));child.on('exit',()=>this.helperFailed(child,new Error('搜索服务已退出')));child.stdin.on('error',()=>{});child.stderr.resume();return child;
 }
 private helperFailed(child:ChildProcessWithoutNullStreams,error:Error){
  if(this.stopped||this.child!==child||this.restartTimer)return;
  clearTimeout(this.healthyTimer);if(child.exitCode===null&&child.signalCode===null)child.kill();
  this.failed(error);
  // Keep retrying after transient launch failures, with a bounded delay.
  // Three failures used to leave search unavailable until One restarted.
  const delay=[250,1000,3000,10000,30000][this.restartAttempts];
  this.restartAttempts=Math.min(this.restartAttempts+1,4);
  this.value={...this.value,error:'搜索服务正在恢复'};this.changed(this.value);
  this.restartTimer=setTimeout(()=>{this.restartTimer=undefined;if(this.stopped)return;this.child=this.spawnHelper();this.healthyTimer=setTimeout(()=>{if(!this.stopped)this.restartAttempts=0;},30000);this.healthyTimer.unref();try{this.send({type:'init',settings:this.settings});if(this.launcherItems.length)this.send({type:'launchers',items:this.launcherItems});}catch(e){this.helperFailed(this.child,e as Error);}},delay);
 }
 private available(){return !this.stopped&&this.child.exitCode===null&&this.child.signalCode===null&&this.child.stdin.writable&&!this.child.stdin.destroyed;}
 private send(value:unknown){
  if(!this.available()){
   const error=new Error('搜索服务不可用');
   if(!this.stopped)this.helperFailed(this.child,error);
   throw error;
  }
  try{this.child.stdin.write(JSON.stringify(value)+'\n');}
  catch(error){this.helperFailed(this.child,error as Error);throw error;}
 }
 private failed(error:Error){this.value={...this.value,running:false,error:error.message};this.changed(this.value);for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear();}
 private queueResync(urgent=false){
  this.resync=true;
  if(urgent)this.resyncUrgent=true;
  // A nameless Windows notification cannot identify a changed path. Keep an
  // eventual whole-index check, but do not run one for every such notification.
  const due=urgent?Date.now():Math.max(Date.now()+300,this.lastFullCheck+5*60_000);
  if(!this.resyncDue||due<this.resyncDue)this.resyncDue=due;
  this.scheduleResync();
 }
 private scheduleResync(){
  clearTimeout(this.resyncTimer);this.resyncTimer=undefined;
  if(!this.resync)return;
  const delay=this.resyncDue-Date.now();
  if(delay>0)this.resyncTimer=setTimeout(()=>{this.resyncTimer=undefined;this.flush();},delay);
 }
 private settled(){
  if(this.fullCheckPending){
   this.fullCheckPending=false;this.lastFullCheck=Date.now();
   if(this.resync&&!this.resyncUrgent){this.resyncDue=Math.max(this.resyncDue,this.lastFullCheck+5*60_000);this.scheduleResync();}
  }
  this.flush();
 }
 private isCache(path:string){const p=resolve(path).toLowerCase(),c=this.cache.toLowerCase();return p===c||p===c+'.tmp'||p===c+'.lock'||p===c+'.delta'||p===c+'.mapped'||p.startsWith(c+'.mapped\\')||p.startsWith(c+'.')&&/^(?:\d+\.\d+|\d+\.init)\.tmp$/.test(p.slice(c.length+1));}
 private startWatch(){for(const w of this.watchers)w.close();this.watchers=[];this.watchError='';this.paths.clear();this.resync=false;this.resyncUrgent=false;this.resyncDue=0;clearTimeout(this.resyncTimer);this.resyncTimer=undefined;clearTimeout(this.timer);this.timer=undefined;for(const root of this.settings.roots)try{const w=watch(root,{recursive:true},(_,name)=>{if(!name){this.queueResync();}else{const path=join(root,name.toString()),key=path.toLowerCase();if(this.settings.excluded.some(x=>key===x.toLowerCase()||key.startsWith(x.toLowerCase().replace(/[\\/]$/,'')+'\\'))||this.isCache(path))return;this.paths.add(path);if(this.paths.size>10000){this.paths.clear();this.queueResync(true);}}if(!this.timer)this.timer=setTimeout(()=>{this.timer=undefined;this.flush();},300);});w.on('error',()=>{this.watchError='部分目录监听中断，请重新扫描';this.value.error=this.watchError;this.value.watching=false;this.queueResync(true);this.changed(this.value);this.flush();});this.watchers.push(w);}catch{this.watchError='部分目录无法监听，请手动刷新';}}
 private flush(){
  if(this.stopped||this.value.running)return;
  const due=this.resync&&Date.now()>=this.resyncDue;
  if(due){
   this.paths.clear();this.resync=false;this.resyncUrgent=false;this.resyncDue=0;clearTimeout(this.resyncTimer);this.resyncTimer=undefined;
   try{this.fullCheckPending=true;this.value.running=true;this.send({type:'resync'});}catch(error){this.failed(error as Error);}
   return;
  }
  if(this.paths.size){const paths=[...this.paths];this.paths.clear();try{this.send({type:'changes',paths});}catch(error){this.failed(error as Error);}}
  if(this.resync)this.scheduleResync();
 }
 // The helper compiles current priority rules without invalidating the file cache.
 configure(settings:SearchSettings){this.settings=settings;}
 state(){return this.value;}
 rebuild(settings:SearchSettings){this.settings=settings;this.startWatch();this.fullCheckPending=true;this.value={...this.value,running:true};this.changed(this.value);this.send({type:'rebuild',settings});}
 cancel(){this.send({type:'cancel'});}
 query(query:unknown,foldersOnly:unknown=false,currentFolder='',scope=0,includeLaunchers=false,progress?:(r:SearchResult)=>void){if(typeof query!=='string'||query.length>1000||typeof foldersOnly!=='boolean')throw new Error('搜索条件无效');const id=++this.serial;return new Promise<SearchResult>((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('搜索超时，请缩小条件后重试'));},15000);this.pending.set(id,{resolve,reject,timer,progress});try{this.send({type:'query',id,query,scope,includeLaunchers,foldersOnly,currentFolder,progressive:!!progress,priorities:this.settings.priorities??[],fuzzy:this.settings.fuzzy,pinyin:this.settings.pinyin});}catch(e){clearTimeout(timer);this.pending.delete(id);reject(e);}});}
 launchers(items:import('../shared/search').SearchEntry[]){this.launcherItems=items;try{if(this.available())this.send({type:'launchers',items});}catch(error){this.helperFailed(this.child,error as Error);}}
 releaseScope(scope:number){
  // A window may close in the same turn that the helper exits. Releasing its
  // query is best effort; a dead helper has no scope left to release.
  try{if(this.available())this.send({type:'release-query',scope});}catch{}
 }
 stop(){this.stopped=true;clearTimeout(this.timer);clearTimeout(this.resyncTimer);clearTimeout(this.restartTimer);clearTimeout(this.healthyTimer);for(const w of this.watchers)w.close();this.failed(new Error('搜索已关闭'));const child=this.child;return new Promise<void>(resolve=>{if(child.exitCode!==null||child.signalCode!==null||!child.pid){resolve();return;}const timer=setTimeout(()=>child.kill(),10000);child.once('exit',()=>{clearTimeout(timer);child.stdin.destroy();child.stdout.destroy();child.stderr.destroy();resolve();});if(child.stdin.writable&&!child.stdin.destroyed)child.stdin.end(JSON.stringify({type:'stop'})+'\n');else child.kill();});}
}
