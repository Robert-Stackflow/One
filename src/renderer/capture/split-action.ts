import {icon} from '../ui';
import {closeControls,openControl,releaseControl} from '../controls';
import {openAnchoredPopover,closeAnchoredPopover} from '../anchored-popover';
import {onRemoval} from '../dom-lifecycle';
import './split-action.css';

export function splitAction(id:string,label:string,glyph:string,primary=false){
  return `<div class="action-split${primary?' is-primary':''}"><button type="button" id="${id}" class="split-action">${icon(glyph)}${label}</button><button type="button" id="${id}-menu" class="split-chevron" aria-label="${label}选项" aria-haspopup="menu" aria-expanded="false" aria-controls="${id}-options">${icon('chevron-down')}</button></div><div id="${id}-options" class="select-popup capture-entry-menu" popover="manual" role="menu" aria-label="${label}选项"><button type="button" data-preserve-window role="menuitem">${icon('lucide:camera')}保留主窗口截图</button><button type="button" id="${id}-hide" role="menuitem">${icon('lucide:window')}隐藏主窗口后截图</button></div>`;
}
export function bindSplitAction(root:HTMLElement,id:string,work:(hideMainWindow:boolean)=>void){
  const button=root.querySelector<HTMLButtonElement>('#'+id+'-menu')!,menu=root.querySelector<HTMLElement>('#'+id+'-options')!,primary=root.querySelector<HTMLButtonElement>('#'+id)!;
  const close=()=>{releaseControl(close);void closeAnchoredPopover(menu,{immediate:true});button.setAttribute('aria-expanded','false');document.removeEventListener('pointerdown',outside,true);};
  const outside=(event:PointerEvent)=>{if(!menu.contains(event.target as Node)&&!button.contains(event.target as Node))close();};
  primary.onclick=()=>{closeControls();work(false);};
  menu.querySelector<HTMLButtonElement>('[data-preserve-window]')!.onclick=()=>{close();if(!primary.disabled)work(false);};
  menu.querySelector<HTMLButtonElement>('#'+id+'-hide')!.onclick=()=>{close();if(!primary.disabled)work(true);};
  button.onclick=()=>{
    if(menu.matches(':popover-open'))return close();
    openControl(close);
    if(!openAnchoredPopover(button,menu,{mode:'manual',preferred:'below',gap:6,onDetach:close}))return close();
    button.setAttribute('aria-expanded','true');document.addEventListener('pointerdown',outside,true);
    menu.querySelector<HTMLButtonElement>('button')!.focus({preventScroll:true});
  };
  menu.onkeydown=event=>{
    if(event.key==='Escape'){event.preventDefault();close();button.focus({preventScroll:true});}
    else if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
      event.preventDefault();const choices=[...menu.querySelectorAll<HTMLButtonElement>('button')];const current=choices.indexOf(document.activeElement as HTMLButtonElement);
      choices[event.key==='Home'?0:event.key==='End'?choices.length-1:(current+(event.key==='ArrowDown'?1:choices.length-1))%choices.length].focus();
    }
  };
  onRemoval(button,close);
  return close;
}
