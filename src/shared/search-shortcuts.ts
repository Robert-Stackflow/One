export interface SearchWebEngine {id:string;shortcut:string;name:string;url:string;icon?:string}

export const builtinSearchEngines:SearchWebEngine[]=[
 {id:'google',shortcut:'g',name:'Google',url:'https://www.google.com/search?q={query}'},
 {id:'bing',shortcut:'b',name:'Bing',url:'https://www.bing.com/search?q={query}'},
 {id:'duckduckgo',shortcut:'ddg',name:'DuckDuckGo',url:'https://duckduckgo.com/?q={query}'},
 {id:'baidu',shortcut:'bd',name:'百度',url:'https://www.baidu.com/s?wd={query}'}
];

export interface BuiltinSearchCommand {id:string;shortcut:string;name:string;description:string;placeholder:string;showFilters:boolean;icon:string;queryPrefix?:string}
export const builtinSearchCommands:BuiltinSearchCommand[]=[
 {id:'one',shortcut:'>',name:'One 命令',description:'搜索 One 的页面和操作',placeholder:'搜索 One 的功能和操作',showFilters:false,icon:'terminal'},
 {id:'extension',shortcut:'.扩展名',name:'扩展名',description:'支持 .zip 和 .zip|7z 等格式组合',placeholder:'搜索指定扩展名的文件',showFilters:true,icon:'file'},
 {id:'app',shortcut:'app',name:'应用',description:'搜索已注册的应用',placeholder:'搜索应用',showFilters:false,icon:'window',queryPrefix:'app:'},
 {id:'cfg',shortcut:'cfg',name:'设置',description:'搜索 Windows 设置',placeholder:'搜索 Windows 设置',showFilters:false,icon:'settings',queryPrefix:'setting:'},
 {id:'dir',shortcut:'dir',name:'文件夹',description:'只搜索文件夹',placeholder:'搜索文件夹',showFilters:false,icon:'folder',queryPrefix:'folder:'},
 {id:'file',shortcut:'file',name:'文件',description:'搜索文件，不包含文件夹',placeholder:'搜索文件',showFilters:true,icon:'file',queryPrefix:'file:'},
 {id:'doc',shortcut:'doc',name:'文档',description:'搜索常见文档格式',placeholder:'搜索文档',showFilters:false,icon:'text',queryPrefix:'doc:'},
 {id:'img',shortcut:'img',name:'图片',description:'搜索图片文件',placeholder:'搜索图片',showFilters:false,icon:'images',queryPrefix:'pic:'},
 {id:'vid',shortcut:'vid',name:'视频',description:'搜索视频文件',placeholder:'搜索视频',showFilters:false,icon:'play',queryPrefix:'video:'},
 {id:'aud',shortcut:'aud',name:'音频',description:'搜索音频文件',placeholder:'搜索音频',showFilters:false,icon:'music',queryPrefix:'audio:'},
 {id:'arc',shortcut:'arc',name:'压缩包',description:'搜索压缩包文件',placeholder:'搜索压缩包',showFilters:false,icon:'archive',queryPrefix:'archive:'},
 {id:'mm',shortcut:'mm',name:'媒体文件',description:'图片、视频和音频，可继续筛选类型',placeholder:'搜索图片、视频或音频',showFilters:true,icon:'images'},
 {id:'recent',shortcut:'recent',name:'最近访问',description:'通过 One 搜索打开过的文件和文件夹',placeholder:'搜索最近通过 One 打开的项目',showFilters:false,icon:'history'},
 {id:'fav',shortcut:'fav',name:'收藏文件夹',description:'搜索已收藏的文件夹',placeholder:'搜索收藏文件夹',showFilters:false,icon:'star'}
];
export const reservedSearchShortcuts=new Set(builtinSearchCommands.filter(item=>item.id!=='extension').map(item=>item.shortcut));
export const mediaSearchExtensions=['png','jpg','jpeg','webp','gif','bmp','tif','tiff','svg','avif','heic','mp4','mkv','webm','avi','mov','m4v','mp3','flac','wav','m4a','ogg','aac','opus'];
export function validateDisabledSearchCommands(value:unknown):string[]{
 if(value===undefined)return [];
 if(!Array.isArray(value)||value.length>builtinSearchCommands.length||value.some(id=>typeof id!=='string'||!builtinSearchCommands.some(item=>item.id===id)))throw new Error('快捷命令设置无效');
 return [...new Set(value)];
}

export function searchEngineUrl(template:string,query:string):string{
 if(typeof template!=='string'||template.length>2048||!template.includes('{query}'))throw new Error('搜索地址需包含 {query}');
 const url=new URL(template.replaceAll('{query}',encodeURIComponent(query)));
 if(url.protocol!=='https:'||!url.hostname||url.username||url.password||url.port||/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?)/i.test(url.hostname))throw new Error('请输入公开网站的 HTTPS 搜索地址');
 return url.href;
}

export function validateSearchEngines(value:unknown):SearchWebEngine[]{
 if(value===undefined)return [];
 if(!Array.isArray(value)||value.length>24)throw new Error('自定义搜索引擎最多 24 个');
 const used=new Set(builtinSearchEngines.map(engine=>engine.shortcut));
 return value.map((raw:unknown)=>{
  if(!raw||typeof raw!=='object')throw new Error('搜索引擎设置无效');
  const item=raw as Partial<SearchWebEngine>;
  if(typeof item.id!=='string'||!/^[-\w]{1,80}$/.test(item.id)||typeof item.shortcut!=='string'||!/^\p{L}[\p{L}\d-]{0,15}$/u.test(item.shortcut)||typeof item.name!=='string'||!item.name.trim()||item.name.length>60||typeof item.url!=='string')throw new Error('搜索引擎设置无效');
  const shortcut=item.shortcut.toLowerCase();if(used.has(shortcut))throw new Error('快捷命令已被占用');used.add(shortcut);
  searchEngineUrl(item.url,'test');
  if(item.icon!==undefined&&(typeof item.icon!=='string'||item.icon.length>350_000||item.icon&&!/^data:image\/(?:png|jpeg|gif|webp|x-icon|vnd\.microsoft\.icon);base64,/i.test(item.icon)))throw new Error('搜索引擎图标无效');
  return {id:item.id,shortcut,name:item.name.trim(),url:item.url,...(item.icon?{icon:item.icon}:{})};
 });
}

type SearchShortcutPresentation={placeholder:string;showFilters:boolean};
export type SearchShortcutMode=SearchShortcutPresentation&({kind:'one';query:string}|{kind:'engine';query:string;engine:SearchWebEngine}|{kind:'extension';query:string;extensions:string[]}|{kind:'category';query:string;command:BuiltinSearchCommand});
export function parseSearchShortcut(raw:string,custom:SearchWebEngine[]=[],disabled:string[]=[]):SearchShortcutMode|null{
 const match=/^\s*(\S+)(\s)([\s\S]*)$/.exec(raw);if(!match)return null;
 const prefix=match[1].toLowerCase(),query=match[3].trim();
 if(prefix==='>'&&!disabled.includes('one'))return {kind:'one',query,placeholder:'搜索 One 的功能和操作',showFilters:false};
 if(!disabled.includes('extension')&&/^\.[a-z0-9]{1,12}(?:\|\.?[a-z0-9]{1,12})*$/i.test(prefix)){
  const extensions=[...new Set(prefix.split('|').map(part=>part.replace(/^\./,'').toLowerCase()))];
  return {kind:'extension',query,extensions,placeholder:`搜索 ${extensions.map(ext=>'.'+ext).join('、')} 文件`,showFilters:true};
 }
 const command=builtinSearchCommands.find(item=>item.shortcut===prefix&&!disabled.includes(item.id));
 if(command)return {kind:'category',query,command,placeholder:command.placeholder,showFilters:command.showFilters};
 const engine=[...builtinSearchEngines,...custom].find(item=>item.shortcut===prefix);
 return engine?{kind:'engine',query,engine,placeholder:`使用 ${engine.name} 搜索网页`,showFilters:false}:null;
}
