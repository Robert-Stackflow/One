import {api} from './ui';
import type {DirectoryInfo,DirectoryPage,DirectoryEntry} from '../shared/directory';
export class DirectoryPages {
 private cache=new Map<string,DirectoryPage>();private pending=new Map<string,Promise<DirectoryPage>>();private failed=new Map<string,Error>();private active=new Set<string>();private disposed=false;readonly size=128;
 constructor(private changed:()=>void,private error:(error:Error)=>void){}
 add(info:DirectoryInfo){this.active.add(info.id);}
 get(info:DirectoryInfo,position:number,query=''):DirectoryEntry|undefined {
  const offset=Math.floor(position/this.size)*this.size,key=info.id+'|'+query+'|'+offset,page=this.cache.get(key);if(page){this.cache.delete(key);this.cache.set(key,page);return page.entries[position-offset];}void this.read(info,offset,query).catch(()=>{});return;
 }
 read(info:DirectoryInfo,offset:number,query=''){
  const key=info.id+'|'+query+'|'+offset,cached=this.cache.get(key);if(cached)return Promise.resolve(cached);const pending=this.pending.get(key);if(pending)return pending;const failure=this.failed.get(key);if(failure)return Promise.reject(failure);
  const request=api.directoryPage(info.id,offset,this.size,query).then(page=>{if(!this.disposed&&this.active.has(info.id)){this.cache.set(key,page);while(this.cache.size>12)this.cache.delete(this.cache.keys().next().value!);this.changed();}return page;}).catch(error=>{if(!this.disposed&&this.active.has(info.id)){this.failed.set(key,error);while(this.failed.size>12)this.failed.delete(this.failed.keys().next().value!);this.error(error);}throw error;}).finally(()=>this.pending.delete(key));this.pending.set(key,request);return request;
 }
 forget(id:string){this.active.delete(id);for(const map of [this.cache,this.failed])for(const key of map.keys())if(key.startsWith(id+'|'))map.delete(key);}
 dispose(){this.disposed=true;this.active.clear();this.cache.clear();this.failed.clear();this.pending.clear();}
}
