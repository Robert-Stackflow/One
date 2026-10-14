import {mkdir,mkdtemp,lstat,readFile,writeFile,rename,rm,realpath} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {LocalModelStore} from '../local-model-store';
import type {LocalModelProgress} from '../../shared/local-models';
import {formulaRuntimeProfile,type FormulaRuntimeProfile} from './formula-runtime-catalog';
import {extractFormulaRuntime,runtimeFiles,runtimeName,runtimeHash,type RuntimeFile} from './formula-runtime-tree';
const digest=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
const PTH='python312.zip\r\n.\r\nLib/site-packages\r\nimport site\r\n';
interface Preparation {abort:AbortController;listeners:Map<symbol,(value:LocalModelProgress)=>void>;promise:Promise<void>;latest?:LocalModelProgress}
/** Optional compiler package, independently leased from weights and inference. */
export class FormulaRuntimeStore {
  private readonly archives:LocalModelStore;private readonly installed:string;private readonly parent:string;private readonly profile:FormulaRuntimeProfile;
  private job?:Preparation;private users=0;private closed=false;private invalid=false;
  constructor(root:string,transport:typeof fetch=fetch,profile:FormulaRuntimeProfile=formulaRuntimeProfile){
    root=resolve(root);this.profile=structuredClone(profile);this.archives=new LocalModelStore(join(root,'archives'),transport);this.parent=join(root,'expanded');this.installed=join(this.parent,'builder');
  }
  private platform(){if(process.platform!=='win32'||process.arch!=='x64')throw Error('公式准备运行包仅支持 Windows x64');}
  private async owned(directory:string){
    const info=await lstat(directory);if(!info.isDirectory()||info.isSymbolicLink())throw Error('运行包目录无效');
    const path=join(directory,'.runtime.json'),stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>4096)throw Error('运行包归属记录无效');const marker=JSON.parse(await readFile(path,'utf8'));
    if(marker.app!=='One'||marker.kind!=='formula-runtime'||marker.schema!==1||marker.id!==this.profile.id||marker.revision!==this.profile.revision||marker.manifestSha256!==this.profile.manifestSha256)throw Error('运行包归属与版本不匹配');
  }
  async state(){
    const archives=await this.archives.state(this.profile,undefined,false);let ready=false;try{await this.owned(this.installed);const manifest=await lstat(join(this.installed,'.files.json'));ready=!this.invalid&&manifest.isFile()&&!manifest.isSymbolicLink()&&manifest.size>0&&manifest.size<=4*1024*1024;}catch{}
    return {...archives,ready,diskBytes:archives.diskBytes+(ready?this.profile.expandedBytes:0),downloading:!!this.job,inUse:this.users>0};
  }
  async install(signal:AbortSignal,progress:(value:LocalModelProgress)=>void=()=>{},sources:Record<string,string>={}){
    this.platform();signal.throwIfAborted();if(this.closed)throw Error('公式运行包服务已关闭');
    if(this.job?.abort.signal.aborted)await this.job.promise.catch(()=>{});signal.throwIfAborted();if(this.closed)throw Error('公式运行包服务已关闭');
    if(!this.job){const job:Preparation={abort:new AbortController(),listeners:new Map(),promise:Promise.resolve()};this.job=job;
      const emit=(value:LocalModelProgress)=>{job.latest={...value};for(const callback of job.listeners.values())callback({...value});};
      job.promise=Promise.resolve().then(()=>this.prepare(job.abort.signal,emit,{...sources})).finally(()=>{if(this.job===job)this.job=undefined;});
    }
    const job=this.job,token=Symbol('formula-runtime');return new Promise<void>((resolve,reject)=>{
      let finished=false;const finish=(error?:unknown)=>{if(finished)return;finished=true;signal.removeEventListener('abort',abort);job.listeners.delete(token);error?reject(error):resolve();};
      const abort=()=>{finish(Error('公式运行包准备已取消'));if(!job.listeners.size)job.abort.abort();};
      const notify=(value:LocalModelProgress)=>{try{progress(value);}catch(error){finish(error);if(!job.listeners.size)job.abort.abort();}};
      job.listeners.set(token,notify);signal.addEventListener('abort',abort,{once:true});job.promise.then(()=>finish(),finish);if(signal.aborted)abort();else if(job.latest)notify({...job.latest});
    });
  }
  private async manifest(directory:string){
    const path=join(directory,'.files.json'),stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>4*1024*1024)throw Error('运行包文件清单无效');const bytes=await readFile(path);if(digest(bytes)!==this.profile.manifestSha256)throw Error('运行包清单校验失败');return JSON.parse(bytes.toString('utf8')) as RuntimeFile[];
  }
  private allowed(files:RuntimeFile[]){const names=new Set<string>();for(const file of files){if(!runtimeName(file.name))throw Error('运行包文件清单路径无效');const parts=file.name.split('/');for(let n=1;n<=parts.length;n++)names.add(parts.slice(0,n).join('/'));}return names;}
  private async removeOwned(directory:string,published=false){
    const actual=await realpath(directory),parent=await realpath(this.parent);if(dirname(actual).toLowerCase()!==parent.toLowerCase())throw Error('运行包清理目录越界');
    // Refuse links anywhere in the tree before recursive removal.
    const allowed=published?this.allowed(await this.manifest(directory)):undefined;await runtimeFiles(directory,undefined,false,allowed);await rm(actual,{recursive:true,force:true});
  }
  private async prepare(signal:AbortSignal,progress:(value:LocalModelProgress)=>void,sources:Record<string,string>){
    const total=this.profile.artifacts.reduce((sum,item)=>sum+item.bytes,0);progress({phase:'checking',received:0,total});if((await this.state()).ready){progress({phase:'ready',received:total,total});return;}
    if(this.users)throw Error('运行包正在使用');await this.archives.install(this.profile,signal,value=>progress({...value,phase:value.phase==='ready'?'verifying':value.phase}),sources);const lease=await this.archives.acquire(this.profile,signal);let temporary:string|undefined,old:string|undefined;
    try{
      await mkdir(this.parent,{recursive:true});const info=await lstat(this.parent);if(!info.isDirectory()||info.isSymbolicLink())throw Error('运行包缓存目录无效');temporary=await mkdtemp(join(this.parent,'.prepare-'));
      for(const file of lease.files){signal.throwIfAborted();progress({phase:'verifying',received:total,total,artifact:file.name});await extractFormulaRuntime(file.path,temporary,file.role==='python'?'':'Lib/site-packages',signal);}
      await writeFile(join(temporary,'python312._pth'),PTH);const files=await runtimeFiles(temporary,signal),encoded=JSON.stringify(files);
      if(files.length!==this.profile.files||files.reduce((sum,file)=>sum+file.bytes,0)!==this.profile.expandedBytes||digest(encoded)!==this.profile.manifestSha256)throw Error('运行包展开文件与固定版本不一致');
      await writeFile(join(temporary,'.files.json'),encoded);await writeFile(join(temporary,'.runtime.json'),JSON.stringify({app:'One',kind:'formula-runtime',schema:1,id:this.profile.id,revision:this.profile.revision,manifestSha256:this.profile.manifestSha256}));signal.throwIfAborted();if(this.closed||this.users)throw Error('运行包服务状态已改变');
      let exists=false;try{await lstat(this.installed);exists=true;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
      if(exists){await this.owned(this.installed);await runtimeFiles(this.installed,undefined,false,this.allowed(await this.manifest(this.installed)));old=join(this.parent,'.obsolete-'+randomUUID());await rename(this.installed,old);}
      try{await rename(temporary,this.installed);temporary=undefined;}catch(error){if(old){await rename(old,this.installed);old=undefined;}throw error;}
      this.invalid=false;progress({phase:'ready',received:total,total});
    }finally{lease.release();if(temporary)await this.removeOwned(temporary);if(old)await this.removeOwned(old,true);}
  }
  private async verify(signal?:AbortSignal){
    await this.owned(this.installed);const expected=await this.manifest(this.installed);
    const actual=await runtimeFiles(this.installed,signal,false,this.allowed(expected));if(actual.length!==expected.length)throw Error('运行包存在缺失或外来文件');
    for(let index=0;index<expected.length;index++){signal?.throwIfAborted();const file=expected[index];if(!runtimeName(file.name)||actual[index].name!==file.name||actual[index].bytes!==file.bytes||await runtimeHash(join(this.installed,...file.name.split('/')),signal)!==file.sha256)throw Error('运行包文件校验失败');}
  }
  async acquire(signal?:AbortSignal){
    this.platform();if(this.closed||this.job)throw Error('运行包正在准备或服务已关闭');this.users++;let released=false;const release=()=>{if(!released){released=true;this.users--;}};
    try{await this.verify(signal);signal?.throwIfAborted();if(this.closed)throw Error('运行包服务已关闭');return {executable:join(this.installed,'python.exe'),directory:this.installed,release};}catch(error){if(!signal?.aborted)this.invalid=true;release();throw error;}
  }
  async remove(){if(this.job||this.users)throw Error('运行包正在准备或使用');let exists=false;try{await lstat(this.installed);exists=true;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}if(exists){await this.owned(this.installed);await this.removeOwned(this.installed,true);}await this.archives.remove(this.profile);this.invalid=false;}
  async stop(){this.closed=true;this.job?.abort.abort();await this.job?.promise.catch(()=>{});}
}
