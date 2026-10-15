import yauzl,{type Entry,type ZipFile} from 'yauzl';
import {createWriteStream,createReadStream} from 'node:fs';
import {mkdir,readdir,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {createHash} from 'node:crypto';
export interface RuntimeFile {name:string;bytes:number;sha256:string}
export interface RuntimeSelection {maxArchiveBytes:number;excludePrefixes:string[];excludeSuffixes:string[]}
export function runtimeName(name:string){return !!name&&!name.startsWith('/')&&!/[\\:\0]/.test(name)&&name.split('/').every(part=>part!=='.'&&part!=='..'&&!!part&&!/[. ]$/.test(part)&&! /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));}
export async function runtimeHash(path:string,signal?:AbortSignal){const hash=createHash('sha256'),stream=createReadStream(path,{signal});for await(const chunk of stream){signal?.throwIfAborted();hash.update(chunk);}return hash.digest('hex');}
export async function extractFormulaRuntime(path:string,destination:string,prefix:string,signal:AbortSignal,selection?:RuntimeSelection){
  if(selection&&(!Number.isSafeInteger(selection.maxArchiveBytes)||selection.maxArchiveBytes<1024**3||selection.maxArchiveBytes>2*1024**3||!Array.isArray(selection.excludePrefixes)||!Array.isArray(selection.excludeSuffixes)||selection.excludePrefixes.length>16||selection.excludeSuffixes.length>8||selection.excludePrefixes.some(value=>typeof value!=='string'||!value.endsWith('/')||!runtimeName(value.slice(0,-1)))||selection.excludeSuffixes.some(value=>typeof value!=='string'||!/^\.[a-z0-9]{1,12}$/.test(value))))throw Error('运行包文件筛选配方无效');
  if(prefix&&!runtimeName(prefix))throw Error('运行包目标前缀无效');const base=await lstat(destination);if(!base.isDirectory()||base.isSymbolicLink())throw Error('运行包目标目录无效');
  const zip=await new Promise<ZipFile>((resolve,reject)=>yauzl.open(path,{lazyEntries:true,autoClose:false,strictFileNames:true,validateEntrySizes:true},(error,value)=>error?reject(error):resolve(value!)));
  let count=0,total=0,fatal:Error|undefined;const names=new Set<string>();zip.on('error',error=>fatal=error);
  const next=()=>new Promise<Entry|undefined>((resolve,reject)=>{
    const cleanup=()=>{zip.off('entry',entry);zip.off('end',end);zip.off('error',error);signal.removeEventListener('abort',abort);};
    const entry=(value:Entry)=>{cleanup();resolve(value);},end=()=>{cleanup();resolve(undefined);},error=(value:Error)=>{cleanup();reject(value);},abort=()=>error(Error('运行包解压已取消'));
    zip.once('entry',entry);zip.once('end',end);zip.once('error',error);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();else if(fatal)error(fatal);else zip.readEntry();
  });
  try{for(;;){signal.throwIfAborted();const entry=await next();if(!entry)break;const name=entry.fileName.replace(/\/$/,'');total+=entry.uncompressedSize;
    if(++count>32768||total>(selection?.maxArchiveBytes??1024**3)||!runtimeName(name)||entry.generalPurposeBitFlag&1||((entry.externalFileAttributes>>>16)&0xf000)===0xa000||![0,8].includes(entry.compressionMethod)||names.has(name.toLowerCase()))throw Error('运行包压缩内容无效');names.add(name.toLowerCase());
    if(entry.fileName.endsWith('/')||selection&&(selection.excludePrefixes.some(value=>name.startsWith(value))||selection.excludeSuffixes.some(value=>name.endsWith(value))))continue;const target=join(destination,prefix,...name.split('/'));await mkdir(join(target,'..'),{recursive:true});
    const source=await new Promise<NodeJS.ReadableStream>((resolve,reject)=>zip.openReadStream(entry,(error,stream)=>error?reject(error):resolve(stream!)));
    await pipeline(source,createWriteStream(target,{flags:'wx'}),{signal});
  }}finally{zip.close();}
}
export async function runtimeFiles(root:string,signal?:AbortSignal,hash=true,allowed?:Set<string>):Promise<RuntimeFile[]>{
  const files:RuntimeFile[]=[];let total=0;
  async function walk(relative:string){signal?.throwIfAborted();const directory=join(root,relative),info=await lstat(directory);if(!info.isDirectory()||info.isSymbolicLink())throw Error('运行包目录存在链接或无效类型');
    for(const entry of await readdir(directory,{withFileTypes:true})){const name=relative?relative+'/'+entry.name:entry.name;if(!relative&&['.runtime.json','.files.json'].includes(name))continue;if(!runtimeName(name))throw Error('运行包路径无效');if(allowed&&!allowed.has(name))throw Error('运行包存在外来内容');const path=join(root,...name.split('/')),stat=await lstat(path);if(stat.isSymbolicLink())throw Error('运行包存在文件链接');
      if(stat.isDirectory())await walk(name);else if(stat.isFile()){if(files.length>=16000||(total+=stat.size)>1024**3)throw Error('运行包超出容量');files.push({name,bytes:stat.size,sha256:hash?await runtimeHash(path,signal):''});}else throw Error('运行包文件类型无效');
    }
  }
  await walk('');return files.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
}
