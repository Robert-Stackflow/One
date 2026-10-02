import {button,esc} from './ui';
import {closeControls} from './controls';
let active:HTMLElement|undefined;
/** Compact confirmation beside the action; dismissing always cancels. */
export function confirmPopover(anchor:HTMLElement,message:string,detail:string,onConfirm:()=>void){
 closeControls();active?.remove();const popup=active=document.createElement('div');popup.className='confirmation-popover';popup.popover='auto';popup.setAttribute('role','alertdialog');popup.setAttribute('aria-label',message);
 popup.innerHTML=`<strong>${esc(message)}</strong>${detail?`<p>${esc(detail)}</p>`:''}<div>${button('confirmation-cancel','取消')}${button('confirmation-accept','删除','',true)}</div>`;
 document.body.append(popup);popup.showPopover();const box=anchor.getBoundingClientRect(),height=popup.offsetHeight,width=popup.offsetWidth,above=box.top>height+14;
 const left=Math.max(8,Math.min(box.right-width,innerWidth-width-8));popup.style.left=left+'px';popup.style.top=Math.max(8,Math.min(above?box.top-height-9:box.bottom+9,innerHeight-height-8))+'px';popup.dataset.side=above?'above':'below';popup.style.setProperty('--arrow-left',Math.max(12,Math.min(width-18,box.left+box.width/2-left))+'px');
 const close=()=>{popup.remove();if(active!==popup)return;active=undefined;if(anchor.isConnected)anchor.focus();};
 popup.querySelector<HTMLButtonElement>('#confirmation-cancel')!.onclick=close;popup.querySelector<HTMLButtonElement>('#confirmation-accept')!.onclick=()=>{close();onConfirm();};popup.onkeydown=event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}};popup.addEventListener('toggle',event=>{if((event as ToggleEvent).newState==='closed')close();});popup.querySelector<HTMLButtonElement>('#confirmation-cancel')!.focus();
}
