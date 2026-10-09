import {lstat} from 'node:fs/promises';
import {isAbsolute,resolve} from 'node:path';
import type {ArchiveEdit} from '../shared/archive';

/** Bounded binary plan; user paths and comments never become command arguments. */
export async function archiveEditPacket(changes:ArchiveEdit[]):Promise<Buffer>{
 if(!Array.isArray(changes)||!changes.length||changes.length>10000)throw Error('请选择 1–10000 项修改');
 const records:Buffer[]=[];
 const text=(value:unknown,limit=65535)=>{if(typeof value!=='string'||value.includes('\0')||Buffer.byteLength(value)>limit)throw Error('压缩包修改内容无效或过长');const bytes=Buffer.from(value),size=Buffer.alloc(4);size.writeUInt32LE(bytes.length);return Buffer.concat([size,bytes]);};
 const name=(value:unknown)=>{if(typeof value!=='string'||!value.trim()||value.length>32767)throw Error('请填写包内路径');return value;};
 const index=(value:unknown)=>{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0||value>=1000000)throw Error('选择的条目无效');return value;};
 const add=(kind:number,entry:number,target:string,source='',replace=false)=>{const head=Buffer.alloc(12);head.writeUInt32LE(kind);head.writeUInt32LE(entry,4);head.writeUInt32LE(replace?1:0,8);records.push(Buffer.concat([head,text(target),text(source,131072)]));if(records.length>10000)throw Error('一次最多修改 10000 项');};
 for(const change of changes){
  if(!change||typeof change!=='object')throw Error('压缩包修改无效');
  switch(change.kind){
   case 'delete':{
    const folders=change.folders??[];
    if(!Array.isArray(change.indexes)||!Array.isArray(folders)||!change.indexes.length&&!folders.length||change.indexes.length+folders.length>10000)throw Error('请选择要删除的条目');
    for(const entry of new Set(change.indexes))add(1,index(entry),'');
    for(const folder of new Set(folders))add(6,0,'',name(folder));break;
   }
   case 'rename':add(2,index(change.index),name(change.name));break;
   case 'rename-folder':add(7,0,name(change.name),name(change.folder));break;
   case 'mkdir':add(3,0,name(change.name));break;
   case 'comment':add(5,0,change.text);break;
   case 'add':{
    if(typeof change.source!=='string'||!isAbsolute(change.source)||change.source.includes('\0')||change.source.length>32768)throw Error('添加路径无效');
    if(change.replace!==undefined&&typeof change.replace!=='boolean')throw Error('同名替换选项无效');
    const source=resolve(change.source),info=await lstat(source);
    if(info.isSymbolicLink()||(!info.isFile()&&!info.isDirectory()))throw Error('不支持添加链接或特殊文件');
    add(4,0,name(change.name),source,change.replace===true);break;
   }
   default:throw Error('未知压缩包修改操作');
  }
 }
 const count=Buffer.alloc(4);count.writeUInt32LE(records.length);
 const body=Buffer.concat([count,...records]);if(body.length>4*1024*1024)throw Error('压缩包修改计划超出大小限制');
 const length=Buffer.alloc(4);length.writeUInt32LE(body.length);return Buffer.concat([length,body]);
}
