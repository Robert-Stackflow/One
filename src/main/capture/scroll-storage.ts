import {mkdtemp,realpath,writeFile,readFile,lstat,readdir,unlink,rmdir,opendir} from 'node:fs/promises';
import {readFileSync,lstatSync,openSync,closeSync,readSync,writeFileSync,renameSync,unlinkSync,statfsSync,fstatSync,realpathSync} from 'node:fs';
import {join,dirname,basename,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import type {ScrollStripStorage} from '../../shared/capture/scroll-stitch';
import {ScrollCaptureLimit} from '../../shared/capture/scroll-capture';

export interface ScrollDirectory {directory:string;parent:string;token:string}
export async function createScrollDirectory(base=tmpdir()):Promise<ScrollDirectory>{
  const parent=await realpath(base),directory=await mkdtemp(join(parent,'one-scroll-')),token=randomUUID();
  try{await writeFile(join(directory,'owner.json'),JSON.stringify({app:'One',kind:'scroll',schema:1,token,pid:process.pid,created:Date.now()}),{flag:'wx'});}catch(error){await unlink(join(directory,'owner.json')).catch(()=>{});await rmdir(directory).catch(()=>{});throw error;}return {directory,parent,token};
}
/** Scan a bounded namespace; an inaccessible or reused live PID keeps its files. */
export async function sweepScrollDirectories(base=tmpdir()){
  const parent=await realpath(base),result={checked:0,removed:0,kept:0},entries=await opendir(parent);let scanned=0;
  for await(const entry of entries){
    if(++scanned>4096||result.checked>=64)break;
    if(!entry.name.startsWith('one-scroll-')||!entry.isDirectory()||entry.isSymbolicLink())continue;
    result.checked++;const directory=join(parent,entry.name),file=join(directory,'owner.json');
    try{
      const item=await lstat(file);if(!item.isFile()||item.isSymbolicLink()||item.size>512){result.kept++;continue;}
      const owner=JSON.parse(await readFile(file,'utf8'));
      if(owner.app!=='One'||owner.kind!=='scroll'||owner.schema!==1||typeof owner.token!=='string'||!/^[0-9a-f-]{36}$/.test(owner.token)||!Number.isSafeInteger(owner.pid)||owner.pid<=0||!Number.isSafeInteger(owner.created)||owner.created<0||owner.created>Date.now()+60000){result.kept++;continue;}
      let dead=false;try{process.kill(owner.pid,0);}catch(error){dead=(error as NodeJS.ErrnoException).code==='ESRCH';}
      if(!dead){result.kept++;continue;}
      await cleanScrollDirectory({directory,parent,token:owner.token});result.removed++;
    }catch{result.kept++;}
  }
  return result;
}
export async function cleanScrollDirectory(lease:ScrollDirectory){
  const item=await lstat(lease.directory).catch(error=>{if(error.code==='ENOENT')return undefined;throw error;});if(!item)return;
  if(item.isSymbolicLink()||!item.isDirectory()||await realpath(lease.directory)!==resolve(lease.directory)||dirname(lease.directory)!==lease.parent||!basename(lease.directory).startsWith('one-scroll-'))throw Error('拒绝清理非本会话长截图目录');
  if((await lstat(join(lease.directory,'owner.json'))).isSymbolicLink()||JSON.parse(await readFile(join(lease.directory,'owner.json'),'utf8')).token!==lease.token)throw Error('长截图缓存所有权已改变');
  const names=await readdir(lease.directory);
  for(const name of names){if(name!=='owner.json'&&!/^\d+\.bgra(?:\.part)?$/.test(name))throw Error('长截图缓存存在非本会话文件');const file=await lstat(join(lease.directory,name));if(!file.isFile()||file.isSymbolicLink())throw Error('长截图缓存文件类型已改变');}
  for(const name of names)if(name!=='owner.json')await unlink(join(lease.directory,name));await unlink(join(lease.directory,'owner.json'));await rmdir(lease.directory);
}

/** Synchronous disk I/O belongs only to the dedicated stitch worker. */
export class ScrollDiskStorage implements ScrollStripStorage {
  private sizes=new Map<number,number>();private digests=new Map<number,string>();private serial=0;private used=0;
  constructor(private directory:string,private token:string,private limit=256*1024*1024){this.check();}
  private check(){if(lstatSync(this.directory).isSymbolicLink()||realpathSync(this.directory)!==resolve(this.directory)||lstatSync(join(this.directory,'owner.json')).isSymbolicLink()||JSON.parse(readFileSync(join(this.directory,'owner.json'),'utf8')).token!==this.token)throw Error('长截图缓存所有权无效');}
  get bytes(){return this.used;}
  put(pixels:Uint8Array){
    this.check();
    if(this.used+pixels.byteLength>this.limit)throw new ScrollCaptureLimit('长截图缓存达到磁盘预算，已有内容已保留。');
    const free=statfsSync(this.directory);if(free.bavail*free.bsize<pixels.byteLength+16*1024*1024)throw new ScrollCaptureLimit('磁盘空间不足，已有内容已保留。');
    const id=++this.serial,file=join(this.directory,id+'.bgra'),part=file+'.part';
    try{writeFileSync(part,pixels,{flag:'wx'});renameSync(part,file);}catch(error){try{unlinkSync(part);}catch{}if((error as NodeJS.ErrnoException).code==='ENOSPC'||(error as NodeJS.ErrnoException).code==='EDQUOT')throw new ScrollCaptureLimit('磁盘空间不足，已有内容已保留。');throw error;}
    this.sizes.set(id,pixels.byteLength);this.digests.set(id,createHash('sha256').update(pixels).digest('hex'));this.used+=pixels.byteLength;return id;
  }
  private load(id:number,indices?:number[],stride?:number){
    this.check();
    const size=this.sizes.get(id);if(size===undefined)throw Error('长截图条带已失效');const file=join(this.directory,id+'.bgra'),entry=lstatSync(file);if(entry.isSymbolicLink()||!entry.isFile()||entry.size!==size)throw Error('长截图条带已改变');
    if(indices&&(!Number.isSafeInteger(stride)||stride!<=0||indices.some(row=>!Number.isSafeInteger(row)||row<0||(row+1)*stride!>size)))throw Error('长截图预览行无效');
    const output=Buffer.allocUnsafeSlow(indices?indices.length*stride!:size),fd=openSync(file,'r');
    try{if(fstatSync(fd).size!==size)throw Error('长截图条带已改变');const rows=indices||[0],width=stride||size;for(let row=0;row<rows.length;row++){let read=0;while(read<width){const n=readSync(fd,output,row*width+read,width-read,rows[row]*width+read);if(!n)throw Error('长截图条带不完整');read+=n;}}if(!indices&&createHash('sha256').update(output).digest('hex')!==this.digests.get(id))throw Error('长截图条带校验失败');return new Uint8Array(output.buffer,output.byteOffset,output.byteLength);}catch(error){output.fill(0);throw error;}finally{closeSync(fd);}
  }
  read(id:number){return this.load(id);}
  rows(id:number,stride:number,indices:number[]){return this.load(id,indices,stride);}
  remove(id:number){this.check();const size=this.sizes.get(id);if(size===undefined)return;unlinkSync(join(this.directory,id+'.bgra'));this.sizes.delete(id);this.digests.delete(id);this.used-=size;}
  reset(){for(const id of this.sizes.keys())this.remove(id);}
}
