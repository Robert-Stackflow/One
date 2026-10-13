import {captureShortcutDefinitions,captureAccelerator,defaultCaptureShortcuts,validateCaptureShortcuts,type CaptureShortcutAction,type CaptureShortcuts,type CaptureShortcutState} from '../../shared/capture/shortcuts';

interface Dependencies {
  register(key:string,run:()=>void):boolean;unregister(key:string):void;
  conflict(key:string):string|undefined;enabled():boolean;
  run(action:CaptureShortcutAction):Promise<unknown>;failed(error:unknown):void;
  publish(state:CaptureShortcutState):void;
}
/** One owns registration; no action ever unregisters another feature's hotkeys. */
export class CaptureShortcutController {
  private preferences=defaultCaptureShortcuts();
  private bindings=new Map<CaptureShortcutAction,string>();
  private errors=new Map<CaptureShortcutAction,string>();
  private paused=true;
  private stopped=false;
  private revision=0;
  constructor(private dependencies:Dependencies){}
  state():CaptureShortcutState{return {paused:this.paused,entries:Object.fromEntries(captureShortcutDefinitions.map(({id})=>[id,{active:this.bindings.has(id),error:this.errors.get(id)||''}])) as CaptureShortcutState['entries']};}
  private publish(){this.dependencies.publish(this.state());}
  configure(value:CaptureShortcuts){
    if(this.stopped)return;
    const next=validateCaptureShortcuts(value),same=captureShortcutDefinitions.every(({id})=>captureAccelerator(next[id])===captureAccelerator(this.preferences[id]));
    this.preferences=next;
    if(same&&!this.paused&&!this.errors.size&&!captureShortcutDefinitions.some(({id})=>next[id]&&this.dependencies.conflict(captureAccelerator(next[id])))){this.publish();return;}
    this.pause();this.paused=false;this.errors.clear();const revision=this.revision;
    for(const {id,label} of captureShortcutDefinitions){
      const key=captureAccelerator(next[id]);if(!key)continue;
      try{
        const duplicate=captureShortcutDefinitions.find(item=>this.bindings.get(item.id)===key);
        const owner=duplicate?.label||this.dependencies.conflict(key);
        if(owner)throw Error(`One 的「${owner}」正在使用此快捷键`);
        if(!this.dependencies.register(key,()=>{if(this.revision===revision)this.trigger(id);}))throw Error(`${label}快捷键已被其他程序或 One 功能占用，请更换或重试`);
        this.bindings.set(id,key);
      }catch(error){this.errors.set(id,error instanceof Error?error.message:'快捷键注册失败');}
    }
    this.publish();
  }
  pause(){this.revision++;this.paused=true;for(const key of this.bindings.values())this.dependencies.unregister(key);this.bindings.clear();this.publish();}
  trigger(action:CaptureShortcutAction){
    if(this.stopped||this.paused||!this.bindings.has(action)||!this.dependencies.enabled())return;
    try{void this.dependencies.run(action).catch(error=>this.dependencies.failed(error));}catch(error){this.dependencies.failed(error);}
  }
  stop(){this.stopped=true;this.pause();}
}
