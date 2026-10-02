export interface LevelAdjustment{action:'volume'|'brightness';delta:number;point:{x:number;y:number};generation:number}
/** Preserve wheel deltas, coalesce bursts and keep unrelated devices independent. */
export class AdjustmentQueue {
 private pending=new Map<string,LevelAdjustment>();private timers=new Map<string,ReturnType<typeof setTimeout>>();private running=new Set<string>();
 constructor(private apply:(item:LevelAdjustment)=>Promise<void>,private failed:(error:unknown,item:LevelAdjustment)=>void,private interval=24){}
 add(key:string,item:LevelAdjustment){const previous=this.pending.get(key);this.pending.set(key,{...item,delta:Math.max(-100,Math.min(100,item.delta+(previous?.generation===item.generation?previous.delta:0)))});this.schedule(key);}
 private schedule(key:string,delay=this.interval){if(this.timers.has(key)||this.running.has(key)||!this.pending.has(key))return;this.timers.set(key,setTimeout(()=>{this.timers.delete(key);void this.drain(key);},delay));}
 private async drain(key:string){const item=this.pending.get(key);if(!item)return;this.pending.delete(key);if(!item.delta)return;this.running.add(key);let delay=this.interval;try{await this.apply(item);}catch(error){delay=250;this.failed(error,item);}finally{this.running.delete(key);this.schedule(key,delay);}}
 clear(){this.pending.clear();for(const timer of this.timers.values())clearTimeout(timer);this.timers.clear();}
}
