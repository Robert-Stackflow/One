import { lstat, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { LocalModelStore } from '../local-model-store';
import type { LocalArtifactBundle, LocalModelProgress } from '../../shared/local-models';
import { llamaRuntimeProfiles, type LlamaRuntimeProfile } from './llama-runtime-catalog';
import { extractRuntimeArchive } from './runtime-extract';

type Backend='cpu'|'cuda';
interface Preparation { abort:AbortController; listeners:Map<symbol,(value:LocalModelProgress)=>void>; promise:Promise<void>; latest?:LocalModelProgress }
const profiles=structuredClone(llamaRuntimeProfiles);
function profile(backend:Backend){const value=profiles.find(value=>value.backend===backend);if(!value)throw Error('运行包类型无效');return value;}
const descriptor=(value:LlamaRuntimeProfile,binaries:boolean):LocalArtifactBundle=>({
  id:value.id+(binaries?'-files':'-archives'),revision:value.revision,
  artifacts:binaries?value.files.map((file,index)=>({name:file.name,role:'file-'+index,bytes:file.bytes,sha256:file.sha256,url:value.archives.find(archive=>archive.id===file.archive)!.url})):
    value.archives.map(archive=>({name:archive.name,role:archive.id,bytes:archive.bytes,sha256:archive.sha256,url:archive.url})),
});
/** On-demand, fixed-hash native packages; model weights and runtime binaries have independent leases. */
export class LlamaRuntimeStore {
  private readonly archives:LocalModelStore;
  private readonly binaries:LocalModelStore;
  private readonly jobs=new Map<Backend,Preparation>();
  private closed=false;
  constructor(root:string,transport:typeof fetch=fetch){
    this.archives=new LocalModelStore(join(root,'archives'),transport);
    // Expanded files are import-only. A missing or modified entry must never turn into a raw network fetch.
    this.binaries=new LocalModelStore(join(root,'binaries'),async()=>{throw Error('运行包内容与固定版本不匹配');});
  }
  private platform(){if(process.platform!=='win32'||process.arch!=='x64')throw Error('此原生运行包目前仅支持 Windows x64');}
  async state(backend:Backend,verify=false){
    const value=profile(backend),files=await this.binaries.state(descriptor(value,true),undefined,verify),archives=await this.archives.state(descriptor(value,false),undefined,false);
    return {...files,totalBytes:archives.totalBytes,downloadedBytes:files.ready?archives.totalBytes:archives.downloadedBytes,
      diskBytes:files.diskBytes+archives.diskBytes,downloading:this.jobs.has(backend),inUse:files.inUse||archives.inUse};
  }
  async install(backend:Backend,signal:AbortSignal,progress:(value:LocalModelProgress)=>void=()=>{},sources:Record<string,string>={}) {
    this.platform();profile(backend);signal.throwIfAborted();if(this.closed)throw Error('运行包服务已关闭');
    let job=this.jobs.get(backend);
    if(job?.abort.signal.aborted){await job.promise.catch(()=>{});signal.throwIfAborted();job=undefined;}
    if(this.closed)throw Error('运行包服务已关闭');
    if(!job){
      const created:Preparation={abort:new AbortController(),listeners:new Map(),promise:Promise.resolve()};job=created;this.jobs.set(backend,created);
      const emit=(value:LocalModelProgress)=>{created.latest={...value};for(const callback of created.listeners.values())callback({...value});};
      const imports={...sources};created.promise=Promise.resolve().then(()=>this.prepare(profile(backend),created.abort.signal,emit,imports)).finally(()=>{if(this.jobs.get(backend)===created)this.jobs.delete(backend);});
    }
    const current=job,token=Symbol('runtime-download');
    return new Promise<void>((resolve,reject)=>{
      let finished=false;
      const finish=(error?:unknown)=>{if(finished)return;finished=true;signal.removeEventListener('abort',abort);current.listeners.delete(token);if(error)reject(error);else resolve();};
      const abort=()=>{finish(Error('运行包准备已取消'));if(!current.listeners.size)current.abort.abort();};
      const notify=(value:LocalModelProgress)=>{try{progress(value);}catch(error){finish(error);if(!current.listeners.size)current.abort.abort();}};
      current.listeners.set(token,notify);signal.addEventListener('abort',abort,{once:true});
      current.promise.then(()=>finish(),finish);if(signal.aborted)abort();else if(current.latest)notify({...current.latest});
    });
  }
  private async prepare(value:LlamaRuntimeProfile,signal:AbortSignal,progress:(value:LocalModelProgress)=>void,sources:Record<string,string>) {
    const total=value.archives.reduce((sum,file)=>sum+file.bytes,0),expanded=descriptor(value,true);
    progress({phase:'checking',received:0,total});
    if((await this.binaries.state(expanded,signal)).ready){progress({phase:'ready',received:total,total});return;}
    await this.archives.install(descriptor(value,false),signal,item=>progress({...item,phase:item.phase==='ready'?'verifying':item.phase}),sources);signal.throwIfAborted();
    const lease=await this.archives.acquire(descriptor(value,false));let temporary:string|undefined;
    try{
      signal.throwIfAborted();await mkdir(this.binaries.root,{recursive:true});const rootInfo=await lstat(this.binaries.root);
      if(!rootInfo.isDirectory()||rootInfo.isSymbolicLink())throw Error('运行包缓存目录无效');
      temporary=await mkdtemp(join(this.binaries.root,'.extract-'));
      for(const archive of value.archives){
        const source=lease.files.find(file=>file.role===archive.id)!;
        await extractRuntimeArchive(source.path,value.files.filter(file=>file.archive===archive.id),temporary,signal,
          artifact=>progress({phase:'verifying',received:total,total,artifact}));
      }
      signal.throwIfAborted();const local=Object.fromEntries(expanded.artifacts.map(file=>[file.role,join(temporary!,file.name)]));
      await this.binaries.install(expanded,signal,item=>progress({...item,phase:'verifying',received:total,total}),local);
      progress({phase:'ready',received:total,total});
    }finally{
      lease.release();
      if(temporary){const actual=await realpath(temporary);if(dirname(actual).toLowerCase()!==(await realpath(this.binaries.root)).toLowerCase())throw Error('运行包临时目录越界');await rm(actual,{recursive:true,force:true});}
    }
  }
  async acquire(backend:Backend){
    this.platform();if(this.closed)throw Error('运行包服务已关闭');const value=profile(backend),lease=await this.binaries.acquire(descriptor(value,true));
    if(this.closed){lease.release();throw Error('运行包服务已关闭');}
    const executable=lease.files.find(file=>file.name==='llama-server.exe')!;
    return {profile:structuredClone(value),executable:executable.path,directory:dirname(executable.path),release:lease.release};
  }
  async remove(backend:Backend){
    if(this.closed)throw Error('运行包服务已关闭');
    if(this.jobs.has(backend))throw Error('运行包正在准备');const value=profile(backend);
    await this.binaries.remove(descriptor(value,true));await this.archives.remove(descriptor(value,false));
  }
  async stop(){this.closed=true;for(const job of this.jobs.values())job.abort.abort();await Promise.allSettled([...this.jobs.values()].map(job=>job.promise));}
}
