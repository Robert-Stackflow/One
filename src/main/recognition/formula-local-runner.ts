import {fork,type ChildProcess} from 'node:child_process';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {formulaOutput,FORMULA_IMAGE} from '../../shared/recognition/formula';
import {localInference,type LocalInferenceScheduler,type LocalInferenceClient} from '../local-inference-scheduler';
import {limitChildProcess} from '../capture/native';
import type {FormulaLocalJob,FormulaLocalPreferences,FormulaLocalResult,FormulaModelFiles} from './formula-local';
class FormulaProcessError extends Error {constructor(message:string,readonly kind:string){super(message);}}
/** An owner-bound cache. Cancellation waits for process exit before scheduler admission changes. */
export class FormulaLocalRunner {
  private child?:ChildProcess;private identity='';private release?:()=>void;private terminating?:Promise<void>;
  private abort?:AbortController;private active?:Promise<FormulaLocalResult>;private idle?:ReturnType<typeof setTimeout>;private closed=false;private serial=0;
  private readonly client:LocalInferenceClient={owner:Symbol('local-formula'),unload:()=>this.terminate()};
  constructor(private worker=join(__dirname,'recognition/formula-local-worker.cjs'),private timeoutMs=60000,private idleMs=60000,private scheduler:LocalInferenceScheduler=localInference){}
  get waiting(){return this.scheduler.waiting(this.client);}
  private async terminate(){
    clearTimeout(this.idle);if(this.terminating)return this.terminating;
    const child=this.child;this.child=undefined;this.identity='';
    if(!child||child.exitCode!==null||child.signalCode!==null){this.release?.();this.release=undefined;return;}
    const task=this.terminating=new Promise<void>(resolve=>{child.once('exit',()=>resolve());child.kill();});
    try{await task;}finally{this.release?.();this.release=undefined;if(this.terminating===task)this.terminating=undefined;}
  }
  async cancel(){this.abort?.abort();await this.active?.catch(()=>{});}
  async close(){this.closed=true;await this.cancel();await this.terminate();this.scheduler.forget(this.client);}
  run(png:Buffer,model:FormulaModelFiles,preferences:FormulaLocalPreferences,progress:(value:number,phase:string)=>void=()=>{}){
    if(this.closed)return Promise.reject(Error('本地公式服务已关闭'));if(this.active)return Promise.reject(Error('公式任务正在进行'));
    if(!Buffer.isBuffer(png)||png.length<24||png.length>FORMULA_IMAGE)throw Error('公式图片支持最多 8 MiB PNG');
    if(typeof model?.id!=='string'||!/^[\w.-]{1,100}$/.test(model.id)||typeof model.revision!=='string'||!model.revision||model.revision.length>128)throw Error('公式模型身份无效');
    if(!['auto','cpu','gpu'].includes(preferences.device)||!Number.isSafeInteger(preferences.deviceId)||preferences.deviceId<0||preferences.deviceId>31||preferences.automaticBackend!==undefined&&!['cpu','dml'].includes(preferences.automaticBackend)||preferences.memoryMiB!==undefined&&(!Number.isSafeInteger(preferences.memoryMiB)||preferences.memoryMiB<256||preferences.memoryMiB>8192))throw Error('公式推理设备或内存预算无效');
    const input=Buffer.from(png),snapshot=structuredClone(model),prefs={...preferences},signal=(this.abort=new AbortController()).signal;
    const backend=prefs.device==='gpu'||prefs.device==='auto'&&prefs.automaticBackend==='dml'?'dml':'cpu';clearTimeout(this.idle);
    const task=this.scheduler.run(this.client,signal,async()=>{
      try{return await this.execute(input,snapshot,prefs,backend,signal,progress);}
      catch(error){
        if(signal.aborted||prefs.device!=='auto'||backend!=='dml'||!(error instanceof FormulaProcessError)||!['loading','inference','resource','exit','timeout'].includes(error.kind))throw error;
        await this.terminate();signal.throwIfAborted();progress(0,'cpu-fallback');const result=await this.execute(input,snapshot,prefs,'cpu',signal,progress);return {...result,fallbackReason:error.message};
      }
    });this.active=task;
    return task.finally(()=>{input.fill(0);if(this.active===task){this.active=undefined;this.abort=undefined;if(!this.closed){this.idle=setTimeout(()=>void this.terminate(),this.idleMs);this.idle.unref();}}});
  }
  private async execute(png:Buffer,model:FormulaModelFiles,prefs:FormulaLocalPreferences,backend:'cpu'|'dml',signal:AbortSignal,progress:(value:number,phase:string)=>void){
    await this.terminating;signal.throwIfAborted();const memoryMiB=prefs.memoryMiB??2048,identity=JSON.stringify([model,backend,prefs.deviceId,memoryMiB]);
    if(this.child&&this.identity!==identity)await this.terminate();signal.throwIfAborted();
    if(!this.child){
      const child=this.child=fork(this.worker,[],{execArgv:['--max-old-space-size=256'],serialization:'advanced',windowsHide:true,stdio:['ignore','ignore','pipe','ipc'],env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}});
      child.on('error',()=>{});child.once('exit',()=>{if(this.child===child){this.child=undefined;this.identity='';this.release?.();this.release=undefined;}});
      try{this.release=limitChildProcess(child.pid!,memoryMiB);this.identity=identity;}catch(error){await this.terminate();throw error;}
    }
    const child=this.child,id=++this.serial,sourceSha256=createHash('sha256').update(png).digest('hex');
    return new Promise<FormulaLocalResult>((resolve,reject)=>{
      let done=false;
      const finish=(error?:Error,result?:FormulaLocalResult)=>{if(done)return;done=true;clearTimeout(timer);signal.removeEventListener('abort',cancel);child.off('message',message);child.off('exit',exit);child.off('error',failed);if(error)void this.terminate().then(()=>reject(error),()=>reject(error));else resolve(result!);};
      const cancel=()=>finish(new FormulaProcessError('公式识别已取消','cancelled'));
      const exit=()=>finish(new FormulaProcessError('公式推理进程退出或资源不足，输入已保留','exit'));
      const failed=()=>finish(new FormulaProcessError('公式推理进程无法启动','exit'));
      const message=(packet:any)=>{
        if(done||packet?.id!==id)return;
        if(packet.phase&&Number.isFinite(packet.progress)){try{progress(Math.max(0,Math.min(1,packet.progress)),String(packet.phase).slice(0,80));}catch{finish(new FormulaProcessError('公式进度处理失败','result'));}return;}
        if(!packet.ok){finish(new FormulaProcessError(typeof packet.error==='string'?packet.error.slice(0,1000):'公式推理失败',String(packet.kind)));return;}
        try{const result=packet.result as FormulaLocalResult;if(result.sourceSha256!==sourceSha256||result.model!==model.id||result.revision!==model.revision||result.actualBackend!==backend||backend==='dml'&&result.deviceId!==prefs.deviceId||!Number.isFinite(result.peakRSSMiB)||result.peakRSSMiB<1||result.peakRSSMiB>32768)throw Error();finish(undefined,{...result,text:formulaOutput(result.text)});}catch{finish(new FormulaProcessError('公式推理结果与任务不匹配','result'));}
      };
      const timer=setTimeout(()=>finish(new FormulaProcessError('公式识别超时，输入已保留','timeout')),this.timeoutMs);
      signal.addEventListener('abort',cancel,{once:true});child.on('message',message);child.once('exit',exit);child.once('error',failed);child.stderr?.resume();
      child.send({id,png,model,backend,deviceId:prefs.deviceId,memoryMiB} satisfies FormulaLocalJob,error=>{if(error)failed();});if(signal.aborted)cancel();
    });
  }
}
