export interface SearchWebEngine {id:string;shortcut:string;name:string;url:string;icon?:string}

export const builtinSearchEngines:SearchWebEngine[]=[
 {id:'google',shortcut:'g',name:'Google',url:'https://www.google.com/search?q={query}'},
 {id:'bing',shortcut:'b',name:'Bing',url:'https://www.bing.com/search?q={query}'},
 {id:'duckduckgo',shortcut:'ddg',name:'DuckDuckGo',url:'https://duckduckgo.com/?q={query}'},
 {id:'baidu',shortcut:'bd',name:'百度',url:'https://www.baidu.com/s?wd={query}'}
];

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
export type SearchShortcutMode=SearchShortcutPresentation&({kind:'one';query:string}|{kind:'engine';query:string;engine:SearchWebEngine}|{kind:'extension';query:string;extensions:string[]});
export function parseSearchShortcut(raw:string,custom:SearchWebEngine[]=[]):SearchShortcutMode|null{
 const match=/^\s*(\S+)(\s)([\s\S]*)$/.exec(raw);if(!match)return null;
 const prefix=match[1].toLowerCase(),query=match[3].trim();
 if(prefix==='>')return {kind:'one',query,placeholder:'搜索 One 的功能和操作',showFilters:false};
 if(/^\.[a-z0-9]{1,12}(?:\|\.?[a-z0-9]{1,12})*$/i.test(prefix)){
  const extensions=[...new Set(prefix.split('|').map(part=>part.replace(/^\./,'').toLowerCase()))];
  return {kind:'extension',query,extensions,placeholder:`搜索 ${extensions.map(ext=>'.'+ext).join('、')} 文件`,showFilters:true};
 }
 const engine=[...builtinSearchEngines,...custom].find(item=>item.shortcut===prefix);
 return engine?{kind:'engine',query,engine,placeholder:`使用 ${engine.name} 搜索网页`,showFilters:false}:null;
}
