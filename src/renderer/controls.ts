import {icon} from './ui';
import {enabledOption,focusOption,revealOption} from './option-list';
let closeActive: (() => void) | null = null;
/** Replace native selection controls with a keyboard-accessible popup. */
export function customControls(root: HTMLElement) {
  for (const select of root.querySelectorAll<HTMLSelectElement>('select')) {
    const options = [...select.options].map(option => ({ label: option.text, value: option.value, disabled: option.disabled }));
    const button = document.createElement('button'); button.type = 'button'; button.className = 'custom-select'; button.id = select.id;button.disabled=select.disabled;
    button.setAttribute('role','combobox'); button.setAttribute('aria-haspopup','listbox'); button.setAttribute('aria-expanded','false');
    button.setAttribute('aria-label', select.getAttribute('aria-label') || select.closest('label')?.textContent?.trim() || '选择');
    const label = document.createElement('span');button.append(label);button.insertAdjacentHTML('beforeend',icon('chevron-down')); 
    let value = select.value; let menu: HTMLDivElement | null = null; let modal:HTMLDialogElement|null=null;let active = 0; let prefix = ''; let typedAt = 0;
    let focused:HTMLElement|null=null,selected:HTMLElement|null=null;
    const setValue = (next: string) => {
      const index=options.findIndex(option=>option.value===next);if(index<0)return;
      value=next;label.textContent=options[index].label;
      if(menu){const node=menu.children[index] as HTMLElement;if(selected!==node){selected?.setAttribute('aria-selected','false');node?.setAttribute('aria-selected','true');selected=node;}}
    };
    Object.defineProperty(button,'value',{ get:()=>value, set:setValue }); setValue(value);
    button.addEventListener('one:options',event=>{close();options.splice(0,options.length,...(event as CustomEvent).detail);if(options.length)setValue(options.some(o=>o.value===value)?value:options[0].value);else{value='';label.textContent='没有可选项';}});
    const close = () => { menu?.remove(); menu=null;focused=selected=null;modal?.removeEventListener('close',close);modal=null; button.setAttribute('aria-expanded','false'); button.removeAttribute('aria-controls'); button.removeAttribute('aria-activedescendant'); document.removeEventListener('pointerdown',outside,true); window.removeEventListener('resize',close); root.removeEventListener('scroll',position,true); if(closeActive===close)closeActive=null; };
    const outside = (event: PointerEvent) => { if(event.target!==button && !button.contains(event.target as Node) && !menu?.contains(event.target as Node))close(); };
    const activate = (index: number) => {
      active=index;const option=menu?.children[index] as HTMLElement|undefined;
      if(focused===option)return;focused=focusOption(focused,option||null);
      if(option){button.setAttribute('aria-activedescendant',option.id);if(menu)revealOption(menu,option);}
      else button.removeAttribute('aria-activedescendant');
    };
    const move = (index:number,direction:1|-1) => {const next=enabledOption(options,index,direction);if(next>=0)activate(next);};
    const choose = (index: number) => { if(!options[index]||options[index].disabled)return; setValue(options[index].value); close(); button.focus(); button.dispatchEvent(new Event('change',{bubbles:true})); };
    const position = () => { if(!menu)return;const rect=button.getBoundingClientRect(),width=Math.max(rect.width,120),height=Math.min(248,menu.scrollHeight);menu.style.minWidth=width+'px';menu.style.left=Math.max(8,Math.min(rect.left,window.innerWidth-width-8))+'px';menu.style.top=(rect.bottom+height+5>window.innerHeight?Math.max(8,rect.top-height-5):rect.bottom+5)+'px'; };
    const open = () => { if(menu)return; closeActive?.(); closeActive=close; menu=document.createElement('div'); menu.className='select-popup'; menu.setAttribute('role','listbox'); menu.id=button.id+'-options'; button.setAttribute('aria-controls',menu.id); button.setAttribute('aria-expanded','true');
      options.forEach((option,index)=>{const node=document.createElement('div');node.setAttribute('role','option');node.setAttribute('aria-label',option.label);node.id=menu!.id+'-'+index;node.textContent=option.label;node.insertAdjacentHTML('beforeend',icon('check'));node.setAttribute('aria-disabled',String(!!option.disabled));node.setAttribute('aria-selected',String(option.value===value));if(option.value===value)selected=node;node.addEventListener('pointerdown',event=>event.preventDefault());node.addEventListener('pointerenter',()=>{if(!option.disabled)activate(index);});node.addEventListener('click',()=>choose(index));menu!.append(node);});
      if(!options.length){const empty=document.createElement('div');empty.className='select-empty';empty.role='status';empty.textContent='没有可选项';menu.append(empty);}
      modal=button.closest('dialog');menu.popover='manual';(modal||document.body).append(menu);menu.showPopover();modal?.addEventListener('close',close);position();const at=options.findIndex(option=>option.value===value);const next=enabledOption(options,Math.max(0,at),1);activate(next>=0?next:enabledOption(options,options.length-1,-1));document.addEventListener('pointerdown',outside,true); window.addEventListener('resize',close); root.addEventListener('scroll',position,true);
    };
    button.addEventListener('click',()=>{if(menu)close();else open()});
    button.addEventListener('keydown',event=>{
      if(event.key==='Escape'){event.preventDefault();close();return} if(event.key==='Tab'){close();return}
      if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();if(!menu){open();return}if(event.key==='Home')move(0,1);else if(event.key==='End')move(options.length-1,-1);else{const direction=event.key==='ArrowDown'?1:-1;move(active<0?direction>0?0:options.length-1:active+direction,direction);}return}
      if((event.key==='Enter'||event.key===' ')&&menu){event.preventDefault();choose(active);return}
      if(event.key.length===1&&!event.ctrlKey&&!event.altKey){event.preventDefault();if(Date.now()-typedAt>700)prefix='';prefix+=event.key.toLowerCase();typedAt=Date.now();open();const index=options.findIndex(option=>!option.disabled&&option.label.toLowerCase().startsWith(prefix));if(index>=0)activate(index)}
    });
    select.replaceWith(button);
  }
  for (const input of root.querySelectorAll<HTMLInputElement>('input[type=number]')) {
    if(input.parentElement?.classList.contains('number-control'))continue;
    const wrapper=document.createElement('span');wrapper.className='number-control';input.replaceWith(wrapper);wrapper.append(input);
    for (const [text,direction] of [['−',-1],['+',1]] as const) { const button=document.createElement('button');button.type='button';button.innerHTML=icon(direction<0?'minus':'plus');button.setAttribute('aria-label',(direction<0?'减少':'增加')+(input.getAttribute('aria-label')||input.closest('label')?.textContent?.trim()||'数值'));button.addEventListener('click',()=>{if(input.disabled)return;const number=Number(input.value)+(Number(input.step)||1)*direction;input.value=String(Math.max(input.min?Number(input.min):-Infinity,Math.min(input.max?Number(input.max):Infinity,number)));input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));});wrapper.append(button); }
  }
}
export function closeControls() { closeActive?.(); }
export function updateSelectOptions(control:HTMLElement,options:{label:string;value:string;disabled?:boolean}[]){control.dispatchEvent(new CustomEvent('one:options',{detail:options}));}
export function openControl(close: () => void) { closeActive?.(); closeActive = close; }
export function releaseControl(close: () => void) { if (closeActive === close) closeActive = null; }

