import {Worker} from 'node:worker_threads';
import {session} from 'electron';
import {randomUUID} from 'node:crypto';
import {join,basename,extname,resolve} from 'node:path';
import {rm,stat} from 'node:fs/promises';
import {ensureAiModel,validAiModel,backgroundModel,superResolutionModel,repairModel} from './image-ai-model';
import type {ImageAiProgress,ImageAiResult,ImageRepairMode} from '../shared/image-ai';

interface Task {owner:number;abort:AbortController;worker?:Worker;promise?:Promise<ImageAiResult>;cancelFlag?:Int32Array}

export class ImageAiService {
 private active?:Task;
 constructor(private readonly dataDir:string){}
 get pendingTasks(){return !!this.active;}
 modelReady(){return validAiModel(this.dataDir);}
 superResolutionReady(){return validAiModel(this.dataDir,superResolutionModel);}
 repairReady(){return validAiModel(this.dataDir,repairModel);}
 start(owner:number,sourceValue:unknown,directoryValue:unknown,notify:(value:ImageAiProgress)=>void){return this.run('background',owner,sourceValue,directoryValue,notify);}
 startSuperResolution(owner:number,sourceValue:unknown,directoryValue:unknown,notify:(value:ImageAiProgress)=>void){return this.run('superres',owner,sourceValue,directoryValue,notify);}
 startRepair(owner:number,sourceValue:unknown,directoryValue:unknown,maskValue:unknown,modeValue:unknown,notify:(value:ImageAiProgress)=>void){return this.run('repair',owner,sourceValue,directoryValue,notify,maskValue,modeValue);}
 private async run(kind:'background'|'superres'|'repair',owner:number,sourceValue:unknown,directoryValue:unknown,notify:(value:ImageAiProgress)=>void,maskValue?:unknown,modeValue?:unknown):Promise<ImageAiResult>{
  if(this.active)throw Error('已有 AI 图片任务正在进行');
  if(typeof sourceValue!=='string'||!sourceValue||sourceValue.length>32768||sourceValue.includes('\0'))throw Error('图片路径无效');
  if(typeof directoryValue!=='string'||!directoryValue||directoryValue.length>32768||directoryValue.includes('\0'))throw Error('输出目录无效');
  if(kind==='repair'&&(typeof maskValue!=='string'||maskValue.length>2_000_000||!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(maskValue)))throw Error('修复选区无效');
  if(kind==='repair'&&modeValue!==undefined&&modeValue!=='damage'&&modeValue!=='remove')throw Error('修复类型无效');
  const repairMode:ImageRepairMode=modeValue==='remove'?'remove':'damage';
  const source=resolve(sourceValue),directory=resolve(directoryValue);
  const id=randomUUID(),stem=basename(source,extname(source)).slice(0,90)||'image',suffix=kind==='background'?'no-background':kind==='superres'?'superres-4x':repairMode==='remove'?'object-removed':'repaired',output=join(directory,`${stem}-${suffix}-${id.slice(0,8)}.png`),temporary=join(directory,`.one-image-ai-${id}.tmp.png`);
  const task:Task={owner,abort:new AbortController()};this.active=task;
  const run=(async()=>{
   try{
    const [input,outputDir]=await Promise.all([stat(source).catch(()=>null),stat(directory).catch(()=>null)]);
    if(!input?.isFile()||!outputDir?.isDirectory())throw Error('图片或输出目录不存在');
    if(task.abort.signal.aborted)throw Error('已取消 AI 图片任务');
    notify({phase:'download',message:'检查本地模型'});
    const descriptor=kind==='background'?backgroundModel:kind==='superres'?superResolutionModel:repairModel;
    // The default session blocks all HTTP(S); this in-memory session is used only for pinned model downloads.
    const model=await ensureAiModel(this.dataDir,task.abort.signal,(received,total)=>notify({phase:'download',received,total,message:kind==='background'?'下载去背景模型':kind==='superres'?'下载超分模型':'下载修复模型'}),descriptor,25_000,(url,options)=>session.fromPartition('one-model-download',{cache:false}).fetch(url,options));
    if(task.abort.signal.aborted)throw Error('已取消 AI 图片任务');
    notify({phase:'process',message:kind==='background'?'正在本地去除背景':kind==='superres'?'正在本地超分':repairMode==='remove'?'正在本地移除物体':'正在本地修复选区'});
    const cancelFlag=kind==='repair'?new Int32Array(new SharedArrayBuffer(4)):undefined;task.cancelFlag=cancelFlag;
    const worker=new Worker(join(__dirname,kind==='background'?'image-ai-worker.cjs':kind==='superres'?'image-superres-worker.cjs':'image-repair-worker.cjs'),{workerData:{source,output,temporary,model,mask:maskValue,mode:repairMode,cancelBuffer:cancelFlag?.buffer},resourceLimits:{maxOldGenerationSizeMb:256}});task.worker=worker;
    return await new Promise<ImageAiResult>((resolveResult,rejectResult)=>{
     let completed=false;
     worker.on('message',(message:{type:string;result?:ImageAiResult;progress?:ImageAiProgress;message?:string})=>{if(message.type==='result'&&message.result){completed=true;resolveResult(message.result);}else if(message.type==='progress'&&message.progress){notify(message.progress);}else if(message.type==='error'){completed=true;rejectResult(Error(message.message||'AI 图片处理失败'));}});
     worker.on('error',error=>{completed=true;rejectResult(error);});
     worker.on('exit',code=>{if(!completed)rejectResult(Error(task.abort.signal.aborted?'已取消 AI 图片任务':`AI 图片处理进程退出（${code}）`));});
    });
   }finally{await rm(temporary,{force:true}).catch(()=>{});if(this.active===task)this.active=undefined;}
  })();task.promise=run;return run;
 }
 cancel(owner:number){const task=this.active;if(!task||task.owner!==owner)return false;task.abort.abort();if(task.cancelFlag)Atomics.store(task.cancelFlag,0,1);task.worker?.postMessage({type:'cancel'});return true;}
 async stopAll(){const task=this.active;if(!task)return;this.cancel(task.owner);await task.promise?.catch(()=>{});}
 get modelBytes(){return backgroundModel.bytes;}
 get superResolutionBytes(){return superResolutionModel.bytes;}
 get repairBytes(){return repairModel.bytes;}
}
