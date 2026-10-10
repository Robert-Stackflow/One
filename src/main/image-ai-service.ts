import {Worker} from 'node:worker_threads';
import {session} from 'electron';
import {randomUUID} from 'node:crypto';
import {join,basename,extname,resolve} from 'node:path';
import {rm,stat} from 'node:fs/promises';
import {ensureAiModel,validAiModel,backgroundModel,superResolutionModel} from './image-ai-model';
import type {ImageAiProgress,ImageAiResult} from '../shared/image-ai';

interface Task {owner:number;abort:AbortController;worker?:Worker;promise?:Promise<ImageAiResult>}

export class ImageAiService {
 private active?:Task;
 constructor(private readonly dataDir:string){}
 get pendingTasks(){return !!this.active;}
 modelReady(){return validAiModel(this.dataDir);}
 superResolutionReady(){return validAiModel(this.dataDir,superResolutionModel);}
 start(owner:number,sourceValue:unknown,directoryValue:unknown,notify:(value:ImageAiProgress)=>void){return this.run('background',owner,sourceValue,directoryValue,notify);}
 startSuperResolution(owner:number,sourceValue:unknown,directoryValue:unknown,notify:(value:ImageAiProgress)=>void){return this.run('superres',owner,sourceValue,directoryValue,notify);}
 private async run(kind:'background'|'superres',owner:number,sourceValue:unknown,directoryValue:unknown,notify:(value:ImageAiProgress)=>void):Promise<ImageAiResult>{
  if(this.active)throw Error('已有 AI 图片任务正在进行');
  if(typeof sourceValue!=='string'||!sourceValue||sourceValue.length>32768||sourceValue.includes('\0'))throw Error('图片路径无效');
  if(typeof directoryValue!=='string'||!directoryValue||directoryValue.length>32768||directoryValue.includes('\0'))throw Error('输出目录无效');
  const source=resolve(sourceValue),directory=resolve(directoryValue);
  const id=randomUUID(),stem=basename(source,extname(source)).slice(0,90)||'image',suffix=kind==='background'?'no-background':'superres-4x',output=join(directory,`${stem}-${suffix}-${id.slice(0,8)}.png`),temporary=join(directory,`.one-image-ai-${id}.tmp.png`);
  const task:Task={owner,abort:new AbortController()};this.active=task;
  const run=(async()=>{
   try{
    const [input,outputDir]=await Promise.all([stat(source).catch(()=>null),stat(directory).catch(()=>null)]);
    if(!input?.isFile()||!outputDir?.isDirectory())throw Error('图片或输出目录不存在');
    if(task.abort.signal.aborted)throw Error('已取消 AI 图片任务');
    notify({phase:'download',message:'检查本地模型'});
    const descriptor=kind==='background'?backgroundModel:superResolutionModel;
    // The default session blocks all HTTP(S); this in-memory session is used only for pinned model downloads.
    const model=await ensureAiModel(this.dataDir,task.abort.signal,(received,total)=>notify({phase:'download',received,total,message:kind==='background'?'下载去背景模型':'下载超分模型'}),descriptor,25_000,(url,options)=>session.fromPartition('one-model-download',{cache:false}).fetch(url,options));
    if(task.abort.signal.aborted)throw Error('已取消 AI 图片任务');
    notify({phase:'process',message:kind==='background'?'正在本地去除背景':'正在本地超分'});
    const worker=new Worker(join(__dirname,kind==='background'?'image-ai-worker.cjs':'image-superres-worker.cjs'),{workerData:{source,output,temporary,model},resourceLimits:{maxOldGenerationSizeMb:192}});task.worker=worker;
    return await new Promise<ImageAiResult>((resolveResult,rejectResult)=>{
     let completed=false;
     worker.on('message',(message:{type:string;result?:ImageAiResult;progress?:ImageAiProgress;message?:string})=>{if(message.type==='result'&&message.result){completed=true;resolveResult(message.result);}else if(message.type==='progress'&&message.progress){notify(message.progress);}else if(message.type==='error'){completed=true;rejectResult(Error(message.message||'AI 图片处理失败'));}});
     worker.on('error',error=>{completed=true;rejectResult(error);});
     worker.on('exit',code=>{if(!completed)rejectResult(Error(task.abort.signal.aborted?'已取消 AI 图片任务':`AI 图片处理进程退出（${code}）`));});
    });
   }finally{await rm(temporary,{force:true}).catch(()=>{});if(this.active===task)this.active=undefined;}
  })();task.promise=run;return run;
 }
 cancel(owner:number){const task=this.active;if(!task||task.owner!==owner)return false;task.abort.abort();task.worker?.postMessage({type:'cancel'});return true;}
 async stopAll(){const task=this.active;if(!task)return;this.cancel(task.owner);await task.promise?.catch(()=>{});}
 get modelBytes(){return backgroundModel.bytes;}
 get superResolutionBytes(){return superResolutionModel.bytes;}
}
