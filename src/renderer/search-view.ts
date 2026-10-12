import {indexPrioritySections,setupIndexPriorities} from './index-priorities';
import {menuEditorCard,setupMenuEditor} from './menu-editor';
import {subscribeSnapshot} from './event-snapshot';
import {api,q,icon,iconButton,button,esc,switchControl,toast,action,errorMessage} from './ui';
import {bindPreference} from './preferences';
import {setupShortcut} from './shortcut';
import {SearchResults} from './search-results';
import {commandMatches} from './search-commands';
import {customControls,updateSelectOptions} from './controls';
import {isWindowVisible,onWindowVisibility} from './window-visibility';
import {defaultSearch,type SearchSettings,type SearchEntry,type SearchContext,type SearchState} from '../shared/search';
import {builtinSearchCommands,builtinSearchEngines,mediaSearchExtensions,parseSearchShortcut,reservedSearchShortcuts,searchEngineUrl,type SearchWebEngine} from '../shared/search-shortcuts';
import {dialogMarkup,openDialog,closeDialog} from './dialog';
import type {AIHistoryEntry} from '../shared/ai';
const searchSwitch=(key:string,title:string,description='')=>`<div class="setting-row"><div class="setting-copy"><h2>${title}</h2>${description?`<p>${description}</p>`:''}</div>${switchControl('search-'+key,title)}</div>`;
const pathSection=(title:string,add:string,list:string)=>`<section class="search-path-section"><div class="search-path-heading section-heading"><h2 class="section-label">${title}</h2>${button(add,'添加','plus')}</div><div class="settings-card"><div id="${list}" class="search-paths"></div></div></section>`;
export function searchPage(){return `<div class="search-settings"><div class="toolbar search-page-toolbar"><div class="tabs" role="tablist" aria-label="文件搜索设置">${[['entry','搜索'],['index','索引'],['shortcuts','快捷命令'],['history','历史'],['menu','快捷菜单']].map(([id,label])=>`<button id="search-tab-${id}" data-search-tab="${id}" role="tab" aria-selected="${id==='entry'}" class="${id==='entry'?'selected':''}">${label}</button>`).join('')}</div>${button('search-launch','打开命令面板','search',true)}</div><div data-search-panel="entry"><div class="search-settings-grid"><div><h2 class="section-label">快捷入口</h2><div class="settings-card"><div class="setting-row"><div class="setting-copy"><h2>命令面板</h2><p>搜索文件、程序、设置与 One 操作；输入 &gt; 仅查看命令。</p></div><input id="search-shortcut" aria-label="命令面板快捷键"></div><div class="setting-row"><div class="setting-copy"><h2>定位当前程序</h2><p>在资源管理器中选中可执行文件</p></div><input id="search-programShortcut" aria-label="定位当前程序快捷键"></div>${searchSwitch('doubleCtrl','双按 Ctrl')}${searchSwitch('explorerTyping','直接输入搜索','资源管理器文件列表')}${searchSwitch('explorerMenu','双击空白处菜单','资源管理器文件列表')}${searchSwitch('dialogSwitch','文件对话框操作栏','搜索与目录跳转')}</div></div><div><h2 class="section-label">匹配方式</h2><div class="settings-card">${searchSwitch('fuzzy','模糊搜索')}${searchSwitch('pinyin','拼音与首字母')}</div>${pathSection('收藏文件夹','search-bookmark','search-bookmarks')}</div></div><p class="utility-message" id="search-bridge-error" role="alert"></p></div><div data-search-panel="index" hidden><div class="settings-card index-limit"><div class="preference-row"><label for="index-limit">索引项上限</label><input type="number" id="index-limit" min="1000" max="10000000" step="1000" aria-label="索引项上限"></div></div><div class="index-status-bar"><span id="index-summary" role="status"></span><span id="index-detail"></span><div class="spacer"></div>${button('index-cancel','停止')}${button('index-refresh','重新扫描','refresh')}</div>${indexPrioritySections()}</div><div data-search-panel="shortcuts" hidden><h2 class="section-label">内置快捷命令</h2><p class="utility-message">在搜索窗口输入命令并按空格进入对应模式。关闭的命令不会触发；按 Esc 或点击标签退出。</p><div id="search-command-list" class="settings-card search-command-card"></div><div class="section-heading search-web-heading"><h2 class="section-label">搜索引擎</h2>${button('search-web-engine-add','添加搜索引擎','plus')}</div><div id="search-web-engine-list" class="settings-card"></div></div><div data-search-panel="history" hidden><div class="section-heading"><h2 class="section-label">搜索历史</h2>${button('search-history-clear','清空历史','trash')}</div><p class="utility-message">记录搜索词、快捷命令和已完成的 AI 回答。</p><div id="search-history-list" class="settings-card"></div></div><div data-search-panel="menu" hidden>${menuEditorCard()}</div></div>`;}
export function setupSearchPage(){let config:SearchSettings,settingsRevision=0;for(const key of ['shortcut','programShortcut'])setupShortcut(q<HTMLInputElement>('search-'+key));
 const drawHistory=async()=>{const list=document.getElementById('search-history-list');if(!list)return;const entries=(await api.aiState()).history;list.innerHTML=entries.length?entries.map(item=>`<div class="search-history-row"><div><strong>${esc(item.query)}</strong><small>${esc(item.command)} · ${new Date(item.time).toLocaleString()}</small>${item.result?`<p>${esc(item.result)}</p>`:''}</div></div>`).join(''):'<p class="ai-empty">暂无搜索历史。</p>';};
 q('search-history-clear').addEventListener('click',()=>void api.searchHistoryClear().then(drawHistory).catch(toast));api.onAIEvent(event=>{if(event.kind==='changed'&&!q('search-history-list').closest('[hidden]'))void drawHistory().catch(toast);});
 const tab=(id:string)=>{document.querySelectorAll<HTMLElement>('[data-search-panel]').forEach(p=>p.hidden=p.dataset.searchPanel!==id);document.querySelectorAll<HTMLElement>('[data-search-tab]').forEach(b=>{b.classList.toggle('selected',b.dataset.searchTab===id);b.setAttribute('aria-selected',String(b.dataset.searchTab===id));});};
 document.querySelectorAll<HTMLButtonElement>('[data-search-tab]').forEach(b=>b.onclick=()=>{tab(b.dataset.searchTab!);if(b.dataset.searchTab==='history')void drawHistory().catch(toast);});
 const update=async(patch:Partial<SearchSettings>)=>{const revision=settingsRevision,result=await api.patchSettings({search:patch});if(revision===settingsRevision)accept(result.search);return result;};
 const drawPriorities=setupIndexPriorities(()=>config,update);
 const drawPaths=(id:string,key:'roots'|'excluded'|'bookmarks')=>{q(id).innerHTML=config[key].length?config[key].map((p,i)=>`<div><span title="${esc(p)}">${icon('folder')}<span>${esc(p)}</span></span><button class="icon-button quiet" data-remove="${i}" aria-label="移除 ${esc(p)}">${icon('close')}</button></div>`).join(''):'<p class="path-empty">未添加</p>';q(id).querySelectorAll<HTMLButtonElement>('[data-remove]').forEach(b=>b.onclick=()=>{const path=config[key][Number(b.dataset.remove)];void update({[key]:config[key].filter(p=>p!==path)}).catch(toast);});};
 const render=(s:SearchState&{bridgeError:string})=>{q('index-summary').textContent=`${s.running?'正在索引 · ':''}${s.count.toLocaleString()} 项`;q('index-detail').textContent=s.error||(s.issues?`${s.issues} 项未能读取`:s.running?s.root:s.updated?`更新于 ${new Date(s.updated).toLocaleTimeString()}`:'');q('index-detail').title=s.root;q('search-bridge-error').textContent=s.bridgeError;q<HTMLButtonElement>('index-cancel').hidden=!s.running;};
 const drawMenu=setupMenuEditor(()=>({menu:config?.menu||defaultSearch().menu,menuBar:config?.menuBar||defaultSearch().menuBar}),async layout=>{await update(layout);});
 const webIcons=new Map<string,string>();
 const webIcon=(engine:SearchWebEngine)=>{const image=engine.icon||webIcons.get(engine.url);return image?`<img src="${esc(image)}" alt="">`:`<span>${esc(engine.name.slice(0,1))}</span>`;};
 const drawBuiltinCommands=()=>{if(!config)return;q('search-command-list').innerHTML=builtinSearchCommands.map(command=>{
  const enabled=!config.shortcutDisabled.includes(command.id),conflict=config.webEngines.some(engine=>engine.shortcut===command.shortcut);
  return `<div class="search-command-row ${enabled?'':'is-disabled'}"><span class="search-shortcut-badge">${icon(command.icon)}</span><div class="search-command-copy"><strong>${esc(command.name)}</strong><span class="search-shortcut-detail"><span class="search-shortcut-trigger">${esc(command.shortcut)}</span><span class="search-shortcut-note">${esc(command.description)}${conflict?' · 与自定义搜索引擎代号冲突':''}</span></span></div><label class="switch"><input type="checkbox" role="switch" data-search-command="${esc(command.id)}" aria-label="启用 ${esc(command.name)}" ${enabled?'checked':''}><span class="switch-track"></span></label></div>`;
 }).join('');};
 const drawWebEngines=()=>{if(!config)return;const host=q('search-web-engine-list');host.innerHTML=[...builtinSearchEngines,...config.webEngines].map(engine=>`<div class="search-web-engine-row"><span class="search-shortcut-badge">${webIcon(engine)}</span><div><strong>${esc(engine.name)}</strong><span class="search-shortcut-detail"><span class="search-shortcut-trigger">${esc(engine.shortcut)}</span><span class="search-shortcut-note">${esc(new URL(engine.url).hostname)}</span></span></div>${builtinSearchEngines.some(item=>item.id===engine.id)?'<span class="search-web-builtin">内置</span>':`<button data-web-edit="${esc(engine.id)}" aria-label="编辑 ${esc(engine.name)}">编辑</button>`}</div>`).join('');
  for(const engine of [...builtinSearchEngines,...config.webEngines]){if(engine.icon||webIcons.has(engine.url))continue;webIcons.set(engine.url,'');void api.searchWebIcon(engine.url).then(image=>{if(image){webIcons.set(engine.url,image);drawWebEngines();}}).catch(()=>{});}
 };
 const editWebEngine=(engine?:SearchWebEngine)=>{const template=document.createElement('template');template.innerHTML=dialogMarkup({id:'search-engine-editor',title:engine?'编辑搜索引擎':'添加搜索引擎',className:'search-engine-editor',body:`<label>名称<input id="engine-name" maxlength="60" value="${esc(engine?.name||'')}" placeholder="例如 Google"></label><label>快捷命令<input id="engine-shortcut" maxlength="16" value="${esc(engine?.shortcut||'')}" placeholder="例如 g2"></label><label>搜索地址<input id="engine-url" value="${esc(engine?.url||'')}" placeholder="https://example.com/search?q={query}"></label><label>建议地址（可选）<input id="engine-suggest" value="${esc(engine?.suggestUrl||'')}" placeholder="https://example.com/suggest?q={query}"></label><p>地址需包含 {query}，One 会尝试自动获取网站图标。建议接口需返回 JSON 列表。</p><p id="engine-error" role="alert"></p>`,actions:`${engine?'<button data-engine-delete>删除</button>':''}<button data-engine-cancel>取消</button><button class="primary" data-engine-save>保存</button>`});
  const dialog=template.content.firstElementChild as HTMLDialogElement;dialog.addEventListener('close',()=>dialog.remove(),{once:true});document.body.append(dialog);openDialog(dialog);
  dialog.querySelector('[data-engine-cancel]')!.addEventListener('click',()=>void closeDialog(dialog));
  dialog.querySelector('[data-engine-delete]')?.addEventListener('click',()=>void update({webEngines:config.webEngines.filter(item=>item.id!==engine!.id)}).then(()=>void closeDialog(dialog)).catch(error=>{q('engine-error').textContent=errorMessage(error);}));
  dialog.querySelector('[data-engine-save]')!.addEventListener('click',()=>void(async()=>{const name=q<HTMLInputElement>('engine-name').value.trim(),shortcut=q<HTMLInputElement>('engine-shortcut').value.trim().toLowerCase(),url=q<HTMLInputElement>('engine-url').value.trim(),suggestUrl=q<HTMLInputElement>('engine-suggest').value.trim();try{
   searchEngineUrl(url,'test');if(suggestUrl)searchEngineUrl(suggestUrl,'test');if(reservedSearchShortcuts.has(shortcut)&&shortcut!==engine?.shortcut)throw new Error('此代号已由内置快捷命令使用');const next:SearchWebEngine={id:engine?.id||crypto.randomUUID(),name,shortcut,url,...(suggestUrl?{suggestUrl}:{})};await update({webEngines:[...config.webEngines.filter(item=>item.id!==engine?.id),next]});void closeDialog(dialog);
   void api.searchWebIcon(url).then(image=>{if(!image)return;webIcons.set(url,image);if(config.webEngines.some(item=>item.id===next.id&&item.url===url))void update({webEngines:config.webEngines.map(item=>item.id===next.id?{...item,icon:image}:item)}).catch(()=>{});}).catch(()=>{});
  }catch(error){q('engine-error').textContent=errorMessage(error);}})());
 };
 action('search-web-engine-add',()=>editWebEngine());
 q('search-web-engine-list').addEventListener('click',event=>{const target=event.target instanceof Element?event.target.closest<HTMLElement>('[data-web-edit]'):null;if(target)editWebEngine(config.webEngines.find(item=>item.id===target.dataset.webEdit));});
 let commandUpdates=Promise.resolve();
 q('search-command-list').addEventListener('change',event=>{const control=event.target instanceof HTMLInputElement?event.target:null,id=control?.dataset.searchCommand;if(!control||!id)return;
  const enabled=control.checked;control.disabled=true;
  commandUpdates=commandUpdates.catch(()=>{}).then(async()=>{const disabled=new Set(config.shortcutDisabled);if(enabled)disabled.delete(id);else disabled.add(id);await update({shortcutDisabled:[...disabled]});}).catch(error=>{drawBuiltinCommands();toast(error);});
 });
 const fill=(previous?:SearchSettings)=>{const set=(id:string,value:string|boolean)=>{const control=q<HTMLInputElement>(id);if(document.activeElement===control)return;if(typeof value==='boolean')control.checked=value;else control.value=value;};if(!previous||previous.maxEntries!==config.maxEntries)set('index-limit',String(config.maxEntries));for(const key of ['shortcut','programShortcut'] as const)if(!previous||previous[key]!==config[key])set('search-'+key,config[key]);for(const key of ['doubleCtrl','explorerTyping','explorerMenu','dialogSwitch','fuzzy','pinyin'] as const)if(!previous||previous[key]!==config[key])set('search-'+key,config[key]);};
 const accept=(next:SearchSettings)=>{const previous=config;config=next;settingsRevision++;if(!previous||JSON.stringify([previous.roots,previous.excluded,previous.priorities])!==JSON.stringify([next.roots,next.excluded,next.priorities]))drawPriorities();if(!previous||JSON.stringify(previous.bookmarks)!==JSON.stringify(next.bookmarks))drawPaths('search-bookmarks','bookmarks');if(!previous||JSON.stringify(previous.shortcutDisabled)!==JSON.stringify(next.shortcutDisabled)||JSON.stringify(previous.webEngines)!==JSON.stringify(next.webEngines))drawBuiltinCommands();if(!previous||JSON.stringify(previous.webEngines)!==JSON.stringify(next.webEngines))drawWebEngines();const menuChanged=!previous||JSON.stringify(previous.menu)!==JSON.stringify(next.menu);if(menuChanged||JSON.stringify(previous?.menuBar)!==JSON.stringify(next.menuBar))drawMenu();fill(previous);};
 const load=()=>{const revision=settingsRevision;return api.searchPreferences().then(search=>{if(revision===settingsRevision)accept(search);});};void subscribeSnapshot(api.onSearchPreferences,api.searchPreferences,accept).catch(toast);document.querySelector('[data-page=search]')?.addEventListener('click',()=>void load().catch(toast));api.onSearchSettings(()=>void load().catch(toast));
 for(const key of ['shortcut','programShortcut','doubleCtrl','explorerTyping','explorerMenu','dialogSwitch','fuzzy','pinyin'] as const){const control=q<HTMLInputElement>('search-'+key);control.addEventListener('change',()=>void update({[key]:key==='shortcut'||key==='programShortcut'?control.value:control.checked}).catch(error=>{fill();toast(error);}));}
 for(const [id,key]of [['search-bookmark','bookmarks']] as const)action(id,async()=>{const path=await api.pickDirectory();if(path&&!config[key].includes(path)){await update({[key]:[...config[key],path]});}});
 bindPreference(q('index-limit'),()=>({search:{maxEntries:Number(q<HTMLInputElement>('index-limit').value)}}),load);
 action('index-refresh',()=>api.rebuildSearch());action('index-cancel',()=>api.cancelSearchIndex());action('search-launch',()=>api.showSearch());api.onSearchState(render);void api.searchState().then(render).catch(toast);
}
export async function renderSearch(){
 const embedded=new URLSearchParams(location.search).has('embedded');
 document.body.classList.add('search-window');if(embedded)document.body.classList.add('search-inline');
  const filters=[['','全部'],...(!embedded?[['app:','程序'],['setting:','设置']]:[]),['folder:','文件夹'],['doc:','文档'],['pic:','图片'],['video:','视频'],['audio:','音频'],['archive:','压缩包']];
  document.querySelector('#app')!.innerHTML=`<div class="search-shell"><header class="search-input-row drag-region">${icon('search')}${embedded?'':'<span id="search-mode-tag" class="search-mode-tag" hidden></span>'}<input id="file-query" placeholder="搜索文件、应用与设置；输入 > 查找命令" aria-label="搜索文件与文件夹" role="combobox" aria-autocomplete="list" aria-controls="search-results" aria-expanded="false" autocomplete="off" spellcheck="false">${embedded?'<span id="search-inline-summary" role="status"></span>':iconButton('search-save','保存当前搜索','star')}${iconButton('search-clear','清空','close')}</header>${embedded?'':'<div id="search-saved-row" class="search-saved-row" hidden></div>'}<div class="search-filter-row" id="search-filters"><div class="tabs" role="tablist" aria-label="搜索类型">${filters.map(([filter,label],i)=>`<button data-filter="${filter}" role="tab" aria-selected="${i===0}" class="${i===0?'selected':''}">${label}</button>`).join('')}</div>${embedded?'':'<div class="search-scope-field"><select id="search-scope" aria-label="搜索范围"><option value="">全部索引</option></select></div>'}</div>${embedded?'':'<div id="search-shortcut-panel" class="search-shortcut-panel" hidden></div>'}<div id="search-results" class="search-results" role="listbox" aria-label="搜索结果" aria-busy="false"></div><footer class="search-footer"><span id="search-summary" role="status"></span><span id="search-keys">↑↓ 选择 · Enter 打开 · Alt+P 预览</span></footer></div><div id="toast" class="toast" role="status" hidden></div>`;
 if(!embedded)customControls(q('search-filters'));
 const input=q<HTMLInputElement>('file-query'),list=q('search-results');
 let context:SearchContext={kind:'search',hwnd:0,pid:0,created:'',folders:[]},prefs:SearchSettings,filter='',scopeSelection='',selectedSaved='';
 let activeMode:ReturnType<typeof parseSearchShortcut>=null;
 const panel=embedded?null:q('search-shortcut-panel');
 let searchHistory:AIHistoryEntry[]=[],aiOutput='',aiError='',aiBusy=false,aiPrompt='',aiRequestId='',suggestions:string[]=[];
 let suggestTimer:ReturnType<typeof setTimeout>|undefined,historyTimer:ReturnType<typeof setTimeout>|undefined,historyKey='';
 const iconCache=new Map<string,string>();
 const engines=()=>[...builtinSearchEngines,...(prefs?.webEngines||[])];
 const engineImage=(engine:SearchWebEngine)=>{const image=engine.icon||iconCache.get(engine.url);return image?`<img src="${esc(image)}" alt="">`:`<span class="search-engine-initial">${esc(engine.name.slice(0,1).toUpperCase())}</span>`;};
 let renderedModeKey='',renderedModeIcon='';
 const drawMode=()=>{if(embedded)return;
  input.placeholder=activeMode?.placeholder||(context.kind==='dialog'?'搜索要跳转的文件夹':'搜索文件、程序与设置');
  q('search-filters').hidden=context.kind==='dialog'||!!activeMode&&!activeMode.showFilters;
  const tag=q('search-mode-tag');tag.hidden=!activeMode;if(!activeMode){renderedModeKey='';renderedModeIcon='';return;}
  const name=activeMode.kind==='one'?'One 命令':activeMode.kind==='extension'?activeMode.extensions.map(ext=>'.'+ext).join(' | '):activeMode.kind==='category'?activeMode.command.name:activeMode.engine.name;
  const modeIcon=activeMode.kind==='engine'?engineImage(activeMode.engine):activeMode.kind==='one'?'<span class="search-mode-command">&gt;</span>':icon(activeMode.kind==='extension'?'file':activeMode.command.icon);
  tag.dataset.kind=activeMode.kind;
  const modeKey=activeMode.kind+':'+name+(activeMode.kind==='engine'?':'+activeMode.engine.id:'');
  if(modeKey!==renderedModeKey){tag.innerHTML=`<span class="search-mode-icon" aria-hidden="true">${modeIcon}</span><strong>${esc(name)}</strong><button type="button" data-mode-exit aria-label="退出快捷命令">${icon('close')}</button>`;renderedModeKey=modeKey;renderedModeIcon=modeIcon;}
  else if(modeIcon!==renderedModeIcon){tag.querySelector('.search-mode-icon')!.innerHTML=modeIcon;renderedModeIcon=modeIcon;}
 };
 const drawActivePanel=()=>{if(!panel)return;
  const ai=activeMode?.kind==='category'&&activeMode.command.id==='ai',engine=activeMode?.kind==='engine',idle=!activeMode&&!input.value.trim()&&!filter;
  panel.hidden=!ai&&!engine&&!(idle&&searchHistory.length>0);
  if(ai){panel.innerHTML=`<div class="search-ai-panel ${aiOutput?'has-answer':'is-empty'}"><div class="search-ai-heading"><span class="search-shortcut-badge">${icon('ai')}</span><strong>AI 回答</strong>${aiBusy?'<button data-ai-stop>停止</button>':''}</div>${aiError?`<p class="search-ai-error">${esc(aiError)}</p>`:''}<div class="search-ai-answer">${aiOutput?esc(aiOutput):aiBusy?'正在思考…':input.value.trim()?'按 Enter 提问':'输入问题后按 Enter'}</div>${aiOutput&&!aiBusy?`<div class="search-ai-actions"><button data-ai-copy>复制回答</button><button class="primary" data-ai-chat>转为对话并追问</button></div>`:''}</div>`;return;}
  if(activeMode?.kind==='engine'){panel.innerHTML=`<div class="search-web-action"><span class="search-shortcut-badge">${engineImage(activeMode.engine)}</span><div><strong>使用 ${esc(activeMode.engine.name)} 搜索</strong><small>${input.value.trim()?esc(input.value.trim()):'输入关键词后按 Enter'}</small></div><button class="primary" data-search-web ${input.value.trim()?'':'disabled'}>搜索</button></div>${suggestions.length?`<div class="search-suggestions">${suggestions.map((item,i)=>`<button data-suggestion="${i}">${icon('search')}<span>${esc(item)}</span></button>`).join('')}</div>`:''}`;return;}
  panel.innerHTML=`<div class="search-history-heading"><strong>最近搜索</strong><small>输入关键词可继续搜索</small></div><div class="search-history-items">${searchHistory.slice(0,8).map(item=>`<button data-history-id="${esc(item.id)}"><span>${icon(item.command==='ai'?'ai':'history')}</span><strong>${esc(item.query)}</strong><small>${esc(item.command)}</small></button>`).join('')}</div>`;
 };
 const loadIcons=()=>{if(embedded)return;for(const engine of engines()){if(engine.icon||iconCache.has(engine.url))continue;iconCache.set(engine.url,'');void api.searchWebIcon(engine.url).then(image=>{if(image)iconCache.set(engine.url,image);drawMode();drawActivePanel();}).catch(()=>{});}};
 let revision=0,navigation=0,shownKey='',composing=false,inputPending=false,backgroundPending=false;
 let inputTimer:ReturnType<typeof setTimeout>|undefined,refreshTimer:ReturnType<typeof setTimeout>|undefined;
 let running:{version:number;key:string;navigation:number}|undefined,lastLayout='',lastInlineSummary='',lastBackgroundQuery=0;
 let progressive:{token:string;accept:(result:import('../shared/search').SearchResult)=>void}|undefined;
 api.onSearchProgress(value=>{if(value.token===progressive?.token)progressive.accept(value.result);});
 const nameMarkup=(item:SearchEntry)=>{
  const terms=(input.value.match(/"[^"]*"|\S+/g)||[]).map(t=>t.replace(/^"|"$/g,'')).filter(t=>!t.includes(':'));
  const lower=item.name.toLowerCase(),matched=new Set<number>();
  for(const term of terms){const value=term.toLowerCase(),at=lower.indexOf(value);if(at>=0){for(let i=at;i<at+value.length;i++)matched.add(i);}else if(item.matchKind==='fuzzy'){let cursor=0;for(const char of value){const at=lower.indexOf(char,cursor);if(at<0)break;matched.add(at);cursor=at+1;}}}
  let offset=0;return Array.from(item.name).map(c=>{const active=matched.has(offset);offset+=c.length;return active?`<mark>${esc(c)}</mark>`:esc(c);}).join('');
 };
 const results=new SearchResults(list,input,embedded,nameMarkup);
 const withinRoot=(path:string,root:string)=>{const value=path.replace(/\//g,'\\').replace(/\\+$/,'').toLowerCase(),base=root.replace(/\//g,'\\').replace(/\\+$/,'').toLowerCase();return value===base||value.startsWith(base+'\\');};
 const indexed=(path:string)=>!!path&&!!prefs?.roots.some(root=>withinRoot(path,root));
 const launcherMode=()=>activeMode?.kind==='category'&&['app','cfg'].includes(activeMode.command.id);
 const collectionMode=()=>activeMode?.kind==='category'&&['recent','fav'].includes(activeMode.command.id);
 const scopePath=()=>filter==='app:'||filter==='setting:'||activeMode?.kind==='one'||activeMode?.kind==='engine'||launcherMode()||collectionMode()?'':scopeSelection==='@current'?context.currentFolder||'':scopeSelection;
 const drawScope=()=>{
  if(embedded)return;
  const select=q<HTMLButtonElement&{value:string}>('search-scope'),roots=prefs?.roots||[],current=context.currentFolder||'';
  if(scopeSelection==='@current'&&!indexed(current)||scopeSelection&&scopeSelection!=='@current'&&!indexed(scopeSelection))scopeSelection='';
  const options=[{label:'全部索引',value:''}];
  if(indexed(current))options.push({label:'当前文件夹 · '+(current.split(/[\\/]/).filter(Boolean).pop()||current),value:'@current'});
  for(const root of roots)options.push({label:'索引目录 · '+root,value:root});
  if(scopeSelection&&scopeSelection!=='@current'&&!roots.some(root=>root.toLowerCase()===scopeSelection.toLowerCase()))options.push({label:'已保存范围 · '+scopeSelection,value:scopeSelection});
  updateSelectOptions(select,options);select.value=scopeSelection;select.disabled=filter==='app:'||filter==='setting:'||activeMode?.kind==='one'||activeMode?.kind==='engine'||launcherMode()||collectionMode()||options.length===1;
  select.title=scopePath()||'全部索引目录';
 };
 // Enriching the same Explorer context only changes ranking, not user intent.
 const key=()=>JSON.stringify([input.value,filter,activeMode,scopePath(),context.kind,context.hwnd]);
 const layout=()=>{
  const active=!!input.value.trim()||!!filter||!!activeMode||searchHistory.length>0;
  document.body.classList.toggle('search-idle',!embedded&&!active);
  document.body.classList.toggle('search-shortcut-only',!embedded&&(activeMode?.kind==='engine'||activeMode?.kind==='category'&&activeMode.command.id==='ai'||!activeMode&&!input.value.trim()&&!filter&&searchHistory.length>0));
  document.body.classList.toggle('search-has-results',embedded&&(results.count>0||active));
  const next=embedded?`${results.count}:${active}`:String(active);
  if(next!==lastLayout){lastLayout=next;void api.searchSize(results.count,active);}
 };
 const summary=(text:string,inline=results.count?`${results.count.toLocaleString()} 项`:'')=>{
  q('search-summary').textContent=text;lastInlineSummary=inline;if(embedded)q('search-inline-summary').textContent=inline;
 };
 const choose=async(index=results.selected)=>{const item=results.entry(index);if(item)try{const query=input.value.trim();if(query)await api.searchHistoryAdd(query,activeMode?.kind==='category'?activeMode.command.shortcut:activeMode?.kind==='extension'?activeMode.extensions.map(ext=>'.'+ext).join('|'):activeMode?.kind==='one'?'>':filter||'all');if(item.launchKind==='action')await api.searchAction(item.path.slice(7));else await api.searchChoose(item.path);}catch(e){toast(e);}};
 const drawSaved=()=>{if(embedded)return;const row=q('search-saved-row'),saved=prefs?.savedQueries||[];row.hidden=!saved.length;row.innerHTML=saved.map(item=>`<div class="search-saved-item ${selectedSaved===item.id?'selected':''}"><button data-saved-id="${esc(item.id)}" title="${esc(item.query+(item.folder?' · '+item.folder:''))}">${icon('search')}<span>${esc(item.name)}</span></button><button class="search-saved-remove" data-saved-remove="${esc(item.id)}" aria-label="删除 ${esc(item.name)}">${icon('close')}</button></div>`).join('');};
 if(!embedded){q('search-saved-row').addEventListener('click',event=>{const target=event.target instanceof Element?event.target.closest<HTMLElement>('[data-saved-id],[data-saved-remove]'):null;if(!target)return;const id=target.dataset.savedId||target.dataset.savedRemove,item=prefs?.savedQueries.find(saved=>saved.id===id);if(!item)return;if(target.dataset.savedRemove){void api.searchSavedQuery('remove',item.id).catch(toast);return;}activeMode=null;selectedSaved=item.id;scopeSelection=item.folder;input.value=item.query;filter=item.filter;syncFilters();drawMode();drawScope();drawSaved();input.focus();newQuery();});
  q('search-save').onclick=()=>{const query=input.value.trim();if(!query||query.startsWith('>')||activeMode)return;const folder=scopePath();if(prefs.savedQueries.some(item=>item.query===query&&item.filter===filter&&item.folder===folder)){toast('已保存这个搜索');return;}const next={id:crypto.randomUUID(),name:query.slice(0,50),query,filter,folder};void api.searchSavedQuery('add',next).then(result=>{prefs=result;selectedSaved=next.id;scopeSelection=folder;drawScope();drawSaved();}).catch(toast);};}
 const stopTimers=()=>{clearTimeout(inputTimer);clearTimeout(refreshTimer);inputTimer=undefined;refreshTimer=undefined;};
 const invalidate=()=>{revision++;progressive=undefined;stopTimers();clearTimeout(suggestTimer);clearTimeout(historyTimer);backgroundPending=false;inputPending=false;list.setAttribute('aria-busy','false');};
 // Background indexing never cancels an in-flight query. Many notifications become
 // one follow-up query; typing still invalidates old responses immediately.
 const refresh=()=>{
  if(!isWindowVisible()||composing||inputPending||activeMode?.kind==='engine'||activeMode?.kind==='one')return;
  backgroundPending=true;if(running||refreshTimer)return;
   refreshTimer=setTimeout(()=>{refreshTimer=undefined;if(backgroundPending)void query();},Math.max(160,1200-(Date.now()-lastBackgroundQuery)));
 };
 const query=async()=>{
  if(!isWindowVisible()||composing)return;
  const typed=inputPending,background=backgroundPending&&!typed;if(background)lastBackgroundQuery=Date.now();
  stopTimers();inputPending=false;backgroundPending=false;
  const request={version:++revision,key:key(),navigation},text=input.value.trim();running=request;layout();drawMode();drawActivePanel();
  const quiet=!typed;
  const current=()=>request.version===revision&&request.key===key()&&isWindowVisible();
  const update=(entries:SearchEntry[])=>{
   // Resolve identity at completion, after any arrows pressed during the request.
   results.update(entries,shownKey===request.key||navigation!==request.navigation,text?'没有匹配的项目':'输入名称开始搜索');
   shownKey=request.key;layout();
  };
  try{
  const commandSettings={pinyin:prefs?.pinyin??true,fuzzy:prefs?.fuzzy??true};
   if(activeMode?.kind==='one'||!embedded&&!activeMode&&text.startsWith('>')&&!prefs?.shortcutDisabled.includes('one')){const entries=commandMatches(activeMode?.kind==='one'?text:text.slice(1),100,commandSettings);update(entries);summary(entries.length+' 个命令 · Enter 执行');return;}
   if(activeMode?.kind==='category'&&activeMode.command.id==='ai'){update([]);summary(aiBusy?'AI 正在回答':aiOutput?'AI 回答已完成':'按 Enter 向 AI 提问');drawActivePanel();return;}
   if(activeMode?.kind==='engine'){update([]);summary(text?'按 Enter 使用 '+activeMode.engine.name+' 搜索':'输入关键词开始网页搜索');suggestions=[];drawActivePanel();if(text){const id=activeMode.engine.id;suggestTimer=setTimeout(()=>void api.searchSuggest(id,text).then(items=>{if(current()){suggestions=items.slice(0,8);drawActivePanel();}}).catch(()=>{}),250);}return;}
   if(activeMode?.kind==='category'&&['recent','fav'].includes(activeMode.command.id)){
    const result=await api.searchCollection(activeMode.command.id as 'recent'|'fav',text);
    if(!current())return;update(result.items);summary(`${result.total} 项 · ${Math.round(result.elapsed)} ms`);return;
   }
    if(!embedded&&!text&&!filter&&!activeMode){update([]);summary(searchHistory.length?'最近搜索':'');drawActivePanel();return;}
    if(!text&&!filter&&!activeMode){
    const seen=new Set<string>(),entries=[...(prefs?.bookmarks||[]),...context.folders.map(f=>f.path)].filter(p=>{const k=p.toLowerCase();if(seen.has(k))return false;seen.add(k);return true;}).map(path=>({path,name:path.split(/[\\/]/).filter(Boolean).pop()||path,directory:true,size:0,modified:0}));
    update(entries);const s=await api.searchState();if(current())summary(results.count?'收藏与已打开的文件夹':s.count?'输入名称开始搜索':'请先在 One 中添加索引目录');return;
   }
   list.setAttribute('aria-busy','true');
    if(!results.count)results.update([],false,'正在搜索…');
    if(!quiet)summary('正在搜索…', '搜索中');
   const token=shownKey!==request.key||!results.count?crypto.randomUUID():undefined;
    if(token)progressive={token,accept:result=>{if(!current()||result.cancelled)return;update(result.items);if(!quiet)summary(result.partialScope==='global'?`已找到 ${result.total.toLocaleString()} 项 · 搜索中`:`本文件夹 · ${result.total.toLocaleString()} 项 · 正在搜索其他位置`,`${result.total.toLocaleString()} 项 · 搜索中`);}};
    const searchText=activeMode?.kind==='extension'?`${filter||'file:'} ext:${activeMode.extensions.join(';')} ${text}`:
     activeMode?.kind==='category'?activeMode.command.id==='mm'?(filter?`${filter} ${text}`:`file: ext:${mediaSearchExtensions.join(';')} ${text}`):`${filter||activeMode.command.queryPrefix||''} ${text}`:filter+' '+text;
    const result=await api.searchFiles(searchText,context.kind==='dialog',token,scopePath());
   if(!current())return;
   if(result.cancelled){if(embedded)q('search-inline-summary').textContent=lastInlineSummary;return;}
    const commands=embedded||activeMode?[]:commandMatches(text,6,commandSettings);
   update([...commands,...result.items]);
   summary(`${result.total.toLocaleString()} 项${commands.length?` · ${commands.length} 个 One 命令`:''}${result.total>100?' · 显示前 100 项':''} · ${Math.round(result.elapsed)} ms`,result.total?`${result.total.toLocaleString()} 项`:(commands.length?`${commands.length} 个命令`:'无结果'));
   if(text&&!background){const command=activeMode?.kind==='category'?activeMode.command.shortcut:activeMode?.kind==='extension'?activeMode.extensions.map(ext=>'.'+ext).join('|'):filter||'all',recordKey=JSON.stringify([command,text,scopePath()]);if(recordKey!==historyKey)historyTimer=setTimeout(()=>{if(current()&&recordKey!==historyKey){historyKey=recordKey;void api.searchHistoryAdd(text,command).catch(()=>{});}},1000);}
  }catch(e){if(current()){results.update([],false,errorMessage(e));shownKey=request.key;summary('');layout();}}
  finally{
   if(running===request){running=undefined;progressive=undefined;if(current())list.setAttribute('aria-busy','false');if(backgroundPending)refresh();}
  }
 };
 const newQuery=()=>{invalidate();results.select(0);void query();};
  const enterMode=(mode:NonNullable<typeof activeMode>)=>{activeMode=mode;input.value=mode.query;filter='';selectedSaved='';syncFilters();drawScope();drawSaved();drawMode();input.focus();newQuery();};
  const exitMode=()=>{activeMode=null;input.value='';syncFilters();drawMode();drawScope();input.focus();newQuery();};
  const runAI=async()=>{if(!(activeMode?.kind==='category'&&activeMode.command.id==='ai')||aiBusy)return;const text=input.value.trim();if(!text)return;aiPrompt=text;aiOutput='';aiError='';aiBusy=true;aiRequestId=crypto.randomUUID();const request=aiRequestId;drawActivePanel();summary('AI 正在回答');try{const result=await api.aiInline(text,request);if(request!==aiRequestId)return;aiOutput=result.text;searchHistory=(await api.aiState()).history;}catch(error){if(request===aiRequestId)aiError=errorMessage(error);}finally{if(request===aiRequestId){aiBusy=false;drawActivePanel();summary(aiError||'AI 回答已完成');}}};
  if(panel)panel.addEventListener('click',event=>{const target=event.target instanceof Element?event.target.closest<HTMLElement>('[data-search-web],[data-suggestion],[data-ai-stop],[data-ai-chat],[data-ai-copy],[data-history-id]'):null;if(!target)return;
   if(target.dataset.searchWeb!==undefined&&activeMode?.kind==='engine')void api.searchWeb(activeMode.engine.id,input.value).catch(toast);
   else if(target.dataset.suggestion!==undefined&&activeMode?.kind==='engine'){input.value=suggestions[Number(target.dataset.suggestion)]||input.value;suggestions=[];input.focus();newQuery();}
   else if(target.dataset.aiStop!==undefined){const request=aiRequestId;aiRequestId='';aiBusy=false;drawActivePanel();void api.aiCancel(request).catch(toast);}
   else if(target.dataset.aiCopy!==undefined&&aiOutput)void navigator.clipboard.writeText(aiOutput).catch(toast);
   else if(target.dataset.aiChat!==undefined&&aiOutput)void api.aiChatCreate({query:aiPrompt,answer:aiOutput}).then(id=>api.aiChatOpen(id)).catch(toast);
   else if(target.dataset.historyId){const item=searchHistory.find(entry=>entry.id===target.dataset.historyId);if(!item)return;const mode=parseSearchShortcut(item.command+' ',prefs?.webEngines,prefs?.shortcutDisabled);activeMode=mode;input.value=item.query;filter=mode?'' :item.command==='all'?'':item.command;aiPrompt=item.command==='ai'?item.query:'';aiOutput=item.command==='ai'?item.result||'':'';aiError='';syncFilters();drawMode();drawScope();newQuery();input.focus();}
  });
 if(!embedded)q('search-mode-tag').addEventListener('click',event=>{if(event.target instanceof Element&&event.target.closest('[data-mode-exit]'))exitMode();});
 input.addEventListener('input',e=>{
   if(!embedded&&!activeMode&&!composing){const mode=parseSearchShortcut(input.value,prefs?.webEngines,prefs?.shortcutDisabled);if(mode){enterMode(mode);return;}}
  if(activeMode?.kind==='category'&&activeMode.command.id==='ai'&&input.value.trim()!==aiPrompt){if(aiBusy){const request=aiRequestId;aiRequestId='';aiBusy=false;void api.aiCancel(request).catch(()=>{});}aiOutput='';aiError='';}
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
  const index=rowIndex(event.target),item=results.entry(index);if(!item||item.launchKind==='action')return;
  event.preventDefault();navigation++;results.select(index);
  void api.searchContextMenu(item.path,{x:event.clientX,y:event.clientY},item.directory).catch(toast);
 });
 document.addEventListener('keydown',e=>{
  if(e.isComposing||composing)return;
   if(e.key==='Escape'){e.preventDefault();if(activeMode){exitMode();return;}void api.closeWindow();return;}
   if(e.key==='Backspace'&&e.target===input&&activeMode&&!input.value){e.preventDefault();exitMode();return;}
  // SegmentTab handles its own keyboard navigation and button activation.
  if(e.target instanceof Element&&e.target.closest('#search-filters'))return;
  const item=results.entry();
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){
   e.preventDefault();navigation++;results.select(results.selected+(e.key==='ArrowDown'?1:-1),true);
  }else if(e.ctrlKey&&/^[1-9]$/.test(e.key)&&embedded){e.preventDefault();void choose(Number(e.key)-1);}
  else if(e.key==='Enter'){
   e.preventDefault();if(document.body.classList.contains('search-idle'))return;
    if(activeMode?.kind==='engine'){if(input.value.trim())void api.searchWeb(activeMode.engine.id,input.value).catch(toast);return;}
    if(activeMode?.kind==='category'&&activeMode.command.id==='ai'){void runAI();return;}
   if(e.ctrlKey&&item&&!item.launchKind)void api.revealFile(item.path).catch(toast);else void choose();
  }else if(e.altKey&&e.key.toLowerCase()==='p'&&item&&!item.launchKind){e.preventDefault();void api.preview(item.path).catch(toast);}
 });
 const syncFilters=()=>document.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach(b=>{
  const value=b.dataset.filter||'',fileMode=activeMode?.kind==='extension'||activeMode?.kind==='category'&&activeMode.command.id==='file',mediaMode=activeMode?.kind==='category'&&activeMode.command.id==='mm';
  b.hidden=!!(fileMode&&['app:','setting:','folder:'].includes(value)||mediaMode&&!['','pic:','video:','audio:'].includes(value));
  const active=b.dataset.filter===filter;b.classList.toggle('selected',active);b.setAttribute('aria-selected',String(active));
 });
  q('search-clear').onclick=()=>{if(!input.value&&!activeMode){void api.closeWindow();return;}input.value='';activeMode=null;selectedSaved='';syncFilters();drawMode();drawSaved();input.focus();newQuery();};
 document.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach(b=>b.onclick=event=>{
   if(activeMode&&activeMode.kind!=='extension'&&!(activeMode.kind==='category'&&['file','mm'].includes(activeMode.command.id))){activeMode=null;input.value='';drawMode();}filter=b.dataset.filter!;syncFilters();drawScope();if(event.detail)input.focus();newQuery();
 });
 if(!embedded)q<HTMLButtonElement&{value:string}>('search-scope').onchange=event=>{scopeSelection=(event.currentTarget as HTMLButtonElement&{value:string}).value;selectedSaved='';drawSaved();drawScope();newQuery();};
 const applyContext=(c:SearchContext)=>{
  const previous=key(),previousFolder=context.currentFolder;context=c;
  document.title=(c.kind==='dialog'?'跳转文件夹':c.kind==='menu'?'文件夹菜单':'文件搜索')+' · One';
  q('search-keys').textContent=c.kind==='search'?'↑↓ 选择 · Enter 打开 · Alt+P 预览':'↑↓ 选择 · Enter 跳转 · Alt+P 预览';
  drawScope();
  input.placeholder=c.kind==='dialog'?'搜索要跳转的文件夹':embedded?'搜索文件与文件夹':'搜索文件、程序与设置';drawMode();
  if(key()!==previous)newQuery();else if(previousFolder!==c.currentFolder){invalidate();void query();}
 };
 onWindowVisibility(visible=>{invalidate();if(visible){lastLayout='';void query();}});
 api.onSearchFilesChanged(refresh);
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')invalidate();});
 let lastIndexUpdate=0;
 api.onSearchState(state=>{if(state.running||!state.updated||state.updated===lastIndexUpdate)return;lastIndexUpdate=state.updated;if(input.value.trim()||filter)refresh();});
 api.onSearchContext(applyContext);
 if(!embedded){api.onAIEvent(event=>{if(event.kind==='inline-delta'&&event.requestId===aiRequestId&&aiOutput.length===event.offset){aiOutput+=event.text;drawActivePanel();}else if(event.kind==='changed')void api.aiState().then(state=>{searchHistory=state.history;drawActivePanel();layout();}).catch(()=>{});});void api.aiState().then(state=>{searchHistory=state.history;drawActivePanel();layout();}).catch(()=>{});}
 api.onSearchReset(()=>{
  invalidate();shownKey='';input.value='';activeMode=null;filter='';scopeSelection='';selectedSaved='';syncFilters();drawMode();drawSaved();drawScope();input.focus();
  const reset=revision;void api.searchPreferences().then(p=>{prefs=p;drawScope();drawSaved();loadIcons();lastLayout='';layout();if(revision===reset)void query();});void api.searchReady();
 });
  input.focus();void api.searchReady();await subscribeSnapshot(api.onSearchPreferences,api.searchPreferences,next=>{const changed=JSON.stringify(prefs?.bookmarks)!==JSON.stringify(next.bookmarks),ranking=JSON.stringify([prefs?.priorities,prefs?.fuzzy,prefs?.pinyin])!==JSON.stringify([next.priorities,next.fuzzy,next.pinyin]),oldScope=scopePath(),disabledChanged=JSON.stringify(prefs?.shortcutDisabled)!==JSON.stringify(next.shortcutDisabled);prefs=next;const modeId=activeMode?.kind==='one'?'one':activeMode?.kind==='extension'?'extension':activeMode?.kind==='category'?activeMode.command.id:'';const deactivated=!!modeId&&next.shortcutDisabled.includes(modeId);if(deactivated){activeMode=null;input.value='';filter='';syncFilters();}if(selectedSaved&&!next.savedQueries.some(item=>item.id===selectedSaved)){selectedSaved='';scopeSelection='';}drawScope();drawSaved();drawMode();loadIcons();lastLayout='';layout();if(deactivated||disabledChanged&&input.value.startsWith('>'))newQuery();else if(ranking||oldScope!==scopePath()||changed&&!input.value.trim()&&!filter)refresh();});
 if(context.hwnd===0)applyContext(await api.searchContext());else void query();
}
