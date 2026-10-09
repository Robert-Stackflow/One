import {archiveBudget,type ArchiveBudget,type ArchiveResources} from '../shared/archive-options';

type Waiting={resources:ArchiveResources;signal:AbortSignal;abort:()=>void;resolve:(release:()=>void)=>void;reject:(error:unknown)=>void;position:(value:number)=>void;last:number};
export class ArchiveBudgetFailure extends Error {readonly code='resource';}

/** FIFO admission; reserve the whole job, including scanning and publication. */
export class ArchiveScheduler {
 private limits=archiveBudget();private running=0;private memory=0;private threads=0;private waiting:Waiting[]=[];private pumping=false;private rerun=false;
 get budget():ArchiveBudget{return {...this.limits};}
 configure(value:ArchiveBudget){this.limits=archiveBudget(value);this.pump();}
 private oversized(value:ArchiveResources){return value.memoryMiB>this.limits.totalMemoryMiB||value.threads>this.limits.totalThreads;}
 acquire(resources:ArchiveResources,signal:AbortSignal,position:(value:number)=>void):Promise<()=>void>{
  if(signal.aborted)return Promise.reject(signal.reason);
  if(this.oversized(resources))return Promise.reject(new ArchiveBudgetFailure('单个任务超过归档队列总预算；请降低任务内存或线程数，或在设置中提高总预算'));
  if(this.waiting.length>=32)return Promise.reject(new ArchiveBudgetFailure('归档队列已满，请等待当前任务完成'));
  return new Promise((resolve,reject)=>{
   const item:Waiting={resources:{...resources},signal,resolve,reject,position,last:0,abort:()=>{
    const index=this.waiting.indexOf(item);if(index<0)return;
    this.waiting.splice(index,1);signal.removeEventListener('abort',item.abort);reject(signal.reason);this.pump();
   }};
   signal.addEventListener('abort',item.abort,{once:true});this.waiting.push(item);this.pump();
  });
 }
 private pump(){
  if(this.pumping){this.rerun=true;return;}this.pumping=true;
  try{
   for(;;){
    // A changed budget may no longer admit a waiting job. Fail explicitly
    // rather than leave it waiting forever. Running reservations stay intact.
    for(const item of [...this.waiting])if(this.oversized(item.resources)){
     this.waiting.splice(this.waiting.indexOf(item),1);item.signal.removeEventListener('abort',item.abort);
     item.reject(new ArchiveBudgetFailure('归档队列总预算已降低，无法运行此任务；请调整资源设置后重试'));
    }
    const item=this.waiting[0];if(!item||this.running>=this.limits.maxConcurrent||this.memory+item.resources.memoryMiB>this.limits.totalMemoryMiB||this.threads+item.resources.threads>this.limits.totalThreads)break;
    this.waiting.shift();item.signal.removeEventListener('abort',item.abort);
    this.running++;this.memory+=item.resources.memoryMiB;this.threads+=item.resources.threads;let released=false;
    item.resolve(()=>{if(released)return;released=true;this.running--;this.memory-=item.resources.memoryMiB;this.threads-=item.resources.threads;this.pump();});
   }
   for(const item of [...this.waiting]){
    const index=this.waiting.indexOf(item);if(index<0||item.last===index+1)continue;item.last=index+1;
    try{item.position(index+1);}catch(error){const current=this.waiting.indexOf(item);if(current>=0){item.signal.removeEventListener('abort',item.abort);this.waiting.splice(current,1);item.reject(error);this.rerun=true;}}
   }
  }finally{this.pumping=false;}
  // Position notifications can synchronously cancel the head. Re-evaluate
  // admission after callbacks, without polling or delaying helper startup.
  if(this.rerun){this.rerun=false;this.pump();}
 }
}
