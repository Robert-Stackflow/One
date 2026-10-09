type Limits={heartbeatMs:number;idleMs:number};
/** A live heartbeat alone does not prove that the archive engine is advancing. */
export class ArchiveWatchdog {
 private timer:ReturnType<typeof setTimeout>|undefined;
 private alive:number;private advancing:number;private activity=-1;private closed=false;
 constructor(private limits:Limits,private exempt:()=>boolean,private failed:(reason:'heartbeat'|'idle')=>void,private now:()=>number=()=>performance.now()){
  this.alive=this.advancing=this.now();this.arm();
 }
 heartbeat(activity:number){
  if(!Number.isSafeInteger(activity)||activity<0||activity<this.activity)throw Error('归档心跳无效');
  this.alive=this.now();if(activity!==this.activity){this.activity=activity;this.advancing=this.alive;}this.arm();
 }
 progress(){this.advancing=this.now();this.arm();}
 close(){this.closed=true;if(this.timer)clearTimeout(this.timer);this.timer=undefined;}
 private arm(){
  if(this.closed)return;if(this.timer)clearTimeout(this.timer);
  const now=this.now(),delay=Math.max(1,Math.min(this.alive+this.limits.heartbeatMs,this.advancing+this.limits.idleMs)-now);
  this.timer=setTimeout(()=>{
   if(this.exempt()){this.alive=this.advancing=this.now();this.arm();return;}
   const now=this.now();if(now-this.alive>=this.limits.heartbeatMs){this.close();this.failed('heartbeat');}
   else if(now-this.advancing>=this.limits.idleMs){this.close();this.failed('idle');}else this.arm();
  },delay);
 }
}
export function archiveWatchdogLimits():Limits{
 const test=process.env.ONE_TEST_MODE==='1';
 const value=(name:string,fallback:number)=>{const text=process.env[name];if(!test||!text)return fallback;const value=Number(text);return Number.isInteger(value)&&value>=50&&value<=3000?value:fallback;};
 return {heartbeatMs:value('ONE_ARCHIVE_HEARTBEAT_TIMEOUT_MS',30000),idleMs:value('ONE_ARCHIVE_IDLE_TIMEOUT_MS',1800000)};
}
