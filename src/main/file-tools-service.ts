import {Worker} from 'node:worker_threads';
import {readFile,mkdir,readdir,rm} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {FileToolTask,FileToolReport,FileToolProgress,FileToolRow,FileToolKind} from '../shared/file-tools';
import {paths} from './file-tool-fs';
type Job={id:string;owner:number;kind:FileToolKind;worker:Worker;reject:(e:Error)=>void;timer?:NodeJS.Timeout;done:Promise<void>;complete:()=>void};
const idPattern=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const mutation=(kind:FileToolKind)=>kind==='rename-apply'||kind==='rename-undo';
export class FileToolsService{
 private jobs=new Map<string,Job>();private closing=new Set<Job>();private mutationStarting=false;private stopped=false;private reports=new Map<string,FileToolReport>();private ready:Promise<void>;
 constructor(private root:string,private progress:(owner:number,value:FileToolProgress)=>void){this.ready=this.load();}
 get pendingTasks(){return this.jobs.size+this.closing.size;}
 get busyTransactions(){return [...this.jobs.values(),...this.closing].some(job=>mutation(job.kind));}
 private async load(){await mkdir(this.root,{recursive:true});for(const id of await readdir(this.root)){if(!idPattern.test(id))continue;try{const report=JSON.parse(await readFile(join(this.root,id,'report.json'),'utf8'));if(report.id===id)this.reports.set(id,report);}catch{}}}
 async history(){await this.ready;return [...this.reports.values()].sort((a,b)=>b.created-a.created).slice(0,30);}
 async report(id:string){await this.ready;if(!idPattern.test(id)||!this.reports.has(id))throw Error('任务记录不存在');return this.reports.get(id)!;}
 async page(id:string,page:number,group?:number){const report=await this.report(id);if(!Number.isInteger(page)||page<0||page>1e7||group!==undefined&&(!Number.isInteger(group)||group<0||group>=report.count||report.kind!=='duplicates'))throw Error('结果页无效');const file=join(this.root,id,(group===undefined?'page-':`group-${group}-page-`)+page+'.json');try{return JSON.parse(await readFile(file,'utf8')) as FileToolRow[];}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return[];throw e;}}
 async run(owner:number,value:FileToolTask):Promise<FileToolReport>{
  await this.ready;const task=this.validate(value),key=owner+':'+task.kind;if(this.jobs.has(key))throw Error('请先停止当前任务');if(this.stopped)throw Error('文件服务正在关闭');if(mutation(task.kind)&&this.mutationStarting)throw Error('请等待当前重命名操作完成');if(mutation(task.kind))this.mutationStarting=true;try{if(mutation(task.kind))await Promise.all([...this.closing].filter(job=>mutation(job.kind)).map(job=>job.done));const id=randomUUID(),dir=join(this.root,id);await mkdir(dir);if(this.stopped)throw Error('文件服务正在关闭');
  return await new Promise((resolve,reject)=>{
   const worker=new Worker(join(__dirname,'file-tools-worker.cjs'),{workerData:{task,context:{id,dir,root:this.root,database:join(this.root,'documents.sqlite')}},resourceLimits:{maxOldGenerationSizeMb:384}});
   let complete!:()=>void;const done=new Promise<void>(resolve=>complete=resolve),job:Job={id,owner,kind:task.kind,worker,reject,done,complete};this.jobs.set(key,job);
   const watchdog=()=>{clearTimeout(job.timer);if(!mutation(task.kind))job.timer=setTimeout(()=>this.cancel(owner,task.kind,'任务长时间没有响应，已停止'),60000);};watchdog();
   let finishing=false;const finish=()=>{if(finishing)return;finishing=true;clearTimeout(job.timer);if(this.jobs.get(key)===job)this.jobs.delete(key);this.closing.add(job);void worker.terminate().finally(()=>{this.closing.delete(job);job.complete();});};
   worker.on('message',message=>{if(this.jobs.get(key)!==job)return;if(message.progress){watchdog();this.progress(owner,message.progress);return;}
    if(message.error){finish();void job.done.then(()=>reject(Error(message.error)));return;}
    const report=message.report as FileToolReport;this.reports.set(id,report);
    if(task.kind==='rename-undo'){const old=this.reports.get(task.receipt);if(old){old.receipt=undefined;old.stats.undone=1;}}
    finish();void job.done.then(()=>resolve(report));void this.prune().catch(()=>{});
   });worker.once('error',e=>{finish();reject(e);});worker.once('exit',code=>{if(this.jobs.get(key)===job){finish();reject(Error('文件任务已退出（'+code+'）'));}});
  });}finally{if(mutation(task.kind))this.mutationStarting=false;}
 }
 private async prune(){const all=[...this.reports.values()].sort((a,b)=>b.created-a.created),keep=new Set(all.slice(0,100).map(r=>r.id));for(const report of all){if(keep.has(report.id)||report.kind==='rename-apply'&&report.receipt)continue;const target=resolve(this.root,report.id);if(!idPattern.test(report.id)||dirname(target).toLowerCase()!==resolve(this.root).toLowerCase())continue;this.reports.delete(report.id);await rm(target,{recursive:true,force:true});}}
 private validate(task:FileToolTask){
  if(!task||!['duplicates','diff','rename-preview','rename-apply','rename-undo','document-index','document-search'].includes(task.kind))throw Error('文件任务无效');
  if('roots'in task)task={...task,roots:paths(task.roots)};
  if('recursive'in task&&typeof task.recursive!=='boolean')throw Error('扫描范围无效');
  if(task.kind==='rename-preview'){task={...task,paths:paths(task.paths)};if(typeof task.files!=='boolean'||typeof task.folders!=='boolean')throw Error('项目类型无效');}
  if(task.kind==='diff'){task={...task,left:paths([task.left])[0],right:paths([task.right])[0]};if(!['file','folder'].includes(task.mode)||typeof task.ignoreWhitespace!=='boolean')throw Error('比较模式无效');if(!['自动','UTF-8','UTF-16','GBK','Big5'].includes(task.encoding))throw Error('文本编码无效');}
  if(task.kind==='duplicates'&&(!Number.isFinite(task.minBytes)||task.minBytes<0||typeof task.extensions!=='string'))throw Error('扫描条件无效');
  if(task.kind==='document-index'&&typeof task.extensions!=='string')throw Error('文档类型无效');
  if(task.kind==='document-search'&&(typeof task.query!=='string'||!task.query.trim()||task.query.length>256))throw Error('请输入 1–256 字符的正文关键词');
  if(task.kind==='rename-apply'&&!this.reports.has(task.report)||task.kind==='rename-undo'&&!this.reports.has(task.receipt))throw Error('任务记录不存在');
  if(task.kind==='rename-apply')for(const ids of [task.ids,task.excluded])if(ids!==undefined&&(!Array.isArray(ids)||ids.some(id=>!Number.isInteger(id)||id<0)||ids.length>100000))throw Error('选择项目无效');
  return task;
 }
 cancel(owner:number,kind?:FileToolKind,message='任务已停止'){
  if(kind&&mutation(kind)&&this.jobs.has(owner+':'+kind))throw Error('正在保存重命名操作，请等待完成');
  for(const [key,job]of this.jobs){if(job.owner!==owner||kind&&job.kind!==kind||mutation(job.kind))continue;clearTimeout(job.timer);this.jobs.delete(key);this.closing.add(job);void job.worker.terminate().finally(()=>{this.closing.delete(job);job.complete();});job.reject(Error(message));}
 }
 async stop(){this.stopped=true;const pending=[...this.jobs.values(),...this.closing];for(const job of [...this.jobs.values()])this.cancel(job.owner);await Promise.all(pending.map(job=>job.done));}
}
