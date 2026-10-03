import {app} from 'electron';
import {join,resolve} from 'node:path';
import {mkdir,copyFile,readFile,writeFile,stat} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import type {ExplorerMenuState} from '../shared/explorer-menu';
const execute=promisify(execFile);
const nativeRoot=()=>app.isPackaged?join(process.resourcesPath,'app.asar.unpacked/dist/native'):join(__dirname,'../native');
const script=()=>join(__dirname,'explorer-menu.ps1').replace('app.asar','app.asar.unpacked');
let pending:Promise<ExplorerMenuState>|undefined;
async function run(operation:string,config?:string):Promise<ExplorerMenuState>{
 const result=await execute('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script(),'-Operation',operation,...(config?['-Config',config]:[])],{windowsHide:true,timeout:60000,maxBuffer:1024*1024});return JSON.parse(result.stdout.replace(/^\uFEFF/,''));
}
export const explorerMenuState=()=>run('status');
export function setExplorerMenu(value:unknown):Promise<ExplorerMenuState>{
 if(!value||typeof value!=='object'||typeof(value as any).locksmith!=='boolean'||typeof(value as any).rename!=='boolean')return Promise.reject(Error('右键菜单设置无效'));
 if(pending)return Promise.reject(Error('正在更新右键菜单'));
 pending=install(value as {locksmith:boolean;rename:boolean}).finally(()=>pending=undefined);return pending;
}
async function install(value:{locksmith:boolean;rename:boolean}){
 const root=join(app.getPath('userData'),'explorer-menu');await mkdir(root,{recursive:true});
 if(value.locksmith||value.rename){
  for(const name of ['One.Shell.dll','One.Shell.exe']){
   const source=join(nativeRoot(),name),target=join(root,name);
   // Loaded shell DLLs must not be overwritten. A hash-versioned filename lets Windows finish old instances.
   if(name.endsWith('.dll'))continue;await copyFile(source,target);
  }
  const {createHash}=await import('node:crypto'),bytes=await readFile(join(nativeRoot(),'One.Shell.dll')),dll='One.Shell-'+createHash('sha256').update(bytes).digest('hex').slice(0,16)+'.dll';
  try{await stat(join(root,dll));}catch{await writeFile(join(root,dll),bytes);}
  await copyFile(join(__dirname,'../icons/one-256.png'),join(root,'logo.png'));await copyFile(join(__dirname,'../icons/one.ico'),join(root,'one.ico'));
  const manifest=(await readFile(join(__dirname,'explorer-menu.xml'),'utf8')).replaceAll('One.Shell.dll',dll);await writeFile(join(root,'AppxManifest.xml'),manifest);
 }
 const {createHash}=await import('node:crypto'),manifestHash=value.locksmith||value.rename?createHash('sha256').update(await readFile(join(root,'AppxManifest.xml'))).digest('hex'):'';
 const config=join(root,'config.json');await writeFile(config,JSON.stringify({...value,root,manifestHash,executable:process.execPath,appPath:app.isPackaged?'':resolve(app.getAppPath()),profile:app.getPath('userData'),icon:join(root,'one.ico')}));return run('set',config);
}
