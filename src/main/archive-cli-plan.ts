import {resolve,sep,dirname,basename,join} from 'node:path';
import {realpath} from 'node:fs/promises';
import type {ArchiveRequest} from '../shared/archive';

type Access={path:string;write:boolean;family?:boolean};
const normalized=(path:string)=>resolve(path).toLowerCase();
// Split members share the archive family. ZIP's final .zip member and 7Z's
// .001 member must not race with a create targeting the unsuffixed name.
const archiveFamily=(path:string)=>path.replace(/\.7z\.\d{3,}$/i,'.7z').replace(/\.z\d{2,}$/i,'.zip').replace(/\.r\d\d$/i,'.rar').replace(/\.part\d+\.rar$/i,'.rar');
const overlap=(a:string,b:string)=>archiveFamily(a)===archiveFamily(b)||a.startsWith(b.endsWith(sep)?b:b+sep)||b.startsWith(a.endsWith(sep)?a:a+sep);
function access(request:ArchiveRequest):Access[]{
 if(request.operation==='create')return [{path:normalized(request.path),write:true,family:true},...request.sources.map(path=>({path:normalized(path),write:false}))];
 if(request.operation==='extract')return [{path:normalized(request.path),write:false,family:true},{path:normalized(request.parent),write:true}];
 return [{path:normalized(request.path),write:request.operation==='update',family:true}];
}
async function canonical(path:string):Promise<string|undefined>{
 let current=resolve(path);const suffix:string[]=[];
 for(let depth=0;depth<512;depth++){
  try{return normalized(join(await realpath(current),...suffix.slice().reverse()));}catch(error){
   if(!['ENOENT','ENOTDIR'].includes((error as NodeJS.ErrnoException).code??''))return undefined;
   const parent=dirname(current);if(parent===current)return undefined;suffix.push(basename(current));current=parent;
  }
 }
 return undefined;
}
/** Earlier conflicting jobs form a bounded DAG; independent jobs can advance. */
export async function archiveCliDependencies(jobs:{request:ArchiveRequest}[],signal?:AbortSignal):Promise<number[][]>{
 const paths:Access[][]=[],uncertain=new Set<number>(),cache=new Map<string,Promise<string|undefined>>();
 for(let index=0;index<jobs.length;index++){
  const scopes:Access[]=[];
  for(const item of access(jobs[index].request)){
   if(signal?.aborted)return jobs.map(()=>[]);
   let pending=cache.get(item.path);if(!pending){pending=canonical(item.path);cache.set(item.path,pending);}const path=await pending;
   if(path===undefined)uncertain.add(index);const resolved=path??item.path;scopes.push({...item,path:item.family?archiveFamily(resolved):resolved});
  }
  paths.push(scopes);
 }
 return jobs.map((job,index)=>{
  const previous:number[]=[];
  for(let before=0;before<index;before++){
   // Update plans can add arbitrary absolute sources. Keep them as barriers
   // without loading all change files or guessing their complete footprint.
   if(uncertain.has(index)||uncertain.has(before)||job.request.operation==='update'||jobs[before].request.operation==='update'||paths[index].some(a=>a.write&&paths[before].some(b=>overlap(a.path,b.path)))||paths[before].some(b=>b.write&&paths[index].some(a=>overlap(a.path,b.path))))previous.push(before);
  }
  return previous;
 });
}
