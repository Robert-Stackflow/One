import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {lstat,readdir,realpath,readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {join,resolve,basename} from 'node:path';
import {nativeMaintenance,nativeCacheFiles,nativeCacheRemove} from './native-scan';
import type {MaintenanceEntry,MaintenanceKind,MaintenanceReport,MaintenanceReceipt,MaintenanceOutcome} from '../shared/maintenance';
import type {MaintenanceRow} from '../shared/types';
const execute=promisify(execFile);
const powershell=join(process.env.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
type Candidate=MaintenanceEntry&{canonicalRoot?:string;reg?:{hive:string;view:number;key:string;value:string|null;expected:string;expectedName?:string};task?:string;file?:string;fileIdentity?:{size:number;mtime:number};files?:{path:string;size:number;mtime:number;root:string}[]};
type Receipt=MaintenanceReceipt&{backup?:unknown;file?:{original:string;stored:string};task?:string};
export class MaintenanceService {
 private controller=new AbortController();
 stop(){this.controller.abort();}
 private reports=new Map<string,Map<string,Candidate>>();private busy=false;private scans=new Map<MaintenanceKind,Promise<MaintenanceReport>>();
 constructor(private dataPath:string,private fixtureRoots?:string[],private progress:(value:import('../shared/maintenance').MaintenanceProgress)=>void=()=>{}){}
 private async ps(request:unknown):Promise<any>{return new Promise((resolve,reject)=>{const p=spawn(powershell,['-NoProfile','-NonInteractive','-File',join(__dirname,'maintenance-actions.ps1').replace('app.asar\\','app.asar.unpacked\\')],{windowsHide:true,stdio:'pipe',signal:this.controller.signal});let out='',err='';const t=setTimeout(()=>{p.kill();reject(new Error('系统操作超时'));},90000);p.stdout.setEncoding('utf8');p.stderr.setEncoding('utf8');p.stdout.on('data',c=>{out+=c;if(out.length>32*1024*1024)p.kill();});p.stderr.on('data',c=>err+=c);p.stdin.on('error',()=>{});p.on('error',e=>{clearTimeout(t);reject(e);});p.on('exit',code=>{clearTimeout(t);if(code)return reject(new Error(err.trim()||'系统操作失败'));try{const result=JSON.parse(out.trim()||'null');if(result?.error)reject(new Error(result.error));else resolve(result);}catch{reject(new Error('系统返回的数据无效'));}});p.stdin.end(JSON.stringify(request));});}
 async scan(kind:MaintenanceKind):Promise<MaintenanceReport>{
  if(!['startup','registry','disk'].includes(kind))throw new Error('检查类型无效');const active=this.scans.get(kind);if(active)return active;
  const work=(async()=>{this.progress({kind,phase:'scan',completed:0,total:0,label:'正在扫描'});const entries=kind==='disk'?await this.disk():await this.system(kind);const id=randomUUID();this.reports.set(id,new Map(entries.map(e=>[e.id,e])));while(this.reports.size>6)this.reports.delete(this.reports.keys().next().value!);this.progress({kind,phase:'scan',completed:entries.length,total:entries.length,label:'完成'});return {id,kind,created:Date.now(),entries:entries.map(({canonicalRoot,reg,task,file,fileIdentity,files,...e})=>e)};})();this.scans.set(kind,work);try{return await work;}finally{this.scans.delete(kind);}
 }
 private async system(kind:'startup'|'registry'):Promise<Candidate[]>{
  const rows:MaintenanceRow[]=await nativeMaintenance(kind,this.controller.signal);const result:Candidate[]=[];
  for(const row of rows){const entry:Candidate={...row,id:randomUUID(),category:kind==='startup'?'注册表启动项':row.location.includes('CLSID')?'COM 组件':row.location.includes('Uninstall')?'卸载信息':'应用路径',detail:row.location,action:''};
   const source=row.source.split('/');if(['CurrentUser','LocalMachine'].includes(source[0])&&/Registry(?:32|64)$/.test(row.source)){
    const value=kind==='startup'?row.name:null;entry.reg={hive:source[0],view:row.source.endsWith('32')?32:64,key:row.location,value,expected:row.command,expectedName:row.location.includes('Uninstall')?'UninstallString':undefined};
    if(kind==='startup'&&row.command)entry.action='disable';else if(row.status.includes('目标未找到'))entry.action='clean';
    if(entry.action==='clean')entry.detail='目标不存在；清理前会备份注册表。';
   }else if(['Startup','CommonStartup'].includes(row.source)&&row.command){entry.file=row.command;entry.action='disable';entry.category='启动文件夹';}
   result.push(entry);
  }
  if(kind==='startup'){
   const extra=await this.ps({mode:'startup-info'});for(const item of extra.tasks||[])result.push({id:randomUUID(),name:item.name,source:'任务计划',status:item.enabled?'已启用':'已禁用',command:item.command,location:item.path,category:'登录 / 开机任务',detail:item.description||'',task:item.path,action:item.enabled?'disable':''});
   for(const entry of result)if(entry.file){try{const meta=await lstat(entry.file);entry.fileIdentity={size:meta.size,mtime:meta.mtimeMs};}catch{entry.action='';entry.status='文件不可访问';}}
   for(const item of extra.shortcuts||[]){const entry=result.find(e=>e.file?.toLowerCase()===item.path.toLowerCase());if(entry){entry.command=item.target;entry.status=item.status;entry.detail=item.path;}}
  }
  return result;
 }
 private async disk():Promise<Candidate[]>{
  const local=process.env.LOCALAPPDATA||'',win=process.env.SystemRoot||'C:\\Windows';
  const roots=this.fixtureRoots?this.fixtureRoots.map((r,i)=>[`测试缓存 ${i+1}`,r,0] as const):[
   ['用户临时文件',process.env.TEMP||join(local,'Temp'),86400000],['系统临时文件',join(win,'Temp'),86400000],['DirectX 着色器缓存',join(local,'D3DSCache'),86400000],['崩溃转储',join(local,'CrashDumps'),86400000],
   ['Edge 缓存',join(local,'Microsoft/Edge/User Data/Default/Cache'),86400000],['Chrome 缓存',join(local,'Google/Chrome/User Data/Default/Cache'),86400000]
  ] as const;
  const entries:Candidate[]=[];const seen=new Set<string>();for(const [name,path,age] of roots){const root=resolve(path);if(seen.has(root.toLowerCase()))continue;seen.add(root.toLowerCase());const canonicalRoot=await realpath(root).catch(()=>root);const {files,skipped,truncated}=await nativeCacheFiles(root,age,this.controller.signal);this.progress({kind:'disk',phase:'scan',completed:entries.length+1,total:roots.length,label:name});entries.push({id:randomUUID(),name,category:'临时文件与缓存',source:root,status:truncated?'已达 200,000 文件上限':skipped?`${skipped} 项不可访问`:'可清理',command:'',location:root,detail:age?'清理 24 小时前的文件；占用或已变化的文件会跳过。':'测试目录',action:files.length?'clean':'',bytes:files.reduce((s,f)=>s+f.size,0),count:files.length,files,canonicalRoot});}
  if(!this.fixtureRoots){const info=await this.ps({mode:'disk-info'});entries.push({id:randomUUID(),name:'回收站',category:'回收站',source:'当前用户',status:'永久清空',command:'',location:'',detail:'永久删除当前用户回收站中的文件，无法撤销。',action:info.recycleBytes>0?'recycle':'',bytes:info.recycleBytes,count:info.recycleCount});
   for(const item of info.system||[])entries.push({id:randomUUID(),name:item.name,category:'系统文件',source:item.path,status:item.name==='hiberfil.sys'?'休眠文件':'Windows 管理',command:'',location:item.path,detail:item.name==='hiberfil.sys'?'关闭休眠将释放此文件，同时关闭快速启动。':'分页文件用于虚拟内存；请在系统设置中调整，需要重启。',action:item.name==='hiberfil.sys'?'hibernate':'manage',bytes:item.bytes});
  }return entries;
 }
 async receipts():Promise<MaintenanceReceipt[]>{await mkdir(this.dataPath,{recursive:true});const result:Receipt[]=[];for(const name of await readdir(this.dataPath)){if(!/^[\w-]+\.json$/.test(name))continue;try{result.push(JSON.parse(await readFile(join(this.dataPath,name),'utf8')));}catch{}}return result.sort((a,b)=>b.created-a.created).map(({backup,file,task,...r})=>r);}
 private async save(receipt:Receipt){await mkdir(this.dataPath,{recursive:true});const path=join(this.dataPath,receipt.id+'.json');await writeFile(path+'.tmp',JSON.stringify(receipt),'utf8');await rename(path+'.tmp',path);}
 async apply(reportId:string,ids:string[]):Promise<MaintenanceOutcome>{
  if(this.busy)throw new Error('请等待当前操作完成');const report=this.reports.get(reportId);if(!report||!Array.isArray(ids)||!ids.length||ids.length>1000||new Set(ids).size!==ids.length)throw new Error('扫描结果已过期，请重新扫描');const entries=ids.map(id=>{const e=report.get(id);if(!e||!e.action||e.action==='manage')throw new Error('清理项目无效');return e;});
  this.busy=true;const result:MaintenanceOutcome={succeeded:0,failed:[],failedCount:0,bytes:0};const kind:MaintenanceKind=entries.some(e=>e.bytes!==undefined)?'disk':entries.some(e=>e.action==='disable')?'startup':'registry';const failed=(name:string,error:string)=>{result.failedCount!++;if(result.failed.length<500)result.failed.push({name,error});};
  try{for(const e of entries){try{const receipt:Receipt={id:randomUUID(),name:e.name,created:Date.now(),restorable:!!(e.reg||e.file||e.task),restored:false,items:1};
   if(e.reg){receipt.backup=await this.ps({mode:'registry-backup',...e.reg});await this.save(receipt);await this.ps({mode:'registry-remove',...e.reg,backup:receipt.backup});}
   else if(e.file){const s=await lstat(e.file);if(!s.isFile()||s.isSymbolicLink()||s.size!==e.fileIdentity?.size||s.mtimeMs!==e.fileIdentity?.mtime)throw new Error('启动文件已变化');receipt.file={original:e.file,stored:join(this.dataPath,receipt.id+basename(e.file))};await this.save(receipt);await rename(e.file,receipt.file.stored);}
   else if(e.task){receipt.task=e.task;receipt.backup=await this.ps({mode:'task-backup',path:e.task});await this.save(receipt);await this.ps({mode:'task-disable',path:e.task,expected:receipt.backup});}
   else if(e.files){const outcome=await nativeCacheRemove(e.canonicalRoot!,e.files,value=>this.progress({kind,phase:'apply',...value,label:e.name}),this.controller.signal);result.bytes+=outcome.bytes;result.failedCount!+=outcome.failedCount;result.failed.push(...outcome.failed.slice(0,Math.max(0,500-result.failed.length)));receipt.items=outcome.items;await this.save(receipt);}
   else if(e.action==='recycle'){await this.ps({mode:'recycle-empty'});result.bytes+=e.bytes||0;await this.save(receipt);}
   else if(e.action==='hibernate'){await this.ps({mode:'hibernate-off'});result.bytes+=e.bytes||0;await this.save(receipt);}
   report.delete(e.id);result.succeeded++;this.progress({kind,phase:'apply',completed:result.succeeded,total:entries.length,label:e.name});
  }catch(error){failed(e.name,(error as Error).message);}}return result;}finally{this.busy=false;}
 }
 async restore(id:string){if(!/^[a-f\d-]{36}$/.test(id)||this.busy)throw new Error('恢复项目无效');this.busy=true;try{const receipt:Receipt=JSON.parse(await readFile(join(this.dataPath,id+'.json'),'utf8'));if(!receipt.restorable||receipt.restored)throw new Error('此项目无法恢复');if(receipt.file){try{await lstat(receipt.file.original);throw new Error('原位置已有文件，未覆盖');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}await rename(receipt.file.stored,receipt.file.original);}else if(receipt.task)await this.ps({mode:'task-restore',path:receipt.task,expected:receipt.backup});else await this.ps({mode:'registry-restore',backup:receipt.backup});receipt.restored=true;await this.save(receipt);}finally{this.busy=false;}}
 async manage(kind:string){if(kind==='pagefile'){await execute(join(process.env.SystemRoot||'C:\\Windows','System32/SystemPropertiesAdvanced.exe'),[],{windowsHide:false});}else if(kind==='hibernate-on')await this.ps({mode:'hibernate-on'});else throw new Error('系统设置无效');}
}
