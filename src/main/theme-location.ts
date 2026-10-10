import koffi from 'koffi';
import {join} from 'node:path';
import type {ThemeLocationResult} from '../shared/theme-location';

export interface LocationPort {begin():number;poll(token:number,output:Buffer,size:number):number;cancel(token:number):void}
let native:LocationPort|undefined;
function binding():LocationPort {
 if(native)return native;
 const library=koffi.load(join(__dirname,'../native/One.Location.dll').replace('app.asar\\','app.asar.unpacked\\'));
 return native={begin:library.func('uint32 one_location_begin()'),poll:library.func('uint32 one_location_poll(uint32 token,_Out_ void *output,uint32 size)'),cancel:library.func('void one_location_cancel(uint32 token)')};
}
const messages={denied:'Windows 定位已关闭或未授权，请手动填写经纬度，或开启定位后重试。',unavailable:'暂时无法获取位置，请手动填写经纬度或重试。',timeout:'定位超时，请手动填写经纬度或重试。',cancelled:'已取消定位。'};
export class ThemeLocationService {
 private pending?:()=>void;
 constructor(private port:()=>LocationPort=binding,private timeout=25000,private interval=100){}
 cancel(){this.pending?.();}
 locate():Promise<ThemeLocationResult>{
  this.cancel();
  return new Promise(resolve=>{
   let nativePort:LocationPort,token=0,timer:ReturnType<typeof setTimeout>|undefined,done=false;
   const started=Date.now();
   const finish=(result:ThemeLocationResult)=>{
    if(done)return;done=true;clearTimeout(timer);
    try{if(token)nativePort.cancel(token);}catch{}
    if(this.pending===cancel)this.pending=undefined;
    resolve(result);
   };
   const fail=(state:keyof typeof messages)=>finish({state,detail:messages[state]});
   const cancel=()=>fail('cancelled');this.pending=cancel;
   const poll=()=>{
    if(done)return;if(Date.now()-started>=this.timeout){fail('timeout');return;}
    try{
     const output=Buffer.alloc(32);if(nativePort.poll(token,output,32)!==1){fail('unavailable');return;}
     const state=output.readUInt32LE(0);
     if(state===1){timer=setTimeout(poll,this.interval);return;}
     if(state===2){
      const latitude=output.readDoubleLE(8),longitude=output.readDoubleLE(16),accuracy=output.readDoubleLE(24);
      if(Number.isFinite(latitude)&&Math.abs(latitude)<=90&&Number.isFinite(longitude)&&Math.abs(longitude)<=180&&Number.isFinite(accuracy)&&accuracy>=0){finish({state:'success',latitude,longitude,accuracy});return;}
     }
     fail(state===3?'denied':state===5?'timeout':state===6?'cancelled':'unavailable');
    }catch{fail('unavailable');}
   };
   try{nativePort=this.port();token=nativePort.begin();if(!token){fail('unavailable');return;}poll();}catch{fail('unavailable');}
  });
 }
}
