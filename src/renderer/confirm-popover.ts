import {button,esc} from './ui';
import {closeControls} from './controls';
let dismissActive:((restoreFocus:boolean)=>void)|undefined;
/** Compact confirmation beside the action; dismissing always cancels. */
export function confirmPopover(anchor:HTMLElement,message:string,detail:string,onConfirm:()=>void){
 closeControls();dismissActive?.(false);
 const popup=document.createElement('div');popup.className='confirmation-popover';popup.popover='auto';popup.setAttribute('role','alertdialog');popup.setAttribute('aria-label',message);
 popup.innerHTML=`<strong>${esc(message)}</strong>${detail?`<p>${esc(detail)}</p>`:''}<div>${button('confirmation-cancel','取消')}${button('confirmation-accept','删除','',true)}</div>`;
 document.body.append(popup);popup.showPopover();
 let frame=0,closed=false;
 const close=(restoreFocus:boolean)=>{
  if(closed)return;closed=true;if(dismissActive===close)dismissActive=undefined;
  cancelAnimationFrame(frame);window.removeEventListener('resize',schedulePosition);document.removeEventListener('scroll',schedulePosition,true);observer.disconnect();
  if(popup.matches(':popover-open'))popup.hidePopover();popup.remove();
  if(restoreFocus&&anchor.isConnected)anchor.focus({preventScroll:true});
 };
 const position=()=>{
  frame=0;if(closed)return;
  if(!anchor.isConnected){close(false);return;}
  const box=anchor.getBoundingClientRect();
  if(box.bottom<0||box.top>innerHeight||box.right<0||box.left>innerWidth){close(false);return;}
  const height=popup.offsetHeight,width=popup.offsetWidth,above=box.top>height+14;
  const left=Math.max(8,Math.min(box.right-width,innerWidth-width-8));
  popup.style.left=left+'px';popup.style.top=Math.max(8,Math.min(above?box.top-height-9:box.bottom+9,innerHeight-height-8))+'px';popup.dataset.side=above?'above':'below';
  popup.style.setProperty('--arrow-left',Math.max(12,Math.min(width-18,box.left+box.width/2-left))+'px');
 };
 function schedulePosition(){if(!closed&&!frame)frame=requestAnimationFrame(position);}
 const observer=new ResizeObserver(schedulePosition);observer.observe(anchor);observer.observe(popup);
 window.addEventListener('resize',schedulePosition);document.addEventListener('scroll',schedulePosition,true);
 dismissActive=close;position();
 popup.querySelector<HTMLButtonElement>('#confirmation-cancel')!.onclick=()=>close(true);
 popup.querySelector<HTMLButtonElement>('#confirmation-accept')!.onclick=()=>{close(true);onConfirm();};
 popup.onkeydown=event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);}};
 popup.addEventListener('toggle',event=>{if((event as ToggleEvent).newState==='closed')close(false);});
 popup.querySelector<HTMLButtonElement>('#confirmation-cancel')!.focus();
}
