import {q,icon,esc,toast} from './ui';
import {hydrateFileIcons} from './shell-icons';
import {confirmPopover} from './confirm-popover';
import {menuIconPath} from '../shared/menu-icons';
import {barItem,barOrder,placeInBar,reorderBar,materializeBar,removeBarKey,type MenuLayout} from '../shared/menu-layout';
import type {MenuBarPosition} from '../shared/search';
export const menuPreviewMarkup=()=>`<div class="menu-preview-canvas"><div class="menu-preview-heading"><span class="section-label">菜单预览</span></div><div class="menu-preview-surface shortcut-menu"><div id="menu-bar-top" class="menu-action-bar" data-position="top" role="toolbar" aria-label="顶部快捷操作栏预览"></div><div id="menu-editor-list" role="tree" aria-label="快捷菜单层级"></div><div id="menu-bar-bottom" class="menu-action-bar" data-position="bottom" role="toolbar" aria-label="底部快捷操作栏预览"></div></div></div>`;
export function setupMenuBarEditor(options:{get:()=>MenuLayout;change:(mutate:(layout:MenuLayout)=>MenuLayout)=>Promise<void>;dragged:()=>string;setDragged:(key:string)=>void;finish:()=>void;edit:(id:string)=>void;selected:()=>string;remove:(id:string,anchor:HTMLElement)=>void}){
 const change=async(mutate:(layout:MenuLayout)=>MenuLayout)=>{try{await options.change(mutate);return true;}catch(error){toast(error);return false;}};
 const positions:MenuBarPosition[]=['top','bottom'];
 const clear=()=>{for(const position of positions){const footer=q('menu-bar-'+position);footer.classList.remove('drop-active','drop-full');delete footer.dataset.dropBefore;delete footer.dataset.dropAlign;footer.style.removeProperty('--bar-drop-x');}};
 // Let Chromium capture the drag source before revealing empty drop areas.
 const reveal=()=>requestAnimationFrame(()=>{if(options.dragged())document.querySelector('.menu-preview-surface')!.classList.add('bar-dragging');});
 const remove=(key:string,anchor:HTMLElement)=>{const item=barItem(options.get().menu,key,'');if(key.startsWith('item:'))options.remove(key.slice(5),anchor);else confirmPopover(anchor,'删除“'+(item?.label||'此按钮')+'”？','',()=>void change(layout=>({...layout,menuBar:removeBarKey(layout.menuBar,key)})));};
 const draw=()=>{
  const {menu,menuBar}=options.get();document.querySelector('.menu-preview-surface')!.classList.remove('bar-dragging');
  for(const position of positions){const section=menuBar[position],footer=q('menu-bar-'+position);
  let rightStarted=false;
  footer.innerHTML=barOrder(section).map(key=>{
   const item=barItem(menu,key,'');if(!item)return '';const separator=item.kind==='separator',label=separator?'分隔线':item.label,path=menuIconPath(item),selected=key==='item:'+options.selected(),right=section.right.includes(key),start=right&&!rightStarted;rightStarted ||= right;
   return `<button type="button" class="icon-button quiet ${separator?'bar-separator-editor':''} ${selected?'selected':''} ${item.enabled?'':'disabled'} ${start?'bar-right-start':''}" data-align="${right?'right':'left'}" data-bar-key="${esc(key)}" draggable="true" aria-label="${esc(label)}" aria-pressed="${selected}" title="${esc(label)}">${separator?'<span class="bar-divider" aria-hidden="true"></span>':path?`<span class="menu-file-icon" data-file-icon="${esc(path)}">${icon(item.icon)}</span>`:icon(item.icon)}</button>`;
  }).join('');hydrateFileIcons(footer);
  footer.querySelectorAll<HTMLButtonElement>('[data-bar-key]').forEach(button=>{
   const key=button.dataset.barKey!;
   button.onclick=()=>{if(key.startsWith('item:'))options.edit(key.slice(5));else{const id=crypto.randomUUID();void change(layout=>materializeBar(layout,key,id)).then(saved=>{if(saved)options.edit(id);});}};
   button.oncontextmenu=e=>{e.preventDefault();remove(key,button);};
   button.onkeydown=e=>{if(e.key==='Delete'){e.preventDefault();remove(key,button);}if(e.altKey&&['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();void change(layout=>{const keys=barOrder(layout.menuBar[position]),at=keys.indexOf(key),to=at+(e.key==='ArrowLeft'?-1:1);if(to<0||to>=keys.length)return layout;return reorderBar(layout,key,position,e.key==='ArrowLeft'?keys[to]:keys[to+1],layout.menuBar[position].right.includes(key)?'right':'left');});}};
   button.ondragstart=e=>{options.setDragged('bar:'+key);reveal();button.classList.add('dragging');e.dataTransfer!.setData('text/plain','bar:'+key);e.dataTransfer!.effectAllowed='move';e.stopPropagation();};
   button.ondragend=()=>{clear();options.finish();};
  });
  footer.ondragover=e=>{
   const source=options.dragged();if(!source)return;e.preventDefault();e.stopPropagation();
   const layout=options.get(),key=source.startsWith('bar:')?source.slice(4):'item:'+source,full=!layout.menuBar[position].actions.includes(key)&&layout.menuBar[position].actions.length>=7;
   if(full){clear();footer.classList.add('drop-full');e.dataTransfer!.dropEffect='none';return;}
   clear();
   footer.classList.add('drop-active');footer.classList.remove('drop-full');e.dataTransfer!.dropEffect='move';
   const box=footer.getBoundingClientRect(),align=e.clientX>=box.left+box.width/2?'right':'left';
   const buttons=[...footer.querySelectorAll<HTMLElement>('[data-bar-key]')].filter(button=>button.dataset.align===align&&'bar:'+button.dataset.barKey!==source);
   const target=buttons.find(button=>e.clientX<button.getBoundingClientRect().left+button.getBoundingClientRect().width/2);
   footer.dataset.dropAlign=align;footer.dataset.dropBefore=target?.dataset.barKey||'';
   const edge=target?.getBoundingClientRect().left||buttons.at(-1)?.getBoundingClientRect().right||(align==='right'?box.right-10:box.left+10);
   footer.style.setProperty('--bar-drop-x',(edge-box.left-2)+'px');
  };
  footer.ondragleave=e=>{if(!footer.contains(e.relatedTarget as Node))clear();};
  footer.ondrop=e=>{
   e.preventDefault();e.stopPropagation();const source=options.dragged(),before=footer.dataset.dropBefore,align=footer.dataset.dropAlign as 'left'|'right',blocked=footer.classList.contains('drop-full');clear();options.setDragged('');
   if(!blocked&&source&&align)void change(layout=>source.startsWith('bar:')?reorderBar(layout,source.slice(4),position,before,align):placeInBar(layout,source,position,before,align));else options.finish();
  };
  }
 };
 return {draw,clear,reveal};
}
