import {join,basename,dirname,resolve} from 'node:path';
import type {FileEntry} from './types';
export interface DirectoryInfo {id:string;path:string;count:number;position:number}
export interface DirectoryEntry extends FileEntry {index:number}
export interface DirectoryPage {entries:DirectoryEntry[];offset:number;total:number;query:string}
export interface DirectoryName {name:string;directory:boolean}
/** Keep a shared path once; materialize full paths only for requested pages. */
export class DirectoryIndex {
 private matches=new Map<string,Uint32Array>();readonly count:number;
 constructor(readonly path:string,private names:DirectoryName[]){
  const collator=new Intl.Collator(undefined,{numeric:true});names.sort((a,b)=>Number(b.directory)-Number(a.directory)||collator.compare(a.name,b.name));this.count=names.length;
 }
 find(path:string){if(dirname(resolve(path)).toLocaleLowerCase()!==resolve(this.path).toLocaleLowerCase())return -1;const name=basename(path),exact=this.names.findIndex(entry=>entry.name===name);return exact>=0?exact:this.names.findIndex(entry=>entry.name.toLocaleLowerCase()===name.toLocaleLowerCase());}
 page(offset:number,limit:number,query=''):DirectoryPage {
  if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>256||typeof query!=='string'||query.length>1000)throw new Error('目录范围无效');
  const term=query.toLocaleLowerCase();let indices:Uint32Array|undefined;
  if(term){indices=this.matches.get(term);if(!indices){const buffer=new Uint32Array(this.count);let count=0;for(let i=0;i<this.count;i++)if(this.names[i].name.toLocaleLowerCase().includes(term))buffer[count++]=i;indices=buffer.slice(0,count);this.matches.set(term,indices);while(this.matches.size>2)this.matches.delete(this.matches.keys().next().value!);}}
  const total=indices?.length??this.count,entries:DirectoryEntry[]=[];for(let position=offset;position<Math.min(total,offset+limit);position++){const index=indices?indices[position]:position,entry=this.names[index];entries.push({...entry,index,path:join(this.path,entry.name)});}return{entries,offset,total,query};
 }
}
