import CodeWorker from './code-worker?worker';
export class PreviewWorkerClient {
 private worker=new CodeWorker();private next=0;private closed=false;private pending=new Map<number,{resolve:(value:unknown)=>void;reject:(error:Error)=>void}>();
 constructor(){
  this.worker.onmessage=e=>{const request=this.pending.get(e.data.requestId);if(!request)return;this.pending.delete(e.data.requestId);e.data.error?request.reject(new Error(e.data.error)):request.resolve(e.data.result);};
  this.worker.onerror=()=>{this.closed=true;this.reject(new Error('无法解析，请查看源码'));this.worker.terminate();};
 }
 request<T>(data:Record<string,unknown>):Promise<T>{if(this.closed)return Promise.reject(new DOMException('预览已关闭','AbortError'));return new Promise<T>((resolve,reject)=>{const requestId=++this.next;this.pending.set(requestId,{resolve:value=>resolve(value as T),reject});this.worker.postMessage({...data,requestId});});}
 private reject(error:Error){for(const request of this.pending.values())request.reject(error);this.pending.clear();}
 close(){this.closed=true;this.worker.terminate();this.reject(new DOMException('预览已关闭','AbortError'));}
}
