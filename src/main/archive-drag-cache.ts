import {lstat,mkdir,readFile,readdir,rename,rm,rmdir,writeFile} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute} from 'node:path';

const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const marker='.one-archive-drag.json',lease='lease.lock',claimed='lease.claimed';
const signature='One archive drag lease v1\n';
const ttl=24*60*60*1000;
export type DragCacheReport={removed:number;busy:number;failures:string[]};
export type DragCacheJob={directory:string;payload:string;lease:string};

/** Only generated, marked jobs can be reclaimed. A native helper holds the
 * lease without FILE_SHARE_DELETE throughout extraction and OLE transfer.
 * Renaming that lease is an atomic claim: a live helper prevents it, and a
 * helper which has not started yet can no longer acquire a claimed lease. */
export class ArchiveDragCache {
 constructor(private root:string,private report:(value:DragCacheReport)=>void=()=>{}){this.root=resolve(root);}
 private directory(id:string){
  if(!uuid.test(id))throw Error('拖出任务编号无效');
  const target=resolve(this.root,`drag-${id}`),part=relative(this.root,target);
  if(!part||part.startsWith('..')||isAbsolute(part))throw Error('拖出暂存路径无效');
  return target;
 }
 private async checkRoot(){const info=await lstat(this.root);if(!info.isDirectory()||info.isSymbolicLink())throw Error('拖出缓存目录不是普通目录');}
 async create(id:string):Promise<DragCacheJob>{
  await mkdir(this.root,{recursive:true});await this.checkRoot();
  const directory=this.directory(id);let created=false;
  try{
   await mkdir(directory);created=true;
   await writeFile(join(directory,marker),JSON.stringify({kind:'one-archive-drag',version:1,id,created:Date.now()}),{flag:'wx'});
   await writeFile(join(directory,lease),signature,{flag:'wx'});
   return {directory,payload:join(directory,'payload'),lease:join(directory,lease)};
  }catch(error){if(created)await rm(directory,{recursive:true,force:true});throw error;}
 }
 private async metadata(id:string){
  const directory=this.directory(id),info=await lstat(directory);
  if(!info.isDirectory()||info.isSymbolicLink())return;
  const file=join(directory,marker),details=await lstat(file);
  if(!details.isFile()||details.isSymbolicLink()||details.size>4096)return;
  const value=JSON.parse(await readFile(file,'utf8')) as Record<string,unknown>;
  if(value.kind!=='one-archive-drag'||value.version!==1||value.id!==id||typeof value.created!=='number'||!Number.isSafeInteger(value.created)||value.created<=0)return;
  return {directory,created:value.created};
 }
 private async claim(directory:string){
  const check=async(file:string)=>{const info=await lstat(file);return info.isFile()&&!info.isSymbolicLink()&&info.size===Buffer.byteLength(signature)&&await readFile(file,'utf8')===signature;};
  const lock=join(directory,lease),target=join(directory,claimed);
  try{
   // A previous cleanup may have claimed the lease before a crash. The native
   // helper only opens lease.lock, so lease.claimed is never a live lease.
   if(await check(target)){try{await lstat(lock);return false;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return true;throw error;}}
   return false;
  }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  if(!await check(lock))return false;
  try{await rename(lock,target);return true;}
  catch(error){if(['EACCES','EPERM','EBUSY','ENOENT'].includes((error as NodeJS.ErrnoException).code??''))return false;throw error;}
 }
 async release(id:string):Promise<boolean>{
  const info=await this.metadata(id).catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;});
  if(!info)return false;
  if(!await this.claim(info.directory))return false;
  await rm(info.directory,{recursive:true,force:true});return true;
 }
 async sweep(now=Date.now()):Promise<DragCacheReport>{
  const result:DragCacheReport={removed:0,busy:0,failures:[]};
  try{
   await this.checkRoot();
   for(const entry of await readdir(this.root,{withFileTypes:true})){
    const id=entry.name.startsWith('drag-')?entry.name.slice(5):'';
    if(!uuid.test(id)||!entry.isDirectory()||entry.isSymbolicLink())continue;
    try{
     const info=await this.metadata(id);if(!info||now-info.created<ttl)continue;
     if(await this.claim(info.directory)){await rm(info.directory,{recursive:true,force:true});result.removed++;}else result.busy++;
    }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')result.failures.push(`${entry.name}: ${error instanceof Error?error.message:String(error)}`);}
   }
  }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')result.failures.push(error instanceof Error?error.message:String(error));}
  if(result.removed||result.failures.length)this.report(result);
  return result;
 }
 async removeEmptyRoot(){try{await rmdir(this.root);}catch(error){if(!['ENOENT','ENOTEMPTY','EEXIST'].includes((error as NodeJS.ErrnoException).code??''))throw error;}}
}
