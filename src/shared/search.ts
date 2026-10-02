import {builtinById} from './menu-builtins';
export type MenuKind='folder'|'file'|'url'|'command'|'shell'|'group'|'separator'|'builtin';
export type MenuShell='powershell'|'pwsh'|'cmd'|'custom';
export interface SearchMenuItem {id:string;parent:string;kind:MenuKind;label:string;target:string;args:string[];cwd:string;icon:string;iconMode?:'auto'|'custom';console?:boolean;enabled:boolean;shell?:MenuShell;shellPath?:string;}
export interface MenuNode {id:string;label:string;icon:string;kind:string;path?:string;children?:MenuNode[];expandable?:boolean;key?:string;align?:'left'|'right';}
export type MenuBarPosition='top'|'bottom';
export interface MenuBarSection {actions:string[];right:string[]}
export interface MenuBarSettings {top:MenuBarSection;bottom:MenuBarSection}
export interface MenuBar {top:MenuNode[];bottom:MenuNode[]}
export interface SearchSettings {maxEntries:number;roots:string[];excluded:string[];shortcut:string;doubleCtrl:boolean;explorerTyping:boolean;explorerMenu:boolean;dialogSwitch:boolean;bookmarks:string[];fuzzy:boolean;pinyin:boolean;menu:SearchMenuItem[];menuVersion:number;menuBar:MenuBarSettings}
export interface SearchEntry {path:string;name:string;directory:boolean;modified:number;size:number;matchKind?:'exact'|'pinyin'|'fuzzy'|'typo';launchKind?:'app'|'setting';icon?:string;subtitle?:string}
export interface SearchState {running:boolean;count:number;scanned:number;issues:number;root:string;updated:number;error:string;watching:boolean}
export interface SearchResult {items:SearchEntry[];total:number;elapsed:number;cancelled?:boolean;partial?:boolean;localTotal?:number}
export interface SearchProgress {token:string;result:SearchResult}
export interface SearchContext {kind:'search'|'explorer'|'menu'|'dialog';hwnd:number;pid:number;created:string;currentFolder?:string;selected?:string[];folders:{path:string;hwnd:number;active:boolean}[]}
export const defaultMenu=():SearchMenuItem[]=>[['opened','已打开的文件夹','folder'],['recent','最近访问','history'],['copy-path','复制当前路径','copy'],['terminal','在此打开 PowerShell','terminal'],['settings','自定义菜单','system']].map(([target,label,icon],i)=>({id:'default-'+i,parent:'',kind:'builtin',label,target,args:[],cwd:'',icon,enabled:true}));
export const bookmarkMenuItem=(id='default-bookmarks'):SearchMenuItem=>({id,parent:'',kind:'builtin',label:'收藏文件夹',target:'bookmarks',args:[],cwd:'',icon:'star',enabled:true});
export const defaultMenuBar=():MenuBarSettings=>({top:{actions:[],right:[]},bottom:{actions:['favorite','builtin:settings'],right:['builtin:settings']}});
export const defaultSearch=():SearchSettings=>({maxEntries:2_000_000,roots:[],excluded:[],shortcut:'Ctrl+Alt+F',doubleCtrl:false,explorerTyping:false,explorerMenu:false,dialogSwitch:false,bookmarks:[],fuzzy:true,pinyin:true,menu:[...defaultMenu(),bookmarkMenuItem()],menuVersion:1,menuBar:defaultMenuBar()});
export function validateMenuBar(value:unknown,menu:SearchMenuItem[]):MenuBarSettings {
 if(value===undefined)return defaultMenuBar();if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('快捷操作栏设置无效');
 const source=value as Record<string,unknown>,seen=new Set<string>();
 const section=(value:unknown):MenuBarSection=>{
  if(!value||typeof value!=='object')throw new Error('快捷操作栏设置无效');const bar=value as MenuBarSection;
  if(!Array.isArray(bar.actions)||bar.actions.length>7||bar.actions.some(key=>typeof key!=='string'||key.length>100||key!=='favorite'&&!(key.startsWith('builtin:')&&builtinById(key.slice(8)))&&!/^item:[\w-]{1,80}$/.test(key)))throw new Error('每个快捷操作栏最多包含 7 项');
  if(bar.right!==undefined&&(!Array.isArray(bar.right)||bar.right.length>7||bar.right.some(key=>typeof key!=='string'||!bar.actions.includes(key))))throw new Error('快捷操作栏位置无效');
  const actions=[...new Set(bar.actions)].filter(key=>!key.startsWith('item:')||menu.some(item=>item.id===key.slice(5))).filter(key=>{if(seen.has(key))return false;seen.add(key);return true;});
  const right=bar.right??actions.filter(key=>key==='builtin:settings'||key.startsWith('item:')&&menu.find(item=>item.id===key.slice(5))?.target==='settings');
  return {actions,right:[...new Set(right)].filter(key=>actions.includes(key))};
 };
 // Preserve the location and order of the former single toolbar on first load.
 if('position' in source||'actions' in source){if(!['top','bottom'].includes(source.position as string))throw new Error('快捷操作栏位置无效');const migrated=section(source);return source.position==='top'?{top:migrated,bottom:{actions:[],right:[]}}:{top:{actions:[],right:[]},bottom:migrated};}
 return {top:section(source.top),bottom:section(source.bottom)};
}
export function validateMenu(value:unknown):SearchMenuItem[]{
 if(!Array.isArray(value)||value.length>200)throw new Error('菜单最多包含 200 项');const ids=new Set<string>();const items:SearchMenuItem[]=value.map(v=>{if(!v||typeof v.id!=='string'||!/^[\w-]{1,80}$/.test(v.id)||ids.has(v.id)||!['folder','file','url','command','shell','group','separator','builtin'].includes(v.kind)||typeof v.enabled!=='boolean'||!Array.isArray(v.args)||v.args.length>64||v.args.some((x:unknown)=>typeof x!=='string'||x.length>4000||x.includes('\0')))throw new Error('菜单项目无效');ids.add(v.id);for(const k of ['parent','label','target','cwd','icon'])if(typeof v[k]!=='string'||v[k].length>(k==='target'||k==='cwd'?32768:200)||v[k].includes('\0'))throw new Error('菜单字段无效');if(v.kind!=='separator'&&!v.label.trim())throw new Error('请填写菜单名称');if(['folder','file','command','shell'].includes(v.kind)&&!v.target.trim())throw new Error('请填写目标');if(v.kind==='builtin'&&!builtinById(v.target))throw new Error('内置菜单动作无效');if(v.kind==='url'&&!/^https?:\/\//i.test(v.target))throw new Error('网址需要以 http:// 或 https:// 开头');if((v.kind==='shell'||v.kind==='command'&&v.shell!==undefined)&&(!['powershell','pwsh','cmd','custom'].includes(v.shell??'powershell')||v.shellPath!==undefined&&(typeof v.shellPath!=='string'||v.shellPath.length>32768||/[\0\r\n]/.test(v.shellPath))||(v.shell==='custom'&&!v.shellPath?.trim())))throw new Error('请选择有效的 Shell 程序');if(v.console!==undefined&&typeof v.console!=='boolean')throw new Error('程序窗口选项无效');if(v.iconMode!==undefined&&!['auto','custom'].includes(v.iconMode))throw new Error('菜单图标模式无效');return {id:v.id,parent:v.parent,kind:v.kind==='shell'?'command':v.kind,label:v.label,target:v.target,args:[...v.args],cwd:v.cwd,icon:v.icon,enabled:v.enabled,...(v.iconMode?{iconMode:v.iconMode}:{}),...(v.console!==undefined?{console:v.console}:{}),...(v.kind==='shell'||v.kind==='command'&&v.shell!==undefined?{shell:v.shell??'powershell',shellPath:v.shellPath??''}:{})};});
 for(const item of items){let parent=item.parent;const visited=new Set([item.id]);while(parent){if(visited.has(parent)||visited.size>=5)throw new Error('菜单不能循环嵌套，最多五层');visited.add(parent);const found=items.find(x=>x.id===parent);if(!found||found.kind!=='group')throw new Error('上级菜单必须为分组');parent=found.parent;}}return items;
}
export function validateSearch(value:unknown):SearchSettings {
 if(value===undefined)return defaultSearch();const v=value as SearchSettings;
 if(!v||['doubleCtrl','explorerTyping','explorerMenu','dialogSwitch'].some(k=>typeof v[k as keyof SearchSettings]!=='boolean')||typeof v.shortcut!=='string'||v.shortcut.length>100||v.shortcut&&!/^(?:(?:Ctrl|Control|Alt|Shift|Win|Meta|Super)\+)+(?:[A-Z0-9]|F(?:[1-9]|1\d|2[0-4]))$/i.test(v.shortcut))throw new Error('搜索设置无效');
 for(const key of ['roots','excluded','bookmarks'] as const)if(!Array.isArray(v[key])||v[key].length>64||v[key].some(x=>typeof x!=='string'||x.length>32768||/[\0\r\n]/.test(x)||!(/^[A-Z]:[\\/]|^\\\\[^\\]+\\[^\\]+/i.test(x))))throw new Error('请选择有效的绝对目录路径');
 if(v.fuzzy!==undefined&&typeof v.fuzzy!=='boolean'||v.pinyin!==undefined&&typeof v.pinyin!=='boolean')throw new Error('匹配设置无效');
 if(v.maxEntries!==undefined&&(!Number.isSafeInteger(v.maxEntries)||v.maxEntries<1000||v.maxEntries>10_000_000))throw new Error('索引上限应为 1,000–10,000,000 项');
 if(v.menuVersion!==undefined&&v.menuVersion!==1)throw new Error('菜单版本无效');
 const menu=validateMenu(v.menu??defaultMenu());
 // Adopt the formerly injected favorites once; deletion thereafter is intentional.
 if(v.menuVersion===undefined&&v.bookmarks.length&&!menu.some(item=>item.kind==='builtin'&&item.target==='bookmarks')&&menu.length<200){let id='default-bookmarks',suffix=0;while(menu.some(item=>item.id===id))id='default-bookmarks-'+(++suffix);menu.push(bookmarkMenuItem(id));}
 return {maxEntries:v.maxEntries??2_000_000,roots:[...new Set(v.roots)],excluded:[...new Set(v.excluded)],bookmarks:[...new Set(v.bookmarks)],shortcut:v.shortcut,doubleCtrl:v.doubleCtrl,explorerTyping:v.explorerTyping,explorerMenu:v.explorerMenu,dialogSwitch:v.dialogSwitch,fuzzy:v.fuzzy??true,pinyin:v.pinyin??true,menu,menuVersion:1,menuBar:validateMenuBar(v.menuBar,menu)};
}
const groups:Record<string,Set<string>>={doc:new Set(['txt','md','pdf','doc','docx','ppt','pptx','xls','xlsx','csv','rtf','epub']),pic:new Set(['png','jpg','jpeg','webp','gif','bmp','tif','tiff','svg','avif','heic']),video:new Set(['mp4','mkv','webm','avi','mov','m4v']),audio:new Set(['mp3','flac','wav','m4a','ogg','aac','opus'])};
export function searchMatcher(query:string,foldersOnly=false){
 const tokens=(query.match(/"[^"]*"|\S+/g)||[]).map(t=>t.replace(/^"|"$/g,'').toLowerCase());let type=foldersOnly?'folder':'',extension='';const terms:string[]=[];
 for(const token of tokens){if(/^(folder|file|doc|pic|video|audio):$/.test(token))type=token.slice(0,-1);else if(token.startsWith('ext:'))extension=token.slice(4).replace(/^\./,'');else if(token.startsWith('folder:')){type='folder';if(token.length>7)terms.push(token.slice(7));}else terms.push(token);}
 return (item:SearchEntry)=>{if((foldersOnly||type==='folder')&&!item.directory||type&&type!=='folder'&&item.directory)return -1;const name=item.name.toLowerCase(),ext=name.includes('.')?name.split('.').pop()!:'';if(extension&&!extension.split(';').includes(ext)||groups[type]&&!groups[type].has(ext))return -1;
 const path=item.path.toLowerCase();let score=item.directory?3:0;for(const term of terms){const normalized=term.replace(/\//g,'\\');const at=name.indexOf(normalized);if(at>=0)score+=name===normalized?100:at===0?50:25;else if(path.includes(normalized))score+=5;else return -1;}return score;};
}
