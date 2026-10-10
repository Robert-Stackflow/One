import {lstat,rename} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';

const waits=[50,100,200,400,500,500];
const busyCodes=new Set(['EPERM','EACCES','EBUSY']);

/** Briefly tolerate Windows sharing locks after extraction, without replacing a target. */
export async function renameArchiveDirectory(source:string,target:string):Promise<void>{
  for(let attempt=0;;attempt++){
    const occupied=await lstat(target).then(()=>true,error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;});
    if(occupied)throw Object.assign(new Error('解压目标已被其他操作占用，请重新解压'),{code:'EEXIST'});
    try{await rename(source,target);return;}
    catch(error){
      if(process.platform!=='win32'||!busyCodes.has((error as NodeJS.ErrnoException).code??'')||attempt===waits.length)throw error;
      await delay(waits[attempt]);
    }
  }
}
