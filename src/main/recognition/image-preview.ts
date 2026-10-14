import { fork,type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { imagePreviewRequest,type OCRImagePreviewRequest } from '../../shared/recognition/image-preview';
interface Pending { region:OCRImagePreviewRequest;resolve:(png:Uint8Array)=>void;reject:(error:Error)=>void }
/** One lazy, bounded decoder per window; obsolete queued views never decode. */
export class OCRImagePreview {
  private child?:ChildProcess;
  private queue:Pending[]=[];
  private view=-1;
  private busy=false;
  private closed=false;
  private failure?:Error;
  private stopped?:Promise<void>;
  private pending?:(error:Error)=>void;
  constructor(private png:Buffer,private size:{width:number;height:number},private worker=join(__dirname,'recognition/ocr-tile-worker.cjs')){}
  request(value:unknown):Promise<Uint8Array>{
    const region=imagePreviewRequest(value,this.size);
    if(this.closed||this.failure)return Promise.reject(this.failure||Error('图片预览已关闭'));
    if(region.view<this.view)return Promise.reject(Error('图片视图已更新'));
    if(region.view>this.view){this.view=region.view;for(const task of this.queue)task.reject(Error('图片视图已更新'));this.queue=[];}
    if(this.queue.length>=32)return Promise.reject(Error('图片预览请求过多'));
    const promise=new Promise<Uint8Array>((resolve,reject)=>this.queue.push({region,resolve,reject}));void this.pump();return promise;
  }
  private async start(){
    if(this.child)return;
    const child=this.child=fork(this.worker,[],{execArgv:['--max-old-space-size=128'],serialization:'advanced',windowsHide:true,
      stdio:['ignore','ignore','pipe','ipc'],env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}});
    child.stderr?.resume();
    child.on('error',error=>{this.failure=error;this.pending?.(error);});
    child.on('exit',code=>{const error=this.failure||Error(this.closed?'图片预览已关闭':code===70?'图片预览超过内存预算':'图片预览进程已退出');this.failure=error;this.pending?.(error);});
    if(!(await this.packet({type:'open',mode:'preview',png:this.png,size:this.size})).ready)throw Error('图片预览初始化无效');
  }
  private packet(value:Record<string,any>):Promise<any>{
    if(this.closed||this.failure)return Promise.reject(this.failure||Error('图片预览已关闭'));
    const child=this.child!;
    return new Promise((resolve,reject)=>{
      let done=false;
      const finish=(error?:Error,response?:any)=>{if(done)return;done=true;clearTimeout(timer);child.off('message',message);this.pending=undefined;error?reject(error):resolve(response);};
      const message=(response:any)=>finish(response?.error?Error(String(response.error).slice(0,500)):undefined,response);
      this.pending=error=>finish(error);
      const timer=setTimeout(()=>{finish(Error('图片预览解码超时'));child.kill();},30000);timer.unref();child.once('message',message);
      try{child.send(value,error=>{if(error)finish(error);});}catch(error){finish(error as Error);}
    });
  }
  private async pump(){
    if(this.busy||this.closed)return;this.busy=true;
    try{
      while(this.queue.length&&!this.closed){
        const task=this.queue.shift()!;
        try{
          await this.start();if(task.region.view!==this.view){task.reject(Error('图片视图已更新'));continue;}
          const response=await this.packet({type:'preview',region:task.region}),png=response?.png;
          if(response?.preview!==true||response.view!==task.region.view||!Buffer.isBuffer(png)||png.length<33||png.length>8*1024**2||
            png.toString('hex',0,8)!=='89504e470d0a1a0a'||png.readUInt32BE(8)!==13||png.toString('ascii',12,16)!=='IHDR'||png[28]!==0||png.readUInt32BE(16)!==Math.ceil(task.region.width/task.region.downsample)||
            png.readUInt32BE(20)!==Math.ceil(task.region.height/task.region.downsample)||!Number.isFinite(response.peakRSSMiB)||response.peakRSSMiB<1||response.peakRSSMiB>384)throw Error('图片预览结果无效');
          if(this.closed||task.region.view!==this.view){png.fill(0);task.reject(Error('图片视图已更新'));}
          else task.resolve(png);
        }catch(error){task.reject(error as Error);if(this.closed)break;this.failure=error as Error;throw error;}
      }
    }catch(error){for(const task of this.queue)task.reject(error as Error);this.queue=[];this.child?.kill();}
    finally{this.busy=false;}
  }
  close():Promise<void>{
    if(this.stopped)return this.stopped;this.closed=true;
    const error=Error('图片预览已关闭');for(const task of this.queue)task.reject(error);this.queue=[];this.pending?.(error);
    const child=this.child;
    return this.stopped=child?.pid&&child.exitCode===null&&child.signalCode===null?
      new Promise<void>(resolve=>{child.once('exit',()=>resolve());child.kill();}):Promise.resolve();
  }
}
