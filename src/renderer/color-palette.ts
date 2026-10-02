import {api,esc,icon,toast} from './ui';
import {colorFormats,colorFormatNames,colorVariants,type ColorState,type ColorFormat} from '../shared/colors';
/** Shared bounded palette for the workbench and compact result window. */
export class ColorPalette {
 selected='#4479D8';private formats:ColorFormat[]=['hex','rgb','hsl'];private expanded:boolean;private historyKey='';private valuesKey='';private revision=0;private selectionRevision=0;
 constructor(private root:HTMLElement,private compact=false){
  this.expanded=!compact;
  root.addEventListener('click',event=>{
   const target=event.target instanceof Element?event.target.closest<HTMLElement>('button'):null;if(!target)return;
   if(target.dataset.colorHex){this.select(target.dataset.colorHex,!target.hasAttribute('data-color-variant'));return;}
   const kind=target.dataset.colorCopy as ColorFormat|undefined;
   if(kind){void api.copyText(colorFormats(this.selected)[kind]).then(()=>toast('已复制')).catch(toast);return;}
   if(target.hasAttribute('data-color-save')){void this.save().catch(toast);return;}
   if(target.hasAttribute('data-color-clear')){void api.clearColorHistory().catch(toast);return;}
   if(target.hasAttribute('data-color-more')){this.expanded=!this.expanded;this.valuesKey='';this.values();}
  });
  root.addEventListener('keydown',event=>{
   const target=event.target instanceof Element?event.target.closest<HTMLElement>('[data-color-hex]'):null;
   if(!target||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
   const buttons=[...target.parentElement!.querySelectorAll<HTMLButtonElement>('[data-color-hex]')],at=buttons.indexOf(target as HTMLButtonElement);
   const index=event.key==='Home'?0:event.key==='End'?buttons.length-1:(at+(event.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length;
   event.preventDefault();buttons[index]?.focus();buttons[index]?.click();
  });
  const input=this.field<HTMLInputElement>('input');
  input.addEventListener('input',()=>{input.removeAttribute('aria-invalid');if(/^#[\da-f]{6}$/i.test(input.value))this.select(input.value);});
  input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.isComposing){event.preventDefault();void this.save().catch(toast);}});
  api.onColor(hex=>{this.select(hex);void this.load().catch(toast);});api.onColorSettings(()=>void this.load().catch(toast));
  this.select(this.selected);void this.load(true).catch(toast);
 }
 private field<T extends HTMLElement=HTMLElement>(name:string){return this.root.querySelector<T>(`[data-color-${name}]`)!;}
 async load(initial=false){const revision=++this.revision,selection=this.selectionRevision,state=await api.colorState();if(revision!==this.revision)return;this.apply(state);if(initial&&selection===this.selectionRevision)this.select(state.selected);}
 private apply(state:ColorState){
  this.formats=state.formats;const key=JSON.stringify(state.history),history=this.field('history');
  if(key!==this.historyKey){this.historyKey=key;history.innerHTML=state.history.map(hex=>`<button style="--swatch:${esc(hex)}" data-color-hex="${esc(hex)}" aria-label="选择 ${esc(hex)}" title="${esc(hex)}" aria-pressed="false"><i aria-hidden="true"></i><span>${esc(hex)}</span></button>`).join('');}
  const recent=this.root.querySelector<HTMLElement>('[data-color-recent]');if(recent)recent.hidden=!state.history.length;
  this.values();this.markSelected();
 }
 select(hex:string,variants=true){
  if(!/^#[\da-f]{6}$/i.test(hex))return;this.selectionRevision++;this.selected=hex.toUpperCase();const sample=this.field('sample');sample.style.background=this.selected;
  const [r,g,b]=this.selected.slice(1).match(/../g)!.map(x=>parseInt(x,16));sample.style.color=r*.299+g*.587+b*.114>155?'#202020':'#fff';
  const label=this.root.querySelector<HTMLElement>('[data-color-label]');if(label)label.textContent=this.selected;
  const input=this.field<HTMLInputElement>('input');if(input.value.toUpperCase()!==this.selected)input.value=this.selected;
  if(variants)this.field('variants').innerHTML=colorVariants(this.selected).map(({hex,label})=>`<button style="--swatch:${hex}" data-color-hex="${hex}" data-color-variant aria-label="${label} ${hex}" title="${label} · ${hex}" aria-pressed="false"><i aria-hidden="true"></i></button>`).join('');
  this.values();this.markSelected();
 }
 private markSelected(){this.root.querySelectorAll<HTMLElement>('[data-color-hex]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.colorHex===this.selected)));}
 private values(){
  const kinds=this.expanded?this.formats:this.formats.slice(0,3),key=kinds.join(','),values=this.field('values'),formatted=colorFormats(this.selected);
  if(this.valuesKey!==key||!values.childElementCount){this.valuesKey=key;values.innerHTML=kinds.length?kinds.map(kind=>`<button data-color-copy="${kind}" aria-label="复制 ${colorFormatNames[kind]}" title="复制 ${colorFormatNames[kind]}"><span>${colorFormatNames[kind]}</span><strong></strong>${icon('copy')}</button>`).join(''):'<p class="color-formats-empty">在屏幕取色页面选择显示格式</p>';}
  for(const button of values.querySelectorAll<HTMLButtonElement>('[data-color-copy]')){const value=formatted[button.dataset.colorCopy as ColorFormat];button.dataset.copy=value;button.querySelector('strong')!.textContent=value;}
  const more=this.root.querySelector<HTMLButtonElement>('[data-color-more]');if(more){const label=this.expanded?'收起格式':`更多格式 · ${this.formats.length-3}`;more.hidden=this.formats.length<=3;more.setAttribute('aria-expanded',String(this.expanded));more.setAttribute('aria-label',label);more.title=label;more.innerHTML=`${this.compact?'':label}${icon('chevron-down')}`;}
 }
 private async save(){const input=this.field<HTMLInputElement>('input');if(!/^#[\da-f]{6}$/i.test(input.value)){input.setAttribute('aria-invalid','true');input.focus();throw Error('请输入 #RRGGBB 格式颜色');}this.select(input.value);await api.chooseColor(this.selected);toast('已保存并复制');}
}
