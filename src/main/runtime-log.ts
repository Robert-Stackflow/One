import {appendFile,mkdir,rename,stat} from 'node:fs/promises';
import {join} from 'node:path';

let pending=Promise.resolve();
export function runtimeLog(profile:string,event:string,detail=''){
 pending=pending.catch(()=>{}).then(async()=>{
  const folder=join(profile,'logs'),file=join(folder,'main.log');
  await mkdir(folder,{recursive:true});
  const size=(await stat(file).catch(()=>null))?.size??0;
  if(size>1024*1024)await rename(file,join(folder,'main.previous.log')).catch(()=>{});
  const line=`${new Date().toISOString()} pid=${process.pid} ${event}${detail?' '+detail.replace(/[\r\n]+/g,' ').slice(0,1000):''}\n`;
  await appendFile(file,line,'utf8');
 }).catch(()=>{});
}
