import {createHash,randomUUID} from 'node:crypto';
import {mkdir,open,rename,rm,lstat,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createReadStream} from 'node:fs';
import {LocalModelStore} from './local-model-store';
import {miganModel} from './local-model-catalog';

export interface AiModelDescriptor {id:string;url:string;bytes:number;sha256:string}
export const backgroundModel:AiModelDescriptor={
 id:'u2netp',
 url:'https://huggingface.co/skillsafe-ai/u2netp/resolve/33f0c8b5c2429bcf0cfd62bbf48669eeec80c2a2/u2netp.onnx',
 bytes:4574861,
 sha256:'309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8'
};
export const superResolutionModel:AiModelDescriptor={
 id:'realesr-general-x4v3',
 url:'https://raw.githubusercontent.com/ningtoba/Browsersnip-Upscale/8e7094416ad91ec7477e968d348cd78742e20dc6/public/models/realesr-general-x4v3.onnx',
 bytes:4945202,
 sha256:'4ca39b3a965ecab832861860f046400bdac7727e10f40cc75ab2393104346e08'
};
export const repairModel:AiModelDescriptor={
 id:'migan-pipeline-v2',
 url:'https://huggingface.co/andraniksargsyan/migan/resolve/406830d0fa60666da0071c342ad2fbc8f30c5c64/migan_pipeline_v2.onnx',
 bytes:28079181,
 sha256:'6f1f3530a1a2324b19752018ce756088b07973cda8d7d890034ace5c8a48c40b'
};

export function aiModelPath(dataDir:string,model=backgroundModel){return join(dataDir,'models',`${model.id}-${model.sha256.slice(0,12)}.onnx`);}
const isSharedRepair=(model:AiModelDescriptor)=>model.id===repairModel.id&&model.bytes===repairModel.bytes&&model.sha256===repairModel.sha256&&model.url===repairModel.url;
const repairStore=(dataDir:string,transport:typeof fetch=fetch,idleTimeoutMs=25000)=>new LocalModelStore(join(dataDir,'models','library'),transport,idleTimeoutMs);

export async function validAiModel(dataDir:string,model=backgroundModel):Promise<boolean>{
 if(isSharedRepair(model)&&(await repairStore(dataDir).state(miganModel)).ready)return true;
 const path=aiModelPath(dataDir,model),info=await lstat(path).catch(()=>null);if(!info?.isFile()||info.isSymbolicLink()||info.size!==model.bytes)return false;
 const hash=createHash('sha256');for await(const part of createReadStream(path))hash.update(part);
 return hash.digest('hex')===model.sha256;
}

async function pruneOldModels(dataDir:string,model:AiModelDescriptor){
 const folder=join(dataDir,'models'),current=`${model.id}-${model.sha256.slice(0,12)}.onnx`;
 for(const name of await readdir(folder).catch(()=>[]))if(name!==current&&name.startsWith(`${model.id}-`)&&/^[a-f0-9]{12}\.onnx$/.test(name.slice(model.id.length+1)))await rm(join(folder,name),{force:true}).catch(()=>{});
}

export async function ensureAiModel(dataDir:string,signal:AbortSignal,progress:(received:number,total:number)=>void,model=backgroundModel,idleTimeoutMs=25_000,fetcher:(url:string,options:RequestInit)=>Promise<Response>=fetch):Promise<string>{
 if(isSharedRepair(model)){
  const store=repairStore(dataDir,fetcher as typeof fetch,idleTimeoutMs);
  const folder=await store.install(miganModel,signal,value=>progress(value.received,value.total),{repair:aiModelPath(dataDir,model)});
  return join(folder,miganModel.artifacts[0].name);
 }
 const path=aiModelPath(dataDir,model);if(await validAiModel(dataDir,model)){await pruneOldModels(dataDir,model);return path;}
 await mkdir(join(dataDir,'models'),{recursive:true});
 for(let attempt=0;attempt<2;attempt++){
  if(signal.aborted)throw Error('已取消模型下载');
  const temporary=join(dataDir,'models',`.one-model-${randomUUID()}.tmp`),controller=new AbortController();
  let timedOut=false,timer:NodeJS.Timeout|undefined;
  const resetIdle=()=>{clearTimeout(timer);timer=setTimeout(()=>{timedOut=true;controller.abort();},idleTimeoutMs);};
  const cancel=()=>controller.abort();signal.addEventListener('abort',cancel,{once:true});resetIdle();
  try{
   if(attempt)progress(0,model.bytes);
   const response=await fetcher(model.url,{signal:controller.signal,redirect:'follow'});
   if(!response.ok||!response.body)throw Error(`模型下载失败：HTTP ${response.status}`);
   const length=Number(response.headers.get('content-length'));if(Number.isFinite(length)&&length>model.bytes)throw Error('模型下载大小超过预期');
   const output=await open(temporary,'wx'),hash=createHash('sha256');let received=0;
   try{
    const reader=response.body.getReader();
    for(;;){const {done,value}=await reader.read();if(done)break;if(signal.aborted)throw Error('已取消模型下载');received+=value.length;if(received>model.bytes)throw Error('模型下载大小超过预期');hash.update(value);
     let written=0;while(written<value.length){const part=await output.write(value,written,value.length-written,received-value.length+written);written+=part.bytesWritten;}
     progress(received,model.bytes);resetIdle();
    }
   }finally{await output.close();}
   if(signal.aborted)throw Error('已取消模型下载');
   if(received!==model.bytes||hash.digest('hex')!==model.sha256)throw Error('模型校验失败，下载内容不完整或已变化');
   await rm(path,{force:true});await rename(temporary,path);await pruneOldModels(dataDir,model);return path;
  }catch(error){
   if(signal.aborted)throw Error('已取消模型下载');
   if(attempt===0&&(timedOut||error instanceof TypeError||(error instanceof Error&&error.message.startsWith('net::'))))continue;
   if(timedOut)throw Error('模型下载连接超时，请检查网络后重试');
   if(error instanceof TypeError||(error instanceof Error&&error.message.startsWith('net::')))throw Error('模型下载连接失败，请检查网络后重试');
   throw error;
  }finally{clearTimeout(timer);signal.removeEventListener('abort',cancel);await rm(temporary,{force:true}).catch(()=>{});}
 }
 throw Error('模型下载失败');
}

/** Repair tasks lease their shared bundle so model management cannot delete a running task's weights. */
export async function acquireAiModel(dataDir:string,signal:AbortSignal,progress:(received:number,total:number)=>void,model=backgroundModel,idleTimeoutMs=25_000,fetcher:(url:string,options:RequestInit)=>Promise<Response>=fetch){
 const path=await ensureAiModel(dataDir,signal,progress,model,idleTimeoutMs,fetcher);
 if(!isSharedRepair(model))return {path,release:()=>{}};
 const lease=await repairStore(dataDir).acquire(miganModel);
 return {path:lease.files[0].path,release:lease.release};
}
