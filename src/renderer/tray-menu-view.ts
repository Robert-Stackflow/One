import {api,esc,icon} from './ui';
import type {TrayMenuAction,TrayMenuView} from '../main/tray-menu';
import './tray-menu.css';

const mark='<svg viewBox="0 0 256 256" aria-hidden="true"><rect x="16" y="16" width="224" height="224" rx="56" fill="#252c29"/><path d="M180 77C168 60 151 52 128 52C86 52 60 81 60 124V132C60 175 86 204 128 204C150 204 167 197 180 184L158 162C151 169 141 173 128 173C105 173 93 157 93 132V124C93 99 105 83 128 83C140 83 150 87 157 96Z" fill="#f4f5ef"/><path d="M166 101L185 88C191 84 198 88 198 95V170C198 180 192 186 182 186C172 186 166 180 166 170V120L162 116C157 111 159 106 166 101Z" fill="#b3cbb8" stroke="#252c29" stroke-width="8" stroke-linejoin="round"/></svg>';

export async function renderTrayMenu(){
 document.body.classList.add('tray-menu-window');
 document.querySelector('#app')!.innerHTML=`<div class="tray-menu-card"><header class="tray-menu-heading"><div class="tray-brand-mark">${mark}</div><div class="tray-heading-copy"><strong>One</strong><span id="tray-menu-status"></span></div><button id="tray-menu-pause" class="tray-header-action" type="button" data-action="pause" aria-label="暂停操作增强"></button></header><main id="tray-menu-items" role="menu" aria-label="One 托盘菜单"></main><p id="tray-menu-notice" role="alert" hidden></p></div>`;
 const root=document.querySelector<HTMLElement>('#tray-menu-items')!,status=document.querySelector<HTMLElement>('#tray-menu-status')!,pause=document.querySelector<HTMLButtonElement>('#tray-menu-pause')!,notice=document.querySelector<HTMLElement>('#tray-menu-notice')!;
 const render=(view:TrayMenuView)=>{
  status.textContent=view.paused?'操作增强已暂停':'随时可用';
  const pauseItem=view.entries.find(item=>item.id==='pause')!;pause.title=pauseItem.label;pause.setAttribute('aria-label',pauseItem.label);pause.setAttribute('aria-pressed',String(view.paused));pause.innerHTML=icon(pauseItem.icon);
  let lastGroup='';root.replaceChildren();
  for(const item of view.entries){if(item.id==='pause')continue;
   if(item.group!==lastGroup){const section=document.createElement('section');section.className='tray-menu-section';section.dataset.group=item.group;root.append(section);lastGroup=item.group;}
   const button=document.createElement('button');button.type='button';button.className='tray-menu-item';button.dataset.action=item.id;button.setAttribute('role','menuitem');button.setAttribute('aria-label',item.label);if(item.tone)button.dataset.tone=item.tone;if(item.active)button.dataset.active='true';button.innerHTML=`${icon(item.icon)}<span>${esc(item.label)}</span>${item.active?icon('check'):''}`;root.lastElementChild!.append(button);
  }
 };
 const update=()=>void api.trayMenuState().then(render).catch(()=>{});
 document.addEventListener('click',event=>{
  const button=event.target instanceof Element?event.target.closest<HTMLButtonElement>('[data-action]'):null;
  if(!button||button.disabled)return;button.disabled=true;notice.hidden=true;
  void api.trayMenuAction(button.dataset.action as TrayMenuAction).then(()=>{button.disabled=false;update();},error=>{button.disabled=false;notice.textContent=String(error).replace(/^Error: /,'');notice.hidden=false;});
 });
 document.addEventListener('keydown',event=>{
  if(event.key==='Escape'){event.preventDefault();void api.trayMenuHide();return;}
  if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
  event.preventDefault();const items=Array.from(root.querySelectorAll<HTMLButtonElement>('.tray-menu-item'));if(!items.length)return;
  const index=items.indexOf(document.activeElement as HTMLButtonElement),next=event.key==='Home'?0:event.key==='End'?items.length-1:event.key==='ArrowDown'?(index+1)%items.length:(index+items.length-1)%items.length;items[next].focus();
 });
 document.addEventListener('contextmenu',event=>event.preventDefault());
 api.onTrayMenuChanged(update);render(await api.trayMenuState());await api.trayMenuReady();
}
