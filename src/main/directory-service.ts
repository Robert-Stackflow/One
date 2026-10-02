import {Worker} from 'node:worker_threads';
import {join} from 'node:path';
import type {DirectoryInfo,DirectoryPage} from '../shared/directory';
interface Client {worker:Worker;next:number;pending:Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void}>}
export class DirectoryService {
 private clients=new Map<number,Client>();
 private client(owner:number){let client=this.clients.get(owner);if(client)return client;
  const worker=new Worker(join(__dirname,'directory-worker.cjs'),{resourceLimits:{maxOldGenerationSizeMb:192}});client={worker,next:0,pending:new Map()};this.clients.set(owner,client);const current=client;
  worker.on('message',message=>{const request=current.pending.get(message.requestId);if(!request)return;current.pending.delete(message.requestId);message.error?request.reject(new Error(message.error)):request.resolve(message.result);});
  worker.on('error',error=>{for(const request of current.pending.values())request.reject(error);current.pending.clear();if(this.clients.get(owner)===current)this.clients.delete(owner);});
  worker.on('exit',()=>{for(const request of current.pending.values())request.reject(new Error('目录读取已终止'));current.pending.clear();if(this.clients.get(owner)===current)this.clients.delete(owner);});return client;
 }
 private request<T>(owner:number,message:Record<string,unknown>):Promise<T>{const client=this.client(owner),requestId=++client.next;return new Promise<T>((resolve,reject)=>{client.pending.set(requestId,{resolve,reject});client.worker.postMessage({...message,requestId});});}
 open(owner:number,path:string,target?:string){return this.request<DirectoryInfo>(owner,{action:'open',path,target});}
 page(owner:number,id:string,offset:number,limit:number,query=''){return this.request<DirectoryPage>(owner,{action:'page',id,offset,limit,query});}
 release(owner:number,id:string){if(this.clients.has(owner))void this.request(owner,{action:'release',id}).catch(()=>{});}
 close(owner:number){const client=this.clients.get(owner);if(!client)return;this.clients.delete(owner);for(const request of client.pending.values())request.reject(new Error('预览已关闭'));client.pending.clear();void client.worker.terminate();}
}
