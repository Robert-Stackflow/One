/** Bounded, shared Shell icon cache. Icon lookup never delays search results or menus. */
export class FileIcons {
 private cache=new Map<string,{image:string;expires:number}>();
 private pending=new Map<string,Promise<string>>();
 private queue:Array<()=>void>=[];private active=0;
 constructor(private readIcon:(path:string)=>Promise<string>,private limit=768,private concurrency=4){}
 cached(path:string){const value=this.cache.get(path.toLowerCase());return value&&value.expires>Date.now()?value.image:'';}
 async read(paths:string[]):Promise<Record<string,string>>{return Object.fromEntries(await Promise.all([...new Set(paths)].map(async path=>[path,await this.icon(path)])));}
 private icon(path:string):Promise<string>{
  const key=path.toLowerCase(),cached=this.cache.get(key);
  if(cached&&cached.expires>Date.now()){this.cache.delete(key);this.cache.set(key,cached);return Promise.resolve(cached.image);}
  this.cache.delete(key);const existing=this.pending.get(key);if(existing)return existing;
  if(this.pending.size>=512)return Promise.resolve('');
  let finish!:(image:string)=>void;const promise=new Promise<string>(resolve=>{finish=resolve;});this.pending.set(key,promise);
  this.queue.push(()=>{this.active++;void Promise.resolve().then(()=>this.readIcon(path)).catch(()=>'').then(image=>{
   this.cache.set(key,{image,expires:Date.now()+(image?600_000:30_000)});
   while(this.cache.size>this.limit)this.cache.delete(this.cache.keys().next().value!);
   finish(image);
  }).finally(()=>{this.pending.delete(key);this.active--;this.drain();});});this.drain();return promise;
 }
 private drain(){while(this.active<this.concurrency&&this.queue.length)this.queue.shift()!();}
}
