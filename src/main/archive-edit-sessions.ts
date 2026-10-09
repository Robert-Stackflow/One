import {createHash,randomUUID} from 'node:crypto';
import {lstat,mkdir,open,opendir,readdir,readFile,rename,rm,rmdir} from 'node:fs/promises';
import {basename,dirname,extname,isAbsolute,join,resolve,relative} from 'node:path';
import type {ArchiveListing,ArchiveRequest,ArchiveResult} from '../shared/archive';
import type {ArchiveEditSession,ArchiveEditSessionPage,ArchiveEditStart} from '../shared/archive-edit-session';
import {validArchiveRevision} from '../shared/archive-revision';

type Record=ArchiveEditSession&{version:1;revision:string;baseline:string;encoding?:ArchiveEditStart['encoding'];passwordEncoding?:ArchiveEditStart['passwordEncoding']};
type Run=(owner:number,request:ArchiveRequest,id?:string)=>Promise<ArchiveListing|ArchiveResult>;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const digest=/^[a-f0-9]{64}$/;
const maxBytes=256*1024**2;
// Shell associations for programs/scripts can execute their contents. Keep this
// first editing surface limited to documents, text and images.
const extensions=new Set('.txt .md .markdown .json .xml .csv .log .ini .yaml .yml .css .sql .rtf .doc .docx .xls .xlsx .ppt .pptx .odt .ods .odp .pdf .svg .png .jpg .jpeg .gif .webp .bmp .ico'.split(' '));
const text=(value:unknown,max=32767):value is string=>typeof value==='string'&&!!value&&value.length<=max&&!/[\0\r\n]/.test(value);
const message=(error:unknown)=>error instanceof Error?error.message:String(error);

/** Persistent edit copies are user work, never a TTL cache. No secrets are saved. */
export class ArchiveEditSessions {
 private active?:Promise<unknown>;
 private control?:{owner:number;id:string;cancelled:boolean;native:boolean};
 private stopped=false;
 constructor(private root:string,private run:Run,private launch:(file:string)=>Promise<string>){this.root=resolve(root);}
 get pendingTasks(){return this.active?1:0;}
 async stop(){this.stopped=true;if(this.control)this.control.cancelled=true;await this.active?.catch(()=>{});}
 cancel(id:string,owner:number){const value=this.control;if(!value||value.id!==id||value.owner!==owner||value.native)return false;value.cancelled=true;return true;}
 private checkpoint(){if(this.stopped||this.control?.cancelled)throw Error('外部编辑操作已停止，编辑副本会保留');}
 private operation(owner:number,id:string= randomUUID()){if(typeof id!=='string'||!uuid.test(id))throw Error('外部编辑任务编号无效');this.control={owner,id,cancelled:false,native:false};return id;}
 private async native(owner:number,request:ArchiveRequest,id:string){this.checkpoint();this.control!.native=true;try{return await this.run(owner,request,id);}finally{this.control!.native=false;}}
 private action<T>(work:()=>Promise<T>):Promise<T>{
  if(this.stopped)return Promise.reject(Error('压缩服务正在关闭'));
  if(this.active)return Promise.reject(Error('外部编辑操作正在进行，请稍候'));
  const task=work();this.active=task;
  void task.finally(()=>{if(this.active===task){this.active=undefined;this.control=undefined;}}).catch(()=>{});return task;
 }
 private async directory(path:string){const info=await lstat(path);if(!info.isDirectory()||info.isSymbolicLink())throw Error('外部编辑目录已被替换，请保留资料并手动检查');}
 private async rootDirectory(){await this.directory(dirname(this.root));await mkdir(this.root,{recursive:true});await this.directory(this.root);}
 private folder(id:string){if(typeof id!=='string'||!uuid.test(id))throw Error('外部编辑标识无效');return join(this.root,id);}
 private async read(id:string):Promise<Record>{
  await this.rootDirectory();const folder=this.folder(id);await this.directory(folder);
  const file=join(folder,'session.json'),info=await lstat(file);
  if(!info.isFile()||info.isSymbolicLink()||info.size>256*1024)throw Error('外部编辑记录无效，请保留临时文件');
  const record=JSON.parse(await readFile(file,'utf8')) as Record;
  if(record.version!==1||record.id!==id||!text(record.archive)||!isAbsolute(record.archive)||!text(record.name)||record.name.split('/').some(part=>!part||part==='.'||part==='..'||/[\\:<>"|?*\x00-\x1f]|[. ]$/.test(part))||!validArchiveRevision(record.revision)||!digest.test(record.baseline)||!Number.isSafeInteger(record.created)||!['ready','writing','saved'].includes(record.state)||record.file!==join(folder,'document'+extname(record.name))||!extensions.has(extname(record.name).toLowerCase())||![undefined,0,437,932,936,950,65001].includes(record.encoding)||![undefined,0,437,932,936,950,65001].includes(record.passwordEncoding))throw Error('外部编辑记录无效，请保留临时文件');
  return record;
 }
 private async persist(record:Record){
  const folder=this.folder(record.id);await this.directory(folder);
  const temp=join(folder,'session.next');
  const handle=await open(temp,'wx');try{await handle.writeFile(JSON.stringify(record));await handle.sync();}finally{await handle.close();}
  await rename(temp,join(folder,'session.json'));
 }
 private async fingerprint(file:string,snapshot?:string){
  const info=await lstat(file,{bigint:true});if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1n||info.size>BigInt(maxBytes))throw Error('编辑文件无效、已被链接或超过 256 MiB；请另存文件');
  const input=await open(file,'r');let output:Awaited<ReturnType<typeof open>>|undefined;
  try{
   if(snapshot)output=await open(snapshot,'wx');
   // Windows lstat can report dev=0 while fstat reports the volume serial.
   // Compare exact 64-bit file IDs, not rounded JavaScript numbers.
   const before=await input.stat({bigint:true});if(before.ino!==info.ino)throw Error('编辑文件正在被替换，请保存完成后重试');
   const hash=createHash('sha256'),buffer=Buffer.allocUnsafe(1024*1024);let size=0;
   while(true){this.checkpoint();const {bytesRead}=await input.read(buffer,0,buffer.length,null);if(!bytesRead)break;size+=bytesRead;if(size>maxBytes)throw Error('编辑文件超过 256 MiB；请另存文件');hash.update(buffer.subarray(0,bytesRead));if(output){let offset=0;while(offset<bytesRead){const written=await output.write(buffer,offset,bytesRead-offset);if(!written.bytesWritten)throw Error('无法保存编辑快照');offset+=written.bytesWritten;}}}
   const after=await input.stat({bigint:true}),current=await lstat(file,{bigint:true});
   if(current.isSymbolicLink()||current.ino!==before.ino||after.size!==BigInt(size)||before.size!==after.size||before.mtimeNs!==after.mtimeNs||before.ctimeNs!==after.ctimeNs)throw Error('编辑文件仍在变化，请保存完成后重试');
   await output?.sync();return hash.digest('hex');
  }finally{await Promise.allSettled([input.close(),output?.close()]);}
 }
 private view(record:Record):ArchiveEditSession{const {id,archive,name,file,created,state}=record;return{id,archive,name,file,created,state};}
 list():Promise<ArchiveEditSessionPage>{return this.action(async()=>{
  await this.rootDirectory();const items:ArchiveEditSession[]=[];
  // Bound both metadata reads and returned records. Unknown directories are kept.
  const entries=await opendir(this.root);let seen=0,truncated=false;
  try{for await(const entry of entries){if(++seen>256){truncated=true;break;}if(!uuid.test(entry.name))continue;
   try{items.push(this.view(await this.read(entry.name)));}catch(error){items.push({id:entry.name,archive:'',name:'无法读取的编辑资料',file:this.folder(entry.name),created:0,state:'writing',error:message(error)});}
  }}finally{await entries.close().catch(()=>{});}
  return{items:items.sort((a,b)=>b.created-a.created),truncated};
 });}
 check(id:string){return this.action(async()=>{const record=await this.read(id),token=await this.fingerprint(record.file);return{...this.view(record),changed:token!==record.baseline,token};});}
 start(owner:number,request:ArchiveEditStart,id?:string){return this.action(async()=>{
  id=this.operation(owner,id);
  if(!request||!text(request.path)||!isAbsolute(request.path)||!validArchiveRevision(request.revision)||!Number.isInteger(request.index)||request.index<0||request.index>=1000000)throw Error('请选择一个包内文件');
  const listing=await this.native(owner,{operation:'list',path:request.path,password:request.password,encoding:request.encoding,passwordEncoding:request.passwordEncoding},id);
  if(!('entries'in listing)||!listing.editable||listing.revision!==request.revision)throw Error('压缩包已变化或不支持编辑，请重新打开');
  const detail=await this.native(owner,{operation:'details',path:request.path,index:request.index,revision:request.revision,password:request.password,encoding:request.encoding,passwordEncoding:request.passwordEncoding},id);
  if(!('details'in detail)||!detail.details||detail.details.entry.directory)throw Error('请选择一个普通文件');
  const entry=detail.details.entry;if(entry.size>maxBytes||!extensions.has(extname(entry.name).toLowerCase()))throw Error('外部编辑支持 256 MiB 以内的文档、文本和图片；其他文件请解压后处理');
  await this.rootDirectory();const existing=await opendir(this.root);let count=0;for await(const _entry of existing)if(++count>=16)throw Error('已有 16 份外部编辑资料，请先处理现有文件');
  const sessionId=randomUUID(),folder=this.folder(sessionId);await mkdir(folder);
  try{
   const result=await this.native(owner,{operation:'extract',path:request.path,revision:request.revision,selected:[request.index],parent:folder,destination:'folder',password:request.password,encoding:request.encoding,passwordEncoding:request.passwordEncoding},id);
   if(!('count'in result)||result.cancelled||result.count!==1)throw Error('未能解出唯一的编辑文件');
   const name=entry.name.replaceAll('\\','/'),extracted=join(result.path,...name.split('/'));const inside=relative(folder,extracted);if(!inside||inside.startsWith('..')||isAbsolute(inside))throw Error('编辑文件路径无效');
   const record:Record={version:1,id:sessionId,archive:resolve(request.path),name,file:join(folder,'document'+extname(name)),created:Date.now(),state:'ready',revision:request.revision,baseline:'',encoding:request.encoding,passwordEncoding:request.passwordEncoding};
   record.baseline=await this.fingerprint(extracted);await rename(extracted,record.file);await rm(result.path,{recursive:true,force:true});await this.persist(record);
   return this.view(record);
  }catch(error){
   // No editor has been launched yet, so these are exclusively extraction data.
   try{await this.directory(folder);await rm(folder,{recursive:true,force:true});}catch{throw Error(`${message(error)}\n临时资料保留在：${folder}`);}
   throw error;
  }
 });}
 open(id:string){return this.action(async()=>{const record=await this.read(id);await this.fingerprint(record.file);const error=await this.launch(record.file);if(error)throw Error('无法打开编辑文件：'+error);});}
 save(owner:number,id:string,token:string,password?:string,taskId?:string){return this.action(async()=>{
  taskId=this.operation(owner,taskId);
  const record=await this.read(id);if(record.state!=='ready')throw Error('此前写回结果尚未确认或已经保存，请另存编辑文件并重新打开原包');
  if(typeof token!=='string'||!digest.test(token)||token===record.baseline)throw Error('编辑文件没有变化，请先保存外部程序中的修改');
  const snapshot=join(this.folder(id),'snapshot-'+randomUUID()+extname(record.file));let updating=false;
  try{
   if(await this.fingerprint(record.file,snapshot)!==token)throw Error('编辑内容在确认后已变化，请重新检查再写回');
   record.state='writing';await this.persist(record);updating=true;
   const result=await this.native(owner,{operation:'update',path:record.archive,revision:record.revision,changes:[{kind:'add',source:snapshot,name:record.name,replace:true}],encoding:record.encoding,passwordEncoding:record.passwordEncoding,password},taskId);
   if(!('count'in result)||result.cancelled)throw Error('写回未完成，编辑副本已保留');
   // Close the session after one transaction. Other sessions retain the old
   // source revision and must never silently overwrite this transaction.
   record.state='saved';record.baseline=token;await this.persist(record);
   return result;
  }catch(error){if(updating&&record.state==='writing'){record.state='ready';await this.persist(record).catch(()=>{});}if(/archive changed|revision/i.test(message(error)))throw Error('原压缩包已经变化，写回已停止；请另存编辑副本并重新打开原包');throw error;}
  finally{await rm(snapshot,{force:true}).catch(()=>{});}
 });}
 discard(id:string,token:string){return this.action(async()=>{
  const record=await this.read(id),folder=this.folder(id);if(await this.fingerprint(record.file)!==token)throw Error('编辑文件在确认后已变化，请重新检查');
  const expected=new Set(['session.json',basename(record.file)]),names=await readdir(folder);if(names.some(name=>!expected.has(name)))throw Error('编辑目录还有其他资料，请先另存并手动处理');
  // Explicitly authorized, flat files only. Never recursively delete user work.
  await rm(record.file);await rm(join(folder,'session.json'));await rmdir(folder);
 });}
}
