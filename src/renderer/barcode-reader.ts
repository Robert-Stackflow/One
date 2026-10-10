import {barcodeLimits,type BarcodeDecoded} from '../shared/barcode';
export class BarcodeReader {
 private worker:Worker|undefined;private reject:((reason:Error)=>void)|undefined;
 cancel(){this.worker?.terminate();this.worker=undefined;const reject=this.reject;this.reject=undefined;reject?.(new Error('识别已取消'));}
 read(bytes:Uint8Array):Promise<BarcodeDecoded>{this.cancel();return new Promise((resolve,reject)=>{const worker=new Worker(new URL('./barcode-worker.ts',import.meta.url),{type:'module'});this.worker=worker;let timer:ReturnType<typeof setTimeout>;const finish=(error?:Error,value?:BarcodeDecoded)=>{clearTimeout(timer);worker.terminate();if(this.worker===worker){this.worker=undefined;this.reject=undefined;}error?reject(error):resolve(value!);};this.reject=reason=>finish(reason);timer=setTimeout(()=>finish(new Error('识别超时，请缩小图片或框选条码区域重试')),barcodeLimits.timeout);worker.onerror=()=>finish(new Error('识别引擎加载失败，请重试'));worker.onmessage=event=>event.data.error?finish(new Error(event.data.error)):finish(undefined,event.data.decoded);worker.postMessage(bytes,[bytes.buffer as ArrayBuffer]);});}
}
