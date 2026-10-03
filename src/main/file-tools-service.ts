import {Worker} from 'node:worker_threads';
import {readFile,writeFile,mkdir,readdir,rm,unlink,rmdir,lstat,realpath} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {FileToolTask,FileToolReport,FileToolProgress,FileToolRow,FileToolKind} from '../shared/file-tools';
import {paths} from './file-tool-fs';
type Job={id:string;owner:number;kind:FileToolKind;phase:'loading'|'directory'|'running';created:boolean;worker?:Worker;cancelled?:Error;finishing:boolean;finish:(error?:Error,report?:FileToolReport)=>Promise<void>;timer?:NodeJS.Timeout;done:Promise<void>;complete:()=>void};
const idPattern=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const mutation=(kind:FileToolKind)=>kind==='rename-apply'||kind==='rename-undo';
const taskKinds:FileToolKind[]=['duplicates','diff','rename-preview','rename-apply','rename-undo','document-index','document-search'];
export class FileToolsService{
 private jobs=new Map<string,Job>();private closing=new Set<Job>();private mutationStarting=false;private stopped=false;private reports=new Map<string,FileToolReport>();private ready:Promise<void>;
 constructor(private root:string,private progress:(owner:number,value:FileToolProgress)=>void){this.ready=this.load();}
 get pendingTasks(){return this.jobs.size+this.closing.size;}
 get busyTransactions(){return [...this.jobs.values(),...this.closing].some(job=>mutation(job.kind));}
 private async load(){await mkdir(this.root,{recursive:true});for(const item of await readdir(this.root,{withFileTypes:true})){const id=item.name;if(!idPattern.test(id)||!item.isDirectory()||item.isSymbolicLink())continue;try{const report=JSON.parse(await readFile(join(this.root,id,'report.json'),'utf8'));if(report.id===id){this.reports.set(id,report);continue;}}catch{}await this.removeTransient(id).catch(()=>{});}}
 /** Reap only marked read-only work, after its worker has closed all file handles. */
 private async removePages(target:string,files:{name:string}[]){
  // Keep the ownership marker until all pages are gone, so interrupted cleanup can resume.
  for(let at=0;at<files.length;at+=32){const results=await Promise.allSettled(files.slice(at,at+32).filter(file=>file.name!=='.one-task.json').map(file=>unlink(join(target,file.name)).catch(error=>{if(error.code!=='ENOENT')throw error;})));const failed=results.find((result):result is PromiseRejectedResult=>result.status==='rejected');if(failed)throw failed.reason;}
  await unlink(join(target,'.one-task.json')).catch(error=>{if(error.code!=='ENOENT')throw error;});await rmdir(target);
 }
 private async removeTransient(id:string,starting=false){
  const target=resolve(this.root,id);if(!idPattern.test(id)||dirname(target).toLowerCase()!==resolve(this.root).toLowerCase())throw Error('任务清理路径无效');
  try{const stat=await lstat(target);if(!stat.isDirectory()||stat.isSymbolicLink())return;
   const [rootPath,targetPath]=await Promise.all([realpath(this.root),realpath(target)]);if(dirname(targetPath).toLowerCase()!==rootPath.toLowerCase())return;
   const files=await readdir(target,{withFileTypes:true});
   // Creation succeeded in this live job, but its marker may have failed to write.
   if(starting&&files.every(file=>file.isFile()&&!file.isSymbolicLink()&&file.name==='.one-task.json')){await this.removePages(target,files);return;}
   const marker=JSON.parse(await readFile(join(target,'.one-task.json'),'utf8'));if(marker.version!==1||marker.id!==id||!taskKinds.includes(marker.kind)||mutation(marker.kind))return;
   if(files.some(file=>!file.isFile()||file.isSymbolicLink()||!/^\.one-task\.json$|^report\.json$|^(?:page-\d+|group-\d+-page-\d+)\.json$/.test(file.name)))return;
   if(files.some(file=>file.name==='report.json')){try{const report=JSON.parse(await readFile(join(target,'report.json'),'utf8'));if(report.id===id&&taskKinds.includes(report.kind))return;}catch(error){if(!(error instanceof SyntaxError))throw error;}}
   await this.removePages(target,files);
  }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}
 }
 async history(){await this.ready;return [...this.reports.values()].sort((a,b)=>b.created-a.created).slice(0,30);}
 async report(id:string){await this.ready;if(!idPattern.test(id)||!this.reports.has(id))throw Error('任务记录不存在');return this.reports.get(id)!;}
 async page(id:string,page:number,group?:number){const report=await this.report(id);if(!Number.isInteger(page)||page<0||page>1e7||group!==undefined&&(!Number.isInteger(group)||group<0||group>=report.count||report.kind!=='duplicates'))throw Error('结果页无效');const file=join(this.root,id,(group===undefined?'page-':`group-${group}-page-`)+page+'.json');try{return JSON.parse(await readFile(file,'utf8')) as FileToolRow[];}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return[];throw e;}}
 async run(owner:number,value:FileToolTask):Promise<FileToolReport>{
  if(!value||!taskKinds.includes(value.kind))throw Error('文件任务无效');let task=value;const key=owner+':'+task.kind;if(this.jobs.has(key))throw Error('请先停止当前任务');if(this.stopped)throw Error('文件服务正在关闭');if(mutation(task.kind)&&this.mutationStarting)throw Error('请等待当前重命名操作完成');if(mutation(task.kind))this.mutationStarting=true;
  try{return await new Promise<FileToolReport>((resolveResult,reject)=>{
   const id=randomUUID(),dir=join(this.root,id);let complete!:()=>void;const done=new Promise<void>(resolve=>complete=resolve);
   const job:Job={id,owner,kind:task.kind,phase:'loading',created:false,finishing:false,done,complete,finish:async(error,report)=>{
    if(job.finishing)return job.done;job.finishing=true;clearTimeout(job.timer);if(this.jobs.get(key)===job)this.jobs.delete(key);this.closing.add(job);
    try{await job.worker?.terminate();if(error&&job.created&&!mutation(task.kind))await this.removeTransient(id,job.phase==='directory');}catch{error=Error((error?.message||'任务退出失败')+'；临时结果未能清理，重启后重试');}
    finally{this.closing.delete(job);job.complete();}
    if(error)reject(error);else if(report)resolveResult(report);
   }};
   // Reserve before initial history loading and directory creation, covering cold-start cancel/quit.
   this.jobs.set(key,job);
   const watchdog=()=>{clearTimeout(job.timer);if(!mutation(task.kind))job.timer=setTimeout(()=>this.cancel(owner,task.kind,'任务长时间没有响应，已停止'),60000);};watchdog();
   void(async()=>{try{
    await Promise.race([this.ready,job.done]);if(job.finishing)return;if(job.cancelled)throw job.cancelled;task=this.validate(value);job.phase='directory';
    await mkdir(dir);job.created=true;await writeFile(join(dir,'.one-task.json'),JSON.stringify({version:1,id,kind:task.kind,created:Date.now()}));if(job.cancelled)throw job.cancelled;
    job.phase='running';
    const worker=job.worker=new Worker(join(__dirname,'file-tools-worker.cjs'),{workerData:{task,context:{id,dir,root:this.root,database:join(this.root,'documents.sqlite')}},resourceLimits:{maxOldGenerationSizeMb:384}});
    worker.on('message',message=>{if(this.jobs.get(key)!==job||job.cancelled)return;if(message.progress){watchdog();this.progress(owner,message.progress);return;}
     if(message.error){void job.finish(Error(message.error));return;}
     const report=message.report as FileToolReport;if(!report||report.id!==id||report.kind!==task.kind){void job.finish(Error('任务返回的记录无效'));return;}this.reports.set(id,report);
     if(task.kind==='rename-undo'){const old=this.reports.get(task.receipt);if(old){old.receipt=undefined;old.stats.undone=1;}}
     void job.finish(undefined,report);void this.prune().catch(()=>{});
    });worker.once('error',e=>void job.finish(e));worker.once('exit',code=>{if(this.jobs.get(key)===job)void job.finish(job.cancelled||Error('文件任务已退出（'+code+'）'));});
   }catch(error){void job.finish(error instanceof Error?error:Error(String(error)));}})();
  });}finally{if(mutation(task.kind))this.mutationStarting=false;}
 }
 private async prune(){const all=[...this.reports.values()].sort((a,b)=>b.created-a.created),keep=new Set(all.slice(0,100).map(r=>r.id));for(const report of all){if(keep.has(report.id)||report.kind==='rename-apply'&&report.receipt)continue;const target=resolve(this.root,report.id);if(!idPattern.test(report.id)||dirname(target).toLowerCase()!==resolve(this.root).toLowerCase())continue;this.reports.delete(report.id);await rm(target,{recursive:true,force:true});}}
 private validate(task:FileToolTask){
  if(!task||!taskKinds.includes(task.kind))throw Error('文件任务无效');
  if('roots'in task)task={...task,roots:paths(task.roots)};
  if('recursive'in task&&typeof task.recursive!=='boolean')throw Error('扫描范围无效');
  if(task.kind==='rename-preview'){task={...task,paths:paths(task.paths)};if(typeof task.files!=='boolean'||typeof task.folders!=='boolean'||task.selectedOnly!==undefined&&typeof task.selectedOnly!=='boolean')throw Error('项目类型无效');}
  if(task.kind==='diff'){task={...task,left:paths([task.left])[0],right:paths([task.right])[0]};if(!['file','folder'].includes(task.mode)||typeof task.ignoreWhitespace!=='boolean')throw Error('比较模式无效');if(!['自动','UTF-8','UTF-16','GBK','Big5'].includes(task.encoding))throw Error('文本编码无效');}
  if(task.kind==='duplicates'&&(!Number.isFinite(task.minBytes)||task.minBytes<0||typeof task.extensions!=='string'))throw Error('扫描条件无效');
  if(task.kind==='document-index'&&typeof task.extensions!=='string')throw Error('文档类型无效');
  if(task.kind==='document-search'&&(typeof task.query!=='string'||!task.query.trim()||task.query.length>256))throw Error('请输入 1–256 字符的正文关键词');
  if(task.kind==='rename-apply'&&!this.reports.has(task.report)||task.kind==='rename-undo'&&!this.reports.has(task.receipt))throw Error('任务记录不存在');
  if(task.kind==='rename-apply')for(const ids of [task.ids,task.excluded])if(ids!==undefined&&(!Array.isArray(ids)||ids.some(id=>!Number.isInteger(id)||id<0)||ids.length>100000))throw Error('选择项目无效');
  return task;
 }
 cancel(owner:number,kind?:FileToolKind,message='任务已停止'){
  if(kind&&mutation(kind)&&[...this.jobs.values(),...this.closing].some(job=>job.owner===owner&&job.kind===kind))throw Error('正在保存重命名操作，请等待完成');
  const pending=[...this.closing].filter(job=>job.owner===owner&&(!kind||job.kind===kind)&&!mutation(job.kind)).map(job=>job.done);for(const job of this.jobs.values()){if(job.owner!==owner||kind&&job.kind!==kind||mutation(job.kind))continue;job.cancelled=Error(message);clearTimeout(job.timer);if(job.worker||job.phase==='loading')void job.finish(job.cancelled);pending.push(job.done);}return Promise.all(pending).then(()=>{});
 }
 async stop(){this.stopped=true;await this.ready;const pending=[...this.jobs.values(),...this.closing];for(const job of [...this.jobs.values()])this.cancel(job.owner);await Promise.all(pending.map(job=>job.done));}
}
