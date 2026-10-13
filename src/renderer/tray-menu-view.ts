import {api,esc,icon} from './ui';
import {trayMenuGroupLabels,type TrayMenuAction,type TrayMenuView} from '../main/tray-menu';
import markURL from '../../assets/icons/one.svg?url';
import './tray-menu.css';

export async function renderTrayMenu(){
 const initial=await api.trayMenuState(),submenu=!!initial.submenu;
 document.body.classList.add('tray-menu-window');document.body.classList.toggle('tray-submenu-window',submenu);
 document.querySelector('#app')!.innerHTML=`<div class="tray-menu-card"><header class="tray-menu-heading">${submenu?'<strong>更多操作</strong>':`<div class="tray-brand-mark"><img src="${markURL}" alt="" width="37" height="37"></div><div class="tray-heading-copy"><strong>One</strong><span id="tray-menu-status"></span></div><button id="tray-menu-pause" class="tray-header-action" type="button" data-action="pause"></button>`}</header><main id="tray-menu-items" role="menu" aria-label="${submenu?'更多操作':'One 托盘菜单'}"></main><p id="tray-menu-notice" role="alert" hidden></p></div>`;
 const root=document.querySelector<HTMLElement>('#tray-menu-items')!,status=document.querySelector<HTMLElement>('#tray-menu-status'),notice=document.querySelector<HTMLElement>('#tray-menu-notice')!;
 const render=(view:TrayMenuView)=>{
  if(status)status.textContent=view.paused?'操作增强已暂停':'随时可用';
  const pause=document.querySelector<HTMLButtonElement>('#tray-menu-pause');if(pause&&view.headerAction){pause.title=view.headerAction.label;pause.ariaLabel=view.headerAction.label;pause.setAttribute('aria-pressed',String(view.paused));pause.innerHTML=icon(view.headerAction.icon);}
  const focused=document.activeElement instanceof HTMLElement?document.activeElement.dataset.action:undefined;
  let lastGroup='';root.replaceChildren();
  for(const item of view.entries){
   if(item.group!==lastGroup){const section=document.createElement('section');section.className='tray-menu-section';section.dataset.group=item.group;if(submenu){const heading=document.createElement('h2');heading.textContent=trayMenuGroupLabels[item.group];section.append(heading);}root.append(section);lastGroup=item.group;}
   const button=document.createElement('button');button.type='button';button.className='tray-menu-item';button.dataset.action=item.id;
   const checked=item.id==='pause'||item.id==='startup';button.setAttribute('role',checked?'menuitemcheckbox':'menuitem');if(checked)button.setAttribute('aria-checked',String(!!item.active));
   button.setAttribute('aria-label',item.label+(item.shortcut?`，${item.shortcut.key}${item.shortcut.active?'':'，快捷键不可用'}`:''));
   if(item.id==='more')button.setAttribute('aria-haspopup','menu');if(item.tone)button.dataset.tone=item.tone;if(item.active)button.dataset.active='true';
   const key=item.shortcut,help=key?(key.active?key.key:`${key.key} · ${key.error||'快捷键不可用'}`):item.label;if(key&&!key.active)button.title=help;
   button.innerHTML=`${icon(item.icon)}<span class="tray-menu-label">${esc(item.label)}</span>${key?`<span class="tray-menu-shortcut${key.active?'':' is-inactive'}">${esc(key.key)}</span>`:''}${item.id==='more'?icon('chevron'):item.active?icon('check'):''}`;root.lastElementChild!.append(button);
  }
  if(focused&&document.hasFocus())root.querySelector<HTMLButtonElement>(`[data-action="${focused}"]`)?.focus();
 };
 const update=()=>void api.trayMenuState().then(render).catch(()=>{});
 const act=(button:HTMLButtonElement)=>{
  clearTimeout(hoverTimer);if(button.disabled)return;button.disabled=true;notice.hidden=true;
  const action=button.dataset.action as TrayMenuAction;
  void api.trayMenuAction(action,action==='more'?button.getBoundingClientRect().top:undefined).then(()=>{button.disabled=false;if(action!=='more')update();},error=>{button.disabled=false;notice.textContent=String(error).replace(/^Error: /,'');notice.hidden=false;});
 };
 document.addEventListener('click',event=>{const button=event.target instanceof Element?event.target.closest<HTMLButtonElement>('[data-action]'):null;if(button)act(button);});
 let hoverTimer:ReturnType<typeof setTimeout>|undefined,hoveredAction:string|undefined,lastPointer='';
 window.addEventListener('blur',()=>clearTimeout(hoverTimer));
 window.addEventListener('focus',()=>{hoveredAction=undefined;lastPointer='';});
 if(!submenu){
  root.addEventListener('pointermove',event=>{
   const button=(event.target as Element).closest<HTMLButtonElement>('[data-action]'),point=event.screenX+','+event.screenY;if(!button||point===lastPointer)return;lastPointer=point;if(hoveredAction===button.dataset.action)return;hoveredAction=button.dataset.action;
   clearTimeout(hoverTimer);
   if(button.dataset.action==='more')hoverTimer=setTimeout(()=>act(button),120);
   else hoverTimer=setTimeout(()=>void api.trayMenuMoreClose().catch(()=>{}),200);
  });
  root.addEventListener('pointerleave',()=>{hoveredAction=undefined;lastPointer='';clearTimeout(hoverTimer);});
 }
 document.addEventListener('keydown',event=>{
  if(event.key==='Escape'||submenu&&event.key==='ArrowLeft'){event.preventDefault();clearTimeout(hoverTimer);void api.trayMenuHide();return;}
  if(event.key==='ArrowRight')hoveredAction=undefined;
  if(event.key==='ArrowRight'&&!submenu&&document.activeElement instanceof HTMLButtonElement&&document.activeElement.dataset.action==='more'){event.preventDefault();act(document.activeElement);return;}
  if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
  event.preventDefault();const items=Array.from(root.querySelectorAll<HTMLButtonElement>('.tray-menu-item'));if(!items.length)return;
  const index=items.indexOf(document.activeElement as HTMLButtonElement),next=event.key==='Home'?0:event.key==='End'?items.length-1:event.key==='ArrowDown'?(index+1)%items.length:(index+items.length-1)%items.length;items[next].focus();
 });
 document.addEventListener('contextmenu',event=>event.preventDefault());
 api.onTrayMenuChanged(update);render(initial);await api.trayMenuReady();
}
