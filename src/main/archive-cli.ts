import {randomUUID} from 'node:crypto';
import {open,lstat} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import type {ArchiveEdit,ArchiveEncoding,ArchiveRequest,ArchiveListing,ArchiveResult} from '../shared/archive';
import {archiveEditPacket} from './archive-update';
import {archiveLevel,archiveResources} from '../shared/archive-options';

export class CliFailure extends Error {
 constructor(message:string,readonly exitCode:number=2){super(message);this.name='CliFailure';}
}
type Job={operation:'list'|'create'|'extract'|'test'|'update';request:ArchiveRequest;changesFile?:string};
export type CliCommand={json:boolean;progress:boolean;passwordStdin:boolean;help:boolean;jobs:Job[];jobsFile?:string};
export const cliHelp=`One.Cli.exe archive <list|create|extract|test|update|batch> [options] [--] paths

create:  --output FILE [--format zip|7z|tar|tar.gz|tar.xz|gz|xz] [--volume-size SIZE] [--level 0-9] SOURCES...
extract: --output DIRECTORY [--destination smart|folder|here] [--conflict rename|skip|replace]
         [--select 0,1,...] ARCHIVES...
list/test: [--encoding auto|437|932|936|950|65001] ARCHIVES...
update:  --changes FILE.json ARCHIVE.zip|ARCHIVE.7z
batch:   --jobs FILE.json (array of argument arrays, up to 128 jobs)
common:  --json (JSON Lines), --progress (stderr), --password-stdin, --help
resources: --threads 1-64 (compression), --memory-mib 128-8192 (per helper, default 1024)

Relative paths resolve from the working directory; batch job paths resolve from the jobs file.
Update add-source paths resolve from the changes file. Passwords must be piped through stdin.
No main window or Explorer folder is opened. Existing archive targets are never overwritten.
Exit: 0 success, 1 operation failure, 2 arguments, 3 password, 4 invalid archive,
      5 read, 6 write, 7 unsafe content, 8 mixed batch results, 9 resources, 130 cancelled, 126 runtime missing.
`;
function argument(condition:unknown,message:string):asserts condition {if(!condition)throw new CliFailure(message);}
const filePath=(value:string,cwd:string)=>{argument(typeof value==='string'&&value.length>0&&value.length<=32768&&!/[\0\r\n]/.test(value),'Invalid path');return resolve(cwd,value);};
const sourcePattern=/\.(zip|7z|7z\.001|rar|r00|tar|tar\.gz|tgz|gz|tar\.xz|txz|xz)$/i;
const targetPattern=/\.(zip|7z|tar|tar\.gz|tgz|gz|tar\.xz|txz|xz)$/i;
export function parseCli(input:string[],cwd:string):CliCommand {
 argument(input.length<=512&&input.every(item=>typeof item==='string'&&item.length<=32768&&!item.includes('\0')),'Too many or invalid arguments');
 const args=[...input];if(args[0]==='archive')args.shift();
 if(!args.length||args.length===1&&['--help','-h','help'].includes(args[0]))return {json:false,progress:false,passwordStdin:false,help:true,jobs:[]};
 const operation=args.shift()!;
 argument(['list','create','extract','test','update','batch'].includes(operation),'Unknown archive command');
 const flags=new Set(['json','progress','password-stdin','help']);
 const allowed:Record<string,string[]>={list:['encoding'],test:['encoding'],create:['output','format','volume-size','level'],extract:['output','encoding','destination','conflict','select'],update:['encoding','changes'],batch:['jobs']};
 for(const operation of ['list','test','create','extract','update'])allowed[operation].push('threads','memory-mib');
 const options=new Map<string,string>(),paths:string[]=[];let literal=false;
 for(let i=0;i<args.length;i++){
  const token=args[i];if(token==='--'&&!literal){literal=true;continue;}
  if(!literal&&token.startsWith('-')){
   const match=/^--([a-z-]+)(?:=(.*))?$/.exec(token);argument(match,'Unknown option');
   const key=match[1];argument(flags.has(key)||allowed[operation].includes(key),`Unsupported option: --${key}`);
   argument(!options.has(key),`Repeated option: --${key}`);
   if(flags.has(key)){argument(match[2]===undefined,`--${key} does not take a value`);options.set(key,'true');}
   else {const value=match[2]??args[++i];argument(value!==undefined&&value!==''&&!value.startsWith('--'),`Missing value: --${key}`);options.set(key,value);}
  }else paths.push(filePath(token,cwd));
 }
 const result:CliCommand={json:options.has('json'),progress:options.has('progress'),passwordStdin:options.has('password-stdin'),help:options.has('help'),jobs:[]};
 if(result.help)return result;
 const encodingText=options.get('encoding')??'auto';argument(['auto','437','932','936','950','65001'].includes(encodingText),'Invalid code page');
 const encoding=(encodingText==='auto'?0:Number(encodingText)) as ArchiveEncoding;
 if(operation==='batch'){argument(paths.length===0&&options.has('jobs'),'batch requires --jobs and no paths');result.jobsFile=filePath(options.get('jobs')!,cwd);return result;}
 const number=(key:string)=>{const value=options.get(key);if(value===undefined)return undefined;argument(/^\d+$/.test(value),`--${key} requires an integer`);return Number(value);};
 let resources:ReturnType<typeof archiveResources>;
 try{resources=archiveResources({threads:number('threads'),memoryMiB:number('memory-mib')});}catch(error){if(error instanceof CliFailure)throw error;throw new CliFailure(error instanceof Error?error.message:'Invalid resources');}
 argument(paths.length>0&&paths.length<=128,'Supply 1–128 paths');
 if(operation==='create'){
  argument(options.has('output'),'create requires --output');const path=filePath(options.get('output')!,cwd);argument(targetPattern.test(path),'Unsupported output archive format');
  const format=options.get('format');if(format){argument(['zip','7z','tar','tar.gz','tar.xz','gz','xz'].includes(format),'Unsupported format');const lower=path.toLowerCase(),actual=/\.(tar\.gz|tgz)$/.test(lower)?'tar.gz':/\.(tar\.xz|txz)$/.test(lower)?'tar.xz':lower.split('.').at(-1);argument(actual===format,'--format must match the output extension');}
  let volumeBytes=0;const volume=options.get('volume-size');if(volume){const match=/^(\d+)(KiB|MiB|GiB)?$/i.exec(volume);argument(match,'Volume size requires integer bytes or KiB/MiB/GiB');const unit=match[2]?.toLowerCase();volumeBytes=Number(match[1])*(unit==='kib'?1024:unit==='mib'?1024**2:unit==='gib'?1024**3:1);argument(Number.isSafeInteger(volumeBytes)&&volumeBytes>=1024**2&&volumeBytes<=64*1024**3,'Volume size must be 1 MiB–64 GiB');argument(/\.(zip|7z)$/i.test(path),'Only ZIP and 7Z support volumes');}
  let level:number|undefined;try{level=options.has('level')?archiveLevel(number('level')):undefined;}catch{throw new CliFailure('--level must be an integer from 0 to 9');}
  argument(!/\.tar$/i.test(path)||level===undefined||level===0,'TAR stores files without compression; only --level 0 is valid');
  result.jobs=[{operation,request:{operation,path,sources:paths,volumeBytes,level,...resources}}];return result;
 }
 argument(paths.every(path=>sourcePattern.test(path)),'Unsupported input archive format');
 if(operation==='extract'){
  argument(options.has('output'),'extract requires --output');const parent=filePath(options.get('output')!,cwd),destination=options.get('destination')??'folder',conflict=options.get('conflict')??'rename';
  argument(['folder','smart','here'].includes(destination),'Invalid extraction destination');argument(['rename','skip','replace'].includes(conflict),'Invalid conflict policy');
  const select=options.get('select');let selected:number[]=[];
  if(select){argument(/^\d+(,\d+)*$/.test(select),'--select requires comma-separated zero-based indexes');selected=[...new Set(select.split(',').map(Number))];argument(selected.length<=10000&&selected.every(index=>Number.isSafeInteger(index)&&index<1000000),'Invalid selected indexes');}
  result.jobs=paths.map(path=>({operation,request:{operation,path,parent,destination:destination as 'folder'|'smart'|'here',conflict:conflict as 'rename'|'skip'|'replace',encoding,selected}}));
 }else if(operation==='update'){
  argument(paths.length===1&&options.has('changes'),'update requires one archive and --changes');argument(/\.(?:zip|7z)$/i.test(paths[0]),'Only single-volume ZIP and 7Z editing is supported');
  result.jobs=[{operation,request:{operation,path:paths[0],encoding,revision:'',changes:[]},changesFile:filePath(options.get('changes')!,cwd)}];
 }else result.jobs=paths.map(path=>({operation:operation as 'list'|'test',request:{operation:operation as 'list'|'test',path,encoding}}));
 for(const job of result.jobs)Object.assign(job.request,resources);
 return result;
}

/** Read a bounded file through its handle, including files that grow after stat. */
async function jsonFile(file:string):Promise<unknown>{
 const handle=await open(file,'r');try{const info=await handle.stat();argument(info.isFile()&&info.size<=4*1024*1024,'Plan must be a file of at most 4 MiB');const buffer=Buffer.alloc(4*1024*1024+1);let length=0;while(length<buffer.length){const {bytesRead}=await handle.read(buffer,length,buffer.length-length,null);if(!bytesRead)break;length+=bytesRead;}argument(length<=4*1024*1024,'Plan exceeds 4 MiB');try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,length)).replace(/^\uFEFF/,''));}catch{throw new CliFailure('Plan is not valid UTF-8 JSON');}}finally{await handle.close();}
}
async function readChanges(file:string):Promise<ArchiveEdit[]>{
 const changes=await jsonFile(file);argument(Array.isArray(changes)&&changes.length>0&&changes.length<=10000,'Supply 1–10000 changes');
 const fields:Record<string,string[]>={delete:['kind','indexes'],rename:['kind','index','name'],mkdir:['kind','name'],add:['kind','source','name','replace'],comment:['kind','text']};
 for(const item of changes){argument(item&&typeof item==='object'&&!Array.isArray(item)&&Object.hasOwn(fields,item.kind)&&Object.keys(item).every(key=>fields[item.kind].includes(key)),'Unknown change or change field');if(item.kind==='add')item.source=filePath(item.source,dirname(file));}
 try{await archiveEditPacket(changes);}catch(error){if(error&&typeof error==='object'&&'code' in error)throw error;throw new CliFailure(error instanceof Error?error.message:'Invalid changes');}
 return changes;
}
export interface CliService {run(owner:number,request:ArchiveRequest,id:string):Promise<ArchiveListing|ArchiveResult>;cancel(id:string,owner:number):boolean}
export interface CliIO {out:(line:string)=>Promise<void>;err:(line:string)=>Promise<void>;signal:AbortSignal;password:()=>Promise<string>;event?:(operation:string,outcome:string,duration:number)=>void}
export function cliExit(error:unknown,writing=false):number {
 if(error instanceof CliFailure)return error.exitCode;
 const code=error&&typeof error==='object'&&'code' in error?String(error.code):'';
 const typed:Record<string,number>={password:3,archive:4,read:5,write:6,safety:7,resource:9,cancelled:130};if(Object.hasOwn(typed,code))return typed[code];
 if(['ENOENT','ENOTDIR','EISDIR'].includes(code))return 5;
 if(['EEXIST','ENOSPC','EROFS'].includes(code))return 6;
 if(['EACCES','EPERM','EBUSY'].includes(code))return writing?6:5;
 if(code==='ABORT_ERR')return 130;
 return 1;
}
const human=(value:string)=>value.replace(/[\x00-\x1f\x7f-\x9f]/g,char=>'\\u'+char.charCodeAt(0).toString(16).padStart(4,'0'));
export async function runCli(command:CliCommand,service:CliService,io:CliIO):Promise<number>{
 if(command.help){await io.out(cliHelp);return 0;}
 const write=async(type:string,data:Record<string,unknown>,text:string)=>{if(command.json)await io.out(JSON.stringify({schema:1,type,...data})+'\n');else await io.out(text+'\n');};
 let jobs=command.jobs;
 if(command.jobsFile){const plan=await jsonFile(command.jobsFile);argument(Array.isArray(plan)&&plan.length>0&&plan.length<=128,'Supply 1–128 batch jobs');jobs=[];
  for(const args of plan){argument(Array.isArray(args)&&args.every(value=>typeof value==='string'),'Each job must be an argument array');const job=parseCli(args,dirname(command.jobsFile));argument(!job.jobsFile&&!job.help&&!job.passwordStdin&&!job.json&&!job.progress,'Batch jobs must be operations without common options');jobs.push(...job.jobs);argument(jobs.length<=128,'Batch exceeds 128 operations');}
 }
 const secret=command.passwordStdin?await io.password():'';
 argument(Buffer.byteLength(secret)<=1024&&!/[\0\r\n]/.test(secret),'Invalid password input');
 const counts={completed:0,failed:0,cancelled:0,skipped:0},codes:number[]=[];let currentId:string|undefined;
 const cancel=()=>{if(currentId)service.cancel(currentId,0);};io.signal.addEventListener('abort',cancel);const timer=setInterval(()=>{if(io.signal.aborted)cancel();},40);
 const call=async(request:ArchiveRequest)=>{if(io.signal.aborted)throw new CliFailure('Cancelled',130);currentId=randomUUID();try{return await service.run(0,{...request,password:secret},currentId);}finally{currentId=undefined;}};
 try{
  for(let index=0;index<jobs.length;index++){
   const job=jobs[index],started=Date.now(),base={job:index,operation:job.operation,source:job.request.path};
   if(io.signal.aborted){counts.cancelled++;codes.push(130);await write('error',{...base,exitCode:130,message:'Cancelled before start'},'Cancelled: '+human(job.request.path));continue;}
   await write('start',base,`${job.operation}: ${human(job.request.path)}`);
   try{
    if(job.request.operation!=='create'){const info=await lstat(job.request.path);if(!info.isFile()||info.isSymbolicLink())throw new CliFailure('Input must be an ordinary archive file',5);}
    let value:ArchiveListing|ArchiveResult;
    if(job.request.operation==='list'){
     let offset=0,revision:string|undefined,total=-1,count=0;
     do{const page=await call({...job.request,offset}) as ArchiveListing;
      if(total<0){total=page.total;revision=page.revision;argument(Number.isSafeInteger(total)&&total>=0&&total<=1000000,'Archive directory exceeds supported limits');await write('meta',{...base,total,comment:page.comment,revision,editable:page.editable},`Entries: ${total}${page.comment?'\nComment: '+human(page.comment):''}`);}
      else if(page.total!==total||page.revision!==revision)throw new CliFailure('Archive changed while listing',4);
      if(page.offset!==offset||page.entries.length>200||!page.entries.length&&offset<total)throw new CliFailure('Incomplete archive directory',4);
      for(const entry of page.entries){if(entry.index!==count||count>=total)throw new CliFailure('Invalid archive directory order',4);await write('entry',{...base,...entry},`${entry.index}\t${entry.directory?'DIR':entry.size}\t${human(entry.name)}`);count++;}
      offset=count;
     }while(offset<total);
     value={path:job.request.path,count};
    }else if(job.request.operation==='update'){
     const changes=await readChanges(job.changesFile!);const listing=await call({operation:'list',path:job.request.path,encoding:job.request.encoding}) as ArchiveListing;
     if(!listing.editable||!listing.revision)throw new CliFailure('Archive is not an editable single-volume ZIP',2);
     value=await call({...job.request,changes,revision:listing.revision});
    }else value=await call(job.request);
    if(!('count' in value))throw new CliFailure('Archive engine returned no result',1);
    if(value.cancelled)throw new CliFailure('Cancelled; publication rolled back',130);
    counts.completed++;counts.skipped+=value.skipped??0;
    await write('result',{...base,...value,elapsedMs:Date.now()-started},`Completed: ${value.count} items${value.skipped?`, ${value.skipped} skipped`:''} -> ${human(value.path)}`);
    io.event?.(job.operation,'ok',Date.now()-started);
   }catch(error){const code=io.signal.aborted?130:cliExit(error,job.operation==='create'||job.operation==='extract'||job.operation==='update');codes.push(code);if(code===130)counts.cancelled++;else counts.failed++;
    const message=error instanceof Error?error.message:'Operation failed';await write('error',{...base,exitCode:code,message},`Failed (${code}): ${human(message)}`);io.event?.(job.operation,`error:${code}`,Date.now()-started);
   }
  }
 }finally{clearInterval(timer);io.signal.removeEventListener('abort',cancel);}
 const unique=new Set(codes);const exitCode=counts.cancelled?130:!codes.length?0:counts.completed||unique.size>1?8:codes[0];
 await write('summary',{...counts,total:jobs.length,exitCode},`Summary: ${counts.completed} completed, ${counts.failed} failed, ${counts.cancelled} cancelled, ${counts.skipped} skipped`);return exitCode;
}
