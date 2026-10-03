import {lstat,opendir,open,mkdir,writeFile,readFile} from 'node:fs/promises';
import {isAbsolute,join,resolve,extname,parse,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import type {FileStamp,FileToolReport,FileToolRow} from '../shared/file-tools';
export const extensions=(text:string)=>new Set(text.split(/[;,\s]+/).map(s=>s.replace(/^\*?\./,'').toLowerCase()).filter(Boolean));
export function paths(value:unknown){if(!Array.isArray(value)||!value.length||value.length>10000||value.some(p=>typeof p!=='string'||!isAbsolute(p)||p.length>32768||p.includes('\0')))throw Error('请选择有效的文件或文件夹');return [...new Set((value as string[]).map(p=>resolve(p)))];}
const identity=(s:{dev:bigint;ino:bigint},path:string)=>(process.platform==='win32'?parse(path).root.toLowerCase():s.dev)+':'+s.ino;
export async function stamp(path:string):Promise<FileStamp>{const s=await lstat(path,{bigint:true});if(s.isSymbolicLink())throw Error('不处理符号链接或目录联接');return{path,size:Number(s.size),mtime:s.mtimeNs.toString(),birthtime:Number(s.birthtimeMs),identity:identity(s,path),directory:s.isDirectory()};}
export const unchanged=(a:FileStamp,b:FileStamp)=>a.identity===b.identity&&a.size===b.size&&a.mtime===b.mtime&&a.directory===b.directory;
const hashBufferBytes=256*1024;
export const partialHashBytes=hashBufferBytes*3;
export const partialHashCoversFile=(size:number)=>size<=partialHashBytes;
function overlappingRoots(roots:string[]){
 if(roots.length<2)return false;
 const normalized=roots.map(root=>root.toLowerCase()),known=new Set(normalized);
 if(known.size!==roots.length)return true;
 for(let root of normalized){for(let parent=dirname(root);parent!==root;root=parent,parent=dirname(root))if(known.has(parent))return true;}
 return false;
}
export async function* walk(roots:string[],recursive:boolean,issue:(path:string,error:unknown)=>void,includeDirectories=false,selectedOnly=false):AsyncGenerator<FileStamp>{
 const stack=paths(roots).reverse(),seen=overlappingRoots(stack)?new Set<string>():undefined;
 while(stack.length){const path=stack.pop()!;if(seen){const key=path.toLowerCase();if(seen.has(key))continue;seen.add(key);}let value:FileStamp;try{value=await stamp(path);}catch(e){issue(path,e);continue;}if(selectedOnly||!value.directory){yield value;continue;}if(includeDirectories)yield value;try{const dir=await opendir(path);for await(const e of dir){if(e.isSymbolicLink())continue;const child=join(path,e.name);if(e.isDirectory()){if(recursive)stack.push(child);else if(includeDirectories)try{yield await stamp(child);}catch(e){issue(child,e);}}else if(e.isFile()){if(seen){const key=child.toLowerCase();if(seen.has(key))continue;seen.add(key);}try{yield await stamp(child);}catch(e){issue(child,e);}}}}catch(e){issue(path,e);}}
}
export async function hashFile(file:FileStamp,partial=false,tick:(bytes:number)=>void=()=>{}){
 const handle=await open(file.path,'r');try{const before=await handle.stat({bigint:true});if(identity(before,file.path)!==file.identity||before.mtimeNs.toString()!==file.mtime||Number(before.size)!==file.size)throw Error('文件在扫描后发生变化');const hash=createHash('sha256'),buffer=Buffer.allocUnsafe(hashBufferBytes);let bytes=0;
  if(partial&&!partialHashCoversFile(file.size)){for(const position of [0,Math.floor((file.size-buffer.length)/2),file.size-buffer.length]){const r=await handle.read(buffer,0,buffer.length,position);hash.update(buffer.subarray(0,r.bytesRead));bytes+=r.bytesRead;tick(bytes);}}
  else{while(true){const r=await handle.read(buffer,0,buffer.length,null);if(!r.bytesRead)break;hash.update(buffer.subarray(0,r.bytesRead));bytes+=r.bytesRead;tick(bytes);}}
  const after=await handle.stat({bigint:true});if(identity(after,file.path)!==file.identity||after.mtimeNs.toString()!==file.mtime||Number(after.size)!==file.size)throw Error('文件在校验过程中发生变化');return hash.digest('hex');
 }finally{await handle.close();}
}
export async function writeRows(dir:string,rows:FileToolRow[],group?:number){await mkdir(dir,{recursive:true});for(let offset=0;offset<rows.length;offset+=100)await writeFile(join(dir,(group===undefined?'page-':`group-${group}-page-`)+Math.floor(offset/100)+'.json'),JSON.stringify(rows.slice(offset,offset+100)));}
export async function allRows(dir:string,report:FileToolReport):Promise<FileToolRow[]>{const result:FileToolRow[]=[];for(let page=0;page<Math.ceil(report.count/report.pageSize);page++)result.push(...JSON.parse(await readFile(join(dir,`page-${page}.json`),'utf8')));return result;}
export const fileExtension=(path:string)=>extname(path).slice(1).toLowerCase();
