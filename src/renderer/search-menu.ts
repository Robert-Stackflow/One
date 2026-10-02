import {api,q,icon,esc,toast} from './ui';
import {loadMenuIcons} from './icon-picker';
import {hydrateFileIcons} from './shell-icons';
import {subscribeSnapshot} from './event-snapshot';
import type {MenuNode,MenuBar} from '../shared/search';
export async function renderSearchMenu(){
 const depth=Number(new URLSearchParams(location.search).get('depth')||0);
 document.body.classList.add('shortcut-menu-window');
 const barMarkup=(position:string)=>`<div class="menu-action-bar" data-position="${position}" role="toolbar" aria-label="${position==='top'?'顶部':'底部'}快捷操作栏" hidden></div>`;
 q('app').innerHTML=`<div class="shortcut-menu">${depth?'':barMarkup('top')}<div id="menu-levels"><div class="menu-level" role="menu"></div></div>${depth?'':barMarkup('bottom')}</div><div id="toast" class="toast" role="status" hidden></div>`;
 let items:MenuNode[]=[],bar:MenuBar={top:[],bottom:[]},selected=-1,hover:ReturnType<typeof setTimeout>,source='';
 const glyph=(item:MenuNode)=>item.path?`<span class="menu-file-icon" data-file-icon="${esc(item.path)}">${icon(item.icon)}</span>`:icon(item.icon);
 const resize=()=>{const level=q('menu-levels').firstElementChild as HTMLElement;if(!level.firstElementChild)return;const style=getComputedStyle(level),content=level.firstElementChild.getBoundingClientRect().height,barHeight=[...document.querySelectorAll('.menu-action-bar')].reduce((sum,bar)=>sum+bar.getBoundingClientRect().height,0);void api.menuSize({width:286,height:Math.max(40,Math.min(620,Math.ceil(content+parseFloat(style.paddingTop)+parseFloat(style.paddingBottom)+2+barHeight)))});};
 const select=()=>q('menu-levels').querySelectorAll<HTMLElement>('[data-menu-index]').forEach(b=>b.classList.toggle('selected',Number(b.dataset.menuIndex)===selected));
 const expandNode=(item:MenuNode,row:HTMLElement,focus=false)=>{if(!item.children&&!item.expandable)return;if(source===item.id&&!focus)return;source=item.id;const r=row.getBoundingClientRect();void api.menuOpen(item.id,{top:r.top,right:innerWidth,focus}).catch(toast);};
 const expand=(index:number,focus=false)=>{const item=items[index],row=q('menu-levels').querySelector<HTMLElement>(`[data-menu-index="${index}"]`);if(item&&row)expandNode(item,row,focus);};
 const execute=(index:number)=>{const item=items[index];if(!item)return;if(item.kind==='group'||item.kind==='builtin'&&item.expandable)expand(index,true);else void api.menuExecute(item.id).catch(toast);};
 const drawBar=()=>{if(depth)return;for(const position of ['top','bottom'] as const){const footer=document.querySelector<HTMLElement>(`.menu-action-bar[data-position=${position}]`)!,nodes=bar[position];footer.hidden=!nodes.length;footer.innerHTML=nodes.map((item,index)=>{const start=item.align==='right'&&nodes[index-1]?.align!=='right',className=start?'bar-right-start':'';return item.kind==='separator'?`<span class="bar-separator ${className}" role="separator" aria-orientation="vertical" data-align="${item.align||'left'}"><span class="bar-divider"></span></span>`:`<button type="button" ${item.kind==='favorite'?'id="menu-favorite"':item.key==='builtin:settings'?'id="menu-options"':''} class="icon-button quiet ${className}" data-align="${item.align||'left'}" data-bar-index="${index}" aria-label="${esc(item.label)}" title="${esc(item.label)}" data-tooltip-side="${position==='top'?'bottom':'top'}" ${item.children||item.expandable?'aria-haspopup="menu"':''}>${glyph(item)}</button>`;}).join('');
  hydrateFileIcons(footer);footer.querySelectorAll<HTMLButtonElement>('[data-bar-index]').forEach(button=>{const item=nodes[Number(button.dataset.barIndex)];button.onmouseenter=()=>{clearTimeout(hover);hover=setTimeout(()=>{if(item.children||item.expandable)expandNode(item,button);else{source='';void api.menuOpen(null);}},140);};button.onclick=()=>{clearTimeout(hover);if(item.kind==='favorite')void api.menuFavorite().then(()=>toast('已收藏')).catch(toast);else if(item.children||item.expandable)expandNode(item,button,true);else void api.menuExecute(item.id).catch(toast);};});}resize();
 };
 const draw=()=>{const level=q('menu-levels').firstElementChild as HTMLElement;level.innerHTML='<div class="menu-items">'+(items.map((item,i)=>item.kind==='separator'?'<hr role="separator">':`<button role="menuitem" data-menu-index="${i}" class="shortcut-item ${i===selected?'selected':''}" ${item.children||item.expandable?'aria-haspopup="menu"':''}>${glyph(item)}<span>${esc(item.label)}</span>${item.children||item.expandable?icon('chevron'):''}</button>`).join('')||'<p class="menu-empty">此分组为空</p>')+'</div>';
  resize();hydrateFileIcons(level);
  q('menu-levels').querySelectorAll<HTMLButtonElement>('[data-menu-index]').forEach(b=>{const index=Number(b.dataset.menuIndex);b.onmouseenter=()=>{clearTimeout(hover);selected=index;select();hover=setTimeout(()=>{const item=items[index];if(item.children||item.expandable)expand(index);else {source='';void api.menuOpen(null);}},140);};b.onclick=e=>{clearTimeout(hover);if(items[index].expandable&&(e.target as Element).closest('svg:last-child'))expand(index,true);else execute(index);};});
 };
 const reset=(next:MenuNode[])=>{clearTimeout(hover);source='';selected=-1;items=next;draw();const panel=q('menu-levels');panel.classList.remove('popup-enter');requestAnimationFrame(()=>panel.classList.add('popup-enter'));};
 await Promise.all([subscribeSnapshot(api.onMenuReset,api.searchMenu,reset),depth?Promise.resolve():subscribeSnapshot(api.onMenuBar,api.menuBar,next=>{bar=next;drawBar();})]);void loadMenuIcons().then(()=>{draw();drawBar();}).catch(()=>{});
 document.addEventListener('keydown',e=>{
  clearTimeout(hover);
  const barButton=(e.target as Element)?.closest<HTMLButtonElement>('[data-bar-index]');
  if(barButton&&['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const buttons=[...document.querySelectorAll<HTMLButtonElement>('[data-bar-index]')],at=buttons.indexOf(barButton),to=e.key==='Home'?0:e.key==='End'?buttons.length-1:Math.max(0,Math.min(buttons.length-1,at+(e.key==='ArrowLeft'?-1:1)));buttons[to]?.focus();return;}
  if(barButton&&['Enter',' '].includes(e.key))return;
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();const step=e.key==='ArrowDown'?1:-1;if(selected<0)selected=step===1?-1:0;for(let n=0;n<items.length;n++){selected=(selected+step+items.length)%items.length;if(items[selected].kind!=='separator')break;}select();q('menu-levels').querySelector('.selected')?.scrollIntoView({block:'nearest'});if(barButton)barButton.blur();}
  else if(e.key==='ArrowRight'){e.preventDefault();expand(selected,true);}
  else if((e.key==='ArrowLeft'||e.key==='Escape')&&depth){e.preventDefault();void api.menuBack();}
  else if(e.key==='Escape'){void api.closeWindow();}
  else if(e.key==='Enter'){e.preventDefault();execute(selected);}
 });
}
