import {api,q,icon,iconButton,esc,toast} from './ui';
import {loadMenuIcons} from './icon-picker';
import {hydrateFileIcons} from './shell-icons';
import {subscribeSnapshot} from './event-snapshot';
import type {MenuNode} from '../shared/search';
export async function renderSearchMenu(){
 const depth=Number(new URLSearchParams(location.search).get('depth')||0);
 document.body.classList.add('shortcut-menu-window');
 q('app').innerHTML=`<div class="shortcut-menu"><div id="menu-levels"><div class="menu-level" role="menu"></div></div>${depth?'':`<footer>${iconButton('menu-favorite','收藏当前文件夹','star')}<span class="spacer"></span>${iconButton('menu-options','自定义菜单','system')}</footer>`}</div><div id="toast" class="toast" hidden></div>`;
 let items:MenuNode[]=[],selected=-1,hover:ReturnType<typeof setTimeout>,source='';
 const select=()=>q('menu-levels').querySelectorAll<HTMLElement>('[data-menu-index]').forEach(b=>b.classList.toggle('selected',Number(b.dataset.menuIndex)===selected));
 const expand=(index:number,focus=false)=>{const item=items[index],row=q('menu-levels').querySelector<HTMLElement>(`[data-menu-index="${index}"]`);if(!item||!row||!item.children&&!item.expandable)return;if(source===item.id&&!focus)return;source=item.id;const r=row.getBoundingClientRect();void api.menuOpen(item.id,{top:r.top,right:innerWidth,focus}).catch(toast);};
 const execute=(index:number)=>{const item=items[index];if(!item)return;if(item.kind==='group'||item.kind==='builtin'&&item.expandable)expand(index,true);else void api.menuExecute(item.id).catch(toast);};
 const draw=()=>{const level=q('menu-levels').firstElementChild as HTMLElement;level.innerHTML='<div class="menu-items">'+(items.map((item,i)=>item.kind==='separator'?'<hr role="separator">':`<button role="menuitem" data-menu-index="${i}" class="shortcut-item ${i===selected?'selected':''}" ${item.children||item.expandable?'aria-haspopup="menu"':''}>${item.path?`<span class="menu-file-icon" data-file-icon="${esc(item.path)}">${icon(item.icon)}</span>`:icon(item.icon)}<span>${esc(item.label)}</span>${item.children||item.expandable?icon('chevron'):''}</button>`).join('')||'<p class="menu-empty">此分组为空</p>')+'</div>';
  const style=getComputedStyle(level),content=level.firstElementChild!.getBoundingClientRect().height;
  void api.menuSize({width:286,height:Math.max(40,Math.min(620,Math.ceil(content+parseFloat(style.paddingTop)+parseFloat(style.paddingBottom)+2+(depth?0:39))))});
  hydrateFileIcons(level);
  q('menu-levels').querySelectorAll<HTMLButtonElement>('[data-menu-index]').forEach(b=>{const index=Number(b.dataset.menuIndex);b.onmouseenter=()=>{clearTimeout(hover);selected=index;select();hover=setTimeout(()=>{const item=items[index];if(item.children||item.expandable)expand(index);else {source='';void api.menuOpen(null);}},140);};b.onclick=e=>{clearTimeout(hover);if(items[index].expandable&&(e.target as Element).closest('svg:last-child'))expand(index,true);else execute(index);};});
 };
 const reset=(next:MenuNode[])=>{clearTimeout(hover);source='';selected=-1;items=next;draw();const panel=q('menu-levels');panel.classList.remove('popup-enter');requestAnimationFrame(()=>panel.classList.add('popup-enter'));};
 await subscribeSnapshot(api.onMenuReset,api.searchMenu,reset);void loadMenuIcons().then(draw).catch(()=>{});
 document.addEventListener('keydown',e=>{clearTimeout(hover);if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();const step=e.key==='ArrowDown'?1:-1;if(selected<0)selected=step===1?-1:0;for(let n=0;n<items.length;n++){selected=(selected+step+items.length)%items.length;if(items[selected].kind!=='separator')break;}select();q('menu-levels').querySelector('.selected')?.scrollIntoView({block:'nearest'});}else if(e.key==='ArrowRight'){e.preventDefault();expand(selected,true);}else if((e.key==='ArrowLeft'||e.key==='Escape')&&depth){e.preventDefault();void api.menuBack();}else if(e.key==='Escape'){void api.closeWindow();}else if(e.key==='Enter'){e.preventDefault();execute(selected);}});
 if(!depth){q('menu-options').onclick=()=>void api.menuSettings();q('menu-favorite').onclick=()=>void api.menuFavorite().then(next=>{reset(next);toast('已收藏');}).catch(toast);}
}
