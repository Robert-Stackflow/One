import type {MaintenanceEntry} from '../shared/maintenance';
import {RowHeights} from '../shared/row-heights';
import {VirtualRows} from './virtual-rows';
import {esc,icon,size} from './ui';

export interface MaintenanceListState {expanded:Map<string,number>;anchor:string;offset:number;focused:string}
export const maintenanceEntryKey=(entry:MaintenanceEntry)=>[entry.source,entry.location,entry.name].join('\0');
export const maintenanceListState=():MaintenanceListState=>({expanded:new Map(),anchor:'',offset:0,focused:''});
const compactStatus=(v:string)=>v.startsWith('目标未找到')?'目标不存在':v.startsWith('目标存在')?'正常':v.startsWith('相对路径')?'间接命令':v.startsWith('网络路径')?'网络路径':v.startsWith('磁盘离线')?'磁盘离线':v.startsWith('无访问权限')?'无访问权限':v;

/** Full metadata lists with persistent disclosure state and a bounded number of rows. */
export class MaintenanceList {
 private entries:MaintenanceEntry[]=[];private selected=new Map<string,MaintenanceEntry>();private view?:MaintenanceListState;private context='';private position=0;
 private heights=new RowHeights(96);private rows:VirtualRows;private empty=document.createElement('div');private emptyLabel='';
 constructor(private host:HTMLElement,private choose:(entry:MaintenanceEntry,checked:boolean)=>void,private manage:()=>void,private all:()=>void){
  host.tabIndex=0;host.setAttribute('role','grid');host.setAttribute('aria-colcount','3');host.setAttribute('aria-label','维护项目，方向键浏览，空格选择，回车展开详情');
  this.rows=new VirtualRows(host,()=>this.entries.length,(position,previous)=>this.row(position,previous),96,()=>this.painted(),this.heights);this.rows.setActive(false);
  this.empty.className='maintenance-empty';this.empty.hidden=true;host.append(this.empty);host.addEventListener('keydown',this.key);host.addEventListener('scroll',()=>this.remember(),{passive:true});
 }
 setActive(active:boolean){if(!active){this.remember();this.rows.setActive(false);this.entries=[];this.selected=new Map();this.heights.reset(0);this.rows.reset();}else this.rows.setActive(true);}
 update(entries:MaintenanceEntry[],selected:Map<string,MaintenanceEntry>,view:MaintenanceListState,context:string){
  this.selected=selected;
  if(entries!==this.entries||view!==this.view||context!==this.context){
   this.remember();const restore=view!==this.view||context===this.context,anchor=restore?view.anchor:'',focused=restore?view.focused:'';
   this.entries=entries;this.view=view;this.context=context;this.heights.reset(entries.length);this.rows.reset();
   this.position=focused?Math.max(0,entries.findIndex(e=>maintenanceEntryKey(e)===focused)):0;
   if(view.expanded.size)for(let i=0;i<entries.length;i++){const height=view.expanded.get(maintenanceEntryKey(entries[i]));if(height)this.heights.set(i,height);}
   const at=anchor?Math.max(0,entries.findIndex(e=>maintenanceEntryKey(e)===anchor)):0;this.rows.anchor(at,restore?view.offset:0);
   this.host.setAttribute('aria-rowcount',String(entries.length));
  }
  this.empty.hidden=!!entries.length;this.rows.refresh();
 }
 setEmpty(label:string,loading:boolean){if(label===this.emptyLabel&&this.empty.classList.contains('loading')===loading)return;this.emptyLabel=label;this.empty.classList.toggle('loading',loading);this.empty.innerHTML=icon(loading?'refresh':'check')+'<span>'+esc(label)+'</span>';}
 private remember(){if(!this.view)return;const location=this.rows.location(),entry=this.entries[location.position];if(entry){this.view.anchor=maintenanceEntryKey(entry);this.view.offset=location.offset;}if(this.entries[this.position])this.view.focused=maintenanceEntryKey(this.entries[this.position]);}
 private painted(){
  const id='maintenance-row-'+this.position;if(this.rows.items.querySelector('#'+id))this.host.setAttribute('aria-activedescendant',id);else this.host.removeAttribute('aria-activedescendant');
  if(this.view)for(const row of this.rows.items.children){const key=(row as HTMLElement).dataset.entryKey!;if(this.view.expanded.has(key))this.view.expanded.set(key,row.getBoundingClientRect().height);}
  this.remember();
 }
 private toggle(position:number,expanded?:boolean){const entry=this.entries[position],view=this.view;if(!entry||!view)return;const key=maintenanceEntryKey(entry),open=expanded??!view.expanded.has(key);if(open)view.expanded.set(key,view.expanded.get(key)||156);else view.expanded.delete(key);this.rows.refresh();}
 private row(position:number,previous?:HTMLElement){
  const entry=this.entries[position],view=this.view!,key=maintenanceEntryKey(entry),row=previous||document.createElement('div');row.className='maintenance-item';row.id='maintenance-row-'+position;row.setAttribute('role','row');row.setAttribute('aria-rowindex',String(position+1));
  if(row.dataset.entry!==entry.id){
   row.dataset.entry=entry.id;row.dataset.entryKey=key;
   row.innerHTML=`<div class="maintenance-check" role="gridcell"><input type="checkbox" data-maintain-id="${esc(entry.id)}" aria-label="选择 ${esc(entry.name)}" ${!entry.action||entry.action==='manage'?'disabled':''}></div><div class="maintenance-item-main" role="gridcell"><div class="maintenance-entry-heading"><strong>${esc(entry.name)}</strong><span class="maintenance-category">${esc(entry.category)}</span></div><span class="maintenance-path" title="${esc(entry.command||entry.source)}">${esc(entry.command||entry.source)}</span><details><summary>${icon('chevron')}详情</summary><div class="maintenance-detail-body"><p>${esc(entry.status)}${entry.detail?' · '+esc(entry.detail):''}</p><code>${esc(entry.location)}</code></div></details></div><div class="maintenance-item-end" role="gridcell"><span title="${esc(entry.status)}" class="${entry.status.includes('未找到')?'missing':''}">${entry.bytes!==undefined?size(entry.bytes):esc(compactStatus(entry.status))}</span>${entry.count!==undefined?`<small>${entry.count.toLocaleString()} 个文件</small>`:''}${entry.action==='manage'?'<button class="quiet" data-manage="pagefile">管理</button>':entry.action==='hibernate'?'<small>关闭休眠</small>':''}</div>`;
  }
  const checkbox=row.querySelector<HTMLInputElement>('input')!,details=row.querySelector<HTMLDetailsElement>('details')!,summary=details.querySelector('summary')!;
  checkbox.checked=this.selected.has(entry.id);checkbox.tabIndex=position===this.position?0:-1;summary.tabIndex=position===this.position?0:-1;
  details.open=view.expanded.has(key);row.classList.toggle('chosen',checkbox.checked);row.classList.toggle('focused',position===this.position);row.setAttribute('aria-selected',String(checkbox.checked));
  checkbox.onchange=()=>{if(this.view===view)this.choose(entry,checkbox.checked);};
  summary.onclick=event=>{event.preventDefault();this.position=position;this.toggle(position);};
  details.ontoggle=()=>{if(this.view!==view||!row.isConnected||row.dataset.entry!==entry.id)return;if(details.open!==view.expanded.has(key))this.toggle(position,details.open);};
  const management=row.querySelector<HTMLButtonElement>('[data-manage]');if(management){management.tabIndex=position===this.position?0:-1;management.onclick=this.manage;}
  row.onclick=event=>{this.position=position;if(!(event.target as Element).closest('input,summary,button,code'))this.host.focus({preventScroll:true});this.rows.refresh();};return row;
 }
 private key=(event:KeyboardEvent)=>{
  if(event.target!==this.host||event.altKey||event.metaKey)return;if(event.ctrlKey){if(event.key.toLowerCase()==='a'){event.preventDefault();event.stopPropagation();this.all();}return;}
  if(!this.entries.length||!['ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Home','End','PageDown','PageUp','Enter',' '].includes(event.key))return;event.preventDefault();event.stopPropagation();
  const entry=this.entries[this.position],step=Math.max(1,Math.floor(this.host.clientHeight/96)-1);
  if(event.key===' ') {if(entry.action&&entry.action!=='manage')this.choose(entry,!this.selected.has(entry.id));return;}
  if(event.key==='Enter'||event.key==='ArrowLeft'||event.key==='ArrowRight'){this.toggle(this.position,event.key==='ArrowLeft'?false:event.key==='ArrowRight'?true:undefined);return;}
  this.position=event.key==='Home'?0:event.key==='End'?this.entries.length-1:Math.max(0,Math.min(this.entries.length-1,this.position+(event.key==='ArrowDown'?1:event.key==='ArrowUp'?-1:event.key==='PageDown'?step:-step)));
  this.rows.reveal(this.position);this.rows.refresh();
 };
}

/** The confirmation shows every selected target, without retaining every DOM row. */
export class MaintenanceConfirmation {
 private entries:MaintenanceEntry[]=[];private position=0;private rows:VirtualRows;
 constructor(private host:HTMLElement){
  host.tabIndex=0;host.setAttribute('role','grid');host.setAttribute('aria-colcount','1');host.setAttribute('aria-label','所选维护项目，方向键浏览');
  this.rows=new VirtualRows(host,()=>this.entries.length,(position,previous)=>{const entry=this.entries[position],row=previous||document.createElement('div');row.className='maintenance-confirm-item';row.id='maintenance-confirm-row-'+position;row.dataset.confirmId=entry.id;row.setAttribute('role','row');row.setAttribute('aria-rowindex',String(position+1));row.innerHTML=`<div role="gridcell"><strong title="${esc(entry.name)}">${esc(entry.name)}</strong><span title="${esc(entry.location)}">${esc(entry.location)}</span></div>`;return row;},64,()=>{const id='maintenance-confirm-row-'+this.position;if(this.rows.items.querySelector('#'+id))host.setAttribute('aria-activedescendant',id);else host.removeAttribute('aria-activedescendant');});this.rows.setActive(false);
  host.addEventListener('keydown',event=>{if(event.target!==host||event.ctrlKey||event.altKey||!['Home','End','PageUp','PageDown','ArrowDown','ArrowUp'].includes(event.key))return;event.preventDefault();event.stopPropagation();const step=Math.max(1,Math.floor(host.clientHeight/64)-1);this.position=event.key==='Home'?0:event.key==='End'?this.entries.length-1:Math.max(0,Math.min(this.entries.length-1,this.position+(event.key==='ArrowDown'?1:event.key==='ArrowUp'?-1:event.key==='PageDown'?step:-step)));this.rows.reveal(this.position);this.rows.refresh();});
 }
 set(entries:MaintenanceEntry[]){this.entries=entries;this.position=0;this.host.setAttribute('aria-rowcount',String(entries.length));this.rows.setActive(true);this.rows.reset();}
 clear(){this.entries=[];this.rows.setActive(false);this.rows.reset();}
}
