import {Worker} from 'node:worker_threads';
import {join} from 'node:path';
import type {MaintenanceKind,MaintenanceReport,MaintenanceOutcome,MaintenanceReceipt,MaintenanceProgress} from '../shared/maintenance';
export class MaintenanceClient {
 private worker:Worker;private sequence=0;private pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void}>();private closed=false;
 constructor(path:string,progress:(value:MaintenanceProgress)=>void,roots?:string[]){this.worker=new Worker(join(__dirname,'maintenance-worker.cjs'),{workerData:{path,roots}});this.worker.on('message',message=>{if(message.progress){progress(message.progress);return;}const pending=this.pending.get(message.id);if(!pending)return;this.pending.delete(message.id);if(message.error)pending.reject(new Error(message.error));else pending.resolve(message.value);});this.worker.on('error',error=>this.fail(error));this.worker.on('exit',()=>this.fail(new Error('维护服务已退出')));}
 private fail(error:Error){this.closed=true;for(const p of this.pending.values())p.reject(error);this.pending.clear();}
 private request<T>(operation:string,...args:unknown[]):Promise<T>{if(this.closed)return Promise.reject(new Error('维护服务不可用'));const id=++this.sequence;return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.worker.postMessage({id,operation,args});});}
 scan(kind:MaintenanceKind){return this.request<MaintenanceReport>('scan',kind);}
 cancel(kind:MaintenanceKind){return this.request<void>('cancel',kind);}
 apply(report:string,ids:string[]){return this.request<MaintenanceOutcome>('apply',report,ids);}
 receipts(){return this.request<MaintenanceReceipt[]>('receipts');}
 restore(id:string){return this.request<void>('restore',id);}
 manage(kind:string){return this.request<void>('manage',kind);}
 stop(){this.worker.postMessage({operation:'stop'});this.fail(new Error('维护服务已关闭'));setTimeout(()=>void this.worker.terminate(),250).unref();}
}
