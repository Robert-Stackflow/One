import {shell,clipboard} from 'electron';
import {readFile,writeFile,mkdir,readdir,stat} from 'node:fs/promises';
import {dirname,basename,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {defaultMenuBar,type SearchContext,type SearchSettings,type SearchMenuItem,type MenuNode,type MenuBar,type MenuBarSection} from '../shared/search';
import type {SearchBridge} from './search-bridge';
import {shellCommand} from './menu-command';
import {launchMenuProgram,lockWorkstation} from './open-with';
import {menuIconPath} from '../shared/menu-icons';
import {builtinById,type MenuBuiltin} from '../shared/menu-builtins';
import {builtinPlan} from './menu-builtins';
import {barOrder,barKeys} from '../shared/menu-layout';
import {topN} from '../shared/top-n';
type Action={kind:string;target:string;item?:SearchMenuItem};
const folderNameCollator=new Intl.Collator('zh-CN',{numeric:true});
export class SearchMenu {
 private actions=new Map<string,Action>();private context:SearchContext={kind:'menu',hwnd:0,pid:0,created:'',folders:[]};private recent:string[]=[];private ready:Promise<void>;
 constructor(private cache:string,private config:()=>SearchSettings,private bridge:SearchBridge,private settings:()=>void,private search:()=>void,private launch:typeof launchMenuProgram=launchMenuProgram,private confirm:(command:MenuBuiltin)=>Promise<boolean>=async()=>false,private favorite:()=>Promise<void>=async()=>{throw new Error('当前文件夹不可用');},private one:(command:MenuBuiltin,context:SearchContext)=>Promise<void>|void=()=>{throw new Error('One 操作不可用');}){this.ready=readFile(cache,'utf8').then(s=>{const a=JSON.parse(s);if(Array.isArray(a))this.recent=a.filter(x=>typeof x==='string').slice(0,30);}).catch(()=>{});}
 private node(label:string,icon:string,action:Action,expandable=false,path?:string):MenuNode{const id=randomUUID();this.actions.set(id,action);return{id,label,icon,kind:action.kind,expandable,...(path?{path}:{})};}
 updateContext(context:SearchContext){this.context=context;}
 async recentFolders(){await this.ready;return this.recent.slice();}
 private itemNode(item:SearchMenuItem,children?:MenuNode[]):MenuNode{
  if(item.kind==='separator')return{id:item.id,label:'',icon:'',kind:'separator'};
  if(item.kind==='group')return{id:item.id,label:item.label,icon:item.icon||'folder',kind:'group',children:children||[]};
  return this.node(item.label,item.icon||item.kind,{kind:item.kind,target:item.target,item},item.kind==='folder'||item.kind==='builtin'&&['opened','recent','bookmarks'].includes(item.target),menuIconPath(item));
 }
 async open(context:SearchContext){await this.ready;this.context=context;this.actions.clear();const config=this.config(),inBar=new Set(barKeys(config.menuBar||defaultMenuBar()).filter(key=>key.startsWith('item:')).map(key=>key.slice(5)));const build=(parent:string):MenuNode[]=>config.menu.filter(i=>i.parent===parent&&i.enabled&&!inBar.has(i.id)).map(i=>{
  if(i.kind==='separator')return{id:i.id,label:'',icon:'',kind:'separator'};
  return this.itemNode(i,i.kind==='group'?build(i.id):undefined);
 });return build('');}
 toolbar():MenuBar {
  const config=this.config(),bar=config.menuBar||defaultMenuBar();
  const visible=(item:SearchMenuItem):boolean=>item.enabled&&(!item.parent||!!config.menu.find(parent=>parent.id===item.parent&&visible(parent)));
  const inBar=new Set(barKeys(bar).filter(key=>key.startsWith('item:')).map(key=>key.slice(5))),children=(id:string):MenuNode[]=>config.menu.filter(item=>item.parent===id&&item.enabled&&!inBar.has(item.id)).map(item=>this.itemNode(item,item.kind==='group'?children(item.id):undefined));
  const build=(section:MenuBarSection)=>barOrder(section).flatMap(key=>{
   if(key==='favorite')return [{id:'menu-favorite',key,label:'收藏当前文件夹',icon:'star',kind:'favorite'}];
   const configured=key.startsWith('item:')?config.menu.find(item=>item.id===key.slice(5)):undefined;
   if(key.startsWith('item:'))return configured&&visible(configured)?[{...this.itemNode(configured,configured.kind==='group'?children(configured.id):undefined),key}]:[];
   const builtin=builtinById(key.slice(8));return builtin?[{...this.itemNode({id:key,parent:'',kind:'builtin',label:builtin.label,target:builtin.id,args:[],cwd:'',icon:builtin.icon,enabled:true}),key}]:[];
  }).map(item=>({...item,align:section.right.includes(item.key!)?'right' as const:'left' as const}));
  return {top:build(bar.top),bottom:build(bar.bottom)};
 }
 async children(id:string){const item=this.actions.get(id);if(item?.kind==='builtin'&&['opened','recent','bookmarks'].includes(item.target)){const paths=item.target==='bookmarks'?this.config().bookmarks:item.target==='recent'?this.recent:this.context.folders.map(f=>f.path);return [...new Set(paths)].map(p=>this.node(basename(p)||p,'folder',{kind:'folder',target:p},true,p));}if(!item||item.kind!=='folder')throw new Error('菜单项目已失效');const directory=this.expand(item.target),entries=await readdir(directory,{withFileTypes:true});const visible=function*(){for(const entry of entries)if(!entry.isSymbolicLink())yield entry;};return topN(visible(),150,(a,b)=>Number(b.isDirectory())-Number(a.isDirectory())||folderNameCollator.compare(a.name,b.name)).map(e=>{const path=join(directory,e.name);return this.node(e.name,e.isDirectory()?'folder':'file',{kind:e.isDirectory()?'folder':'file',target:path},e.isDirectory(),path);});}
 private expand(value:string){if(/\{selected\}/.test(value)&&!this.context.selected?.length)throw new Error('请先在资源管理器中选中文件');if(/\{folder\}/.test(value)&&!this.context.currentFolder)throw new Error('当前窗口没有文件夹路径');return value.replace(/\{folder\}/g,()=>this.context.currentFolder||'').replace(/\{selected\}/g,()=>this.context.selected?.[0]||'').replace(/%([\w()]+)%/g,(m,key)=>process.env[key]??m);}
 async remember(path:string){await this.ready;this.recent=[path,...this.recent.filter(p=>p.toLowerCase()!==path.toLowerCase())].slice(0,30);await mkdir(dirname(this.cache),{recursive:true});await writeFile(this.cache,JSON.stringify(this.recent),'utf8');}
 async execute(id:string){const action=this.actions.get(id);if(!action)throw new Error('菜单项目已失效');const target=action.kind==='shell'?action.target:this.expand(action.target);
  if(action.kind==='folder'){if(!(await stat(target)).isDirectory())throw new Error('文件夹不存在');if(this.context.hwnd&&this.context.created)await this.bridge.jump(this.context,target);else{const error=await shell.openPath(target);if(error)throw new Error(error);}await this.remember(target);}
  else if(action.kind==='file'){const error=await shell.openPath(target);if(error)throw new Error(error);}
  else if(action.kind==='url'){if(!/^https?:\/\//i.test(target))throw new Error('网址无效');await shell.openExternal(target);}
  else if(action.kind==='command'||action.kind==='shell'){const item=action.item!,cwd=item.cwd?this.expand(item.cwd):this.context.currentFolder;if(item.shell||action.kind==='shell'){const plan=shellCommand(item,this.context.currentFolder,this.context.selected);await this.launch(plan.file,plan.args,cwd,{console:true,env:plan.env,windowsVerbatimArguments:plan.windowsVerbatimArguments});}else{const args=item.args.flatMap(a=>a==='{selection}'?this.context.selected?.length?this.context.selected:(()=>{throw new Error('请先选中文件')})():[this.expand(a)]);await this.launch(target,args,cwd,{console:item.console});}}
  else if(action.kind==='builtin'){if(target==='settings')this.settings();else if(target==='search')this.search();else if(target==='favorite-current')await this.favorite();else if(target==='copy-path'){if(!this.context.currentFolder)throw new Error('当前文件夹不可用');clipboard.writeText(this.context.currentFolder);}else if(target==='terminal'){if(!this.context.currentFolder)throw new Error('当前文件夹不可用');await this.launch(join(process.env.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoLogo','-NoExit'],this.context.currentFolder,{console:true});}else{
   const command=builtinById(target);if(!command)throw new Error('内置命令无效');
   if(command.onePage||command.oneAction){await this.one(command,{...this.context,selected:this.context.selected?.slice(),folders:this.context.folders.map(folder=>({...folder}))});return;}
   if(command.confirm&&!await this.confirm(command))return;
   if(target==='lock'){await lockWorkstation();return;}
   const uri=target==='apps'?'ms-settings:appsfeatures':target==='windows-settings'?'ms-settings:':undefined;if(uri){await shell.openExternal(uri);return;}
   const plan=builtinPlan(target);if(!plan)throw new Error('内置命令不可用');if(['group-policy','steps-recorder'].includes(target)&&!(await stat(target==='group-policy'?plan.args[0]:plan.file).catch(()=>undefined))?.isFile())throw new Error('当前 Windows 未提供此工具');await this.launch(plan.file,plan.args,undefined,plan);
  }}
 }
}
