import {icon} from './ui';
import './time-picker.css';
let closeActive:(()=>void)|undefined;
const pad=(value:number)=>String(value).padStart(2,'0');
/** Accessible 24-hour picker with no native date/time input or OS popup. */
export function timePickerMarkup(id:string,label:string,value:string){return `<button type="button" id="${id}" class="custom-time" role="combobox" aria-label="${label}" aria-haspopup="dialog" aria-expanded="false" data-time="${value}"><span>${value}</span>${icon('clock')}</button>`;}
export function setupTimePicker(button:HTMLButtonElement){
 let value=button.dataset.time||'00:00',popup:HTMLDivElement|undefined;
 const label=button.getAttribute('aria-label')||'切换时间';
 const set=(next:string)=>{
  if(!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(next))return;
  value=next;button.querySelector('span')!.textContent=value;
  popup?.querySelectorAll<HTMLButtonElement>('[data-time-value]').forEach(option=>{const selected=option.dataset.timeValue===value.split(':')[Number(option.dataset.part)];option.setAttribute('aria-selected',String(selected));option.tabIndex=selected?0:-1;});
 };
 Object.defineProperty(button,'value',{get:()=>value,set});set(value);
 const close=()=>{popup?.remove();popup=undefined;button.setAttribute('aria-expanded','false');button.removeAttribute('aria-controls');document.removeEventListener('pointerdown',outside,true);document.removeEventListener('focusin',focusOutside);document.removeEventListener('scroll',scrolled,true);window.removeEventListener('resize',close);window.removeEventListener('blur',close);if(closeActive===close)closeActive=undefined;};
 const outside=(event:PointerEvent)=>{if(!button.contains(event.target as Node)&&!popup?.contains(event.target as Node))close();};
 const focusOutside=(event:FocusEvent)=>{if(event.target!==button&&!popup?.contains(event.target as Node))close();};
 const scrolled=(event:Event)=>{if(!popup?.contains(event.target as Node))close();};
 const selected=(part:number)=>popup?.querySelector<HTMLButtonElement>(`[data-part="${part}"][aria-selected="true"]`);
 const choose=(part:number,next:string)=>{const parts=value.split(':');parts[part]=next;const nextValue=parts.join(':');if(nextValue!==value){set(nextValue);button.dispatchEvent(new Event('change',{bubbles:true}));}};
 const open=()=>{
  closeActive?.();closeActive=close;popup=document.createElement('div');popup.className='custom-time-popup';popup.id=button.id+'-popup';popup.setAttribute('role','dialog');popup.setAttribute('aria-label',label);
  popup.innerHTML=[['小时',24],['分钟',60]].map(([title,count],part)=>`<div class="time-column"><span>${title}</span><div role="listbox" aria-label="${title}">${Array.from({length:Number(count)},(_,n)=>`<button type="button" role="option" data-part="${part}" data-time-value="${pad(n)}">${pad(n)}</button>`).join('')}</div></div>`).join('');
  document.body.append(popup);set(value);button.setAttribute('aria-expanded','true');button.setAttribute('aria-controls',popup.id);
  const rect=button.getBoundingClientRect(),height=popup.offsetHeight,width=popup.offsetWidth;
  popup.style.left=Math.max(8,Math.min(innerWidth-width-8,rect.right-width))+'px';popup.style.top=Math.max(8,rect.bottom+height+8<=innerHeight?rect.bottom+6:rect.top-height-6)+'px';
  for(const part of [0,1])selected(part)?.scrollIntoView({block:'center'});
  popup.addEventListener('click',event=>{const option=(event.target as HTMLElement).closest<HTMLButtonElement>('[data-time-value]');if(option){choose(Number(option.dataset.part),option.dataset.timeValue!);option.focus();}});
  popup.addEventListener('keydown',event=>{
   const option=(event.target as HTMLElement).closest<HTMLButtonElement>('[data-time-value]');if(!option)return;
   const part=Number(option.dataset.part),count=part?60:24,current=Number(option.dataset.timeValue);
   if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?count-1:(current+(event.key==='ArrowDown'?1:count-1))%count;choose(part,pad(next));selected(part)?.focus();}
   else if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();selected(part?0:1)?.focus();}
   else if(event.key==='Escape'||event.key==='Enter'){event.preventDefault();close();button.focus();}
  });
  document.addEventListener('pointerdown',outside,true);document.addEventListener('focusin',focusOutside);document.addEventListener('scroll',scrolled,true);window.addEventListener('resize',close);window.addEventListener('blur',close);selected(0)?.focus();
 };
 button.addEventListener('click',()=>popup?close():open());
 button.addEventListener('keydown',event=>{if(event.key==='ArrowDown'){event.preventDefault();if(!popup)open();}else if(event.key==='Escape')close();});
 return {close};
}
