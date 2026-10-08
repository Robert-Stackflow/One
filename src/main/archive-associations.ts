import {app,shell} from 'electron';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join} from 'node:path';
import type {ArchiveAssociationState} from '../shared/archive-preferences';
const execute=promisify(execFile);
let pending:Promise<ArchiveAssociationState>|undefined;
export function archiveAssociation(operation:unknown):Promise<ArchiveAssociationState>{
 if(!['status','register','remove','defaults'].includes(String(operation)))return Promise.reject(Error('文件关联操作无效'));
 // Dev must never replace a real installation's Open With registration.
 if(!app.isPackaged)return operation==='status'?Promise.resolve({registered:false,available:false}):Promise.reject(Error('安装版本中可设置文件关联'));
 if(pending)return Promise.reject(Error('正在更新文件关联'));
 pending=run(operation as string).finally(()=>pending=undefined);
 return pending;
}
async function run(operation:string):Promise<ArchiveAssociationState>{
 const script=join(__dirname,'archive-associations.ps1').replace('app.asar','app.asar.unpacked');
 const icon=process.execPath;
 const {stdout}=await execute('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-Operation',operation==='defaults'?'status':operation,'-Executable',process.execPath,'-Icon',icon],{windowsHide:true,timeout:15000,maxBuffer:65536});
 const state=JSON.parse(stdout.replace(/^\uFEFF/,'')) as {registered:boolean};
 if(operation==='defaults'){
  if(!state.registered)throw Error('请先注册压缩包打开方式');
  await shell.openExternal('ms-settings:defaultapps?registeredAppUser='+encodeURIComponent('One 压缩与解压'));
 }
 return {registered:state.registered,available:true};
}
