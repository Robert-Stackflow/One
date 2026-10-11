import {maxBase64FileBytes} from '../shared/base64';
import {encodeText,decodeText,type TextCodec} from '../shared/text-codecs';

const textCodecs:TextCodec[]=['base64','base64url','hex','base32','quoted-printable','html','unicode'];
type Request={id:number;action:'encode-text'|'encode-all'|'decode-text'|'encode-file';codec?:TextCodec;text?:string;buffer?:ArrayBuffer};
self.onmessage=(event:MessageEvent<Request>)=>{
 const {id,action,codec='base64',text,buffer}=event.data;
 try{
  let result:string;
  if(action==='encode-all'){
   if(typeof text!=='string'||text.length>2*1024*1024)throw Error('文本不能超过 2 MB');
   const results=Object.fromEntries(textCodecs.map(item=>{try{return [item,{result:encodeText(text,item)}];}catch(error){return [item,{error:(error as Error).message}];}}));
   self.postMessage({id,results});return;
  }
  if(action==='encode-file'){
   if(!buffer||buffer.byteLength>maxBase64FileBytes)throw Error('文件不能超过 6 MB');
   const bytes=new Uint8Array(buffer),parts:string[]=[];
   for(let index=0;index<bytes.length;index+=16384)parts.push(String.fromCharCode(...bytes.subarray(index,index+16384)));
   result=btoa(parts.join(''));
  }else{
   if(typeof text!=='string'||text.length>2*1024*1024)throw Error('文本不能超过 2 MB');
   result=action==='encode-text'?encodeText(text,codec):decodeText(text,codec);
  }
  self.postMessage({id,result});
 }catch(error){self.postMessage({id,error:(error as Error).message});}
};
