import {createHash,randomUUID} from 'node:crypto';
import {mkdir,open,rename,rm,stat,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createReadStream} from 'node:fs';

export interface AiModelDescriptor {id:string;url:string;bytes:number;sha256:string}
export const backgroundModel:AiModelDescriptor={
 id:'u2netp',
 url:'https://huggingface.co/skillsafe-ai/u2netp/resolve/33f0c8b5c2429bcf0cfd62bbf48669eeec80c2a2/u2netp.onnx',
 bytes:4574861,
 sha256:'309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8'
};

export function aiModelPath(dataDir:string,model=backgroundModel){return join(dataDir,'models',`${model.id}-${model.sha256.slice(0,12)}.onnx`);}

export async function validAiModel(dataDir:string,model=backgroundModel):Promise<boolean>{
 const path=aiModelPath(dataDir,model),info=await stat(path).catch(()=>null);if(!info?.isFile()||info.size!==model.bytes)return false;
 const hash=createHash('sha256');for await(const part of createReadStream(path))hash.update(part);
 return hash.digest('hex')===model.sha256;
}

async function pruneOldModels(dataDir:string,model:AiModelDescriptor){
 const folder=join(dataDir,'models'),current=`${model.id}-${model.sha256.slice(0,12)}.onnx`;
 for(const name of await readdir(folder).catch(()=>[]))if(name!==current&&name.startsWith(`${model.id}-`)&&/^[a-f0-9]{12}\.onnx$/.test(name.slice(model.id.length+1)))await rm(join(folder,name),{force:true}).catch(()=>{});
}

export async function ensureAiModel(dataDir:string,signal:AbortSignal,progress:(received:number,total:number)=>void,model=backgroundModel):Promise<string>{
 const path=aiModelPath(dataDir,model);if(await validAiModel(dataDir,model)){await pruneOldModels(dataDir,model);return path;}
 await mkdir(join(dataDir,'models'),{recursive:true});
 const temporary=join(dataDir,'models',`.one-model-${randomUUID()}.tmp`);
 try{
  const response=await fetch(model.url,{signal,redirect:'follow'});
  if(!response.ok||!response.body)throw Error(`模型下载失败：HTTP ${response.status}`);
  const length=Number(response.headers.get('content-length'));if(Number.isFinite(length)&&length>model.bytes)throw Error('模型下载大小超过预期');
  const output=await open(temporary,'wx'),hash=createHash('sha256');let received=0;
  try{
   const reader=response.body.getReader();
   for(;;){const {done,value}=await reader.read();if(done)break;if(signal.aborted)throw Error('已取消模型下载');received+=value.length;if(received>model.bytes)throw Error('模型下载大小超过预期');hash.update(value);
    let written=0;while(written<value.length){const part=await output.write(value,written,value.length-written,received-value.length+written);written+=part.bytesWritten;}
    progress(received,model.bytes);
   }
  }finally{await output.close();}
  if(signal.aborted)throw Error('已取消模型下载');
  if(received!==model.bytes||hash.digest('hex')!==model.sha256)throw Error('模型校验失败，下载内容不完整或已变化');
  await rm(path,{force:true});await rename(temporary,path);await pruneOldModels(dataDir,model);return path;
 }finally{await rm(temporary,{force:true}).catch(()=>{});}
}
