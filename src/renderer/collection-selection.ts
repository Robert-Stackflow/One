import {Check,ListChecks,X} from 'lucide';
import {esc,icon,registerIcons} from './ui';
import './collection-selection.css';
registerIcons({'collection-check':Check,'collection-select':ListChecks,'collection-close':X});

export const collectionSelectButton=()=>`<button type="button" class="quiet collection-select-toggle" data-collection-toggle aria-pressed="false">${icon('lucide:collection-select')}多选</button>`;
export function collectionCheck(attribute:string,id:string,title:string,checked:boolean){
  return `<label class="collection-check"><input type="checkbox" ${attribute}="${esc(id)}" aria-label="选择 ${esc(title)}" ${checked?'checked':''}><span aria-hidden="true">${icon('lucide:collection-check')}</span></label>`;
}
export function collectionSelectionBar(id:string,label:string,actions:string){
  return `<div class="collection-selection-shell" inert aria-hidden="true"><div class="collection-selection-clip"><section class="collection-selection" aria-label="${label}"><label class="collection-select-all"><input id="${id}" type="checkbox"><span>全选</span></label><span class="collection-selected-count" aria-live="polite" aria-atomic="true"></span><div class="collection-batch-actions">${actions}</div><button type="button" class="quiet icon-button collection-selection-close" data-collection-clear aria-label="取消选择" title="取消选择">${icon('lucide:collection-close')}</button></section></div></div>`;
}
/** Keep the last row scrollable above a floating dock, including wrapped/scaled controls. */
export function watchCollectionDock(root:HTMLElement){
  let bar:HTMLElement|null=null;
  const workspace=root.closest<HTMLElement>('.workspace'),property=`--${root.classList.contains('pins-page')?'pins':'materials'}-dock-space`;
  const measure=()=>{
    const space=`${(bar?.getBoundingClientRect().height||0)+28}px`;
    root.style.setProperty('--collection-dock-space',space);workspace?.style.setProperty(property,space);
  };
  const resize=new ResizeObserver(measure);
  const bind=()=>{
    const next=root.querySelector<HTMLElement>('.collection-selection');
    if(next===bar)return;
    if(bar)resize.unobserve(bar);bar=next;if(bar)resize.observe(bar);measure();
  };
  const changes=new MutationObserver(bind);changes.observe(root,{childList:true});bind();
  return ()=>{resize.disconnect();changes.disconnect();root.style.removeProperty('--collection-dock-space');workspace?.style.removeProperty(property);};
}
export function syncCollectionSelection(root:HTMLElement,selected:Set<string>,ids:string[],mode:boolean,busy=false){
  root.classList.toggle('is-selecting',mode);
  const shell=root.querySelector<HTMLElement>('.collection-selection-shell');
  if(shell){shell.classList.toggle('is-open',mode);shell.inert=!mode;shell.setAttribute('aria-hidden',String(!mode));}
  const count=ids.filter(id=>selected.has(id)).length;
  const countLabel=root.querySelector('.collection-selected-count');if(countLabel)countLabel.textContent=`已选 ${count} 项`;
  const all=root.querySelector<HTMLInputElement>('.collection-select-all input');if(all){all.checked=!!ids.length&&count===ids.length;all.indeterminate=count>0&&count<ids.length;all.disabled=busy||!ids.length;}
  for(const card of root.querySelectorAll<HTMLElement>('[data-collection-card]')){
    const checked=selected.has(card.dataset.collectionCard!);card.classList.toggle('is-selected',checked);card.tabIndex=mode?0:-1;
    const input=card.querySelector<HTMLInputElement>('.collection-check input');if(input){input.checked=checked;input.disabled=busy;}
  }
  for(const button of root.querySelectorAll<HTMLButtonElement>('[data-collection-toggle]')){button.setAttribute('aria-pressed',String(mode));button.disabled=busy||!ids.length;}
  for(const button of root.querySelectorAll<HTMLButtonElement>('[data-collection-clear]'))button.disabled=busy;
}
/** Shift keeps the original anchor so extending/shrinking a range stays predictable. */
export function toggleCollectionRange(selected:Set<string>,ids:string[],id:string,checked:boolean,shift:boolean,anchor?:string){
  const from=anchor?ids.indexOf(anchor):-1,to=ids.indexOf(id);if(to<0)return anchor;
  if(shift&&from>=0){for(const value of ids.slice(Math.min(from,to),Math.max(from,to)+1))if(checked)selected.add(value);else selected.delete(value);return anchor;}
  if(checked)selected.add(id);else selected.delete(id);return id;
}
export function collectionShortcut(event:KeyboardEvent){
  if(event.defaultPrevented&&event.key==='Escape')return;
  if(event.target instanceof Element&&(event.target.closest('textarea,select,[contenteditable=true],[role=combobox]')||event.target.matches('input:not([type=checkbox]):not([type=radio])')))return;
  if(document.querySelector('dialog[open],:popover-open'))return;
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='a')return 'all';
  if(event.key==='Escape')return 'clear';
  if((event.key===' '||event.key==='Enter')&&event.target instanceof HTMLElement&&event.target.matches('[data-collection-card]'))return event.target.dataset.collectionCard;
}
