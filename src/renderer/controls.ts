import {icon} from './ui';
import {enabledOption,focusOption,revealOption} from './option-list';
let closeActive: (() => void) | null = null;
/** Replace native selection controls with a keyboard-accessible popup. */
export function customControls(root: HTMLElement) {
  for (const select of root.querySelectorAll<HTMLSelectElement>('select')) {
    const options = [...select.options].map(option => ({ label: option.text, value: option.value, disabled: option.disabled }));
    const button = document.createElement('button'); button.type = 'button'; button.className = 'custom-select'; button.id = select.id;button.disabled=select.disabled;
    button.setAttribute('role','combobox'); button.setAttribute('aria-haspopup','listbox'); button.setAttribute('aria-expanded','false');
    const associatedLabel=select.labels?.item(0);
    const labelText=associatedLabel?[...associatedLabel.childNodes].filter(node=>node.nodeType===Node.TEXT_NODE).map(node=>node.textContent?.trim()).filter(Boolean).join(' '):'';
    button.setAttribute('aria-label',select.getAttribute('aria-label')||labelText||associatedLabel?.querySelector('span')?.textContent?.trim()||'选择');
    const label = document.createElement('span');button.append(label);button.insertAdjacentHTML('beforeend',icon('chevron-down')); 
    let value = select.value; let popup:HTMLDivElement|null=null,menu:HTMLDivElement|null=null,search:HTMLInputElement|null=null,modal:HTMLDialogElement|null=null;
    let active = -1, prefix = '', typedAt = 0,visible:number[]=[];
    let focused:HTMLElement|null=null,selected:HTMLElement|null=null;
    const setValue = (next: string) => {
      const index=options.findIndex(option=>option.value===next);if(index<0)return;
      value=next;label.textContent=options[index].label;
      if(menu){const node=menu.children[index] as HTMLElement;if(selected!==node){selected?.setAttribute('aria-selected','false');node?.setAttribute('aria-selected','true');selected=node;}}
    };
    Object.defineProperty(button,'value',{ get:()=>value, set:setValue }); setValue(value);
    button.addEventListener('one:options',event=>{close();options.splice(0,options.length,...(event as CustomEvent).detail);if(options.length)setValue(options.some(o=>o.value===value)?value:options[0].value);else{value='';label.textContent='没有可选项';}});
    const close = () => { popup?.remove();popup=menu=search=null;visible=[];focused=selected=null;active=-1;modal?.removeEventListener('close',close);modal=null; button.setAttribute('aria-expanded','false'); button.removeAttribute('aria-controls'); button.removeAttribute('aria-activedescendant'); document.removeEventListener('pointerdown',outside,true); window.removeEventListener('resize',close); root.removeEventListener('scroll',position,true); if(closeActive===close)closeActive=null; };
    const outside = (event: PointerEvent) => { if(event.target!==button && !button.contains(event.target as Node) && !popup?.contains(event.target as Node))close(); };
    const activate = (index: number) => {
      active=index;const option=menu?.children[index] as HTMLElement|undefined;
      if(focused===option)return;focused=focusOption(focused,option||null);
      if(option&&!option.hidden){button.setAttribute('aria-activedescendant',option.id);search?.setAttribute('aria-activedescendant',option.id);if(menu)revealOption(menu,option);}
      else {button.removeAttribute('aria-activedescendant');search?.removeAttribute('aria-activedescendant');}
    };
    const move = (index:number,direction:1|-1) => {const next=enabledOption(visible.map(i=>options[i]),index,direction);if(next>=0)activate(visible[next]);};
    const choose = (index: number) => { if(!options[index]||options[index].disabled)return; setValue(options[index].value); close(); button.focus(); button.dispatchEvent(new Event('change',{bubbles:true})); };
    const position = () => {
      if(!popup)return;const rect=button.getBoundingClientRect(),edge=8,gap=5,maxWidth=Math.max(0,Math.min(480,innerWidth-edge*2));
      popup.style.width='max-content';popup.style.minWidth=Math.min(Math.max(rect.width,120),maxWidth)+'px';popup.style.maxWidth=maxWidth+'px';
      const below=Math.max(0,innerHeight-rect.bottom-gap-edge),above=Math.max(0,rect.top-gap-edge),opensAbove=below<Math.min(272,popup.scrollHeight)&&above>below;
      popup.dataset.placement=opensAbove?'above':'below';popup.style.maxHeight=Math.min(272,opensAbove?above:below)+'px';
      const size=popup.getBoundingClientRect();popup.style.left=Math.max(edge,Math.min(rect.left,innerWidth-edge-size.width))+'px';
      popup.style.top=(opensAbove?Math.max(edge,rect.top-gap-size.height):Math.min(innerHeight-edge-size.height,rect.bottom+gap))+'px';
    };
    const filter = (query:string) => {if(!menu)return;const needle=query.trim().toLocaleLowerCase();visible=[];options.forEach((option,index)=>{const node=menu!.children[index] as HTMLElement;node.hidden=!!needle&&!option.label.toLocaleLowerCase().includes(needle);if(!node.hidden)visible.push(index);});(menu.lastElementChild as HTMLElement).hidden=visible.length>0;const next=visible.find(index=>!options[index].disabled);activate(next??-1);position();};
    const onKey = (event:KeyboardEvent) => {
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();button.focus();return;}
      if(event.key==='Tab'){setTimeout(close,0);return;}
      if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const at=visible.indexOf(active);if(event.key==='Home')move(0,1);else if(event.key==='End')move(visible.length-1,-1);else{const direction=event.key==='ArrowDown'?1:-1;move(at<0?direction>0?0:visible.length-1:at+direction,direction);}return;}
      if(event.key==='Enter'||event.key===' '&&event.target===button){event.preventDefault();if(active>=0)choose(active);}
    };
    const open = (initial='') => { if(menu)return; closeActive?.(); closeActive=close;popup=document.createElement('div');popup.className='select-popup';menu=document.createElement('div');menu.className='select-popup-options';menu.setAttribute('role','listbox');menu.id=button.id+'-options';button.setAttribute('aria-controls',menu.id);button.setAttribute('aria-expanded','true');
      if(select.dataset.searchable==='true'||select.dataset.searchable!=='false'&&options.length>=10){search=document.createElement('input');search.type='search';search.className='select-popup-search';search.placeholder='筛选选项';search.setAttribute('aria-label','筛选选项');search.setAttribute('aria-controls',menu.id);search.addEventListener('input',()=>filter(search!.value));search.addEventListener('keydown',onKey);popup.append(search);}
      options.forEach((option,index)=>{const node=document.createElement('div');node.setAttribute('role','option');node.setAttribute('aria-label',option.label);node.id=menu!.id+'-'+index;node.textContent=option.label;node.insertAdjacentHTML('beforeend',icon('check'));node.setAttribute('aria-disabled',String(!!option.disabled));node.setAttribute('aria-selected',String(option.value===value));if(option.value===value)selected=node;node.addEventListener('pointerdown',event=>event.preventDefault());node.addEventListener('pointerenter',()=>{if(!option.disabled)activate(index);});node.addEventListener('click',()=>choose(index));menu!.append(node);});
      const empty=document.createElement('div');empty.className='select-empty';empty.role='status';empty.textContent='没有匹配项';menu.append(empty);popup.append(menu);
      modal=button.closest('dialog');popup.popover='manual';(modal||document.body).append(popup);popup.showPopover();modal?.addEventListener('close',close);filter(initial);if(!initial){const at=options.findIndex(option=>option.value===value);if(at>=0&&!options[at].disabled)activate(at);}search?.focus();document.addEventListener('pointerdown',outside,true); window.addEventListener('resize',close); root.addEventListener('scroll',position,true);
    };
    button.addEventListener('click',()=>{if(menu)close();else open()});
    button.addEventListener('keydown',event=>{
      if(event.key==='Escape'||event.key==='Tab'||menu){onKey(event);return;}
      if(['ArrowDown','ArrowUp','Home','End','Enter',' '].includes(event.key)){event.preventDefault();open();return;}
      if(event.key.length===1&&!event.ctrlKey&&!event.altKey&&!event.metaKey){event.preventDefault();if(options.length>=10&&select.dataset.searchable!=='false'||select.dataset.searchable==='true'){open(event.key);return;}if(Date.now()-typedAt>700)prefix='';prefix+=event.key.toLowerCase();typedAt=Date.now();open();const index=options.findIndex(option=>!option.disabled&&option.label.toLowerCase().startsWith(prefix));if(index>=0)activate(index);}
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

