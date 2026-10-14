import {fork,type ChildProcess} from 'node:child_process';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {limitChildProcess} from '../capture/native';
import {localInference} from '../local-inference-scheduler';
import {formulaText} from '../../shared/recognition/formula';
import {formulaCrop,FORMULA_PNG_BYTES,FORMULA_RENDER_PIXELS,FORMULA_SVG_BYTES,type FormulaCrop} from '../../shared/recognition/formula-image';
import {validateSvg} from '../image-svg';
interface ImageResult {kind:'crop'|'render';png:Buffer;width:number;height:number;svg?:string}
export class FormulaImageRunner {
  private active?:Promise<ImageResult>;private abort?:AbortController;private closed=false;
  private readonly client={owner:Symbol('formula-image')};
  constructor(private worker=join(__dirname,'recognition/formula-image-worker.cjs'),private timeout=15000){}
  get waiting(){return localInference.waiting(this.client);}
  async cancel(){this.abort?.abort();await this.active?.catch(()=>{});}
  async close(){this.closed=true;await this.cancel();}
  crop(png:Buffer,size:{width:number;height:number},crop:FormulaCrop){const checked=formulaCrop(crop,size);return this.run({kind:'crop',png:Buffer.from(png),crop:checked});}
  render(text:string){return this.run({kind:'render',text:formulaText(text)});}
  private run(job:{kind:'crop'|'render';png?:Buffer;crop?:FormulaCrop;text?:string}):Promise<ImageResult>{
    if(this.closed||this.active){job.png?.fill(0);return Promise.reject(Error('公式图片任务正在进行或已关闭'));}
    const abort=this.abort=new AbortController(),sha256=createHash('sha256').update(job.png||job.text!).digest('hex');
    const task=localInference.run(this.client,abort.signal,()=>new Promise<ImageResult>((resolve,reject)=>{
      let child:ChildProcess,release:(()=>void)|undefined,response:any,error:unknown;
      try{child=fork(this.worker,[],{serialization:'advanced',execArgv:['--max-old-space-size=128'],windowsHide:true,stdio:['ignore','ignore','ignore','ipc'],env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}});}catch(value){reject(value);return;}
      const cancel=()=>{error=Error('公式图像处理已取消');child.kill();};const timer=setTimeout(()=>{error=Error('公式图像处理超时，请分段处理');child.kill();},this.timeout);
      child.once('spawn',()=>{try{release=limitChildProcess(child.pid!,768);if(abort.signal.aborted)cancel();else child.send(job);}catch(value){error=value;child.kill();}});
      child.on('message',value=>{if(response){error=Error('公式图像返回次数无效');child.kill();}else response=value;});child.once('error',value=>{error=value;});abort.signal.addEventListener('abort',cancel,{once:true});
      child.once('close',code=>{
        clearTimeout(timer);abort.signal.removeEventListener('abort',cancel);release?.();
        try{
          if(error)throw error;if(!response?.ok)throw Error(response?.error||'公式图像进程已退出');
          const {png,width,height}=response;
          if(code!==0||response.kind!==job.kind||response.sha256!==sha256||!Buffer.isBuffer(png)||png.length<24||png.length>FORMULA_PNG_BYTES||!png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||![width,height].every(value=>Number.isSafeInteger(value)&&value>0&&value<=16384)||width*height>FORMULA_RENDER_PIXELS||png.readUInt32BE(16)!==width||png.readUInt32BE(20)!==height)throw Error('公式图像返回内容无效');
          if(job.crop){const r=job.crop.region;if(width!==(job.crop.rotation%2?r.height:r.width)||height!==(job.crop.rotation%2?r.width:r.height))throw Error('公式裁剪尺寸不匹配');}
          if(job.kind==='render'&&(typeof response.svg!=='string'||Buffer.byteLength(response.svg)>FORMULA_SVG_BYTES))throw Error('公式矢量图无效');
          resolve({kind:job.kind,png,width,height,svg:job.kind==='render'?validateSvg(response.svg):undefined});
        }catch(value){reject(value);}
      });
    }));this.active=task;
    return task.finally(()=>{job.png?.fill(0);if(this.active===task){this.active=undefined;this.abort=undefined;}});
  }
}
