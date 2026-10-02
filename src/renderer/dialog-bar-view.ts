import {api,q,icon,iconButton,esc,toast} from './ui';
import {SearchResults} from './search-results';
import {isWindowVisible,onWindowVisibility} from './window-visibility';
import type {DialogBarData} from '../shared/dialog-bar';
import type {SearchEntry} from '../shared/search';
import './dialog-bar.css';
export async function renderDialogBar(){
 document.body.classList.add('dialog-companion','search-window');
 document.querySelector('#app')!.innerHTML=`<div class="dialog-companion-shell"><div class="search-input-row dialog-quick-bar">${icon('search')}<input id="dialog-query" aria-label="搜索文件夹" placeholder="搜索文件夹" role="combobox" aria-autocomplete="list" aria-controls="dialog-results" aria-expanded="false" autocomplete="off" spellcheck="false"><div class="dialog-bar-buttons">${iconButton('dialog-bookmarks','收藏文件夹','star')}${iconButton('dialog-recent','最近访问','history')}${iconButton('dialog-settings','文件对话框设置','settings')}</div></div><div class="dialog-results-panel" hidden><div id="dialog-results" class="search-results" role="listbox" aria-label="跳转目录" aria-busy="false"></div></div></div><div id="toast" class="toast" hidden role="status"></div>`;
 const input=q<HTMLInputElement>('dialog-query'),root=q('dialog-results'),panel=document.querySelector<HTMLElement>('.dialog-results-panel')!;
 const results=new SearchResults(root,input,false,item=>esc(item.name));
 let data:DialogBarData={opened:[],bookmarks:[],recent:[]},group:''|'bookmarks'|'recent'='',revision=0,composing=false,running=false,pending=false;
 let timer:ReturnType<typeof setTimeout>|undefined,progressive:{token:string;version:number}|undefined;
 let lastSize='';const layout=(shown:boolean)=>{panel.hidden=!shown;input.setAttribute('aria-expanded',String(shown));const count=shown?Math.min(6,results.count):0,active=shown&&!!(input.value.trim()||group),size=count+':'+active;if(size!==lastSize){lastSize=size;void api.dialogBarSize(count,active).catch(()=>{});}};
 const defaults=()=>{results.update(entries([...data.opened,...data.recent]),true,'暂无已打开或最近访问的目录');layout(isWindowVisible()&&!!results.count);};
 const clear=()=>{revision++;clearTimeout(timer);progressive=undefined;running=false;pending=false;group='';input.value='';lastSize='';defaults();root.setAttribute('aria-busy','false');for(const id of ['dialog-bookmarks','dialog-recent'])q(id).setAttribute('aria-pressed','false');};
 const choose=async(path:string)=>{try{await api.dialogBarChoose(path);}catch(error){toast(error);}};
 const entries=(paths:string[]):SearchEntry[]=>paths.map(path=>({path,name:path.split(/[\\/]/).filter(Boolean).pop()||path,directory:true,size:0,modified:0}));
 const acceptData=(next:DialogBarData)=>{
  data=next;if(group||input.value.trim())void query();else defaults();
 };
 const query=async()=>{
  if(composing||!isWindowVisible())return;
  clearTimeout(timer);const version=++revision,text=input.value.trim();pending=false;running=true;
  const current=()=>version===revision&&isWindowVisible();
  try{
   if(!text){results.update(entries([...data.opened,...data[group||'recent']]),true,group==='bookmarks'?'暂无收藏':'暂无已打开或最近访问的目录');layout(true);return;}
   layout(true);root.setAttribute('aria-busy','true');const token=crypto.randomUUID();progressive={token,version};
   const result=await api.searchFiles(text,true,token);if(!current()||result.cancelled)return;
   results.update(result.items,true,'没有匹配的目录');layout(true);
  }catch(error){if(current())toast(error);}
  finally{if(version===revision){running=false;progressive=undefined;root.setAttribute('aria-busy','false');if(pending){pending=false;timer=setTimeout(()=>void query(),160);}}}
 };
 api.onSearchProgress(value=>{if(progressive?.token===value.token&&progressive.version===revision&&!value.result.cancelled&&isWindowVisible()){results.update(value.result.items,true,'没有匹配的目录');layout(true);}});
 input.addEventListener('input',()=>{revision++;clearTimeout(timer);group='';for(const id of ['dialog-bookmarks','dialog-recent'])q(id).setAttribute('aria-pressed','false');progressive=undefined;if(!composing)timer=setTimeout(()=>void query(),40);});
 input.addEventListener('focus',()=>void query());
 input.addEventListener('compositionstart',()=>{composing=true;revision++;clearTimeout(timer);});input.addEventListener('compositionend',()=>{composing=false;void query();});
 root.addEventListener('click',event=>{const row=event.target instanceof Element?event.target.closest<HTMLElement>('[data-result]'):null;if(row){const item=results.entry(Number(row.dataset.result));if(item)void choose(item.path);}});
 document.addEventListener('keydown',event=>{
  if(event.isComposing||composing)return;
  if(event.key==='Escape'){event.preventDefault();clear();void api.dialogBarCollapse();}
  else if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();results.select(results.selected+(event.key==='ArrowDown'?1:-1),true);}
  else if(event.key==='Enter'&&event.target===input){event.preventDefault();const text=input.value.trim(),item=results.entry();if(/^[a-z]:[\\/]|^\\\\/i.test(text))void choose(text);else if(item)void choose(item.path);}
 });
 for(const key of ['bookmarks','recent'] as const)q('dialog-'+key).onclick=()=>{const next=group===key?'':key;clear();group=next;q('dialog-'+key).setAttribute('aria-pressed',String(!!group));input.focus();void api.dialogBarData().then(acceptData).catch(toast);};
 q('dialog-settings').onclick=()=>void api.dialogBarSettings();
 api.onDialogBarData(acceptData);api.onDialogBarCollapse(clear);onWindowVisibility(visible=>{if(!visible)clear();else defaults();});
 api.onSearchState(()=>{if(input.value.trim()&&isWindowVisible()){if(running)pending=true;else{clearTimeout(timer);timer=setTimeout(()=>void query(),160);}}});
 acceptData(await api.dialogBarData());
}
