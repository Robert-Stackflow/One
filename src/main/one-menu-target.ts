import {stat} from 'node:fs/promises';
import {isAbsolute,resolve} from 'node:path';
import type {MenuBuiltin,OneMenuTarget} from '../shared/menu-builtins';
import type {SearchContext} from '../shared/search';

// Explorer virtual locations and deleted paths should still open the normal page.
async function existingPath(value:string|undefined,directory=false):Promise<string|undefined>{
 if(!value||value.length>32768||/[\0\r\n]/.test(value)||!isAbsolute(value))return;
 const path=resolve(value),info=await stat(path).catch(()=>undefined);
 if(info&&(directory?info.isDirectory():info.isFile()||info.isDirectory()))return path;
}
export async function oneMenuTarget(command:MenuBuiltin,context:SearchContext):Promise<OneMenuTarget|undefined>{
 const page=command.onePage;if(!page)return;
 if(command.oneContext==='folder'&&(page==='disk'||page==='tools')){
  const folder=await existingPath(context.currentFolder,true);return {page,...(folder?{folder}:{})};
 }
 if(command.oneContext==='paths'&&page==='locksmith'){
  const seen=new Set<string>(),selected=(context.selected||[]).filter(path=>{const key=resolve(path).toLowerCase();if(seen.has(key))return false;seen.add(key);return true;});
  if(selected.length>32)throw new Error('一次最多检查 32 个目标');
  const paths=(await Promise.all(selected.map(path=>existingPath(path)))).filter((path):path is string=>!!path);
  if(!paths.length){const folder=await existingPath(context.currentFolder,true);if(folder)paths.push(folder);}
  return {page,...(paths.length?{paths}:{})};
 }
 return {page};
}
