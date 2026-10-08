import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {lstat,link,mkdir,readdir,rename,rm,stat} from 'node:fs/promises';
import {join,dirname,basename,extname,isAbsolute,resolve,relative} from 'node:path';
import {existsSync} from 'node:fs';
import {createReadStream,createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import type {ArchiveRequest,ArchiveListing,ArchiveEntry,ArchiveProgress,ArchiveResult,ArchiveEncoding} from '../shared/archive';
import {zipEditPacket} from './archive-update';

type Message = {type:'meta';total:number;comment:string;revision?:string;editable?:boolean}|({type:'entry'}&ArchiveEntry)|{type:'progress';done:number;total:number}|{type:'result';count:number;cancelled?:boolean}|{type:'ready'}|{type:'error';message:string};
const helper=()=>join(__dirname,'../native/One.Archive.exe').replace('app.asar\\','app.asar.unpacked\\');
const path=(value:unknown)=>{if(typeof value!=='string'||!isAbsolute(value)||value.length>32768||value.includes('\0'))throw Error('路径无效');return resolve(value);};
const encoding=(value:unknown):ArchiveEncoding=>[0,437,932,936,950,65001].includes(Number(value))?Number(value) as ArchiveEncoding:0;
const password=(value:unknown)=>{if(value===undefined)return '';if(typeof value!=='string'||Buffer.byteLength(value,'utf8')>1024)throw Error('密码无效或过长');return value;};
const archiveTarget=(value:unknown)=>{const target=path(value);if(!/\.(?:zip|7z|tar|tar\.gz|tgz|gz|tar\.xz|txz|xz)$/i.test(target))throw Error('不支持该压缩包格式');return target;};
const archiveSource=(value:unknown)=>{const source=path(value);if(!/\.(?:zip|7z|7z\.001|rar|r00|tar|tar\.gz|tgz|gz|tar\.xz|txz|xz)$/i.test(source))throw Error('暂不支持该压缩格式');return source;};
const archiveName=(source:string)=>basename(source).replace(/\.(?:7z\.001|part\d+\.rar|tar\.gz|tar\.xz|zip|7z|rar|r00|tar|tgz|txz|gz|xz)$/i,'');
const composite=(source:string)=>/\.(?:tar\.gz|tar\.xz|tgz|txz)$/i.test(source);
type CachedTar={path:string;directory:string;stamp:string;users:number;used:number;stale:boolean};

export class ArchiveService {
  private active=new Map<string,{child:ChildProcessWithoutNullStreams;owner:number;committing:boolean}>();
  private publishing=new Map<string,{controller:AbortController;owner:number}>();
  private pending=new Set<Promise<ArchiveListing|ArchiveResult>>();
  private requests=new Set<string>();
  private cached=new Map<string,CachedTar>();
  private preparing=new Map<string,Promise<CachedTar>>();
  private sweepQueued=false;
  constructor(private cacheRoot:string,private changed:(owner:number,progress:ArchiveProgress)=>void,private sourceWindow:(owner:number)=>string=()=> '0'){}
  get pendingTasks(){return this.pending.size;}
  cancel(id:string,owner:number){const task=this.active.get(id);if(task&&task.owner===owner){if(task.committing)return false;task.child.kill();return true;}const publishing=this.publishing.get(id);if(publishing&&publishing.owner===owner){publishing.controller.abort();return true;}return false;}
  async stop(){for(const task of this.active.values())if(!task.committing)task.child.kill();for(const task of this.publishing.values())task.controller.abort();await Promise.allSettled([...this.pending]);await rm(this.cacheRoot,{recursive:true,force:true}).catch(()=>{});this.cached.clear();}
  run(owner:number,request:ArchiveRequest,requestedId?:string):Promise<ArchiveListing|ArchiveResult>{
    const id=requestedId??randomUUID();
    if(typeof id!=='string'||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id)||this.requests.has(id))return Promise.reject(Error('压缩任务编号无效或正在使用'));
    this.requests.add(id);
    const task=this.perform(owner,request,id);
    this.pending.add(task);
    void task.finally(()=>{this.pending.delete(task);this.requests.delete(id);}).catch(()=>{});
    return task;
  }
  private async execute(owner:number,id:string,operation:'list'|'create'|'extract'|'test'|'update'|'drag',args:string[],secret:string,progressOperation?:ArchiveProgress['operation'],packet?:Buffer):Promise<Message[]> {
    return new Promise((done,reject)=>{
      const child=spawn(helper(),[operation,...args],{windowsHide:true,stdio:'pipe'});
      const task={child,owner,committing:false};
      this.active.set(id,task);
      const data:Message[]=[];let buffered='',error='',failed=false,settled=false;
      const finish=(reason?:Error)=>{if(settled)return;settled=true;this.active.delete(id);if(reason)reject(reason);else done(data);};
      if(operation!=='list')this.changed(owner,{id,operation:progressOperation??operation,done:0,total:0});
      child.stdout.setEncoding('utf8');child.stdout.on('data',(chunk:string)=>{
        buffered+=chunk;
        if(buffered.length>2*1024*1024){child.kill();failed=true;error='压缩程序输出超出限制';return;}
        let end:number;
        while((end=buffered.indexOf('\n'))>=0){const line=buffered.slice(0,end).trim();buffered=buffered.slice(end+1);if(!line)continue;
          try{const message=JSON.parse(line) as Message;
            if(message.type==='ready'){
              if(!['update','drag'].includes(operation)||failed||child.killed||task.committing){child.kill();failed=true;error='压缩程序返回无效提交状态';}
              else{task.committing=true;this.changed(owner,{id,operation:operation==='drag'?'drag':'commit',done:0,total:0});child.stdin.end(Buffer.from([1]));}
            }
            else if(message.type==='progress')this.changed(owner,{id,operation:operation==='drag'&&task.committing?'drag':progressOperation??operation as ArchiveProgress['operation'],done:message.done,total:message.total});
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
      child.stdin.on('error',()=>{});
      const input=Buffer.concat([header,value,...(packet?[packet]:[])]);
      if(operation==='update'||operation==='drag')child.stdin.write(input);else child.stdin.end(input);
    });
  }
  private async acquireSource(owner:number,id:string,source:string):Promise<{path:string;release:()=>void}>{
    if(!composite(source))return {path:source,release:()=>{}};
    const info=await stat(source),stamp=`${info.size}:${info.mtimeMs}:${info.birthtimeMs}`;
    const prefix=source.toLowerCase()+'|',key=prefix+stamp;
    for(const [oldKey,old] of this.cached)if(oldKey.startsWith(prefix)&&oldKey!==key){old.stale=true;this.cached.delete(oldKey);if(!old.users)void rm(old.directory,{recursive:true,force:true}).catch(()=>{});}
    let item=this.cached.get(key);
    if(!item){
      let preparing=this.preparing.get(key);
      if(!preparing){
        preparing=(async()=>{
          await mkdir(this.cacheRoot,{recursive:true});
          const directory=join(this.cacheRoot,randomUUID()),inner=join(directory,'inner.tar');
          try{
            const messages=await this.execute(owner,id,'extract',[source,directory,'','0'],'','prepare');
            if(!messages.some(message=>message.type==='result'))throw Error('无法打开复合压缩包');
            const names=await readdir(directory);
            if(names.length!==1)throw Error('复合压缩包应包含一个 TAR 文件');
            const extracted=join(directory,names[0]),details=await lstat(extracted);
            if(!details.isFile()||details.isSymbolicLink())throw Error('复合压缩包的内部文件无效');
            if(extracted.toLowerCase()!==inner.toLowerCase())await rename(extracted,inner);
            const probe=await this.execute(owner,id,'list',[inner,'0','1','0'],'');
            if(!probe.some(message=>message.type==='meta'))throw Error('复合压缩包的内部文件不是 TAR');
            const current=await stat(source);
            if(`${current.size}:${current.mtimeMs}:${current.birthtimeMs}`!==stamp)throw Error('压缩包在读取期间发生了变化，请重试');
            const ready={path:inner,directory,stamp,users:0,used:Date.now(),stale:false};
            this.cached.set(key,ready);
            return ready;
          }catch(error){await rm(directory,{recursive:true,force:true}).catch(()=>{});throw error;}
        })();
        this.preparing.set(key,preparing);
        void preparing.finally(()=>this.preparing.delete(key)).catch(()=>{});
      }
      item=await preparing;
    }
    item.users++;item.used=Date.now();
    const cached=item;
    return {path:cached.path,release:()=>{cached.users--;if(cached.stale&&!cached.users)void rm(cached.directory,{recursive:true,force:true}).catch(()=>{});else this.sweepCache();}};
  }
  private sweepCache(){
    if(this.cached.size<=2||this.sweepQueued)return;
    this.sweepQueued=true;
    setImmediate(()=>{
      this.sweepQueued=false;
      for(const [key,item] of [...this.cached].sort((a,b)=>a[1].used-b[1].used)){
        if(this.cached.size<=2)break;
        if(item.users)continue;
        this.cached.delete(key);void rm(item.directory,{recursive:true,force:true}).catch(()=>{});
      }
    });
  }
  private async perform(owner:number,request:ArchiveRequest,id:string):Promise<ArchiveListing|ArchiveResult> {
    if(!request||typeof request!=='object')throw Error('压缩请求无效');
    if(request.operation==='list'){
      const source=archiveSource(request.path),offset=Math.max(0,Math.min(1000000,Math.floor(Number(request.offset)||0)));
      const prepared=await this.acquireSource(owner,id,source);
      try{
        const messages=await this.execute(owner,id,'list',[prepared.path,String(offset),'200',String(encoding(request.encoding))],password(request.password));
        const meta=messages.find((item):item is Extract<Message,{type:'meta'}>=>item.type==='meta');
        if(!meta)throw Error('无法读取压缩包目录');
        return {path:source,total:meta.total,comment:meta.comment,revision:meta.revision,editable:meta.editable===true,offset,entries:messages.filter((item):item is Extract<Message,{type:'entry'}>=>item.type==='entry').map(({type,...entry})=>entry)};
      }finally{prepared.release();}
    }
    if(request.operation==='drag'){
      const source=archiveSource(request.path),secret=password(request.password);
      if(typeof request.revision!=='string'||!/^\d+(?::\d+){6}$/.test(request.revision))throw Error('请重新打开压缩包后再拖出');
      const selected=request.selected;
      if(!Array.isArray(selected)||!selected.length||selected.length>10000||selected.some(index=>!Number.isInteger(index)||index<0||index>=1000000))throw Error('请选择 1–10000 项拖出');
      const packet=Buffer.alloc(4+selected.length*4);packet.writeUInt32LE(selected.length);
      selected.forEach((value,index)=>packet.writeUInt32LE(value,4+index*4));
      const prepared=await this.acquireSource(owner,id,source);
      const stage=join(this.cacheRoot,`drag-${id}`);
      try{
        await mkdir(this.cacheRoot,{recursive:true});
        const messages=await this.execute(owner,id,'drag',[prepared.path,stage,String(encoding(request.encoding)),request.revision,this.sourceWindow(owner)],secret,'prepare',packet);
        const result=messages.find((item):item is Extract<Message,{type:'result'}>=>item.type==='result');
        if(!result)throw Error('拖出未完成');
        return {path:source,count:result.count,cancelled:result.cancelled===true};
      }finally{
        prepared.release();
        // The helper exits only after the target ends its async operation and
        // closes all contents streams. Never remove files when DoDragDrop alone returns.
        await rm(stage,{recursive:true,force:true}).catch(()=>{});
      }
    }
    if(request.operation==='update'){
      const source=archiveSource(request.path);
      if(!/\.zip$/i.test(source))throw Error('目前仅支持修改单卷 ZIP 压缩包');
      if(typeof request.revision!=='string'||!/^\d+(?::\d+){6}$/.test(request.revision))throw Error('请重新打开压缩包后再保存修改');
      const packet=await zipEditPacket(request.changes);
      const temporary=join(dirname(source),`.one-update-${id}.zip`),backup=join(dirname(source),`.one-update-${id}.original.zip`);
      try{
        const messages=await this.execute(owner,id,'update',[source,temporary,backup,String(encoding(request.encoding)),request.revision],password(request.password),undefined,packet);
        const result=messages.find((item):item is Extract<Message,{type:'result'}>=>item.type==='result');
        if(!result)throw Error('压缩程序未确认修改成功');
        return {path:source,count:result.count};
      }finally{
        await rm(temporary,{force:true}).catch(()=>{});
        // A backup left by a failed OS replacement is recovery data. Never
        // delete it here, even if the original path happens to exist again.
      }
    }
    if(request.operation==='test'){
      const source=archiveSource(request.path);
      const prepared=await this.acquireSource(owner,id,source);
      try{
        const messages=await this.execute(owner,id,'test',[prepared.path,String(encoding(request.encoding))],password(request.password));
        return {path:source,count:(messages.find(item=>item.type==='result') as {count:number}|undefined)?.count||0};
      }finally{prepared.release();}
    }
    if(request.operation==='create'){
      const target=archiveTarget(request.path),sources=request.sources;
      const seven=/\.7z$/i.test(target),zip=/\.zip$/i.test(target),single=/\.(?:gz|xz)$/i.test(target)&&!composite(target);
      if(!Array.isArray(sources)||!sources.length||sources.length>128)throw Error('请选择 1–128 个文件或文件夹');
      const volumeBytes=request.volumeBytes??0;
      if(!Number.isSafeInteger(volumeBytes)||volumeBytes<0||volumeBytes>64*1024**3||(volumeBytes>0&&volumeBytes<1024**2))
        throw Error('分卷大小须为 1 MB 至 64 GB');
      const secret=password(request.password);
      if(!zip&&!seven&&(secret||volumeBytes))throw Error('TAR、GZ 和 XZ 不支持密码或分卷');
      const checked=await Promise.all(sources.map(async item=>{const source=path(item),info=await lstat(source);if(info.isSymbolicLink()||(!info.isFile()&&!info.isDirectory()))throw Error('不支持压缩链接或特殊文件');if(info.isDirectory()&&!relative(source,target).startsWith('..')&&!isAbsolute(relative(source,target)))throw Error('压缩包不能保存在被压缩的文件夹中');return source;}));
      if(single&&(checked.length!==1||!(await lstat(checked[0])).isFile()))throw Error('GZ 和 XZ 只能压缩单个文件；压缩文件夹请选 TAR.GZ 或 TAR.XZ');
      const names=new Set<string>();
      for(const source of checked){const name=basename(source).toLowerCase();if(names.has(name))throw Error('所选内容包含同名文件或文件夹，请分开压缩');names.add(name);}
      if(existsSync(target)||seven&&volumeBytes>0&&existsSync(target+'.001'))throw Error('目标压缩包已经存在');
      const suffix=basename(target).slice(archiveName(target).length);
      const temporary=join(dirname(target),`.one-archive-${id}${suffix}`);
      const temporaryStem=temporary.slice(0,-4),targetStem=target.slice(0,-4);
      const stage=join(dirname(target),`.one-archive-${id}-stage`);
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
        let messages:Message[];
        if(composite(target)){
          await mkdir(stage);
          const inner=join(stage,archiveName(target)+'.tar');
          await this.execute(owner,id,'create',[inner,...checked],'');
          await this.execute(owner,id,'test',[inner,'0'],'');
          messages=await this.execute(owner,id,'create',[temporary,inner],'');
        }else messages=await this.execute(owner,id,'create',[temporary,...(zip&&volumeBytes?[`--volume=${volumeBytes}`]:[]),...checked],secret);
        await this.execute(owner,id,'test',[temporary,'0'],secret);
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
        const parts=seven?sevenParts:zip?await zipParts():[];
        controller.signal.throwIfAborted();
        for(const item of parts)if(existsSync(item.target))throw Error('目标目录中已存在同名分卷');
        for(const item of parts){controller.signal.throwIfAborted();await link(item.temporary,item.target);published.push(item.target);}
        controller.signal.throwIfAborted();
        if(!seven||!volumeBytes)await link(temporary,target);
        return {path:seven&&volumeBytes?target+'.001':target,count:composite(target)?checked.length:result.count};
      }catch(error){await Promise.allSettled(published.map(item=>rm(item,{force:true})));throw error;}
      finally{this.publishing.delete(id);await rm(temporary,{force:true}).catch(()=>{});for(const item of seven?sevenParts:zip?await zipParts().catch(()=>[]):[])await rm(item.temporary,{force:true}).catch(()=>{});await rm(stage,{recursive:true,force:true}).catch(()=>{});}
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
      const prepared=await this.acquireSource(owner,id,source);
      try{
        const messages=await this.execute(owner,id,'extract',[prepared.path,temporary,selected.join(','),String(encoding(request.encoding))],password(request.password));
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
      }finally{prepared.release();await rm(temporary,{recursive:true,force:true}).catch(()=>{});}
    }
    throw Error('未知压缩操作');
  }
}
