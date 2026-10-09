import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {availableParallelism} from 'node:os';
import {archiveCompression,type ArchiveCompression} from '../shared/archive-compression';
import {lstat,link,mkdir,readdir,rename,rm,stat} from 'node:fs/promises';
import {join,dirname,basename,extname,isAbsolute,resolve,relative} from 'node:path';
import {existsSync} from 'node:fs';
import {createReadStream,createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import type {ArchiveRequest,ArchiveListing,ArchiveEntry,ArchiveProgress,ArchiveResult,ArchiveEncoding,ArchivePasswordEncoding} from '../shared/archive';
import {archiveEditPacket} from './archive-update';
import {browsePacket,folderSelection} from './archive-browser';
import {ArchiveDragCache,type DragCacheReport} from './archive-drag-cache';
import {ArchiveEditSessions} from './archive-edit-sessions';
import type {ArchiveTasks} from './archive-tasks';
import {validArchiveScan,copyArchiveScan,type ArchiveScan} from '../shared/archive-scan';
import {archiveResources,archiveLevel,archiveBudget,archivePasswordEncoding,type ArchiveResources,type ArchiveBudget} from '../shared/archive-options';
import {ArchiveScheduler} from './archive-scheduler';
import {ArchiveWatchdog,archiveWatchdogLimits} from './archive-watchdog';
import {extractionBudget,riskApproval,validArchiveRisk,type ArchiveRisk,type ArchiveRiskApproval,type ExtractionBudget} from '../shared/archive-risk';
import {archiveEntryDetails} from '../shared/archive-details';
import {validArchiveRevision} from '../shared/archive-revision';
import {ArchiveSharedBudget,type ArchiveSharedLease} from './archive-shared-budget';
import {ArchiveRecoveryRegistry,inspectArchiveRecovery,archiveRecoveryId} from './archive-recovery';
import {archiveStageInspection,type ArchiveRecoveryInspection,type ArchiveRecoveryRecord} from '../shared/archive-recovery';

type NativeResult={type:'result';count:number;skipped?:number;cancelled?:boolean;retainCache?:boolean;staged?:boolean;path?:string;revision?:string;volumes?:number;committed?:boolean;cleanupPending?:boolean;recovery?:string};
type Message = {type:'meta';total:number;comment:string;revision?:string;editable?:boolean;matched?:number}|({type:'entry'}&ArchiveEntry)|({type:'details'}&import('../shared/archive').ArchiveEntryDetails)|{type:'progress';done:number;total:number;phase?:'scan'}|{type:'heartbeat';activity:number}|({type:'scan'}&ArchiveScan)|NativeResult|{type:'ready'}|({type:'risk'}&ArchiveRisk)|{type:'stage-inspection'}|{type:'error';message:string;code?:string};
export class ArchiveFailure extends Error {constructor(message:string,readonly code:string='archive',readonly scan?:ArchiveScan,readonly risk?:ArchiveRisk){super(message);this.name='ArchiveFailure';}}
const helper=()=>join(__dirname,'../native/One.Archive.exe').replace('app.asar\\','app.asar.unpacked\\');
const path=(value:unknown)=>{if(typeof value!=='string'||!isAbsolute(value)||value.length>32768||value.includes('\0'))throw Error('路径无效');return resolve(value);};
const encoding=(value:unknown):ArchiveEncoding=>[0,437,932,936,950,65001].includes(Number(value))?Number(value) as ArchiveEncoding:0;
const password=(value:unknown)=>{if(value===undefined)return '';if(typeof value!=='string'||value.includes('\0')||Buffer.byteLength(value,'utf8')>1024||Buffer.from(value,'utf8').toString('utf8')!==value)throw Error('密码无效或过长');return value;};
const archiveTarget=(value:unknown)=>{const target=path(value);if(!/\.(?:zip|7z|tar|tar\.gz|tgz|gz|tar\.xz|txz|xz)$/i.test(target))throw Error('不支持该压缩包格式');return target;};
const archiveSource=(value:unknown)=>{const source=path(value);if(!/\.(?:zip|7z|7z\.001|rar|r00|tar|tar\.gz|tgz|gz|tar\.xz|txz|xz)$/i.test(source))throw Error('暂不支持该压缩格式');return source;};
const archiveName=(source:string)=>basename(source).replace(/\.(?:7z\.001|part\d+\.rar|tar\.gz|tar\.xz|zip|7z|rar|r00|tar|tgz|txz|gz|xz)$/i,'');
const composite=(source:string)=>/\.(?:tar\.gz|tar\.xz|tgz|txz)$/i.test(source);
const archiveDiagnostic=(message:string)=>message.startsWith('Missing volume : ')?`缺少 RAR 分卷：${message.slice('Missing volume : '.length)}。请将所有分卷放在同一文件夹后重新打开首卷。`:
  message==='Open the first RAR volume, not a later part'?'请选择 RAR 的第一个分卷（通常为 .part1.rar、.part01.rar 或 .rar），并将全部分卷放在同一文件夹。':
  message==='RAR archive headers are damaged, incomplete or unsupported'?'RAR 头部损坏、分卷不完整或使用了暂不支持的特性。请检查压缩包和全部分卷后重试。':
  message==='RAR archive comment is damaged or unsupported'?'RAR 压缩包备注损坏或使用了暂不支持的格式，无法读取或完成校验。':
  message==='RAR archive comment exceeds the size limit'?'RAR 压缩包备注超过 256 KiB 的读取上限。':
  message==='RAR archive comment exceeded the memory budget'?'读取 RAR 压缩包备注时超出内存预算。':
  message==='RAR comment search exceeds the header limit'?'RAR 压缩包备注搜索超过头部读取上限。':message;
type CachedTar={path:string;directory:string;stamp:string;users:number;used:number;stale:boolean};
type RecoveryRequest=Omit<Extract<ArchiveRequest,{operation:'test'}>,'operation'>&{operation:'recover'|'cleanup';record:ArchiveRecoveryRecord;stageToken?:string};
type StageInspectRequest=Omit<RecoveryRequest,'operation'|'stageToken'>&{operation:'inspect-stage'};
type ScheduledResult=ArchiveListing|ArchiveResult|ArchiveRecoveryInspection;
async function recordedStage(value:ArchiveRecoveryRecord){
  if(value.kind!=='volume-update')return false;
  const present=async(name:string)=>!!await lstat(join(value.path,name)).catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error;});
  const [stage,published]=await Promise.all([present('stage.jsonl'),present('manifest.jsonl')]);
  // A complete publication plan can coexist with its staging journal after an
  // interrupted atomic handoff. Native restore/cleanup validates their identity
  // link before touching any file; the presence of two names grants no authority.
  return stage&&!published;
}
function stageInspectionDiagnostic(message:string){
  if(message.includes('missing'))return '暂存来源记录缺失，无法确认清理范围；请保留资料';
  if(message.includes('unknown'))return '暂存或恢复目录中包含未知内容，未处理这些内容；请检查后重试';
  if(message.includes('link')||message.includes('incompatible'))return '暂存路径包含链接或类型已经变化，资料已保留';
  if(message.includes('changed')||message.includes('replaced')||message.includes('differs')||message.includes('appeared'))return '暂存文件、目录或记录已经变化，无法确认清理范围；请保留资料';
  if(message.includes('exceeds')||message.includes('limit'))return '暂存来源记录超过检查上限，资料已保留';
  if(message.includes('Cannot lock'))return '暂存文件或目录被占用、无法访问，请关闭相关程序后重新检查';
  return '暂存来源记录损坏或无法验证，资料已保留；详细原因可在运行日志中查看';
}
function recoveryDiagnostic(message:string,cleanup=false){
  if(cleanup){
    if(message.includes('not finished restoring'))return '尚未完成原文件还原，请先还原再清理；剩余副本已保留';
    if(message.includes('unknown'))return '恢复目录中包含未知内容，未删除这些内容；请检查后重试';
    if(message.includes('modified')||message.includes('changed'))return '文件身份发生变化，清理已停止；其余恢复资料已保留';
    if(message.includes('link')||message.includes('incompatible'))return '恢复路径包含链接或不兼容类型，清理已停止';
    if(message.includes('cancelled')||message.includes('stopped'))return '清理已停止，已删除的副本无法撤销；剩余资料可检查后继续清理';
    return '恢复资料无法验证、被占用或无法清理；剩余资料已保留，请查看运行日志';
  }
  if(message.startsWith('Target was modified'))return '目标文件发生变化，还原已停止；文件与恢复资料均已保留';
  if(message.startsWith('Original recovery copy is missing'))return '缺少原文件副本，还原已停止；现有内容已保留';
  if(message.startsWith('Extraction was committed'))return '原解压已确认完成，不能按中断任务还原；恢复副本已保留';
  if(message.includes('committed'))return '分卷保存已确认完成，不能按中断任务还原；可检查后清理原卷副本';
  if(message.includes('missing'))return '缺少必要的分卷或原卷副本，还原已停止；现有内容已保留';
  if(message.startsWith('Cannot lock recovery path'))return '文件或目录被占用、无法访问或类型已变化，请关闭相关程序后检查';
  if(message.startsWith('Recovery stopped')||message.startsWith('Recovery cancelled'))return '还原已停止；已处理的部分和恢复资料均已保留，可以检查后重试';
  if(message.includes('changed')||message.includes('appeared')||message.includes('Both '))return '文件身份发生变化或目标位置已有内容，还原已停止；现有资料已保留';
  if(message.includes('link')||message.includes('incompatible'))return '恢复路径包含链接或不兼容的文件类型，还原已停止';
  return '恢复资料无法验证或文件无法移动，还原未完成；请保留资料并查看运行日志';
}

export class ArchiveService {
  private active=new Map<string,{child:ChildProcessWithoutNullStreams;owner:number;committing:boolean;cooperative:boolean}>();
  private publishing=new Map<string,{controller:AbortController;owner:number}>();
  private pending=new Set<Promise<ScheduledResult>>();
  private requests=new Set<string>();
  private jobs=new Map<string,{owner:number;cancelled:boolean;committing:boolean;finishing:boolean;resources:ArchiveResources;compression:ArchiveCompression;level:number;passwordEncoding:ArchivePasswordEncoding;riskApproval?:ArchiveRiskApproval;extractionLimits:ExtractionBudget;source:string;extractionStarted?:number;propagateZone:boolean;scan:boolean;controller:AbortController;shared?:ArchiveSharedLease}>();
  private scheduler=new ArchiveScheduler();
  private shared:ArchiveSharedBudget|undefined;
  private budgetOverride:ArchiveBudget|undefined;
  private stopped=false;
  private cached=new Map<string,CachedTar>();
  private preparing=new Map<string,Promise<CachedTar>>();
  private sweepQueued=false;
  private dragCache:ArchiveDragCache;
  private recovery:ArchiveRecoveryRegistry;
  private inspections=new Map<string,{owner:number;controller:AbortController;task:Promise<import('../shared/archive-recovery').ArchiveRecoveryInspection>}>();
  private stageSnapshots=new Map<string,{owner:number;token:string;record:string}>();
  private cacheMaintenance:Promise<DragCacheReport>;
  readonly edits:ArchiveEditSessions;
  constructor(private cacheRoot:string,private changed:(owner:number,progress:ArchiveProgress)=>void,private sourceWindow:(owner:number)=>string=()=> '0',private diagnostic:(event:string,detail:string,warning?:boolean)=>void=()=>{},private independentProcessGroup=false,private tasks?:ArchiveTasks,private defaults:()=>ArchiveResources&Partial<ArchiveBudget>&Partial<ArchiveCompression>&{compressionLevel?:number;propagateZone?:boolean;scanOnExtract?:boolean}=()=>archiveResources(),recoveryDirectory=join(dirname(cacheRoot),'tasks','archive-recovery'),launchEdit:(file:string)=>Promise<string>=async()=> '未配置外部编辑程序'){
    this.dragCache=new ArchiveDragCache(cacheRoot,value=>this.diagnostic('archive-drag-cache',JSON.stringify(value),value.failures.length>0));
    this.cacheMaintenance=this.dragCache.sweep();
    this.recovery=new ArchiveRecoveryRegistry(recoveryDirectory);
    this.edits=new ArchiveEditSessions(join(dirname(cacheRoot),'archive-edits'),(owner,request,id)=>this.run(owner,request,id),launchEdit);
  }
  private recoveryActive(id:string,value?:ArchiveRecoveryRecord){
    if([...this.requests].some(value=>value.toLowerCase()===id.toLowerCase()))return true;
    if(value&&value.ownerPid!==process.pid)try{process.kill(value.ownerPid,0);return true;}catch(error){return (error as NodeJS.ErrnoException).code!=='ESRCH';}
    return false;
  }
  recoveryPage(offset=0){return this.recovery.list(offset,(id,value)=>this.recoveryActive(id,value));}
  async inspectRecovery(owner:number,id:string){
    id=archiveRecoveryId(id);
    if(this.stopped)throw Error('压缩服务正在关闭');if(this.inspections.size>=2||this.inspections.has(id))throw Error('已有恢复资料正在检查，请稍候');
    const controller=new AbortController();
    this.stageSnapshots.delete(id);
    const task=(async()=>{const value=await this.recovery.read(id);controller.signal.throwIfAborted();if(this.recoveryActive(id,value))throw Error('该任务可能仍在运行，请等待结束后检查');
      let staged:boolean;try{staged=await recordedStage(value);}catch(error){return{id,kind:value.kind,state:'invalid',message:error instanceof Error?error.message:String(error),items:0,files:0,directories:0,replaced:0,published:0,skipped:0,samples:[]} as ArchiveRecoveryInspection;}
      controller.signal.throwIfAborted();if(!staged)return inspectArchiveRecovery(value,controller.signal);
      const cancel=()=>{this.cancel(id,owner);};controller.signal.addEventListener('abort',cancel,{once:true});
      try{const result=await this.schedule(owner,{operation:'inspect-stage',path:value.archive,record:value},id);controller.signal.throwIfAborted();
        if(result.stage){if(this.stageSnapshots.size>=1024)this.stageSnapshots.delete(this.stageSnapshots.keys().next().value!);this.stageSnapshots.set(id,{owner,token:result.stage.token,record:JSON.stringify(value)});}return result;
      }finally{controller.signal.removeEventListener('abort',cancel);}
    })();
    this.inspections.set(id,{owner,controller,task});
    try{const result=await task;this.diagnostic('archive-recovery-inspected',JSON.stringify({id,kind:result.kind??'extract',state:result.state,items:result.items}),result.state==='invalid');return result;}finally{this.inspections.delete(id);}
  }
  cancelRecoveryInspection(owner:number,id:string){const task=this.inspections.get(archiveRecoveryId(id));if(task?.owner===owner)task.controller.abort();}
  restoreRecovery(owner:number,id:string):Promise<ArchiveResult>{return this.recoveryOperation(owner,id,'recover');}
  cleanupRecovery(owner:number,id:string,stageToken?:string):Promise<ArchiveResult>{return this.recoveryOperation(owner,id,'cleanup',stageToken);}
  private async recoveryOperation(owner:number,id:string,operation:'recover'|'cleanup',stageToken?:string):Promise<ArchiveResult>{
    id=archiveRecoveryId(id);if(this.stopped||this.inspections.has(id))throw Error('恢复资料仍在检查或服务正在关闭');
    const record=await this.recovery.read(id);if(this.inspections.has(id)||this.recoveryActive(id,record))throw Error('该任务可能仍在运行或检查，请等待结束后处理');
    if(stageToken!==undefined){const checked=this.stageSnapshots.get(id);if(operation!=='cleanup'||typeof stageToken!=='string'||!/^[a-f0-9]{64}$/.test(stageToken)||!checked||checked.owner!==owner||checked.token!==stageToken||checked.record!==JSON.stringify(record))throw Error('请在当前窗口重新检查暂存资料后确认清理');}
    else if(await recordedStage(record))throw Error(operation==='recover'?'仅生成了暂存资料，原压缩包未发布修改，无需还原；请检查后清理暂存':'请先检查暂存资料，再确认永久清理');
    return this.schedule(owner,{operation,path:record.archive,record,stageToken},id) as Promise<ArchiveResult>;
  }
  async forgetRecovery(id:string){
    id=archiveRecoveryId(id);
    if(this.stopped||this.inspections.has(id)||this.requests.has(id))throw Error('任务仍在进行，请稍后处理');
    const value=await this.recovery.read(id).catch(()=>undefined);if(this.recoveryActive(id,value))throw Error('该任务可能仍在其他实例中运行');
    await this.recovery.forget(id);this.stageSnapshots.delete(id);this.diagnostic('archive-recovery-forgotten',JSON.stringify({id}));
  }
  get pendingTasks(){return this.pending.size+this.edits.pendingTasks;}
  setBudget(value:ArchiveBudget){const budget=archiveBudget(value);this.scheduler.configure(budget);this.shared?.configure(budget);this.budgetOverride=budget;}
  taskOverview(){return this.tasks?.overview()??Promise.resolve({active:[],recent:[],error:''});}
  cancelId(id:string){const job=this.jobs.get(id);if(!job)throw Error('任务已结束');if(!this.cancel(id,job.owner))throw Error('正在完成最终保存，请等待任务结束');return job.owner;}
  cancelOwner(owner:number){for(const [id,job] of this.jobs)if(job.owner===owner)this.cancel(id,owner);for(const task of this.inspections.values())if(task.owner===owner)task.controller.abort();}
  private checkpoint(id:string){if(this.jobs.get(id)?.cancelled)throw new ArchiveFailure('压缩任务已取消','cancelled');}
  private seal(owner:number,id:string,confirmed=false){const job=this.jobs.get(id);if(confirmed&&job)job.cancelled=false;this.checkpoint(id);if(job)job.committing=true;this.notify(owner,{id,operation:'commit',done:0,total:0});}
  private notify(owner:number,value:ArchiveProgress){const job=this.jobs.get(value.id);this.tasks?.progress(value,!!job&&!job.cancelled&&!job.finishing&&!job.committing);this.changed(owner,value);}
  cancel(id:string,owner:number){if(this.edits.cancel(id,owner))return true;const job=this.jobs.get(id);if(!job||job.owner!==owner||job.finishing||job.committing)return false;job.cancelled=true;
    this.tasks?.cancelling(id);job.controller.abort(new ArchiveFailure('压缩任务已取消','cancelled'));
    const task=this.active.get(id);if(task&&task.owner===owner){if(task.cooperative)task.child.stdin.write(Buffer.from([2]));else task.child.kill();}
    this.publishing.get(id)?.controller.abort();return true;}
  async stop(){
    this.stopped=true;for(const [id,job] of this.jobs)this.cancel(id,job.owner);
    await this.edits.stop();
    for(const task of this.inspections.values())task.controller.abort();await Promise.allSettled([...this.inspections.values()].map(value=>value.task));
    await Promise.allSettled([...this.pending]);await this.shared?.close();await this.tasks?.flush();await this.cacheMaintenance;
    for(const item of this.cached.values())await rm(item.directory,{recursive:true,force:true}).catch(error=>this.diagnostic('archive-cache-cleanup',String(error),true));
    this.cached.clear();this.stageSnapshots.clear();await this.dragCache.sweep();
    // Another helper can outlive a crashed One instance. Never recursively
    // remove its leased payload merely because this instance is quitting.
    await this.dragCache.removeEmptyRoot().catch(error=>this.diagnostic('archive-cache-cleanup',String(error),true));
  }
  run(owner:number,request:ArchiveRequest,requestedId?:string):Promise<ArchiveListing|ArchiveResult>{
    if(!request||!['list','details','create','extract','test','update','drag'].includes(request.operation))return Promise.reject(Error('压缩请求无效'));
    return this.schedule(owner,request,requestedId);
  }
  private schedule(owner:number,request:StageInspectRequest,requestedId?:string):Promise<ArchiveRecoveryInspection>;
  private schedule(owner:number,request:ArchiveRequest|RecoveryRequest,requestedId?:string):Promise<ArchiveListing|ArchiveResult>;
  private schedule(owner:number,request:ArchiveRequest|RecoveryRequest|StageInspectRequest,requestedId?:string):Promise<ScheduledResult>{
    if(this.stopped)return Promise.reject(Error('压缩服务正在关闭'));
    if(!request||typeof request!=='object'||typeof request.path!=='string')return Promise.reject(Error('压缩请求无效'));
    if(this.requests.size>=32)return Promise.reject(Error('进行中或等待的压缩任务过多，请等待当前任务完成'));
    const id=requestedId??randomUUID();
    if(typeof id!=='string'||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id)||this.requests.has(id))return Promise.reject(Error('压缩任务编号无效或正在使用'));
    let resources:ArchiveResources,compression:ArchiveCompression,level:number,propagateZone:boolean,scan:boolean,budget:ArchiveBudget,passwordEncoding:ArchivePasswordEncoding,approved:ArchiveRiskApproval|undefined,limits:ExtractionBudget;
    try{approved=riskApproval(request?.riskApproval);limits=extractionBudget(approved??request?.extractionLimits);passwordEncoding=archivePasswordEncoding(request?.passwordEncoding);if(passwordEncoding!==65001&&(typeof request?.path!=='string'||!/\.zip$/i.test(request.path)))throw Error('密码编码选项仅适用于 ZIP；其他格式请使用默认 UTF-8');password(request?.password);}catch(error){return Promise.reject(error);}
    try{const defaults=this.defaults();resources=archiveResources(request,defaults);level=archiveLevel(request?.operation==='create'&&request.level!==undefined?request.level:defaults.compressionLevel??6);propagateZone=(request?.operation==='extract'||request?.operation==='drag')&&request.propagateZone!==undefined?request.propagateZone:defaults.propagateZone??true;if(typeof propagateZone!=='boolean')throw Error('来源标记设置无效');scan=(request?.operation==='extract'||request?.operation==='drag')&&request.scan!==undefined?request.scan:defaults.scanOnExtract??false;if(typeof scan!=='boolean')throw Error('解压扫描设置无效');budget=this.budgetOverride??archiveBudget(defaults,resources);compression=archiveCompression(request.operation==='create'?request:{},archiveCompression(defaults));if(compression.autoThreads&&(request.operation==='create'||request.operation==='update'))resources.threads=Math.max(1,Math.min(availableParallelism(),64,budget.totalThreads));}catch(error){return Promise.reject(error);}
    try{this.scheduler.configure(budget);this.shared??=new ArchiveSharedBudget(budget);this.shared.configure(budget);}catch(error){return Promise.reject(error);}
    this.requests.add(id);
    const job={owner,cancelled:false,committing:false,finishing:false,resources,compression,level,passwordEncoding,riskApproval:approved,extractionLimits:limits,source:request.path,extractionStarted:undefined as number|undefined,propagateZone,scan,controller:new AbortController(),shared:undefined as ArchiveSharedLease|undefined};this.jobs.set(id,job);
    const task=(async()=>{let result:ScheduledResult|undefined,error:unknown,release:(()=>void)|undefined;
      try{if(request&&['create','extract','test','update','drag','recover','cleanup'].includes(request.operation))await this.tasks?.begin(id,request.operation as import('../shared/archive').ArchiveTaskOperation,path(request.path),'queue');
        this.checkpoint(id);release=await this.scheduler.acquire(resources,job.controller.signal,queuePosition=>this.notify(owner,{id,operation:'queue',done:0,total:0,queuePosition}));
        job.shared=await this.shared!.acquire(id,resources,job.controller.signal,queuePosition=>this.notify(owner,{id,operation:'queue',done:0,total:0,queuePosition}));
        this.checkpoint(id);this.diagnostic('archive-job-admitted',JSON.stringify({id,...resources,...this.scheduler.budget}));
        this.diagnostic('archive-shared-budget',JSON.stringify({id,...job.shared.budget}));
        if(request.operation==='extract'||request.operation==='drag'||composite(request.path))this.diagnostic('archive-extraction-budget',JSON.stringify({id,...limits,confirmed:!!approved}));
        result=await this.perform(owner,request,id);return result;
      }catch(cause){error=cause;if(cause instanceof ArchiveFailure&&cause.code==='risk'&&cause.risk)return {path:request.path,count:0,risk:cause.risk};throw cause;}
      finally{job.finishing=true;try{await this.tasks?.finish(id,result&&'count'in result?result:undefined,error,job.cancelled||error instanceof ArchiveFailure&&error.code==='cancelled');}finally{try{await job.shared?.release();}finally{release?.();}}}
    })();
    this.pending.add(task);
    void task.finally(()=>{this.pending.delete(task);this.requests.delete(id);this.jobs.delete(id);}).catch(()=>{});
    return task;
  }
  private async execute(owner:number,id:string,nativeOperation:'list'|'browse'|'details'|'create'|'extract'|'test'|'update'|'drag'|'publish'|'recover'|'cleanup'|'update-stage'|'update-recorded-stage'|'volume-publish'|'volume-recover'|'volume-cleanup'|'stage-inspect'|'stage-cleanup',args:string[],secret:string,progressOperation?:ArchiveProgress['operation'],packet?:Buffer,origin?:{path:string;stamp?:string}):Promise<Message[]> {
    const operation=nativeOperation==='volume-recover'?'recover':nativeOperation==='volume-cleanup'||nativeOperation==='stage-cleanup'?'cleanup':nativeOperation==='stage-inspect'?'list':nativeOperation==='volume-publish'?'publish':nativeOperation==='update-stage'||nativeOperation==='update-recorded-stage'?'update':nativeOperation;
    this.checkpoint(id);
    return new Promise((done,reject)=>{
      // CLI cancellation is handled by this service, not a console-wide signal
      // that could kill the helper during transactional publication.
      const options=this.jobs.get(id)!;
      const child=spawn(helper(),[nativeOperation,...args],{windowsHide:true,stdio:'pipe',detached:this.independentProcessGroup,env:{...process.env,...options.shared!.environment,ONE_ARCHIVE_RISK_SOURCE:options.source,ONE_ARCHIVE_RISK_REVISION:options.riskApproval?.revision??'',ONE_ARCHIVE_EXTRACT_MAX_BYTES:String(options.extractionLimits.maxBytes),ONE_ARCHIVE_EXTRACT_MAX_MS:String(options.extractionLimits.maxMilliseconds),ONE_ARCHIVE_COMPOSITE_PREPARE:operation==='extract'&&composite(args[0])?'1':'0',ONE_ARCHIVE_PASSWORD_ENCODING:String(options.passwordEncoding),ONE_ARCHIVE_SCAN:origin&&options.scan?'1':'0',ONE_ARCHIVE_LEVEL:String(options.level),ONE_ARCHIVE_ZIP_METHOD:options.compression.zipMethod==='xz'?'95':'8',ONE_ARCHIVE_ZIP_AES:options.compression.zipEncryption==='aes256'?'1':'0',ONE_ARCHIVE_7Z_METHOD:options.compression.sevenMethod==='lzma'?'1':'2',ONE_ARCHIVE_7Z_SOLID:String(options.compression.sevenSolid==='off'?0:options.compression.sevenSolid==='solid'?2048:options.compression.sevenSolid),ONE_ARCHIVE_ZIP_WORK_DIR:nativeOperation==='create'&&/\.zip$/i.test(args[0])?join(dirname(args[0]),`.one-archive-${id}-stage`):'',ONE_ARCHIVE_THREADS:String(options.resources.threads),ONE_ARCHIVE_MEMORY_MIB:String(options.resources.memoryMiB),ONE_ARCHIVE_PROPAGATE_ZONE:origin&&options.propagateZone?'1':'0',ONE_ARCHIVE_ZONE_SOURCE:origin?.path??'',ONE_ARCHIVE_ZONE_STAMP:origin?.stamp??''}});
      const task={child,owner,committing:false,cooperative:operation==='publish'||operation==='recover'||operation==='cleanup'};
      this.active.set(id,task);
      const data:Message[]=[];let buffered='',error='',errorCode='archive',failed=false,settled=false;
      let lastProgress='';let risk:ArchiveRisk|undefined,deadline:ReturnType<typeof setTimeout>|undefined;
      if(operation==='extract'){options.extractionStarted??=performance.now();const remaining=options.extractionLimits.maxMilliseconds-(performance.now()-options.extractionStarted);deadline=setTimeout(()=>{failed=true;errorCode='timeout';error='解压超过本次时间上限，已停止解压；内容未发布';this.diagnostic('archive-timeout',JSON.stringify({id,operation,reason:'extraction-budget',maxMilliseconds:options.extractionLimits.maxMilliseconds}),true);child.kill();},Math.max(1,remaining));}
      const watchdog=new ArchiveWatchdog(archiveWatchdogLimits(),()=>task.committing&&operation!=='recover'&&operation!=='cleanup',reason=>{
        failed=true;errorCode='timeout';error=reason==='heartbeat'?'归档辅助进程失去响应，任务已停止':'归档任务长时间没有读写或处理进展，任务已停止';
        this.diagnostic('archive-timeout',JSON.stringify({id,operation,reason}),true);child.kill();
      });
      const scanning=!!origin&&options.scan;let scan:ArchiveScan|undefined,scanTimer:ReturnType<typeof setTimeout>|undefined,scanDone=-1,scanUiTime=0;
      const stopScanTimer=()=>{if(scanTimer)clearTimeout(scanTimer);scanTimer=undefined;};
      const armScanTimer=()=>{stopScanTimer();const test=process.env.ONE_TEST_MODE==='1'?Number(process.env.ONE_ARCHIVE_SCAN_TIMEOUT_MS):NaN;const timeout=Number.isInteger(test)&&test>=50&&test<=3000?test:120000;scanTimer=setTimeout(()=>{scan={state:'incomplete',files:Math.max(0,scanDone),reason:'扫描超过单文件时限'};failed=true;errorCode='scan';error='未完成恶意软件扫描：扫描超时，本次内容未发布';this.diagnostic('archive-scan',JSON.stringify({id,operation,...scan}),true);child.kill();},timeout);};
      const finish=(reason?:Error)=>{if(settled)return;settled=true;if(deadline)clearTimeout(deadline);watchdog.close();stopScanTimer();this.active.delete(id);if(reason)reject(reason);else done(data);};
      child.stdout.setEncoding('utf8');child.stdout.on('data',(chunk:string)=>{
        buffered+=chunk;
        if(buffered.length>2*1024*1024){child.kill();failed=true;error='压缩程序输出超出限制';return;}
        let end:number;
        while((end=buffered.indexOf('\n'))>=0){const line=buffered.slice(0,end).trim();buffered=buffered.slice(end+1);if(!line)continue;
          try{const message=JSON.parse(line) as Message;
            if(message.type==='heartbeat'){watchdog.heartbeat(message.activity);}
            else if(message.type==='ready'){
              if(nativeOperation==='update-stage'||nativeOperation==='update-recorded-stage'||!['update','drag','publish','recover','cleanup'].includes(operation)||failed||child.killed||task.committing){child.kill();failed=true;error='压缩程序返回无效提交状态';}
              else{task.committing=true;if(operation==='publish'||operation==='recover'||operation==='cleanup'){child.stdin.write(Buffer.from([this.jobs.get(id)?.cancelled?2:1]));this.notify(owner,{id,operation:progressOperation??(operation==='publish'?'extract':operation),done:0,total:0});}else{const job=this.jobs.get(id);if(job)job.committing=true;this.notify(owner,{id,operation:operation==='drag'?'drag':'commit',done:0,total:0});child.stdin.end(Buffer.from([1]));}}
            }
            else if(message.type==='progress'){
              const current=`${message.phase??''}:${message.done}:${message.total}`;if(current!==lastProgress){lastProgress=current;watchdog.progress();}
              if(message.phase==='scan'){if(!scanning||scan||!Number.isSafeInteger(message.done)||message.done<0||message.done<=scanDone||message.done>=1000000||message.total!==0)throw Error('扫描进度无效');scanDone=message.done;armScanTimer();const now=Date.now();if(now-scanUiTime>=100){scanUiTime=now;this.notify(owner,{id,operation:'scan',done:message.done,total:0});}}
              else this.notify(owner,{id,operation:operation==='drag'&&task.committing?'drag':progressOperation??(operation==='publish'?'extract':operation) as ArchiveProgress['operation'],done:message.done,total:message.total});
            }
            else if(message.type==='scan'){if(scan||!validArchiveScan(message)||scanning&&message.state==='disabled'||!scanning&&message.state!=='disabled'||message.state==='passed'&&message.files!==scanDone+1||message.state==='empty'&&scanDone!==-1)throw Error('扫描结果无效');scan=copyArchiveScan(message);stopScanTimer();this.diagnostic('archive-scan',JSON.stringify({id,operation,...scan}),['incomplete','blocked'].includes(scan.state));if(scanning)data.push({type:'scan',...scan});if(scan.state==='incomplete'||scan.state==='blocked'){failed=true;errorCode=scan.state==='blocked'?'threat':'scan';error=scan.state==='blocked'?'恶意软件扫描阻止了本次解压；内容未发布':'未完成恶意软件扫描；本次内容未发布，可在设置中关闭扫描后重试';}}
            else if((message as {type:string}).type==='resources'){this.diagnostic('archive-resources',JSON.stringify({id,operation,...options.resources,level:options.level,...options.compression}));}
            else if((message as {type:string}).type==='origin'){const mark=message as unknown as {zone:number;stagedFiles:number};if(![3,4].includes(mark.zone)||!Number.isSafeInteger(mark.stagedFiles)||mark.stagedFiles<0||mark.stagedFiles>1000000)throw Error('来源标记结果无效');this.diagnostic('archive-source-zone',JSON.stringify({id,operation,zone:mark.zone,stagedFiles:mark.stagedFiles}));}
            else if(message.type==='risk'){if(risk||!validArchiveRisk(message))throw Error('解压风险数据无效');risk={revision:message.revision,entries:message.entries,bytes:message.bytes,compressed:message.compressed,nested:message.nested,highRatio:message.highRatio};this.diagnostic('archive-extraction-risk',JSON.stringify({id,operation,...risk}),true);}
            else if(message.type==='error'){failed=true;if(operation==='recover'||operation==='cleanup')this.diagnostic('archive-recovery-error',JSON.stringify({id,operation,message:message.message}),true);error=operation==='recover'||operation==='cleanup'?recoveryDiagnostic(message.message,operation==='cleanup'):archiveDiagnostic(message.message);if(['password','archive','read','write','safety','cancelled','resource','scan','threat','risk','timeout'].includes(message.code??''))errorCode=message.code!;if(errorCode==='scan')error='未完成恶意软件扫描；本次内容未发布，可在设置中关闭扫描后重试';else if(errorCode==='threat')error='恶意软件扫描阻止了本次解压；内容未发布';if(errorCode==='resource'){this.diagnostic('archive-resource-error',JSON.stringify({id,message:message.message}),true);error='归档资源不足或无法应用限制；请降低压缩等级，或提高内存上限后重试';}}
            else data.push(message);
            if(data.length>505){failed=true;error='压缩程序返回过多数据';child.kill();}
          }catch{failed=true;errorCode='archive';error='压缩程序返回无效数据';if(scanning&&!scan){errorCode='scan';error='未完成恶意软件扫描：扫描结果无效，内容未发布';}child.kill();}
        }
      });
      child.stderr.on('data',(chunk:Buffer)=>{if(error.length<512)error+=chunk.toString('utf8').slice(0,512);});
      child.on('error',cause=>finish(cause));
      child.on('close',code=>{
        const cancelled=this.jobs.get(id)?.cancelled||data.some(item=>item.type==='result'&&item.cancelled);
        if(scanning&&!cancelled&&!scan){scan={state:'incomplete',files:Math.max(0,scanDone),reason:'归档进程未返回完整扫描结果'};this.diagnostic('archive-scan',JSON.stringify({id,operation,...scan}),true);if(!failed&&(code===0||scanDone>=0)){failed=true;errorCode='scan';error='未完成恶意软件扫描：缺少扫描结果，内容未发布';}}
        if(failed||code!==0)finish(new ArchiveFailure(error||'压缩任务已取消或失败',this.jobs.get(id)?.cancelled?'cancelled':errorCode,scanning?scan:undefined,risk));else finish();
      });
      const value=Buffer.from(secret,'utf8'),header=Buffer.alloc(4);header.writeUInt32LE(value.length);
      child.stdin.on('error',()=>{});
      const input=Buffer.concat([header,value,...(packet?[packet]:[])]);
      if(operation==='update'||operation==='drag'||operation==='publish'||operation==='recover'||operation==='cleanup')child.stdin.write(input);else child.stdin.end(input);
      // Initial progress can synchronously request cancellation. Write the
      // private request frame first so a cooperative cancel byte cannot corrupt it.
      if(operation!=='list'&&operation!=='browse'&&operation!=='details')this.notify(owner,{id,operation:progressOperation??(operation==='publish'?'extract':operation),done:0,total:0});
    });
  }
  private scanResult(messages:Message[]):{scan?:ArchiveScan}{const scan=messages.find((item):item is Extract<Message,{type:'scan'}>=>item.type==='scan');return scan?{scan:copyArchiveScan(scan)}:{};}
  private async acquireSource(owner:number,id:string,source:string):Promise<{path:string;stamp?:string;release:()=>void}>{
    if(!composite(source))return {path:source,release:()=>{}};
    const info=await stat(source,{bigint:true}),stamp=`${info.size}:${info.mtimeNs}:${info.birthtimeNs}:${info.ino}`;
    const prefix=source.toLowerCase()+'|',version=prefix+stamp+'|',ordinary=version+'ordinary';
    // A TAR prepared without special permission is safe to reuse after an
    // inner-content warning. Keep its identity for the displayed selection.
    // A risky wrapper's cache is only reusable by explicitly approved jobs;
    // changing write limits doesn't change the source or its directory ids.
    const key=!this.jobs.get(id)?.riskApproval||this.cached.has(ordinary)||this.preparing.has(ordinary)?ordinary:version+'confirmed';
    for(const [oldKey,old] of this.cached)if(oldKey.startsWith(prefix)&&!oldKey.startsWith(version)){old.stale=true;this.cached.delete(oldKey);if(!old.users)void rm(old.directory,{recursive:true,force:true}).catch(()=>{});}
    let item=this.cached.get(key);
    if(!item){
      let preparing=this.preparing.get(key);
      if(!preparing){
        preparing=(async()=>{
          await mkdir(this.cacheRoot,{recursive:true});
          const directory=join(this.cacheRoot,randomUUID()),inner=join(directory,'inner.tar');
          try{
            const messages=await this.execute(owner,id,'extract',[source,directory,'','0'],'','prepare');
            if(!messages.some(message=>message.type==='result'))throw Error('无法打开复合压缩包');
            const names=await readdir(directory);
            if(names.length!==1)throw Error('复合压缩包应包含一个 TAR 文件');
            const extracted=join(directory,names[0]),details=await lstat(extracted);
            if(!details.isFile()||details.isSymbolicLink())throw Error('复合压缩包的内部文件无效');
            if(extracted.toLowerCase()!==inner.toLowerCase())await rename(extracted,inner);
            const probe=await this.execute(owner,id,'list',[inner,'0','1','0'],'');
            if(!probe.some(message=>message.type==='meta'))throw Error('复合压缩包的内部文件不是 TAR');
            const current=await stat(source,{bigint:true});
            if(`${current.size}:${current.mtimeNs}:${current.birthtimeNs}:${current.ino}`!==stamp)throw Error('压缩包在读取期间发生了变化，请重试');
            const ready={path:inner,directory,stamp,users:0,used:Date.now(),stale:false};
            this.cached.set(key,ready);
            return ready;
          }catch(error){await rm(directory,{recursive:true,force:true}).catch(()=>{});throw error;}
        })();
        this.preparing.set(key,preparing);
        void preparing.finally(()=>this.preparing.delete(key)).catch(()=>{});
      }
      try{item=await preparing;}catch(error){
        // The shared preparation belongs to its originating job. Cancelling
        // that owner must not cancel another admitted reader of the archive.
        this.checkpoint(id);
        if(error instanceof ArchiveFailure&&error.code==='cancelled')return this.acquireSource(owner,id,source);
        throw error;
      }
    }
    item.users++;item.used=Date.now();
    const cached=item;
    return {path:cached.path,stamp:cached.stamp,release:()=>{cached.users--;if(cached.stale&&!cached.users)void rm(cached.directory,{recursive:true,force:true}).catch(()=>{});else this.sweepCache();}};
  }
  private sweepCache(){
    if(this.cached.size<=2||this.sweepQueued)return;
    this.sweepQueued=true;
    setImmediate(()=>{
      this.sweepQueued=false;
      for(const [key,item] of [...this.cached].sort((a,b)=>a[1].used-b[1].used)){
        if(this.cached.size<=2)break;
        if(item.users)continue;
        this.cached.delete(key);void rm(item.directory,{recursive:true,force:true}).catch(()=>{});
      }
    });
  }
  private async perform(owner:number,request:ArchiveRequest|RecoveryRequest|StageInspectRequest,id:string):Promise<ScheduledResult> {
    await this.cacheMaintenance;
    this.checkpoint(id);
    if(!request||typeof request!=='object')throw Error('压缩请求无效');
    if(request.operation==='inspect-stage'){
      const current=await this.recovery.read(id);
      if(JSON.stringify(current)!==JSON.stringify(request.record)||current.kind!=='volume-update')throw Error('恢复记录已变化，请重新检查');
      const result:ArchiveRecoveryInspection={id,kind:'volume-update',state:'invalid',message:'',items:0,files:0,directories:0,replaced:0,published:0,skipped:0,samples:[]};
      try{const messages=await this.execute(owner,id,'stage-inspect',[current.archive,current.stage,current.path],'');
        if(messages.length!==1||messages[0].type!=='stage-inspection')throw Error('暂存检查未返回唯一结果');
        const {samples,...stage}=archiveStageInspection(messages[0]);
        return{...result,state:'staged',message:stage.sealed?'新卷已生成，尚未交接发布；此流程不会修改原压缩包。':'新卷生成尚未完成；此流程不会修改原压缩包。',items:stage.created,files:stage.files,stage,samples:samples.map(name=>({name,directory:false,existing:false}))};
      }catch(error){if(error instanceof ArchiveFailure&&['cancelled','resource','timeout'].includes(error.code))throw error;const message=error instanceof Error?error.message:String(error);this.diagnostic('archive-stage-inspection-error',JSON.stringify({id,message}),true);return{...result,message:stageInspectionDiagnostic(message)};}
    }
    if(request.operation==='recover'||request.operation==='cleanup'){
      const current=await this.recovery.read(id);
      if(JSON.stringify(current)!==JSON.stringify(request.record))throw Error('恢复记录已变化，请重新检查');
      const staged=request.stageToken!==undefined;
      if(staged&&(request.operation!=='cleanup'||current.kind!=='volume-update'))throw Error('暂存清理请求无效');
      if(!staged&&await recordedStage(current))throw Error('资料已变化，请重新检查暂存后确认清理');
      const nativeOperation=staged?'stage-cleanup':current.kind==='volume-update'?(request.operation==='recover'?'volume-recover':'volume-cleanup'):request.operation;
      const args=staged&&current.kind==='volume-update'?[current.archive,current.stage,current.path,request.stageToken!]:[current.parent,current.path];
      const messages=await this.execute(owner,id,nativeOperation,args,'');
      const result=messages.find((item):item is Extract<Message,{type:'result'}>=>item.type==='result');
      if(!result||!Number.isSafeInteger(result.count)||result.count<0||result.count>1000000)throw Error('恢复处理进程未返回有效结果，请保留剩余资料');
      if(request.operation==='cleanup'){if(!await this.recovery.clearIfAbsent(id))throw Error('恢复目录或分卷暂存目录仍存在，记录已保留；请检查剩余资料');this.stageSnapshots.delete(id);this.diagnostic('archive-recovery-cleaned',JSON.stringify({id,kind:current.kind??'extract',phase:staged?'stage':'publication',count:result.count}));return {path:current.parent,count:result.count,cancelled:result.cancelled};}
      this.diagnostic('archive-recovery-restored',JSON.stringify({id,kind:current.kind??'extract',count:result.count,retained:current.path}));
      return {path:current.path,count:result.count,cancelled:result.cancelled};
    }
    if(request.operation==='list'){
      const source=archiveSource(request.path),offset=Math.max(0,Math.min(1000000,Math.floor(Number(request.offset)||0)));
      const browser=request.browse===undefined?undefined:browsePacket(request.browse);
      if(browser&&request.offset!==undefined&&(!Number.isInteger(request.offset)||request.offset<0||request.offset>1000000))throw Error('压缩包页码无效');
      const prepared=await this.acquireSource(owner,id,source);
      try{
        const messages=await this.execute(owner,id,browser?'browse':'list',[prepared.path,String(offset),'200',String(encoding(request.encoding))],password(request.password),undefined,browser?.packet);
        const meta=messages.find((item):item is Extract<Message,{type:'meta'}>=>item.type==='meta');
        if(!meta)throw Error('无法读取压缩包目录');
        return {path:source,total:meta.total,matched:meta.matched,browse:browser?.query,comment:meta.comment,revision:meta.revision,editable:meta.editable===true,offset,entries:messages.filter((item):item is Extract<Message,{type:'entry'}>=>item.type==='entry').map(({type,...entry})=>entry)};
      }finally{prepared.release();}
    }
    if(request.operation==='details'){
      const source=archiveSource(request.path);
      if(!Number.isInteger(request.index)||request.index<0||request.index>=1000000)throw Error('文件编号无效');
      if(!validArchiveRevision(request.revision))throw Error('请重新打开压缩包后查看文件信息');
      const prepared=await this.acquireSource(owner,id,source);
      try{
        const messages=await this.execute(owner,id,'details',[prepared.path,String(request.index),String(encoding(request.encoding)),request.revision],password(request.password));
        const response=messages.filter((item):item is Extract<Message,{type:'details'}>=>item.type==='details');
        if(response.length!==1)throw Error('无法读取文件信息');
        const details=archiveEntryDetails(response[0]);if(details.entry.index!==request.index)throw Error('文件信息与当前选择不一致');
        return {path:source,count:1,details};
      }finally{prepared.release();}
    }
    if(request.operation==='drag'){
      const source=archiveSource(request.path),secret=password(request.password);
      if(!validArchiveRevision(request.revision))throw Error('请重新打开压缩包后再拖出');
      const selected=request.selected;
      const folders=folderSelection(request.selectedFolders);
      if(!Array.isArray(selected)||!selected.length&&!folders.folders.length||selected.length+folders.folders.length>10000||selected.some(index=>!Number.isInteger(index)||index<0||index>=1000000))throw Error('请选择 1–10000 项拖出');
      const indexes=Buffer.alloc(4+selected.length*4);indexes.writeUInt32LE(selected.length);
      selected.forEach((value,index)=>indexes.writeUInt32LE(value,4+index*4));
      const packet=Buffer.concat([indexes,...(folders.packet?[folders.packet]:[])]);
      const prepared=await this.acquireSource(owner,id,source);
      let job:Awaited<ReturnType<ArchiveDragCache['create']>>|undefined,retainCache=false;
      try{
        await this.dragCache.sweep();job=await this.dragCache.create(id);
        const messages=await this.execute(owner,id,'drag',[prepared.path,job.payload,String(encoding(request.encoding)),request.revision,this.sourceWindow(owner),job.lease,...(folders.packet?['--folders']:[])],secret,'prepare',packet,{path:source,stamp:prepared.stamp});
        const result=messages.find((item):item is Extract<Message,{type:'result'}>=>item.type==='result');
        if(!result)throw Error('拖出未完成');
        retainCache=result.retainCache===true;
        return {path:source,count:result.count,cancelled:result.cancelled===true,...this.scanResult(messages)};
      }finally{
        prepared.release();
        // The helper exits only after the target ends its async operation and
        // closes all contents streams. Never remove files when DoDragDrop alone returns.
        // A path-only drop target may open the files after OLE returns. Keep that
        // marked job for the regular 24-hour cache sweep; streams still release immediately.
        if(job&&retainCache)this.diagnostic('archive-drag-path-cache-retained',id,false);
        else if(job)await this.dragCache.release(id).then(removed=>{if(!removed)this.diagnostic('archive-drag-cache-retained',id,true);}).catch(error=>this.diagnostic('archive-drag-cache-cleanup',String(error),true));
      }
    }
    if(request.operation==='update'){
      const source=archiveSource(request.path);
      if(!/\.(?:zip|7z|7z\.001)$/i.test(source))throw Error('目前支持修改 ZIP 和 7Z 压缩包');
      if(!validArchiveRevision(request.revision))throw Error('请重新打开压缩包后再保存修改');
      const packet=await archiveEditPacket(request.changes);
      if(/\.7z(?:\.001)?$/i.test(source)&&request.changes.some(change=>change.kind==='comment'))throw Error('7Z 格式不支持压缩包备注');
      if(/\.7z\.001$/i.test(source)||/\.zip$/i.test(source)&&request.revision.startsWith('v2:'))return this.updateVolumes(owner,id,source,request,packet);
      const suffix=extname(source),temporary=join(dirname(source),`.one-update-${id}${suffix}`),backup=join(dirname(source),`.one-update-${id}.original${suffix}`);
      try{
        const messages=await this.execute(owner,id,'update',[source,temporary,backup,String(encoding(request.encoding)),request.revision],password(request.password),undefined,packet);
        const result=messages.find((item):item is Extract<Message,{type:'result'}>=>item.type==='result');
        if(!result)throw Error('压缩程序未确认修改成功');
        return {path:source,count:result.count};
      }finally{
        await rm(temporary,{force:true}).catch(()=>{});
        // A backup left by a failed OS replacement is recovery data. Never
        // delete it here, even if the original path happens to exist again.
      }
    }
    if(request.operation==='test'){
      const source=archiveSource(request.path);
      const prepared=await this.acquireSource(owner,id,source);
      try{
        const messages=await this.execute(owner,id,'test',[prepared.path,String(encoding(request.encoding))],password(request.password));
        const result=messages.find((item):item is Extract<Message,{type:'result'}>=>item.type==='result');
        if(!result)throw new ArchiveFailure('压缩程序未确认校验成功');
        return {path:source,count:result.count};
      }finally{prepared.release();}
    }
    if(request.operation==='create'){
      const target=archiveTarget(request.path),sources=request.sources;
      const seven=/\.7z$/i.test(target),zip=/\.zip$/i.test(target),single=/\.(?:gz|xz)$/i.test(target)&&!composite(target);
      if(!Array.isArray(sources)||!sources.length||sources.length>128)throw Error('请选择 1–128 个文件或文件夹');
      const volumeBytes=request.volumeBytes??0;
      if(!Number.isSafeInteger(volumeBytes)||volumeBytes<0||volumeBytes>64*1024**3||(volumeBytes>0&&volumeBytes<1024**2))
        throw Error('分卷大小须为 1 MB 至 64 GB');
      const secret=password(request.password);
      if(!zip&&!seven&&(secret||volumeBytes))throw Error('TAR、GZ 和 XZ 不支持密码或分卷');
      const checked=await Promise.all(sources.map(async item=>{const source=path(item),info=await lstat(source);if(info.isSymbolicLink()||(!info.isFile()&&!info.isDirectory()))throw Error('不支持压缩链接或特殊文件');if(info.isDirectory()&&!relative(source,target).startsWith('..')&&!isAbsolute(relative(source,target)))throw Error('压缩包不能保存在被压缩的文件夹中');return source;}));
      if(single&&(checked.length!==1||!(await lstat(checked[0])).isFile()))throw Error('GZ 和 XZ 只能压缩单个文件；压缩文件夹请选 TAR.GZ 或 TAR.XZ');
      const names=new Set<string>();
      for(const source of checked){const name=basename(source).toLowerCase();if(names.has(name))throw Error('所选内容包含同名文件或文件夹，请分开压缩');names.add(name);}
      if(existsSync(target)||seven&&volumeBytes>0&&existsSync(target+'.001'))throw new ArchiveFailure('目标压缩包已经存在','write');
      const suffix=basename(target).slice(archiveName(target).length);
      const temporary=join(dirname(target),`.one-archive-${id}${suffix}`);
      const temporaryStem=temporary.slice(0,-4),targetStem=target.slice(0,-4);
      const stage=join(dirname(target),`.one-archive-${id}-stage`);let stageOwned=false;
      const createStage=async()=>{try{await mkdir(stage);stageOwned=true;}catch(error){this.diagnostic('archive-create-staging-failed',JSON.stringify({id,message:String(error)}),true);throw new ArchiveFailure('无法创建压缩暂存目录，请检查保存位置与写入权限','write');}};
      const zipParts=async()=>{
        const prefix=basename(temporaryStem)+'.z';
        return (await readdir(dirname(temporary))).filter(name=>name.startsWith(prefix)&&/^\d{2,}$/.test(name.slice(prefix.length)))
          .sort((a,b)=>Number(a.slice(prefix.length))-Number(b.slice(prefix.length)))
          .map(name=>({temporary:join(dirname(temporary),name),target:targetStem+'.z'+name.slice(prefix.length)}));
      };
      const sevenParts:{temporary:string;target:string}[]=[];
      const controller=new AbortController();
      const published:string[]=[];
      try{
        let messages:Message[];
        if(composite(target)){
          await createStage();
          const inner=join(stage,archiveName(target)+'.tar');
          await this.execute(owner,id,'create',[inner,...checked],'');
          await this.execute(owner,id,'test',[inner,'0'],'');
          messages=await this.execute(owner,id,'create',[temporary,inner],'');
        }else{if(zip&&this.jobs.get(id)!.resources.threads>1)await createStage();messages=await this.execute(owner,id,'create',[temporary,...(zip&&volumeBytes?[`--volume=${volumeBytes}`]:[]),...checked],secret);}
        await this.execute(owner,id,'test',[temporary,'0'],secret);this.checkpoint(id);
        const result=messages.find((item):item is Extract<Message,{type:'result'}>=>item.type==='result');
        if(!result)throw Error('压缩程序未确认创建成功');
        if(seven&&volumeBytes){
          this.publishing.set(id,{controller,owner});
          const size=(await stat(temporary)).size;
          const count=Math.ceil(size/volumeBytes);
          if(count<1||count>4096)throw Error('7Z 分卷数量超出支持范围');
          for(let index=0;index<count;index++){
            controller.signal.throwIfAborted();
            const suffix=String(index+1).padStart(3,'0');
            const item={temporary:temporary+'.'+suffix,target:target+'.'+suffix};
            if(existsSync(item.target))throw Error('目标目录中已存在同名分卷');
            sevenParts.push(item);
            await pipeline(createReadStream(temporary,{start:index*volumeBytes,end:Math.min(size-1,(index+1)*volumeBytes-1)}),createWriteStream(item.temporary,{flags:'wx'}),{signal:controller.signal});
            this.notify(owner,{id,operation:'create',done:index+1,total:count});
          }
        }
        const parts=seven?sevenParts:zip?await zipParts():[];
        this.checkpoint(id);
        controller.signal.throwIfAborted();
        for(const item of parts)if(existsSync(item.target))throw Error('目标目录中已存在同名分卷');
        for(const item of parts){controller.signal.throwIfAborted();await link(item.temporary,item.target);published.push(item.target);}
        controller.signal.throwIfAborted();
        this.seal(owner,id);if(!seven||!volumeBytes)await link(temporary,target);
        return {path:seven&&volumeBytes?target+'.001':target,count:composite(target)?checked.length:result.count};
      }catch(error){await Promise.allSettled(published.map(item=>rm(item,{force:true})));throw error;}
      finally{this.publishing.delete(id);await rm(temporary,{force:true}).catch(()=>{});for(const item of seven?sevenParts:zip?await zipParts().catch(()=>[]):[])await rm(item.temporary,{force:true}).catch(()=>{});if(stageOwned)await rm(stage,{recursive:true,force:true}).catch(()=>{});}
    }
    if(request.operation==='extract'){
      const source=archiveSource(request.path),parent=path(request.parent),parentInfo=await stat(parent);
      if(!parentInfo.isDirectory())throw Error('请选择目标文件夹');
      const destination=request.destination??'folder';
      if(!['folder','smart','here'].includes(destination))throw Error('解压位置模式无效');
      const conflict=request.conflict??'rename';if(!['rename','skip','replace'].includes(conflict))throw Error('同名文件处理方式无效');
      const selected=request.selected||[];
      const folders=folderSelection(request.selectedFolders);
      if(!Array.isArray(selected)||selected.length+folders.folders.length>10000||selected.some(value=>!Number.isSafeInteger(value)||value<0||value>=1000000))throw Error('选择的条目无效');
      if(request.revision!==undefined&&!validArchiveRevision(request.revision))throw Error('请重新打开压缩包后再解压');
      const uniqueTarget=(name:string,file=false)=>{const extension=file?extname(name):'',base=extension?name.slice(0,-extension.length):name;let target=join(parent,name),suffix=2;while(existsSync(target)){target=join(parent,`${base} (${suffix++})${extension}`);if(suffix>10000)throw Error('没有可用的解压目标名称');}return target;};
      const temporary=join(parent,`.one-extract-${id}`);
      const prepared=await this.acquireSource(owner,id,source);
      try{
        const messages=await this.execute(owner,id,'extract',[prepared.path,temporary,selected.join(','),String(encoding(request.encoding)),...(folders.packet?['--folders']:[]),...(request.revision?[`--revision=${request.revision}`]:[])],password(request.password),undefined,folders.packet,{path:source,stamp:prepared.stamp});
        const result=messages.find((item):item is Extract<Message,{type:'result'}>=>item.type==='result');
        if(!result)throw Error('压缩程序未确认解压成功');
        if(destination==='here'){
          const recovery=join(parent,`.one-recovery-${id}`);
          await this.recovery.register(id,source,parent);
          let published:Message[];
          try{published=await this.execute(owner,id,'publish',[temporary,parent,recovery,conflict,source],'');}
          catch(error){
            // A terminated helper cannot emit its usual retained-backup error.
            // Check only this request's exact directory; never scan or clean
            // other recovery directories as if they were extraction caches.
            const directory=await lstat(recovery).catch(()=>undefined),manifest=directory?.isDirectory()&&!directory.isSymbolicLink()?await lstat(join(recovery,'manifest.jsonl')).catch(()=>undefined):undefined;
            if(manifest?.isFile()&&!manifest.isSymbolicLink()){
              this.diagnostic('archive-recovery-retained',JSON.stringify({id,path:recovery}),true);
              throw new ArchiveFailure(`解压发布异常结束，请检查目标目录。恢复资料保留在：${recovery}。请勿删除该目录。\n${error instanceof Error?error.message:String(error)}`,error instanceof ArchiveFailure?error.code:'archive',error instanceof ArchiveFailure?error.scan:undefined);
            }
            throw error;
          }finally{await this.recovery.clearIfAbsent(id).catch(error=>this.diagnostic('archive-recovery-index',String(error),true));}
          const outcome=published.find((item):item is Extract<Message,{type:'result'}>=>item.type==='result');
          if(!outcome)throw Error('压缩程序未确认提交成功');
          if(!outcome.cancelled)this.seal(owner,id,true);
          return {path:parent,count:outcome.count,skipped:outcome.skipped??0,cancelled:outcome.cancelled===true,...this.scanResult(messages)};
        }
        this.checkpoint(id);const top=destination==='smart'?await readdir(temporary):[];
        let target:string;
        if(top.length===1){
          const extracted=join(temporary,top[0]),info=await lstat(extracted);
          if(!info.isFile()&&!info.isDirectory())throw Error('压缩包包含无法安全提交的条目');
          target=uniqueTarget(top[0],info.isFile());
          this.seal(owner,id);
          if(info.isFile())await link(extracted,target);else await rename(extracted,target);
        }else{
          target=uniqueTarget(archiveName(source));
          this.seal(owner,id);
          await rename(temporary,target);
        }
        return {path:target,count:result.count,...this.scanResult(messages)};
      }finally{prepared.release();await rm(temporary,{recursive:true,force:true}).catch(()=>{});}
    }
    throw Error('未知压缩操作');
  }
  private async updateVolumes(owner:number,id:string,source:string,request:Extract<ArchiveRequest,{operation:'update'}>,packet:Buffer):Promise<ArchiveResult>{
    const parent=dirname(source),stage=join(parent,`.one-update-${randomUUID()}`),primary=join(stage,basename(source));
    // Register before even staging. A killed rewriter has not touched originals,
    // but its partially written directory must remain discoverable after restart.
    const recovery=await this.recovery.register(id,source,parent,{kind:'volume-update',stage});
    try{
      const prepared=await this.execute(owner,id,'update-recorded-stage',[source,stage,recovery.path,String(encoding(request.encoding)),request.revision],password(request.password),'update',packet);
      const staged=prepared.find((item):item is NativeResult=>item.type==='result');
      if(!staged||staged.staged!==true||typeof staged.path!=='string'||staged.path.toLowerCase()!==primary.toLowerCase()||!validArchiveRevision(staged.revision)||!Number.isSafeInteger(staged.count)||staged.count<0||staged.count>1000000||typeof staged.volumes!=='number'||!Number.isSafeInteger(staged.volumes)||staged.volumes<1||staged.volumes>4096)throw Error('压缩程序未返回有效的新卷组，请保留暂存资料');
      this.checkpoint(id);
      const published=await this.execute(owner,id,'volume-publish',[source,primary,recovery.path,String(encoding(request.encoding)),request.revision,staged.revision!],password(request.password),'update');
      const result=published.find((item):item is NativeResult=>item.type==='result');
      if(result?.cancelled)throw new ArchiveFailure('修改已取消，原卷组已还原；新卷暂存已保留','cancelled');
      if(!result||result.committed!==true||result.count!==staged.volumes||result.volumes!==staged.volumes||typeof result.cleanupPending!=='boolean'||result.recovery!==(result.cleanupPending?recovery.path:''))throw Error('压缩程序未确认整组保存结果，请检查恢复资料');
      // A flushed native commit is final, including cancellation received while
      // old copies were being cleaned. Do not report a successful save as cancelled.
      this.seal(owner,id,true);
      let retained=result.cleanupPending;
      try{retained=!await this.recovery.clearIfAbsent(id);}catch(error){retained=true;this.diagnostic('archive-volume-index-cleanup',JSON.stringify({id,message:String(error)}),true);}
      if(retained)this.diagnostic('archive-volume-cleanup-pending',JSON.stringify({id,recovery:recovery.path}),true);
      return{path:source,count:staged.count,...(retained?{recovery:recovery.path}:{})};
    }catch(error){
      // Never recursively remove a stage or recovery tree: files can change
      // after a helper exits. The immutable index and native journal govern
      // later restore/cleanup; a partial stage with no journal is kept explicitly.
      const retained=await this.recovery.clearIfAbsent(id).then(cleared=>!cleared).catch(()=>true);
      if(retained){this.diagnostic('archive-volume-recovery-retained',JSON.stringify({id,recovery:recovery.path,stage}),true);throw new ArchiveFailure(`${error instanceof Error?error.message:'分卷修改未完成'}。恢复资料已保留，请在“恢复资料”中检查；暂存目录：${stage}`,error instanceof ArchiveFailure?error.code:'archive');}
      throw error;
    }
  }
}
