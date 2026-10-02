import type {SearchEntry} from '../shared/search';
import {esc,icon} from './ui';
import {hydrateIconRows} from './shell-icons';

const identity=(item:SearchEntry)=>(item.launchKind||'file')+':'+item.path.toLowerCase();
type Row={element:HTMLElement;symbol:HTMLElement;name:HTMLElement;path:HTMLElement;shortcut:HTMLElement|null;markup:string;preview:HTMLButtonElement|null;reveal:HTMLButtonElement|null};

/** Keep row, icon and tooltip targets alive across updates to the same search. */
export class SearchResults {
 private rows=new Map<string,Row>();
 private entries:SearchEntry[]=[];
 private index=0;
 private serial=0;
 private empty:HTMLElement|null=null;
 constructor(private root:HTMLElement,private input:HTMLInputElement,private embedded:boolean,private nameMarkup:(item:SearchEntry)=>string){}
 get count(){return this.entries.length;}
 get selected(){return this.index;}
 entry(index=this.index){return this.entries[index];}
 select(index:number,scroll=false){
  this.index=Math.max(0,Math.min(this.count-1,index));
  for(let i=0;i<this.count;i++){
   const row=this.rows.get(identity(this.entries[i]))!.element,selected=i===this.index;
   row.classList.toggle('selected',selected);
   if(row.getAttribute('aria-selected')!==String(selected))row.setAttribute('aria-selected',String(selected));
  }
  const row=this.entry()&&this.rows.get(identity(this.entry()!))!.element;
  if(row){this.input.setAttribute('aria-activedescendant',row.id);if(scroll)row.scrollIntoView({block:'nearest'});}
  else this.input.removeAttribute('aria-activedescendant');
 }
 update(entries:SearchEntry[],preserve:boolean,emptyLabel:string){
  const previous=this.entry(),oldIndex=this.index,seen=new Set<string>();
  const next=entries.filter(item=>{const key=identity(item);if(seen.has(key))return false;seen.add(key);return true;});
  const reordered=next.length!==this.count||next.some((item,i)=>identity(item)!==identity(this.entries[i]));
  let anchor:HTMLElement|undefined,offset=0;
  if(preserve&&reordered&&this.count){
   const bounds=this.root.getBoundingClientRect(),selected=previous&&this.rows.get(identity(previous))?.element;
   const visible=(row:HTMLElement)=>{const r=row.getBoundingClientRect();return r.bottom>bounds.top&&r.top<bounds.bottom;};
   anchor=selected&&visible(selected)?selected:[...this.root.querySelectorAll<HTMLElement>('[data-result]')].find(visible);
   if(anchor)offset=anchor.getBoundingClientRect().top-bounds.top;
  }
  for(const [key,row]of this.rows)if(!seen.has(key)){row.element.remove();this.rows.delete(key);}
  this.entries=next;
  const selected=preserve&&previous?next.findIndex(item=>identity(item)===identity(previous)):-1;
  this.index=preserve?(selected>=0?selected:Math.max(0,Math.min(next.length-1,oldIndex))):0;
  const newIcons:HTMLElement[]=[];
  if(next.length){this.empty?.remove();this.empty=null;}
  let cursor=this.root.firstElementChild;
  for(let i=0;i<next.length;i++){
   const item=next[i],key=identity(item);let row=this.rows.get(key);
   if(!row){
    const element=document.createElement('div');element.className='search-result';element.role='option';element.id='search-result-'+ ++this.serial;
    element.innerHTML=`<span class="result-icon" data-file-icon="${esc(item.path)}">${icon(item.launchKind==='setting'?'settings':item.launchKind==='app'?'window':item.directory?'folder':'file')}</span><div class="result-name"><strong></strong><span></span></div>${this.embedded?'<kbd class="result-shortcut"></kbd>':''}${!item.launchKind?`<div class="search-row-actions"><button class="icon-button quiet" data-preview data-tooltip="预览">${icon('preview')}</button><button class="icon-button quiet" data-reveal data-tooltip="在资源管理器中显示">${icon('folder')}</button></div>`:''}`;
    row={element,symbol:element.querySelector('.result-icon')!,name:element.querySelector('strong')!,path:element.querySelector('.result-name>span')!,shortcut:element.querySelector('kbd'),markup:'',preview:element.querySelector('[data-preview]'),reveal:element.querySelector('[data-reveal]')};
    this.rows.set(key,row);newIcons.push(row.symbol);
   }
   const markup=this.nameMarkup(item),path=item.subtitle||item.path;
   if(row.markup!==markup){row.name.innerHTML=markup;row.markup=markup;}
   if(row.path.textContent!==path)row.path.textContent=path;
   const label=row.name.parentElement!;if(label.dataset.tooltip!==path)label.dataset.tooltip=path;
   if(row.element.dataset.result!==String(i))row.element.dataset.result=String(i);
   for(const [button,attribute,prefix]of [[row.preview,'preview','预览 '],[row.reveal,'reveal','定位 ']] as const)if(button){
    if(button.dataset[attribute]!==String(i))button.dataset[attribute]=String(i);
    if(button.getAttribute('aria-label')!==prefix+item.name)button.setAttribute('aria-label',prefix+item.name);
   }
   if(row.shortcut){const text=i<9?'Ctrl+'+(i+1):'';row.shortcut.hidden=!text;if(row.shortcut.textContent!==text)row.shortcut.textContent=text;}
   // An unchanged order performs no DOM insertion/removal at all.
   if(row.element!==cursor)this.root.insertBefore(row.element,cursor);
   cursor=row.element.nextElementSibling;
  }
  if(!next.length){
   if(!this.empty){this.empty=document.createElement('div');this.empty.className='search-empty';this.empty.innerHTML=icon('search')+'<span></span>';this.root.append(this.empty);}
   const label=this.empty.querySelector('span')!;if(label.textContent!==emptyLabel)label.textContent=emptyLabel;
  }
  this.select(this.index);this.input.setAttribute('aria-expanded',String(!!next.length));
  if(!preserve)this.root.scrollTop=0;
  else if(anchor?.isConnected){const delta=anchor.getBoundingClientRect().top-this.root.getBoundingClientRect().top-offset;if(Math.abs(delta)>.5)this.root.scrollTop+=delta;}
  hydrateIconRows(newIcons);
 }
}
