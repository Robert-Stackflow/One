import {PagedRows} from '../shared/paged-rows';
import {RowHeights} from '../shared/row-heights';
import {VirtualRows} from './virtual-rows';
import {hydrateIconRows} from './shell-icons';
import {icon} from './ui';

export interface ResultLocation {position:number;offset:number;selected:number}
interface ResultOptions<T> {
 count:number;pageSize:number;estimate:number;label:string;read:(page:number)=>Promise<T[]>;
 markup:(value:T)=>string;decorate?:(row:HTMLElement,value:T)=>void;
 selected?:(value:T,position:number)=>void;activate?:(value:T)=>void;error:(error:unknown)=>void;
}

/** A common result list with complete keyboard traversal and a bounded data cache. */
export class PagedResultList<T> {
 private pages:PagedRows<T>;private virtual:VirtualRows;private active=true;private disposed=false;
 private records=new WeakMap<HTMLElement,T>();private position=0;private notify=-1;private focusPending=false;
 private icons=new WeakSet<HTMLElement>();
 constructor(readonly root:HTMLElement,private options:ResultOptions<T>){
  root.tabIndex=0;root.setAttribute('role','grid');root.setAttribute('aria-label',options.label);
  root.setAttribute('aria-rowcount',String(options.count));root.setAttribute('aria-colcount','1');
  this.pages=new PagedRows(options.read,()=>this.virtual.refresh(),options.error,options.pageSize);
  this.virtual=new VirtualRows(root,()=>options.count,(position,previous)=>this.row(position,previous),options.estimate,()=>this.painted(),new RowHeights(options.estimate,options.count));
  root.addEventListener('keydown',this.keydown);root.addEventListener('click',this.clicked);
 }
 private row(position:number,previous?:HTMLElement){
  const row=previous||document.createElement('div'),value=this.pages.get(position);
  row.className='tool-visible-row';row.dataset.position=String(position);row.id=this.root.id+'-row-'+position;
  row.setAttribute('role','row');row.setAttribute('aria-rowindex',String(position+1));
  const selected=this.position===position;
  if(row.getAttribute('aria-selected')!==String(selected))row.setAttribute('aria-selected',String(selected));
  if(value){
   row.removeAttribute('aria-busy');
   if(this.records.get(row)!==value){row.innerHTML='<div role="gridcell">'+this.options.markup(value)+'</div>';this.records.set(row,value);}
   this.options.decorate?.(row,value);
  }else{
   row.setAttribute('aria-busy','true');
   const failed=this.pages.hasFailed(position),state=failed?'failed':'pending';
   if(row.dataset.loading!==state||this.records.has(row))row.innerHTML=failed?'<div role="gridcell"><button class="quiet tool-page-retry" data-result-retry>'+icon('refresh')+'重新加载</button></div>':'<div role="gridcell" class="tool-result-placeholder" aria-label="正在加载结果" style="height:'+this.options.estimate+'px"><span></span><span></span></div>';
   row.dataset.loading=state;this.records.delete(row);
  }
  return row;
 }
 private painted(){
  if(!this.active||this.disposed)return;
  const rows=[...this.virtual.items.children] as HTMLElement[];
  if(rows.length)this.pages.demand(Number(rows[0].dataset.position),Number(rows.at(-1)!.dataset.position)+1);
  const current=this.pages.get(this.position);
  if(current&&this.notify!==this.position){this.notify=this.position;this.options.selected?.(current,this.position);}
  const selected=rows.find(row=>Number(row.dataset.position)===this.position);
  if(selected)this.root.setAttribute('aria-activedescendant',selected.id);else this.root.removeAttribute('aria-activedescendant');
  if(this.focusPending&&selected&&current){this.focusPending=false;this.virtual.reveal(this.position);const button=selected.querySelector<HTMLElement>('[data-group]');(button||this.root).focus({preventScroll:true});}
  const icons=[...this.root.querySelectorAll<HTMLElement>('[data-file-icon]')].filter(row=>!this.icons.has(row));
  icons.forEach(row=>this.icons.add(row));hydrateIconRows(icons,()=>this.active&&!this.disposed);
 }
 readonly keydown=(event:KeyboardEvent)=>{
  if(event.ctrlKey||event.metaKey||event.altKey||event.isComposing)return;
  const target=event.target as HTMLElement;
  if(target!==this.root&&!target.matches('[data-group],input[type=checkbox]'))return;
  const key=event.key;
  if(['ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(key)){
   event.preventDefault();const step=key.startsWith('Page')?Math.max(1,Math.floor(this.virtual.visibleHeight/this.options.estimate)):1;
   const position=key==='Home'?0:key==='End'?this.options.count-1:this.position+(key==='ArrowDown'||key==='PageDown'?step:-step);
   this.choose(position,true);
  }else if(key==='Enter'&&target===this.root){const value=this.pages.get(this.position);if(value){event.preventDefault();this.options.activate?.(value);}}
 };
 readonly clicked=(event:MouseEvent)=>{
  if(!(event.target instanceof Element))return;
  if(event.target.closest('[data-result-retry]')){this.pages.retry();return;}
  const row=event.target.closest<HTMLElement>('.tool-visible-row');if(row)this.choose(Number(row.dataset.position));
 };
 choose(position:number,focus=false){this.position=Math.max(0,Math.min(this.options.count-1,position));this.focusPending=focus;this.virtual.reveal(this.position);this.virtual.refresh();}
 get(position:number){return this.pages.get(position);}
 refresh(){this.virtual.refresh();}
 location():ResultLocation{return{...this.virtual.location(),selected:this.position};}
 restore(location:ResultLocation){this.position=location.selected;this.virtual.anchor(location.position,location.offset);}
 setViewport(viewport:HTMLElement){this.virtual.setViewport(viewport);}
 setActive(active:boolean){if(this.active===active)return;this.active=active;if(active)this.icons=new WeakSet();this.virtual.setActive(active);this.pages.setActive(active);}
 dispose(){this.disposed=true;this.pages.dispose();this.virtual.dispose();this.root.removeEventListener('keydown',this.keydown);this.root.removeEventListener('click',this.clicked);}
}
