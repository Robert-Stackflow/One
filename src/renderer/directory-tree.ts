import {api,esc,icon} from './ui';
import {fileIcon} from './file-icons';
import {VirtualRows} from './virtual-rows';
import {DirectoryPages} from './directory-pages';
import type {DirectoryInfo} from '../shared/directory';
import {directoryRowCount as rowCount,directoryRowAt as at,directoryPositionOf as positionOf,invalidateDirectory,type DirectoryBranch as Branch,type DirectoryNode as Node,type DirectoryRow as Row} from '../shared/directory-tree';
import './directory-view.css';
export function renderDirectoryTree(host:HTMLElement,info:DirectoryInfo,select:(path:string)=>void){
 const root:Node={info,children:new Map()},view=document.createElement('div');view.className='file-tree directory-tree';view.innerHTML='<div class="directory-tree-toolbar">'+info.count.toLocaleString()+' 项</div><div class="directory-tree-scroll" role="tree" tabindex="0" aria-label="目录内容"></div>';host.append(view);
 const scroll=view.querySelector<HTMLElement>('.directory-tree-scroll')!;let selected=0,disposed=false,version=0,queue=Promise.resolve();
 const pages=new DirectoryPages(()=>rows.refresh(),error=>{if(!disposed){const message='目录读取失败：'+error.message;scroll.setAttribute('aria-label',message);view.querySelector('.directory-tree-toolbar')!.textContent=message;}});pages.add(info);
 const rows=new VirtualRows(scroll,()=>rowCount(root),(position,previous)=>{
  const value=at(root,position),entry=value.index>=0?pages.get(value.node.info,value.index):undefined,row=previous?.tagName===(value.note?'DIV':'BUTTON')?previous:document.createElement(value.note?'div':'button');row.className=value.note?'directory-note':'file-tree-row';row.style.setProperty('--directory-depth',String(value.depth));row.dataset.flat=String(position);row.setAttribute('role',value.note?'note':'treeitem');row.tabIndex=-1;
  if(value.note){row.textContent=value.note;delete row.dataset.path;delete row.dataset.tooltip;row.removeAttribute('title');row.removeAttribute('aria-expanded');row.removeAttribute('aria-level');row.removeAttribute('aria-selected');row.onclick=null;row.ondblclick=null;return row;}
  row.setAttribute('aria-level',String(value.depth+1));row.setAttribute('aria-selected',String(position===selected));
  if(!entry){row.innerHTML='<span class="directory-skeleton"></span>';delete row.dataset.path;delete row.dataset.tooltip;row.removeAttribute('title');row.removeAttribute('aria-expanded');row.onclick=null;row.ondblclick=null;return row;}
  const expanded=value.node.children.has(value.index),changed=row.dataset.path!==entry.path;
  if(changed){row.innerHTML=(entry.directory?icon('chevron').replace('class="icon ','class="icon tree-chevron '):'<span class="tree-spacer"></span>')+fileIcon(entry.name,entry.directory,expanded)+'<span>'+esc(entry.name)+'</span>';row.dataset.path=entry.path;row.dataset.tooltip=entry.name;row.removeAttribute('title');}
  if(entry.directory){row.setAttribute('aria-expanded',String(expanded));if(row.dataset.open!==String(expanded)){row.dataset.open=String(expanded);const holder=document.createElement('div');holder.innerHTML=fileIcon(entry.name,true,expanded);row.querySelector('.file-type-icon')?.replaceWith(holder.firstChild!);}}else {row.removeAttribute('aria-expanded');delete row.dataset.open;}
  row.onclick=()=>{version++;selected=position;scroll.focus({preventScroll:true});rows.refresh();if(entry.directory)void toggle(value);else select(entry.path);};row.ondblclick=entry.directory?()=>select(entry.path):null;return row;
 },36);
 function release(node:Node){for(const branch of node.children.values())if(branch.node){release(branch.node);pages.forget(branch.node.info.id);void api.directoryRelease(branch.node.info.id).catch(()=>{});}node.children.clear();invalidateDirectory(node);}
 async function toggle(value:Row){const previous=value.node.children.get(value.index);if(previous){value.node.children.delete(value.index);invalidateDirectory(value.node);if(previous.node){release(previous.node);pages.forget(previous.node.info.id);void api.directoryRelease(previous.node.info.id).catch(()=>{});}rows.refresh();return;}
  const branch:Branch={};value.node.children.set(value.index,branch);invalidateDirectory(value.node);rows.refresh();
  try{const page=await pages.read(value.node.info,Math.floor(value.index/128)*128),entry=page.entries[value.index-page.offset];if(disposed||value.node.children.get(value.index)!==branch)return;if(!entry?.directory){value.node.children.delete(value.index);invalidateDirectory(value.node);rows.refresh();return;}const child=await api.directoryOpen(entry.path);if(disposed||value.node.children.get(value.index)!==branch){void api.directoryRelease(child.id).catch(()=>{});return;}branch.node={info:child,children:new Map(),parent:value.node,parentIndex:value.index};pages.add(child);}catch(error){if(!disposed&&value.node.children.get(value.index)===branch)branch.error=(error as Error).message;}invalidateDirectory(value.node);rows.refresh();
 }
 const key=(event:KeyboardEvent)=>{if(event.ctrlKey||event.metaKey||event.altKey||!['ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Home','End','PageDown','PageUp','Enter'].includes(event.key))return;event.preventDefault();event.stopPropagation();const requested=version,key=event.key;queue=queue.then(async()=>{if(disposed||requested!==version)return;const value=at(root,selected),count=rowCount(root),step=Math.max(1,Math.floor(scroll.clientHeight/36)-1);
   if(key==='ArrowLeft'){if(value.node.children.has(value.index))await toggle(value);else if(value.node.parent)selected=positionOf(value.node.parent,value.node.parentIndex!);}
   else if(key==='ArrowRight'||key==='Enter'){if(value.index>=0){const page=await pages.read(value.node.info,Math.floor(value.index/128)*128),entry=page.entries[value.index-page.offset];if(disposed||requested!==version)return;if(entry?.directory){if(!value.node.children.has(value.index))await toggle(value);else if(key==='ArrowRight')selected=Math.min(count-1,selected+1);}else if(entry&&key==='Enter')select(entry.path);}}
   else selected=key==='Home'?0:key==='End'?count-1:Math.max(0,Math.min(count-1,selected+(key==='ArrowDown'?1:key==='ArrowUp'?-1:key==='PageDown'?step:-step)));
   if(!disposed){rows.reveal(selected);rows.refresh();}
  }).catch(()=>{});};scroll.addEventListener('keydown',key);
 return()=>{disposed=true;version++;scroll.removeEventListener('keydown',key);release(root);rows.dispose();pages.dispose();view.remove();};
}
