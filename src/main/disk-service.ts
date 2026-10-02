import {watch,type FSWatcher} from 'node:fs';
import {lstat,readdir} from 'node:fs/promises';
import {basename,dirname,join,relative,resolve} from 'node:path';
import {nativeScan} from './native-scan';
import type {ScanNode,ScanProgress,ScanSummary} from '../shared/types';

/** One initial native scan, then reconcile changed paths and their ancestors only. */
export class DiskService {
 private nodes=new Map<string,ScanNode>();private children=new Map<string,Set<string>>();
 private watcher?:FSWatcher;private pending=new Set<string>();private timer?:NodeJS.Timeout;
 private job?:ReturnType<typeof nativeScan>;private revision=0;private busy=false;private active=false;private root='';
 private files=0;private directories=0;private issues=0;private dirty=new Map<string,ScanNode>();private removed:string[]=[];
 constructor(private emit:(p:ScanProgress)=>void){}
 private key(p:string){return resolve(p).toLowerCase();}
 private inside(p:string){const r=relative(this.root,p);return !r.startsWith('..')&&!r.includes(':');}
 private store(n:ScanNode){const k=this.key(n.path);this.nodes.set(k,n);if(n.parent){const p=this.key(n.parent);if(!this.children.has(p))this.children.set(p,new Set());this.children.get(p)!.add(k);}}
 start(path:string,complete:(r?:ScanSummary,error?:string)=>void){
  this.stop();const generation=++this.revision;this.root=resolve(path);this.active=true;this.busy=true;this.nodes.clear();this.children.clear();this.dirty.clear();this.removed=[];this.files=0;this.directories=0;this.issues=0;
  let watchError='';
  try{this.watcher=watch(this.root,{recursive:true},(_,name)=>{if(!this.active||generation!==this.revision)return;this.pending.add(name?join(this.root,name.toString()):this.root);if(this.pending.size>10000){this.pending.clear();this.pending.add(this.root);}this.schedule();});this.watcher.on('error',e=>{watchError=e.message;this.watcher?.close();this.watcher=undefined;this.send('stopped',e.message);});}catch(e){watchError=(e as Error).message;}
  this.job=nativeScan(this.root,p=>{if(generation!==this.revision)return;for(const n of p.nodes)this.store(n);this.files=p.files;this.directories=p.directories;this.issues=p.issues;this.emit({...p,phase:'scan'});},(result,error)=>{
   if(generation!==this.revision){complete(undefined,'扫描已取消');return;}this.job=undefined;this.busy=false;
   if(error){this.active=false;this.watcher?.close();this.watcher=undefined;complete(undefined,error);return;}
   complete(result);this.send(this.watcher?'watch':'stopped',watchError);this.schedule();
  });
 }
 private schedule(){clearTimeout(this.timer);if(this.active)this.timer=setTimeout(()=>void this.flush(),250);}
 private send(phase:ScanProgress['phase'],error=''){this.emit({rootPath:this.root,path:this.root,bytes:this.nodes.get(this.key(this.root))?.size||0,files:this.files,directories:this.directories,issues:this.issues,nodes:[...this.dirty.values()],removed:this.removed,phase,error});this.dirty.clear();this.removed=[];}
 private ancestors(parent:string|null,delta:number){while(parent){const n=this.nodes.get(this.key(parent));if(!n)break;n.size=Math.max(0,n.size+delta);this.dirty.set(this.key(n.path),{...n});parent=n.parent;}}
 private remove(k:string){const node=this.nodes.get(k);if(!node)return;this.ancestors(node.parent,-node.size);const walk=(key:string)=>{const n=this.nodes.get(key);if(!n)return;for(const child of this.children.get(key)||[])walk(child);if(n.issue)this.issues=Math.max(0,this.issues-1);else if(n.directory)this.directories=Math.max(0,this.directories-1);else this.files=Math.max(0,this.files-1);this.nodes.delete(key);this.children.delete(key);this.dirty.delete(key);this.removed.push(n.path);};walk(k);if(node.parent)this.children.get(this.key(node.parent))?.delete(k);}
 private async allowed(path:string){let p=path;while(this.inside(p)){try{if((await lstat(p)).isSymbolicLink())return false;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}if(this.key(p)===this.key(this.root))break;p=dirname(p);}return this.inside(path);}
 private async reconcile(path:string,generation:number){
  if(!await this.allowed(path)||generation!==this.revision)return;
  const k=this.key(path),old=this.nodes.get(k);let stat;try{stat=await lstat(path);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT'){this.remove(k);return;}throw e;}
  if(generation!==this.revision)return;if(stat.isSymbolicLink())return;
  if(stat.isDirectory()&&old?.directory){
   const entries=await readdir(path,{withFileTypes:true});if(generation!==this.revision)return;const seen=new Set(entries.map(e=>this.key(join(path,e.name))));
   for(const child of [...this.children.get(k)||[]])if(!seen.has(child))this.remove(child);
   for(const e of entries)if(!e.isSymbolicLink())this.pending.add(join(path,e.name));return;
  }
  if(old)this.remove(k);
  if(stat.isDirectory()){
   const subtree=new Map<string,ScanNode>();await new Promise<void>((resolve,reject)=>{this.job=nativeScan(path,p=>{for(const n of p.nodes)subtree.set(this.key(n.path),n);},(_,error)=>error?reject(new Error(error)):resolve());});if(generation!==this.revision)return;this.job=undefined;
   for(const n of subtree.values()){if(this.key(n.path)===k)n.parent=this.key(path)===this.key(this.root)?null:dirname(path);this.store(n);this.dirty.set(this.key(n.path),n);if(n.issue)this.issues++;else if(n.directory)this.directories++;else this.files++;}
   this.ancestors(subtree.get(k)?.parent||null,subtree.get(k)?.size||0);
  }else if(stat.isFile()){
   const node:ScanNode={path,name:basename(path),parent:this.key(path)===this.key(this.root)?null:dirname(path),directory:false,size:stat.size,modified:stat.mtimeMs};this.store(node);this.dirty.set(k,node);this.files++;this.ancestors(node.parent,node.size);
  }
 }
 private async flush(){
  if(!this.active||this.busy||!this.pending.size)return;this.busy=true;const generation=this.revision;this.send('update');
  try{let count=0;while(this.pending.size&&generation===this.revision&&count++<128){const p=this.pending.values().next().value!;this.pending.delete(p);await this.reconcile(p,generation);if(this.dirty.size+this.removed.length>1800)this.send('update');}if(generation===this.revision)this.send(this.watcher?'watch':'stopped');}
  catch(e){if(generation===this.revision)this.send('watch',(e as Error).message);}
  finally{if(generation===this.revision){this.busy=false;if(this.pending.size)this.schedule();}}
 }
 stop(){this.active=false;this.revision++;clearTimeout(this.timer);this.pending.clear();this.watcher?.close();this.watcher=undefined;this.job?.kill();this.job=undefined;this.busy=false;}
}
