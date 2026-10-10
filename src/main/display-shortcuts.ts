import {defaultDisplayShortcuts,displayAccelerator,validateDisplayShortcuts,type DisplayShortcuts,type DisplayShortcutState} from '../shared/display-shortcuts';
import type {DisplayWriteResult} from '../shared/display-management';
interface Point {key:string;x:number;y:number}
interface Dependencies {register(key:string,callback:()=>void):boolean;unregister(key:string):void;point():Point;enabled():boolean;adjust(point:Point,delta:number,isCurrent:()=>boolean):Promise<DisplayWriteResult[]>;publish(state:DisplayShortcutState):void;complete(results:DisplayWriteResult[]):void}
export class DisplayShortcutController {
 private preferences=defaultDisplayShortcuts();private bindings=new Map<'increase'|'decrease',string>();private errors={increase:'',decrease:''};private operationError='';private paused=true;private stopped=false;private revision=0;private running=false;private queue:{point:Point;delta:number}[]=[];
 constructor(private dependencies:Dependencies){}
 state():DisplayShortcutState{return {increase:{active:this.bindings.has('increase'),error:this.errors.increase},decrease:{active:this.bindings.has('decrease'),error:this.errors.decrease},busy:this.running||!!this.queue.length,operationError:this.operationError};}
 private publish(){this.dependencies.publish(this.state());}
 configure(value:DisplayShortcuts){
  if(this.stopped)return;
  const next=validateDisplayShortcuts(value),same=(['increase','decrease'] as const).every(k=>displayAccelerator(next[k])===displayAccelerator(this.preferences[k])&&!this.errors[k]);this.preferences=next;
  if(same&&!this.paused){this.publish();return;}this.pause();this.paused=false;this.errors={increase:'',decrease:''};const revision=this.revision;
  for(const direction of ['increase','decrease'] as const){const key=displayAccelerator(next[direction]);if(!key)continue;try{if(!this.dependencies.register(key,()=>{if(this.revision===revision)this.trigger(direction);}))throw Error(`${direction==='increase'?'调亮':'调暗'}快捷键已被占用，请更换或重试`);this.bindings.set(direction,key);}catch(error){this.errors[direction]=error instanceof Error?error.message:'快捷键注册失败';}}
  this.publish();
 }
 pause(){this.revision++;this.paused=true;this.queue=[];for(const key of this.bindings.values())this.dependencies.unregister(key);this.bindings.clear();this.publish();}
 trigger(direction:'increase'|'decrease'){
  if(this.paused||this.stopped||!this.dependencies.enabled())return;
  try{const point=this.dependencies.point(),delta=this.preferences.step*(direction==='increase'?1:-1),prior=this.queue.find(job=>job.point.key===point.key);if(prior)prior.delta=Math.max(-100,Math.min(100,prior.delta+delta));else{if(this.queue.length>=16)throw Error('显示器快捷键操作过于频繁');this.queue.push({point,delta});}void this.drain();}
  catch(error){this.operationError=error instanceof Error?error.message:'亮度操作失败';this.publish();}
 }
 private async drain(){
  if(this.running||this.paused||this.stopped||!this.queue.length)return;const job=this.queue.shift()!;if(!job.delta){this.publish();void this.drain();return;}const revision=this.revision;this.running=true;this.operationError='';this.publish();
  const current=()=>!this.paused&&!this.stopped&&revision===this.revision&&this.dependencies.enabled();
  try{const results=await this.dependencies.adjust(job.point,job.delta,current);if(current()){const failed=results.filter(r=>r.error);this.operationError=failed.length?`${failed.length} 块屏幕调整失败，请重新检测`:'';this.dependencies.complete(results);}}
  catch(error){if(current())this.operationError=error instanceof Error?error.message:'亮度操作失败';}
  finally{this.running=false;this.publish();void this.drain();}
 }
 stop(){this.stopped=true;this.pause();}
}
