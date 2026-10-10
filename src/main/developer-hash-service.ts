import {createHash,timingSafeEqual} from 'node:crypto';
import {isAbsolute,resolve} from 'node:path';
import {stamp,hashFile} from './file-tool-fs';
import type {HashAlgorithm,HashRequest,HashResult,HashProgress} from '../shared/developer-hash';

const lengths:Record<HashAlgorithm,number>={md5:32,sha1:40,sha256:64,sha512:128};
interface Session {cancelled:boolean;task?:Promise<HashResult>}

export class DeveloperHashService{
 private sessions=new Map<number,Session>();
 get pendingTasks(){return this.sessions.size>0;}
 async start(owner:number,value:unknown,notify:(progress:HashProgress)=>void):Promise<HashResult>{
  if(this.sessions.has(owner))throw Error('已有哈希任务正在进行');
  if(!value||typeof value!=='object')throw Error('哈希设置无效');const request=value as HashRequest;
  if(!Object.hasOwn(lengths,request.algorithm)||!['text','file'].includes(request.kind))throw Error('哈希算法或来源无效');
  const expected=typeof request.expected==='string'?request.expected.replace(/\s+/g,'').toLowerCase():undefined;if(request.expected!==undefined&&(!expected||!new RegExp(`^[0-9a-f]{${lengths[request.algorithm]}}$`).test(expected)))throw Error('校验值长度或十六进制格式无效');
  if(request.kind==='text'&&typeof request.text!=='string'||request.kind==='file'&&(typeof request.path!=='string'||!isAbsolute(request.path)||request.path.length>32768||request.path.includes('\0')))throw Error('哈希输入无效');
  const session:Session={cancelled:false};this.sessions.set(owner,session);
  const task=(async()=>{
   let digest:string,bytes:number;
   if(request.kind==='text'){const data=Buffer.from(request.text,'utf8');if(data.length>2*1024*1024)throw Error('文本不能超过 2 MB');bytes=data.length;digest=createHash(request.algorithm).update(data).digest('hex');notify({processed:bytes,total:bytes});}
   else {const file=await stamp(resolve(request.path));if(file.directory)throw Error('请选择普通文件');bytes=file.size;let last=0;digest=await hashFile(file,false,processed=>{if(session.cancelled)throw Error('已取消');const now=Date.now();if(now-last>=100||processed===bytes){last=now;notify({processed,total:bytes});}},request.algorithm);}
   if(session.cancelled)throw Error('已取消');const match=expected===undefined?undefined:timingSafeEqual(Buffer.from(digest,'hex'),Buffer.from(expected,'hex'));
   return {algorithm:request.algorithm,digest,bytes,match};
  })().finally(()=>this.sessions.delete(owner));session.task=task;return task;
 }
 cancel(owner:number){const session=this.sessions.get(owner);if(!session)return false;session.cancelled=true;return true;}
 async stopAll(){const tasks=[...this.sessions.values()].map(session=>session.task).filter((task):task is Promise<HashResult>=>!!task);for(const owner of this.sessions.keys())this.cancel(owner);await Promise.allSettled(tasks);}
}
