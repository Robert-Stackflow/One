import {validArchiveScan,copyArchiveScan} from '../shared/archive-scan';
import {open,readFile,mkdir,rename,rm,lstat} from 'node:fs/promises';
import {dirname,isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {ArchiveTask,ArchiveTaskOperation,ArchiveTaskOverview,ArchiveProgress,ArchiveResult} from '../shared/archive';

const operations:ArchiveTaskOperation[]=['create','extract','test','update','drag'];
const phases=['create','extract','test','prepare','update','commit','drag','scan'];
const states=['running','completed','failed','cancelled','interrupted'];
const integer=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
const taskPath=(value:unknown)=>typeof value==='string'&&value.length<=32768&&isAbsolute(value)&&!value.includes('\0');
const valid=(value:ArchiveTask)=>value&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value.id)&&operations.includes(value.operation)&&states.includes(value.state)&&taskPath(value.path)&&integer(value.started)&&integer(value.done)&&integer(value.total)&&phases.includes(value.phase)&&typeof value.cancellable==='boolean'&&(value.finished===undefined||integer(value.finished))&&(value.message===undefined||typeof value.message==='string'&&value.message.length<=2048)&&(value.scan===undefined||validArchiveScan(value.scan))&&(value.result===undefined||taskPath(value.result.path)&&integer(value.result.count)&&(value.result.skipped===undefined||integer(value.result.skipped))&&(value.result.cancelled===undefined||typeof value.result.cancelled==='boolean'));
const copy=(task:ArchiveTask):ArchiveTask=>({...task,...(task.scan?{scan:copyArchiveScan(task.scan)}:{}),...(task.result?{result:{...task.result}}:{})});

/** Bounded task summaries, without request arguments, passwords or per-entry data. */
export class ArchiveTasks {
 private live=new Map<string,ArchiveTask>();private recent:ArchiveTask[]=[];private writes=Promise.resolve();private ready:Promise<void>;private error='';
 constructor(private file:string,private changed:()=>void=()=>{},private diagnostic:(message:string)=>void=()=>{}){this.ready=this.load();}
 private warn(error:unknown){this.error='归档任务记录未能保存或读取';this.diagnostic(error instanceof Error?error.message:String(error));this.changed();}
 private async load(){try{
  const info=await lstat(this.file);if(!info.isFile()||info.isSymbolicLink()||info.size>32*1024**2)throw Error('Archive task history is not a bounded ordinary file');
  const data=JSON.parse(await readFile(this.file,'utf8'));if(data.version!==1||!Array.isArray(data.tasks)||data.tasks.length>132||!data.tasks.every(valid))throw Error('Invalid archive task history');
  const interrupted=data.tasks.some((task:ArchiveTask)=>task.state==='running');
  const unique=new Set<string>();this.recent=data.tasks.filter((task:ArchiveTask)=>{if(unique.has(task.id))return false;unique.add(task.id);return true;}).map((task:ArchiveTask)=>{
   // Reconstruct only known summary fields; never retain unknown request data.
   const value:ArchiveTask={id:task.id,operation:task.operation,state:task.state,path:task.path,started:task.started,finished:task.finished,phase:task.phase,done:task.done,total:task.total,cancellable:false,result:task.result?{path:task.result.path,count:task.result.count,skipped:task.result.skipped,cancelled:task.result.cancelled}:undefined,message:task.message,scan:task.scan?copyArchiveScan(task.scan):undefined};
   if(value.state==='running'){value.state='interrupted';value.finished=Date.now();value.message='上次运行异常结束，任务结果尚未确认；请检查输出。';}return value;
  }).sort((a:ArchiveTask,b:ArchiveTask)=>(b.finished??b.started)-(a.finished??a.started)).slice(0,100);
  if(interrupted)await this.persist();
 }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')this.warn(error);}}
 async overview():Promise<ArchiveTaskOverview>{await this.ready;return {active:[...this.live.values()].map(copy).sort((a,b)=>a.started-b.started),recent:this.recent.slice(0,30).map(copy),error:this.error};}
 async begin(id:string,operation:ArchiveTaskOperation,path:string){await this.ready;if(!taskPath(path)||!operations.includes(operation))return;
  this.live.set(id,{id,operation,state:'running',path,started:Date.now(),phase:operation,done:0,total:0,cancellable:true});this.changed();await this.persist();
 }
 progress(value:ArchiveProgress,cancellable:boolean){const task=this.live.get(value.id);if(!task)return;const notify=task.phase!==value.operation||task.cancellable!==cancellable;task.phase=value.operation;task.done=integer(value.done)?value.done:0;task.total=integer(value.total)?value.total:0;task.cancellable=cancellable;if(notify)this.changed();}
 cancelling(id:string){const task=this.live.get(id);if(task){task.cancellable=false;this.changed();}}
 async finish(id:string,result?:ArchiveResult,error?:unknown,cancelled=false){await this.ready;const task=this.live.get(id);if(!task)return;
  this.live.delete(id);task.finished=Date.now();task.cancellable=false;task.state=cancelled||result?.cancelled?'cancelled':error?'failed':'completed';
  if(result)task.result={path:result.path,count:result.count,skipped:result.skipped,cancelled:result.cancelled};
  const scan=result?.scan??(error&&typeof error==='object'&&'scan'in error?error.scan:undefined);if(validArchiveScan(scan))task.scan=copyArchiveScan(scan);
  if(error&&!cancelled)task.message=(error instanceof Error?error.message:String(error)).slice(0,2048);
  this.recent.unshift(task);this.recent.length=Math.min(this.recent.length,100);this.changed();await this.persist();
 }
 private persist(){this.writes=this.writes.then(async()=>{let temporary='';try{
   await mkdir(dirname(this.file),{recursive:true});try{const info=await lstat(this.file);if(info.isSymbolicLink()||!info.isFile())throw Error('Archive task history target is not an ordinary file');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
   const text=JSON.stringify({version:1,tasks:[...this.live.values(),...this.recent]});if(Buffer.byteLength(text)>32*1024**2)throw Error('Archive task history exceeds size limit');
   const candidate=this.file+'.'+randomUUID()+'.tmp',handle=await open(candidate,'wx');temporary=candidate;
   try{await handle.writeFile(text,'utf8');await handle.sync();}finally{await handle.close();}
   await rename(temporary,this.file);temporary='';this.error='';
  }catch(error){this.warn(error);}finally{if(temporary)await rm(temporary,{force:true}).catch(error=>this.warn(error));}
 });return this.writes;}
 async flush(){await this.ready;await this.writes;}
}
