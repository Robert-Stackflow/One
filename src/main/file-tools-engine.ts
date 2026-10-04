import {readFile,writeFile,mkdir,open} from 'node:fs/promises';
import {basename,dirname,join,relative,extname} from 'node:path';
import {compareTextLines} from './bounded-diff';
import {textDiffRows} from './text-diff';
import type {FileToolTask,FileToolReport,FileToolProgress,FileToolRow,FileStamp} from '../shared/file-tools';
import {walk,hashFile,sameFileContent,extensions,fileExtension,writeRows,unchanged,partialHashBytes,partialHashCoversFile} from './file-tool-fs';
import {readText} from './text-files';
export interface ToolContext {id:string;dir:string;root:string;database:string;progress:(value:FileToolProgress)=>void}
export async function runFileTool(task:FileToolTask,context:ToolContext):Promise<FileToolReport>{
 const report:FileToolReport={id:context.id,kind:task.kind,created:Date.now(),count:0,pageSize:100,summary:'',stats:{},issues:[],issueCount:0};let last=0;
 const issue=(path:string,error:unknown)=>{report.issueCount++;if(report.issues.length<100)report.issues.push({path,error:error instanceof Error?error.message:String(error)});};
 const progress=(phase:string,completed=0,total=0,path='',bytes=0,found=0,force=false)=>{if(!force&&Date.now()-last<80)return;last=Date.now();context.progress({id:context.id,kind:task.kind,phase,completed,total,path,bytes,found});};
 await mkdir(context.dir,{recursive:true});let rows:FileToolRow[]=[];
 if(task.kind==='duplicates'){
  const types=extensions(task.extensions),sizes=new Map<number,FileStamp[]>(),identities=new Set<string>();let files=0,bytes=0;
  for await(const file of walk(task.roots,task.recursive,issue)){files++;progress('收集文件',files,0,file.path);if(file.size<task.minBytes||types.size&&!types.has(fileExtension(file.path)))continue;if(identities.has(file.identity))continue;identities.add(file.identity);const bucket=sizes.get(file.size);if(bucket)bucket.push(file);else sizes.set(file.size,[file]);}
  const candidates=[...sizes.values()].filter(group=>group.length>1);sizes.clear();identities.clear();let checked=0,total=candidates.reduce((n,g)=>n+g.length,0),wasted=0,duplicates=0;
  // Group pages are independent. Keep at most eight writes in flight so many
  // small duplicate groups do not serialize filesystem metadata operations.
  const writes:Promise<Error|null>[]=[];
  const flushWrites=async()=>{const errors=await Promise.all(writes.splice(0));const error=errors.find(Boolean);if(error)throw error;};
  for(const group of candidates){const partials=new Map<string,FileStamp[]>();for(const file of group)try{const hash=await hashFile(file,true,n=>progress('快速筛选',checked,total,file.path,bytes+n));bytes+=Math.min(file.size,partialHashBytes);const bucket=partials.get(hash);if(bucket)bucket.push(file);else partials.set(hash,[file]);checked++;}catch(e){issue(file.path,e);checked++;}
   for(const [sample,subset] of partials){if(subset.length<2)continue;const hashes=new Map<string,FileStamp[]>();if(partialHashCoversFile(group[0].size))hashes.set(sample,subset);else for(const file of subset)try{const hash=await hashFile(file,false,n=>progress('校验完整内容',checked,total,file.path,bytes+n));bytes+=file.size;const bucket=hashes.get(hash);if(bucket)bucket.push(file);else hashes.set(hash,[file]);}catch(e){issue(file.path,e);}
    for(const [hash,items]of hashes){if(items.length<2)continue;const id=rows.length,extra=(items.length-1)*items[0].size;wasted+=extra;duplicates+=items.length;writes.push(writeRows(context.dir,items.map((file,id)=>({id,...file})),id).then(()=>null,error=>error instanceof Error?error:Error(String(error))));rows.push({id,hash,size:items[0].size,files:items.length,wasted:extra,samples:items.slice(0,3).map(f=>f.path)});progress('发现重复组',checked,total,items[0].path,bytes,rows.length);if(writes.length>=8)await flushWrites();}
   }
  }await flushWrites();report.stats={scanned:files,groups:rows.length,duplicateFiles:duplicates,wasted,bytesRead:bytes};report.summary=`发现 ${rows.length} 组重复文件`;
 }else if(task.kind==='diff'){
  if(task.mode==='folder'){
   const left=new Map<string,FileStamp>(),right=new Map<string,FileStamp>();for(const [root,map]of [[task.left,left],[task.right,right]] as const)for await(const file of walk([root],true,issue,true)){const name=relative(root,file.path);if(!name)continue;map.set(name.toLowerCase(),file);progress('扫描目录',left.size+right.size,0,file.path);}
   let same=0,added=0,removed=0,modified=0,checked=0;const keys=new Set([...left.keys(),...right.keys()]);for(const key of keys){const a=left.get(key),b=right.get(key);let status='相同';try{if(!a){status='新增';added++;}else if(!b){status='删除';removed++;}else if(a.directory!==b.directory||!a.directory&&(a.size!==b.size||!(await sameFileContent(a,b,()=>progress('比较内容',checked,keys.size,a.path))))){status='修改';modified++;}else same++;}catch(e){issue(a?.path||b!.path,e);status='未完成校验';}
    if(status!=='相同')rows.push({id:rows.length,status,name:relative(a?task.left:task.right,(a||b)!.path),left:a?.path,right:b?.path,leftSize:a?.size,rightSize:b?.size,directory:(a||b)!.directory});checked++;progress('比较内容',checked,keys.size,(a||b)!.path);
   }report.stats={same,added,removed,modified};report.summary=rows.length?`${rows.length} 项差异`:'两个目录内容相同';
  }else{
   const {stamp}=await import('./file-tool-fs'),a=await stamp(task.left),b=await stamp(task.right);if(a.directory||b.directory)throw Error('请选择两个文件');const textType=/^(txt|log|md|markdown|html?|css|scss|less|js|jsx|ts|tsx|json|jsonl|ya?ml|ini|toml|xml|csv|tsv|py|rs|go|java|c|cpp|h|sql|sh|bat|ps1|properties|conf|cfg)$/i;
   if((!fileExtension(a.path)||textType.test(fileExtension(a.path)))&&(!fileExtension(b.path)||textType.test(fileExtension(b.path)))&&a.size<=20*1024*1024&&b.size<=20*1024*1024){progress('比较文本',0,1,task.left,0,0,true);const [left,right]=await Promise.all([readText(a.path,task.encoding),readText(b.path,task.encoding)]);const comparison=compareTextLines(left,right,task.ignoreWhitespace);if(!unchanged(a,await stamp(a.path))||!unchanged(b,await stamp(b.path)))throw Error('文件在比较过程中发生变化，请重新比较');const compared=textDiffRows(comparison.changes);rows=compared.rows;report.stats={...compared.stats,grouped:comparison.grouped?1:0};report.summary=rows.length?`新增 ${compared.stats.addedLines} 行 · 删除 ${compared.stats.removedLines} 行`:'两个文件内容相同';
   }else{const leftHash=await hashFile(a,false,n=>progress('校验左侧文件',0,2,a.path,n)),rightHash=await hashFile(b,false,n=>progress('校验右侧文件',1,2,b.path,n));rows=[{id:0,status:leftHash===rightHash?'相同':'不同',left:a.path,right:b.path,leftSize:a.size,rightSize:b.size,leftHash,rightHash}];report.summary=leftHash===rightHash?'两个文件内容相同':'两个文件内容不同';report.stats={binary:1,leftBytes:a.size,rightBytes:b.size};}
  }
 }else if(task.kind.startsWith('rename-')){const {runRename}=await import('./rename-engine');await runRename(task,context,report,rows,progress,issue);
 }else{const {runDocuments}=await import('./document-search');await runDocuments(task,context,report,rows,progress,issue);}
 if(!report.stats.streamed){report.count=rows.length;await writeRows(context.dir,rows);}await writeFile(join(context.dir,'report.json'),JSON.stringify(report));progress('已完成',report.count,report.count,'',0,report.count,true);return report;
}
