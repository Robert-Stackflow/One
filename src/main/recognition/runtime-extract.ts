import yauzl, { type Entry, type ZipFile } from 'yauzl';
import { createWriteStream } from 'node:fs';
import { lstat, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { LlamaRuntimeFile } from './llama-runtime-catalog';

const cancelled=()=>Error('运行包准备已取消');
function safeEntry(name:string) {
  return name.length>0&&name.length<=512&&!/[\\:\x00-\x1f]/.test(name)&&!name.startsWith('/')&&
    name.split('/').every((part,index,parts)=>part!=='.'&&part!=='..'&&(part!==''||index===parts.length-1));
}
/** Stream only the pinned native files into a new, owned directory. Never execute archive content here. */
export async function extractRuntimeArchive(path:string,files:readonly LlamaRuntimeFile[],destination:string,signal:AbortSignal,onFile:(name:string)=>void=()=>{}) {
  signal.throwIfAborted();
  const folder=await lstat(destination);if(!folder.isDirectory()||folder.isSymbolicLink())throw Error('运行包临时目录无效');
  const root=await realpath(destination),expected=new Map<string,LlamaRuntimeFile>(),names=new Set<string>();
  if(!files.length||files.length>64)throw Error('运行包文件清单无效');
  for(const file of files){
    if(!safeEntry(file.entry)||!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(file.name)||file.name.endsWith('.')||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(file.name)||!Number.isSafeInteger(file.bytes)||file.bytes<1||file.bytes>2*1024**3||
      !/^[a-f0-9]{64}$/.test(file.sha256)||expected.has(file.entry)||names.has(file.name.toLowerCase()))throw Error('运行包文件清单无效');
    expected.set(file.entry,file);names.add(file.name.toLowerCase());
  }
  const zip=await new Promise<ZipFile>((resolve,reject)=>yauzl.open(path,{lazyEntries:true,autoClose:false,strictFileNames:true,validateEntrySizes:true},(error,value)=>error?reject(error):resolve(value!)));
  let active:Readable|undefined,fatal:Error|undefined,count=0,unpacked=0;
  const seen=new Set<string>(),onError=(error:Error)=>{fatal=error;active?.destroy(error);};zip.on('error',onError);
  const next=()=>new Promise<Entry|undefined>((resolve,reject)=>{
    const cleanup=()=>{zip.off('entry',entry);zip.off('end',end);zip.off('error',error);signal.removeEventListener('abort',abort);};
    const entry=(value:Entry)=>{cleanup();resolve(value);},end=()=>{cleanup();resolve(undefined);},error=(value:Error)=>{cleanup();reject(value);},abort=()=>error(cancelled());
    zip.once('entry',entry);zip.once('end',end);zip.once('error',error);signal.addEventListener('abort',abort,{once:true});
    if(signal.aborted)abort();else if(fatal)error(fatal);else try{zip.readEntry();}catch(value){error(value as Error);}
  });
  try{
    for(;;){
      signal.throwIfAborted();const entry=await next();if(!entry)break;
      unpacked+=entry.uncompressedSize;
      if(++count>512||unpacked>4*1024**3||!safeEntry(entry.fileName)||((entry.externalFileAttributes>>>16)&0xf000)===0xa000||
        entry.generalPurposeBitFlag&1||![0,8].includes(entry.compressionMethod))throw Error('运行包压缩文件无效');
      const key=entry.fileName.toLowerCase();if(seen.has(key))throw Error('运行包存在重复文件');seen.add(key);
      const file=expected.get(entry.fileName);if(!file)continue;
      if(entry.uncompressedSize!==file.bytes)throw Error('运行包文件大小不匹配');
      const source=await new Promise<Readable>((resolve,reject)=>zip.openReadStream(entry,(error,value)=>{
        if(error)return reject(error);value!.on('error',()=>{});if(fatal){value!.destroy();reject(fatal);}else resolve(value!);
      }));active=source;
      let bytes=0;const hash=createHash('sha256');
      const verify=new Transform({transform(chunk:Buffer,_encoding,callback){bytes+=chunk.length;if(bytes>file.bytes){callback(Error('运行包文件过大'));return;}hash.update(chunk);callback(null,chunk);}});
      try{await pipeline(source,verify,createWriteStream(join(root,file.name),{flags:'wx'}),{signal});}finally{active=undefined;}
      if(bytes!==file.bytes||hash.digest('hex')!==file.sha256)throw Error('运行包文件校验失败');
      expected.delete(entry.fileName);onFile(file.name);
    }
    if(fatal)throw fatal;if(expected.size)throw Error('运行包缺少必需文件');signal.throwIfAborted();
  }finally{
    if(zip.isOpen)await new Promise<void>(resolve=>{const finish=()=>{zip.off('close',finish);zip.off('error',finish);resolve();};zip.once('close',finish);zip.once('error',finish);zip.close();});
    zip.off('error',onError);
  }
}
