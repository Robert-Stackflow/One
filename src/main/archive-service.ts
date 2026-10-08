import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {lstat,link,mkdir,readdir,rename,rm,stat} from 'node:fs/promises';
import {join,dirname,basename,extname,isAbsolute,resolve,relative} from 'node:path';
import {existsSync} from 'node:fs';
import {createReadStream,createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import type {ArchiveRequest,ArchiveListing,ArchiveEntry,ArchiveProgress,ArchiveResult,ArchiveEncoding} from '../shared/archive';
import {archiveEditPacket} from './archive-update';
import {browsePacket,folderSelection} from './archive-browser';
import {ArchiveDragCache,type DragCacheReport} from './archive-drag-cache';
import type {ArchiveTasks} from './archive-tasks';
import {archiveResources,archiveLevel,type ArchiveResources} from '../shared/archive-options';

type Message = {type:'meta';total:number;comment:string;revision?:string;editable?:boolean;matched?:number}|({type:'entry'}&ArchiveEntry)|{type:'progress';done:number;total:number}|{type:'result';count:number;skipped?:number;cancelled?:boolean}|{type:'ready'}|{type:'error';message:string;code?:string};
export class ArchiveFailure extends Error {constructor(message:string,readonly code:string='archive'){super(message);this.name='ArchiveFailure';}}
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
  private active=new Map<string,{child:ChildProcessWithoutNullStreams;owner:number;committing:boolean;cooperative:boolean}>();
  private publishing=new Map<string,{controller:AbortController;owner:number}>();
  private pending=new Set<Promise<ArchiveListing|ArchiveResult>>();
  private requests=new Set<string>();
  private jobs=new Map<string,{owner:number;cancelled:boolean;committing:boolean;finishing:boolean;resources:ArchiveResources;level:number}>();
  private stopped=false;
  private cached=new Map<string,CachedTar>();
  private preparing=new Map<string,Promise<CachedTar>>();
  private sweepQueued=false;
  private dragCache:ArchiveDragCache;
  private cacheMaintenance:Promise<DragCacheReport>;
  constructor(private cacheRoot:string,private changed:(owner:number,progress:ArchiveProgress)=>void,private sourceWindow:(owner:number)=>string=()=> '0',private diagnostic:(event:string,detail:string,warning?:boolean)=>void=()=>{},private independentProcessGroup=false,private tasks?:ArchiveTasks,private defaults:()=>ArchiveResources&{compressionLevel?:number}=()=>archiveResources()){
    this.dragCache=new ArchiveDragCache(cacheRoot,value=>this.diagnostic('archive-drag-cache',JSON.stringify(value),value.failures.length>0));
    this.cacheMaintenance=this.dragCache.sweep();
  }
  get pendingTasks(){return this.pending.size;}
  taskOverview(){return this.tasks?.overview()??Promise.resolve({active:[],recent:[],error:''});}
  cancelId(id:string){const job=this.jobs.get(id);if(!job)throw Error('任务已结束');if(!this.cancel(id,job.owner))throw Error('正在完成最终保存，请等待任务结束');return job.owner;}
  private checkpoint(id:string){if(this.jobs.get(id)?.cancelled)throw new ArchiveFailure('压缩任务已取消','cancelled');}
  private seal(owner:number,id:string,confirmed=false){const job=this.jobs.get(id);if(confirmed&&job)job.cancelled=false;this.checkpoint(id);if(job)job.committing=true;this.notify(owner,{id,operation:'commit',done:0,total:0});}
  private notify(owner:number,value:ArchiveProgress){const job=this.jobs.get(value.id);this.tasks?.progress(value,!!job&&!job.cancelled&&!job.finishing&&!job.committing);this.changed(owner,value);}
  cancel(id:string,owner:number){const job=this.jobs.get(id);if(!job||job.owner!==owner||job.finishing||job.committing)return false;job.cancelled=true;
    this.tasks?.cancelling(id);
    const task=this.active.get(id);if(task&&task.owner===owner){if(task.cooperative)task.child.stdin.write(Buffer.from([2]));else task.child.kill();}
    this.publishing.get(id)?.controller.abort();return true;}
  async stop(){
    this.stopped=true;for(const [id,job] of this.jobs)this.cancel(id,job.owner);
    await Promise.allSettled([...this.pending]);await this.tasks?.flush();await this.cacheMaintenance;
    for(const item of this.cached.values())await rm(item.directory,{recursive:true,force:true}).catch(error=>this.diagnostic('archive-cache-cleanup',String(error),true));
    this.cached.clear();await this.dragCache.sweep();
    // Another helper can outlive a crashed One instance. Never recursively
    // remove its leased payload merely because this instance is quitting.
    await this.dragCache.removeEmptyRoot().catch(error=>this.diagnostic('archive-cache-cleanup',String(error),true));
  }
  run(owner:number,request:ArchiveRequest,requestedId?:string):Promise<ArchiveListing|ArchiveResult>{
    if(this.stopped)return Promise.reject(Error('压缩服务正在关闭'));
    if(this.requests.size>=32)return Promise.reject(Error('同时运行的压缩任务过多，请等待当前任务完成'));
    const id=requestedId??randomUUID();
    if(typeof id!=='string'||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id)||this.requests.has(id))return Promise.reject(Error('压缩任务编号无效或正在使用'));
    let resources:ArchiveResources,level:number;
    try{const defaults=this.defaults();resources=archiveResources(request,defaults);level=archiveLevel(request?.operation==='create'&&request.level!==undefined?request.level:defaults.compressionLevel??6);}catch(error){return Promise.reject(error);}
    this.requests.add(id);
    const job={owner,cancelled:false,committing:false,finishing:false,resources,level};this.jobs.set(id,job);
    const task=(async()=>{let result:ArchiveListing|ArchiveResult|undefined,error:unknown;
      try{if(request&&['create','extract','test','update','drag'].includes(request.operation))await this.tasks?.begin(id,request.operation as import('../shared/archive').ArchiveTaskOperation,path(request.path));
        this.checkpoint(id);result=await this.perform(owner,request,id);return result;
      }catch(cause){error=cause;throw cause;}
      finally{job.finishing=true;await this.tasks?.finish(id,result&&'count'in result?result:undefined,error,job.cancelled||error instanceof ArchiveFailure&&error.code==='cancelled');}
    })();
    this.pending.add(task);
    void task.finally(()=>{this.pending.delete(task);this.requests.delete(id);this.jobs.delete(id);}).catch(()=>{});
    return task;
  }
  private async execute(owner:number,id:string,operation:'list'|'browse'|'create'|'extract'|'test'|'update'|'drag'|'publish',args:string[],secret:string,progressOperation?:ArchiveProgress['operation'],packet?:Buffer):Promise<Message[]> {
    this.checkpoint(id);
    return new Promise((done,reject)=>{
      // CLI cancellation is handled by this service, not a console-wide signal
      // that could kill the helper during transactional publication.
      const options=this.jobs.get(id)!;
      const child=spawn(helper(),[operation,...args],{windowsHide:true,stdio:'pipe',detached:this.independentProcessGroup,env:{...process.env,ONE_ARCHIVE_LEVEL:String(options.level),ONE_ARCHIVE_THREADS:String(options.resources.threads),ONE_ARCHIVE_MEMORY_MIB:String(options.resources.memoryMiB)}});
      const task={child,owner,committing:false,cooperative:operation==='publish'};
      this.active.set(id,task);
      const data:Message[]=[];let buffered='',error='',errorCode='archive',failed=false,settled=false;
      const finish=(reason?:Error)=>{if(settled)return;settled=true;this.active.delete(id);if(reason)reject(reason);else done(data);};
      child.stdout.setEncoding('utf8');child.stdout.on('data',(chunk:string)=>{
        buffered+=chunk;
        if(buffered.length>2*1024*1024){child.kill();failed=true;error='压缩程序输出超出限制';return;}
        let end:number;
        while((end=buffered.indexOf('\n'))>=0){const line=buffered.slice(0,end).trim();buffered=buffered.slice(end+1);if(!line)continue;
          try{const message=JSON.parse(line) as Message;
            if(message.type==='ready'){
              if(!['update','drag','publish'].includes(operation)||failed||child.killed||task.committing){child.kill();failed=true;error='压缩程序返回无效提交状态';}
              else{task.committing=true;if(operation==='publish'){child.stdin.write(Buffer.from([1]));this.notify(owner,{id,operation:'extract',done:0,total:0});}else{const job=this.jobs.get(id);if(job)job.committing=true;this.notify(owner,{id,operation:operation==='drag'?'drag':'commit',done:0,total:0});child.stdin.end(Buffer.from([1]));}}
            }
            else if(message.type==='progress')this.notify(owner,{id,operation:operation==='drag'&&task.committing?'drag':progressOperation??(operation==='publish'?'extract':operation) as ArchiveProgress['operation'],done:message.done,total:message.total});
            else if((message as {type:string}).type==='resources'){this.diagnostic('archive-resources',JSON.stringify({id,operation,...options.resources,level:options.level}));}
            else if(message.type==='error'){failed=true;error=message.message;if(['password','archive','read','write','safety','cancelled','resource'].includes(message.code??''))errorCode=message.code!;if(errorCode==='resource'){this.diagnostic('archive-resource-error',JSON.stringify({id,message:message.message}),true);error='归档资源不足或无法应用限制；请降低压缩等级，或提高内存上限后重试';}}
            else data.push(message);
            if(data.length>505){failed=true;error='压缩程序返回过多数据';child.kill();}
          }catch{failed=true;error='压缩程序返回无效数据';child.kill();}
        }
      });
      child.stderr.on('data',(chunk:Buffer)=>{if(error.length<512)error+=chunk.toString('utf8').slice(0,512);});
      child.on('error',cause=>finish(cause));
      child.on('close',code=>{if(failed||code!==0)finish(new ArchiveFailure(error||'压缩任务已取消或失败',this.jobs.get(id)?.cancelled?'cancelled':errorCode));else finish();});
      const value=Buffer.from(secret,'utf8'),header=Buffer.alloc(4);header.writeUInt32LE(value.length);
      child.stdin.on('error',()=>{});
      const input=Buffer.concat([header,value,...(packet?[packet]:[])]);
      if(operation==='update'||operation==='drag'||operation==='publish')child.stdin.write(input);else child.stdin.end(input);
      // Initial progress can synchronously request cancellation. Write the
      // private request frame first so a cooperative cancel byte cannot corrupt it.
      if(operation!=='list'&&operation!=='browse')this.notify(owner,{id,operation:progressOperation??(operation==='publish'?'extract':operation),done:0,total:0});
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
    await this.cacheMaintenance;
    this.checkpoint(id);
    if(!request||typeof request!=='object')throw Error('压缩请求无效');
    if(request.operation==='list'){
      const source=archiveSource(request.path),offset=Math.max(0,Math.min(1000000,Math.floor(Number(request.offset)||0)));
      const browser=request.browse===undefined?undefined:browsePacket(request.browse);
      if(browser&&request.offset!==undefined&&(!Number.isInteger(request.offset)||request.offset<0||request.offset>1000000))throw Error('压缩包页码无效');
      const prepared=await this.acquireSource(owner,id,source);
      try{
        const messages=await this.execute(owner,id,browser?'browse':'list',[prepared.path,String(offset),'200',String(encoding(request.encoding))],password(request.password),undefined,browser?.packet);
        const meta=messages.find((item):item is Extract<Message,{type:'meta'}>=>item.type==='meta');
        if(!meta)throw Error('无法读取压缩包目录');
        return {path:source,total:meta.total,matched:meta.matched,browse:browser?.query,comment:meta.comment,revision:meta.revision,editable:meta.editable===true,offset,entries:messages.filter((item):item is Extract<Message,{type:'entry'}>=>item.type==='entry').map(({type,...entry})=>entry)};
      }finally{prepared.release();}
    }
    if(request.operation==='drag'){
      const source=archiveSource(request.path),secret=password(request.password);
      if(typeof request.revision!=='string'||!/^\d+(?::\d+){6}$/.test(request.revision))throw Error('请重新打开压缩包后再拖出');
      const selected=request.selected;
      const folders=folderSelection(request.selectedFolders);
      if(!Array.isArray(selected)||!selected.length&&!folders.folders.length||selected.length+folders.folders.length>10000||selected.some(index=>!Number.isInteger(index)||index<0||index>=1000000))throw Error('请选择 1–10000 项拖出');
      const indexes=Buffer.alloc(4+selected.length*4);indexes.writeUInt32LE(selected.length);
      selected.forEach((value,index)=>indexes.writeUInt32LE(value,4+index*4));
      const packet=Buffer.concat([indexes,...(folders.packet?[folders.packet]:[])]);
      const prepared=await this.acquireSource(owner,id,source);
      let job:Awaited<ReturnType<ArchiveDragCache['create']>>|undefined;
      try{
        await this.dragCache.sweep();job=await this.dragCache.create(id);
        const messages=await this.execute(owner,id,'drag',[prepared.path,job.payload,String(encoding(request.encoding)),request.revision,this.sourceWindow(owner),job.lease,...(folders.packet?['--folders']:[])],secret,'prepare',packet);
        const result=messages.find((item):item is Extract<Message,{type:'result'}>=>item.type==='result');
        if(!result)throw Error('拖出未完成');
        return {path:source,count:result.count,cancelled:result.cancelled===true};
      }finally{
        prepared.release();
        // The helper exits only after the target ends its async operation and
        // closes all contents streams. Never remove files when DoDragDrop alone returns.
        if(job)await this.dragCache.release(id).then(removed=>{if(!removed)this.diagnostic('archive-drag-cache-retained',id,true);}).catch(error=>this.diagnostic('archive-drag-cache-cleanup',String(error),true));
      }
    }
    if(request.operation==='update'){
      const source=archiveSource(request.path);
      if(!/\.(?:zip|7z)$/i.test(source))throw Error('目前支持修改单卷 ZIP 和 7Z 压缩包');
      if(typeof request.revision!=='string'||!/^\d+(?::\d+){6}$/.test(request.revision))throw Error('请重新打开压缩包后再保存修改');
      const packet=await archiveEditPacket(request.changes);
      if(/\.7z$/i.test(source)&&request.changes.some(change=>change.kind==='comment'))throw Error('7Z 格式不支持压缩包备注');
      const suffix=extname(source),temporary=join(dirname(source),`.one-update-${id}${suffix}`),backup=join(dirname(source),`.one-update-${id}.original${suffix}`);
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
        const result=messages.find((item):item is Extract<Message,{type:'result'}>=>item.type==='result');
        if(!result)throw new ArchiveFailure('压缩程序未确认校验成功');
        return {path:source,count:result.count};
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
      if(existsSync(target)||seven&&volumeBytes>0&&existsSync(target+'.001'))throw new ArchiveFailure('目标压缩包已经存在','write');
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
        await this.execute(owner,id,'test',[temporary,'0'],secret);this.checkpoint(id);
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
            this.notify(owner,{id,operation:'create',done:index+1,total:count});
          }
        }
        const parts=seven?sevenParts:zip?await zipParts():[];
        this.checkpoint(id);
        controller.signal.throwIfAborted();
        for(const item of parts)if(existsSync(item.target))throw Error('目标目录中已存在同名分卷');
        for(const item of parts){controller.signal.throwIfAborted();await link(item.temporary,item.target);published.push(item.target);}
        controller.signal.throwIfAborted();
        this.seal(owner,id);if(!seven||!volumeBytes)await link(temporary,target);
        return {path:seven&&volumeBytes?target+'.001':target,count:composite(target)?checked.length:result.count};
      }catch(error){await Promise.allSettled(published.map(item=>rm(item,{force:true})));throw error;}
      finally{this.publishing.delete(id);await rm(temporary,{force:true}).catch(()=>{});for(const item of seven?sevenParts:zip?await zipParts().catch(()=>[]):[])await rm(item.temporary,{force:true}).catch(()=>{});await rm(stage,{recursive:true,force:true}).catch(()=>{});}
    }
    if(request.operation==='extract'){
      const source=archiveSource(request.path),parent=path(request.parent),parentInfo=await stat(parent);
      if(!parentInfo.isDirectory())throw Error('请选择目标文件夹');
      const destination=request.destination??'folder';
      if(!['folder','smart','here'].includes(destination))throw Error('解压位置模式无效');
      const conflict=request.conflict??'rename';if(!['rename','skip','replace'].includes(conflict))throw Error('同名文件处理方式无效');
      const selected=request.selected||[];
      const folders=folderSelection(request.selectedFolders);
      if(!Array.isArray(selected)||selected.length+folders.folders.length>10000||selected.some(value=>!Number.isSafeInteger(value)||value<0||value>=1000000))throw Error('选择的条目无效');
      if(request.revision!==undefined&&(typeof request.revision!=='string'||!/^\d+(?::\d+){6}$/.test(request.revision)))throw Error('请重新打开压缩包后再解压');
      const uniqueTarget=(name:string,file=false)=>{const extension=file?extname(name):'',base=extension?name.slice(0,-extension.length):name;let target=join(parent,name),suffix=2;while(existsSync(target)){target=join(parent,`${base} (${suffix++})${extension}`);if(suffix>10000)throw Error('没有可用的解压目标名称');}return target;};
      const temporary=join(parent,`.one-extract-${id}`);
      const prepared=await this.acquireSource(owner,id,source);
      try{
        const messages=await this.execute(owner,id,'extract',[prepared.path,temporary,selected.join(','),String(encoding(request.encoding)),...(folders.packet?['--folders']:[]),...(request.revision?[`--revision=${request.revision}`]:[])],password(request.password),undefined,folders.packet);
        const result=messages.find((item):item is Extract<Message,{type:'result'}>=>item.type==='result');
        if(!result)throw Error('压缩程序未确认解压成功');
        if(destination==='here'){
          const published=await this.execute(owner,id,'publish',[temporary,parent,join(parent,`.one-recovery-${id}`),conflict,source],'');
          const outcome=published.find((item):item is Extract<Message,{type:'result'}>=>item.type==='result');
          if(!outcome)throw Error('压缩程序未确认提交成功');
          if(!outcome.cancelled)this.seal(owner,id,true);
          return {path:parent,count:outcome.count,skipped:outcome.skipped??0,cancelled:outcome.cancelled===true};
        }
        this.checkpoint(id);const top=destination==='smart'?await readdir(temporary):[];
        let target:string;
        if(top.length===1){
          const extracted=join(temporary,top[0]),info=await lstat(extracted);
          if(!info.isFile()&&!info.isDirectory())throw Error('压缩包包含无法安全提交的条目');
          target=uniqueTarget(top[0],info.isFile());
          this.seal(owner,id);
          if(info.isFile())await link(extracted,target);else await rename(extracted,target);
        }else{
          target=uniqueTarget(archiveName(source));
          this.seal(owner,id);
          await rename(temporary,target);
        }
        return {path:target,count:result.count};
      }finally{prepared.release();await rm(temporary,{recursive:true,force:true}).catch(()=>{});}
    }
    throw Error('未知压缩操作');
  }
}
