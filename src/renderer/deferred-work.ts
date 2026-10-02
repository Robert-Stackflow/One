/** Debounce automatic work, retaining edits while its page or window is inactive. */
export class DeferredWork {
 private dirty=false;
 private running=false;
 private timer?:ReturnType<typeof setTimeout>;
 constructor(private delay:number,private available:()=>boolean,private work:()=>Promise<void>,private error:(error:unknown)=>void){}
 request(){this.dirty=true;this.sync();}
 clear(){this.dirty=false;clearTimeout(this.timer);this.timer=undefined;}
 sync(){
  clearTimeout(this.timer);this.timer=undefined;
  if(!this.dirty||this.running||!this.available())return;
  this.timer=setTimeout(()=>{
   this.timer=undefined;if(!this.available())return;
   this.dirty=false;this.running=true;
   void this.work().catch(this.error).finally(()=>{this.running=false;this.sync();});
  },this.delay);
 }
}
