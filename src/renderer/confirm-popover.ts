import {button,esc} from './ui';
import {closeControls} from './controls';
import {openAnchoredPopover,closeAnchoredPopover} from './anchored-popover';
let dismissActive:((restoreFocus:boolean)=>void)|undefined;
/** Compact confirmation beside the action; dismissing always cancels. */
export function confirmPopover(anchor:HTMLElement,message:string,detail:string,onConfirm:()=>void){
 closeControls();dismissActive?.(false);
 const popup=document.createElement('div');popup.className='confirmation-popover';popup.popover='auto';popup.setAttribute('role','alertdialog');popup.setAttribute('aria-label',message);
 popup.innerHTML=`<strong>${esc(message)}</strong>${detail?`<p>${esc(detail)}</p>`:''}<div>${button('confirmation-cancel','取消')}${button('confirmation-accept','删除','',true)}</div>`;
 document.body.append(popup);
 let closed=false;
 const close=(restoreFocus:boolean)=>{
  if(closed)return;closed=true;if(dismissActive===close)dismissActive=undefined;
  void closeAnchoredPopover(popup,{remove:true});
  if(restoreFocus&&anchor.isConnected)anchor.focus({preventScroll:true});
 };
 dismissActive=close;
 if(!openAnchoredPopover(anchor,popup,{preferred:'above',gap:9,width:240,mode:'auto',onDetach:()=>close(false)})){close(false);return;}
 popup.querySelector<HTMLButtonElement>('#confirmation-cancel')!.onclick=()=>close(true);
 popup.querySelector<HTMLButtonElement>('#confirmation-accept')!.onclick=()=>{close(true);onConfirm();};
 popup.onkeydown=event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);}};
 popup.addEventListener('toggle',event=>{if((event as ToggleEvent).newState==='closed')close(false);});
 popup.querySelector<HTMLButtonElement>('#confirmation-cancel')!.focus();
}
