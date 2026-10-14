import {mkdir,mkdtemp,lstat,readFile,writeFile,readdir,rename,rm,copyFile,realpath} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {LocalModelStore,localModelIdentity} from '../local-model-store';
import type {LocalModelProgress,LocalModelState} from '../../shared/local-models';
import type {FormulaModelFiles} from './formula-local';
import type {FormulaRuntimeStore} from './formula-runtime-store';
import {formulaRuntimeProfile} from './formula-runtime-catalog';
import {formulaPlusS,type FormulaPreparedProfile} from './formula-model-catalog';
import {buildFormulaModel,type FormulaBuildInput} from './formula-model-builder';

type Runtime=Pick<FormulaRuntimeStore,'state'|'install'|'acquire'>;
interface Job {abort:AbortController;promise:Promise<void>;listeners:Map<symbol,(value:LocalModelProgress)=>void>;latest?:LocalModelProgress}
interface Options {transport?:typeof fetch;profile?:FormulaPreparedProfile;build?:(input:FormulaBuildInput)=>Promise<void>}
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
async function directory(path:string,create=false){if(create)await mkdir(path,{recursive:true});const stat=await lstat(path);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('公式模型目录无效');}
async function hash(path:string,signal?:AbortSignal){const value=createHash('sha256');for await(const bytes of createReadStream(path)){signal?.throwIfAborted();value.update(bytes);}signal?.throwIfAborted();return value.digest('hex');}

/** Owns original weights and a derived, atomically published native inference model. */
export class FormulaModelStore {
  private readonly profile:FormulaPreparedProfile;
  private readonly sources:LocalModelStore;private readonly parent:string;private readonly installed:string;private readonly marker:object;
  private readonly builder:(input:FormulaBuildInput)=>Promise<void>;
  private job?:Job;private users=0;private closed=false;private invalid=false;
  constructor(root:string,private readonly runtime:Runtime,options:Options={}){
    root=resolve(root);this.profile=structuredClone(options.profile||formulaPlusS);const sourceKey=localModelIdentity(this.profile.source);
    const output=this.profile.output;
    if(!/^[a-z0-9._-]{1,80}$/.test(this.profile.recipe)||!Number.isSafeInteger(output.bytes)||output.bytes<1||output.bytes>512*1024*1024||!/^[a-f0-9]{64}$/.test(output.sha256)||!/^[a-z0-9][a-z0-9._-]{0,80}$/.test(output.name)||!this.profile.source.artifacts.some(file=>file.role==='config'&&file.name==='config.json'))throw Error('公式准备配方无效');
    const key=sourceKey+'-'+digest(JSON.stringify([this.profile.recipe,output,formulaRuntimeProfile.revision,formulaRuntimeProfile.manifestSha256])).slice(0,16);
    this.parent=join(root,'prepared');this.installed=join(this.parent,key);this.sources=new LocalModelStore(join(root,'sources'),options.transport);this.builder=options.build||buildFormulaModel;
    this.marker={app:'One',kind:'formula-model',schema:1,key,recipe:this.profile.recipe};
  }
  private files(directory:string):FormulaModelFiles{
    const output=this.profile.output,config=this.profile.source.artifacts.find(file=>file.role==='config')!;
    return {id:this.profile.source.id,revision:this.profile.source.revision,onnx:{path:join(directory,output.name),bytes:output.bytes,sha256:output.sha256},config:{path:join(directory,'config.json'),bytes:config.bytes,sha256:config.sha256}};
  }
  private async owned(path:string){
    await directory(path);const marker=join(path,'.prepared.json'),stat=await lstat(marker);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>4096||JSON.stringify(JSON.parse(await readFile(marker,'utf8')))!==JSON.stringify(this.marker))throw Error('公式模型缓存归属不匹配');
    const allowed=new Set(['.prepared.json',this.profile.output.name,'config.json']);
    for(const item of await readdir(path,{withFileTypes:true}))if(!allowed.has(item.name)||!item.isFile()||item.isSymbolicLink())throw Error('公式缓存存在外来文件，不能替换或删除');
  }
  private async verify(path:string,signal?:AbortSignal,integrity=true){
    await this.owned(path);
    const files=this.files(path);for(const file of [files.onnx,files.config]){signal?.throwIfAborted();const stat=await lstat(file.path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==file.bytes||integrity&&await hash(file.path,signal)!==file.sha256)throw Error('公式模型校验失败，请重新准备');}
  }
  private async protectSources(){
    const key=localModelIdentity(this.profile.source),names=this.profile.source.artifacts.map(file=>file.name);
    for(const suffix of ['', '.partial']){
      const path=join(this.sources.root,key+suffix);let exists=false;try{await lstat(path);exists=true;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
      if(!exists)continue;await directory(this.sources.root);await directory(path);const allowed=new Set(suffix?[...names,...names.map(name=>name+'.part')]:names);
      for(const item of await readdir(path,{withFileTypes:true}))if(!allowed.has(item.name)||!item.isFile()||item.isSymbolicLink())throw Error('公式权重缓存存在外来文件，不能替换或删除');
    }
  }
  async state():Promise<LocalModelState&{sourceReady:boolean}>{
    const source=await this.sources.state(this.profile.source,undefined,false);let ready=false,disk=0;
    try{await this.verify(this.installed,undefined,false);ready=!this.invalid;disk=this.profile.output.bytes+this.files(this.installed).config.bytes;}catch{}
    return {...source,ready,sourceReady:source.ready,diskBytes:source.diskBytes+disk,downloading:!!this.job,inUse:this.users>0};
  }
  async install(signal:AbortSignal,progress:(value:LocalModelProgress)=>void=()=>{},sources:Record<string,string>={},runtimeSources:Record<string,string>={}){
    signal.throwIfAborted();if(this.closed)throw Error('公式模型服务已关闭');
    if(this.job?.abort.signal.aborted)await this.job.promise.catch(()=>{});signal.throwIfAborted();if(this.closed||this.users)throw Error('公式模型正在使用或服务已关闭');
    if(!this.job){const job:Job={abort:new AbortController(),promise:Promise.resolve(),listeners:new Map()};this.job=job;
      const emit=(value:LocalModelProgress)=>{job.latest={...value};for(const listener of job.listeners.values())try{listener({...value});}catch{}};
      job.promise=Promise.resolve().then(()=>this.prepare(job.abort.signal,emit,{...sources},{...runtimeSources})).finally(()=>{if(this.job===job)this.job=undefined;});
    }
    const job=this.job,token=Symbol('formula-preparation');return new Promise<void>((resolve,reject)=>{
      let finished=false;const finish=(error?:unknown)=>{if(finished)return;finished=true;signal.removeEventListener('abort',abort);job.listeners.delete(token);const failure=signal.aborted?Error('公式模型准备已取消'):error;failure?reject(failure):resolve();};
      const abort=()=>{job.listeners.delete(token);const error=Error('公式模型准备已取消');if(!job.listeners.size){job.abort.abort();void job.promise.then(()=>finish(error),()=>finish(error));}else finish(error);};
      job.listeners.set(token,progress);signal.addEventListener('abort',abort,{once:true});if(job.latest)try{progress({...job.latest});}catch{}if(signal.aborted)abort();void job.promise.then(()=>finish(),error=>finish(error));
    });
  }
  private async dispose(path:string,owned=false){
    if(dirname(resolve(path))!==this.parent||await realpath(dirname(path))!==await realpath(this.parent))throw Error('公式缓存清理范围无效');
    await directory(path);if(owned)await this.owned(path);await rm(path,{recursive:true});
  }
  private async prepare(signal:AbortSignal,progress:(value:LocalModelProgress)=>void,sources:Record<string,string>,runtimeSources:Record<string,string>){
    const weightsTotal=this.profile.source.artifacts.reduce((sum,file)=>sum+file.bytes,0),runtimeTotal=formulaRuntimeProfile.artifacts.reduce((sum,file)=>sum+file.bytes,0),total=weightsTotal+runtimeTotal;progress({phase:'checking',received:0,total});
    try{await this.verify(this.installed,signal);this.invalid=false;progress({phase:'ready',received:total,total});return;}catch(error){signal.throwIfAborted();let exists=false;try{await lstat(this.installed);exists=true;}catch(check){if((check as NodeJS.ErrnoException).code!=='ENOENT')throw check;}if(exists)await this.owned(this.installed);}
    const runtimeReady=(await this.runtime.state()).ready;signal.throwIfAborted();
    await this.protectSources();await this.sources.install(this.profile.source,signal,value=>progress({...value,total,received:Math.min(total,(runtimeReady?runtimeTotal:0)+value.received),phase:value.phase==='ready'?'verifying':value.phase}),sources);
    const weights=await this.sources.acquire(this.profile.source,signal);let runtime:Awaited<ReturnType<Runtime['acquire']>>|undefined,temporary:string|undefined,old:string|undefined;
    try{
      await this.runtime.install(signal,value=>progress({...value,total,received:Math.min(total,weightsTotal+(runtimeReady?runtimeTotal:value.received)),phase:value.phase==='ready'?'verifying':value.phase}),runtimeSources);runtime=await this.runtime.acquire(signal);
      await directory(dirname(this.parent),true);await directory(this.parent,true);temporary=await mkdtemp(join(this.parent,'.preparing-'));
      await writeFile(join(temporary,'.prepared.json'),JSON.stringify(this.marker),{flag:'wx'});
      progress({phase:'verifying',received:total,total,artifact:'准备公式模型'});
      await this.builder({executable:runtime.executable,source:dirname(weights.files[0].path),destination:temporary,signal});signal.throwIfAborted();
      await copyFile(weights.files.find(file=>file.role==='config')!.path,join(temporary,'config.json'));await this.verify(temporary,signal);
      if(this.closed||this.users)throw Error('公式模型服务状态已改变');
      let exists=false;try{await lstat(this.installed);exists=true;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
      if(exists)await this.owned(this.installed);signal.throwIfAborted();
      if(exists){old=join(this.parent,'.obsolete-'+randomUUID());await rename(this.installed,old);}
      try{await rename(temporary,this.installed);temporary=undefined;}catch(error){if(old){await rename(old,this.installed);old=undefined;}throw error;}
      this.invalid=false;progress({phase:'ready',received:total,total});
    }finally{runtime?.release();weights.release();if(temporary)await this.dispose(temporary);if(old)await this.dispose(old,true);}
  }
  async acquire(signal?:AbortSignal){
    if(this.closed||this.job)throw Error('公式模型正在准备或服务已关闭');this.users++;let released=false;const release=()=>{if(!released){released=true;this.users--;}};
    try{await this.verify(this.installed,signal);signal?.throwIfAborted();if(this.closed)throw Error('公式模型服务已关闭');this.invalid=false;return {model:this.files(this.installed),release};}catch(error){if(!signal?.aborted)this.invalid=true;release();throw error;}
  }
  async remove(){
    if(this.job||this.users)throw Error('公式模型正在准备或使用');
    await this.protectSources();
    let exists=false;try{await lstat(this.installed);exists=true;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    if(exists)await this.dispose(this.installed,true);await this.sources.remove(this.profile.source);this.invalid=false;
  }
  async stop(){this.closed=true;this.job?.abort.abort();await this.job?.promise.catch(()=>{});}
}
