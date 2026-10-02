import {app} from 'electron';
import {stat} from 'node:fs/promises';
import {parse,resolve,extname} from 'node:path';
import {folderImage,programImage} from './open-with';
import {programImagePath} from './program-path';

let folder:Promise<string>|undefined;
/** Electron's Windows directory lookup can return the containing drive icon. */
export async function shellFileImage(path:string) {
 if(process.platform==='win32'){
  path=await programImagePath(path);
  if(extname(path).toLowerCase()==='.exe'){const image=await programImage(path).catch(()=>'');if(image)return image;}
  const absolute=resolve(path);
  // Keep real drive icons; ordinary directories share the native folder image.
  if(absolute!==parse(absolute).root&&(await stat(absolute).catch(()=>undefined))?.isDirectory()){
   return folder ||= folderImage().catch(()=>{folder=undefined;return '';});
  }
 }
 const image=await app.getFileIcon(path,{size:'normal'});
 return image.isEmpty()?'':image.toDataURL();
}
