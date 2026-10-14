export type ScrollMotionAction={kind:'scroll';notches:number;probe:boolean}|{kind:'wait'}|{kind:'end'};
/** One outstanding movement. Never stack wheels while a page is still loading. */
export class ScrollMotion {
  private notches=1;
  private pixelsPerNotch=0;
  private started:number|undefined;
  private probeAt:number|undefined;
  private delivered=0;
  reset(){this.notches=1;this.pixelsPerNotch=0;this.started=this.probeAt=undefined;this.delivered=0;}
  action(now:number):ScrollMotionAction {
    if(this.started===undefined)return {kind:'scroll',notches:this.notches,probe:false};
    if(this.probeAt!==undefined)return now-this.probeAt>=4000?{kind:'end'}:{kind:'wait'};
    return now-this.started>=6000?{kind:'scroll',notches:1,probe:true}:{kind:'wait'};
  }
  sent(now:number,notches:number,probe:boolean){
    if(probe){this.probeAt=now;this.delivered+=notches;}
    else {this.started=now;this.probeAt=undefined;this.delivered=notches;}
  }
  accepted(offset:number,viewport:number){
    if(!Number.isFinite(offset)||offset<=0||!Number.isFinite(viewport)||viewport<64||!this.delivered){this.reset();return;}
    const observed=offset/this.delivered;
    this.pixelsPerNotch=this.pixelsPerNotch?Math.max(observed,this.pixelsPerNotch*.75+observed*.25):observed;
    const desired=Math.round(viewport*.45/this.pixelsPerNotch),overlapLimit=Math.floor(viewport*.65/this.pixelsPerNotch);
    this.notches=Math.max(1,Math.min(3,this.notches+1,desired,overlapLimit));
    this.started=this.probeAt=undefined;this.delivered=0;
  }
}
