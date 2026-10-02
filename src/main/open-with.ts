import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join} from 'node:path';
import type {OpenWithApp} from '../shared/preview';
const execute=promisify(execFile),helper=()=>join(__dirname,'../native/One.OpenWith.exe').replace('app.asar\\','app.asar.unpacked\\');
export async function activatePreviewWindow(hwnd:number){await execute(helper(),['focus',String(hwnd),String(process.pid)],{windowsHide:true,timeout:1500});}
export async function openWithApplications(path:string):Promise<OpenWithApp[]>{
 const {stdout}=await execute(helper(),['list',path],{windowsHide:true,timeout:10000,maxBuffer:1024*1024,encoding:'utf8'});return JSON.parse(stdout||'[]');
}
export async function openInApplication(path:string,id:string){
 if(typeof id!=='string'||id.length>32768||id.includes('\0'))throw new Error('打开方式无效');
 await execute(helper(),id===':choose'?['choose',path]:['invoke',path,id],{windowsHide:true,timeout:id===':choose'?0:30000});
}

export async function showFileContextMenu(path:string,hwnd:number,point:{x:number;y:number}){await execute(helper(),['context',path,String(hwnd),String(process.pid),String(point.x),String(point.y)],{windowsHide:true,timeout:0,maxBuffer:1024*1024});}
export async function installedApplications():Promise<{id:string;name:string;file:string}[]>{const {stdout}=await execute(helper(),['apps'],{windowsHide:true,timeout:15000,maxBuffer:4*1024*1024,encoding:'utf8'});return JSON.parse(stdout);}
export async function applicationImage(id:string){const {stdout}=await execute(helper(),['app-icon',id],{windowsHide:true,timeout:3000,maxBuffer:256*1024,encoding:'utf8'});return stdout;}
export async function launchApplication(id:string){await execute(helper(),['launch-app',id],{windowsHide:true,timeout:15000});}
export async function copyShellItem(path:string,cut=false){await execute(helper(),[cut?'cut':'copy',path],{windowsHide:true,timeout:10000});}
export async function renameShellItem(path:string,target:string){try{await execute(helper(),['rename',path,target],{windowsHide:true,timeout:10000});}catch(error){const detail=(error as {stderr?:string}).stderr||'';throw new Error(/0x800700(?:b7|50)/i.test(detail)?'已存在同名文件，请换一个名称':'无法重命名，请检查文件是否被占用或有访问权限');}}
