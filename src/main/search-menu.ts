import {shell,clipboard} from 'electron';
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,readdir,stat} from 'node:fs/promises';
import {dirname,basename,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {SearchContext,SearchSettings,SearchMenuItem,MenuNode} from '../shared/search';
import type {SearchBridge} from './search-bridge';
import {shellCommand} from './menu-command';
import type {SpawnOptions} from 'node:child_process';
type Action={kind:string;target:string;item?:SearchMenuItem};
export class SearchMenu {
 private actions=new Map<string,Action>();private context:SearchContext={kind:'menu',hwnd:0,pid:0,created:'',folders:[]};private recent:string[]=[];private ready:Promise<void>;
 constructor(private cache:string,private config:()=>SearchSettings,private bridge:SearchBridge,private settings:()=>void,private search:()=>void){this.ready=readFile(cache,'utf8').then(s=>{const a=JSON.parse(s);if(Array.isArray(a))this.recent=a.filter(x=>typeof x==='string').slice(0,30);}).catch(()=>{});}
 private node(label:string,icon:string,action:Action,expandable=false,path?:string):MenuNode{const id=randomUUID();this.actions.set(id,action);return{id,label,icon,kind:action.kind,expandable,...(path?{path}:{})};}
 updateContext(context:SearchContext){this.context=context;}
 async open(context:SearchContext){await this.ready;this.context=context;this.actions.clear();const config=this.config();const build=(parent:string):MenuNode[]=>config.menu.filter(i=>i.parent===parent&&i.enabled).map(i=>{
  if(i.kind==='separator')return{id:i.id,label:'',icon:'',kind:'separator'};
  if(i.kind==='group')return{id:i.id,label:i.label,icon:i.icon||'list',kind:'group',children:build(i.id)};
  if(i.kind==='builtin'&&['opened','recent'].includes(i.target))return this.node(i.label,i.icon,{kind:'builtin',target:i.target},true);
  return this.node(i.label,i.icon||i.kind,{kind:i.kind,target:i.target,item:i},i.kind==='folder');
 });const roots=build('');const favorites=config.bookmarks.filter(p=>!config.menu.some(i=>i.kind==='folder'&&i.target===p));if(favorites.length)roots.unshift({id:'bookmarks',label:'收藏文件夹',icon:'star',kind:'group',children:favorites.map(p=>this.node(basename(p)||p,'folder',{kind:'folder',target:p},true,p))});return roots;}
 async children(id:string){const item=this.actions.get(id);if(item?.kind==='builtin'&&['opened','recent'].includes(item.target)){const paths=item.target==='recent'?this.recent:this.context.folders.map(f=>f.path);return [...new Set(paths)].map(p=>this.node(basename(p)||p,'folder',{kind:'folder',target:p},true,p));}if(!item||item.kind!=='folder')throw new Error('菜单项目已失效');const directory=this.expand(item.target),entries=await readdir(directory,{withFileTypes:true});return entries.filter(e=>!e.isSymbolicLink()).sort((a,b)=>Number(b.isDirectory())-Number(a.isDirectory())||a.name.localeCompare(b.name,'zh-CN',{numeric:true})).slice(0,150).map(e=>{const path=join(directory,e.name);return this.node(e.name,e.isDirectory()?'folder':'file',{kind:e.isDirectory()?'folder':'file',target:path},e.isDirectory(),path);});}
 private expand(value:string){if(/\{selected\}/.test(value)&&!this.context.selected?.length)throw new Error('请先在资源管理器中选中文件');if(/\{folder\}/.test(value)&&!this.context.currentFolder)throw new Error('当前窗口没有文件夹路径');return value.replace(/\{folder\}/g,()=>this.context.currentFolder||'').replace(/\{selected\}/g,()=>this.context.selected?.[0]||'').replace(/%([\w()]+)%/g,(m,key)=>process.env[key]??m);}
 async remember(path:string){await this.ready;this.recent=[path,...this.recent.filter(p=>p.toLowerCase()!==path.toLowerCase())].slice(0,30);await mkdir(dirname(this.cache),{recursive:true});await writeFile(this.cache,JSON.stringify(this.recent),'utf8');}
 async execute(id:string){const action=this.actions.get(id);if(!action)throw new Error('菜单项目已失效');const target=action.kind==='shell'?action.target:this.expand(action.target);
  if(action.kind==='folder'){if(!(await stat(target)).isDirectory())throw new Error('文件夹不存在');if(this.context.hwnd&&this.context.created)await this.bridge.jump(this.context,target);else{const error=await shell.openPath(target);if(error)throw new Error(error);}await this.remember(target);}
  else if(action.kind==='file'){const error=await shell.openPath(target);if(error)throw new Error(error);}
  else if(action.kind==='url'){if(!/^https?:\/\//i.test(target))throw new Error('网址无效');await shell.openExternal(target);}
  else if(action.kind==='command'){const item=action.item!;const args=item.args.flatMap(a=>a==='{selection}'?this.context.selected?.length?this.context.selected:(()=>{throw new Error('请先选中文件')})():[this.expand(a)]);await this.launch(target,args,item.cwd?this.expand(item.cwd):this.context.currentFolder);}
  else if(action.kind==='shell'){const item=action.item!,plan=shellCommand(item,this.context.currentFolder,this.context.selected);await this.launch(plan.file,plan.args,item.cwd?this.expand(item.cwd):this.context.currentFolder,{env:plan.env,windowsVerbatimArguments:plan.windowsVerbatimArguments});}
  else if(action.kind==='builtin'){if(target==='settings')this.settings();else if(target==='search')this.search();else if(target==='copy-path'){if(!this.context.currentFolder)throw new Error('当前文件夹不可用');clipboard.writeText(this.context.currentFolder);}else if(target==='terminal'){if(!this.context.currentFolder)throw new Error('当前文件夹不可用');await this.launch(join(process.env.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),[],this.context.currentFolder);}}
 }
 private launch(file:string,args:string[],cwd?:string,options:SpawnOptions={}){return new Promise<void>((resolve,reject)=>{const child=spawn(file,args,{...options,cwd:cwd||undefined,detached:true,stdio:'ignore',windowsHide:false,shell:false});child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});});}
}
