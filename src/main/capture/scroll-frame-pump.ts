import type {PixelFrame} from '../../shared/capture/scroll-stitch';

/** Capture and matching have separate clocks. Preserve intermediate frames in
 * order, with bounded backpressure; never silently skip a bridge frame. */
export class ScrollFramePump {
  private frames:PixelFrame[]=[];
  private wake=new Set<()=>void>();
  private stopped=false;
  private ended=false;
  private error:unknown;
  private task:Promise<void>;
  readonly capacity:number;
  constructor(bytes:number,private capture:()=>Promise<PixelFrame>,private active:()=>boolean){
    this.capacity=Math.max(1,Math.min(16,Math.floor(96*1024*1024/bytes)));
    this.task=this.produce();
  }
  private signal(){for(const wake of this.wake)wake();this.wake.clear();}
  private wait(){return new Promise<void>(resolve=>this.wake.add(resolve));}
  private async produce(){
    try{
      while(!this.stopped&&this.active()){
        if(this.frames.length>=this.capacity){await this.wait();continue;}
        const started=performance.now(),frame=await this.capture();
        if(this.stopped||!this.active()){frame.pixels.fill(0);break;}
        this.frames.push(frame);this.signal();
        const delay=16-(performance.now()-started);
        if(delay>0)await new Promise(resolve=>setTimeout(resolve,delay));
      }
    }catch(error){if(!this.stopped&&this.active())this.error=error;}
    finally{this.ended=true;this.signal();}
  }
  async next(){
    while(!this.stopped&&this.active()){
      const frame=this.frames.shift();if(frame){this.signal();return frame;}
      if(this.ended){if(this.error)throw this.error;return;}
      await this.wait();
    }
  }
  async nextBatch(){const first=await this.next();if(!first)return;const batch=[first,...this.frames.splice(0)];this.signal();return batch;}
  async close(){
    this.stopped=true;this.signal();await this.task;
    for(const frame of this.frames)frame.pixels.fill(0);this.frames=[];
  }
}
