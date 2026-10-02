import {menuEditorCard,setupMenuEditor} from './menu-editor';
import {subscribeSnapshot} from './event-snapshot';
import {api,q,icon,iconButton,button,esc,switchControl,toast,action} from './ui';
import {bindPreference} from './preferences';
import {setupShortcut} from './shortcut';
import {SearchResults} from './search-results';
import {isWindowVisible,onWindowVisibility} from './window-visibility';
import {defaultSearch,type SearchSettings,type SearchEntry,type SearchContext,type SearchState} from '../shared/search';
const searchSwitch=(key:string,title:string,description='')=>`<div class="setting-row"><div class="setting-copy"><h2>${title}</h2>${description?`<p>${description}</p>`:''}</div>${switchControl('search-'+key,title)}</div>`;
const pathSection=(title:string,add:string,list:string)=>`<section class="search-path-section"><div class="search-path-heading section-heading"><h2 class="section-label">${title}</h2>${button(add,'添加','plus')}</div><div class="settings-card"><div id="${list}" class="search-paths"></div></div></section>`;
export function searchPage(){return `<div class="search-settings"><div class="toolbar search-page-toolbar"><div class="tabs" role="tablist" aria-label="文件搜索设置">${[['entry','搜索'],['index','索引'],['menu','快捷菜单']].map(([id,label])=>`<button id="search-tab-${id}" data-search-tab="${id}" role="tab" aria-selected="${id==='entry'}" class="${id==='entry'?'selected':''}">${label}</button>`).join('')}</div>${button('search-launch','打开搜索','search',true)}</div><div data-search-panel="entry"><div class="search-settings-grid"><div><h2 class="section-label">快捷入口</h2><div class="settings-card"><div class="setting-row"><div class="setting-copy"><h2>搜索窗口</h2></div><input id="search-shortcut" aria-label="文件搜索快捷键"></div>${searchSwitch('doubleCtrl','双按 Ctrl')}${searchSwitch('explorerTyping','直接输入搜索','资源管理器文件列表')}${searchSwitch('explorerMenu','双击空白处菜单','资源管理器文件列表')}${searchSwitch('dialogSwitch','文件对话框跳转','Ctrl+G')}</div></div><div><h2 class="section-label">匹配方式</h2><div class="settings-card">${searchSwitch('fuzzy','模糊搜索')}${searchSwitch('pinyin','拼音与首字母')}</div>${pathSection('收藏文件夹','search-bookmark','search-bookmarks')}</div></div><p class="utility-message" id="search-bridge-error" role="alert"></p></div><div data-search-panel="index" hidden><div class="settings-card index-limit"><div class="preference-row"><label for="index-limit">索引项上限</label><input type="number" id="index-limit" min="1000" max="10000000" step="1000" aria-label="索引项上限"></div></div><div class="index-status-bar"><span id="index-summary" role="status"></span><span id="index-detail"></span><div class="spacer"></div>${button('index-cancel','停止')}${button('index-refresh','重新扫描','refresh')}</div><div class="search-settings-grid">${pathSection('索引目录','index-add','index-roots')}${pathSection('排除目录','index-exclude','index-excluded')}</div></div><div data-search-panel="menu" hidden>${menuEditorCard()}</div></div>`;}
export function setupSearchPage(){let config:SearchSettings,settingsRevision=0;setupShortcut(q<HTMLInputElement>('search-shortcut'));
 const tab=(id:string)=>{document.querySelectorAll<HTMLElement>('[data-search-panel]').forEach(p=>p.hidden=p.dataset.searchPanel!==id);document.querySelectorAll<HTMLElement>('[data-search-tab]').forEach(b=>{b.classList.toggle('selected',b.dataset.searchTab===id);b.setAttribute('aria-selected',String(b.dataset.searchTab===id));});};
 document.querySelectorAll<HTMLButtonElement>('[data-search-tab]').forEach(b=>b.onclick=()=>tab(b.dataset.searchTab!));
 const update=async(patch:Partial<SearchSettings>)=>{const revision=settingsRevision,result=await api.patchSettings({search:patch});if(revision===settingsRevision)accept(result.search);return result;};
 const drawPaths=(id:string,key:'roots'|'excluded'|'bookmarks')=>{q(id).innerHTML=config[key].length?config[key].map((p,i)=>`<div><span title="${esc(p)}">${icon('folder')}<span>${esc(p)}</span></span><button class="icon-button quiet" data-remove="${i}" aria-label="移除 ${esc(p)}">${icon('close')}</button></div>`).join(''):'<p class="path-empty">未添加</p>';q(id).querySelectorAll<HTMLButtonElement>('[data-remove]').forEach(b=>b.onclick=()=>{const path=config[key][Number(b.dataset.remove)];void update({[key]:config[key].filter(p=>p!==path)}).catch(toast);});};
 const render=(s:SearchState&{bridgeError:string})=>{q('index-summary').textContent=`${s.running?'正在索引 · ':''}${s.count.toLocaleString()} 项`;q('index-detail').textContent=s.error||(s.issues?`${s.issues} 项未能读取`:s.running?s.root:s.updated?`更新于 ${new Date(s.updated).toLocaleTimeString()}`:'');q('index-detail').title=s.root;q('search-bridge-error').textContent=s.bridgeError;q<HTMLButtonElement>('index-cancel').hidden=!s.running;};
 const drawMenu=setupMenuEditor(()=>({menu:config?.menu||defaultSearch().menu,menuBar:config?.menuBar||defaultSearch().menuBar}),async layout=>{await update(layout);});
 const fill=(previous?:SearchSettings)=>{const set=(id:string,value:string|boolean)=>{const control=q<HTMLInputElement>(id);if(document.activeElement===control)return;if(typeof value==='boolean')control.checked=value;else control.value=value;};if(!previous||previous.maxEntries!==config.maxEntries)set('index-limit',String(config.maxEntries));if(!previous||previous.shortcut!==config.shortcut)set('search-shortcut',config.shortcut);for(const key of ['doubleCtrl','explorerTyping','explorerMenu','dialogSwitch','fuzzy','pinyin'] as const)if(!previous||previous[key]!==config[key])set('search-'+key,config[key]);};
 const accept=(next:SearchSettings)=>{const previous=config;config=next;settingsRevision++;for(const [id,key] of [['index-roots','roots'],['index-excluded','excluded'],['search-bookmarks','bookmarks']] as const)if(!previous||JSON.stringify(previous[key])!==JSON.stringify(next[key]))drawPaths(id,key);const menuChanged=!previous||JSON.stringify(previous.menu)!==JSON.stringify(next.menu);if(menuChanged||JSON.stringify(previous?.menuBar)!==JSON.stringify(next.menuBar))drawMenu();fill(previous);};
 const load=()=>{const revision=settingsRevision;return api.searchPreferences().then(search=>{if(revision===settingsRevision)accept(search);});};void subscribeSnapshot(api.onSearchPreferences,api.searchPreferences,accept).catch(toast);document.querySelector('[data-page=search]')?.addEventListener('click',()=>void load().catch(toast));api.onSearchSettings(()=>void load().catch(toast));
 for(const key of ['shortcut','doubleCtrl','explorerTyping','explorerMenu','dialogSwitch','fuzzy','pinyin'] as const){const control=q<HTMLInputElement>('search-'+key);control.addEventListener('change',()=>void update({[key]:key==='shortcut'?control.value:control.checked}).catch(error=>{fill();toast(error);}));}
 for(const [id,key]of [['index-add','roots'],['index-exclude','excluded'],['search-bookmark','bookmarks']] as const)action(id,async()=>{const path=await api.pickDirectory();if(path&&!config[key].includes(path)){await update({[key]:[...config[key],path]});}});
 bindPreference(q('index-limit'),()=>({search:{maxEntries:Number(q<HTMLInputElement>('index-limit').value)}}),load);
 action('index-refresh',()=>api.rebuildSearch());action('index-cancel',()=>api.cancelSearchIndex());action('search-launch',()=>api.showSearch());api.onSearchState(render);void api.searchState().then(render).catch(toast);
}
export async function renderSearch(){
 const embedded=new URLSearchParams(location.search).has('embedded');
 document.body.classList.add('search-window');if(embedded)document.body.classList.add('search-inline');
 const filters=[['','全部'],...(!embedded?[['app:','程序'],['setting:','设置']]:[]),['folder:','文件夹'],['doc:','文档'],['pic:','图片'],['video:','视频'],['audio:','音频']];
 document.querySelector('#app')!.innerHTML=`<div class="search-shell"><header class="search-input-row drag-region">${icon('search')}<input id="file-query" placeholder="搜索文件与文件夹" aria-label="搜索文件与文件夹" role="combobox" aria-autocomplete="list" aria-controls="search-results" aria-expanded="false" autocomplete="off" spellcheck="false">${embedded?'<span id="search-inline-summary" role="status"></span>':''}${iconButton('search-clear','清空','close')}</header><div class="search-filter-row" id="search-filters"><div class="tabs" role="tablist" aria-label="搜索类型">${filters.map(([filter,label],i)=>`<button data-filter="${filter}" role="tab" aria-selected="${i===0}" class="${i===0?'selected':''}">${label}</button>`).join('')}</div></div><div id="search-results" class="search-results" role="listbox" aria-label="搜索结果" aria-busy="false"></div><footer class="search-footer"><span id="search-summary" role="status"></span><span id="search-keys">↑↓ 选择 · Enter 打开 · Alt+P 预览</span></footer></div><div id="toast" class="toast" role="status" hidden></div>`;
 const input=q<HTMLInputElement>('file-query'),list=q('search-results');
 let context:SearchContext={kind:'search',hwnd:0,pid:0,created:'',folders:[]},prefs:SearchSettings,filter='';
 let revision=0,navigation=0,shownKey='',composing=false,inputPending=false,backgroundPending=false;
 let inputTimer:ReturnType<typeof setTimeout>|undefined,refreshTimer:ReturnType<typeof setTimeout>|undefined;
 let running:{version:number;key:string;navigation:number}|undefined,lastLayout='',lastInlineSummary='';
 let progressive:{token:string;accept:(result:import('../shared/search').SearchResult)=>void}|undefined;
 api.onSearchProgress(value=>{if(value.token===progressive?.token)progressive.accept(value.result);});
 const nameMarkup=(item:SearchEntry)=>{
  const terms=(input.value.match(/"[^"]*"|\S+/g)||[]).map(t=>t.replace(/^"|"$/g,'')).filter(t=>!t.includes(':'));
  const lower=item.name.toLowerCase(),matched=new Set<number>();
  for(const term of terms){const value=term.toLowerCase(),at=lower.indexOf(value);if(at>=0){for(let i=at;i<at+value.length;i++)matched.add(i);}else if(item.matchKind==='fuzzy'){let cursor=0;for(const char of value){const at=lower.indexOf(char,cursor);if(at<0)break;matched.add(at);cursor=at+1;}}}
  let offset=0;return Array.from(item.name).map(c=>{const active=matched.has(offset);offset+=c.length;return active?`<mark>${esc(c)}</mark>`:esc(c);}).join('');
 };
 const results=new SearchResults(list,input,embedded,nameMarkup);
 // Enriching the same Explorer context only changes ranking, not user intent.
 const key=()=>JSON.stringify([input.value.trim(),filter,context.kind,context.hwnd]);
 const layout=()=>{
  const active=!!input.value.trim()||!!filter;
  document.body.classList.toggle('search-idle',!embedded&&!active);
  document.body.classList.toggle('search-has-results',embedded&&(results.count>0||active));
  const next=embedded?`${results.count}:${active}`:String(active);
  if(next!==lastLayout){lastLayout=next;void api.searchSize(results.count,active);}
 };
 const summary=(text:string,inline=results.count?`${results.count.toLocaleString()} 项`:'')=>{
  q('search-summary').textContent=text;lastInlineSummary=inline;if(embedded)q('search-inline-summary').textContent=inline;
 };
 const choose=async(index=results.selected)=>{const item=results.entry(index);if(item)try{await api.searchChoose(item.path);}catch(e){toast(e);}};
 const stopTimers=()=>{clearTimeout(inputTimer);clearTimeout(refreshTimer);inputTimer=undefined;refreshTimer=undefined;};
 const invalidate=()=>{revision++;progressive=undefined;stopTimers();backgroundPending=false;inputPending=false;list.setAttribute('aria-busy','false');};
 // Background indexing never cancels an in-flight query. Many notifications become
 // one follow-up query; typing still invalidates old responses immediately.
 const refresh=()=>{
  if(!isWindowVisible()||composing||inputPending)return;
  backgroundPending=true;if(running||refreshTimer)return;
  refreshTimer=setTimeout(()=>{refreshTimer=undefined;if(backgroundPending)void query();},160);
 };
 const query=async()=>{
  if(!isWindowVisible()||composing)return;
  stopTimers();inputPending=false;backgroundPending=false;
  const request={version:++revision,key:key(),navigation},text=input.value.trim();running=request;layout();
  const current=()=>request.version===revision&&request.key===key()&&isWindowVisible();
  const update=(entries:SearchEntry[])=>{
   // Resolve identity at completion, after any arrows pressed during the request.
   results.update(entries,shownKey===request.key||navigation!==request.navigation,text?'没有匹配的项目':'输入名称开始搜索');
   shownKey=request.key;layout();
  };
  try{
   if(!embedded&&!text&&!filter){update([]);summary('');return;}
   if(!text&&!filter){
    const seen=new Set<string>(),entries=[...(prefs?.bookmarks||[]),...context.folders.map(f=>f.path)].filter(p=>{const k=p.toLowerCase();if(seen.has(k))return false;seen.add(k);return true;}).map(path=>({path,name:path.split(/[\\/]/).filter(Boolean).pop()||path,directory:true,size:0,modified:0}));
    update(entries);const s=await api.searchState();if(current())summary(results.count?'收藏与已打开的文件夹':s.count?'输入名称开始搜索':'请先在 One 中添加索引目录');return;
   }
   list.setAttribute('aria-busy','true');if(embedded&&shownKey!==request.key)q('search-inline-summary').textContent='搜索中';
   const token=crypto.randomUUID();progressive={token,accept:result=>{if(!current()||result.cancelled)return;update(result.items);summary(`本文件夹 · ${result.total.toLocaleString()} 项 · 正在搜索其他位置`,`${result.total.toLocaleString()} 项 · 搜索中`);}};
   const result=await api.searchFiles(filter+' '+text,context.kind==='dialog',token);
   if(!current())return;
   if(result.cancelled){if(embedded)q('search-inline-summary').textContent=lastInlineSummary;return;}
   update(result.items);
   summary(`${result.total.toLocaleString()} 项${result.total>100?' · 显示前 100 项':''} · ${Math.round(result.elapsed)} ms`,result.total?`${result.total.toLocaleString()} 项`:'无结果');
  }catch(e){if(current()){if(embedded)q('search-inline-summary').textContent='';toast(e);}}
  finally{
   if(running===request){running=undefined;progressive=undefined;if(current())list.setAttribute('aria-busy','false');if(backgroundPending)refresh();}
  }
 };
 const newQuery=()=>{invalidate();results.select(0);void query();};
 input.addEventListener('input',e=>{
  invalidate();inputPending=true;results.select(0);layout();
  if(composing||(e as InputEvent).isComposing)return;
  inputTimer=setTimeout(()=>void query(),75);
 });
 input.addEventListener('compositionstart',()=>{composing=true;invalidate();inputPending=true;});
 input.addEventListener('compositionend',()=>{composing=false;void query();});
 const rowIndex=(target:EventTarget|null)=>target instanceof Element?Number(target.closest<HTMLElement>('[data-result]')?.dataset.result):NaN;
 list.addEventListener('dragstart',event=>{
  event.preventDefault();const row=event.target instanceof Element?event.target.closest<HTMLElement>('[data-drag-path]'):null;
  if(!row||event.target instanceof Element&&event.target.closest('button'))return;
  const path=row.dataset.dragPath!;navigation++;results.select(Number(row.dataset.result));
  void api.startFileDrag(path).catch(toast);
 });
 list.addEventListener('click',event=>{
  const index=rowIndex(event.target),item=results.entry(index);if(!item)return;
  const control=event.target instanceof Element?event.target.closest('[data-preview],[data-reveal]'):null;
  if(control){void (control.hasAttribute('data-preview')?api.preview(item.path):api.revealFile(item.path)).catch(toast);return;}
  navigation++;results.select(index);
 });
 list.addEventListener('dblclick',event=>{if(event.target instanceof Element&&event.target.closest('button'))return;const index=rowIndex(event.target);if(results.entry(index))void choose(index);});
 list.addEventListener('contextmenu',event=>{
  const index=rowIndex(event.target),item=results.entry(index);if(!item)return;
  event.preventDefault();navigation++;results.select(index);
  void api.searchContextMenu(item.path,{x:event.clientX,y:event.clientY},item.directory).catch(toast);
 });
 document.addEventListener('keydown',e=>{
  if(e.isComposing||composing)return;
  if(e.key==='Escape'){e.preventDefault();void api.closeWindow();return;}
  // SegmentTab handles its own keyboard navigation and button activation.
  if(e.target instanceof Element&&e.target.closest('#search-filters'))return;
  const item=results.entry();
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){
   e.preventDefault();navigation++;results.select(results.selected+(e.key==='ArrowDown'?1:-1),true);
  }else if(e.ctrlKey&&/^[1-9]$/.test(e.key)&&embedded){e.preventDefault();void choose(Number(e.key)-1);}
  else if(e.key==='Enter'){
   e.preventDefault();if(document.body.classList.contains('search-idle'))return;
   if(e.ctrlKey&&item&&!item.launchKind)void api.revealFile(item.path).catch(toast);else void choose();
  }else if(e.altKey&&e.key.toLowerCase()==='p'&&item&&!item.launchKind){e.preventDefault();void api.preview(item.path).catch(toast);}
 });
 const syncFilters=()=>document.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach(b=>{
  const active=b.dataset.filter===filter;b.classList.toggle('selected',active);b.setAttribute('aria-selected',String(active));
 });
 q('search-clear').onclick=()=>{if(!input.value){void api.closeWindow();return;}input.value='';input.focus();newQuery();};
 document.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach(b=>b.onclick=event=>{
  filter=b.dataset.filter!;syncFilters();if(event.detail)input.focus();newQuery();
 });
 const applyContext=(c:SearchContext)=>{
  const previous=key(),previousFolder=context.currentFolder;context=c;
  document.title=(c.kind==='dialog'?'跳转文件夹':c.kind==='menu'?'文件夹菜单':'文件搜索')+' · One';
  q('search-keys').textContent=c.kind==='search'?'↑↓ 选择 · Enter 打开 · Alt+P 预览':'↑↓ 选择 · Enter 跳转 · Alt+P 预览';
  q('search-filters').hidden=c.kind==='dialog';
  input.placeholder=c.kind==='dialog'?'搜索要跳转的文件夹':embedded?'搜索文件与文件夹':'搜索文件、程序与设置';
  if(key()!==previous)newQuery();else if(previousFolder!==c.currentFolder){invalidate();void query();}else refresh();
 };
 onWindowVisibility(visible=>{invalidate();if(visible){lastLayout='';void query();}});
 api.onSearchFilesChanged(refresh);
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')invalidate();});
 api.onSearchState(()=>{if(input.value.trim()||filter)refresh();});
 api.onSearchContext(applyContext);
 api.onSearchReset(()=>{
  invalidate();shownKey='';input.value='';filter='';syncFilters();input.focus();
  const reset=revision;void api.searchPreferences().then(p=>{prefs=p;if(revision===reset)void query();});void api.searchReady();
 });
 input.focus();void api.searchReady();await subscribeSnapshot(api.onSearchPreferences,api.searchPreferences,next=>{const changed=JSON.stringify(prefs?.bookmarks)!==JSON.stringify(next.bookmarks);prefs=next;if(changed&&!input.value.trim()&&!filter)refresh();});
 if(context.hwnd===0)applyContext(await api.searchContext());else void query();
}
