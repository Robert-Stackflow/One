import {spawn,execFile} from 'node:child_process';
import {join} from 'node:path';
import {promisify} from 'node:util';
import type {ScanProgress,ScanSummary,MaintenanceRow} from '../shared/types';
const executable=()=>join(__dirname,'../native/One.Index.exe').replace('app.asar\\','app.asar.unpacked\\');
export async function nativeCacheFiles(root:string,age:number,signal?:AbortSignal):Promise<{files:{path:string;size:number;mtime:number;root:string}[];skipped:number;truncated:boolean}>{const result=await promisify(execFile)(executable(),['cleanup',root,String(age)],{windowsHide:true,signal,timeout:120000,maxBuffer:128*1024*1024,encoding:'utf8'});return JSON.parse(result.stdout);}
export async function nativeMaintenance(mode:'startup'|'registry',signal?:AbortSignal):Promise<MaintenanceRow[]>{const result=await promisify(execFile)(executable(),[mode],{windowsHide:true,signal,timeout:120000,maxBuffer:32*1024*1024,encoding:'utf8'});return JSON.parse(result.stdout);}
export function nativeCacheRemove(root:string,files:{path:string;size:number;mtime:number}[],progress:(value:{completed:number;total:number})=>void,signal?:AbortSignal):Promise<{items:number;bytes:number;failedCount:number;failed:{name:string;error:string}[]}>{return new Promise((resolve,reject)=>{
 const child=spawn(executable(),['cleanup-remove'],{windowsHide:true,stdio:'pipe',signal});let buffer='',done=false;const timeout=setTimeout(()=>finish(new Error('缓存清理超时')),300000);const finish=(error?:Error,result?:any)=>{if(done)return;done=true;clearTimeout(timeout);child.kill();if(error)reject(error);else resolve(result);};child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{buffer+=chunk;if(buffer.length>4*1024*1024)return finish(new Error('清理响应超过限制'));let end;while(!done&&(end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);try{const value=JSON.parse(line);if(value.progress)progress(value.progress);else if(value.error)finish(new Error(value.error));else if(value.result)finish(undefined,value.result);}catch{finish(new Error('缓存清理响应无效'));}}});child.stderr.resume();child.stdin.on('error',()=>{});child.on('error',e=>finish(e));child.on('close',code=>{if(!done)finish(new Error(`缓存清理服务已退出 (${code})`));});child.stdin.end(JSON.stringify({root,files}));
 });}
export function nativeScan(path:string,progress:(p:ScanProgress)=>void,complete:(r?:ScanSummary,error?:string)=>void){
 const child=spawn(executable(),['disk',path],{windowsHide:true,stdio:'pipe'});let buffer='',done=false,cancelTimer:NodeJS.Timeout|undefined;
 const finish=(result?:ScanSummary,error?:string)=>{if(done)return;done=true;clearTimeout(cancelTimer);child.stdin.end();child.kill();complete(result,error);};
 child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{buffer+=chunk;if(buffer.length>64*1024*1024){finish(undefined,'扫描响应超过限制');return;}let end;while(!done&&(end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);try{const message=JSON.parse(line);if(message.progress)progress(message.progress);else finish(message.result,message.error);}catch{finish(undefined,'扫描服务返回了无效数据');}}});
 // Exit can precede the final stdout data event; close guarantees the pipes drained.
 child.stdin.on('error',()=>{});child.stderr.resume();child.on('error',e=>finish(undefined,e.message));child.on('close',code=>finish(undefined,`扫描服务意外退出 (${code})`));
 return {stop(){if(done||cancelTimer)return;child.stdin.write('cancel\n');cancelTimer=setTimeout(()=>finish(undefined,'扫描已取消'),2000);},kill(){finish(undefined,'扫描已取消');}};
}
