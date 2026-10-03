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
 const menus=[
  {tool:'locksmith',packageName:'One.ExplorerMenu.Locksmith',title:'文件占用',verb:'OneLocks',clsid:'49A8359C-85B9-4E7A-905E-6A724911750A'},
  {tool:'rename',packageName:'One.ExplorerMenu.Rename',title:'批量重命名',verb:'OneRename',clsid:'57ABA3E6-8D9A-4A16-A717-6541B2241A36'},
 ].map(menu=>({...menu,enabled:value[menu.tool as keyof typeof value],root:join(root,menu.tool),manifestHash:''}));
 if(value.locksmith||value.rename){
  const {createHash}=await import('node:crypto'),bytes=await readFile(join(nativeRoot(),'One.Shell.dll')),dll='One.Shell-'+createHash('sha256').update(bytes).digest('hex').slice(0,16)+'.dll';
  const template=await readFile(join(__dirname,'explorer-menu.xml'),'utf8');
  for(const menu of menus){
   if(!menu.enabled)continue;await mkdir(menu.root,{recursive:true});
   // Loaded shell DLLs must not be overwritten. Each command has its own package and launch configuration.
   try{await stat(join(menu.root,dll));}catch{await writeFile(join(menu.root,dll),bytes);}
   await copyFile(join(nativeRoot(),'One.Shell.exe'),join(menu.root,'One.Shell.exe'));
   await copyFile(join(__dirname,'../icons/one-256.png'),join(menu.root,'logo.png'));await copyFile(join(__dirname,'../icons/one.ico'),join(menu.root,'one.ico'));
   const manifest=template.replaceAll('{{PACKAGE}}',menu.packageName).replaceAll('{{TITLE}}',menu.title).replaceAll('{{CLSID}}',menu.clsid).replaceAll('{{VERB}}',menu.verb).replaceAll('One.Shell.dll',dll);
   await writeFile(join(menu.root,'AppxManifest.template.xml'),manifest);menu.manifestHash=createHash('sha256').update(manifest).digest('hex');
  }
 }
 const config=join(root,'config.json');await writeFile(config,JSON.stringify({menus,root,executable:process.execPath,appPath:app.isPackaged?'':resolve(app.getAppPath()),profile:app.getPath('userData')}));return run('set',config);
}
