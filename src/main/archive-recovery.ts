import {lstat,open,mkdir,opendir,unlink,link} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {join,resolve,isAbsolute,parse,relative} from 'node:path';
import type {BigIntStats} from 'node:fs';
import {crc32} from 'node:zlib';
import {createRequire} from 'node:module';
import type {ArchiveRecoveryRecord,ArchiveRecoverySummary,ArchiveRecoveryPage,ArchiveRecoveryInspection} from '../shared/archive-recovery';

const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
export function archiveRecoveryId(value:unknown){if(typeof value!=='string'||!uuid.test(value))throw Error('恢复记录标识无效');return value.toLowerCase();}
const maxRecords=1024,maxRecordBytes=512*1024,maxJournalBytes=512*1024**2,maxLineBytes=512*1024;
const absolute=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=32768&&!/[\0-\x1f]/.test(value)&&isAbsolute(value)&&resolve(value)===value;
const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
const integer=(value:unknown,limit=1000000):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=limit;
const identity=(info:BigIntStats)=>`${BigInt.asUintN(32,info.dev)}:${info.ino>>32n}:${info.ino&0xffffffffn}`;
// Windows lstat can report dev=0 while fstat reports the volume serial. Do not
// compare those two values as if both were an authoritative volume identity.
const sameFile=(a:BigIntStats,b:BigIntStats)=>a.ino===b.ino&&(!a.dev||!b.dev||a.dev===b.dev);
let directoryIdentity:((path:string)=>Promise<string>)|undefined;
async function nativeDirectoryIdentity(path:string){
 if(process.platform!=='win32')return identity(await lstat(path,{bigint:true}));
 if(!directoryIdentity){
  const koffi=createRequire(__filename)('koffi') as typeof import('koffi').default,kernel=koffi.load('kernel32.dll');
  const create=kernel.func('intptr_t __stdcall CreateFileW(str16 path,uint32 access,uint32 share,void *security,uint32 disposition,uint32 flags,intptr_t templateFile)'),info=kernel.func('bool __stdcall GetFileInformationByHandle(intptr_t file,_Out_ uint8_t *information)'),close=kernel.func('bool __stdcall CloseHandle(intptr_t file)');
  const call=(fn:ReturnType<typeof kernel.func>,...args:unknown[])=>new Promise<unknown>((resolve,reject)=>fn.async(...args,(error:Error|null,value:unknown)=>error?reject(error):resolve(value)));
  directoryIdentity=async value=>{
   const extended=value.startsWith('\\\\')?'\\\\?\\UNC\\'+value.slice(2):'\\\\?\\'+value;
   const handle=await call(create,extended,0x80,7,null,3,0x02200000,0);
   if(handle===-1||handle===-1n)throw Error('无法读取恢复目录的身份');
   try{const bytes=Buffer.alloc(52);if(!await call(info,handle,bytes)||bytes.readUInt32LE(0)&0x400||!(bytes.readUInt32LE(0)&0x10))throw Error('恢复目录包含链接或类型已经变化');return `${bytes.readUInt32LE(28)}:${bytes.readUInt32LE(44)}:${bytes.readUInt32LE(48)}`;}
   finally{await call(close,handle);}
  };
 }
 return directoryIdentity(path);
}
const idStamp=(value:unknown):value is string=>typeof value==='string'&&/^(?:\d{1,10}:){2}\d{1,10}$/.test(value)&&value.split(':').every(part=>BigInt(part)<=0xffffffffn);
const fileStamp=(value:unknown):value is string=>typeof value==='string'&&/^(?:\d{1,10}:){6}\d{1,10}$/.test(value)&&value.split(':').every(part=>BigInt(part)<=0xffffffffn);
const fields=(object:unknown,names:string[]):object is Record<string,unknown>=>!!object&&typeof object==='object'&&!Array.isArray(object)&&Object.keys(object).length===names.length&&names.every(name=>Object.hasOwn(object,name));
const within=(root:string,target:unknown)=>{
 if(!absolute(target))return false;const name=relative(root,target);
 return !!name&&!isAbsolute(name)&&name.split(/[\\/]/).every(part=>part&&part!=='.'&&part!=='..'&&!/[<>:"|?*\0-\x1f]/.test(part)&&!/[. ]$/.test(part));
};
async function ordinaryAncestors(path:string){
 if(!absolute(path))throw Error('恢复路径无效');let current=parse(path).root;
 for(const part of ['',...relative(current,path).split(/[\\/]/).filter(Boolean)]){
  if(part)current=join(current,part);const info=await lstat(current,{bigint:true});
  if(!info.isDirectory()||info.isSymbolicLink())throw Error('恢复路径包含链接、联接或非文件夹');
 }
}
function record(value:unknown,id:string):ArchiveRecoveryRecord{
 if(!fields(value,['version','id','created','archive','parent','path','ownerPid'])||value.version!==1||value.id!==id||!uuid.test(id)||!integer(value.created,Number.MAX_SAFE_INTEGER)||!integer(value.ownerPid,0xffffffff)||!value.ownerPid||!absolute(value.archive)||!absolute(value.parent)||!absolute(value.path)||!same(value.path,join(value.parent,`.one-recovery-${id}`)))throw Error('恢复记录无效，资料已保留');
 return{id,created:value.created,archive:value.archive,parent:value.parent,path:value.path,ownerPid:value.ownerPid};
}

/** One immutable, exclusive record per operation, shared safely by GUI/CLI.
 * It is synced before the native publisher is allowed to touch target files.
 * Records are never evicted with ordinary task history or cache maintenance. */
export class ArchiveRecoveryRegistry{
 constructor(private directory:string){}
 private file(id:string){return join(this.directory,archiveRecoveryId(id)+'.json');}
 private async names(){
  const names:string[]=[];let handle;
  try{await ordinaryAncestors(this.directory);handle=await opendir(this.directory);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {names,truncated:false};throw error;}
  for await(const entry of handle){if(!/^[a-f0-9-]{36}\.json$/i.test(entry.name)||!uuid.test(entry.name.slice(0,-5)))continue;if(names.length===maxRecords)return{names,truncated:true};names.push(entry.name);}
  return {names,truncated:false};
 }
 async register(id:string,archive:string,parent:string){
  id=archiveRecoveryId(id);
  const value={version:1,id:id.toLowerCase(),created:Date.now(),archive,parent,path:join(parent,`.one-recovery-${id}`),ownerPid:process.pid};
  const checked=record(value,value.id);await mkdir(this.directory,{recursive:true});await ordinaryAncestors(this.directory);
  if((await this.names()).names.length>=maxRecords)throw Error('待处理恢复记录已满，请先检查恢复资料');
  const bytes=Buffer.from(JSON.stringify(value));if(bytes.length>maxRecordBytes)throw Error('恢复记录过大');
  // Never expose a partially written .json record to another GUI/CLI instance.
  // Linking the fully synced temporary file publishes without replacing an
  // existing operation ID. If this filesystem cannot do that, fail before any
  // target files are touched.
  const temporary=this.file(id)+'.pending-'+randomUUID(),handle=await open(temporary,'wx');
  try{try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}await link(temporary,this.file(id));}
  finally{await unlink(temporary).catch(error=>{if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;});}
  return checked;
 }
 async read(id:string){
  id=archiveRecoveryId(id);
  await ordinaryAncestors(this.directory);const path=this.file(id),before=await lstat(path,{bigint:true});
  if(!before.isFile()||before.isSymbolicLink()||before.size>BigInt(maxRecordBytes))throw Error('恢复记录不是有效的普通文件');
  const handle=await open(path,'r');try{
   const info=await handle.stat({bigint:true});if(!info.isFile()||!sameFile(info,before)||info.size>BigInt(maxRecordBytes))throw Error('恢复记录已经变化');
   const bytes=Buffer.alloc(Number(info.size)+1);let length=0;
   while(length<bytes.length){const next=await handle.read(bytes,length,bytes.length-length,null);if(!next.bytesRead)break;length+=next.bytesRead;}
   if(length!==Number(info.size))throw Error('恢复记录正在变化，请稍后重试');
   const value=record(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,length))),id);
   const after=await handle.stat({bigint:true});if(after.size!==info.size||after.mtimeNs!==info.mtimeNs)throw Error('恢复记录正在变化，请稍后重试');return value;
  }finally{await handle.close();}
 }
 async list(offset=0,active:(id:string,record?:ArchiveRecoveryRecord)=>boolean=()=>false):Promise<ArchiveRecoveryPage>{
  if(!integer(offset,maxRecords)||offset%50)throw Error('恢复列表页码无效');
  const {names,truncated}=await this.names(),dated=[] as {id:string;created:number}[];
  // A bounded directory of small private records, not a recursive disk scan.
  for(let start=0;start<names.length;start+=16)dated.push(...await Promise.all(names.slice(start,start+16).map(async name=>({id:name.slice(0,-5).toLowerCase(),created:(await lstat(join(this.directory,name)).catch(()=>undefined))?.birthtimeMs??0}))));
  dated.sort((a,b)=>b.created-a.created||a.id.localeCompare(b.id));const items:ArchiveRecoverySummary[]=[];
  for(const candidate of dated.slice(offset,offset+50))try{const value=await this.read(candidate.id);items.push({...value,active:active(candidate.id,value)});}catch(error){items.push({...candidate,error:error instanceof Error?error.message:String(error),active:active(candidate.id)});}
  return{items,total:dated.length,offset,truncated};
 }
 async forget(id:string){
  // Removes only the private index entry after a user decision. Recovery files
  // and target files are never deleted here, including malformed entries.
  await ordinaryAncestors(this.directory);const path=this.file(id),info=await lstat(path);
  if(!info.isFile()||info.isSymbolicLink())throw Error('恢复记录已变化，未移除');await unlink(path);
 }
 async clearIfAbsent(id:string){
  const value=await this.read(id),info=await lstat(value.path).catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error;});
  if(!info)await this.forget(id);
 }
}

/** Streaming, read-only validation. A valid journal is evidence about a past
 * decision, never authority to overwrite a file or to delete a recovery copy. */
export async function inspectArchiveRecovery(value:ArchiveRecoveryRecord,signal?:AbortSignal):Promise<ArchiveRecoveryInspection>{
 const result:ArchiveRecoveryInspection={id:value.id,state:'invalid',message:'',items:0,files:0,directories:0,replaced:0,published:0,skipped:0,samples:[]};
 let handle;
 try{
  signal?.throwIfAborted();await ordinaryAncestors(value.parent);
  const directory=await lstat(value.path,{bigint:true}).catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error;});
  if(!directory)return{...result,state:'missing',message:'未找到恢复目录。它可能已完成清理或被移动，请检查目标目录。'};
  if(!directory.isDirectory()||directory.isSymbolicLink())throw Error('恢复目录被替换为链接或非文件夹，未读取其中内容');
  const parent=await lstat(value.parent,{bigint:true}),manifest=join(value.path,'manifest.jsonl'),before=await lstat(manifest,{bigint:true}).catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error;});
  if(!before){
   const contents=await opendir(value.path);for await(const _entry of contents)throw Error('恢复清单缺失且目录中仍有内容，请保留资料');
   signal?.throwIfAborted();const after=await lstat(value.path,{bigint:true});
   if(!sameFile(directory,after)||!after.isDirectory()||after.isSymbolicLink())throw Error('恢复目录已经变化');
   return{...result,state:'empty',message:'恢复目录已无清单和副本，可继续清理空目录。'};
  }
  if(!before.isFile()||before.isSymbolicLink()||before.size>BigInt(maxJournalBytes))throw Error('恢复清单无效或超过读取上限');
  handle=await open(manifest,'r');const initial=await handle.stat({bigint:true});if(!sameFile(initial,before)||!initial.isFile()||initial.size>BigInt(maxJournalBytes))throw Error('恢复清单已经变化');
  const parentIdentity=await nativeDirectoryIdentity(value.parent),recoveryIdentity=await nativeDirectoryIdentity(value.path);
  const flags=new Uint8Array(1000000);let crc=0,sequence=0,lastIndex=-1,prepared=false,phase='plan',seenHeader=false,skipped=0;
  const stage=join(value.parent,`.one-extract-${value.id}`),decode=new TextDecoder('utf-8',{fatal:true});
  const line=(bytes:Buffer)=>{
   if(bytes.length>maxLineBytes)throw Error('恢复清单单条记录过大');const text=decode.decode(bytes),envelope=JSON.parse(text),cut=text.lastIndexOf(',"crc32":');
   if(!fields(envelope,['sequence','record','crc32'])||envelope.sequence!==sequence||sequence>3000010||cut<0||typeof envelope.crc32!=='string'||!/^[a-f0-9]{8}$/.test(envelope.crc32)||JSON.stringify(envelope)!==text)throw Error('恢复清单顺序或格式损坏');
   crc=crc32(bytes.subarray(0,Buffer.byteLength(text.slice(0,cut))),crc);if(envelope.crc32!==crc.toString(16).padStart(8,'0'))throw Error('恢复清单校验失败');++sequence;
   const row=envelope.record as Record<string,unknown>;if(!row||typeof row!=='object'||typeof row.type!=='string')throw Error('恢复清单记录无效');
   if(row.type==='header'){
    if(seenHeader||sequence!==1||!fields(row,['type','version','parent','stage','recovery','parentIdentity','stageIdentity','recoveryIdentity','conflict'])||row.version!==2||!absolute(row.parent)||!same(row.parent,value.parent)||!absolute(row.stage)||!same(row.stage,stage)||!absolute(row.recovery)||!same(row.recovery,value.path)||!idStamp(row.parentIdentity)||!idStamp(row.stageIdentity)||!idStamp(row.recoveryIdentity)||!['rename','skip','replace'].includes(String(row.conflict)))throw Error('恢复清单不属于本次任务或版本不受支持');
    if(row.parentIdentity!==parentIdentity||row.recoveryIdentity!==recoveryIdentity)throw Error('目标目录或恢复目录的身份已经变化');seenHeader=true;return;
   }
   if(!seenHeader)throw Error('恢复清单缺少头部');
   if(row.type==='item'){
    if(phase!=='plan'||prepared||!fields(row,['type','index','source','target','backup','directory','existing','sourceStamp','targetStamp'])||!integer(row.index,999999)||row.index<=lastIndex||typeof row.directory!=='boolean'||typeof row.existing!=='boolean'||!within(stage,row.source)||!within(value.parent,row.target)||within(value.path,row.target)||same(String(row.target),value.path)||within(stage,row.target)||same(String(row.target),stage)||typeof row.backup!=='string'||!same(row.backup,join(value.path,row.index+'.original'))||(!row.directory&&!fileStamp(row.sourceStamp))||row.directory&&row.sourceStamp!==''||(!row.directory&&row.existing?!fileStamp(row.targetStamp):row.targetStamp!==''))throw Error('恢复清单路径或文件身份无效');
    lastIndex=row.index;flags[row.index]=1|(row.directory?2:0)|(row.existing?4:0);++result.items;if(row.directory)++result.directories;else{++result.files;if(row.existing)++result.replaced;}
    if(result.samples.length<30)result.samples.push({name:relative(value.parent,row.target as string),directory:row.directory,existing:row.existing});return;
   }
   if(row.type==='prepared'){
    if(phase!=='plan'||prepared||!fields(row,['type','items','skipped'])||row.items!==result.items||!integer(row.skipped)||result.items+row.skipped>1000000)throw Error('恢复清单的完整计划不匹配');prepared=true;skipped=row.skipped;phase='publishing';result.skipped=skipped;return;
   }
   if(row.type==='directory-created'||row.type==='published'){
    if(!prepared||phase!=='publishing'||!integer(row.index,999999)||!(flags[row.index]&1))throw Error('恢复清单发布顺序无效');
    if(row.type==='directory-created'){
     if(!fields(row,['type','index','identity'])||!idStamp(row.identity)||!(flags[row.index]&2)||(flags[row.index]&12))throw Error('恢复清单文件夹身份无效');flags[row.index]|=8;
    }else{if(!fields(row,['type','index'])||flags[row.index]&16||flags[row.index]&2&&!(flags[row.index]&4)&&!(flags[row.index]&8))throw Error('恢复清单存在重复或无效发布记录');flags[row.index]|=16;++result.published;}return;
   }
   if(row.type==='committed'){
    if(phase!=='publishing'||!fields(row,['type','count','skipped'])||row.count!==result.items||result.published!==result.items||row.skipped!==skipped)throw Error('恢复清单完成标记不完整');phase='committed';return;
   }
   if(row.type==='rollback-started'){
    if(!fields(row,['type'])||phase==='rollback'||phase==='rolled-back')throw Error('恢复清单回滚顺序无效');phase='rollback';return;
   }
   if(row.type==='rolled-back'){
    if(phase!=='rollback'||!fields(row,['type']))throw Error('恢复清单回滚标记无效');phase='rolled-back';return;
   }
   throw Error('恢复清单包含未知记录');
  };
  let pending=Buffer.alloc(0),read=0;
  signal?.throwIfAborted();
  const stream=handle.createReadStream({autoClose:false,highWaterMark:64*1024,signal});
  for await(const chunk of stream){signal?.throwIfAborted();read+=chunk.length;if(read>maxJournalBytes)throw Error('恢复清单超过读取上限');const data=pending.length?Buffer.concat([pending,chunk]):chunk;let start=0,end;
   while((end=data.indexOf(10,start))>=0){line(data.subarray(start,end));start=end+1;}pending=Buffer.from(data.subarray(start));if(pending.length>maxLineBytes)throw Error('恢复清单单条记录过大');
  }
  if(pending.length||!seenHeader)throw Error('恢复清单被截断或没有完整头部');
  const after=await handle.stat({bigint:true}),nowDirectory=await lstat(value.path,{bigint:true}),nowParent=await lstat(value.parent,{bigint:true}),nowManifest=await lstat(manifest,{bigint:true});
  if(after.size!==initial.size||after.mtimeNs!==initial.mtimeNs||read!==Number(initial.size)||!nowDirectory.isDirectory()||nowDirectory.isSymbolicLink()||!nowParent.isDirectory()||nowParent.isSymbolicLink()||!sameFile(nowDirectory,directory)||!sameFile(nowParent,parent)||!sameFile(nowManifest,initial)||nowManifest.isSymbolicLink()||await nativeDirectoryIdentity(value.parent)!==parentIdentity||await nativeDirectoryIdentity(value.path)!==recoveryIdentity)throw Error('检查期间恢复资料正在变化，请稍后重试');
  result.state=phase==='committed'?'committed':phase==='rolled-back'?'rolled-back':prepared?'pending':'incomplete';
  result.message=result.state==='committed'?'清单确认发布已完成，保留的副本可能来自清理中断。':result.state==='rolled-back'?'清单确认已回滚，仍需检查保留的资料。':result.state==='pending'?'发布或回滚尚未确认完成，请保留原件和恢复资料。':'写入计划未完成，清单没有授权开始发布。请检查目标目录。';
  return result;
 }catch(error){if(signal?.aborted)throw error;return{...result,state:'invalid',message:error instanceof Error?error.message:String(error)};}
 finally{await handle?.close();}
}
