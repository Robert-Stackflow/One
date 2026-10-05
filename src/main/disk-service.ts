import {watch,type FSWatcher} from 'node:fs';
import {lstat,readdir} from 'node:fs/promises';
import {basename,dirname,join,relative,resolve} from 'node:path';
import {nativeScan} from './native-scan';
import {ScanNodeStore,scanNodePatch,type StoredScanNode} from './scan-node-store';
import type {ScanNode,ScanProgress,ScanSummary} from '../shared/types';

/** One initial native scan, then reconcile changed paths and their ancestors only. */
export class DiskService {
 private nodes=new Map<string,StoredScanNode>();private children=new Map<string,Set<string>>();private nodeStore=new ScanNodeStore();
 private watcher?:FSWatcher;private pending=new Set<string>();private changedDuringScan=new Set<string>();private timer?:NodeJS.Timeout;
 private job?:ReturnType<typeof nativeScan>;private revision=0;private busy=false;private scanning=false;private initialUpdating=false;private active=false;private root='';
 // File events are overlaid on native progress until the scan finishes; otherwise later native batches restore stale sizes.
 private overlays=new Map<string,{base:ScanNode|null;live:ScanNode|null}>();private baseAncestors=new Map<string,number>();
 private files=0;private directories=0;private issues=0;private dirty=new Map<string,ScanNode>();private removed:string[]=[];
 constructor(private emit:(p:ScanProgress)=>void){}
 state(){return {running:this.active&&this.busy,root:this.root,files:this.files,directories:this.directories};}
 private key(p:string){return resolve(p).toLowerCase();}
 private inside(p:string){const r=relative(this.root,p);return !r.startsWith('..')&&!r.includes(':');}
 private store(n:ScanNode){const k=this.key(n.path),old=this.nodes.get(k);if(old)this.nodeStore.release(old);const stored=this.nodeStore.retain(n);this.nodes.set(k,stored);if(n.parent){const p=this.key(n.parent);if(!this.children.has(p))this.children.set(p,new Set());this.children.get(p)!.add(k);}return stored;}
 start(path:string,complete:(r?:ScanSummary,error?:string)=>void){
  this.stop();const generation=++this.revision;this.root=resolve(path);this.active=true;this.busy=true;this.scanning=true;this.nodes.clear();this.nodeStore.clear();this.children.clear();this.dirty.clear();this.removed=[];this.overlays.clear();this.baseAncestors.clear();this.changedDuringScan.clear();this.files=0;this.directories=0;this.issues=0;
  let watchError='';
  try{this.watcher=watch(this.root,{recursive:true},(_,name)=>{if(!this.active||generation!==this.revision)return;this.pending.add(name?join(this.root,name.toString()):this.root);if(this.pending.size>10000){this.pending.clear();this.pending.add(this.root);}this.schedule();});this.watcher.on('error',e=>{watchError=e.message;this.watcher?.close();this.watcher=undefined;this.send('stopped',e.message);});}catch(e){watchError=(e as Error).message;}
  this.job=nativeScan(this.root,p=>{if(generation!==this.revision)return;const patches=new Map<string,ScanNode>();for(const n of p.nodes){const k=this.key(n.path),overlay=this.overlays.get(k);if(overlay){overlay.base=scanNodePatch(n);if(overlay.live)patches.set(k,overlay.live);continue;}this.store(n);patches.set(k,n);if(this.baseAncestors.has(k))this.baseAncestors.set(k,n.size);}this.baseAncestors.set(this.key(this.root),p.bytes);this.applyOverlays(patches);this.files=p.files+this.overlayFileDelta();this.directories=p.directories;this.issues=p.issues;this.emit({...p,bytes:this.nodes.get(this.key(this.root))?.size||0,files:this.files,nodes:[...patches.values()].map(scanNodePatch),phase:'scan'});},(result,error)=>{
   if(generation!==this.revision){complete(undefined,'扫描已取消');return;}this.job=undefined;this.busy=false;this.scanning=false;
   if(error){this.active=false;this.watcher?.close();this.watcher=undefined;complete(undefined,error);return;}
   for(const path of this.changedDuringScan)this.pending.add(path);this.changedDuringScan.clear();this.overlays.clear();this.baseAncestors.clear();
   complete(result?{...result,bytes:this.nodes.get(this.key(this.root))?.size||result.bytes,files:this.files,directories:this.directories}:result);this.send(this.watcher?'watch':'stopped',watchError);this.schedule();
  });
 }
 private schedule(){clearTimeout(this.timer);if(this.active)this.timer=setTimeout(()=>void (this.scanning?this.flushDuringScan():this.flush()),250);}
 private overlayFileDelta(){let delta=0;for(const {base,live} of this.overlays.values())delta+=Number(!!live)-Number(!!base);return delta;}
 private overlayDeltas(){const deltas=new Map<string,number>();for(const {base,live} of this.overlays.values()){let parent=live?.parent||base?.parent;const delta=(live?.size||0)-(base?.size||0);while(parent){const k=this.key(parent);deltas.set(k,(deltas.get(k)||0)+delta);parent=dirname(parent);if(k===this.key(this.root))break;}}return deltas;}
 private applyOverlays(patches:Map<string,ScanNode>){const deltas=this.overlayDeltas();for(const [k,base] of this.baseAncestors){const node=this.nodes.get(k);if(!node)continue;node.size=Math.max(0,base+(deltas.get(k)||0));if(deltas.has(k))patches.set(k,node);}}
 private async flushDuringScan(){
  if(!this.active||!this.scanning||this.initialUpdating||!this.pending.size)return;this.initialUpdating=true;const generation=this.revision;
  try{let count=0;while(this.pending.size&&generation===this.revision&&this.scanning&&count++<128){const path=this.pending.values().next().value!;this.pending.delete(path);this.changedDuringScan.add(path);if(!this.inside(path)||!await this.allowed(path))continue;const k=this.key(path),old=this.nodes.get(k);let stat;try{stat=await lstat(path);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')continue;}
    if(generation!==this.revision||!this.scanning)break;
    if(stat?.isDirectory()){if(old?.directory){const entries=await readdir(path,{withFileTypes:true});if(generation!==this.revision||!this.scanning)break;const present=new Set(entries.map(e=>this.key(join(path,e.name))));for(const child of this.children.get(k)||[])if(!present.has(child))this.pending.add(this.nodes.get(child)?.path||child);for(const entry of entries)if(entry.isFile()&&(entries.length<512||!this.nodes.has(this.key(join(path,entry.name)))))this.pending.add(join(path,entry.name));}continue;}
    if(stat&&!stat.isFile()||old?.directory||!old&&!stat||!old&&!this.nodes.has(this.key(dirname(path))))continue;
    const previous=this.overlays.get(k),base=previous?previous.base:old?scanNodePatch(old):null;
    if(!previous){const currentDeltas=this.overlayDeltas();let parent=dirname(path);while(this.inside(parent)){const a=this.key(parent),node=this.nodes.get(a);if(node&&!this.baseAncestors.has(a))this.baseAncestors.set(a,node.size-(currentDeltas.get(a)||0));if(a===this.key(this.root))break;parent=dirname(parent);}}
    const live:ScanNode|null=stat?{path,name:basename(path),parent:dirname(path),directory:false,size:stat.size,modified:stat.mtimeMs}:null;
    this.overlays.set(k,{base,live});const patches=new Map<string,ScanNode>();if(live){this.store(live);patches.set(k,live);}else if(old){this.nodes.delete(k);this.nodeStore.release(old);this.children.get(this.key(old.parent!))?.delete(k);}
    this.applyOverlays(patches);this.files+=Number(!!live)-Number(!!previous?.live)+Number(!!previous?.base)-Number(!!base);
    this.emit({rootPath:this.root,path:this.root,bytes:this.nodes.get(this.key(this.root))?.size||0,files:this.files,directories:this.directories,issues:this.issues,nodes:[...patches.values()].map(scanNodePatch),removed:live?undefined:[path],phase:'scan'});
   }}catch{if(generation===this.revision)this.changedDuringScan.add(this.root);}finally{if(generation===this.revision){this.initialUpdating=false;if(!this.scanning){for(const path of this.changedDuringScan)this.pending.add(path);this.changedDuringScan.clear();}if(this.pending.size)this.schedule();}}
 }
 private send(phase:ScanProgress['phase'],error=''){this.emit({rootPath:this.root,path:this.root,bytes:this.nodes.get(this.key(this.root))?.size||0,files:this.files,directories:this.directories,issues:this.issues,nodes:[...this.dirty.values()].map(scanNodePatch),removed:this.removed,phase,error});this.dirty.clear();this.removed=[];}
 private ancestors(parent:string|null,delta:number){while(parent){const n=this.nodes.get(this.key(parent));if(!n)break;n.size=Math.max(0,n.size+delta);this.dirty.set(this.key(n.path),n);parent=n.parent;}}
 private remove(k:string){const node=this.nodes.get(k);if(!node)return;this.ancestors(node.parent,-node.size);const walk=(key:string)=>{const n=this.nodes.get(key);if(!n)return;for(const child of this.children.get(key)||[])walk(child);if(n.issue)this.issues=Math.max(0,this.issues-1);else if(n.directory)this.directories=Math.max(0,this.directories-1);else this.files=Math.max(0,this.files-1);this.nodes.delete(key);this.nodeStore.release(n);this.children.delete(key);this.dirty.delete(key);this.removed.push(n.path);};walk(k);if(node.parent)this.children.get(this.key(node.parent))?.delete(k);}
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
   for(const n of subtree.values()){if(this.key(n.path)===k)n.parent=this.key(path)===this.key(this.root)?null:dirname(path);this.dirty.set(this.key(n.path),this.store(n));if(n.issue)this.issues++;else if(n.directory)this.directories++;else this.files++;}
   this.ancestors(subtree.get(k)?.parent||null,subtree.get(k)?.size||0);
  }else if(stat.isFile()){
   const node:ScanNode={path,name:basename(path),parent:this.key(path)===this.key(this.root)?null:dirname(path),directory:false,size:stat.size,modified:stat.mtimeMs};this.dirty.set(k,this.store(node));this.files++;this.ancestors(node.parent,node.size);
  }
 }
 private async flush(){
  if(!this.active||this.busy||this.initialUpdating||!this.pending.size)return;this.busy=true;const generation=this.revision;this.send('update');
  try{let count=0;while(this.pending.size&&generation===this.revision&&count++<128){const p=this.pending.values().next().value!;this.pending.delete(p);await this.reconcile(p,generation);if(this.dirty.size+this.removed.length>1800)this.send('update');}if(generation===this.revision)this.send(this.watcher?'watch':'stopped');}
  catch(e){if(generation===this.revision)this.send('watch',(e as Error).message);}
  finally{if(generation===this.revision){this.busy=false;if(this.pending.size)this.schedule();}}
 }
 stop(){this.active=false;this.revision++;clearTimeout(this.timer);this.pending.clear();this.changedDuringScan.clear();this.overlays.clear();this.baseAncestors.clear();this.watcher?.close();this.watcher=undefined;this.job?.kill();this.job=undefined;this.busy=false;this.scanning=false;this.initialUpdating=false;}
}
