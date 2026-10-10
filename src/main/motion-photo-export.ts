import {createReadStream,createWriteStream} from 'node:fs';
import {realpath,rename,rm,stat} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {dirname,join,resolve} from 'node:path';
import {pipeline} from 'node:stream/promises';
import type {MotionPhotoSource} from './motion-photo';

/** Copy only the validated movie slice, then publish the complete video. */
export async function exportMotionPhotoVideo(motion:MotionPhotoSource,target:string,signal:AbortSignal):Promise<number>{
 const source=await realpath(motion.path),destination=resolve(target),existing=await realpath(destination).catch(()=>null);
 if(existing?.toLowerCase()===source.toLowerCase())throw Error('不能覆盖原始动态照片或配对视频');
 const before=await stat(source);
 if(existing){const targetInfo=await stat(existing);if(before.ino&&before.ino===targetInfo.ino&&before.dev===targetInfo.dev)throw Error('不能覆盖原始动态照片或配对视频');}
 if(!before.isFile()||!Number.isSafeInteger(motion.offset)||!Number.isSafeInteger(motion.length)||motion.offset<0||motion.length<32||motion.length>512*1024*1024||motion.offset+motion.length>before.size)throw Error('动态视频片段无效或源文件已变化');
 const temporary=join(dirname(destination),`.one-motion-${randomUUID()}.tmp`);
 try{
  await pipeline(createReadStream(source,{start:motion.offset,end:motion.offset+motion.length-1,signal}),createWriteStream(temporary,{flags:'wx'}),{signal});
  const [after,output]=await Promise.all([stat(source),stat(temporary)]);
  if(after.size!==before.size||after.mtimeMs!==before.mtimeMs||output.size!==motion.length)throw Error('动态照片在导出期间发生变化，请重试');
  if(signal.aborted)throw Error('已取消动态视频导出');
  await rename(temporary,destination);
  return output.size;
 }finally{await rm(temporary,{force:true}).catch(()=>{});}
}
