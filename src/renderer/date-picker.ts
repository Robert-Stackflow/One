import {CalendarDays,ChevronLeft,ChevronRight,createElement} from 'lucide';
import {customControls,closeControls} from './controls';
import './date-picker.css';

const pad=(value:number)=>String(value).padStart(2,'0');
const valid=(value:string)=>{const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value);if(!match)return false;const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);return month>=1&&month<=12&&day>=1&&day<=new Date(year,month,0).getDate();};
const glyph=createElement(CalendarDays,{'class':'icon','aria-hidden':'true','stroke-width':1.75}).outerHTML;
const previousGlyph=createElement(ChevronLeft,{'class':'icon','aria-hidden':'true','stroke-width':1.75}).outerHTML;
const nextGlyph=createElement(ChevronRight,{'class':'icon','aria-hidden':'true','stroke-width':1.75}).outerHTML;

export function datePickerMarkup(id:string,label:string,value:string){return `<button type="button" id="${id}" class="custom-date" role="combobox" aria-label="${label}" aria-haspopup="dialog" aria-expanded="false" data-date="${value}"><span>${value}</span>${glyph}</button>`;}

export function setupDatePicker(button:HTMLButtonElement){
 let value=button.dataset.date||new Date().toISOString().slice(0,10),popup:HTMLDivElement|undefined,year=Number(value.slice(0,4)),month=Number(value.slice(5,7));
 const set=(next:string)=>{if(!valid(next))return;value=next;button.querySelector('span')!.textContent=next;year=Number(next.slice(0,4));month=Number(next.slice(5,7));};
 Object.defineProperty(button,'value',{get:()=>value,set});set(value);
 const close=()=>{closeControls();popup?.remove();popup=undefined;button.setAttribute('aria-expanded','false');button.removeAttribute('aria-controls');document.removeEventListener('pointerdown',outside,true);document.removeEventListener('scroll',onScroll,true);window.removeEventListener('resize',close);window.removeEventListener('blur',close);};
 const outside=(event:PointerEvent)=>{const target=event.target as HTMLElement,menu=target.closest<HTMLElement>('.select-popup');if(menu?.id.startsWith(button.id+'-popup-'))return;if(!button.contains(target)&&!popup?.contains(target))close();};
 const onScroll=(event:Event)=>{const target=event.target as HTMLElement;if(target.closest?.('.select-popup')?.id.startsWith(button.id+'-popup-'))return;close();};
 const render=()=>{
  if(!popup)return;
  const first=(new Date(year,month-1,1).getDay()+6)%7,days=new Date(year,month,0).getDate(),today=new Date(),todayValue=`${today.getFullYear()}-${pad(today.getMonth()+1)}-${pad(today.getDate())}`;
  popup.innerHTML=`<header><button type="button" data-step="-1" aria-label="上个月">${previousGlyph}</button><div class="date-picker-period"><select id="${popup.id}-year" aria-label="年份">${Array.from({length:201},(_,index)=>1900+index).map(item=>`<option value="${item}"${item===year?' selected':''}>${item} 年</option>`).join('')}</select><select id="${popup.id}-month" aria-label="月份">${Array.from({length:12},(_,index)=>index+1).map(item=>`<option value="${item}"${item===month?' selected':''}>${item} 月</option>`).join('')}</select></div><button type="button" data-step="1" aria-label="下个月">${nextGlyph}</button></header><div class="date-weekdays">${'一二三四五六日'.split('').map(day=>`<span>${day}</span>`).join('')}</div><div class="date-days">${Array.from({length:first},()=>'<span></span>').join('')}${Array.from({length:days},(_,index)=>{const day=index+1,chosen=`${year}-${pad(month)}-${pad(day)}`;return `<button type="button" data-day="${day}" aria-label="${chosen}" aria-selected="${chosen===value}" data-today="${chosen===todayValue}">${day}</button>`;}).join('')}</div><footer><button type="button" data-today-action>今天</button><span>${value}</span></footer>`;
  customControls(popup);
 };
 const open=()=>{popup=document.createElement('div');popup.id=button.id+'-popup';popup.className='custom-date-popup';popup.role='dialog';popup.setAttribute('aria-label','选择日期');popup.addEventListener('keydown',event=>{if(event.key==='Escape'&&!event.defaultPrevented){event.preventDefault();close();button.focus();}});document.body.append(popup);render();button.setAttribute('aria-expanded','true');button.setAttribute('aria-controls',popup.id);const rect=button.getBoundingClientRect(),width=popup.offsetWidth,height=popup.offsetHeight;popup.style.left=Math.max(8,Math.min(innerWidth-width-8,rect.left))+'px';popup.style.top=Math.max(8,rect.bottom+height+8<=innerHeight?rect.bottom+6:rect.top-height-6)+'px';document.addEventListener('pointerdown',outside,true);document.addEventListener('scroll',onScroll,true);window.addEventListener('resize',close);window.addEventListener('blur',close);};
 button.onclick=()=>popup?close():open();button.onkeydown=event=>{if(event.key==='Escape')close();if(event.key==='ArrowDown'&&!popup){event.preventDefault();open();}};
 const onClick=(event:MouseEvent)=>{if(!popup||!popup.contains(event.target as Node))return;const target=event.target as HTMLElement,step=target.closest<HTMLElement>('[data-step]'),day=target.closest<HTMLElement>('[data-day]'),today=target.closest<HTMLElement>('[data-today-action]');if(step){month+=Number(step.dataset.step);if(month<1){month=12;year--;}else if(month>12){month=1;year++;}render();}else if(day||today){const now=new Date();set(day?`${year}-${pad(month)}-${pad(Number(day.dataset.day))}`:`${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`);button.dispatchEvent(new Event('change',{bubbles:true}));close();button.focus();}};
 const onChange=(event:Event)=>{if(!popup||!popup.contains(event.target as Node))return;const target=event.target as HTMLButtonElement & {value:string};if(target.id===popup.id+'-year')year=Number(target.value);else if(target.id===popup.id+'-month')month=Number(target.value);else return;render();};
 document.addEventListener('click',onClick);document.addEventListener('change',onChange);
 return {close,dispose(){close();document.removeEventListener('click',onClick);document.removeEventListener('change',onChange);}};
}
