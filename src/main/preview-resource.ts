import {realpath,stat} from 'node:fs/promises';
import {dirname,resolve,relative,isAbsolute,parse} from 'node:path';

function inside(root:string,path:string){const rel=relative(root,path);return rel!==''&&!rel.startsWith('..')&&!isAbsolute(rel);}

export async function previewResourcePath(documentPath:string,value:string){
  if(value.length>4096||/^[a-z][a-z\d+.-]*:/i.test(value)||value.startsWith('\\'))return null;
  let decoded:string;try{decoded=decodeURIComponent(value.split(/[?#]/,1)[0]);}catch{return null;}
  const folder=await realpath(dirname(documentPath));
  if(!decoded.startsWith('/')){
    const target=await realpath(resolve(folder,decoded)).catch(()=>null);
    return target&&inside(folder,target)?target:null;
  }
  if(decoded.startsWith('//'))return null;
  const asset=decoded.slice(1);
  let ancestor=folder;
  for(let depth=0;depth<12;depth++){
    for(const directory of ['public','static']){
      const base=resolve(ancestor,directory),target=resolve(base,asset);
      if(!inside(base,target))continue;
      const actual=await realpath(target).catch(()=>null),actualBase=await realpath(base).catch(()=>null);
      if(actual&&actualBase&&inside(actualBase,actual)&&(await stat(actual)).isFile())return actual;
    }
    if(ancestor===parse(ancestor).root)break;
    ancestor=dirname(ancestor);
  }
  return null;
}
