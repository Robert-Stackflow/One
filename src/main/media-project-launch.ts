import {extname,resolve} from 'node:path';
import {IMAGE_PROJECT_FORMAT,RECORDING_PROJECT_FORMAT} from '../shared/media-project';

export function mediaProjectKind(file:string):'image'|'recording'|undefined{
  const extension=extname(file).toLowerCase();
  if(extension===IMAGE_PROJECT_FORMAT.extension)return 'image';
  if(extension===RECORDING_PROJECT_FORMAT.extension)return 'recording';
}

/** File arguments only; One's internal resource URLs are never external launch commands. */
export function mediaProjectLaunchPaths(args:readonly string[],directory=process.cwd()):string[]{
  const paths:string[]=[],seen=new Set<string>();
  for(const argument of args){
    const explicit=argument.startsWith('--one-project=');
    let file=explicit?argument.slice('--one-project='.length):argument;
    if(!explicit&&file.startsWith('-'))continue;
    if(file.startsWith('"')&&file.endsWith('"'))file=file.slice(1,-1);
    if(!file||/^[a-z][a-z\d+.-]*:\/\//i.test(file)||/^file:/i.test(file)||!mediaProjectKind(file))continue;
    const path=resolve(directory,file),key=process.platform==='win32'?path.toLowerCase():path;
    if(!seen.has(key)){seen.add(key);paths.push(path);}
  }
  return paths;
}
