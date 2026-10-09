import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import type {ArchiveBudget,ArchiveResources} from '../shared/archive-options';
import {ArchiveBudgetFailure} from './archive-scheduler';

type Native={open:(scope:string)=>unknown;error:()=>string;owner:(handle:unknown)=>string;step:(handle:unknown,count:number,memory:number,threads:number,id:string,memoryMiB:number,taskThreads:number,out:Buffer)=>number;release:(handle:unknown,id:string)=>number;close:(handle:unknown)=>number};
let native:Native|undefined;
const nativeRequire=createRequire(__filename);
function binding():Native {
 if(native)return native;
 // Keep the coordinator next to the archive helper, including ASAR installs.
 const library=nativeRequire('koffi').load(join(__dirname,'../native/One.ArchiveBudget.dll').replace('app.asar\\','app.asar.unpacked\\'));
 return native={open:library.func('void *one_budget_open(str16 scope)'),error:library.func('str16 one_budget_error()'),owner:library.func('str16 one_budget_owner(void *handle)'),step:library.func('int one_budget_step(void *handle,uint32 count,uint32 memory,uint32 threads,str id,uint32 taskMemory,uint32 taskThreads,_Out_ void *out)'),release:library.func('int one_budget_release(void *handle,str id)'),close:library.func('int one_budget_close(void *handle)')};
}
export function archiveCoordinationScope():string {
 const isolated=process.env.ONE_ARCHIVE_TEST_BUDGET_SCOPE;
 if(process.env.ONE_TEST_MODE==='1'&&isolated&&/^[a-z0-9-]{1,80}$/.test(isolated))return isolated;
 // Installed GUI/CLI versions share one user/session budget. Repository dev
 // and isolated build trees cannot consume the installed application's quota.
 return /[\\/]resources[\\/]/i.test(__dirname)?'main':'dev-'+createHash('sha256').update(__dirname.toLowerCase()).digest('hex').slice(0,24);
}
const delay=(signal?:AbortSignal)=>new Promise<void>((resolve,reject)=>{
 if(signal?.aborted)return reject(signal.reason);
 const abort=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(signal?.reason);};
 const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},100);signal?.addEventListener('abort',abort,{once:true});
});
export type ArchiveSharedLease={environment:Record<string,string>;release:()=>Promise<void>;budget:ArchiveBudget};

/** OS-owned, user/session-scoped reservations for complete service jobs. */
export class ArchiveSharedBudget {
 private handle:unknown;private budget:ArchiveBudget;private closed=false;
 private dirty=false;private refreshing:Promise<void>|undefined;private failure:Error|undefined;
 readonly scope=archiveCoordinationScope();
 constructor(budget:ArchiveBudget){this.budget={...budget};}
 configure(value:ArchiveBudget){this.budget={...value};this.dirty=true;if(this.handle)this.refresh();}
 private refresh(){
  if(this.refreshing||this.closed)return;
  this.refreshing=(async()=>{while(this.dirty&&!this.closed){this.dirty=false;const value=this.budget;
   const result=binding().step(this.handle,value.maxConcurrent,value.totalMemoryMiB,value.totalThreads,'',0,0,Buffer.alloc(16));
   if(result<0)throw new ArchiveBudgetFailure('无法更新跨进程归档资源预算',{cause:Error(binding().error())});if(result===2){this.dirty=true;await delay();}
  }})().catch(error=>{this.failure=error;}).finally(()=>{this.refreshing=undefined;if(this.dirty&&!this.closed&&!this.failure)this.refresh();});
 }
 private open(){if(!this.handle){let cause:unknown;try{this.handle=binding().open(this.scope);if(!this.handle)cause=Error(binding().error());}catch(error){cause=error;}if(!this.handle)throw new ArchiveBudgetFailure('无法打开跨进程归档资源队列，请检查安装文件后重试',{cause});}return this.handle;}
 async acquire(id:string,resources:ArchiveResources,signal:AbortSignal,position:(value:number)=>void):Promise<ArchiveSharedLease>{
  if(this.closed)throw new ArchiveBudgetFailure('归档资源队列正在关闭');if(this.failure)throw this.failure;
  const handle=this.open();let admitted=false,last=0;
  try{for(;;){
   if(signal.aborted)throw signal.reason;const out=Buffer.alloc(16),limits=this.budget;
   const result=binding().step(handle,limits.maxConcurrent,limits.totalMemoryMiB,limits.totalThreads,id,resources.memoryMiB,resources.threads,out);
   if(result===1){admitted=true;let released=false;return {environment:{ONE_ARCHIVE_BUDGET_SCOPE:this.scope,ONE_ARCHIVE_BUDGET_OWNER:binding().owner(handle),ONE_ARCHIVE_BUDGET_TASK:id},budget:{maxConcurrent:out.readUInt32LE(4),totalMemoryMiB:out.readUInt32LE(8),totalThreads:out.readUInt32LE(12)},release:async()=>{if(released)return;released=true;await this.release(id);}};}
   if(result===-2)throw new ArchiveBudgetFailure('任务超过其他 One 实例的共享资源预算；请降低任务资源，或调整其他实例的总预算后重试');
   if(result<0)throw new ArchiveBudgetFailure(result===-3?'跨进程归档队列已满，请等待其他任务结束':'无法校验跨进程归档资源队列，任务未启动',{cause:Error(binding().error())});
   if(result===0){const value=out.readUInt32LE();if(value!==last){last=value;position(value);}}
   await delay(signal);
  }}finally{if(!admitted)await this.release(id);}
 }
 private async release(id:string){for(;;){const result=binding().release(this.handle,id);if(result===1)return;if(result<0)throw new ArchiveBudgetFailure('无法释放跨进程归档资源额度，请退出 One 后重试',{cause:Error(binding().error())});await delay();}}
 async close(){if(this.closed)return;this.closed=true;await this.refreshing;if(!this.handle)return;for(;;){const result=binding().close(this.handle);if(result===1){this.handle=undefined;return;}if(result<0)throw new ArchiveBudgetFailure('无法关闭跨进程归档资源队列',{cause:Error(binding().error())});await delay();}}
}
