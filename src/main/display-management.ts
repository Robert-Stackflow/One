import {validateDisplayProfile,type DisplayProfile,type DisplayProfileCapture,type DisplayProfileResult} from '../shared/display-profiles';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {displayParameters,defaultDisplayPreferences,type DisplayPreferences,type DisplayWriteResult,type DisplayParameter,type DisplayControl,type ManagedDisplay} from '../shared/display-management';
type NativeDisplay=Omit<ManagedDisplay,'id'|'controls'|'error'>&{path:string;key:string};
type Invoke=(args:string[],signal:AbortSignal)=>Promise<unknown>;
type Job={key:string;run:()=>Promise<unknown>;resolve:((value:any)=>void)[];reject:((error:Error)=>void)[];epoch:number};
const execute=promisify(execFile);
const invalid=()=>Error('显示器服务返回的数据无效，请刷新后重试');
function control(raw:any):DisplayControl {
 if(!raw||typeof raw.supported!=='boolean'||typeof raw.method!=='string'||raw.method.length>80||typeof raw.error!=='string'||raw.error.length>512)throw invalid();
 if(raw.supported&&(!Number.isInteger(raw.value)||raw.value<0||raw.value>100||!Number.isInteger(raw.minimum)||raw.minimum<0||!Number.isInteger(raw.maximum)||raw.maximum>0xffffffff||raw.maximum<=raw.minimum||!Number.isInteger(raw.raw)||raw.raw<raw.minimum||raw.raw>raw.maximum))throw invalid();
 return {supported:raw.supported,method:raw.method,error:raw.error,...(raw.supported?{value:raw.value,minimum:raw.minimum,maximum:raw.maximum,raw:raw.raw}:{})};
}
export class DisplayManagementService {
 private helper=join(__dirname,'../native/One.Display.exe').replace('app.asar\\','app.asar.unpacked\\');
 private rows=new Map<string,NativeDisplay&{controls?:Record<DisplayParameter,DisplayControl>}>();
 private queue:Job[]=[];private active?:Job;private controller?:AbortController;private epoch=0;private stopped=false;
 constructor(private changed:()=>void=()=>{},private invoke:Invoke=async(args,signal)=>{
  try{const {stdout}=await execute(this.helper,args,{windowsHide:true,timeout:8000,maxBuffer:128*1024,encoding:'utf8',signal});return JSON.parse(stdout);}
  catch(error){signal.throwIfAborted();throw Error((error as {killed?:boolean}).killed?'显示器操作超时；设置可能已发送，请重新检测。':'显示器服务暂时不可用，请重新检测。');}
 },private preferences:()=>DisplayPreferences=defaultDisplayPreferences){}
 private async call(args:string[]){
  const raw=await this.invoke(args,this.controller!.signal) as any;
  if(raw?.error)throw Error(typeof raw.error==='string'?raw.error.slice(0,512):'显示器接口不可用');return raw;
 }
 private enqueue<T>(key:string,run:()=>Promise<T>):Promise<T>{
  if(this.stopped)return Promise.reject(Error('显示器管理已停止'));
  const prior=key.startsWith('set:')?this.queue.find(job=>job.key===key):undefined;
  if((prior?.resolve.length||0)>=64||(!prior&&this.queue.length>=16))return Promise.reject(Error('显示器操作过于频繁，请稍后重试'));
  return new Promise<T>((resolve,reject)=>{
   if(prior){prior.run=run;prior.resolve.push(resolve);prior.reject.push(reject);}
   else this.queue.push({key,run,resolve:[resolve],reject:[reject],epoch:this.epoch});
   void this.drain();
  });
 }
 private async drain(){
  if(this.active||!this.queue.length||this.stopped)return;
  const job=this.active=this.queue.shift()!;const controller=this.controller=new AbortController();
  try{const result=await job.run();if(job.epoch!==this.epoch||controller.signal.aborted)throw Error('显示器列表已变化，请刷新后重试');job.resolve.forEach(resolve=>resolve(result));}
  catch(error){job.reject.forEach(reject=>reject(error instanceof Error?error:Error('显示器操作失败')));}
  finally{if(this.active===job){this.active=undefined;this.controller=undefined;}void this.drain();}
 }
 cancel(){this.epoch++;this.controller?.abort();for(const job of this.queue)job.reject.forEach(reject=>reject(Error('已取消显示器操作')));this.queue=[];}
 invalidate(){this.cancel();this.rows.clear();this.changed();}
 stop(){this.stopped=true;this.invalidate();}
 private target(id:string){if(typeof id!=='string'||!/^[0-9a-f]{64}$/.test(id))throw Error('显示器标识无效');const row=this.rows.get(id);if(!row)throw Error('显示器列表已变化，请刷新后重试');if(row.cloned)throw Error('镜像模式无法唯一控制此屏幕，请使用扩展模式');return row;}
 private publicRow(id:string,row:NativeDisplay):ManagedDisplay {const {path,key,...rest}=row;return {...rest,id};}
 list():Promise<ManagedDisplay[]>{return this.enqueue('list',()=>this.inventory());}
 private async inventory():Promise<ManagedDisplay[]>{
   const raw=await this.call(['list']);if(!Array.isArray(raw?.displays)||raw.displays.length>64)throw invalid();
   const found=new Map<string,NativeDisplay>();
   for(const row of raw.displays){
    for(const key of ['name','source','path','key'])if(typeof row?.[key]!=='string'||!row[key]||row[key].length>2048)throw invalid();
    if(!['serial','connection'].includes(row.identity)||['internal','virtual','primary','cloned'].some(key=>typeof row[key]!=='boolean'))throw invalid();
    for(const key of ['width','height','left','top','rotation','refreshRate'])if(!Number.isFinite(row[key]))throw invalid();
    if(row.width<0||row.width>65536||row.height<0||row.height>65536||Math.abs(row.left)>1000000||Math.abs(row.top)>1000000||![0,90,180,270].includes(row.rotation)||row.refreshRate<0||row.refreshRate>1000)throw invalid();
    const id=createHash('sha256').update(row.key).digest('hex');if(found.has(id))throw invalid();
    const {name,source,path,key,identity,internal,virtual,primary,cloned,width,height,left,top,rotation,refreshRate}=row;found.set(id,{name,source,path,key,identity,internal,virtual,primary,cloned,width,height,left,top,rotation,refreshRate});
   }
   this.controller!.signal.throwIfAborted();this.rows=found;return [...found].map(([id,row])=>this.publicRow(id,row));
 }
 probe(id:string):Promise<ManagedDisplay>{return this.enqueue('probe:'+id,()=>this.detect(id));}
 private async detect(id:string):Promise<ManagedDisplay>{
  const row=this.target(id),raw=await this.call(['probe',row.path,row.key]);const values=Object.fromEntries(displayParameters.map(key=>[key,control(raw?.controls?.[key])])) as Record<DisplayParameter,DisplayControl>;
  this.controller!.signal.throwIfAborted();row.controls=values;return this.publicRow(id,row);
 }
 set(id:string,parameter:DisplayParameter,value:number):Promise<DisplayControl>{
  if(!displayParameters.includes(parameter)||!Number.isInteger(value)||value<0||value>100)return Promise.reject(Error('显示器参数需为 0 至 100 的整数'));
  return this.enqueue(`set:${id}:${parameter}`,()=>this.write(id,parameter,value));
 }
 private async write(id:string,parameter:DisplayParameter,value:number):Promise<DisplayControl>{
   const row=this.target(id);if(!row.controls?.[parameter].supported)throw Error('请先检测此显示器的控制能力');
   try{const raw=await this.call(['set',row.path,row.key,parameter,String(value)]),next=control(raw?.control);if(!next.supported)throw Error(next.error||'显示器未接受设置');this.controller!.signal.throwIfAborted();row.controls[parameter]=next;return next;}
   catch(error){if(row.controls)row.controls[parameter]={supported:false,method:'',error:'设置失败，请重新检测'};throw error;}
 }
 setBrightness(id:string,value:number):Promise<DisplayWriteResult[]>{
  if(!Number.isInteger(value)||value<0||value>100)return Promise.reject(Error('显示器参数需为 0 至 100 的整数'));
  return this.enqueue(`set:${id}:linked-brightness`,async()=>{
   const source=this.target(id);if(!source.controls?.brightness.supported)throw Error('请先检测此显示器的控制能力');
   const p=this.preferences(),linked=p.linkedBrightness&&!p.excluded.includes(id);
   const targets=[id,...(linked?[...this.rows].filter(([other,row])=>other!==id&&!row.cloned&&row.controls?.brightness.supported&&!p.excluded.includes(other)).map(([other])=>other):[])];
   const results:DisplayWriteResult[]=[];
   for(const target of targets){
    // Re-read preferences between devices so disabling/excluding stops remaining linked writes.
    const current=this.preferences();if(target!==id&&(!current.linkedBrightness||current.excluded.includes(id)||current.excluded.includes(target)))continue;
    this.controller!.signal.throwIfAborted();
    try{results.push({id:target,control:await this.write(target,'brightness',value)});}
    catch(error){this.controller!.signal.throwIfAborted();results.push({id:target,error:error instanceof Error?error.message:'显示器设置失败'});}
   }
   return results;
  });
 }
 captureProfile():Promise<DisplayProfileCapture>{return this.enqueue('profile:capture',async()=>{
  await this.inventory();const targets:DisplayProfileCapture['targets']=[],warnings:DisplayProfileCapture['warnings']=[];
  for(const [id,row] of this.rows){
   if(row.cloned)continue;this.controller!.signal.throwIfAborted();
   try{const found=await this.detect(id),values:DisplayProfileCapture['targets'][number]['values']={};
    for(const parameter of displayParameters){const c=found.controls?.[parameter];if(c?.supported)values[parameter]=c.value!;}
    if(Object.keys(values).length)targets.push({id,name:row.name,identity:row.identity,values});else warnings.push({name:row.name,error:'未提供可保存的控制参数'});
   }catch(error){this.controller!.signal.throwIfAborted();warnings.push({name:row.name,error:error instanceof Error?error.message:'读取失败'});}
  }
  if(!targets.length)throw Error('没有可保存的显示器参数，请检测控制能力后重试');return {targets,warnings};
 });}
 adjustBrightness(point:{x:number;y:number},delta:number,isCurrent:()=>boolean=()=>true):Promise<DisplayWriteResult[]>{
  if(!point||!Number.isInteger(point.x)||!Number.isInteger(point.y)||Math.abs(point.x)>1000000||Math.abs(point.y)>1000000||!Number.isInteger(delta)||!delta||Math.abs(delta)>100)return Promise.reject(Error('亮度步进参数无效'));
  return this.enqueue('shortcut:brightness',async()=>{
   if(!isCurrent())return [];await this.inventory();if(!isCurrent())return [];
   const matches=[...this.rows].filter(([,r])=>!r.cloned&&point.x>=r.left&&point.x<r.left+r.width&&point.y>=r.top&&point.y<r.top+r.height);
   if(matches.length!==1)throw Error('无法唯一识别鼠标所在显示器，请刷新显示器列表');const [id]=matches[0],source=await this.detect(id),brightness=source.controls?.brightness;if(!brightness?.supported)throw Error('鼠标所在显示器未提供亮度接口');
   const desired=Math.max(0,Math.min(100,brightness.value!+delta)),p=this.preferences(),linked=p.linkedBrightness&&!p.excluded.includes(id),targets=[id,...(linked?[...this.rows].filter(([other,r])=>other!==id&&!r.cloned&&!p.excluded.includes(other)).map(([other])=>other):[])],results:DisplayWriteResult[]=[];
   for(const target of targets){
    if(!isCurrent())break;const latest=this.preferences();if(target!==id&&(!latest.linkedBrightness||latest.excluded.includes(id)||latest.excluded.includes(target)))continue;
    try{const row=target===id?source:await this.detect(target),c=row.controls?.brightness;if(!isCurrent())break;if(!c?.supported)continue;results.push({id:target,control:c.value===desired?c:await this.write(target,'brightness',desired)});}
    catch(error){this.controller!.signal.throwIfAborted();results.push({id:target,error:error instanceof Error?error.message:'设置失败'});}
   }return results;
  });
 }
 applyProfile(value:DisplayProfile):Promise<DisplayProfileResult[]>{
  let profile:DisplayProfile;try{profile=validateDisplayProfile(value);}catch(error){return Promise.reject(error);}
  return this.enqueue('profile:apply',async()=>{
   await this.inventory();const results:DisplayProfileResult[]=[];
   for(const target of profile.targets){
    this.controller!.signal.throwIfAborted();const result:DisplayProfileResult={id:target.id,name:target.name,controls:{},errors:{}};results.push(result);
    const row=this.rows.get(target.id);if(!row){result.error='显示器未连接或身份已变化';continue;}
    if(row.cloned||row.identity!==target.identity){result.error='当前显示器无法唯一匹配方案目标';continue;}
    try{await this.detect(target.id);}catch(error){this.controller!.signal.throwIfAborted();result.error=error instanceof Error?error.message:'检测失败';continue;}
    for(const parameter of displayParameters){
     const desired=target.values[parameter];if(desired===undefined)continue;this.controller!.signal.throwIfAborted();
     if(!row.controls?.[parameter].supported){result.errors[parameter]=row.controls?.[parameter].error||'当前接口不可用';continue;}
     // Profiles carry per-screen values and intentionally do not trigger brightness linking.
     try{result.controls[parameter]=await this.write(target.id,parameter,desired);}catch(error){this.controller!.signal.throwIfAborted();result.errors[parameter]=error instanceof Error?error.message:'设置失败';}
    }
   }
   return results;
  });
 }
}
