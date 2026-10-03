import {dialogMarkup,openDialog,closeDialog} from './dialog';
import {pickerDisplayName,type PickerData,type PickerEntry,type PickerPlaces,type PickerOpened} from '../shared/picker';
import {api,q,esc,icon,button,iconButton,toast,action} from './ui';
import {windowControls,setupChrome} from './chrome';
import {openControl,releaseControl} from './controls';
import {VirtualRows} from './virtual-rows';
import {hydrateIconRows} from './shell-icons';
import {pathField} from './path-field';
import './picker.css';

export function renderPicker() {
 const app=q('app');
 app.innerHTML = `<div class="picker-shell"><header class="picker-heading drag-region"><h2 id="picker-title">选择位置</h2>${windowControls()}</header>
 <div class="picker-toolbar"><div class="picker-navigation">${iconButton('picker-back','后退 · Alt+←','back')}${iconButton('picker-forward','前进 · Alt+→','arrow')}${iconButton('picker-up','上级目录 · Alt+↑','up')}</div>${pathField('picker-path','当前目录',{id:'picker-go',label:'前往此目录',glyph:'arrow'},'输入目录路径')}${iconButton('picker-options-button','显示选项','ellipsis')}</div>
 <div class="picker-content"><nav id="picker-places" aria-label="快捷位置"><section id="picker-common"></section><section id="picker-opened"></section><section id="picker-recent"></section><section id="picker-bookmarks"></section><section id="picker-drives"></section></nav>
 <section class="picker-browser"><div class="picker-list-heading"><span id="picker-location">当前目录</span><label class="picker-filter">${icon('search')}<input id="picker-filter" aria-label="筛选当前目录" placeholder="筛选当前目录" autocomplete="off" spellcheck="false"></label></div><div id="picker-list" role="listbox" aria-label="文件与目录" tabindex="0"></div><div id="picker-empty" class="picker-empty" hidden>${icon('folder')}<span>目录为空</span></div></section></div>
 <footer class="picker-footer"><label id="picker-name-label" hidden>文件名<input id="picker-name" aria-label="文件名" autocomplete="off" spellcheck="false"></label><div class="picker-buttons"><div class="picker-status"><span id="picker-status" role="status">正在读取…</span><span id="picker-selection"></span></div>${button('picker-cancel','取消')}${button('picker-confirm','选择','',true)}</div></footer></div>
 <div id="picker-options" class="picker-options" role="menu" aria-label="显示选项" hidden><button id="picker-hidden" role="menuitemcheckbox" aria-checked="false"><span class="picker-check"></span>显示隐藏文件</button><button id="picker-extensions" role="menuitemcheckbox" aria-checked="true"><span class="picker-check"></span>显示文件扩展名</button><div class="picker-menu-divider"></div><button id="picker-refresh" role="menuitem">${icon('refresh')}刷新当前目录</button></div>
 <div class="toast picker-toast" id="toast" hidden role="status"></div>${dialogMarkup({id:'overwrite-dialog',title:'文件已存在',closeId:'overwrite-close',body:'<p id="overwrite-name"></p>',actions:`<button id="overwrite-cancel" autofocus>取消</button>${button('overwrite-confirm','替换文件','',true)}`})}`;
 setupChrome();
 let data:PickerData|undefined, selected='', revision=0, loading=true, choosing=false, disposed=false;
 let places:PickerPlaces|undefined, explorer:PickerOpened|undefined, openedLoading=true, openedRevision=0;
 let entries:PickerEntry[]=[], history:string[]=[], historyIndex=-1, optionsOpen=false, named=false;
 const list=q('picker-list'), name=q<HTMLInputElement>('picker-name'), path=q<HTMLInputElement>('picker-path'), filter=q<HTMLInputElement>('picker-filter');
 const newlyPainted:HTMLElement[]=[];
 const rows=new VirtualRows(list,()=>entries.length,(position,previous)=>{
  const entry=entries[position];
  let row=previous;
  if(!row||row.dataset.path!==entry.path){
   row=document.createElement('div');row.className='picker-entry';row.dataset.path=entry.path;row.id='picker-option-'+position;
   row.setAttribute('role','option');row.setAttribute('aria-label',entry.name);row.setAttribute('aria-posinset',String(position+1));row.setAttribute('aria-setsize',String(entries.length));
   row.innerHTML=`<span class="picker-file-icon" data-file-icon="${esc(entry.path)}">${icon(entry.directory?'folder':'file')}</span><span class="picker-entry-name"></span><span class="entry-kind">${entry.directory?'文件夹':esc(entry.name.split('.').length>1?entry.name.split('.').at(-1)?.toUpperCase()||'':'文件')}</span>`;
   row.addEventListener('click',()=>select(entry.path));
   row.addEventListener('dblclick',()=>{select(entry.path);if(entry.directory)void navigate(entry.path);else void confirm().catch(toast);});
   newlyPainted.push(row.querySelector<HTMLElement>('[data-file-icon]')!);
  }
  row.classList.toggle('selected',entry.path===selected);row.classList.toggle('hidden-file',entry.hidden);row.setAttribute('aria-selected',String(entry.path===selected));
  const label=row.querySelector('.picker-entry-name')!,display=pickerDisplayName(entry,data?.preferences.showExtensions!==false);
  if(label.textContent!==display)label.textContent=display;
  return row;
 },42,()=>{
  const index=entries.findIndex(entry=>entry.path===selected),node=q('picker-option-'+index);
  if(node?.dataset.path===selected)list.setAttribute('aria-activedescendant',node.id);else list.removeAttribute('aria-activedescendant');
  const candidates=newlyPainted.splice(0),version=revision;if(candidates.length)hydrateIconRows(candidates,()=>!disposed&&version===revision);
 });
 function updateControls(){
  path.disabled=loading;q<HTMLButtonElement>('picker-go').disabled=loading;
  q<HTMLButtonElement>('picker-confirm').disabled=loading||choosing||!data||(data.mode!=='directory'&&!name.value.trim());
  q<HTMLButtonElement>('picker-back').disabled=loading||historyIndex<=0;
  q<HTMLButtonElement>('picker-forward').disabled=loading||historyIndex>=history.length-1;
  q<HTMLButtonElement>('picker-up').disabled=loading||!data||data.parent===data.path;
  q<HTMLButtonElement>('picker-hidden').disabled=loading||!data;q<HTMLButtonElement>('picker-extensions').disabled=loading||!data;
  list.setAttribute('aria-busy',String(loading));
  q('picker-selection').textContent=data?(selected||data.path):'';
 }
 function select(location:string){
  selected=location;const entry=entries.find(entry=>entry.path===location);
  if(entry&&!entry.directory)name.value=entry.name;
  else if(data?.mode==='file')name.value='';
  updateControls();rows.refresh();list.focus({preventScroll:true});
 }
 function filterEntries(preserve=false){
  const query=filter.value.trim().toLocaleLowerCase(),anchor=rows.location();
  entries=(data?.entries||[]).filter(entry=>entry.name.toLocaleLowerCase().includes(query));
  if(!entries.some(entry=>entry.path===selected))selected='';
  rows.reset();if(preserve)rows.anchor(anchor.position,anchor.offset);
  q('picker-empty').hidden=entries.length>0||loading;
  q('picker-empty').querySelector('span')!.textContent=query?'没有匹配的项目':'目录为空';
  q('picker-status').textContent=loading?'正在读取…':query?`${entries.length.toLocaleString()} / ${data?.entries.length.toLocaleString()} 项`:`${entries.length.toLocaleString()} 项`;
  list.dataset.count=String(entries.length);list.removeAttribute('aria-activedescendant');updateControls();
 }
 function activePlaces(){for(const b of q('picker-places').querySelectorAll<HTMLButtonElement>('[data-place]')){const active=b.dataset.place?.toLocaleLowerCase()===data?.path.toLocaleLowerCase();b.classList.toggle('active',active);if(active)b.setAttribute('aria-current','location');else b.removeAttribute('aria-current');}}
 function section(id:string,title:string,items:{path:string;name:string}[],glyph='folder',empty=''){
  const root=q(id);root.hidden=!items.length&&!empty;root.innerHTML=`<div class="picker-place-caption"><span>${esc(title)}</span>${id==='picker-opened'?iconButton('picker-opened-refresh','刷新已打开的目录','refresh'):id==='picker-recent'?iconButton('picker-recent-clear','清空最近','trash'):''}</div>${items.map(item=>`<button type="button" class="picker-place" data-place="${esc(item.path)}" title="${esc(item.path)}">${icon(glyph)}<span>${esc(item.name)}</span></button>`).join('')}${!items.length?`<small class="picker-place-empty">${esc(empty)}</small>`:''}`;
 }
 function renderPlaces(){
  section('picker-common','常用',places?.common||[]);
  section('picker-opened','已打开',explorer?.places||[],'window',openedLoading?'正在获取…':explorer?.error||'没有已打开的目录');
  section('picker-recent','最近',places?.recent||[],'history','暂无最近位置');
  section('picker-bookmarks','收藏',places?.bookmarks||[],'star');
  section('picker-drives','磁盘',places?.drives||[],'disk');
  activePlaces();
  q('picker-opened-refresh').addEventListener('click',()=>void readOpened());
  q<HTMLButtonElement>('picker-recent-clear').disabled=!places?.recent.length;
  q('picker-recent-clear').addEventListener('click',()=>void (async()=>{await api.pickerClearRecent();const next=await api.pickerPlaces();if(!disposed){places=next;renderPlaces();}})().catch(toast));
 }
 async function readOpened(){
  const version=++openedRevision;openedLoading=true;renderPlaces();
  try{const next=await api.pickerOpened();if(disposed||version!==openedRevision)return;explorer=next;}
  catch{if(disposed||version!==openedRevision)return;explorer={places:[],error:'读取失败，请刷新重试'};}
  openedLoading=false;renderPlaces();
 }
 async function navigate(location?:string,options:{history?:number;preserve?:boolean}={}){
  const version=++revision;loading=true;closeOptions();q('picker-status').textContent='正在读取…';q('picker-empty').hidden=true;updateControls();
  const anchor=rows.location(),selection=selected;
  try{
   const next=await api.pickerData(location);if(disposed||version!==revision)return;
   const same=data?.path===next.path;data=next;loading=false;
   selected=options.preserve&&same?selection:'';
   if(!named){name.value=data.name;named=true;}else if(data.mode==='file'&&!options.preserve)name.value='';
   if(!same)filter.value='';
   if(options.history!==undefined)historyIndex=options.history;
   else if(!options.preserve&&history[historyIndex]!==data.path){history.splice(historyIndex+1);history.push(data.path);if(history.length>50)history.shift();historyIndex=history.length-1;}
   q('picker-title').textContent=data.title;path.value=data.path;q('picker-location').textContent=data.path.split(/[\\/]/).filter(Boolean).at(-1)||data.path;
   q('picker-name-label').hidden=data.mode==='directory';q('picker-confirm').textContent=data.mode==='save'?'保存':data.mode==='directory'?'选择此目录':'打开';
   syncOptions();filterEntries();if(options.preserve&&same)rows.anchor(anchor.position,anchor.offset);activePlaces();
  }catch(error){if(disposed||version!==revision)return;loading=false;q('picker-status').textContent='无法读取目录';if(data){path.value=data.path;q('picker-empty').hidden=entries.length>0;}updateControls();toast(error);}
 }
 async function confirm(overwrite=false){
  if(!data||loading||choosing)return;
  if(data.mode!=='directory'&&!name.value.trim())return toast('请输入或选择文件名');
  const target=data.mode==='directory'?(selected||data.path):data.path.replace(/[\\/]$/,'')+'\\'+name.value;
  choosing=true;updateControls();
  try{const result=await api.pickerChoose(target,overwrite);if(result.overwrite){q('overwrite-name').textContent='替换 '+name.value+'？';openDialog(q<HTMLDialogElement>('overwrite-dialog'));}}
  finally{choosing=false;updateControls();}
 }
 function syncOptions(){
  for(const [id,key]of [['picker-hidden','showHidden'],['picker-extensions','showExtensions']]as const){const enabled=data?.preferences[key]||false;q(id).setAttribute('aria-checked',String(enabled));q(id).querySelector('.picker-check')!.innerHTML=enabled?icon('check'):'';}
 }
 function closeOptions(){
  if(!optionsOpen)return;optionsOpen=false;q('picker-options').hidden=true;q('picker-options-button').setAttribute('aria-expanded','false');releaseControl(closeOptions);
 }
 function openOptions(){
  if(optionsOpen)return closeOptions();openControl(closeOptions);optionsOpen=true;
  const menu=q('picker-options'),rect=q('picker-options-button').getBoundingClientRect();menu.hidden=false;
  menu.style.top=rect.bottom+6+'px';menu.style.right=Math.max(8,innerWidth-rect.right)+'px';
  q('picker-options-button').setAttribute('aria-expanded','true');menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
 }
 async function preference(key:'showHidden'|'showExtensions'){
  if(!data||loading)return;closeOptions();const next={...data.preferences,[key]:!data.preferences[key]};
  const saved=await api.pickerPreferences(next);if(disposed)return;data.preferences=saved;syncOptions();
  if(key==='showHidden')await navigate(data.path,{preserve:true});else rows.refresh();
 }
 action('picker-go',()=>navigate(path.value));action('picker-back',()=>navigate(history[historyIndex-1],{history:historyIndex-1}));action('picker-forward',()=>navigate(history[historyIndex+1],{history:historyIndex+1}));action('picker-up',()=>data&&navigate(data.parent));
 action('picker-cancel',()=>api.closeWindow());action('picker-confirm',()=>confirm());action('picker-options-button',openOptions);q('picker-options-button').setAttribute('aria-haspopup','menu');q('picker-options-button').setAttribute('aria-expanded','false');
 action('picker-hidden',()=>preference('showHidden'));action('picker-extensions',()=>preference('showExtensions'));action('picker-refresh',()=>data&&navigate(data.path,{preserve:true}));
 action('overwrite-cancel',()=>closeDialog(q<HTMLDialogElement>('overwrite-dialog')));action('overwrite-confirm',()=>confirm(true));
 q('picker-places').addEventListener('click',event=>{const place=(event.target as Element).closest<HTMLElement>('[data-place]');if(place)void navigate(place.dataset.place);});
 path.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();void navigate(path.value);}});
 name.addEventListener('input',()=>{selected='';rows.refresh();updateControls();});name.addEventListener('keydown',event=>{if(event.key==='Enter')void confirm().catch(toast);});
 filter.addEventListener('input',()=>filterEntries());
 list.addEventListener('keydown',event=>{
  if(loading)return;const index=entries.findIndex(entry=>entry.path===selected),page=Math.max(1,Math.floor(rows.visibleHeight/42)-1);
  let next:number|undefined;
  if(event.key==='ArrowUp')next=index<0?entries.length-1:index-1;
  if(event.key==='ArrowDown')next=index+1;if(event.key==='Home')next=0;if(event.key==='End')next=entries.length-1;
  if(event.key==='PageUp')next=index-page;if(event.key==='PageDown')next=Math.max(0,index)+page;
  if(next!==undefined){event.preventDefault();next=Math.max(0,Math.min(entries.length-1,next));if(entries[next]){select(entries[next].path);rows.reveal(next);}}
  else if(event.key==='Enter'&&index>=0){event.preventDefault();const entry=entries[index];if(entry.directory)void navigate(entry.path);else void confirm().catch(toast);}
 });
 q('picker-options').addEventListener('keydown',event=>{
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeOptions();q('picker-options-button').focus();}
  else if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();const nodes=[...q('picker-options').querySelectorAll<HTMLButtonElement>('button:not(:disabled)')],at=nodes.indexOf(document.activeElement as HTMLButtonElement);nodes[(at+(event.key==='ArrowDown'?1:nodes.length-1))%nodes.length]?.focus();}
  else if(event.key==='Tab')closeOptions();
 });
 document.addEventListener('pointerdown',event=>{if(optionsOpen&&!(event.target as Element).closest('#picker-options,#picker-options-button'))closeOptions();},{capture:true});
 window.addEventListener('resize',closeOptions);
 window.addEventListener('keydown',event=>{
  if(event.defaultPrevented||q<HTMLDialogElement>('overwrite-dialog').open)return;
  if(event.key==='Escape'){if(optionsOpen)closeOptions();else void api.closeWindow();}
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='l'){event.preventDefault();path.focus();path.select();}
  if(event.altKey&&!loading&&['ArrowLeft','ArrowRight','ArrowUp'].includes(event.key)){event.preventDefault();if(event.key==='ArrowLeft'&&historyIndex>0)void navigate(history[historyIndex-1],{history:historyIndex-1});else if(event.key==='ArrowRight'&&historyIndex<history.length-1)void navigate(history[historyIndex+1],{history:historyIndex+1});else if(event.key==='ArrowUp'&&data)void navigate(data.parent);}
 });
 window.addEventListener('pagehide',()=>{disposed=true;revision++;openedRevision++;rows.dispose();closeOptions();});
 updateControls();renderPlaces();void navigate();
 void api.pickerPlaces().then(value=>{if(!disposed){places=value;renderPlaces();}}).catch(toast);
 void readOpened();
}
