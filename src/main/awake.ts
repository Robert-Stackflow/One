import {powerSaveBlocker,powerMonitor} from 'electron';
import {awakeEffective,defaultUtilities,type AwakeConfig,type AwakeState} from '../shared/utilities';

/** Requests expire with this process; no power-plan settings are written. */
export class AwakeService {
  private config=defaultUtilities().awake;
  private blocker:number|undefined;
  private display=false;
  private locked=false;
  private error='';
  private timer:NodeJS.Timeout;
  private lock=()=>{this.locked=true;this.reconcile();};
  private unlock=()=>{this.locked=false;this.reconcile();};
  private resume=()=>this.reconcile();
  constructor(private changed:()=>void){
    this.locked=powerMonitor.getSystemIdleState(1)==='locked';
    powerMonitor.on('lock-screen',this.lock);powerMonitor.on('unlock-screen',this.unlock);powerMonitor.on('resume',this.resume);
    this.timer=setInterval(()=>this.reconcile(),1000);this.timer.unref();
  }
  update(config:AwakeConfig){this.config={...config};this.reconcile();}
  private release(){if(this.blocker!==undefined){powerSaveBlocker.stop(this.blocker);this.blocker=undefined;}}
  private reconcile(){
    const {active,expired}=awakeEffective(this.config,this.locked);if(expired)this.config={...this.config,mode:'off'};
    try {if(!active)this.release();else if(this.blocker===undefined||this.display!==this.config.display){this.release();this.blocker=powerSaveBlocker.start(this.config.display?'prevent-display-sleep':'prevent-app-suspension');this.display=this.config.display;}this.error='';}
    catch(error){this.release();this.error=String(error);}
    this.changed();
  }
  state():AwakeState{return {...this.config,active:this.blocker!==undefined&&powerSaveBlocker.isStarted(this.blocker),locked:this.locked,remaining:awakeEffective(this.config,this.locked).remaining,error:this.error};}
  stop(){clearInterval(this.timer);this.release();powerMonitor.removeListener('lock-screen',this.lock);powerMonitor.removeListener('unlock-screen',this.unlock);powerMonitor.removeListener('resume',this.resume);}
}
