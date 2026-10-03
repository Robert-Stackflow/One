import {closeControls,openControl,releaseControl} from './controls';
import {icon} from './ui';

/** Reuse the file lock form in a small, dismissible path entry beside the header. */
export function setupLockPathPopover(actions:HTMLElement,entry:HTMLElement){
 const anchor=document.createElement('button');anchor.id='lock-enter-path';anchor.className='icon-button quiet';anchor.type='button';anchor.title='输入路径';anchor.setAttribute('aria-label','输入路径');anchor.setAttribute('aria-haspopup','dialog');anchor.setAttribute('aria-expanded','false');anchor.setAttribute('aria-controls','lock-path-popover');anchor.innerHTML=icon('keyboard');actions.append(anchor);
 const popup=document.createElement('div');popup.id='lock-path-popover';popup.className='lock-path-popover';popup.popover='auto';popup.setAttribute('role','dialog');popup.setAttribute('aria-label','输入路径');popup.append(entry);document.body.append(popup);
 const input=entry.querySelector<HTMLInputElement>('input')!,add=entry.querySelector<HTMLButtonElement>('#lock-add')!;add.textContent='添加';add.classList.add('primary');
 const close=()=>{if(popup.matches(':popover-open'))popup.hidePopover();anchor.setAttribute('aria-expanded','false');releaseControl(close);};
 anchor.onclick=()=>{
  if(popup.matches(':popover-open')){close();return;}closeControls();openControl(close);popup.showPopover();anchor.setAttribute('aria-expanded','true');
  const box=anchor.getBoundingClientRect(),width=popup.offsetWidth,height=popup.offsetHeight,left=Math.max(8,Math.min(box.right-width,innerWidth-width-8)),above=box.bottom+height+10>innerHeight-8&&box.top>height+10;
  popup.style.left=left+'px';popup.style.top=Math.max(8,Math.min(above?box.top-height-10:box.bottom+10,innerHeight-height-8))+'px';popup.dataset.side=above?'above':'below';popup.style.setProperty('--arrow-left',Math.max(14,Math.min(width-22,box.left+box.width/2-left-4))+'px');input.focus();
 };
 add.addEventListener('click',()=>{if(input.value.trim()){close();anchor.focus();}});
 popup.onkeydown=event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();anchor.focus();}};
 popup.addEventListener('toggle',event=>{if((event as ToggleEvent).newState==='closed'){anchor.setAttribute('aria-expanded','false');releaseControl(close);}});
 window.addEventListener('resize',close);
}
