import type {ArchiveBrowse} from '../shared/archive';

const text=(value:unknown,limit:number)=>{
 if(typeof value!=='string'||value.includes('\0')||Buffer.byteLength(value,'utf8')>limit||Buffer.from(value,'utf8').toString('utf8')!==value)throw Error('压缩包浏览请求无效或过长');
 return value;
};
function folder(value:unknown){
 const name=text(value,32767).replaceAll('\\','/').replace(/\/$/,'');
 if(!name||name.split('/').some(part=>!part||part==='.'||part==='..'||/[\x00-\x1f\x7f:<>"|?*]|[. ]$/.test(part)||/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part)))throw Error('包内目录路径无效');
 return name+'/';
}
const number=(value:number)=>{const bytes=Buffer.alloc(4);bytes.writeUInt32LE(value);return bytes;};
const framed=(value:string)=>{const bytes=Buffer.from(value,'utf8');return Buffer.concat([number(bytes.length),bytes]);};
export function browsePacket(value:ArchiveBrowse){
 if(!value||typeof value!=='object'||typeof value.flat!=='boolean')throw Error('压缩包浏览模式无效');
 const query:ArchiveBrowse={directory:value.directory===''?'':folder(value.directory),search:text(value.search,1024),flat:value.flat};
 return {query,packet:Buffer.concat([framed(query.directory),framed(query.search),number(query.flat?1:0)])};
}
export function folderSelection(value:unknown){
 if(value===undefined)return {folders:[] as string[],packet:undefined};
 if(!Array.isArray(value)||value.length>10000)throw Error('选择的目录过多或无效');
 const folders=[...new Set(value.map(folder))];
 if(folders.reduce((total,name)=>total+Buffer.byteLength(name,'utf8'),0)>4*1024*1024)throw Error('目录选择超出限制');
 return {folders,packet:folders.length?Buffer.concat([number(folders.length),...folders.map(framed)]):undefined};
}
