import {esc,icon} from './ui';
import type {ArchiveBrowse,ArchiveEntry,ArchiveListing} from '../shared/archive';

export function archiveBrowserMarkup(editor='',heading='',actions='',draft=''){return `<div class="archive-browser-actions">${heading}<nav id="archive-breadcrumb" aria-label="包内路径"></nav><div class="archive-browser-search"><input id="archive-search" type="search" maxlength="1024" placeholder="搜索包内文件" aria-label="搜索包内文件名"><button id="archive-search-run" type="button" class="icon-button quiet" aria-label="搜索包内文件">${icon('search')}</button></div><button id="archive-list-head" type="button" class="icon-button quiet" aria-label="更多压缩包操作" title="更多" aria-expanded="false" aria-haspopup="dialog" popovertarget="archive-more-menu" hidden>${icon('ellipsis')}</button><div id="archive-more-menu" class="archive-more-menu" popover="auto" role="dialog" aria-label="压缩包操作">${editor}${actions}<label class="archive-flat"><input id="archive-flat" type="checkbox" aria-label="显示全部文件"><span>显示全部文件</span></label></div></div>${draft}<div id="archive-browser" class="archive-browser" hidden>
 <div class="archive-browser-content"><nav id="archive-tree" aria-label="包内目录"></nav><div class="archive-file-table"><div class="archive-table-heading" aria-hidden="true"><span></span><span></span><span>名称</span><span>状态</span><span>大小</span><span></span></div><div id="archive-list" class="archive-list"><div class="archive-empty">选择压缩包后查看其中的内容</div></div></div></div>
 <div class="archive-browser-footer"><span id="archive-browser-summary" aria-live="polite"></span><button id="archive-selection-clear" type="button" class="quiet">清除选择</button><div><button id="archive-previous" type="button" hidden>上一页</button><button id="archive-more" type="button" hidden>下一页</button></div></div>
 </div><div id="archive-browser-empty" class="archive-empty">选择压缩包后查看其中的内容</div>`;}

const folderPath=(name:string)=>name.replaceAll('\\','/').replace(/\/?$/,'/');
const entryKey=(entry:ArchiveEntry)=>entry.implicit?'folder:'+folderPath(entry.name):'index:'+entry.index;
const bytes=(value:number)=>value<1024?`${value} B`:value<1024**2?`${(value/1024).toLocaleString(undefined,{maximumFractionDigits:1})} KB`:`${(value/1024**2).toLocaleString(undefined,{maximumFractionDigits:1})} MB`;

export function setupArchiveBrowser(root:HTMLElement,options:{navigate:(offset:number)=>void;status:(message:string)=>void;selectionChanged?:(count:number)=>void;details?:(entry:ArchiveEntry)=>void}){
 const find=<T extends HTMLElement=HTMLElement>(selector:string)=>root.querySelector<T>(selector)!;
 const menu=find('#archive-more-menu'),more=find('#archive-list-head');
 const positionMenu=()=>{const box=more.getBoundingClientRect();menu.style.left=Math.max(8,Math.min(box.right-menu.offsetWidth,innerWidth-menu.offsetWidth-8))+'px';menu.style.top=Math.max(8,Math.min(box.bottom+6,innerHeight-menu.offsetHeight-8))+'px';};
 menu.addEventListener('toggle',()=>{const open=menu.matches(':popover-open');more.setAttribute('aria-expanded',String(open));if(open)positionMenu();});
 menu.addEventListener('click',event=>{if((event.target as Element).closest('button:not(:disabled)')&&menu.matches(':popover-open'))menu.hidePopover();},true);
 menu.addEventListener('keydown',event=>{if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;event.preventDefault();const items=[...menu.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)')].filter(node=>node.getClientRects().length>0),current=items.indexOf(document.activeElement as HTMLElement);if(items.length)items[event.key==='Home'?0:event.key==='End'?items.length-1:(current+(event.key==='ArrowDown'?1:-1)+items.length)%items.length].focus();});
 more.addEventListener('keydown',event=>{if(event.key==='ArrowDown'){event.preventDefault();menu.showPopover();menu.querySelector<HTMLElement>('button:not(:disabled),input:not(:disabled)')?.focus();}});
 window.addEventListener('resize',()=>{if(menu.matches(':popover-open'))menu.hidePopover();});
 let query:ArchiveBrowse={directory:'',search:'',flat:false},listing:ArchiveListing|undefined,busy=false;
 const selected=new Map<string,ArchiveEntry>(),folderPages=new Map<string,string[]>();
 const summary=()=>{if(!listing)return;const matched=listing.matched??listing.total;
  find('#archive-browser-summary').textContent=`${matched?`${listing.offset+1}–${listing.offset+listing.entries.length} / ${matched.toLocaleString()}`:'没有匹配的项目'} · 已选择 ${selected.size} 项`;
  find('#archive-selection-clear').hidden=!selected.size;
  options.selectionChanged?.(selected.size);
 };
 const syncChecks=()=>{for(const input of root.querySelectorAll<HTMLInputElement>('.archive-entry input'))input.checked=selected.has(input.dataset.archiveKey!);summary();};
 const nav=(directory:string)=>{if(busy)return;query={...query,directory:directory?folderPath(directory):'',search:''};find<HTMLInputElement>('#archive-search').value='';options.navigate(0);};
 const controls=()=>{
  find<HTMLButtonElement>('#archive-previous').hidden=!listing||listing.offset===0;
  find<HTMLButtonElement>('#archive-more').hidden=!listing||listing.offset+listing.entries.length>=(listing.matched??listing.total);
  for(const control of root.querySelectorAll<HTMLInputElement|HTMLButtonElement>('#archive-browser input,#archive-browser button,.archive-browser-actions input,.archive-browser-actions button'))if(!control.closest('#archive-editor'))control.disabled=busy;
 };
 const navigation=()=>{
  const parts=query.directory.split('/').filter(Boolean),ancestors=[{name:'压缩包',path:''},...parts.map((name,i)=>({name,path:parts.slice(0,i+1).join('/')+'/'}))];
  find('#archive-breadcrumb').classList.toggle('at-root',!parts.length);
  find('#archive-breadcrumb').innerHTML=ancestors.map((item,i)=>`${i?'<span aria-hidden="true">/</span>':''}<button type="button" class="quiet" data-archive-directory="${esc(item.path)}"${i===ancestors.length-1?' aria-current="location"':''}>${esc(item.name)}</button>`).join('');
  const folders=folderPages.get(query.directory)||[];
  find('#archive-tree').innerHTML=ancestors.map((item,i)=>`<button type="button" class="quiet${i===ancestors.length-1?' selected':''}" data-archive-directory="${esc(item.path)}" style="--depth:${Math.min(i,8)}">${icon('folder')}<span title="${esc(item.path)}">${esc(item.name)}</span></button>`).join('')+folders.map(path=>`<button type="button" class="quiet" data-archive-directory="${esc(path)}" style="--depth:${Math.min(parts.length+1,8)}">${icon('folder')}<span title="${esc(path)}">${esc(path.slice(query.directory.length).replace(/\/$/,''))}</span></button>`).join('');
  find<HTMLInputElement>('#archive-flat').checked=query.flat;
 };
 find('#archive-list').onchange=event=>{const input=(event.target as Element).closest<HTMLInputElement>('.archive-entry input');if(!input||busy||!listing)return;
  const entry=listing.entries.find(entry=>entryKey(entry)===input.dataset.archiveKey);if(!entry)return;
  if(input.checked){if(selected.size>=10000){input.checked=false;options.status('最多选择 10000 项；较多内容请直接选择文件夹');return;}selected.set(entryKey(entry),entry);}else selected.delete(entryKey(entry));summary();
 };
 root.addEventListener('click',event=>{const button=(event.target as Element).closest<HTMLButtonElement>('[data-archive-directory]');if(button&&root.contains(button))nav(button.dataset.archiveDirectory!);});
 find('#archive-list').addEventListener('click',event=>{const button=(event.target as Element).closest<HTMLButtonElement>('[data-archive-details]');if(!button||busy||!listing)return;const entry=listing.entries.find(entry=>entryKey(entry)===button.dataset.archiveDetails);if(entry)options.details?.(entry);});
 const search=()=>{if(!busy){query={...query,search:find<HTMLInputElement>('#archive-search').value.trim()};options.navigate(0);}};
 find('#archive-search-run').onclick=search;find<HTMLInputElement>('#archive-search').onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();search();}};
 find<HTMLInputElement>('#archive-search').addEventListener('search',()=>{if(!find<HTMLInputElement>('#archive-search').value)search();});
 find<HTMLInputElement>('#archive-flat').onchange=()=>{query={...query,flat:find<HTMLInputElement>('#archive-flat').checked};options.navigate(0);};
 find('#archive-more').onclick=()=>{if(listing&&!busy)options.navigate(listing.offset+200);};
 find('#archive-previous').onclick=()=>{if(listing&&!busy)options.navigate(Math.max(0,listing.offset-200));};
 find('#archive-selection-clear').onclick=()=>{if(!busy){selected.clear();syncChecks();}};
 return {
  query:()=>({...query}),entries:()=>[...selected.values()],
  selection:()=>({selected:[...selected.values()].filter(entry=>!entry.implicit).map(entry=>entry.index),selectedFolders:[...selected.values()].filter(entry=>entry.implicit).map(entry=>folderPath(entry.name))}),
  setBusy(value:boolean){busy=value;if(value&&menu.matches(':popover-open'))menu.hidePopover();controls();},
  clear(message='选择压缩包后查看其中的内容'){listing=undefined;query={directory:'',search:'',flat:false};selected.clear();options.selectionChanged?.(0);folderPages.clear();find('#archive-browser').hidden=true;find('#archive-list').replaceChildren();find('#archive-tree').replaceChildren();find('#archive-breadcrumb').replaceChildren();find('#archive-browser-summary').textContent='';find('#archive-browser-empty').hidden=false;find('#archive-browser-empty').textContent=message;find<HTMLInputElement>('#archive-search').value='';controls();},
  loading(){if(!listing)find('#archive-browser-empty').hidden=false;},
  loaded(value:ArchiveListing){listing=value;query=value.browse??query;find('#archive-browser').hidden=false;find('#archive-browser-empty').hidden=true;
   if(!query.search&&!query.flat){folderPages.delete(query.directory);folderPages.set(query.directory,value.entries.filter(entry=>entry.directory).map(entry=>folderPath(entry.name)));while(folderPages.size>5)folderPages.delete(folderPages.keys().next().value!);}
   navigation();find('#archive-list').innerHTML=value.entries.length?value.entries.map(entry=>{
    const path=entry.name.replaceAll('\\','/'),name=query.search||query.flat?path:path.slice(query.directory.length).replace(/\/$/,'');
    return `<div class="archive-entry" draggable="true" data-archive-key="${esc(entryKey(entry))}"><input type="checkbox" aria-label="选择 ${esc(entry.name)}" data-archive-key="${esc(entryKey(entry))}" value="${entry.index}"${selected.has(entryKey(entry))?' checked':''}><span class="archive-entry-icon">${icon(entry.directory?'folder':'file')}</span>${entry.directory?`<button class="archive-entry-name quiet" type="button" data-archive-directory="${esc(folderPath(entry.name))}" title="${esc(entry.name)}">${esc(name)}</button>`:`<span class="archive-entry-name" title="${esc(entry.name)}">${esc(name)}</span>`}<span>${entry.encrypted?'已加密':''}</span><span>${entry.directory?'文件夹':entry.sizeKnown===false?'未知大小':bytes(entry.size)}</span><button type="button" class="icon-button quiet archive-entry-details-button" data-archive-details="${esc(entryKey(entry))}" aria-label="查看 ${esc(entry.name)} 的文件信息" title="文件信息">${icon('info')}</button></div>`;
   }).join(''):'<div class="archive-empty">'+(query.search?'没有匹配的项目':'此目录为空')+'</div>';summary();controls();
  },
  selectDrag(input:HTMLInputElement){if(!listing)return false;const entry=listing.entries.find(entry=>entryKey(entry)===input.dataset.archiveKey);if(!entry)return false;
   if(!selected.has(entryKey(entry))){selected.clear();selected.set(entryKey(entry),entry);}syncChecks();return true;
  },
 };
}
