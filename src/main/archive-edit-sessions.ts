import {createHash,randomUUID} from 'node:crypto';
import {watch,constants,type FSWatcher} from 'node:fs';
import {copyFile,lstat,mkdir,open,opendir,readdir,readFile,rename,rm,rmdir} from 'node:fs/promises';
import {basename,dirname,extname,isAbsolute,join,resolve,relative} from 'node:path';
import type {ArchiveListing,ArchiveRequest,ArchiveResult} from '../shared/archive';
import type {ArchiveEditResolution,ArchiveEditSession,ArchiveEditSessionPage,ArchiveEditStart} from '../shared/archive-edit-session';
import {validArchiveRevision} from '../shared/archive-revision';
import {launchArchiveEditor,type ArchiveEditLauncher,type ArchiveEditLaunch} from './archive-edit-launch';

type Snapshot={file:string;token:string};
type Record=ArchiveEditSession&{version:1|2;revision:string;baseline:string;missing?:boolean;pending?:Snapshot;retired?:Snapshot[];scratch?:string[];encoding?:ArchiveEditStart['encoding'];passwordEncoding?:ArchiveEditStart['passwordEncoding']};
type Run=(owner:number,request:ArchiveRequest,id?:string)=>Promise<ArchiveListing|ArchiveResult>;
type Observed={watcher?:FSWatcher;timer?:NodeJS.Timeout;launch?:ArchiveEditLaunch;abort?:AbortController;editor:NonNullable<ArchiveEditSession['editor']>;notice?:string;dirty:boolean;checking:boolean;signature?:string;view?:ArchiveEditSession};
type Resolution=ArchiveEditResolution&{revision:string;baseline:string;previous:string};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const digest=/^[a-f0-9]{64}$/;
const snapshotName=/^snapshot-[0-9a-f-]{36}(?:\.[^\\/:<>"|?*\x00-\x1f]+)?$/;
const maxBytes=256*1024**2;
// Never invoke a script/executable association. Unknown types use the explicit
// program picker, and source/configuration files use a text editor.
const documents=new Set('.rtf .doc .docx .xls .xlsx .ppt .pptx .odt .ods .odp .pdf .svg .png .jpg .jpeg .gif .webp .bmp .ico'.split(' '));
const texts=new Set('.txt .md .markdown .json .xml .csv .log .ini .yaml .yml .css .sql .js .jsx .ts .tsx .mjs .cjs .html .htm .bat .cmd .ps1 .sh .py .rb .c .cpp .h .hpp .rs .toml .config .env'.split(' '));
const text=(value:unknown,max=32767):value is string=>typeof value==='string'&&!!value&&value.length<=max&&!/[\0\r\n]/.test(value);
const message=(error:unknown)=>error instanceof Error?error.message:String(error);
const safeName=(name:unknown):name is string=>text(name)&&!name.split('/').some(part=>!part||part==='.'||part==='..'||/[\\:<>"|?*\x00-\x1f]|[. ]$/.test(part));

/** Persistent edit copies are user work, never a TTL cache. No secrets are saved. */
export class ArchiveEditSessions {
 private active?:Promise<unknown>;
 private control?:{owner:number;id:string;cancelled:boolean;native:boolean};
 private stopped=false;
 private observed=new Map<string,Observed>();
 private resolutions=new Map<string,Resolution>();
 constructor(private root:string,private run:Run,private launch:ArchiveEditLauncher=launchArchiveEditor,private changed:(item:ArchiveEditSession)=>void=()=>{}){this.root=resolve(root);}
 get pendingTasks(){return this.active?1:0;}
 refresh(){for(const [id,item] of this.observed){item.dirty=true;this.schedule(id);}}
 async stop(){this.stopped=true;if(this.control)this.control.cancelled=true;for(const item of this.observed.values()){item.abort?.abort();item.launch?.release();item.watcher?.close();clearTimeout(item.timer);}await this.active?.catch(()=>{});this.observed.clear();}
 cancel(id:string,owner:number){const value=this.control;if(!value||value.id!==id||value.owner!==owner||value.native)return false;value.cancelled=true;return true;}
 private checkpoint(){if(this.stopped||this.control?.cancelled)throw Error('外部编辑操作已停止，编辑副本会保留');}
 private operation(owner:number,id:string=randomUUID()){if(typeof id!=='string'||!uuid.test(id))throw Error('外部编辑任务编号无效');this.control={owner,id,cancelled:false,native:false};return id;}
 private async native(owner:number,request:ArchiveRequest,id:string){this.checkpoint();this.control!.native=true;try{return await this.run(owner,request,id);}finally{this.control!.native=false;}}
 private action<T>(work:()=>Promise<T>):Promise<T>{
  if(this.stopped)return Promise.reject(Error('压缩服务正在关闭'));
  if(this.active)return Promise.reject(Error('外部编辑操作正在进行，请稍候'));
  const task=work();this.active=task;
  void task.finally(()=>{if(this.active===task){this.active=undefined;this.control=undefined;for(const [id,item] of this.observed)if(item.dirty)this.schedule(id);}}).catch(()=>{});return task;
 }
 private async directory(path:string){const info=await lstat(path);if(!info.isDirectory()||info.isSymbolicLink())throw Error('外部编辑目录已被替换，请保留资料并手动检查');}
 private async rootDirectory(){await this.directory(dirname(this.root));await mkdir(this.root,{recursive:true});await this.directory(this.root);}
 private folder(id:string){if(typeof id!=='string'||!uuid.test(id))throw Error('外部编辑标识无效');return join(this.root,id);}
 private validate(record:Record,id:string){
  const folder=this.folder(id);
  if(![1,2].includes(record.version)||record.id!==id||!text(record.archive)||!isAbsolute(record.archive)||!safeName(record.name)||!validArchiveRevision(record.revision)||!digest.test(record.baseline)||!Number.isSafeInteger(record.created)||!['ready','writing','saved'].includes(record.state)||record.file!==(record.version===1?join(folder,'document'+extname(record.name)):join(folder,'edit',basename(record.name)))||![undefined,0,437,932,936,949,950,65001].includes(record.encoding)||![undefined,0,437,932,936,949,950,65001].includes(record.passwordEncoding)||record.pending&&(!snapshotName.test(record.pending.file)||!digest.test(record.pending.token)))throw Error('外部编辑记录无效，请保留临时文件');
  if(record.retired&&(!Array.isArray(record.retired)||record.retired.length>16||record.retired.some(value=>!value||!snapshotName.test(value.file)||!digest.test(value.token))||new Set(record.retired.map(value=>value.file)).size!==record.retired.length))throw Error('外部编辑快照记录无效，请保留临时文件');
  if(record.scratch&&(!Array.isArray(record.scratch)||record.scratch.length>16||record.scratch.some(value=>typeof value!=='string'||!value.startsWith('inspect-')||!uuid.test(value.slice(8)))||new Set(record.scratch).size!==record.scratch.length))throw Error('外部编辑核对记录无效，请保留临时文件');
 }
 private async metadata(file:string,id:string){const info=await lstat(file);if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size>256*1024)throw Error('外部编辑记录无效，请保留临时文件');const record=JSON.parse(await readFile(file,'utf8')) as Record;this.validate(record,id);return record;}
 private async read(id:string):Promise<Record>{
  await this.rootDirectory();const folder=this.folder(id);await this.directory(folder);
  const journal=join(folder,'session.json'),next=join(folder,'session.next');let record:Record;
  try{record=await this.metadata(journal,id);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;record=await this.metadata(next,id);await rename(next,journal);}
  // A complete next journal cannot override the committed journal. In
  // particular, an unacknowledged write stays uncertain until source inspection.
  try{await this.metadata(next,id);await rm(next);}catch{/* Keep unknown/partial metadata for manual inspection. */}
  if(record.version===2)await this.directory(dirname(record.file));return record;
 }
 private async persist(record:Record){
  const folder=this.folder(record.id);await this.directory(folder);this.validate(record,record.id);
  const temp=join(folder,'session.next');
  // An interrupted atomic journal replacement may leave our previous metadata.
  // Unknown files are retained rather than deleted to force an overwrite.
  try{await this.metadata(temp,record.id);await rm(temp);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const handle=await open(temp,'wx');try{await handle.writeFile(JSON.stringify(record));await handle.sync();}finally{await handle.close();}
  await rename(temp,join(folder,'session.json'));
 }
 private async fingerprint(file:string,snapshot?:string){
  const info=await lstat(file,{bigint:true});if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1n||info.size>BigInt(maxBytes))throw Error('编辑文件无效、已被链接或超过 256 MiB；请另存文件');
  const input=await open(file,'r');let output:Awaited<ReturnType<typeof open>>|undefined;
  try{
   if(snapshot)output=await open(snapshot,'wx');
   // Windows lstat can report dev=0 while fstat reports the volume serial.
   const before=await input.stat({bigint:true});if(before.ino!==info.ino||before.nlink!==1n)throw Error('编辑文件正在被替换，请保存完成后重试');
   const hash=createHash('sha256'),buffer=Buffer.allocUnsafe(1024*1024);let size=0;
   while(true){this.checkpoint();const {bytesRead}=await input.read(buffer,0,buffer.length,null);if(!bytesRead)break;size+=bytesRead;if(size>maxBytes)throw Error('编辑文件超过 256 MiB；请另存文件');hash.update(buffer.subarray(0,bytesRead));if(output){let offset=0;while(offset<bytesRead){const written=await output.write(buffer,offset,bytesRead-offset);if(!written.bytesWritten)throw Error('无法保存编辑快照');offset+=written.bytesWritten;}}}
   const after=await input.stat({bigint:true}),current=await lstat(file,{bigint:true});
   if(current.isSymbolicLink()||current.nlink!==1n||current.ino!==before.ino||after.size!==BigInt(size)||before.size!==after.size||before.mtimeNs!==after.mtimeNs||before.ctimeNs!==after.ctimeNs)throw Error('编辑文件仍在变化，请保存完成后重试');
   await output?.sync();return hash.digest('hex');
  }finally{await Promise.allSettled([input.close(),output?.close()]);}
 }
 private view(record:Record):ArchiveEditSession{const {id,archive,name,file,created,state}=record,item=this.observed.get(id);return{id,archive,name,file,created,state,editor:item?.editor||'idle',notice:item?.notice,conflict:record.conflict};}
 private retire(record:Record,value:Snapshot){if((record.retired?.length||0)>=16)throw Error('待清理快照过多，请先处理编辑资料');record.retired=[...(record.retired||[]),value];}
 private async cleanInspection(folder:string,name:string){
  await this.directory(folder);const first=await readdir(folder);if(!first.length){await rmdir(folder);return;}if(first.length!==1)throw Error('核对目录包含其他资料');
  let path=join(folder,first[0]);const directories=[folder,path];await this.directory(path);
  const parts=name.split('/');
  for(let index=0;index<parts.length;index++){
   const entries=await readdir(path);if(!entries.length)break;if(entries.length!==1||entries[0]!==parts[index])throw Error('核对目录包含其他资料');path=join(path,parts[index]);
   if(index===parts.length-1){await this.fingerprint(path);await rm(path);}else{await this.directory(path);directories.push(path);}
  }
  for(const directory of directories.reverse())await rmdir(directory);
 }
 private async cleanup(record:Record){
  if(!record.retired?.length&&!record.scratch?.length)return;const retained:Snapshot[]=[],scratch:string[]=[];
  for(const item of record.retired||[]){try{
   // These random, journaled internal snapshots may be partial after a crash.
   // User documents and unrecorded editor sidecars are never included here.
   const file=join(this.folder(record.id),item.file);await this.fingerprint(file);await rm(file);
  }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')retained.push(item);}}
  for(const item of record.scratch||[]){try{await this.cleanInspection(join(this.folder(record.id),item),record.name);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')scratch.push(item);}}
  if(retained.length!==(record.retired?.length||0)||scratch.length!==(record.scratch?.length||0)){record.retired=retained;record.scratch=scratch;await this.persist(record);}
  if(retained.length||scratch.length){const observed=this.observed.get(record.id);if(observed)observed.notice='有内部暂存尚未清理，请查看位置；编辑副本仍保留';}
 }
 private observe(record:Record){
  let item=this.observed.get(record.id);if(item)return item;
  if(this.observed.size>=16)return;
  item={editor:'idle',dirty:false,checking:false};this.observed.set(record.id,item);
  try{item.watcher=watch(dirname(record.file),{persistent:false},(_event,name)=>{if(name===null||String(name).toLowerCase()===basename(record.file).toLowerCase()){item!.dirty=true;this.schedule(record.id);}});item.watcher.on('error',()=>{item!.notice='自动检测暂不可用；返回 One 时会重新检查';item!.watcher?.close();item!.watcher=undefined;});}catch{item.notice='自动检测暂不可用；请检查变化';}
  return item;
 }
 private schedule(id:string){const item=this.observed.get(id);if(!item||this.stopped)return;clearTimeout(item.timer);item.timer=setTimeout(()=>{
  if(this.active||item.checking)return;
  item.dirty=false;item.checking=true;
  void this.action(()=>this.checked(id,false)).catch(error=>{const previous=item.view;if(previous){item.view={...previous,error:message(error)};this.changed(item.view);}}).finally(()=>{item.checking=false;});
 },700);item.timer.unref();}
 private async checked(id:string,force=true){
  const record=await this.read(id),item=this.observe(record);await this.cleanup(record).catch(()=>{if(item)item.notice='内部快照清理尚未完成，资料仍保留';});const info=await lstat(record.file,{bigint:true});
  const signature=`${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
  if(!force&&item?.signature===signature&&item.view){const view={...item.view,...this.view(record)};item.view=view;this.changed(view);return view;}
  const token=await this.fingerprint(record.file),view={...this.view(record),changed:!!record.missing||token!==record.baseline,token};
  if(item){item.signature=signature;item.view=view;}this.changed(view);return view;
 }
 list():Promise<ArchiveEditSessionPage>{return this.action(async()=>{
  await this.rootDirectory();const items:ArchiveEditSession[]=[];
  const entries=await opendir(this.root);let seen=0,truncated=false;
  try{for await(const entry of entries){if(++seen>256){truncated=true;break;}if(!uuid.test(entry.name))continue;
   try{const record=await this.read(entry.name);this.observe(record);items.push(await this.checked(entry.name,false));}catch(error){items.push({id:entry.name,archive:'',name:'无法读取的编辑资料',file:this.folder(entry.name),created:0,state:'writing',error:message(error)});}
  }}finally{await entries.close().catch(()=>{});}
  return{items:items.sort((a,b)=>b.created-a.created),truncated};
 });}
 check(id:string){return this.action(()=>this.checked(id));}
 start(owner:number,request:ArchiveEditStart,id?:string){return this.action(async()=>{
  id=this.operation(owner,id);
  if(!request||!text(request.path)||!isAbsolute(request.path)||!validArchiveRevision(request.revision)||!Number.isInteger(request.index)||request.index<0||request.index>=1000000)throw Error('请选择一个包内文件');
  const listing=await this.native(owner,{operation:'list',path:request.path,password:request.password,encoding:request.encoding,passwordEncoding:request.passwordEncoding},id);
  if(!('entries'in listing)||!listing.editable||listing.revision!==request.revision)throw Error('压缩包已变化或不支持编辑，请重新打开');
  const detail=await this.native(owner,{operation:'details',path:request.path,index:request.index,revision:request.revision,password:request.password,encoding:request.encoding,passwordEncoding:request.passwordEncoding},id);
  if(!('details'in detail)||!detail.details||detail.details.entry.directory)throw Error('请选择一个普通文件');
  const entry=detail.details.entry,name=entry.name.replaceAll('\\','/');if(entry.size>maxBytes)throw Error('外部编辑支持 256 MiB 以内的文件；请解压后处理');if(!safeName(name))throw Error('包内文件名称不能安全用于外部编辑');
  await this.rootDirectory();const existing=await opendir(this.root);let count=0;for await(const _entry of existing)if(++count>=16)throw Error('已有 16 份外部编辑资料，请先处理现有文件');
  const sessionId=randomUUID(),folder=this.folder(sessionId);await mkdir(folder);
  try{
   const staging=join(folder,'prepare-'+randomUUID());await mkdir(staging);await mkdir(join(folder,'edit'));
   const result=await this.native(owner,{operation:'extract',path:request.path,revision:request.revision,selected:[request.index],parent:staging,destination:'folder',password:request.password,encoding:request.encoding,passwordEncoding:request.passwordEncoding},id);
   if(!('count'in result)||result.cancelled||result.count!==1)throw Error('未能解出唯一的编辑文件');
   const extracted=this.extracted(staging,result.path,name);
   const record:Record={version:2,id:sessionId,archive:resolve(request.path),name,file:join(folder,'edit',basename(name)),created:Date.now(),state:'ready',revision:request.revision,baseline:'',encoding:request.encoding,passwordEncoding:request.passwordEncoding};
   record.baseline=await this.fingerprint(extracted);await rename(extracted,record.file);await rm(staging,{recursive:true,force:true});await this.persist(record);this.observe(record);
   return this.checked(sessionId);
  }catch(error){
   // No editor has been launched yet; these are exclusively extraction data.
   try{await this.directory(folder);await rm(folder,{recursive:true,force:true});}catch{throw Error(`${message(error)}\n临时资料保留在：${folder}`);}throw error;
  }
 });}
 private extracted(folder:string,path:string,name:string){const inside=relative(folder,path);if(!inside||inside.startsWith('..')||isAbsolute(inside))throw Error('编辑文件路径无效');return join(path,...name.split('/'));}
 open(id:string,choose=false){return this.action(async()=>{
  const record=await this.read(id);await this.fingerprint(record.file);const item=this.observe(record);if(!item)throw Error('编辑会话过多，请先结束其他编辑');
  if(item.editor==='running')throw Error('编辑程序仍在运行，请使用已打开的窗口');
  item.launch?.release();item.abort=new AbortController();
  const extension=extname(record.name).toLowerCase(),mode=choose?'choose':texts.has(extension)||!extension?'text':documents.has(extension)?'associated':'choose';
  item.launch=await this.launch(record.file,mode,item.abort.signal);item.editor=item.launch.tracked?'running':'untracked';item.notice=item.launch.tracked?'编辑程序正在运行；保存后可回到 One 确认写回':'程序可能复用了已有窗口；保存后回到 One 检查，结束前请自行关闭文件';
  await this.checked(id);
  void item.launch.exited.then(state=>{if(this.stopped||this.observed.get(id)!==item)return;item.editor=state==='closed'?'closed':'untracked';item.notice=state==='closed'?'已观察到编辑程序退出；部分程序可能仍在其他窗口编辑，请检查后写回':'无法确认文件窗口是否关闭；结束前请自行关闭文件';item.dirty=true;this.schedule(id);});
 });}
 save(owner:number,id:string,token:string,password?:string,taskId?:string){return this.action(async()=>{
  taskId=this.operation(owner,taskId);const record=await this.read(id);if(record.state==='writing')throw Error('此前写回结果尚未确认，请先核对原包');
  if(typeof token!=='string'||!digest.test(token)||token===record.baseline&&!record.missing)throw Error('编辑文件没有变化，请先保存外部程序中的修改');
  const snapshot=join(this.folder(id),'snapshot-'+randomUUID()+extname(record.file));let prepared=false,updating=false;
  try{
   record.state='writing';record.pending={file:basename(snapshot),token};await this.persist(record);prepared=true;
   if(await this.fingerprint(record.file,snapshot)!==token)throw Error('编辑内容在确认后已变化，请重新检查再写回');
   this.checkpoint();updating=true;
   const result=await this.native(owner,{operation:'update',path:record.archive,revision:record.revision,changes:[{kind:'add',source:snapshot,name:record.name,replace:true}],encoding:record.encoding,passwordEncoding:record.passwordEncoding,password},taskId);
   if(!('count'in result)||result.cancelled||!validArchiveRevision(result.revision))throw Error('写回结果尚未确认，请核对原包；编辑副本已保留');
   this.retire(record,record.pending!);record.state='saved';record.baseline=token;record.revision=result.revision!;record.conflict=false;record.missing=false;record.pending=undefined;await this.persist(record);
   await this.checked(id).catch(()=>{const item=this.observed.get(id);if(item){item.dirty=true;this.schedule(id);}});return result;
  }catch(error){
   if(prepared&&!updating){if((error as NodeJS.ErrnoException).code!=='EEXIST')this.retire(record,record.pending!);record.state='ready';record.pending=undefined;await this.persist(record).catch(()=>{});}
   if(updating){record.conflict=true;await this.persist(record).catch(()=>{});await this.checked(id).catch(()=>{});const detail=/archive changed|revision/i.test(message(error))?'原压缩包已经变化，写回已停止':message(error);throw Error(`${detail}\n编辑副本已保留；请使用“核对原包”确认结果或处理冲突`);}throw error;
  }finally{if(prepared&&!updating)await this.cleanup(record).catch(()=>{});}
 });}
 private async source(owner:number,record:Record,password:string|undefined,taskId:string){
  const search=Buffer.byteLength(record.name,'utf8')<=1024?record.name:basename(record.name);
  const request={operation:'list' as const,path:record.archive,password,encoding:record.encoding,passwordEncoding:record.passwordEncoding,browse:{directory:'',search,flat:true}};
  let listing=await this.native(owner,request,taskId);if(!('entries'in listing)||!listing.editable||!validArchiveRevision(listing.revision))throw Error('原包不支持继续编辑；可另存编辑副本');
  const revision=listing.revision!,matches:ArchiveListing['entries']=[];let examined=0;
  while(true){if(!('entries'in listing)||listing.revision!==revision)throw Error('核对时原包又发生变化，请重试');matches.push(...listing.entries.filter(entry=>entry.name.replaceAll('\\','/')===record.name));examined+=listing.entries.length;if(matches.length>1)throw Error('原包中存在同名条目，不能安全回写；请另存副本');
   if(examined>10000)throw Error('匹配条目过多，无法安全定位；请另存副本');const offset=listing.offset+listing.entries.length;if(!listing.entries.length||offset>=(listing.matched??listing.total))break;listing=await this.native(owner,{...request,offset},taskId);
  }
  const entry=matches[0];if(!entry)return{revision,missing:true,baseline:record.baseline};if(entry.directory||entry.size>maxBytes)throw Error('原条目已变为目录或过大，不能安全回写；请另存副本');
  if((record.scratch?.length||0)>=16)throw Error('待处理的核对资料过多，请先处理现有资料');const scratch='inspect-'+randomUUID(),parent=join(this.folder(record.id),scratch);record.scratch=[...(record.scratch||[]),scratch];await this.persist(record);await mkdir(parent);
  try{const result=await this.native(owner,{operation:'extract',path:record.archive,revision,selected:[entry.index],parent,destination:'folder',password,encoding:record.encoding,passwordEncoding:record.passwordEncoding},taskId);if(!('count'in result)||result.count!==1||result.cancelled)throw Error('无法核对原包条目');return{revision,missing:false,baseline:await this.fingerprint(this.extracted(parent,result.path,record.name))};}
  finally{await this.cleanup(record).catch(()=>{});}
 }
 inspect(owner:number,id:string,password?:string,taskId?:string){return this.action(async()=>{
  taskId=this.operation(owner,taskId);const record=await this.read(id),source=await this.source(owner,record,password,taskId);
  const committed=record.state==='writing'&&!!record.pending&&!source.missing&&source.baseline===record.pending.token;
  const resolution:Resolution={id,token:randomUUID(),archive:record.archive,name:record.name,missing:source.missing,same:!source.missing&&source.baseline===record.baseline,committed,revision:source.revision,baseline:source.baseline,previous:record.revision};
  this.resolutions.set(id,resolution);return{...resolution,revision:undefined,baseline:undefined,previous:undefined} as ArchiveEditResolution;
 });}
 resolve(owner:number,id:string,token:string,password?:string,taskId?:string){return this.action(async()=>{
  taskId=this.operation(owner,taskId);const resolution=this.resolutions.get(id);if(!resolution||resolution.token!==token)throw Error('核对结果已过期，请重新核对原包');const record=await this.read(id);if(record.revision!==resolution.previous)throw Error('编辑记录已变化，请重新核对');
  const listing=await this.native(owner,{operation:'list',path:record.archive,password,encoding:record.encoding,passwordEncoding:record.passwordEncoding},taskId);if(!('entries'in listing)||listing.revision!==resolution.revision)throw Error('原包在确认后又发生变化，请重新核对');
  const pending=record.pending;if(pending)this.retire(record,pending);record.revision=resolution.revision;record.baseline=resolution.committed?pending!.token:resolution.baseline;record.state=resolution.committed?'saved':'ready';record.conflict=false;record.missing=resolution.missing;record.pending=undefined;await this.persist(record);this.resolutions.delete(id);
  return this.checked(id);
 });}
 export(id:string,token:string,target:string){return this.action(async()=>{
  const record=await this.read(id);if(!text(target)||!isAbsolute(target)||relative(this.root,resolve(target))===''||!relative(this.root,resolve(target)).startsWith('..')&&!isAbsolute(relative(this.root,resolve(target))))throw Error('请选择编辑资料目录以外的位置');await this.directory(dirname(target));
  if(!digest.test(token))throw Error('请先检查编辑内容');const snapshot=join(this.folder(id),'snapshot-'+randomUUID()+extname(record.file));this.retire(record,{file:basename(snapshot),token});await this.persist(record);let created=false;
  try{if(await this.fingerprint(record.file)!==token)throw Error('编辑文件在确认后已变化，请重新检查');await copyFile(record.file,snapshot,constants.COPYFILE_EXCL);created=true;if(await this.fingerprint(snapshot)!==token)throw Error('编辑文件在确认后已变化，请重新检查');await copyFile(snapshot,target,constants.COPYFILE_EXCL);return target;}
  catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST'){if(!created){record.retired=record.retired!.filter(value=>value.file!==basename(snapshot));await this.persist(record);}throw Error('目标文件已存在，请选择其他名称以保留已有文件');}throw error;}
  finally{await this.cleanup(record).catch(()=>{});}
 });}
 discard(id:string,token:string){return this.action(async()=>{
  const record=await this.read(id),folder=this.folder(id);if(record.state==='writing')throw Error('写回结果尚未确认，请先核对原包或另存副本');await this.cleanup(record);if(await this.fingerprint(record.file)!==token)throw Error('编辑文件在确认后已变化，请重新检查');
  const expected=new Set(['session.json',record.version===1?basename(record.file):'edit']),names=await readdir(folder);if(names.some(name=>!expected.has(name))||record.version===2&&(await readdir(dirname(record.file))).some(name=>name!==basename(record.file)))throw Error('编辑目录还有其他资料，请先另存并手动处理');
  // Explicitly authorized flat files only. Never recursively delete user work.
  await rm(record.file);
  const observed=this.observed.get(id);observed?.abort?.abort();observed?.launch?.release();observed?.watcher?.close();clearTimeout(observed?.timer);this.observed.delete(id);this.resolutions.delete(id);
  if(record.version===2)await rmdir(dirname(record.file));await rm(join(folder,'session.json'));await rmdir(folder);
 });}
}
