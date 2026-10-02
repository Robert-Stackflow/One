import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {join} from 'node:path';
import type {DisplayBrightness,Settings} from '../shared/types';
type Corner=keyof Settings['corners'];
/** Core Audio, display I/O and corner sampling run on separate native threads. */
class LevelsService {
 private child?:ChildProcessWithoutNullStreams;private sequence=0;private desired=false;private restart?:NodeJS.Timeout;
 private pending=new Map<number,{resolve(value:DisplayBrightness):void;reject(error:Error):void;timer:NodeJS.Timeout}>();
 private cornerHandler?:(corner:Corner)=>void;private config='corners 0 650 12 1200';
 private start(){clearTimeout(this.restart);if(this.child)return this.child;
  const child=this.child=spawn(join(__dirname,'../native/One.Levels.exe').replace('app.asar\\','app.asar.unpacked\\'),[],{windowsHide:true,stdio:'pipe'});let buffer='';
  child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{buffer+=chunk;if(buffer.length>65536){this.fail(new Error('原生调节服务响应无效'),child);return;}let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);try{const message=JSON.parse(line);if(message.corner){if(['TL','TR','BL','BR'].includes(message.corner))this.cornerHandler?.(message.corner);continue;}const item=this.pending.get(message.id);if(!item)continue;clearTimeout(item.timer);this.pending.delete(message.id);if(message.error)item.reject(new Error(message.error));else item.resolve(message.result);}catch{}}});
  child.stderr.resume();child.stdin.on('error',error=>this.fail(error,child));child.on('error',error=>this.fail(error,child));child.on('exit',()=>this.fail(new Error('原生调节服务已退出'),child));child.stdin.write(this.config+'\n');return child;
 }
 private fail(error:Error,child:ChildProcessWithoutNullStreams){if(this.child!==child)return;this.child=undefined;for(const item of this.pending.values()){clearTimeout(item.timer);item.reject(error);}this.pending.clear();child.kill();if(this.desired){this.restart=setTimeout(()=>this.start(),800);this.restart.unref();}}
 request(action:'volume'|'brightness',point:{x:number;y:number},delta?:number):Promise<DisplayBrightness>{const child=this.start();return new Promise((resolve,reject)=>{const id=++this.sequence,timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(action==='brightness'?'显示器响应超时':'音频设备响应超时'));},action==='brightness'?10000:2500);this.pending.set(id,{resolve,reject,timer});child.stdin.write(`${action} ${id} ${Math.round(point.x)} ${Math.round(point.y)} ${delta??0} ${delta===undefined?1:0}\n`);});}
 corners(settings:Settings,blocked:boolean,callback:(corner:Corner)=>void){this.cornerHandler=callback;const mask=blocked?0:(['TL','TR','BL','BR'] as const).reduce((n,c,i)=>n|(settings.corners[c]!=='off'?1<<i:0),0);this.desired=!!mask||settings.edgeScroll;this.config=`corners ${mask} ${settings.dwellMs} ${settings.cornerPixels} ${settings.cooldownMs}`;if(this.desired||this.child)this.start().stdin.write(this.config+'\n');else clearTimeout(this.restart);}
 suppress(){this.child?.stdin.write('suppress\n');}
 warm(){this.start();}
 stop(){this.desired=false;clearTimeout(this.restart);const child=this.child;this.cornerHandler=undefined;if(child){this.fail(new Error('调节服务已停止'),child);}}
}
export const levels=new LevelsService();
