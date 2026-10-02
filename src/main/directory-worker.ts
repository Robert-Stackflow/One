import {parentPort} from 'node:worker_threads';
import {opendir,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DirectoryIndex,type DirectoryName} from '../shared/directory';
const snapshots=new Map<string,{id:string;index:DirectoryIndex;references:number;stamp:number}>(),byPath=new Map<string,string>(),opening=new Map<string,Promise<string>>();
async function open(path:string){
 const key=resolve(path).toLocaleLowerCase(),stamp=(await stat(path)).mtimeMs,existing=byPath.get(key);if(existing&&snapshots.get(existing)?.stamp===stamp)return existing;
 let pending=opening.get(key);if(!pending){pending=(async()=>{const names:DirectoryName[]=[],directory=await opendir(path);for await(const entry of directory)if(!entry.isSymbolicLink())names.push({name:entry.name,directory:entry.isDirectory()});const id=randomUUID();snapshots.set(id,{id,index:new DirectoryIndex(path,names),references:0,stamp});byPath.set(key,id);return id;})();opening.set(key,pending);pending.finally(()=>opening.delete(key)).catch(()=>{});}return pending;
}
parentPort!.on('message',async request=>{try{
 let result:unknown;
 if(request.action==='open'){const id=await open(request.path),snapshot=snapshots.get(id)!;snapshot.references++;result={id,path:snapshot.index.path,count:snapshot.index.count,position:request.target?snapshot.index.find(request.target):-1};}
 else {const snapshot=snapshots.get(request.id);if(!snapshot)throw new Error('目录已关闭，请重新加载');
  if(request.action==='page')result=snapshot.index.page(request.offset,request.limit,request.query);
  else if(request.action==='release'){if(--snapshot.references===0){snapshots.delete(request.id);const key=resolve(snapshot.index.path).toLocaleLowerCase();if(byPath.get(key)===request.id)byPath.delete(key);}result=true;}
  else throw new Error('目录操作无效');
 }
 parentPort!.postMessage({requestId:request.requestId,result});
 }catch(error){parentPort!.postMessage({requestId:request.requestId,error:(error as Error).message});}});
