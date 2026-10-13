import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { lstat, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { OCR_TEXT, ocrDimensions } from '../../shared/recognition/ocr-limits';
import type { DeepSeekOCRPreset } from './deepseek-models';

export type NativeFailure = 'input'|'protocol'|'loading'|'inference'|'resource'|'exit'|'timeout'|'cancelled';
export class NativeInferenceError extends Error {
  constructor(message:string,readonly kind:NativeFailure){super(message);}
}
export interface LlamaSessionOptions {
  helper:string; executable:string; weights:string; projector:string; controlDirectory:string;
  preset:DeepSeekOCRPreset; backend:'cpu'|'cuda'; deviceId?:number; memoryMiB?:number;
  startupTimeoutMs?:number; requestTimeoutMs?:number;
}
const failure=(kind:NativeFailure,message:string)=>new NativeInferenceError(message,kind);
const cancelled=()=>failure('cancelled','本地识别已取消');
const finiteBytes=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
async function freePort():Promise<number>{
  const server=createServer();
  return new Promise((resolve,reject)=>{
    server.once('error',reject);server.listen(0,'127.0.0.1',()=>{
      const address=server.address();
      if(!address||typeof address==='string'){server.close();reject(Error('无法分配本地推理端口'));return;}
      server.close(error=>error?reject(error):resolve(address.port));
    });
  });
}
function pause(ms:number,signal:AbortSignal){
  return new Promise<void>((resolve,reject)=>{
    const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(signal.reason);};
    const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);
    signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  });
}
/** A loopback-only server inside a kill-on-close Windows job. Its caller owns the verified file leases. */
export class LlamaSession {
  private child?:ChildProcessWithoutNullStreams;
  private directory?:string;
  private port=0;
  private key='';
  private control='';
  private logs='';
  private identity?:{pid:number;creation:string};
  private bound=false;
  private exited=false;
  private exitCode:number|null=null;
  private failure?:NativeInferenceError;
  private closing?:Promise<void>;
  private starting?:Promise<void>;
  private closed?:Promise<void>;
  private closeResolve?:()=>void;
  private readonly lifetime=new AbortController();
  private used=false;
  private ready=false;
  private busy=false;
  private peakBytes=0;
  private options:LlamaSessionOptions;
  constructor(options:LlamaSessionOptions){
    this.options=structuredClone(options);
    for(const path of [options.helper,options.executable,options.weights,options.projector,options.controlDirectory])
      if(!isAbsolute(path))throw failure('input','原生推理路径无效');
    const budget=options.memoryMiB??options.preset.memoryBudgetMiB;
    if(!Number.isSafeInteger(budget)||budget<128||budget>32768||!['cpu','cuda'].includes(options.backend)||
      options.backend==='cuda'&&(!Number.isSafeInteger(options.deviceId)||options.deviceId!<0||options.deviceId!>31))
      throw failure('input','原生推理设备或内存预算无效');
    for(const value of [options.startupTimeoutMs??180000,options.requestTimeoutMs??180000])
      if(!Number.isSafeInteger(value)||value<1||value>600000)throw failure('input','原生推理超时设置无效');
    if(!['v1','v2'].includes(options.preset.generation)||options.preset.contextTokens!==16384||options.preset.outputTokens!==8192)
      throw failure('input','原生识别预设无效');
  }
  get peakRSSMiB(){return this.peakBytes/1024**2;}
  get alive(){return this.ready&&!this.exited&&!this.lifetime.signal.aborted;}
  private fail(error:NativeInferenceError){
    this.failure ||= error;this.lifetime.abort(this.failure);
  }
  private packet(value:unknown){
    const data=value as Record<string,unknown>;
    if(!data||typeof data!=='object')throw Error('control');
    switch(data.type){
      case 'started':
        if(this.identity||data.protocol!==1||!Number.isSafeInteger(data.pid)||Number(data.pid)<1||Number(data.pid)>0xffffffff||
          typeof data.creation!=='string'||!/^[0-9a-f]{16}$/.test(data.creation))throw Error('control');
        this.identity={pid:Number(data.pid),creation:data.creation};break;
      case 'memory':
        if(data.pid!==this.identity?.pid||![data.rss,data.peak,data.commit].every(finiteBytes))throw Error('control');
        this.peakBytes=Math.max(this.peakBytes,Number(data.peak));break;
      case 'resource':this.fail(failure('resource','本地模型超过内存预算，请裁剪图片或切换设备'));break;
      case 'exit':
        if(data.pid!==this.identity?.pid||!finiteBytes(data.code))throw Error('control');break;
      default:throw Error('control');
    }
  }
  private receive(data:Buffer){
    this.control+=data.toString('utf8');let index:number;
    while((index=this.control.indexOf('\n'))>=0){
      const line=this.control.slice(0,index);this.control=this.control.slice(index+1);
      if(line.length>4096){this.fail(failure('protocol','原生推理控制消息无效'));return;}
      try{this.packet(JSON.parse(line));}catch{this.fail(failure('protocol','原生推理控制消息无效'));return;}
    }
    if(this.control.length>4096)this.fail(failure('protocol','原生推理控制消息过长'));
  }
  private error(error:unknown,signal:AbortSignal):NativeInferenceError{
    if(this.failure)return this.failure;
    if(signal.aborted){
      if((signal.reason as Error)?.name==='TimeoutError')return failure('timeout','本地识别超时，请裁剪图片后重试');
      return cancelled();
    }
    return error instanceof NativeInferenceError?error:failure(this.ready?'inference':'loading',this.ready?'本地识别失败，请重试':'本地模型启动失败，请检查运行包或切换 CPU');
  }
  private async json(path:'/health'|'/v1/chat/completions',signal:AbortSignal,body?:string){
    // node:http ignores global fetch/proxy dispatchers. Never follow redirects or accept arbitrary hosts/paths.
    return new Promise<{status:number;value:unknown}>((resolve,reject)=>{
      const req=request({hostname:'127.0.0.1',port:this.port,path,method:body?'POST':'GET',agent:false,signal,
        headers:{Authorization:'Bearer '+this.key,...(body?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}:{})}},response=>{
        const chunks:Buffer[]=[];let bytes=0;const limit=body?2*OCR_TEXT:8192;
        response.on('error',reject);response.on('aborted',()=>reject(failure('protocol','本地识别响应不完整')));
        if(Number(response.headers['content-length'])>limit){response.destroy(failure('protocol','本地识别响应过长'));return;}
        response.on('data',(chunk:Buffer)=>{
          bytes+=chunk.length;if(bytes>limit){response.destroy(failure('protocol','本地识别响应过长'));return;}chunks.push(chunk);
        });
        response.on('end',()=>{
          try{resolve({status:response.statusCode||0,value:JSON.parse(Buffer.concat(chunks).toString('utf8'))});}
          catch{reject(failure('protocol','本地识别响应无效'));}
        });
      });
      req.on('error',reject);req.end(body);
    });
  }
  async start(signal:AbortSignal){
    if(this.used)throw failure('loading','此推理会话已启动或关闭');this.used=true;
    const starting=this.starting=this.launch(signal);
    try{await starting;}catch(error){await this.close();throw error;}
    finally{if(this.starting===starting)this.starting=undefined;}
  }
  private async launch(signal:AbortSignal){
    const combined=AbortSignal.any([signal,this.lifetime.signal,AbortSignal.timeout(this.options.startupTimeoutMs??180000)]);
    try{
      combined.throwIfAborted();
      const {controlDirectory,helper,executable,weights,projector,preset,backend,deviceId}=this.options;
      await mkdir(controlDirectory,{recursive:true});const root=await lstat(controlDirectory);
      if(!root.isDirectory()||root.isSymbolicLink())throw failure('input','原生推理临时目录无效');
      this.directory=await mkdtemp(join(controlDirectory,'session-'));this.key=randomBytes(32).toString('hex');
      const keyFile=join(this.directory,'key');await writeFile(keyFile,this.key,{flag:'wx',mode:0o600});
      this.port=await freePort();combined.throwIfAborted();
      const device=backend==='cpu'?'none':'CUDA'+deviceId;
      const args=['inference-host',String(this.options.memoryMiB??preset.memoryBudgetMiB),executable,
        '-m',weights,'--mmproj',projector,'--no-jinja','--chat-template','deepseek-ocr','--host','127.0.0.1','--port',String(this.port),
        '--api-key-file',keyFile,'--offline','--no-webui','--parallel','1','--flash-attn','off','--no-warmup',
        '--fit','off','-c',String(preset.contextTokens),'-b','128','-ub','128','--device',device,'--mmproj-device',device,
        '-ngl',backend==='cpu'?'0':'99'];
      if(backend==='cpu')args.push('--no-mmproj-offload');
      if(preset.generation==='v2')args.push('--dry-multiplier','0.8','--dry-base','1.75','--dry-allowed-length','2','--dry-penalty-last-n','64','--dry-sequence-breaker','none');
      this.closed=new Promise(resolve=>{this.closeResolve=resolve;});
      const child=this.child=spawn(helper,args,{windowsHide:true,stdio:['pipe','pipe','pipe']});
      child.stdin.on('error',()=>{});child.stdout.on('data',data=>this.receive(data));
      child.stderr.on('data',data=>{
        this.logs=(this.logs+data.toString('utf8')).slice(-16384);
        if(new RegExp('listening on (?:http://)?127\\.0\\.0\\.1:'+this.port+'\\b').test(this.logs))this.bound=true;
      });
      child.on('error',()=>this.fail(failure('loading','无法启动本地推理进程')));
      child.once('close',code=>{
        this.exited=true;this.exitCode=code;this.closeResolve?.();
        if(!this.closing)this.fail(failure(code===70?'resource':'exit',code===70?'本地模型超过内存预算':'本地推理进程已退出'));
      });
      while(true){
        combined.throwIfAborted();
        if(this.identity&&this.bound){
          try{
            const response=await this.json('/health',AbortSignal.any([combined,AbortSignal.timeout(2000)]));
            if(response.status===200&&(response.value as {status?:unknown})?.status==='ok'){this.ready=true;return;}
            if(response.status!==503)throw failure('protocol','本地推理服务就绪响应无效');
          }catch(error){if(error instanceof NativeInferenceError)throw error;combined.throwIfAborted();}
        }
        await pause(50,combined);
      }
    }catch(error){throw this.error(error,combined);}
  }
  async recognize(png:Buffer,signal:AbortSignal):Promise<string>{
    if(!this.alive)throw this.failure||failure('exit','本地推理会话不可用');
    if(this.busy)throw failure('inference','此推理会话正在识别');
    if(!Buffer.isBuffer(png)||png.length<33||png.length>64*1024**2||!png.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))
      throw failure('input','识别图片数据无效');
    ocrDimensions(png.readUInt32BE(16),png.readUInt32BE(20));
    const combined=AbortSignal.any([signal,this.lifetime.signal,AbortSignal.timeout(this.options.requestTimeoutMs??180000)]);
    this.busy=true;
    try{
      combined.throwIfAborted();
      const body=JSON.stringify({messages:[{role:'user',content:[{type:'image_url',image_url:{url:'data:image/png;base64,'+png.toString('base64')}},{type:'text',text:'Free OCR.'}]}],
        stream:false,temperature:0,max_tokens:this.options.preset.outputTokens});
      const response=await this.json('/v1/chat/completions',combined,body);
      if(response.status!==200)throw failure(response.status===500?'inference':'protocol','本地识别请求失败');
      const value=response.value as {choices?:{message?:{content?:unknown};finish_reason?:unknown}[]};
      if(!Array.isArray(value?.choices)||value.choices.length!==1)throw failure('protocol','本地识别结果格式无效');
      const choice=value.choices[0],text=choice?.message?.content;
      if(choice.finish_reason==='length')throw failure('inference','识别内容过长，请裁剪或拆分图片后重试');
      if(choice.finish_reason!=='stop'||typeof text!=='string'||Buffer.byteLength(text)>OCR_TEXT)throw failure('protocol','本地识别结果格式无效');
      return text.trim();
    }catch(error){const result=this.error(error,combined);await this.close();throw result;}
    finally{this.busy=false;}
  }
  close():Promise<void>{
    if(this.closing)return this.closing;
    this.lifetime.abort(cancelled());
    // Defer cleanup so event handlers can observe closing before process exit.
    const closing=this.closing=Promise.resolve().then(async()=>{await this.starting?.catch(()=>{});await this.dispose();});
    void closing.catch(()=>{if(this.closing===closing)this.closing=undefined;});return closing;
  }
  private async waitClosed(ms:number){
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{return await Promise.race([this.closed!.then(()=>true),new Promise<false>(resolve=>{timer=setTimeout(()=>resolve(false),ms);timer.unref();})]);}
    finally{clearTimeout(timer);}
  }
  private async dispose(){
    this.used=true;this.ready=false;this.lifetime.abort(cancelled());
    const child=this.child;
    if(child&&!this.exited){
      child.stdin.end('stop\n');
      const ended=await this.waitClosed(5000);
      if(!ended){child.kill();await this.waitClosed(5000);}
    }
    // A normal host exit confirms the entire job drained. For a forced/failed exit, check PID + creation time.
    if(child?.pid&&(!this.exited||![0,2,3,4,6,70].includes(this.exitCode!))){
      if(!this.identity)throw failure('exit','无法确认本地推理进程退出，暂时保留模型资源');
      try{await promisify(execFile)(this.options.helper,['inference-wait',String(this.identity.pid),this.identity.creation,'5000'],
        {windowsHide:true,timeout:6000,maxBuffer:4096});}
      catch{throw failure('exit','本地推理进程尚未退出，暂时保留模型资源');}
    }
    this.child=undefined;this.logs='';this.key='';
    if(this.directory){
      const path=await realpath(this.directory),root=await realpath(resolve(this.options.controlDirectory));
      if(dirname(path).toLowerCase()!==root.toLowerCase())throw failure('input','原生推理临时目录越界');
      await rm(path,{recursive:true,force:true});this.directory=undefined;
    }
  }
}
