import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {watch,type FSWatcher} from 'node:fs';
import {join,resolve} from 'node:path';
import type {SearchSettings,SearchState,SearchResult} from '../shared/search';
export class SearchService {
 private child:ChildProcessWithoutNullStreams;private serial=0;private pending=new Map<number,{resolve:(r:SearchResult)=>void;reject:(e:Error)=>void;timer:NodeJS.Timeout;progress?:(r:SearchResult)=>void}>();
 private value:SearchState={running:false,count:0,scanned:0,issues:0,root:'',updated:0,error:'',watching:false};
 private watchers:FSWatcher[]=[];private paths=new Set<string>();private timer?:NodeJS.Timeout;private stopped=false;private watchError='';
 private cache:string;private resync=false;
 constructor(cache:string,private settings:SearchSettings,private changed:(s:SearchState)=>void,backend:'memory'|'disk'='disk'){
  this.cache=resolve(cache.replace(/\.ndjson$/,'.bin'));
  // Both backends share the app protocol and Windows watcher. Memory mode is
  // available as an explicit fallback while cold-storage checks continue.
  this.child=spawn(join(__dirname,'../native/One.Index.exe').replace('app.asar\\','app.asar.unpacked\\'),backend==='disk'?['mapped-service',this.cache]:[this.cache],{windowsHide:true,stdio:'pipe'});
  let buffer='';this.child.stdout.setEncoding('utf8');this.child.stdout.on('data',part=>{buffer+=part;if(buffer.length>8*1024*1024){this.failed(new Error('搜索服务响应过大'));return;}let at;while((at=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,at);buffer=buffer.slice(at+1);try{const message=JSON.parse(line);if(message.state){this.value={...message.state,watching:this.watchers.length===this.settings.roots.length&&!!this.watchers.length,error:[message.state.error,message.state.cacheError,this.watchError].filter(Boolean).join(' · ')};this.changed(this.value);if(!this.value.running)this.flush();}else{const p=this.pending.get(message.id);if(!p)continue;if(message.result?.partial){p.progress?.(message.result);continue;}this.pending.delete(message.id);clearTimeout(p.timer);message.error?p.reject(new Error(message.error)):p.resolve(message.result);}}catch{this.failed(new Error('搜索服务返回了无效数据'));}}});
  this.child.on('error',e=>this.failed(e));this.child.on('exit',()=>{if(!this.stopped)this.failed(new Error('搜索服务已退出，请重新启动 One'));});this.child.stdin.on('error',()=>{});this.child.stderr.resume();this.startWatch();this.send({type:'init',settings});
 }
 private available(){return !this.stopped&&this.child.exitCode===null&&this.child.signalCode===null&&this.child.stdin.writable&&!this.child.stdin.destroyed;}
 private send(value:unknown){if(!this.available())throw new Error('搜索服务不可用');this.child.stdin.write(JSON.stringify(value)+'\n');}
 private failed(error:Error){this.value={...this.value,running:false,error:error.message};this.changed(this.value);for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear();}
 private isCache(path:string){const p=resolve(path).toLowerCase(),c=this.cache.toLowerCase();return p===c||p===c+'.tmp'||p===c+'.lock'||p===c+'.delta'||p===c+'.mapped'||p.startsWith(c+'.mapped\\')||p.startsWith(c+'.')&&/^(?:\d+\.\d+|\d+\.init)\.tmp$/.test(p.slice(c.length+1));}
 private startWatch(){for(const w of this.watchers)w.close();this.watchers=[];this.watchError='';this.paths.clear();this.resync=false;clearTimeout(this.timer);this.timer=undefined;for(const root of this.settings.roots)try{const w=watch(root,{recursive:true},(_,name)=>{if(!name){this.resync=true;}else{const path=join(root,name.toString()),key=path.toLowerCase();if(this.settings.excluded.some(x=>key===x.toLowerCase()||key.startsWith(x.toLowerCase().replace(/[\\/]$/,'')+'\\'))||this.isCache(path))return;this.paths.add(path);if(this.paths.size>10000){this.paths.clear();this.resync=true;}}if(!this.timer)this.timer=setTimeout(()=>{this.timer=undefined;this.flush();},300);});w.on('error',()=>{this.watchError='部分目录监听中断，请重新扫描';this.value.error=this.watchError;this.value.watching=false;this.resync=true;this.changed(this.value);this.flush();});this.watchers.push(w);}catch{this.watchError='部分目录无法监听，请手动刷新';}}
 private flush(){if(this.stopped||this.value.running||!this.paths.size&&!this.resync)return;const paths=[...this.paths],resync=this.resync;this.paths.clear();this.resync=false;try{if(resync){this.value.running=true;this.send({type:'resync'});}else this.send({type:'changes',paths});}catch(error){this.failed(error as Error);}}
 // The helper compiles current priority rules without invalidating the file cache.
 configure(settings:SearchSettings){this.settings=settings;}
 state(){return this.value;}
 rebuild(settings:SearchSettings){this.settings=settings;this.startWatch();this.value={...this.value,running:true};this.changed(this.value);this.send({type:'rebuild',settings});}
 cancel(){this.send({type:'cancel'});}
 query(query:unknown,foldersOnly:unknown=false,currentFolder='',scope=0,includeLaunchers=false,progress?:(r:SearchResult)=>void){if(typeof query!=='string'||query.length>1000||typeof foldersOnly!=='boolean')throw new Error('搜索条件无效');const id=++this.serial;return new Promise<SearchResult>((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('搜索超时，请缩小条件后重试'));},15000);this.pending.set(id,{resolve,reject,timer,progress});try{this.send({type:'query',id,query,scope,includeLaunchers,foldersOnly,currentFolder,progressive:!!progress,priorities:this.settings.priorities??[],fuzzy:this.settings.fuzzy,pinyin:this.settings.pinyin});}catch(e){clearTimeout(timer);this.pending.delete(id);reject(e);}});}
 launchers(items:import('../shared/search').SearchEntry[]){this.send({type:'launchers',items});}
 releaseScope(scope:number){
  // A window may close in the same turn that the helper exits. Releasing its
  // query is best effort; a dead helper has no scope left to release.
  try{if(this.available())this.send({type:'release-query',scope});}catch{}
 }
 stop(){this.stopped=true;clearTimeout(this.timer);for(const w of this.watchers)w.close();this.failed(new Error('搜索已关闭'));return new Promise<void>(resolve=>{if(this.child.exitCode!==null||this.child.signalCode!==null){resolve();return;}const timer=setTimeout(()=>{this.child.kill();},10000);this.child.once('exit',()=>{clearTimeout(timer);this.child.stdin.destroy();this.child.stdout.destroy();this.child.stderr.destroy();resolve();});this.child.stdin.end(JSON.stringify({type:'stop'})+'\n');});}
}
