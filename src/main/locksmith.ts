import {app} from 'electron';
import {execFile,type ChildProcess} from 'node:child_process';
import {stat} from 'node:fs/promises';
import {join,resolve,isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {LocksmithState,LockProcess} from '../shared/locksmith';
const initial=():LocksmithState=>({running:false,targets:[],processes:[],checked:0,total:0,denied:0,timedOut:0,modulesUnavailable:0,error:'',cancelled:false});
interface ProcessQuery {pid:number;created?:string;process?:string;files?:string[];references?:string[];windows?:string[];denied?:boolean;modulesDenied?:boolean}
interface SnapshotTask {pid:number;handles:string[]}
export class LocksmithService {
  private value=initial();private generation=0;private children=new Set<ChildProcess>();private finishing=false;private stopped=false;
  private helper=join(__dirname,'../native/One.Native.exe').replace('app.asar\\','app.asar.unpacked\\');
  constructor(private changed:(state:LocksmithState)=>void){}
  state(){return this.value;}
  private notify(){this.changed(this.value);}
  private call<T>(args:string[],timeout:number):Promise<T>{return new Promise((accept,reject)=>{const child=execFile(this.helper,args,{windowsHide:true,timeout,maxBuffer:16*1024*1024,encoding:'utf8'},(error,stdout,stderr)=>{this.children.delete(child);if(error){reject(Object.assign(new Error(stderr.trim()||error.message),{timedOut:!!error.killed}));return;}try{accept(JSON.parse(stdout));}catch{reject(new Error('文件占用辅助程序返回无效结果'));}});this.children.add(child);});}
  private callBatch(tasks:SnapshotTask[],targets:string[]):Promise<ProcessQuery[]>{return new Promise((accept,reject)=>{
    const child=execFile(this.helper,['inspect-batch',...targets],{windowsHide:true,timeout:5000,maxBuffer:16*1024*1024,encoding:'utf8'},(error,stdout,stderr)=>{
      this.children.delete(child);
      try{const results=stdout.trim()?stdout.trim().split(/\r?\n/).map(line=>JSON.parse(line) as ProcessQuery):[];
        if((!error&&results.length!==tasks.length)||results.some((result,i)=>result.pid!==tasks[i]?.pid))throw new Error('批量进程检查结果不完整');accept(results);
      }catch{reject(new Error(stderr.trim()||'文件占用辅助程序返回无效结果'));}
    });
    this.children.add(child);child.stdin?.on('error',()=>{});child.stdin?.end(tasks.map(task=>`${task.pid}\t${task.handles.join(',')}`).join('\n')+'\n');
  });}
  private async inspectOne(task:SnapshotTask,targets:string[],alive:()=>boolean){
    const files=new Set<string>(),references=new Set<string>(),windows=new Set<string>();let info:ProcessQuery|undefined,denied=false,modulesDenied=false,failed=false;
    for(let start=0;start<Math.max(1,task.handles.length)&&alive();start+=1200){
      try{const result=await this.call<ProcessQuery>(['inspect',String(task.pid),task.handles.slice(start,start+1200).join(','),...targets],2000);if(!alive())break;
        denied||=!!result.denied;modulesDenied||=!!result.modulesDenied;if(result.created||result.windows?.length)info=result;
        for(const file of result.files||[])files.add(file);for(const file of result.references||[])references.add(file);for(const title of result.windows||[])windows.add(title);
      }catch{failed=true;break;}
    }
    return {result:info?{...info,files:[...files],references:[...references],windows:[...windows],denied,modulesDenied}:undefined,denied,modulesDenied,failed};
  }
  async scan(paths:unknown){
    if(this.stopped)throw new Error('文件占用窗口已关闭');
    if(this.value.running||this.finishing)throw new Error('已有文件占用任务正在运行');
    if(!Array.isArray(paths)||!paths.length||paths.length>32||paths.some(p=>typeof p!=='string'||!isAbsolute(p)||p.length>32768||p.includes('\0')))throw new Error('请选择 1–32 个文件或目录');
    const targets=[...new Set((paths as string[]).map(p=>resolve(p)))];this.finishing=true;try{for(const path of targets){const info=await stat(path);if(!info.isFile()&&!info.isDirectory())throw new Error('只能检查普通文件和目录');}}finally{this.finishing=false;}
    if(this.stopped)throw new Error('文件占用窗口已关闭');
    const revision=++this.generation;this.value={...initial(),running:true,targets};this.notify();
    void this.run(revision,targets);return this.value;
  }
  private async run(revision:number,targets:string[]){
    const alive=()=>revision===this.generation;
    try{
      const snapshot=await this.call<{processes:SnapshotTask[]}>(['snapshot'],10000);if(!alive())return;
      const own=new Set(app.getAppMetrics().map(p=>p.pid));own.add(process.pid);
      const tasks=snapshot.processes.filter(p=>!own.has(p.pid));this.value.total=tasks.length;let last=0;
      const groups:SnapshotTask[][]=[];let group:SnapshotTask[]=[];
      for(const task of tasks){if(task.handles.length>1200){if(group.length)groups.push(group);group=[];groups.push([task]);continue;}group.push(task);if(group.length===16){groups.push(group);group=[];}}
      if(group.length)groups.push(group);let next=0;
      const deadline=Date.now()+90000;
      const record=(result:ProcessQuery|undefined,failed=false,denied=!!result?.denied,modulesDenied=!!result?.modulesDenied)=>{
        if(!alive())return;
        if(result&&(result.files?.length||result.references?.length||result.windows?.length)){
          const files=result.files||[],held=new Set(files.map(file=>file.toLowerCase()));
          this.value.processes.push({token:randomUUID(),pid:result.pid,created:result.created||'',process:result.process||'',files,references:(result.references||[]).filter(file=>!held.has(file.toLowerCase())),windows:result.windows||[]});
        }
        this.value.checked++;this.value.denied+=Number(denied);this.value.timedOut+=Number(failed);this.value.modulesUnavailable+=Number(modulesDenied);
        if(Date.now()-last>150){last=Date.now();this.notify();}
      };
      await Promise.all(Array.from({length:4},async()=>{while(alive()&&next<groups.length){if(Date.now()>deadline){this.value.error='扫描达到 90 秒上限，保留已查到的结果';return;}const batch=groups[next++];
        let completed=0;
        if(batch.length>1){try{const results=await this.callBatch(batch,targets);if(!alive())return;for(const result of results)record(result);completed=results.length;}catch{if(!alive())return;}}
        for(const task of batch.slice(completed)){if(!alive())return;if(Date.now()>deadline){this.value.error='扫描达到 90 秒上限，保留已查到的结果';return;}const outcome=await this.inspectOne(task,targets,alive);if(!alive())return;record(outcome.result,outcome.failed,outcome.denied,outcome.modulesDenied);}
      }}));
    }catch(error){if(alive())this.value.error=(error as Error).message;}
    finally{if(alive()){this.value.running=false;this.notify();}}
  }
  cancel(){if(!this.value.running)return;this.generation++;for(const child of this.children)child.kill();this.children.clear();this.value.running=false;this.value.cancelled=true;this.notify();}
  async end(token:unknown){if(typeof token!=='string')throw new Error('进程标识无效');if(this.value.running)throw new Error('请先等待扫描完成或停止扫描');if(this.finishing)throw new Error('正在结束进程');const item=this.value.processes.find(p=>p.token===token);if(!item)throw new Error('结果已失效，请重新扫描');if(!item.files.length)throw new Error('未发现该进程持有文件句柄，不能确认持续占用');if(app.getAppMetrics().some(p=>p.pid===item.pid)||item.pid===process.pid)throw new Error('不能在此结束 One 自身');
    this.finishing=true;try{await this.call(['end',String(item.pid),item.created],5000);this.value.processes=this.value.processes.filter(p=>p.token!==token);this.notify();}finally{this.finishing=false;}
  }
  stop(){this.stopped=true;this.cancel();for(const child of this.children)child.kill();this.children.clear();}
}
