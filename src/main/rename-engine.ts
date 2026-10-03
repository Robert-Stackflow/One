import {lstat,readFile,writeFile,appendFile} from 'node:fs/promises';
import {dirname,basename,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {FileToolTask,FileToolReport,FileToolRow,FileStamp,RenameOptions} from '../shared/file-tools';
import {renameName} from '../shared/file-tools';
import {walk,stamp,unchanged,allRows} from './file-tool-fs';
import type {ToolContext} from './file-tools-engine';
type RenameRow=FileToolRow&{path:string;target:string;name:string;newName:string;stamp:FileStamp;status:string};
type Move={from:string;to:string;identity:string};
const windowsPath=(path:string)=>path.startsWith('\\\\?\\')?path:path.startsWith('\\\\')?'\\\\?\\UNC\\'+path.slice(2):'\\\\?\\'+path;
let nativeMove:((from:string,to:string)=>void)|undefined;
function moveNoReplace(from:string,to:string){
 if(!nativeMove){const koffi=require('koffi'),kernel=koffi.load('kernel32.dll'),move=kernel.func('bool __stdcall MoveFileExW(str16 existing,str16 next,uint32 flags)'),error=kernel.func('uint32 __stdcall GetLastError()');nativeMove=(from,to)=>{if(!move(windowsPath(from),windowsPath(to),0))throw Error(`无法重命名（Windows ${error()}）：${basename(from)}`);};}
 nativeMove(from,to);
}
function checkOptions(o:RenameOptions){if(!o||typeof o.search!=='string'||typeof o.replace!=='string'||o.search.length>1000||o.replace.length>2000||!['name','stem','extension'].includes(o.target)||!['keep','lower','upper','title'].includes(o.caseMode)||!['regex','caseSensitive','all','enumerate'].every(k=>typeof(o as any)[k]==='boolean')||!Number.isInteger(o.start)||Math.abs(o.start)>1e9||!Number.isInteger(o.increment)||Math.abs(o.increment)>1e6||!Number.isInteger(o.padding)||o.padding<0||o.padding>12)throw Error('重命名规则无效');if(o.regex)new RegExp(o.search);}
export async function runRename(task:FileToolTask,context:ToolContext,report:FileToolReport,rows:FileToolRow[],progress:(phase:string,completed?:number,total?:number,path?:string,bytes?:number,found?:number,force?:boolean)=>void,issue:(path:string,error:unknown)=>void){
 if(task.kind==='rename-preview'){
  checkOptions(task.options);const files:FileStamp[]=[],roots=new Set(task.paths.map(p=>p.toLowerCase()));for await(const file of walk(task.paths,task.recursive,issue,task.folders,task.selectedOnly)){if(file.directory? !task.folders||!task.selectedOnly&&roots.has(file.path.toLowerCase()):!task.files)continue;if(files.length>=100000)throw Error('一次最多预览 100,000 项，请缩小范围');files.push(file);progress('收集项目',files.length,0,file.path);}files.sort((a,b)=>a.path.localeCompare(b.path,'zh-CN',{numeric:true}));
  for(const [id,file]of files.entries()){let name=basename(file.path),newName=name,status='无变化';try{newName=renameName(name,task.options,id,file.birthtime,file.directory);status=name===newName?'无变化':'可重命名';}catch(e){status=(e as Error).message;}rows.push({id,path:file.path,target:join(dirname(file.path),newName),name,newName,stamp:file,status});progress('预览规则',id+1,files.length,file.path);}
  const changes=rows.filter(r=>r.status==='可重命名') as RenameRow[],sources=new Set(changes.map(r=>r.path.toLowerCase())),targets=new Map<string,RenameRow[]>();for(const row of changes){const key=row.target.toLowerCase(),bucket=targets.get(key);if(bucket)bucket.push(row);else targets.set(key,[row]);}
  for(const group of targets.values()){if(group.length>1){for(const r of group)r.status='多个项目产生相同名称';continue;}const r=group[0];if(!sources.has(r.target.toLowerCase()))try{await lstat(r.target);r.status='目标名称已存在';}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')r.status=(e as Error).message;}}
  report.stats={items:rows.length,changes:rows.filter(r=>r.status==='可重命名').length,conflicts:rows.filter(r=>!['可重命名','无变化'].includes(String(r.status))).length};report.summary=`${report.stats.changes} 项可重命名 · ${report.stats.conflicts} 项冲突`;return;
 }
 if(task.kind!=='rename-apply'&&task.kind!=='rename-undo')throw Error('重命名任务无效');
 const source=join(context.root,task.kind==='rename-apply'?task.report:task.receipt),previous=JSON.parse(await readFile(join(source,'report.json'),'utf8')) as FileToolReport;
 if(task.kind==='rename-undo'){
  if(previous.kind!=='rename-apply')throw Error('此记录无法撤销');const receipt=JSON.parse(await readFile(join(source,'receipt.json'),'utf8')) as {moves:Move[];files:{path:string;identity:string}[];undone?:boolean};if(receipt.undone)throw Error('此操作已经撤销');for(const item of receipt.files)if((await stamp(item.path)).identity!==item.identity)throw Error('文件已被替换，无法自动撤销：'+item.path);
  const reversed:Move[]=[];try{for(const move of [...receipt.moves].reverse()){moveNoReplace(move.to,move.from);reversed.push(move);progress('撤销重命名',reversed.length,receipt.moves.length,move.to);}}catch(e){for(const move of reversed.reverse())try{moveNoReplace(move.from,move.to);}catch(rollback){issue(move.from,rollback);}throw e;}
  receipt.undone=true;await writeFile(join(source,'receipt.json'),JSON.stringify(receipt));previous.receipt=undefined;previous.stats.undone=1;await writeFile(join(source,'report.json'),JSON.stringify(previous));report.stats={renamed:receipt.files.length};report.summary=`已撤销 ${receipt.files.length} 项重命名`;return;
 }
 if(previous.kind!=='rename-preview')throw Error('请选择重命名预览');const selected=task.ids?new Set(task.ids):undefined,excluded=new Set(task.excluded||[]),plan=(await allRows(source,previous) as RenameRow[]).filter(r=>r.status==='可重命名'&&(!selected||selected.has(r.id))&&!excluded.has(r.id));if(!plan.length)throw Error('没有可重命名的项目');
 for(const row of plan){const current=await stamp(row.path);if(current.identity!==row.stamp.identity||!current.directory&&!unchanged(current,row.stamp))throw Error('预览后项目发生变化，请重新预览：'+row.path);}
 const sources=new Set(plan.map(r=>r.path.toLowerCase()));for(const row of plan)if(!sources.has(row.target.toLowerCase()))try{await lstat(row.target);throw Error('目标名称已存在：'+row.target);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 const groups=new Map<string,RenameRow[]>();for(const row of plan){const parent=dirname(row.path),group=groups.get(parent);if(group)group.push(row);else groups.set(parent,[row]);}const moves:Move[]=[];
 const perform=async(from:string,to:string,identity:string)=>{const move={from,to,identity};await appendFile(join(context.dir,'journal.ndjson'),JSON.stringify({intent:move})+'\n',{flush:true});moveNoReplace(from,to);moves.push(move);await appendFile(join(context.dir,'journal.ndjson'),JSON.stringify({done:move})+'\n',{flush:true});};
 try{let completed=0;for(const [parent,group]of [...groups].sort((a,b)=>b[0].length-a[0].length)){const staged:{row:RenameRow;temporary:string}[]=[];for(const row of group){const temporary=join(parent,'.one-rename-'+randomUUID());await perform(row.path,temporary,row.stamp.identity);staged.push({row,temporary});}for(const {row,temporary}of staged){await perform(temporary,row.target,row.stamp.identity);completed++;progress('执行重命名',completed,plan.length,row.target);}}
 const folders=plan.filter(r=>r.stamp.directory).sort((a,b)=>b.path.length-a.path.length),finalPath=(path:string)=>{let result=path;for(const folder of folders)if(result.toLowerCase().startsWith(folder.path.toLowerCase()+'\\'))result=folder.target+result.slice(folder.path.length);return result;};
 const files=plan.map(r=>({path:finalPath(r.target),identity:r.stamp.identity}));await writeFile(join(context.dir,'receipt.json'),JSON.stringify({moves,files}));rows.push(...plan.map((r,id)=>({id,path:r.path,target:files[id].path,name:r.name,newName:r.newName,status:'已重命名'})));report.receipt=context.id;report.stats={renamed:plan.length};report.summary=`已重命名 ${plan.length} 项`;
 } catch(e){for(const move of [...moves].reverse())try{moveNoReplace(move.to,move.from);}catch(rollback){issue(move.to,rollback);}await writeFile(join(context.dir,'recovery.json'),JSON.stringify({moves,issues:report.issues,error:String(e)}));if(report.issueCount)throw Error('重命名中断，部分回滚未完成；恢复记录已保存：'+context.dir);throw e;}
}
