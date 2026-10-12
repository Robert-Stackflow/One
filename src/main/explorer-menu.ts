import {app} from 'electron';
import {join,resolve} from 'node:path';
import {mkdir,copyFile,readFile,writeFile,stat} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import type {ExplorerMenuState} from '../shared/explorer-menu';
const execute=promisify(execFile);
const nativeRoot=()=>app.isPackaged?join(process.resourcesPath,'app.asar.unpacked/dist/native'):join(__dirname,'../native');
const script=()=>join(__dirname,'explorer-menu.ps1').replace('app.asar','app.asar.unpacked');
let pending:Promise<ExplorerMenuState>|undefined;
async function run(operation:string,config?:string):Promise<ExplorerMenuState>{
 const result=await execute('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script(),'-Operation',operation,...(config?['-Config',config]:[])],{windowsHide:true,timeout:600000,maxBuffer:1024*1024});return JSON.parse(result.stdout.replace(/^\uFEFF/,''));
}
export const explorerMenuState=()=>run('status');
export async function repairExplorerMenu(){
 if(!app.isPackaged||pending)return;
 const state=await explorerMenuState();
 if(!state.locksmith&&!state.rename&&!state.archiveCreate&&!state.archiveExtract)return;
 const root=join(app.getPath('userData'),'explorer-menu');
 const stamp=createHash('sha256').update(await readFile(script())).update(await readFile(join(nativeRoot(),'One.Shell.dll'))).update(process.execPath).digest('hex');
 const marker=join(root,'registration-hash.txt');
 let previous='';try{previous=(await readFile(marker,'utf8')).trim();}catch{}
 if(previous===stamp&&state.classic)return;
 const repaired=await setExplorerMenu(state,true);
 if(repaired.error||!repaired.classic)throw Error(repaired.error||'系统右键菜单注册未完成');
 await writeFile(marker,stamp);
}
export function setExplorerMenu(value:unknown,force=false):Promise<ExplorerMenuState>{
 if(!value||typeof value!=='object'||typeof(value as any).locksmith!=='boolean'||typeof(value as any).rename!=='boolean')return Promise.reject(Error('右键菜单设置无效'));
 if(pending)return Promise.reject(Error('正在更新右键菜单'));
 const input=value as Partial<ExplorerMenuState>;
 if(input.archiveCreate!==undefined&&typeof input.archiveCreate!=='boolean'||input.archiveExtract!==undefined&&typeof input.archiveExtract!=='boolean')return Promise.reject(Error('右键菜单设置无效'));
 pending=install({locksmith:input.locksmith!,rename:input.rename!,archiveCreate:input.archiveCreate??false,archiveExtract:input.archiveExtract??false},force).finally(()=>pending=undefined);return pending;
}
async function install(value:{locksmith:boolean;rename:boolean;archiveCreate:boolean;archiveExtract:boolean},force:boolean){
 const root=join(app.getPath('userData'),'explorer-menu');await mkdir(root,{recursive:true});
 const menus=[
  {tool:'locksmith',key:'locksmith',packageName:'One.ExplorerMenu.Locksmith',title:'文件占用',verb:'OneLocks',clsid:'49A8359C-85B9-4E7A-905E-6A724911750A'},
  {tool:'rename',key:'rename',packageName:'One.ExplorerMenu.Rename',title:'批量重命名',verb:'OneRename',clsid:'57ABA3E6-8D9A-4A16-A717-6541B2241A36'},
  {tool:'archive-create',key:'archiveCreate',packageName:'One.ExplorerMenu.ArchiveCreate',title:'创建压缩包',verb:'OneArchiveCreate',clsid:'9E88B01D-C56C-4730-B3C4-18591F6AE40B'},
  {tool:'archive-extract',key:'archiveExtract',packageName:'One.ExplorerMenu.ArchiveExtract',title:'解压压缩包',verb:'OneArchiveExtract',clsid:'0A2B662F-8197-4BD9-9131-029B529C119E'},
 ] as const;
 const configured=menus.map(menu=>({...menu,enabled:value[menu.key],root:join(root,menu.tool),manifestHash:''}));
 if(Object.values(value).some(Boolean)){
  const {createHash}=await import('node:crypto'),bytes=await readFile(join(nativeRoot(),'One.Shell.dll')),dll='One.Shell-'+createHash('sha256').update(bytes).digest('hex').slice(0,16)+'.dll';
  const template=await readFile(join(__dirname,'explorer-menu.xml'),'utf8');
  for(const menu of configured){
   if(!menu.enabled)continue;await mkdir(menu.root,{recursive:true});
   // Loaded shell DLLs must not be overwritten. Each command has its own package and launch configuration.
   try{await stat(join(menu.root,dll));}catch{await writeFile(join(menu.root,dll),bytes);}
   await copyFile(join(nativeRoot(),'One.Shell.exe'),join(menu.root,'One.Shell.exe'));
   await copyFile(join(__dirname,'../icons/one-256.png'),join(menu.root,'logo.png'));await copyFile(join(__dirname,'../icons/one.ico'),join(menu.root,'one.ico'));
   const directoryItem=menu.tool==='archive-extract'?'':'<desktop5:ItemType Type="Directory"><desktop5:Verb Id="{{VERB}}" Clsid="{{CLSID}}"/></desktop5:ItemType>';
   const manifest=template.replaceAll('{{PACKAGE}}',menu.packageName).replaceAll('{{TITLE}}',menu.title).replaceAll('{{CLSID}}',menu.clsid).replaceAll('{{VERB}}',menu.verb).replaceAll('{{DIRECTORY_ITEM}}',directoryItem.replaceAll('{{VERB}}',menu.verb).replaceAll('{{CLSID}}',menu.clsid)).replaceAll('One.Shell.dll',dll);
   await writeFile(join(menu.root,'AppxManifest.template.xml'),manifest);menu.manifestHash=createHash('sha256').update(manifest).digest('hex');
  }
 }
 const config=join(root,'config.json');await writeFile(config,JSON.stringify({menus:configured,root,force,executable:process.execPath,appPath:app.isPackaged?'':resolve(app.getAppPath()),profile:app.getPath('userData')}));return run('set',config);
}
