import {normalizeBase64} from './base64';

export type TextCodec='base64'|'base64url'|'hex'|'base32';
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

export function encodeText(text:string,codec:TextCodec){
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

export function decodeText(text:string,codec:TextCodec){
 let bytes:Uint8Array;
 if(codec==='hex')bytes=fromHex(text);
 else if(codec==='base32')bytes=fromBase32(text);
 else if(codec==='base64url')bytes=fromBase64Url(text);
 else if(codec==='base64')bytes=Uint8Array.from(atob(normalizeBase64(text)),char=>char.charCodeAt(0));
 else throw Error('不支持的编码类型');
 try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw Error('解码后的字节不是有效 UTF-8 文本');}
}
