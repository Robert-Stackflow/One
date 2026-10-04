import {closeControls,openControl,releaseControl} from './controls';
import {icon} from './ui';
import {positionAnchoredPopover,trackAnchoredPopover} from './anchored-popover';

/** Reuse the file lock form in a small, dismissible path entry beside the header. */
export function setupLockPathPopover(actions:HTMLElement,entry:HTMLElement){
 const anchor=document.createElement('button');anchor.id='lock-enter-path';anchor.className='icon-button quiet';anchor.type='button';anchor.title='输入路径';anchor.setAttribute('aria-label','输入路径');anchor.setAttribute('aria-haspopup','dialog');anchor.setAttribute('aria-expanded','false');anchor.setAttribute('aria-controls','lock-path-popover');anchor.innerHTML=icon('keyboard');actions.append(anchor);
 const popup=document.createElement('div');popup.id='lock-path-popover';popup.className='lock-path-popover';popup.popover='auto';popup.setAttribute('role','dialog');popup.setAttribute('aria-label','输入路径');popup.append(entry);document.body.append(popup);
 const input=entry.querySelector<HTMLInputElement>('input')!,add=entry.querySelector<HTMLButtonElement>('#lock-add')!;add.textContent='添加';add.classList.add('primary');
 let stopTracking=()=>{};
 const close=()=>{stopTracking();stopTracking=()=>{};if(popup.matches(':popover-open'))popup.hidePopover();anchor.setAttribute('aria-expanded','false');releaseControl(close);};
 anchor.onclick=()=>{
  if(popup.matches(':popover-open')){close();return;}closeControls();openControl(close);popup.showPopover();anchor.setAttribute('aria-expanded','true');
  const placement={preferred:'below' as const,gap:10};
  if(!positionAnchoredPopover(anchor,popup,placement)){close();return;}
  stopTracking=trackAnchoredPopover(anchor,popup,placement,close);input.focus();
 };
 add.addEventListener('click',()=>{if(input.value.trim()){close();anchor.focus();}});
 popup.onkeydown=event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();anchor.focus();}};
 popup.addEventListener('toggle',event=>{if((event as ToggleEvent).newState==='closed')close();});
}
