import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {join} from 'node:path';
import type {DisplayBrightness,Settings} from '../shared/types';
import type {LevelState} from '../shared/hud';
type Corner=keyof Settings['corners'];
/** Core Audio, display I/O and corner sampling run on separate native threads. */
class LevelsService {
 private child?:ChildProcessWithoutNullStreams;private sequence=0;private desired=false;private restart?:NodeJS.Timeout;
 private pending=new Map<number,{resolve(value:DisplayBrightness):void;reject(error:Error):void;timer:NodeJS.Timeout}>();
 private cornerHandler?:(corner:Corner)=>void;private config='corners 0 650 12 1200';private quickConfig='';private levelHandler?:(level:LevelState)=>void;private errorHandler?:(error:string)=>void;
 private start(){clearTimeout(this.restart);if(this.child)return this.child;
  const child=this.child=spawn(join(__dirname,'../native/One.Levels.exe').replace('app.asar\\','app.asar.unpacked\\'),[],{windowsHide:true,stdio:'pipe'});let buffer='';
  child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{buffer+=chunk;if(buffer.length>65536){this.fail(new Error('原生调节服务响应无效'),child);return;}let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);try{const message=JSON.parse(line);if(message.corner){if(['TL','TR','BL','BR'].includes(message.corner))this.cornerHandler?.(message.corner);continue;}if(message.level){const l=message.level;if(['volume','brightness'].includes(l.action)&&Number.isFinite(l.value)&&l.value>=0&&l.value<=100)this.levelHandler?.(l);continue;}if(message.levelError){this.errorHandler?.(String(message.levelError));continue;}const item=this.pending.get(message.id);if(!item)continue;clearTimeout(item.timer);this.pending.delete(message.id);if(message.error)item.reject(new Error(message.error));else item.resolve(message.result);}catch{}}});
  child.stderr.resume();child.stdin.on('error',error=>this.fail(error,child));child.on('error',error=>this.fail(error,child));child.on('exit',()=>this.fail(new Error('原生调节服务已退出'),child));child.stdin.write(this.config+'\n'+(this.quickConfig?this.quickConfig+'\n':''));return child;
 }
 private fail(error:Error,child:ChildProcessWithoutNullStreams){if(this.child!==child)return;this.child=undefined;for(const item of this.pending.values()){clearTimeout(item.timer);item.reject(error);}this.pending.clear();child.kill();if(this.desired){this.restart=setTimeout(()=>this.start(),800);this.restart.unref();}}
 request(action:'volume'|'brightness',point:{x:number;y:number},delta?:number):Promise<DisplayBrightness>{const child=this.start();return new Promise((resolve,reject)=>{const id=++this.sequence,timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(action==='brightness'?'显示器响应超时':'音频设备响应超时'));},action==='brightness'?10000:2500);this.pending.set(id,{resolve,reject,timer});child.stdin.write(`${action} ${id} ${Math.round(point.x)} ${Math.round(point.y)} ${delta??0} ${delta===undefined?1:0}\n`);});}
 corners(settings:Settings,blocked:boolean,callback:(corner:Corner)=>void){this.cornerHandler=callback;const mask=blocked?0:(['TL','TR','BL','BR'] as const).reduce((n,c,i)=>n|(settings.corners[c]!=='off'?1<<i:0),0);this.desired=!!mask||settings.edgeScroll||Object.entries(settings.quickActions).some(([key,value])=>key!=='volumeStep'&&value===true);this.config=`corners ${mask} ${settings.dwellMs} ${settings.cornerPixels} ${settings.cooldownMs}`;if(this.desired||this.child)this.start().stdin.write(this.config+'\n');else clearTimeout(this.restart);}
 quick(settings:Settings,blocked:boolean,callback:(level:LevelState)=>void,onError:(error:string)=>void){this.levelHandler=callback;this.errorHandler=onError;const q=settings.quickActions,mask=[q.volume,q.copy,q.paste,q.move,q.naturalScroll].reduce((n,enabled,i)=>n|(enabled?1<<i:0),0),edges=(['top','right','bottom','left'] as const).map(key=>{const e=settings.edges[key];return `${settings.edgeScroll?e.action==='volume'?1:e.action==='brightness'?2:0:0} ${e.step}`;}).join(' ');const excluded=Buffer.from(settings.excludedApps.replace(/[;\n]/g,','),'utf8').toString('hex')||'-';this.quickConfig=`quick ${mask} ${q.volumeStep} ${blocked?1:0} ${settings.pauseFullscreen?1:0} ${process.pid} ${settings.edgePixels} ${edges} ${excluded}`;if(this.desired||this.child)this.start().stdin.write(this.quickConfig+'\n');}
 suppress(){this.child?.stdin.write('suppress\n');}
 warm(){this.start();}
 stop(){this.desired=false;clearTimeout(this.restart);const child=this.child;this.cornerHandler=undefined;this.levelHandler=undefined;this.errorHandler=undefined;if(child){this.fail(new Error('调节服务已停止'),child);}}
}
export const levels=new LevelsService();
