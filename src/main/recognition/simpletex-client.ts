import {createHash,randomInt} from 'node:crypto';
import {serviceRequest} from '../service-request';
import type {FormulaServices} from '../formula-services';
import {formulaServiceReference,type FormulaServiceReference} from '../../shared/recognition/formula-services';
import {formulaOutput,FORMULA_IMAGE,type FormulaResult} from '../../shared/recognition/formula';
class SimpleTexFailure extends Error {}
export function simpletexHeaders(appId:string,secret:string,fields:Record<string,string>={},timestamp=String(Math.floor(Date.now()/1000)),nonce=Array.from({length:16},()=> '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'[randomInt(62)]).join('')){
  const signed={...fields,'app-id':appId,'random-str':nonce,timestamp},source=Object.keys(signed).sort().map(key=>key+'='+signed[key as keyof typeof signed]).join('&')+'&secret='+secret;
  return {'app-id':appId,'random-str':nonce,timestamp,sign:createHash('md5').update(source).digest('hex')};
}
const failure=(status:number)=>status===401||status===403?'SimpleTex 鉴权失败，请检查 APP ID 和 Secret':status===402?'SimpleTex 资源不足，请到服务商控制台核对':status===413?'SimpleTex 图片过大或格式不受支持，请裁剪后重试':status===429?'SimpleTex 请求过多，请稍后手动重试':status>=500?'SimpleTex 暂时不可用，请稍后重试':'SimpleTex 未完成识别，请检查配置与图片';
export class SimpleTexClient {
  constructor(private services:FormulaServices,private transport:typeof fetch=serviceRequest){}
  async run(value:FormulaServiceReference,png:Buffer,signal:AbortSignal):Promise<Omit<FormulaResult,'revision'>>{
    const ref=formulaServiceReference(value),connection=this.services.connection(ref);signal.throwIfAborted();
    if(!Buffer.isBuffer(png)||png.length<24||png.length>FORMULA_IMAGE||!png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('公式图片支持最多 8 MiB PNG');
    const abort=new AbortController(),cancel=()=>abort.abort('cancelled');signal.addEventListener('abort',cancel,{once:true});let timedOut=false,reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
    const cancelReader=()=>{void reader?.cancel().catch(()=>{});};abort.signal.addEventListener('abort',cancelReader,{once:true});if(signal.aborted)cancel();
    const timer=setTimeout(()=>{timedOut=true;abort.abort('timeout');},connection.timeoutSeconds*1000);
    timer.unref();
    try{
      const form=new FormData();form.append('file',new Blob([new Uint8Array(png)],{type:'image/png'}),'formula.png');
      const response=await this.transport(connection.endpoint,{method:'POST',headers:simpletexHeaders(connection.appId,connection.key),body:form,signal:abort.signal,redirect:'error',credentials:'omit',cache:'no-store'});
      if(abort.signal.aborted){await response.body?.cancel().catch(()=>{});abort.signal.throwIfAborted();}
      if(!response.ok){await response.body?.cancel().catch(()=>{});throw new SimpleTexFailure(failure(response.status));}
      const declared=response.headers.get('content-length');if(declared!==null&&(!Number.isSafeInteger(Number(declared))||Number(declared)<0||Number(declared)>512*1024)){await response.body?.cancel().catch(()=>{});throw new SimpleTexFailure('SimpleTex 返回过大，请缩小图片');}
      if(!response.body)throw new SimpleTexFailure('SimpleTex 返回为空');reader=response.body.getReader();const chunks:Uint8Array[]=[];let bytes=0;
      for(;;){abort.signal.throwIfAborted();const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;if(bytes>512*1024)throw new SimpleTexFailure('SimpleTex 返回过大，请缩小图片');chunks.push(chunk.value);}
      abort.signal.throwIfAborted();let data:any;try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{throw new SimpleTexFailure('SimpleTex 返回格式无效');}
      if(data?.status!==true||!data.res||typeof data.res!=='object'||Array.isArray(data.res)||typeof data.res.latex!=='string')throw new SimpleTexFailure(failure(response.status));
      let text:string;try{text=formulaOutput(data.res.latex);}catch{throw new SimpleTexFailure('SimpleTex 返回的公式格式无效');}if(!text.trim())throw new SimpleTexFailure('SimpleTex 未返回公式，请调整图片区域');
      if(data.res.conf!==undefined&&(typeof data.res.conf!=='number'||!Number.isFinite(data.res.conf)||data.res.conf<0||data.res.conf>1))throw new SimpleTexFailure('SimpleTex 置信度格式无效');
      abort.signal.throwIfAborted();try{this.services.assertReference(ref);}catch{throw new SimpleTexFailure('公式服务已删除或配置已改变，请重新选择');}
      return {text,endpoint:connection.endpoint,...(data.res.conf!==undefined?{confidence:data.res.conf}:{}),...(typeof data.request_id==='string'&&/^[\w-]{1,128}$/.test(data.request_id)?{requestId:data.request_id}:{})};
    }catch(error){if(timedOut)throw Error('SimpleTex 请求超时，请稍后手动重试');if(signal.aborted)throw Error('公式识别已取消');if(error instanceof SimpleTexFailure)throw error;throw Error('SimpleTex 请求失败，请检查网络后手动重试');}
    finally{clearTimeout(timer);signal.removeEventListener('abort',cancel);abort.signal.removeEventListener('abort',cancelReader);await reader?.cancel().catch(()=>{});reader?.releaseLock();}
  }
}
