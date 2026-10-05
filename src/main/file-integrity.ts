import {writeFileSync} from 'node:fs';
import {readFile,writeFile,rename,unlink,stat,mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {basename,dirname,join,relative,resolve,isAbsolute} from 'node:path';
import type {FileToolTask,FileToolReport,FileToolRow,FileToolProgress} from '../shared/file-tools';
import {hashFile,stamp,walk,unchanged} from './file-tool-fs';

type Entry={path:string;size:number;sha256:string};
type Manifest={format:'one-integrity';version:1;algorithm:'sha256';created:number;entries:Entry[]};
const manifestName=/^one-integrity-.*\.sha256\.json$/i;
const relativeName=(root:string,path:string)=>relative(root,path).split('\\').join('/');
const validName=(name:string)=>!!name&&!isAbsolute(name)&&!name.split(/[\\/]/).some(part=>!part||part==='.'||part==='..'||part.includes(':'))&&!/[\0\r\n]/.test(name);
const inside=(root:string,path:string)=>{const rel=relative(root,path);return !!rel&&!rel.startsWith('..')&&!isAbsolute(rel);};

/** Verification can find a row for every file. Stream those rows when called
 * by the file-tool worker, while retaining the small in-memory mode used by
 * callers that only need a direct result. */
export async function runIntegrity(task:Extract<FileToolTask,{kind:'integrity-create'|'integrity-verify'}>,report:FileToolReport,rows:FileToolRow[],emit:(value:FileToolProgress)=>void,issue:(path:string,error:unknown)=>void,streamDir?:string){
 const root=task.kind==='integrity-create'?resolve(task.roots[0]):dirname(resolve(task.manifest));
 if(!(await stat(root)).isDirectory())throw Error('请选择目录');
 let entries:Entry[]=[];const started=Date.now();let bytes=0,completed=0,last=0;
 const progress=(phase:string,path:string,total=0,force=false)=>{if(!force&&Date.now()-last<100)return;last=Date.now();emit({id:report.id,kind:task.kind,phase,completed,total,path,bytes});};
 if(task.kind==='integrity-create'){
  for await(const file of walk([root],task.recursive,issue)){
   if(manifestName.test(basename(file.path)))continue;
   if(entries.length>=250_000)throw Error('单份清单最多包含 250,000 个文件，请缩小范围');
   try{const hash=await hashFile(file,false,n=>progress('计算 SHA-256',file.path));entries.push({path:relativeName(root,file.path),size:file.size,sha256:hash});bytes+=file.size;completed++;progress('生成清单',file.path);}catch(error){issue(file.path,error);}
  }
  if(report.issueCount)throw Error(`${report.issueCount} 个文件无法读取，未生成不完整的清单`);
  entries.sort((a,b)=>a.path.localeCompare(b.path));
  const name=`one-integrity-${new Date(started).toISOString().replace(/[:.]/g,'-')}-${randomUUID()}.sha256.json`;
  const target=join(root,name),temporary=join(root,'.'+name+'.tmp');
  const manifest:Manifest={format:'one-integrity',version:1,algorithm:'sha256',created:started,entries};
  try{await writeFile(temporary,JSON.stringify(manifest,null,2),{flag:'wx'});await rename(temporary,target);}catch(error){await unlink(temporary).catch(()=>{});throw error;}
  report.manifest=target;report.summary=`已为 ${entries.length.toLocaleString()} 个文件生成完整性清单`;
  report.stats={files:entries.length,bytesRead:bytes};
 }else{
  const manifestPath=resolve(task.manifest),info=await stat(manifestPath);
  if(info.size>64*1024*1024)throw Error('清单超过 64 MB，请拆分目录');
  let manifest:Manifest;try{manifest=JSON.parse(await readFile(manifestPath,'utf8'));}catch{throw Error('清单不是有效的 JSON 文件');}
  if(manifest?.format!=='one-integrity'||manifest.version!==1||manifest.algorithm!=='sha256'||!Array.isArray(manifest.entries)||manifest.entries.length>250_000)throw Error('清单格式或版本无效');
  const names=new Set<string>();
  for(const entry of manifest.entries){if(!entry||typeof entry.path!=='string'||!validName(entry.path)||typeof entry.size!=='number'||!Number.isSafeInteger(entry.size)||entry.size<0||typeof entry.sha256!=='string'||!(/^[0-9a-f]{64}$/i).test(entry.sha256))throw Error('清单包含无效文件记录');const key=entry.path.toLowerCase();if(names.has(key))throw Error('清单存在重复路径');names.add(key);}
  entries=manifest.entries;let matched=0,missing=0,changed=0,added=0,rowCount=0,page=0,buffer:FileToolRow[]=[];
  if(streamDir)await mkdir(streamDir,{recursive:true});
  const flush=()=>{if(!streamDir||!buffer.length)return;writeFileSync(join(streamDir,`page-${page++}.json`),JSON.stringify(buffer));buffer=[];};
  const add=(row:Omit<FileToolRow,'id'>)=>{const value={id:rowCount++,...row};if(!streamDir){rows.push(value);return;}buffer.push(value);if(buffer.length===report.pageSize)flush();};
  for(const entry of entries){const path=resolve(root,entry.path);if(!inside(root,path))throw Error('清单中的路径超出当前目录');
   try{const before=await stamp(path);if(before.directory){changed++;add({path:entry.path,status:'类型改变'});}
    else if(before.size!==entry.size){changed++;add({path:entry.path,status:'大小改变',expected:entry.size,actual:before.size});}
    else{const actual=await hashFile(before,false,()=>progress('校验 SHA-256',path,entries.length));
     if(!unchanged(before,await stamp(path)))throw Error('文件在校验过程中发生变化');
     if(actual.toLowerCase()===entry.sha256.toLowerCase())matched++;else{changed++;add({path:entry.path,status:'内容不同',expected:entry.sha256,actual});}
     bytes+=before.size;}
   }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT'){missing++;add({path:entry.path,status:'缺失'});}else{issue(path,error);add({path:entry.path,status:'无法读取',error:String(error)});}}
   completed++;progress('核对清单',path,entries.length);
  }
  for await(const file of walk([root],true,issue)){
   if(file.path.toLowerCase()===manifestPath.toLowerCase()||manifestName.test(basename(file.path)))continue;
   const name=relativeName(root,file.path);if(!names.has(name.toLowerCase())){added++;add({path:name,status:'新增'});}
  }
  flush();report.manifest=manifestPath;report.summary=rowCount||report.issueCount?`发现 ${rowCount.toLocaleString()} 项变化${report.issueCount?' · '+report.issueCount+' 项未读取':''}`:`${matched.toLocaleString()} 个文件校验通过`;
  report.stats={files:entries.length,matched,missing,changed,added,bytesRead:bytes,...(streamDir?{streamed:1}:{} )};report.count=rowCount;
 }
 progress('已完成',report.manifest||root,entries.length,true);
}
