import {urlSearchEntry} from '../shared/search-url';
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
import {defaultSearch,type SavedSearch,type SearchSettings,type SearchEntry,type SearchContext,type SearchState} from '../shared/search';
import {builtinSearchCommands,builtinSearchEngines,mediaSearchExtensions,parseSearchShortcut,reservedSearchShortcuts,searchEngineUrl,type SearchShortcutMode,type SearchWebEngine} from '../shared/search-shortcuts';
import {dialogMarkup,openDialog,closeDialog} from './dialog';
import type {AIHistoryEntry} from '../shared/ai';
const searchSwitch=(key:string,title:string,description='')=>`<div class="setting-row"><div class="setting-copy"><h2>${title}</h2>${description?`<p>${description}</p>`:''}</div>${switchControl('search-'+key,title)}</div>`;
const pathSection=(title:string,add:string,list:string)=>`<section class="search-path-section"><div class="search-path-heading section-heading"><h2 class="section-label">${title}</h2>${button(add,'添加','plus')}</div><div class="settings-card"><div id="${list}" class="search-paths"></div></div></section>`;
export function searchPage(){return `<div class="search-settings"><div class="toolbar search-page-toolbar"><div class="tabs" role="tablist" aria-label="文件搜索设置">${[['entry','搜索'],['index','索引'],['shortcuts','快捷命令'],['history','历史'],['menu','快捷菜单']].map(([id,label])=>`<button id="search-tab-${id}" data-search-tab="${id}" role="tab" aria-selected="${id==='entry'}" class="${id==='entry'?'selected':''}">${label}</button>`).join('')}</div>${button('search-launch','打开命令面板','search',true)}</div><div data-search-panel="entry"><div class="search-settings-grid"><div><h2 class="section-label">快捷入口</h2><div class="settings-card"><div class="setting-row"><div class="setting-copy"><h2>打开 One</h2><p>显示 One 主窗口</p></div><input id="main-window-shortcut" aria-label="打开 One 快捷键"></div><div class="setting-row"><div class="setting-copy"><h2>命令面板</h2><p>搜索文件、程序、设置和快捷命令</p></div><input id="search-shortcut" aria-label="命令面板快捷键"></div><div class="setting-row"><div class="setting-copy"><h2>定位当前程序</h2><p>在资源管理器中选中可执行文件</p></div><input id="search-programShortcut" aria-label="定位当前程序快捷键"></div>${searchSwitch('doubleCtrl','双按 Ctrl')}${searchSwitch('explorerTyping','直接输入搜索','资源管理器文件列表')}${searchSwitch('explorerMenu','双击空白处菜单','资源管理器文件列表')}${searchSwitch('dialogSwitch','文件对话框操作栏','搜索与目录跳转')}</div></div><div><h2 class="section-label">匹配方式</h2><div class="settings-card">${searchSwitch('fuzzy','模糊搜索')}${searchSwitch('pinyin','拼音与首字母')}</div>${pathSection('收藏文件夹','search-bookmark','search-bookmarks')}</div></div><p class="utility-message" id="search-bridge-error" role="alert"></p></div><div data-search-panel="index" hidden><div class="settings-card index-limit"><div class="preference-row"><label for="index-limit">索引项上限</label><input type="number" id="index-limit" min="1000" max="10000000" step="1000" aria-label="索引项上限"></div></div><div class="index-status-bar"><span id="index-summary" role="status"></span><span id="index-detail"></span><div class="spacer"></div>${button('index-cancel','停止')}${button('index-refresh','重新扫描','refresh')}</div>${indexPrioritySections()}</div><div data-search-panel="shortcuts" hidden><h2 class="section-label">内置快捷命令</h2><p class="utility-message">在搜索窗口输入命令并按空格进入对应模式。关闭的命令不会触发；按 Esc 或点击标签退出。</p><div id="search-command-list" class="settings-card search-command-card"></div><div class="section-heading search-web-heading"><h2 class="section-label">搜索引擎</h2>${button('search-web-engine-add','添加搜索引擎','plus')}</div><div id="search-web-engine-list" class="settings-card"></div></div><div data-search-panel="history" hidden><div class="section-heading"><h2 class="section-label">搜索历史</h2>${button('search-history-clear','清空历史','trash')}</div><p class="utility-message">记录搜索词、快捷命令和已完成的 AI 回答。</p><div id="search-history-list" class="settings-card"></div></div><div data-search-panel="menu" hidden>${menuEditorCard()}</div></div>`;}
export function setupSearchPage(){let config:SearchSettings,settingsRevision=0;const mainShortcut=q<HTMLInputElement>('main-window-shortcut');setupShortcut(mainShortcut);
 const loadMainShortcut=async()=>{const value=(await api.settings()).general.openShortcut;if(document.activeElement!==mainShortcut)mainShortcut.value=value;};void loadMainShortcut().catch(toast);
 mainShortcut.addEventListener('change',()=>void api.patchSettings({general:{openShortcut:mainShortcut.value}}).then(settings=>{mainShortcut.value=settings.general.openShortcut;}).catch(error=>{toast(error);void loadMainShortcut().catch(toast);}));
 document.querySelector('[data-page=search]')?.addEventListener('click',()=>void loadMainShortcut().catch(toast));for(const key of ['shortcut','programShortcut'])setupShortcut(q<HTMLInputElement>('search-'+key));
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
  document.querySelector('#app')!.innerHTML=`<div class="search-shell"><header class="search-input-row drag-region"><span class="search-leading-icon" aria-hidden="true">${icon('search')}</span>${embedded?'':'<span id="search-mode-tag" class="search-mode-tag" hidden></span>'}<input id="file-query" placeholder="搜索文件、应用、设置或网址；输入 > 查找命令" aria-label="搜索文件与文件夹" role="combobox" aria-autocomplete="list" aria-controls="search-results" aria-expanded="false" autocomplete="off" spellcheck="false">${embedded?'<span id="search-inline-summary" role="status"></span>':iconButton('search-save','收藏当前搜索','star')}${iconButton('search-clear','清空','close')}</header><div class="search-filter-row" id="search-filters"><div class="tabs" role="tablist" aria-label="搜索类型">${filters.map(([filter,label],i)=>`<button data-filter="${filter}" role="tab" aria-selected="${i===0}" class="${i===0?'selected':''}">${label}</button>`).join('')}</div>${embedded?'':'<div class="search-scope-field"><select id="search-scope" aria-label="搜索范围"><option value="">全部索引</option></select></div>'}</div>${embedded?'':'<div id="search-shortcut-panel" class="search-shortcut-panel" hidden></div>'}<div id="search-results" class="search-results" role="listbox" aria-label="搜索结果" aria-busy="false"></div><footer class="search-footer"><span id="search-summary" role="status"></span><span id="search-keys">↑↓ 选择 · Enter 打开 · Alt+P 预览</span></footer></div><div id="toast" class="toast" role="status" hidden></div>`;
 if(!embedded)customControls(q('search-filters'));
 const input=q<HTMLInputElement>('file-query'),list=q('search-results');
 let context:SearchContext={kind:'search',hwnd:0,pid:0,created:'',folders:[]},prefs:SearchSettings,filter='',scopeSelection='',selectedSaved='';
 let activeMode:ReturnType<typeof parseSearchShortcut>=null;
 const panel=embedded?null:q('search-shortcut-panel');
 let searchHistory:AIHistoryEntry[]=[],aiOutput='',aiError='',aiBusy=false,aiPrompt='',aiRequestId='',suggestions:string[]=[],suggestionIndex=-1;
 let idleMutation=0,idleRender=false,idleAction:Promise<void>=Promise.resolve();
 let suggestTimer:ReturnType<typeof setTimeout>|undefined,historyTimer:ReturnType<typeof setTimeout>|undefined,historyKey='';
 const iconCache=new Map<string,string>();
 const engines=()=>[...builtinSearchEngines,...(prefs?.webEngines||[])];
 const engineImage=(engine:SearchWebEngine)=>{const image=engine.icon||iconCache.get(engine.url);return image?`<img src="${esc(image)}" alt="">`:`<span class="search-engine-initial">${esc(engine.name.slice(0,1).toUpperCase())}</span>`;};
 const modeName=(mode:SearchShortcutMode)=>mode.kind==='one'?'One 命令':mode.kind==='extension'?mode.extensions.map(ext=>'.'+ext).join(' | '):mode.kind==='category'?mode.command.name:mode.engine.name;
 const modeIcon=(mode:SearchShortcutMode)=>mode.kind==='engine'?engineImage(mode.engine):mode.kind==='one'?'<span class="search-mode-command">&gt;</span>':icon(mode.kind==='extension'?'file':mode.command.icon);
 let markdownRender:((text:string)=>string)|undefined,markdownLoading:Promise<void>|undefined;
 const ensureMarkdown=()=>{markdownLoading||=import('./ai-chat-markdown').then(module=>{markdownRender=module.chatMarkdown;drawActivePanel();}).catch(toast);};
 const renderAIText=(value:string)=>markdownRender?markdownRender(value):esc(value);
 let idleSelection=0;
 const idleVisible=()=>!!panel&&!activeMode&&!input.value.trim()&&!filter&&!!(searchHistory.length||prefs?.savedQueries.length);
 const idleSummary=()=>prefs?.savedQueries.length&&searchHistory.length?'收藏与最近搜索':prefs?.savedQueries.length?'收藏':searchHistory.length?'最近搜索':'';
 const idleEntries=()=>[...(prefs?.savedQueries||[]).map(item=>({kind:'saved',id:item.id})),...searchHistory.slice(0,20).map(item=>({kind:'history',id:item.id}))];
 const syncIdleSelection=(scroll=false)=>{if(!idleVisible())return;const rows=[...panel!.querySelectorAll<HTMLElement>('[data-idle-kind]')];if(!rows.length)return;idleSelection=Math.max(0,Math.min(rows.length-1,idleSelection));rows.forEach((row,i)=>{row.classList.toggle('selected',i===idleSelection);row.setAttribute('aria-selected',String(i===idleSelection));});input.setAttribute('aria-controls','search-idle-items');input.setAttribute('aria-expanded','true');input.setAttribute('aria-activedescendant',rows[idleSelection].id);if(scroll)rows[idleSelection].scrollIntoView({block:'nearest'});};
 const historySubtitle=(item:AIHistoryEntry)=>{const date=new Date(item.time),time=Number.isNaN(date.getTime())?'':date.toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});return item.command==='ai'&&item.result?`${time} · ${item.result.replace(/\s+/g,' ').slice(0,90)}`:time;};
 const favoriteFor=(item:AIHistoryEntry)=>prefs?.savedQueries.find(saved=>saved.query===item.query&&(saved.command||saved.filter||'all')===item.command);
 const storedCommandIcon=(command?:string)=>{if(!command||command==='all')return '';const mode=parseSearchShortcut(command+' ',prefs?.webEngines,[]);if(mode)return modeIcon(mode);const filters:Record<string,string>={'app:':'window','setting:':'settings','folder:':'folder','doc:':'text','pic:':'images','video:':'play','audio:':'music','archive:':'archive'};return filters[command]?icon(filters[command]):'';};
 let renderedModeKey='',renderedModeIcon='';
 const drawMode=()=>{if(embedded)return;
  document.querySelector('.search-input-row')?.classList.toggle('has-mode',!!activeMode);
  input.placeholder=activeMode?.placeholder||(context.kind==='dialog'?'搜索要跳转的文件夹':'搜索文件、程序与设置');
  q('search-filters').hidden=context.kind==='dialog'||!input.value.trim()||!!activeMode&&!activeMode.showFilters;
  q('search-save').hidden=!input.value.trim();
  const tag=q('search-mode-tag');tag.hidden=!activeMode;if(!activeMode){renderedModeKey='';renderedModeIcon='';return;}
  const name=modeName(activeMode);
  const currentIcon=modeIcon(activeMode);
  tag.dataset.kind=activeMode.kind;
  const modeKey=activeMode.kind+':'+name+(activeMode.kind==='engine'?':'+activeMode.engine.id:'');
  if(modeKey!==renderedModeKey){tag.innerHTML=`<span class="search-mode-icon" aria-hidden="true">${currentIcon}</span><strong>${esc(name)}</strong><button type="button" data-mode-exit aria-label="退出快捷命令">${icon('close')}</button>`;renderedModeKey=modeKey;renderedModeIcon=currentIcon;}
  else if(currentIcon!==renderedModeIcon){tag.querySelector('.search-mode-icon')!.innerHTML=currentIcon;renderedModeIcon=currentIcon;}
 };
 const drawActivePanel=()=>{if(activeMode?.kind!=='engine')input.setAttribute('aria-controls','search-results');if(!panel||idleMutation&&!idleRender)return;
  const ai=activeMode?.kind==='category'&&activeMode.command.id==='ai',engine=activeMode?.kind==='engine',idle=!activeMode&&!input.value.trim()&&!filter;
  const typed=input.value,hint=!activeMode&&!composing&&context.kind==='search'&&prefs&&typed&&!/\s/.test(typed)?parseSearchShortcut(typed+' ',prefs.webEngines,prefs.shortcutDisabled):null;
  panel.hidden=!ai&&!engine&&!hint&&!idleVisible();panel.classList.toggle('is-idle',idleVisible());panel.classList.toggle('is-ai',ai);
  if(!idleVisible()&&input.getAttribute('aria-controls')==='search-idle-items'){input.setAttribute('aria-controls','search-results');input.removeAttribute('aria-activedescendant');input.setAttribute('aria-expanded','false');}
  if(ai){ensureMarkdown();const previous=panel.querySelector<HTMLElement>('.search-ai-answer'),previousTop=previous?.scrollTop||0,follow=!!previous&&previous.scrollHeight-previous.scrollTop-previous.clientHeight<48;panel.innerHTML=`<div class="search-ai-panel ${aiOutput?'has-answer':aiBusy?'is-thinking':'is-empty'}">${aiError?`<p class="search-ai-error">${esc(aiError)}</p>`:''}<div class="search-ai-answer markdown ${markdownRender?'':'is-raw'}">${aiOutput?renderAIText(aiOutput):aiBusy?'<span class="chat-working" role="status" aria-label="正在生成"><i></i><i></i><i></i></span>':input.value.trim()?'按 Enter 提问':'输入问题后按 Enter'}</div>${aiBusy?'<div class="search-ai-actions"><button data-ai-stop>停止</button></div>':aiOutput?`<div class="search-ai-actions"><button data-ai-copy>${icon('copy')}<span>复制回答</span></button><button data-ai-chat>${icon('arrow')}<span>转为对话并追问</span></button></div>`:''}</div>`;const answer=panel.querySelector<HTMLElement>('.search-ai-answer');if(answer&&previous)answer.scrollTop=follow?answer.scrollHeight:previousTop;return;}
  if(activeMode?.kind==='engine'){input.setAttribute('aria-controls','search-web-suggestions');input.setAttribute('aria-expanded',String(suggestions.length>0));if(suggestionIndex>=0)input.setAttribute('aria-activedescendant','search-suggestion-'+suggestionIndex);else input.removeAttribute('aria-activedescendant');panel.innerHTML=`<div class="search-web-action"><span class="search-shortcut-badge">${engineImage(activeMode.engine)}</span><div><strong>使用 ${esc(activeMode.engine.name)} 搜索</strong><small>${input.value.trim()?esc(input.value.trim()):'输入关键词后按 Enter'}</small></div><button class="primary" data-search-web ${input.value.trim()?'':'disabled'}>搜索</button></div>${suggestions.length?`<div class="search-suggestions" id="search-web-suggestions" role="listbox" aria-label="搜索建议"><h3>搜索建议</h3>${suggestions.map((item,i)=>`<button id="search-suggestion-${i}" data-suggestion="${i}" role="option" aria-selected="${i===suggestionIndex}" class="${i===suggestionIndex?'selected':''}">${icon('search')}<span class="search-suggestion-text">${esc(item)}</span><kbd aria-hidden="true">↵</kbd></button>`).join('')}</div>`:''}`;return;}
  if(hint){panel.innerHTML=`<div class="search-result search-shortcut-hint" role="status"><span class="result-icon" aria-hidden="true">${modeIcon(hint)}</span><div class="result-name"><strong>${esc(modeName(hint))}</strong><span>按空格进入快捷命令</span></div><kbd>空格</kbd></div>`;return;}
  if(idle)q('search-summary').textContent=idleSummary();
  const favorites=prefs?.savedQueries||[];
  panel.innerHTML=`<div class="search-idle-items" id="search-idle-items" role="listbox" aria-label="收藏与最近搜索">${favorites.length?`<section class="search-idle-section" role="group" aria-label="收藏"><div class="search-history-heading" data-idle-heading="saved"><strong>收藏</strong><small>${favorites.length}</small></div><div class="search-tag-list">${favorites.map((item,i)=>`<div class="search-idle-tag" id="search-idle-${i}" data-idle-kind="saved" data-idle-id="${esc(item.id)}" role="option" aria-selected="false"><button class="search-tag-main" data-saved-id="${esc(item.id)}" title="${esc(item.query)}">${storedCommandIcon(item.command||item.filter)}<span>${esc(item.name)}</span>${item.command&&item.command!=='all'?`<small>${esc(item.command)}</small>`:''}</button><button class="search-tag-action" data-saved-remove="${esc(item.id)}" aria-label="取消收藏 ${esc(item.name)}" title="取消收藏">${icon('close')}</button></div>`).join('')}</div></section>`:''}${searchHistory.length?`<section class="search-idle-section" role="group" aria-label="最近搜索"><div class="search-history-heading" data-idle-heading="history"><strong>最近搜索</strong><button type="button" data-history-clear aria-label="清空搜索历史" title="清空搜索历史">${icon('trash')}</button></div><div class="search-tag-list">${searchHistory.slice(0,20).map((item,i)=>{const saved=favoriteFor(item);return `<div class="search-idle-tag" id="search-idle-${favorites.length+i}" data-idle-kind="history" data-idle-id="${esc(item.id)}" role="option" aria-selected="false"><button class="search-tag-main" data-history-id="${esc(item.id)}" title="${esc(historySubtitle(item))}">${storedCommandIcon(item.command)}<span>${esc(item.query)}</span>${item.command!=='all'?`<small>${esc(item.command)}</small>`:''}</button><button class="search-tag-action ${saved?'is-favorite':''}" data-history-favorite="${esc(item.id)}" aria-label="${saved?'取消收藏':'收藏'} ${esc(item.query)}" title="${saved?'取消收藏':'收藏'}">${icon('star')}</button><button class="search-tag-action" data-history-remove="${esc(item.id)}" aria-label="删除历史 ${esc(item.query)}" title="删除历史">${icon('close')}</button></div>`;}).join('')}</div></section>`:''}</div>`;
  syncIdleSelection();
 };
 const mutateIdle=(work:()=>Promise<void>,removed:string[]=[]):Promise<void>=>{const next=idleAction.then(async()=>{
  idleMutation++;
  try{
   const targets=()=>[...panel!.querySelectorAll<HTMLElement>('[data-idle-kind],[data-idle-heading]')];
   const key=(element:HTMLElement)=>element.dataset.idleKind?`${element.dataset.idleKind}:${element.dataset.idleId}`:`heading:${element.dataset.idleHeading}`;
   const previous=new Map(targets().map(element=>[key(element),{rect:element.getBoundingClientRect(),favorite:!!element.querySelector('.is-favorite')}]));
   await work();
   const motion=!matchMedia('(prefers-reduced-motion: reduce)').matches;
   if(motion)await Promise.allSettled(targets().filter(element=>removed.includes(key(element))).map(element=>element.animate([{opacity:1,transform:'scale(1)'},{opacity:0,transform:'scale(.88)'}],{duration:160,easing:'ease-in',fill:'forwards'}).finished));
   idleRender=true;drawActivePanel();idleRender=false;layout();
   if(motion){const animations:Promise<Animation>[]=[];for(const element of targets()){const old=previous.get(key(element)),rect=element.getBoundingClientRect();if(old){const dx=old.rect.left-rect.left,dy=old.rect.top-rect.top;if(Math.abs(dx)>1||Math.abs(dy)>1)animations.push(element.animate([{transform:`translate(${dx}px,${dy}px)`},{transform:'translate(0,0)'}],{duration:260,easing:'cubic-bezier(.2,.8,.2,1)'}).finished);if(old.favorite!==!!element.querySelector('.is-favorite')){const star=element.querySelector<HTMLElement>('[data-history-favorite] .icon');if(star)animations.push(star.animate([{transform:'scale(.7)'},{transform:'scale(1.22)'},{transform:'scale(1)'}],{duration:260,easing:'ease-out'}).finished);}}else animations.push(element.animate([{opacity:0,transform:'translateY(7px) scale(.94)'},{opacity:1,transform:'translateY(0) scale(1)'}],{duration:210,delay:100,easing:'cubic-bezier(.2,.8,.2,1)',fill:'backwards'}).finished);}await Promise.allSettled(animations);}
  }finally{idleRender=false;idleMutation--;drawActivePanel();layout();}
 });idleAction=next.catch(()=>{});return next;};
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
  if(idleMutation&&!idleRender)return;
  const active=!!input.value.trim()||!!filter||!!activeMode||searchHistory.length>0||!!prefs?.savedQueries.length;
  document.body.classList.toggle('search-idle',!embedded&&!active);
  document.body.classList.toggle('search-shortcut-only',!embedded&&(activeMode?.kind==='engine'||activeMode?.kind==='category'&&activeMode.command.id==='ai'||idleVisible()));
  document.body.classList.toggle('search-has-results',embedded&&(results.count>0||active));
  const next=embedded?`${results.count}:${active}`:String(active);
  if(next!==lastLayout){lastLayout=next;void api.searchSize(results.count,active);}
 };
 const summary=(text:string,inline=results.count?`${results.count.toLocaleString()} 项`:'')=>{
  q('search-summary').textContent=text;lastInlineSummary=inline;if(embedded)q('search-inline-summary').textContent=inline;
 };
 const choose=async(index=results.selected)=>{const address=!embedded&&!activeMode&&!filter&&context.kind!=='dialog'?urlSearchEntry(input.value):null;const item=address&&shownKey!==key()?address:results.entry(index);if(item)try{const query=input.value.trim();if(query&&(item.launchKind!=='url'||query.length<=2000))await api.searchHistoryAdd(query,activeMode?.kind==='category'?activeMode.command.shortcut:activeMode?.kind==='extension'?activeMode.extensions.map(ext=>'.'+ext).join('|'):activeMode?.kind==='one'?'>':filter||'all');if(item.launchKind==='url')await api.searchOpenUrl(item.path);else if(item.launchKind==='action')await api.searchAction(item.path.slice(7));else await api.searchChoose(item.path);}catch(e){toast(e);}};
 const currentCommand=()=>activeMode?.kind==='category'?activeMode.command.shortcut:activeMode?.kind==='extension'?activeMode.extensions.map(ext=>'.'+ext).join('|'):activeMode?.kind==='one'?'>':activeMode?.kind==='engine'?activeMode.engine.shortcut:filter||'all';
 const hasFavorite=(value:SavedSearch)=>prefs.savedQueries.some(item=>item.query===value.query&&item.filter===value.filter&&item.folder===value.folder&&(item.command||item.filter||'all')===(value.command||value.filter||'all'));
 const addFavorite=async(value:SavedSearch)=>{if(hasFavorite(value)){toast('已收藏这个搜索');return;}await mutateIdle(async()=>{if(hasFavorite(value))return;prefs=await api.searchSavedQuery('add',value);selectedSaved=value.id;});};
 const removeFavorite=(id:string)=>mutateIdle(async()=>{prefs=await api.searchSavedQuery('remove',id);if(selectedSaved===id)selectedSaved='';},['saved:'+id]);
 if(!embedded)q('search-save').onclick=()=>{const query=input.value.trim();if(!query)return;const command=currentCommand(),next:SavedSearch={id:crypto.randomUUID(),name:query.slice(0,80),query,filter,folder:scopePath(),command,...(command==='ai'&&aiOutput?{result:aiOutput.slice(0,32768)}:{})};void addFavorite(next).catch(toast);};
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
  const directUrl=!embedded&&!activeMode&&!filter&&context.kind!=='dialog'?urlSearchEntry(text):null;
  const update=(entries:SearchEntry[])=>{
   // Resolve identity at completion, after any arrows pressed during the request.
   results.update(directUrl?[directUrl,...entries]:entries,shownKey===request.key||navigation!==request.navigation,text?'没有匹配的项目':'输入名称开始搜索');
   syncIdleSelection();
   shownKey=request.key;layout();
  };
  try{
  const commandSettings={pinyin:prefs?.pinyin??true,fuzzy:prefs?.fuzzy??true};
   if(activeMode?.kind==='one'||!embedded&&!activeMode&&text.startsWith('>')&&!prefs?.shortcutDisabled.includes('one')){const entries=commandMatches(activeMode?.kind==='one'?text:text.slice(1),100,commandSettings);update(entries);summary(entries.length+' 个命令 · Enter 执行');return;}
   if(activeMode?.kind==='category'&&activeMode.command.id==='ai'){update([]);summary(aiBusy?'AI 正在回答':aiOutput?'AI 回答已完成':'按 Enter 向 AI 提问');drawActivePanel();return;}
   if(activeMode?.kind==='engine'){update([]);summary(text?'按 Enter 使用 '+activeMode.engine.name+' 搜索':'输入关键词开始网页搜索');suggestions=[];suggestionIndex=-1;drawActivePanel();if(text){const id=activeMode.engine.id;suggestTimer=setTimeout(()=>void api.searchSuggest(id,text).then(items=>{if(current()){suggestions=items.slice(0,8);drawActivePanel();}}).catch(()=>{}),250);}return;}
   if(activeMode?.kind==='category'&&['recent','fav'].includes(activeMode.command.id)){
    const result=await api.searchCollection(activeMode.command.id as 'recent'|'fav',text);
    if(!current())return;update(result.items);summary(`${result.total} 项 · ${Math.round(result.elapsed)} ms`);return;
   }
    if(!embedded&&!text&&!filter&&!activeMode){update([]);summary(idleSummary());drawActivePanel();return;}
    if(!text&&!filter&&!activeMode){
    const seen=new Set<string>(),entries=[...(prefs?.bookmarks||[]),...context.folders.map(f=>f.path)].filter(p=>{const k=p.toLowerCase();if(seen.has(k))return false;seen.add(k);return true;}).map(path=>({path,name:path.split(/[\\/]/).filter(Boolean).pop()||path,directory:true,size:0,modified:0}));
    update(entries);const s=await api.searchState();if(current())summary(results.count?'收藏与已打开的文件夹':s.count?'输入名称开始搜索':'请先在 One 中添加索引目录');return;
   }
   if(directUrl){update([]);if(text.length>2000){summary('网页地址 · Enter 在浏览器打开','网页地址');return;}}
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
   if(directUrl)summary('网页地址 · Enter 在浏览器打开'+(result.total?' · '+result.total.toLocaleString()+' 个文件':''),'网页地址');else summary(`${result.total.toLocaleString()} 项${commands.length?` · ${commands.length} 个 One 命令`:''}${result.total>100?' · 显示前 100 项':''} · ${Math.round(result.elapsed)} ms`,result.total?`${result.total.toLocaleString()} 项`:(commands.length?`${commands.length} 个命令`:'无结果'));
   if(text&&!background){const command=activeMode?.kind==='category'?activeMode.command.shortcut:activeMode?.kind==='extension'?activeMode.extensions.map(ext=>'.'+ext).join('|'):filter||'all',recordKey=JSON.stringify([command,text,scopePath()]);if(recordKey!==historyKey)historyTimer=setTimeout(()=>{if(current()&&recordKey!==historyKey){historyKey=recordKey;void api.searchHistoryAdd(text,command).catch(()=>{});}},1000);}
  }catch(e){if(current()){results.update([],false,errorMessage(e));shownKey=request.key;summary('');layout();}}
  finally{
   if(running===request){running=undefined;progressive=undefined;if(current())list.setAttribute('aria-busy','false');if(backgroundPending)refresh();}
  }
 };
 const newQuery=()=>{invalidate();results.select(0);void query();};
  const enterMode=(mode:NonNullable<typeof activeMode>)=>{activeMode=mode;input.value=mode.query;filter='';selectedSaved='';syncFilters();drawScope();drawMode();input.focus();newQuery();};
  const exitMode=()=>{activeMode=null;input.value='';syncFilters();drawMode();drawScope();input.focus();newQuery();};
  const openStored=(item:{query:string;command?:string;filter?:string;folder?:string;result?:string},savedId='')=>{const command=item.command||item.filter||'all',mode=parseSearchShortcut(command+' ',prefs?.webEngines,prefs?.shortcutDisabled);activeMode=mode;input.value=item.query;filter=mode?'':item.filter||'';scopeSelection=item.folder||'';selectedSaved=savedId;aiPrompt=command==='ai'?item.query:'';aiOutput=command==='ai'?item.result||'':'';aiError='';syncFilters();drawMode();drawScope();newQuery();input.focus();};
  const openHistory=(item:AIHistoryEntry)=>openStored({...item,filter:['app:','setting:','folder:','doc:','pic:','video:','audio:','archive:'].includes(item.command)?item.command:''});
  const runAI=async()=>{if(!(activeMode?.kind==='category'&&activeMode.command.id==='ai')||aiBusy)return;const text=input.value.trim();if(!text)return;aiPrompt=text;aiOutput='';aiError='';aiBusy=true;aiRequestId=crypto.randomUUID();const request=aiRequestId;drawActivePanel();summary('AI 正在回答');try{const result=await api.aiInline(text,request);if(request!==aiRequestId)return;aiOutput=result.text;searchHistory=(await api.aiState()).history;}catch(error){if(request===aiRequestId)aiError=errorMessage(error);}finally{if(request===aiRequestId){aiBusy=false;drawActivePanel();summary(aiError||'AI 回答已完成');}}};
  if(panel)panel.addEventListener('click',event=>{const target=event.target instanceof Element?event.target.closest<HTMLElement>('[data-search-web],[data-suggestion],[data-ai-stop],[data-ai-chat],[data-ai-copy],[data-copy-code],a[href],[data-history-id],[data-history-clear],[data-history-remove],[data-history-favorite],[data-saved-id],[data-saved-remove]'):null;if(!target)return;
   if(target instanceof HTMLAnchorElement){event.preventDefault();void api.aiOpenLink(target.href).catch(toast);}
   else if(target.dataset.copyCode!==undefined){const code=target.closest('.chat-code')?.querySelector('code')?.textContent;if(code)void api.copyText(code).then(()=>toast('已复制代码')).catch(toast);}
   else if(target.dataset.searchWeb!==undefined&&activeMode?.kind==='engine')void api.searchWeb(activeMode.engine.id,input.value).catch(toast);
   else if(target.dataset.suggestion!==undefined&&activeMode?.kind==='engine'){const text=suggestions[Number(target.dataset.suggestion)];if(text)void api.searchWeb(activeMode.engine.id,text).catch(toast);}
   else if(target.dataset.aiStop!==undefined){const request=aiRequestId;aiRequestId='';aiBusy=false;drawActivePanel();void api.aiCancel(request).catch(toast);}
   else if(target.dataset.aiCopy!==undefined&&aiOutput)void api.copyText(aiOutput).then(()=>toast('已复制回答')).catch(toast);
   else if(target.dataset.aiChat!==undefined&&aiOutput)void api.aiChatCreate({query:aiPrompt,answer:aiOutput}).then(id=>api.aiChatOpen(id)).catch(toast);
   else if(target.dataset.historyClear!==undefined)void mutateIdle(async()=>{await api.searchHistoryClear();searchHistory=[];},searchHistory.slice(0,20).map(item=>'history:'+item.id)).catch(toast);
   else if(target.dataset.historyRemove){const id=target.dataset.historyRemove;void mutateIdle(async()=>{await api.searchHistoryRemove(id);searchHistory=searchHistory.filter(item=>item.id!==id);},['history:'+id]).catch(toast);}
   else if(target.dataset.historyFavorite){const item=searchHistory.find(entry=>entry.id===target.dataset.historyFavorite);if(!item)return;const saved=favoriteFor(item);if(saved)void removeFavorite(saved.id).catch(toast);else{const value:SavedSearch={id:crypto.randomUUID(),name:item.query.slice(0,80),query:item.query,filter:['app:','setting:','folder:','doc:','pic:','video:','audio:','archive:'].includes(item.command)?item.command:'',folder:'',command:item.command,...(item.result?{result:item.result}:{})};void addFavorite(value).catch(toast);} }
   else if(target.dataset.savedRemove)void removeFavorite(target.dataset.savedRemove).catch(toast);
   else if(target.dataset.savedId){const saved=prefs?.savedQueries.find(item=>item.id===target.dataset.savedId);if(saved)openStored(saved,saved.id);}
   else if(target.dataset.historyId){const item=searchHistory.find(entry=>entry.id===target.dataset.historyId);if(item)openHistory(item);}
  });
 if(!embedded)q('search-mode-tag').addEventListener('click',event=>{if(event.target instanceof Element&&event.target.closest('[data-mode-exit]'))exitMode();});
 input.addEventListener('input',e=>{
   if(!embedded&&!activeMode&&!composing){const mode=parseSearchShortcut(input.value,prefs?.webEngines,prefs?.shortcutDisabled);if(mode){enterMode(mode);return;}}
  if(!input.value.trim()&&!activeMode&&filter){filter='';syncFilters();}
  if(activeMode?.kind==='category'&&activeMode.command.id==='ai'&&input.value.trim()!==aiPrompt){if(aiBusy){const request=aiRequestId;aiRequestId='';aiBusy=false;void api.aiCancel(request).catch(()=>{});}aiOutput='';aiError='';}
  invalidate();inputPending=true;results.select(0);drawMode();layout();
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
  const index=rowIndex(event.target),item=results.entry(index);if(!item||item.launchKind==='action'||item.launchKind==='url'){if(item?.launchKind==='url')event.preventDefault();return;}
  event.preventDefault();navigation++;results.select(index);
  void api.searchContextMenu(item.path,{x:event.clientX,y:event.clientY},item.directory).catch(toast);
 });
 document.addEventListener('keydown',e=>{
  if(e.isComposing||composing)return;
   if(e.key==='Escape'){e.preventDefault();if(activeMode){exitMode();return;}void api.closeWindow();return;}
   if(e.key==='Backspace'&&e.target===input&&activeMode&&!input.value){e.preventDefault();exitMode();return;}
  // SegmentTab handles its own keyboard navigation and button activation.
  if(e.target instanceof Element&&e.target.closest('#search-filters'))return;
  if(activeMode?.kind==='engine'&&suggestions.length&&(e.key==='ArrowDown'||e.key==='ArrowUp')){e.preventDefault();suggestionIndex=(suggestionIndex+(e.key==='ArrowDown'?1:suggestionIndex<0?0:-1)+suggestions.length)%suggestions.length;drawActivePanel();panel?.querySelector('[data-suggestion="'+suggestionIndex+'"]')?.scrollIntoView({block:'nearest'});return;}
  const item=results.entry();
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){
   if(idleVisible()){e.preventDefault();idleSelection+=e.key==='ArrowDown'?1:-1;syncIdleSelection(true);return;}
   e.preventDefault();navigation++;results.select(results.selected+(e.key==='ArrowDown'?1:-1),true);
  }else if(e.ctrlKey&&/^[1-9]$/.test(e.key)&&embedded){e.preventDefault();void choose(Number(e.key)-1);}
  else if(e.key==='Enter'){
   if(idleVisible()){e.preventDefault();const selected=idleEntries()[idleSelection];if(selected?.kind==='saved'){const saved=prefs.savedQueries.find(item=>item.id===selected.id);if(saved)openStored(saved,saved.id);}else if(selected){const history=searchHistory.find(item=>item.id===selected.id);if(history)openHistory(history);}return;}
   e.preventDefault();if(document.body.classList.contains('search-idle'))return;
    if(activeMode?.kind==='engine'){const text=suggestionIndex>=0?suggestions[suggestionIndex]:input.value;if(text.trim())void api.searchWeb(activeMode.engine.id,text).catch(toast);return;}
    if(activeMode?.kind==='category'&&activeMode.command.id==='ai'){void runAI();return;}
   if(e.ctrlKey&&item&&!item.launchKind)void api.revealFile(item.path).catch(toast);else void choose();
  }else if(e.altKey&&e.key.toLowerCase()==='p'&&item&&!item.launchKind){e.preventDefault();void api.preview(item.path).catch(toast);}
 });
 const syncFilters=()=>document.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach(b=>{
  const value=b.dataset.filter||'',fileMode=activeMode?.kind==='extension'||activeMode?.kind==='category'&&activeMode.command.id==='file',mediaMode=activeMode?.kind==='category'&&activeMode.command.id==='mm';
  b.hidden=!!(fileMode&&['app:','setting:','folder:'].includes(value)||mediaMode&&!['','pic:','video:','audio:'].includes(value));
  const active=b.dataset.filter===filter;b.classList.toggle('selected',active);b.setAttribute('aria-selected',String(active));
 });
  q('search-clear').onclick=()=>{if(!input.value&&!activeMode&&!filter){input.focus();return;}input.value='';activeMode=null;filter='';selectedSaved='';scopeSelection='';syncFilters();drawMode();drawScope();input.focus();newQuery();};
 document.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach(b=>b.onclick=event=>{
   if(activeMode&&activeMode.kind!=='extension'&&!(activeMode.kind==='category'&&['file','mm'].includes(activeMode.command.id))){activeMode=null;input.value='';drawMode();}filter=b.dataset.filter!;syncFilters();drawScope();if(event.detail)input.focus();newQuery();
 });
 if(!embedded)q<HTMLButtonElement&{value:string}>('search-scope').onchange=event=>{scopeSelection=(event.currentTarget as HTMLButtonElement&{value:string}).value;selectedSaved='';drawScope();newQuery();};
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
 if(!embedded){api.onAIEvent(event=>{if(event.kind==='inline-delta'&&event.requestId===aiRequestId&&aiOutput.length===event.offset){aiOutput+=event.text;const answer=panel?.querySelector<HTMLElement>('.search-ai-answer');if(answer){const previousTop=answer.scrollTop,follow=answer.scrollHeight-previousTop-answer.clientHeight<48;answer.classList.toggle('is-raw',!markdownRender);const shell=answer.closest('.search-ai-panel');shell?.classList.remove('is-empty','is-thinking');shell?.classList.add('has-answer');answer.innerHTML=renderAIText(aiOutput);answer.scrollTop=follow?answer.scrollHeight:previousTop;}else drawActivePanel();}else if(event.kind==='changed')void api.aiState().then(state=>{searchHistory=state.history;drawActivePanel();layout();}).catch(()=>{});});void api.aiState().then(state=>{searchHistory=state.history;drawActivePanel();layout();}).catch(()=>{});}
 api.onSearchReset(()=>{
  invalidate();shownKey='';input.value='';activeMode=null;filter='';scopeSelection='';selectedSaved='';syncFilters();drawMode();drawActivePanel();drawScope();input.focus();
  const reset=revision;void api.searchPreferences().then(p=>{prefs=p;drawScope();drawActivePanel();loadIcons();lastLayout='';layout();if(revision===reset)void query();});void api.searchReady();
 });
  input.focus();void api.searchReady();await subscribeSnapshot(api.onSearchPreferences,api.searchPreferences,next=>{const changed=JSON.stringify(prefs?.bookmarks)!==JSON.stringify(next.bookmarks),ranking=JSON.stringify([prefs?.priorities,prefs?.fuzzy,prefs?.pinyin])!==JSON.stringify([next.priorities,next.fuzzy,next.pinyin]),oldScope=scopePath(),disabledChanged=JSON.stringify(prefs?.shortcutDisabled)!==JSON.stringify(next.shortcutDisabled);prefs=next;const modeId=activeMode?.kind==='one'?'one':activeMode?.kind==='extension'?'extension':activeMode?.kind==='category'?activeMode.command.id:'';const deactivated=!!modeId&&next.shortcutDisabled.includes(modeId);if(deactivated){activeMode=null;input.value='';filter='';syncFilters();}if(selectedSaved&&!next.savedQueries.some(item=>item.id===selectedSaved)){selectedSaved='';scopeSelection='';}drawScope();drawActivePanel();drawMode();loadIcons();lastLayout='';layout();if(deactivated||disabledChanged&&input.value.startsWith('>'))newQuery();else if(ranking||oldScope!==scopePath()||changed&&!input.value.trim()&&!filter)refresh();});
 if(context.hwnd===0)applyContext(await api.searchContext());else void query();
}
