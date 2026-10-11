import {md5,sha1} from '@noble/hashes/legacy.js';

export type UuidFormat='standard'|'compact'|'braces';
export type UuidVersion='v3'|'v4'|'v5'|'v7';
export type UuidNamespace='dns'|'url'|'oid'|'x500'|'custom';
export interface UuidOptions {version:UuidVersion;count:number;format:UuidFormat;uppercase:boolean;name?:string;namespace?:UuidNamespace;customNamespace?:string}

const namespaces:Record<Exclude<UuidNamespace,'custom'>,string>={
 dns:'6ba7b810-9dad-11d1-80b4-00c04fd430c8',
 url:'6ba7b811-9dad-11d1-80b4-00c04fd430c8',
 oid:'6ba7b812-9dad-11d1-80b4-00c04fd430c8',
 x500:'6ba7b814-9dad-11d1-80b4-00c04fd430c8'
};
const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const randomLimit=(1n<<74n)-1n;
let lastTimestamp=-1,lastRandom=-1n;

export interface UuidInspection {standard:string;version:number;variant:'NCS'|'RFC'|'Microsoft'|'Future';valid:boolean;special?:'Nil'|'Max'}

export function inspectUuid(input:string):UuidInspection{
 if(typeof input!=='string'||input.length>100)throw Error('UUID 长度无效');
 const trimmed=input.trim(),value=trimmed.startsWith('{')&&trimmed.endsWith('}')?trimmed.slice(1,-1):trimmed;
 if(value.includes('-')&&!uuidPattern.test(value)||!/^[0-9a-f]{32}$/i.test(value.replaceAll('-','')))throw Error('UUID 格式无效：需要 32 位十六进制、标准格式或花括号格式');
 const hex=value.replaceAll('-','').toLowerCase(),octet=parseInt(hex.slice(16,18),16),version=parseInt(hex[12],16);
 const variant=(octet&0x80)===0?'NCS':(octet&0xc0)===0x80?'RFC':(octet&0xe0)===0xc0?'Microsoft':'Future';
 const special=/^0{32}$/.test(hex)?'Nil':/^f{32}$/.test(hex)?'Max':undefined;
 return {standard:`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`,version,variant,valid:!!special||variant==='RFC'&&version>=1&&version<=8,special};
}

export function convertUuid(input:string,format:UuidFormat,uppercase:boolean){
 if(!['standard','compact','braces'].includes(format)||typeof uppercase!=='boolean')throw Error('UUID 参数无效');
 const hex=inspectUuid(input).standard.replaceAll('-','');
 return formatUuid(Uint8Array.from({length:16},(_,index)=>parseInt(hex.slice(index*2,index*2+2),16)),format,uppercase);
}

function formatUuid(bytes:Uint8Array,format:UuidFormat,uppercase:boolean){
 const hex=Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
 let value=format==='compact'?hex:`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
 if(format==='braces')value=`{${value}}`;
 return uppercase?value.toUpperCase():value;
}

function uuidFromName(version:'v3'|'v5',name:string,namespace:UuidNamespace,customNamespace?:string){
 if(!name||name.length>1024)throw Error('名称需填写且不超过 1024 个字符');
 const id=namespace==='custom'?customNamespace:namespaces[namespace];
 if(!id||!uuidPattern.test(id))throw Error('命名空间 UUID 需使用标准的 36 字符格式');
 const hex=id.replaceAll('-','');
 const prefix=Uint8Array.from({length:16},(_,index)=>parseInt(hex.slice(index*2,index*2+2),16));
 const suffix=new TextEncoder().encode(name),input=new Uint8Array(prefix.length+suffix.length);
 input.set(prefix);input.set(suffix,prefix.length);
 const bytes=(version==='v3'?md5(input):sha1(input)).slice(0,16);
 bytes[6]=(bytes[6]&0x0f)|(version==='v3'?0x30:0x50);bytes[8]=(bytes[8]&0x3f)|0x80;
 return bytes;
}

function uuidV7(){
 const now=Date.now();if(!Number.isSafeInteger(now)||now<0||now>=2**48)throw Error('系统时间超出 UUID v7 范围');
 const timestamp=Math.max(now,lastTimestamp);
 let random:bigint;
 if(timestamp===lastTimestamp)random=lastRandom+1n;
 else{random=0n;for(const byte of crypto.getRandomValues(new Uint8Array(10)))random=(random<<8n)|BigInt(byte);random&=randomLimit;}
 if(random>randomLimit)throw Error('当前毫秒的 UUID v7 序列已用尽，请重试');
 lastTimestamp=timestamp;lastRandom=random;
 const bytes=new Uint8Array(16);let time=BigInt(timestamp);
 for(let index=5;index>=0;index--){bytes[index]=Number(time&255n);time>>=8n;}
 const high=Number(random>>62n);bytes[6]=0x70|(high>>8);bytes[7]=high&255;
 let low=random&((1n<<62n)-1n);
 for(let index=15;index>=8;index--){bytes[index]=Number(low&255n);low>>=8n;}
 bytes[8]|=0x80;
 return bytes;
}

export function generateUuids(options:UuidOptions):string[]{
 const {version,count,format,uppercase}=options;
 if(!Number.isInteger(count)||count<1||count>1000)throw Error('生成数量需在 1 至 1000 之间');
 if(!['v3','v4','v5','v7'].includes(version)||!['standard','compact','braces'].includes(format)||typeof uppercase!=='boolean')throw Error('UUID 参数无效');
 if((version==='v3'||version==='v5')&&count!==1)throw Error('名称型 UUID 每次生成一个');
 const namespace=options.namespace??'dns';
 if((version==='v3'||version==='v5')&&!['dns','url','oid','x500','custom'].includes(namespace))throw Error('命名空间无效');
 const result:string[]=[];
 for(let index=0;index<count;index++){
  let bytes:Uint8Array;
  if(version==='v3'||version==='v5')bytes=uuidFromName(version,options.name??'',namespace,options.customNamespace);
  else if(version==='v7')bytes=uuidV7();
  else{bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&0x0f)|0x40;bytes[8]=(bytes[8]&0x3f)|0x80;}
  result.push(formatUuid(bytes,format,uppercase));
 }
 return result;
}
