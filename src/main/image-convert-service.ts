import {Worker} from 'node:worker_threads';
import {randomUUID} from 'node:crypto';
import {join,basename,extname,resolve} from 'node:path';
import {rm,stat} from 'node:fs/promises';
import {imageConvertOptions,type ImageConvertOptions,type ImageConvertProgress,type ImageConvertResult,type ImageConvertSummary} from '../shared/image-convert';

interface Entry {source:string;output:string;temp:string}
interface Session {worker:Worker;entries:Entry[];results:Map<string,ImageConvertResult>;cancelled:boolean;task?:Promise<ImageConvertSummary>;fatal?:string;current?:string;childPid?:number}

export class ImageConvertService {
 private sessions=new Map<number,Session>();
 get pendingTasks(){return this.sessions.size>0;}
 async start(owner:number,paths:unknown,directory:unknown,settings:unknown,notify:(value:ImageConvertProgress)=>void):Promise<ImageConvertSummary>{
  if(this.sessions.has(owner))throw Error('已有图片转换任务正在进行');
  if(!Array.isArray(paths)||paths.length<1||paths.length>100||paths.some(path=>typeof path!=='string'||!path||path.length>32768||path.includes('\0')))throw Error('每次请选择 1 至 100 张图片');
  if(typeof directory!=='string'||!directory||directory.length>32768||directory.includes('\0'))throw Error('输出目录无效');
  const outputDir=resolve(directory),info=await stat(outputDir).catch(()=>null);if(!info?.isDirectory())throw Error('输出目录不存在');
  const options:ImageConvertOptions=imageConvertOptions(settings),unique=[...new Set((paths as string[]).map(path=>resolve(path).toLowerCase()))];
  if(unique.length!==paths.length)throw Error('图片列表含重复路径');
  const entries:Entry[]=(paths as string[]).map(path=>{const source=resolve(path),name=basename(source,extname(source)).slice(0,90)||'image',id=randomUUID();const sourceExtension=extname(source).slice(1).toLowerCase();if(options.format==='original'&&!['png','jpg','jpeg','webp','gif','tif','tiff'].includes(sourceExtension))throw Error('保持原格式仅支持 PNG、JPEG、WebP、GIF 和 TIFF');const extension=options.format==='original'?sourceExtension:options.format==='jpeg'?'jpg':options.format==='tiff'?'tiff':options.format;const suffix=options.crop?'cropped':options.resize?'resized':options.format==='original'?'compressed':'converted';return {source,output:join(outputDir,`${name}-${suffix}-${id.slice(0,8)}.${extension}`),temp:join(outputDir,`.one-image-${id}.tmp.${extension}`)};});
  const worker=new Worker(join(__dirname,'image-convert-worker.cjs'),{workerData:{entries,options},resourceLimits:{maxOldGenerationSizeMb:256}});
  const session:Session={worker,entries,results:new Map(),cancelled:false};this.sessions.set(owner,session);
  const task=new Promise<ImageConvertSummary>(resolve=>{
   worker.on('message',(message:{type:string;source?:string;result?:ImageConvertResult;message?:string;pid?:number})=>{
    if(message.type==='child'&&typeof message.pid==='number'&&Number.isInteger(message.pid)&&message.pid>0){session.childPid=message.pid;return;}
    if(message.type==='childDone'){session.childPid=undefined;return;}
    if(message.type==='current'){session.current=message.source;notify({done:session.results.size,total:entries.length,current:message.source});}
    else if(message.type==='result'&&message.result){session.results.set(message.result.source,message.result);notify({done:session.results.size,total:entries.length,result:message.result});}
    else if(message.type==='fatal'){session.fatal=message.message||'图片处理进程异常';void worker.terminate();}
   });
   worker.on('error',error=>{session.fatal=error.message.slice(0,300);});
   worker.on('exit',()=>{void(async()=>{
    if(session.childPid)try{process.kill(session.childPid);}catch{}
    for(const entry of entries){await rm(entry.temp,{force:true}).catch(()=>{});await rm(entry.temp+'.decoded.png',{force:true}).catch(()=>{});}
    this.sessions.delete(owner);
    const results=entries.map(entry=>session.results.get(entry.source)||{source:entry.source,before:0,status:session.cancelled?'cancelled':'error',message:session.cancelled?'已取消':session.fatal||'图片处理未完成'} as ImageConvertResult);
    resolve({results,cancelled:session.cancelled});
   })();});
  });
  session.task=task;return task;
 }
 cancel(owner:number){const session=this.sessions.get(owner);if(!session)return false;session.cancelled=true;if(session.childPid)try{process.kill(session.childPid);}catch{}void session.worker.terminate();return true;}
 async stopAll(){const tasks=[...this.sessions.values()].map(session=>session.task).filter((task):task is Promise<ImageConvertSummary>=>!!task);for(const owner of this.sessions.keys())this.cancel(owner);await Promise.all(tasks);}
}
