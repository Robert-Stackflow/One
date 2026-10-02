/** Keep result data near the viewport; scrolling never queues the whole report. */
export class PagedRows<T> {
 private pages=new Map<number,{rows:T[];characters:number}>();
 private pending=new Set<number>();private wanted=new Set<number>();private failed=new Set<number>();
 private active=true;private disposed=false;private characters=0;
 constructor(private read:(page:number)=>Promise<T[]>,private changed:()=>void,private error:(error:unknown)=>void,readonly pageSize=100,private maximumPages=6,private maximumCharacters=2_000_000){}
 get(position:number){const page=Math.floor(position/this.pageSize),value=this.pages.get(page);if(!value)return;this.pages.delete(page);this.pages.set(page,value);return value.rows[position%this.pageSize];}
 demand(start:number,end:number){this.wanted=new Set<number>();for(let position=start;position<end;position+=this.pageSize)this.wanted.add(Math.floor(position/this.pageSize));if(end>start)this.wanted.add(Math.floor((end-1)/this.pageSize));this.prune();this.pump();}
 setActive(active:boolean){this.active=active;if(active){this.changed();this.pump();}}
 hasFailed(position:number){return this.failed.has(Math.floor(position/this.pageSize));}
 retry(){this.failed.clear();this.changed();this.pump();}
 private prune(){for(const [page,value]of this.pages){if(this.pages.size<=this.maximumPages&&this.characters<=this.maximumCharacters)break;if(this.wanted.has(page))continue;this.pages.delete(page);this.characters-=value.characters;}}
 private pump(){
  if(!this.active||this.disposed)return;
  for(const page of this.wanted){
   if(this.pending.size>=2)break;if(this.pages.has(page)||this.pending.has(page)||this.failed.has(page))continue;
   this.pending.add(page);
   void this.read(page).then(rows=>{
    if(this.disposed)return;
    // Avoid a second serialized copy of large diff blocks just to measure the cache.
    let characters=0;const measure=(value:unknown):void=>{if(typeof value==='string')characters+=value.length;else if(Array.isArray(value))value.forEach(measure);else if(value&&typeof value==='object')Object.values(value).forEach(measure);};rows.forEach(measure);
    this.pages.set(page,{rows,characters});this.characters+=characters;this.prune();if(this.active)this.changed();
   }).catch(error=>{if(this.disposed)return;this.failed.add(page);while(this.failed.size>12)this.failed.delete(this.failed.values().next().value!);if(this.active){this.changed();this.error(error);}}).finally(()=>{this.pending.delete(page);this.pump();});
  }
 }
 dispose(){this.disposed=true;this.wanted.clear();this.pages.clear();this.failed.clear();this.characters=0;}
}
