import { createHash } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { LocalModelStore } from '../local-model-store';
import { readInferenceDevices, resolveCUDAInferenceDevice } from '../inference-devices';
import { inferencePreference, type InferencePreference } from '../../shared/inference-devices';
import { ocrDimensions, ocrLanguage, type OCRResult } from '../../shared/recognition/ocr';
import { textDocument } from '../../shared/recognition/text-document';
import { localInference, type LocalInferenceClient, type LocalInferenceScheduler } from '../local-inference-scheduler';
import { LlamaRuntimeStore } from './llama-runtime-store';
import { deepseekOCRPresets, type DeepSeekOCRPreset } from './deepseek-models';
import { LlamaSession, NativeInferenceError, type LlamaSessionOptions } from './llama-session';

const presets=structuredClone(deepseekOCRPresets);
type Device=ReturnType<typeof resolveCUDAInferenceDevice>;
interface Cached {
  identity:string; modelId:string; session:LlamaSession; release():void;
  files:{path:string;signature:string}[];
}
export interface LlamaRunnerOptions {
  helper?:string; idleMs?:number; scheduler?:LocalInferenceScheduler;
  deviceReader?:typeof readInferenceDevices;
  sessionFactory?:(options:LlamaSessionOptions)=>LlamaSession;
  startupTimeoutMs?:number; requestTimeoutMs?:number;
}
export interface LlamaTaskResult extends OCRResult { actualBackend:'cpu'|'cuda'; deviceId?:number; fallbackReason?:string; peakRSSMiB:number }
const recoverable=(error:unknown)=>error instanceof NativeInferenceError&&['loading','inference','resource','exit','timeout'].includes(error.kind);
async function signature(path:string){
  const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink())throw Error('本地模型文件无效');
  return [stat.dev,stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs].join(':');
}
/** One retained native model per owner; all local engines share admission and unload before a model change. */
export class LlamaRunner {
  private cached?:Cached;
  private abort?:AbortController;
  private active?:Promise<LlamaTaskResult>;
  private unloading?:Promise<void>;
  private idle?:ReturnType<typeof setTimeout>;
  private stopped=false;
  private readonly scheduler:LocalInferenceScheduler;
  private readonly client:LocalInferenceClient={owner:Symbol('deepseek-ocr'),unload:()=>this.unload()};
  private readonly helper:string;
  constructor(private weights:LocalModelStore,private runtimes:LlamaRuntimeStore,private controlDirectory:string,private options:LlamaRunnerOptions={}){
    this.scheduler=options.scheduler||localInference;
    this.helper=options.helper||join(__dirname,'../native/One.Monitor.exe').replace('app.asar\\','app.asar.unpacked\\');
    if(options.idleMs!==undefined&&(!Number.isSafeInteger(options.idleMs)||options.idleMs<1||options.idleMs>600000))throw Error('原生推理空闲时间无效');
  }
  get waiting(){return this.scheduler.waiting(this.client);}
  async unload(modelId?:string){
    if(this.unloading)return this.unloading;
    const cached=this.cached;if(!cached||modelId&&cached.modelId!==modelId)return;
    clearTimeout(this.idle);
    const task=this.unloading=(async()=>{
      await cached.session.close(); // Keep both leases if native termination cannot be confirmed.
      cached.release();if(this.cached===cached)this.cached=undefined;this.scheduler.forget(this.client);
    })();
    try{await task;}finally{if(this.unloading===task)this.unloading=undefined;}
  }
  async cancel(){this.abort?.abort();await this.active?.catch(()=>{});await this.unload();}
  async close(){this.stopped=true;await this.cancel();this.scheduler.forget(this.client);}
  run(png:Buffer,size:{width:number;height:number},language:'eng'|'chi_sim+eng',modelId:string,preference:InferencePreference,
      progress:(phase:string)=>void=()=>{},memoryMiB?:number):Promise<LlamaTaskResult>{
    if(this.stopped)return Promise.reject(Error('原生 OCR 服务已关闭'));
    if(this.active)return Promise.reject(Error('正在识别，请先结束当前任务'));
    const model=presets.find(value=>value.id===modelId);if(!model)throw Error('原生 OCR 模型尚未适配');
    const dimensions=ocrDimensions(size.width,size.height);ocrLanguage(language);const choice=inferencePreference(preference);
    if(!Buffer.isBuffer(png)||png.length<33||png.length>64*1024**2||!png.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))||
      png.readUInt32BE(16)!==size.width||png.readUInt32BE(20)!==size.height)throw Error('原生 OCR 图片数据或尺寸无效');
    if(memoryMiB!==undefined&&(!Number.isSafeInteger(memoryMiB)||memoryMiB<128||memoryMiB>32768))throw Error('原生 OCR 内存预算无效');
    clearTimeout(this.idle);const input=Buffer.from(png),signal=(this.abort=new AbortController()).signal;
    const task=this.scheduler.run(this.client,signal,async()=>{
      signal.throwIfAborted();
      const devices=choice.mode==='cpu'?{gpus:[]}:await (this.options.deviceReader||readInferenceDevices)(signal,this.helper);
      const device=resolveCUDAInferenceDevice(choice,devices);
      try{return await this.execute(input,dimensions,language,model,device,signal,progress,memoryMiB);}
      catch(error){
        if(signal.aborted||choice.mode!=='auto'||device.backend!=='cuda'||!recoverable(error)){
          if(!signal.aborted&&choice.mode==='gpu'&&recoverable(error))(error as Error).message+='；输入已保留，可切换 CPU 重试';
          throw error;
        }
        await this.unload();signal.throwIfAborted();progress('cpu-fallback');
        const result=await this.execute(input,dimensions,language,model,{backend:'cpu'},signal,progress,memoryMiB);
        result.fallbackReason=(error as Error).message;result.inference!.fallbackReason=result.fallbackReason;return result;
      }
    });
    this.active=task;
    return task.finally(()=>{
      input.fill(0);
      if(this.active===task){
        this.active=undefined;this.abort=undefined;
        if(this.cached&&!this.stopped){this.idle=setTimeout(()=>{void this.unload().catch(()=>{});},this.options.idleMs??60000);this.idle.unref();}
      }
    });
  }
  private async execute(png:Buffer,size:{width:number;height:number},language:'eng'|'chi_sim+eng',model:DeepSeekOCRPreset,device:Device,
      signal:AbortSignal,progress:(phase:string)=>void,memoryMiB?:number):Promise<LlamaTaskResult>{
    await this.unloading;signal.throwIfAborted();
    const identity=JSON.stringify([model.id,model.revision,device.backend,device.gpu?.id,device.deviceId,memoryMiB??model.memoryBudgetMiB]);
    if(this.cached){
      let unchanged=this.cached.identity===identity&&this.cached.session.alive;
      if(unchanged)try{for(const file of this.cached.files)if(await signature(file.path)!==file.signature){unchanged=false;break;}}catch{unchanged=false;}
      if(!unchanged)await this.unload();
    }
    signal.throwIfAborted();
    if(!this.cached){
      progress('verifying');const weights=await this.weights.acquire(model,signal);let runtime:Awaited<ReturnType<LlamaRuntimeStore['acquire']>>;
      try{runtime=await this.runtimes.acquire(device.backend,signal);}catch(error){weights.release();throw error;}
      let session:LlamaSession;
      try{
        session=(this.options.sessionFactory||((options)=>new LlamaSession(options)))({helper:this.helper,executable:runtime.executable,
          weights:weights.files.find(file=>file.role==='language')!.path,projector:weights.files.find(file=>file.role==='vision')!.path,
          controlDirectory:this.controlDirectory,preset:model,backend:device.backend,deviceId:device.deviceId,memoryMiB,
          startupTimeoutMs:this.options.startupTimeoutMs,requestTimeoutMs:this.options.requestTimeoutMs});
        const files=await Promise.all([...weights.files.map(file=>file.path),runtime.executable].map(async path=>({path,signature:await signature(path)})));
        this.cached={identity,modelId:model.id,session,files,release:()=>{runtime.release();weights.release();}};
      }catch(error){runtime.release();weights.release();throw error;}
      try{progress('loading');await session.start(signal);}catch(error){await this.unload();throw error;}
    }
    try{
      signal.throwIfAborted();progress('recognizing');const text=await this.cached.session.recognize(png,signal);signal.throwIfAborted();
      const result:LlamaTaskResult={text,confidence:0,...size,words:[],language,actualBackend:device.backend,deviceId:device.deviceId,
        fallbackReason:device.reason,peakRSSMiB:this.cached.session.peakRSSMiB,
        inference:{model:model.title+' '+model.size,backend:device.backend,device:device.gpu?.name||'CPU',fallbackReason:device.reason}};
      result.document=textDocument(result,createHash('sha256').update(png).digest('hex'),
        {id:'deepseek-ocr',version:model.runtime,model:model.revision,device:device.backend});
      return result;
    }catch(error){await this.unload();throw error;}
  }
}
