import {normalizeBase64} from './base64';
import {decodeHTML,encodeHTML} from 'entities';

export type BinaryCodec='base64'|'base64url'|'hex'|'base32';
export type TextCodec=BinaryCodec|'html'|'unicode';
const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const maxOutput=10*1024*1024;

function binary(bytes:Uint8Array){
 const parts:string[]=[];
 for(let index=0;index<bytes.length;index+=16384)parts.push(String.fromCharCode(...bytes.subarray(index,index+16384)));
 return parts.join('');
}

function base32(bytes:Uint8Array){
 let value=0,bits=0,result='';
 for(const byte of bytes){value=(value<<8)|byte;bits+=8;while(bits>=5){bits-=5;result+=alphabet[(value>>bits)&31];}value&=(1<<bits)-1;}
 if(bits)result+=alphabet[(value<<(5-bits))&31];
 return result.padEnd(Math.ceil(result.length/8)*8,'=');
}

function fromBase32(text:string){
 const compact=text.replace(/\s/g,'').toUpperCase(),match=/^([A-Z2-7]*)(=*)$/.exec(compact);
 if(!match)throw Error('Base32 内容无效，请检查字符');
 const raw=match[1],padding=match[2].length,remainder=raw.length%8;
 const needed:Record<number,number>={0:0,2:6,4:4,5:3,7:1};
 if(!(remainder in needed)||padding!==0&&padding!==needed[remainder])throw Error('Base32 内容无效，请检查填充');
 let value=0,bits=0,index=0;const bytes=new Uint8Array(Math.floor(raw.length*5/8));
 for(const char of raw){value=(value<<5)|alphabet.indexOf(char);bits+=5;if(bits>=8){bits-=8;bytes[index++]=(value>>bits)&255;}value&=(1<<bits)-1;}
 if(value!==0)throw Error('Base32 内容无效：末尾填充位不为零');
 return bytes;
}

function fromBase64Url(text:string){
 const compact=text.replace(/\s/g,''),match=/^([A-Za-z0-9_-]*)(=*)$/.exec(compact);
 if(!match||match[2].length>2||match[2].length>0&&compact.length%4!==0||match[1].length%4===1)throw Error('Base64URL 内容无效，请检查字符和填充');
 const raw=match[1],standard=raw.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(raw.length/4)*4,'=');
 const decoded=atob(standard),canonical=btoa(decoded).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
 if(canonical!==raw)throw Error('Base64URL 内容无效：末尾填充位不为零');
 return Uint8Array.from(decoded,char=>char.charCodeAt(0));
}

function fromHex(text:string){
 const compact=text.replace(/\s/g,''),bad=/[^0-9a-f]/i.exec(compact);
 if(bad)throw Error(`十六进制第 ${bad.index+1} 个字符无效`);
 if(compact.length%2)throw Error('十六进制字符数必须为偶数');
 return Uint8Array.from({length:compact.length/2},(_,index)=>parseInt(compact.slice(index*2,index*2+2),16));
}

function unicodeEscape(text:string){
 let result='';
 for(const char of text){
  const value=char.codePointAt(0)!;
  if(value>=0xd800&&value<=0xdfff)throw Error('输入包含无效的 Unicode 代理项');
  if(char==='\\')result+='\\\\';
  else if(char==='\n')result+='\\n';
  else if(char==='\r')result+='\\r';
  else if(char==='\t')result+='\\t';
  else if(value>=0x20&&value<=0x7e)result+=char;
  else if(value<=0xffff)result+='\\u'+value.toString(16).toUpperCase().padStart(4,'0');
  else result+='\\u{'+value.toString(16).toUpperCase()+'}';
  if(result.length>maxOutput)throw Error('编码结果超过 10 MB 上限');
 }
 return result;
}

function fromUnicodeEscape(text:string){
 let result='';
 for(let index=0;index<text.length;index++){
  const char=text[index];
  if(char!=='\\'){result+=char;continue;}
  const start=index,next=text[++index];
  if(next==='\\')result+='\\';
  else if(next==='n')result+='\n';
  else if(next==='r')result+='\r';
  else if(next==='t')result+='\t';
  else if(next==='u'){
   let value:number;
   if(text[index+1]==='{'){
    const end=text.indexOf('}',index+2),digits=end<0?'':text.slice(index+2,end);
    if(!/^[0-9a-fA-F]{1,6}$/.test(digits))throw Error(`第 ${start+1} 个字符处的 Unicode 转义无效`);
    value=parseInt(digits,16);index=end;
   }else{
    const digits=text.slice(index+1,index+5);
    if(!/^[0-9a-fA-F]{4}$/.test(digits))throw Error(`第 ${start+1} 个字符处的 Unicode 转义无效`);
    value=parseInt(digits,16);index+=4;
   }
   if(value>0x10ffff||value>=0xdc00&&value<=0xdfff)throw Error(`第 ${start+1} 个字符处的 Unicode 码点无效`);
   if(value>=0xd800&&value<=0xdbff){
    if(text.slice(index+1,index+3)!=='\\u'||!/^[0-9a-fA-F]{4}$/.test(text.slice(index+3,index+7)))throw Error(`第 ${start+1} 个字符处缺少低位代理项`);
    const low=parseInt(text.slice(index+3,index+7),16);
    if(low<0xdc00||low>0xdfff)throw Error(`第 ${start+1} 个字符处缺少低位代理项`);
    value=0x10000+((value-0xd800)<<10)+(low-0xdc00);index+=6;
   }
   result+=String.fromCodePoint(value);
  }else throw Error(`第 ${start+1} 个字符处的转义无效`);
 }
 for(const char of result){const value=char.codePointAt(0)!;if(value>=0xd800&&value<=0xdfff)throw Error('解码结果包含无效的 Unicode 代理项');}
 return result;
}

export function encodeText(text:string,codec:TextCodec){
 if(codec==='unicode')return unicodeEscape(text);
 if(codec==='html'){
  const result=encodeHTML(text);if(result.length>maxOutput)throw Error('编码结果超过 10 MB 上限');return result;
 }
 const bytes=new TextEncoder().encode(text);
 const estimated=codec==='hex'?bytes.length*2:codec==='base32'?Math.ceil(bytes.length/5)*8:Math.ceil(bytes.length/3)*4;
 if(estimated>maxOutput)throw Error('编码结果超过 10 MB 上限');
 if(codec==='hex')return Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
 if(codec==='base32')return base32(bytes);
 if(codec==='base64'||codec==='base64url'){
  const encoded=btoa(binary(bytes));return codec==='base64'?encoded:encoded.replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
 }
 throw Error('不支持的编码类型');
}

export function decodeBytes(text:string,codec:BinaryCodec){
 let bytes:Uint8Array;
 if(codec==='hex')bytes=fromHex(text);
 else if(codec==='base32')bytes=fromBase32(text);
 else if(codec==='base64url')bytes=fromBase64Url(text);
 else if(codec==='base64')bytes=Uint8Array.from(atob(normalizeBase64(text)),char=>char.charCodeAt(0));
 else throw Error('不支持的编码类型');
 return bytes;
}

export function decodeText(text:string,codec:TextCodec){
 if(codec==='unicode')return fromUnicodeEscape(text);
 if(codec==='html')return decodeHTML(text);
 try{return new TextDecoder('utf-8',{fatal:true}).decode(decodeBytes(text,codec));}catch(error){if(error instanceof TypeError)throw Error('解码后的字节不是有效 UTF-8 文本');throw error;}
}
