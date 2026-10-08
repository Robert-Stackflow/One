import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {lstat,link,readdir,rename,rm,stat} from 'node:fs/promises';
import {join,dirname,basename,extname,isAbsolute,resolve,relative} from 'node:path';
import {existsSync} from 'node:fs';
import {createReadStream,createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import type {ArchiveRequest,ArchiveListing,ArchiveEntry,ArchiveProgress,ArchiveResult,ArchiveEncoding} from '../shared/archive';

type Message = {type:'meta';total:number;comment:string}|({type:'entry'}&ArchiveEntry)|{type:'progress';done:number;total:number}|{type:'result';count:number}|{type:'error';message:string};
const helper=()=>join(__dirname,'../native/One.Archive.exe').replace('app.asar\\','app.asar.unpacked\\');
const path=(value:unknown)=>{if(typeof value!=='string'||!isAbsolute(value)||value.length>32768||value.includes('\0'))throw Error('路径无效');return resolve(value);};
const encoding=(value:unknown):ArchiveEncoding=>[0,437,932,936,950,65001].includes(Number(value))?Number(value) as ArchiveEncoding:0;
const password=(value:unknown)=>{if(value===undefined)return '';if(typeof value!=='string'||Buffer.byteLength(value,'utf8')>1024)throw Error('密码无效或过长');return value;};
const archiveTarget=(value:unknown)=>{const target=path(value);if(!/\.(?:zip|7z)$/i.test(target))throw Error('创建压缩包请选择 .zip 或 .7z 路径');return target;};
const archiveSource=(value:unknown)=>{const source=path(value);if(!/\.(?:zip|7z|7z\.001|rar|r00)$/i.test(source))throw Error('目前支持 ZIP、7Z 和 RAR 压缩包');return source;};
const archiveName=(source:string)=>basename(source).replace(/\.(?:7z\.001|part\d+\.rar|zip|7z|rar|r00)$/i,'');

export class ArchiveService {
  private active=new Map<string,{child:ChildProcessWithoutNullStreams;owner:number}>();
  private publishing=new Map<string,{controller:AbortController;owner:number}>();
  private pending=new Set<Promise<ArchiveListing|ArchiveResult>>();
  constructor(private changed:(owner:number,progress:ArchiveProgress)=>void){}
  get pendingTasks(){return this.pending.size;}
  cancel(id:string,owner:number){const task=this.active.get(id);if(task&&task.owner===owner){task.child.kill();return true;}const publishing=this.publishing.get(id);if(publishing&&publishing.owner===owner){publishing.controller.abort();return true;}return false;}
  async stop(){for(const task of this.active.values())task.child.kill();for(const task of this.publishing.values())task.controller.abort();await Promise.allSettled([...this.pending]);}
  run(owner:number,request:ArchiveRequest):Promise<ArchiveListing|ArchiveResult>{
    const task=this.perform(owner,request);
    this.pending.add(task);
    void task.finally(()=>this.pending.delete(task)).catch(()=>{});
    return task;
  }
  private async execute(owner:number,id:string,operation:'list'|'create'|'extract'|'test',args:string[],secret:string):Promise<Message[]> {
    return new Promise((done,reject)=>{
      const child=spawn(helper(),[operation,...args],{windowsHide:true,stdio:'pipe'});
      this.active.set(id,{child,owner});
      const data:Message[]=[];let buffered='',error='',failed=false,settled=false;
      const finish=(reason?:Error)=>{if(settled)return;settled=true;this.active.delete(id);if(reason)reject(reason);else done(data);};
      if(operation!=='list')this.changed(owner,{id,operation,done:0,total:0});
      child.stdout.setEncoding('utf8');child.stdout.on('data',(chunk:string)=>{
        buffered+=chunk;
        if(buffered.length>2*1024*1024){child.kill();failed=true;error='压缩程序输出超出限制';return;}
        let end:number;
        while((end=buffered.indexOf('\n'))>=0){const line=buffered.slice(0,end).trim();buffered=buffered.slice(end+1);if(!line)continue;
          try{const message=JSON.parse(line) as Message;
            if(message.type==='progress')this.changed(owner,{id,operation:operation as ArchiveProgress['operation'],done:message.done,total:message.total});
            else if(message.type==='error'){failed=true;error=message.message;}
            else data.push(message);
            if(data.length>505){failed=true;error='压缩程序返回过多数据';child.kill();}
          }catch{failed=true;error='压缩程序返回无效数据';child.kill();}
        }
      });
      child.stderr.on('data',(chunk:Buffer)=>{if(error.length<512)error+=chunk.toString('utf8').slice(0,512);});
      child.on('error',cause=>finish(cause));
      child.on('close',code=>{if(failed||code!==0)finish(new Error(error||'压缩任务已取消或失败'));else finish();});
      const value=Buffer.from(secret,'utf8'),header=Buffer.alloc(4);header.writeUInt32LE(value.length);
      child.stdin.on('error',()=>{});child.stdin.end(Buffer.concat([header,value]));
    });
  }
  private async perform(owner:number,request:ArchiveRequest):Promise<ArchiveListing|ArchiveResult> {
    if(!request||typeof request!=='object')throw Error('压缩请求无效');
    const id=randomUUID();
    if(request.operation==='list'){
      const source=archiveSource(request.path),offset=Math.max(0,Math.min(1000000,Math.floor(Number(request.offset)||0)));
      const messages=await this.execute(owner,id,'list',[source,String(offset),'200',String(encoding(request.encoding))],password(request.password));
      const meta=messages.find((item):item is Extract<Message,{type:'meta'}>=>item.type==='meta');
      if(!meta)throw Error('无法读取压缩包目录');
      return {path:source,total:meta.total,comment:meta.comment,offset,entries:messages.filter((item):item is Extract<Message,{type:'entry'}>=>item.type==='entry').map(({type,...entry})=>entry)};
    }
    if(request.operation==='test'){
      const source=archiveSource(request.path);
      const messages=await this.execute(owner,id,'test',[source,String(encoding(request.encoding))],password(request.password));
      return {path:source,count:(messages.find(item=>item.type==='result') as {count:number}|undefined)?.count||0};
    }
    if(request.operation==='create'){
      const target=archiveTarget(request.path),sources=request.sources;
      const seven=/\.7z$/i.test(target);
      if(!Array.isArray(sources)||!sources.length||sources.length>128)throw Error('请选择 1–128 个文件或文件夹');
      const volumeBytes=request.volumeBytes??0;
      if(!Number.isSafeInteger(volumeBytes)||volumeBytes<0||volumeBytes>64*1024**3||(volumeBytes>0&&volumeBytes<1024**2))
        throw Error('分卷大小须为 1 MB 至 64 GB');
      const checked=await Promise.all(sources.map(async item=>{const source=path(item),info=await lstat(source);if(info.isSymbolicLink()||(!info.isFile()&&!info.isDirectory()))throw Error('不支持压缩链接或特殊文件');if(info.isDirectory()&&!relative(source,target).startsWith('..')&&!isAbsolute(relative(source,target)))throw Error('压缩包不能保存在被压缩的文件夹中');return source;}));
      const names=new Set<string>();
      for(const source of checked){const name=basename(source).toLowerCase();if(names.has(name))throw Error('所选内容包含同名文件或文件夹，请分开压缩');names.add(name);}
      if(existsSync(target)||seven&&volumeBytes>0&&existsSync(target+'.001'))throw Error('目标压缩包已经存在');
      const temporary=join(dirname(target),`.one-archive-${id}.${seven?'7z':'zip'}`);
      const temporaryStem=temporary.slice(0,-4),targetStem=target.slice(0,-4);
      const zipParts=async()=>{
        const prefix=basename(temporaryStem)+'.z';
        return (await readdir(dirname(temporary))).filter(name=>name.startsWith(prefix)&&/^\d{2,}$/.test(name.slice(prefix.length)))
          .sort((a,b)=>Number(a.slice(prefix.length))-Number(b.slice(prefix.length)))
          .map(name=>({temporary:join(dirname(temporary),name),target:targetStem+'.z'+name.slice(prefix.length)}));
      };
      const sevenParts:{temporary:string;target:string}[]=[];
      const controller=new AbortController();
      const published:string[]=[];
      try{
        const messages=await this.execute(owner,id,'create',[temporary,...(!seven&&volumeBytes?[`--volume=${volumeBytes}`]:[]),...checked],password(request.password));
        await this.execute(owner,id,'test',[temporary,'0'],password(request.password));
        const result=messages.find((item):item is Extract<Message,{type:'result'}>=>item.type==='result');
        if(!result)throw Error('压缩程序未确认创建成功');
        if(seven&&volumeBytes){
          this.publishing.set(id,{controller,owner});
          const size=(await stat(temporary)).size;
          const count=Math.ceil(size/volumeBytes);
          if(count<1||count>4096)throw Error('7Z 分卷数量超出支持范围');
          for(let index=0;index<count;index++){
            controller.signal.throwIfAborted();
            const suffix=String(index+1).padStart(3,'0');
            const item={temporary:temporary+'.'+suffix,target:target+'.'+suffix};
            if(existsSync(item.target))throw Error('目标目录中已存在同名分卷');
            sevenParts.push(item);
            await pipeline(createReadStream(temporary,{start:index*volumeBytes,end:Math.min(size-1,(index+1)*volumeBytes-1)}),createWriteStream(item.temporary,{flags:'wx'}),{signal:controller.signal});
            this.changed(owner,{id,operation:'create',done:index+1,total:count});
          }
        }
        const parts=seven?sevenParts:await zipParts();
        controller.signal.throwIfAborted();
        for(const item of parts)if(existsSync(item.target))throw Error('目标目录中已存在同名分卷');
        for(const item of parts){controller.signal.throwIfAborted();await link(item.temporary,item.target);published.push(item.target);}
        controller.signal.throwIfAborted();
        if(!seven||!volumeBytes)await link(temporary,target);
        return {path:seven&&volumeBytes?target+'.001':target,count:result.count};
      }catch(error){await Promise.allSettled(published.map(item=>rm(item,{force:true})));throw error;}
      finally{this.publishing.delete(id);await rm(temporary,{force:true}).catch(()=>{});for(const item of seven?sevenParts:await zipParts().catch(()=>[]))await rm(item.temporary,{force:true}).catch(()=>{});}
    }
    if(request.operation==='extract'){
      const source=archiveSource(request.path),parent=path(request.parent),parentInfo=await stat(parent);
      if(!parentInfo.isDirectory())throw Error('请选择目标文件夹');
      const destination=request.destination??'folder';
      if(destination!=='folder'&&destination!=='smart')throw Error('解压位置模式无效');
      const selected=request.selected||[];
      if(!Array.isArray(selected)||selected.length>10000||selected.some(value=>!Number.isSafeInteger(value)||value<0))throw Error('选择的条目无效');
      const uniqueTarget=(name:string,file=false)=>{const extension=file?extname(name):'',base=extension?name.slice(0,-extension.length):name;let target=join(parent,name),suffix=2;while(existsSync(target)){target=join(parent,`${base} (${suffix++})${extension}`);if(suffix>10000)throw Error('没有可用的解压目标名称');}return target;};
      const temporary=join(parent,`.one-extract-${id}`);
      try{
        const messages=await this.execute(owner,id,'extract',[source,temporary,selected.join(','),String(encoding(request.encoding))],password(request.password));
        const result=messages.find((item):item is Extract<Message,{type:'result'}>=>item.type==='result');
        if(!result)throw Error('压缩程序未确认解压成功');
        const top=destination==='smart'?await readdir(temporary):[];
        let target:string;
        if(top.length===1){
          const extracted=join(temporary,top[0]),info=await lstat(extracted);
          if(!info.isFile()&&!info.isDirectory())throw Error('压缩包包含无法安全提交的条目');
          target=uniqueTarget(top[0],info.isFile());
          if(info.isFile())await link(extracted,target);else await rename(extracted,target);
        }else{
          target=uniqueTarget(archiveName(source));
          await rename(temporary,target);
        }
        return {path:target,count:result.count};
      }finally{await rm(temporary,{recursive:true,force:true}).catch(()=>{});}
    }
    throw Error('未知压缩操作');
  }
}
