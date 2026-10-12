import {lstat,opendir} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';

/** Sum regular source files without following directory links. Runs outside the renderer. */
export async function archiveSourceSize(source:string):Promise<number|null>{
 if(typeof source!=='string'||!isAbsolute(source)||source.length>32767||/[\x00\r\n]/.test(source))throw Error('来源路径无效');
 try{
  const root=await lstat(source);
  if(root.isFile())return root.size;
  if(!root.isDirectory())return null;
  let total=0;
  const pending=[source];
  while(pending.length){
   const folder=pending.pop()!;
   const handle=await opendir(folder);
   for await(const entry of handle){
    if(entry.isSymbolicLink())continue;
    const path=join(folder,entry.name);
    if(entry.isDirectory())pending.push(path);
    else if(entry.isFile())total+=(await lstat(path)).size;
    if(!Number.isSafeInteger(total))return null;
   }
  }
  return total;
 }catch{return null;}
}
