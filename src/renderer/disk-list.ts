import type {DiskNode} from '../shared/types';
import {fileIcon} from './file-icons';
import {esc,size} from './ui';
import {VirtualRows} from './virtual-rows';

const rowHeight=52;
/** Complete scan results with a bounded DOM and one keyboard focus target. */
export class DiskList {
 private nodes:DiskNode[]=[];private totalSize=0;private context='';private position=-1;private selectedPath='';private rows:VirtualRows;
 constructor(private host:HTMLElement,private choose:(node:DiskNode)=>void,private enter:(node:DiskNode)=>void,private menu:(x:number,y:number,node:DiskNode)=>void){
  host.tabIndex=0;host.setAttribute('role','listbox');host.setAttribute('aria-label','目录内容，按大小排序');
  this.rows=new VirtualRows(host,()=>this.nodes.length,(position,previous)=>this.row(position,previous),rowHeight,()=>this.focusReference());this.rows.items.id='disk-rows';this.rows.setActive(false);
  host.addEventListener('keydown',this.key);
 }
 setActive(active:boolean){this.rows.setActive(active);}
 update(nodes:DiskNode[],totalSize:number,context:string){
  const location=this.rows.location(),anchor=this.nodes[location.position],focused=this.nodes[this.position],changed=context!==this.context;
  this.nodes=nodes;this.totalSize=totalSize;this.context=context;
  if(changed){this.position=-1;this.selectedPath='';this.rows.anchor(0);}
  else{
   const find=(node:DiskNode|undefined)=>{if(!node)return-1;const identical=nodes.indexOf(node),path=node.path;return identical>=0?identical:nodes.findIndex(next=>next.path===path);};
   const next=find(anchor),focus=find(focused);this.position=focus>=0?focus:Math.min(this.position,nodes.length-1);
   this.rows.anchor(next>=0?next:Math.min(location.position,Math.max(0,nodes.length-1)),location.offset);
  }
  this.host.setAttribute('aria-label',`目录内容，${nodes.length.toLocaleString()} 项，按大小排序`);this.rows.refresh();
 }
 select(path:string){if(path===this.selectedPath)return;this.selectedPath=path;const position=this.nodes.findIndex(node=>node.path===path);if(position>=0)this.position=position;this.rows.refresh();}
 clear(){this.update([],0,'');this.rows.reset();}
 private focusReference(){const id='disk-row-'+this.position;if(this.rows.items.querySelector('#'+id))this.host.setAttribute('aria-activedescendant',id);else this.host.removeAttribute('aria-activedescendant');}
 private chooseAt(position:number,reveal=false){
  const node=this.nodes[position];if(!node)return;this.position=position;this.selectedPath=node.path;this.choose(node);if(reveal)this.rows.reveal(position);this.rows.refresh();
 }
 private row(position:number,previous?:HTMLElement){
  const node=this.nodes[position],row=previous||document.createElement('button'),path=node.path;row.className='disk-row';row.id='disk-row-'+position;row.tabIndex=-1;row.dataset.position=String(position);row.dataset.directory=String(node.directory);
  if(row.dataset.path!==path){row.dataset.path=path;row.innerHTML=`<span class="disk-row-main"><span class="disk-row-name">${fileIcon(node.name,node.directory)}<span>${esc(node.name)}</span></span><span class="size-track"><i></i></span></span><span class="disk-row-size"></span>`;row.title=node.name;}
  row.querySelector('.disk-row-size')!.textContent=size(node.size);(row.querySelector('.size-track i') as HTMLElement).style.width=(this.totalSize?node.size/this.totalSize*100:0)+'%';
  row.setAttribute('role','option');row.setAttribute('aria-posinset',String(position+1));row.setAttribute('aria-setsize',String(this.nodes.length));row.setAttribute('aria-label',`${node.name}，${size(node.size)}，${node.directory?'文件夹，回车进入':'文件，回车预览'}`);
  row.classList.toggle('selected',path===this.selectedPath);row.setAttribute('aria-selected',String(path===this.selectedPath));
  row.onclick=()=>{this.chooseAt(position);this.host.focus({preventScroll:true});};row.ondblclick=()=>this.enter(node);
  row.oncontextmenu=event=>{event.preventDefault();this.chooseAt(position);this.host.focus({preventScroll:true});this.menu(event.clientX,event.clientY,node);};return row;
 }
 private key=(event:KeyboardEvent)=>{
  if(event.ctrlKey||event.metaKey||event.altKey)return;
  const key=event.key,navigation=['ArrowDown','ArrowUp','Home','End','PageDown','PageUp'].includes(key),context=key==='ContextMenu'||key==='F10'&&event.shiftKey;
  if(!navigation&&!['Enter',' '].includes(key)&&!context)return;event.preventDefault();event.stopPropagation();if(!this.nodes.length)return;
  const target=event.target instanceof HTMLElement?event.target.closest<HTMLElement>('.disk-row'):null,position=target?Number(target.dataset.position):this.position;
  if(navigation){const step=Math.max(1,Math.floor(this.host.clientHeight/rowHeight)-1),next=key==='Home'?0:key==='End'?this.nodes.length-1:key==='ArrowDown'?position+1:key==='ArrowUp'?Math.max(0,position-1):Math.max(0,position)+(key==='PageDown'?step:-step);this.chooseAt(Math.max(0,Math.min(this.nodes.length-1,next)),true);this.host.focus({preventScroll:true});return;}
  const next=position>=0?position:this.rows.location().position;this.chooseAt(next,true);
  if(key==='Enter')this.enter(this.nodes[next]);
  if(context)requestAnimationFrame(()=>{const row=this.rows.items.querySelector<HTMLElement>('#disk-row-'+this.position);if(!row)return;const bounds=row.getBoundingClientRect();this.menu(bounds.left+20,Math.max(this.host.getBoundingClientRect().top,bounds.top)+16,this.nodes[this.position]);});
 };
}
