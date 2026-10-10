import {normalizeBase64,maxBase64FileBytes} from '../shared/base64';

type Request={id:number;action:'encode-text'|'decode-text'|'encode-file';text?:string;buffer?:ArrayBuffer};
self.onmessage=(event:MessageEvent<Request>)=>{
 const {id,action,text,buffer}=event.data;
 try{
  let result:string;
  if(action==='encode-file'){
   if(!buffer||buffer.byteLength>maxBase64FileBytes)throw Error('文件不能超过 6 MB');
   const bytes=new Uint8Array(buffer),parts:string[]=[];
   for(let index=0;index<bytes.length;index+=16384)parts.push(String.fromCharCode(...bytes.subarray(index,index+16384)));
   result=btoa(parts.join(''));
  }else{
   if(typeof text!=='string'||text.length>2*1024*1024)throw Error('文本不能超过 2 MB');
   if(action==='encode-text'){
    const bytes=new TextEncoder().encode(text),parts:string[]=[];
    for(let index=0;index<bytes.length;index+=16384)parts.push(String.fromCharCode(...bytes.subarray(index,index+16384)));
    result=btoa(parts.join(''));
   }else{
    const decoded=atob(normalizeBase64(text)),bytes=Uint8Array.from(decoded,char=>char.charCodeAt(0));
    result=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
   }
  }
  self.postMessage({id,result});
 }catch(error){self.postMessage({id,error:(error as Error).message});}
};
