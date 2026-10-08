import {appendFile,copyFile,mkdir,readdir,readFile,rename,stat,unlink} from 'node:fs/promises';
import {appendFileSync,existsSync,mkdirSync,renameSync,statSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';

export type LogLevel='debug'|'info'|'warn'|'error'|'fatal';
export interface DiagnosticFile {id:string;name:string;kind:'log'|'crash';size:number;modified:number}
export interface DiagnosticRecord {time:string;level:LogLevel;category:string;event:string;detail:string;pid:number;source:string;file:string;durationMs?:number}
let pending=Promise.resolve();
const maxLogBytes=2*1024*1024;
const maxDetail=12*1024;
const safe=(value:unknown)=>String(value??'').replace(/\0/g,'').slice(0,maxDetail);
const logFolder=(profile:string)=>join(profile,'logs');
const categoryOf=(event:string)=>event.startsWith('ipc:')?'operation':event.includes('renderer')||event.includes('window')?'window':event.includes('shell')?'integration':event.includes('search')?'search':event.includes('settings')||event.includes('backup')?'settings':event.includes('file')||event.includes('lock')?'file':event.includes('native')||event.includes('child')?'native':'app';
const record=(level:LogLevel,event:string,detail:unknown,extra:Partial<Pick<DiagnosticRecord,'category'|'source'|'durationMs'>>={})=>({v:2,time:new Date().toISOString(),level,category:extra.category||categoryOf(event),event,detail:safe(detail),pid:process.pid,source:extra.source||'main',...(extra.durationMs===undefined?{}:{durationMs:Math.max(0,Math.round(extra.durationMs))})});
function append(profile:string,file:string,value:ReturnType<typeof record>){
 pending=pending.catch(()=>{}).then(async()=>{const folder=logFolder(profile),path=join(folder,file),line=JSON.stringify(value)+'\n';await mkdir(folder,{recursive:true});
  const length=(await stat(path).catch(()=>null))?.size||0;
  if(length+Buffer.byteLength(line)>maxLogBytes){await unlink(path+'.2').catch(()=>{});await rename(path+'.1',path+'.2').catch(()=>{});await rename(path,path+'.1').catch(()=>{});}
  await appendFile(path,line,'utf8');
 }).catch(()=>{});
}
export function runtimeLog(profile:string,event:string,detail=''){append(profile,'main.jsonl',record('info',event,detail));}
export function runtimeCli(profile:string,event:string,detail:string,durationMs?:number,warning=false){append(profile,'cli.jsonl',record(warning?'warn':'info',event,detail,{source:'cli',category:'operation',durationMs}));}
export async function flushRuntimeLogs(){await pending;}
export function runtimeWarning(profile:string,event:string,detail=''){append(profile,'main.jsonl',record('warn',event,detail));}
export function runtimeOperation(profile:string,event:string,role:string,durationMs:number,outcome:'ok'|'error'){
 append(profile,outcome==='ok'?'main.jsonl':'errors.jsonl',record(outcome==='ok'?'info':'error',`ipc:${event}`,`role=${safe(role)} outcome=${outcome}`,{category:'operation',durationMs}));
}
export function runtimeError(profile:string,event:string,error:unknown){const value=error instanceof Error?error.stack||`${error.name}: ${error.message}`:safe(error);append(profile,'errors.jsonl',record('error',event,value,{source:event.startsWith('renderer')?'renderer':'main'}));}
export function runtimeFatal(profile:string,event:string,error:unknown){try{const folder=logFolder(profile),file=join(folder,'fatal.jsonl');mkdirSync(folder,{recursive:true});if(existsSync(file)&&statSync(file).size>maxLogBytes){if(existsSync(file+'.2'))unlinkSync(file+'.2');if(existsSync(file+'.1'))renameSync(file+'.1',file+'.2');renameSync(file,file+'.1');}appendFileSync(file,JSON.stringify(record('fatal',event,error instanceof Error?error.stack||error.message:error))+'\n','utf8');}catch{}}
export async function diagnosticsList(profile:string,crashFolder:string):Promise<DiagnosticFile[]>{
 await pending.catch(()=>{});const result:DiagnosticFile[]=[];
 for(const [kind,folder] of [['log',logFolder(profile)],['crash',crashFolder]] as const){
  for(const subfolder of kind==='crash'?['','pending','completed']:['']){
   const dir=subfolder?join(folder,subfolder):folder;
   for(const item of await readdir(dir,{withFileTypes:true}).catch(()=>[])){
    if(!item.isFile()||!(kind==='log'&&/\.(?:jsonl(?:\.\d+)?|log)$/i.test(item.name)||kind==='crash'&&/\.dmp$/i.test(item.name)))continue;
    const path=join(dir,item.name),info=await stat(path).catch(()=>null);if(!info)continue;
    result.push({id:`${kind}/${subfolder?subfolder+'/':''}${item.name}`,name:item.name,kind,size:info.size,modified:info.mtimeMs});
   }
  }
 }
 return result.sort((a,b)=>b.modified-a.modified).slice(0,100);
}
function diagnosticPath(profile:string,crashFolder:string,id:string){
 if(!/^(?:log\/[\w.-]+\.(?:jsonl(?:\.\d+)?|log)|crash\/(?:pending\/|completed\/)?[\w.-]+\.dmp)$/i.test(id))throw new Error('诊断文件无效');
 const [kind,...parts]=id.split('/');return join(kind==='log'?logFolder(profile):crashFolder,...parts);
}
export async function diagnosticsRecent(profile:string,crashFolder:string):Promise<DiagnosticRecord[]>{
 const files=(await diagnosticsList(profile,crashFolder)).filter(file=>file.kind==='log'&&/^(?:main|errors|fatal|cli)\.jsonl(?:\.[12])?$/i.test(file.name)&&file.size<=maxLogBytes+maxDetail+1024);
 const values:DiagnosticRecord[]=[];
 for(const file of files){const body=await readFile(diagnosticPath(profile,crashFolder,file.id),'utf8').catch(()=>'');for(const line of body.split(/\r?\n/)){
  if(!line)continue;try{const item=JSON.parse(line) as Record<string,unknown>;if(typeof item.time!=='string'||typeof item.event!=='string')continue;
   values.push({time:item.time,level:isLevel(item.level)?item.level:file.name.startsWith('fatal')?'fatal':file.name.startsWith('errors')?'error':'info',category:typeof item.category==='string'?item.category:categoryOf(item.event),event:item.event,detail:safe(item.detail),pid:Number(item.pid)||0,source:typeof item.source==='string'?item.source:'main',file:file.id,...(Number.isFinite(item.durationMs)?{durationMs:Number(item.durationMs)}:{})});
  }catch{/* A truncated last line must not hide the rest of the log. */}
 }}
 return values.sort((a,b)=>b.time.localeCompare(a.time)).slice(0,600);
}
function isLevel(value:unknown):value is LogLevel{return ['debug','info','warn','error','fatal'].includes(String(value));}
export async function diagnosticsDelete(profile:string,crashFolder:string,ids:string[]){
 if(!Array.isArray(ids)||ids.length>100)throw new Error('删除列表无效');await pending.catch(()=>{});
 const known=new Set((await diagnosticsList(profile,crashFolder)).map(item=>item.id));
 for(const id of ids){if(!known.has(id))throw new Error('诊断文件不存在');await unlink(diagnosticPath(profile,crashFolder,id));}
}
export async function diagnosticsExport(profile:string,crashFolder:string,target:string,ids:string[]){
 if(!Array.isArray(ids)||ids.length>100)throw new Error('导出列表无效');await pending.catch(()=>{});
 const known=new Set((await diagnosticsList(profile,crashFolder)).map(item=>item.id));
 const folder=join(target,`One-诊断-${new Date().toISOString().replace(/[:.]/g,'-')}`);await mkdir(folder,{recursive:true});
 for(const id of ids){if(!known.has(id))throw new Error('诊断文件不存在');await copyFile(diagnosticPath(profile,crashFolder,id),join(folder,id.replaceAll('/','-')));}
 await appendFile(join(folder,'README.txt'),'One 本地诊断资料。日志可能包含文件路径、窗口标题及错误详情；分享前请检查。崩溃转储可能包含内存片段。\r\n','utf8');
 return folder;
}
