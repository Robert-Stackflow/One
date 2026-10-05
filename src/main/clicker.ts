import type {ClickerConfig,ClickerState} from '../shared/utilities';
import {cursorPosition,foreground,mouseClick,setCursorPosition} from './native';

/** Owns the native mouse timer so a renderer close cannot leave clicking behind. */
export class ClickerService {
  private config:ClickerConfig;
  private timer:NodeJS.Timeout|undefined;
  private running=false;
  private clicks=0;
  private error='';
  private lastReported=0;
  constructor(config:ClickerConfig,private readonly changed:()=>void){this.config={...config};}
  state():ClickerState{return {running:this.running,clicks:this.clicks,remaining:this.config.repeat?Math.max(0,this.config.repeat-this.clicks):0,error:this.error};}
  update(config:ClickerConfig){
    this.config={...config};
    if(this.running)this.stop('设置已更新，连点已停止');
    else this.changed();
  }
  capture(){return cursorPosition();}
  start(){
    if(this.running)return this.state();
    if(!this.config.enabled)throw new Error('请先开启鼠标连点');
    if(foreground(true)?.password)throw new Error('密码输入时不能启动鼠标连点');
    this.running=true;this.clicks=0;this.error='';this.changed();this.schedule(0);return this.state();
  }
  toggle(){return this.running?this.stop():this.start();}
  stop(reason=''){
    if(this.timer){clearTimeout(this.timer);this.timer=undefined;}
    this.running=false;if(reason)this.error=reason;this.changed();return this.state();
  }
  private schedule(delay:number){this.timer=setTimeout(()=>this.tick(),delay);this.timer.unref();}
  private tick(){
    if(!this.running)return;
    try{
      if(foreground(true)?.password){this.stop('检测到密码输入，已停止连点');return;}
      const original=this.config.target==='fixed'&&this.config.restore?cursorPosition():undefined;
      if(this.config.target==='fixed')setCursorPosition(this.config.x,this.config.y);
      mouseClick(this.config.button,this.config.double,this.config.method);
      if(original)setCursorPosition(original.x,original.y);
      this.clicks++;
      if(this.config.repeat&&this.clicks>=this.config.repeat){this.stop();return;}
      if(Date.now()-this.lastReported>200){this.lastReported=Date.now();this.changed();}
      this.schedule(this.config.intervalMs);
    }catch(error){this.stop(error instanceof Error?error.message:String(error));}
  }
}
