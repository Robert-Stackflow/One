import {Worker} from 'node:worker_threads';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {unlink,readFile,rm,rmdir} from 'node:fs/promises';
import type {TextProgress,TextComparison,TextDifference} from '../shared/text-tools';
type Cache={id:string;directory:string;report?:TextComparison};
type Job={resolve:(value:any)=>void;reject:(e:Error)=>void;timer:NodeJS.Timeout;temporary?:string;cache?:Cache;heavy:boolean};
type Slot={worker:Worker;job?:Job;idle?:NodeJS.Timeout};
export class TextService {
 private pool=new Map<number,Slot>();
 private comparisons=new Map<number,Cache>();
 private cleanups=new Set<Promise<unknown>>();
 private root=resolve(tmpdir(),'One.Text',randomUUID());
 private stopped=false;
 constructor(private changed:(owner:number,value:TextProgress)=>void){}
 private track(work:Promise<unknown>){this.cleanups.add(work);void work.finally(()=>this.cleanups.delete(work));return work;}
 private remove(cache:Cache){
  // Only UUID directories allocated by this service may be recursively removed.
  const path=resolve(cache.directory),inside=relative(this.root,path);
  if(!/^[0-9a-f-]{36}$/.test(cache.id)||inside!==cache.id||isAbsolute(inside))throw new Error('文本缓存路径无效');
  return this.track(rm(path,{recursive:true,force:true}).catch(()=>{}));
 }
 private retire(owner:number,slot:Slot){if(this.pool.get(owner)===slot)this.pool.delete(owner);clearTimeout(slot.idle);return this.track(slot.worker.terminate().catch(()=>{}));}
 run<T>(owner:number,task:any):Promise<T>{
  if(this.stopped)throw new Error('文本服务正在关闭');let slot=this.pool.get(owner);if(slot?.job)throw new Error('请先停止当前文本任务');
  if(!slot){
   const worker=new Worker(join(__dirname,'text-worker.cjs'),{resourceLimits:{maxOldGenerationSizeMb:384}});slot={worker};this.pool.set(owner,slot);const current=slot;
   worker.on('message',message=>{
    const job=current.job;if(!job)return;
    if(Object.hasOwn(message,'temporary')){job.temporary=message.temporary||undefined;return;}
    if(message.progress){this.changed(owner,message.progress);clearTimeout(job.timer);job.timer=setTimeout(()=>this.cancel(owner,'处理超时，请调整文本或正则表达式'),message.timeout||30000);return;}
    clearTimeout(job.timer);current.job=undefined;
    if(message.error){if(job.cache)void this.remove(job.cache);job.reject(new Error(message.error));}
    else {
     if(job.cache){const previous=this.comparisons.get(owner);job.cache.report=message.result;this.comparisons.set(owner,job.cache);if(previous)void this.remove(previous);}
     job.resolve(message.result);
    }
    // Large ropes and comparison arrays should not leave a large idle worker heap resident.
    if(job.heavy||message.error)void this.retire(owner,current);
    else {current.idle=setTimeout(()=>void this.retire(owner,current),60000);current.idle.unref();}
   });
   worker.on('error',e=>{if(this.pool.get(owner)===current)this.cancel(owner,e.message);});
   worker.on('exit',code=>{if(this.pool.get(owner)===current){this.pool.delete(owner);if(current.job){clearTimeout(current.job.timer);if(current.job.cache)void this.remove(current.job.cache);current.job.reject(new Error(`文本服务已退出 (${code})`));}}});
  }
  clearTimeout(slot.idle);const current=slot,cache:Cache|undefined=task.kind==='compare'?{id:randomUUID(),directory:''}:undefined;if(cache)cache.directory=join(this.root,cache.id);
  return new Promise<T>((resolve,reject)=>{current.job={resolve,reject,cache,heavy:!!cache||(task.text?.length||0)>1_000_000,timer:setTimeout(()=>this.cancel(owner,'文本处理超时'),30000)};current.worker.postMessage({...task,...(cache?{cache}:{})});});
 }
 async page(owner:number,id:unknown,page:unknown):Promise<TextDifference[]>{
  const cache=this.comparisons.get(owner);if(!cache||id!==cache.id||!Number.isSafeInteger(page)||(page as number)<0||(page as number)>=Math.ceil(cache.report!.count/cache.report!.pageSize))throw new Error('差异记录已关闭或页码无效');
  return JSON.parse(await readFile(join(cache.directory,`${page}.json`),'utf8'));
 }
 async clear(owner:number,id:unknown){const cache=this.comparisons.get(owner);if(!cache||cache.id!==id)return;this.comparisons.delete(owner);await this.remove(cache);}
 cancel(owner:number,message='处理已停止'){
  const slot=this.pool.get(owner);if(!slot)return;const job=slot.job;slot.job=undefined;if(job){clearTimeout(job.timer);job.reject(new Error(message));}
  const termination=this.retire(owner,slot);void this.track(termination.then(async()=>{if(job?.temporary)await unlink(job.temporary).catch(()=>{});if(job?.cache)await this.remove(job.cache);}));
 }
 release(owner:number){this.cancel(owner);const cache=this.comparisons.get(owner);if(cache)void this.clear(owner,cache.id);}
 get pendingTasks(){return this.pool.size+this.comparisons.size+this.cleanups.size;}
 async stop(){this.stopped=true;for(const owner of new Set([...this.pool.keys(),...this.comparisons.keys()]))this.release(owner);while(this.cleanups.size)await Promise.all([...this.cleanups]);await rmdir(this.root).catch(()=>{});}
}
